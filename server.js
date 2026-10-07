/**
 * Portal de aplicações — Performance & Continuous Improvement.
 *
 * Um Databricks App roda UM processo; este é ele. O portal não tem regra
 * de negócio: só entrega a página inicial (index.html + assets/) e monta
 * cada aplicação na sua pasta. Cada aplicação é dona dos seus arquivos:
 *
 *   /                  portal (este diretório: index.html, assets/)
 *   /VBM-Kaizen-App/   VBM-Kaizen-App/server.js  (app Express montável)
 *   /VBM-Quartely/     VBM-Quartely/portal.js    (API própria, banco PRD)
 *
 * Nova aplicação = nova pasta + uma linha de montagem abaixo.
 */
const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");

// Pasta do Kaizen no disco. A URL continua /VBM-Kaizen-App/ (favoritos e
// links de e-mail), mas o código pode estar em VBM-Kaizen-App-DEV ou -PROD.
// Escolha explícita: env KAIZEN_PASTA (app.yaml). Sem ela, a primeira que existir.
const KAIZEN_PASTA = [process.env.KAIZEN_PASTA, "VBM-Kaizen-App", "VBM-Kaizen-App-PROD", "VBM-Kaizen-App-DEV"]
  .filter(Boolean)
  .find((p) => fs.existsSync(path.join(__dirname, p, "server.js")));
if (!KAIZEN_PASTA) {
  throw new Error(`[portal] server.js do Kaizen não encontrado (KAIZEN_PASTA=${process.env.KAIZEN_PASTA || "não definida"}). Pastas em ${__dirname}: ${fs.readdirSync(__dirname).join(", ")}`);
}
if (process.env.KAIZEN_PASTA && process.env.KAIZEN_PASTA !== KAIZEN_PASTA) {
  console.warn(`[portal] KAIZEN_PASTA=${process.env.KAIZEN_PASTA} não existe; usando ${KAIZEN_PASTA}.`);
}
process.env.KAIZEN_PASTA = KAIZEN_PASTA; // o VBM-Quartely lê daqui o módulo azure-blob
console.log(`[portal] VBM-Kaizen-App carregado de ./${KAIZEN_PASTA}`);
const kaizen = require(path.join(__dirname, KAIZEN_PASTA, "server.js"));
const criarControleDeAcesso = require("./portal-acesso");

const portal = express();
portal.disable("x-powered-by");
// Mesmas opções do Kaizen (ver comentário do helmet em VBM-Kaizen-App/server.js).
portal.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginOpenerPolicy: false }));
portal.use(compression());

// Pasta sem barra final: os caminhos relativos das telas (css/, js/,
// assets/) resolveriam na raiz do portal. Redireciona para a barra.
function exigirBarraFinal(prefixo) {
  return (req, res, next) => {
    const [caminho, consulta] = req.originalUrl.split("?");
    if (caminho.endsWith("/")) return next();
    res.redirect(301, caminho + "/" + (consulta ? "?" + consulta : ""));
  };
}

// ── VBM-Kaizen-App ──
// As telas chamam a API em /api/... (absoluto), então /api também é do
// Kaizen. A próxima aplicação com API própria usa /<pasta>/api.
portal.use((req, res, next) => (req.path === "/api" || req.path.startsWith("/api/") ? kaizen.app(req, res, next) : next()));
portal.get("/VBM-Kaizen-App", exigirBarraFinal());
portal.use("/VBM-Kaizen-App", kaizen.app);
// Endereços antigos (favoritos, e-mails enviados) das telas que moravam na raiz.
portal.get(["/admin.html", "/aprovacao.html", "/biblioteca.html", "/kaizen-novo.html"], (req, res) => {
  res.redirect(302, "/VBM-Kaizen-App" + req.originalUrl);
});

// ── Controle de acesso do Portal ──
// Usuário em IBP.USERS com CD_MATRICULA preenchido (ver portal-acesso.js).
// Vale para o Portal e o Quartely; o VBM-Kaizen-App é aberto (validação própria).
// Registrado ANTES das rotas do Quartely.
let acesso = null;
const aguardarAcesso = (fn) => (req, res, next) => (acesso ? acesso[fn](req, res, next) : res.status(503).json({ error: "Portal iniciando." }));
portal.get("/portal/acesso", aguardarAcesso("rotaStatus"));
portal.use("/VBM-Quartely", aguardarAcesso("exigir"));
portal.use("/Quartely", aguardarAcesso("exigir"));

// ── VBM-Quartely ──
// API (/VBM-Quartely/api) + bloqueio dos arquivos internos da pasta.
const quartely = require("./VBM-Quartely/portal")(portal) || {};
// portal.js antigo (não devolve a conexão) não pode derrubar o app: o Portal
// e o Quartely ficam bloqueados com "não foi possível validar" e o log explica.
if (typeof quartely.runQuery !== "function") {
  console.error("[portal-acesso] VBM-Quartely/portal.js desatualizado (não devolve { runQuery }) — publique a versão nova. Acesso ao Portal/Quartely bloqueado até lá.");
}
// IBP.USERS é lida SOMENTE no banco de produção (BDIBPBMSA_PRD, conexão do Quartely).
const conexoesAcesso = [];
if (typeof quartely.runQuery === "function") conexoesAcesso.push({ nome: "PRD (BDIBPBMSA_PRD)", runQuery: quartely.runQuery });
acesso = criarControleDeAcesso({ conexoes: conexoesAcesso });
portal.use("/VBM-Quartely", express.static(path.join(__dirname, "VBM-Quartely"), { index: "quartely.html", dotfiles: "ignore" }));
portal.use("/Quartely", (req, res) => res.redirect(301, "/VBM-Quartely" + req.url));

// ── Portal ──
portal.use("/assets", express.static(path.join(__dirname, "assets"), { dotfiles: "ignore" }));
// index.html também validado no servidor: sem autorização, a página vai SEM os
// links das aplicações (só a tela de bloqueio) — DevTools não tem o que revelar.
portal.get(["/", "/index.html"], async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const r = acesso ? await acesso.validar(req) : { autorizado: false, motivo: "erro" };
    if (r.autorizado) return res.sendFile(path.join(__dirname, "index.html"));
    const html = await fs.promises.readFile(path.join(__dirname, "index.html"), "utf8");
    res.status(r.motivo === "erro" ? 503 : 403).type("html").send(html.replace(/<nav class="cards"[\s\S]*?<\/nav>/, ""));
  } catch (err) { next(err); }
});

const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000;
portal.listen(PORT, "0.0.0.0", () => {
  console.log(`[portal] rodando em 0.0.0.0:${PORT}`);
  kaizen.aoIniciar();
});
