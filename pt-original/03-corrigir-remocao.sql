-- ============================================================
--  CORREÇÃO — remover/diminuir unidades não estava valendo
--
--  Rode isto UMA vez no SQL Editor do Supabase.
--  (Já está incluído no 01-banco.sql pra quem for instalar do zero;
--   este arquivo existe só pra atualizar quem já instalou antes.)
--
--  Não apaga nada: só substitui a função por uma versão corrigida.
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
    raise exception 'precisa estar logado';
  end if;

  -- Tira o que não está mais na lista enviada.
  -- Uso o operador `?` (existe esta chave no jsonb?) em vez de
  -- "not in (select jsonb_object_keys(...))": faz a mesma coisa, mas é
  -- direto e não depende de subconsulta com função que devolve conjunto.
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
