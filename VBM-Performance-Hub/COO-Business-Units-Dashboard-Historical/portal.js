/**
 * COO Business Units Dashboard Historical — aplicação do Performance Hub montada em
 * /VBM-Performance-Hub/<pasta>/ (página: index.html). Mesmo molde do portal.js do
 * COO-Business-Units-Dashboard e do VBM-Performance-Studio: o endereço sai do NOME DA PASTA.
 *
 * Quem chama é VBM-Performance-Hub/portal.js (ver a lista APLICACOES lá),
 * ANTES do express.static do Portal. O controle de acesso (IBP.USERS com
 * CD_MATRICULA, portal-acesso.js) já vale para tudo em /VBM-Performance-Hub,
 * inclusive esta API — registrado no server.js do Portal.
 *
 * Conexão PRÓPRIA (pool separado), sempre no Azure SQL PRD, com as mesmas
 * variáveis do Performance Hub: PERFORMANCEHUB_SQL_SERVER / _DATABASE / _PORT /
 * _USER / _PASSWORD. Sem elas: servidor e base PRD abaixo, e o usuário/senha
 * do Portal (AZURE_SQL_USER / AZURE_SQL_PASSWORD, por valueFrom no app.yaml).
 * COO_ID_DASH (opcional): IBP.DASHBOARD.ID_DASH do dashboard (padrão 15 — a mesma carga do COO).
 */
const path = require('path');
const sql = require('mssql');
const { criarCooRouter } = require('./coo-api');

const PRD_SERVER = 'rdb-ibp-bmsa-prd.database.windows.net';
const PRD_DATABASE = 'BDIBPBMSA_PRD';
// Prefixo da aplicação no portal: /VBM-Performance-Hub/<nome desta pasta>.
const HUB = '/' + path.basename(path.dirname(__dirname));
const PASTA = path.basename(__dirname);
const BASE = HUB + '/' + PASTA;
const TAG = '[' + PASTA.toLowerCase() + ']';
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = function montarCooHistoricalNoPortal(app) {
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
      if (faltando.length) return Promise.reject(new Error(`COO Historical: credencial do banco ausente (${faltando.join(', ')})`));
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
  const runQuery = async (query, params) => {
    const request = (await getPool()).request();
    Object.entries(params || {}).forEach(([nome, [tipo, valor]]) => request.input(nome, tipo, valor));
    return request.query(query);
  };
  const semCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

  // Express não diferencia maiúsculas: cobre <BASE>/api em qualquer caixa.
  // O motivo da falha fica no log; a resposta não leva texto do banco.
  app.get(BASE + '/api/health', semCache, async (req, res) => {
    try {
      await runQuery('SELECT 1 AS ok');
      res.json({ status: 'healthy' }); // servidor e base ficam só no log (não vão para o navegador)
    } catch (err) {
      console.error(TAG + ' health:', err.message);
      res.status(503).json({ status: 'unhealthy' });
    }
  });
  app.use(BASE + '/api', semCache, criarCooRouter({ runQuery, idDash: env.COO_ID_DASH }));

  // Da pasta só a página (/, index.html) e os assets são públicos:
  // server.js, portal.js, coo-api.js, database/, tests/, package*.json, .env*
  // ficam bloqueados (o express.static do Portal serve a pasta).
  const PUBLICO = new RegExp('^' + escaparRegex(BASE) + '\\/?(index\\.html|assets\\/.+)?$', 'i');
  app.use(BASE, (req, res, next) => {
    const caminho = req.originalUrl.split('?')[0];
    if (PUBLICO.test(caminho) && !/\.\.|%2e|%5c|\\/i.test(caminho)) return next();
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Not found.' });
  });

  console.log(`${TAG} rotas em ${BASE}/api — banco ${DB.server}/${DB.database}`);
  if (!env.PERFORMANCEHUB_SQL_SERVER || !(env.PERFORMANCEHUB_AZURE_SQL_DATABASE || env.PERFORMANCEHUB_SQL_DATABASE)) {
    console.warn(`${TAG} ATENÇÃO: servidor/base não definidos por variável — usando o padrão de PRODUÇÃO (${PRD_SERVER}/${PRD_DATABASE}). Em DEV/HML defina PERFORMANCEHUB_SQL_SERVER e PERFORMANCEHUB_AZURE_SQL_DATABASE.`);
  }
  return { runQuery };
};
