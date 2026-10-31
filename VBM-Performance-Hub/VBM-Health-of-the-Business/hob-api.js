/**
 * VBM Health of the Business — dados do dashboard (rotas em <BASE>/api).
 * Mesmo molde do coo-api.js: a SQL fica em database/*.sql e é lida na subida.
 *
 *   GET /ping   diagnóstico que NÃO toca no banco
 *   GET /dados  tudo o que a página usa, no formato de assets/hob-data.js
 *
 * Enquanto um script de database/ tiver a marca "-- HOB:PENDENTE", /dados responde
 * 503 { codigo: 'CONSULTAS_PENDENTES' } e a página segue com os dados de demonstração.
 *
 * Contrato das consultas (nomes de coluna exatos; ver os comentários de cada script):
 *   001_hob_mensal.sql       CD_BU, NR_ANO, NR_MES, CD_INDICADOR, VL_B, VL_AF
 *   002_hob_pontes.sql       NR_ANO, CD_PONTE, NR_ORDEM, DS_ITEM, VL_ITEM, TP_ITEM, FL_CINZA
 *   003_hob_atualizacao.sql  DT_ATUALIZACAO, NR_ANO_REAL, NR_MES_REAL (uma linha)
 *
 * HOB_CACHE_TTL_S (opcional): cache do /dados em segundos (padrão 300).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const TAG = '[vbm-health-of-the-business]';
const PENDENTE = '-- HOB:PENDENTE';
const ARQUIVOS = { mensal: '001_hob_mensal.sql', pontes: '002_hob_pontes.sql', atualizacao: '003_hob_atualizacao.sql' };

// CD_BU do banco → chave da página
const BUS = { VBM: 'vbm', CU: 'cu', NI: 'ni' };
// CD_INDICADOR do banco → série da página, por BU
const NEGOCIO = { PROD: 'prod', SALES: 'sales', EBITDA: 'ebitda', CAPEX: 'capex', FCF: 'fcf', AISC_SUS: 'sus', AISC_COST: 'cost', AISC_BYP: 'byp' };
const INDICADORES = {
  vbm: { EBITDA_CU: 'ebitdaCu', EBITDA_NI: 'ebitdaNi', EBITDA_OUT: 'ebitdaOut', CAPEX: 'capex' },
  cu: NEGOCIO,
  ni: NEGOCIO,
};
// CD_PONTE do banco → ponte da visão consolidada
const PONTES = { EBITDA_YEAR: 'ebitdaYear', FCF_YEAR: 'fcfYear' };
const TIPOS = ['tot', 'd', 'sub', 'ref', 'zero'];

function carregarSql(arquivo) {
  return fs.readFileSync(path.join(__dirname, 'database', arquivo), 'utf8');
}
function consultasPendentes(sqls) {
  return Object.keys(ARQUIVOS).filter((k) => !sqls[k] || sqls[k].includes(PENDENTE));
}
const chave = (v) => String(v == null ? '' : v).trim().toUpperCase();
const numero = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));

// Linhas do banco → formato da página (o mesmo de assets/hob-data.js). Mês sem valor vira 0 e entra em avisos.
function montarDados({ mensal = [], pontes = [], atualizacao = null }) {
  const bu = {}, anos = new Set(), avisos = [];
  const no = (b, ano) => ((bu[b] = bu[b] || {})[ano] = bu[b][ano] || {});

  let ultimo = null;
  for (const l of mensal) {
    const b = BUS[chave(l.CD_BU)], ind = b && INDICADORES[b][chave(l.CD_INDICADOR)];
    const ano = numero(l.NR_ANO), mes = numero(l.NR_MES);
    if (!ind || !ano || !(mes >= 1 && mes <= 12)) { avisos.push(`linha ignorada: ${l.CD_BU}/${l.CD_INDICADOR} ${l.NR_ANO}-${l.NR_MES}`); continue; }
    anos.add(ano);
    const d = no(b, ano), s = (d[ind] = d[ind] || { b: Array(12).fill(null), a: Array(12).fill(null) });
    s.b[mes - 1] = numero(l.VL_B);
    s.a[mes - 1] = numero(l.VL_AF);
  }
  const listaAnos = [...anos].sort((x, y) => x - y);
  for (const b of Object.values(BUS)) {
    for (const ano of listaAnos) {
      const d = no(b, ano);
      for (const ind of Object.values(INDICADORES[b])) {
        const s = (d[ind] = d[ind] || { b: Array(12).fill(null), a: Array(12).fill(null) });
        let faltas = 0;
        ['b', 'a'].forEach((k) => { s[k] = s[k].map((v) => { if (v === null) { faltas++; return 0; } return v; }); });
        if (faltas) avisos.push(`${b}/${ind} ${ano}: ${faltas} valor(es) sem dado, exibidos como 0`);
      }
    }
  }

  const ordenadas = [...pontes].sort((x, y) => numero(x.NR_ORDEM) - numero(y.NR_ORDEM));
  for (const ano of listaAnos) {
    const d = no('vbm', ano);
    for (const p of Object.values(PONTES)) d[p] = [];
  }
  for (const l of ordenadas) {
    const ano = numero(l.NR_ANO), p = PONTES[chave(l.CD_PONTE)], tipo = String(l.TP_ITEM || '').trim().toLowerCase();
    if (!p || !anos.has(ano) || TIPOS.indexOf(tipo) < 0) { avisos.push(`ponte ignorada: ${l.CD_PONTE} ${l.NR_ANO} ${l.DS_ITEM}`); continue; }
    const item = { tipo };
    if (tipo !== 'zero') item.lbl = String(l.DS_ITEM || '').trim();
    if (tipo === 'tot' || tipo === 'd' || tipo === 'ref') item.v = numero(l.VL_ITEM) || 0;
    if (l.FL_CINZA === true || Number(l.FL_CINZA) === 1) item.cinza = true;
    no('vbm', ano)[p].push(item);
  }

  if (atualizacao && numero(atualizacao.NR_ANO_REAL) && numero(atualizacao.NR_MES_REAL)) {
    ultimo = { ano: numero(atualizacao.NR_ANO_REAL), mes: numero(atualizacao.NR_MES_REAL) };
  } else if (listaAnos.length) {
    ultimo = { ano: listaAnos[listaAnos.length - 1], mes: 12 };
    avisos.push('003_hob_atualizacao.sql sem último mês real: considerado dezembro do último ano');
  }
  const dt = atualizacao && atualizacao.DT_ATUALIZACAO ? new Date(atualizacao.DT_ATUALIZACAO) : null;
  return { fonte: 'db', atualizado: dt && !isNaN(dt) ? dt.toISOString() : null, anos: listaAnos, ultimoReal: ultimo, bu, avisos };
}

function criarHobRouter({ runQuery, sqls }) {
  sqls = sqls || Object.fromEntries(Object.entries(ARQUIVOS).map(([k, a]) => [k, carregarSql(a)]));
  const CACHE_MS = Math.max(0, parseInt(process.env.HOB_CACHE_TTL_S || '300', 10)) * 1000;
  let cache = null, emAndamento = null;

  async function buscar() {
    const [m, p, a] = await Promise.all([runQuery(sqls.mensal), runQuery(sqls.pontes), runQuery(sqls.atualizacao)]);
    const dados = montarDados({ mensal: m.recordset || [], pontes: p.recordset || [], atualizacao: (a.recordset || [])[0] || null });
    if (dados.avisos.length) console.warn(`${TAG} ${dados.avisos.length} aviso(s) nos dados:`, dados.avisos.slice(0, 5).join(' | '));
    return dados;
  }

  const router = express.Router();
  router.get('/ping', (req, res) => res.json({ ok: true, pendentes: consultasPendentes(sqls).map((k) => ARQUIVOS[k]) }));
  router.get('/dados', async (req, res) => {
    const pendentes = consultasPendentes(sqls);
    if (pendentes.length) {
      return res.status(503).json({ error: 'Queries not configured yet.', codigo: 'CONSULTAS_PENDENTES', pendentes: pendentes.map((k) => ARQUIVOS[k]) });
    }
    try {
      if (!cache || Date.now() - cache.em > CACHE_MS) {
        emAndamento = emAndamento || buscar().finally(() => { emAndamento = null; });
        cache = { em: Date.now(), dados: await emAndamento };
      }
      res.json(cache.dados);
    } catch (err) {
      console.error(`${TAG} erro em /dados:`, err.message);
      res.status(500).json({ error: 'Database query failed.', codigo: 'ERRO_BANCO' });
    }
  });
  return router;
}

module.exports = { criarHobRouter, montarDados, carregarSql, consultasPendentes, ARQUIVOS, BUS, INDICADORES, PONTES, PENDENTE };
