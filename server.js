/**
 * Portal de aplicações — Performance & Continuous Improvement.
 *
 * Um Databricks App roda UM processo; este é ele. O portal não tem regra
 * de negócio: só entrega a página inicial (index.html + assets/) e monta
 * cada aplicação na sua pasta. Cada aplicação é dona dos seus arquivos:
 *
 *   /                  portal (este diretório: index.html, assets/)
 *   /VBM-Kaizen-App/   VBM-Kaizen-App/server.js  (app Express montável)
 *   /VBM-Performance-Hub/     VBM-Performance-Hub/portal.js    (página com as aplicações)
 *     .../VBM-Performance-Studio/                   cada subpasta tem o próprio portal.js
 *     .../COO-Business-Units-Dashboard/             (API em <pasta>/api, banco PRD) —
 *     .../COO-Business-Units-Dashboard-Historical/  lista em VBM-Performance-Hub/portal.js
 *     .../VBM-Health-of-the-Business/
 *   /VBM-Stable-and-Capable/  VBM-Stable-and-Capable/portal.js  (API em <pasta>/api,
 *                             banco do Kaizen, PDFs no Azure Blob, gerador Python)
 *
 *   /VBM-Vdt/       VBM-Vdt/      (Python/FastAPI)  processos filhos em portas
 *   /VBM-Cockpit/   VBM-Cockpit/  (Python/FastAPI)  internas — ver apps-python.js
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
process.env.KAIZEN_PASTA = KAIZEN_PASTA; // o VBM-Performance-Hub lê daqui o módulo azure-blob
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
// Vale para o Portal, o Performance Hub e o Stable & Capable. Abertos a todos: VBM-Kaizen-App
// (validação própria), VBM-Vdt e VBM-Cockpit (sem restrição de acesso, por decisão do negócio).
// Registrado ANTES das rotas do Performance Hub.
let acesso = null;
const aguardarAcesso = (fn) => (req, res, next) => (acesso ? acesso[fn](req, res, next) : res.status(503).json({ error: "Portal iniciando." }));
portal.get("/portal/acesso", aguardarAcesso("rotaStatus"));
portal.use("/VBM-Performance-Hub", aguardarAcesso("exigir"));
portal.use("/Performance-Hub", aguardarAcesso("exigir"));
portal.use("/VBM-Stable-and-Capable", aguardarAcesso("exigir"));

// ── VBM-Performance-Hub ──
// API (/VBM-Performance-Hub/api) + bloqueio dos arquivos internos da pasta.
const performanceHub = require("./VBM-Performance-Hub/portal")(portal) || {};
// portal.js antigo (não devolve a conexão) não pode derrubar o app: o Portal
// e o Performance Hub ficam bloqueados com "não foi possível validar" e o log explica.
if (typeof performanceHub.runQuery !== "function") {
  console.error("[portal-acesso] VBM-Performance-Hub/portal.js desatualizado (não devolve { runQuery }) — publique a versão nova. Acesso ao Portal/Performance Hub bloqueado até lá.");
}
// IBP.USERS é lida SOMENTE no banco de produção (BDIBPBMSA_PRD, conexão do Performance Hub).
const conexoesAcesso = [];
if (typeof performanceHub.runQuery === "function") conexoesAcesso.push({ nome: "PRD (BDIBPBMSA_PRD)", runQuery: performanceHub.runQuery });
acesso = criarControleDeAcesso({ conexoes: conexoesAcesso });
portal.use("/VBM-Performance-Hub", express.static(path.join(__dirname, "VBM-Performance-Hub"), { index: "index.html", dotfiles: "ignore" }));
portal.use("/Performance-Hub", (req, res) => res.redirect(301, "/VBM-Performance-Hub" + req.url));
// Links salvos do Studio na raiz: o Studio agora fica dentro do Hub.
portal.use("/VBM-Performance-Studio", (req, res) => res.redirect(301, "/VBM-Performance-Hub/VBM-Performance-Studio" + req.url));

// ── VBM-Stable-and-Capable ──
// API (/VBM-Stable-and-Capable/api) + bloqueio dos arquivos internos da pasta
// (python/, database/, *.js). Uma falha ao montar não derruba o Portal.
try {
  require("./VBM-Stable-and-Capable/portal")(portal);
} catch (err) {
  console.error("[portal] falha ao montar VBM-Stable-and-Capable:", err.message);
}
portal.get("/VBM-Stable-and-Capable", exigirBarraFinal());
portal.use("/VBM-Stable-and-Capable", express.static(path.join(__dirname, "VBM-Stable-and-Capable"), { index: "index.html", dotfiles: "ignore" }));

// ── Aplicações Python: VBM-Vdt e VBM-Cockpit ──
// Cada uma roda como processo filho numa porta interna; o Portal encaminha
// /<pasta>/... para ela (apps-python.js). Uma aplicação que não sobe responde
// 503 na própria rota e não derruba o Portal.
const montarAppPython = require("./apps-python");
const absDaPasta = (pasta, valor) => (path.isAbsolute(valor) ? valor : path.join(pasta, valor));
try {
  montarAppPython(portal, {
    pasta: "VBM-Vdt",
    titulo: "VBM - Value Driver Tree",
    porta: 8101,
    variavelPorta: "VDT_PORTA_INTERNA",
    // mesmo comando do app.yaml standalone do VDT
    args: (porta) => ["-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", String(porta)],
    env: (pasta) => ({
      // SQLite do VDT. Relativo = dentro da pasta. Fica no disco do app:
      // um deploy novo volta ao vdt.db publicado (igual ao app standalone).
      VDT_DB_PATH: absDaPasta(pasta, process.env.VDT_DB_PATH || "vdt.db"),
      ...(process.env.VDT_ARCHIVE_DIR ? { VDT_ARCHIVE_DIR: absDaPasta(pasta, process.env.VDT_ARCHIVE_DIR) } : {}),
    }),
    saude: "/api/health",
    testeImport: "import fastapi, uvicorn, openpyxl, multipart",
    reescrever: true, // frontend compilado com /assets e /api absolutos
  });
} catch (err) {
  console.error("[portal] falha ao montar VBM-Vdt:", err.message);
}
try {
  montarAppPython(portal, {
    pasta: "VBM-Cockpit",
    titulo: "VBM - Strategic Cockpit",
    porta: 8102,
    variavelPorta: "COCKPIT_PORTA_INTERNA",
    // O app_entry.py do standalone escuta em 0.0.0.0; aqui uvicorn direto, só interno.
    args: (porta) => ["-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", String(porta),
      "--workers", String(process.env.COCKPIT_WEB_CONCURRENCY || 1)],
    env: () => {
      // Variáveis do Cockpit no app.yaml do Portal levam o prefixo COCKPIT_
      // (COCKPIT_ENVIRONMENT -> ENVIRONMENT), para não colidir com as do Portal.
      const proprias = {};
      for (const [k, v] of Object.entries(process.env)) if (k.startsWith("COCKPIT_")) proprias[k.slice(8)] = v;
      return {
        ENVIRONMENT: "prod",
        DATA_BACKEND: "sql",
        ...proprias,
        // Papel do Postgres no Lakebase = service principal do app (o que o app_entry.py fazia)
        ...((process.env.PGUSER || process.env.DATABRICKS_CLIENT_ID) ? { PGUSER: process.env.PGUSER || process.env.DATABRICKS_CLIENT_ID } : {}),
      };
    },
    saude: "/api/health",
    testeImport: "import fastapi, uvicorn, pydantic_settings, sqlalchemy, psycopg, databricks.sdk, multipart, openpyxl",
    reescrever: false, // build já sai com o prefixo (npm run build:portal)
  });
} catch (err) {
  console.error("[portal] falha ao montar VBM-Cockpit:", err.message);
}

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
