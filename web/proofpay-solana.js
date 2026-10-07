// ==========================================================
// PROOFPAY — ADAPTADOR SOLANA
// ==========================================================
//
// Nesta primeira versão este arquivo SOMENTE:
//
// - lê o Program ID;
// - carrega o IDL;
// - converte agreementId para u64 little-endian;
// - deriva o Agreement PDA;
// - deriva o Escrow PDA.
//
// NÃO:
// - conecta carteira;
// - pede assinatura;
// - envia transação;
// - movimenta tokens.
//
// ==========================================================

(function () {

  // --------------------------------------------------------
  // Confirma que @solana/web3.js foi carregado
  // --------------------------------------------------------

  function getWeb3() {

    if (
      !window.solanaWeb3 ||
      !window.solanaWeb3.PublicKey
    ) {
      throw new Error(
        "Solana Web3 não foi carregado."
      );
    }

    return window.solanaWeb3;
  }


  // --------------------------------------------------------
  // Configuração do ProofPay
  // --------------------------------------------------------

  function getConfig() {

    if (!window.ppSolanaConfig) {
      throw new Error(
        "solana-config.js não foi carregado."
      );
    }

    return window.ppSolanaConfig;
  }


  // --------------------------------------------------------
  // Program ID
  // --------------------------------------------------------

  function getProgramId() {

    const {
      PublicKey
    } = getWeb3();

    const config =
      getConfig();

    return new PublicKey(
      config.programId
    );
  }


  // --------------------------------------------------------
  // Converter u64 para 8 bytes little-endian
  // --------------------------------------------------------
  //
  // Nosso Rust usa agreement_id: u64.
  //
  // Para gerar exatamente o mesmo PDA no navegador,
  // precisamos transformar o número em 8 bytes LE.
  //
  // Exemplo:
  //
  // agreementId = 1
  //
  // vira:
  //
  // 01 00 00 00 00 00 00 00
  //
  // --------------------------------------------------------

  function u64ToLittleEndian(
    value
  ) {

    const number =
      BigInt(value);


    if (number < 0n) {
      throw new Error(
        "agreementId não pode ser negativo."
      );
    }


    const maxU64 =
      18446744073709551615n;


    if (number > maxU64) {
      throw new Error(
        "agreementId é maior que u64."
      );
    }


    const bytes =
      new Uint8Array(8);


    let temp =
      number;


    for (
      let i = 0;
      i < 8;
      i++
    ) {

      bytes[i] =
        Number(
          temp & 255n
        );

      temp >>=
        8n;
    }


    return bytes;
  }


  // --------------------------------------------------------
  // Derivar Agreement PDA
  // --------------------------------------------------------
  //
  // Seeds do contrato:
  //
  // "agreement"
  // client pubkey
  // worker pubkey
  // agreement_id (u64 LE)
  //
  // --------------------------------------------------------

  function deriveAgreementPda({
    client,
    worker,
    agreementId
  }) {

    const {
      PublicKey
    } = getWeb3();


    const programId =
      getProgramId();


    const clientPublicKey =
      new PublicKey(
        client
      );


    const workerPublicKey =
      new PublicKey(
        worker
      );


    const agreementIdBytes =
      u64ToLittleEndian(
        agreementId
      );


    const agreementSeed =
      new TextEncoder()
        .encode(
          "agreement"
        );


    const [
      agreementPda,
      bump
    ] =
      PublicKey
        .findProgramAddressSync(
          [
            agreementSeed,

            clientPublicKey
              .toBytes(),

            workerPublicKey
              .toBytes(),

            agreementIdBytes
          ],

          programId
        );


    return {
      pda:
        agreementPda,

      address:
        agreementPda
          .toString(),

      bump:
        bump
    };
  }


  // --------------------------------------------------------
  // Derivar Escrow PDA
  // --------------------------------------------------------
  //
  // Seeds:
  //
  // "escrow"
  // Agreement PDA
  //
  // --------------------------------------------------------

  function deriveEscrowPda(
    agreementPda
  ) {

    const {
      PublicKey
    } = getWeb3();


    const programId =
      getProgramId();


    const agreementPublicKey =
      agreementPda instanceof PublicKey

        ? agreementPda

        : new PublicKey(
            agreementPda
          );


    const escrowSeed =
      new TextEncoder()
        .encode(
          "escrow"
        );


    const [
      escrowPda,
      bump
    ] =
      PublicKey
        .findProgramAddressSync(
          [
            escrowSeed,

            agreementPublicKey
              .toBytes()
          ],

          programId
        );


    return {
      pda:
        escrowPda,

      address:
        escrowPda
          .toString(),

      bump:
        bump
    };
  }


  // --------------------------------------------------------
  // Derivar Agreement + Escrow juntos
  // --------------------------------------------------------

  function deriveAgreementAddresses({
    client,
    worker,
    agreementId
  }) {

    const agreement =
      deriveAgreementPda({
        client,
        worker,
        agreementId
      });


    const escrow =
      deriveEscrowPda(
        agreement.pda
      );


    return {

      agreement: {
        address:
          agreement.address,

        bump:
          agreement.bump
      },

      escrow: {
        address:
          escrow.address,

        bump:
          escrow.bump
      }

    };
  }


  // --------------------------------------------------------
  // Carregar IDL
  // --------------------------------------------------------

  async function loadIdl() {

    const response =
      await fetch(
        "proofpay-idl.json",
        {
          cache:
            "no-store"
        }
      );


    if (!response.ok) {

      throw new Error(
        "Não foi possível carregar proofpay-idl.json. HTTP " +
        response.status
      );

    }


    const idl =
      await response.json();


    if (
      !idl ||
      idl.name !==
        "proofpay_escrow"
    ) {

      throw new Error(
        "IDL do ProofPay inválido."
      );

    }


    return idl;
  }


  // --------------------------------------------------------
  // Expor funções para as outras páginas
  // --------------------------------------------------------

  window.ppProofPaySolana =
    Object.freeze({

      getProgramId,

      loadIdl,

      u64ToLittleEndian,

      deriveAgreementPda,

      deriveEscrowPda,

      deriveAgreementAddresses

    });

})();
