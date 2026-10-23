/**
 * Botão de exclusão no card do Kaizen (Biblioteca) — critérios de
 * aceite: visível só para dono/admin em status != Aprovado/Rejeitado,
 * modal de confirmação com código+título, DELETE revalida no servidor
 * (dono errado -> 403, status bloqueado -> 409), lista+resumo atualizam
 * sem reload, teclado/foco, cor de alerta só no hover, temas claro/escuro.
 *
 * Dublê: tests/fake-mssql-lixeira.js — 5 Kaizens fixos (601 Aguardando/
 * dono 901, 602 Aprovado/dono 901, 603 Solicitado alterações/dono 902,
 * 604 Revisado/dono 901, 605 Reprovado/dono 901), identidade por
 * X-Forwarded-Email (dono@vale.com=901, outro@vale.com=902,
 * admin@vale.com=admin).
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const BASE = "http://127.0.0.1:3996";
let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

async function fetchJson(path, email, opts) {
  const headers = Object.assign({ Accept: "application/json" }, email ? { "X-Forwarded-Email": email } : {}, (opts && opts.headers) || {});
  const r = await fetch(BASE + path, Object.assign({}, opts, { headers }));
  let body = null;
  try { body = await r.json(); } catch (e) {}
  return { status: r.status, body };
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const erros = [];

  async function abrirBiblioteca(email) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: { "X-Forwarded-Email": email } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => erros.push(`[${email}] ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") erros.push(`[${email}] console: ${m.text()}`); });
    await page.goto(BASE + "/biblioteca.html", { waitUntil: "networkidle" });
    await page.waitForSelector(".kaizen-card, .kaizen-empty, [data-filter-item]", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    return { ctx, page };
  }

  function botaoDe(page, idKaizen) {
    return page.locator(`[data-excluir-kaizen="${idKaizen}"]`);
  }

  console.log("=== Visibilidade da lixeira por perfil ===");
  {
    const { ctx, page } = await abrirBiblioteca("admin@vale.com");
    ok("admin vê lixeira no 601 (Aguardando, de outro dono)", await botaoDe(page, 601).count() === 1);
    ok("admin vê lixeira no 603 (Solicitado alterações, de outro dono)", await botaoDe(page, 603).count() === 1);
    ok("admin vê lixeira no 604 (Revisado)", await botaoDe(page, 604).count() === 1);
    ok("admin NÃO vê lixeira no 602 (Aprovado) mesmo sendo admin", await botaoDe(page, 602).count() === 0);
    ok("admin NÃO vê lixeira no 605 (Reprovado) mesmo sendo admin", await botaoDe(page, 605).count() === 0);
    await ctx.close();
  }
  {
    const { ctx, page } = await abrirBiblioteca("dono@vale.com");
    ok("dono vê lixeira no próprio 601 (Aguardando)", await botaoDe(page, 601).count() === 1);
    ok("dono vê lixeira no próprio 604 (Revisado)", await botaoDe(page, 604).count() === 1);
    ok("dono NÃO vê lixeira no próprio 602 (Aprovado)", await botaoDe(page, 602).count() === 0);
    ok("dono NÃO vê lixeira no próprio 605 (Reprovado)", await botaoDe(page, 605).count() === 0);
    ok("dono NÃO vê lixeira no 603 (não é dele)", await botaoDe(page, 603).count() === 0);
    await ctx.close();
  }
  {
    const { ctx, page } = await abrirBiblioteca("outro@vale.com");
    ok("outro usuário vê lixeira só no próprio 603", await botaoDe(page, 603).count() === 1);
    ok("outro usuário NÃO vê lixeira no 601 (não é dele)", await botaoDe(page, 601).count() === 0);
    ok("outro usuário NÃO vê lixeira no 604 (não é dele)", await botaoDe(page, 604).count() === 0);
    await ctx.close();
  }

  console.log("\n=== Layout: lixeira não desloca nem sobrepõe título/id ===");
  {
    const { ctx, page } = await abrirBiblioteca("admin@vale.com");
    const card = page.locator('[data-filter-item]').filter({ has: botaoDe(page, 601) });
    const boxBotao = await botaoDe(page, 601).boundingBox();
    // O DIV do título/id é block-level (ocupa a largura toda do card) —
    // a extensão REAL do texto (o que importa pra "não sobrepõe") vem de
    // um Range sobre o conteúdo, não do bounding box do bloco.
    const extensaoTexto = (loc) => loc.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect();
    });
    const retTitulo = await extensaoTexto(card.locator(".kaizen-card-title").first());
    const retId = await extensaoTexto(card.locator(".kaizen-card-id").first());
    const semSobrepor = (b, t) => b.x >= t.x + t.width || t.x >= b.x + b.width || b.y >= t.y + t.height || t.y >= b.y + b.height;
    ok("lixeira não sobrepõe o texto do título", boxBotao && semSobrepor(boxBotao, retTitulo));
    ok("lixeira não sobrepõe o texto do id/rótulo", boxBotao && semSobrepor(boxBotao, retId));
    await ctx.close();
  }

  console.log("\n=== Vermelho sólido e visível em repouso; hover/foco escurecem discretamente ===");
  {
    const { ctx, page } = await abrirBiblioteca("admin@vale.com");
    const btn = botaoDe(page, 601);
    const corNormal = await btn.evaluate((el) => getComputedStyle(el).color);
    const bgNormal = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    await btn.hover();
    await page.waitForTimeout(400);
    const bgHover = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    ok("ícone já é vermelho sólido em repouso (visível sem hover)", corNormal === "rgb(220, 38, 38)");
    ok("fundo em repouso não é transparente/opacidade baixa", bgNormal === "rgb(254, 242, 242)");
    ok("hover escurece o fundo pro vermelho cheio", bgHover === "rgb(220, 38, 38)");
    await btn.focus();
    const outlineFoco = await btn.evaluate((el) => getComputedStyle(el).outlineStyle);
    ok("foco visível (outline) ao navegar por teclado", outlineFoco === "solid");
    await ctx.close();
  }

  console.log("\n=== Modal de confirmação: código + título, Cancelar preserva o Kaizen ===");
  {
    const { ctx, page } = await abrirBiblioteca("dono@vale.com");
    await botaoDe(page, 601).click();
    await page.waitForSelector(".confirm-backdrop.open", { timeout: 3000 });
    const textoModal = await page.locator(".confirm-backdrop.open .modal").innerText();
    ok("modal mostra o código do Kaizen (KZN26-601 ou 601)", /601/.test(textoModal));
    ok("modal mostra o título do Kaizen", textoModal.includes("Postura de EPI na oficina"));
    ok("modal com título 'Excluir Kaizen?'", textoModal.includes("Excluir Kaizen?"));
    await page.locator(".confirm-backdrop.open [data-role=\"cancelar\"]").click();
    await page.waitForTimeout(400);
    ok("cancelar fecha o modal", await page.locator(".confirm-backdrop.open").count() === 0);
    ok("Kaizen 601 continua no card após cancelar", await botaoDe(page, 601).count() === 1);
    await ctx.close();
  }

  console.log("\n=== Exclusão bem-sucedida: some da lista, resumo atualiza, sem reload ===");
  {
    const { ctx, page } = await abrirBiblioteca("dono@vale.com");
    const totalAntes = await page.locator("#bibShowingCount").innerText().catch(() => "");
    await botaoDe(page, 601).click();
    await page.waitForSelector(".confirm-backdrop.open", { timeout: 3000 });
    await page.locator(".confirm-backdrop.open [data-role=\"confirmar\"]").click();
    await page.waitForSelector(".toast, [class*=toast]", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    ok("card do Kaizen 601 sumiu da grade após excluir", await botaoDe(page, 601).count() === 0);
    const totalDepois = await page.locator("#bibShowingCount").innerText().catch(() => "");
    ok("resumo/contagem da lista mudou sem reload de página", totalAntes !== totalDepois);
    // Confere direto na API que o registro realmente foi removido do "banco".
    const r = await fetchJson("/api/kaizens?pagina=0", "dono@vale.com");
    const aindaExiste = (r.body.itens || []).some((k) => k.ID_KAIZEN === 601);
    ok("Kaizen 601 removido de verdade (não só escondido no DOM)", !aindaExiste);
    await ctx.close();
  }

  console.log("\n=== Backend revalida: não confia no botão escondido no front ===");
  {
    // 604 pertence ao dono@vale.com (901) — outro@vale.com (902) tenta excluir direto na API.
    const semPermissao = await fetchJson("/api/kaizens/604", "outro@vale.com", { method: "DELETE" });
    ok("DELETE por quem não é dono/admin -> 403", semPermissao.status === 403);
    const aindaLa = await fetchJson("/api/kaizens?pagina=0", "dono@vale.com");
    ok("Kaizen 604 continua existindo após a tentativa negada", (aindaLa.body.itens || []).some((k) => k.ID_KAIZEN === 604));

    // 602 é do próprio dono@vale.com, mas está Aprovado — status bloqueia mesmo pro dono.
    const statusBloqueado = await fetchJson("/api/kaizens/602", "dono@vale.com", { method: "DELETE" });
    ok("DELETE em Kaizen Aprovado (mesmo sendo dono) -> 409", statusBloqueado.status === 409);

    // Sem identidade nenhuma.
    const semIdentidade = await fetchJson("/api/kaizens/604", null, { method: "DELETE" });
    ok("DELETE sem X-Forwarded-Email -> 403", semIdentidade.status === 403);
  }

  console.log("\n=== Tema escuro: lixeira renderiza visível e escurece no hover ===");
  {
    const { ctx, page } = await abrirBiblioteca("admin@vale.com");
    await page.evaluate(() => { document.body.setAttribute("data-bg", "dark"); try { localStorage.setItem("vbm-theme", "dark"); } catch (e) {} });
    await page.waitForTimeout(200);
    const btn = botaoDe(page, 604);
    ok("lixeira visível no tema escuro", await btn.isVisible());
    const corNormalDark = await btn.evaluate((el) => getComputedStyle(el).color);
    await btn.hover();
    await page.waitForTimeout(400);
    const corHoverDark = await btn.evaluate((el) => getComputedStyle(el).color);
    ok("tema escuro: cor muda no hover", corNormalDark !== corHoverDark);
    await ctx.close();
  }

  if (erros.length) {
    erros.forEach((e) => ok("nenhum erro de JavaScript: " + e, false));
  } else {
    ok("nenhum erro de JavaScript em nenhuma navegação", true);
  }

  await browser.close();
  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})().catch((err) => { console.error("FALHA GERAL:", err.message, err.stack); process.exit(1); });
