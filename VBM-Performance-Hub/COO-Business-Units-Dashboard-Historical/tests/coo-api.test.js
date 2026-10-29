// Testes do módulo de dados do COO Historical (node --test). Banco simulado: runQuery falso, sem rede.
// Rodar na pasta do Historical: npm test
process.env.COO_CACHE_TTL_S = '1';
process.env.COO_FRESCO_S = '1';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { criarCooRouter, carregarSql, agregarAnual, extrairFiltros, sitePermitido, lerCiclo, ANUAL, ANO_INICIAL, CICLOS_SQL } = require('../coo-api');

const linha = (o) => Object.assign({ ID_SITE: 6, ID_OPERACAO: 1, ID_KPI: 10, NM_KPI: 'Mine Movement', ID_ORDEM: 1, SG_UNID: 'Mt', VL_CASADECIMAL: 1 }, o);
const ANUAIS = [
  linha({ ANO: 2025, SERIE: 'B', NM_VISAO: '25B', VL_KPI: 120 }),
  linha({ ANO: 2025, SERIE: 'AF', NM_VISAO: '25A', VL_KPI: 118 }),
  linha({ ANO: 2026, SERIE: 'B', NM_VISAO: '26B', VL_KPI: 135 }),
  linha({ ANO: 2026, SERIE: 'AF', NM_VISAO: '26F', VL_KPI: 135 }),
  linha({ ID_SITE: 26, ANO: 2026, SERIE: 'AF', NM_VISAO: '26F', VL_KPI: 7, NM_KPI: 'Matsusaka Production' }),
  linha({ ID_SITE: 40, ANO: 2026, SERIE: 'AF', NM_VISAO: '26F', VL_KPI: 1 }), // Coleman (mina): fora do Historical
];
const SITES = [{ ID_SITE: 6, NM_SITE: 'Salobo' }, { ID_SITE: 26, NM_SITE: 'Matsusaka' }, { ID_SITE: 40, NM_SITE: 'Coleman' }, { ID_SITE: 9, NM_SITE: 'Ontario' }];

test('SQL anual: lê só a visão ANUAL da tabela do COO, com @idDash e @dtRef e sem ID_DASH fixo', () => {
  const sql = carregarSql(ANUAL.arquivo, ANUAL.parametros);
  assert.match(sql, /FROM IBP\.PHUB_PERFORMANCESTUDIO R/);
  assert.match(sql, /R\.CD_PERIODO = 'YEAR'/);
  assert.match(sql, /R\.ORDEM_ANO >= @anoIni/);
  assert.ok(!/'MONTH'|'QUARTER'/.test(sql.replace(/\/\*[\s\S]*?\*\//g, '')), 'mês/trimestre não podem ser lidos');
  assert.ok(!/ID_DASH\s*=\s*\d/.test(sql));
});

test('SQL anual: junção com separador (sem colisão de CONCAT entre site/operação/KPI)', () => {
  const ativas = fs.readFileSync(path.join(__dirname, '..', 'database', ANUAL.arquivo), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--'));
  for (const l of ativas) if (/CONCAT\([^)]*ID_SITE/.test(l)) assert.match(l, /'\|'/, l.trim());
});

test('agregarAnual: B e A/F por ano, letra do script, unidade e casas decimais', () => {
  const [k] = agregarAnual(ANUAIS, 6);
  assert.deepStrictEqual(k.ANOS, { 2025: { VL_B: 120, VL_AF: 118, LETRA_AF: 'A' }, 2026: { VL_B: 135, VL_AF: 135, LETRA_AF: 'F' } });
  assert.strictEqual(k.SG_UNID, 'Mt');
  assert.strictEqual(k.CASA_DECIMAL, 1);
  assert.strictEqual(agregarAnual(ANUAIS, 6).length, 1); // só o site pedido
});

test('Business Units do Historical: as 7 BUs e as refinarias da IR; minas e outras unidades ficam fora', () => {
  for (const n of ['Salobo', 'Sossego', 'Onça Puma', 'Manitoba', 'VNL', 'Ontario', 'IR', 'International Refineries']) assert.ok(sitePermitido(1, n), n);
  assert.ok(sitePermitido(26, 'Matsusaka'));
  assert.ok(sitePermitido(16, 'Clydach'));
  for (const n of ['Coleman', 'Copper Cliff', 'Eastern Deeps', 'Thompson', 'Voisey']) assert.ok(!sitePermitido(99, n), n);
});

test('extrairFiltros: só sites permitidos com dados anuais, anos em ordem', () => {
  const f = extrairFiltros(ANUAIS, SITES);
  assert.deepStrictEqual(f.sites, [{ id: 6, nome: 'Salobo' }, { id: 26, nome: 'Matsusaka' }]);
  assert.deepStrictEqual(f.anos, [2025, 2026]);
});

test('lerCiclo: AAAA-MM válido, vazio e inválido', () => {
  assert.strictEqual(lerCiclo('2026-10'), '2026-10');
  assert.strictEqual(lerCiclo('2026-10-01'), '2026-10');
  assert.strictEqual(lerCiclo(''), null);
  assert.strictEqual(lerCiclo('2026-13'), undefined);
});

// Router com banco simulado: responde pelo texto da SQL
function app(consultas) {
  const runQuery = async (sql, params) => {
    consultas.push({ sql, params });
    if (sql === CICLOS_SQL) return { recordset: [{ DT_REF: new Date(Date.UTC(2026, 9, 1)), DT_CARGA: new Date(Date.UTC(2026, 9, 20, 16, 52)) }] };
    if (/CD_PERIODO = 'YEAR'/.test(sql)) return { recordset: ANUAIS };
    if (/FROM IBP\.SITES/.test(sql)) return { recordset: SITES };
    if (/IBP\.PHUB_PS_SETUP/.test(sql)) return { recordset: [] };
    if (/SELECT DISTINCT DASH\.ID_SITE/.test(sql)) return { recordset: [] };
    throw new Error('consulta inesperada');
  };
  const a = express();
  a.use('/api', criarCooRouter({ runQuery }));
  return a;
}
async function get(a, url) {
  const srv = a.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${url}`);
    const txt = await r.text();
    let body = null; try { body = JSON.parse(txt); } catch (e) { /* 404 padrão do express (HTML) */ }
    return { status: r.status, body };
  } finally { srv.close(); }
}

test('rotas: filtros e indicadores com a série anual; ciclo vira @dtRef; site fora do Historical → 404', async () => {
  const consultas = [];
  const a = app(consultas);
  const f = await get(a, '/api/filtros?ciclo=2026-10');
  assert.strictEqual(f.status, 200);
  assert.deepStrictEqual(f.body.anos, [2025, 2026]);
  const anual = consultas.find((c) => /CD_PERIODO = 'YEAR'/.test(c.sql));
  assert.strictEqual(anual.params.dtRef[1].toISOString().slice(0, 10), '2026-10-01');
  assert.strictEqual(anual.params.anoIni[1], 2017); // série histórica desde 2017 (COO_HIST_ANO_INICIAL)
  assert.strictEqual(ANO_INICIAL, 2017);

  const i = await get(a, '/api/indicadores?site=6&ciclo=2026-10');
  assert.strictEqual(i.status, 200);
  assert.strictEqual(i.body.linhas[0].ANOS[2025].LETRA_AF, 'A');
  assert.strictEqual(i.body.geradoEm, '2026-10-20T16:52:00.000Z');

  assert.strictEqual((await get(a, '/api/indicadores?site=40&ciclo=2026-10')).status, 404);
  assert.strictEqual((await get(a, '/api/indicadores?site=abc')).status, 400);
  assert.strictEqual((await get(a, '/api/filtros?ciclo=2026-11')).status, 404);
});

test('rotas do COO mensal não existem no Historical', async () => {
  const a = app([]);
  for (const r of ['/api/atualizacao?site=6&ano=2026&mes=9', '/api/chart-data', '/api/atualizacoes']) {
    assert.strictEqual((await get(a, r)).status, 404, r);
  }
});
