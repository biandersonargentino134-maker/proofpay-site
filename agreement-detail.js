// ProofPay — Detalhe do Acordo (agreement-detail.html?id=...)
//
// O botão "Aceitar" só aparece quando o próprio JS confirma as condições
// (status aberto, não é o próprio hirer) — mas quem garante isso de
// verdade é a policy agreements_accept_open no banco. Se alguém tentar
// burlar isso mexendo no HTML/JS pelo navegador, o Supabase recusa o
// update de qualquer forma.
const STATUS_LABELS = {
  draft: 'Rascunho',
  awaiting_provider: 'Aguardando prestador',
  awaiting_funding: 'Aguardando financiamento',
  funded: 'Financiado',
  in_progress: 'Em andamento',
  delivery_submitted: 'Entrega enviada',
  ai_verifying: 'IA verificando',
  awaiting_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  payment_pending: 'Pagamento pendente',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

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

document.addEventListener('DOMContentLoaded', async () => {
  const contentEl = document.getElementById('ad-content');

  if (typeof window.ppSupabase === 'undefined') {
    console.error('[ProofPay] agreement-detail.js precisa do supabase-client.js carregado antes dele.');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const agreementId = params.get('id');
  if (!agreementId) {
    contentEl.innerHTML = '<p>Nenhum acordo informado na URL.</p>';
    return;
  }

  const { data: sessionData } = await window.ppSupabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return; // require-auth.js já está redirecionando
  const userId = session.user.id;

  const { data: agreement, error } = await window.ppSupabase
    .from('agreements')
    .select('id, title, description, amount_usdc, status, hirer_id, provider_id, created_at')
    .eq('id', agreementId)
    .single();

  if (error || !agreement) {
    contentEl.innerHTML = '<p>Não foi possível carregar este acordo (ele pode não existir, ou você não tem acesso a ele).</p>';
    return;
  }

  const canAccept = agreement.status === 'awaiting_provider'
    && !agreement.provider_id
    && agreement.hirer_id !== userId;

  render();

  function render() {
    contentEl.innerHTML = `
      <span class="ad-status-pill">${STATUS_LABELS[agreement.status] || agreement.status}</span>
      <h1 style="margin:0 0 4px">${escapeHtml(agreement.title)}</h1>
      <div class="ad-amount">${formatAmount(agreement.amount_usdc)} USDC</div>
      <p class="ad-desc">${escapeHtml(agreement.description)}</p>
      <div class="ad-meta">Publicado em ${formatDate(agreement.created_at)}</div>
      ${canAccept ? `
        <button type="button" class="btn btn-primary" id="ad-accept-btn" style="margin-top:18px">Aceitar acordo</button>
        <div id="ad-action-status" class="ad-action-status"></div>
      ` : ''}
    `;

    if (canAccept) {
      document.getElementById('ad-accept-btn').addEventListener('click', onAccept);
    }
  }

  async function onAccept() {
    const btn = document.getElementById('ad-accept-btn');
    const statusEl = document.getElementById('ad-action-status');
    btn.disabled = true;
    statusEl.textContent = 'Aceitando…';
    statusEl.className = 'ad-action-status';

    const { error: updateError } = await window.ppSupabase
      .from('agreements')
      .update({ provider_id: userId, status: 'awaiting_funding' })
      .eq('id', agreementId);

    if (updateError) {
      statusEl.textContent = 'Erro ao aceitar: ' + updateError.message;
      statusEl.className = 'ad-action-status error';
      btn.disabled = false;
      return;
    }

    statusEl.textContent = 'Acordo aceito! Aguardando financiamento.';
    statusEl.className = 'ad-action-status success';
    agreement.status = 'awaiting_funding';
    agreement.provider_id = userId;
    render();
  }
});
