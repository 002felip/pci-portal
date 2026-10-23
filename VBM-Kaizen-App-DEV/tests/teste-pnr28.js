/**
 * Pacote "PNR28 + Biblioteca" contra o dublê fake-mssql-dashboard.js.
 * Sobe o servidor na porta 4003 (duas vezes: sem e com a tabela de
 * membros envolvidos).
 *
 * Cobre:
 *  - GET /api/hierarquia/opcoes (níveis, contagens, caminho)
 *  - filtro n3..n8 em /api/kaizens, /resumo e /exportar (SQL conferido)
 *  - GET /api/kaizens/recursos com e sem kzn_membros_envolvidos
 *  - limites da equipe (Líder + 2) e do total (5) no POST
 *  - recusa explicada quando há envolvidos e a tabela não existe
 *  - INSERT em kzn_membros_envolvidos quando ela existe
 *  - tela Novo Kaizen: 2 vagas Vale/Externo com teto combinado, bloco
 *    "Membros envolvidos" (liga/desliga, teto de 5, duplicidade),
 *    Lições escondida, Comparação opcional, payload enviado
 *  - Biblioteca: drill-down navegando 3 níveis e voltando pela trilha
 *
 * O SQL gravado no log vai para tests/.pnr28-sql.jsonl — o regressao.sh
 * passa esse arquivo pelo sqlglot (dialeto tsql).
 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const ExcelJS = require("exceljs");

const APP = path.join(__dirname, "..");
const PORTA = 4003;
const BASE = `http://127.0.0.1:${PORTA}`;
const SHOTS = process.env.DASH_SHOTS || path.join(__dirname, ".shots");
const LOG = path.join(__dirname, ".pnr28-sql.jsonl");
fs.mkdirSync(SHOTS, { recursive: true });
try { fs.unlinkSync(LOG); } catch (e) {}

let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };
const H = { "X-Forwarded-Email": "membro@vale.com" };
const HJ = Object.assign({ "Content-Type": "application/json" }, H);

function subir(envExtra) {
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
const parar = (srv) => new Promise((r) => { srv.proc.on("exit", r); srv.proc.kill(); });
const sqlDoLog = () => fs.readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const marcaLog = () => { try { return fs.readFileSync(LOG, "utf8").trim().split("\n").length; } catch (e) { return 0; } };
const sqlDesde = (n) => sqlDoLog().slice(n);

function corpoValido(extra) {
  return Object.assign({
    titulo: "Teste PNR28", declaracao_problema: "Problema", meta_objetivo: "Meta",
    descricao_antes: "Antes", descricao_depois: "Depois", id_categoria: 1, id_usuario_aprovador: 1,
    data_conclusao: "2026-01-10", sg_gm: "N", membros: [], membros_envolvidos: [],
  }, extra || {});
}

(async () => {
  const { _base } = require("./fake-mssql-dashboard.js");
  let srv = await subir();

  console.log("=== Hierarquia: opções do drill-down ===");
  const o3 = await (await fetch(BASE + "/api/hierarquia/opcoes", { headers: H })).json();
  const COO = "CHIEF OPERATING OFFICER - BM - FULANO DE TAL";
  ok("1º nível é N3 (COO)", o3.nivel === "n3", o3.nivel);
  ok("total = base inteira", o3.total === _base.length, `${o3.total} vs ${_base.length}`);
  ok("contagens somam o total menos os sem valor", o3.opcoes.reduce((a, x) => a + x.qtd, 0) + o3.semValor === o3.total);
  ok("COO principal vem primeiro (mais Kaizens)", o3.opcoes[0] && o3.opcoes[0].valor === COO);
  const o4 = await (await fetch(BASE + "/api/hierarquia/opcoes?n3=" + encodeURIComponent(COO), { headers: H })).json();
  const esperadoCOO = _base.filter((r) => r.N3 === COO).length;
  ok("2º nível é N4 dentro do COO", o4.nivel === "n4" && o4.total === esperadoCOO, `${o4.total} vs ${esperadoCOO}`);
  ok("'NULL'/'N.A' não viram opção", !o4.opcoes.some((x) => /^(NULL|N\.A)$/i.test(x.valor)));
  const o9 = await (await fetch(BASE + "/api/hierarquia/opcoes?n4=" + encodeURIComponent("x"), { headers: H })).json();
  ok("caminho sem N3 é ignorado (volta ao N3)", o9.nivel === "n3");
  ok("rota exige identidade", (await fetch(BASE + "/api/hierarquia/opcoes")).status === 403);

  console.log("\n=== Filtro de hierarquia na Biblioteca ===");
  const DIR = o4.opcoes[0].valor;
  let m = marcaLog();
  let r = await fetch(BASE + `/api/kaizens?n3=${encodeURIComponent(COO)}&n4=${encodeURIComponent(DIR)}`, { headers: H });
  ok("GET /kaizens com n3+n4 responde", r.ok, r.status);
  let qs = sqlDesde(m).filter((x) => /hierBib/.test(x.q));
  ok("lista filtra por hierBib.N3 e N4", qs.length > 0 && qs.every((x) => /hierBib\.N3\)\) = @hier3/.test(x.q) && /hierBib\.N4\)\) = @hier4/.test(x.q)));
  ok("parâmetros recebem o caminho", qs.length > 0 && qs[0].inputs.hier3 === COO && qs[0].inputs.hier4 === DIR);
  m = marcaLog();
  await fetch(BASE + `/api/kaizens?n4=${encodeURIComponent(DIR)}`, { headers: H });
  ok("n4 sem n3 não filtra (caminho contíguo)", !sqlDesde(m).some((x) => /hierBib/.test(x.q)));
  m = marcaLog();
  r = await fetch(BASE + `/api/kaizens/resumo?n3=${encodeURIComponent(COO)}`, { headers: H });
  ok("resumo responde com filtro", r.ok, r.status);
  ok("resumo usa a mesma hierarquia", sqlDesde(m).some((x) => /hierBib\.N3/.test(x.q)));

  console.log("\n=== Recursos / envolvidos sem tabela ===");
  let rec = await (await fetch(BASE + "/api/kaizens/recursos", { headers: H })).json();
  ok("recursos: envolvidos indisponível", rec.membrosEnvolvidos === false && rec.maxEquipe === 2 && rec.maxEnvolvidos === 5, JSON.stringify(rec));
  let j = await (await fetch(BASE + "/api/kaizens", { method: "POST", headers: HJ, body: JSON.stringify(corpoValido({ membros: [11, 12, 13] })) })).json();
  ok("equipe com 3 pessoas é recusada", (j.erros || []).some((e) => /no máximo 2 pessoas além do líder/.test(e)), j.error);
  j = await (await fetch(BASE + "/api/kaizens", { method: "POST", headers: HJ, body: JSON.stringify(corpoValido({ membros: [11, 12], membros_envolvidos: [21, 22, 23, 24, 25, 26] })) })).json();
  ok("6 envolvidos é recusado", (j.erros || []).some((e) => /no máximo 5 pessoas/.test(e)), j.error);
  j = await (await fetch(BASE + "/api/kaizens", { method: "POST", headers: HJ, body: JSON.stringify(corpoValido({ membros: [11, 12], membros_envolvidos: [11, 12, 21, 22, 23, 24, 25] })) })).json();
  ok("líder + 2 + 5 envolvidos = 8 pessoas é aceito (repetidos da equipe não contam)", !(j.erros || []).some((e) => /no máximo/.test(e)), j.error);
  ok("…e sem a tabela a recusa é explicada", /criar_membros_envolvidos\.sql/.test(j.error || ""), j.error);

  console.log("\n=== Exportação ===");
  m = marcaLog();
  r = await fetch(BASE + `/api/kaizens/exportar?n3=${encodeURIComponent(COO)}`, { headers: H });
  ok("exportar responde", r.ok, r.status);
  const wb = new ExcelJS.Workbook();
  if (r.ok) await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
  const cab = wb.worksheets[0] ? wb.worksheets[0].getRow(1).values.filter(Boolean) : [];
  ok("planilha tem a coluna Membros Envolvidos", cab.includes("Membros Envolvidos"), cab.slice(-6).join(" | "));
  const qExp = sqlDesde(m).filter((x) => /NM_MEMBROS_ENVOLVIDOS/.test(x.q));
  ok("sem a tabela, a coluna sai NULL", qExp.length > 0 && qExp.every((x) => /CAST\(NULL AS NVARCHAR\(MAX\)\)\) envolv/.test(x.q)));
  ok("exportação também filtra a hierarquia", qExp.length > 0 && qExp.every((x) => /hierBib\.N3/.test(x.q)));
  await parar(srv);

  console.log("\n=== Com kzn_membros_envolvidos ===");
  srv = await subir({ FAKE_ENVOLVIDOS: "1" });
  rec = await (await fetch(BASE + "/api/kaizens/recursos", { headers: H })).json();
  ok("recursos: envolvidos disponível", rec.membrosEnvolvidos === true);
  m = marcaLog();
  r = await fetch(BASE + "/api/kaizens", { method: "POST", headers: HJ, body: JSON.stringify(corpoValido({ membros: [11, 12], membros_envolvidos: [21, 22, 23, 24, 25] })) });
  const insEnv = sqlDesde(m).filter((x) => /INSERT INTO \[ci\]\.\[kzn_membros_envolvidos\]/.test(x.q));
  const insEq = sqlDesde(m).filter((x) => /INSERT INTO \[ci\]\.\[kzn_membros_equipe\]/.test(x.q));
  ok("POST com 8 pessoas grava 2 na equipe e 5 envolvidos", r.status === 201 && insEq.length === 2 && insEnv.length === 5 &&
    insEnv.map((x) => x.inputs.idUsuario).join() === "21,22,23,24,25", `status ${r.status}, equipe ${insEq.length}, envolvidos ${insEnv.length}`);
  // Detalhe, edição, PUT e DELETE: o importante aqui é o SQL que
  // chega ao banco (o dublê não guarda estado entre as chamadas).
  m = marcaLog();
  await fetch(BASE + "/api/kaizens/9000", { headers: H });
  await fetch(BASE + "/api/kaizens/9000/edicao?origem=A", { headers: H });
  const rPut = await fetch(BASE + "/api/kaizens/9000", { method: "PUT", headers: HJ, body: JSON.stringify(corpoValido({ ORIGEM: "A", membros: [11], membros_envolvidos: [31] })) });
  const jPut = await rPut.json().catch(() => ({}));
  await fetch(BASE + "/api/kaizens/9000", { method: "DELETE", headers: H });
  const qCrud = sqlDesde(m).map((x) => x.q).join("\n");
  ok("detalhe/edição leem kzn_membros_envolvidos", /FROM \[ci\]\.\[kzn_membros_envolvidos\] me/.test(qCrud));
  ok("PUT troca os envolvidos (DELETE + INSERT)", /DELETE FROM \[ci\]\.\[kzn_membros_envolvidos\] WHERE ID_KAIZEN/.test(qCrud) &&
    /INSERT INTO \[ci\]\.\[kzn_membros_envolvidos\]/.test(qCrud), `PUT ${rPut.status} ${jPut.error || ""}`);
  m = marcaLog();
  await fetch(BASE + `/api/kaizens/exportar`, { headers: H });
  ok("exportação agrega os envolvidos (STRING_AGG)", sqlDesde(m).some((x) => /STRING_AGG[\s\S]*kzn_membros_envolvidos/.test(x.q)));

  console.log("\n=== Tela: Novo Kaizen ===");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ extraHTTPHeaders: H, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errosJs = [];
  page.on("pageerror", (e) => errosJs.push(e.message));
  await page.goto(BASE + "/kaizen-novo.html", { waitUntil: "networkidle" });
  ok("Lições Aprendidas escondida", await page.locator("#grupoLicoesAprendidas").isHidden());
  ok("Comparação sem asterisco de obrigatório", (await page.locator("label[data-i18n='f.comparisonWithGoal'] .req").count()) === 0);
  ok("bloco de envolvidos visível (tabela existe)", await page.locator("#blocoEnvolvidos").isVisible());
  ok("busca de envolvidos começa desligada", await page.locator("#buscaEnvolvido").isDisabled());

  async function escolher(inputSel, n) {
    await page.fill(inputSel, "a");
    const itens = page.locator(".mdm-suggest-item");
    await itens.first().waitFor({ timeout: 3000 });
    await itens.nth(n).dispatchEvent("mousedown");
    await page.waitForTimeout(50);
  }
  await escolher("#buscaMembroVale", 0);
  await escolher("#buscaMembroVale", 1);
  ok("2 Vale preenchem as 2 vagas", (await page.locator("#teamSlotsVale .team-slot.filled").count()) === 2);
  ok("hidden id_membros_vale_2 preenchido", (await page.inputValue("#id_membros_vale_2")) === "202");
  ok("Líder + 2 Vale: Externos bloqueado", await page.locator("#buscaMembroExterno").isDisabled());
  await page.locator("#teamSlotsVale .team-slot.filled .team-slot-remove").nth(1).click();
  ok("removendo 1 Vale, Externo libera", !(await page.locator("#buscaMembroExterno").isDisabled()));
  await escolher("#buscaMembroExterno", 0);
  ok("1 Vale + 1 terceiro: os dois bloqueados", (await page.locator("#buscaMembroVale").isDisabled()) && (await page.locator("#buscaMembroExterno").isDisabled()));

  await page.click("#toggleEnvolvidos");
  await page.waitForTimeout(50);
  ok("toggle liga a busca de envolvidos", !(await page.locator("#buscaEnvolvido").isDisabled()));
  ok("equipe cheia não limita os envolvidos", !(await page.locator("#buscaEnvolvido").isDisabled()));
  for (let i = 0; i < 4; i++) await escolher("#buscaEnvolvido", i);
  ok("4 envolvidos: ainda há vaga", !(await page.locator("#buscaEnvolvido").isDisabled()));
  await escolher("#buscaEnvolvido", 4);
  ok("5 envolvidos (8 pessoas no Kaizen) → busca bloqueia", (await page.locator("#teamSlotsEnvolvidos .team-slot.filled").count()) === 5 && (await page.locator("#buscaEnvolvido").isDisabled()));
  ok("mensagem de limite de 5 envolvidos", /5 membros envolvidos/.test(await page.textContent("#envolvidosHelper")));
  ok("hidden id_envolvido_5 preenchido", (await page.inputValue("#id_envolvido_5")) === "255");
  await page.screenshot({ path: path.join(SHOTS, "pnr28-equipe.png"), clip: await page.locator("#blocoEnvolvidos").evaluate((el) => {
    const r = el.parentElement.getBoundingClientRect(); return { x: r.x, y: Math.max(0, r.y + window.scrollY - 10), width: r.width, height: r.height + 20 };
  }) }).catch(() => {});
  // Duplicidade: remover um envolvido e tentar escolher alguém que já é da equipe.
  await page.locator("#teamSlotsEnvolvidos .team-slot.filled .team-slot-remove").first().click();
  const antes = await page.locator("#teamSlotsEnvolvidos .team-slot.filled").count();
  await page.evaluate(() => document.getElementById("teamSlotsEnvolvidos").__preencher({ ID_USUARIO: 201, NM_USUARIO: "A PESSOA 1" }));
  ok("pessoa da equipe não entra como envolvida", (await page.locator("#teamSlotsEnvolvidos .team-slot.filled").count()) === antes);
  await page.click("#toggleEnvolvidos");
  await page.waitForTimeout(50);
  ok("desligar esvazia os envolvidos", (await page.locator("#teamSlotsEnvolvidos .team-slot.filled").count()) === 0);
  ok("equipe não muda ao desligar (continua Líder + 2)", await page.locator("#buscaMembroVale").isDisabled());

  console.log("\n=== Tela: ajuda por campo ===");
  const chaves = await page.evaluate(() => Object.keys(window.VBMAjudaCampos.textos));
  const botoes = await page.locator(".campo-ajuda").evaluateAll((bs) => bs.map((b) => b.dataset.ajuda));
  ok("um botão de ajuda por campo da planilha", chaves.every((c) => botoes.includes(c)), chaves.filter((c) => !botoes.includes(c)).join(","));
  const bProb = page.locator('.campo-ajuda[data-ajuda="f.problemDescription"]');
  await bProb.click();
  const pop = page.locator("#campoAjudaPop");
  ok("abre o pop-up com o título do campo", (await pop.evaluate((e) => e.classList.contains("open"))) && /Descrição do Problema/.test(await pop.locator(".cap-titulo").textContent()));
  ok("dicas viram lista e exemplo fica destacado", (await pop.locator(".cap-lista li").count()) === 5 && /britagem primária/.test(await pop.locator(".cap-exemplo").textContent()));
  ok("clicar no i não foca o campo", await page.evaluate(() => document.activeElement.id !== "declaracao_problema"));
  await page.screenshot({ path: path.join(SHOTS, "ajuda-problema.png") });
  await page.keyboard.press("Escape");
  ok("Esc fecha", !(await pop.evaluate((e) => e.classList.contains("open"))));
  await page.locator('.campo-ajuda[data-ajuda="f.kaizenType"]').click();
  ok("Tipo de Kaizen mostra as 3 definições", (await pop.locator(".cap-def").count()) === 3);
  await page.mouse.click(5, 300);
  ok("clique fora fecha", !(await pop.evaluate((e) => e.classList.contains("open"))));
  await page.locator('.campo-ajuda[data-ajuda="f.involvedMembers"]').click();
  ok("ajuda do toggle não liga/desliga o bloco", !(await page.locator("#toggleEnvolvidos").evaluate((e) => e.classList.contains("on"))));
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const s = document.getElementById("langSelect"); if (s) { s.value = "en"; s.dispatchEvent(new Event("change")); } });
  await page.waitForTimeout(150);
  await page.locator('.campo-ajuda[data-ajuda="f.goalObjective"]').click();
  ok("inglês: texto e rótulo do exemplo traduzidos", /SMART goal framework/.test(await pop.textContent()) && /Example/.test(await pop.locator(".cap-exemplo-rot").textContent()));
  ok("inglês: título segue o rótulo", /Goal/.test(await pop.locator(".cap-titulo").textContent()), await pop.locator(".cap-titulo").textContent());
  await page.screenshot({ path: path.join(SHOTS, "ajuda-meta-en.png") });
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const s = document.getElementById("langSelect"); if (s) { s.value = "pt-BR"; s.dispatchEvent(new Event("change")); } });
  ok("sem erro de JavaScript", errosJs.length === 0, errosJs.join(" | "));

  console.log("\n=== Tela: Novo Kaizen sem a tabela ===");
  await parar(srv);
  srv = await subir();
  await page.goto(BASE + "/kaizen-novo.html", { waitUntil: "networkidle" });
  ok("bloco de envolvidos escondido", await page.locator("#blocoEnvolvidos").isHidden());

  console.log("\n=== Tela: Biblioteca (drill-down) ===");
  await page.goto(BASE + "/biblioteca.html", { waitUntil: "networkidle" });
  const trig = page.locator("#bibFiltroHierarquia .ms-filter-trigger");
  ok("gatilho mostra 'Toda a hierarquia'", /Toda a hierarquia/.test(await trig.textContent()));
  await trig.click();
  await page.locator("#bibFiltroHierarquia .hier-opcao").first().waitFor();
  ok("painel lista o nível COO", /COO/.test(await page.textContent("#bibFiltroHierarquia .hier-nivel")));
  let req = page.waitForRequest((q) => /\/api\/kaizens\?/.test(q.url()) && /n3=/.test(q.url()));
  await page.locator("#bibFiltroHierarquia .hier-opcao").first().click();
  ok("escolher COO recarrega a lista com n3", !!(await req));
  await page.waitForFunction(() => /Diretoria/.test(document.querySelector("#bibFiltroHierarquia .hier-nivel").textContent));
  await page.locator("#bibFiltroHierarquia .hier-opcao").first().waitFor();
  req = page.waitForRequest((q) => /\/api\/kaizens\?/.test(q.url()) && /n4=/.test(q.url()));
  await page.locator("#bibFiltroHierarquia .hier-opcao").first().click();
  const u = new URL((await req).url());
  ok("2º clique manda n3 + n4", u.searchParams.get("n3") === COO && !!u.searchParams.get("n4"));
  await page.waitForFunction(() => /Head/.test(document.querySelector("#bibFiltroHierarquia .hier-nivel").textContent));
  ok("trilha mostra 3 passos (Todas › COO › Dir)", (await page.locator("#bibFiltroHierarquia .hier-passo").count()) === 3);
  await page.locator("#bibFiltroHierarquia .hier-opcao").first().waitFor();
  await page.screenshot({ path: path.join(SHOTS, "pnr28-drilldown.png") });
  req = page.waitForRequest((q) => /\/api\/kaizens\?/.test(q.url()) && /n3=/.test(q.url()) && !/n4=/.test(q.url()));
  await page.locator("#bibFiltroHierarquia .hier-passo").nth(1).click();
  ok("voltar pela trilha tira o N4", !!(await req));
  await page.keyboard.press("Escape");
  ok("gatilho fica ativo com o nível escolhido", await trig.evaluate((el) => el.classList.contains("ms-filter-ativo")));
  req = page.waitForRequest((q) => /\/api\/kaizens\?/.test(q.url()) && !/n3=/.test(q.url()));
  await page.click("#bibLimparFiltros");
  ok("Limpar filtros zera a hierarquia", !!(await req) && /Toda a hierarquia/.test(await trig.textContent()));
  await page.evaluate(() => { const s = document.getElementById("langSelect"); if (s) { s.value = "en"; s.dispatchEvent(new Event("change")); } });
  await page.waitForTimeout(200);
  ok("inglês: 'Whole hierarchy'", /Whole hierarchy/.test(await trig.textContent()), await trig.textContent());
  await page.evaluate(() => { const s = document.getElementById("langSelect"); if (s) { s.value = "pt-BR"; s.dispatchEvent(new Event("change")); } });
  ok("sem erro de JavaScript", errosJs.length === 0, errosJs.join(" | "));

  await browser.close();
  await parar(srv);
  console.log(`\n${passou} ok, ${falhou} falha(s)`);
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
