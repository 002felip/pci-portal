/**
 * VBM Stable & Capable montado em /VBM-Stable-and-Capable/ (página: index.html),
 * aplicação da RAIZ do Portal, ao lado do VBM-Kaizen-App e do VBM-Performance-Hub.
 * Mesmo molde do portal.js das aplicações do Hub: o endereço sai do NOME DA
 * PASTA. Quem chama é o server.js do Portal:
 *     require("./VBM-Stable-and-Capable/portal")(portal);
 * ANTES do express.static da pasta, e DEPOIS do controle de acesso do Portal
 * (IBP.USERS com CD_MATRICULA), registrado lá para /VBM-Stable-and-Capable.
 *
 * BANCO: o MESMO do VBM-Kaizen-App (mesmo servidor e login do Portal), com
 * pool próprio. Banco escolhido nesta ordem:
 *   STABLECAPABLE_AZURE_SQL_DATABASE  (só desta aplicação, se um dia precisar)
 *   KAIZEN_AZURE_SQL_DATABASE         (o do Kaizen — padrão)
 *   AZURE_SQL_DATABASE
 * Servidor/porta/login: AZURE_SQL_SERVER / AZURE_SQL_PORT /
 * AZURE_SQL_USER / AZURE_SQL_PASSWORD (os do Portal).
 *
 * ARQUIVOS: mesmo Azure Blob do Kaizen (AZURE_STORAGE_*, módulo azure-blob
 * da pasta do Kaizen). Subpasta dentro de AZURE_STORAGE_CONTAINER:
 *   STABLECAPABLE_BLOB_PASTA  padrão '01 - Imagens/Stable & Capable'
 * Sem Blob configurado, a aplicação funciona gravando no disco local do app
 * (os arquivos se perdem quando ele reinicia) — o log avisa.
 *
 * POWER BI (aba refeita no app, bi-api.js): lê SEMPRE do banco PRD, como o
 * Power BI original, com pool próprio:
 *   STABLECAPABLE_BI_SQL_DATABASE  padrão 'BDIBPBMSA_PRD'
 *   STABLECAPABLE_BI_SQL_SERVER    padrão AZURE_SQL_SERVER ou o servidor PRD
 *   login: AZURE_SQL_USER / AZURE_SQL_PASSWORD (os do Portal)
 *
 * PYTHON: o gerador de PDF fica em ./python e roda como processo filho.
 * As bibliotecas vêm do requirements.txt da RAIZ do Portal (o Databricks
 * Apps instala no deploy). STABLECAPABLE_PYTHON (opcional) força o executável.
 */
const path = require('path');
const sql = require('mssql');
const { criarStableCapableRouter } = require('./stable-capable-api');

// Prefixo da aplicação no portal: /<nome desta pasta>.
const PASTA = path.basename(__dirname);
const BASE = '/' + PASTA;
const TAG = '[' + PASTA.toLowerCase() + ']';
// Raiz do portal (uma pasta acima): de onde vem o módulo azure-blob do Kaizen.
const RAIZ_PORTAL = path.resolve(__dirname, '..');
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = function montarStableCapableNoPortal(app) {
  const env = process.env;
  const DB = {
    server: env.STABLECAPABLE_SQL_SERVER || env.AZURE_SQL_SERVER || '',
    database: env.STABLECAPABLE_AZURE_SQL_DATABASE || env.KAIZEN_AZURE_SQL_DATABASE || env.AZURE_SQL_DATABASE || '',
    user: env.STABLECAPABLE_SQL_USER || env.AZURE_SQL_USER || '',
    password: env.STABLECAPABLE_SQL_PASSWORD || env.AZURE_SQL_PASSWORD || '',
    port: parseInt(env.STABLECAPABLE_SQL_PORT || env.AZURE_SQL_PORT || '1433', 10),
  };

  let poolPromise = null;
  let ultimaFalha = null; // falha recente reaproveitada por 30 s (evita esperar o timeout a cada rota)

  function getPool() {
    if (!poolPromise && ultimaFalha && Date.now() - ultimaFalha.em < 30000) return Promise.reject(ultimaFalha.erro);
    if (!poolPromise) {
      const faltando = ['server', 'database', 'user', 'password'].filter(k => !DB[k]);
      if (faltando.length) return Promise.reject(new Error(`Stable & Capable: configuração do banco ausente (${faltando.join(', ')})`));
      const pool = new sql.ConnectionPool({
        server: DB.server,
        port: DB.port,
        database: DB.database,
        user: DB.user,
        password: DB.password,
        options: { encrypt: true, trustServerCertificate: false },
        connectionTimeout: 30000,
        // A consulta do Stable & Capable agrega ~2 anos de dados diários:
        // bem mais lenta que as telas. 10 min de margem.
        requestTimeout: 10 * 60 * 1000,
        pool: { max: 2, min: 0, idleTimeoutMillis: 30000 },
      });
      pool.on('error', err => { console.error(TAG + ' erro no pool:', err.message); poolPromise = null; });
      poolPromise = pool.connect().then(p => {
        ultimaFalha = null;
        console.log(`${TAG} conectado a ${DB.server}/${DB.database}`);
        return p;
      }).catch(err => {
        poolPromise = null;
        ultimaFalha = { erro: err, em: Date.now() };
        console.error(TAG + ' falha ao conectar:', err.message);
        throw err;
      });
    }
    return poolPromise;
  }

  // params: { nome: [tipoMssql, valor] } → request.input (nunca concatenado na SQL)
  // ── Pool PRD da aba Power BI (independente do banco acima) ──
  const DB_BI = {
    server: env.STABLECAPABLE_BI_SQL_SERVER || env.AZURE_SQL_SERVER || 'rdb-ibp-bmsa-prd.database.windows.net',
    database: env.STABLECAPABLE_BI_SQL_DATABASE || 'BDIBPBMSA_PRD',
    user: DB.user, password: DB.password, port: DB.port,
  };
  let poolBi = null;
  function getPoolBi() {
    if (!poolBi) {
      if (!DB_BI.user || !DB_BI.password) return Promise.reject(new Error('Stable & Capable BI: credencial do banco ausente'));
      const pool = new sql.ConnectionPool({
        ...DB_BI,
        options: { encrypt: true, trustServerCertificate: false },
        connectionTimeout: 30000,
        requestTimeout: 10 * 60 * 1000, // ~80 mil linhas agregadas
        pool: { max: 2, min: 0, idleTimeoutMillis: 60000 },
      });
      pool.on('error', (err) => { console.error(TAG + ' erro no pool BI:', err.message); poolBi = null; });
      poolBi = pool.connect().catch((err) => { poolBi = null; throw err; });
    }
    return poolBi;
  }
  const runQueryPrd = async (query) => (await getPoolBi()).request().query(query);

  const runQuery = async (query, params) => {
    const request = (await getPool()).request();
    Object.entries(params || {}).forEach(([nome, [tipo, valor]]) => request.input(nome, tipo, valor));
    return request.query(query);
  };
  const semCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

  // O motivo da falha fica no log; a resposta não leva texto do banco.
  app.get(BASE + '/api/health', semCache, async (req, res) => {
    try {
      await runQuery('SELECT 1 AS ok');
      res.json({ status: 'healthy', database: DB.database, server: DB.server });
    } catch (err) {
      console.error(TAG + ' health:', err.message);
      res.status(503).json({ status: 'unhealthy', database: DB.database });
    }
  });

  let armazenamento = null;
  try {
    const blob = require(path.join(RAIZ_PORTAL, env.KAIZEN_PASTA || 'VBM-Kaizen-App', 'azure-blob'));
    armazenamento = { configurado: blob.blobConfigurado, enviar: blob.enviarArquivoParaBlob, baixar: blob.baixarArquivoDoBlob };
  } catch (e) {
    console.warn(TAG + ' Azure Blob indisponível:', e.message);
  }
  app.use(BASE + '/api', semCache, criarStableCapableRouter({ runQuery, obterPool: getPool, runQueryPrd, bancoBi: `${DB_BI.server}/${DB_BI.database}`, armazenamento, pastaBlob: env.STABLECAPABLE_BLOB_PASTA }));

  // Da pasta só a página (/, index.html) e os assets são públicos:
  // portal.js, stable-capable-api.js, server.js, database/, python/,
  // package*.json, .env* ficam bloqueados (o express.static do Portal serve a pasta).
  const PUBLICO = new RegExp('^' + escaparRegex(BASE) + '\\/?(index\\.html|assets\\/.+)?$', 'i');
  app.use(BASE, (req, res, next) => {
    const caminho = req.originalUrl.split('?')[0];
    if (PUBLICO.test(caminho) && !/\.\.|%2e|%5c|\\/i.test(caminho)) return next();
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Não encontrado.' });
  });

  console.log(`${TAG} rotas em ${BASE}/api — banco ${DB.server || '?'}/${DB.database || '?'}`);
  return { runQuery };
};
