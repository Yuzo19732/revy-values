-- ============================================================
--  ASTD Trade Values — estrutura do banco
--
--  COMO USAR: no painel do Supabase, menu "SQL Editor" -> "New query",
--  cola TUDO isso e clica em Run. Pode rodar de novo sem medo, nada
--  aqui apaga dado existente.
-- ============================================================


-- ------------------------------------------------------------
--  1) PERFIS
--  Uma linha por pessoa que entrou com o Discord.
--
--  O Supabase já guarda o usuário na tabela dele (auth.users), mas
--  aquilo é privado. Esta tabela é a versão "pública" com só o que o
--  bot precisa pra mostrar no Discord: id, nome e foto.
-- ------------------------------------------------------------
create table if not exists public.perfis (
  id             uuid primary key references auth.users(id) on delete cascade,
  discord_id     text unique not null,
  discord_nome   text,
  discord_avatar text,
  criado_em      timestamptz not null default now(),
  visto_em       timestamptz not null default now()
);

-- O bot procura a pessoa pelo id do Discord, então esse índice importa.
create index if not exists perfis_discord_id_idx on public.perfis (discord_id);


-- ------------------------------------------------------------
--  2) INVENTÁRIOS
--  Uma linha por unidade que a pessoa tem.
--
--  `chave` é o mesmo formato que o site já usa: "tier|nome", tipo
--  "pure|Death / Ryuk". O tier vai junto de propósito: 12 unidades
--  aparecem duas vezes na planilha (a normal e a Pure) com valores
--  diferentes, e sem o tier o site somaria a errada.
--
--  Guardo só a chave e a quantidade, NÃO o valor. Valor muda toda hora
--  na planilha; se eu congelasse aqui, o total ficaria desatualizado.
--  Quem calcula é sempre quem lê (o site ou o bot), com o valor do dia.
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
--  3) SEGURANÇA (Row Level Security)
--
--  Sem isso, qualquer pessoa com a chave pública do site conseguiria
--  ler e APAGAR o inventário dos outros. Com RLS ligado, o banco só
--  entrega/aceita a linha se ela for do próprio dono.
--
--  O bot é exceção: ele usa a chave de serviço (service_role), que
--  ignora estas regras — por isso ela NUNCA pode ir pro site, só pro
--  servidor do bot.
-- ------------------------------------------------------------
alter table public.perfis       enable row level security;
alter table public.inventarios  enable row level security;

-- --- perfis ---
drop policy if exists "leitura do proprio perfil"   on public.perfis;
create policy "leitura do proprio perfil"
  on public.perfis for select
  using (auth.uid() = id);

drop policy if exists "cria o proprio perfil"       on public.perfis;
create policy "cria o proprio perfil"
  on public.perfis for insert
  with check (auth.uid() = id);

drop policy if exists "edita o proprio perfil"      on public.perfis;
create policy "edita o proprio perfil"
  on public.perfis for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- --- inventarios ---
drop policy if exists "le o proprio inventario"     on public.inventarios;
create policy "le o proprio inventario"
  on public.inventarios for select
  using (auth.uid() = perfil_id);

drop policy if exists "escreve no proprio inventario" on public.inventarios;
create policy "escreve no proprio inventario"
  on public.inventarios for insert
  with check (auth.uid() = perfil_id);

drop policy if exists "atualiza o proprio inventario" on public.inventarios;
create policy "atualiza o proprio inventario"
  on public.inventarios for update
  using (auth.uid() = perfil_id) with check (auth.uid() = perfil_id);

drop policy if exists "apaga do proprio inventario"  on public.inventarios;
create policy "apaga do proprio inventario"
  on public.inventarios for delete
  using (auth.uid() = perfil_id);


-- ------------------------------------------------------------
--  4) CRIAR O PERFIL SOZINHO NO PRIMEIRO LOGIN
--
--  Quando alguém entra com o Discord pela primeira vez, o Supabase
--  cria a linha em auth.users. Este gatilho copia nome/foto/id do
--  Discord pra tabela `perfis` na mesma hora.
--
--  Sem ele, o site teria que criar o perfil na mão a cada login — e
--  se essa chamada falhasse, o bot não acharia a pessoa.
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
--  5) SALVAR O INVENTÁRIO DE UMA VEZ SÓ
--
--  O site manda a lista inteira e esta função sincroniza: apaga o que
--  saiu, insere o que entrou, atualiza a quantidade do resto.
--
--  Existe pra ser UMA viagem ao banco em vez de dezenas. Se o site
--  fizesse item por item e a internet caísse no meio, o inventário
--  ficaria pela metade. Aqui é tudo ou nada.
-- ------------------------------------------------------------
create or replace function public.salvar_inventario(itens jsonb)
returns void
language plpgsql
security invoker              -- roda como a pessoa logada; o RLS vale
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'precisa estar logado';
  end if;

  -- tira o que não está mais na lista enviada.
  -- Uso o operador `?` (existe esta chave no jsonb?) em vez de
  -- "not in (select jsonb_object_keys(...))": faz a mesma coisa, mas é
  -- direto e não depende de subconsulta com função que devolve conjunto.
  delete from public.inventarios
   where perfil_id = uid
     and not (itens ? chave);

  -- insere/atualiza o que veio
  insert into public.inventarios (perfil_id, chave, qtd, atualizado_em)
  select uid, k, least(greatest((v #>> '{}')::int, 1), 9999), now()
    from jsonb_each(itens) as t(k, v)
  on conflict (perfil_id, chave) do update
    set qtd = excluded.qtd, atualizado_em = now();
end;
$$;
