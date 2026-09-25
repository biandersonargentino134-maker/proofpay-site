// ProofPay — Tela de autenticação (Etapa 4)
//
// Nesta etapa, os botões de Google e Phantom AINDA NÃO fazem login real —
// isso vem nas Etapas 5 e 6. O que já funciona de verdade aqui:
//   - checar se existe uma sessão ativa ao carregar a página;
//   - logout real, via supabase.auth.signOut().
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

  async function refreshSessionState() {
    const { data, error } = await window.ppSupabase.auth.getSession();

    loadingEl.classList.add('hide');
    loadingEl.style.display = 'none';

    if (error) {
      loginCard.classList.remove('hide');
      statusEl.textContent = 'Erro ao verificar sessão: ' + error.message;
      statusEl.classList.add('error');
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

  function showPending(message) {
    statusEl.textContent = message;
    statusEl.classList.remove('error');
    statusEl.classList.add('pending');
  }

  // Placeholders — implementação real nas Etapas 5 (Google) e 6 (Phantom).
  btnGoogle.addEventListener('click', () => {
    showPending('Login com Google será ativado na Etapa 5.');
  });

  btnPhantom.addEventListener('click', () => {
    showPending('Conexão com a Phantom será ativada na Etapa 6.');
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

  // Mantém a tela em sincronia se a sessão mudar em outra aba, por exemplo.
  window.ppSupabase.auth.onAuthStateChange(() => {
    refreshSessionState();
  });

  refreshSessionState();
});
