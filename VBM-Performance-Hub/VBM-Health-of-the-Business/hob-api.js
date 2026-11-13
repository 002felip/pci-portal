/**
 * VBM Health of the Business — rotas de dados como MÓDULO.
 *
 * Mesmo contrato do coo-api.js do COO-Business-Units-Dashboard (e do performancehub-api.js do
 * VBM-Performance-Studio): os dois pontos de entrada (portal.js, dentro do Portal; server.js,
 * standalone) montam ESTE router, e cada um injeta o seu `runQuery`.
 * Contrato: `runQuery(sql, params?)` devolve algo com `.recordset` (formato do pacote `mssql`);
 * `params` é `{ nome: [tipoMssql, valor] }` e cada entrada vira `request.input` — nada da
 * requisição é concatenado na SQL.
 *
 * Fonte dos gráficos: as cargas gravadas em IBP.PHUB_PERFORMANCESTUDIO (a tabela do COO e do Studio),
 * com o ID_DASH do Health of the Business (HOB_ID_DASH), por database/003_carga_mensal_hob.sql.
 * Cada carga é um ciclo (DT_REF, dia 1 do mês; ex.: 2026-10-01 = realizado até setembro). A leitura
 * é database/001_hob_dashboard.sql: mês (CD_PERIODO 'MONTH') e ano ('YEAR'), séries 1 = Budget e
 * 3 = Act/Fcst. Nome, ordem, unidade e casas decimais do KPI: IBP.DASHBOARD, como no COO.
 *
 * Qual KPI alimenta cada gráfico (e cada degrau das pontes) vem da configuração da tela em
 * IBP.PHUB_PS_SETUP (CD_VISAO 'VBM_HEALTH_OF_THE_BUSINESS', database/005_config_hob.sql); sem o
 * registro, vale CONFIG_PADRAO abaixo.
 *
 * FCF YEAR: IBP.WATERFALL (database/002_hob_waterfall.sql, site e ano inicial da configuração), lido à
 * parte — não depende do HOB_ID_DASH.
 *
 * Sem HOB_ID_DASH as rotas da carga respondem 503 { codigo: 'ID_DASH_PENDENTE' } e a página segue
 * com os dados de demonstração (selo "Dados demo"), já com o FCF YEAR do banco quando /waterfall responde.
 *
 * Rotas (ciclo = AAAA-MM de uma carga gravada; sem ele, a carga mais recente):
 *   GET /ping                    diagnóstico sem banco
 *   GET /ciclos                  cargas gravadas (DT_REF), da mais recente para a mais antiga
 *   GET /config                  a configuração em uso (registro do banco ou padrão do código)
 *   GET /indicadores?ciclo=      tudo o que a tela desenha, no formato de window.HOB_DATA do index.html
 *   GET /waterfall               FCF YEAR por ano, de IBP.WATERFALL
 *   GET /waterfall?bruto=1       colunas e linhas como vieram da tabela (só com HOB_DIAGNOSTICO=1)
 *   GET /atualizacao?ciclo=      situação da atualização de cada gráfico da carga (SG_STATUS/DT_ATUALIZACAO,
 *                                gravados por database/007_status_atualizacao_hob.sql, como o COO)
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const sql = require('mssql');

const TAG = '[vbm-health-of-the-business]';
// Segundos de env (inteiro positivo) ou o padrão
function segundos(valor, padrao) { const n = Number(valor); return Number.isInteger(n) && n > 0 ? n * 1000 : padrao * 1000; }
// Mesmos padrões do COO: cache, refresh e tolerância a banco fora
const CACHE_TTL_MS = segundos(process.env.HOB_CACHE_TTL_S, 300);
const FRESCO_MS = segundos(process.env.HOB_FRESCO_S, 15);
const DESATUALIZADO_MAX_MS = segundos(process.env.HOB_DESATUALIZADO_MAX_S, 2 * 3600);
const LIMITE_POR_MINUTO = 240;

// Nome comparável: sem acento, espaços, pontuação ou maiúsculas (mesma regra do COO)
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// ── Configuração da tela ──
// bus:          sites (IBP.DASHBOARD.ID_SITE) de cada Business Unit; vazio = qualquer site do dashboard
// indicadores:  série da tela → nomes do KPI em IBP.DASHBOARD.NM_KPIS_DASH (o primeiro que existir)
// pontes:       degraus das pontes, na ordem. tipo: tot | d | sub | ref | zero (ver o index.html);
//               kpi + serie ('B' | 'AF') + ano (0 = ano da tela, -1 = anterior) dão o valor;
//               {ano} no rótulo vira o ano do valor. cinza: coluna no cinza do Budget.
const CONFIG_VISAO = 'VBM_HEALTH_OF_THE_BUSINESS';
const CONFIG_PADRAO = {
  // FCF YEAR: IBP.WATERFALL (consulta do time de dados: ID_SITE = 40, ID_TIPO = 2, desde 2025)
  fcf: { site: 40, tipo: 2, anoInicial: 2025 },
  // 2026 EBITDA YEAR: a mesma consulta de IBP.WATERFALL com ID_TIPO = 3
  ebitdaPonte: { site: 40, tipo: 3, anoInicial: 2025 },
  // EBITDA (gráfico por período, seletor VBM | Copper | Nickel | Others): carga do Health of the Business em
  // IBP.PHUB_PERFORMANCESTUDIO (ID_DASH 16). KPI EBITDA (ID_KPI 73) por site, um negócio por vez no seletor:
  // VBM 40, Copper 38, Nickel 39; Others = EBITDA (KPI 73) dos sites 45, 102 e 46 da operação 11, somados
  // (outros.kpis e outros.sites ajustáveis no 005; sites vazio = qualquer site)
  ebitda: { idDash: 16, idKpi: 73, sites: { vbm: [40], cu: [38], ni: [39] }, outros: { idOperacao: 11, kpis: [73], sites: [45, 102, 46] } },
  // Demais gráficos mês a mês: um KPI (ID_KPI) da carga do dashboard (ID_DASH 16) por série, no site da página
  // (VBM 40, Copper 38, Nickel 39). null = ainda sem KPI definido (o gráfico segue na demonstração)
  coo: { idDash: 16, sites: { vbm: 40, cu: 38, ni: 39 }, kpis: {
    // IBP.DASHBOARD (ID_DASH 16): Copper 38 · Production 22 (op. 12), Sales 34 (op. 8); Nickel 39 · Production 51
    // (op. 12), Sales 41 (op. 8); nos três sites: EBITDA 73, Capex 83, FCF 733; All-in: Sustaining 102, Cost 45, By Product 46
    'vbm.capex': 83,
    'cu.prod': 22, 'cu.sales': 34, 'cu.ebitda': 73, 'cu.capex': 83, 'cu.fcf': 733, 'cu.sus': 102, 'cu.cost': 45, 'cu.byp': 46,
    'ni.prod': 51, 'ni.sales': 41, 'ni.ebitda': 73, 'ni.capex': 83, 'ni.fcf': 733, 'ni.sus': 102, 'ni.cost': 45, 'ni.byp': 46,
  } },
  bus: { vbm: { sites: [] }, cu: { sites: [] }, ni: { sites: [] } },
  indicadores: {
    vbm: { ebitdaCu: ['EBITDA Copper'], ebitdaNi: ['EBITDA Nickel'], ebitdaOut: ['EBITDA Others', 'EBITDA Other Segments'], capex: ['CAPEX'] },
    cu: { prod: ['Production'], sales: ['Sales'], ebitda: ['EBITDA'], capex: ['CAPEX'], fcf: ['FCF', 'Free Cash Flow'],
      sus: ['All-in | Sustaining', 'Sustaining'], cost: ['All-in | Cost', 'Cost'], byp: ['All-in | By Product', 'By Product'] },
    ni: { prod: ['Production'], sales: ['Sales'], ebitda: ['EBITDA'], capex: ['CAPEX'], fcf: ['FCF', 'Free Cash Flow'],
      sus: ['All-in | Sustaining', 'Sustaining'], cost: ['All-in | Cost', 'Cost'], byp: ['All-in | By Product', 'By Product'] },
  },
  pontes: {
    ebitdaYear: [
      { lbl: 'FY M-1 (Act/Fcst)', tipo: 'tot', kpi: ['EBITDA FY M-1'] },
      { lbl: 'FX impact', tipo: 'd', kpi: ['EBITDA Bridge | FX impact'] },
      { lbl: 'Price', tipo: 'd', kpi: ['EBITDA Bridge | Price'] },
      { lbl: 'Volume', tipo: 'd', kpi: ['EBITDA Bridge | Volume'] },
      { lbl: 'Unit COGS', tipo: 'd', kpi: ['EBITDA Bridge | Unit COGS'] },
      { lbl: 'Other', tipo: 'd', kpi: ['EBITDA Bridge | Other'] },
      { lbl: 'FY Act/Fcst', tipo: 'sub' },
      { tipo: 'zero' },
      { lbl: 'Copper', tipo: 'd', kpi: ['EBITDA Copper'] },
      { lbl: 'Nickel', tipo: 'd', kpi: ['EBITDA Nickel'] },
      { lbl: 'Other Seg.', tipo: 'd', kpi: ['EBITDA Others', 'EBITDA Other Segments'] },
      { lbl: 'Non-Alloc.', tipo: 'd', kpi: ['EBITDA Non-Allocated'] },
    ],
    fcfYear: [
      { lbl: '{ano} Net Debt', tipo: 'tot', kpi: ['Net Debt'], ano: -1 },
      { lbl: 'EBITDA', tipo: 'tot', kpi: ['EBITDA'] },
      { lbl: 'Streaming & Wheaton Bonus', tipo: 'd', kpi: ['FCF Bridge | Streaming & Wheaton Bonus'] },
      { lbl: 'ARO, PTVI, Energy', tipo: 'd', kpi: ['FCF Bridge | ARO, PTVI, Energy'] },
      { lbl: 'Working Capital', tipo: 'd', kpi: ['FCF Bridge | Working Capital'] },
      { lbl: 'Gross Operational Cash Flow', tipo: 'sub', cinza: true },
      { lbl: 'Investments', tipo: 'd', kpi: ['FCF Bridge | Investments'] },
      { lbl: 'Income Tax', tipo: 'd', kpi: ['FCF Bridge | Income Tax'] },
      { lbl: 'Financial Expenses / Income', tipo: 'd', kpi: ['FCF Bridge | Financial Expenses / Income'] },
      { lbl: 'Others', tipo: 'd', kpi: ['FCF Bridge | Others'] },
      { lbl: 'Free Cash Flow', tipo: 'sub', cinza: true },
      { lbl: 'Debt Adjustments (accrued interest, FX variation)', tipo: 'tot', kpi: ['FCF Bridge | Debt Adjustments'], cinza: true },
      { lbl: '{ano}B Net Debt', tipo: 'ref', kpi: ['Net Debt'], serie: 'B', cinza: true },
      { lbl: '{ano}F Net Debt', tipo: 'tot', kpi: ['Net Debt'] },
    ],
  },
};
const BUS = ['vbm', 'cu', 'ni'];
const TIPOS = ['tot', 'd', 'sub', 'ref', 'zero'];
const CONFIG_SQL = `
SELECT TOP 1 S.DS_LAYOUT
FROM IBP.PHUB_PS_SETUP S
WHERE S.CD_VISAO = @visao
ORDER BY S.DT_ATUALIZACAO DESC`;
const texto = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
const nomes = (v) => (Array.isArray(v) ? v.map(n => texto(n, 200)).filter(Boolean).slice(0, 20) : []);
// Só o formato esperado passa; o que faltar vem do padrão do código. JSON inválido → null (vale o padrão)
function normalizarConfigHob(json) {
  let c;
  try { c = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
  if (!c || typeof c !== 'object') return null;
  const out = JSON.parse(JSON.stringify(CONFIG_PADRAO));
  for (const k of ['fcf', 'ebitdaPonte']) {
    const f = c[k];
    if (!f || typeof f !== 'object') continue;
    const site = Number(f.site), tipo = Number(f.tipo), ano = Number(f.anoInicial);
    if (Number.isInteger(site) && site > 0) out[k].site = site;
    if (f.tipo != null && Number.isInteger(tipo) && tipo > 0) out[k].tipo = tipo;
    if (Number.isInteger(ano) && ano >= 2000 && ano <= 2100) out[k].anoInicial = ano;
  }
  if (c.coo && typeof c.coo === 'object') {
    const id = Number(c.coo.idDash);
    if (Number.isInteger(id) && id > 0) out.coo.idDash = id;
    for (const b of ['vbm', 'cu', 'ni']) { const n = Number(c.coo.sites && c.coo.sites[b]); if (Number.isInteger(n) && n > 0) out.coo.sites[b] = n; }
    for (const [k, v] of Object.entries(c.coo.kpis || {})) {
      if (!(k in out.coo.kpis)) continue;
      const n = Number(v);
      out.coo.kpis[k] = v === null ? null : Number.isInteger(n) && n > 0 ? n : out.coo.kpis[k];
    }
  }
  if (c.ebitda && typeof c.ebitda === 'object') {
    const id = Number(c.ebitda.idDash), kpi = Number(c.ebitda.idKpi);
    if (Number.isInteger(id) && id > 0) out.ebitda.idDash = id;
    if (Number.isInteger(kpi) && kpi > 0) out.ebitda.idKpi = kpi;
    const ints = (v) => (Array.isArray(v) ? v.map(Number).filter(n => Number.isInteger(n) && n > 0) : null);
    for (const seg of ['vbm', 'cu', 'ni']) {
      const lista = c.ebitda.sites && ints(c.ebitda.sites[seg]);
      if (lista) out.ebitda.sites[seg] = lista;
    }
    const o = c.ebitda.outros;
    if (o && typeof o === 'object') {
      const op = Number(o.idOperacao);
      if (Number.isInteger(op) && op > 0) out.ebitda.outros.idOperacao = op;
      if (ints(o.kpis) && ints(o.kpis).length) out.ebitda.outros.kpis = ints(o.kpis);
      if (ints(o.sites)) out.ebitda.outros.sites = ints(o.sites);
    }
  }
  for (const b of BUS) {
    const sites = c.bus && c.bus[b] && Array.isArray(c.bus[b].sites) ? c.bus[b].sites.map(Number).filter(n => Number.isInteger(n) && n > 0) : null;
    if (sites) out.bus[b].sites = sites;
    for (const [ind, lista] of Object.entries((c.indicadores || {})[b] || {})) {
      if (out.indicadores[b][ind] && nomes(lista).length) out.indicadores[b][ind] = nomes(lista);
    }
  }
  for (const p of Object.keys(out.pontes)) {
    const itens = c.pontes && Array.isArray(c.pontes[p]) ? c.pontes[p] : null;
    if (!itens) continue;
    const validos = itens.map(i => (i && TIPOS.includes(i.tipo) ? {
      tipo: i.tipo, lbl: texto(i.lbl, 120) || undefined, kpi: nomes(i.kpi), serie: i.serie === 'B' ? 'B' : 'AF',
      ano: Number.isInteger(i.ano) && i.ano >= -5 && i.ano <= 0 ? i.ano : 0, cinza: i.cinza === true || undefined,
    } : null)).filter(Boolean);
    if (validos.length) out.pontes[p] = validos;
  }
  return out;
}

// ?ciclo=AAAA-MM (ou AAAA-MM-01) → 'AAAA-MM'; vazio → null; inválido → undefined
function lerCiclo(valor) {
  if (valor === undefined || valor === '') return null;
  const m = typeof valor === 'string' && /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(valor);
  if (!m || +m[1] < 2000 || +m[1] > 2100) return undefined;
  return `${m[1]}-${m[2]}`;
}
// DT_REF do mssql vem como Date (UTC) → 'AAAA-MM'
function cicloDe(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// Casas decimais do KPI (IBP.DASHBOARD.VL_CASADECIMAL): inteiro de 0 a 6; fora disso, null (padrão da página)
function casasDe(v) { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n >= 0 && n <= 6 ? n : null; }
// Cadastro do KPI a partir das linhas: fica o primeiro com casas decimais e unidade; linha sem eles não apaga o anterior
function melhorMeta(atual, l, nomePadrao) {
  const novo = { nome: String(l.NM_KPI || nomePadrao).trim(), unid: l.SG_UNID ? String(l.SG_UNID).trim() : null, casas: casasDe(l.VL_CASADECIMAL) };
  if (!atual) return novo;
  return { nome: atual.nome || novo.nome, unid: atual.unid || novo.unid, casas: atual.casas != null ? atual.casas : novo.casas };
}

// Linhas da carga (001_hob_dashboard.sql) + configuração → formato da página (window.HOB_DATA).
// Mês sem valor vira 0 e entra em avisos; KPI não encontrado também (o card mostra 0, o log diz qual falta).
function montarDados(linhas, config, ciclo) {
  const [anoC, mesC] = ciclo.split('-').map(Number);
  // último mês realizado: o mês anterior ao do ciclo (2026-10 → setembro de 2026)
  const ultimoReal = { ano: anoC, mes: mesC }; // DT_REF da carga = mês em fechamento (como o COO)
  const avisos = [], anos = new Set(), meta = {};
  const porNome = new Map(); // nome normalizado → linhas
  for (const l of linhas) {
    const n = normalizar(l.NM_KPI);
    if (!porNome.has(n)) porNome.set(n, []);
    porNome.get(n).push(l);
    if (Number.isInteger(Number(l.ANO))) anos.add(Number(l.ANO));
  }
  const listaAnos = [...anos].sort((x, y) => x - y);
  // Linhas de um KPI (primeiro nome que existir), só dos sites da BU
  function linhasDe(lista, sites) {
    for (const nome of lista) {
      const ls = (porNome.get(normalizar(nome)) || []).filter(l => !sites.length || sites.includes(Number(l.ID_SITE)));
      if (ls.length) {
        const sitesAchados = new Set(ls.map(l => Number(l.ID_SITE)));
        if (sitesAchados.size > 1 && !sites.length) avisos.push(`"${nome}" existe em ${sitesAchados.size} sites: defina bus.<bu>.sites na configuração (valores somados)`);
        return ls;
      }
    }
    return null;
  }
  const bu = {};
  for (const b of BUS) {
    const sites = config.bus[b].sites;
    bu[b] = {}; meta[b] = {};
    for (const ano of listaAnos) bu[b][ano] = {};
    for (const [ind, lista] of Object.entries(config.indicadores[b])) {
      const ls = linhasDe(lista, sites) || [];
      if (!ls.length) avisos.push(`${b}/${ind}: KPI não encontrado (${lista.join(' | ')})`);
      const l0 = ls[0];
      if (l0) meta[b][ind] = { nome: String(l0.NM_KPI).trim(), unid: l0.SG_UNID ? String(l0.SG_UNID).trim() : null, casas: casasDe(l0.VL_CASADECIMAL) };
      for (const ano of listaAnos) {
        const s = { b: Array(12).fill(null), a: Array(12).fill(null) };
        for (const l of ls) {
          if (l.CD_PERIODO !== 'MONTH' || Number(l.ANO) !== ano) continue;
          const m = Number(l.MES) - 1, k = l.SERIE === 'B' ? 'b' : 'a', v = l.VL_KPI == null ? 0 : Number(l.VL_KPI);
          if (m >= 0 && m < 12) s[k][m] = (s[k][m] || 0) + v;
        }
        let faltas = 0;
        ['b', 'a'].forEach(k => { s[k] = s[k].map(v => { if (v === null) { faltas++; return 0; } return v; }); });
        if (faltas && ls.length) avisos.push(`${b}/${ind} ${ano}: ${faltas} mês(es) sem valor, exibidos como 0`);
        bu[b][ano][ind] = s;
      }
    }
  }
  // Pontes da visão consolidada (valores anuais)
  const valorAnual = (lista, serie, ano) => {
    const ls = linhasDe(lista, config.bus.vbm.sites);
    if (!ls) return null;
    const vs = ls.filter(l => l.CD_PERIODO === 'YEAR' && Number(l.ANO) === ano && l.SERIE === serie);
    return vs.length ? vs.reduce((s, l) => s + (l.VL_KPI == null ? 0 : Number(l.VL_KPI)), 0) : null;
  };
  for (const ano of listaAnos) {
    for (const [p, itens] of Object.entries(config.pontes)) {
      bu.vbm[ano][p] = itens.map(i => {
        const item = { tipo: i.tipo };
        const anoV = ano + (i.ano || 0);
        if (i.tipo !== 'zero') item.lbl = String(i.lbl || '').replace('{ano}', anoV);
        if (i.tipo === 'tot' || i.tipo === 'd' || i.tipo === 'ref') {
          const v = valorAnual(i.kpi || [], i.serie === 'B' ? 'B' : 'AF', anoV);
          if (v === null && ano === ultimoReal.ano) avisos.push(`ponte ${p}: "${item.lbl}" sem valor (${(i.kpi || []).join(' | ')})`);
          item.v = v || 0;
        }
        if (i.cinza) item.cinza = true;
        return item;
      });
    }
  }
  return { fonte: 'db', ciclo, anos: listaAnos, ultimoReal, bu, meta, avisos: [...new Set(avisos)] };
}

// ── IBP.WATERFALL → degraus do FCF YEAR ──
// As colunas são lidas pelo padrão de nomes do IBP: rótulo (DS_/NM_ texto), valor (VL_ numérico),
// ordem (ORDEM/SEQ/ID_ITEM) e tipo (TP_/TIPO, opcional). Para cada ano vale o maior DT_REF do ano.
// O tipo e o cinza de cada degrau vêm do rótulo comparado à configuração (pontes.fcfYear); rótulo
// desconhecido entra como variação ('d'). Subtotais da configuração ausentes da tabela são inseridos
// na posição da configuração (calculados pela tela).
// rótulo sem o ano ('2026B Net Debt' e '{ano}B Net Debt' → 'bnetdebt'; o B/F continua distinguindo)
const semAno = (t) => normalizar(String(t || '').replace(/\{ano\}|(19|20)\d{2}/g, ''));
function colunasWaterfall(l) {
  const cols = Object.keys(l || {});
  const ehNum = (k) => typeof l[k] === 'number' || (l[k] != null && l[k] !== '' && !isNaN(Number(l[k])) && !(l[k] instanceof Date));
  const ehTexto = (k) => typeof l[k] === 'string' && isNaN(Number(l[k]));
  const achar = (regs, filtro) => { for (const r of regs) { const k = cols.find(c => r.test(c) && filtro(c)); if (k) return k; } return null; };
  return {
    data: achar([/^DT_REF$/i, /^DT_/i], () => true),
    rotulo: achar([/^DS_(ITEM|WATERFALL|DESCRICAO|CONTA|LINHA)/i, /^NM_(ITEM|WATERFALL|CONTA|LINHA|KPI)/i, /^(DS|NM)_/i, /./], (c) => ehTexto(c) && !/SITE|USUARIO|SISTEMA|STATUS|ATUALIZ|SITUACAO/i.test(c)),
    valor: achar([/^VL_(ITEM|VALOR|WATERFALL|KPI)$/i, /^VL_/i, /VALOR|VALUE/i], ehNum),
    ordem: achar([/ORDEM|ORDER/i, /SEQ/i, /^ID_ITEM$/i, /^NR_/i], ehNum),
    tipo: achar([/^TP_/i, /TIPO|TYPE/i], (c) => typeof l[c] === 'string'),
    // situação da atualização da referência (a tabela diz se está atualizada): S/N, 1/0, true/false ou texto
    status: achar([/^(SG|FL|IN|ST|CD)_(STATUS|ATUALIZ|VALID|SITUACAO)/i, /VALIDATE|ATUALIZADO|SITUACAO|STATUS/i], (c) => !/^DT_/i.test(c)),
    atualizacao: achar([/^DT_ATUALIZ/i, /^DT_(CARGA|ALTERACAO|MODIFICACAO)/i], () => true),
  };
}
// Valor da coluna de situação → atualizado? (null = não dá para dizer)
function atualizadoDe(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const t = String(v).trim().toUpperCase();
  if (['S', 'Y', '1', 'SIM', 'YES', 'TRUE', 'OK', 'ATUALIZADO', 'UPDATED', '.'].includes(t)) return true;
  if (['N', '0', '2', 'NAO', 'NÃO', 'NO', 'FALSE', 'PENDENTE', 'PENDING', 'DESATUALIZADO'].includes(t) || /PENDING|PENDENTE/.test(t)) return false;
  return null;
}
// Ponte da tela → chave da configuração com site/tipo/ano de IBP.WATERFALL
const FONTE_PONTE = { fcfYear: 'fcf', ebitdaYear: 'ebitdaPonte' };
function mapearWaterfall(linhas, config, ponte = 'fcfYear') {
  const avisos = [], anos = {}, referencias = [];
  if (!linhas.length) return { anos, referencias, colunas: null, avisos: ['IBP.WATERFALL sem linhas para o site/tipo/ano'] };
  const col = colunasWaterfall(linhas[0]);
  if (!col.data || !col.rotulo || !col.valor) {
    return { anos, referencias, colunas: col, avisos: [`colunas não reconhecidas em IBP.WATERFALL (data/rótulo/valor): ${Object.keys(linhas[0]).join(', ')}`] };
  }
  const modelo = config.pontes[ponte].filter(i => i.tipo !== 'zero');
  const ref = new Map(modelo.map(i => [semAno(i.lbl), i]));
  // Uma ponte por referência (DT_REF): a tela escolhe a do Ano/Mês dos filtros
  const porRef = new Map();
  for (const l of linhas) {
    const d = l[col.data] instanceof Date ? l[col.data] : new Date(l[col.data]);
    if (isNaN(d)) continue;
    const chave = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!porRef.has(chave)) porRef.set(chave, { dt: d, linhas: [] });
    porRef.get(chave).linhas.push(l);
  }
  function itensDe(ls, rotuloRef) {
    const itens = ls.slice().sort((a, b) => (col.ordem ? Number(a[col.ordem]) - Number(b[col.ordem]) : 0)).map(l => {
      const lbl = String(l[col.rotulo]).trim(), c = ref.get(semAno(lbl));
      const tipoTab = col.tipo ? String(l[col.tipo] || '').trim().toLowerCase() : '';
      const tipo = TIPOS.includes(tipoTab) ? tipoTab : c ? c.tipo : 'd';
      if (!c && !TIPOS.includes(tipoTab)) avisos.push(`${rotuloRef}: "${lbl}" não está na configuração (entra como variação)`);
      const item = { tipo, lbl };
      if (tipo !== 'sub' && tipo !== 'zero') item.v = l[col.valor] == null ? 0 : Number(l[col.valor]);
      if (c && c.cinza) item.cinza = true;
      return item;
    });
    // subtotais da configuração que a tabela não traz: na mesma posição relativa
    modelo.forEach((i, pos) => {
      if (i.tipo !== 'sub' || itens.some(x => semAno(x.lbl) === semAno(i.lbl))) return;
      const ant = modelo.slice(0, pos).reverse().find(x => itens.some(y => semAno(y.lbl) === semAno(x.lbl)));
      const onde = ant ? itens.findIndex(y => semAno(y.lbl) === semAno(ant.lbl)) + 1 : 0;
      itens.splice(onde, 0, { tipo: 'sub', lbl: i.lbl, ...(i.cinza ? { cinza: true } : {}) });
    });
    // quebras da configuração ('zero': começa outro gráfico, do 0 e sem fio do anterior), depois do degrau que as
    // antecede na configuração — ex.: 2026 EBITDA YEAR, FY Act/Fcst | Copper, Nickel, Other Seg., Non-Allocated
    const cfgPonte = config.pontes[ponte];
    cfgPonte.forEach((i, pos) => {
      if (i.tipo !== 'zero') return;
      const ant = cfgPonte.slice(0, pos).reverse().find(x => x.tipo !== 'zero' && itens.some(y => semAno(y.lbl || '') === semAno(x.lbl)));
      const onde = ant ? itens.findIndex(y => semAno(y.lbl || '') === semAno(ant.lbl)) : -1;
      if (onde >= 0 && onde < itens.length - 1 && itens[onde + 1].tipo !== 'zero') itens.splice(onde + 1, 0, { tipo: 'zero' });
    });
    return itens;
  }
  for (const [chave, g] of [...porRef].sort((x, y) => x[0].localeCompare(y[0]))) {
    const r = { ref: chave, ano: g.dt.getUTCFullYear(), mes: g.dt.getUTCMonth() + 1, dtRef: g.dt.toISOString(), itens: itensDe(g.linhas, chave) };
    // situação gravada na própria IBP.WATERFALL: pendente se alguma linha da referência não está atualizada
    if (col.status) {
      const vals = g.linhas.map(l => atualizadoDe(l[col.status])).filter(v => v !== null);
      const dts = col.atualizacao ? g.linhas.map(l => new Date(l[col.atualizacao]).getTime()).filter(n => !isNaN(n)) : [];
      if (vals.length) r.situacao = { status: vals.every(Boolean) ? 'ok' : 'pendente', dt: dts.length ? new Date(Math.max(...dts)).toISOString() : null, coluna: col.status };
    }
    referencias.push(r);
    anos[r.ano] = { dtRef: r.dtRef, itens: r.itens }; // em ordem crescente: fica a mais recente do ano
  }
  return { anos, referencias, colunas: col, avisos: [...new Set(avisos)] };
}

// Linha de período (QUARTER, YTD, YTG, YEAR) gravada pela carga para o mês DT_IND → s.per[mês][período] = { b, a }
// (sem CD_PERIODO, a linha é do mês). A tela usa estes valores no mês escolhido em vez de somar os meses.
const PERIODOS = ['QUARTER', 'YTD', 'YTG', 'YEAR'];
function periodoDe(l) { const p = String(l.CD_PERIODO || 'MONTH').trim().toUpperCase(); return p === 'MONTH' || PERIODOS.includes(p) ? p : null; }
function somarPeriodo(s, l, cd, m) {
  s.per = s.per || {};
  const g = s.per[m + 1] = s.per[m + 1] || {};
  const v = g[cd] = g[cd] || { b: null, a: null }, k = l.SERIE === 'B' ? 'b' : 'a';
  v[k] = (v[k] || 0) + (l.VL_KPI == null ? 0 : Number(l.VL_KPI));
}

// ── EBITDA (004_hob_ebitda.sql) → séries mensais por segmento ──
// KPI 73 (ebitda.idKpi) por ID_SITE: VBM 40, Copper 38 e Nickel 39 (cada um é uma opção do seletor).
// Others: soma de ebitda.outros (KPI 73 nos sites 45, 102 e 46) na operação 11; com outros.sites vazio, de qualquer site.
// Linha fora da configuração entra em avisos (não é somada).
function montarEbitda(linhas, linhasOutros, config, ciclo) {
  const [anoC, mesC] = ciclo.split('-').map(Number);
  const ultimoReal = { ano: anoC, mes: mesC }; // DT_REF da carga = mês em fechamento (como o COO)
  const SEG = { vbm: 'ebitdaVbm', cu: 'ebitdaCu', ni: 'ebitdaNi', out: 'ebitdaOut' };
  const avisos = [], anos = {}, sitesUsados = {}, fora = new Set();
  // cadastro (IBP.DASHBOARD) de cada opção do seletor, pelas linhas dela: unidade e casas decimais próprias
  const metas = {};
  const metaDe = (seg, l) => { metas[seg] = melhorMeta(metas[seg], l, seg === 'out' ? 'Others' : 'EBITDA'); };
  const somar = (seg, l, rotulo) => {
    const ano = Number(l.ANO), m = Number(l.MES) - 1;
    if (!Number.isInteger(ano) || m < 0 || m > 11) return;
    sitesUsados[seg] = sitesUsados[seg] || new Set(); sitesUsados[seg].add(rotulo);
    if (!anos[ano]) { anos[ano] = {}; for (const k of Object.values(SEG)) anos[ano][k] = { b: Array(12).fill(0), a: Array(12).fill(0) }; }
    const cd = periodoDe(l);
    if (!cd) return;
    if (cd !== 'MONTH') return somarPeriodo(anos[ano][SEG[seg]], l, cd, m);
    anos[ano][SEG[seg]][l.SERIE === 'B' ? 'b' : 'a'][m] += l.VL_KPI == null ? 0 : Number(l.VL_KPI);
  };
  for (const l of linhas) {
    const site = Number(l.ID_SITE), seg = ['vbm', 'cu', 'ni'].find(k => config.ebitda.sites[k].includes(site));
    if (!seg) { if (!config.ebitda.outros.sites.includes(site)) fora.add(String(site)); continue; }
    metaDe(seg, l);
    somar(seg, l, l.NM_SITE ? `${site} ${String(l.NM_SITE).trim()}` : String(site));
  }
  const O = config.ebitda.outros, sitesOutros = new Set();
  for (const l of linhasOutros || []) {
    if (Number(l.ID_OPERACAO) !== O.idOperacao || !O.kpis.includes(Number(l.ID_KPI))) continue;
    if (O.sites.length && !O.sites.includes(Number(l.ID_SITE))) continue;
    sitesOutros.add(Number(l.ID_SITE));
    metaDe('out', l);
    somar('out', l, `site ${l.ID_SITE}${l.NM_SITE ? ' ' + String(l.NM_SITE).trim() : ''} · KPI ${l.ID_KPI}`);
  }
  if (sitesOutros.size > 1 && !O.sites.length) avisos.push(`Others: KPIs ${O.kpis.join(', ')} em ${sitesOutros.size} sites (${[...sitesOutros].join(', ')}), somados; defina ebitda.outros.sites para limitar`);
  if (fora.size) avisos.push(`sites com o KPI ${config.ebitda.idKpi} fora da configuração (não usados): ${[...fora].join(', ')}`);
  for (const k of ['vbm', 'cu', 'ni']) if (!sitesUsados[k] && Object.keys(anos).length) avisos.push(`${k}: nenhum dos sites ${config.ebitda.sites[k].join(', ')} tem o KPI ${config.ebitda.idKpi} no ciclo ${ciclo}`);
  // Sem Other Segments cadastrado (nenhuma linha de ebitda.outros): Others = VBM − Copper − Nickel, mês a mês e nos
  // períodos gravados (mesmo fator em IBP.DASHBOARD.VL_FATOR nos três sites)
  let outrosCalculado = false;
  if (!sitesUsados.out && sitesUsados.vbm && sitesUsados.cu && sitesUsados.ni) {
    outrosCalculado = true;
    const menos = (v, c, n) => (v == null ? null : v - (c || 0) - (n || 0));
    for (const a of Object.values(anos)) {
      const V = a.ebitdaVbm, C = a.ebitdaCu, N = a.ebitdaNi, Ot = a.ebitdaOut;
      for (const k of ['b', 'a']) Ot[k] = V[k].map((v, i) => v - C[k][i] - N[k][i]);
      if (V.per) {
        Ot.per = {};
        for (const [m, g] of Object.entries(V.per)) {
          Ot.per[m] = {};
          for (const [cd, x] of Object.entries(g)) {
            const c = (C.per && C.per[m] && C.per[m][cd]) || {}, n = (N.per && N.per[m] && N.per[m][cd]) || {};
            Ot.per[m][cd] = { b: menos(x.b, c.b, n.b), a: menos(x.a, c.a, n.a) };
          }
        }
      }
    }
    metas.out = metas.vbm ? { ...metas.vbm } : metas.out;
    avisos.push(`Others calculado (VBM − Copper − Nickel): ebitda.outros sem linhas no ciclo ${ciclo}`);
  } else if (!sitesUsados.out && Object.keys(anos).length) avisos.push(`out: KPIs ${O.kpis.join(', ')} da operação ${O.idOperacao} sem linhas no ciclo ${ciclo}`);
  if (!Object.keys(anos).length) avisos.push(`KPI ${config.ebitda.idKpi} sem linhas no ciclo ${ciclo} (ID_DASH ${config.ebitda.idDash})`);
  return { ciclo, ultimoReal, anos, outrosCalculado, meta: metas.vbm || metas.cu || metas.ni || null, metas, sites: Object.fromEntries(Object.entries(sitesUsados).map(([k, v]) => [k, [...v]])), avisos };
}

// ── Demais séries da carga do COO: linhas de 004 (um KPI por consulta) → série mensal do site da página ──
function montarSerieCoo(linhas, site) {
  const anos = {};
  let meta = null;
  for (const l of linhas) {
    if (Number(l.ID_SITE) !== site) continue;
    const ano = Number(l.ANO), m = Number(l.MES) - 1;
    if (!Number.isInteger(ano) || m < 0 || m > 11) continue;
    meta = melhorMeta(meta, l, '');
    const s = anos[ano] = anos[ano] || { b: Array(12).fill(0), a: Array(12).fill(0) };
    const cd = periodoDe(l);
    if (!cd) continue;
    if (cd !== 'MONTH') { somarPeriodo(s, l, cd, m); continue; }
    s[l.SERIE === 'B' ? 'b' : 'a'][m] += l.VL_KPI == null ? 0 : Number(l.VL_KPI);
  }
  return { anos, meta };
}

// ── Situação de atualização (SG_STATUS 'S'/'N' e DT_ATUALIZACAO gravados por database/007_status_atualizacao_hob.sql,
// como o 004 do COO) → situação de cada gráfico que vem da carga. Chave do gráfico:
//   vbm.ebitda.vbm | vbm.ebitda.cu | vbm.ebitda.ni | vbm.ebitda.out (opções do seletor do EBITDA)
//   <bu>.<série> de coo.kpis com ID_KPI (ex.: cu.ebitda, ni.ebitda), no site da página
// Gráfico com algum KPI 'N' → pendente; também pendente o KPI sem o realizado (Act) do mês do ciclo na carga
// (SEM_REAL: valor nulo ou 0 em MONTH/ID_TIPO_VISAO 3 no mês do ciclo), mesmo com o log em dia.
// Sem linha com situação → fora (a tela não marca)
const STATUS_SQL = `
SELECT
  R.ID_SITE, R.ID_OPERACAO, R.ID_KPI,
  MIN(R.SG_STATUS) AS SG_STATUS, MAX(R.DT_ATUALIZACAO) AS DT_ATUALIZACAO,
  CASE WHEN ISNULL(MAX(CASE WHEN R.CD_PERIODO = 'MONTH' AND R.ID_TIPO_VISAO = 3 AND R.DT_IND = @dtMes THEN ABS(R.VL_KPI) END), 0) = 0 THEN 1 ELSE 0 END AS SEM_REAL
FROM IBP.PHUB_PERFORMANCESTUDIO R
WHERE R.ID_DASH = @idDash
  AND R.DT_REF = @dtRef
  AND R.SG_STATUS IS NOT NULL
GROUP BY R.ID_SITE, R.ID_OPERACAO, R.ID_KPI`;
// Sem situação gravada na carga (007 ainda não rodou para o ciclo): a mesma regra do 007 (e do 004 do COO), lida na hora
// do log — última atualização em IBP.LOG_PEDRAVISAOCONSOLIDADA >= 1º dia do mês seguinte ao do ciclo (@dtLimite) → 'S'
const STATUS_LOG_SQL = `
SELECT
  R.ID_SITE, R.ID_OPERACAO, R.ID_KPI,
  CASE WHEN MAX(L.DT_ATUALIZACAO) >= @dtLimite THEN 'S' ELSE 'N' END AS SG_STATUS,
  MAX(L.DT_ATUALIZACAO) AS DT_ATUALIZACAO,
  MAX(R.SEM_REAL) AS SEM_REAL
FROM (
  SELECT R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI,
  CASE WHEN ISNULL(MAX(CASE WHEN R.CD_PERIODO = 'MONTH' AND R.ID_TIPO_VISAO = 3 AND R.DT_IND = @dtMes THEN ABS(R.VL_KPI) END), 0) = 0 THEN 1 ELSE 0 END AS SEM_REAL
  FROM IBP.PHUB_PERFORMANCESTUDIO R
  WHERE R.ID_DASH = @idDash AND R.DT_REF = @dtRef
  GROUP BY R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI
) R
LEFT JOIN IBP.LOG_PEDRAVISAOCONSOLIDADA L
  ON L.ID_SISTEMA = R.ID_SISTEMA AND L.ID_SITE = R.ID_SITE
  AND L.ID_OPERACAO = R.ID_OPERACAO AND L.ID_KPI = R.ID_KPI
GROUP BY R.ID_SITE, R.ID_OPERACAO, R.ID_KPI`;
function montarAtualizacao(linhas, config, ciclo) {
  const [anoC, mesC] = ciclo.split('-').map(Number);
  const kpis = linhas.map(l => ({ site: Number(l.ID_SITE), op: Number(l.ID_OPERACAO), kpi: Number(l.ID_KPI),
    ok: String(l.SG_STATUS).trim().toUpperCase() === 'S' && !Number(l.SEM_REAL), semReal: !!Number(l.SEM_REAL), dt: l.DT_ATUALIZACAO || null }));
  const situacao = ({ sites, op, ids }) => {
    const achados = kpis.filter(k => ids.includes(k.kpi) && (!sites || !sites.length || sites.includes(k.site)) && (op == null || k.op === op));
    if (!achados.length) return null;
    const pend = achados.filter(k => !k.ok), base = pend.length ? pend : achados;
    const dts = base.map(k => k.dt).filter(Boolean).map(d => new Date(d).getTime()).filter(n => !isNaN(n));
    // pendente: a última atualização recebida dos KPIs pendentes (algum sem registro → nenhuma)
    const dt = pend.length && dts.length < pend.length ? null : dts.length ? new Date(Math.max(...dts)).toISOString() : null;
    return { status: pend.length ? 'pendente' : 'ok', dt, kpis: achados.length, pendentes: pend.length, ...(pend.some(k => k.semReal) ? { semReal: true } : {}) };
  };
  const cards = {}, E = config.ebitda;
  for (const seg of ['vbm', 'cu', 'ni']) cards[`vbm.ebitda.${seg}`] = situacao({ sites: E.sites[seg], ids: [E.idKpi] });
  // Others calculado (VBM − Copper − Nickel, sem Other Segments cadastrado): a situação dos três sites
  cards['vbm.ebitda.out'] = situacao({ sites: E.outros.sites, op: E.outros.idOperacao, ids: E.outros.kpis })
    || situacao({ sites: [...E.sites.vbm, ...E.sites.cu, ...E.sites.ni], ids: [E.idKpi] });
  for (const [chave, idKpi] of Object.entries(config.coo.kpis)) {
    if (idKpi) cards[chave] = situacao({ sites: [config.coo.sites[chave.split('.')[0]]], ids: [idKpi] });
  }
  for (const k of Object.keys(cards)) if (!cards[k]) delete cards[k];
  // mês do ciclo da carga (carga 2026-11 → outubro): meses anteriores já fechados contam como atualizados
  return { ciclo, mesCiclo: { ano: anoC, mes: mesC }, cards, indicadores: kpis.length };
}

// Erro do banco → código para a tela (sem o texto do banco na resposta; o texto vai para o log)
function codigoDoErro(err) {
  const m = String((err && err.message) || '');
  let r;
  if ((r = /Invalid column name '([^']+)'/i.exec(m))) return { codigo: 'COLUNA', detalhe: r[1] };
  if (/Invalid object name/i.test(m)) return { codigo: 'TABELA' };
  if (/permission|denied/i.test(m)) return { codigo: 'PERMISSAO' };
  if (/Login failed|credencial/i.test(m)) return { codigo: 'LOGIN' };
  if (/timeout|timed out/i.test(m)) return { codigo: 'TEMPO' };
  return { codigo: 'ERRO_BANCO' };
}

// Lê o script de database/ e confere os parâmetros que a API passa (falha ao subir, não na tela)
function carregarSql(arquivo, parametros) {
  const textoSql = fs.readFileSync(path.join(__dirname, 'database', arquivo), 'utf8');
  for (const p of parametros) {
    if (!textoSql.includes(p)) throw new Error(`${arquivo}: parâmetro ${p} ausente — revise o script antes de publicar`);
  }
  if (/ID_DASH\s*=\s*\d/.test(textoSql)) throw new Error(`${arquivo}: ID_DASH fixo — use @idDash`);
  return textoSql;
}
const LEITURA = { arquivo: '001_hob_dashboard.sql', parametros: ['@idDash', '@dtRef', 'IBP.PHUB_PERFORMANCESTUDIO', 'IBP.DASHBOARD'] };
const EBITDA = { arquivo: '004_hob_ebitda.sql', parametros: ['@idDash', '@idKpi', '@dtRef', 'IBP.PHUB_PERFORMANCESTUDIO', 'IBP.DASHBOARD', "CD_PERIODO IN ('MONTH', 'QUARTER', 'YTD', 'YTG', 'YEAR')"] };
const WATERFALL = { arquivo: '002_hob_waterfall.sql', parametros: ['IBP.WATERFALL', '@site', '@tipo', '@anoIni'] };

// Cargas do Health of the Business em IBP.PHUB_PERFORMANCESTUDIO (uma por DT_REF), com a hora da gravação
const CICLOS_SQL = `
SELECT R.DT_REF, MAX(COALESCE(R.DT_ATUALIZACAO, R.DT_REF)) AS DT_CARGA
FROM IBP.PHUB_PERFORMANCESTUDIO R
WHERE R.ID_DASH = @idDash
GROUP BY R.DT_REF
ORDER BY R.DT_REF DESC`;

// ID_DASH do dashboard em IBP.DASHBOARD: 16 (o da carga 003_carga_mensal_hob.sql), trocável por HOB_ID_DASH.
// O router aceita sem ID (null: rotas da carga pendentes); portal.js e server.js passam o padrão.
const ID_DASH_PADRAO = 16;
function lerIdDash(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new Error(`HOB_ID_DASH inválido: ${valor}`);
  return n;
}

function criarHobRouter({ runQuery, idDash }) {
  if (typeof runQuery !== 'function') throw new Error('criarHobRouter: `runQuery` é obrigatório');
  const ID_DASH = lerIdDash(idDash);
  const LEITURA_SQL = carregarSql(LEITURA.arquivo, LEITURA.parametros);
  const WATERFALL_SQL = carregarSql(WATERFALL.arquivo, WATERFALL.parametros);
  const EBITDA_SQL = carregarSql(EBITDA.arquivo, EBITDA.parametros);
  const diagnostico = process.env.HOB_DIAGNOSTICO === '1';
  const router = express.Router();
  const cache = new Map();

  // Pedidos simultâneos da mesma consulta esperam a MESMA ida ao banco; falha não fica no cache.
  // Releitura que falha com resultado anterior (até DESATUALIZADO_MAX_MS): serve o anterior, marcado.
  const emAndamento = new Map();
  function comCache(chave, buscar, fresco) {
    const item = cache.get(chave);
    const valido = item && item.expiraEm > Date.now() && !(fresco && Date.now() - item.lidoEm > FRESCO_MS);
    if (valido) return Promise.resolve(item.dados);
    if (emAndamento.has(chave)) return emAndamento.get(chave);
    const inicio = Date.now();
    const p = Promise.resolve().then(buscar).then(dados => {
      cache.set(chave, { dados, lidoEm: Date.now(), expiraEm: Date.now() + CACHE_TTL_MS, desatualizado: false });
      console.log(`${TAG} leitura ${chave}: ${(dados || []).length} linhas em ${Date.now() - inicio} ms${fresco ? ' (refresh)' : ''}`);
      return dados;
    }, err => {
      if (item && Date.now() - item.lidoEm < DESATUALIZADO_MAX_MS) {
        console.error(`${TAG} leitura ${chave} falhou (${err.message}); servindo o resultado de ${new Date(item.lidoEm).toISOString()}`);
        item.desatualizado = true;
        item.expiraEm = Date.now() + Math.min(CACHE_TTL_MS, 60 * 1000);
        return item.dados;
      }
      throw err;
    }).finally(() => emAndamento.delete(chave));
    emAndamento.set(chave, p);
    return p;
  }
  const fresco = req => req.query.fresco === '1';
  const pendente = () => Object.assign(new Error('Dashboard not registered yet: set HOB_ID_DASH (IBP.DASHBOARD.ID_DASH).'), { status: 503, codigo: 'ID_DASH_PENDENTE' });
  const buscarCiclos = async (f) => {
    if (!ID_DASH) throw pendente();
    const linhas = await comCache('/ciclos', async () => (await runQuery(CICLOS_SQL, { idDash: [sql.Int, ID_DASH] })).recordset, f);
    return linhas.map(l => ({ ciclo: cicloDe(l.DT_REF), carregadoEm: l.DT_CARGA || null }));
  };
  async function resolverCiclo(req) {
    const pedido = lerCiclo(req.query.ciclo);
    if (pedido === undefined) throw Object.assign(new Error('Invalid ciclo: use AAAA-MM.'), { status: 400, codigo: 'PARAMETRO' });
    const ciclos = await buscarCiclos(fresco(req));
    if (!ciclos.length) throw Object.assign(new Error('No cycle loaded in IBP.PHUB_PERFORMANCESTUDIO for this dashboard.'), { status: 404, codigo: 'SEM_CICLO' });
    const achado = pedido ? ciclos.find(c => c.ciclo === pedido) : ciclos[0];
    if (!achado) throw Object.assign(new Error(`Cycle ${pedido} is not loaded.`), { status: 404, codigo: 'CICLO' });
    return { ...achado, todos: ciclos };
  }
  async function lerConfig(f) {
    try {
      const linhas = await comCache('/config', async () => (await runQuery(CONFIG_SQL, { visao: [sql.VarChar(40), CONFIG_VISAO] })).recordset, f);
      const c = linhas.length ? normalizarConfigHob(linhas[0].DS_LAYOUT) : null;
      return { config: c || CONFIG_PADRAO, origem: c ? 'banco' : 'padrao' };
    } catch (err) {
      console.error(`${TAG} configuração indisponível (usando o padrão do código):`, err.message);
      return { config: CONFIG_PADRAO, origem: 'padrao' };
    }
  }
  // FCF YEAR de IBP.WATERFALL (não depende do ID_DASH). Falha não derruba /indicadores: vale a configuração
  async function lerWaterfall(config, f, ponte = 'fcfYear') {
    const { site, tipo, anoInicial } = config[FONTE_PONTE[ponte]];
    const linhas = await comCache(`/waterfall:${site}:${tipo}:${anoInicial}`, async () => (await runQuery(WATERFALL_SQL, { site: [sql.Int, site], tipo: [sql.Int, tipo], anoIni: [sql.Int, anoInicial] })).recordset, f);
    return { linhas, ...mapearWaterfall(linhas, config, ponte) };
  }
  // A carga inteira do ciclo (004 com @idKpi NULL), numa ida ao banco e em cache: EBITDA, Others e todas as séries
  // de coo.kpis saem daqui (antes era uma consulta por KPI, ~12 idas ao banco por carregamento da página)
  const lerCarga = (idDash, ciclo, f) => comCache(`/carga:${idDash}:${ciclo}`, async () => (await runQuery(EBITDA_SQL, { idDash: [sql.Int, idDash], idKpi: [sql.Int, null], dtRef: [sql.Date, new Date(`${ciclo}-01T00:00:00Z`)] })).recordset, f);
  // EBITDA da carga do COO: o ciclo pedido, se existir no dashboard de origem; senão, o mais recente
  async function lerEbitda(config, f, cicloPedido) {
    const idDash = config.ebitda.idDash;
    const ciclos = (await comCache(`/ciclos:${idDash}`, async () => (await runQuery(CICLOS_SQL, { idDash: [sql.Int, idDash] })).recordset, f)).map(l => cicloDe(l.DT_REF));
    if (!ciclos.length) throw Object.assign(new Error('Sem carga gravada para o ID_DASH'), { status: 404, codigo: 'SEM_CICLO' });
    const ciclo = cicloPedido && ciclos.includes(cicloPedido) ? cicloPedido : ciclos[0];
    const idKpi = config.ebitda.idKpi;
    const carga = await lerCarga(idDash, ciclo, f), lerKpi = (k) => carga.filter(l => Number(l.ID_KPI) === k);
    const linhas = lerKpi(idKpi), outros = config.ebitda.outros.kpis.map(lerKpi);
    return { idDash, idKpi, ...montarEbitda(linhas, [].concat(...outros), config, ciclo) };
  }
  // Séries da carga do COO configuradas em coo.kpis (uma consulta por ID_KPI, a mesma do EBITDA)
  async function lerCoo(config, f, cicloPedido) {
    const { idDash, sites, kpis } = config.coo;
    const ciclos = (await comCache(`/ciclos:${idDash}`, async () => (await runQuery(CICLOS_SQL, { idDash: [sql.Int, idDash] })).recordset, f)).map(l => cicloDe(l.DT_REF));
    if (!ciclos.length) throw Object.assign(new Error('Sem carga gravada para o ID_DASH'), { status: 404, codigo: 'SEM_CICLO' });
    const ciclo = cicloPedido && ciclos.includes(cicloPedido) ? cicloPedido : ciclos[0];
    const [anoC, mesC] = ciclo.split('-').map(Number);
    const ids = [...new Set(Object.values(kpis).filter(v => v))];
    const porKpi = {};
    const carga = await lerCarga(idDash, ciclo, f);
    for (const idKpi of ids) porKpi[idKpi] = carga.filter(l => Number(l.ID_KPI) === idKpi);
    const series = {}, pendentes = [], avisos = [];
    for (const [chave, idKpi] of Object.entries(kpis)) {
      if (!idKpi) { pendentes.push(chave); continue; }
      const site = sites[chave.split('.')[0]], s = montarSerieCoo(porKpi[idKpi], site);
      if (!Object.keys(s.anos).length) avisos.push(`${chave}: KPI ${idKpi} sem linhas do site ${site} no ciclo ${ciclo}`);
      series[chave] = { idKpi, site, ...s };
    }
    return { idDash, ciclo, ultimoReal: { ano: anoC, mes: mesC }, series, pendentes, avisos };
  }
  const pontePedida = (req) => (req.query.ponte === 'ebitdaYear' ? 'ebitdaYear' : 'fcfYear');
  function responderErro(res, rotaNome, err, falha) {
    if (err.status) return res.status(err.status).json({ error: err.message, codigo: err.codigo });
    console.error(`${TAG} erro em ${rotaNome}:`, err.message);
    res.status(500).json({ error: falha, codigo: 'ERRO_BANCO' });
  }

  // Limite de pedidos por usuário (X-Forwarded-Email do proxy; sem ele, o IP) por minuto
  const contagem = new Map();
  let janela = Date.now();
  router.use((req, res, next) => {
    if (Date.now() - janela > 60 * 1000) { contagem.clear(); janela = Date.now(); }
    const quem = String(req.get('X-Forwarded-Email') || req.ip || '').toLowerCase();
    const n = (contagem.get(quem) || 0) + 1;
    contagem.set(quem, n);
    if (n > LIMITE_POR_MINUTO) return res.status(429).json({ error: 'Too many requests. Try again in a minute.', codigo: 'LIMITE' });
    next();
  });

  router.get('/ping', (req, res) => res.json({ ok: true, idDash: ID_DASH }));

  router.get('/config', async (req, res) => res.json(await lerConfig(fresco(req))));

  router.get('/ciclos', async (req, res) => {
    try { res.json({ ciclos: await buscarCiclos(fresco(req)) }); }
    catch (err) { responderErro(res, '/ciclos', err, 'Failed to query the loaded cycles.'); }
  });

  router.get('/indicadores', async (req, res) => {
    try {
      const c = await resolverCiclo(req);
      const [linhas, cfg] = await Promise.all([
        comCache(`/leitura:${c.ciclo}`, async () => (await runQuery(LEITURA_SQL, { idDash: [sql.Int, ID_DASH], dtRef: [sql.Date, new Date(`${c.ciclo}-01T00:00:00Z`)] })).recordset, fresco(req)),
        lerConfig(fresco(req)),
      ]);
      const dados = montarDados(linhas, cfg.config, c.ciclo);
      dados.pontesRefs = {};
      for (const ponte of Object.keys(FONTE_PONTE)) {
        try {
          const w = await lerWaterfall(cfg.config, fresco(req), ponte);
          for (const [ano, x] of Object.entries(w.anos)) if (dados.bu.vbm[ano]) dados.bu.vbm[ano][ponte] = x.itens;
          dados.pontesRefs[ponte] = w.referencias;
          dados.avisos.push(...w.avisos);
        } catch (err) {
          console.error(`${TAG} IBP.WATERFALL (${ponte}) indisponível:`, err.message);
        }
      }
      dados.fcfRefs = dados.pontesRefs.fcfYear || [];
      dados.fcf = dados.fcfRefs.length ? 'waterfall' : 'config';
      if (dados.avisos.length) console.warn(`${TAG} ciclo ${c.ciclo}: ${dados.avisos.length} aviso(s):`, dados.avisos.slice(0, 5).join(' | '));
      const item = cache.get(`/leitura:${c.ciclo}`) || {};
      res.json({ ...dados, ciclos: c.todos.map(x => x.ciclo), config: cfg.origem,
        atualizado: c.carregadoEm ? new Date(c.carregadoEm).toISOString() : new Date(item.lidoEm || Date.now()).toISOString(),
        desatualizado: !!item.desatualizado });
    } catch (err) {
      responderErro(res, '/indicadores', err, 'Failed to query the dashboard indicators.');
    }
  });

  router.get('/waterfall', async (req, res) => {
    try {
      const cfg = await lerConfig(fresco(req));
      const ponte = pontePedida(req), fonte = cfg.config[FONTE_PONTE[ponte]];
      const w = await lerWaterfall(cfg.config, fresco(req), ponte);
      if (w.avisos.length) console.warn(`${TAG} IBP.WATERFALL (${ponte}): ${w.avisos.slice(0, 5).join(' | ')}`);
      if (req.query.bruto === '1') {
        if (!diagnostico) return res.status(404).json({ error: 'Not found.' });
        return res.json({ ponte, site: fonte.site, tipo: fonte.tipo, anoInicial: fonte.anoInicial, colunas: w.linhas.length ? Object.keys(w.linhas[0]) : [], mapeamento: w.colunas, linhas: w.linhas.slice(0, 200) });
      }
      res.json({ ponte, site: fonte.site, tipo: fonte.tipo, referencias: w.referencias, anos: w.anos, avisos: w.avisos,
        ...(w.referencias.length ? {} : { codigo: w.colunas ? 'COLUNAS' : 'SEM_LINHAS' }) });
    } catch (err) {
      console.error(`${TAG} erro em /waterfall:`, err.message);
      res.status(500).json({ error: 'Failed to query IBP.WATERFALL.', ...codigoDoErro(err) });
    }
  });

  // Estrutura de IBP.WATERFALL como a API a enxerga: colunas, tipos, mapeamento e referências — sem os valores.
  // Serve para conferir no Portal por que o FCF YEAR não veio do banco (rota protegida pelo acesso do Hub).
  router.get('/waterfall/estrutura', async (req, res) => {
    const cfg = await lerConfig(fresco(req));
    const ponte = pontePedida(req), fonte = cfg.config[FONTE_PONTE[ponte]];
    const base = { ponte, site: fonte.site, tipo: fonte.tipo, anoInicial: fonte.anoInicial };
    try {
      const w = await lerWaterfall(cfg.config, true, ponte);
      const l0 = w.linhas[0] || {};
      res.json({ ...base, ok: w.referencias.length > 0, linhas: w.linhas.length,
        colunas: Object.keys(l0).map(c => ({ nome: c, tipo: l0[c] === null ? 'null' : l0[c] instanceof Date ? 'data' : typeof l0[c] })),
        mapeamento: w.colunas, referencias: w.referencias.map(r => ({ ref: r.ref, itens: r.itens.length, situacao: r.situacao || null })), avisos: w.avisos.slice(0, 20) });
    } catch (err) {
      console.error(`${TAG} erro em /waterfall/estrutura:`, err.message);
      res.status(500).json({ ...base, ok: false, ...codigoDoErro(err) });
    }
  });

  // Demais gráficos da carga do COO (coo.kpis). ?ciclo= como em /ebitda
  router.get('/coo', async (req, res) => {
    let cfg = null;
    const configuradas = () => (cfg ? Object.keys(cfg.config.coo.kpis).filter(k => cfg.config.coo.kpis[k]) : []);
    try {
      cfg = await lerConfig(fresco(req));
      const c = await lerCoo(cfg.config, fresco(req), lerCiclo(req.query.ciclo) || null);
      if (c.avisos.length) console.warn(`${TAG} carga do COO (ID_DASH ${c.idDash}): ${c.avisos.join(' | ')}`);
      res.json(c);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, codigo: err.codigo, configuradas: configuradas() });
      console.error(`${TAG} erro em /coo:`, err.message);
      res.status(500).json({ error: 'Failed to query the COO load.', ...codigoDoErro(err), configuradas: configuradas() });
    }
  });

  // Situação de atualização dos gráficos da carga (Pending final updates, como o COO). ?ciclo= como em /ebitda.
  // À parte: a tela desenha os gráficos e acrescenta o aviso; se falhar, fica sem ele
  router.get('/atualizacao', async (req, res) => {
    const pedido = lerCiclo(req.query.ciclo);
    try {
      const { config } = await lerConfig(fresco(req));
      const idDash = config.ebitda.idDash;
      const ciclos = (await comCache(`/ciclos:${idDash}`, async () => (await runQuery(CICLOS_SQL, { idDash: [sql.Int, idDash] })).recordset, fresco(req))).map(l => cicloDe(l.DT_REF));
      if (!ciclos.length) throw Object.assign(new Error('Sem carga gravada para o ID_DASH'), { status: 404, codigo: 'SEM_CICLO' });
      const ciclo = pedido && ciclos.includes(pedido) ? pedido : ciclos[0];
      // DT_REF da carga = mês do ciclo (dtMes); atualizado com log a partir do mês seguinte (dtLimite), regra do 004 do COO
      const dtRef = new Date(`${ciclo}-01T00:00:00Z`), dtMes = dtRef, dtLimite = new Date(Date.UTC(dtRef.getUTCFullYear(), dtRef.getUTCMonth() + 1, 1));
      let origem = 'carga';
      let linhas = await comCache(`/status:${idDash}:${ciclo}`, async () => (await runQuery(STATUS_SQL, { idDash: [sql.Int, idDash], dtRef: [sql.Date, dtRef], dtMes: [sql.Date, dtMes] })).recordset, fresco(req));
      if (!linhas.length) {
        // 007 ainda não gravou SG_STATUS neste ciclo: a mesma regra, direto do log
        origem = 'log';
        linhas = await comCache(`/status-log:${idDash}:${ciclo}`, async () => (await runQuery(STATUS_LOG_SQL, { idDash: [sql.Int, idDash], dtRef: [sql.Date, dtRef], dtMes: [sql.Date, dtMes], dtLimite: [sql.Date, dtLimite] })).recordset, fresco(req));
      }
      const a = montarAtualizacao(linhas, config, ciclo);
      if (!Object.keys(a.cards).length) console.warn(`${TAG} /atualizacao: nenhum gráfico com situação no ciclo ${ciclo} (origem ${origem}, ${linhas.length} KPIs)`);
      res.json({ idDash, origem, ...a });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, codigo: err.codigo });
      console.error(`${TAG} erro em /atualizacao:`, err.message);
      res.status(500).json({ error: 'Failed to query the data update status.', ...codigoDoErro(err) });
    }
  });

  // EBITDA por segmento (carga do COO). ?ciclo= segue o ciclo da tela quando o COO tiver a mesma carga
  router.get('/ebitda', async (req, res) => {
    const pedido = lerCiclo(req.query.ciclo);
    try {
      const cfg = await lerConfig(fresco(req));
      const e = await lerEbitda(cfg.config, fresco(req), pedido || null);
      if (e.avisos.length) console.warn(`${TAG} EBITDA (ID_DASH ${e.idDash}): ${e.avisos.join(' | ')}`);
      res.json({ ...e, ...(Object.keys(e.anos).length ? {} : { codigo: 'SEM_LINHAS' }) });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, codigo: err.codigo });
      console.error(`${TAG} erro em /ebitda:`, err.message);
      res.status(500).json({ error: 'Failed to query the EBITDA.', ...codigoDoErro(err) });
    }
  });

  return router;
}

module.exports = { ID_DASH_PADRAO, montarAtualizacao, STATUS_SQL, STATUS_LOG_SQL, criarHobRouter, montarDados, montarEbitda, montarSerieCoo, EBITDA, FONTE_PONTE, mapearWaterfall, codigoDoErro, colunasWaterfall, normalizarConfigHob, carregarSql, lerCiclo, lerIdDash, LEITURA, WATERFALL, CICLOS_SQL, CONFIG_PADRAO, CONFIG_VISAO };
