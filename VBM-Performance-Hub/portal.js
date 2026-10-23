/**
 * Performance Hub acoplado ao Portal em /VBM-Performance-Hub/ (página: index.html).
 *
 * Tudo do Performance Hub fica nesta pasta. O server.js do Portal só faz:
 *     require("./VBM-Performance-Hub/portal")(portal);
 * ANTES do express.static da pasta.
 *
 * Conexão PRÓPRIA (pool separado do Kaizen), sempre no Azure SQL PRD.
 * Variáveis opcionais: PERFORMANCEHUB_SQL_SERVER / _DATABASE / _PORT / _USER /
 * _PASSWORD. Sem elas: servidor e base PRD abaixo, e o usuário/senha do
 * Portal (AZURE_SQL_USER / AZURE_SQL_PASSWORD).
 */
const sql = require('mssql');
const { criarPerformanceHubRouter } = require('./performancehub-api');

const PRD_SERVER = 'rdb-ibp-bmsa-prd.database.windows.net';
const PRD_DATABASE = 'BDIBPBMSA_PRD';
// Prefixo da aplicação no portal (= nome da pasta).
const BASE = '/VBM-Performance-Hub';

module.exports = function montarPerformanceHubNoPortal(app) {
  const env = process.env;
  const DB = {
    server: env.PERFORMANCEHUB_SQL_SERVER || PRD_SERVER,
    // PERFORMANCEHUB_AZURE_SQL_DATABASE = convenção do app.yaml do portal.
    database: env.PERFORMANCEHUB_AZURE_SQL_DATABASE || env.PERFORMANCEHUB_SQL_DATABASE || PRD_DATABASE,
    user: env.PERFORMANCEHUB_SQL_USER || env.AZURE_SQL_USER || '',
    password: env.PERFORMANCEHUB_SQL_PASSWORD || env.AZURE_SQL_PASSWORD || '',
    port: parseInt(env.PERFORMANCEHUB_SQL_PORT || env.AZURE_SQL_PORT || '1433', 10),
  };

  let poolPromise = null;
  let ultimaFalha = null; // falha recente reaproveitada por 30 s (evita esperar o timeout a cada rota)

  function getPool() {
    if (!poolPromise && ultimaFalha && Date.now() - ultimaFalha.em < 30000) return Promise.reject(ultimaFalha.erro);
    if (!poolPromise) {
      const faltando = ['user', 'password'].filter(k => !DB[k]);
      if (faltando.length) return Promise.reject(new Error(`Performance Hub: credencial do banco ausente (${faltando.join(', ')})`));
      const pool = new sql.ConnectionPool({
        server: DB.server,
        port: DB.port,
        database: DB.database,
        user: DB.user,
        password: DB.password,
        options: { encrypt: true, trustServerCertificate: false },
        connectionTimeout: 30000,
        requestTimeout: 60000,
        pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
      });
      pool.on('error', err => { console.error('[performance-hub] erro no pool:', err.message); poolPromise = null; });
      poolPromise = pool.connect().then(p => {
        ultimaFalha = null;
        console.log(`[performance-hub] conectado a ${DB.server}/${DB.database}`);
        return p;
      }).catch(err => {
        poolPromise = null;
        ultimaFalha = { erro: err, em: Date.now() };
        console.error('[performance-hub] falha ao conectar:', err.message);
        throw err;
      });
    }
    return poolPromise;
  }

  // params: { nome: [tipoMssql, valor] } → request.input (nunca concatenado na SQL)
  const runQuery = async (query, params) => {
    const request = (await getPool()).request();
    Object.entries(params || {}).forEach(([nome, [tipo, valor]]) => request.input(nome, tipo, valor));
    return request.query(query);
  };
  const semCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

  // Express não diferencia maiúsculas: cobre /VBM-Performance-Hub/api e /vbm-performance-hub/api.
  app.get(BASE + '/api/health', semCache, async (req, res) => {
    try {
      await runQuery('SELECT 1 AS ok');
      res.json({ status: 'healthy', database: DB.database, server: DB.server });
    } catch (err) {
      res.status(503).json({ status: 'unhealthy', database: DB.database, error: err.message });
    }
  });
  // PERFORMANCEHUB_CONFIG_TABLE (opcional): tabela das configurações dos gráficos.
  // Imagens de fundo: mesmo Azure Blob do portal (AZURE_STORAGE_*, módulo do
  // Kaizen). Sem ele, o upload responde 503 e o resto do Performance Hub segue normal.
  let armazenamento = null;
  try {
    const blob = require(require('path').join(__dirname, '..', process.env.KAIZEN_PASTA || 'VBM-Kaizen-App', 'azure-blob'));
    armazenamento = { configurado: blob.blobConfigurado, enviar: blob.enviarArquivoParaBlob, baixar: blob.baixarArquivoDoBlob };
  } catch (e) {
    console.warn('[performance-hub] armazenamento de imagens indisponível:', e.message);
  }
  app.use(BASE + '/api', semCache, criarPerformanceHubRouter({ runQuery, tabelaConfiguracao: env.PERFORMANCEHUB_CONFIG_TABLE, armazenamento, pastaFundos: env.PERFORMANCEHUB_BG_PASTA }));

  // Da pasta só a página (/, index.html) e os assets são públicos:
  // server.js, portal.js, performancehub-api.js, app.yaml, package*.json, .env*
  // e docs ficam bloqueados (o express.static do Portal serve a pasta).
  const PUBLICO = /^\/vbm-performance-hub\/?(index\.html|assets\/.+)?$/i;
  app.use(BASE, (req, res, next) => {
    const caminho = req.originalUrl.split('?')[0];
    if (PUBLICO.test(caminho) && !/\.\.|%2e|%5c|\\/i.test(caminho)) return next();
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Não encontrado.' });
  });

  console.log(`[performance-hub] rotas em ${BASE}/api — banco ${DB.server}/${DB.database}`);
  // Conexão PRD reaproveitada pelo controle de acesso do Portal (portal-acesso.js)
  return { runQuery };
};
