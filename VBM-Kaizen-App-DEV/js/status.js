/**
 * VBM Kaizen — aba "Status Kaizen" (admin.html).
 * Só a configuração; a lógica (listar/criar/editar/ativar) está em
 * js/cadastro-bilingue.js (window.criarCadastroBilingue).
 *
 * Tabela: kzn_status — ID_STATUS, ID_IDIOMA, URL_ICONE VARCHAR(200),
 * NM_STATUS VARCHAR(30), DS_STATUS VARCHAR(100), SG_ATIVO, ID_USUARIO,
 * DT_ATUALIZACAO.
 *
 * Diferente da kzn_motivo_reprovacao que esta aba usava antes, kzn_status
 * TEM URL_ICONE: o modal ganha a mesma paleta de ícones das abas
 * Categorias/Replicação/Desperdícios/Resultados, pelo mesmo motor.
 */
(function () {
  if (!window.criarCadastroBilingue) return;

  criarCadastroBilingue({
    rota: "status", listaId: "statusList",
    modalAddId: "modalAddStatus", modalEditId: "modalEditStatus",
    prefixoAdd: "statusAdd", prefixoEdit: "statusEdit",
    btnSalvarAddId: "btnSaveAddStatus", btnSalvarEditId: "btnSaveEditStatus",
    classeIcone: "purple", iconePadrao: "assets/icons/status/fa-solid-circle-check.svg",
    // Ícone pelo nome (ver iconeDoRegistro em cadastro-bilingue.js); a ordem importa:
    // "Reprovado" e "Em aprovação" antes de "Aprovado".
    iconesPorNome: [
      { re: /reprov|reject|recus|refus/i, icone: "circle-xmark" },
      { re: /em aprova|aguard|await|pending approval|in approval|under approval|submetido|submitted/i, icone: "clipboard-check" },
      { re: /aprova|approv/i, icone: "circle-check" },
      { re: /rascunho|draft|novo|\bnew\b/i, icone: "pen" },
      { re: /revis|review/i, icone: "rotate" },
      { re: /implement|conclu|complet|finaliz|done|closed|encerr/i, icone: "flag-checkered" },
      { re: /cancel/i, icone: "ban" },
      { re: /pendent|pending|andamento|progress/i, icone: "hourglass-half" },
    ],
    palavraBadge: null, palavraBadgeSingular: null,
    // Limites do DER (kzn_status): NM_STATUS VARCHAR(30) /
    // DS_STATUS VARCHAR(100) — mesmo tamanho das outras tabelas
    // bilíngues (server.js espelha isso em CADASTRO_LIMITES_DER).
    maxNome: 30, maxDescricao: 100,
    rotuloSingular: "Status",
    textoCarregando: "Carregando status…", textoVazio: "Nenhum status cadastrado.",
    textoErro: "Não foi possível carregar os status no momento. Tente novamente em instantes.",
  });
})();
