// ProofPay — Edge Function: verify-delivery
//
// Chamada automaticamente pelo deliver.js assim que o prestador envia
// uma entrega (e, como reforço, por um botão manual "Executar
// verificação da IA" em agreement-detail.js, caso a chamada automática
// tenha falhado).
//
// O QUE ESTA FUNÇÃO FAZ:
//   1. Confirma que quem chamou tem relação com o acordo (hirer ou
//      provider) e que o acordo está em 'delivery_submitted'.
//   2. Move o status para 'ai_verifying'.
//   3. Busca a entrega mais recente e tenta coletar evidência REAL:
//      - links comuns: faz fetch da página e extrai texto simples;
//      - links do GitHub: usa a API pública do GitHub (metadados,
//        lista de arquivos da raiz, README);
//      - arquivos enviados (Storage): só lista os nomes — o conteúdo
//      (imagem, zip etc.) NÃO é lido/inspecionado nesta etapa. Isso é
//      dito explicitamente pra IA, pra ela nunca fingir que analisou
//      um arquivo que não conseguiu abrir.
//   4. Manda critérios + evidência coletada pra IA (Groq,
//      openai/gpt-oss-120b) e pede um relatório item a item.
//   5. Grava o relatório em `ai_verifications` (nunca sobrescreve —
//      cada rodada é uma linha nova) e move o status pra
//      'awaiting_approval'.
//
// FRONTEIRA DE RESPONSABILIDADE (importante, igual nas outras etapas):
//   - A IA só analisa e relata. Ela NUNCA aprova, NUNCA libera
//     pagamento, NUNCA move o acordo pra 'approved'. Essa decisão é do
//     contratante, na tela de detalhe do acordo.
//   - Se qualquer coisa falhar depois do passo 2, a função reverte o
//     status de volta pra 'delivery_submitted' — nunca deixa o acordo
//     travado em 'ai_verifying' sem um relatório de verdade.
//
// LIMITAÇÃO CONHECIDA: chamadas à API do GitHub aqui não são
// autenticadas (sem token), então o limite de requisições é o público
// (bem baixo). Se isso virar um problema real de uso, a solução é
// adicionar uma secret GITHUB_TOKEN — não fiz isso agora pra não expandir
// o escopo desta etapa sem necessidade.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;

const GROQ_MODEL = "openai/gpt-oss-120b";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const FETCH_TIMEOUT_MS = 8000;
const MAX_EVIDENCE_CHARS_PER_SOURCE = 2500;
const MAX_LINKS_TO_FETCH = 5;

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

// Evidência de um link do GitHub: metadados do repo + lista de arquivos
// da raiz + README (se existir). Tudo via API pública, sem autenticação.
async function collectGithubEvidence(owner: string, repo: string): Promise<string> {
  const headers = { "User-Agent": "ProofPay-Verification", "Accept": "application/vnd.github+json" };
  const parts: string[] = [];

  try {
    const repoRes = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (repoRes.ok) {
      const repoData = await repoRes.json();
      parts.push(`Repositório encontrado. Descrição no GitHub: "${repoData.description || "(sem descrição)"}". Linguagem principal: ${repoData.language || "não detectada"}.`);
    } else {
      parts.push(`Repositório GitHub não encontrado ou inacessível (status ${repoRes.status}).`);
      return parts.join(" ");
    }
  } catch {
    parts.push("Não foi possível acessar a API do GitHub para este repositório (timeout ou erro de rede).");
    return parts.join(" ");
  }

  try {
    const contentsRes = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/contents`, { headers });
    if (contentsRes.ok) {
      const contents = await contentsRes.json();
      if (Array.isArray(contents)) {
        const names = contents.map((f: any) => f.name).slice(0, 40).join(", ");
        parts.push(`Arquivos na raiz do repositório: ${names || "(nenhum)"}.`);
      }
    }
  } catch { /* segue sem essa evidência */ }

  try {
    const readmeRes = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: { ...headers, "Accept": "application/vnd.github.raw" },
    });
    if (readmeRes.ok) {
      const readmeText = await readmeRes.text();
      parts.push(`Trecho do README: """${readmeText.slice(0, MAX_EVIDENCE_CHARS_PER_SOURCE)}"""`);
    } else {
      parts.push("Nenhum README encontrado na raiz do repositório.");
    }
  } catch { /* segue sem essa evidência */ }

  return parts.join(" ");
}

async function collectUrlEvidence(url: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "ProofPay-Verification" } });
    if (!res.ok) {
      return `URL retornou status ${res.status} ao ser acessada — pode estar fora do ar ou bloqueada.`;
    }
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text")) {
      return `URL acessível (status ${res.status}), mas o conteúdo não é HTML/texto (${contentType}) — conteúdo não inspecionado.`;
    }
    const html = await res.text();
    const text = stripHtml(html).slice(0, MAX_EVIDENCE_CHARS_PER_SOURCE);
    return `URL acessível (status ${res.status}). Texto extraído da página: """${text}"""`;
  } catch (e) {
    return "Não foi possível acessar esta URL (timeout, offline, ou bloqueio de acesso automatizado).";
  }
}

async function collectEvidence(delivery: { description: string; links: string[]; file_paths: string[] }): Promise<string> {
  const blocks: string[] = [];
  blocks.push(`Descrição da entrega escrita pelo prestador: """${delivery.description}"""`);

  const links = (delivery.links || []).slice(0, MAX_LINKS_TO_FETCH);
  for (const link of links) {
    const github = parseGithubUrl(link);
    if (github) {
      const evidence = await collectGithubEvidence(github.owner, github.repo);
      blocks.push(`--- Evidência do link (GitHub) ${link} ---\n${evidence}`);
    } else {
      const evidence = await collectUrlEvidence(link);
      blocks.push(`--- Evidência do link ${link} ---\n${evidence}`);
    }
  }

  const files = delivery.file_paths || [];
  if (files.length > 0) {
    const names = files.map((p) => p.split("/").pop()).join(", ");
    blocks.push(`--- Arquivos enviados (Storage) ---\nNomes de arquivo informados: ${names}. IMPORTANTE: o conteúdo desses arquivos NÃO foi lido/inspecionado automaticamente nesta etapa — considere isso "não verificado por conteúdo", apenas "presença de arquivo" como fato.`);
  }

  return blocks.join("\n\n");
}

function buildSystemPrompt(): string {
  return `Você verifica se a entrega de um serviço cumpre os critérios de aceite combinados, para uma plataforma de acordos com pagamento em escrow (ProofPay).

REGRAS OBRIGATÓRIAS:
- Você recebe uma lista de critérios numerados (índice começando em 0) e evidências coletadas automaticamente (conteúdo real de URLs e repositórios, quando acessíveis).
- Para CADA critério, avalie usando SOMENTE a evidência fornecida — nunca invente ou presuma algo que não está no texto de evidência.
- Se a evidência de um link não pôde ser coletada (erro, timeout, bloqueio), ou se o único "suporte" for a presença de um nome de arquivo sem conteúdo lido, isso NÃO conta como verificação — marque como "not_verified" ou, no máximo, "partial" se houver alguma outra evidência parcial, e explique isso claramente no campo evidence.
- Nunca marque "verified" sem citar, no campo evidence, o trecho ou fato concreto da evidência que sustenta isso.
- Responda APENAS com um JSON válido, sem markdown, sem texto antes ou depois, exatamente neste formato:
{"items":[{"criterion_index":0,"result":"verified","evidence":"texto explicando o que foi encontrado, citando a evidência"}]}
"result" só pode ser um destes três valores: "verified", "partial", "not_verified".
Inclua um item para CADA índice de critério recebido, na mesma quantidade.`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}

type ReportItem = { criterion: string; how_to_verify: string; result: "verified" | "partial" | "not_verified"; evidence: string };

function buildReport(criteria: { criterion: string; how_to_verify?: string }[], aiParsed: unknown): ReportItem[] {
  const itemsByIndex = new Map<number, any>();
  if (aiParsed && typeof aiParsed === "object" && Array.isArray((aiParsed as any).items)) {
    for (const item of (aiParsed as any).items) {
      if (item && typeof item.criterion_index === "number") {
        itemsByIndex.set(item.criterion_index, item);
      }
    }
  }

  const validResults = new Set(["verified", "partial", "not_verified"]);

  return criteria.map((c, index) => {
    const aiItem = itemsByIndex.get(index);
    const result = aiItem && validResults.has(aiItem.result) ? aiItem.result : "not_verified";
    const evidence = aiItem && typeof aiItem.evidence === "string" && aiItem.evidence.trim()
      ? String(aiItem.evidence).trim().slice(0, 800)
      : "A IA não avaliou este critério nesta rodada (resposta incompleta ou inválida).";
    return {
      criterion: c.criterion,
      how_to_verify: c.how_to_verify || "",
      result,
      evidence,
    };
  });
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let agreementIdForRollback: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Sessão ausente." }), { status: 401, headers });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Sessão inválida ou expirada." }), { status: 401, headers });
    }
    const callerId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const agreementId = String(body.agreement_id || "");
    if (!agreementId) {
      return new Response(JSON.stringify({ error: "agreement_id ausente." }), { status: 400, headers });
    }

    // Valida o formato antes de consultar — se o valor que chegou não
    // for um UUID de verdade, isso vira um erro CLARO aqui, em vez de
    // um erro genérico de "não encontrado" (que era o que acontecia
    // antes desta correção, e escondia a causa real).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(agreementId)) {
      console.error("[verify-delivery] agreement_id não é um UUID válido. Valor recebido:", JSON.stringify(agreementId));
      return new Response(JSON.stringify({ error: `ID de acordo em formato inválido: "${agreementId}"` }), { status: 400, headers });
    }

    const { data: agreement, error: agreementError } = await adminClient
      .from("agreements")
      .select("id, title, description, criteria, status, hirer_id, provider_id")
      .eq("id", agreementId)
      .single();

    if (agreementError || !agreement) {
      // Loga o erro real do Postgres/PostgREST — antes esse detalhe
      // era descartado e só aparecia "Acordo não encontrado." sem
      // explicar o motivo real.
      console.error("[verify-delivery] Falha ao buscar acordo. id:", agreementId, "erro:", JSON.stringify(agreementError));
      const detail = agreementError?.message ? ` (detalhe técnico: ${agreementError.message})` : "";
      return new Response(JSON.stringify({ error: `Acordo não encontrado.${detail}` }), { status: 404, headers });
    }

    if (agreement.hirer_id !== callerId && agreement.provider_id !== callerId) {
      return new Response(JSON.stringify({ error: "Você não tem acesso a este acordo." }), { status: 403, headers });
    }

    if (agreement.status !== "delivery_submitted") {
      return new Response(JSON.stringify({ error: "Este acordo não está aguardando verificação no momento." }), { status: 409, headers });
    }

    const criteria = Array.isArray(agreement.criteria) ? agreement.criteria : [];
    if (criteria.length === 0) {
      return new Response(JSON.stringify({ error: "Este acordo não tem critérios definidos — não há o que verificar." }), { status: 422, headers });
    }

    const { data: delivery, error: deliveryError } = await adminClient
      .from("deliveries")
      .select("id, description, links, file_paths, created_at")
      .eq("agreement_id", agreementId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (deliveryError || !delivery) {
      return new Response(JSON.stringify({ error: "Nenhuma entrega encontrada para este acordo." }), { status: 404, headers });
    }

    // A partir daqui, qualquer falha precisa reverter o status.
    agreementIdForRollback = agreementId;
    await adminClient.from("agreements").update({ status: "ai_verifying" }).eq("id", agreementId);

    if (!GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY não configurada.");
    }

    const evidenceText = await collectEvidence({
      description: delivery.description,
      links: Array.isArray(delivery.links) ? delivery.links : [],
      file_paths: Array.isArray(delivery.file_paths) ? delivery.file_paths : [],
    });

    const criteriaText = criteria
      .map((c: any, i: number) => `${i}. ${c.criterion}${c.how_to_verify ? ` (como verificar: ${c.how_to_verify})` : ""}`)
      .join("\n");

    const userPrompt = `Acordo: "${agreement.title}"
Descrição original do acordo: """${agreement.description}"""

CRITÉRIOS A AVALIAR (avalie todos, pelo índice):
${criteriaText}

EVIDÊNCIA COLETADA DA ENTREGA:
${evidenceText}`;

    const groqResponse = await fetchWithTimeout(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: 2500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: userPrompt },
        ],
      }),
    }, 25000);

    if (!groqResponse.ok) {
      const errText = await groqResponse.text().catch(() => "");
      throw new Error(`Groq respondeu ${groqResponse.status}: ${errText.slice(0, 300)}`);
    }

    const groqData = await groqResponse.json();
    const rawContent = groqData?.choices?.[0]?.message?.content;
    if (!rawContent || typeof rawContent !== "string") {
      throw new Error("Resposta da Groq sem conteúdo utilizável.");
    }

    const parsed = extractJson(rawContent);
    const report = buildReport(criteria, parsed);

    const counts = report.reduce(
      (acc, item) => {
        acc[item.result] += 1;
        return acc;
      },
      { verified: 0, partial: 0, not_verified: 0 } as Record<string, number>
    );

    const { error: insertError } = await adminClient.from("ai_verifications").insert({
      agreement_id: agreementId,
      delivery_id: delivery.id,
      report,
      verified_count: counts.verified,
      partial_count: counts.partial,
      not_verified_count: counts.not_verified,
    });

    if (insertError) {
      throw new Error("Erro ao salvar relatório: " + insertError.message);
    }

    await adminClient.from("agreements").update({ status: "awaiting_approval" }).eq("id", agreementId);

    return new Response(JSON.stringify({ success: true, counts }), { status: 200, headers });
  } catch (e) {
    console.error("[verify-delivery] Erro:", e);
    if (agreementIdForRollback) {
      // Nunca deixa o acordo travado em 'ai_verifying' sem relatório —
      // volta pro estado anterior, visível e reexecutável.
      await adminClient.from("agreements").update({ status: "delivery_submitted" }).eq("id", agreementIdForRollback);
    }
    return new Response(
      JSON.stringify({ error: "Não foi possível concluir a verificação agora. Tente novamente em instantes." }),
      { status: 500, headers: corsHeaders(req) }
    );
  }
});
