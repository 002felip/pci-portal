/**
 * VBM Kaizen — aba "Tipo Resultados" (admin.html).
 * Só a configuração; a lógica (listar/criar/editar/ativar) está em
 * js/cadastro-bilingue.js (window.criarCadastroBilingue).
 *
 * Tabela (DER): kzn_tipo_resultado — ID_TIPO_RESULTADO, ID_IDIOMA,
 * NM_TIPO_RESULTADO VARCHAR(30), DT_ATUALIZACAO. Sem coluna de
 * descrição e sem URL_ICONE — o motor compartilhado infere isso pela
 * ausência dos campos *DescPt/*DescEn no modal (não há tiporesAddDescPt
 * nem tiporesEditDescPt no admin.html) e usa sempre o ícone padrão.
 */
(function () {
  if (!window.criarCadastroBilingue) return;

  criarCadastroBilingue({
    rota: "tiporesultados", listaId: "tiporesultadosList",
    modalAddId: "modalAddTipoResultado", modalEditId: "modalEditTipoResultado",
    prefixoAdd: "tiporesAdd", prefixoEdit: "tiporesEdit",
    btnSalvarAddId: "btnSaveAddTipoResultado", btnSalvarEditId: "btnSaveEditTipoResultado",
    classeIcone: "teal", iconePadrao: "assets/icons/tiporesultados/fa-solid-layer-group.svg",
    palavraBadge: null, palavraBadgeSingular: null,
    // Limite do DER (kzn_tipo_resultado): NM_TIPO_RESULTADO VARCHAR(30)
    // — mesmo tamanho de nome das outras 4 tabelas bilíngues (server.js
    // espelha isso em CADASTRO_LIMITES_DER.nome).
    maxNome: 30, maxDescricao: 0,
    rotuloSingular: "Classificação de tipo de resultado",
    textoCarregando: "Carregando classificações…", textoVazio: "Nenhuma classificação cadastrada.",
    textoErro: "Não foi possível carregar as classificações no momento. Tente novamente em instantes.",
  });
})();
