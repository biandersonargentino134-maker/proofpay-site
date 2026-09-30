-- ProofPay — Editar acordo (antes do aceite) + materiais do contratante (depois do aceite)
--
-- REGRAS:
--   1. Enquanto ninguém aceitou (status 'awaiting_provider', provider_id nulo),
--      o contratante pode editar título, descrição, valor e critérios.
--   2. Depois do aceite, os TERMOS (título, descrição, valor, critérios)
--      ficam travados. O contratante só pode ANEXAR informações/arquivos
--      para o prestador ver.
--
-- Rodar inteiro, de uma vez, no SQL Editor do Supabase.

-- =========================================================
-- 1. Editar acordo aberto
-- =========================================================
create policy agreements_hirer_edit_open
  on public.agreements for update
  to authenticated
  using (hirer_id = auth.uid() and status = 'awaiting_provider' and provider_id is null)
  with check (hirer_id = auth.uid() and status = 'awaiting_provider' and provider_id is null);

-- (já existe desde 0006; repetido só por segurança, é idempotente)
grant update on public.agreements to authenticated;

-- =========================================================
-- 2. Trava dos termos depois do aceite
-- =========================================================
-- RLS só valida a linha final e soma policies com OR, então sozinha ela
-- não impede alterar valor/título "de carona" em outro update (limitação
-- registrada em 0006 e 0010). Este trigger fecha isso: os termos só podem
-- mudar se o acordo estava aberto ANTES e continua aberto DEPOIS.
create or replace function public.agreements_lock_terms()
returns trigger
language plpgsql
as $$
begin
  if (
    new.title       is distinct from old.title or
    new.description is distinct from old.description or
    new.amount_usdc is distinct from old.amount_usdc or
    new.criteria    is distinct from old.criteria or
    new.hirer_id    is distinct from old.hirer_id
  ) then
    if not (
      old.status = 'awaiting_provider' and old.provider_id is null
      and new.status = 'awaiting_provider' and new.provider_id is null
    ) then
      raise exception 'Os termos do acordo (titulo, descricao, valor, criterios) nao podem ser alterados depois que ele e aceito.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists agreements_lock_terms_trg on public.agreements;
create trigger agreements_lock_terms_trg
  before update on public.agreements
  for each row execute function public.agreements_lock_terms();

-- =========================================================
-- 3. Materiais do contratante para o prestador
-- =========================================================
-- Uma linha por item. Pode ser um arquivo (com nota opcional) ou só uma nota.
create table public.agreement_attachments (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id),
  uploader_id uuid not null references public.profiles(id),
  file_path text null,
  file_name text null,
  note text null,
  created_at timestamptz not null default now(),
  constraint agreement_attachments_has_content check (file_path is not null or note is not null)
);

create index agreement_attachments_agreement_id_idx on public.agreement_attachments(agreement_id);

alter table public.agreement_attachments enable row level security;

-- Contratante e prestador do acordo veem.
create policy agreement_attachments_select_related
  on public.agreement_attachments for select
  to authenticated
  using (
    exists (
      select 1 from public.agreements a
      where a.id = agreement_id
        and (a.hirer_id = auth.uid() or a.provider_id = auth.uid())
    )
  );

-- Só o contratante adiciona, e só com o acordo aceito e ainda ativo.
create policy agreement_attachments_insert_hirer
  on public.agreement_attachments for insert
  to authenticated
  with check (
    uploader_id = auth.uid()
    and exists (
      select 1 from public.agreements a
      where a.id = agreement_id
        and a.hirer_id = auth.uid()
        and a.status in ('awaiting_funding', 'in_progress', 'revision_requested')
    )
  );

-- Só quem enviou remove, e só enquanto o acordo está ativo.
create policy agreement_attachments_delete_hirer
  on public.agreement_attachments for delete
  to authenticated
  using (
    uploader_id = auth.uid()
    and exists (
      select 1 from public.agreements a
      where a.id = agreement_id
        and a.hirer_id = auth.uid()
        and a.status in ('awaiting_funding', 'in_progress', 'revision_requested')
    )
  );

-- Projeto em modo "sem privilégios padrão" (ver 0009): GRANT manual.
grant select, insert, delete on public.agreement_attachments to authenticated;

-- =========================================================
-- 4. Storage: bucket privado agreement-attachments
-- =========================================================
-- Caminho: {agreement_id}/{arquivo}
insert into storage.buckets (id, name, public)
values ('agreement-attachments', 'agreement-attachments', false)
on conflict (id) do nothing;

create policy agreement_attachments_storage_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'agreement-attachments'
    and exists (
      select 1 from public.agreements a
      where a.id::text = (storage.foldername(name))[1]
        and a.hirer_id = auth.uid()
        and a.status in ('awaiting_funding', 'in_progress', 'revision_requested')
    )
  );

create policy agreement_attachments_storage_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'agreement-attachments'
    and exists (
      select 1 from public.agreements a
      where a.id::text = (storage.foldername(name))[1]
        and (a.hirer_id = auth.uid() or a.provider_id = auth.uid())
    )
  );

create policy agreement_attachments_storage_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'agreement-attachments'
    and exists (
      select 1 from public.agreements a
      where a.id::text = (storage.foldername(name))[1]
        and a.hirer_id = auth.uid()
        and a.status in ('awaiting_funding', 'in_progress', 'revision_requested')
    )
  );

-- =========================================================
-- 5. Timeline: novos tipos de evento
-- =========================================================
alter table public.agreement_events drop constraint if exists agreement_events_event_type_check;
alter table public.agreement_events add constraint agreement_events_event_type_check check (event_type in (
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
  'cancelled',
  'edited',
  'attachment_added'
));
