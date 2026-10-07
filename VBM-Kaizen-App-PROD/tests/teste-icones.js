/**
 * ITEM 3 — o ícone que não aparecia, e a rede para ele não voltar.
 *
 * O projeto serve um SUBCONJUNTO do Font Awesome (70 ícones, embutidos
 * em css/fontawesome-subset.css). Uma classe fa-* de fora do
 * subconjunto não dá erro, não some do HTML e não aparece no console:
 * rende um quadradinho vazio. Foi assim que fa-image ficou no cabeçalho
 * do modal "Visualizar" sem ninguém notar até virar print.
 *
 * Duas travas:
 *   A) varredura ESTÁTICA — toda classe fa-* escrita em html/js/css tem
 *      de existir no subconjunto;
 *   B) prova VIVA — o modal é aberto de verdade e o glifo é medido.
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const fs = require("fs"), path = require("path");
const RAIZ = path.join(__dirname, "..");
const BASE = "http://127.0.0.1:3994";
let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

console.log("\n=== A. Toda classe fa-* usada existe no subconjunto ===");
const sub = fs.readFileSync(path.join(RAIZ, "css/fontawesome-subset.css"), "utf8");
const disponiveis = new Set((sub.match(/\.(fa-[a-z0-9-]+):+before/g) || [])
  .map((s) => s.replace(/^\./, "").replace(/:+before$/, "")));
const arquivos = []
  .concat(fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html")).map((f) => f))
  .concat(fs.readdirSync(path.join(RAIZ, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f))
  .concat(fs.readdirSync(path.join(RAIZ, "css")).filter((f) => f.endsWith(".css")).map((f) => "css/" + f));
const usadas = new Map();
for (const rel of arquivos) {
  const t = fs.readFileSync(path.join(RAIZ, rel), "utf8");
  const re = /fa-(?:solid|regular|brands)\s+(fa-[a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(t))) {
    if (!usadas.has(m[1])) usadas.set(m[1], new Set());
    usadas.get(m[1]).add(rel);
  }
}
const ausentes = [...usadas.keys()].filter((k) => !disponiveis.has(k));
ok(`${usadas.size} classes usadas, ${disponiveis.size} no subconjunto`, true);
ok("nenhuma classe fora do subconjunto", ausentes.length === 0,
  ausentes.map((a) => a + " (" + [...usadas.get(a)].join(",") + ")").join(" | "));

(async () => {
  console.log("\n=== B. O modal 'Visualizar' mostra o ícone de verdade ===");
  const nav = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "X-Forwarded-Email": "admin@vale.com" } });
  const p = await ctx.newPage();
  await p.goto(BASE + "/kaizen-novo.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(700);

  for (const modo of ["light", "dark"]) {
    await p.evaluate((m) => {
      document.body.setAttribute("data-bg", m);
      document.getElementById("modalFotoAmpliada").classList.add("open");
    }, modo);
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const cab = document.querySelector("#modalFotoAmpliada .modal-head");
      const medir = (el) => {
        if (!el) return { classe: "(ausente)", largura: -1 };
        const c = el.getBoundingClientRect();
        return { classe: el.className, largura: Math.round(c.width),
                 conteudo: getComputedStyle(el, "::before").content };
      };
      return { badge: medir(cab.querySelector(".modal-icon i")),
               fechar: medir(cab.querySelector(".modal-close i")) };
    });
    ok(`tema ${modo}: o ícone do cabeçalho tem glifo`,
      r.badge.largura > 4 && r.badge.conteudo !== "none" && r.badge.conteudo !== '""',
      r.badge.classe + " largura=" + r.badge.largura + "px");
    ok(`tema ${modo}: o X de fechar tem glifo`,
      r.fechar.largura > 4 && r.fechar.conteudo !== "none" && r.fechar.conteudo !== '""',
      r.fechar.classe + " largura=" + r.fechar.largura + "px");
    await p.evaluate(() => document.getElementById("modalFotoAmpliada").classList.remove("open"));
  }

  await nav.close();
  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})();
