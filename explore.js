// ProofPay — Explorar Serviços (explore.html)
//
// A policy agreements_select_open já garante que só acordos com
// status = 'awaiting_provider' e provider_id nulo aparecem pra qualquer
// usuário autenticado — não é este arquivo que decide isso, é o banco.
// Aqui só escondemos os acordos do próprio usuário como contratante
// (ele não deveria aceitar o próprio acordo — o banco também bloqueia
// isso na hora de aceitar, isto aqui é só pra não nem oferecer o botão).
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof window.ppSupabase === 'undefined') {
    console.error('[ProofPay] explore.js precisa do supabase-client.js carregado antes dele.');
    return;
  }

  const { data: sessionData } = await window.ppSupabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return; // require-auth.js já está redirecionando

  const userId = session.user.id;
  const listEl = document.getElementById('ex-list');

  const { data, error } = await window.ppSupabase
    .from('agreements')
    .select('id, title, amount_usdc, created_at, hirer_id')
    .eq('status', 'awaiting_provider')
    .is('provider_id', null)
    .order('created_at', { ascending: false });

  if (error) {
    listEl.innerHTML = '<p class="ex-empty">Erro ao carregar: ' + error.message + '</p>';
    return;
  }

  const open = (data || []).filter((a) => a.hirer_id !== userId);

  if (open.length === 0) {
    listEl.innerHTML = '<p class="ex-empty">Nenhum acordo aberto no momento.</p>';
    return;
  }

  listEl.innerHTML = open.map((a) => `
    <a class="ex-card" href="agreement-detail.html?id=${encodeURIComponent(a.id)}">
      <div>
        <div class="ex-card-title">${escapeHtml(a.title)}</div>
        <div class="ex-card-meta">publicado em ${formatDate(a.created_at)}</div>
      </div>
      <div class="ex-amount">${formatAmount(a.amount_usdc)} USDC</div>
    </a>
  `).join('');
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatAmount(amount) {
  return Number(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
