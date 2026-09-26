// ProofPay — chip de conta no header (Etapa 9)
//
// Não muda nada se não houver sessão (o header padrão de "Entrar/Criar
// conta" continua como está). Se houver sessão, troca o conteúdo do
// #pp-account-slot por um chip com o estado da conta e um menu com
// carteira + logout.
//
// wallet_verified vem direto do banco (fato persistido) — o chip nunca
// inventa esse status sozinho.
document.addEventListener('DOMContentLoaded', async () => {
  const slot = document.getElementById('pp-account-slot');
  if (!slot) return;

  if (typeof window.ppSupabase === 'undefined') {
    console.error('[ProofPay] account-header.js precisa do supabase-client.js carregado antes dele.');
    return;
  }

  const t = (key) => (typeof ppT === 'function' ? ppT(key) : key);

  const { data, error } = await window.ppSupabase.auth.getSession();
  if (error || !data.session) return; // mantém Entrar/Criar conta como estão

  const user = data.session.user;
  const { data: profile } = await window.ppSupabase
    .from('profiles')
    .select('full_name, wallet_verified')
    .eq('id', user.id)
    .single();

  const displayName = (profile && profile.full_name) || (user.email ? user.email.split('@')[0] : 'Conta');
  const walletVerified = !!(profile && profile.wallet_verified);

  slot.innerHTML = `
    <div class="pp-account" id="pp-account">
      <button type="button" class="pp-account-btn" id="pp-account-btn">
        <span class="pp-account-dot${walletVerified ? ' verified' : ''}"></span>
        ${displayName}
        <svg class="pp-account-caret" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="pp-account-menu" id="pp-account-menu">
        <div class="pp-account-email">${user.email || ''}</div>
        <div class="pp-account-wallet-line">
          <span class="pp-account-dot${walletVerified ? ' verified' : ''}"></span>
          ${walletVerified ? t('account_wallet_verified') : t('account_wallet_pending')}
        </div>
        <a href="auth.html">${t('account_menu_profile')}</a>
        <button type="button" id="pp-account-logout">${t('account_menu_logout')}</button>
      </div>
    </div>
  `;

  const btn = document.getElementById('pp-account-btn');
  const menu = document.getElementById('pp-account-menu');
  const logoutBtn = document.getElementById('pp-account-logout');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!slot.contains(e.target)) menu.classList.remove('open');
  });

  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    await window.ppSupabase.auth.signOut();
    window.location.reload();
  });
});
