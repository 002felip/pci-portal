/**
 * COO Business Units Dashboard Historical — rotas de dados como MÓDULO.
 *
 * Mesmo contrato do coo-api.js do COO-Business-Units-Dashboard (e do performancehub-api.js do
 * VBM-Performance-Studio): os dois pontos de entrada (portal.js, dentro do Portal; server.js,
 * standalone) montam ESTE router, e cada um injeta o seu `runQuery`.
 * Contrato: `runQuery(sql, params?)` devolve algo com `.recordset` (formato do pacote `mssql`);
 * `params` é `{ nome: [tipoMssql, valor] }` e cada entrada vira `request.input` — nada da
 * requisição é concatenado na SQL.
 *
 * Fonte dos gráficos: a MESMA tabela do COO, IBP.PHUB_PERFORMANCESTUDIO (ID_DASH do COO), só com
 * a visão ANUAL (CD_PERIODO = 'YEAR') desde COO_HIST_ANO_INICIAL (padrão 2017), filtrada no banco por
 * database/001_coo_historical_anual.sql. Mês e trimestre não são lidos. Cada carga é um ciclo (DT_REF,
 * dia 1 do mês); a tela mostra, para cada ano, a carga mais recente até o ciclo escolhido.
 *
 * Business Units: só as do Historical (BUS_HISTORICAL), aplicado aqui no servidor. As refinarias da
 * IR (Clydach, Matsusaka) também passam: alimentam os cards de produção da IR e não viram unidade.
 *
 * Rotas (ciclo = AAAA-MM de uma carga gravada; sem ele, a carga mais recente):
 *   GET /ping                          diagnóstico sem banco
 *   GET /ciclos                        cargas gravadas (DT_REF), da mais recente para a mais antiga
 *   GET /config                        seletores e apelidos de KPI (o mesmo JSON do COO em IBP.PHUB_PS_SETUP)
 *   GET /filtros?ciclo=                sites do Historical com dados e anos disponíveis
 *   GET /indicadores?site=&ciclo=      Budget e Actual/Forecast por KPI do site, ano a ano
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const sql = require('mssql');

const TAG = '[coo-historical]';
// Segundos de env (inteiro positivo) ou o padrão
function segundos(valor, padrao) { const n = Number(valor); return Number.isInteger(n) && n > 0 ? n * 1000 : padrao * 1000; }
// Mesmas variáveis do COO (padrões iguais): cache, refresh e tolerância a banco fora
const CACHE_TTL_MS = segundos(process.env.COO_CACHE_TTL_S, 300);
const FRESCO_MS = segundos(process.env.COO_FRESCO_S, 15);
const DESATUALIZADO_MAX_MS = segundos(process.env.COO_DESATUALIZADO_MAX_S, 2 * 3600);
const LIMITE_POR_MINUTO = 240;
const ID_DASH_PADRAO = 15; // IBP.DASHBOARD.ID_DASH do COO Dashboard (a mesma carga)
// Primeiro ano da série histórica (COO_HIST_ANO_INICIAL, padrão 2017)
const ANO_INICIAL = (() => { const n = Number(process.env.COO_HIST_ANO_INICIAL); return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : 2017; })();

// Nome comparável: sem acento, espaços, pontuação ou maiúsculas (mesma regra da página)
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// Business Units do Historical (nome de apresentação de SITES_SQL, normalizado)
const BUS_HISTORICAL = ['salobo', 'sossego', 'oncapuma', 'manitoba', 'vnl', 'ontario', 'ir', 'internationalrefineries'];
// Refinarias que alimentam a produção da IR: entram nos dados, não no menu (a página as reconhece)
const FILHOS_IR = /^(clydach|matsusaka|matsuzaka)/;
const IDS_FILHOS_IR = [16, 26];
function sitePermitido(id, nome) {
  const n = normalizar(nome);
  return BUS_HISTORICAL.includes(n) || FILHOS_IR.test(n) || IDS_FILHOS_IR.includes(Number(id));
}

// Cargas do COO em IBP.PHUB_PERFORMANCESTUDIO (uma por DT_REF), com a hora da gravação
const CICLOS_SQL = `
SELECT R.DT_REF, MAX(R.DT_ATUALIZACAO) AS DT_CARGA
FROM IBP.PHUB_PERFORMANCESTUDIO R
WHERE R.ID_DASH = @idDash
GROUP BY R.DT_REF
ORDER BY R.DT_REF DESC`;

// Configuração da tela: o MESMO registro do COO (seletores Cu/Au, All-in, CAPEX e apelidos de KPI)
const CONFIG_VISAO = 'COO_BUSINESS_UNITS';
const CONFIG_SQL = `
SELECT TOP 1 S.DS_LAYOUT
FROM IBP.PHUB_PS_SETUP S
WHERE S.CD_VISAO = @visao
ORDER BY S.DT_ATUALIZACAO DESC`;
const texto = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
const nomes = (v) => (Array.isArray(v) ? v.map(n => texto(n, 200)).filter(Boolean).slice(0, 20) : []);
// Só o formato esperado passa para a tela; o resto é descartado
function normalizarConfigCoo(json) {
  let c;
  try { c = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
  if (!c || typeof c !== 'object') return null;
  const seletores = {}, apelidos = {};
  for (const [cod, sel] of Object.entries(c.seletores || {})) {
    if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(cod) || !sel || !Array.isArray(sel.opcoes)) continue;
    const opcoes = sel.opcoes.map(o => o && /^[a-z][a-z0-9]{0,19}$/.test(o.chave) && texto(o.lbl, 40) && texto(o.titulo, 200)
      ? { chave: o.chave, lbl: texto(o.lbl, 40), titulo: texto(o.titulo, 200), kpi: nomes(o.kpi), unid: texto(o.unid, 20) } : null).filter(Boolean);
    if (opcoes.length) seletores[cod] = { opcoes };
  }
  for (const [card, lista] of Object.entries(c.apelidos || {})) {
    const n = nomes(lista);
    if (texto(card, 200) && n.length) apelidos[card.trim()] = n;
  }
  return { seletores, apelidos };
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

// Inteiro de query string dentro de um intervalo; null se inválido
function inteiro(valor, min, max) {
  if (!/^\d{1,10}$/.test(String(valor || ''))) return null;
  const n = Number(valor);
  return n >= min && n <= max ? n : null;
}

// Última letra do rótulo do script ('25A', '26F') → 'A' ou 'F'
function letraAF(tipo) {
  const l = String(tipo || '').trim().slice(-1).toUpperCase();
  return l === 'A' || l === 'F' ? l : null;
}
// Casas decimais do KPI (IBP.DASHBOARD.VL_CASADECIMAL): inteiro de 0 a 6; fora disso, null (padrão da página)
function casasDe(v) { const n = Number(v); return v != null && Number.isInteger(n) && n >= 0 && n <= 6 ? n : null; }

// Linhas anuais de um site → um item por KPI, com B e A/F de cada ano e a letra do script
function agregarAnual(linhas, site) {
  const porKpi = new Map(), vistas = new Set();
  let repetidas = 0;
  for (const l of linhas) {
    if (Number(l.ID_SITE) !== site) continue;
    const ano = Number(l.ANO), serie = l.SERIE === 'B' ? 'B' : l.SERIE === 'AF' ? 'AF' : null;
    if (!serie || !Number.isInteger(ano)) continue;
    const unica = `${l.ID_OPERACAO}|${l.ID_KPI}|${ano}|${serie}`;
    if (vistas.has(unica)) repetidas++; else vistas.add(unica);
    const chave = `${l.ID_OPERACAO}|${l.ID_KPI}`;
    if (!porKpi.has(chave)) {
      porKpi.set(chave, { ID_OPERACAO: l.ID_OPERACAO, ID_KPI: l.ID_KPI, NM_KPI: String(l.NM_KPI || '').trim(), ID_ORDEM: l.ID_ORDEM, SG_UNID: null, CASA_DECIMAL: null, ANOS: {} });
    }
    const item = porKpi.get(chave);
    const unid = String(l.SG_UNID == null ? '' : l.SG_UNID).trim();
    if (unid && !item.SG_UNID) item.SG_UNID = unid;
    if (casasDe(l.VL_CASADECIMAL) != null) item.CASA_DECIMAL = casasDe(l.VL_CASADECIMAL);
    const a = item.ANOS[ano] = item.ANOS[ano] || { VL_B: null, VL_AF: null, LETRA_AF: null };
    const valor = l.VL_KPI == null ? 0 : Number(l.VL_KPI);
    if (serie === 'B') a.VL_B = (a.VL_B || 0) + valor;
    else { a.VL_AF = (a.VL_AF || 0) + valor; a.LETRA_AF = letraAF(l.NM_VISAO) || a.LETRA_AF; }
  }
  if (repetidas) console.warn(`${TAG} site ${site}: ${repetidas} linha(s) repetida(s) para a mesma série/ano do mesmo KPI — valores somados; verifique duplicidade em IBP.DASHBOARD (ID_DASH do COO)`);
  return [...porKpi.values()].sort((x, y) => (x.ID_ORDEM - y.ID_ORDEM) || (x.ID_OPERACAO - y.ID_OPERACAO) || (x.ID_KPI - y.ID_KPI));
}

// Nome de site do dashboard sem nome em IBP.SITES (mesmo padrão do COO)
const NOMES_PADRAO = { 36: 'Reid Brook', 37: 'Eastern Deeps', 42: 'Discovery Hill' };

// Filtros da tela: sites do Historical que têm linhas anuais e os anos disponíveis
function extrairFiltros(linhas, sites) {
  const nomesSite = new Map(Object.entries(NOMES_PADRAO).map(([id, nome]) => [Number(id), nome]));
  for (const s of sites) nomesSite.set(Number(s.ID_SITE), s.NM_SITE); // o nome do banco vence o padrão
  const comDados = new Set(), anos = new Set();
  for (const l of linhas) {
    const id = Number(l.ID_SITE);
    if (!nomesSite.has(id) || !sitePermitido(id, nomesSite.get(id))) continue;
    comDados.add(id);
    if (Number.isInteger(Number(l.ANO))) anos.add(Number(l.ANO));
  }
  return {
    sites: [...comDados].sort((x, y) => x - y).map(id => ({ id, nome: nomesSite.get(id) })),
    semNome: [...new Set(linhas.map(l => Number(l.ID_SITE)))].filter(id => !nomesSite.has(id)).sort((x, y) => x - y),
    anos: [...anos].sort((x, y) => x - y),
  };
}

// Nomes dos sites do dashboard com os nomes curtos de apresentação (o mesmo SQL do COO)
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

// KPIs cadastrados no dashboard (IBP.DASHBOARD): o card existe mesmo sem valor anual
const CADASTRO_SQL = `
SELECT DISTINCT DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI, LTRIM(RTRIM(DASH.NM_KPIS_DASH)) AS NM_KPI,
  DASH.ID_ORDEM, LTRIM(RTRIM(DASH.SG_UNID)) AS SG_UNID, DASH.VL_CASADECIMAL
FROM IBP.DASHBOARD DASH
WHERE DASH.ID_DASH = @idDash`;

function cadastroDoSite(linhas, site) {
  return linhas.filter(l => Number(l.ID_SITE) === site).map(l => ({
    ID_OPERACAO: l.ID_OPERACAO, ID_KPI: l.ID_KPI, NM_KPI: String(l.NM_KPI || '').trim(), ID_ORDEM: l.ID_ORDEM,
    SG_UNID: l.SG_UNID || null, CASA_DECIMAL: casasDe(l.VL_CASADECIMAL),
  })).sort((a, b) => a.ID_ORDEM - b.ID_ORDEM);
}

// Lê o script de database/ e confere os parâmetros que a API passa (falha ao subir, não na tela)
function carregarSql(arquivo, parametros) {
  const textoSql = fs.readFileSync(path.join(__dirname, 'database', arquivo), 'utf8');
  for (const p of parametros) {
    if (!textoSql.includes(p)) throw new Error(`${arquivo}: parâmetro ${p} ausente — revise o script antes de publicar`);
  }
  if (/DASH\.ID_DASH\s*=\s*\d/.test(textoSql)) throw new Error(`${arquivo}: ID_DASH fixo — use @idDash`);
  return textoSql;
}
const ANUAL = { arquivo: '001_coo_historical_anual.sql', parametros: ['@idDash', '@dtRef', '@anoIni', "CD_PERIODO = 'YEAR'"] };

// ID_DASH configurável (COO_ID_DASH, a mesma variável do COO)
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
  const ANUAL_SQL = carregarSql(ANUAL.arquivo, ANUAL.parametros);
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

  const buscar = (caminho, consulta, fresco) => comCache(caminho, async () => (await runQuery(consulta, { idDash: [sql.Int, ID_DASH] })).recordset, fresco);
  // Série anual até o ciclo 'AAAA-MM' (todas as BUs numa consulta só; cada ciclo tem o seu lugar no cache)
  const buscarAnual = (ciclo, fresco) => comCache(`/anual:${ciclo}`, async () => (await runQuery(ANUAL_SQL, {
    idDash: [sql.Int, ID_DASH], dtRef: [sql.Date, new Date(`${ciclo}-01T00:00:00Z`)], anoIni: [sql.Int, ANO_INICIAL],
  })).recordset, fresco);
  const buscarCiclos = async (fresco) => (await buscar('/ciclos', CICLOS_SQL, fresco)).map(l => ({ ciclo: cicloDe(l.DT_REF), carregadoEm: l.DT_CARGA || null }));
  async function resolverCiclo(req) {
    const pedido = lerCiclo(req.query.ciclo);
    if (pedido === undefined) throw Object.assign(new Error('Invalid ciclo: use AAAA-MM.'), { status: 400, codigo: 'PARAMETRO' });
    const ciclos = await buscarCiclos(fresco(req));
    if (!ciclos.length) throw Object.assign(new Error('No cycle loaded in IBP.PHUB_PERFORMANCESTUDIO for this dashboard.'), { status: 404, codigo: 'SEM_CICLO' });
    const achado = pedido ? ciclos.find(c => c.ciclo === pedido) : ciclos[0];
    if (!achado) throw Object.assign(new Error(`Cycle ${pedido} is not loaded.`), { status: 404, codigo: 'CICLO' });
    return achado;
  }
  function responderErro(res, rotaNome, err, falha) {
    if (err.status) return res.status(err.status).json({ error: err.message, codigo: err.codigo });
    console.error(`${TAG} erro em ${rotaNome}:`, err.message);
    res.status(500).json({ error: falha, codigo: 'ERRO_BANCO' });
  }
  const fresco = req => req.query.fresco === '1';
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

  router.get('/ping', (req, res) => res.json({ ok: true, idDash: ID_DASH }));

  // Configuração da tela (o mesmo registro do COO). Sem ela ou com erro: { config: null } e a tela
  // segue com o padrão do código — nunca bloqueia os gráficos.
  router.get('/config', async (req, res) => {
    try {
      const linhas = await comCache('/config', async () => (await runQuery(CONFIG_SQL, { visao: [sql.VarChar(40), CONFIG_VISAO] })).recordset, fresco(req));
      res.json({ config: linhas.length ? normalizarConfigCoo(linhas[0].DS_LAYOUT) : null });
    } catch (err) {
      console.error(`${TAG} configuração indisponível (usando o padrão do código):`, err.message);
      res.json({ config: null });
    }
  });

  router.get('/ciclos', async (req, res) => {
    try {
      res.json({ ciclos: await buscarCiclos(fresco(req)) });
    } catch (err) {
      responderErro(res, '/ciclos', err, 'Failed to query the loaded cycles.');
    }
  });

  router.get('/filtros', async (req, res) => {
    try {
      const c = await resolverCiclo(req);
      const [linhas, sites] = await Promise.all([buscarAnual(c.ciclo, fresco(req)), buscar('/sites', SITES_SQL, fresco(req))]);
      res.json({ ciclo: c.ciclo, ...extrairFiltros(linhas, sites) });
    } catch (err) {
      responderErro(res, '/filtros', err, 'Failed to query the dashboard filters.');
    }
  });

  // Série anual dos KPIs de um site (só sites do Historical)
  router.get('/indicadores', async (req, res) => {
    const site = inteiro(req.query.site, 1, 2147483647);
    if (!site) return res.status(400).json({ error: 'Invalid parameters: use site (numeric id).', codigo: 'PARAMETRO' });
    try {
      const c = await resolverCiclo(req);
      const sites = await buscar('/sites', SITES_SQL, fresco(req));
      const nome = (sites.find(s => Number(s.ID_SITE) === site) || {}).NM_SITE || NOMES_PADRAO[site];
      if (!sitePermitido(site, nome)) return res.status(404).json({ error: 'Business Unit not available in the Historical view.', codigo: 'SITE' });
      const linhas = agregarAnual(await buscarAnual(c.ciclo, fresco(req)), site);
      let cadastro = [];
      try { cadastro = cadastroDoSite(await buscar('/cadastro', CADASTRO_SQL, fresco(req)), site); } catch (err) { console.error(`${TAG} cadastro indisponível:`, err.message); }
      const geradoEm = c.carregadoEm ? new Date(c.carregadoEm).toISOString() : lidoEm(`/anual:${c.ciclo}`);
      res.json({ site, ciclo: c.ciclo, geradoEm, desatualizado: desatualizado(`/anual:${c.ciclo}`), linhas, cadastro });
    } catch (err) {
      responderErro(res, '/indicadores', err, 'Failed to query the dashboard indicators.');
    }
  });

  return router;
}

module.exports = { criarCooRouter, carregarSql, agregarAnual, extrairFiltros, sitePermitido, normalizarConfigCoo, lerCiclo, ANUAL, ANO_INICIAL, CICLOS_SQL, BUS_HISTORICAL };
