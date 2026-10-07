/**
 * VBM Kaizen — e-mails automáticos das decisões de aprovação.
 *
 * Usado por server.js (registrarDecisao) DEPOIS que a decisão já está
 * gravada: aprovar, reprovar e solicitar alteração avisam o autor da
 * iniciativa por e-mail.
 *
 * O QUE ESTE MÓDULO FAZ (e o que não faz)
 *   Aqui ficam só os TEMPLATES e a montagem da mensagem com os dados
 *   reais lidos do banco. O envio em si acontece no navegador
 *   (js/envio-email.js), com o token DELEGADO do aprovador logado —
 *   é o perfil dele que autentica no Microsoft Graph, não uma
 *   identidade de aplicação. Por isso não há client secret aqui.
 *
 *   Montar no servidor e enviar no navegador mantém o conteúdo fora do
 *   alcance da tela: o corpo do e-mail é gerado a partir da linha do
 *   banco, não do que foi digitado.
 *
 * CAIXA REMETENTE — duas formas, escolhidas por variável de ambiente.
 *
 *   PADRÃO: sai pela caixa compartilhada PCI.Base.Metals@Vale.com
 *   (KAIZEN_EMAIL_REMETENTE sobrescreve o endereço). Exige que quem
 *   cadastra/decide tenha "Enviar Como" nessa caixa — liberação do time
 *   de Exchange, fora do alcance deste projeto.
 *
 *   KAIZEN_EMAIL_DO_USUARIO=true: sai pela caixa da PRÓPRIA pessoa que
 *   está usando o sistema. Não depende de liberação nenhuma no Exchange,
 *   porque ninguém está enviando por caixa alheia — cada um envia pela
 *   sua. É a saída para destravar o envio enquanto o "Enviar Como" não
 *   sai, e para voltar atrás basta remover a variável.
 *
 *   Nos dois casos o escopo delegado é o mesmo, Mail.Send.Shared: ele
 *   cobre "enviar como o usuário logado" E "enviar em nome de outra
 *   caixa" (é o que diz a própria descrição da permissão no Entra).
 *   Nenhuma permissão nova precisa ser concedida para alternar.
 *
 *   Quem traduz isso em endereço do Graph é js/envio-email.js: com "de"
 *   preenchido chama /users/<caixa>/sendMail; sem "de", chama /me/sendMail.
 *
 * IDIOMA
 *   Não existe idioma cadastrado por pessoa: kzn_mdm_hierarquia não tem
 *   coluna de idioma e kzn_pedravisaoconsolidada também não. Por isso
 *   cada e-mail sai BILÍNGUE — o corpo em português e, abaixo, o mesmo
 *   conteúdo em inglês —, o que não depende do idioma da tela de quem
 *   decidiu nem de mudança de banco. O nome do status vem de
 *   kzn_status nos dois idiomas (ID_IDIOMA 1 e 2), não de texto fixo.
 */

const REMETENTE = process.env.KAIZEN_EMAIL_REMETENTE || "PCI.Base.Metals@Vale.com";
// Enviar pela caixa de quem está logado, em vez da compartilhada. Ver a
// nota "CAIXA REMETENTE" acima.
const ENVIAR_PELA_CAIXA_DO_USUARIO = String(process.env.KAIZEN_EMAIL_DO_USUARIO || "").toLowerCase() === "true";
const APP_URL = (process.env.KAIZEN_APP_URL ||
  "https://kaizen-7405608945147182.2.azure.databricksapps.com").replace(/\/+$/, "");

// Telas do Kaizen ficam sob /VBM-Kaizen-App/ (portal na raiz do app).
const URL_APROVACAO = `${APP_URL}/VBM-Kaizen-App/aprovacao.html`;
const URL_BIBLIOTECA = `${APP_URL}/VBM-Kaizen-App/biblioteca.html`;

// ------------------------------------------------------------------
// Templates — centralizados aqui de propósito: mudar o texto de um
// aviso não deveria exigir mexer no fluxo de aprovação.
// ------------------------------------------------------------------

function escapar(txt) {
  return String(txt == null ? "" : txt)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Quebra de linha do usuário vira <br>; o resto já vai escapado. */
function paraHtml(txt) {
  return escapar(txt).replace(/\r?\n/g, "<br>");
}

/** dd/MM/aaaa HH:mm (pt) e MM/dd/aaaa HH:mm (en).
 *
 *  Componentes UTC, não locais: DATETIME2 não guarda fuso e o que está
 *  na coluna já é o relógio de Brasília (ver AGORA_BRASILIA e
 *  relogioLocal em server.js). getDate()/getHours() usariam o fuso do
 *  processo Node e deslocariam a data da decisão. */
function formatarData(valor, idioma) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  const dia = p(d.getUTCDate()), mes = p(d.getUTCMonth() + 1), ano = d.getUTCFullYear();
  const hora = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return idioma === "en" ? `${mes}/${dia}/${ano} ${hora}` : `${dia}/${mes}/${ano} ${hora}`;
}

const RODAPE = {
  pt: ["Atenciosamente,", "Programa Kaizen", "Vale Base Metals"],
  en: ["Best regards,", "Kaizen Program", "Vale Base Metals"],
};

const ROTULOS = {
  pt: { codigo: "Código", titulo: "Título", site: "Site", status: "Status",
        aprovador: "Aprovador", data: "Data da decisão",
        categoria: "Categoria", autor: "Autor", dataCadastro: "Data do cadastro" },
  en: { codigo: "Code", titulo: "Title", site: "Site", status: "Status",
        aprovador: "Approver", data: "Decision date",
        categoria: "Category", autor: "Author", dataCadastro: "Registration date" },
};

/** Um momento do ciclo = um template por idioma. Cada função recebe os
 *  dados reais do Kaizen e devolve { assunto, linhas }, onde `linhas` é
 *  a lista de parágrafos/blocos do corpo. */
const TEMPLATES = {
  // Cadastro — vai para o dono do Kaizen e para os demais participantes.
  cadastrado: {
    pt: (d) => ({
      assunto: "[Kaizen] Iniciativa registrada",
      linhas: [
        "Olá.",
        "O Kaizen abaixo foi registrado e está aguardando aprovação.",
        { campos: [["codigo", d.codigo], ["titulo", d.titulo], ["site", d.site],
                   ["categoria", d.categoriaPt], ["autor", d.nomeAutor],
                   ["aprovador", d.nomeAprovador], ["dataCadastro", d.dataPt],
                   ["status", d.statusPt]] },
        "Você está recebendo este comunicado por ser o autor ou participante da equipe desta iniciativa.",
        "Acompanhe pela Biblioteca Kaizen:",
        { link: URL_BIBLIOTECA },
      ],
    }),
    en: (d) => ({
      assunto: "[Kaizen] Initiative registered",
      linhas: [
        "Hello.",
        "The Kaizen below has been registered and is awaiting approval.",
        { campos: [["codigo", d.codigo], ["titulo", d.titulo], ["site", d.site],
                   ["categoria", d.categoriaEn], ["autor", d.nomeAutor],
                   ["aprovador", d.nomeAprovador], ["dataCadastro", d.dataEn],
                   ["status", d.statusEn]] },
        "You are receiving this notice as the author or a team member of this initiative.",
        "Follow it in the Kaizen Library:",
        { link: URL_BIBLIOTECA },
      ],
    }),
  },

  // Cadastro — vai só para quem tem de aprovar, com o link da fila.
  pendenteAprovacao: {
    pt: (d) => ({
      assunto: "[Kaizen] Iniciativa aguardando sua aprovação",
      linhas: [
        `Olá, ${d.nomeAprovador}.`,
        "Um Kaizen foi enviado para a sua aprovação.",
        { campos: [["codigo", d.codigo], ["titulo", d.titulo], ["site", d.site],
                   ["categoria", d.categoriaPt], ["autor", d.nomeAutor],
                   ["dataCadastro", d.dataPt], ["status", d.statusPt]] },
        "Acesse a fila de aprovação para analisar a iniciativa:",
        { link: URL_APROVACAO },
      ],
    }),
    en: (d) => ({
      assunto: "[Kaizen] Initiative awaiting your approval",
      linhas: [
        `Hello, ${d.nomeAprovador}.`,
        "A Kaizen has been submitted for your approval.",
        { campos: [["codigo", d.codigo], ["titulo", d.titulo], ["site", d.site],
                   ["categoria", d.categoriaEn], ["autor", d.nomeAutor],
                   ["dataCadastro", d.dataEn], ["status", d.statusEn]] },
        "Access the approval queue to review the initiative:",
        { link: URL_APROVACAO },
      ],
    }),
  },

  aprovado: {
    pt: (d) => ({
      assunto: "[Kaizen] Iniciativa aprovada",
      linhas: [
        "Olá.",
        "O Kaizen abaixo foi aprovado com sucesso.",
        { campos: [["codigo", d.codigo], ["titulo", d.titulo], ["site", d.site],
                   ["autor", d.nomeAutor], ["status", d.statusPt],
                   ["aprovador", d.nomeAprovador], ["data", d.dataPt]] },
        "Parabéns! Sua iniciativa foi aprovada e seguirá o fluxo definido pelo programa Kaizen.",
        "Acesse o sistema para mais detalhes:",
        { link: URL_APROVACAO },
      ],
    }),
    en: (d) => ({
      assunto: "[Kaizen] Initiative approved",
      linhas: [
        "Hello.",
        "The Kaizen below has been successfully approved.",
        { campos: [["codigo", d.codigo], ["titulo", d.titulo], ["site", d.site],
                   ["autor", d.nomeAutor], ["status", d.statusEn],
                   ["aprovador", d.nomeAprovador], ["data", d.dataEn]] },
        "Congratulations! Your initiative has been approved and will follow the flow defined by the Kaizen program.",
        "Access the system for more details:",
        { link: URL_APROVACAO },
      ],
    }),
  },

  reprovado: {
    pt: (d) => ({
      assunto: "[Kaizen] Iniciativa não aprovada",
      linhas: [
        "Olá.",
        "Após avaliação, o Kaizen abaixo não foi aprovado.",
        { campos: [["codigo", d.codigo], ["titulo", d.titulo], ["site", d.site],
                   ["autor", d.nomeAutor], ["aprovador", d.nomeAprovador], ["data", d.dataPt]] },
        "Motivo informado pelo aprovador:",
        { destaque: d.motivo },
        "Caso necessário, consulte seu gestor ou responsável local para orientação.",
      ],
    }),
    en: (d) => ({
      assunto: "[Kaizen] Initiative not approved",
      linhas: [
        "Hello.",
        "After review, the Kaizen below was not approved.",
        { campos: [["codigo", d.codigo], ["titulo", d.titulo], ["site", d.site],
                   ["autor", d.nomeAutor], ["aprovador", d.nomeAprovador], ["data", d.dataEn]] },
        "Reason given by the approver:",
        { destaque: d.motivo },
        "If needed, contact your manager or local representative for guidance.",
      ],
    }),
  },

  // Único fluxo com o link da Biblioteca: é lá que o autor corrige o
  // Kaizen e o reenvia. Os outros dois não pedem ação de edição.
  alteracao: {
    pt: (d) => ({
      assunto: "[Kaizen] Ajustes solicitados em sua iniciativa",
      linhas: [
        "Olá.",
        "O Kaizen abaixo foi analisado e necessita de ajustes antes de uma nova avaliação.",
        { campos: [["codigo", d.codigo], ["titulo", d.titulo], ["site", d.site],
                   ["autor", d.nomeAutor], ["aprovador", d.nomeAprovador], ["data", d.dataPt]] },
        "Comentários do aprovador:",
        { destaque: d.motivo },
        "Para realizar as correções, acesse a Biblioteca Kaizen:",
        { link: URL_BIBLIOTECA },
        "Após atualizar as informações necessárias, envie novamente para aprovação.",
      ],
    }),
    en: (d) => ({
      assunto: "[Kaizen] Changes requested in your initiative",
      linhas: [
        "Hello.",
        "The Kaizen below has been reviewed and needs changes before a new evaluation.",
        { campos: [["codigo", d.codigo], ["titulo", d.titulo], ["site", d.site],
                   ["autor", d.nomeAutor], ["aprovador", d.nomeAprovador], ["data", d.dataEn]] },
        "Approver comments:",
        { destaque: d.motivo },
        "To make the corrections, access the Kaizen Library:",
        { link: URL_BIBLIOTECA },
        "After updating the required information, submit it for approval again.",
      ],
    }),
  },
};

/** Monta o HTML de um idioma. Mesmo desenho para os três momentos: sem
 *  imagem, sem CSS externo e sem tabela de layout — o que sobrevive ao
 *  Outlook e ao cliente de e-mail do celular. */
function corpoDeUmIdioma(modelo, idioma) {
  const r = ROTULOS[idioma];
  const partes = modelo.linhas.map((linha) => {
    if (typeof linha === "string") {
      return `<p style="margin:0 0 12px;">${paraHtml(linha)}</p>`;
    }
    if (linha.link) {
      return `<p style="margin:0 0 12px;"><a href="${escapar(linha.link)}" ` +
             `style="color:#1a8bbf;">${escapar(linha.link)}</a></p>`;
    }
    if (linha.campos) {
      const itens = linha.campos
        .map(([chave, valor]) => `<div style="margin:0 0 4px;"><strong>${escapar(r[chave])}:</strong> ${paraHtml(valor || "—")}</div>`)
        .join("");
      return `<div style="margin:0 0 16px;">${itens}</div>`;
    }
    if (linha.destaque) {
      return `<div style="margin:0 0 16px;padding:12px 14px;background:#f5f7f9;` +
             `border-left:3px solid #1a8bbf;">${paraHtml(linha.destaque)}</div>`;
    }
    return "";
  }).join("");

  const rodape = RODAPE[idioma]
    .map((l) => `<div>${escapar(l)}</div>`).join("");

  return `${partes}<div style="margin-top:20px;color:#555;">${rodape}</div>`;
}

/** E-mail bilíngue: português em cima, inglês embaixo, separados por uma
 *  linha. Um envio só — dois e-mails para a mesma decisão seriam ruído
 *  na caixa de quem recebe. */
function montarMensagem(momento, dados) {
  const modelo = TEMPLATES[momento];
  if (!modelo) throw new Error(`Sem template de e-mail para "${momento}".`);
  const pt = modelo.pt(dados);
  const en = modelo.en(dados);

  const html =
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;line-height:1.55;">` +
      corpoDeUmIdioma(pt, "pt") +
      `<hr style="border:none;border-top:1px solid #e0e0e0;margin:28px 0;">` +
      corpoDeUmIdioma(en, "en") +
    `</div>`;

  return { assunto: `${pt.assunto} / ${en.assunto}`, html };
}

// ------------------------------------------------------------------
// Montagem do aviso
// ------------------------------------------------------------------

/**
 * Monta um comunicado do Kaizen.
 *
 * @param {string} momento  "cadastrado" | "pendenteAprovacao" |
 *                          "aprovado" | "reprovado" | "alteracao"
 * @param {string[]} destinatarios  e-mails reais; nulos e repetidos são
 *   descartados aqui, para nenhum fluxo precisar lembrar de fazer isso.
 * @param {object} dados    dados REAIS do Kaizen, lidos do banco.
 * @returns {{chave, de, para, assunto, html}|{erro}} `erro` quando não
 *   sobrou ninguém a quem enviar.
 */
function montarAviso(momento, destinatarios, dados) {
  const para = [...new Set((destinatarios || [])
    .map((e) => String(e || "").trim())
    .filter((e) => e.includes("@")))];
  if (!para.length) {
    return { erro: `sem destinatário com e-mail no MDM (${momento})` };
  }
  const { assunto, html } = montarMensagem(momento, {
    ...dados,
    dataPt: formatarData(dados.dataDecisao, "pt"),
    dataEn: formatarData(dados.dataDecisao, "en"),
  });
  return {
    // Identifica o comunicado: a tela usa para não enviar duas vezes o
    // mesmo aviso e o servidor usa no log.
    chave: `${dados.idKaizen}:${dados.idStatus}:${momento}`,
    // null = "a caixa de quem está logado" (ver ENVIAR_PELA_CAIXA_DO_USUARIO).
    de: ENVIAR_PELA_CAIXA_DO_USUARIO ? null : REMETENTE,
    para,
    assunto,
    html,
  };
}

module.exports = { montarAviso, TEMPLATES, montarMensagem, formatarData, REMETENTE };
