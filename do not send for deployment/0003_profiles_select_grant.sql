-- ProofPay — correção pontual
-- authenticated conseguia UPDATE (Etapa 3) mas nunca recebeu SELECT/INSERT
-- explícito em profiles. RLS já limitava certo (só a própria linha) — só
-- faltava o GRANT padrão do Postgres por baixo da RLS.

grant select, insert on public.profiles to authenticated;
