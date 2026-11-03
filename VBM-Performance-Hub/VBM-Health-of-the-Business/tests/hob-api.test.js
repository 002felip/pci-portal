// Testes do módulo de dados do Health of the Business (node --test). Banco simulado: runQuery falso, sem rede.
// Rodar na pasta da aplicação: npm test
process.env.HOB_CACHE_TTL_S = '1';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { criarHobRouter, montarDados, carregarSql, consultasPendentes, ARQUIVOS, INDICADORES, PENDENTE } = require('../hob-api');

const mensal = [];
for (let m = 1; m <= 12; m++) {
  mensal.push({ CD_BU: 'VBM', NR_ANO: 2026, NR_MES: m, CD_INDICADOR: 'EBITDA_CU', VL_B: 0.3, VL_AF: 0.32 });
  mensal.push({ CD_BU: 'cu ', NR_ANO: 2026, NR_MES: m, CD_INDICADOR: 'aisc_byp', VL_B: -7, VL_AF: -7.2 });
}
const pontes = [
  { NR_ANO: 2026, CD_PONTE: 'EBITDA_YEAR', NR_ORDEM: 2, DS_ITEM: 'FX impact', VL_ITEM: 16, TP_ITEM: 'd', FL_CINZA: 0 },
  { NR_ANO: 2026, CD_PONTE: 'EBITDA_YEAR', NR_ORDEM: 1, DS_ITEM: 'FY M-1 (Act/Fcst)', VL_ITEM: 4874, TP_ITEM: 'tot', FL_CINZA: 0 },
  { NR_ANO: 2026, CD_PONTE: 'EBITDA_YEAR', NR_ORDEM: 3, DS_ITEM: 'FY Act/Fcst', VL_ITEM: null, TP_ITEM: 'sub', FL_CINZA: 0 },
  { NR_ANO: 2026, CD_PONTE: 'FCF_YEAR', NR_ORDEM: 1, DS_ITEM: 'Free Cash Flow', VL_ITEM: null, TP_ITEM: 'sub', FL_CINZA: 1 },
];
const atualizacao = { DT_ATUALIZACAO: new Date(Date.UTC(2026, 9, 20, 18, 51)), NR_ANO_REAL: 2026, NR_MES_REAL: 9 };

test('montarDados: formato da página, chaves normalizadas e meses completos', () => {
  const d = montarDados({ mensal, pontes, atualizacao });
  assert.strictEqual(d.fonte, 'db');
  assert.deepStrictEqual(d.anos, [2026]);
  assert.deepStrictEqual(d.ultimoReal, { ano: 2026, mes: 9 });
  assert.strictEqual(d.atualizado, '2026-10-20T18:51:00.000Z');
  assert.strictEqual(d.bu.vbm[2026].ebitdaCu.a[0], 0.32);
  assert.strictEqual(d.bu.cu[2026].byp.b[11], -7);
  // todo indicador de toda BU existe com 12 meses; sem dado vira 0 e gera aviso
  for (const b of ['vbm', 'cu', 'ni']) {
    for (const ind of Object.values(INDICADORES[b])) {
      assert.strictEqual(d.bu[b][2026][ind].b.length, 12, `${b}/${ind}`);
      assert.strictEqual(d.bu[b][2026][ind].a.length, 12, `${b}/${ind}`);
    }
  }
  assert.strictEqual(d.bu.ni[2026].prod.a[5], 0);
  assert.ok(d.avisos.some((a) => a.startsWith('ni/prod 2026')));
});

test('montarDados: pontes na ordem de NR_ORDEM, com tipo, valor e cinza', () => {
  const d = montarDados({ mensal, pontes, atualizacao });
  assert.deepStrictEqual(d.bu.vbm[2026].ebitdaYear, [
    { tipo: 'tot', lbl: 'FY M-1 (Act/Fcst)', v: 4874 },
    { tipo: 'd', lbl: 'FX impact', v: 16 },
    { tipo: 'sub', lbl: 'FY Act/Fcst' },
  ]);
  assert.deepStrictEqual(d.bu.vbm[2026].fcfYear, [{ tipo: 'sub', lbl: 'Free Cash Flow', cinza: true }]);
});

test('montarDados: linhas inválidas ignoradas com aviso', () => {
  const d = montarDados({ mensal: mensal.concat([{ CD_BU: 'XX', NR_ANO: 2026, NR_MES: 1, CD_INDICADOR: 'PROD', VL_B: 1, VL_AF: 1 }, { CD_BU: 'CU', NR_ANO: 2026, NR_MES: 13, CD_INDICADOR: 'PROD', VL_B: 1, VL_AF: 1 }]), pontes: [], atualizacao });
  assert.strictEqual(d.avisos.filter((a) => a.startsWith('linha ignorada')).length, 2);
});

test('scripts de database/ existem e começam pendentes', () => {
  const sqls = Object.fromEntries(Object.entries(ARQUIVOS).map(([k, a]) => [k, carregarSql(a)]));
  assert.deepStrictEqual(consultasPendentes(sqls), Object.keys(ARQUIVOS));
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

test('/dados: 503 CONSULTAS_PENDENTES enquanto houver script marcado, sem tocar no banco', async () => {
  let chamadas = 0;
  const router = criarHobRouter({ runQuery: async () => { chamadas++; return { recordset: [] }; }, sqls: { mensal: PENDENTE + '\nSELECT 1', pontes: 'SELECT 1', atualizacao: 'SELECT 1' } });
  const r = await chamar(router, '/dados');
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.json.codigo, 'CONSULTAS_PENDENTES');
  assert.deepStrictEqual(r.json.pendentes, ['001_hob_mensal.sql']);
  assert.strictEqual(chamadas, 0);
});

test('/dados: monta a resposta com as três consultas e responde 500 sem texto do banco quando falha', async () => {
  const sqls = { mensal: 'M', pontes: 'P', atualizacao: 'A' };
  const ok = criarHobRouter({ sqls, runQuery: async (q) => ({ recordset: q === 'M' ? mensal : q === 'P' ? pontes : [atualizacao] }) });
  const r = await chamar(ok, '/dados');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.bu.vbm['2026'].ebitdaYear.length, 3);
  const falha = criarHobRouter({ sqls, runQuery: async () => { throw new Error('Login failed for user secreto'); } });
  const e = await chamar(falha, '/dados');
  assert.strictEqual(e.status, 500);
  assert.strictEqual(e.json.codigo, 'ERRO_BANCO');
  assert.ok(!JSON.stringify(e.json).includes('secreto'));
});
