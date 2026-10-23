/**
 * ITEM 2 — Proposta A (ficha de mídia) na EDIÇÃO, palco no cadastro.
 *
 * O modo de edição depende de uma resposta autorizada do servidor, que
 * o dublê do mssql não sabe montar. Em vez de testar a classe na mão
 * (o que provaria só que o CSS existe), o teste INTERCEPTA a chamada
 * /api/kaizens/:id/edicao e devolve um Kaizen — assim o caminho real
 * roda inteiro: fetch, autorização, window.VBMEdicao, usarFicha().
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const BASE = "http://127.0.0.1:3994";
const PNG = require("./png.js").png(1920, 1080);
let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

const KAIZEN = {
  ID_KAIZEN: 42, DT_ATUALIZACAO: "2026-09-10T12:00:00Z",
  titulo: "Reducao de refugo na linha 3",
  declaracao_problema: "Refugo acima da meta.", meta_objetivo: "Reduzir 30%",
  descricao_antes: "Como era.", descricao_depois: "Como ficou.",
  data_conclusao: "2026-09-01", id_categoria: 1, id_replicacao: 1,
  url_imagem_antes: "05 - Kaizen/42/antes-linha3.png",
  url_imagem_depois: "05 - Kaizen/42/depois-linha3.png",
  ids_desperdicio: [],
};

(async () => {
  const nav = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2,
    extraHTTPHeaders: { "X-Forwarded-Email": "admin@vale.com" } });
  await ctx.route("**/api/kaizens/42/edicao*", (rota) =>
    rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(KAIZEN) }));
  await ctx.route("**/api/kaizens/imagem**", (rota) =>
    rota.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  const p = await ctx.newPage();
  const erros = [];
  p.on("pageerror", (e) => erros.push(e.message));

  async function medir(pg, campo) {
    return pg.evaluate((c) => {
      const palco = document.querySelector('[data-acoes-foto="' + c + '"]');
      const q = palco.querySelector(".foto-quadro");
      const b = palco.querySelector(".foto-barra");
      const l = palco.querySelector(".foto-legenda");
      const cs = getComputedStyle(palco);
      const cb = b.getBoundingClientRect(), cq = q.getBoundingClientRect(), cp = palco.getBoundingClientRect();
      return {
        ficha: palco.classList.contains("e-ficha"),
        display: cs.display,
        altura: Math.round(cp.height),
        quadroLargura: Math.round(cq.width), quadroAltura: Math.round(cq.height),
        barraPos: getComputedStyle(b).position,
        // Na ficha a barra fica À DIREITA do quadro, na mesma faixa.
        barraDepoisDoQuadro: cb.left > cq.right,
        barraSobreOQuadro: cb.left < cq.right && cb.top < cq.bottom,
        legendaAbaixo: l.getBoundingClientRect().top >= cq.bottom - 1,
        botoes: palco.querySelectorAll(".foto-bt").length,
        visivel: cp.height > 0,
      };
    }, campo);
  }

  // ── CADASTRO: sem ?id=, a ficha vale também aqui ───────────────
  // Era o contrário até a referência visual do usuário: o palco 16:9
  // no cadastro e a ficha só na edição. O palco custava ~300 px por
  // imagem; a ficha resolve o campo em 102 px e é o layout aprovado.
  console.log("\n=== A. Cadastro (sem ?id=) — a MESMA ficha da edição ===");
  await p.goto(BASE + "/kaizen-novo.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelectorAll(".wizard-panel").forEach((x) => (x.style.display = "block")));
  await p.setInputFiles("#imagem_antes", { name: "antes.png", mimeType: "image/png", buffer: PNG });
  await p.waitForTimeout(700);
  let m = await medir(p, "imagem_antes");
  ok("o cadastro já entra na ficha", m.ficha === true);
  ok("a barra é coluna da grade, não flutua sobre a imagem", m.barraPos === "static", JSON.stringify({ pos: m.barraPos }));
  ok("a legenda fica AO LADO do quadro, não abaixo", m.legendaAbaixo === false);
  const razao = m.quadroLargura / m.quadroAltura;
  ok("o quadro é a miniatura da ficha, não o 16:9", Math.abs(razao - 16 / 9) > 0.06, razao.toFixed(2));
  const alturaPalco = m.altura;
  ok("o campo cabe em ~102 px, contra os >250 do palco", alturaPalco < 130, alturaPalco + "px");

  // Arrastar continua trocando, agora com o palco inteiro como alvo.
  const soltou = await p.evaluate(() => {
    const palco = document.querySelector('[data-acoes-foto="imagem_antes"]');
    const ev = new Event("dragover", { bubbles: true });
    ev.dataTransfer = { dropEffect: "" };
    palco.dispatchEvent(ev);
    const q = palco.querySelector(".foto-quadro");
    return { realce: q.classList.contains("arrastando"),
             aviso: !palco.querySelector("[data-foto-solta]").hidden };
  });
  ok("arrastar sobre o palco realça o quadro", soltou.realce && soltou.aviso, JSON.stringify(soltou));

  // ── EDIÇÃO: com ?id=, tem de virar ficha ───────────────────────
  console.log("\n=== B. Edição (?id=42) — a ficha compacta ===");
  await p.goto(BASE + "/kaizen-novo.html?id=42&origem=A", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelectorAll(".wizard-panel").forEach((x) => (x.style.display = "block")));
  await p.waitForTimeout(400);
  ok("a página entrou em modo de edição", await p.evaluate(() => !!window.VBMEdicao));
  ok("o título veio preenchido",
    (await p.inputValue("#titulo_kaizen")) === KAIZEN.titulo);

  for (const campo of ["imagem_antes", "imagem_depois"]) {
    m = await medir(p, campo);
    ok(`${campo}: virou ficha`, m.ficha && m.display === "grid", m.display);
    ok(`${campo}: a foto gravada aparece`, m.visivel);
    ok(`${campo}: miniatura de 104 × 78`,
      m.quadroLargura === 104 && m.quadroAltura === 78, m.quadroLargura + "×" + m.quadroAltura);
    ok(`${campo}: a barra saiu de cima da imagem, para o lado`,
      m.barraPos === "static" && m.barraDepoisDoQuadro && !m.barraSobreOQuadro,
      m.barraPos + " depoisDoQuadro=" + m.barraDepoisDoQuadro);
    ok(`${campo}: as 3 ações continuam lá`, m.botoes === 3, String(m.botoes));
    ok(`${campo}: cabe em ~102 px (cadastro mediu ${alturaPalco}px)`,
      m.altura <= 115, m.altura + "px");
  }

  const legenda = await p.evaluate(() => {
    const palco = document.querySelector('[data-acoes-foto="imagem_antes"]');
    return { nome: palco.querySelector("[data-foto-nome]").textContent,
             dados: palco.querySelector("[data-foto-dados]").textContent };
  });
  ok("a ficha identifica o arquivo gravado", legenda.nome === "antes-linha3.png", legenda.nome);
  ok("e traz a dimensão lida da imagem", /×/.test(legenda.dados), legenda.dados);

  console.log("\n=== C. As ações da ficha funcionam ===");
  await p.locator('[data-acoes-foto="imagem_antes"] [data-foto-ver]').click();
  await p.waitForTimeout(500);
  ok("Ampliar abre o modal", await p.locator("#modalFotoAmpliada.open").count() === 1);
  await p.locator("#modalFotoAmpliada [data-fechar-foto]").click();
  await p.waitForTimeout(400);

  const abriuSeletor = await p.evaluate(() => {
    const input = document.getElementById("imagem_antes");
    let chamou = false;
    const orig = input.click;
    input.click = function () { chamou = true; };
    document.querySelector('[data-acoes-foto="imagem_antes"] [data-foto-trocar]').click();
    input.click = orig;
    return chamou;
  });
  ok("Substituir abre o seletor", abriuSeletor);

  await p.locator('[data-acoes-foto="imagem_antes"] [data-foto-limpar]').click();
  await p.waitForTimeout(400);
  ok("Remover esconde a ficha",
    await p.locator('[data-acoes-foto="imagem_antes"]').isHidden());
  ok("Remover devolve a zona de upload",
    await p.locator("#imagem_antes").locator("xpath=ancestor::div[contains(@class,'photo-upload-zone')]").isVisible());

  // Escolher outro arquivo na edição mantém a ficha (o modo é da tela).
  await p.setInputFiles("#imagem_antes", { name: "novo-antes.png", mimeType: "image/png", buffer: PNG });
  await p.waitForTimeout(700);
  m = await medir(p, "imagem_antes");
  ok("escolher outra foto na edição continua na ficha", m.ficha && m.visivel);

  console.log("\n=== D. Contraste no tema escuro ===");
  // Trocar o tema e MEDIR em chamadas separadas: no mesmo evaluate, com
  // outros getComputedStyle já vivos, o Chrome devolveu o estilo velho e
  // o teste acusou botão branco onde a regra escura estava correta.
  await p.evaluate(() => document.body.setAttribute("data-bg", "dark"));
  await p.waitForTimeout(250);
  const escuro = await p.evaluate(() => {
    const palco = document.querySelector('[data-acoes-foto="imagem_antes"]');
    const cs = getComputedStyle(palco), bt = getComputedStyle(palco.querySelector(".foto-bt"));
    return { fundo: cs.backgroundColor, borda: cs.borderTopColor, botao: bt.backgroundColor };
  });
  ok("a ficha tem fundo próprio no escuro", escuro.fundo !== "rgb(255, 255, 255)", escuro.fundo);
  ok("os botões não ficaram brancos", escuro.botao !== "rgb(255, 255, 255)", escuro.botao);

  ok("nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await nav.close();
  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})();
