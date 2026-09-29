-- ProofPay — Cancelamento de acordo, em 3 fases
--
-- FASE 1 (ninguém aceitou ainda): contratante cancela livre, sem
-- consentimento — não tem quem consentir ainda.
--
-- FASE 2 (já tem prestador, sem entrega ainda): qualquer um dos dois
-- pode SOLICITAR, mas precisa do consentimento do outro lado. O acordo
-- fica em 'cancellation_requested' até alguém responder (aceitar ou
-- recusar) ou quem pediu desistir.
--
-- FASE 3 (entrega já enviada): DE PROPÓSITO não existe nenhuma policy
-- de cancelamento a partir daqui. Nenhum status cobre
-- delivery_submitted/ai_verifying/awaiting_approval/revision_requested
-- nas policies abaixo — então RLS bloqueia qualquer tentativa. As partes
-- resolvem fora da plataforma, mesmo padrão já usado pra revisão
-- solicitada. Isso é proposital, não esquecimento (ver seção 22 do
-- prompt mestre: não criar sistema de disputa/arbitragem).
--
-- Cancelamento é sempre "suave" (UPDATE status = 'cancelled'), nunca
-- DELETE — preserva histórico, mesmo padrão do resto do projeto.

alter table public.agreements drop constraint agreements_status_check;
alter table public.agreements add constraint agreements_status_check check (status in (
  'draft',
  'awaiting_provider',
  'awaiting_funding',
  'funded',
  'in_progress',
  'delivery_submitted',
  'ai_verifying',
  'awaiting_approval',
  'approved',
  'revision_requested',
  'cancellation_requested',
  'payment_pending',
  'completed',
  'cancelled'
));

alter table public.agreements
  add column cancel_requested_by uuid null references public.profiles(id),
  add column cancel_requested_at timestamptz null,
  add column cancel_reason text null,
  add column pre_cancel_status text null;

-- --- FASE 1: contratante cancela livre, sem prestador ainda ---
create policy agreements_hirer_cancel_open
  on public.agreements for update
  to authenticated
  using (status = 'awaiting_provider' and hirer_id = auth.uid())
  with check (status = 'cancelled' and hirer_id = auth.uid());

-- --- FASE 2a: qualquer um dos dois SOLICITA o cancelamento ---
-- pre_cancel_status é informado pelo próprio cliente (ele já sabe o
-- status atual, acabou de carregar a página) — serve só pra saber pra
-- onde voltar se o pedido for recusado.
create policy agreements_request_cancellation
  on public.agreements for update
  to authenticated
  using (
    status in ('awaiting_funding', 'in_progress')
    and (hirer_id = auth.uid() or provider_id = auth.uid())
  )
  with check (
    status = 'cancellation_requested'
    and cancel_requested_by = auth.uid()
    and pre_cancel_status in ('awaiting_funding', 'in_progress')
  );

-- --- FASE 2b: quem PEDIU desiste do próprio pedido ---
create policy agreements_withdraw_cancel_request
  on public.agreements for update
  to authenticated
  using (status = 'cancellation_requested' and cancel_requested_by = auth.uid())
  with check (
    status in ('awaiting_funding', 'in_progress')
    and cancel_requested_by is null
  );

-- --- FASE 2c: o OUTRO lado decide — aceita (vira cancelled) ou recusa
-- (volta pro status anterior) ---
create policy agreements_cancel_decision
  on public.agreements for update
  to authenticated
  using (
    status = 'cancellation_requested'
    and (hirer_id = auth.uid() or provider_id = auth.uid())
    and cancel_requested_by <> auth.uid()
  )
  with check (
    status in ('cancelled', 'awaiting_funding', 'in_progress')
  );

-- LIMITAÇÃO CONHECIDA (mesma de sempre, documentada desde 0006): estas
-- policies validam a LINHA final, não travam quais colunas mudam junto
-- — title/amount_usdc poderiam em teoria ser alterados na mesma chamada.
-- Baixo risco prático aqui, mesma decisão de não expandir escopo.
