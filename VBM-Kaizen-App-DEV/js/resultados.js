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
    // Ícone pelo nome (ver iconeDoRegistro em cadastro-bilingue.js)
    iconesPorNome: [
      { re: /custo|cost|saving|economia|redu[çc][ãa]o de gasto/i, icone: "dollar-sign" },
      { re: /receita|revenue|ganho|financ|lucro|profit|ebitda/i, icone: "sack-dollar" },
      { re: /produtiv|productiv|produ[çc][ãa]o|production|volume/i, icone: "chart-line" },
      { re: /desempenho|performance|efici|effici|\boee\b|disponib|availab|utiliza/i, icone: "gauge-high" },
      { re: /tempo|\btime|lead|ciclo|cycle|prazo/i, icone: "clock" },
      { re: /seguran|safety|risco|risk/i, icone: "shield-halved" },
      { re: /[áa]gua|water/i, icone: "droplet" },
      { re: /energ/i, icone: "bolt" },
      { re: /ambient|environment|sustent|emiss|carbon|co2|esg/i, icone: "leaf" },
      { re: /qualid|quality|defeito|defect/i, icone: "circle-check" },
      { re: /engaj|engag|pessoa|people|moral|equipe|team/i, icone: "hand-holding-hand" },
      { re: /satisf|cliente|customer|experi/i, icone: "face-smile" },
    ],
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
