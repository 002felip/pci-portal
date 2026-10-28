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
 *   GET /filtros                      o que a tela pode filtrar, tirado do resultado
 *                                     do script: sites com dados, anos e meses, e o
 *                                     último mês realizado (Actual)
 *   GET /indicadores?site=&ano=&mes=  Budget e Actual/Forecast por KPI do site,
 *                                     no mês, no trimestre do mês e no ano
 *   GET /atualizacao?site=&ano=&mes=  situação da atualização do ciclo por KPI do site
 *                                     no mês (consulta à parte: não atrasa os gráficos)
 *   GET /atualizacoes                 saída do script de atualização, linha a linha
 *
 * /chart-data, /atualizacoes e /sites devolvem o resultado inteiro (todas as BUs) e a
 * página não as usa: só respondem com COO_DIAGNOSTICO=1 (diagnóstico pontual).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const sql = require('mssql');

const TAG = '[coo-dashboard]';
// Segundos de env (inteiro positivo) ou o padrão
function segundos(valor, padrao) { const n = Number(valor); return Number.isInteger(n) && n > 0 ? n * 1000 : padrao * 1000; }
// Resultado das consultas em memória (COO_CACHE_TTL_S, padrão 5 min)
const CACHE_TTL_MS = segundos(process.env.COO_CACHE_TTL_S, 300);
// Refresh da página (?fresco=1 no 1º pedido da carga): lê o banco de novo se o resultado guardado
// tiver mais que isto (COO_FRESCO_S, padrão 15 s) — alteração no banco aparece no refresh, sem martelar o banco a cada F5
const FRESCO_MS = segundos(process.env.COO_FRESCO_S, 15);
// Banco fora: a página continua com o último resultado lido até este limite (marcado como desatualizado)
const DESATUALIZADO_MAX_MS = segundos(process.env.COO_DESATUALIZADO_MAX_S, 2 * 3600);
// Limite de pedidos por usuário por minuto nas rotas da API (proteção contra abuso; a navegação normal fica muito abaixo)
const LIMITE_POR_MINUTO = 240;
const ID_DASH_PADRAO = 15; // IBP.DASHBOARD.ID_DASH do COO Dashboard

// Scripts de database/ servidos pela API. `trocas`: texto fixo do script →
// parâmetro, com o número exato de ocorrências esperado.
const CONSULTAS = [
  {
    rota: '/chart-data',
    arquivo: 'coo_dashboard.sql', // MONTH, QUARTER e YEAR (UNION ALL) — "SQL - COO DASHBOARD.txt"
    trocas: [{ de: 'DASH.ID_DASH = 15', para: 'DASH.ID_DASH = @idDash', ocorrencias: 3 }],
    falha: 'Failed to query the dashboard data.',
  },
  {
    rota: '/atualizacoes',
    arquivo: 'coo_dashboard_atualizacao.sql', // situação de cada KPI no ciclo — "SQL - COO DASHBOARD ATUALIZACAO"
    trocas: [{ de: 'DASH.ID_DASH = 15', para: 'DASH.ID_DASH = @idDash', ocorrencias: 1 }],
    falha: 'Failed to query the data update status.',
  },
];

// Situação do KPI no ciclo (script de atualização): VALIDATE 1 = atualizado, 0 = aguardando a
// atualização final. 2 fica reservado para "atrasado", regra que o time de dados ainda vai criar.
function situacaoAtualizacao(l) {
  const v = Number(l.VALIDATE);
  const texto = String(l.DS_VALIDATE || '').trim();
  return {
    status: v === 1 ? 'ok' : v === 2 ? 'atrasado' : 'pendente',
    texto: texto && texto !== '.' ? texto : null,
    dt: l.DT_ATUALIZACAO || null,
  };
}

// Linhas de um resultado agrupadas por site|ano|mês, montado uma vez por leitura do banco
// (o resultado em cache é o mesmo array até a próxima leitura)
const indices = new WeakMap();
function linhasDe(linhas, { site, ano, mes }) {
  let idx = indices.get(linhas);
  if (!idx) {
    idx = new Map();
    for (const l of linhas) {
      const [a, m] = anoMes(l.DT_REF);
      const k = `${Number(l.ID_SITE)}|${a}|${m}`;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(l);
    }
    indices.set(linhas, idx);
  }
  return idx.get(`${site}|${ano}|${mes}`) || [];
}

// Linhas do script de atualização de um site/mês → situação por KPI (ID_OPERACAO|ID_KPI)
function atualizacoesDoMes(linhas, p) {
  const porKpi = new Map();
  for (const l of linhasDe(linhas, p)) porKpi.set(`${l.ID_OPERACAO}|${l.ID_KPI}`, situacaoAtualizacao(l));
  return porKpi;
}

// ORDEM_GRAFICO do script → janela e série do card
//   0 = mês Budget · 1 = mês Plan (Supply; botão Plan da tela) · 2 = mês Act/Fcst
//   3 = trimestre Budget · 4 = trimestre Act/Fcst · 6 = ano Budget · 7 = ano Act/Fcst
const SERIE_POR_ORDEM = { 0: ['MONTH', 'B'], 1: ['MONTH', 'P'], 2: ['MONTH', 'AF'], 3: ['QUARTER', 'B'], 4: ['QUARTER', 'AF'], 6: ['YEAR', 'B'], 7: ['YEAR', 'AF'] };

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
function agregarIndicadores(linhas, p) {
  const porKpi = new Map(), vistas = new Set();
  let repetidas = 0;
  for (const l of linhasDe(linhas, p)) {
    const serie = SERIE_POR_ORDEM[l.ORDEM_GRAFICO];
    if (!serie) continue;
    const [visao, s] = serie;
    // Mesma série do mesmo KPI duas vezes no mês = cadastro duplicado (os valores seriam somados)
    const unica = `${l.ID_OPERACAO}|${l.ID_KPI}|${l.ORDEM_GRAFICO}`;
    if (vistas.has(unica)) repetidas++; else vistas.add(unica);
    // Um item por KPI cadastrado (operação + KPI) e janela
    const chave = `${l.ID_OPERACAO}|${l.ID_KPI}|${visao}`;
    if (!porKpi.has(chave)) {
      porKpi.set(chave, { ID_OPERACAO: l.ID_OPERACAO, ID_KPI: l.ID_KPI, NM_KPI: String(l.NM_KPI || '').trim(), ID_ORDEM: l.ID_ORDEM, CD_VISAO: visao, VL_B: null, VL_AF: null, VL_P: null, LETRA_AF: null, CASA_DECIMAL: null, SG_UNID: null });
    }
    const item = porKpi.get(chave);
    const valor = l.VL_KPI == null ? 0 : Number(l.VL_KPI);
    // Unidade de medida do KPI (IBP.DASHBOARD.SG_UNID, coluna da própria consulta)
    const unid = String(l.SG_UNID == null ? '' : l.SG_UNID).trim();
    if (unid && !item.SG_UNID) item.SG_UNID = unid;
    // Casas decimais do KPI (IBP.DASHBOARD.VL_CASADECIMAL): inteiro de 0 a 6; fora disso a página usa o padrão do card
    const casas = Number(l.VL_CASADECIMAL);
    if (l.VL_CASADECIMAL != null && Number.isInteger(casas) && casas >= 0 && casas <= 6) item.CASA_DECIMAL = casas;
    if (s === 'B') item.VL_B = (item.VL_B || 0) + valor;
    else if (s === 'P') item.VL_P = (item.VL_P || 0) + valor;
    else { item.VL_AF = (item.VL_AF || 0) + valor; item.LETRA_AF = letraAF(l.NM_VISAO) || item.LETRA_AF; }
  }
  if (repetidas) console.warn(`${TAG} site ${p.site} ${p.mes}/${p.ano}: ${repetidas} linha(s) repetida(s) para a mesma série do mesmo KPI — valores somados; verifique duplicidade em IBP.DASHBOARD (ID_DASH do COO)`);
  return [...porKpi.values()].sort((x, y) => (x.ID_ORDEM - y.ID_ORDEM) || x.CD_VISAO.localeCompare(y.CD_VISAO));
}

// Nome de site do dashboard sem nome em IBP.SITES (minas da VNL cadastradas no ID_DASH 15).
// 36 e 37 conforme o mapeamento do VBM-Stable-and-Capable; 42 = Discovery Hill (confirmado pelo time)
const NOMES_PADRAO = { 36: 'Reid Brook', 37: 'Eastern Deeps', 42: 'Discovery Hill' };

// Filtros da tela a partir do resultado do script: sites que têm linhas, anos e
// meses de referência (DT_REF) e o último mês realizado (mês com Actual 'A')
function extrairFiltros(linhas, sites) {
  const nomes = new Map(Object.entries(NOMES_PADRAO).map(([id, nome]) => [Number(id), nome]));
  for (const s of sites) nomes.set(Number(s.ID_SITE), s.NM_SITE); // o nome do banco vence o padrão
  const comDados = new Set(), meses = {};
  let ultimo = null;
  for (const l of linhas) {
    if (!SERIE_POR_ORDEM[l.ORDEM_GRAFICO]) continue;
    const [a, m] = anoMes(l.DT_REF);
    comDados.add(Number(l.ID_SITE));
    (meses[a] = meses[a] || new Set()).add(m);
    if (l.ORDEM_GRAFICO === 2 && letraAF(l.NM_VISAO) === 'A' && (!ultimo || a * 12 + m > ultimo.ano * 12 + ultimo.mes)) ultimo = { ano: a, mes: m };
  }
  return {
    // Ordem de apresentação das unidades: ID_SITE (ordem padrão do filtro). Site sem nome em
    // IBP.SITES não entra no menu (não há como identificá-lo); o ID vai em semNome para diagnóstico
    sites: [...comDados].filter(id => nomes.has(id)).sort((x, y) => x - y).map(id => ({ id, nome: nomes.get(id) })),
    semNome: [...comDados].filter(id => !nomes.has(id)).sort((x, y) => x - y),
    anos: Object.keys(meses).map(Number).sort(),
    meses: Object.fromEntries(Object.entries(meses).map(([a, ms]) => [a, [...ms].sort((x, y) => x - y)])),
    ultimoRealizado: ultimo,
  };
}

// Nomes dos sites do dashboard (base: /sites do VBM-Performance-Studio), com os nomes curtos
// de apresentação definidos para o COO
const SITES_SQL = `
SELECT DISTINCT
  S.ID_SITE,
  CASE LTRIM(RTRIM(S.NM_SITE))
    WHEN 'Ontario Operations'       THEN 'Ontario'
    WHEN 'VNL Operations'           THEN 'VNL'
    WHEN 'Clydach | CNR'            THEN 'Clydach'
    WHEN 'Matsusaka | Tonimet'      THEN 'Matsusaka'
    WHEN 'Copper Cliff | CCNR'      THEN 'Copper Cliff'
    ELSE LTRIM(RTRIM(S.NM_SITE))
  END AS NM_SITE
FROM IBP.SITES S
RIGHT JOIN IBP.DASHBOARD D
  ON D.ID_SITE = S.ID_SITE
WHERE D.ID_DASH = @idDash
  AND S.NM_SITE IS NOT NULL
  AND LTRIM(RTRIM(S.NM_SITE)) <> ''
ORDER BY NM_SITE`;

// KPIs cadastrados no dashboard (IBP.DASHBOARD): a lista vale mesmo para KPI sem valor no mês
// (a query de valores só traz KPI com linha em PEDRAVISAO*) — usada nas páginas que mostram
// todos os KPIs da query (VNL Mines)
const CADASTRO_SQL = `
SELECT DISTINCT DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI, LTRIM(RTRIM(DASH.NM_KPIS_DASH)) AS NM_KPI,
  DASH.ID_ORDEM, LTRIM(RTRIM(DASH.SG_UNID)) AS SG_UNID, DASH.VL_CASADECIMAL
FROM IBP.DASHBOARD DASH
WHERE DASH.ID_DASH = @idDash`;

function cadastroDoSite(linhas, site) {
  return linhas.filter(l => Number(l.ID_SITE) === site).map(l => {
    const casas = Number(l.VL_CASADECIMAL);
    return { ID_OPERACAO: l.ID_OPERACAO, ID_KPI: l.ID_KPI, NM_KPI: String(l.NM_KPI || '').trim(), ID_ORDEM: l.ID_ORDEM, SG_UNID: l.SG_UNID || null,
      CASA_DECIMAL: l.VL_CASADECIMAL != null && Number.isInteger(casas) && casas >= 0 && casas <= 6 ? casas : null };
  }).sort((a, b) => a.ID_ORDEM - b.ID_ORDEM);
}

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

  // Pedidos simultâneos da mesma consulta esperam a MESMA ida ao banco (o pool do Portal
  // tem poucas conexões; consultas pesadas em paralelo travariam as demais). Falha não fica no cache.
  // Se a releitura falhar e houver resultado anterior (até DESATUALIZADO_MAX_MS), ele continua
  // sendo servido, marcado como desatualizado — a página não fica vazia por uma queda do banco.
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
        item.expiraEm = Date.now() + Math.min(CACHE_TTL_MS, 60 * 1000); // tenta o banco de novo em até 1 min
        return item.dados;
      }
      throw err;
    }).finally(() => emAndamento.delete(chave));
    emAndamento.set(chave, p);
    return p;
  }

  // Erro do banco fica no log do servidor; a tela recebe só uma mensagem genérica
  const buscar = (caminho, consulta, fresco) => comCache(caminho, async () => (await runQuery(consulta, { idDash: [sql.Int, ID_DASH] })).recordset, fresco);
  const fresco = req => req.query.fresco === '1';
  // Hora em que o banco foi lido (para o "Last updated" da tela)
  const lidoEm = caminho => { const item = cache.get(caminho); return new Date(item ? item.lidoEm : Date.now()).toISOString(); };
  const desatualizado = caminho => !!(cache.get(caminho) || {}).desatualizado;

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
  const diagnostico = process.env.COO_DIAGNOSTICO === '1';
  for (const c of CONSULTAS) {
    SQL[c.rota] = carregarSql(c.arquivo, c.trocas);
    if (diagnostico) rota(c.rota, SQL[c.rota], c.falha);
  }
  if (diagnostico) rota('/sites', SITES_SQL, 'Failed to query the dashboard sites.');

  router.get('/filtros', async (req, res) => {
    try {
      const [linhas, sites] = await Promise.all([buscar('/chart-data', SQL['/chart-data'], fresco(req)), buscar('/sites', SITES_SQL, fresco(req))]);
      res.json(extrairFiltros(linhas, sites));
    } catch (err) {
      console.error(`${TAG} erro em /filtros:`, err.message);
      res.status(500).json({ error: 'Failed to query the dashboard filters.', codigo: 'ERRO_BANCO' });
    }
  });

  // Indicadores de um site no mês escolhido: o script devolve, para cada mês
  // (DT_REF), as linhas do mês, do trimestre daquele mês e do ano — o filtro
  // pelo mês já traz as três janelas do card. Usa o mesmo cache do /chart-data.
  router.get('/indicadores', async (req, res) => {
    const p = { site: inteiro(req.query.site, 1, 2147483647), ano: inteiro(req.query.ano, 2000, 2100), mes: inteiro(req.query.mes, 1, 12) };
    if (!p.site || !p.ano || !p.mes) {
      return res.status(400).json({ error: 'Invalid parameters: use site (numeric id), ano (2000–2100) and mes (1–12).', codigo: 'PARAMETRO' });
    }
    try {
      const linhas = agregarIndicadores(await buscar('/chart-data', SQL['/chart-data'], fresco(req)), p);
      // Cadastro do site (KPIs sem valor no mês também); se falhar, segue sem ele
      let cadastro = [];
      try { cadastro = cadastroDoSite(await buscar('/cadastro', CADASTRO_SQL, fresco(req)), p.site); } catch (err) { console.error(`${TAG} cadastro indisponível:`, err.message); }
      res.json({ ...p, geradoEm: lidoEm('/chart-data'), desatualizado: desatualizado('/chart-data'), linhas, cadastro });
    } catch (err) {
      console.error(`${TAG} erro em /indicadores:`, err.message);
      res.status(500).json({ error: 'Failed to query the dashboard indicators.', codigo: 'ERRO_BANCO' });
    }
  });

  // Situação da atualização do ciclo, à parte dos indicadores: a tela desenha os gráficos
  // primeiro e acrescenta o aviso quando esta resposta chega (ou fica sem ele, se falhar)
  router.get('/atualizacao', async (req, res) => {
    const p = { site: inteiro(req.query.site, 1, 2147483647), ano: inteiro(req.query.ano, 2000, 2100), mes: inteiro(req.query.mes, 1, 12) };
    if (!p.site || !p.ano || !p.mes) {
      return res.status(400).json({ error: 'Invalid parameters: use site (numeric id), ano (2000–2100) and mes (1–12).', codigo: 'PARAMETRO' });
    }
    try {
      const kpis = Object.fromEntries(atualizacoesDoMes(await buscar('/atualizacoes', SQL['/atualizacoes'], fresco(req)), p));
      res.json({ ...p, kpis });
    } catch (err) {
      console.error(`${TAG} erro em /atualizacao:`, err.message);
      res.status(500).json({ error: 'Failed to query the data update status.', codigo: 'ERRO_BANCO' });
    }
  });

  return router;
}

module.exports = { criarCooRouter, carregarSql, agregarIndicadores, extrairFiltros, atualizacoesDoMes, situacaoAtualizacao, cadastroDoSite, CONSULTAS };
