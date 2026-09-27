-- ProofPay — correção pontual da Etapa 6
-- Garante explicitamente que o service_role (usado só dentro das Edge
-- Functions) tem permissão de tabela nas duas tabelas de autenticação.
-- Não muda nada da segurança pra anon/authenticated — RLS continua
-- bloqueando as duas normalmente.

grant usage on schema public to service_role;
grant all on public.wallet_challenges to service_role;
grant all on public.profiles to service_role;
