/**
 * ITEM 1 — o "X" de fechar no tema escuro.
 *
 * Não confio em ler cor computada e compor alfa na mão: foi assim que
 * o defeito passou batido (a pílula vinha do tema claro e o glifo do
 * escuro, e cada regra, lida isolada, parecia correta). Aqui o teste
 * FOTOGRAFA o botão e lê os pixels: se o X está apagado, o recorte sai
 * quase liso. É a mesma coisa que o olho do usuário faz no print.
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const BASE = "http://127.0.0.1:3995";
const TELAS = ["index.html", "kaizen-novo.html", "aprovacao.html", "biblioteca.html", "admin.html"];
let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

const MIN_CONTRASTE = 4.5; // AA para ícone/texto pequeno

(async () => {
  const nav = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2,
    extraHTTPHeaders: { "X-Forwarded-Email": "admin@vale.com" } });
  const p = await ctx.newPage();
  // Página auxiliar só para decodificar PNG em pixels.
  const lupa = await ctx.newPage();
  await lupa.goto("about:blank");

  async function contrasteDoRecorte(png) {
    return lupa.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext("2d");
      cx.drawImage(img, 0, 0);
      // Descarta 18% de moldura: o canto arredondado deixa ver o
      // cartão atrás e falsearia o extremo escuro.
      const m = Math.round(Math.min(cv.width, cv.height) * 0.18);
      const d = cx.getImageData(m, m, cv.width - 2 * m, cv.height - 2 * m).data;
      const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      let claro = -1, escuro = 2;
      const L = [];
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * canal(d[i]) + 0.7152 * canal(d[i + 1]) + 0.0722 * canal(d[i + 2]);
        L.push(l);
      }
      // O glifo ocupa POUCOS pixels do recorte (um "x" de 1.6px de
      // traço dentro de uma pílula de 32px). Percentil 5/95 caía todo
      // dentro da pílula e devolvia "contraste" onde não havia glifo
      // nenhum — media a pílula contra ela mesma. O que interessa é o
      // extremo do glifo contra a MEDIANA, que é a pílula.
      L.sort((a, b2) => a - b2);
      const pct = (q) => L[Math.min(L.length - 1, Math.floor(L.length * q))];
      const pilula = pct(0.5), alto = pct(0.995), baixo = pct(0.005);
      const c = (a, b2) => (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05);
      return +Math.max(c(alto, pilula), c(pilula, baixo)).toFixed(2);
    }, png.toString("base64"));
  }

  for (const tela of TELAS) {
    console.log("\n──── " + tela);
    await p.goto(BASE + "/" + tela, { waitUntil: "networkidle" });
    await p.waitForTimeout(500);
    await p.evaluate(() => document.body.setAttribute("data-bg", "dark"));

    // 1) Cartão de runtime (o do print: "E-mail não enviado").
    const criou = await p.evaluate(() => {
      if (typeof window.showToast !== "function") return false;
      window.showToast("error", "E-mail não enviado", "Verifique o destinatário.", 999999);
      return true;
    });
    await p.waitForTimeout(450);
    if (criou) {
      const bt = p.locator('#avisoApp [data-role="fechar"]');
      const c = await contrasteDoRecorte(await bt.screenshot());
      ok("aviso (showToast): o X se destaca da pílula", c >= MIN_CONTRASTE, c + ":1");
    } else {
      ok("aviso (showToast) existe nesta tela", false);
    }

    // 2) Painel de configurações — o outro botão de fechar de toda tela.
    // Fecha o aviso antes: ele é um overlay com backdrop-filter por
    // cima de tudo, e a foto do botão do painel saía borrada e
    // escurecida POR ELE — o recorte vinha liso e acusava defeito onde
    // não havia. O que a foto mede é o que está na tela, inclusive o
    // que está na frente.
    await p.evaluate(() => {
      const a = document.getElementById("avisoApp");
      if (a) a.classList.remove("open", "closing");
    });
    // Abre como o usuário abre (classe .open no painel E no backdrop) e
    // espera a transição terminar: forçar transform/opacity no estilo
    // inline fotografava o painel a meio caminho e o recorte saía liso,
    // acusando defeito onde não havia.
    await p.evaluate(() => {
      const pn = document.querySelector(".settings-panel");
      if (pn) pn.classList.add("open");
      const bd = document.querySelector(".settings-backdrop");
      if (bd) bd.classList.add("open");
    });
    await p.waitForTimeout(700);
    const sc = p.locator("#settingsClose");
    if (await sc.count()) {
      const c = await contrasteDoRecorte(await sc.screenshot());
      ok("painel de configurações: o X se destaca", c >= MIN_CONTRASTE, c + ":1");
    }
  }

  // 3) Modais fixos no HTML — admin tem a maior coleção deles.
  console.log("\n──── modais fixos (admin.html)");
  await p.goto(BASE + "/admin.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  await p.evaluate(() => document.body.setAttribute("data-bg", "dark"));
  const ids = await p.evaluate(() =>
    Array.from(document.querySelectorAll(".modal-backdrop")).map((m) => m.id).filter(Boolean).slice(0, 4));
  for (const id of ids) {
    await p.evaluate((i) => document.getElementById(i).classList.add("open"), id);
    await p.waitForTimeout(600); // o scaleIn do modal dura .32s
    const bt = p.locator("#" + id + " .modal-close").first();
    if (await bt.count()) {
      const c = await contrasteDoRecorte(await bt.screenshot());
      ok(id + ": o X se destaca", c >= MIN_CONTRASTE, c + ":1");
    }
    await p.evaluate((i) => document.getElementById(i).classList.remove("open"), id);
  }

  // 4) Regressão: o tema CLARO não pode ter piorado.
  console.log("\n──── tema claro (regressão)");
  await p.goto(BASE + "/kaizen-novo.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    document.body.setAttribute("data-bg", "light");
    window.showToast("info", "Aviso", "Teste.", 999999);
  });
  await p.waitForTimeout(450);
  const claro = await contrasteDoRecorte(await p.locator('#avisoApp [data-role="fechar"]').screenshot());
  ok("tema claro segue legível", claro >= 3, claro + ":1");

  await nav.close();
  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})();
