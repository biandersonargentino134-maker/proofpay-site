-- ProofPay — Histórico/timeline do acordo
--
-- Log de eventos, um por linha, pra alimentar uma timeline visual e
-- servir de auditoria simples de "o que aconteceu e quando". Não
-- substitui `deliveries`/`ai_verifications` (que já são o histórico
-- "de conteúdo" de cada rodada) — isso aqui é só a lista cronológica de
-- marcos, pra mostrar tudo junto numa linha do tempo.
--
-- IMPORTANTE — o que esta tabela NÃO é: não é mecanismo de autorização.
-- A policy de insert abaixo é deliberadamente simples (só confere que
-- quem está logando o evento participa do acordo e está se atribuindo
-- o evento a si mesmo) — ela NÃO valida se aquele event_type realmente
-- corresponde à transição de status que aconteceu. Quem garante isso de
-- verdade continua sendo as policies de UPDATE em `agreements`
-- (0005/0006/0008/0010). Se o cliente logar um evento "errado" aqui,
-- o pior caso é a timeline mostrar algo impreciso — nunca uma mudança
-- real de estado ou de dinheiro.

create table public.agreement_events (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id),
  event_type text not null check (event_type in (
    'created',
    'accepted',
    'delivery_submitted',
    'ai_verified',
    'approved',
    'revision_requested',
    'cancellation_requested',
    'cancellation_accepted',
    'cancellation_rejected',
    'cancellation_withdrawn',
    'cancelled'
  )),
  actor_id uuid null references public.profiles(id),
  meta jsonb null,
  created_at timestamptz not null default now()
);

create index agreement_events_agreement_id_idx on public.agreement_events(agreement_id);

alter table public.agreement_events enable row level security;

create policy agreement_events_select_related
  on public.agreement_events for select
  to authenticated
  using (
    exists (
      select 1 from public.agreements a
      where a.id = agreement_id
        and (a.hirer_id = auth.uid() or a.provider_id = auth.uid())
    )
  );

create policy agreement_events_insert_own
  on public.agreement_events for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.agreements a
      where a.id = agreement_id
        and (a.hirer_id = auth.uid() or a.provider_id = auth.uid())
    )
  );

-- actor_id null é usado pelo evento 'ai_verified', logado pela Edge
-- Function verify-delivery via service_role (que ignora RLS por
-- definição) — não precisa de policy de insert pra isso, só do GRANT
-- de tabela abaixo (mesmo motivo do 0009: modo "sem privilégios
-- padrão" do Supabase).
grant select, insert on public.agreement_events to authenticated;
grant select, insert on public.agreement_events to service_role;
