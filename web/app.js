// ProofPay — Dashboard (app.html)
//
// require-auth.js já garante, antes deste script rodar, que existe uma
// sessão válida (senão redireciona pra auth.html).
//
// wallet_verified vem direto do banco (fato persistido) — nunca é
// inventado aqui, igual ao resto do site.
//
// ETAPA 7 — Dashboard real (seção 11 do prompt mestre): em vez de só
// mostrar a conta, agora calculamos "o que o usuário precisa fazer
// agora" e um resumo dos acordos ativos, a partir da MESMA tabela
// `agreements` e das MESMAS regras de RLS que já existiam — nenhuma
// tabela nova, nenhuma policy nova. Isso é só leitura e organização do
// que já estava disponível.
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

const INACTIVE_STATUSES = ['completed', 'cancelled'];

// Mesmos textos da timeline de agreement-detail.js.
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

const RECENT_LIMIT = 5;
const ACTIVITY_LIMIT = 8;

// Cor da etiqueta de status: verde = concluído, amarelo = pede atenção
// de alguém, vermelho = parado/cancelado, cinza = andamento normal.
function statusClass(status) {
  if (status === 'completed' || status === 'approved') return 'done';
  if (status === 'cancelled') return 'stopped';
  if (['awaiting_approval', 'revision_requested', 'cancellation_requested'].includes(status)) return 'attention';
  return '';
}

function formatAmount(amount) {
  return Number(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// "há 2 horas", "ontem", etc.; acima de 7 dias mostra a data.
function formatRelative(iso) {
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (abs < 60) return 'agora';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(diffSec / 86400), 'day');
  return formatDate(iso);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Decide se ESTE usuário tem uma ação pendente neste acordo, e qual.
// Retorna null se o acordo está OK do lado dele (aguardando a outra
// parte, ou já encerrado) — só aparece na lista quem tem algo real a
// fazer.
function pendingActionFor(agreement, userId) {
  const isHirer = agreement.hirer_id === userId;
  const isProvider = agreement.provider_id === userId;

  if (isHirer && agreement.status === 'awaiting_approval') {
    return {
      role: 'Contratante',
      label: 'Revisar relatório da IA e decidir',
      href: `agreement-detail.html?id=${encodeURIComponent(agreement.id)}`,
    };
  }

  if (isProvider && (agreement.status === 'awaiting_funding' || agreement.status === 'in_progress')) {
    return {
      role: 'Prestador',
      label: 'Enviar entrega',
      href: `deliver.html?id=${encodeURIComponent(agreement.id)}`,
    };
  }

  if (isProvider && agreement.status === 'revision_requested') {
    return {
      role: 'Prestador',
      label: 'Revisão solicitada — enviar nova entrega',
      href: `deliver.html?id=${encodeURIComponent(agreement.id)}`,
    };
  }

  if (agreement.status === 'cancellation_requested' && agreement.cancel_requested_by !== userId && (isHirer || isProvider)) {
    return {
      role: isHirer ? 'Contratante' : 'Prestador',
      label: 'Pedido de cancelamento aguardando sua resposta',
      href: `agreement-detail.html?id=${encodeURIComponent(agreement.id)}`,
    };
  }

  return null;
}

function renderPendingList(container, items) {
  if (items.length === 0) {
    container.innerHTML = '<p class="app-empty">Nenhuma ação pendente no momento. 🎉</p>';
    return;
  }

  container.innerHTML = items.map((item) => `
    <a class="app-action-item" href="${item.href}">
      <div>
        <span class="app-action-role">${item.role}</span>
        <div class="app-action-title" style="margin-top:6px">${escapeHtml(item.agreementTitle)}</div>
        <div class="app-action-desc">${escapeHtml(item.label)}</div>
      </div>
      <span class="app-action-arrow">→</span>
    </a>
  `).join('');
}

function renderRecentList(container, agreements, userId) {
  if (agreements.length === 0) {
    container.innerHTML = '<p class="app-empty">Você ainda não participa de nenhum acordo. <a href="agreements.html" style="color:var(--ink)">Crie o primeiro</a> ou <a href="explore.html" style="color:var(--ink)">explore serviços</a>.</p>';
    return;
  }

  container.innerHTML = agreements.map((a) => {
    const role = a.hirer_id === userId ? 'Contratante' : 'Prestador';
    const cls = statusClass(a.status);
    return `
      <a class="app-recent-item" href="agreement-detail.html?id=${encodeURIComponent(a.id)}">
        <div>
          <div class="app-recent-title">${escapeHtml(a.title)}</div>
          <div class="app-recent-meta">
            <span class="app-action-role">${role}</span>
            <span>${formatAmount(a.amount_usdc)} USDC · atualizado ${escapeHtml(formatRelative(a.updated_at))}</span>
          </div>
        </div>
        <span class="app-status-pill${cls ? ' ' + cls : ''}">${escapeHtml(STATUS_LABELS[a.status] || a.status)}</span>
      </a>
    `;
  }).join('');
}

// Quem fez o evento. profiles só deixa ler a própria linha (RLS), então
// a outra parte aparece como "a outra parte", sem nome.
function whoLabel(event, userId) {
  if (!event.actor_id) return 'Sistema';
  return event.actor_id === userId ? 'Você' : 'A outra parte';
}

function renderActivityList(container, events, titleById, userId) {
  if (events.length === 0) {
    container.innerHTML = '<p class="app-empty">Nenhuma atividade ainda.</p>';
    return;
  }

  container.innerHTML = events.map((e) => `
    <a class="app-activity-item" href="agreement-detail.html?id=${encodeURIComponent(e.agreement_id)}">
      <div class="app-activity-time">${escapeHtml(formatRelative(e.created_at))}</div>
      <div class="app-activity-text">
        ${escapeHtml(EVENT_LABELS[e.event_type] || e.event_type)}
        <span class="app-activity-sub">· ${escapeHtml(titleById.get(e.agreement_id) || 'Acordo')} · ${escapeHtml(whoLabel(e, userId))}</span>
      </div>
    </a>
  `).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof window.ppSupabase === 'undefined') {
    console.error('[ProofPay] app.js precisa do supabase-client.js carregado antes dele.');
    return;
  }

  const { data } = await window.ppSupabase.auth.getSession();
  const session = data.session;
  if (!session) return; // require-auth.js já está redirecionando
  const userId = session.user.id;

  const emailEl = document.getElementById('app-email');
  const greetingEl = document.getElementById('app-greeting');
  const walletPillEl = document.getElementById('app-wallet-pill');
  const logoutBtn = document.getElementById('app-logout');
  const pendingListEl = document.getElementById('app-pending-list');
  const summaryHirerEl = document.getElementById('app-summary-hirer');
  const summaryProviderEl = document.getElementById('app-summary-provider');
  const summaryCompletedEl = document.getElementById('app-summary-completed');
  const summaryValueEl = document.getElementById('app-summary-value');
  const recentListEl = document.getElementById('app-recent-list');
  const activityListEl = document.getElementById('app-activity-list');

  emailEl.textContent = session.user.email || 'Conta conectada';
  greetingEl.textContent = 'Olá, ' + (session.user.email ? session.user.email.split('@')[0] : 'bem-vindo');

  const { data: profile, error: profileError } = await window.ppSupabase
    .from('profiles')
    .select('wallet_address, wallet_verified')
    .eq('id', session.user.id)
    .single();

  if (profileError || !profile) {
    walletPillEl.textContent = 'não foi possível verificar';
    walletPillEl.className = 'wallet-pill pending';
  } else if (profile.wallet_verified) {
    walletPillEl.textContent = 'verificada';
    walletPillEl.className = 'wallet-pill verified';
  } else {
    walletPillEl.textContent = 'não verificada';
    walletPillEl.className = 'wallet-pill pending';
  }

  // Uma única consulta traz tudo onde o usuário é hirer OU provider —
  // a policy agreements_select_own (0005) já cobre os dois casos.
  const { data: agreements, error: agreementsError } = await window.ppSupabase
    .from('agreements')
    .select('id, title, status, hirer_id, provider_id, cancel_requested_by, amount_usdc, created_at, updated_at')
    .or(`hirer_id.eq.${userId},provider_id.eq.${userId}`);

  if (agreementsError) {
    pendingListEl.innerHTML = '<p class="app-empty">Erro ao carregar acordos: ' + agreementsError.message + '</p>';
    summaryHirerEl.textContent = '—';
    summaryProviderEl.textContent = '—';
    summaryCompletedEl.textContent = '—';
    summaryValueEl.textContent = '—';
    recentListEl.innerHTML = '<p class="app-empty">Erro ao carregar acordos.</p>';
    activityListEl.innerHTML = '<p class="app-empty">Erro ao carregar atividade.</p>';
  } else {
    const list = agreements || [];

    const pendingItems = list
      .map((a) => {
        const action = pendingActionFor(a, userId);
        return action ? { ...action, agreementTitle: a.title } : null;
      })
      .filter(Boolean);

    renderPendingList(pendingListEl, pendingItems);

    const activeAsHirer = list.filter((a) => a.hirer_id === userId && !INACTIVE_STATUSES.includes(a.status)).length;
    const activeAsProvider = list.filter((a) => a.provider_id === userId && !INACTIVE_STATUSES.includes(a.status)).length;
    summaryHirerEl.textContent = String(activeAsHirer);
    summaryProviderEl.textContent = String(activeAsProvider);

    const completed = list.filter((a) => a.status === 'completed').length;
    const activeValue = list
      .filter((a) => !INACTIVE_STATUSES.includes(a.status))
      .reduce((sum, a) => sum + Number(a.amount_usdc || 0), 0);
    summaryCompletedEl.textContent = String(completed);
    summaryValueEl.textContent = formatAmount(activeValue);

    // Acordos recentes: os mexidos por último (updated_at), qualquer papel.
    const recent = [...list]
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, RECENT_LIMIT);
    renderRecentList(recentListEl, recent, userId);

    // Atividade recente: eventos da timeline de todos os acordos do
    // usuário (a RLS de agreement_events já limita a hirer/provider).
    if (list.length === 0) {
      renderActivityList(activityListEl, [], new Map(), userId);
    } else {
      const titleById = new Map(list.map((a) => [a.id, a.title]));
      const { data: events, error: eventsError } = await window.ppSupabase
        .from('agreement_events')
        .select('agreement_id, event_type, actor_id, created_at')
        .in('agreement_id', list.map((a) => a.id))
        .order('created_at', { ascending: false })
        .limit(ACTIVITY_LIMIT);

      if (eventsError) {
        activityListEl.innerHTML = '<p class="app-empty">Não foi possível carregar a atividade.</p>';
      } else {
        renderActivityList(activityListEl, events || [], titleById, userId);
      }
    }
  }

  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    await window.ppSupabase.auth.signOut();
    window.location.href = 'index.html';
  });
});
