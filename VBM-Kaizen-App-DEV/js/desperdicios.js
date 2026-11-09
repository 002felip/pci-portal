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
    // Ícone pelo nome (ver iconeDoRegistro em cadastro-bilingue.js): os desperdícios do Lean.
    // bolt, wrench, lightbulb e shield-halved eram da paleta antiga (tipos de Kaizen) e não
    // valem como escolha.
    iconesLegados: ["bolt", "wrench", "lightbulb", "shield-halved"],
    iconesPorNome: [
      { re: /nenhum|^none$|n[ãa]o se aplica|not applicable|^n\/?a$/i, icone: "circle-minus" },
      { re: /defeit|defect|retrabalho|rework|refugo|scrap|erro|error/i, icone: "triangle-exclamation" },
      { re: /superprocess|over-?process|processamento extra|extra process|excesso de process/i, icone: "gears" },
      { re: /superprodu|over-?produc|excesso de produ/i, icone: "boxes-stacked" },
      { re: /espera|wait|fila|queue|ociosid|idle/i, icone: "hourglass-half" },
      { re: /talent|intelect|conhecimento|skill|non-?utili|n[ãa]o utiliz|criativ/i, icone: "user-graduate" },
      { re: /transport/i, icone: "truck-fast" },
      { re: /estoque|invent/i, icone: "warehouse" },
      { re: /movimenta|motion|moviment|deslocamento/i, icone: "person-walking" },
      { re: /ergonom/i, icone: "user-injured" },
      { re: /sobrecarga|overburden|muri/i, icone: "weight-hanging" },
      { re: /variab|unevenness|desnivel|mura\b|irregular/i, icone: "wave-square" },
    ],
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
