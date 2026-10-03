// ProofPay — configuração pública da Solana.
//
// Não existe nenhuma chave privada aqui.
// Program ID e endereço RPC são informações públicas.

(function () {
  window.ppSolanaConfig = Object.freeze({
    network: "devnet",

    commitment: "confirmed",

    rpcUrl: "https://api.devnet.solana.com",

    programId:
      "EXwZRxFkNBubX9toSZearSoFLqanRADTN4HGCySrUzWz",
  });
})();
