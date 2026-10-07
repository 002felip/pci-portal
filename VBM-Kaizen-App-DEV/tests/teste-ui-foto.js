/**
 * Proposta B aplicada ao Antes/Depois + o calendário clicável no escuro.
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const BASE = "http://127.0.0.1:3994";
let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

// PNG 1920x1080 de VERDADE. Um base64 escrito a mao nao decodificava:
// o navegador reportava complete=true com naturalWidth=0, e o teste
// acusava a legenda sem dimensao — defeito do fixture, nao do codigo.
const PNG = require("./png.js").png(1920, 1080);

(async () => {
  const nav = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "X-Forwarded-Email": "admin@vale.com" } });
  const p = await ctx.newPage();
  const erros = [];
  p.on("pageerror", (e) => erros.push(e.message));
  await p.goto(BASE + "/kaizen-novo.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(800);

  // Abre todas as etapas: o teste precisa alcançar os dois campos e a data.
  await p.evaluate(() => {
    document.querySelectorAll(".wizard-panel").forEach((x) => (x.style.display = "block"));
  });

  console.log("\n=== A. CALENDÁRIO: o clique chega ao botão nos dois temas ===");
  for (const modo of ["light", "dark"]) {
    await p.evaluate((m) => document.body.setAttribute("data-bg", m), modo);
    await p.locator("#data_conclusao_abrir").scrollIntoViewIfNeeded();
    await p.waitForTimeout(200);
    const r = await p.evaluate(() => {
      const b = document.getElementById("data_conclusao_abrir");
      const c = b.getBoundingClientRect();
      const alvo = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
      return { chega: !!(alvo && (alvo === b || b.contains(alvo))),
               noPonto: alvo ? (alvo.id || alvo.tagName + "." + String(alvo.className).slice(0, 26)) : "(nada)",
               backdrop: getComputedStyle(document.getElementById("data_conclusao_texto")).backdropFilter };
    });
    ok(`tema ${modo}: o clique chega ao ícone`, r.chega, r.noPonto + " · backdrop=" + r.backdrop);
  }
  // Clique de verdade no escuro (era aqui que não abria).
  await p.evaluate(() => document.body.setAttribute("data-bg", "dark"));
  const abriu = await p.evaluate(() => {
    const nativo = document.getElementById("data_conclusao");
    let chamou = false;
    const orig = nativo.showPicker;
    nativo.showPicker = function () { chamou = true; };
    document.getElementById("data_conclusao_abrir").click();
    nativo.showPicker = orig;
    return chamou;
  });
  ok("tema dark: clicar no ícone abre o calendário", abriu);

  console.log("\n=== B. PALCO: estrutura nos dois campos ===");
  for (const campo of ["imagem_antes", "imagem_depois"]) {
    const palco = p.locator(`[data-acoes-foto="${campo}"]`);
    ok(`${campo}: palco existe`, await palco.count() === 1);
    ok(`${campo}: começa escondido`, await palco.isHidden());
    ok(`${campo}: tem os 3 botões`, await palco.locator(".foto-bt").count() === 3);
    ok(`${campo}: tem legenda`, await palco.locator("[data-foto-nome]").count() === 1);
    ok(`${campo}: a <img> está dentro do quadro`,
      await palco.locator(".foto-quadro .photo-preview-img").count() === 1);
  }

  console.log("\n=== C. Escolher um arquivo preenche o palco ===");
  await p.setInputFiles("#imagem_antes", { name: "evidencia-antes.png", mimeType: "image/png", buffer: PNG });
  await p.waitForTimeout(700);
  const palcoA = p.locator('[data-acoes-foto="imagem_antes"]');
  ok("o palco apareceu", await palcoA.isVisible());
  ok("a zona de upload saiu de cena",
    await p.locator("#imagem_antes").locator("xpath=ancestor::div[contains(@class,'photo-upload-zone')]").isHidden());
  ok("a imagem tem src (desenhada pelo initPhotoUpload)",
    (await palcoA.locator(".photo-preview-img").getAttribute("src") || "").startsWith("data:image"));
  ok("a legenda traz o nome do arquivo",
    (await palcoA.locator("[data-foto-nome]").textContent()) === "evidencia-antes.png",
    await palcoA.locator("[data-foto-nome]").textContent());
  const dados = await palcoA.locator("[data-foto-dados]").textContent();
  // A linha visível é nome + dimensão, como o layout de referência; o
  // peso migrou para o title (é o que explica uma recusa por 10MB).
  ok("a legenda traz a dimensão", /×/.test(dados), dados);
  const titleDados = await palcoA.locator("[data-foto-dados]").getAttribute("title");
  ok("o peso continua no title", /(KB|MB)/.test(titleDados || ""), titleDados);
  const prop = await palcoA.locator(".foto-quadro .photo-preview-img").evaluate((el) => {
    const cs = getComputedStyle(el);
    const c = el.getBoundingClientRect();
    return { fit: cs.objectFit, razao: (c.width / c.height).toFixed(2) };
  });
  ok("a imagem usa contain (não corta o print)", prop.fit === "contain", prop.fit);
  // A moldura deixou de ser 16:9: virou a miniatura de 104x78 da ficha,
  // que é o layout de referência nos dois modos.
  ok("a miniatura da ficha, e não mais o palco 16:9",
    Math.abs(parseFloat(prop.razao) - 16 / 9) > 0.05, prop.razao);

  console.log("\n=== D. Substituir não exige limpar antes ===");
  const abriuSeletor = await p.evaluate(() => {
    const input = document.getElementById("imagem_antes");
    let chamou = false;
    const orig = input.click;
    input.click = function () { chamou = true; };
    document.querySelector('[data-acoes-foto="imagem_antes"] [data-foto-trocar]').click();
    input.click = orig;
    return chamou;
  });
  ok("Substituir abre o seletor direto", abriuSeletor);
  ok("o palco continua visível (não voltou ao vazio)", await palcoA.isVisible());

  console.log("\n=== E. Ampliar e Remover ===");
  await palcoA.locator("[data-foto-ver]").click();
  await p.waitForTimeout(400);
  ok("Ampliar abre o modal", await p.locator("#modalFotoAmpliada.open").count() === 1);
  await p.locator("#modalFotoAmpliada [data-modal-close], #modalFotoAmpliada .modal-close").first().click();
  await p.waitForTimeout(400);
  await palcoA.locator("[data-foto-limpar]").click();
  await p.waitForTimeout(300);
  ok("Remover esconde o palco", await palcoA.isHidden());
  ok("Remover devolve a zona de upload",
    await p.locator("#imagem_antes").locator("xpath=ancestor::div[contains(@class,'photo-upload-zone')]").isVisible());
  ok("Remover limpa a legenda",
    (await palcoA.locator("[data-foto-nome]").textContent()) === "");

  console.log("\n=== F. O campo Depois funciona igual ===");
  await p.setInputFiles("#imagem_depois", { name: "evidencia-depois.png", mimeType: "image/png", buffer: PNG });
  await p.waitForTimeout(700);
  const palcoD = p.locator('[data-acoes-foto="imagem_depois"]');
  ok("o palco do Depois apareceu", await palcoD.isVisible());
  ok("com o nome certo", (await palcoD.locator("[data-foto-nome]").textContent()) === "evidencia-depois.png");
  ok("o palco do Antes segue vazio", await palcoA.isHidden());

  console.log("\n=== G. Contraste no tema escuro ===");
  const cores = await palcoD.evaluate((el) => {
    const q = el.querySelector(".foto-quadro"), l = el.querySelector(".foto-legenda"), b = el.querySelector(".foto-bt");
    return { quadro: getComputedStyle(q).borderTopColor,
             legenda: getComputedStyle(l).backgroundColor,
             botao: getComputedStyle(b).color };
  });
  ok("o quadro tem borda própria no escuro", cores.quadro !== "rgb(227, 233, 238)", cores.quadro);
  ok("a legenda não ficou branca sobre fundo escuro",
    !/^rgb\(255, 255, 255\)$/.test(cores.legenda), cores.legenda);

  console.log("\n=== H. Os ícones da barra existem de verdade ===");
  // O projeto serve um SUBCONJUNTO do Font Awesome (70 ícones). Usar um
  // que ficou de fora rende um quadradinho vazio, sem erro nenhum — foi
  // o que aconteceu com fa-magnifying-glass-plus. Medir a LARGURA do
  // glifo pega isso: glifo ausente vem com largura ~0.
  const glifos = await palcoD.evaluate((el) => {
    return Array.from(el.querySelectorAll(".foto-bt i")).map((i) => {
      const antes = getComputedStyle(i, "::before");
      const r = i.getBoundingClientRect();
      return { classe: i.className.replace("fa-solid ", ""),
               conteudo: antes.content, largura: Math.round(r.width) };
    });
  });
  glifos.forEach((g) => {
    ok(`${g.classe} tem glifo`, g.conteudo !== "none" && g.conteudo !== "" && g.largura > 4,
      `content=${g.conteudo} largura=${g.largura}px`);
  });

  ok("nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await nav.close();
  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})();
