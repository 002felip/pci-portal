/**
 * VBM Kaizen — aba "Pot. Replicação" (admin.html).
 * Só a configuração; a lógica (listar/criar/editar/ativar) está em
 * js/cadastro-bilingue.js (window.criarCadastroBilingue).
 */
(function () {
  if (!window.criarCadastroBilingue) return;

  criarCadastroBilingue({
    rota: "replicacoes", listaId: "replicacoesList",
    modalAddId: "modalAddReplicacao", modalEditId: "modalEditReplicacao",
    prefixoAdd: "replAdd", prefixoEdit: "replEdit",
    btnSalvarAddId: "btnSaveAddReplicacao", btnSalvarEditId: "btnSaveEditReplicacao",
    classeIcone: "blue", iconePadrao: "assets/icons/replicacao/fa-solid-globe.svg",
    palavraBadge: null, palavraBadgeSingular: null,
    // Limites do DER (kzn_replicacao): NM_REPLICACAO VARCHAR(30) /
    // DS_REPLICACAO VARCHAR(100) — mesmo tamanho das outras 3 tabelas
    // bilíngues (server.js espelha isso em CADASTRO_LIMITES_DER).
    maxNome: 30, maxDescricao: 100,
    rotuloSingular: "Potencial de replicação",
    textoCarregando: "Carregando potenciais de replicação…", textoVazio: "Nenhum potencial de replicação cadastrado.",
    textoErro: "Não foi possível carregar os potenciais de replicação no momento. Tente novamente em instantes.",
  });
})();
