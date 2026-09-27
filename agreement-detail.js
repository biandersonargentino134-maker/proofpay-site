// ProofPay — Detalhe do Acordo (agreement-detail.html?id=...)
//
// O botão "Aceitar" só aparece quando o próprio JS confirma as condições
// (status aberto, não é o próprio hirer) — mas quem garante isso de
// verdade é a policy agreements_accept_open no banco. Se alguém tentar
// burlar isso mexendo no HTML/JS pelo navegador, o Supabase recusa o
// update de qualquer forma. O mesmo vale pra tudo que a Etapa 6
// adiciona abaixo (aprovar/pedir revisão) — a policy
// agreements_hirer_decision (0008_ai_verification.sql) é quem decide
// de verdade, este arquivo só reflete o que ela permite.
//
// ETAPA 6: exibe o relatório de verificação da IA (tabela
// `ai_verifications`, escrita só pela Edge Function verify-delivery via
// service_role — o cliente nunca escreve nela) e as ações do
// contratante sobre esse relatório.
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
  revision_requested: 'Revisão solicitada',
  payment_pending: 'Pagamento pendente',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

const RESULT_LABELS = { verified: 'Verificado', partial: 'Parcial', not_verified: 'Não verificado' };
const RESULT_ICONS = { verified: '✓', partial: '⚠', not_verified: '✕' };

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

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

function renderReport(verification) {
  if (!verification) return '';

  const report = Array.isArray(verification.report) ? verification.report : [];
  const itemsHtml = report.map((item) => `
    <div class="ad-report-item">
      <div class="ad-report-item-head">
        <span class="ad-report-icon ${item.result}">${RESULT_ICONS[item.result] || '?'}</span>
        ${escapeHtml(item.criterion)}
      </div>
      <div class="ad-report-evidence">${escapeHtml(item.evidence || '')}</div>
    </div>
  `).join('');

  return `
    <div style="margin-top:18px">
      <h2 style="font-size:13px;color:var(--ink-soft);margin:0 0 4px">Relatório da IA</h2>
      <div class="ad-meta" style="margin-top:0">Gerado em ${formatDateTime(verification.created_at)}</div>
      <div class="ad-report-summary">
        <span class="ad-report-badge verified">${verification.verified_count} verificado(s)</span>
        <span class="ad-report-badge partial">${verification.partial_count} parcial(is)</span>
        <span class="ad-report-badge not_verified">${verification.not_verified_count} não verificado(s)</span>
      </div>
      ${itemsHtml}
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

// Repassa erros de supabase.functions.invoke — o corpo com a mensagem
// real vem em error.context quando a Edge Function responde != 2xx.
async function extractInvokeError(error) {
  if (!error) return 'Erro desconhecido.';
  const resp = error.context;
  if (resp && typeof resp.clone === 'function') {
    try {
      const body = await resp.clone().json();
      if (body && (body.error || body.message)) return body.error || body.message;
    } catch (e) { /* corpo não é JSON */ }
  }
  return error.message || 'Erro desconhecido.';
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

  const isHirer = agreement.hirer_id === userId;
  const isProvider = agreement.provider_id === userId;

  const canAccept = agreement.status === 'awaiting_provider'
    && !agreement.provider_id
    && agreement.hirer_id !== userId;

  const [{ data: deliveries }, { data: verifications }] = await Promise.all([
    window.ppSupabase
      .from('deliveries')
      .select('id, description, links, file_paths, created_at')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: false }),
    window.ppSupabase
      .from('ai_verifications')
      .select('id, report, verified_count, partial_count, not_verified_count, created_at')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const latestVerification = (verifications && verifications[0]) || null;
  const deliveriesHtml = await renderDeliveries(deliveries || []);
  const criteriaHtml = renderCriteriaList(agreement.criteria);
  const reportHtml = renderReport(latestVerification);

  render();

  function statusBannerHtml() {
    if (agreement.status === 'ai_verifying') {
      return `<div class="ad-banner pending">A IA está verificando a entrega agora — isso pode levar até 20 segundos. Atualize a página em instantes.</div>`;
    }
    if (agreement.status === 'delivery_submitted') {
      return `
        <div class="ad-banner warning">
          A verificação automática da IA ainda não rodou (ou falhou) para esta entrega.
          <div style="margin-top:8px">
            <button type="button" class="btn btn-ghost" id="ad-retry-verify-btn">Executar verificação da IA</button>
          </div>
          <div id="ad-retry-status" class="ad-action-status"></div>
        </div>
      `;
    }
    if (agreement.status === 'revision_requested') {
      return `
        <div class="ad-banner warning">
          Revisão solicitada pelo contratante. Combine com ${isProvider ? 'o contratante' : 'o prestador'} o que precisa mudar
          (fora da plataforma, por enquanto) ${isProvider ? 'e envie uma nova entrega quando ajustar.' : '.'}
          ${isProvider ? `<div style="margin-top:8px"><a class="btn btn-primary" href="deliver.html?id=${encodeURIComponent(agreementId)}">Enviar nova entrega</a></div>` : ''}
        </div>
      `;
    }
    if (agreement.status === 'approved') {
      return `<div class="ad-banner success">Entrega aprovada pelo contratante. (A liberação do pagamento em escrow depende da integração blockchain, ainda não implementada.)</div>`;
    }
    return '';
  }

  function decisionActionsHtml() {
    if (agreement.status !== 'awaiting_approval' || !isHirer) return '';
    return `
      <div class="ad-decision-actions">
        <button type="button" class="btn btn-primary" id="ad-approve-btn">Aprovar entrega</button>
        <button type="button" class="btn btn-ghost" id="ad-revise-btn">Solicitar revisão</button>
      </div>
      <div id="ad-decision-status" class="ad-action-status"></div>
    `;
  }

  function render() {
    // 'revision_requested' não entra aqui de propósito — esse caso já
    // tem o próprio link "Enviar nova entrega" dentro do banner acima.
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
      ${statusBannerHtml()}
      ${reportHtml}
      ${decisionActionsHtml()}
      ${deliveriesHtml}
    `;

    if (canAccept) {
      document.getElementById('ad-accept-btn').addEventListener('click', onAccept);
    }
    const retryBtn = document.getElementById('ad-retry-verify-btn');
    if (retryBtn) retryBtn.addEventListener('click', onRetryVerify);
    const approveBtn = document.getElementById('ad-approve-btn');
    if (approveBtn) approveBtn.addEventListener('click', () => onDecision('approved'));
    const reviseBtn = document.getElementById('ad-revise-btn');
    if (reviseBtn) reviseBtn.addEventListener('click', () => onDecision('revision_requested'));
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

  async function onRetryVerify() {
    const btn = document.getElementById('ad-retry-verify-btn');
    const statusEl = document.getElementById('ad-retry-status');
    btn.disabled = true;
    statusEl.textContent = 'Rodando verificação da IA (pode levar até 20s)…';
    statusEl.className = 'ad-action-status pending';

    const { error: invokeError } = await window.ppSupabase.functions.invoke('verify-delivery', {
      body: { agreement_id: agreementId },
    });

    if (invokeError) {
      const msg = await extractInvokeError(invokeError);
      statusEl.textContent = 'Erro: ' + msg;
      statusEl.className = 'ad-action-status error';
      btn.disabled = false;
      return;
    }

    statusEl.textContent = 'Verificação concluída! Recarregando…';
    statusEl.className = 'ad-action-status success';
    window.location.reload();
  }

  async function onDecision(newStatus) {
    const approveBtn = document.getElementById('ad-approve-btn');
    const reviseBtn = document.getElementById('ad-revise-btn');
    const statusEl = document.getElementById('ad-decision-status');
    approveBtn.disabled = true;
    reviseBtn.disabled = true;
    statusEl.textContent = 'Salvando decisão…';
    statusEl.className = 'ad-action-status';

    const { error: updateError } = await window.ppSupabase
      .from('agreements')
      .update({ status: newStatus })
      .eq('id', agreementId);

    if (updateError) {
      statusEl.textContent = 'Erro: ' + updateError.message;
      statusEl.className = 'ad-action-status error';
      approveBtn.disabled = false;
      reviseBtn.disabled = false;
      return;
    }

    agreement.status = newStatus;
    render();
  }
});
