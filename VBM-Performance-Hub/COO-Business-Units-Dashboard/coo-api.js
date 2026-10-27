/**
 * COO Business Units Dashboard — rotas de dados como MÓDULO.
 *
 * Mesmo contrato do performancehub-api.js do VBM-Performance-Studio: os dois
 * pontos de entrada (portal.js, dentro do Portal; server.js, standalone)
 * montam ESTE router, e cada um injeta o seu `runQuery`.
 * Contrato: `runQuery(sql, params?)` devolve algo com `.recordset` (formato
 * do pacote `mssql`); `params` é `{ nome: [tipoMssql, valor] }` e cada
 * entrada vira `request.input` — nada da requisição é concatenado na SQL.
 *
 * A SQL não é reescrita aqui: vem dos scripts do time de dados em database/,
 * lidos como foram entregues. A única troca é o filtro fixo do dashboard
 * (`DASH.ID_DASH = 15`) por parâmetro (`@idDash`), conferida na carga:
 * se o script mudar e a troca não acontecer, o módulo falha ao subir em vez
 * de consultar o dashboard errado.
 *
 * Nova consulta = novo script em database/ + uma entrada em CONSULTAS.
 *
 * Rotas:
 *   GET /ping                         diagnóstico sem banco
 *   GET /chart-data                   saída do script, linha a linha (todas as BUs)
 *   GET /sites                        ID_SITE e nome dos sites do dashboard
 *   GET /indicadores?site=&ano=&mes=  Budget e Actual/Forecast por KPI do site,
 *                                     no mês, no trimestre do mês e no ano
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const sql = require('mssql');

const TAG = '[coo-dashboard]';
const CACHE_TTL_MS = 5 * 60 * 1000;
const ID_DASH_PADRAO = 15; // IBP.DASHBOARD.ID_DASH do COO Dashboard

// Scripts de database/ servidos pela API. `trocas`: texto fixo do script →
// parâmetro, com o número exato de ocorrências esperado.
const CONSULTAS = [
  {
    rota: '/chart-data',
    arquivo: 'coo_dashboard.sql', // MONTH, QUARTER e YEAR (UNION ALL) — "SQL - COO DASHBOARD.txt"
    trocas: [{ de: 'DASH.ID_DASH = 15', para: 'DASH.ID_DASH = @idDash', ocorrencias: 3 }],
    falha: 'Falha ao consultar os dados do dashboard.',
  },
];

// ORDEM_GRAFICO do script → janela e série do card
//   0 = mês Budget · 2 = mês Act/Fcst (1 = Plan, não exibido no dashboard)
//   3 = trimestre Budget · 4 = trimestre Act/Fcst · 6 = ano Budget · 7 = ano Act/Fcst
const SERIE_POR_ORDEM = { 0: ['MONTH', 'B'], 2: ['MONTH', 'AF'], 3: ['QUARTER', 'B'], 4: ['QUARTER', 'AF'], 6: ['YEAR', 'B'], 7: ['YEAR', 'AF'] };

// Inteiro de query string dentro de um intervalo; null se inválido
function inteiro(valor, min, max) {
  if (!/^\d{1,10}$/.test(String(valor || ''))) return null;
  const n = Number(valor);
  return n >= min && n <= max ? n : null;
}

// DT_REF do mssql vem como Date (UTC)
function anoMes(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1];
}

// Última letra do rótulo do script ('Aug A', 'Q3F', '26F') → 'A' ou 'F'
function letraAF(tipo) {
  const l = String(tipo || '').trim().slice(-1).toUpperCase();
  return l === 'A' || l === 'F' ? l : null;
}

// Linhas do script de um site/mês → um item por KPI e janela, com B, A/F e a letra do script
function agregarIndicadores(linhas, { site, ano, mes }) {
  const porKpi = new Map();
  for (const l of linhas) {
    const serie = SERIE_POR_ORDEM[l.ORDEM_GRAFICO];
    if (!serie || Number(l.ID_SITE) !== site) continue;
    const [a, m] = anoMes(l.DT_REF);
    if (a !== ano || m !== mes) continue;
    const [visao, s] = serie;
    const chave = `${l.ID_KPI}|${visao}`;
    if (!porKpi.has(chave)) {
      porKpi.set(chave, { ID_KPI: l.ID_KPI, NM_KPI: String(l.NM_KPI || '').trim(), ID_ORDEM: l.ID_ORDEM, CD_VISAO: visao, VL_B: null, VL_AF: null, LETRA_AF: null });
    }
    const item = porKpi.get(chave);
    const valor = l.Value == null ? 0 : Number(l.Value);
    if (s === 'B') item.VL_B = (item.VL_B || 0) + valor;
    else { item.VL_AF = (item.VL_AF || 0) + valor; item.LETRA_AF = letraAF(l.Type) || item.LETRA_AF; }
  }
  return [...porKpi.values()].sort((x, y) => (x.ID_ORDEM - y.ID_ORDEM) || x.CD_VISAO.localeCompare(y.CD_VISAO));
}

// Nomes dos sites do dashboard (mesma regra do /sites do VBM-Performance-Studio)
const SITES_SQL = `
SELECT DISTINCT
  S.ID_SITE,
  CASE LTRIM(RTRIM(S.NM_SITE))
    WHEN 'VNL Operations'      THEN 'VNL'
    WHEN 'Ontario Operations'  THEN 'Ontario'
    WHEN 'Matsusaka | Tonimet' THEN 'Matsusaka'
    WHEN 'Clydach | CNR'       THEN 'Clydach'
    ELSE LTRIM(RTRIM(S.NM_SITE))
  END AS NM_SITE
FROM IBP.SITES S
RIGHT JOIN IBP.DASHBOARD D
  ON D.ID_SITE = S.ID_SITE
WHERE D.ID_DASH = @idDash
  AND S.NM_SITE IS NOT NULL
  AND LTRIM(RTRIM(S.NM_SITE)) <> ''
ORDER BY NM_SITE`;

// Lê o script e aplica as trocas; falha se alguma não bater com o esperado
function carregarSql(arquivo, trocas) {
  let texto = fs.readFileSync(path.join(__dirname, 'database', arquivo), 'utf8');
  for (const { de, para, ocorrencias } of trocas) {
    const achadas = texto.split(de).length - 1;
    if (achadas !== ocorrencias) {
      throw new Error(`${arquivo}: esperava ${ocorrencias}× "${de}" e encontrou ${achadas} — revise o script antes de publicar`);
    }
    texto = texto.split(de).join(para);
  }
  return texto;
}

// ID_DASH configurável (COO_ID_DASH) para o mesmo código servir outra visão
function lerIdDash(valor) {
  if (valor === undefined || valor === '') return ID_DASH_PADRAO;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new Error(`COO_ID_DASH inválido: ${valor}`);
  return n;
}

function criarCooRouter({ runQuery, idDash }) {
  if (typeof runQuery !== 'function') {
    throw new Error('criarCooRouter: `runQuery` é obrigatório');
  }
  const ID_DASH = lerIdDash(idDash);
  const router = express.Router();
  const cache = new Map();

  async function comCache(chave, buscar) {
    const item = cache.get(chave);
    if (item && item.expiraEm > Date.now()) return item.dados;
    const dados = await buscar();
    cache.set(chave, { dados, expiraEm: Date.now() + CACHE_TTL_MS });
    return dados;
  }

  // Erro do banco fica no log do servidor; a tela recebe só uma mensagem genérica
  const buscar = (caminho, consulta) => comCache(caminho, async () => (await runQuery(consulta, { idDash: [sql.Int, ID_DASH] })).recordset);
  function rota(caminho, consulta, falha) {
    router.get(caminho, async (req, res) => {
      try {
        res.json(await buscar(caminho, consulta));
      } catch (err) {
        console.error(`${TAG} erro em ${caminho}:`, err.message);
        res.status(500).json({ error: falha, codigo: 'ERRO_BANCO' });
      }
    });
  }

  // Diagnóstico que NÃO toca no banco: separa "código não publicado"
  // (404 aqui) de "publicado, mas o banco falha" (200 aqui + 500 abaixo).
  router.get('/ping', (req, res) => res.json({ ok: true, idDash: ID_DASH }));

  const SQL = {};
  for (const c of CONSULTAS) rota(c.rota, SQL[c.rota] = carregarSql(c.arquivo, c.trocas), c.falha);
  rota('/sites', SITES_SQL, 'Falha ao consultar os sites do dashboard.');

  // Indicadores de um site no mês escolhido: o script devolve, para cada mês
  // (DT_REF), as linhas do mês, do trimestre daquele mês e do ano — o filtro
  // pelo mês já traz as três janelas do card. Usa o mesmo cache do /chart-data.
  router.get('/indicadores', async (req, res) => {
    const p = { site: inteiro(req.query.site, 1, 2147483647), ano: inteiro(req.query.ano, 2000, 2100), mes: inteiro(req.query.mes, 1, 12) };
    if (!p.site || !p.ano || !p.mes) {
      return res.status(400).json({ error: 'Parâmetros inválidos: use site (id numérico), ano (2000–2100) e mes (1–12).', codigo: 'PARAMETRO' });
    }
    try {
      const linhas = agregarIndicadores(await buscar('/chart-data', SQL['/chart-data']), p);
      res.json({ ...p, geradoEm: new Date().toISOString(), linhas });
    } catch (err) {
      console.error(`${TAG} erro em /indicadores:`, err.message);
      res.status(500).json({ error: 'Falha ao consultar os indicadores do dashboard.', codigo: 'ERRO_BANCO' });
    }
  });

  return router;
}

module.exports = { criarCooRouter, carregarSql, agregarIndicadores, CONSULTAS };
