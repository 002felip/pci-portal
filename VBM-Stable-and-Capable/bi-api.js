/**
 * VBM Stable & Capable — aba "Power BI", refeita dentro do app.
 *
 * Reproduz a página "Stable and capable" do Stable_and_Capable_3.pbix. Os
 * DADOS vêm daqui; os CÁLCULOS e gráficos ficam no navegador
 * (assets/js/painel-spc.js), na mesma lógica dos visuais Python do .pbix.
 *
 *   database/query_powerbi_stable_and_capable.sql   a consulta da tabela 'base'
 *                                                    do .pbix, copiada como está
 *   Banco: SEMPRE o PRD (BDIBPBMSA_PRD), como no Power BI — conexão própria,
 *   independente do banco do resto do Stable & Capable.
 *
 * O resultado (~80 mil linhas) fica em memória e é recarregado depois de
 * STABLECAPABLE_BI_CACHE_MIN minutos (padrão 60), como um refresh do dataset.
 * Enquanto recarrega, a versão anterior continua sendo servida.
 *
 * Filtro da página no .pbix: DT_REF > 31/12/2023 (aplicado aqui também).
 *
 * Rotas:
 *   GET  /filtros            combinações BU/site/operação/KPI disponíveis + período
 *   GET  /serie?id=          pontos de uma combinação: [data, actual, budget]
 *   POST /atualizar          força recarregar do banco
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const TAG = '[stable-and-capable:bi]';
const CONSULTA = fs.readFileSync(path.join(__dirname, 'database', 'query_powerbi_stable_and_capable.sql'), 'utf8');
const DATA_MINIMA = '2024-01-01'; // filtro de página do .pbix: DT_REF > 2023-12-31

const isoData = (d) => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
};
const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

function criarBiRouter({ runQueryPrd, banco }) {
  const router = express.Router();
  const TTL_MS = Math.max(5, parseInt(process.env.STABLECAPABLE_BI_CACHE_MIN || '60', 10)) * 60 * 1000;
  let cache = null;      // { carregadoEm, combinacoes: Map(id -> {meta, pontos}) , lista, periodo }
  let carregando = null; // promessa em andamento
  let ultimoErro = null;

  async function carregar() {
    const t0 = Date.now();
    const r = await runQueryPrd(CONSULTA);
    const linhas = r.recordset || [];
    const combinacoes = new Map();
    let min = null, max = null;
    for (const l of linhas) {
      const data = isoData(l.DT_REF);
      if (!data || data < DATA_MINIMA) continue;
      const bu = String(l['BUSINESS UNIT'] || '').trim();
      if (!bu || bu === 'outros') continue;
      const site = String(l['NAME SITE'] || '').trim();
      const op = String(l['TYPE OPERATION'] || '').trim();
      const kpi = String(l['NAME KPI'] || '').trim();
      const id = [bu, site, op, kpi].join('|');
      let c = combinacoes.get(id);
      if (!c) {
        c = { id, bu, pais: String(l.NM_PAIS || '').trim(), site, op, kpi, unit: String(l.UNIT || '').trim(), pontos: [] };
        combinacoes.set(id, c);
      }
      c.pontos.push([data, num(l.ACTUAL), num(l.BUDGET)]);
      if (!min || data < min) min = data;
      if (!max || data > max) max = data;
    }
    // Mesmo tratamento dos visuais Python: ordena por data e mantém o 1º de cada dia
    for (const c of combinacoes.values()) {
      c.pontos.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const vistos = new Set();
      c.pontos = c.pontos.filter((p) => (vistos.has(p[0]) ? false : (vistos.add(p[0]), true)));
    }
    const lista = [...combinacoes.values()]
      .map(({ pontos, ...meta }) => ({ ...meta, n: pontos.length }))
      .sort((a, b) => (a.bu + a.site + a.kpi + a.op).localeCompare(b.bu + b.site + b.kpi + b.op, 'pt-BR'));
    cache = { carregadoEm: new Date().toISOString(), combinacoes, lista, periodo: { min, max }, linhas: linhas.length };
    ultimoErro = null;
    console.log(`${TAG} dataset carregado de ${banco}: ${linhas.length} linhas, ${lista.length} combinações em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return cache;
  }

  /** Cache válido, ou recarrega. Com cache vencido, serve o antigo e recarrega em segundo plano. */
  function obter({ forcar = false } = {}) {
    const vencido = !cache || forcar || Date.now() - Date.parse(cache.carregadoEm) > TTL_MS;
    if (vencido && !carregando) {
      carregando = carregar()
        .catch((err) => { ultimoErro = err.message; console.error(TAG, 'falha ao carregar:', err.message); throw err; })
        .finally(() => { carregando = null; });
      carregando.catch(() => {});
    }
    if (cache && !forcar) return Promise.resolve(cache);
    return carregando || Promise.resolve(cache);
  }

  const falha = (res, err) => res.status(503).json({ error: 'Não foi possível carregar os dados do banco PRD.', detalhe: ultimoErro || (err && err.message) });

  router.get('/filtros', async (req, res) => {
    try {
      const c = await obter();
      res.json({ atualizadoEm: c.carregadoEm, banco, periodo: c.periodo, linhas: c.linhas, combinacoes: c.lista, recarregando: !!carregando });
    } catch (err) { falha(res, err); }
  });

  router.get('/serie', async (req, res) => {
    try {
      const c = await obter();
      const s = c.combinacoes.get(String(req.query.id || ''));
      if (!s) return res.status(404).json({ error: 'Combinação não encontrada.' });
      res.json(s);
    } catch (err) { falha(res, err); }
  });

  router.post('/atualizar', async (req, res) => {
    // Evita martelar o PRD: no máximo 1 recarga forçada a cada 2 minutos
    if (cache && Date.now() - Date.parse(cache.carregadoEm) < 2 * 60 * 1000) {
      return res.json({ atualizadoEm: cache.carregadoEm, recarregado: false });
    }
    try {
      const c = await obter({ forcar: true });
      res.json({ atualizadoEm: c.carregadoEm, recarregado: true });
    } catch (err) { falha(res, err); }
  });

  // Carrega já na subida, para a primeira pessoa não esperar
  setTimeout(() => obter().catch(() => {}), 5000).unref();
  return router;
}

module.exports = { criarBiRouter };
