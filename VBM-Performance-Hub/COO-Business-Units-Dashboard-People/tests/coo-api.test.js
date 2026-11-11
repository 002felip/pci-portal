// Testes do módulo de dados do COO People (node --test). Banco simulado: runQuery falso, sem rede.
// Rodar na pasta do COO People: npm test
process.env.COO_CACHE_TTL_S = '1';
process.env.COO_FRESCO_S = '1';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { criarCooRouter, carregarSql, agregarIndicadores, extrairFiltros, atualizacoesDoMes, mesDoCicloDaCarga, lerCiclo, CONSULTAS, CICLOS_SQL, SNAPSHOT_SQL, STATUS_SQL } = require('../coo-api');

const AGO = new Date(Date.UTC(2026, 7, 1));
const linha = (o) => Object.assign({ DT_REF: AGO, ID_SITE: 6, ID_OPERACAO: 1, ID_KPI: 717, NM_KPI: 'Headcount VBM', ID_ORDEM: 1, SG_UNID: '#', VL_CASADECIMAL: 1 }, o);
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
    assert.ok(!/DASH\.ID_DASH = (15|20)/.test(sql), c.arquivo);
    assert.strictEqual(sql.split('@idDash').length - 1, c.trocas[0].ocorrencias, c.arquivo);
  }
});

test('junções das consultas usam separador (sem colisão de CONCAT entre site/operação/KPI)', () => {
  for (const arq of ['001_coo_people_dashboard.sql', '002_coo_people_dashboard_atualizacao.sql']) {
    const ativas = fs.readFileSync(path.join(__dirname, '..', 'database', arq), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--'));
    for (const l of ativas) if (/CONCAT\([^)]*ID_SITE/.test(l)) assert.match(l, /'\|'/, `${arq}: ${l.trim()}`);
  }
});

test('agregarIndicadores: séries por janela, unidade, casas decimais e letra A/F', () => {
  const r = agregarIndicadores(DADOS, { site: 6, ano: 2026, mes: 8 });
  const mes = r.find((x) => x.CD_VISAO === 'MONTH'), ano = r.find((x) => x.CD_VISAO === 'YEAR');
  assert.deepStrictEqual([mes.VL_B, mes.VL_P, mes.VL_AF, mes.LETRA_AF], [3, 4, 5, 'A']);
  assert.deepStrictEqual([ano.VL_B, ano.VL_AF, ano.LETRA_AF], [30, 31, 'F']);
  assert.strictEqual(mes.SG_UNID, '#');
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
// Cargas gravadas em IBP.PHUB_PERFORMANCESTUDIO (mais recente primeiro) e o banco simulado: /ciclos → CICLOS, carga → DADOS
const CARGA_OUT = new Date(Date.UTC(2026, 9, 28, 10, 0, 0));
const CICLOS = [{ DT_REF: new Date(Date.UTC(2026, 9, 1)), DT_CARGA: CARGA_OUT }, { DT_REF: new Date(Date.UTC(2026, 8, 1)), DT_CARGA: null }];
const ehCarga = (q) => q === SNAPSHOT_SQL;
const banco = (dados = DADOS, ciclos = CICLOS) => async (q) => ({ recordset: q === CICLOS_SQL ? ciclos : dados });

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
  const s = await servidor(async (q, p) => { if (ehCarga(q)) leituras++; await espera(50); return banco()(q, p); });
  try {
    const rs = await Promise.all(Array.from({ length: 10 }, () => get(s, '/api/indicadores?site=6&ano=2026&mes=8')));
    assert.ok(rs.every((r) => r.status === 200));
    assert.strictEqual(leituras, 1);
  } finally { s.close(); }
});

test('banco fora após uma leitura: serve o último resultado marcado como desatualizado', async () => {
  let falhar = false;
  const s = await servidor(async (q, p) => { if (falhar) throw new Error('Login failed'); return banco()(q, p); });
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
  const s = await servidor(async (q, p) => { if (ehCarga(q)) leituras++; return banco()(q, p); });
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

test('cadastroDoSite: KPIs de People do site, na ordem de apresentação (não a do ID_ORDEM), casas inválidas nulas', () => {
  const { cadastroDoSite } = require('../coo-api');
  const c = cadastroDoSite([
    { ID_SITE: 42, ID_OPERACAO: 1, ID_KPI: 773, NM_KPI: ' Turnover ', ID_ORDEM: 1, SG_UNID: '%', VL_CASADECIMAL: 2 },
    { ID_SITE: 42, ID_OPERACAO: 1, ID_KPI: 10, NM_KPI: 'Fora de People', ID_ORDEM: 0 },
    { ID_SITE: 42, ID_OPERACAO: 1, ID_KPI: 717, NM_KPI: 'Headcount VBM', ID_ORDEM: 9, SG_UNID: '#', VL_CASADECIMAL: 'x' },
    { ID_SITE: 36, ID_OPERACAO: 1, ID_KPI: 717, NM_KPI: 'Outro site', ID_ORDEM: 1 },
  ], 42);
  assert.deepStrictEqual(c.map((x) => [x.NM_KPI, x.CASA_DECIMAL]), [['Headcount VBM', null], ['Turnover', 2]]);
});

test('situação de mês projetado segue o mês do ciclo (último realizado)', () => {
  const { periodoDaSituacao } = require('../coo-api');
  const ciclo = { ano: 2026, mes: 9 };
  assert.deepStrictEqual(periodoDaSituacao({ site: 6, ano: 2026, mes: 12 }, ciclo), { site: 6, ano: 2026, mes: 9 });
  assert.deepStrictEqual(periodoDaSituacao({ site: 6, ano: 2026, mes: 9 }, ciclo), { site: 6, ano: 2026, mes: 9 });
  assert.deepStrictEqual(periodoDaSituacao({ site: 6, ano: 2026, mes: 3 }, ciclo), { site: 6, ano: 2026, mes: 3 });
  assert.deepStrictEqual(periodoDaSituacao({ site: 6, ano: 2027, mes: 1 }, ciclo), { site: 6, ano: 2026, mes: 9 });
});

test('mês do ciclo = mês anterior ao atual', () => {
  const { mesDoCiclo } = require('../coo-api');
  assert.deepStrictEqual(mesDoCiclo(new Date(2026, 9, 28)), { ano: 2026, mes: 9 });  // outubro → setembro
  assert.deepStrictEqual(mesDoCiclo(new Date(2026, 10, 3)), { ano: 2026, mes: 10 }); // novembro → outubro
  assert.deepStrictEqual(mesDoCiclo(new Date(2027, 0, 10)), { ano: 2026, mes: 12 }); // janeiro → dezembro anterior
});

test('consultas sem SELECT de depuração ativo (um 2º resultado esvaziaria o dashboard)', () => {
  for (const arq of ['001_coo_people_dashboard.sql', '002_coo_people_dashboard_atualizacao.sql']) {
    const ativas = fs.readFileSync(path.join(__dirname, '..', 'database', arq), 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith('--'));
    assert.ok(!ativas.some((l) => /^\s*select\s+@\w+\s*$/i.test(l)), arq);
  }
});

test('mês do ciclo acompanha o GETDATE()-2 das queries (dias 1 e 2 ainda no ciclo anterior)', () => {
  const { mesDoCiclo } = require('../coo-api');
  assert.deepStrictEqual(mesDoCiclo(new Date(2026, 10, 1, 12)), { ano: 2026, mes: 9 });  // 1/nov → setembro
  assert.deepStrictEqual(mesDoCiclo(new Date(2026, 10, 3, 12)), { ano: 2026, mes: 10 }); // 3/nov → outubro
});

test('lerCiclo e mês do ciclo da carga (2026-10 = realizado até setembro; janeiro → dezembro anterior)', () => {
  assert.strictEqual(lerCiclo('2026-10'), '2026-10');
  assert.strictEqual(lerCiclo('2026-10-01'), '2026-10');
  assert.strictEqual(lerCiclo(''), null);
  for (const v of ['2026-13', '26-10', '2026-10-02', ['2026-10', '2026-09']]) assert.strictEqual(lerCiclo(v), undefined, String(v));
  assert.deepStrictEqual(mesDoCicloDaCarga('2026-10'), { ano: 2026, mes: 9 });
  assert.deepStrictEqual(mesDoCicloDaCarga('2027-01'), { ano: 2026, mes: 12 });
});

test('leitura da carga: só a tabela do VBM, filtrada por dashboard e DT_REF, ORDEM_GRAFICO refeito do período e da série', () => {
  assert.match(SNAPSHOT_SQL, /FROM IBP\.PHUB_PERFORMANCESTUDIO R/);
  assert.match(SNAPSHOT_SQL, /R\.ID_DASH = @idDash\s+AND R\.DT_REF = @dtRef\s+AND R\.ID_KPI IN \(717, 768, 774, 773, 772, 761, 771, 769, 770\)/);
  assert.doesNotMatch(SNAPSHOT_SQL, /PEDRAVISAO/);
  assert.match(SNAPSHOT_SQL, /'MONTH'\s+THEN CASE R\.ID_TIPO_VISAO WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END/);
  assert.match(SNAPSHOT_SQL, /'QUARTER' THEN CASE R\.ID_TIPO_VISAO WHEN 1 THEN 3 ELSE 4 END/);
  assert.match(SNAPSHOT_SQL, /'YEAR'\s+THEN CASE R\.ID_TIPO_VISAO WHEN 1 THEN 6 ELSE 7 END/);
});

test('/ciclos lista as cargas; /indicadores usa o ciclo pedido (ou o mais recente) com a hora da carga', async () => {
  const pedidos = [];
  const s = await servidor(async (q, p) => { if (ehCarga(q)) pedidos.push(p.dtRef[1].toISOString().slice(0, 10)); return banco()(q, p); });
  try {
    assert.deepStrictEqual((await get(s, '/api/ciclos')).json.ciclos.map((c) => c.ciclo), ['2026-10', '2026-09']);
    const r = await get(s, '/api/indicadores?site=6&ano=2026&mes=8');
    assert.strictEqual(r.json.ciclo, '2026-10');
    assert.strictEqual(r.json.geradoEm, CARGA_OUT.toISOString());
    assert.strictEqual(r.json.linhas.length, 3);
    assert.strictEqual((await get(s, '/api/filtros?ciclo=2026-09')).json.ciclo, '2026-09');
    assert.deepStrictEqual(pedidos, ['2026-10-01', '2026-09-01']); // um cache por ciclo
  } finally { s.close(); }
});

test('ciclo inválido → 400; ciclo sem carga → 404; nenhuma carga → 404 sem consulta ao vivo', async () => {
  let aoVivo = 0;
  const s = await servidor(async (q, p) => { if (/PEDRAVISAO/.test(q)) aoVivo++; return banco()(q, p); });
  const vazio = await servidor(async (q, p) => { if (/PEDRAVISAO/.test(q)) aoVivo++; return banco(DADOS, [])(q, p); });
  try {
    assert.strictEqual((await get(s, '/api/indicadores?site=6&ano=2026&mes=8&ciclo=2026-13')).status, 400);
    assert.strictEqual((await get(s, '/api/atualizacao?site=6&ano=2026&mes=8&ciclo=x')).status, 400);
    const r = await get(s, '/api/filtros?ciclo=2025-01');
    assert.deepStrictEqual([r.status, r.json.codigo], [404, 'CICLO']);
    const v = await get(vazio, '/api/filtros');
    assert.deepStrictEqual([v.status, v.json.codigo], [404, 'SEM_CICLO']);
    assert.strictEqual(aoVivo, 0);
  } finally { s.close(); vazio.close(); }
});

test('/atualizacao: situação lida da carga (SG_STATUS), mês projetado segue o mês do ciclo, sem consulta ao vivo', async () => {
  const set = new Date(Date.UTC(2026, 8, 1)), out = new Date(Date.UTC(2026, 9, 1)), dt = new Date(Date.UTC(2026, 9, 5));
  const l = (d, kpi, st) => ({ DT_REF: d, ID_SITE: 6, ID_OPERACAO: 1, ID_KPI: kpi, SG_STATUS: st, DT_ATUALIZACAO: dt });
  let aoVivo = 0, pedido = null;
  const s = await servidor(async (q, p) => {
    if (/LOG_PEDRAVISAO|PEDRAVISAO/.test(q)) aoVivo++;
    if (q === STATUS_SQL) { pedido = p.dtRef[1].toISOString().slice(0, 10); return { recordset: [l(set, 10, 'N'), l(set, 11, 'S'), l(out, 10, 'S')] }; }
    return banco()(q, p);
  });
  try {
    const r = await get(s, '/api/atualizacao?site=6&ano=2026&mes=12&ciclo=2026-10');
    assert.deepStrictEqual(r.json.situacaoDe, { ano: 2026, mes: 9 });
    assert.strictEqual(r.json.kpis['1|10'].status, 'pendente');
    assert.strictEqual(r.json.kpis['1|10'].texto, 'Pending final updates');
    assert.strictEqual(r.json.kpis['1|11'].status, 'ok');
    assert.strictEqual(new Date(r.json.kpis['1|11'].dt).toISOString(), dt.toISOString());
    assert.strictEqual(pedido, '2026-10-01');
    assert.strictEqual((await get(s, '/api/atualizacao?site=6&ano=2026&mes=9&ciclo=2025-01')).status, 404);
    assert.strictEqual(aoVivo, 0);
  } finally { s.close(); }
});

test('leitura da situação: só a carga do ciclo, por mês, sem linhas ainda sem situação', () => {
  assert.match(STATUS_SQL, /FROM IBP\.PHUB_PERFORMANCESTUDIO R/);
  assert.match(STATUS_SQL, /R\.ID_DASH = @idDash\s+AND R\.DT_REF = @dtRef\s+AND R\.CD_PERIODO = 'MONTH'\s+AND R\.SG_STATUS IS NOT NULL/);
  assert.doesNotMatch(STATUS_SQL, /PEDRAVISAO/);
});

test('configuração (PHUB_PS_SETUP): só o formato esperado passa; sem registro ou com erro → null sem bloquear', async () => {
  const { normalizarConfigCoo, CONFIG_SQL } = require('../coo-api');
  const c = normalizarConfigCoo(JSON.stringify({
    seletores: { CAPEX_MINA: { opcoes: [{ chave: 'cost', lbl: 'Cost', titulo: 'CAPEX (Cost)', kpi: ['CAPEX', 5] }, { chave: 'Bad Key', lbl: 'x', titulo: 'y' }] }, 'ruim-codigo': { opcoes: [] } },
    apelidos: { Revenues: ['Net Revenue'], Vazio: [] },
  }));
  assert.deepStrictEqual(c.seletores, { CAPEX_MINA: { opcoes: [{ chave: 'cost', lbl: 'Cost', titulo: 'CAPEX (Cost)', kpi: ['CAPEX'], unid: null }] } });
  assert.deepStrictEqual(c.apelidos, { Revenues: ['Net Revenue'] });
  assert.strictEqual(normalizarConfigCoo('{x'), null);
  assert.match(CONFIG_SQL, /FROM IBP\.PHUB_PS_SETUP S\s+WHERE S\.CD_VISAO = @visao/);
  const ok = await servidor(async (q, p) => (q === CONFIG_SQL ? { recordset: [{ DS_LAYOUT: '{"apelidos":{"Revenues":["Net Revenue"]}}' }] } : banco()(q, p)));
  const vazio = await servidor(async (q, p) => (q === CONFIG_SQL ? { recordset: [] } : banco()(q, p)));
  const erro = await servidor(async (q, p) => { if (q === CONFIG_SQL) throw new Error('Invalid object name'); return banco()(q, p); });
  try {
    assert.deepStrictEqual((await get(ok, '/api/config')).json.config.apelidos, { Revenues: ['Net Revenue'] });
    assert.deepStrictEqual((await get(vazio, '/api/config')).json, { config: null });
    const r = await get(erro, '/api/config');
    assert.deepStrictEqual([r.status, r.json], [200, { config: null }]);
  } finally { ok.close(); vazio.close(); erro.close(); }
});

test('/filtros: só o ano do último mês realizado do ciclo e o anterior (carga com anos antigos)', async () => {
  const velhos = [2017, 2024, 2025, 2026].map((a) => linha({ DT_REF: new Date(Date.UTC(a, 7, 1)), ORDEM_GRAFICO: 2, NM_VISAO: 'Aug A' }));
  const s = await servidor(banco(velhos));
  try {
    assert.deepStrictEqual((await get(s, '/api/filtros?ciclo=2026-10')).json.anos, [2025, 2026]);
    const jan = await servidor(banco(velhos, [{ DT_REF: new Date(Date.UTC(2027, 0, 1)), DT_CARGA: null }]));
    try { assert.deepStrictEqual((await get(jan, '/api/filtros?ciclo=2027-01')).json.anos, [2025, 2026]); } finally { jan.close(); }
  } finally { s.close(); }
});

// ── People: ID_DASH 20, os 9 KPIs em ordem fixa e a formatação condicional por ID_KPI ──
const { KPIS_PEOPLE, CADASTRO_SQL } = require('../coo-api');
const ORDEM_PEOPLE = [717, 768, 774, 773, 772, 761, 771, 769, 770];
const PAGINA = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// Regras da página (REGRAS_KPI, CORES_DELTA e delta), avaliadas fora do navegador
function regrasDaPagina() {
  const a = PAGINA.indexOf('  var REGRAS_KPI = ['), b = PAGINA.indexOf('  // Legenda de cores no cabeçalho do card');
  const c = PAGINA.indexOf('  function delta(b, a, ind) {'), d = PAGINA.indexOf('  function view(ind) {');
  assert.ok(a > 0 && b > a && c > b && d > c, 'trechos das regras não encontrados em index.html');
  const fmt = (v, dec) => Number(v).toFixed(dec).replace('.', ',');
  return new Function('fmt', `${PAGINA.slice(a, b)}\n${PAGINA.slice(c, d)}\nreturn { REGRAS_KPI, regraDe, delta };`)(fmt);
}

test('People: ID_DASH padrão 20 e os 9 KPIs na ordem definida, iguais na API e na página', async () => {
  assert.deepStrictEqual(KPIS_PEOPLE, ORDEM_PEOPLE);
  assert.deepStrictEqual(regrasDaPagina().REGRAS_KPI.map((r) => r.id), ORDEM_PEOPLE);
  for (const q of [SNAPSHOT_SQL, STATUS_SQL, CADASTRO_SQL]) assert.ok(q.includes(`IN (${ORDEM_PEOPLE.join(', ')})`));
  const vistos = [];
  const app = express();
  app.use('/api', criarCooRouter({ runQuery: async (q, p) => { vistos.push(p && p.idDash && p.idDash[1]); return { recordset: [] }; } }));
  const s = app.listen(0);
  try {
    const r = await (await fetch(`http://127.0.0.1:${s.address().port}/api/ping`)).json();
    assert.strictEqual(r.idDash, 20);
    await fetch(`http://127.0.0.1:${s.address().port}/api/ciclos`);
    assert.deepStrictEqual(vistos, [20]);
  } finally { s.close(); }
});

test('People: a ordem de apresentação não depende da ordem (nem do ID_ORDEM) do banco; KPI fora da lista não entra', () => {
  // banco devolve na ordem inversa, com ID_ORDEM também invertido, e um KPI de outro dashboard
  const linhas = ORDEM_PEOPLE.slice().reverse().map((id, i) => linha({ ID_KPI: id, NM_KPI: 'K' + id, ID_ORDEM: i, ORDEM_GRAFICO: 0, NM_VISAO: 'Aug B', VL_KPI: 1 }));
  linhas.unshift(linha({ ID_KPI: 10, NM_KPI: 'Mine Movement', ID_ORDEM: -1, ORDEM_GRAFICO: 0, NM_VISAO: 'Aug B', VL_KPI: 1 }));
  assert.deepStrictEqual(agregarIndicadores(linhas, { site: 6, ano: 2026, mes: 8 }).map((x) => x.ID_KPI), ORDEM_PEOPLE);
});

test('People: regra de cor por ID_KPI (Headcount = faixa; Women = maior; os outros 6 = menor)', () => {
  const { regraDe } = regrasDaPagina();
  assert.deepStrictEqual(ORDEM_PEOPLE.map(regraDe), ['faixa', 'faixa', 'maior', 'menor', 'menor', 'menor', 'menor', 'menor', 'menor']);
  assert.strictEqual(regraDe(10), null);
  for (const fora of [716, 767, 766]) assert.strictEqual(regraDe(fora), null, `KPI ${fora} saiu do dashboard`);
});

test('People: delta em % sobre a referência e cores nos limites exatos (0%, ±2,5%, ±5%)', () => {
  const { delta } = regrasDaPagina();
  const cor = (regra, pct) => delta(1000, 1000 + pct * 10, { regra }).cls; // referência 1000: pct% exato
  const V = 'is-good', A = 'is-warn', R = 'is-bad';
  // Headcount (faixa): |delta| ≤ 2,5 verde · ≤ 5 âmbar · > 5 vermelho, igual para + e −
  for (const [pct, c] of [[0, V], [2.5, V], [-2.5, V], [2.6, A], [-2.6, A], [5, A], [-5, A], [5.1, R], [-5.1, R], [60, R], [-20, R]]) assert.strictEqual(cor('faixa', pct), c, `faixa ${pct}`);
  // Women (maior): ≥ 0 verde · < 0 até −2,5 âmbar · < −2,5 vermelho
  for (const [pct, c] of [[0, V], [2.5, V], [5, V], [-0.1, A], [-2.5, A], [-2.6, R], [-5, R]]) assert.strictEqual(cor('maior', pct), c, `maior ${pct}`);
  // Quanto menor, melhor: ≤ 0 verde · > 0 até 2,5 âmbar · > 2,5 vermelho
  for (const [pct, c] of [[0, V], [-2.5, V], [-5, V], [0.1, A], [2.5, A], [2.6, R], [5, R]]) assert.strictEqual(cor('menor', pct), c, `menor ${pct}`);
  // texto: sinal, 1 casa e % (os números do layout: 696 → 656 = −5,7%; 5 → 8 = +60,0%)
  assert.strictEqual(delta(696, 656, { regra: 'faixa' }).txt, '−5,7%');
  assert.strictEqual(delta(5, 8, { regra: 'faixa' }).txt, '+60,0%');
  assert.strictEqual(delta(10.5, 9.9, { regra: 'maior' }).txt, '−5,7%');
  assert.strictEqual(delta(7, 7, { regra: 'menor' }).txt, '0,0%');
  // a cor segue o valor arredondado que a tela mostra (2,54% aparece como 2,5%: verde)
  assert.strictEqual(cor('faixa', 2.54), V);
  assert.strictEqual(cor('faixa', -2.54), V);
  // referência negativa: o desvio é relativo ao módulo
  assert.strictEqual(delta(-100, -90, { regra: 'menor' }).d, 10);
});

test('People: nulos, zero, divisão por zero e valores inválidos ficam neutros, sem percentual', () => {
  const { delta } = regrasDaPagina();
  for (const [b, a] of [[null, 5], [5, null], [undefined, 5], [0, 5], [0, 0], [NaN, 5], [5, NaN], [Infinity, 5]]) {
    assert.deepStrictEqual(delta(b, a, { regra: 'faixa' }), { txt: '—', cls: 'is-flat', d: null }, `${b} → ${a}`);
  }
  assert.strictEqual(delta(5, 0, { regra: 'menor' }).txt, '−100,0%'); // realizado zero é valor válido
  assert.strictEqual(delta(10, 11, {}).cls, 'is-flat'); // KPI sem regra: neutro
});
