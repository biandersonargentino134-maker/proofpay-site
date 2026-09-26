-- ProofPay — correção crítica de segurança
-- A policy profiles_update_own (e profiles_insert_own) restringe por LINHA
-- (auth.uid() = id), mas o GRANT de UPDATE/INSERT em 0003 e na Etapa 3 é
-- por TABELA inteira, não por coluna. Resultado: qualquer usuário logado
-- consegue, hoje, marcar a própria wallet_verified = true e definir
-- wallet_address livremente, direto pelo client, sem nunca assinar nada
-- com a Phantom — o que anula o fluxo de request-wallet-challenge /
-- verify-wallet-signature.
--
-- Esta migração tira o GRANT geral de UPDATE/INSERT de `authenticated` e
-- devolve só nas colunas que o próprio usuário deveria poder editar.
-- wallet_verified e wallet_address ficam só graváveis por service_role
-- (que é o que as Edge Functions usam, e que ignora GRANT/RLS por
-- definição no Supabase).
--
-- Ajuste a lista de colunas "públicas" abaixo (hoje: full_name) para o
-- que realmente existir na sua tabela profiles além de wallet_*.

revoke update on public.profiles from authenticated;
revoke insert on public.profiles from authenticated;

grant update (full_name) on public.profiles to authenticated;
grant insert (id, full_name) on public.profiles to authenticated;

-- Depois de rodar isto, teste no console do navegador logado:
--   window.ppSupabase.from('profiles')
--     .update({ wallet_verified: true })
--     .eq('id', (await window.ppSupabase.auth.getSession()).data.session.user.id)
-- O resultado esperado agora é um erro de permissão (RLS/coluna), não
-- mais um update bem-sucedido.
