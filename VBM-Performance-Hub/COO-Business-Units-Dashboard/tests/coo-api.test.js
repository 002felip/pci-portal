// Testes do módulo de dados do COO (node --test). Banco simulado: runQuery falso, sem rede.
// Rodar na pasta do COO: npm test
process.env.COO_CACHE_TTL_S = '1';
process.env.COO_FRESCO_S = '1';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { criarCooRouter, carregarSql, agregarIndicadores, extrairFiltros, atualizacoesDoMes, CONSULTAS } = require('../coo-api');

const AGO = new Date(Date.UTC(2026, 7, 1));
const linha = (o) => Object.assign({ DT_REF: AGO, ID_SITE: 6, ID_OPERACAO: 1, ID_KPI: 10, NM_KPI: 'Mine Movement', ID_ORDEM: 1, SG_UNID: 'Mt', VL_CASADECIMAL: 1 }, o);
const DADOS = [
  linha({ ORDEM_GRAFICO: 0, NM_VISAO: 'Aug B', VL_KPI: 3 }),
  linha({ ORDEM_GRAFICO: 1, NM_VISAO: 'Aug P', VL_KPI: 4 }),
  linha({ ORDEM_GRAFICO: 2, NM_VISAO: 'Aug A', VL_KPI: 5 }),
  linha({ ORDEM_GRAFICO: 3, NM_VISAO: 'Q3B', VL_KPI: 9 }),
  linha({ ORDEM_GRAFICO: 4, NM_VISAO: 'Q3A', VL_KPI: 8 }),
  linha({ ORDEM_GRAFICO: 6, NM_VISAO: '26B', VL_KPI: 30 }),
  linha({ ORDEM_GRAFICO: 7, NM_VISAO: '26F', VL_KPI: 31 }),
  linha({ ID_SITE: 7, ORDEM_GRAFICO: 0, NM_VISAO: 'Aug B', VL_KPI: 99 }),
];

test('carregarSql troca o ID_DASH fixo pelo parâmetro nas duas consultas, na quantidade esperada', () => {
  for (const c of CONSULTAS) {
    const sql = carregarSql(c.arquivo, c.trocas);
    assert.ok(!/DASH\.ID_DASH = 15/.test(sql), c.arquivo);
    assert.strictEqual(sql.split('@idDash').length - 1, c.trocas[0].ocorrencias, c.arquivo);
  }
});

test('junções das consultas usam separador (sem colisão de CONCAT entre site/operação/KPI)', () => {
  for (const arq of ['coo_dashboard.sql', 'coo_dashboard_atualizacao.sql']) {
    const ativas = fs.readFileSync(path.join(__dirname, '..', 'database', arq), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--'));
    for (const l of ativas) if (/CONCAT\([^)]*ID_SITE/.test(l)) assert.match(l, /'\|'/, `${arq}: ${l.trim()}`);
  }
});

test('agregarIndicadores: séries por janela, unidade, casas decimais e letra A/F', () => {
  const r = agregarIndicadores(DADOS, { site: 6, ano: 2026, mes: 8 });
  const mes = r.find((x) => x.CD_VISAO === 'MONTH'), ano = r.find((x) => x.CD_VISAO === 'YEAR');
  assert.deepStrictEqual([mes.VL_B, mes.VL_P, mes.VL_AF, mes.LETRA_AF], [3, 4, 5, 'A']);
  assert.deepStrictEqual([ano.VL_B, ano.VL_AF, ano.LETRA_AF], [30, 31, 'F']);
  assert.strictEqual(mes.SG_UNID, 'Mt');
  assert.strictEqual(mes.CASA_DECIMAL, 1);
  assert.strictEqual(r.length, 3); // o site 7 não entra
});

test('agregarIndicadores: casas decimais inválidas ficam nulas', () => {
  const r = agregarIndicadores([linha({ ORDEM_GRAFICO: 0, NM_VISAO: 'Aug B', VL_KPI: 1, VL_CASADECIMAL: 'x' })], { site: 6, ano: 2026, mes: 8 });
  assert.strictEqual(r[0].CASA_DECIMAL, null);
});

test('extrairFiltros: ordem por ID_SITE, nome do banco vence o padrão, site sem nome fica fora', () => {
  const linhas = [linha({ ID_SITE: 42, ORDEM_GRAFICO: 2, NM_VISAO: 'Aug A' }), linha({ ID_SITE: 6, ORDEM_GRAFICO: 2, NM_VISAO: 'Aug A' }), linha({ ID_SITE: 99, ORDEM_GRAFICO: 0 })];
  const f = extrairFiltros(linhas, [{ ID_SITE: 6, NM_SITE: 'Salobo' }]);
  assert.deepStrictEqual(f.sites, [{ id: 6, nome: 'Salobo' }, { id: 42, nome: 'Discovery Hill' }]);
  assert.deepStrictEqual(f.semNome, [99]);
  assert.deepStrictEqual(f.ultimoRealizado, { ano: 2026, mes: 8 });
});

test('atualizacoesDoMes: VALIDATE 1/0/2 → ok/pendente/atrasado', () => {
  const l = (kpi, v) => ({ DT_REF: AGO, ID_SITE: 6, ID_OPERACAO: 1, ID_KPI: kpi, VALIDATE: v, DS_VALIDATE: v ? '.' : 'Pending final updates', DT_ATUALIZACAO: null });
  const m = atualizacoesDoMes([l(1, 1), l(2, 0), l(3, 2)], { site: 6, ano: 2026, mes: 8 });
  assert.deepStrictEqual([m.get('1|1').status, m.get('1|2').status, m.get('1|3').status], ['ok', 'pendente', 'atrasado']);
});

// ── Router com banco simulado ──
function servidor(runQuery) {
  const app = express();
  app.use('/api', criarCooRouter({ runQuery }));
  return new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
}
const get = (s, url, h) => fetch(`http://127.0.0.1:${s.address().port}${url}`, { headers: h }).then(async (r) => { const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch (e) { /* 404 do Express em HTML */ } return { status: r.status, json }; });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('parâmetros inválidos → 400; rotas brutas fechadas sem COO_DIAGNOSTICO', async () => {
  const s = await servidor(async () => ({ recordset: DADOS }));
  try {
    for (const q of ['site=abc&ano=2026&mes=8', 'site=6&ano=1999&mes=8', 'site=6&ano=2026&mes=13', 'site=6&site=7&ano=2026&mes=8']) {
      assert.strictEqual((await get(s, '/api/indicadores?' + q)).status, 400, q);
    }
    for (const r of ['/api/chart-data', '/api/atualizacoes', '/api/sites']) assert.strictEqual((await get(s, r)).status, 404, r);
  } finally { s.close(); }
});

test('pedidos simultâneos usam uma única leitura do banco', async () => {
  let leituras = 0;
  const s = await servidor(async (q) => { if (/PEDRAVISAO/.test(q)) leituras++; await espera(50); return { recordset: DADOS }; });
  try {
    const rs = await Promise.all(Array.from({ length: 10 }, () => get(s, '/api/indicadores?site=6&ano=2026&mes=8')));
    assert.ok(rs.every((r) => r.status === 200));
    assert.strictEqual(leituras, 1);
  } finally { s.close(); }
});

test('banco fora após uma leitura: serve o último resultado marcado como desatualizado', async () => {
  let falhar = false;
  const s = await servidor(async () => { if (falhar) throw new Error('Login failed'); return { recordset: DADOS }; });
  try {
    assert.strictEqual((await get(s, '/api/indicadores?site=6&ano=2026&mes=8')).json.desatualizado, false);
    falhar = true;
    await espera(1100); // cache de 1 s expirado
    const r = await get(s, '/api/indicadores?site=6&ano=2026&mes=8');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.desatualizado, true);
    assert.strictEqual(r.json.linhas.length, 3);
  } finally { s.close(); }
});

test('banco fora sem leitura anterior: 500 com mensagem genérica (sem detalhe do banco)', async () => {
  const s = await servidor(async () => { throw new Error('Login failed for user x at servidor-interno'); });
  try {
    const r = await get(s, '/api/indicadores?site=6&ano=2026&mes=8');
    assert.strictEqual(r.status, 500);
    assert.ok(!/servidor-interno|Login/.test(JSON.stringify(r.json)));
  } finally { s.close(); }
});

test('refresh (?fresco=1) relê o banco quando o resultado passou do limite', async () => {
  let leituras = 0;
  const s = await servidor(async (q) => { if (/PEDRAVISAO/.test(q)) leituras++; return { recordset: DADOS }; });
  try {
    await get(s, '/api/indicadores?site=6&ano=2026&mes=8');
    await get(s, '/api/indicadores?site=6&ano=2026&mes=8&fresco=1');
    assert.strictEqual(leituras, 1); // ainda dentro do limite
    await espera(1100);
    await get(s, '/api/indicadores?site=6&ano=2026&mes=8&fresco=1');
    assert.strictEqual(leituras, 2);
  } finally { s.close(); }
});

test('limite de pedidos por usuário → 429', async () => {
  const s = await servidor(async () => ({ recordset: DADOS }));
  try {
    const h = { 'X-Forwarded-Email': 'teste@vale.com' };
    let ultimo;
    for (let i = 0; i < 241; i++) ultimo = await get(s, '/api/ping', h);
    assert.strictEqual(ultimo.status, 429);
    assert.strictEqual((await get(s, '/api/ping', { 'X-Forwarded-Email': 'outro@vale.com' })).status, 200);
  } finally { s.close(); }
});

test('cadastroDoSite: KPIs cadastrados do site, na ordem do ID_ORDEM, casas inválidas nulas', () => {
  const { cadastroDoSite } = require('../coo-api');
  const c = cadastroDoSite([
    { ID_SITE: 42, ID_OPERACAO: 1, ID_KPI: 4, NM_KPI: ' Ore Mined (Dry) ', ID_ORDEM: 2, SG_UNID: 'Kt', VL_CASADECIMAL: 0 },
    { ID_SITE: 42, ID_OPERACAO: 1, ID_KPI: 15, NM_KPI: 'Equivalent Total Development', ID_ORDEM: 1, SG_UNID: 'Meters', VL_CASADECIMAL: 'x' },
    { ID_SITE: 36, ID_OPERACAO: 1, ID_KPI: 15, NM_KPI: 'Outro site', ID_ORDEM: 1 },
  ], 42);
  assert.deepStrictEqual(c.map((x) => [x.NM_KPI, x.CASA_DECIMAL]), [['Equivalent Total Development', null], ['Ore Mined (Dry)', 0]]);
});

test('situação de mês projetado segue o mês do ciclo (último realizado)', () => {
  const { periodoDaSituacao } = require('../coo-api');
  const ciclo = { ano: 2026, mes: 9 };
  assert.deepStrictEqual(periodoDaSituacao({ site: 6, ano: 2026, mes: 12 }, ciclo), { site: 6, ano: 2026, mes: 9 });
  assert.deepStrictEqual(periodoDaSituacao({ site: 6, ano: 2026, mes: 9 }, ciclo), { site: 6, ano: 2026, mes: 9 });
  assert.deepStrictEqual(periodoDaSituacao({ site: 6, ano: 2026, mes: 3 }, ciclo), { site: 6, ano: 2026, mes: 3 });
  assert.deepStrictEqual(periodoDaSituacao({ site: 6, ano: 2027, mes: 1 }, ciclo), { site: 6, ano: 2026, mes: 9 });
});
