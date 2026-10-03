// ProofPay — status da Solana no Dashboard.
//
// Apenas mostra se nosso programa está
// disponível na Devnet.

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    const pill =
      document.getElementById(
        "app-solana-pill"
      );

    const networkEl =
      document.getElementById(
        "app-solana-network"
      );

    const programEl =
      document.getElementById(
        "app-solana-program"
      );

    const noteEl =
      document.getElementById(
        "app-solana-note"
      );

    // Se a página não tiver esses elementos,
    // simplesmente não fazemos nada.
    if (
      !pill ||
      !networkEl ||
      !programEl ||
      !noteEl
    ) {
      return;
    }

    // Confirma que os outros arquivos
    // foram carregados corretamente.
    if (
      !window.ppSolanaConfig ||
      !window.ppSolanaReadonly
    ) {
      pill.textContent =
        "indisponível";

      noteEl.textContent =
        "A integração Solana não pôde ser inicializada.";

      return;
    }

    networkEl.textContent =
      "Devnet";

    programEl.textContent =
      window.ppSolanaConfig.programId;

    programEl.href =
      window.ppSolanaReadonly
        .explorerProgramUrl();

    try {
      const status =
        await window
          .ppSolanaReadonly
          .getProgramStatus();

      if (
        status.exists &&
        status.executable
      ) {
        pill.textContent =
          "online";

        pill.className =
          "wallet-pill verified";

        noteEl.textContent =
          "Programa ProofPay encontrado e executável na Devnet. Nenhuma transação foi enviada.";

        return;
      }

      if (status.exists) {
        pill.textContent =
          "não executável";

        pill.className =
          "wallet-pill pending";

        noteEl.textContent =
          "A conta foi encontrada, mas não está marcada como programa executável.";

        return;
      }

      pill.textContent =
        "não encontrado";

      pill.className =
        "wallet-pill pending";

      noteEl.textContent =
        "O Program ID não foi encontrado na Devnet.";
    } catch (error) {
      console.error(
        "[ProofPay] Erro Solana:",
        error
      );

      pill.textContent =
        "RPC indisponível";

      pill.className =
        "wallet-pill pending";

      noteEl.textContent =
        "Não foi possível consultar a Devnet agora. Tente recarregar a página.";
    }
  }
);
