/**
 * Varredura de TEMA em todos os modais de todas as telas.
 *
 * A pergunta não é "o modal da Aprovação ficou escuro?", e sim "sobrou
 * alguma superfície clara, ou algum texto ilegível, em QUALQUER popup do
 * sistema?". Por isso abre um por um, nos dois temas, e mede.
 *
 * Imagem é exceção declarada: <img>, <svg> e o que estiver dentro deles
 * não entram na conta — o enunciado pede para não tocar em imagem.
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const { servir } = require("./kaizen-fixture.js");
const BASE = "http://127.0.0.1:3998";
let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

/* Dívida ANTERIOR a esta correção, no tema CLARO. Não entra como falha
   porque não é desta mudança (tudo que acrescentei está sob
   [data-bg="dark"], então o tema claro saiu igual) e porque o enunciado
   pede explicitamente "modo claro: manter o comportamento atual".

   "Solicitar alteração" e "Imprimir A4" são .btn-outline: azul da marca
   (#3cb5e5) sobre branco, 2,18:1. Medido também FORA do modal, no
   painel — é o botão de contorno do sistema inteiro no tema claro, não
   um defeito do popup. Mexer nele mudaria o botão de todas as telas.

   Ficam LISTADOS, e não escondidos: baixar o limiar para 2:1 calaria
   junto qualquer regressão nova. */
const DIVIDA_CLARO = ["Imprimir A4", "Solicitar alteração", "Solicitar alteracao"];
const conhecido = (txt) => DIVIDA_CLARO.some((d) => (txt || "").indexOf(d) !== -1);

const MEDIDOR = () => {
  const num = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
  const sobre = (c, f) => { const a = c.length > 3 ? c[3] : 1; return [0,1,2].map(i => c[i]*a + f[i]*(1-a)); };
  const canal = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
  const lum = (c) => 0.2126*canal(c[0]) + 0.7152*canal(c[1]) + 0.0722*canal(c[2]);
  window.__medir = function (raiz, escuro) {
    const base = escuro ? [11, 22, 32] : [255, 255, 255];
    function fundoDe(el) {
      const cadeia = [];
      for (let n = el; n; n = n.parentElement) cadeia.unshift(n);
      let acc = base.slice();
      for (const n of cadeia) {
        const c = num(getComputedStyle(n).backgroundColor);
        if (c.length >= 3 && (c.length < 4 || c[3] > 0)) acc = sobre(c, acc);
      }
      return acc;
    }
    const superficies = [], textos = [];
    raiz.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      // <img> com object-fit:contain tem TARJA: a parte da caixa que a
      // imagem não preenche mostra o background do próprio <img>. Isso
      // é moldura, não imagem, e entra na conta. O resto do <img> —
      // filtro, opacidade, o conteúdo — segue fora, como manda o
      // enunciado.
      if (el.tagName === "IMG") {
        const cs = getComputedStyle(el);
        if (cs.objectFit !== "contain") return;
        const c = num(cs.backgroundColor);
        const op = c.length >= 3 && (c.length < 4 || c[3] > 0.5);
        const f = sobre(c, fundoDe(el.parentElement));
        if (op && ((escuro && lum(f) > 0.4) || (!escuro && lum(f) < 0.15))) {
          superficies.push({ id: "img (tarja do contain)", bg: cs.backgroundColor,
                             lum: +lum(f).toFixed(3), inline: "" });
        }
        return;
      }
      if (el.tagName === "SVG" || el.tagName === "PATH" || el.closest("img, svg")) return;
      const cs = getComputedStyle(el);
      // Elemento que se pinta com IMAGEM é imagem: o enunciado isenta
      // imagens, e a cor de fundo por trás dela não chega à tela.
      if (cs.backgroundImage !== "none") return;
      const proprio = num(cs.backgroundColor);
      const opaco = proprio.length >= 3 && (proprio.length < 4 || proprio[3] > 0.5);
      const f = fundoDe(el);
      const id = el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/)[0] : "");
      // Superfície "trocada": clara no escuro, ou escura no claro.
      if (opaco && ((escuro && lum(f) > 0.4) || (!escuro && lum(f) < 0.15))) {
        superficies.push({ id, bg: cs.backgroundColor, lum: +lum(f).toFixed(3),
                           inline: (el.getAttribute("style") || "").slice(0, 50) });
      }
      const temTexto = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
      if (temTexto) {
        let porImagem = false;
        for (let n = el; n; n = n.parentElement) {
          if (getComputedStyle(n).backgroundImage !== "none") { porImagem = true; break; }
          const c = num(getComputedStyle(n).backgroundColor);
          if (c.length >= 3 && (c.length < 4 || c[3] > 0.95)) break;
        }
        const cor = sobre(num(cs.color), f);
        const cont = (Math.max(lum(cor), lum(f)) + 0.05) / (Math.min(lum(cor), lum(f)) + 0.05);
        if (cont < 3) {
          if (porImagem) {
            // Não afirmo nada por composição aqui — marco para a foto.
            el.setAttribute("data-conferir-pixel", "1");
          } else {
            textos.push({ id, contraste: +cont.toFixed(2), cor: cs.color,
                          txt: el.textContent.trim().slice(0, 30) });
          }
        }
      }
    });
    return { superficies, textos, porPixel: raiz.querySelectorAll('[data-conferir-pixel]').length };
  };
};

(async () => {
  const nav = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await nav.newContext({ viewport: { width: 1400, height: 950 },
    extraHTTPHeaders: { "X-Forwarded-Email": "admin@vale.com" } });
  await servir(ctx);
  await ctx.addInitScript(MEDIDOR);
  const p = await ctx.newPage();
  const erros = [];
  p.on("pageerror", (e) => erros.push(e.message));

  async function abrirEMedir(id, tema) {
    await p.evaluate((t) => document.body.setAttribute("data-bg", t), tema);
    await p.evaluate((i) => {
      const m = document.getElementById(i);
      m.classList.add("open");
      m.style.animation = "none";
      m.querySelectorAll(".modal").forEach((x) => (x.style.animation = "none"));
    }, id);
    await p.waitForTimeout(450);
    const r = await p.evaluate((a) =>
      window.__medir(document.getElementById(a[0]), a[1] === "dark"), [id, tema]);
    await p.evaluate((i) => document.getElementById(i).classList.remove("open"), id);
    return r;
  }

  for (const tela of ["aprovacao.html", "admin.html", "biblioteca.html", "kaizen-novo.html", "index.html"]) {
    await p.goto(BASE + "/" + tela, { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    const ids = await p.evaluate(() =>
      Array.from(document.querySelectorAll(".modal-backdrop[id]")).map((m) => m.id));
    if (!ids.length) continue;
    console.log("\n──── " + tela + " (" + ids.length + " modais)");
    for (const tema of ["dark", "light"]) {
      let superficies = 0, textos = 0, pior = null, exemplo = null;
      for (const id of ids) {
        const r = await abrirEMedir(id, tema);
        superficies += r.superficies.length;
        textos += r.textos.filter((x) => !conhecido(x.txt)).length;
        r.textos.filter((x) => conhecido(x.txt)).forEach((x) =>
          console.log("  (dívida anterior, tema claro) " + x.contraste + ":1  " + id + '  "' + x.txt + '"'));
        if (r.superficies.length && !exemplo) exemplo = id + " → " + r.superficies[0].id + " " + r.superficies[0].bg;
        r.textos.forEach((t) => { if (!pior || t.contraste < pior.contraste) pior = Object.assign({ modal: id }, t); });
        r.textos = r.textos.filter((t) => !conhecido(t.txt));
        textos -= 0;
      }
      ok(`${tema}: nenhuma superfície fora do tema`, superficies === 0,
        superficies ? superficies + " achado(s) · " + exemplo : "");
      ok(`${tema}: nenhum texto abaixo de 3:1`, textos === 0,
        pior ? pior.contraste + ":1 em " + pior.modal + " " + pior.id + ' "' + pior.txt + '"' : "");
    }
  }

  // O modal ampliado da Aprovação, aberto do jeito do usuário.
  console.log("\n──── Kaizen ampliado, aberto pelo botão (o caso do print)");
  await p.goto(BASE + "/aprovacao.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  for (const tema of ["dark", "light"]) {
    await p.evaluate((t) => document.body.setAttribute("data-bg", t), tema);
    await p.waitForTimeout(250);
    await p.click("#btnAmpliarKaizen");
    await p.waitForTimeout(800);
    const r = await p.evaluate((t) =>
      window.__medir(document.getElementById("modalKaizenAmpliado"), t === "dark"), tema);
    ok(`${tema}: conteúdo clonado sem superfície fora do tema`, r.superficies.length === 0,
      r.superficies.slice(0, 3).map((s) => s.id + " " + s.bg).join(" | "));
    const novos = r.textos.filter((x) => !conhecido(x.txt));
    r.textos.filter((x) => conhecido(x.txt)).forEach((x) =>
      console.log("  (dívida anterior, tema claro) " + x.contraste + ":1  \"" + x.txt + "\""));
    ok(`${tema}: conteúdo clonado sem texto abaixo de 3:1`, novos.length === 0,
      novos.slice(0, 3).map((t) => t.contraste + ":1 " + t.id + ' "' + t.txt + '"').join(" | "));
    // Imagens intactas: sem filtro e sem opacidade.
    const imgs = await p.$$eval("#modalKaizenAmpliado img", (is) => is.map((i) => {
      const cs = getComputedStyle(i);
      return { filtro: cs.filter, opacidade: cs.opacity, mix: cs.mixBlendMode };
    }));
    ok(`${tema}: as imagens Antes/Depois sem filtro`,
      imgs.length > 0 && imgs.every((i) => i.filtro === "none" && i.opacidade === "1" && i.mix === "normal"),
      JSON.stringify(imgs[0] || {}));
    await p.locator("#modalKaizenAmpliado .modal").screenshot({ path: `modal-depois-${tema}.png` });
    await p.evaluate(() => document.getElementById("modalKaizenAmpliado").classList.remove("open"));
    await p.waitForTimeout(300);
  }

  console.log("\n──── Troca de tema com o modal JÁ ABERTO");
  await p.evaluate(() => document.body.setAttribute("data-bg", "light"));
  await p.click("#btnAmpliarKaizen");
  await p.waitForTimeout(600);
  const claro = await p.$eval("#modalKaizenAmpliado .modal", (e) => getComputedStyle(e).backgroundColor);
  await p.evaluate(() => document.body.setAttribute("data-bg", "dark"));
  await p.waitForTimeout(400);
  const escuro = await p.$eval("#modalKaizenAmpliado .modal", (e) => getComputedStyle(e).backgroundColor);
  ok("o modal acompanha a troca sem reabrir", claro !== escuro && claro === "rgb(255, 255, 255)",
    claro + " → " + escuro);

  console.log("\n──── Responsividade do modal ampliado (tema escuro)");
  await p.evaluate(() => document.body.setAttribute("data-bg", "dark"));
  for (const [nome, largura] of [["desktop", 1400], ["notebook", 1100], ["tablet", 820], ["celular", 390]]) {
    await p.setViewportSize({ width: largura, height: 900 });
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const m = document.querySelector("#modalKaizenAmpliado .modal");
      const c = m.getBoundingClientRect();
      return { cabe: c.width <= window.innerWidth + 1 && c.left >= -1,
               fundo: getComputedStyle(m).backgroundColor,
               rolagem: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    ok(`${nome} (${largura}px): cabe na tela, sem rolagem lateral, e escuro`,
      r.cabe && !r.rolagem && r.fundo === "rgb(13, 38, 64)",
      JSON.stringify(r));
  }
  await p.setViewportSize({ width: 1400, height: 950 });

  ok("nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await nav.close();
  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})();
