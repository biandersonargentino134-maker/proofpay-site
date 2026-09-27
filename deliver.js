// ProofPay — Enviar Entrega (deliver.html?id=agreementId)
//
// Quem garante que só o provider certo consegue fazer isso é a RLS
// (deliveries_insert_own, delivery_evidence_insert, agreements_submit_
// delivery) — este arquivo só monta as chamadas, não decide permissão.
//
// ETAPA 6: depois que a entrega é registrada e o status vira
// 'delivery_submitted', chamamos a Edge Function verify-delivery na
// hora — ela busca evidência real (URL, GitHub) e gera o relatório da
// IA automaticamente. Se essa chamada falhar por qualquer motivo, a
// entrega já foi salva (não se perde nada) e existe um botão de
// retentativa manual em agreement-detail.js — por isso não travamos a
// navegação numa falha aqui, só avisamos.
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof window.ppSupabase === 'undefined') {
    console.error('[ProofPay] deliver.js precisa do supabase-client.js carregado antes dele.');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const agreementId = params.get('id');
  const titleEl = document.getElementById('dl-agreement-title');

  if (!agreementId) {
    titleEl.textContent = 'Nenhum acordo informado na URL.';
    return;
  }

  const { data: sessionData } = await window.ppSupabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return; // require-auth.js já está redirecionando
  const userId = session.user.id;

  const { data: agreement, error: agreementError } = await window.ppSupabase
    .from('agreements')
    .select('id, title, status, provider_id')
    .eq('id', agreementId)
    .single();

  if (agreementError || !agreement) {
    titleEl.textContent = 'Não foi possível carregar este acordo.';
    return;
  }

  titleEl.textContent = 'Acordo: ' + agreement.title;

  if (agreement.provider_id !== userId) {
    titleEl.textContent += ' — você não é o prestador deste acordo.';
    document.getElementById('dl-form').style.display = 'none';
    return;
  }

  const form = document.getElementById('dl-form');
  const descriptionInput = document.getElementById('dl-description');
  const linksInput = document.getElementById('dl-links');
  const filesInput = document.getElementById('dl-files');
  const submitBtn = document.getElementById('dl-submit-btn');
  const statusEl = document.getElementById('dl-status');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.className = 'dl-status';

    const description = descriptionInput.value.trim();
    if (!description) {
      statusEl.textContent = 'Descreva a entrega.';
      statusEl.className = 'dl-status error';
      return;
    }

    const links = linksInput.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const files = Array.from(filesInput.files || []);

    submitBtn.disabled = true;

    // 1) sobe cada arquivo pro bucket, num caminho {agreementId}/{arquivo}
    const filePaths = [];
    for (const file of files) {
      statusEl.textContent = `Enviando ${file.name}…`;
      statusEl.className = 'dl-status';

      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const path = `${agreementId}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await window.ppSupabase.storage
        .from('delivery-evidence')
        .upload(path, file);

      if (uploadError) {
        statusEl.textContent = `Erro ao enviar ${file.name}: ${uploadError.message}`;
        statusEl.className = 'dl-status error';
        submitBtn.disabled = false;
        return;
      }

      filePaths.push(path);
    }

    // 2) registra a entrega
    statusEl.textContent = 'Registrando entrega…';
    const { error: insertError } = await window.ppSupabase.from('deliveries').insert({
      agreement_id: agreementId,
      provider_id: userId,
      description,
      links,
      file_paths: filePaths,
    });

    if (insertError) {
      statusEl.textContent = 'Erro ao registrar entrega: ' + insertError.message;
      statusEl.className = 'dl-status error';
      submitBtn.disabled = false;
      return;
    }

    // 3) muda o status do acordo
    const { error: statusError } = await window.ppSupabase
      .from('agreements')
      .update({ status: 'delivery_submitted' })
      .eq('id', agreementId);

    if (statusError) {
      // a entrega já foi registrada — não trava o usuário aqui, só avisa.
      statusEl.textContent = 'Entrega registrada, mas não consegui atualizar o status: ' + statusError.message;
      statusEl.className = 'dl-status error';
      submitBtn.disabled = false;
      return;
    }

    // 4) dispara a verificação da IA (Etapa 6). Evidência real
    // (URL/GitHub) + comparação com os critérios pode levar alguns
    // segundos — por isso o aviso na tela enquanto espera.
    statusEl.textContent = 'Entrega enviada! Rodando verificação da IA (pode levar até 20s)…';
    statusEl.className = 'dl-status';

    const { error: verifyError } = await window.ppSupabase.functions.invoke('verify-delivery', {
      body: { agreement_id: agreementId },
    });

    if (verifyError) {
      // Não bloqueia o fluxo: a entrega já está salva. A tela de
      // detalhe do acordo mostra um botão pra tentar de novo quando o
      // status ainda estiver 'delivery_submitted'.
      console.error('[ProofPay] Falha ao disparar verify-delivery:', verifyError);
    }

    statusEl.textContent = 'Entrega enviada!';
    statusEl.className = 'dl-status success';
    window.location.href = 'agreement-detail.html?id=' + encodeURIComponent(agreementId);
  });
});
