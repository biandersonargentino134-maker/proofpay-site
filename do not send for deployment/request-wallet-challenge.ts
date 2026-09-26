// ProofPay — Edge Function: request-wallet-challenge
//
// Gera um código de uso único (nonce) para o usuário JÁ AUTENTICADO assinar
// com a Phantom. Nunca aceita chamadas sem uma sessão válida do Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function buildChallengeMessage(nonce: string): string {
  return `ProofPay quer verificar sua carteira.\n\nAssine esta mensagem para confirmar que você é o dono dela.\nIsso não é uma transação, não custa nada e não autoriza nenhum pagamento.\n\nCódigo: ${nonce}`;
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Sessão ausente." }), { status: 401, headers });
    }

    // Client de IDENTIDADE: valida o JWT de quem está chamando.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Sessão inválida ou expirada." }), { status: 401, headers });
    }
    const userId = userData.user.id;

    const nonce = crypto.randomUUID();

    // Client de PRIVILÉGIO: só agora, pra gravar o desafio (a tabela é
    // invisível para anon/authenticated de propósito).
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: insertError } = await adminClient
      .from("wallet_challenges")
      .insert({ user_id: userId, nonce });

    if (insertError) {
      return new Response(JSON.stringify({ error: "Erro ao gerar código: " + insertError.message }), { status: 500, headers });
    }

    return new Response(
      JSON.stringify({ nonce, message: buildChallengeMessage(nonce) }),
      { status: 200, headers }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Erro inesperado: " + (e instanceof Error ? e.message : String(e)) }),
      { status: 500, headers }
    );
  }
});
