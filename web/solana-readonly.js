// ProofPay — leitura da Solana.
//
// Este arquivo SOMENTE consulta a blockchain.
// Ele não conecta carteira.
// Ele não assina nada.
// Ele não movimenta tokens.

(function () {
  function getConfig() {
    const config = window.ppSolanaConfig;

    if (!config) {
      throw new Error(
        "Configuração Solana não carregada."
      );
    }

    return config;
  }

  // Faz uma chamada JSON-RPC para a Solana.
  async function rpc(method, params) {
    const config = getConfig();

    const response = await fetch(
      config.rpcUrl,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: method,
          params: params,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        "RPC Solana respondeu HTTP " +
          response.status
      );
    }

    const payload = await response.json();

    if (payload.error) {
      throw new Error(
        payload.error.message ||
          "Erro retornado pela Solana."
      );
    }

    return payload.result;
  }

  // Consulta nosso Program ID.
  async function getProgramStatus() {
    const config = getConfig();

    const result = await rpc(
      "getAccountInfo",
      [
        config.programId,
        {
          encoding: "base64",
          commitment:
            config.commitment,
        },
      ]
    );

    const account =
      result && result.value;

    return {
      network:
        config.network,

      programId:
        config.programId,

      exists:
        account !== null,

      executable:
        !!(
          account &&
          account.executable
        ),

      owner:
        account
          ? account.owner
          : null,

      lamports:
        account
          ? account.lamports
          : null,
    };
  }

  // Link para visualizar o programa
  // no Solana Explorer.
  function explorerProgramUrl() {
    const config = getConfig();

    return (
      "https://explorer.solana.com/address/" +
      encodeURIComponent(
        config.programId
      ) +
      "?cluster=" +
      encodeURIComponent(
        config.network
      )
    );
  }

  window.ppSolanaReadonly =
    Object.freeze({
      getProgramStatus,
      explorerProgramUrl,
    });
})();
