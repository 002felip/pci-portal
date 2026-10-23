/**
 * VBM Kaizen — aba "Resultados" (admin.html).
 * Só a configuração; a lógica (listar/criar/editar/ativar) está em
 * js/cadastro-bilingue.js (window.criarCadastroBilingue).
 */
(function () {
  if (!window.criarCadastroBilingue) return;

  criarCadastroBilingue({
    rota: "resultados", listaId: "resultadosList",
    modalAddId: "modalAddResultado", modalEditId: "modalEditResultado",
    prefixoAdd: "resAdd", prefixoEdit: "resEdit",
    btnSalvarAddId: "btnSaveAddResultado", btnSalvarEditId: "btnSaveEditResultado",
    classeIcone: "yellow", iconePadrao: "assets/icons/resultados/fa-solid-trophy.svg",
    palavraBadge: null, palavraBadgeSingular: null,
    // Limites do DER (kzn_resultados): NM_RESULTADO VARCHAR(30) /
    // DS_RESULTADO VARCHAR(100) — mesmo tamanho das outras 3 tabelas
    // bilíngues (server.js espelha isso em CADASTRO_LIMITES_DER).
    maxNome: 30, maxDescricao: 100,
    rotuloSingular: "Tipo de resultado",
    textoCarregando: "Carregando tipos de resultado…", textoVazio: "Nenhum tipo de resultado cadastrado.",
    textoErro: "Não foi possível carregar os tipos de resultado no momento. Tente novamente em instantes.",
    // Combo "Tipo de Resultado" (ID_TIPO_RESULTADO em kzn_resultados):
    // opções vêm de /api/tiporesultados (aba "Tipo Resultados", mesma
    // fonte que já existe), escolhidas pelo nome e gravadas como ID.
    comboExtra: {
      campo: "idTipoResultado", rota: "tiporesultados",
      addSelectId: "resAddTipoResultado", editSelectId: "resEditTipoResultado",
    },
  });
})();
