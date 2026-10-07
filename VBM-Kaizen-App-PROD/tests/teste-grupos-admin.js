/**
 * ATIVIDADE 2 — Aprovadores agrupados por unidade na Administração.
 *
 * Três coisas precisam ser verdade ao mesmo tempo: os grupos aparecem na
 * ordem certa com a contagem certa, os CARDS não mudaram, e a tela não
 * passou a fazer uma consulta por grupo. O teste mede as três — a
 * terceira contando os pedidos de rede, não lendo o código.
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const BASE = "http://127.0.0.1:3997";
let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

(async () => {
  const nav = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await nav.newContext({ viewport: { width: 1400, height: 950 }, deviceScaleFactor: 2,
    extraHTTPHeaders: { "X-Forwarded-Email": "cristian.alves@vale.com" } });
  const p = await ctx.newPage();
  const erros = [], chamadas = [];
  p.on("pageerror", (e) => erros.push(e.message));
  p.on("request", (r) => { if (r.url().indexOf("/api/aprovadores") !== -1) chamadas.push(r.url()); });
  const trocarIdioma = (lang) => p.$eval("#langSelect", (el, l) => {
    el.value = l; el.dispatchEvent(new Event("change", { bubbles: true }));
  }, lang);


  await p.goto(BASE + "/admin.html", { waitUntil: "networkidle" });
  await p.waitForSelector(".admin-grupo", { timeout: 8000 });
  await p.waitForTimeout(400);

  console.log("\n=== A. Grupos, ordem e contagem ===");
  const grupos = await p.$$eval(".admin-grupo", (gs) => gs.map((g) => ({
    site: g.querySelector(".admin-grupo-nome").textContent.trim(),
    badge: g.querySelector(".admin-item-badge").textContent.trim(),
    cards: g.querySelectorAll(".admin-item").length,
    grade: !!g.querySelector(".admin-list"),
  })));
  grupos.forEach((g) => console.log("      " + g.site.padEnd(16) + g.badge.padEnd(18) + g.cards + " cards"));

  ok("um grupo por unidade (3 + os sem unidade)", grupos.length === 4, grupos.length + " grupos");
  ok("ordem alfabética das unidades",
    grupos.slice(0, 3).map((g) => g.site).join(",") === "CORPORATIVO,SALOBO,SOSSEGO",
    grupos.map((g) => g.site).join(","));
  ok("quem não tem unidade fica por último",
    /sem unidade/i.test(grupos[3].site), grupos[3].site);
  ok("a contagem bate com os cards de cada grupo",
    grupos.every((g) => g.badge.indexOf(String(g.cards)) === 0), grupos.map((g) => g.badge).join(" | "));
  ok("CORPORATIVO tem 3, SALOBO 2, SOSSEGO 2",
    grupos[0].cards === 3 && grupos[1].cards === 2 && grupos[2].cards === 2,
    grupos.map((g) => g.cards).join(","));
  ok("a soma dos grupos é o total do cabeçalho",
    grupos.reduce((s, g) => s + g.cards, 0) === 8 &&
    /^8 /.test(await p.textContent("#aprovadoresCount")),
    await p.textContent("#aprovadoresCount"));
  ok("cada grupo usa a .admin-list de sempre", grupos.every((g) => g.grade));

  console.log("\n=== B. O card não mudou ===");
  const card = await p.$eval(".admin-item", (el) => ({
    classe: el.className,
    partes: [".admin-avatar", ".admin-item-body", ".admin-item-name", ".admin-item-sub",
             '[data-action="editar"]', '[data-action="status"]'].map((s) => !!el.querySelector(s) || el.matches(s)),
    display: getComputedStyle(el).display,
  }));
  ok("continua sendo .admin-item", /admin-item/.test(card.classe), card.classe);
  ok("avatar, corpo, nome, subtítulo e as 2 ações seguem lá",
    card.partes.every(Boolean), JSON.stringify(card.partes));
  ok("continua flex", card.display === "flex", card.display);

  console.log("\n=== C. Uma consulta só ===");
  ok("nenhum pedido por card ou por grupo", chamadas.length === 1, chamadas.length + " pedido(s)");
  ok("e sem ?lider= (a Administração vê todos)",
    chamadas.every((u) => u.indexOf("lider=") === -1), chamadas.join(" , "));

  console.log("\n=== D. Responsividade ===");
  // A responsividade do layout mora em conf-masonry.js, que roda sobre
  // 50 aprovadores em 6 unidades de tamanhos bem diferentes. Aqui são 8
  // em 4 grupos minúsculos: qualquer limiar de largura passaria por
  // acidente, e o teste afirmaria mais do que mediu. O que fica aqui é
  // o que ESTE fixture consegue provar — que nada transborda.
  for (const [nome, largura] of [["desktop", 1400], ["notebook", 1100], ["tablet", 820], ["celular", 390]]) {
    await p.setViewportSize({ width: largura, height: 950 });
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const gs = [...document.querySelectorAll(".admin-grupo")];
      return { rolagem: document.documentElement.scrollWidth > document.documentElement.clientWidth,
               dentro: gs.every((g) => [...g.querySelectorAll(".admin-item")].every((c) =>
                 c.getBoundingClientRect().right <= g.getBoundingClientRect().right + 1)) };
    });
    ok(`${nome} (${largura}px): sem rolagem lateral e sem card fora do bloco`,
      !r.rolagem && r.dentro, JSON.stringify(r));
  }
  await p.setViewportSize({ width: 1400, height: 950 });

  console.log("\n=== E. Troca de idioma redesenha sem novo GET ===");
  const antes = chamadas.length;
  await trocarIdioma("en");
  await p.waitForTimeout(800);
  const badgeEn = await p.$eval(".admin-grupo .admin-item-badge", (e) => e.textContent.trim());
  const semSiteEn = await p.$$eval(".admin-grupo-nome", (ns) => ns[ns.length - 1].textContent.trim());
  ok("os rótulos mudaram de idioma", /approver/i.test(badgeEn), badgeEn);
  ok("'Sem unidade' também", /no site/i.test(semSiteEn), semSiteEn);
  ok("sem consulta adicional", chamadas.length === antes, (chamadas.length - antes) + " pedido(s) a mais");

  ok("nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));

  await trocarIdioma("pt-BR");
  await p.waitForTimeout(600);
  for (const modo of ["light", "dark"]) {
    await p.evaluate((m) => document.body.setAttribute("data-bg", m), modo);
    await p.waitForTimeout(400);
    await p.locator("#panel-aprovadores").screenshot({ path: `grupos-${modo}.png` });
  }

  await nav.close();
  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})();
