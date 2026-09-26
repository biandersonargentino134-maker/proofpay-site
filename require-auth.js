// ProofPay — proteção de página: exige autenticação (sessão válida).
//
// Como incluir numa página nova:
//   1. <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   2. <script src="supabase-client.js"></script>
//   3. <script src="require-auth.js"></script>
//   (nessa ordem, o quanto antes no <head> — antes do conteúdo da página)
//
// Esconde a página até confirmar a sessão. Sem sessão, manda pra
// auth.html e guarda a URL atual pra voltar sozinho depois do login.
//
// Isso é proteção de UX, não a barreira de segurança real — quem garante
// a segurança de verdade são as policies de RLS no Supabase. Mesmo que
// alguém burle isso no navegador, o banco continua recusando o que não é
// dele.
(function () {
  document.documentElement.style.visibility = 'hidden';

  function redirectToLogin() {
    try {
      sessionStorage.setItem('pp_redirect_after_login', window.location.href);
    } catch (e) { /* sessionStorage indisponível — segue sem "voltar depois" */ }
    window.location.replace('auth.html');
  }

  function reveal() {
    document.documentElement.style.visibility = '';
  }

  (async function check() {
    if (typeof window.ppSupabase === 'undefined') {
      console.error('[ProofPay] require-auth.js precisa do supabase-client.js carregado antes dele.');
      redirectToLogin();
      return;
    }

    const { data, error } = await window.ppSupabase.auth.getSession();
    if (error || !data.session) {
      redirectToLogin();
      return;
    }

    reveal();
  })();
})();
