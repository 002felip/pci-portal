/**
 * VBM Kaizen — aba "Tipo Kaizen" (admin.html).
 * Só a configuração; a lógica (listar/criar/editar/ativar) está em
 * js/cadastro-bilingue.js (window.criarCadastroBilingue).
 *
 * Tabela (DER): kzn_tipo_kaizen — ID_TIPO_KAIZEN, ID_IDIOMA,
 * NM_TIPO_KAIZEN VARCHAR(30), DS_TIPO_KAIZEN VARCHAR(100), SG_ATIVO,
 * ID_USUARIO, DT_ATUALIZACAO. Nome + descrição bilíngues, SEM
 * URL_ICONE — o motor compartilhado infere isso pela ausência dos
 * campos *IconGrid/*IconInput no modal (não há tipokznAddIconGrid nem
 * tipokznEditIconGrid no admin.html) e usa sempre o ícone padrão.
 */
(function () {
  if (!window.criarCadastroBilingue) return;

  criarCadastroBilingue({
    rota: "tiposkaizen", listaId: "tiposkaizenList",
    modalAddId: "modalAddTipoKaizen", modalEditId: "modalEditTipoKaizen",
    prefixoAdd: "tipokznAdd", prefixoEdit: "tipokznEdit",
    btnSalvarAddId: "btnSaveAddTipoKaizen", btnSalvarEditId: "btnSaveEditTipoKaizen",
    classeIcone: "teal", iconePadrao: "assets/icons/tiposkaizen/fa-solid-clipboard-list.svg",
    // Sem URL_ICONE na tabela: ícone pelo nome do tipo (PT e EN)
    // New = melhoria nova; Replication = levar uma melhoria comprovada a outro lugar; Scope = ampliar
    // a abrangência de uma melhoria. "Replic" vem antes de "nov" por segurança.
    iconesPorNome: [
      { re: /replic/i, icone: "clone" },
      { re: /scope|escopo|abrang[êe]ncia|expans|amplia/i, icone: "up-right-and-down-left-from-center" },
      { re: /^new\b|^nov[oa]\b|\bnew kaizen|\bnovo kaizen/i, icone: "lightbulb" },
      { re: /simples|simple|quick/i, icone: "bolt" },
      { re: /complex/i, icone: "gears" },
      { re: /inova/i, icone: "rocket" },
      { re: /seguran|safety/i, icone: "shield-halved" },
      { re: /evento|event|equipe|team|blitz/i, icone: "people-group" },
    ],
    palavraBadge: null, palavraBadgeSingular: null,
    // Mesmo tamanho de nome/descrição do DER (server.js espelha isso em
    // CADASTRO_LIMITES_DER).
    maxNome: 30, maxDescricao: 100,
    rotuloSingular: "Tipo de Kaizen",
    textoCarregando: "Carregando tipos de Kaizen…", textoVazio: "Nenhum tipo de Kaizen cadastrado.",
    textoErro: "Não foi possível carregar os tipos de Kaizen no momento. Tente novamente em instantes.",
  });
})();
