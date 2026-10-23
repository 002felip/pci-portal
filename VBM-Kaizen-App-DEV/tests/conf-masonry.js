/**
 * Aprovadores: blocos em multicol + 2 cards por linha.
 *
 * Roda sobre 50 aprovadores em 6 unidades MUITO desiguais (2 a 15) —
 * é a desigualdade que produzia o vazio do print. Com 2 e 3 por grupo,
 * "sobrou espaço" e "está certo" dariam a mesma tela.
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const BASE = "http://127.0.0.1:3999";
let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

const LER = () => {
  const gs = [...document.querySelectorAll(".admin-grupo")].map((g) => {
    const b = (e) => { const c = e.getBoundingClientRect();
      return { L: Math.round(c.left), R: Math.round(c.right), T: Math.round(c.top), B: Math.round(c.bottom) }; };
    const cab = g.querySelector(".admin-grupo-cab");
    return { site: g.querySelector(".admin-grupo-nome").textContent.trim(),
             n: g.querySelectorAll(".admin-item").length,
             badge: cab.querySelector(".admin-item-badge").textContent.trim(),
             bloco: b(g), cab: b(cab), badgeCaixa: b(cab.querySelector(".admin-item-badge")),
             cards: [...g.querySelectorAll(".admin-item")].map(b),
             trilhas: getComputedStyle(g.querySelector(".admin-list")).gridTemplateColumns.split(" ").length };
  });
  const colunas = {};
  gs.forEach((g) => { (colunas[g.bloco.L] = colunas[g.bloco.L] || []).push(g); });
  const cols = Object.keys(colunas).sort((a, b) => a - b).map((x) => {
    const col = colunas[x].sort((a, b) => a.bloco.T - b.bloco.T);
    let buraco = 0;
    col.forEach((g, i) => { if (i) { const s = g.bloco.T - col[i - 1].bloco.B; if (s > 40) buraco += s - 24; } });
    return { x: +x, sites: col.map((g) => `${g.site}(${g.n})`), fundo: col[col.length - 1].bloco.B, buraco };
  });
  return { gs, cols,
    buracoDentroDaColuna: cols.reduce((s, c) => s + c.buraco, 0),
    desequilibrio: cols.length > 1 ? Math.max(...cols.map((c) => c.fundo)) - Math.min(...cols.map((c) => c.fundo)) : 0,
    alturaDoPainel: Math.round(document.getElementById("panel-aprovadores").getBoundingClientRect().height),
    rolagem: document.documentElement.scrollWidth > document.documentElement.clientWidth };
};

// Quantos cards na PRIMEIRA linha de um bloco (mesmo topo).
const porLinha = (g) => g.cards.filter((c) => Math.abs(c.T - g.cards[0].T) <= 3).length;

(async () => {
  const nav = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await nav.newContext({ viewport: { width: 1880, height: 1000 }, deviceScaleFactor: 1,
    extraHTTPHeaders: { "X-Forwarded-Email": "x@vale.com" } });
  const p = await ctx.newPage();
  const erros = [], chamadas = [];
  p.on("pageerror", (e) => erros.push(e.message));
  p.on("request", (r) => { if (r.url().indexOf("/api/aprovadores") !== -1) chamadas.push(r.url()); });
  await p.goto(BASE + "/admin.html", { waitUntil: "networkidle" });
  await p.waitForSelector(".admin-grupo");
  await p.waitForTimeout(700);

  console.log("\n=== 1. Sem espaços vazios grandes ===");
  let r = await p.evaluate(LER);
  r.cols.forEach((c) => console.log("      coluna x=" + String(c.x).padEnd(5) + c.sites.join(" ")));
  ok("nenhum buraco entre blocos dentro de uma coluna",
    r.buracoDentroDaColuna === 0, r.buracoDentroDaColuna + "px");
  ok("o grupo pequeno não abre um vão embaixo dele",
    (() => { const m = r.gs.find((g) => g.n === 2); if (!m) return false;
      const col = r.cols.find((c) => c.x === m.bloco.L);
      const abaixo = r.gs.filter((g) => g.bloco.L === m.bloco.L && g.bloco.T > m.bloco.T)
        .sort((a, b) => a.bloco.T - b.bloco.T)[0];
      return !abaixo || abaixo.bloco.T - m.bloco.B <= 40; })(),
    "MANITOBA(2)");
  ok("nenhum bloco foi partido entre colunas",
    r.gs.every((g) => g.cards.every((c) => c.L >= g.bloco.L - 1 && c.R <= g.bloco.R + 1)));
  ok("altura do painel abaixo de 2200px (era 3539 antes)",
    r.alturaDoPainel < 2200, r.alturaDoPainel + "px");

  console.log("\n=== 2. Dois aprovadores por linha ===");
  ok("toda grade de cards tem 2 trilhas", r.gs.every((g) => g.trilhas === 2),
    r.gs.map((g) => g.site + ":" + g.trilhas).join(" "));
  ok("a primeira linha de cada bloco traz 2 cards",
    r.gs.every((g) => porLinha(g) === Math.min(2, g.n)),
    r.gs.map((g) => `${g.site}:${porLinha(g)}`).join(" "));
  ok("os 2 cards da linha têm a mesma largura",
    r.gs.every((g) => g.n < 2 || Math.abs((g.cards[0].R - g.cards[0].L) - (g.cards[1].R - g.cards[1].L)) <= 1));
  ok("os cards casam com o cabeçalho nas duas bordas",
    r.gs.every((g) => Math.abs(g.cards[0].L - g.cab.L) <= 1 &&
                      Math.abs(Math.max(...g.cards.map((c) => c.R)) - g.cab.R) <= 1));

  console.log("\n=== 3. Quantidade ímpar ===");
  const impares = r.gs.filter((g) => g.n % 2 === 1);
  ok("há grupo ímpar para testar", impares.length > 0, impares.map((g) => `${g.site}(${g.n})`).join(" "));
  ok("o último card fica à ESQUERDA, na primeira trilha",
    impares.every((g) => { const u = g.cards[g.cards.length - 1]; return Math.abs(u.L - g.cab.L) <= 1; }),
    impares.map((g) => `${g.site}: ultimo em x=${g.cards[g.cards.length - 1].L} (cab ${g.cab.L})`).join(" | "));
  ok("o último card NÃO estica para a linha inteira",
    impares.every((g) => { const u = g.cards[g.cards.length - 1];
      return (u.R - u.L) <= (g.cards[0].R - g.cards[0].L) + 1 && u.R < g.cab.R - 40; }),
    impares.map((g) => `${g.site}: ${g.cards[g.cards.length-1].R - g.cards[g.cards.length-1].L}px`).join(" | "));
  ok("nenhum card vazio ou placeholder",
    r.gs.every((g) => g.n === g.cards.length) &&
    (await p.$$eval(".admin-item", (is) => is.every((i) => i.textContent.trim().length > 0))));

  ok("blocos não se sobrepõem",
    r.gs.every((a, i) => r.gs.every((b, j) => i >= j ||
      a.bloco.R <= b.bloco.L + 1 || b.bloco.R <= a.bloco.L + 1 ||
      a.bloco.B <= b.bloco.T + 1 || b.bloco.B <= a.bloco.T + 1)));
  ok("a contagem no canto direito de cada bloco",
    r.gs.every((g) => g.cab.R - g.badgeCaixa.R <= 16 && g.badgeCaixa.R <= g.cab.R),
    r.gs.map((g) => `${g.site}: ${g.cab.R - g.badgeCaixa.R}px`).join(" | "));

  console.log("\n=== 4. Responsividade ===");
  // Limiares MEDIDOS, não escolhidos: a coluna de blocos só se divide
  // quando cabem dois cards confortáveis (780px), e dentro do bloco só
  // há duas trilhas quando cada card fica acima de 370px.
  for (const [nome, largura, blocos, cards] of
       [["desktop grande", 1880, 2, 2], ["notebook", 1440, 1, 2], ["tablet", 900, 1, 2], ["celular", 390, 1, 1]]) {
    await p.setViewportSize({ width: largura, height: 1000 });
    await p.waitForTimeout(450);
    const v = await p.evaluate(LER);
    // columnCount devolve o DECLARADO (2); o usado se conta pelas
    // posições x distintas dos blocos.
    const cols = new Set(v.gs.map((g) => g.bloco.L)).size;
    ok(`${nome} (${largura}px): ${blocos} coluna(s) de blocos`, cols === blocos, cols + "");
    ok(`${nome}: ${cards} card(s) por linha`,
      v.gs.every((g) => g.trilhas === cards), v.gs.map((g) => g.trilhas).join(","));
    ok(`${nome}: sem rolagem lateral e sem card fora do bloco`,
      !v.rolagem && v.gs.every((g) => g.cards.every((c) => c.R <= g.bloco.R + 1)));
  }
  await p.setViewportSize({ width: 1880, height: 1000 });
  await p.waitForTimeout(400);

  console.log("\n=== 5. Agrupamento e contagem preservados ===");
  r = await p.evaluate(LER);
  ok("6 unidades, na ordem alfabética",
    r.gs.map((g) => g.site).join(",") === "CORPORATIVO,MANITOBA,ONTARIO,SALOBO,SOSSEGO,VNL",
    r.gs.map((g) => g.site).join(","));
  ok("a contagem de cada grupo bate com os cards",
    r.gs.every((g) => g.badge.indexOf(String(g.n)) === 0), r.gs.map((g) => g.badge).join(" | "));
  ok("a soma bate com o total do cabeçalho",
    r.gs.reduce((s, g) => s + g.n, 0) === 50 && /^50 /.test(await p.textContent("#aprovadoresCount")),
    await p.textContent("#aprovadoresCount"));

  console.log("\n=== 6. Performance e o card intacto ===");
  ok("uma consulta só, sem pedido por grupo ou por card", chamadas.length === 1, chamadas.length + " pedido(s)");
  const card = await p.$eval(".admin-item", (el) => ({ classe: el.className, display: getComputedStyle(el).display,
    partes: [".admin-avatar", ".admin-item-name", ".admin-item-sub",
             '[data-action="editar"]', '[data-action="status"]'].map((s) => !!el.querySelector(s)) }));
  ok("o card continua .admin-item, flex, com avatar, textos e as 2 ações",
    /admin-item/.test(card.classe) && card.display === "flex" && card.partes.every(Boolean),
    JSON.stringify(card));

  console.log("\n=== 7. Os dois temas ===");
  // Medido por PIXEL, não por cor computada: no escuro o card é
  // rgba(255,255,255,.05) e o cabeçalho pinta com gradiente — compor o
  // alfa na mão exige conhecer a base do tema, que também é gradiente,
  // e foi exatamente aí que a conta errou duas vezes. A foto já traz o
  // resultado da composição que o navegador fez.
  const lupa = await ctx.newPage();
  await lupa.goto("about:blank");
  const pixels = (png) => lupa.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = [];
    for (let i = 0; i < d.length; i += 4) L.push(0.2126*ch(d[i]) + 0.7152*ch(d[i+1]) + 0.0722*ch(d[i+2]));
    L.sort((a, b) => a - b);
    const pct = (q) => L[Math.min(L.length - 1, Math.floor(L.length * q))];
    const fundo = pct(0.5), alto = pct(0.99), baixo = pct(0.01);
    const c = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return { fundo: +fundo.toFixed(3), contraste: +Math.max(c(alto, fundo), c(fundo, baixo)).toFixed(2) };
  }, png.toString("base64"));

  for (const modo of ["light", "dark"]) {
    await p.evaluate((m) => document.body.setAttribute("data-bg", m), modo);
    await p.waitForTimeout(500);
    const card = await pixels(await p.locator(".admin-item").first().screenshot());
    const cab = await pixels(await p.locator(".admin-grupo-cab").first().screenshot());
    // Contraste do TEXTO se mede na caixa do texto. Na faixa inteira o
    // fundo domina e os glifos somem no percentil — foi por isso que
    // trocar #1a8bbf por #0d2640 mexeu de 2,2 para 2,53 e não para 10:
    // a conta olhava o cabeçalho, não a palavra.
    const nomeUnidade = await pixels(await p.locator(".admin-grupo-nome").first().screenshot());
    const nomeCard = await pixels(await p.locator(".admin-item-name").first().screenshot());
    ok(`${modo}: o card acompanha o tema`,
      modo === "dark" ? card.fundo < 0.2 : card.fundo > 0.6,
      `fundo do card = ${card.fundo}`);
    ok(`${modo}: o cabeçalho acompanha o tema`,
      modo === "dark" ? cab.fundo < 0.25 : cab.fundo > 0.6,
      `fundo do cabeçalho = ${cab.fundo}`);
    ok(`${modo}: o nome da unidade legível (>= 4.5:1)`,
      nomeUnidade.contraste >= 4.5, nomeUnidade.contraste + ":1");
    ok(`${modo}: o nome do aprovador legível (>= 4.5:1)`,
      nomeCard.contraste >= 4.5, nomeCard.contraste + ":1");
    await p.locator("#panel-aprovadores").screenshot({ path: `masonry-${modo}.png` });
  }

  ok("nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await nav.close();
  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})();
