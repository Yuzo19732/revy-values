-- ============================================================
--  ASTD Trade Values — database structure
--
--  Only the comments were translated for this review. Every executable
--  statement is identical to what runs in production. Table and column
--  names are kept in Portuguese because that is what the code queries.
--
--  HOW TO RUN: in the Supabase dashboard, "SQL Editor" -> "New query",
--  paste all of this and hit Run. Safe to run again — nothing here
--  deletes existing data.
-- ============================================================


-- ------------------------------------------------------------
--  1) PROFILES  (perfis)
--  One row per person who signed in with Discord.
--
--  Supabase already stores the user in its own table (auth.users), but
--  that one is private. This is the "public" version holding only what
--  the bot needs to show on Discord: id, name and picture.
-- ------------------------------------------------------------
create table if not exists public.perfis (
  id             uuid primary key references auth.users(id) on delete cascade,
  discord_id     text unique not null,
  discord_nome   text,
  discord_avatar text,
  criado_em      timestamptz not null default now(),
  visto_em       timestamptz not null default now()
);

-- The bot looks people up by Discord id, so this index matters.
create index if not exists perfis_discord_id_idx on public.perfis (discord_id);


-- ------------------------------------------------------------
--  2) INVENTORIES  (inventarios)
--  One row per unit a person owns.
--
--  `chave` uses the same format the site uses: "tier|name", e.g.
--  "pure|Death / Ryuk". The tier is part of the key on purpose: 12 units
--  appear twice in the spreadsheet (the regular and the Pure version)
--  with different values, and without the tier the site would add up the
--  wrong one.
--
--  Only the key and the quantity are stored, NEVER the value. Values
--  change constantly in the spreadsheet; freezing them here would make
--  totals go stale. Whoever reads (site or bot) computes the total with
--  the current value.
-- ------------------------------------------------------------
create table if not exists public.inventarios (
  perfil_id     uuid not null references public.perfis(id) on delete cascade,
  chave         text not null,
  qtd           integer not null check (qtd > 0 and qtd <= 9999),
  atualizado_em timestamptz not null default now(),
  primary key (perfil_id, chave)
);

create index if not exists inventarios_perfil_idx on public.inventarios (perfil_id);


-- ------------------------------------------------------------
--  3) SECURITY (Row Level Security)
--
--  Without this, anyone holding the site's public key could read AND
--  DELETE other people's inventories. With RLS on, the database only
--  hands over (or accepts) a row if it belongs to the caller.
--
--  The bot is the exception: it uses the service_role key, which bypasses
--  these rules — which is exactly why that key must NEVER reach the site,
--  only the bot's server-side environment.
-- ------------------------------------------------------------
alter table public.perfis       enable row level security;
alter table public.inventarios  enable row level security;

-- --- profiles ---
drop policy if exists "leitura do proprio perfil"   on public.perfis;
create policy "leitura do proprio perfil"           -- read own profile
  on public.perfis for select
  using (auth.uid() = id);

drop policy if exists "cria o proprio perfil"       on public.perfis;
create policy "cria o proprio perfil"               -- create own profile
  on public.perfis for insert
  with check (auth.uid() = id);

drop policy if exists "edita o proprio perfil"      on public.perfis;
create policy "edita o proprio perfil"              -- update own profile
  on public.perfis for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- --- inventories ---
drop policy if exists "le o proprio inventario"     on public.inventarios;
create policy "le o proprio inventario"             -- read own inventory
  on public.inventarios for select
  using (auth.uid() = perfil_id);

drop policy if exists "escreve no proprio inventario" on public.inventarios;
create policy "escreve no proprio inventario"       -- insert into own inventory
  on public.inventarios for insert
  with check (auth.uid() = perfil_id);

drop policy if exists "atualiza o proprio inventario" on public.inventarios;
create policy "atualiza o proprio inventario"       -- update own inventory
  on public.inventarios for update
  using (auth.uid() = perfil_id) with check (auth.uid() = perfil_id);

drop policy if exists "apaga do proprio inventario"  on public.inventarios;
create policy "apaga do proprio inventario"         -- delete from own inventory
  on public.inventarios for delete
  using (auth.uid() = perfil_id);


-- ------------------------------------------------------------
--  4) CREATE THE PROFILE AUTOMATICALLY ON FIRST LOGIN
--
--  When someone signs in with Discord for the first time, Supabase
--  creates the row in auth.users. This trigger copies id/name/picture
--  from Discord into `perfis` right away.
--
--  Without it, the site would have to create the profile by hand on every
--  login — and if that call failed, the bot would not find the person.
--
--  NOTE FOR REVIEW: this is the only `security definer` function. It has
--  to be, because it writes to a table the brand-new user cannot access
--  yet. It has a fixed search_path and only ever inserts the row for the
--  user being created.
-- ------------------------------------------------------------
create or replace function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, discord_id, discord_nome, discord_avatar)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'provider_id',
             new.raw_user_meta_data ->> 'sub'),
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name',
             new.raw_user_meta_data ->> 'user_name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set discord_nome   = excluded.discord_nome,
        discord_avatar = excluded.discord_avatar,
        visto_em       = now();
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();


-- ------------------------------------------------------------
--  5) SAVE THE WHOLE INVENTORY IN ONE CALL
--
--  The site sends the full list and this function syncs it: deletes what
--  is gone, inserts what is new, updates the rest.
--
--  It exists so this is ONE round trip instead of dozens. If the site did
--  it item by item and the connection dropped halfway, the inventory
--  would end up half-written. Here it is all or nothing.
--
--  NOTE FOR REVIEW: `security invoker` means this runs with the caller's
--  permissions, so the RLS policies above still apply. It also refuses
--  calls with no session.
-- ------------------------------------------------------------
create or replace function public.salvar_inventario(itens jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'precisa estar logado';   -- "must be signed in"
  end if;

  -- Remove what is no longer in the submitted list.
  -- Uses the `?` operator (does this key exist in the jsonb?) instead of
  -- "not in (select jsonb_object_keys(...))": same result, but direct and
  -- not relying on a subquery with a set-returning function.
  delete from public.inventarios
   where perfil_id = uid
     and not (itens ? chave);

  -- Insert / update what was sent
  insert into public.inventarios (perfil_id, chave, qtd, atualizado_em)
  select uid, k, least(greatest((v #>> '{}')::int, 1), 9999), now()
    from jsonb_each(itens) as t(k, v)
  on conflict (perfil_id, chave) do update
    set qtd = excluded.qtd, atualizado_em = now();
end;
$$;
