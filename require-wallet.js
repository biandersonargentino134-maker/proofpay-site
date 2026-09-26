// ProofPay — proteção de página: exige autenticação E carteira verificada.
//
// Mesma ordem de inclusão do require-auth.js (não inclua os dois juntos
// na mesma página — este já cobre a autenticação também).
//
// wallet_verified é checado direto no banco (fato persistido pela Edge
// Function verify-wallet-signature) — nunca uma flag local do navegador.
//
// De novo: isso é proteção de UX. A trava real contra uso indevido tem
// que existir nas policies/RPC do Supabase quando a função financeira em
// si for implementada (Etapas posteriores).
(function () {
  document.documentElement.style.visibility = 'hidden';

  function redirectToLogin() {
    try {
      sessionStorage.setItem('pp_redirect_after_login', window.location.href);
    } catch (e) {}
    window.location.replace('auth.html');
  }

  function redirectToWalletRequired() {
    try {
      sessionStorage.setItem('pp_redirect_after_login', window.location.href);
      sessionStorage.setItem('pp_wallet_required', '1');
    } catch (e) {}
    window.location.replace('auth.html');
  }

  function reveal() {
    document.documentElement.style.visibility = '';
  }

  (async function check() {
    if (typeof window.ppSupabase === 'undefined') {
      console.error('[ProofPay] require-wallet.js precisa do supabase-client.js carregado antes dele.');
      redirectToLogin();
      return;
    }

    const { data: sessionData, error: sessionError } = await window.ppSupabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      redirectToLogin();
      return;
    }

    const { data: profile, error: profileError } = await window.ppSupabase
      .from('profiles')
      .select('wallet_verified')
      .eq('id', sessionData.session.user.id)
      .single();

    if (profileError || !profile || !profile.wallet_verified) {
      redirectToWalletRequired();
      return;
    }

    reveal();
  })();
})();
