/* Testes do modo PORTAL: monta portal.js num Express como o server.js do
   Portal faria (com o dublê do mssql) e confere rotas e arquivos bloqueados.
   O controle de acesso aqui é do Portal (portal-acesso.js), fora desta pasta.
   Uso: node -r ./tests/preload.js tests/teste-portal.js */
const path = require('path');
const express = require('express');
const app = express();
require(path.join(__dirname, '..', 'portal'))(app);

let falhas = 0, total = 0;
function ok(cond, msg) { total++; if (cond) console.log('  OK   ' + msg); else { falhas++; console.log('  FALHA ' + msg); } }

const srv = app.listen(0, async () => {
  const BASE = `http://localhost:${srv.address().port}`;
  const get = async (c) => { const r = await fetch(BASE + c, { redirect: 'manual' }); return { status: r.status, h: r.headers, txt: await r.text() }; };
  try {
    console.log('=== Portal: /COO-Dashboard ===');
    let r = await get('/COO-Dashboard');
    ok(r.status === 301 && r.h.get('location') === '/COO-Dashboard/', '/COO-Dashboard redireciona para a barra final');
    r = await get('/COO-Dashboard/');
    ok(r.status === 200 && /COO – Business Units Dashboard/.test(r.txt), 'página servida em /COO-Dashboard/');
    r = await get('/COO-Dashboard/api/health');
    ok(r.status === 200 && JSON.parse(r.txt).status === 'healthy', '/COO-Dashboard/api/health = healthy');
    r = await get('/COO-Dashboard/api/unidades');
    ok(r.status === 200 && JSON.parse(r.txt).length >= 1, '/COO-Dashboard/api/unidades responde');
    for (const f of ['server.js', 'portal.js', 'coo-api.js', 'acesso.js', 'app.yaml', 'package.json', '.env', '.env.example', 'docs/DEPLOYMENT.md', 'tests/fake-mssql.js', 'database/coo_dashboard.sql', 'database/coo_dashboard_atualizacao.sql']) {
      r = await get('/COO-Dashboard/' + f);
      ok(r.status === 404, `/COO-Dashboard/${f} → 404`);
    }
  } catch (e) { falhas++; console.error(e); }
  console.log(`\n${total - falhas}/${total} verificações OK`);
  srv.close(); process.exit(falhas ? 1 : 0);
});
