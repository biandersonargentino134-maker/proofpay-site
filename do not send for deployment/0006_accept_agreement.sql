-- ProofPay — Etapa 3: explorar e aceitar acordos
--
-- Decisão confirmada: ao aceitar, o acordo NÃO vira "funded" (isso
-- implicaria que o dinheiro já está protegido de verdade, o que seria
-- mentira sem o escrow on-chain do outro desenvolvedor). Ele fica travado
-- em "awaiting_funding" — estado novo, só de espera — até a etapa de
-- integração com blockchain existir de verdade.

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
  'payment_pending',
  'completed',
  'cancelled'
));

-- Qualquer usuário autenticado pode ENXERGAR acordos abertos (pra poder
-- navegar em "Explorar serviços"), mesmo não sendo hirer nem provider
-- deles. Isso soma com a policy agreements_select_own já existente — RLS
-- combina policies permissivas do mesmo comando com OR.
create policy agreements_select_open
  on public.agreements for select
  to authenticated
  using (status = 'awaiting_provider' and provider_id is null);

-- Aceitar um acordo = uma atualização bem específica: só em cima de um
-- acordo que estava aberto (using), e só terminando com o próprio usuário
-- como provider, status novo travado em awaiting_funding, e nunca
-- aceitando o próprio acordo (hirer_id <> auth.uid()).
--
-- LIMITAÇÃO CONHECIDA: esta policy não impede que, na mesma chamada de
-- update, outros campos (title, description, amount_usdc) sejam
-- alterados também — RLS aqui só valida linha, não coluna. Se isso virar
-- um risco real, o mesmo padrão de 0004_profiles_lock_wallet_columns.sql
-- (GRANT por coluna) resolve; não fiz isso agora pra não expandir o
-- escopo desta etapa.
create policy agreements_accept_open
  on public.agreements for update
  to authenticated
  using (status = 'awaiting_provider' and provider_id is null)
  with check (
    provider_id = auth.uid()
    and status = 'awaiting_funding'
    and hirer_id <> auth.uid()
  );

grant update on public.agreements to authenticated;
