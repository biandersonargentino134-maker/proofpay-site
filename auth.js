// ProofPay — Tela de autenticação (Etapa 7: separação de authenticated /
// walletConnected / walletVerified)
//
// Três estados, tratados como coisas DIFERENTES:
//   authenticated  — existe uma sessão válida do Supabase (Google).
//   walletVerified — fato PERSISTIDO no banco (profiles.wallet_verified).
//                    Só muda via verify-wallet-signature. Desconectar a
//                    Phantom no navegador NUNCA zera isso (Opção B).
//   walletConnected— fato AO VIVO do navegador: a Phantom está conectada
//                    a este site agora? É local e temporário.
//
// Authorization de verdade (o que pode ou não fazer algo financeiro) é
// walletVerified && walletConnected && o endereço conectado bater com o
// verificado — isso é o que a Etapa 8 vai usar.
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
  const walletNoteEl = document.getElementById('wallet-note');
  const walletStatusEl = document.getElementById('wallet-status');

  if (typeof window.ppSupabase === 'undefined') {
    loadingEl.textContent = 'Não foi possível conectar ao Supabase. Veja o console (F12).';
    console.error('[ProofPay] window.ppSupabase não existe — confirme supabase-client.js.');
    return;
  }

  // ---- estado central ----
  const state = {
    session: null,
    profile: null,        // { wallet_address, wallet_verified } | null
    walletConnected: false,
    connectedAddress: null
  };

  function getAuthState() {
    const verified = !!(state.profile && state.profile.wallet_verified);
    const connected = state.walletConnected;
    const matches = !!(
      verified && connected && state.connectedAddress &&
      state.profile.wallet_address === state.connectedAddress
    );
    return {
      authenticated: !!state.session,
      walletVerified: verified,
      walletConnected: connected,
      walletMatches: matches
    };
  }

  function showLoginStatus(message, kind) {
    loginStatusEl.textContent = message;
    loginStatusEl.className = 'auth-status' + (kind ? ' ' + kind : '');
  }

  function showWalletStatus(message, kind) {
    walletStatusEl.textContent = message;
    walletStatusEl.className = 'auth-status' + (kind ? ' ' + kind : '');
  }

  async function extractInvokeError(error) {
    if (!error) return 'Erro desconhecido.';
    const resp = error.context;
    if (resp && typeof resp.clone === 'function') {
      try {
        const body = await resp.clone().json();
        if (body && (body.error || body.message)) return body.error || body.message;
      } catch (e) { /* corpo não é JSON */ }
      try {
        const text = await resp.clone().text();
        if (text) return text;
      } catch (e) { /* sem corpo legível */ }
    }
    return error.message || 'Erro desconhecido.';
  }

  function uint8ToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }

  function truncateAddress(addr) {
    return addr && addr.length > 10 ? addr.slice(0, 4) + '…' + addr.slice(-4) : addr;
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

  // ---- renderização da caixa de carteira, a partir do estado central ----
  function renderWalletUI() {
    const s = getAuthState();
    walletNoteEl.style.display = 'none';
    walletAddressEl.style.display = 'none';

    if (!s.walletVerified && !s.walletConnected) {
      walletBadge.textContent = 'não conectada';
      walletBadge.className = 'wallet-badge pending';
      btnPhantom.textContent = 'Conectar Phantom';
      btnPhantom.style.display = '';
      return;
    }

    if (!s.walletVerified && s.walletConnected) {
      walletBadge.textContent = 'conectada, não verificada';
      walletBadge.className = 'wallet-badge warning';
      walletAddressEl.textContent = truncateAddress(state.connectedAddress);
      walletAddressEl.style.display = 'block';
      btnPhantom.textContent = 'Verificar carteira';
      btnPhantom.style.display = '';
      return;
    }

    if (s.walletVerified && s.walletConnected && s.walletMatches) {
      walletBadge.textContent = 'verificada';
      walletBadge.className = 'wallet-badge verified';
      walletAddressEl.textContent = truncateAddress(state.profile.wallet_address);
      walletAddressEl.style.display = 'block';
      btnPhantom.textContent = 'Trocar carteira';
      btnPhantom.style.display = '';
      return;
    }

    if (s.walletVerified && s.walletConnected && !s.walletMatches) {
      walletBadge.textContent = 'carteira diferente da verificada';
      walletBadge.className = 'wallet-badge warning';
      walletAddressEl.textContent = truncateAddress(state.connectedAddress);
      walletAddressEl.style.display = 'block';
      walletNoteEl.textContent = 'Esta não é a carteira verificada da sua conta (' + truncateAddress(state.profile.wallet_address) + '). Verifique esta se quiser trocar.';
      walletNoteEl.style.display = 'block';
      btnPhantom.textContent = 'Verificar esta carteira';
      btnPhantom.style.display = '';
      return;
    }

    // s.walletVerified && !s.walletConnected — Opção B: continua "verificada".
    walletBadge.textContent = 'verificada';
    walletBadge.className = 'wallet-badge verified';
    walletAddressEl.textContent = truncateAddress(state.profile.wallet_address);
    walletAddressEl.style.display = 'block';
    walletNoteEl.textContent = 'Carteira não conectada neste navegador agora.';
    walletNoteEl.style.display = 'block';
    btnPhantom.textContent = 'Reconectar Phantom';
    btnPhantom.style.display = '';
  }

  async function loadProfile(userId) {
    const { data, error } = await window.ppSupabase
      .from('profiles')
      .select('wallet_address, wallet_verified')
      .eq('id', userId)
      .single();

    if (error) {
      showWalletStatus('Não foi possível carregar o status da carteira.', 'error');
      state.profile = null;
      return;
    }
    state.profile = data;
  }

  // ---- Phantom: eventos ao vivo (troca de conta / desconexão) ----
  function attachPhantomEvents() {
    const provider = window.solana;
    if (!provider || !provider.isPhantom) return;

    provider.on('connect', (publicKey) => {
      state.walletConnected = true;
      state.connectedAddress = publicKey ? publicKey.toString() : provider.publicKey?.toString() || null;
      renderWalletUI();
    });

    provider.on('disconnect', () => {
      // Opção B: só o estado AO VIVO cai. walletVerified no banco não muda.
      state.walletConnected = false;
      state.connectedAddress = null;
      renderWalletUI();
    });

    provider.on('accountChanged', (publicKey) => {
      if (publicKey) {
        state.walletConnected = true;
        state.connectedAddress = publicKey.toString();
      } else {
        state.walletConnected = false;
        state.connectedAddress = null;
      }
      renderWalletUI();
    });
  }

  // Tenta reconectar em silêncio (sem popup) se este site já foi autorizado
  // antes na Phantom — só assim dá pra saber o walletConnected real ao
  // carregar a página, sem incomodar quem não vai usar a carteira agora.
  async function trySilentReconnect() {
    const provider = window.solana;
    if (!provider || !provider.isPhantom) return;
    try {
      const resp = await provider.connect({ onlyIfTrusted: true });
      state.walletConnected = true;
      state.connectedAddress = resp.publicKey.toString();
    } catch (e) {
      state.walletConnected = false;
      state.connectedAddress = null;
    }
  }

  async function refreshSessionState() {
    const { data, error } = await window.ppSupabase.auth.getSession();
    loadingEl.style.display = 'none';
    state.session = data && data.session ? data.session : null;

    if (error) {
      loginCard.classList.remove('hide');
      showLoginStatus('Erro ao verificar sessão: ' + error.message, 'error');
      return;
    }

    if (state.session) {
      loginCard.classList.add('hide');
      sessionCard.classList.add('show');
      sessionEmailEl.textContent = state.session.user.email || 'Conta conectada';
      await loadProfile(state.session.user.id);
      await trySilentReconnect();
      renderWalletUI();
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
    const s = getAuthState();

    const provider = window.solana;
    if (!provider || !provider.isPhantom) {
      showWalletStatus('Phantom não encontrada. Instale a extensão em phantom.app e recarregue a página.', 'error');
      return;
    }

    btnPhantom.disabled = true;
    try {
      // Caso "verificada, mas desconectada agora" — só reconectar, sem
      // pedir assinatura de novo (já foi verificada antes).
      if (s.walletVerified && !s.walletConnected) {
        showWalletStatus('Reconectando…', 'pending');
        try {
          const resp = await provider.connect();
          state.walletConnected = true;
          state.connectedAddress = resp.publicKey.toString();
          showWalletStatus('', null);
          renderWalletUI();
        } catch (e) {
          showWalletStatus('Conexão cancelada na Phantom.', 'error');
        }
        return;
      }

      // Qualquer outro caso: conectar (se preciso) + assinar + verificar.
      showWalletStatus('Abrindo a Phantom…', 'pending');
      let walletAddress = state.connectedAddress;
      if (!s.walletConnected) {
        let connectResp;
        try {
          connectResp = await provider.connect();
        } catch (e) {
          showWalletStatus('Conexão cancelada na Phantom.', 'error');
          return;
        }
        walletAddress = connectResp.publicKey.toString();
        state.walletConnected = true;
        state.connectedAddress = walletAddress;
      }

      showWalletStatus('Gerando código de verificação…', 'pending');
      const { data: session } = await window.ppSupabase.auth.getSession();
      if (!session.session) {
        showWalletStatus('Sua sessão expirou. Recarregue a página e entre novamente.', 'error');
        return;
      }

      const { data: challengeData, error: challengeError } =
        await window.ppSupabase.functions.invoke('request-wallet-challenge');

      if (challengeError || !challengeData || challengeData.error) {
        const msg = challengeData?.error || await extractInvokeError(challengeError);
        showWalletStatus('Erro ao gerar código: ' + msg, 'error');
        return;
      }

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

      showWalletStatus('Verificando assinatura…', 'pending');
      const { data: verifyData, error: verifyError } =
        await window.ppSupabase.functions.invoke('wallet-signature', {
          body: {
            wallet_address: walletAddress,
            signature_base64: signatureB64,
            nonce: challengeData.nonce
          }
        });

      if (verifyError || !verifyData || verifyData.error) {
        const msg = verifyData?.error || await extractInvokeError(verifyError);
        showWalletStatus(msg, 'error');
        return;
      }

      showWalletStatus('Carteira verificada com sucesso!', 'success');
      await loadProfile(session.session.user.id);
      renderWalletUI();
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
    state.profile = null;
    state.walletConnected = false;
    state.connectedAddress = null;
    await refreshSessionState();
    btnLogout.disabled = false;
    btnLogout.textContent = 'Sair';
  });

  window.ppSupabase.auth.onAuthStateChange(() => {
    refreshSessionState();
  });

  attachPhantomEvents();
  consumeOAuthErrorFromUrl();
  await refreshSessionState();
});
