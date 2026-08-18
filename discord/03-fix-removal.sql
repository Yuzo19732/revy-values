-- ============================================================
--  FIX — removing/decreasing units was not taking effect
--
--  Run this ONCE in the Supabase SQL Editor.
--  (It is already included in 01-database.sql for anyone installing
--   from scratch; this file exists only to update an earlier install.)
--
--  It deletes nothing: it just replaces the function with a fixed version.
--
--  Only the comments were translated for this review. Every executable
--  statement is identical to what runs in production.
-- ============================================================

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

  insert into public.inventarios (perfil_id, chave, qtd, atualizado_em)
  select uid, k, least(greatest((v #>> '{}')::int, 1), 9999), now()
    from jsonb_each(itens) as t(k, v)
  on conflict (perfil_id, chave) do update
    set qtd = excluded.qtd, atualizado_em = now();
end;
$$;
