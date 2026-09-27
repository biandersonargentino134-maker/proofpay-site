-- ProofPay — Etapa 6: verificação da entrega pela IA
--
-- Duas mudanças de modelo:
--   1. Nova tabela `ai_verifications`: cada rodada de verificação vira
--      uma LINHA (mesmo padrão de `deliveries`) — se a entrega for
--      reenviada depois de uma revisão solicitada, o relatório anterior
--      não é apagado, fica no histórico.
--   2. Novo status `revision_requested`: quando o contratante não
--      aprova a entrega. Não existe fluxo de chat/mensagens no MVP (ver
--      seção 22 do prompt mestre) — o alinhamento entre as partes sobre
--      o que precisa mudar acontece fora da plataforma por enquanto. O
--      que a plataforma garante é o estado visível ("revisão
--      solicitada") e a possibilidade do prestador enviar uma nova
--      entrega depois, que dispara uma nova verificação.
--
-- Quem escreve em `ai_verifications` e quem move o status para
-- `ai_verifying` / `awaiting_approval` é SÓ a Edge Function
-- verify-delivery, usando service_role (que ignora RLS por definição no
-- Supabase) — não existe policy de insert/update nessas transições pra
-- `authenticated` de propósito. Isso impede o cliente de forjar um
-- relatório da IA ou pular a verificação escrevendo status direto.

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
  'payment_pending',
  'completed',
  'cancelled'
));

create table public.ai_verifications (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id),
  delivery_id uuid not null references public.deliveries(id),
  report jsonb not null,
  verified_count int not null default 0,
  partial_count int not null default 0,
  not_verified_count int not null default 0,
  created_at timestamptz not null default now()
);

create index ai_verifications_agreement_id_idx on public.ai_verifications(agreement_id);

alter table public.ai_verifications enable row level security;

-- Só hirer/provider do acordo relacionado podem ver o relatório.
create policy ai_verifications_select_related
  on public.ai_verifications for select
  to authenticated
  using (
    exists (
      select 1 from public.agreements a
      where a.id = agreement_id
        and (a.hirer_id = auth.uid() or a.provider_id = auth.uid())
    )
  );

grant select on public.ai_verifications to authenticated;
-- Sem grant de insert/update pra authenticated aqui — de propósito.
-- Só a service_role (Edge Function) grava relatórios.

-- Decisão do contratante sobre o relatório: aprovar ou pedir revisão.
-- Só sai de 'awaiting_approval', só o hirer, só pra um desses dois
-- destinos. Uma única policy cobre as duas transições — RLS só valida
-- a linha resultante, não qual dos dois caminhos foi escolhido.
create policy agreements_hirer_decision
  on public.agreements for update
  to authenticated
  using (hirer_id = auth.uid() and status = 'awaiting_approval')
  with check (hirer_id = auth.uid() and status in ('approved', 'revision_requested'));

-- Prestador pode reenviar entrega depois de uma revisão solicitada —
-- soma ao conjunto de estados já permitidos em 0007_deliveries.sql.
-- (drop + recreate porque RLS não tem "alter policy" pra mudar o using/check)
drop policy deliveries_insert_own on public.deliveries;
create policy deliveries_insert_own
  on public.deliveries for insert
  to authenticated
  with check (
    provider_id = auth.uid()
    and exists (
      select 1 from public.agreements a
      where a.id = agreement_id
        and a.provider_id = auth.uid()
        and a.status in ('awaiting_funding', 'in_progress', 'revision_requested')
    )
  );

drop policy agreements_submit_delivery on public.agreements;
create policy agreements_submit_delivery
  on public.agreements for update
  to authenticated
  using (provider_id = auth.uid() and status in ('awaiting_funding', 'in_progress', 'revision_requested'))
  with check (status = 'delivery_submitted' and provider_id = auth.uid());
