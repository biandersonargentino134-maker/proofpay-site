-- ProofPay — correção: "permission denied for table agreements" (Etapa 6)
--
-- CAUSA RAIZ: este projeto usa o modo "sem privilégios padrão" do
-- Supabase (novos projetos, a partir de meados de 2026, não recebem
-- mais GRANT automático em tabelas novas para nenhuma role — nem anon,
-- nem authenticated, nem service_role). Isso já era visível nas
-- migrações anteriores, que sempre precisaram de um
-- "grant ... to authenticated" manual (0003, 0005, 0007) — só que
-- ninguém tinha precisado fazer o mesmo para service_role ainda,
-- porque nenhuma Edge Function anterior às da Etapa 6 lia/escrevia em
-- `agreements`/`deliveries` via service_role.
--
-- RLS e GRANT são camadas DIFERENTES:
--   - RLS (policies)  → controla QUAIS LINHAS uma role vê/edita.
--   - GRANT (tabela)  → controla SE a role pode acessar a tabela, ponto.
-- service_role ignora RLS (BYPASSRLS), mas ainda precisa do GRANT de
-- tabela — sem ele, o Postgres nem chega a avaliar RLS, barra antes
-- com "permission denied for table X".
--
-- PONTO DE ATENÇÃO (não corrigido nesta migração, só registrado):
-- se `profiles` e `wallet_challenges` tiverem o mesmo problema, a
-- verificação de carteira (verify-wallet-signature.ts, que também usa
-- service_role) pode estar falhando silenciosamente pelo mesmo motivo.
-- Isso não foi tocado aqui — é autenticação, fora do escopo desta
-- etapa — mas vale conferir/testar separadamente.

grant select, update on public.agreements to service_role;
grant select on public.deliveries to service_role;
grant select, insert on public.ai_verifications to service_role;
