// ProofPay — site
document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = `© ${new Date().getFullYear()} ProofPay`;

  const signupForm = document.getElementById('signupForm');
  if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // TODO: integrar com o backend real de criação de conta
      console.log('Cadastro (placeholder):', Object.fromEntries(new FormData(signupForm)));
      alert(typeof ppT === 'function' ? ppT('alert_signup') : 'Cadastro ainda não conectado a um backend. Em breve!');
    });
  }

  const connectWallet = document.getElementById('connectWallet');
  if (connectWallet) {
    connectWallet.addEventListener('click', () => {
      // TODO: integrar com carteira Solana (ex: wallet-adapter)
      alert(typeof ppT === 'function' ? ppT('alert_wallet') : 'Conexão com carteira Solana ainda não implementada.');
    });
  }
});
