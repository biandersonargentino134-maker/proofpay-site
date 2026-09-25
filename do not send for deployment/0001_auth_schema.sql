-- ProofPay — Etapa 3: estrutura de autenticação
-- Rodar isso inteiro, de uma vez, no SQL Editor do Supabase.
-- Não implementa nenhuma função financeira. Só cria a base de perfis,
-- verificação de carteira e as políticas de segurança que travam tudo
-- isso no nível do banco (não confiando no frontend).

-- =========================================================
-- 1. TABELA profiles
-- =========================================================
-- Uma linha por usuário do Supabase Auth (Google, e futuramente Phantom).
-- wallet_address / wallet_verified só podem ser escritos pela service_role
-- (dentro de uma Edge Function) — nunca pelo navegador do usuário.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  wallet_address text unique,
  wallet_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Usuário autenticado só enxerga a própria linha.
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- Usuário autenticado só pode criar a própria linha (usado pelo trigger abaixo,
-- mas a policy fica aqui como camada extra caso algo precise inserir client-side).
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Usuário autenticado pode atualizar a própria linha — mas o GRANT abaixo
-- restringe QUAIS colunas ele pode mexer nessa atualização.
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Trava por coluna: authenticated só pode escrever nome/avatar.
-- wallet_address e wallet_verified ficam de fora de propósito.
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, updated_at) on public.profiles to authenticated;

-- service_role (usada só dentro de Edge Functions) tem acesso irrestrito,
-- por definição do Supabase — não precisa de GRANT explícito.

-- Mantém updated_at correto sozinho.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =========================================================
-- 2. TRIGGER — cria o profile automaticamente no primeiro login
-- =========================================================
-- Assim que o Supabase Auth cria um usuário (ex.: primeiro login com
-- Google), essa função cria a linha correspondente em profiles,
-- puxando nome/avatar do que o Google já mandou.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- 3. TABELA wallet_challenges (nonce de uso único)
-- =========================================================
-- Fica INVISÍVEL para anon/authenticated. Só a service_role (dentro de uma
-- Edge Function, na Etapa 6) gera, lê e invalida esses desafios.
-- RLS habilitada e SEM nenhuma policy para anon/authenticated = acesso
-- negado por padrão para essas roles. Nenhum GRANT é dado a elas aqui.

create table if not exists public.wallet_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nonce text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  used_at timestamptz
);

alter table public.wallet_challenges enable row level security;

-- Nenhuma policy é criada de propósito: anon/authenticated não têm
-- select/insert/update/delete nesta tabela. Só service_role acessa.

create index if not exists idx_wallet_challenges_user on public.wallet_challenges (user_id);
create index if not exists idx_wallet_challenges_expires on public.wallet_challenges (expires_at);
