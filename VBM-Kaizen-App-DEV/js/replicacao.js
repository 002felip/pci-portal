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
    // Ícone pelo nome (ver iconeDoRegistro em cadastro-bilingue.js). O potencial de replicação é
    // a ÁREA do processo (Concentration, Crusher, Open Pit, Smelter…). Os ícones da paleta antiga
    // (geográficos) não valem como escolha. "Sem replicação" vem primeiro de propósito.
    iconesLegados: ["building", "map-location-dot", "ban", "clone", "sitemap", "gauge-high", "gauge", "gauge-simple"],
    iconesPorNome: [
      { re: /^no\b|no replic|n[ãa]o replic|sem replic|not replic|nenhum|^none$/i, icone: "ban" },
      { re: /concentra|benefici|flota/i, icone: "filter" },
      { re: /crush|britag|britador/i, icone: "hammer" },
      { re: /open.?pit|c[ée]u aberto/i, icone: "mountain" },
      { re: /underground|subterr/i, icone: "person-digging" },
      { re: /smelt|fundi[çc]|forno|furnace/i, icone: "fire-flame-curved" },
      { re: /refin/i, icone: "industry" },
      { re: /project|projeto/i, icone: "diagram-project" },
      { re: /\bport|porto|ship|embarq/i, icone: "ship" },
      { re: /rail|ferrov|train/i, icone: "train" },
      { re: /usina|plant|planta|pelot|pellet/i, icone: "gears" },
      { re: /global|corporat|todas|\ball\b/i, icone: "globe" },
      { re: /outr|other/i, icone: "shapes" },
    ],
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
