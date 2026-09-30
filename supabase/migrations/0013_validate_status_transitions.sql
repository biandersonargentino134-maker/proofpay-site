-- ProofPay — trava de transições de status do acordo
--
-- PROBLEMA: as policies de UPDATE em `agreements` (0006, 0007, 0008, 0010)
-- são permissivas e o Postgres soma as condições WITH CHECK com OR. Na
-- prática, quem passa o USING de UMA policy pode gravar uma linha que
-- satisfaça o CHECK de OUTRA. Exemplo: o contratante de um acordo aberto
-- passa o USING de "cancelar acordo aberto" e poderia gravar
-- status = 'approved' (que é o CHECK da policy de decisão).
--
-- CORREÇÃO: um trigger que valida a transição (status antigo -> novo) e
-- QUEM pode fazê-la. É a mesma matriz que as telas já usam; nada do fluxo
-- atual muda.
--
-- Chamadas sem usuário (auth.uid() nulo) passam direto: é o caso da
-- service_role usada pela Edge Function verify-delivery
-- (delivery_submitted -> ai_verifying -> awaiting_approval) e do SQL Editor.
-- anon/authenticated nunca chegam aqui sem uid.
--
-- Rodar inteiro, de uma vez, no SQL Editor do Supabase.

create or replace function public.agreements_validate_transition()
returns trigger
language plpgsql
as $$
declare
  uid uuid := auth.uid();
  is_hirer boolean;
  is_provider boolean;
  allowed boolean;
begin
  if uid is null then
    return new;
  end if;

  is_hirer := (old.hirer_id = uid);
  is_provider := (old.provider_id is not null and old.provider_id = uid);

  -- provider_id só pode mudar no aceite (aberto -> awaiting_funding,
  -- e o novo prestador é quem está chamando, nunca o próprio contratante).
  if new.provider_id is distinct from old.provider_id then
    if not (
      old.status = 'awaiting_provider'
      and old.provider_id is null
      and new.status = 'awaiting_funding'
      and new.provider_id = uid
      and old.hirer_id <> uid
    ) then
      raise exception 'provider_id so pode ser definido ao aceitar um acordo aberto.'
        using errcode = '42501';
    end if;
  end if;

  -- Sem mudança de status (ex.: edição de termos): quem pode isso já é
  -- decidido pelas policies e pelo trigger agreements_lock_terms.
  if new.status = old.status then
    return new;
  end if;

  allowed :=
    -- contratante cancela acordo ainda aberto
    (old.status = 'awaiting_provider' and new.status = 'cancelled' and is_hirer)
    -- prestador aceita acordo aberto
    or (old.status = 'awaiting_provider' and new.status = 'awaiting_funding'
        and new.provider_id = uid and old.provider_id is null and old.hirer_id <> uid)
    -- prestador envia entrega
    or (old.status in ('awaiting_funding', 'in_progress', 'revision_requested')
        and new.status = 'delivery_submitted' and is_provider)
    -- qualquer das partes solicita cancelamento (em nome próprio)
    or (old.status in ('awaiting_funding', 'in_progress')
        and new.status = 'cancellation_requested'
        and (is_hirer or is_provider)
        and new.cancel_requested_by = uid)
    -- resposta ao pedido de cancelamento: quem pediu desiste; o outro lado
    -- aceita (cancelled) ou recusa (volta ao status anterior)
    or (old.status = 'cancellation_requested' and (is_hirer or is_provider) and (
          (old.cancel_requested_by = uid
             and new.status in ('awaiting_funding', 'in_progress'))
          or (old.cancel_requested_by is distinct from uid
             and new.status in ('cancelled', 'awaiting_funding', 'in_progress'))
        ))
    -- contratante decide sobre o relatório da IA
    or (old.status = 'awaiting_approval'
        and new.status in ('approved', 'revision_requested') and is_hirer);

  if not allowed then
    raise exception 'Transicao de status nao permitida: % -> %', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists agreements_validate_transition_trg on public.agreements;
create trigger agreements_validate_transition_trg
  before update on public.agreements
  for each row execute function public.agreements_validate_transition();

-- TESTE (no console do navegador, logado como contratante de um acordo
-- aberto). Deve dar erro "Transicao de status nao permitida":
--   await window.ppSupabase.from('agreements')
--     .update({ status: 'approved' }).eq('id', '<id do acordo>')
