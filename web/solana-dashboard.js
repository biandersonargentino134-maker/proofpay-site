// ProofPay — status da Solana no Dashboard.
// A parte 1 consulta se o programa está online.
// A parte 2 mostra um acordo de DEMONSTRAÇÃO da Devnet,
// sem associá-lo aos acordos do usuário no Supabase.
// Somente leitura: não conecta Phantom, não assina e não transfere tokens.

document.addEventListener('DOMContentLoaded', async () => {
  const pill = document.getElementById('app-solana-pill');
  const networkEl = document.getElementById('app-solana-network');
  const programEl = document.getElementById('app-solana-program');
  const noteEl = document.getElementById('app-solana-note');

  if (!pill || !networkEl || !programEl || !noteEl) return;

  if (!window.ppSolanaConfig || !window.ppSolanaReadonly) {
    pill.textContent = 'indisponível';
    noteEl.textContent = 'A integração Solana não pôde ser inicializada.';
    return;
  }

  networkEl.textContent = window.ppSolanaConfig.network;
  programEl.textContent = window.ppSolanaConfig.programId;
  programEl.href = window.ppSolanaReadonly.explorerProgramUrl();

  try {
    const status = await window.ppSolanaReadonly.getProgramStatus();

    if (status.exists && status.executable) {
      pill.textContent = 'online';
      pill.className = 'wallet-pill verified';
      noteEl.textContent = 'Programa ProofPay encontrado e executável na Devnet. Nenhuma transação foi enviada.';
    } else if (status.exists) {
      pill.textContent = 'não executável';
      pill.className = 'wallet-pill pending';
      noteEl.textContent = 'A conta foi encontrada, mas não está marcada como programa executável.';
    } else {
      pill.textContent = 'não encontrado';
      pill.className = 'wallet-pill pending';
      noteEl.textContent = 'O Program ID não foi encontrado na Devnet.';
    }
  } catch (error) {
    console.error('[ProofPay] Erro consultando programa Solana:', error);
    pill.textContent = 'RPC indisponível';
    pill.className = 'wallet-pill pending';
    noteEl.textContent = 'Não foi possível consultar a Devnet agora. Tente recarregar a página.';
  }
});

// ==========================================================
// Comprovante público do acordo de demonstração #1 na Devnet
// NÃO é um acordo carregado do Supabase.
// ==========================================================

document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  const config = window.ppSolanaConfig;
  const originalCard = document.getElementById('app-solana-pill')?.closest('.app-card');
  if (!originalCard || !config || config.network !== 'devnet') return;

  const PROGRAM = 'EXwZRxFkNBubX9toSZearSoFLqanRADTN4HGCySrUzWz';
  const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const AGREEMENT = 'yyufzjHKCVC71czNXe8gu3EqbDXLsmD9nrhu5N6GT64';
  const ESCROW = '5Q7C7jkba7goVH4yqpjroJAYUYsMVXapVE7QthkhuhbW';
  const VAULT = 'DM9V2xLZJJh5NecntyKiWGsK8oEkQELD1ey6FSguQM9s';
  const WORKER_ATA = '5Po2kcfAQHQeh7P3BKE2kr2PmwJbNo4dsieT3EX7CaND';
  const CLIENT = 'GrASds6JDpgSU8StgKeE4cd3BrJTkpMF9BaWaThkTFsA';
  const WORKER = '6EgKu4mNChnGEesc2d5jYfLZCrCYRoHxdftRLJLWxZVY';
  const MINT = 'DifqmKQDHFTdLVEKFz7CkmteKjDMHHDiSzuK7X7aprJ8';
  const TX_URL = 'https://explorer.solana.com/tx/4VbnQAGHnhRr1fE5ZV64sjNEGH4vL7vMuFfqdEYZx6KzE4YhphbufsMKUmWNYkJNjhjibhLc7Wd9nYKtoBwtsSUf?cluster=devnet';
  const STATES = ['Created', 'Funded', 'Accepted', 'Delivered', 'Completed', 'Cancelled'];

  // O card é identificado como DEMONSTRAÇÃO, e não como um acordo do usuário.
  const card = document.createElement('section');
  card.className = 'app-card';
  card.innerHTML = `
    <div class="app-card-head">
      <h2>Escrow na prática — demonstração #1</h2>
      <span id="pp-demo-status-pill" class="wallet-pill pending">consultando…</span>
    </div>
    <p class="solana-note">Exemplo público concluído na Solana Devnet. Este acordo de teste não está vinculado à sua lista de acordos do Supabase. O token usado não é USDC.</p>
    <p>Estado na blockchain: <strong id="pp-demo-agreement-state">—</strong></p>
    <p>Saldo do cofre: <strong id="pp-demo-vault-balance">—</strong></p>
    <p>Saldo do prestador: <strong id="pp-demo-worker-balance">—</strong></p>
    <p><a id="pp-demo-tx-link" class="solana-program-link" target="_blank" rel="noopener noreferrer">Ver transação no Solana Explorer →</a></p>
    <p id="pp-demo-status-note" class="solana-note">Consultando o estado real do acordo na Devnet…</p>
  `;
  originalCard.insertAdjacentElement('afterend', card);
  card.querySelector('#pp-demo-tx-link').href = TX_URL;

  const field = id => card.querySelector('#' + id);
  const pill = field('pp-demo-status-pill');
  const note = field('pp-demo-status-note');

  function fail(message) {
    pill.textContent = 'não confirmado';
    pill.className = 'wallet-pill pending';
    note.textContent = message;
  }

  // A Solana usa Base58 para endereços e Base64 para bytes retornados pelo RPC.
  function addressBytes(address) {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let number = 0n;
    for (const ch of address) {
      const n = alphabet.indexOf(ch);
      if (n < 0) throw new Error('Endereço Base58 inválido.');
      number = number * 58n + BigInt(n);
    }
    const result = [];
    while (number > 0n) {
      result.unshift(Number(number & 255n));
      number >>= 8n;
    }
    for (const ch of address) {
      if (ch !== '1') break;
      result.unshift(0);
    }
    if (result.length !== 32) throw new Error('Endereço público inválido.');
    return Uint8Array.from(result);
  }

  function equalAddress(bytes, offset, address) {
    const expected = addressBytes(address);
    if (bytes.length < offset + 32) return false;
    return expected.every((n, i) => bytes[offset + i] === n);
  }

  function readU64(bytes, offset) {
    if (bytes.length < offset + 8) throw new Error('Conta com dados incompletos.');
    let value = 0n;
    for (let i = 7; i >= 0; i--) {
      value = (value << 8n) | BigInt(bytes[offset + i]);
    }
    return value;
  }

  function decodeAccount(account, expectedOwner, minLength) {
    if (!account || account.owner !== expectedOwner || !Array.isArray(account.data) || !account.data[0]) {
      throw new Error('Uma das contas não corresponde ao programa esperado.');
    }
    const raw = atob(account.data[0]);
    const bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0));
    if (bytes.length < minLength) throw new Error('Dados on-chain incompletos.');
    return bytes;
  }

  function tokens(raw) {
    const integer = raw / 1000000n;
    const fraction = (raw % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
    return integer.toString() + (fraction ? ',' + fraction : '') + ' token(s) SPL de teste';
  }

  try {
    if (config.programId !== PROGRAM) throw new Error('Program ID diferente do acordo de demonstração.');

    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
        params: [[AGREEMENT, ESCROW, VAULT, WORKER_ATA], {
          encoding: 'base64', commitment: 'confirmed'
        }]
      })
    });
    if (!response.ok) throw new Error('RPC HTTP ' + response.status);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || 'Erro no RPC.');
    const values = payload.result?.value;
    if (!Array.isArray(values) || values.length !== 4) throw new Error('Resposta RPC incompleta.');

    const a = decodeAccount(values[0], PROGRAM, 130);
    const e = decodeAccount(values[1], PROGRAM, 105);
    const v = decodeAccount(values[2], TOKEN_PROGRAM, 165);
    const w = decodeAccount(values[3], TOKEN_PROGRAM, 165);

    // Confirma os vínculos do acordo, escrow, mint e contas de tokens.
    if (readU64(a, 8) !== 1n ||
        !equalAddress(a, 16, CLIENT) || !equalAddress(a, 48, WORKER) ||
        readU64(a, 80) !== 1000000n ||
        !equalAddress(e, 8, AGREEMENT) || !equalAddress(e, 40, MINT) ||
        !equalAddress(e, 72, VAULT) ||
        !equalAddress(v, 0, MINT) || !equalAddress(v, 32, ESCROW) ||
        !equalAddress(w, 0, MINT) || !equalAddress(w, 32, WORKER)) {
      throw new Error('Os dados da blockchain não correspondem ao teste ProofPay.');
    }

    const state = a[128];
    const vaultAmount = readU64(v, 64);
    const workerAmount = readU64(w, 64);
    field('pp-demo-agreement-state').textContent = STATES[state] || 'Desconhecido';
    field('pp-demo-vault-balance').textContent = tokens(vaultAmount);
    field('pp-demo-worker-balance').textContent = tokens(workerAmount);

    if (state === 4 && vaultAmount === 0n && workerAmount >= 1000000n) {
      pill.textContent = 'concluído';
      pill.className = 'wallet-pill verified';
      note.textContent = 'A blockchain confirma: acordo Completed, cofre vazio e prestador com o token de teste. Somente leitura.';
    } else {
      fail('O acordo de demonstração não apresenta todos os estados esperados. Não interprete este cartão como pagamento confirmado.');
    }
  } catch (error) {
    console.error('[ProofPay] Comprovante da Devnet:', error);
    fail('Não foi possível validar o comprovante agora (' + (error.message || String(error)) + '). A transação pode ser conferida no Explorer.');
  }
});
