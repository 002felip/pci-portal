/**
 * ATIVIDADE 1 — Aprovador recortado pela unidade (NM_SITE) do líder.
 *
 * O dublê (fake-mssql-sites.js) serve 8 aprovadores em 3 unidades, mais
 * dois líderes que não são aprovadores. Com um aprovador só, "filtrou" e
 * "não filtrou" dariam a mesma tela — por isso a população existe.
 *
 * O teste observa a REDE: registra cada /api/aprovadores que o navegador
 * dispara, para provar que o ?lider= vai certo e que não há enxurrada de
 * pedidos a cada tecla digitada no campo Líder.
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const BASE = "http://127.0.0.1:3997";
let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

const EU = "cristian.alves@vale.com";         // CORPORATIVO
// ID_USUARIO, que é o VALOR da <option>. O texto exibido vem de
// rotuloPessoa(), que deriva o nome do e-mail ("Ana Santos5") — comparar
// rótulo mediria o formatador, não o recorte por unidade.
const CORPORATIVO = ["901", "902", "903"];
const SALOBO = ["904", "905"];
const SOSSEGO = ["906", "908"];

(async () => {
  const nav = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "X-Forwarded-Email": EU } });
  const p = await ctx.newPage();
  const erros = [], pedidos = [];
  p.on("pageerror", (e) => erros.push(e.message));
  p.on("request", (r) => {
    if (r.url().indexOf("/api/aprovadores?") !== -1) pedidos.push(r.url().split("/api/")[1]);
  });

  const nomes = () => p.$$eval("#id_aprovador option",
    (os) => os.filter((o) => o.value).map((o) => o.value));
  const trocarIdioma = (lang) => p.$eval("#langSelect", (el, l) => {
    el.value = l; el.dispatchEvent(new Event("change", { bubbles: true }));
  }, lang);
  const ajuda = () => p.textContent("#ajudaAprovador");

  async function esperarLista(minimo) {
    await p.waitForFunction((n) => document.querySelectorAll("#id_aprovador option").length > n,
      minimo, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(250);
  }

  console.log("\n=== A. Novo Kaizen: líder é quem está logado (CORPORATIVO) ===");
  await p.goto(BASE + "/kaizen-novo.html", { waitUntil: "networkidle" });
  await esperarLista(1);
  let lista = await nomes();
  ok("só aprovadores do CORPORATIVO", JSON.stringify(lista.sort()) === JSON.stringify(CORPORATIVO.slice().sort()),
    lista.join(" | "));
  ok("nenhum de SALOBO ou SOSSEGO",
    !lista.some((n) => SALOBO.concat(SOSSEGO).indexOf(n) !== -1), lista.join(","));
  const a1 = await ajuda();
  ok("a ajuda diz a unidade de verdade", /CORPORATIVO/.test(a1) && !/Sudbury/.test(a1), a1);
  ok("pediu com ?lider=logado", pedidos.some((u) => /lider=logado/.test(u)), pedidos.join(" , "));

  console.log("\n=== B. Trocar o líder troca a lista ===");
  const antes = pedidos.length;
  await p.fill("#id_lider_projeto", "Lider Salobo");
  await p.waitForTimeout(700);
  await p.locator(".mdm-suggest-item").first().click({ timeout: 5000 });
  await esperarLista(0);
  lista = await nomes();
  ok("só aprovadores de SALOBO", JSON.stringify(lista.sort()) === JSON.stringify(SALOBO.slice().sort()),
    lista.join(" | "));
  const a2 = await ajuda();
  ok("a ajuda passou a dizer SALOBO", /SALOBO/.test(a2), a2);
  ok("pediu com o ID do líder", pedidos.some((u) => /lider=950/.test(u)), pedidos.slice(antes).join(" , "));
  // Digitar não pode disparar um pedido por tecla: o hidden é limpo a cada
  // 'input', e sem a guarda por valor seriam 12 recargas ao escrever o nome.
  ok("digitar o nome não gerou um pedido por tecla",
    pedidos.length - antes <= 3, (pedidos.length - antes) + " pedidos");

  console.log("\n=== C. Terceira unidade (SOSSEGO) ===");
  await p.fill("#id_lider_projeto", "Alanna");
  await p.waitForTimeout(700);
  await p.locator(".mdm-suggest-item").first().click({ timeout: 5000 });
  await esperarLista(0);
  lista = await nomes();
  ok("só aprovadores de SOSSEGO", JSON.stringify(lista.sort()) === JSON.stringify(SOSSEGO.slice().sort()),
    lista.join(" | "));

  console.log("\n=== D. Líder sem NM_SITE no MDM não trava o cadastro ===");
  await p.fill("#id_lider_projeto", "Lider Sem Site");
  await p.waitForTimeout(700);
  await p.locator(".mdm-suggest-item").first().click({ timeout: 5000 });
  await esperarLista(0);
  lista = await nomes();
  ok("a lista não ficou vazia", lista.length === 8, lista.length + " aprovadores");
  const a4 = await ajuda();
  ok("a ajuda volta ao texto sem unidade", !/unidade [A-Z]/.test(a4), a4);

  console.log("\n=== E. Edição: aprovador de outra unidade é recusado ===");
  // O Kaizen 77 tem líder de SALOBO e aprovador do CORPORATIVO (901):
  // a regra tem de limpar a seleção e avisar.
  await ctx.route("**/api/kaizens/77/edicao*", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ ID_KAIZEN: 77, DT_ATUALIZACAO: "2026-09-10T12:00:00Z", ORIGEM: "A",
      titulo: "Kaizen de Salobo", id_usuario_lider: 950, NM_LIDER: "Lider Salobo",
      id_usuario_aprovador: 901, ids_desperdicio: [] }) }));
  await p.goto(BASE + "/kaizen-novo.html?id=77", { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);
  lista = await nomes();
  ok("a lista é a de SALOBO (unidade do líder gravado)",
    JSON.stringify(lista.sort()) === JSON.stringify(SALOBO.slice().sort()), lista.join(" | "));
  ok("o aprovador de outra unidade não ficou selecionado",
    (await p.inputValue("#id_aprovador")) === "", await p.inputValue("#id_aprovador"));
  const aviso = await p.$eval("#avisoApp", (e) => e.textContent).catch(() => "");
  ok("o aviso de outra unidade apareceu", /outra unidade/i.test(aviso), aviso.slice(0, 70));

  console.log("\n=== F. Edição: aprovador da MESMA unidade é preservado ===");
  await ctx.route("**/api/kaizens/78/edicao*", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ ID_KAIZEN: 78, DT_ATUALIZACAO: "2026-09-10T12:00:00Z", ORIGEM: "A",
      titulo: "Kaizen de Salobo", id_usuario_lider: 950, NM_LIDER: "Lider Salobo",
      id_usuario_aprovador: 904, ids_desperdicio: [] }) }));
  await p.goto(BASE + "/kaizen-novo.html?id=78", { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);
  ok("o aprovador gravado continua selecionado",
    (await p.inputValue("#id_aprovador")) === "904", await p.inputValue("#id_aprovador"));
  // Sem toast nenhum o #avisoApp nem chega a existir — $eval falharia, e
  // "não existe" é justamente o resultado esperado aqui.
  const semAviso = await p.$eval("#avisoApp", (e) => e.textContent).catch(() => "");
  ok("sem aviso de outra unidade", !/outra unidade/i.test(semAviso), semAviso.slice(0, 70));

  console.log("\n=== G. Troca de idioma não quebra o texto da unidade ===");
  await p.goto(BASE + "/kaizen-novo.html", { waitUntil: "networkidle" });
  await esperarLista(1);
  await trocarIdioma("en");
  await p.waitForTimeout(900);
  const a7 = await ajuda();
  ok("nada de '{site}' cru na tela", a7.indexOf("{site}") === -1, a7);

  ok("nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await nav.close();
  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})();
