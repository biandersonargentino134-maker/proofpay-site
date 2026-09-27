// ProofPay — Detalhe do Acordo (agreement-detail.html?id=...)
//
// O botão "Aceitar" só aparece quando o próprio JS confirma as condições
// (status aberto, não é o próprio hirer) — mas quem garante isso de
// verdade é a policy agreements_accept_open no banco. Se alguém tentar
// burlar isso mexendo no HTML/JS pelo navegador, o Supabase recusa o
// update de qualquer forma.
//
// ETAPA 5: passamos a selecionar e mostrar `criteria` (gerado por IA e
// revisado pelo contratante na criação — ver agreements.js). Isso não
// muda nenhuma regra de autorização, só exibe o que já está no banco.
// A comparação critério × evidência (verificação da IA) é a Etapa 6,
// ainda não implementada.
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

function renderCriteriaList(criteria) {
  if (!Array.isArray(criteria) || criteria.length === 0) return '';

  const items = criteria.map((c) => `
    <div class="ad-criteria-item">
      <div class="ad-criteria-text">${escapeHtml(c.criterion || '')}</div>
      ${c.how_to_verify ? `<div class="ad-criteria-verify">Como verificar: ${escapeHtml(c.how_to_verify)}</div>` : ''}
    </div>
  `).join('');

  return `
    <div style="margin-top:18px">
      <h2 style="font-size:13px;color:var(--ink-soft);margin:0 0 8px">Critérios de aceite</h2>
      <div class="ad-criteria-list">${items}</div>
    </div>
  `;
}

async function renderDeliveries(deliveries) {
  if (!deliveries || deliveries.length === 0) return '';

  const blocks = await Promise.all(deliveries.map(async (d) => {
    const linksHtml = (d.links || []).map((l) =>
      `<div><a href="${escapeHtml(l)}" target="_blank" rel="noopener">${escapeHtml(l)}</a></div>`
    ).join('');

    const filesHtml = (await Promise.all((d.file_paths || []).map(async (path) => {
      const { data } = await window.ppSupabase.storage
        .from('delivery-evidence')
        .createSignedUrl(path, 3600);
      const fileName = path.split('/').pop();
      if (!data) return `<div>${escapeHtml(fileName)} (link expirado, recarregue a página)</div>`;
      return `<div><a href="${data.signedUrl}" target="_blank" rel="noopener">${escapeHtml(fileName)}</a></div>`;
    }))).join('');

    return `
      <div style="border-top:1px solid var(--line);padding-top:14px;margin-top:14px">
        <div class="ad-meta">Entrega enviada em ${formatDate(d.created_at)}</div>
        <p class="ad-desc" style="margin-top:8px">${escapeHtml(d.description)}</p>
        ${linksHtml}
        ${filesHtml}
      </div>
    `;
  }));

  return `<div style="margin-top:10px"><h2 style="font-size:13px;color:var(--ink-soft);margin:18px 0 0">Entregas</h2>${blocks.join('')}</div>`;
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
    .select('id, title, description, amount_usdc, status, criteria, hirer_id, provider_id, created_at')
    .eq('id', agreementId)
    .single();

  if (error || !agreement) {
    contentEl.innerHTML = '<p>Não foi possível carregar este acordo (ele pode não existir, ou você não tem acesso a ele).</p>';
    return;
  }

  const canAccept = agreement.status === 'awaiting_provider'
    && !agreement.provider_id
    && agreement.hirer_id !== userId;

  const { data: deliveries } = await window.ppSupabase
    .from('deliveries')
    .select('id, description, links, file_paths, created_at')
    .eq('agreement_id', agreementId)
    .order('created_at', { ascending: false });

  const deliveriesHtml = await renderDeliveries(deliveries || []);
  const criteriaHtml = renderCriteriaList(agreement.criteria);

  render();

  function render() {
    const canDeliverNow = agreement.provider_id === userId
      && ['awaiting_funding', 'in_progress'].includes(agreement.status);

    contentEl.innerHTML = `
      <span class="ad-status-pill">${STATUS_LABELS[agreement.status] || agreement.status}</span>
      <h1 style="margin:0 0 4px">${escapeHtml(agreement.title)}</h1>
      <div class="ad-amount">${formatAmount(agreement.amount_usdc)} USDC</div>
      <p class="ad-desc">${escapeHtml(agreement.description)}</p>
      ${criteriaHtml}
      <div class="ad-meta">Publicado em ${formatDate(agreement.created_at)}</div>
      ${canAccept ? `
        <button type="button" class="btn btn-primary" id="ad-accept-btn" style="margin-top:18px">Aceitar acordo</button>
        <div id="ad-action-status" class="ad-action-status"></div>
      ` : ''}
      ${canDeliverNow ? `
        <a class="btn btn-primary" href="deliver.html?id=${encodeURIComponent(agreementId)}" style="margin-top:18px;display:inline-block">Enviar entrega</a>
      ` : ''}
      ${deliveriesHtml}
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
