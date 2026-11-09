// Testes do módulo de dados do Health of the Business (node --test). Banco simulado: runQuery falso, sem rede.
// Rodar na pasta da aplicação: npm test
process.env.HOB_CACHE_TTL_S = '1';
process.env.HOB_FRESCO_S = '1';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { criarHobRouter, montarDados, mapearWaterfall, normalizarConfigHob, carregarSql, lerCiclo, lerIdDash, LEITURA, WATERFALL, CICLOS_SQL, CONFIG_PADRAO, CONFIG_VISAO } = require('../hob-api');

// Linhas no formato de database/001_hob_dashboard.sql
const linha = (o) => Object.assign({ CD_PERIODO: 'MONTH', ID_SISTEMA: 1, ID_SITE: 1, ID_OPERACAO: 1, ID_KPI: 10, NM_KPI: 'EBITDA Copper', ID_ORDEM: 1, SG_UNID: 'US$ bn', VL_CASADECIMAL: 2 }, o);
const LINHAS = [];
for (let m = 1; m <= 12; m++) {
  LINHAS.push(linha({ ANO: 2026, MES: m, SERIE: 'B', NM_VISAO: 'x B', VL_KPI: 0.3 }), linha({ ANO: 2026, MES: m, SERIE: 'AF', NM_VISAO: m <= 9 ? 'x A' : 'x F', VL_KPI: 0.32 }));
  LINHAS.push(linha({ ID_SITE: 2, ID_KPI: 20, NM_KPI: 'Production', SG_UNID: 'kt', VL_CASADECIMAL: 0, ANO: 2026, MES: m, SERIE: 'AF', VL_KPI: 30 }));
  LINHAS.push(linha({ ID_SITE: 3, ID_KPI: 21, NM_KPI: 'Production', SG_UNID: 'kt', VL_CASADECIMAL: 0, ANO: 2026, MES: m, SERIE: 'AF', VL_KPI: 14 }));
}
LINHAS.push(
  linha({ CD_PERIODO: 'YEAR', ID_KPI: 30, NM_KPI: 'EBITDA FY M-1', ANO: 2026, MES: 12, SERIE: 'AF', VL_KPI: 4874 }),
  linha({ CD_PERIODO: 'YEAR', ID_KPI: 31, NM_KPI: 'EBITDA Bridge | Price', ANO: 2026, MES: 12, SERIE: 'AF', VL_KPI: -200 }),
  linha({ CD_PERIODO: 'YEAR', ID_KPI: 40, NM_KPI: 'Net Debt', ANO: 2025, MES: 12, SERIE: 'AF', VL_KPI: 1189 }),
  linha({ CD_PERIODO: 'YEAR', ID_KPI: 40, NM_KPI: 'Net Debt', ANO: 2026, MES: 12, SERIE: 'B', VL_KPI: -27 }),
  linha({ CD_PERIODO: 'YEAR', ID_KPI: 40, NM_KPI: 'Net Debt', ANO: 2026, MES: 12, SERIE: 'AF', VL_KPI: 1784 }),
);
// IBP.WATERFALL (colunas no padrão do IBP): duas referências em 2026, vale a mais recente
const WF = [];
[['2025 Net Debt', 1189], ['EBITDA', 4665], ['Investments', -1488], ['Item novo', 5], ['2026B Net Debt', -27], ['2026F Net Debt', 1784]].forEach(([n, v], i) => {
  WF.push({ DT_REF: new Date(Date.UTC(2026, 9, 1)), ID_SITE: 40, ID_ORDEM: i + 1, DS_ITEM: n, VL_ITEM: v });
  WF.push({ DT_REF: new Date(Date.UTC(2026, 8, 1)), ID_SITE: 40, ID_ORDEM: i + 1, DS_ITEM: n, VL_ITEM: 0 });
});
const CONFIG = normalizarConfigHob({ bus: { cu: { sites: [2] }, ni: { sites: [3] } } });

test('SQL de leitura: tabela das cargas do COO, cadastro IBP.DASHBOARD, @idDash e @dtRef, sem ID_DASH fixo', () => {
  const s = carregarSql(LEITURA.arquivo, LEITURA.parametros);
  assert.match(s, /FROM IBP\.PHUB_PERFORMANCESTUDIO R/);
  assert.match(s, /R\.DT_REF = @dtRef/);
  assert.match(s, /R\.CD_PERIODO IN \('MONTH', 'YEAR'\)/);
  assert.match(s, /R\.ID_TIPO_VISAO IN \(1, 3\)/);
  assert.ok(!/ID_DASH\s*=\s*\d/.test(s));
  assert.match(CICLOS_SQL, /WHERE R\.ID_DASH = @idDash/);
});

test('SQL de leitura: junção com separador (sem colisão de CONCAT entre site/operação/KPI)', () => {
  const ativas = fs.readFileSync(path.join(__dirname, '..', 'database', LEITURA.arquivo), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--'));
  for (const l of ativas) if (/CONCAT\([^)]*ID_SITE/.test(l)) assert.match(l, /'\|'/, l.trim());
});

test('005_config_hob.sql grava o mesmo JSON do padrão do código, no registro da API', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'database', '005_config_hob.sql'), 'utf8');
  assert.ok(s.includes(`'${CONFIG_VISAO}'`));
  const json = JSON.parse(/@LAYOUT\s+NVARCHAR\(MAX\)\s+=\s+N'([\s\S]*?)';\n/.exec(s)[1].replace(/''/g, "'"));
  assert.deepStrictEqual(normalizarConfigHob(json), normalizarConfigHob(CONFIG_PADRAO)); // mesma configuração efetiva
});

test('003_carga_mensal_hob.sql: query do Health of the Business (ID_DASH 16) no envoltório da carga do COO', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'database', '003_carga_mensal_hob.sql'), 'utf8');
  assert.match(s, /DECLARE @ID_DASH\s+INT\s+=\s+16;/);
  assert.match(s, /DELETE FROM IBP\.PHUB_PERFORMANCESTUDIO\s+WHERE DT_REF = @DT_CARGA AND ID_DASH = @ID_DASH/);
  assert.match(s, /INSERT INTO IBP\.PHUB_PERFORMANCESTUDIO/);
  assert.ok(!/DASH\.ID_DASH\s*=\s*\d/.test(s), 'ID_DASH fixo nos blocos');
  assert.strictEqual((s.match(/DASH\.ID_DASH = @ID_DASH/g) || []).length, 5);
  for (const [cd, ordem] of [['MONTH', 1], ['QUARTER', 2], ['YTD', 4], ['YEAR', 5], ['YTG', 6]]) {
    assert.ok(s.includes(`'${cd}' AS 'CD_PERIODO'`), cd);
    assert.match(s, new RegExp(`'${cd}' AS 'CD_PERIODO',\\s*\\n\\s*${ordem} AS 'ORDEM_VISAO'`), `${cd} ORDEM_VISAO ${ordem}`);
  }
  // colunas da tabela (sem NM_USUARIO), YTG gravado (regra de CD_PERIODO ajustada) e chave única entre anos
  assert.ok(!/NM_USUARIO/.test(s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')), 'NM_USUARIO não existe na tabela');
  assert.match(s, /WHERE HOB\.CD_PERIODO IN \('MONTH', 'QUARTER', 'YTD', 'YEAR', 'YTG'\)/);
  assert.match(s, /CHECK \(CD_PERIODO IN \('MONTH', 'QUARTER', 'SEMESTER', 'YTD', 'YEAR', 'YTG'\)\)/);
  assert.ok(s.indexOf('ADD CONSTRAINT CK_PHUB_PERFORMANCESTUDIO_PERIODO') < s.indexOf('BEGIN TRANSACTION'), 'regra ajustada antes da carga');
  assert.match(s, /HOB\.ORDEM_ANO = YEAR\(HOB\.DT_IND\)/);
  // DT_IND explícito em cada um dos 5 blocos (o mês da linha) e gravado pelo nome
  assert.strictEqual((s.match(/DT_REF AS 'DT_IND'/g) || []).length, 5);
  assert.match(s, /@DT_CARGA, HOB\.DT_IND, @ID_DASH/);
  // fontes da query original
  for (const t of ['PEDRAVISAOCONSOLIDADA', 'PEDRAVISAOTRIMESTRE', 'PEDRAVISAOYEARTODATE', 'PEDRAVISAOYEARTOGO', 'PEDRAVISAOANO']) assert.ok(s.includes('IBP.' + t), t);
  // junções com separador (sem colisão de CONCAT), como no COO
  const ativas = s.split('\n').filter((l) => !l.trim().startsWith('--'));
  for (const l of ativas) if (/CONCAT\([^)]*\.ID_SITE/.test(l)) assert.match(l, /'\|'/, l.trim());
});

test('montarDados: séries mensais por BU (sites da configuração), último mês real e cadastro do KPI', () => {
  const d = montarDados(LINHAS, CONFIG, '2026-10');
  assert.deepStrictEqual(d.ultimoReal, { ano: 2026, mes: 9 });
  assert.deepStrictEqual(d.anos, [2025, 2026]);
  assert.strictEqual(d.bu.vbm[2026].ebitdaCu.b[0], 0.3);
  assert.strictEqual(d.bu.vbm[2026].ebitdaCu.a[11], 0.32);
  assert.strictEqual(d.bu.cu[2026].prod.a[0], 30); // site 2
  assert.strictEqual(d.bu.ni[2026].prod.a[0], 14); // site 3
  assert.deepStrictEqual(d.meta.vbm.ebitdaCu, { nome: 'EBITDA Copper', unid: 'US$ bn', casas: 2 });
  assert.ok(d.avisos.some((a) => a.startsWith('cu/sales: KPI não encontrado')));
  assert.strictEqual(d.bu.cu[2026].sales.a.length, 12);
});

test('montarDados: pontes pela configuração (valor anual, série B/AF, ano anterior e {ano} no rótulo)', () => {
  const d = montarDados(LINHAS, CONFIG, '2026-10');
  const e = d.bu.vbm[2026].ebitdaYear, f = d.bu.vbm[2026].fcfYear;
  assert.deepStrictEqual(e[0], { tipo: 'tot', lbl: 'FY M-1 (Act/Fcst)', v: 4874 });
  assert.deepStrictEqual(e[2], { tipo: 'd', lbl: 'Price', v: -200 });
  assert.deepStrictEqual(e[6], { tipo: 'sub', lbl: 'FY Act/Fcst' });
  assert.deepStrictEqual(e[7], { tipo: 'zero' });
  assert.deepStrictEqual(f[0], { tipo: 'tot', lbl: '2025 Net Debt', v: 1189 });
  assert.deepStrictEqual(f[12], { tipo: 'ref', lbl: '2026B Net Debt', v: -27, cinza: true });
  assert.deepStrictEqual(f[13], { tipo: 'tot', lbl: '2026F Net Debt', v: 1784 });
});

test('normalizarConfigHob: só o formato esperado passa; o resto vem do padrão', () => {
  assert.strictEqual(normalizarConfigHob('{inválido'), null);
  const c = normalizarConfigHob({ indicadores: { cu: { prod: ['Copper Production'], inventado: ['x'] } }, pontes: { fcfYear: [{ tipo: 'xx' }] } });
  assert.deepStrictEqual(c.indicadores.cu.prod, ['Copper Production']);
  assert.strictEqual(c.indicadores.cu.inventado, undefined);
  assert.deepStrictEqual(c.pontes.fcfYear, CONFIG_PADRAO.pontes.fcfYear); // nenhum item válido: padrão
});

test('lerCiclo e lerIdDash', () => {
  assert.strictEqual(lerCiclo('2026-10'), '2026-10');
  assert.strictEqual(lerCiclo('2026-10-01'), '2026-10');
  assert.strictEqual(lerCiclo(''), null);
  assert.strictEqual(lerCiclo('2026-13'), undefined);
  assert.strictEqual(lerIdDash(undefined), null);
  assert.strictEqual(lerIdDash('42'), 42);
  assert.throws(() => lerIdDash('abc'));
});

async function chamar(router, caminho) {
  const app = express();
  app.use('/api', router);
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api${caminho}`);
    return { status: r.status, json: await r.json() };
  } finally { srv.close(); }
}
// Banco simulado: responde pela SQL recebida
function banco(opc = {}) {
  const chamadas = [];
  const runQuery = async (q, params) => {
    chamadas.push({ q, params });
    if (opc.falha) throw new Error('Login failed for user secreto');
    if (q === CICLOS_SQL) return { recordset: [{ DT_REF: new Date(Date.UTC(2026, 9, 1)), DT_CARGA: new Date(Date.UTC(2026, 9, 2, 8)) }, { DT_REF: new Date(Date.UTC(2026, 8, 1)), DT_CARGA: null }] };
    if (/IBP\.WATERFALL/.test(q)) return { recordset: opc.semWaterfall ? [] : WF };
    if (/PHUB_PS_SETUP/.test(q)) return { recordset: [{ DS_LAYOUT: JSON.stringify({ bus: { cu: { sites: [2] }, ni: { sites: [3] } } }) }] };
    return { recordset: LINHAS };
  };
  return { runQuery, chamadas };
}

test('rotas sem HOB_ID_DASH: 503 ID_DASH_PENDENTE, sem tocar no banco', async () => {
  const b = banco();
  const router = criarHobRouter({ runQuery: b.runQuery });
  const r = await chamar(router, '/indicadores');
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.json.codigo, 'ID_DASH_PENDENTE');
  assert.strictEqual(b.chamadas.length, 0);
  assert.deepStrictEqual((await chamar(router, '/ping')).json, { ok: true, idDash: null });
});

test('/indicadores: carga mais recente (ou ?ciclo=), configuração do banco e parâmetros tipados', async () => {
  const b = banco();
  const router = criarHobRouter({ runQuery: b.runQuery, idDash: '42' });
  const r = await chamar(router, '/indicadores');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ciclo, '2026-10');
  assert.deepStrictEqual(r.json.ciclos, ['2026-10', '2026-09']);
  assert.strictEqual(r.json.config, 'banco');
  assert.strictEqual(r.json.atualizado, '2026-10-02T08:00:00.000Z');
  assert.strictEqual(r.json.bu.cu['2026'].prod.a[0], 30);
  const leitura = b.chamadas.find((c) => c.params && c.params.dtRef);
  assert.strictEqual(leitura.params.idDash[1], 42);
  assert.strictEqual(leitura.params.dtRef[1].toISOString(), '2026-10-01T00:00:00.000Z');
  assert.strictEqual((await chamar(router, '/indicadores?ciclo=2026-09')).json.ciclo, '2026-09');
  assert.strictEqual((await chamar(router, '/indicadores?ciclo=2025-01')).status, 404);
  assert.strictEqual((await chamar(router, '/indicadores?ciclo=xx')).status, 400);
});

test('/indicadores: banco fora responde 500 sem texto do banco', async () => {
  const router = criarHobRouter({ runQuery: banco({ falha: true }).runQuery, idDash: 42 });
  const e = await chamar(router, '/indicadores');
  assert.strictEqual(e.status, 500);
  assert.strictEqual(e.json.codigo, 'ERRO_BANCO');
  assert.ok(!JSON.stringify(e.json).includes('secreto'));
});

test('SQL do FCF YEAR: a consulta de IBP.WATERFALL com site e ano inicial por parâmetro', () => {
  const s = carregarSql(WATERFALL.arquivo, WATERFALL.parametros);
  assert.match(s, /FROM IBP\.WATERFALL W/);
  assert.match(s, /W\.ID_SITE = @site/);
  assert.match(s, /W\.ID_TIPO = @tipo/);
  assert.match(s, /YEAR\(W\.DT_REF\) >= @anoIni/);
  assert.deepStrictEqual(CONFIG_PADRAO.fcf, { site: 40, tipo: 2, anoInicial: 2025 });
});

test('mapearWaterfall: referência mais recente do ano, ordem, tipo e cinza pela configuração, subtotais inseridos', () => {
  const w = mapearWaterfall(WF, CONFIG);
  assert.deepStrictEqual(w.colunas, { data: 'DT_REF', rotulo: 'DS_ITEM', valor: 'VL_ITEM', ordem: 'ID_ORDEM', tipo: null });
  const it = w.anos[2026].itens;
  assert.strictEqual(w.anos[2026].dtRef, '2026-10-01T00:00:00.000Z');
  assert.deepStrictEqual(it[0], { tipo: 'tot', lbl: '2025 Net Debt', v: 1189 });
  assert.deepStrictEqual(it.find((x) => x.lbl === '2026B Net Debt'), { tipo: 'ref', lbl: '2026B Net Debt', v: -27, cinza: true });
  assert.deepStrictEqual(it.find((x) => x.lbl === '2026F Net Debt'), { tipo: 'tot', lbl: '2026F Net Debt', v: 1784 });
  assert.deepStrictEqual(it.find((x) => x.lbl === 'Item novo'), { tipo: 'd', lbl: 'Item novo', v: 5 });
  assert.ok(it.some((x) => x.tipo === 'sub' && x.lbl === 'Free Cash Flow' && x.cinza));
  assert.ok(w.avisos.some((a) => a.includes('Item novo')));
  assert.match(mapearWaterfall([{ X: 1 }], CONFIG).avisos[0], /colunas não reconhecidas/);
});

test('/waterfall responde sem HOB_ID_DASH; /indicadores usa o FCF de IBP.WATERFALL; bruto só com diagnóstico', async () => {
  const b = banco();
  const semId = criarHobRouter({ runQuery: b.runQuery });
  const w = await chamar(semId, '/waterfall');
  assert.strictEqual(w.status, 200);
  assert.strictEqual(w.json.site, 40);
  assert.strictEqual(w.json.anos['2026'].itens[0].v, 1189);
  const consulta = b.chamadas.find((c) => /IBP\.WATERFALL/.test(c.q));
  assert.strictEqual(consulta.params.site[1], 40);
  assert.strictEqual(consulta.params.tipo[1], 2);
  assert.strictEqual(consulta.params.anoIni[1], 2025);
  assert.strictEqual((await chamar(semId, '/waterfall?bruto=1')).status, 404);
  const r = await chamar(criarHobRouter({ runQuery: b.runQuery, idDash: 42 }), '/indicadores');
  assert.strictEqual(r.json.fcf, 'waterfall');
  assert.strictEqual(r.json.bu.vbm['2026'].fcfYear[0].lbl, '2025 Net Debt');
  const sem = await chamar(criarHobRouter({ runQuery: banco({ semWaterfall: true }).runQuery, idDash: 42 }), '/indicadores');
  assert.strictEqual(sem.json.fcf, 'config');
});

test('mapearWaterfall: uma ponte por referência (DT_REF), em ordem, para a tela seguir Ano/Mês', () => {
  const w = mapearWaterfall(WF, CONFIG);
  assert.deepStrictEqual(w.referencias.map((r) => r.ref), ['2026-09', '2026-10']);
  assert.deepStrictEqual([w.referencias[0].ano, w.referencias[0].mes], [2026, 9]);
  assert.strictEqual(w.referencias[0].itens[0].v, 0);    // setembro
  assert.strictEqual(w.referencias[1].itens[0].v, 1189); // outubro
  assert.strictEqual(w.anos[2026].itens[0].v, 1189);     // o ano fica com a mais recente
});

test('codigoDoErro: motivo para a tela sem o texto do banco', () => {
  const { codigoDoErro } = require('../hob-api');
  assert.deepStrictEqual(codigoDoErro(new Error("Invalid column name 'ID_TIPO'.")), { codigo: 'COLUNA', detalhe: 'ID_TIPO' });
  assert.deepStrictEqual(codigoDoErro(new Error("Invalid object name 'IBP.WATERFALL'.")), { codigo: 'TABELA' });
  assert.deepStrictEqual(codigoDoErro(new Error('The SELECT permission was denied')), { codigo: 'PERMISSAO' });
  assert.deepStrictEqual(codigoDoErro(new Error('Login failed for user x')), { codigo: 'LOGIN' });
  assert.deepStrictEqual(codigoDoErro(new Error('qualquer')), { codigo: 'ERRO_BANCO' });
});

test('/waterfall: referências e código de erro; /waterfall/estrutura mostra colunas sem os valores', async () => {
  const ok = await chamar(criarHobRouter({ runQuery: banco().runQuery }), '/waterfall');
  assert.deepStrictEqual(ok.json.referencias.map((r) => r.ref), ['2026-09', '2026-10']);
  const est = await chamar(criarHobRouter({ runQuery: banco().runQuery }), '/waterfall/estrutura');
  assert.strictEqual(est.json.ok, true);
  assert.deepStrictEqual(est.json.colunas.map((c) => c.nome), ['DT_REF', 'ID_SITE', 'ID_ORDEM', 'DS_ITEM', 'VL_ITEM']);
  assert.strictEqual(est.json.colunas[0].tipo, 'data');
  assert.ok(!JSON.stringify(est.json).includes('1189'), 'sem valores');
  const erro = criarHobRouter({ runQuery: async () => { throw new Error("Invalid column name 'ID_TIPO'. secreto"); } });
  const e = await chamar(erro, '/waterfall');
  assert.strictEqual(e.status, 500);
  assert.deepStrictEqual([e.json.codigo, e.json.detalhe], ['COLUNA', 'ID_TIPO']);
  assert.ok(!JSON.stringify(e.json).includes('secreto'));
  const ee = await chamar(erro, '/waterfall/estrutura');
  assert.strictEqual(ee.json.codigo, 'COLUNA');
});

test('SQL do EBITDA: carga do COO em IBP.PHUB_PERFORMANCESTUDIO, KPI por @idKpi, mês, B e Act/Fcst', () => {
  const { EBITDA } = require('../hob-api');
  const s = carregarSql(EBITDA.arquivo, EBITDA.parametros);
  assert.match(s, /FROM IBP\.PHUB_PERFORMANCESTUDIO R/);
  assert.match(s, /R\.ID_KPI = @idKpi/);
  assert.match(s, /R\.CD_PERIODO IN \('MONTH', 'QUARTER', 'YTD', 'YTG', 'YEAR'\)/);
  assert.match(s, /OUTER APPLY \([\s\S]*FROM IBP\.DASHBOARD D[\s\S]*\) DASH/);
  assert.ok(!/ID_DASH\s*=\s*\d/.test(s));
  assert.deepStrictEqual(CONFIG_PADRAO.ebitda, { idDash: 16, idKpi: 73, sites: { vbm: [40], cu: [38], ni: [39] }, outros: { idOperacao: 11, kpis: [73], sites: [45, 102, 46] } });
  assert.deepStrictEqual(CONFIG_PADRAO.ebitdaPonte, { site: 40, tipo: 3, anoInicial: 2025 });
});

// Linhas no formato de 004_hob_ebitda.sql (carga do ID_DASH 16): KPI 73 nos sites 38/39/40 e site fora (6);
// Others: KPI 73 nos sites 45/102/46 da operação 11 e o site 45 numa operação que não conta (12)
const EB = [];
const lin = (o) => Object.assign({ ID_OPERACAO: 11, NM_KPI: 'EBITDA', SG_UNID: 'US$ M', VL_CASADECIMAL: 0 }, o);
for (let m = 1; m <= 12; m++) {
  for (const [site, nome, v] of [[40, 'VBM', 500], [38, 'Copper', 300], [39, 'Nickel', 150], [6, 'Salobo', 999]]) {
    EB.push(lin({ ANO: 2026, MES: m, ID_SITE: site, NM_SITE: nome, ID_KPI: 73, SERIE: 'B', VL_KPI: v }));
    EB.push(lin({ ANO: 2026, MES: m, ID_SITE: site, NM_SITE: nome, ID_KPI: 73, SERIE: 'AF', VL_KPI: v + 1 }));
  }
  for (const [site, v, op] of [[45, 10, 11], [102, 5, 11], [46, 2, 11], [45, 777, 12]]) {
    EB.push(lin({ ANO: 2026, MES: m, ID_SITE: site, NM_SITE: 'Outro ' + site, ID_KPI: 73, ID_OPERACAO: op, SERIE: 'B', VL_KPI: v }));
    EB.push(lin({ ANO: 2026, MES: m, ID_SITE: site, NM_SITE: 'Outro ' + site, ID_KPI: 73, ID_OPERACAO: op, SERIE: 'AF', VL_KPI: v }));
  }
}
const EB73 = EB, EBOUT = EB; // Others também é o KPI 73 (a API lê o KPI uma vez só)

test('montarEbitda: KPI 73 por site (Copper 38, Nickel 39, VBM 40 = total) e Others = sites 45+102+46 da operação 11', () => {
  const { montarEbitda } = require('../hob-api');
  const e = montarEbitda(EB73, EBOUT, CONFIG_PADRAO, '2026-10');
  assert.deepStrictEqual(e.ultimoReal, { ano: 2026, mes: 9 });
  assert.strictEqual(e.anos[2026].ebitdaVbm.b[0], 500);
  assert.strictEqual(e.anos[2026].ebitdaCu.b[0], 300);
  assert.strictEqual(e.anos[2026].ebitdaNi.a[0], 151);
  assert.strictEqual(e.anos[2026].ebitdaOut.b[0], 17); // 10 + 5 + 2 (a operação 12 não entra)
  assert.deepStrictEqual(e.meta, { nome: 'EBITDA', unid: 'US$ M', casas: 0 });
  assert.deepStrictEqual(e.sites.out, ['site 45 Outro 45 · KPI 73', 'site 102 Outro 102 · KPI 73', 'site 46 Outro 46 · KPI 73']);
  assert.ok(!e.avisos.some((a) => /fora da configuração.*\b(45|102|46)\b/.test(a)), 'sites de Others não são avisados');
  assert.ok(e.avisos.some((a) => a.includes('fora da configuração') && a.includes('6')));
});

test('/ebitda: ciclo mais recente do ID_DASH 16 (ou o da tela, se existir), KPI 73; /waterfall?ponte=ebitdaYear usa ID_TIPO 3', async () => {
  const chamadas = [];
  const runQuery = async (q, params) => {
    chamadas.push({ q, params });
    if (q === CICLOS_SQL) return { recordset: [{ DT_REF: new Date(Date.UTC(2026, 9, 1)) }, { DT_REF: new Date(Date.UTC(2026, 8, 1)) }] };
    if (/IBP\.WATERFALL/.test(q)) return { recordset: WF };
    if (/PHUB_PS_SETUP/.test(q)) return { recordset: [] };
    return { recordset: EB.filter((l) => l.ID_KPI === params.idKpi[1]) };
  };
  const router = criarHobRouter({ runQuery });
  const r = await chamar(router, '/ebitda');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ciclo, '2026-10');
  assert.deepStrictEqual([r.json.idDash, r.json.idKpi], [16, 73]);
  assert.strictEqual(r.json.anos['2026'].ebitdaVbm.b[0], 500);
  assert.strictEqual(r.json.anos['2026'].ebitdaOut.b[0], 17);
  const kpisLidos = chamadas.filter((c) => c.params && c.params.idKpi).map((c) => c.params.idKpi[1]).sort((x, y) => x - y);
  assert.deepStrictEqual([...new Set(kpisLidos)], [73]); // Others também é o KPI 73 (sites 45, 102 e 46)
  assert.ok(chamadas.filter((c) => c.params && c.params.idKpi).every((c) => c.params.idDash[1] === 16));
  assert.strictEqual((await chamar(router, '/ebitda?ciclo=2026-09')).json.ciclo, '2026-09');
  assert.strictEqual((await chamar(router, '/ebitda?ciclo=2020-01')).json.ciclo, '2026-10'); // ciclo inexistente no COO: o mais recente
  const w = await chamar(router, '/waterfall?ponte=ebitdaYear');
  assert.strictEqual(w.json.ponte, 'ebitdaYear');
  assert.strictEqual(w.json.tipo, 3);
  const consulta = chamadas.filter((c) => /IBP\.WATERFALL/.test(c.q)).pop();
  assert.strictEqual(consulta.params.tipo[1], 3);
});

test('/coo: séries da carga do COO por ID_KPI no site da página; KPI null fica pendente', async () => {
  const chamadas = [];
  const runQuery = async (q, params) => {
    chamadas.push({ q, params });
    if (q === CICLOS_SQL) return { recordset: [{ DT_REF: new Date(Date.UTC(2026, 9, 1)) }] };
    if (/PHUB_PS_SETUP/.test(q)) return { recordset: [] };
    return { recordset: EB };
  };
  const r = await chamar(criarHobRouter({ runQuery }), '/coo');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ciclo, '2026-10');
  assert.strictEqual(r.json.series['cu.ebitda'].anos['2026'].b[0], 300); // site 38
  assert.strictEqual(r.json.series['ni.ebitda'].anos['2026'].a[0], 151); // site 39
  assert.deepStrictEqual(r.json.series['cu.ebitda'].meta, { nome: 'EBITDA', unid: 'US$ M', casas: 0 });
  assert.ok(r.json.pendentes.includes('cu.prod') && r.json.pendentes.includes('vbm.capex'));
  assert.strictEqual(chamadas.filter((c) => c.params && c.params.idKpi).length, 1); // KPI 73 lido uma vez para os dois sites
});

test('normalizarConfigHob: coo.kpis aceita só as séries conhecidas, inteiro ou null', () => {
  const c = normalizarConfigHob({ coo: { kpis: { 'cu.prod': 12, 'cu.ebitda': null, 'xx.yy': 5, 'ni.sales': 'abc' } } });
  assert.strictEqual(c.coo.kpis['cu.prod'], 12);
  assert.strictEqual(c.coo.kpis['cu.ebitda'], null);
  assert.strictEqual(c.coo.kpis['xx.yy'], undefined);
  assert.strictEqual(c.coo.kpis['ni.sales'], null); // inválido: mantém o padrão
});

test('montarEbitda: casas decimais do cadastro por opção do seletor (linha sem cadastro não apaga o anterior)', () => {
  const { montarEbitda } = require('../hob-api');
  const linhas = [
    lin({ ANO: 2026, MES: 1, ID_SITE: 38, NM_SITE: 'Copper', ID_KPI: 73, SERIE: 'B', VL_KPI: 1.25, VL_CASADECIMAL: 0 }),
    lin({ ANO: 2026, MES: 1, ID_SITE: 40, NM_SITE: 'VBM', ID_KPI: 73, SERIE: 'B', VL_KPI: 2.5, SG_UNID: null, VL_CASADECIMAL: null }),
    lin({ ANO: 2026, MES: 2, ID_SITE: 40, NM_SITE: 'VBM', ID_KPI: 73, SERIE: 'B', VL_KPI: 2.5, SG_UNID: 'US$ bn', VL_CASADECIMAL: 1 })
  ];
  const outros = [lin({ ANO: 2026, MES: 1, ID_SITE: 45, ID_KPI: 73, NM_KPI: 'Outro', SERIE: 'B', VL_KPI: 0.1, SG_UNID: 'US$ bn', VL_CASADECIMAL: 2 })];
  const e = montarEbitda(linhas, outros, CONFIG_PADRAO, '2026-10');
  assert.deepStrictEqual(e.metas.vbm, { nome: 'EBITDA', unid: 'US$ bn', casas: 1 });
  assert.strictEqual(e.metas.cu.casas, 0);
  assert.strictEqual(e.metas.out.casas, 2);
  assert.strictEqual(e.meta.casas, 1); // compatibilidade: meta = VBM
});

test('montarAtualizacao: situação por gráfico (opções do EBITDA e coo.kpis), como o COO', () => {
  const { montarAtualizacao } = require('../hob-api');
  const linhas = [
    { ID_SITE: 40, ID_OPERACAO: 11, ID_KPI: 73, SG_STATUS: 'N', DT_ATUALIZACAO: new Date(Date.UTC(2026, 8, 28)) },
    { ID_SITE: 38, ID_OPERACAO: 11, ID_KPI: 73, SG_STATUS: 'S', DT_ATUALIZACAO: new Date(Date.UTC(2026, 9, 5)) },
    { ID_SITE: 45, ID_OPERACAO: 11, ID_KPI: 73, SG_STATUS: 'S', DT_ATUALIZACAO: new Date(Date.UTC(2026, 9, 3)) },
    { ID_SITE: 46, ID_OPERACAO: 11, ID_KPI: 73, SG_STATUS: 'N', DT_ATUALIZACAO: null },
    { ID_SITE: 102, ID_OPERACAO: 12, ID_KPI: 73, SG_STATUS: 'N', DT_ATUALIZACAO: null }, // operação fora de Others
  ];
  const a = montarAtualizacao(linhas, CONFIG_PADRAO, '2026-11');
  assert.deepStrictEqual(a.mesCiclo, { ano: 2026, mes: 10 });
  assert.strictEqual(a.cards['vbm.ebitda.vbm'].status, 'pendente');
  assert.strictEqual(a.cards['vbm.ebitda.vbm'].dt, '2026-09-28T00:00:00.000Z');
  assert.strictEqual(a.cards['vbm.ebitda.cu'].status, 'ok');
  assert.strictEqual(a.cards['cu.ebitda'].status, 'ok');
  assert.ok(!a.cards['vbm.ebitda.ni'] && !a.cards['ni.ebitda'], 'sem situação: fora');
  assert.deepStrictEqual(a.cards['vbm.ebitda.out'], { status: 'pendente', dt: null, kpis: 2, pendentes: 1 });
});

test('007 (status, como o 004 do COO) e 008 (verificação só leitura) do ID_DASH 16', () => {
  const ler = (f) => fs.readFileSync(path.join(__dirname, '..', 'database', f), 'utf8');
  const st = ler('007_status_atualizacao_hob.sql');
  assert.match(st, /DECLARE @ID_DASH\s+INT\s+=\s+16;/);
  assert.match(st, /IBP\.LOG_PEDRAVISAOCONSOLIDADA/);
  assert.match(st, /R\.SG_STATUS = CASE WHEN A\.DT_ATUALIZACAO >= @DT_REF THEN 'S' ELSE 'N' END/); // regra do 004 do COO
  const v = ler('008_verificacao_atualizacao_hob.sql');
  assert.match(v, /DECLARE @ID_DASH INT\s+=\s+16;/);
  const codigo = v.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|MERGE)\b/i.test(codigo), '008 não grava');
  for (const t of ['PEDRAVISAOCONSOLIDADA', 'PEDRAVISAOTRIMESTRE', 'PEDRAVISAOYEARTODATE', 'PEDRAVISAOYEARTOGO', 'PEDRAVISAOANO', 'LOG_PEDRAVISAOCONSOLIDADA']) assert.ok(v.includes('IBP.' + t), t);
});

test('montarEbitda/montarSerieCoo: QUARTER, YTD, YTG e YEAR gravados no mês (DT_IND) vão para per[mês]', () => {
  const { montarEbitda, montarSerieCoo } = require('../hob-api');
  const linhas = [
    lin({ ANO: 2026, MES: 10, ID_SITE: 40, ID_KPI: 73, SERIE: 'B', CD_PERIODO: 'MONTH', VL_KPI: 0.34 }),
    lin({ ANO: 2026, MES: 10, ID_SITE: 40, ID_KPI: 73, SERIE: 'B', CD_PERIODO: 'YTG', VL_KPI: 1.5 }),
    lin({ ANO: 2026, MES: 10, ID_SITE: 40, ID_KPI: 73, SERIE: 'AF', CD_PERIODO: 'YTG', VL_KPI: 1.2 }),
    lin({ ANO: 2026, MES: 10, ID_SITE: 40, ID_KPI: 73, SERIE: 'B', CD_PERIODO: 'YEAR', VL_KPI: 4.94 }),
  ];
  const e = montarEbitda(linhas, [], CONFIG_PADRAO, '2026-11');
  const s = e.anos[2026].ebitdaVbm;
  assert.strictEqual(s.b[9], 0.34);
  assert.deepStrictEqual(s.per[10].YTG, { b: 1.5, a: 1.2 });
  assert.deepStrictEqual(s.per[10].YEAR, { b: 4.94, a: null });
  assert.deepStrictEqual(montarSerieCoo(linhas, 40).anos[2026].per[10].YTG, { b: 1.5, a: 1.2 });
});

test('/atualizacao: sem SG_STATUS gravado no ciclo, usa a mesma regra direto do log (origem log)', async () => {
  const { STATUS_SQL, STATUS_LOG_SQL } = require('../hob-api');
  const chamadas = [];
  const runQuery = async (q, params) => {
    chamadas.push({ q, params });
    if (q === CICLOS_SQL) return { recordset: [{ DT_REF: new Date(Date.UTC(2026, 9, 1)) }] };
    if (q === STATUS_SQL) return { recordset: [] };
    if (q === STATUS_LOG_SQL) return { recordset: [{ ID_SITE: 40, ID_OPERACAO: 11, ID_KPI: 73, SG_STATUS: 'N', DT_ATUALIZACAO: null }] };
    return { recordset: [] };
  };
  const r = await chamar(criarHobRouter({ runQuery, idDash: 16 }), '/atualizacao');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.origem, 'log');
  assert.strictEqual(r.json.cards['vbm.ebitda.vbm'].status, 'pendente');
  const log = chamadas.find((c) => c.q === STATUS_LOG_SQL);
  assert.strictEqual(log.params.dtMes[1].toISOString().slice(0, 10), '2026-09-01'); // mês do ciclo 2026-10
});

test('montarAtualizacao: KPI com log em dia mas sem o realizado do mês do ciclo (SEM_REAL) fica pendente', () => {
  const { montarAtualizacao, STATUS_SQL, STATUS_LOG_SQL } = require('../hob-api');
  const a = montarAtualizacao([
    { ID_SITE: 40, ID_OPERACAO: 11, ID_KPI: 73, SG_STATUS: 'S', SEM_REAL: 1, DT_ATUALIZACAO: new Date(Date.UTC(2026, 9, 7)) },
    { ID_SITE: 38, ID_OPERACAO: 11, ID_KPI: 73, SG_STATUS: 'S', SEM_REAL: 0, DT_ATUALIZACAO: new Date(Date.UTC(2026, 10, 3)) },
  ], CONFIG_PADRAO, '2026-11');
  assert.strictEqual(a.cards['vbm.ebitda.vbm'].status, 'pendente');
  assert.strictEqual(a.cards['vbm.ebitda.vbm'].semReal, true);
  assert.strictEqual(a.cards['vbm.ebitda.cu'].status, 'ok');
  for (const q of [STATUS_SQL, STATUS_LOG_SQL]) assert.match(q, /R\.CD_PERIODO = 'MONTH' AND R\.ID_TIPO_VISAO = 3 AND R\.DT_IND = @dtMes/);
});
