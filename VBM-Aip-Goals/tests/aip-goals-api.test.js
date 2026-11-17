// Testes do módulo de dados do AIP Goals (node --test). Sem banco e sem rede.
// Rodar na pasta do AIP Goals: npm test
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const path = require('path');
const { criarAipGoalsRouter, diasUteisEntre, enriquecer } = require('../aip-goals-api');
const { pendenciasExemplo } = require('../dados-exemplo');

// Segunda-feira, 16/11/2026
const HOJE = new Date(2026, 10, 16, 10, 0, 0);

async function servidor(router, montar) {
  const app = express();
  if (montar) montar(app); else app.use('/api', router);
  return new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
}
async function pedir(s, caminho, headers = {}) {
  const r = await fetch(`http://127.0.0.1:${s.address().port}${caminho}`, { headers });
  let corpo = null; try { corpo = await r.json(); } catch (e) { /* sem JSON */ }
  return { status: r.status, corpo, headers: r.headers };
}

test('diasUteisEntre ignora fins de semana e não conta o dia inicial', () => {
  assert.strictEqual(diasUteisEntre('2026-11-13', HOJE), 1); // sexta → segunda
  assert.strictEqual(diasUteisEntre('2026-11-09', HOJE), 5); // segunda anterior
  assert.strictEqual(diasUteisEntre('2026-11-16', HOJE), 0);
  assert.strictEqual(diasUteisEntre('2026-11-20', HOJE), 0); // futuro
});

test('enriquecer: parada só ACIMA do limite de dias úteis (RN-14) e atrasada pelo prazo', () => {
  const r = enriquecer({ parametros: { diasParado: 3 }, itens: [
    { id: 'a', tipo: 'decidir', estado: 'em_aprovacao', desde: '2026-11-11', prazo: '2026-11-20' }, // 3 dias úteis
    { id: 'b', tipo: 'decidir', estado: 'em_aprovacao', desde: '2026-11-10', prazo: '2026-11-13' }, // 4 dias úteis, venceu
    { id: 'c', tipo: 'invalido', estado: 'em_aprovacao', desde: '2026-11-10' },
  ] }, HOJE);
  assert.deepStrictEqual(r.itens.map((i) => [i.id, i.diasUteis, i.parada, i.atrasada]), [['a', 3, false, false], ['b', 4, true, true]]);
});

test('dados de exemplo: só tipos e estados válidos, datas coerentes com o dia', () => {
  const d = enriquecer(pendenciasExemplo(HOJE), HOJE);
  assert.ok(d.itens.length >= 5);
  assert.ok(d.itens.some((i) => i.parada) && d.itens.some((i) => i.atrasada));
  assert.ok(d.itens.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.desde)));
});

test('GET /pendencias exige a identidade do proxy (X-Forwarded-Email)', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const sem = await pedir(s, '/api/pendencias');
    assert.strictEqual(sem.status, 401);
    const com = await pedir(s, '/api/pendencias', { 'X-Forwarded-Email': 'pessoa@vale.com' });
    assert.strictEqual(com.status, 200);
    assert.strictEqual(com.corpo.exemplo, true);
    assert.ok(Array.isArray(com.corpo.itens) && com.corpo.itens.every((i) => 'parada' in i && 'atrasada' in i && 'diasUteis' in i));
  } finally { s.close(); }
});

test('fonte "banco" sem modelo de dados responde 501 sem texto do banco', async () => {
  const s = await servidor(criarAipGoalsRouter({ fonte: 'banco', runQuery: async () => ({ recordset: [] }) }));
  try {
    const r = await pedir(s, '/api/pendencias', { 'X-Forwarded-Email': 'pessoa@vale.com' });
    assert.strictEqual(r.status, 501);
    assert.strictEqual(r.corpo.codigo, 'MODELO_PENDENTE');
  } finally { s.close(); }
});

test('portal.js: só index.html e assets/ são públicos; arquivos internos dão 404', async () => {
  const montar = require('../portal');
  const raiz = path.join(__dirname, '..');
  const s = await servidor(null, (app) => { montar(app); app.use('/VBM-Aip-Goals', express.static(raiz)); });
  try {
    for (const interno of ['portal.js', 'aip-goals-api.js', 'dados-exemplo.js', 'server.js', 'package.json', 'tests/aip-goals-api.test.js', 'assets/../portal.js']) {
      assert.strictEqual((await pedir(s, '/VBM-Aip-Goals/' + interno)).status, 404, interno);
    }
    assert.strictEqual((await pedir(s, '/VBM-Aip-Goals/api/health')).corpo.status, 'healthy');
    const pag = await fetch(`http://127.0.0.1:${s.address().port}/VBM-Aip-Goals/index.html`);
    assert.strictEqual(pag.status, 200);
  } finally { s.close(); }
});

test('GET /painel: contagens batem com a lista de cards (CA-15) e o funil não cresce', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const r = await pedir(s, '/api/painel', { 'X-Forwarded-Email': 'pessoa@vale.com' });
    assert.strictEqual(r.status, 200);
    const { cards, totais, porBu, funil, niveis } = r.corpo;
    assert.strictEqual(totais.total, cards.length);
    for (const e of ['rascunho', 'em_aprovacao', 'em_revisao', 'aprovado', 'negado']) {
      assert.strictEqual(totais[e], cards.filter((c) => c.estado === e).length, e);
      assert.strictEqual(porBu.reduce((a, b) => a + b[e], 0), totais[e], 'matriz ' + e);
    }
    for (const linha of porBu) assert.strictEqual(linha.total, cards.filter((c) => c.bu.sigla === linha.bu.sigla).length, linha.bu.sigla);
    for (let i = 1; i < funil.length; i++) assert.ok(funil[i].n <= funil[i - 1].n, 'funil ' + funil[i].id);
    assert.strictEqual(niveis.reduce((a, n) => a + n.cards, 0), totais.em_aprovacao);
  } finally { s.close(); }
});

test('GET /painel: filtro País › BU validado e aplicado', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const h = { 'X-Forwarded-Email': 'pessoa@vale.com' };
    const br = await pedir(s, '/api/painel?pais=' + encodeURIComponent('Brasil'), h);
    assert.ok(br.corpo.cards.length > 0 && br.corpo.cards.every((c) => c.bu.pais === 'Brasil'));
    const sal = await pedir(s, '/api/painel?pais=Brasil&bu=Salobo', h);
    assert.ok(sal.corpo.cards.every((c) => c.bu.sigla === 'Salobo'));
    assert.strictEqual((await pedir(s, '/api/painel?pais=Chile', h)).status, 400);
    assert.strictEqual((await pedir(s, '/api/painel?pais=Brasil&bu=VNL', h)).status, 400);
    assert.strictEqual((await pedir(s, '/api/painel')).status, 401);
  } finally { s.close(); }
});
