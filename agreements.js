// ProofPay — Meus Acordos (agreements.html)
//
// require-auth.js já garante sessão válida antes deste script rodar.
//
// Regra de negócio desta etapa: o acordo nasce ABERTO (status
// "awaiting_provider", provider_id nulo) — não existe escolha de
// prestador na criação. Quem decide provider_id é a etapa futura de
// "aceitar acordo" (tela Explorar serviços), que ainda não existe.
//
// A RLS da tabela agreements só permite: inserir com hirer_id = próprio
// usuário, e enxergar linhas onde o usuário é hirer OU provider. Isso
// está garantido no banco (0005_create_agreements_table.sql) — este
// arquivo não pode contornar isso, só reflete o que a policy permite.

const STATUS_LABELS = {
  draft: 'Rascunho',
  awaiting_provider: 'Aguardando prestador',
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

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function formatAmount(amount) {
  return Number(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderList(container, agreements) {
  if (!agreements || agreements.length === 0) {
    container.innerHTML = '<p class="ag-list-empty">Nenhum acordo aqui ainda.</p>';
    return;
  }

  container.innerHTML = agreements.map((a) => `
    <div class="ag-item">
      <div>
        <div class="ag-item-title">${escapeHtml(a.title)}</div>
        <div class="ag-item-meta">${formatAmount(a.amount_usdc)} USDC · criado em ${formatDate(a.created_at)}</div>
      </div>
      <span class="ag-status-pill">${statusLabel(a.status)}</span>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof window.ppSupabase === 'undefined') {
    console.error('[ProofPay] agreements.js precisa do supabase-client.js carregado antes dele.');
    return;
  }

  const { data: sessionData } = await window.ppSupabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return; // require-auth.js já está redirecionando

  const userId = session.user.id;

  const form = document.getElementById('ag-create-form');
  const titleInput = document.getElementById('ag-title');
  const descriptionInput = document.getElementById('ag-description');
  const amountInput = document.getElementById('ag-amount');
  const createBtn = document.getElementById('ag-create-btn');
  const createStatusEl = document.getElementById('ag-create-status');

  const listHirerEl = document.getElementById('ag-list-hirer');
  const listProviderEl = document.getElementById('ag-list-provider');
  const tabHirer = document.getElementById('ag-tab-hirer');
  const tabProvider = document.getElementById('ag-tab-provider');

  async function loadAgreements() {
    const [hirerResult, providerResult] = await Promise.all([
      window.ppSupabase
        .from('agreements')
        .select('id, title, amount_usdc, status, created_at')
        .eq('hirer_id', userId)
        .order('created_at', { ascending: false }),
      window.ppSupabase
        .from('agreements')
        .select('id, title, amount_usdc, status, created_at')
        .eq('provider_id', userId)
        .order('created_at', { ascending: false }),
    ]);

    if (hirerResult.error) {
      listHirerEl.innerHTML = '<p class="ag-list-empty">Erro ao carregar: ' + hirerResult.error.message + '</p>';
    } else {
      renderList(listHirerEl, hirerResult.data);
    }

    if (providerResult.error) {
      listProviderEl.innerHTML = '<p class="ag-list-empty">Erro ao carregar: ' + providerResult.error.message + '</p>';
    } else {
      renderList(listProviderEl, providerResult.data);
    }
  }

  tabHirer.addEventListener('click', () => {
    tabHirer.classList.add('active');
    tabProvider.classList.remove('active');
    listHirerEl.style.display = '';
    listProviderEl.style.display = 'none';
  });

  tabProvider.addEventListener('click', () => {
    tabProvider.classList.add('active');
    tabHirer.classList.remove('active');
    listProviderEl.style.display = '';
    listHirerEl.style.display = 'none';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    createStatusEl.textContent = '';
    createStatusEl.className = 'ag-form-status';

    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    const amount = parseFloat(amountInput.value);

    if (!title || !description || !amount || amount <= 0) {
      createStatusEl.textContent = 'Preencha todos os campos com um valor válido.';
      createStatusEl.className = 'ag-form-status error';
      return;
    }

    createBtn.disabled = true;
    createStatusEl.textContent = 'Publicando…';
    createStatusEl.className = 'ag-form-status pending';

    const { error } = await window.ppSupabase.from('agreements').insert({
      hirer_id: userId,
      title,
      description,
      amount_usdc: amount,
      status: 'awaiting_provider',
    });

    createBtn.disabled = false;

    if (error) {
      createStatusEl.textContent = 'Erro ao publicar: ' + error.message;
      createStatusEl.className = 'ag-form-status error';
      return;
    }

    createStatusEl.textContent = 'Acordo publicado!';
    createStatusEl.className = 'ag-form-status success';
    form.reset();
    await loadAgreements();
  });

  await loadAgreements();
});
