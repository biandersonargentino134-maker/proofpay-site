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
  cancellation_requested: 'Cancelamento solicitado',
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

function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Estados em que o contratante ainda pode anexar materiais/informações
// para o prestador (precisa bater com 0012_edit_agreement_and_attachments.sql).
const ATTACH_STATUSES = ['awaiting_funding', 'in_progress', 'revision_requested'];

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

function renderVerificationHistory(verifications) {
  if (!verifications || verifications.length === 0) return '';

  const blocks = verifications.map((verification, i) => {
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

    const isLatest = i === 0;

    return `
      <div style="${isLatest ? '' : 'opacity:.75;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)'}">
        <div class="ad-meta" style="margin-top:0">
          ${isLatest ? 'Verificação mais recente' : 'Verificação anterior'} — ${formatDateTime(verification.created_at)}
        </div>
        <div class="ad-report-summary">
          <span class="ad-report-badge verified">${verification.verified_count} verificado(s)</span>
          <span class="ad-report-badge partial">${verification.partial_count} parcial(is)</span>
          <span class="ad-report-badge not_verified">${verification.not_verified_count} não verificado(s)</span>
        </div>
        ${itemsHtml}
      </div>
    `;
  });

  return `
    <div style="margin-top:18px">
      <h2 style="font-size:13px;color:var(--ink-soft);margin:0 0 4px">Relatório${verifications.length > 1 ? 's' : ''} da IA</h2>
      ${blocks.join('')}
    </div>
  `;
}

const EVENT_LABELS = {
  created: 'Acordo criado',
  accepted: 'Aceito pelo prestador',
  delivery_submitted: 'Entrega enviada',
  ai_verified: 'IA verificou a entrega',
  approved: 'Entrega aprovada',
  revision_requested: 'Revisão solicitada',
  cancellation_requested: 'Cancelamento solicitado',
  cancellation_accepted: 'Cancelamento aceito',
  cancellation_rejected: 'Cancelamento recusado',
  cancellation_withdrawn: 'Pedido de cancelamento retirado',
  cancelled: 'Acordo cancelado',
  edited: 'Acordo editado pelo contratante',
  attachment_added: 'Material adicionado pelo contratante',
};

function renderTimeline(events, isHirer, isProvider, userId) {
  if (!events || events.length === 0) return '';

  const items = events.map((e) => {
    let who = '';
    if (e.actor_id === userId) who = 'Você';
    else if (e.event_type === 'ai_verified') who = 'IA';
    else if (e.actor_id) who = 'A outra parte';

    const label = EVENT_LABELS[e.event_type] || e.event_type;
    return `
      <div style="display:flex;gap:10px;align-items:baseline;padding:6px 0">
        <div style="font-size:12px;color:var(--ink-faint);white-space:nowrap;min-width:120px">${formatDateTime(e.created_at)}</div>
        <div style="font-size:13.5px">${escapeHtml(label)}${who ? ` <span style="color:var(--ink-faint)">— ${who}</span>` : ''}</div>
      </div>
    `;
  }).join('');

  return `
    <div style="margin-top:18px">
      <h2 style="font-size:13px;color:var(--ink-soft);margin:0 0 8px">Linha do tempo</h2>
      <div>${items}</div>
    </div>
  `;
}

// Loga um evento na timeline. Nunca trava o fluxo principal se falhar —
// isso é só exibição, não autorização (ver 0011_agreement_events.sql).
async function logEvent(agreementId, eventType, actorId, meta) {
  const { error } = await window.ppSupabase.from('agreement_events').insert({
    agreement_id: agreementId,
    event_type: eventType,
    actor_id: actorId,
    meta: meta || null,
  });
  if (error) console.error('[ProofPay] Falha ao logar evento na timeline:', eventType, error.message);
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
    .select('id, title, description, amount_usdc, status, criteria, hirer_id, provider_id, created_at, cancel_requested_by, cancel_requested_at, cancel_reason, pre_cancel_status, updated_at')
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

  const [{ data: deliveries }, { data: verifications }, { data: events }] = await Promise.all([
    window.ppSupabase
      .from('deliveries')
      .select('id, description, links, file_paths, created_at')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: false }),
    window.ppSupabase
      .from('ai_verifications')
      .select('id, report, verified_count, partial_count, not_verified_count, created_at')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: false }),
    window.ppSupabase
      .from('agreement_events')
      .select('id, event_type, actor_id, created_at')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: true }),
  ]);

  const deliveriesHtml = await renderDeliveries(deliveries || []);
  let criteriaHtml = renderCriteriaList(agreement.criteria);
  const reportHtml = renderVerificationHistory(verifications || []);
  const timelineHtml = renderTimeline(events || [], isHirer, isProvider, userId);

  // Edição do acordo (só antes de alguém aceitar) e materiais anexados
  // pelo contratante (só depois de aceito).
  let editing = false;
  let editDraft = null;
  let attachmentsList = await loadAttachments();

  render();

  async function loadAttachments() {
    const { data } = await window.ppSupabase
      .from('agreement_attachments')
      .select('id, uploader_id, file_path, file_name, note, created_at')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: false });

    return Promise.all((data || []).map(async (a) => {
      if (!a.file_path) return { ...a, url: null };
      const { data: signed } = await window.ppSupabase.storage
        .from('agreement-attachments')
        .createSignedUrl(a.file_path, 3600);
      return { ...a, url: signed ? signed.signedUrl : null };
    }));
  }

  function attachmentsHtml() {
    const canAttach = isHirer && ATTACH_STATUSES.includes(agreement.status);
    if (attachmentsList.length === 0 && !canAttach) return '';

    const items = attachmentsList.map((a) => `
      <div class="ad-attach-item">
        <div>
          ${a.file_name ? (a.url
            ? `<a href="${a.url}" target="_blank" rel="noopener">${escapeHtml(a.file_name)}</a>`
            : `${escapeHtml(a.file_name)} (link expirado, recarregue a página)`) : ''}
          ${a.note ? `<div class="ad-attach-note">${escapeHtml(a.note)}</div>` : ''}
          <div class="ad-meta" style="margin-top:2px">Adicionado em ${formatDateTime(a.created_at)}</div>
        </div>
        ${canAttach && a.uploader_id === userId ? `<button type="button" class="btn btn-ghost ad-attach-remove" data-id="${a.id}">Remover</button>` : ''}
      </div>
    `).join('');

    const form = canAttach ? `
      <div class="ad-attach-form">
        <textarea id="ad-attach-note" placeholder="Informação para o prestador (opcional se anexar arquivo)"></textarea>
        <input type="file" id="ad-attach-files" multiple>
        <div><button type="button" class="btn btn-primary" id="ad-attach-btn">Adicionar</button></div>
        <div id="ad-attach-status" class="ad-action-status"></div>
      </div>
    ` : '';

    return `
      <div style="margin-top:18px">
        <h2 style="font-size:13px;color:var(--ink-soft);margin:0 0 8px">Materiais e informações do contratante</h2>
        ${items || '<p class="ad-meta" style="margin-top:0">Nada adicionado ainda.</p>'}
        ${form}
      </div>
    `;
  }

  // --- Edição (antes de alguém aceitar) ---

  function startEdit() {
    editDraft = {
      title: agreement.title,
      description: agreement.description,
      amount: String(agreement.amount_usdc),
      criteria: (Array.isArray(agreement.criteria) ? agreement.criteria : []).map((c) => ({
        criterion: c.criterion || '',
        how_to_verify: c.how_to_verify || '',
      })),
    };
    editing = true;
    render();
  }

  function editFormHtml() {
    const d = editDraft;
    const rows = d.criteria.map((c, i) => `
      <div class="ad-edit-criteria-item">
        <input type="text" data-cfield="criterion" data-index="${i}" value="${escapeAttr(c.criterion)}" placeholder="Critério">
        <input type="text" data-cfield="how_to_verify" data-index="${i}" value="${escapeAttr(c.how_to_verify)}" placeholder="Como verificar (opcional)">
        <button type="button" class="ad-edit-remove" data-index="${i}" aria-label="Remover critério">×</button>
      </div>
    `).join('');

    return `
      <h1 style="margin:0 0 14px;font-size:20px">Editar acordo</h1>
      <div class="ad-edit-field">
        <label for="ad-edit-title">Título</label>
        <input type="text" id="ad-edit-title" maxlength="120" value="${escapeAttr(d.title)}">
      </div>
      <div class="ad-edit-field">
        <label for="ad-edit-description">Descrição</label>
        <textarea id="ad-edit-description">${escapeHtml(d.description)}</textarea>
      </div>
      <div class="ad-edit-field">
        <label for="ad-edit-amount">Valor (USDC)</label>
        <input type="number" id="ad-edit-amount" min="0.01" step="0.01" value="${escapeAttr(d.amount)}">
      </div>
      <div class="ad-edit-field">
        <label>Critérios de aceite</label>
        <div class="ad-edit-criteria-list">${rows}</div>
        <button type="button" class="ad-edit-add" id="ad-edit-add-criterion">+ Adicionar critério</button>
      </div>
      <div class="ad-decision-actions">
        <button type="button" class="btn btn-primary" id="ad-edit-save">Salvar alterações</button>
        <button type="button" class="btn btn-ghost" id="ad-edit-cancel">Cancelar</button>
      </div>
      <div id="ad-edit-status" class="ad-action-status"></div>
    `;
  }

  function bindEditForm() {
    const byId = (id) => document.getElementById(id);
    byId('ad-edit-title').addEventListener('input', (e) => { editDraft.title = e.target.value; });
    byId('ad-edit-description').addEventListener('input', (e) => { editDraft.description = e.target.value; });
    byId('ad-edit-amount').addEventListener('input', (e) => { editDraft.amount = e.target.value; });

    contentEl.querySelectorAll('[data-cfield]').forEach((input) => {
      input.addEventListener('input', (e) => {
        const item = editDraft.criteria[Number(e.target.dataset.index)];
        if (item) item[e.target.dataset.cfield] = e.target.value;
      });
    });
    contentEl.querySelectorAll('.ad-edit-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        editDraft.criteria.splice(Number(btn.dataset.index), 1);
        render();
      });
    });
    byId('ad-edit-add-criterion').addEventListener('click', () => {
      editDraft.criteria.push({ criterion: '', how_to_verify: '' });
      render();
    });
    byId('ad-edit-cancel').addEventListener('click', () => { editing = false; render(); });
    byId('ad-edit-save').addEventListener('click', onSaveEdit);
  }

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

  // --- Cancelamento (3 fases — ver 0010_agreement_cancellation.sql) ---
  function cancelHtml() {
    // Fase 1: ninguém aceitou ainda — contratante cancela livre.
    if (agreement.status === 'awaiting_provider' && isHirer) {
      return `
        <div style="margin-top:18px">
          <button type="button" class="btn btn-ghost" id="ad-cancel-free-btn">Cancelar acordo</button>
          <div id="ad-cancel-status" class="ad-action-status"></div>
        </div>
      `;
    }

    // Fase 2: já tem prestador, sem entrega ainda — pedir cancelamento
    // (precisa de consentimento do outro lado).
    if (['awaiting_funding', 'in_progress'].includes(agreement.status) && (isHirer || isProvider)) {
      return `
        <div style="margin-top:18px">
          <button type="button" class="btn btn-ghost" id="ad-cancel-request-toggle-btn">Solicitar cancelamento</button>
          <div id="ad-cancel-request-form" style="display:none;margin-top:10px">
            <textarea id="ad-cancel-reason" placeholder="Motivo do cancelamento (obrigatório)" style="width:100%;min-height:60px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--ink);font-family:Inter;font-size:13.5px"></textarea>
            <button type="button" class="btn btn-primary" id="ad-cancel-request-submit-btn" style="margin-top:8px">Enviar pedido de cancelamento</button>
          </div>
          <div id="ad-cancel-status" class="ad-action-status"></div>
        </div>
      `;
    }

    // Cancelamento pendente: um lado pediu, esperando o outro decidir.
    if (agreement.status === 'cancellation_requested') {
      const isRequester = agreement.cancel_requested_by === userId;
      const otherRole = isHirer ? 'o prestador' : 'o contratante'; // a outra parte, em relação a quem está vendo

      if (isRequester) {
        return `
          <div class="ad-banner warning" style="margin-top:18px">
            Você solicitou o cancelamento deste acordo. Aguardando resposta de ${otherRole}.
            ${agreement.cancel_reason ? `<div style="margin-top:6px">Motivo informado: ${escapeHtml(agreement.cancel_reason)}</div>` : ''}
            <div style="margin-top:8px">
              <button type="button" class="btn btn-ghost" id="ad-cancel-withdraw-btn">Desistir do pedido</button>
            </div>
            <div id="ad-cancel-status" class="ad-action-status"></div>
          </div>
        `;
      }

      if (isHirer || isProvider) {
        return `
          <div class="ad-banner warning" style="margin-top:18px">
            ${otherRole === 'o prestador' ? 'O prestador' : 'O contratante'} solicitou cancelar este acordo.
            ${agreement.cancel_reason ? `<div style="margin-top:6px">Motivo informado: ${escapeHtml(agreement.cancel_reason)}</div>` : ''}
            <div class="ad-decision-actions" style="margin-top:8px">
              <button type="button" class="btn btn-primary" id="ad-cancel-accept-btn">Aceitar cancelamento</button>
              <button type="button" class="btn btn-ghost" id="ad-cancel-reject-btn">Recusar</button>
            </div>
            <div id="ad-cancel-status" class="ad-action-status"></div>
          </div>
        `;
      }
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
    if (editing) {
      contentEl.innerHTML = editFormHtml();
      bindEditForm();
      return;
    }

    // Só o contratante, e só enquanto ninguém aceitou (o banco também
    // trava isso — ver 0012_edit_agreement_and_attachments.sql).
    const canEdit = isHirer && agreement.status === 'awaiting_provider' && !agreement.provider_id;

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
      ${canEdit ? `<button type="button" class="btn btn-ghost" id="ad-edit-btn" style="margin-top:14px">Editar acordo</button>` : ''}
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
      ${cancelHtml()}
      ${attachmentsHtml()}
      ${deliveriesHtml}
      ${timelineHtml}
    `;

    if (canAccept) {
      document.getElementById('ad-accept-btn').addEventListener('click', onAccept);
    }
    const editBtn = document.getElementById('ad-edit-btn');
    if (editBtn) editBtn.addEventListener('click', startEdit);
    const attachBtn = document.getElementById('ad-attach-btn');
    if (attachBtn) attachBtn.addEventListener('click', onAttach);
    contentEl.querySelectorAll('.ad-attach-remove').forEach((btn) => {
      btn.addEventListener('click', () => onRemoveAttachment(btn.dataset.id));
    });
    const retryBtn = document.getElementById('ad-retry-verify-btn');
    if (retryBtn) retryBtn.addEventListener('click', onRetryVerify);
    const approveBtn = document.getElementById('ad-approve-btn');
    if (approveBtn) approveBtn.addEventListener('click', () => onDecision('approved'));
    const reviseBtn = document.getElementById('ad-revise-btn');
    if (reviseBtn) reviseBtn.addEventListener('click', () => onDecision('revision_requested'));

    const cancelFreeBtn = document.getElementById('ad-cancel-free-btn');
    if (cancelFreeBtn) cancelFreeBtn.addEventListener('click', onCancelFree);

    const cancelRequestToggleBtn = document.getElementById('ad-cancel-request-toggle-btn');
    if (cancelRequestToggleBtn) {
      cancelRequestToggleBtn.addEventListener('click', () => {
        document.getElementById('ad-cancel-request-form').style.display = 'block';
        cancelRequestToggleBtn.style.display = 'none';
      });
    }
    const cancelRequestSubmitBtn = document.getElementById('ad-cancel-request-submit-btn');
    if (cancelRequestSubmitBtn) cancelRequestSubmitBtn.addEventListener('click', onRequestCancel);

    const cancelWithdrawBtn = document.getElementById('ad-cancel-withdraw-btn');
    if (cancelWithdrawBtn) cancelWithdrawBtn.addEventListener('click', onWithdrawCancel);

    const cancelAcceptBtn = document.getElementById('ad-cancel-accept-btn');
    if (cancelAcceptBtn) cancelAcceptBtn.addEventListener('click', onCancelDecision.bind(null, true));
    const cancelRejectBtn = document.getElementById('ad-cancel-reject-btn');
    if (cancelRejectBtn) cancelRejectBtn.addEventListener('click', onCancelDecision.bind(null, false));
  }

  async function onAccept() {
    const btn = document.getElementById('ad-accept-btn');
    const statusEl = document.getElementById('ad-action-status');
    btn.disabled = true;
    statusEl.textContent = 'Aceitando…';
    statusEl.className = 'ad-action-status';

    // .eq('updated_at', ...) garante que o prestador só aceita os termos
    // que ele realmente viu: se o contratante editou o acordo enquanto
    // a página estava aberta, o update não acha nenhuma linha.
    const { data: accepted, error: updateError } = await window.ppSupabase
      .from('agreements')
      .update({ provider_id: userId, status: 'awaiting_funding' })
      .eq('id', agreementId)
      .eq('updated_at', agreement.updated_at)
      .select('id');

    if (updateError) {
      statusEl.textContent = 'Erro ao aceitar: ' + updateError.message;
      statusEl.className = 'ad-action-status error';
      btn.disabled = false;
      return;
    }

    if (!accepted || accepted.length === 0) {
      statusEl.textContent = 'Este acordo foi alterado (ou já aceito por outra pessoa) enquanto você olhava. Recarregando para você ver os termos atuais…';
      statusEl.className = 'ad-action-status error';
      setTimeout(() => window.location.reload(), 2500);
      return;
    }

    statusEl.textContent = 'Acordo aceito! Aguardando financiamento.';
    statusEl.className = 'ad-action-status success';
    agreement.status = 'awaiting_funding';
    agreement.provider_id = userId;
    render();
    logEvent(agreementId, 'accepted', userId);
  }

  async function onSaveEdit() {
    const statusEl = document.getElementById('ad-edit-status');
    const saveBtn = document.getElementById('ad-edit-save');

    const title = editDraft.title.trim();
    const description = editDraft.description.trim();
    const amount = parseFloat(editDraft.amount);
    const criteria = editDraft.criteria
      .map((c) => ({ criterion: (c.criterion || '').trim(), how_to_verify: (c.how_to_verify || '').trim() }))
      .filter((c) => c.criterion);

    if (!title || !description || !amount || amount <= 0) {
      statusEl.textContent = 'Preencha título, descrição e um valor válido.';
      statusEl.className = 'ad-action-status error';
      return;
    }
    if (criteria.length === 0) {
      statusEl.textContent = 'Mantenha pelo menos um critério de aceite.';
      statusEl.className = 'ad-action-status error';
      return;
    }

    saveBtn.disabled = true;
    statusEl.textContent = 'Salvando…';
    statusEl.className = 'ad-action-status pending';

    const { data: updated, error: updateError } = await window.ppSupabase
      .from('agreements')
      .update({ title, description, amount_usdc: amount, criteria })
      .eq('id', agreementId)
      .eq('status', 'awaiting_provider')
      .is('provider_id', null)
      .select('id, updated_at');

    if (updateError) {
      statusEl.textContent = 'Erro ao salvar: ' + updateError.message;
      statusEl.className = 'ad-action-status error';
      saveBtn.disabled = false;
      return;
    }

    if (!updated || updated.length === 0) {
      statusEl.textContent = 'Este acordo não pode mais ser editado (já foi aceito ou cancelado). Recarregue a página.';
      statusEl.className = 'ad-action-status error';
      saveBtn.disabled = false;
      return;
    }

    agreement.title = title;
    agreement.description = description;
    agreement.amount_usdc = amount;
    agreement.criteria = criteria;
    agreement.updated_at = updated[0].updated_at;
    criteriaHtml = renderCriteriaList(criteria);
    editing = false;
    render();
    logEvent(agreementId, 'edited', userId);
  }

  async function onAttach() {
    const noteEl = document.getElementById('ad-attach-note');
    const filesEl = document.getElementById('ad-attach-files');
    const btn = document.getElementById('ad-attach-btn');
    const statusEl = document.getElementById('ad-attach-status');

    const note = noteEl.value.trim();
    const files = Array.from(filesEl.files || []);

    if (!note && files.length === 0) {
      statusEl.textContent = 'Escreva uma informação ou selecione pelo menos um arquivo.';
      statusEl.className = 'ad-action-status error';
      return;
    }

    btn.disabled = true;
    let added = 0;
    let first = true;

    // Sem arquivos: uma única linha só com a nota. Com arquivos: cada
    // arquivo vira uma linha; a nota fica junto do primeiro.
    for (const file of (files.length ? files : [null])) {
      let path = null;
      let name = null;

      if (file) {
        statusEl.textContent = `Enviando ${file.name}…`;
        statusEl.className = 'ad-action-status pending';
        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        path = `${agreementId}/${Date.now()}-${safeName}`;
        name = file.name;

        const { error: uploadError } = await window.ppSupabase.storage
          .from('agreement-attachments')
          .upload(path, file);

        if (uploadError) {
          statusEl.textContent = `Erro ao enviar ${file.name}: ${uploadError.message}`;
          statusEl.className = 'ad-action-status error';
          btn.disabled = false;
          break;
        }
      }

      const { error: insertError } = await window.ppSupabase.from('agreement_attachments').insert({
        agreement_id: agreementId,
        uploader_id: userId,
        file_path: path,
        file_name: name,
        note: first ? (note || null) : null,
      });

      if (insertError) {
        if (path) await window.ppSupabase.storage.from('agreement-attachments').remove([path]);
        statusEl.textContent = 'Erro ao registrar: ' + insertError.message;
        statusEl.className = 'ad-action-status error';
        btn.disabled = false;
        break;
      }

      added += 1;
      first = false;
    }

    if (added > 0) {
      attachmentsList = await loadAttachments();
      render();
      logEvent(agreementId, 'attachment_added', userId, { count: added });
    }
  }

  async function onRemoveAttachment(id) {
    const item = attachmentsList.find((a) => a.id === id);
    if (!item) return;
    if (!window.confirm('Remover este item? O prestador deixará de vê-lo.')) return;

    const { data: removed, error: deleteError } = await window.ppSupabase
      .from('agreement_attachments')
      .delete()
      .eq('id', id)
      .select('id');

    if (deleteError || !removed || removed.length === 0) {
      window.alert('Não foi possível remover' + (deleteError ? ': ' + deleteError.message : '.'));
      return;
    }

    if (item.file_path) {
      await window.ppSupabase.storage.from('agreement-attachments').remove([item.file_path]);
    }
    attachmentsList = await loadAttachments();
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
    logEvent(agreementId, newStatus, userId);
  }

  // --- Cancelamento ---

  async function onCancelFree() {
    const btn = document.getElementById('ad-cancel-free-btn');
    const statusEl = document.getElementById('ad-cancel-status');
    if (!window.confirm('Cancelar este acordo? Ele será removido das listagens ativas.')) return;

    btn.disabled = true;
    statusEl.textContent = 'Cancelando…';
    statusEl.className = 'ad-action-status';

    const { error: updateError } = await window.ppSupabase
      .from('agreements')
      .update({ status: 'cancelled' })
      .eq('id', agreementId);

    if (updateError) {
      statusEl.textContent = 'Erro ao cancelar: ' + updateError.message;
      statusEl.className = 'ad-action-status error';
      btn.disabled = false;
      return;
    }

    agreement.status = 'cancelled';
    render();
    logEvent(agreementId, 'cancelled', userId);
  }

  async function onRequestCancel() {
    const submitBtn = document.getElementById('ad-cancel-request-submit-btn');
    const statusEl = document.getElementById('ad-cancel-status');
    const reason = document.getElementById('ad-cancel-reason').value.trim();

    if (!reason) {
      statusEl.textContent = 'Escreva um motivo antes de enviar.';
      statusEl.className = 'ad-action-status error';
      return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = 'Enviando pedido…';
    statusEl.className = 'ad-action-status';

    const { error: updateError } = await window.ppSupabase
      .from('agreements')
      .update({
        status: 'cancellation_requested',
        cancel_requested_by: userId,
        cancel_requested_at: new Date().toISOString(),
        cancel_reason: reason,
        pre_cancel_status: agreement.status,
      })
      .eq('id', agreementId);

    if (updateError) {
      statusEl.textContent = 'Erro: ' + updateError.message;
      statusEl.className = 'ad-action-status error';
      submitBtn.disabled = false;
      return;
    }

    agreement.pre_cancel_status = agreement.status;
    agreement.status = 'cancellation_requested';
    agreement.cancel_requested_by = userId;
    agreement.cancel_reason = reason;
    render();
    logEvent(agreementId, 'cancellation_requested', userId, { reason });
  }

  async function onWithdrawCancel() {
    const btn = document.getElementById('ad-cancel-withdraw-btn');
    const statusEl = document.getElementById('ad-cancel-status');
    btn.disabled = true;
    statusEl.textContent = 'Desfazendo pedido…';
    statusEl.className = 'ad-action-status';

    const revertStatus = agreement.pre_cancel_status || 'awaiting_funding';

    const { error: updateError } = await window.ppSupabase
      .from('agreements')
      .update({
        status: revertStatus,
        cancel_requested_by: null,
        cancel_requested_at: null,
        cancel_reason: null,
        pre_cancel_status: null,
      })
      .eq('id', agreementId);

    if (updateError) {
      statusEl.textContent = 'Erro: ' + updateError.message;
      statusEl.className = 'ad-action-status error';
      btn.disabled = false;
      return;
    }

    agreement.status = revertStatus;
    agreement.cancel_requested_by = null;
    agreement.cancel_reason = null;
    agreement.pre_cancel_status = null;
    render();
    logEvent(agreementId, 'cancellation_withdrawn', userId);
  }

  async function onCancelDecision(accept) {
    const statusEl = document.getElementById('ad-cancel-status');
    const acceptBtn = document.getElementById('ad-cancel-accept-btn');
    const rejectBtn = document.getElementById('ad-cancel-reject-btn');
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    statusEl.textContent = 'Salvando…';
    statusEl.className = 'ad-action-status';

    const newStatus = accept ? 'cancelled' : (agreement.pre_cancel_status || 'awaiting_funding');
    const payload = accept
      ? { status: 'cancelled' }
      : { status: newStatus, cancel_requested_by: null, cancel_requested_at: null, cancel_reason: null, pre_cancel_status: null };

    const { error: updateError } = await window.ppSupabase
      .from('agreements')
      .update(payload)
      .eq('id', agreementId);

    if (updateError) {
      statusEl.textContent = 'Erro: ' + updateError.message;
      statusEl.className = 'ad-action-status error';
      acceptBtn.disabled = false;
      rejectBtn.disabled = false;
      return;
    }

    agreement.status = newStatus;
    if (!accept) {
      agreement.cancel_requested_by = null;
      agreement.cancel_reason = null;
      agreement.pre_cancel_status = null;
    }
    render();
    logEvent(agreementId, accept ? 'cancellation_accepted' : 'cancellation_rejected', userId);
  }
});
