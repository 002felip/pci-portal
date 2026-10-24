/**
 * COO Dashboard — rotas de dados como MÓDULO.
 *
 * Mesmo desenho do VBM Performance Hub (performancehub-api.js): a SQL existe
 * UMA vez e os dois pontos de entrada montam o mesmo router:
 *
 *   1. Standalone (desenvolvimento ou app próprio): `npm start` nesta pasta
 *      (server.js abre o próprio Express + pool).
 *   2. Dentro do Portal: o server.js do Portal faz
 *      `require("./COO - Dashboard/portal")(portal)` e o portal.js monta este
 *      router em /COO-Dashboard/api.
 *
 * A SQL vem dos scripts do time de dados em database/ (fonte única: para
 * atualizar, substitua o arquivo .sql). A única troca feita aqui é
 * `DASH.ID_DASH = 15` → `DASH.ID_DASH = @ID_DASH`, para o dashboard vir da
 * configuração (COO_ID_DASH, padrão 15) por PARÂMETRO.
 *
 * `runQuery` entra por injeção porque cada entrada tem o seu pool. Contrato:
 * `runQuery(sql, params?)` devolve algo com `.recordset` (formato do `mssql`);
 * `params` é `{ nome: [tipoMssql, valor] }` e cada entrada vira
 * `request.input` — nenhum valor vindo da requisição é concatenado na SQL.
 *
 * Rotas:
 *   GET /ping                         diagnóstico sem banco
 *   GET /unidades                     países e sites do dashboard (drill-down),
 *                                     só os sites em COO_SITES (padrão Sossego e Salobo)
 *   GET /indicadores?site=&ano=&mes=  Budget e Actual/Forecast por KPI: mês,
 *                                     trimestre do mês e ano
 *   GET /atualizacao?site=&ano=&mes=  status de atualização por KPI (regras de
 *                                     exibição a definir)
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const sql = require('mssql');

const CACHE_TTL_MS = 5 * 60 * 1000;
const ID_DASH_PADRAO = 15; // = scripts originais do time de dados
// Escopo do dashboard: só estas unidades aparecem e têm dados liberados (COO_SITES).
// FASE DE TESTE DE DADOS: Sossego e Salobo. Para liberar todos os sites: COO_SITES=*
const SITES_PADRAO = 'Sossego,Salobo';

// Lê o script e parametriza o dashboard. Falha AO SUBIR se o script mudar de
// forma que a troca não aconteça (melhor que consultar o dashboard errado).
function carregarScript(arquivo) {
  const texto = fs.readFileSync(path.join(__dirname, 'database', arquivo), 'utf8').replace(/^﻿/, '');
  const filtro = /DASH\.ID_DASH\s*=\s*\d+/g;
  if (!filtro.test(texto)) throw new Error(`database/${arquivo}: filtro "DASH.ID_DASH = <n>" não encontrado`);
  return texto.replace(filtro, 'DASH.ID_DASH = @ID_DASH');
}
const CHART_DATA_SQL = carregarScript('coo_dashboard.sql');
const ATUALIZACAO_SQL = carregarScript('coo_dashboard_atualizacao.sql');

// ORDEM_GRAFICO do script principal → janela e série do card
//   0 = mês Budget · 2 = mês Act/Fcst (1 = Plan, não usado)
//   3 = trimestre Budget · 4 = trimestre Act/Fcst · 6 = ano Budget · 7 = ano Act/Fcst
const SERIE_POR_ORDEM = { 0: ['MONTH', 'B'], 2: ['MONTH', 'AF'], 3: ['QUARTER', 'B'], 4: ['QUARTER', 'AF'], 6: ['YEAR', 'B'], 7: ['YEAR', 'AF'] };

// Sites configurados para o dashboard, com o país quando IBP.SITES tiver essa
// coluna (descoberta em INFORMATION_SCHEMA, sem supor o nome). Mesma limpeza
// de nomes usada no Performance Hub.
const SITES_SQL = (colunaPais) => `
SELECT DISTINCT
  S.ID_SITE,
  CASE LTRIM(RTRIM(S.NM_SITE))
    WHEN 'VNL Operations'      THEN 'VNL'
    WHEN 'Ontario Operations'  THEN 'Ontario'
    WHEN 'Matsusaka | Tonimet' THEN 'Matsusaka'
    WHEN 'Clydach | CNR'       THEN 'Clydach'
    ELSE LTRIM(RTRIM(S.NM_SITE))
  END AS NM_SITE,
  ${colunaPais ? `LTRIM(RTRIM(S.[${colunaPais}]))` : 'CAST(NULL AS NVARCHAR(100))'} AS NM_PAIS
FROM IBP.SITES S
INNER JOIN IBP.DASHBOARD D
  ON D.ID_SITE = S.ID_SITE
WHERE D.ID_DASH = @ID_DASH
  AND S.NM_SITE IS NOT NULL
  AND LTRIM(RTRIM(S.NM_SITE)) <> ''
ORDER BY NM_PAIS, NM_SITE`;

const PAIS_CANDIDATAS = ['NM_PAIS', 'DS_PAIS', 'PAIS', 'NM_COUNTRY', 'DS_COUNTRY', 'COUNTRY', 'SG_PAIS'];

// Valida um inteiro de query string dentro de um intervalo; null se inválido.
function inteiro(valor, min, max) {
  if (!/^\d{1,9}$/.test(String(valor || ''))) return null;
  const n = Number(valor);
  return n >= min && n <= max ? n : null;
}

// DT_REF do mssql vem como Date em UTC; nos testes, como texto ISO
function anoMes(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1];
}

// Última letra do rótulo do script ('Sep A', 'Q3F', '26F') → 'A' ou 'F'
function letraAF(tipo) {
  const l = String(tipo || '').trim().slice(-1).toUpperCase();
  return l === 'A' || l === 'F' ? l : null;
}

// Nome de site comparável: sem acento, espaços ou maiúsculas
function chaveSite(nome) {
  return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Monta o router. `idDash` = IBP.DASHBOARD.ID_DASH (variável COO_ID_DASH;
 * padrão 15, o dos scripts originais). `sites` = nomes das unidades liberadas,
 * separados por vírgula (variável COO_SITES; padrão "Sossego,Salobo").
 */
function criarCooRouter({ runQuery, idDash, sites }) {
  if (typeof runQuery !== 'function') throw new Error('criarCooRouter: `runQuery` é obrigatório');
  const ID_DASH = inteiro(idDash, 1, 1e9) || ID_DASH_PADRAO;
  const TODOS = String(sites || '').trim() === '*';
  const SITES = new Set(String(sites || SITES_PADRAO).split(',').map(chaveSite).filter(Boolean));
  const liberado = (nome) => TODOS || SITES.has(chaveSite(nome));

  const router = express.Router();
  const cache = new Map();

  async function comCache(chave, buscar) {
    const item = cache.get(chave);
    if (item && item.expiraEm > Date.now()) return item.dados;
    const dados = await buscar();
    cache.set(chave, { dados, expiraEm: Date.now() + CACHE_TTL_MS });
    return dados;
  }

  function falha(res, oQue, err) {
    console.error(`[coo-dashboard] ${oQue}:`, err.message);
    res.status(500).json({ error: oQue, detalhe: err.message });
  }

  // site/ano/mes validados; responde 400 e devolve null se inválidos
  function periodo(req, res) {
    const site = inteiro(req.query.site, 1, 1e9);
    const ano = inteiro(req.query.ano, 2000, 2100);
    const mes = inteiro(req.query.mes, 1, 12);
    if (site && ano && mes) return { site, ano, mes };
    res.status(400).json({ error: 'Parâmetros inválidos', detalhe: 'Use site (id numérico), ano (2000–2100) e mes (1–12).' });
    return null;
  }

  // Coluna de país em IBP.SITES (descoberta uma vez; null se não houver)
  let colunaPais;
  async function descobrirColunaPais() {
    if (colunaPais !== undefined) return colunaPais;
    const r = await runQuery(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'IBP' AND TABLE_NAME = 'SITES'");
    const nomes = r.recordset.map(l => String(l.COLUMN_NAME).toUpperCase());
    colunaPais = PAIS_CANDIDATAS.find(c => nomes.includes(c)) || null;
    console.log(`[coo-dashboard] país dos sites: ${colunaPais ? 'IBP.SITES.' + colunaPais : 'coluna não encontrada (um grupo único "Sites")'}`);
    return colunaPais;
  }

  const P = () => ({ ID_DASH: [sql.Int, ID_DASH] });
  const dadosGraficos = () => comCache('chart-data', async () => (await runQuery(CHART_DATA_SQL, P())).recordset);
  const dadosAtualizacao = () => comCache('atualizacao', async () => (await runQuery(ATUALIZACAO_SQL, P())).recordset);

  // Diagnóstico sem banco: separa "código não publicado" (404) de "banco falha" (500 nas outras rotas)
  router.get('/ping', (req, res) => res.json({ ok: true, caminhoRecebido: req.originalUrl, idDash: ID_DASH }));

  router.get('/unidades', async (req, res) => {
    try {
      const dados = await comCache('unidades', async () => {
        const col = await descobrirColunaPais();
        const linhas = (await runQuery(SITES_SQL(col), P())).recordset;
        const porPais = new Map();
        linhas.filter(l => liberado(l.NM_SITE)).forEach(l => {
          const pais = l.NM_PAIS || 'Sites';
          if (!porPais.has(pais)) porPais.set(pais, []);
          porPais.get(pais).push({ id: l.ID_SITE, nome: l.NM_SITE });
        });
        return [...porPais].map(([pais, sites]) => ({ pais, sites }));
      });
      res.json(dados);
    } catch (err) { falha(res, 'Failed to fetch sites', err); }
  });

  // Só os IDs das unidades liberadas (derivados de /unidades, mesmo cache)
  async function siteLiberado(id) {
    const unidades = await comCache('unidades-ids', async () => {
      const col = await descobrirColunaPais();
      return (await runQuery(SITES_SQL(col), P())).recordset
        .filter(l => liberado(l.NM_SITE)).map(l => Number(l.ID_SITE));
    });
    return unidades.includes(id);
  }
  function foraDoEscopo(res) {
    res.status(404).json({ error: 'Site não disponível neste dashboard' });
  }

  // O script devolve, para cada mês de referência (DT_REF), as linhas do mês,
  // do trimestre daquele mês e do ano. Filtrar pelo mês escolhido já traz as
  // três janelas do card.
  router.get('/indicadores', async (req, res) => {
    const p = periodo(req, res);
    if (!p) return;
    try {
      if (!(await siteLiberado(p.site))) return foraDoEscopo(res);
      const porKpi = new Map();
      (await dadosGraficos()).forEach(l => {
        const serie = SERIE_POR_ORDEM[l.ORDEM_GRAFICO];
        if (!serie || Number(l.ID_SITE) !== p.site) return;
        const [a, m] = anoMes(l.DT_REF);
        if (a !== p.ano || m !== p.mes) return;
        const [visao, s] = serie;
        const chave = `${l.ID_KPI}|${visao}`;
        if (!porKpi.has(chave)) porKpi.set(chave, { ID_KPI: l.ID_KPI, NM_KPI: String(l.NM_KPI || '').trim(), ID_ORDEM: l.ID_ORDEM, CD_VISAO: visao, VL_B: null, VL_AF: null, LETRA_AF: null });
        const item = porKpi.get(chave);
        const valor = l.Value == null ? 0 : Number(l.Value);
        if (s === 'B') item.VL_B = (item.VL_B || 0) + valor;
        else { item.VL_AF = (item.VL_AF || 0) + valor; item.LETRA_AF = letraAF(l.Type) || item.LETRA_AF; }
      });
      const linhas = [...porKpi.values()].sort((x, y) => (x.ID_ORDEM - y.ID_ORDEM) || x.CD_VISAO.localeCompare(y.CD_VISAO));
      res.json({ ...p, geradoEm: new Date().toISOString(), linhas });
    } catch (err) { falha(res, 'Failed to fetch indicators', err); }
  });

  router.get('/atualizacao', async (req, res) => {
    const p = periodo(req, res);
    if (!p) return;
    try {
      if (!(await siteLiberado(p.site))) return foraDoEscopo(res);
      const linhas = (await dadosAtualizacao())
        .filter(l => Number(l.ID_SITE) === p.site && anoMes(l.DT_REF).join('-') === `${p.ano}-${p.mes}`)
        .map(l => ({ ID_KPI: l.ID_KPI, NM_KPI: String(l.NM_KPIS_DASH || '').trim(), ID_ORDEM: l.ID_ORDEM, VALIDATE: l.VALIDATE, DS_VALIDATE: l.DS_VALIDATE, DT_ATUALIZACAO: l.DT_ATUALIZACAO }));
      res.json({ ...p, linhas });
    } catch (err) { falha(res, 'Failed to fetch update status', err); }
  });

  return router;
}

module.exports = { criarCooRouter, CHART_DATA_SQL, ATUALIZACAO_SQL, SITES_SQL };
