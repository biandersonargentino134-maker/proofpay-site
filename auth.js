// ProofPay — Tela de autenticação (Etapa 6: conexão real com a Phantom)
//
// Fluxo da Phantom (Opção 1 aprovada): exige sessão já autenticada (Google).
// A carteira nunca é declarada "verificada" pelo navegador — só o retorno
// da Edge Function verify-wallet-signature pode marcar isso.
document.addEventListener('DOMContentLoaded', async () => {
  const loadingEl = document.getElementById('auth-loading');
  const loginCard = document.getElementById('auth-login-card');
  const loginStatusEl = document.getElementById('auth-login-status');
  const sessionCard = document.getElementById('auth-session-card');
  const sessionEmailEl = document.getElementById('auth-session-email');
  const btnGoogle = document.getElementById('btn-google');
  const btnPhantom = document.getElementById('btn-phantom');
  const btnLogout = document.getElementById('btn-logout');
  const walletBadge = document.getElementById('wallet-badge');
  const walletAddressEl = document.getElementById('wallet-address');
  const walletStatusEl = document.getElementById('wallet-status');

  if (typeof window.ppSupabase === 'undefined') {
    loadingEl.textContent = 'Não foi possível conectar ao Supabase. Veja o console (F12).';
    console.error('[ProofPay] window.ppSupabase não existe — confirme supabase-client.js.');
    return;
  }

  function showLoginStatus(message, kind) {
    loginStatusEl.textContent = message;
    loginStatusEl.className = 'auth-status' + (kind ? ' ' + kind : '');
  }

  function showWalletStatus(message, kind) {
    walletStatusEl.textContent = message;
    walletStatusEl.className = 'auth-status' + (kind ? ' ' + kind : '');
  }

  function uint8ToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }

  function truncateAddress(addr) {
    return addr.length > 10 ? addr.slice(0, 4) + '…' + addr.slice(-4) : addr;
  }

  function consumeOAuthErrorFromUrl() {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const error = url.searchParams.get('error_description') || hashParams.get('error_description')
      || url.searchParams.get('error') || hashParams.get('error');
    if (error) {
      showLoginStatus('Não foi possível entrar com Google: ' + decodeURIComponent(error), 'error');
      window.history.replaceState({}, document.title, url.pathname);
      return true;
    }
    return false;
  }

  async function loadWalletStatus(userId) {
    const { data, error } = await window.ppSupabase
      .from('profiles')
      .select('wallet_address, wallet_verified')
      .eq('id', userId)
      .single();

    if (error) {
      showWalletStatus('Não foi possível carregar o status da carteira.', 'error');
      return;
    }

    if (data.wallet_verified && data.wallet_address) {
      walletBadge.textContent = 'verificada';
      walletBadge.className = 'wallet-badge verified';
      walletAddressEl.textContent = truncateAddress(data.wallet_address);
      walletAddressEl.style.display = 'block';
      btnPhantom.textContent = 'Trocar carteira';
    } else {
      walletBadge.textContent = 'não conectada';
      walletBadge.className = 'wallet-badge pending';
      walletAddressEl.style.display = 'none';
    }
  }

  async function refreshSessionState() {
    const { data, error } = await window.ppSupabase.auth.getSession();
    loadingEl.style.display = 'none';

    if (error) {
      loginCard.classList.remove('hide');
      showLoginStatus('Erro ao verificar sessão: ' + error.message, 'error');
      return;
    }

    if (data.session) {
      loginCard.classList.add('hide');
      sessionCard.classList.add('show');
      sessionEmailEl.textContent = data.session.user.email || 'Conta conectada';
      await loadWalletStatus(data.session.user.id);
    } else {
      sessionCard.classList.remove('show');
      loginCard.classList.remove('hide');
    }
  }

  btnGoogle.addEventListener('click', async () => {
    btnGoogle.disabled = true;
    showLoginStatus('Redirecionando para o Google…', 'pending');
    const { error } = await window.ppSupabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth.html' }
    });
    if (error) {
      btnGoogle.disabled = false;
      showLoginStatus('Erro ao iniciar login com Google: ' + error.message, 'error');
    }
  });

  btnPhantom.addEventListener('click', async () => {
    showWalletStatus('', null);

    const provider = window.solana;
    if (!provider || !provider.isPhantom) {
      showWalletStatus('Phantom não encontrada. Instale a extensão em phantom.app e recarregue a página.', 'error');
      return;
    }

    btnPhantom.disabled = true;
    try {
      // 1) conectar
      showWalletStatus('Abrindo a Phantom…', 'pending');
      let connectResp;
      try {
        connectResp = await provider.connect();
      } catch (e) {
        showWalletStatus('Conexão cancelada na Phantom.', 'error');
        return;
      }
      const walletAddress = connectResp.publicKey.toString();

      // 2) pedir um código de verificação (nonce) para a sessão atual
      showWalletStatus('Gerando código de verificação…', 'pending');
      const { data: session } = await window.ppSupabase.auth.getSession();
      if (!session.session) {
        showWalletStatus('Sua sessão expirou. Recarregue a página e entre novamente.', 'error');
        return;
      }

      const { data: challengeData, error: challengeError } =
        await window.ppSupabase.functions.invoke('request-wallet-challenge');

      if (challengeError || !challengeData || challengeData.error) {
        showWalletStatus('Erro ao gerar código: ' + (challengeData?.error || challengeError?.message || 'desconhecido'), 'error');
        return;
      }

      // 3) pedir assinatura da mensagem (nunca uma transação)
      showWalletStatus('Confirme a assinatura na Phantom…', 'pending');
      let signed;
      try {
        const encodedMessage = new TextEncoder().encode(challengeData.message);
        signed = await provider.signMessage(encodedMessage, 'utf8');
      } catch (e) {
        showWalletStatus('Assinatura cancelada na Phantom.', 'error');
        return;
      }

      const signatureB64 = uint8ToBase64(signed.signature);

      // 4) verificar no servidor
      showWalletStatus('Verificando assinatura…', 'pending');
      const { data: verifyData, error: verifyError } =
        await window.ppSupabase.functions.invoke('verify-wallet-signature', {
          body: {
            wallet_address: walletAddress,
            signature_base64: signatureB64,
            nonce: challengeData.nonce
          }
        });

      if (verifyError || !verifyData || verifyData.error) {
        showWalletStatus(verifyData?.error || verifyError?.message || 'Não foi possível verificar a carteira.', 'error');
        return;
      }

      showWalletStatus('Carteira verificada com sucesso!', 'success');
      await loadWalletStatus(session.session.user.id);
    } finally {
      btnPhantom.disabled = false;
    }
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

  window.ppSupabase.auth.onAuthStateChange(() => {
    refreshSessionState();
  });

  consumeOAuthErrorFromUrl();
  await refreshSessionState();
});
