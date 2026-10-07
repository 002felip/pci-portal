/**
 * Bloqueio de acesso para quem não está no MDM (kzn_mdm_hierarquia) —
 * critérios de aceite da Atividade 1 (diagnóstico de 20/09/2026):
 * membro acessa normal, não-membro é barrado em toda página (mesmo por
 * URL direta) e em toda API, com log de usuário/página/motivo/data.
 *
 * Dublê: "membro@vale.com" existe no MDM; qualquer outro e-mail (ou
 * nenhum cabeçalho) não existe — replica exatamente o cenário real de
 * alguém fora da base tentando entrar.
 */
const BASE = "http://127.0.0.1:4000";
let passou = 0, falhou = 0;
const ok = (t, c, x) => { if (c) passou++; else falhou++; console.log((c ? "  OK   " : " FALHA ") + t + (x ? "   " + x : "")); };

const PAGINAS_MEMBRO = ["/", "/index.html", "/biblioteca.html", "/kaizen-novo.html"];

async function status(path, email) {
  const headers = email ? { "X-Forwarded-Email": email } : {};
  const r = await fetch(BASE + path, { headers, redirect: "manual" });
  return r.status;
}

(async () => {
  console.log("=== Membro (existe no MDM): acessa normal ===");
  for (const p of PAGINAS_MEMBRO) {
    ok(`GET ${p} com membro -> 200`, (await status(p, "membro@vale.com")) === 200);
  }

  console.log("\n=== Não-membro (fora do MDM): bloqueado em toda página, mesmo por URL direta ===");
  for (const p of PAGINAS_MEMBRO) {
    ok(`GET ${p} com não-membro -> 403`, (await status(p, "naomembro@vale.com")) === 403);
  }

  console.log("\n=== Sem cabeçalho nenhum (fora do Databricks Apps): também bloqueado ===");
  for (const p of PAGINAS_MEMBRO) {
    ok(`GET ${p} sem X-Forwarded-Email -> 403`, (await status(p, null)) === 403);
  }

  console.log("\n=== admin.html / aprovacao.html continuam com a regra própria (sem regressão) ===");
  ok("GET /admin.html com não-membro -> 403", (await status("/admin.html", "naomembro@vale.com")) === 403);
  ok("GET /aprovacao.html com não-membro -> 403", (await status("/aprovacao.html", "naomembro@vale.com")) === 403);

  console.log("\n=== APIs continuam protegidas por acesso direto ===");
  ok("GET /api/kaizens com não-membro -> 403", (await status("/api/kaizens", "naomembro@vale.com")) === 403);
  ok("GET /api/kaizens sem cabeçalho -> 403", (await status("/api/kaizens", null)) === 403);

  console.log("\n=== Página de bloqueio: título, mensagem e sem vazamento de dado ===");
  const r = await fetch(BASE + "/biblioteca.html", { headers: { "X-Forwarded-Email": "naomembro@vale.com" } });
  const corpo = await r.text();
  ok("título 'Acesso não autorizado'", corpo.includes("Acesso não autorizado"));
  ok("mensagem exata pedida", corpo.includes("Seu usuário não possui acesso ao Sistema Kaizen. Caso necessite acesso, entre em contato com o administrador da aplicação."));
  ok("botão Atualizar presente", corpo.includes(">Atualizar<"));
  ok("não expõe o e-mail do usuário na página", !corpo.includes("naomembro@vale.com"));
  ok("não expõe nome de tabela/coluna do banco", !/kzn_mdm_hierarquia|CD_EMAIL|ID_USUARIO/i.test(corpo));

  console.log(`\n${passou} passaram, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})().catch((err) => { console.error("FALHA GERAL:", err.message); process.exit(1); });
