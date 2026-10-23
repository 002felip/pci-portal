/**
 * Impressão do Kaizen (js/impressao-kaizen.js) + equipe no modal da
 * Biblioteca. Sobe o servidor na porta 4004 com o dublê do Dashboard e
 * intercepta no navegador o detalhe do Kaizen, o catálogo de resultados
 * e as fotos (o dublê não tem esses dados).
 *
 * Cobre:
 *  - modal da Biblioteca: seção "Equipe do Kaizen" (líder, equipe com
 *    Vale/Terceiro, 5 membros envolvidos, total de pessoas)
 *  - diálogo de impressão do app: padrão A4 horizontal, troca de papel e
 *    orientação, prévia no tamanho certo, preferência lembrada
 *  - folha no formato do template (Antes/Depois, Unidade de Negócio,
 *    problema/solução/benefícios, checklist de resultados, equipe)
 *  - "Baixar PDF": arquivo gerado no app, no papel/orientação escolhidos
 *  - "Imprimir": janela com @page no papel/orientação escolhidos
 *  - inglês
 *
 * Capturas em DASH_SHOTS (padrão tests/.shots/).
 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const APP = path.join(__dirname, "..");
const PORTA = 4004;
const BASE = `http://127.0.0.1:${PORTA}`;
const SHOTS = process.env.DASH_SHOTS || path.join(__dirname, ".shots");
fs.mkdirSync(SHOTS, { recursive: true });

let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

const KZ = {
  ID_KAIZEN: 9000, ROTULO: "KZN26-9000", NM_KAIZEN: "Lona de contenção na galeria do transportador", NM_STATUS: "Aprovado",
  DT_CRIACAO: "2026-08-10T10:00:00", DT_CONCLUSAO: "2026-08-15T00:00:00", NM_CATEGORIA: "Meio ambiente",
  NM_SITE: "SALOBO", NM_LIDER: "Victoria Anne Davis",
  DS_PROBLEMA: "O concentrado cai no chão durante a troca dos painéis da galeria.",
  DS_OBJETIVO: "Zerar a contaminação do solo até dezembro de 2026.",
  DS_ESTADO_ANTES: "Limpeza manual demorada após cada troca.",
  DS_ESTADO_DEPOIS: "Lona de contenção instalada; o material é recolhido de uma vez.",
  DS_RESULTADO_ALCANCADO: "Sem contaminação do solo e limpeza mais rápida.",
  DS_RESULTADO_ESPERADO: "Meta atingida.", VL_RESULTADO_FINANCEIRO: 18500, SG_MOEDA: "USD",
  URL_IMG_ANTES: "01 - Antes/9000.jpg", URL_IMG_DEPOIS: "02 - Depois/9000.jpg",
  MEMBROS: [{ NM_USUARIO: "Carlos Eduardo Lima", ID_TIPO_USUARIO: 1, NM_POSICAO: "Técnico" },
            { NM_USUARIO: "Paulo Reid", ID_TIPO_USUARIO: 2, NM_POSICAO: "Supervisor (SOMAR)" }],
  ENVOLVIDOS: ["Ana Souza", "Bruno Rocha", "Liam Walsh", "Mariana Costa", "Olivia Murphy"]
    .map((n, i) => ({ NM_USUARIO: n, ID_TIPO_USUARIO: i % 2 ? 2 : 1 })),
  DESPERDICIOS: ["Transporte"], RESULTADOS: [{ ID_RESULTADO: 7, NM_RESULTADO: "Sustentabilidade" }],
};
const CAT = ["Savings", "Saúde & Segurança", "Produção", "Tempo", "Consumo", "Meio ambiente", "Sustentabilidade", "Custo evitado"]
  .map((n, i) => ({ ID: i + 1, NM: n, ATIVO: true }));
const FOTO = fs.readFileSync(path.join(APP, "assets/images/Fundo_VBM_2400x1145.webp"));

function subir() {
  const env = Object.assign({}, process.env, {
    AZURE_SQL_SERVER: "teste.database.windows.net", KAIZEN_AZURE_SQL_DATABASE: "TESTE",
    AZURE_SQL_SCHEMA: "ci", AZURE_SQL_TABLE: "kzn_aprovador", AZURE_SQL_USER: "teste", AZURE_SQL_PASSWORD: "teste",
    PORT: String(PORTA), FAKE_MSSQL_LOG: path.join(__dirname, ".impressao-sql.jsonl"),
  });
  const proc = spawn(process.execPath, ["-r", path.join(__dirname, "preload-dashboard.js"), "server.js"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  proc.stdout.on("data", (d) => { saida += d; });
  proc.stderr.on("data", (d) => { saida += d; });
  return new Promise((res) => {
    const t = setInterval(() => { if (/servidor rodando/.test(saida)) { clearInterval(t); res(proc); } }, 100);
  });
}
const pdfTamanho = (buf) => {
  const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(buf.toString("latin1"));
  return m ? [Math.round(parseFloat(m[1]) / 72 * 25.4), Math.round(parseFloat(m[2]) / 72 * 25.4)] : null;
};

(async () => {
  const proc = await subir();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-Email": "membro@vale.com" }, viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/\/api\/kaizens\/9000(\?|$)/, (r) => r.fulfill({ json: KZ }));
  await ctx.route(/\/api\/resultados/, (r) => r.fulfill({ json: CAT }));
  await ctx.route(/\/api\/kaizens\/imagem/, (r) => r.fulfill({ body: FOTO, contentType: "image/webp" }));
  const page = await ctx.newPage();
  const erros = [];
  page.on("pageerror", (e) => erros.push(e.message));
  await page.goto(BASE + "/biblioteca.html", { waitUntil: "networkidle" });

  console.log("=== Biblioteca: equipe no modal ===");
  // Mesmo caminho do botão "Visualizar" do card: [data-ver-detalhe].
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.dataset.verDetalhe = "9000";
    document.body.appendChild(b);
    b.click();
    b.remove();
  });
  await page.waitForSelector("#modalBibDetail.open", { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll("#bibModalEquipe .kd-pessoa").length > 0);
  ok("líder aparece no grupo Líder", /Victoria Anne Davis/.test(await page.textContent("#bibModalEquipe .kd-pessoa-lider")));
  ok("equipe com 2 pessoas (2/2)", (await page.locator("#bibModalEquipe .kd-equipe-grupo").nth(1).locator(".kd-pessoa").count()) === 2 &&
    /2\/2/.test(await page.locator("#bibModalEquipe .kd-equipe-grupo").nth(1).textContent()));
  ok("terceiros marcados (1 na equipe, 2 envolvidos)", (await page.locator("#bibModalEquipe .kd-equipe-grupo").nth(1).locator(".kd-pessoa-ext").count()) === 1 &&
    (await page.locator("#bibModalEquipe .kd-equipe-grupo").nth(2).locator(".kd-pessoa-ext").count()) === 2);
  ok("5 membros envolvidos (5/5)", (await page.locator("#bibModalEquipe .kd-pessoa-env").count()) === 5 &&
    /5\/5/.test(await page.locator("#bibModalEquipe .kd-equipe-grupo").nth(2).textContent()));
  ok("total: 8 pessoas", /8 pessoas/.test(await page.textContent("#bibModalEquipeTotal")));
  await page.locator("#bibModalEquipeWrap").screenshot({ path: path.join(SHOTS, "bib-equipe.png") });

  console.log("\n=== Diálogo de impressão ===");
  await page.evaluate(() => localStorage.removeItem("vbm-impressao-kaizen"));
  await page.click("#bibModalImprimir");
  await page.waitForSelector("#modalImpressaoKaizen.open");
  ok("padrão: A4 horizontal", (await page.getAttribute('[data-papel="A4"]', "aria-pressed")) === "true" &&
    (await page.getAttribute('[data-ori="paisagem"]', "aria-pressed")) === "true");
  ok("tamanho informado 297 × 210 mm", /297 × 210 mm/.test(await page.textContent("#impTamanho")));
  const prev = page.frameLocator("#impPrev");
  await prev.locator(".pg").waitFor();
  ok("prévia no formato do template", (await prev.locator(".bar-g").allTextContents()).join("|") === "Antes|Depois" &&
    /Unidade de Negócio: SALOBO/.test(await prev.locator(".bar-bu").textContent()));
  ok("perguntas do template", (await prev.locator(".bar-m").allTextContents()).join("|") === "Qual era o problema?|Qual foi a solução?|Quais são os benefícios?");
  ok("checklist: catálogo inteiro, 1 marcado", (await prev.locator(".res li").count()) === 8 && (await prev.locator(".res li.on").count()) === 1);
  ok("fotos da equipe: líder + 2", (await prev.locator(".pes").count()) === 3 && (await prev.locator(".pes.lider").count()) === 1);
  ok("membros envolvidos listados", /Olivia Murphy/.test(await prev.locator(".env").textContent()));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, "imp-dialogo.png") });

  await page.click('[data-papel="A3"]');
  await page.click('[data-ori="retrato"]');
  ok("A3 vertical: 297 × 420 mm", /297 × 420 mm/.test(await page.textContent("#impTamanho")));
  ok("folha da prévia em 297mm × 420mm", await prev.locator(".pg").evaluate((e) => e.style.width === "" && /297mm/.test(document.querySelector("style").textContent) && /420mm/.test(document.querySelector("style").textContent)));
  ok("preferência guardada", JSON.parse(await page.evaluate(() => localStorage.getItem("vbm-impressao-kaizen"))).papel === "A3");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, "imp-dialogo-a3v.png") });

  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.click('[data-imp="pdf"]')]);
  const arq = path.join(SHOTS, "kaizen.pdf");
  await dl.saveAs(arq);
  const buf = fs.readFileSync(arq);
  ok("PDF gerado no app", buf.slice(0, 5).toString() === "%PDF-" && /KZN26-9000/.test(dl.suggestedFilename()), dl.suggestedFilename());
  ok("PDF em A3 vertical", JSON.stringify(pdfTamanho(buf)) === "[297,420]", JSON.stringify(pdfTamanho(buf)));

  await page.click('[data-papel="A2"]');
  await page.click('[data-ori="paisagem"]');
  const [pop] = await Promise.all([ctx.waitForEvent("page"), page.click('[data-imp="imprimir"]')]);
  await pop.waitForLoadState();
  ok("Imprimir: @page A2 horizontal (594 × 420 mm)", /@page\{size:594mm 420mm;margin:0\}/.test(await pop.content()));
  ok("diálogo fecha ao imprimir", !(await page.locator("#modalImpressaoKaizen.open").count()));
  await pop.close();

  console.log("\n=== Inglês ===");
  await page.evaluate((k) => window.printKaizen(k, { idioma: "en", urlImagem: (c) => "/api/kaizens/imagem?path=" + encodeURIComponent(c) }), KZ);
  await page.waitForSelector("#modalImpressaoKaizen.open");
  ok("diálogo em inglês", /Print Kaizen/.test(await page.textContent("#impTitulo")) && /Landscape/.test(await page.textContent('[data-ori="paisagem"]')));
  ok("folha em inglês", /What was the problem\?/.test(await prev.locator(".centro").textContent()) && /Business Unit/.test(await prev.locator(".bar-bu").textContent()));
  ok("lembrou A2 horizontal", (await page.getAttribute('[data-papel="A2"]', "aria-pressed")) === "true");
  await page.keyboard.press("Escape");
  ok("Esc fecha só o diálogo (modal do Kaizen continua aberto)", !(await page.locator("#modalImpressaoKaizen.open").count()) &&
    (await page.locator("#modalBibDetail.open").count()) === 1);
  ok("sem erro de JavaScript", erros.length === 0, erros.join(" | "));

  await browser.close();
  proc.kill();
  console.log(`\n${passou} ok, ${falhou} falha(s)`);
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
