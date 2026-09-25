// ProofPay — Tela de autenticação (Etapa 5: Google OAuth real)
//
// Login com Google agora é real, via Supabase Auth (OAuth). A Phantom
// continua como placeholder — isso é a Etapa 6.
document.addEventListener('DOMContentLoaded', async () => {
  const loadingEl = document.getElementById('auth-loading');
  const loginCard = document.getElementById('auth-login-card');
  const sessionCard = document.getElementById('auth-session-card');
  const sessionEmailEl = document.getElementById('auth-session-email');
  const statusEl = document.getElementById('auth-status');
  const btnGoogle = document.getElementById('btn-google');
  const btnPhantom = document.getElementById('btn-phantom');
  const btnLogout = document.getElementById('btn-logout');

  if (typeof window.ppSupabase === 'undefined') {
    loadingEl.textContent = 'Não foi possível conectar ao Supabase. Veja o console (F12).';
    console.error('[ProofPay] window.ppSupabase não existe — confirme supabase-client.js.');
    return;
  }

  function showStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle('error', !!isError);
    statusEl.classList.toggle('pending', !isError);
  }

  // O Google pode voltar com ?error=...&error_description=... (ex.: usuário
  // cancelou o consentimento) — checa isso ANTES de checar sessão, e depois
  // limpa a URL pra não deixar esse estado preso num refresh.
  function consumeOAuthErrorFromUrl() {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const error = url.searchParams.get('error_description') || hashParams.get('error_description')
      || url.searchParams.get('error') || hashParams.get('error');

    if (error) {
      showStatus('Não foi possível entrar com Google: ' + decodeURIComponent(error), true);
      window.history.replaceState({}, document.title, url.pathname);
      return true;
    }
    return false;
  }

  async function refreshSessionState() {
    const { data, error } = await window.ppSupabase.auth.getSession();

    loadingEl.style.display = 'none';

    if (error) {
      loginCard.classList.remove('hide');
      showStatus('Erro ao verificar sessão: ' + error.message, true);
      return;
    }

    if (data.session) {
      loginCard.classList.add('hide');
      sessionCard.classList.add('show');
      sessionEmailEl.textContent = data.session.user.email || 'Conta conectada';
    } else {
      sessionCard.classList.remove('show');
      loginCard.classList.remove('hide');
    }
  }

  btnGoogle.addEventListener('click', async () => {
    btnGoogle.disabled = true;
    const originalText = btnGoogle.textContent;
    showStatus('Redirecionando para o Google…', false);

    const { error } = await window.ppSupabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // volta pra própria auth.html, no mesmo domínio de onde a página
        // foi carregada — evita fixar um domínio só (ex.: Netlify agora,
        // outro depois) diretamente no código.
        redirectTo: window.location.origin + '/auth.html'
      }
    });

    // Se chegou aqui, o redirecionamento para o Google NÃO aconteceu —
    // ou seja, deu erro antes de sair da página.
    if (error) {
      btnGoogle.disabled = false;
      btnGoogle.textContent = originalText;
      showStatus('Erro ao iniciar login com Google: ' + error.message, true);
    }
  });

  // Placeholder — implementação real na Etapa 6.
  btnPhantom.addEventListener('click', () => {
    showStatus('Conexão com a Phantom será ativada na Etapa 6.', false);
  });

  btnLogout.addEventListener('click', async () => {
    btnLogout.disabled = true;
    btnLogout.textContent = 'Saindo…';
    const { error } = await window.ppSupabase.auth.signOut();
    if (error) {
      btnLogout.disabled = false;
      btnLogout.textContent = 'Sair';
      alert('Erro ao sair: ' + error.message);
      return;
    }
    await refreshSessionState();
    btnLogout.disabled = false;
    btnLogout.textContent = 'Sair';
  });

  // Mantém a tela em sincronia se a sessão mudar (ex.: voltando do Google).
  window.ppSupabase.auth.onAuthStateChange(() => {
    refreshSessionState();
  });

  const hadOAuthError = consumeOAuthErrorFromUrl();
  await refreshSessionState();
  if (!hadOAuthError && !loginCard.classList.contains('hide')) {
    statusEl.textContent = '';
  }
});
