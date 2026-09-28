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
    .select('id, title, status, hirer_id, provider_id, cancel_requested_by')
    .or(`hirer_id.eq.${userId},provider_id.eq.${userId}`);

  if (agreementsError) {
    pendingListEl.innerHTML = '<p class="app-empty">Erro ao carregar acordos: ' + agreementsError.message + '</p>';
    summaryHirerEl.textContent = '—';
    summaryProviderEl.textContent = '—';
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
  }

  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    await window.ppSupabase.auth.signOut();
    window.location.href = 'index.html';
  });
});
