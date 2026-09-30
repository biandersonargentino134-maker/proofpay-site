// ProofPay — Edge Function: verify-wallet-signature
//
// Verifica matematicamente a assinatura da Phantom contra o nonce emitido
// por request-wallet-challenge. Só esta função (via service_role) pode
// marcar wallet_verified = true — o navegador nunca decide isso sozinho.
import { createClient } from "npm:@supabase/supabase-js@2";
import nacl from "npm:tweetnacl@1.0.3";
import bs58 from "npm:bs58@5.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Precisa ser EXATAMENTE igual à mensagem gerada em request-wallet-challenge.
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

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Sessão inválida ou expirada." }), { status: 401, headers });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const walletAddress = String(body.wallet_address || "");
    const signatureB64 = String(body.signature_base64 || "");
    const nonce = String(body.nonce || "");

    if (!walletAddress || !signatureB64 || !nonce) {
      return new Response(JSON.stringify({ error: "Dados incompletos." }), { status: 400, headers });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: challenge, error: challengeError } = await adminClient
      .from("wallet_challenges")
      .select("id, expires_at, used_at")
      .eq("nonce", nonce)
      .eq("user_id", userId)
      .maybeSingle();

    if (challengeError || !challenge) {
      return new Response(JSON.stringify({ error: "Código de verificação não encontrado." }), { status: 400, headers });
    }
    if (challenge.used_at) {
      return new Response(JSON.stringify({ error: "Este código já foi utilizado." }), { status: 400, headers });
    }
    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: "Código expirado. Clique em Conectar Phantom de novo." }), { status: 400, headers });
    }

    let signatureBytes: Uint8Array;
    let publicKeyBytes: Uint8Array;
    try {
      signatureBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
      publicKeyBytes = bs58.decode(walletAddress);
    } catch {
      return new Response(JSON.stringify({ error: "Formato de assinatura ou endereço inválido." }), { status: 400, headers });
    }

    const message = buildChallengeMessage(nonce);
    const messageBytes = new TextEncoder().encode(message);
    const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);

    if (!isValid) {
      return new Response(JSON.stringify({ error: "Assinatura inválida." }), { status: 400, headers });
    }

    // Invalida o nonce imediatamente — antes de qualquer outra escrita.
    await adminClient
      .from("wallet_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("id", challenge.id);

    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ wallet_address: walletAddress, wallet_verified: true })
      .eq("id", userId);

    if (updateError) {
      if (updateError.code === "23505") {
        return new Response(JSON.stringify({ error: "Essa carteira já está vinculada a outra conta ProofPay." }), { status: 409, headers });
      }
      return new Response(JSON.stringify({ error: "Erro ao salvar a verificação: " + updateError.message }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ success: true, wallet_address: walletAddress }), { status: 200, headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Erro inesperado: " + (e instanceof Error ? e.message : String(e)) }),
      { status: 500, headers }
    );
  }
});
