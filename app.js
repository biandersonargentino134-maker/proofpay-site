// ProofPay — Dashboard (app.html)
//
// require-auth.js já garante, antes deste script rodar, que existe uma
// sessão válida (senão redireciona pra auth.html). Este arquivo só
// preenche a tela com os dados da conta.
//
// wallet_verified vem direto do banco (fato persistido) — nunca é
// inventado aqui, igual ao resto do site.
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof window.ppSupabase === 'undefined') {
    console.error('[ProofPay] app.js precisa do supabase-client.js carregado antes dele.');
    return;
  }

  const { data } = await window.ppSupabase.auth.getSession();
  const session = data.session;
  if (!session) return; // require-auth.js já está redirecionando

  const emailEl = document.getElementById('app-email');
  const greetingEl = document.getElementById('app-greeting');
  const walletPillEl = document.getElementById('app-wallet-pill');
  const logoutBtn = document.getElementById('app-logout');

  emailEl.textContent = session.user.email || 'Conta conectada';
  greetingEl.textContent = 'Olá, ' + (session.user.email ? session.user.email.split('@')[0] : 'bem-vindo');

  const { data: profile, error } = await window.ppSupabase
    .from('profiles')
    .select('wallet_address, wallet_verified')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) {
    walletPillEl.textContent = 'não foi possível verificar';
    walletPillEl.className = 'wallet-pill pending';
  } else if (profile.wallet_verified) {
    walletPillEl.textContent = 'verificada';
    walletPillEl.className = 'wallet-pill verified';
  } else {
    walletPillEl.textContent = 'não verificada';
    walletPillEl.className = 'wallet-pill pending';
  }

  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    await window.ppSupabase.auth.signOut();
    window.location.href = 'index.html';
  });
});
