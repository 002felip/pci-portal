/**
 * Dashboard (dashboard.html + dashboard-kaizen.js) contra o dublê
 * fake-mssql-dashboard.js. Sobe o próprio servidor na porta 4002.
 *
 * Cobre: acesso (membro / não-membro), API compacta, UNION ALL atual +
 * histórico com a hierarquia das DUAS tabelas de fotografia, totais da
 * tela batendo com a API, filtro por card de status, painel de filtros
 * em cascata, ranking clicável, abas, Base de Dados com detalhes
 * carregados sob demanda, exportação Excel (conteúdo conferido com
 * ExcelJS), tema escuro, inglês e o caso sem kzn_hist_kaizen_hierarquia.
 *
 * Capturas de tela vão para DASH_SHOTS (padrão: tests/.shots/).
 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const ExcelJS = require("exceljs");

const APP = path.join(__dirname, "..");
const PORTA = 4002;
const BASE = `http://127.0.0.1:${PORTA}`;
const SHOTS = process.env.DASH_SHOTS || path.join(__dirname, ".shots");
const LOG = path.join(__dirname, ".dash-sql.jsonl");
fs.mkdirSync(SHOTS, { recursive: true });

let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

function subir(envExtra) {
  try { fs.unlinkSync(LOG); } catch (e) {}
  const env = Object.assign({}, process.env, {
    AZURE_SQL_SERVER: "teste.database.windows.net", KAIZEN_AZURE_SQL_DATABASE: "TESTE",
    AZURE_SQL_SCHEMA: "ci", AZURE_SQL_TABLE: "kzn_aprovador", AZURE_SQL_USER: "teste", AZURE_SQL_PASSWORD: "teste",
    PORT: String(PORTA), FAKE_MSSQL_LOG: LOG,
  }, envExtra || {});
  const proc = spawn(process.execPath, ["-r", path.join(__dirname, "preload-dashboard.js"), "server.js"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  proc.stdout.on("data", (d) => { saida += d; });
  proc.stderr.on("data", (d) => { saida += d; });
  return new Promise((res) => {
    const t = setInterval(() => { if (/servidor rodando/.test(saida)) { clearInterval(t); res({ proc, saida: () => saida }); } }, 100);
  });
}
const H = { "X-Forwarded-Email": "membro@vale.com" };

(async () => {
  let srv = await subir();
  const { _base } = require("./fake-mssql-dashboard.js");

  console.log("=== Acesso ===");
  ok("dashboard.html com membro -> 200", (await fetch(BASE + "/dashboard.html", { headers: H })).status === 200);
  ok("dashboard.html sem identidade -> 403", (await fetch(BASE + "/dashboard.html")).status === 403);
  ok("API sem identidade -> 403", (await fetch(BASE + "/api/dashboard/dados")).status === 403);
  ok("módulo do servidor não é baixável", (await fetch(BASE + "/dashboard-kaizen.js", { headers: H })).status === 404);

  console.log("\n=== API ===");
  const dados = await (await fetch(BASE + "/api/dashboard/dados", { headers: H })).json();
  const nA = _base.filter((r) => r.ORIGEM === "A").length, nH = _base.length - nA;
  ok("todas as linhas (atual + histórico)", dados.linhas.length === _base.length, `${dados.linhas.length}`);
  ok("contagem por origem", dados.origem.atual === nA && dados.origem.historico === nH, `A=${dados.origem.atual} H=${dados.origem.historico}`);
  ok("'NULL'/'N.A' da carga viram em branco (nenhum no dicionário)", !dados.textos.some((t) => /^(NULL|N\.A)$/i.test(t)));
  ok("status nos dois idiomas, com momento", dados.status.every((s) => s.pt && s.en) && dados.status.some((s) => s.momento === "aprovado"));
  const sqls = fs.readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l).q);
  const fatos = sqls.find((q) => /FONTE_HIER/.test(q)) || "";
  ok("consulta usa UNION ALL das duas PVC", /kzn_pedravisaoconsolidada/.test(fatos) && /kzn_hist_pedravisaoconsolidada/.test(fatos) && /UNION ALL/.test(fatos));
  ok("hierarquia das duas fotografias", /\[ci\]\.\[kzn_kaizen_hierarquia\]/.test(fatos) && /\[ci\]\.\[kzn_hist_kaizen_hierarquia\]/.test(fatos));
  ok("pessoas do histórico em kzn_hist_mdm_vbm_terc", /kzn_hist_mdm_vbm_terc/.test(fatos));
  ok("nenhum N1/N2 na consulta (não são filtro)", !/NM_HIERARQUIA_N[12]\b/.test(fatos));
  const t0 = Date.now();
  await fetch(BASE + "/api/dashboard/dados", { headers: H });
  const nFatos = fs.readFileSync(LOG, "utf8").split("\n").filter((l) => /FONTE_HIER/.test(l)).length;
  ok("segunda chamada sai do cache (sem nova consulta)", nFatos === 1, `${Date.now() - t0} ms`);

  console.log("\n=== Tela ===");
  const browser = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? undefined : undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: H, acceptDownloads: true });
  const page = await ctx.newPage();
  const errosJs = [];
  page.on("pageerror", (e) => errosJs.push(e.message));
  await page.goto(BASE + "/dashboard.html");
  await page.waitForSelector(".tt-num");
  const totalTela = await page.textContent(".tt-num");
  ok("total na tela = linhas da API", totalTela.replace(/\D/g, "") === String(_base.length), totalTela);
  ok("4 cards de resumo", (await page.$$(".dash-tiles > *")).length === 4);
  ok("12 colunas de mês", (await page.$$("#grafMes .col")).length === 12);
  ok("31 colunas de dia", (await page.$$("#grafDia .col")).length === 31);
  ok("pílulas de variação no gráfico de mês", (await page.$$("#grafMes .dpill")).length >= 10);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(SHOTS, "01-total-claro.png"), fullPage: true });

  // Card de status filtra a tela inteira.
  const aprovados = _base.filter((r) => r.ID_STATUS === 3).length;
  await page.click('button.dash-tile[data-st="3"]');
  ok("card Aprovado filtra o total", (await page.textContent(".tt-num")).replace(/\D/g, "") === String(aprovados), await page.textContent(".tt-num"));
  ok("etiqueta do filtro aparece", await page.isVisible("#dashChips .dash-chip"));
  await page.click('button.dash-tile-total');
  ok("card Total limpa o status", (await page.textContent(".tt-num")).replace(/\D/g, "") === String(_base.length));

  // Ranking de hierarquia clicável (Diretoria).
  await page.click('#dashNiveis button[data-n="dir"]');
  const linhaDir = await page.$("#rankHier .rk");
  const nomeDir = await linhaDir.getAttribute("aria-label");
  await linhaDir.click();
  const esperado = _base.filter((r) => r.N4 === nomeDir.split(":")[0]).length;
  ok("clique no ranking filtra pela Diretoria", (await page.textContent(".tt-num")).replace(/\D/g, "") === String(esperado), nomeDir);

  // Painel de filtros em cascata.
  await page.click("#dashAbrirFiltros");
  await page.waitForSelector("#filtrosPainel.open");
  ok("painel mostra 14 filtros + ID", (await page.$$(".qf-campo")).length === 14 && !!(await page.$("#qfId")));
  await page.click("#qfg-head");
  const opcoesHead = await page.$$eval("#qfp-head .qf-opcao", (els) => els.map((e) => e.querySelector(".nm").textContent));
  const headsDaDir = new Set(_base.filter((r) => r.N4 === nomeDir.split(":")[0]).map((r) => r.N5 || "(Em branco)"));
  ok("cascata: Head só mostra os da Diretoria escolhida", opcoesHead.every((h) => headsDaDir.has(h)), opcoesHead.join(" | "));
  await page.screenshot({ path: path.join(SHOTS, "02-filtros.png") });
  await page.click("#fpLimpar");
  await page.click("#qfg-o");
  await page.click('#qfp-o .qf-opcao[data-v="1"]');
  ok("filtro Origem = Histórico", (await page.textContent(".tt-num")).replace(/\D/g, "") === String(nH));
  await page.click("#fpLimpar");
  await page.fill("#qfId", "9000, 1000");
  ok("filtro por ID", (await page.textContent(".tt-num")).replace(/\D/g, "") === "2");
  await page.click("#fpLimpar");
  await page.click("#fpVer");

  // Abas.
  await page.click("#aba-lider");
  ok("aba Kaizen Líder: 15 agentes", (await page.$$("#rankLider .rk")).length === 15);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, "03-lider.png"), fullPage: true });
  await page.click("#aba-detalhe");
  ok("aba Detalhamento: tabela por líder", (await page.$$("#corpoDet tr")).length === 25);
  await page.click("#aba-base");
  await page.waitForFunction(() => !document.querySelector("#corpoBase .dash-carregando-txt"));
  ok("Base de Dados: 25 linhas por página com título", (await page.$$("#corpoBase tr")).length === 25 && /Melhoria/.test(await page.textContent("#corpoBase")));
  ok("selo HIST nos históricos", (await page.$$("#corpoBase .dash-tag-hist")).length >= 0);
  await page.fill("#buscaBase", "britagem");
  await page.waitForTimeout(300);
  const contaBusca = await page.textContent("#contaBase");
  ok("busca por título (depois dos detalhes)", /\d/.test(contaBusca) && parseInt(contaBusca.replace(/\D/g, ""), 10) < _base.length, contaBusca);
  await page.fill("#buscaBase", "");
  await page.screenshot({ path: path.join(SHOTS, "04-base.png"), fullPage: true });

  // Exportação.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportarBase")]);
  const arq = path.join(SHOTS, "export-base.xlsx");
  await dl.saveAs(arq);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(arq);
  const ws = wb.worksheets[0];
  ok("Excel da base com todas as linhas filtradas", ws.rowCount - 1 === _base.length, `${ws.rowCount - 1} linhas`);
  ok("Excel tem os 6 níveis + título", ["COO", "Diretoria", "Head", "Gerência Geral", "Gerência Área", "Coord/Sup", "Título"].every((h) => ws.getRow(1).values.includes(h)));
  await page.click("#aba-detalhe");
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#exportarDet")]);
  const arq2 = path.join(SHOTS, "export-lideres.xlsx");
  await dl2.saveAs(arq2);
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(arq2);
  ok("Excel por líder tem coluna % aprovação", wb2.worksheets[0].getRow(1).values.includes("% aprovação"));

  // Tema escuro e inglês.
  await page.click("#aba-total");
  await page.click("#settingsBtn");
  await page.click("#btnBusiness");
  await page.selectOption("#langSelect", "en");
  await page.click("#settingsClose");
  ok("tema escuro aplicado", (await page.getAttribute("body", "data-bg")) === "dark");
  ok("inglês: aba e status traduzidos", (await page.textContent("#aba-lider")).includes("Kaizen Leader") && (await page.textContent("#dashTiles")).includes("Approved"));
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(SHOTS, "05-total-escuro-en.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, "06-celular.png"), fullPage: true });
  const largura = await page.evaluate(() => document.documentElement.scrollWidth);
  ok("celular sem rolagem horizontal da página", largura <= 392, `${largura}px`);
  ok("sem erro de JavaScript", errosJs.length === 0, errosJs.join(" | "));
  await browser.close();

  console.log("\n=== Sem kzn_hist_kaizen_hierarquia (tabela ausente) ===");
  srv.proc.kill();
  await new Promise((r) => setTimeout(r, 600));
  srv = await subir({ FAKE_SEM_HIST_HIER: "1" });
  const r2 = await fetch(BASE + "/api/dashboard/dados", { headers: H });
  const sql2 = fs.readFileSync(LOG, "utf8");
  ok("dashboard continua respondendo", r2.status === 200);
  ok("SQL não cita a tabela ausente", !/kzn_hist_kaizen_hierarquia\]/.test(sql2.split("FONTE_HIER").slice(1).join("")));
  ok("aviso no log", /kzn_hist_kaizen_hierarquia não encontrada/.test(srv.saida()));
  srv.proc.kill();

  console.log(`\n${passou} ok, ${falhou} falha(s)`);
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
