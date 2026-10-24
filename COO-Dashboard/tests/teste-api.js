/* Testes do modo STANDALONE (server.js com o dublê do mssql).
   Uso: PORT=3990 node -r ./tests/preload.js server.js & ; BASE=http://localhost:3990 node tests/teste-api.js */
const BASE = process.env.BASE || 'http://localhost:3990';
const MEMBRO = { 'X-Forwarded-Email': 'membro@vale.com' };
let falhas = 0, total = 0;
function ok(cond, msg) { total++; if (cond) console.log('  OK   ' + msg); else { falhas++; console.log('  FALHA ' + msg); } }
async function get(caminho, headers = {}) {
  const r = await fetch(BASE + caminho, { headers: { Accept: 'application/json', ...headers }, redirect: 'manual' });
  let corpo = null; const txt = await r.text();
  try { corpo = JSON.parse(txt); } catch (e) { corpo = txt; }
  return { status: r.status, h: r.headers, corpo };
}

(async () => {
  console.log('=== Diagnóstico (sem login) ===');
  let r = await get('/api/ping');
  ok(r.status === 200 && r.corpo.ok === true, '/api/ping responde sem tocar no banco');
  r = await get('/api/health');
  ok(r.status === 200 && r.corpo.status === 'healthy', '/api/health = healthy');
  ok(!JSON.stringify(r.corpo).includes('teste') || !('password' in r.corpo), 'health não expõe usuário/senha');

  console.log('=== Controle de acesso (deny by default) ===');
  r = await get('/api/unidades');
  ok(r.status === 403, 'sem X-Forwarded-Email → 403');
  r = await get('/api/unidades', { 'X-Forwarded-Email': 'estranho@vale.com' });
  ok(r.status === 403, 'e-mail fora de IBP.USERS → 403');
  r = await get('/api/unidades', { 'X-Forwarded-Email': 'semmatricula@vale.com' });
  ok(r.status === 403, 'usuário sem CD_MATRICULA → 403');
  r = await get('/', { Accept: 'text/html' });
  ok(r.status === 403 && /Acesso não autorizado/.test(r.corpo), 'página sem login → tela de acesso negado (403)');
  r = await get('/', { ...MEMBRO, Accept: 'text/html' });
  ok(r.status === 200 && /COO – Business Units Dashboard/.test(r.corpo), 'página com usuário autorizado → 200');

  console.log('=== Dados ===');
  r = await get('/api/unidades', MEMBRO);
  ok(r.status === 200 && Array.isArray(r.corpo) && r.corpo.some(p => p.pais === 'Brasil' && p.sites.some(s => s.nome === 'Sossego' && s.id === 11)), '/api/unidades agrupa sites por país');
  const nomes = (r.corpo || []).flatMap(p => p.sites.map(s => s.nome)).sort().join(',');
  ok(nomes === 'Salobo,Sossego', '/api/unidades só com Sossego e Salobo (Sudbury fora do escopo)');
  ok(/no-store/.test(r.h.get('cache-control') || ''), 'API com Cache-Control: no-store');
  r = await get('/api/indicadores?site=11&ano=2026&mes=9', MEMBRO);
  const porVisao = {}; (r.corpo.linhas || []).forEach(l => { porVisao[l.CD_VISAO] = l; });
  ok(r.status === 200 && r.corpo.linhas.length === 3 && porVisao.MONTH.NM_KPI === 'Mine Movement', '/api/indicadores devolve MONTH/QUARTER/YEAR do script');
  ok(porVisao.MONTH.VL_B === 2 && porVisao.MONTH.VL_AF === 2.4 && porVisao.MONTH.LETRA_AF === 'A', 'mês: Budget/Actual corretos (Plan e outros meses não vazam)');
  ok(porVisao.QUARTER.VL_B === 6 && porVisao.QUARTER.VL_AF === 6.5 && porVisao.YEAR.VL_AF === 28 && porVisao.YEAR.LETRA_AF === 'F', 'trimestre e ano corretos, letra F no ano');
  r = await get('/api/indicadores?site=10&ano=2026&mes=9', MEMBRO);
  ok(r.status === 200 && r.corpo.linhas.length === 0, 'site sem dados → lista vazia (página usa exemplo)');
  r = await get('/api/indicadores?site=20&ano=2026&mes=9', MEMBRO);
  ok(r.status === 404, 'site fora do escopo (Sudbury) → 404 mesmo pedido direto');
  r = await get('/api/atualizacao?site=20&ano=2026&mes=9', MEMBRO);
  ok(r.status === 404, '/api/atualizacao fora do escopo → 404');
  r = await get('/api/atualizacao?site=11&ano=2026&mes=9', MEMBRO);
  ok(r.status === 200 && r.corpo.linhas.length === 1 && r.corpo.linhas[0].DS_VALIDATE === 'Pending final updates', '/api/atualizacao filtra site e mês');
  r = await get('/api/indicadores?site=abc&ano=2026&mes=9', MEMBRO);
  ok(r.status === 400, 'site não numérico → 400');
  r = await get('/api/indicadores?site=11&ano=2026&mes=13', MEMBRO);
  ok(r.status === 400, 'mês fora de 1–12 → 400');
  r = await get("/api/indicadores?site=11;DROP%20TABLE%20x&ano=2026&mes=9", MEMBRO);
  ok(r.status === 400, 'tentativa de injeção no parâmetro → 400 (nunca chega à SQL)');

  console.log('=== Arquivos internos nunca são servidos ===');
  for (const f of ['/server.js', '/app.yaml', '/.env', '/package.json', '/acesso.js', '/coo-api.js', '/tests/env-exemplo.sh', '/database/coo_dashboard.sql', '/COO-Dashboard/server.js', '/../server.js']) {
    r = await get(f, MEMBRO);
    ok(r.status === 404, `${f} → 404`);
  }

  console.log('=== Cabeçalhos de segurança ===');
  r = await get('/api/ping');
  ok(r.h.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
  ok(!!r.h.get('x-frame-options'), 'X-Frame-Options presente');
  ok(!r.h.get('x-powered-by'), 'sem X-Powered-By');

  console.log(`\n${total - falhas}/${total} verificações OK`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
