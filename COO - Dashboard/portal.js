/**
 * COO Dashboard acoplado ao Portal em /COO-Dashboard/ (página: index.html).
 *
 * Tudo do COO Dashboard fica nesta pasta. No server.js do Portal, ANTES do
 * gate de páginas e do express.static, bastam duas linhas:
 *
 *     portal.use("/COO-Dashboard", aguardarAcesso("exigir"));   // controle de acesso do Portal
 *     require("./COO - Dashboard/portal")(portal);
 *
 * O controle de acesso dentro do Portal é o do próprio Portal
 * (portal-acesso.js: IBP.USERS + CD_MATRICULA); acesso.js desta pasta só é
 * usado no modo standalone.
 *
 * Conexão PRÓPRIA (pool separado do Kaizen e do Performance Hub), sempre no
 * Azure SQL PRD. Variáveis opcionais: COO_SQL_SERVER / COO_AZURE_SQL_DATABASE /
 * COO_SQL_PORT / COO_SQL_USER / COO_SQL_PASSWORD. Sem elas: servidor e base
 * PRD abaixo, e o usuário/senha do Portal (AZURE_SQL_USER / AZURE_SQL_PASSWORD).
 * Dashboard: COO_ID_DASH (IBP.DASHBOARD.ID_DASH), padrão 15 = scripts em database/.
 * Unidades liberadas: COO_SITES, padrão "Sossego,Salobo".
 */
const path = require('path');
const sql = require('mssql');
const { criarCooRouter } = require('./coo-api');

const PRD_SERVER = 'rdb-ibp-bmsa-prd.database.windows.net';
const PRD_DATABASE = 'BDIBPBMSA_PRD';
// Rota pública da aplicação no portal. A pasta tem espaços ("COO - Dashboard"),
// a URL não: espaço vira %20 e quebra links copiados por e-mail/Teams.
const BASE = '/COO-Dashboard';

module.exports = function montarCooDashboardNoPortal(app) {
  const env = process.env;
  const DB = {
    server: env.COO_SQL_SERVER || PRD_SERVER,
    database: env.COO_AZURE_SQL_DATABASE || env.COO_SQL_DATABASE || PRD_DATABASE,
    user: env.COO_SQL_USER || env.AZURE_SQL_USER || '',
    password: env.COO_SQL_PASSWORD || env.AZURE_SQL_PASSWORD || '',
    port: parseInt(env.COO_SQL_PORT || env.AZURE_SQL_PORT || '1433', 10),
  };

  let poolPromise = null;
  let ultimaFalha = null; // falha recente reaproveitada por 30 s (evita esperar o timeout a cada rota)

  function getPool() {
    if (!poolPromise && ultimaFalha && Date.now() - ultimaFalha.em < 30000) return Promise.reject(ultimaFalha.erro);
    if (!poolPromise) {
      const faltando = ['user', 'password'].filter(k => !DB[k]);
      if (faltando.length) return Promise.reject(new Error(`COO Dashboard: credencial do banco ausente (${faltando.join(', ')})`));
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
      pool.on('error', err => { console.error('[coo-dashboard] erro no pool:', err.message); poolPromise = null; });
      poolPromise = pool.connect().then(p => {
        ultimaFalha = null;
        console.log(`[coo-dashboard] conectado a ${DB.server}/${DB.database}`);
        return p;
      }).catch(err => {
        poolPromise = null;
        ultimaFalha = { erro: err, em: Date.now() };
        console.error('[coo-dashboard] falha ao conectar:', err.message);
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

  // Express não diferencia maiúsculas: cobre /COO-Dashboard/api e /coo-dashboard/api.
  app.get(BASE + '/api/health', semCache, async (req, res) => {
    try {
      await runQuery('SELECT 1 AS ok');
      res.json({ status: 'healthy', database: DB.database, server: DB.server });
    } catch (err) {
      res.status(503).json({ status: 'unhealthy', database: DB.database, error: err.message });
    }
  });
  app.use(BASE + '/api', semCache, criarCooRouter({ runQuery, idDash: env.COO_ID_DASH, sites: env.COO_SITES }));

  // Da pasta, só a página é pública. Ela é servida daqui (sendFile), então o
  // Portal não precisa de express.static para esta pasta — e server.js,
  // portal.js, coo-api.js, acesso.js, app.yaml, package*.json, .env*, docs e
  // tests nunca saem do servidor.
  const PAGINA = path.join(__dirname, 'index.html');
  app.get([BASE, BASE + '/', BASE + '/index.html'], (req, res) => {
    if (req.path === BASE) return res.redirect(301, BASE + '/'); // caminhos relativos (api/) resolvem na pasta
    res.set('Cache-Control', 'no-store').sendFile(PAGINA);
  });
  app.use(BASE, (req, res) => res.status(404).set('Cache-Control', 'no-store').json({ error: 'Não encontrado.' }));

  console.log(`[coo-dashboard] rotas em ${BASE}/api — banco ${DB.server}/${DB.database}`);
  return { runQuery };
};
