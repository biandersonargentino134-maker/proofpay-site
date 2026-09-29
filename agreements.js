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
//
// ETAPA 5 — Critérios gerados por IA:
//   - O botão "Gerar critérios com IA" chama a Edge Function
//     generate-criteria (Groq), que só SUGERE uma lista — nunca grava
//     nada sozinha.
//   - A lista fica em `criteriaState`, editável na tela (texto do
//     critério + como verificar), com remoção e adição manual.
//   - Só quando o contratante clica em "Publicar acordo" é que a lista
//     final (já revisada) é enviada no INSERT, na coluna `criteria`
//     (jsonb) da tabela `agreements`.
//   - Se a IA falhar, a seção de critérios continua funcional pra
//     edição manual — a falha da IA nunca trava a criação do acordo.

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

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function formatAmount(amount) {
  return Number(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function renderList(container, agreements) {
  if (!agreements || agreements.length === 0) {
    container.innerHTML = '<p class="ag-list-empty">Nenhum acordo aqui ainda.</p>';
    return;
  }

  container.innerHTML = agreements.map((a) => `
    <a class="ag-item" href="agreement-detail.html?id=${encodeURIComponent(a.id)}" style="text-decoration:none;color:inherit">
      <div>
        <div class="ag-item-title">${escapeHtml(a.title)}</div>
        <div class="ag-item-meta">${formatAmount(a.amount_usdc)} USDC · criado em ${formatDate(a.created_at)}</div>
      </div>
      <span class="ag-status-pill">${statusLabel(a.status)}</span>
    </a>
  `).join('');
}

// Repassa erros de supabase.functions.invoke — quando a Edge Function
// responde com status != 2xx, o corpo (com a mensagem de erro real) vem
// em error.context, não em `data`.
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

  // --- Critérios (Etapa 5) ---
  let criteriaState = [];
  const criteriaListEl = document.getElementById('ag-criteria-list');
  const criteriaEmptyEl = document.getElementById('ag-criteria-empty');
  const generateBtn = document.getElementById('ag-generate-criteria-btn');
  const generateStatusEl = document.getElementById('ag-generate-status');
  const addCriterionBtn = document.getElementById('ag-add-criterion-btn');

  function renderCriteria() {
    criteriaEmptyEl.style.display = criteriaState.length === 0 ? '' : 'none';
    criteriaListEl.innerHTML = criteriaState.map((c, i) => `
      <div class="ag-criteria-item" data-index="${i}">
        <input type="text" data-field="criterion" value="${escapeAttr(c.criterion)}" placeholder="Critério (ex: Página responsiva)">
        <input type="text" data-field="how_to_verify" value="${escapeAttr(c.how_to_verify)}" placeholder="Como verificar (opcional)">
        <button type="button" class="ag-criteria-remove-btn" data-index="${i}" aria-label="Remover critério">×</button>
      </div>
    `).join('');
  }

  criteriaListEl.addEventListener('input', (e) => {
    const item = e.target.closest('.ag-criteria-item');
    if (!item) return;
    const index = Number(item.dataset.index);
    const field = e.target.dataset.field;
    if (!criteriaState[index] || !field) return;
    criteriaState[index][field] = e.target.value;
  });

  criteriaListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.ag-criteria-remove-btn');
    if (!btn) return;
    criteriaState.splice(Number(btn.dataset.index), 1);
    renderCriteria();
  });

  addCriterionBtn.addEventListener('click', () => {
    criteriaState.push({ criterion: '', how_to_verify: '' });
    renderCriteria();
    const inputs = criteriaListEl.querySelectorAll('input[data-field="criterion"]');
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  });

  generateBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();

    if (!description || description.length < 10) {
      generateStatusEl.textContent = 'Descreva o serviço com mais detalhes antes de gerar critérios.';
      generateStatusEl.className = 'ag-form-status error';
      return;
    }

    generateBtn.disabled = true;
    generateStatusEl.textContent = 'Gerando critérios com IA…';
    generateStatusEl.className = 'ag-form-status pending';

    const { data, error } = await window.ppSupabase.functions.invoke('generate-criteria', {
      body: {
        title,
        description,
        amount_usdc: parseFloat(amountInput.value) || null,
      },
    });

    generateBtn.disabled = false;

    if (error) {
      const msg = await extractInvokeError(error);
      generateStatusEl.textContent = msg + ' Você pode adicionar critérios manualmente abaixo.';
      generateStatusEl.className = 'ag-form-status error';
      return;
    }

    if (!data || !Array.isArray(data.criteria) || data.criteria.length === 0) {
      generateStatusEl.textContent = 'A IA não retornou critérios utilizáveis. Adicione manualmente abaixo.';
      generateStatusEl.className = 'ag-form-status error';
      return;
    }

    criteriaState = data.criteria.map((c) => ({
      criterion: c.criterion || '',
      how_to_verify: c.how_to_verify || '',
    }));
    renderCriteria();
    generateStatusEl.textContent = `${criteriaState.length} critérios sugeridos — revise, edite ou remova antes de publicar.`;
    generateStatusEl.className = 'ag-form-status success';
  });

  // --- Listagem de acordos ---
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

    const cleanCriteria = criteriaState
      .map((c) => ({ criterion: (c.criterion || '').trim(), how_to_verify: (c.how_to_verify || '').trim() }))
      .filter((c) => c.criterion);

    if (cleanCriteria.length === 0) {
      createStatusEl.textContent = 'Adicione pelo menos um critério (gerado pela IA ou manual) antes de publicar.';
      createStatusEl.className = 'ag-form-status error';
      return;
    }

    createBtn.disabled = true;
    createStatusEl.textContent = 'Publicando…';
    createStatusEl.className = 'ag-form-status pending';

    const { data: inserted, error } = await window.ppSupabase.from('agreements').insert({
      hirer_id: userId,
      title,
      description,
      amount_usdc: amount,
      status: 'awaiting_provider',
      criteria: cleanCriteria,
    }).select('id').single();

    createBtn.disabled = false;

    if (error) {
      createStatusEl.textContent = 'Erro ao publicar: ' + error.message;
      createStatusEl.className = 'ag-form-status error';
      return;
    }

    if (inserted && inserted.id) {
      const { error: eventError } = await window.ppSupabase.from('agreement_events').insert({
        agreement_id: inserted.id,
        event_type: 'created',
        actor_id: userId,
      });
      if (eventError) console.error('[ProofPay] Falha ao logar evento na timeline:', eventError.message);
    }

    createStatusEl.textContent = 'Acordo publicado!';
    createStatusEl.className = 'ag-form-status success';
    form.reset();
    criteriaState = [];
    renderCriteria();
    generateStatusEl.textContent = '';
    generateStatusEl.className = 'ag-form-status';
    await loadAgreements();
  });

  renderCriteria();
  await loadAgreements();
});
