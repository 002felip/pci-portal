/**
 * VBM Kaizen — aba "Red. Desperdícios" (admin.html).
 * Só a configuração; a lógica (listar/criar/editar/ativar) está em
 * js/cadastro-bilingue.js (window.criarCadastroBilingue).
 */
(function () {
  if (!window.criarCadastroBilingue) return;

  criarCadastroBilingue({
    rota: "desperdicios", listaId: "desperdiciosList",
    modalAddId: "modalAddDesperdicio", modalEditId: "modalEditDesperdicio",
    prefixoAdd: "despAdd", prefixoEdit: "despEdit",
    btnSalvarAddId: "btnSaveAddDesperdicio", btnSalvarEditId: "btnSaveEditDesperdicio",
    classeIcone: "orange", iconePadrao: "assets/icons/desperdicios/fa-solid-recycle.svg",
    palavraBadge: "usos", palavraBadgeSingular: "uso",
    // Limites do DER (kzn_desperdicio): NM_DESPERDICIO VARCHAR(30) /
    // DS_DESPERDICIO VARCHAR(100) — mesmo tamanho das outras 3 tabelas
    // bilíngues (server.js espelha isso em CADASTRO_LIMITES_DER).
    maxNome: 30, maxDescricao: 100,
    rotuloSingular: "Tipo de desperdício",
    textoCarregando: "Carregando tipos de desperdício…", textoVazio: "Nenhum tipo de desperdício cadastrado.",
    textoErro: "Não foi possível carregar os tipos de desperdício no momento. Tente novamente em instantes.",
  });
})();
