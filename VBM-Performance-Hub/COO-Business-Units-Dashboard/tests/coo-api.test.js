// Testes do módulo de dados do COO (node --test). Banco simulado: runQuery falso, sem rede.
// Rodar na pasta do COO: npm test
process.env.COO_CACHE_TTL_S = '1';
process.env.COO_FRESCO_S = '1';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { criarCooRouter, carregarSql, agregarIndicadores, extrairFiltros, atualizacoesDoMes, mesDoCicloDaCarga, lerCiclo, CONSULTAS, CICLOS_SQL, SNAPSHOT_SQL, STATUS_SQL } = require('../coo-api');

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
  for (const arq of ['001_coo_dashboard.sql', '002_coo_dashboard_atualizacao.sql']) {
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

test('mês do ciclo = mês anterior ao atual', () => {
  const { mesDoCiclo } = require('../coo-api');
  assert.deepStrictEqual(mesDoCiclo(new Date(2026, 9, 28)), { ano: 2026, mes: 9 });  // outubro → setembro
  assert.deepStrictEqual(mesDoCiclo(new Date(2026, 10, 3)), { ano: 2026, mes: 10 }); // novembro → outubro
  assert.deepStrictEqual(mesDoCiclo(new Date(2027, 0, 10)), { ano: 2026, mes: 12 }); // janeiro → dezembro anterior
});

test('consultas sem SELECT de depuração ativo (um 2º resultado esvaziaria o dashboard)', () => {
  for (const arq of ['001_coo_dashboard.sql', '002_coo_dashboard_atualizacao.sql']) {
    const ativas = fs.readFileSync(path.join(__dirname, '..', 'database', arq), 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith('--'));
    assert.ok(!ativas.some((l) => /^\s*select\s+@\w+\s*$/i.test(l)), arq);
  }
});

test('mês do ciclo acompanha o GETDATE()-2 das queries (dias 1 e 2 ainda no ciclo anterior)', () => {
  const { mesDoCiclo } = require('../coo-api');
  assert.deepStrictEqual(mesDoCiclo(new Date(2026, 10, 1, 12)), { ano: 2026, mes: 9 });  // 1/nov → setembro
  assert.deepStrictEqual(mesDoCiclo(new Date(2026, 10, 3, 12)), { ano: 2026, mes: 10 }); // 3/nov → outubro
});

test('carga do COO na tabela do VBM: query original + campos do VBM, só o dashboard 15 e o próprio mês', () => {
  const ler = (f) => fs.readFileSync(path.join(__dirname, '..', 'database', f), 'utf8').replace(/\r/g, '');
  const carga = ler('003_carga_mensal_coo.sql');
  // toda linha da query original continua lá, na mesma ordem (só ganhou vírgula no fim, quando um campo foi incluído depois)
  const linhas = carga.split('\n').map((l) => l.trim());
  let j = 0;
  for (const o of ler('001_coo_dashboard.sql').split('\n').map((l) => l.trim()).filter(Boolean)) {
    while (j < linhas.length && linhas[j] !== o && linhas[j] !== o + ',') j++;
    assert.ok(j < linhas.length, `linha da query original ausente ou fora de ordem: ${o}`);
    j++;
  }
  const ativo = carga.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  assert.match(ativo, /DECLARE @ID_DASH\s+INT\s+=\s+15;/);
  const deletes = ativo.match(/DELETE FROM IBP\.PHUB_PERFORMANCESTUDIO\s+WHERE[^;]*;/g) || [];
  assert.strictEqual(deletes.length, 1);
  assert.match(deletes[0], /DT_REF = @DT_CARGA AND ID_DASH = @ID_DASH/);
  assert.strictEqual((ativo.match(/AS 'ID_TIPO_VISAO_VBM'/g) || []).length, 3);
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
  assert.match(SNAPSHOT_SQL, /R\.ID_DASH = @idDash\s+AND R\.DT_REF = @dtRef/);
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
