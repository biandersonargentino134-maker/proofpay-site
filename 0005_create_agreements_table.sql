-- ProofPay — Etapa 2: modelagem de acordos
--
-- Decisões confirmadas com o dono do projeto:
--   - Acordo fica ABERTO (provider_id nulo) até alguém aceitar — não é
--     escolha de prestador específico na criação (etapa de "aceitar
--     acordo" fica para uma etapa futura, quando existir a tela
--     "Explorar serviços").
--   - Nesta etapa o acordo já nasce como "awaiting_provider" (publicado),
--     sem passo de rascunho/revisão de critérios — a geração de
--     critérios pela IA é uma etapa futura (seção 13 do PROMPT MESTRE).
--     O estado "draft" continua existindo no CHECK por já estar previsto
--     no fluxo, mas nada nesta etapa o utiliza ainda.
--
-- RLS desta etapa é DELIBERADAMENTE mínima: só INSERT (o próprio usuário
-- como hirer) e SELECT (ver acordos onde é hirer OU provider). Não existe
-- policy de UPDATE ainda — aceitar acordo, enviar entrega, aprovar etc.
-- exigem suas próprias regras de autorização e ficam para as etapas que
-- implementarem essas ações, não antes.

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  hirer_id uuid not null references public.profiles(id),
  provider_id uuid null references public.profiles(id),
  title text not null,
  description text not null,
  criteria jsonb null,
  amount_usdc numeric(12,2) not null check (amount_usdc > 0),
  status text not null default 'draft' check (status in (
    'draft',
    'awaiting_provider',
    'funded',
    'in_progress',
    'delivery_submitted',
    'ai_verifying',
    'awaiting_approval',
    'approved',
    'payment_pending',
    'completed',
    'cancelled'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agreements_hirer_id_idx on public.agreements(hirer_id);
create index agreements_provider_id_idx on public.agreements(provider_id);
create index agreements_status_idx on public.agreements(status);

-- updated_at automático, mesmo padrão que outras tabelas do projeto podem
-- vir a usar.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger agreements_set_updated_at
  before update on public.agreements
  for each row execute function public.set_updated_at();

alter table public.agreements enable row level security;

-- Só o próprio usuário autenticado pode criar um acordo em nome dele
-- mesmo como contratante (hirer). Não dá pra criar em nome de outro id.
create policy agreements_insert_own
  on public.agreements for insert
  to authenticated
  with check (hirer_id = auth.uid());

-- Só enxerga acordos onde é o contratante OU o prestador (ninguém vê
-- acordo alheio ainda — a visão "Explorar serviços"/mural de acordos
-- abertos é uma policy nova, de uma etapa futura, não esta).
create policy agreements_select_own
  on public.agreements for select
  to authenticated
  using (hirer_id = auth.uid() or provider_id = auth.uid());

-- Mesmo padrão de 0003_profiles_select_grant.sql: RLS restringe por
-- LINHA, mas o GRANT por TABELA também precisa existir por baixo.
grant select, insert on public.agreements to authenticated;
