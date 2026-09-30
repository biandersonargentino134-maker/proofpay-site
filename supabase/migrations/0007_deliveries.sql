-- ProofPay — Etapa 4: entrega (descrição + links + arquivos)
--
-- Decisão confirmada: já usa upload de arquivo (Supabase Storage), não só
-- links. Cada entrega vira uma LINHA em deliveries (não sobrescreve a
-- anterior) — assim, se o contratante pedir revisão, o histórico de
-- tentativas de entrega fica preservado.
--
-- DECISÃO TOMADA SEM PERGUNTAR (documentando aqui, não escondendo):
-- o fluxo "ideal" só libera entrega quando o acordo está "in_progress",
-- que só existe depois do escrow real (blockchain, ainda não implementado
-- pelo outro desenvolvedor). Bloquear entrega até lá deixaria essa etapa
-- inteira impossível de testar. Por isso, temporariamente, entrega é
-- aceita também com o acordo ainda em "awaiting_funding". Isso é uma
-- simplificação de teste, não uma decisão de produto — quando o escrow
-- existir de verdade, o certo é apertar essa regra pra exigir
-- "in_progress".

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id),
  provider_id uuid not null references public.profiles(id),
  description text not null,
  links jsonb not null default '[]'::jsonb,
  file_paths jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index deliveries_agreement_id_idx on public.deliveries(agreement_id);

alter table public.deliveries enable row level security;

-- Só o próprio prestador do acordo pode registrar uma entrega, e só
-- enquanto o acordo estiver num estado que permite entrega (ver nota
-- acima sobre a simplificação temporária).
create policy deliveries_insert_own
  on public.deliveries for insert
  to authenticated
  with check (
    provider_id = auth.uid()
    and exists (
      select 1 from public.agreements a
      where a.id = agreement_id
        and a.provider_id = auth.uid()
        and a.status in ('awaiting_funding', 'in_progress')
    )
  );

-- Hirer e provider do acordo veem as entregas; ninguém mais.
create policy deliveries_select_related
  on public.deliveries for select
  to authenticated
  using (
    exists (
      select 1 from public.agreements a
      where a.id = agreement_id
        and (a.hirer_id = auth.uid() or a.provider_id = auth.uid())
    )
  );

grant select, insert on public.deliveries to authenticated;

-- Transição de status: só o provider do acordo pode marcar
-- delivery_submitted, e só a partir dos mesmos estados que permitem
-- registrar entrega.
create policy agreements_submit_delivery
  on public.agreements for update
  to authenticated
  using (provider_id = auth.uid() and status in ('awaiting_funding', 'in_progress'))
  with check (status = 'delivery_submitted' and provider_id = auth.uid());

-- --- Storage: bucket privado pra arquivos de evidência ---
--
-- Convenção de caminho: {agreement_id}/{arquivo}. É essa convenção que
-- permite a policy abaixo checar se quem está subindo/baixando tem
-- relação com o acordo, sem precisar de uma tabela extra ligando arquivo
-- a usuário.
insert into storage.buckets (id, name, public)
values ('delivery-evidence', 'delivery-evidence', false)
on conflict (id) do nothing;

create policy delivery_evidence_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'delivery-evidence'
    and exists (
      select 1 from public.agreements a
      where a.id::text = (storage.foldername(name))[1]
        and a.provider_id = auth.uid()
    )
  );

create policy delivery_evidence_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'delivery-evidence'
    and exists (
      select 1 from public.agreements a
      where a.id::text = (storage.foldername(name))[1]
        and (a.hirer_id = auth.uid() or a.provider_id = auth.uid())
    )
  );
