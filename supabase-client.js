// ProofPay — Client do Supabase
//
// Etapa 2: só inicializa a conexão. Nenhuma função de autenticação, sessão
// ou dado financeiro é implementada aqui — isso vem a partir da Etapa 3.
//
// Requer que a lib oficial do Supabase já tenha sido carregada ANTES deste
// arquivo, via:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//
// A "anon key" abaixo é pública por definição do próprio Supabase: feita
// para ser exposta no navegador, e sozinha não dá nenhum acesso além do
// que as políticas de RLS permitirem. A service_role key NUNCA deve entrar
// neste arquivo, nem em nenhum outro arquivo do site.
(function () {
  const SUPABASE_URL = 'https://cofkwsalepvrepzsnnav.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvZmt3c2FsZXB2cmVwenNubmF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNTQzMTcsImV4cCI6MjEwNTkzMDMxN30.KBwO3SKcjhIpP-B7Dfj9SVZJXiAzDWgJfFeqdIVflgI';

  if (typeof supabase === 'undefined' || !supabase.createClient) {
    console.error('[ProofPay] Lib do Supabase não carregada — confirme que o <script> do CDN vem ANTES de supabase-client.js.');
    return;
  }

  window.ppSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
