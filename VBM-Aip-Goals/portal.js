/**
 * AIP Goals montado em /VBM-Aip-Goals/ (página: index.html), aplicação da RAIZ
 * do Portal, ao lado do VBM-Stable-and-Capable. Mesmo molde do portal.js das
 * outras aplicações: o endereço sai do NOME DA PASTA. Quem chama é o server.js
 * do Portal:
 *     require("./VBM-Aip-Goals/portal")(portal);
 * ANTES do express.static da pasta, e DEPOIS do controle de acesso do Portal
 * (IBP.USERS com CD_MATRICULA), registrado lá para /VBM-Aip-Goals.
 *
 * VARIÁVEIS (prefixo AIPGOALS_; segredos só por valueFrom no app.yaml da raiz):
 *   AIPGOALS_AZURE_SQL_DATABASE  base da aplicação (BDIBPBMSA_DEV / BDIBPBMSA_PRD).
 *                                Sem ela, cai no AZURE_SQL_DATABASE do Portal.
 *   AIPGOALS_FONTE               'exemplo' (padrão até a validação do modelo de
 *                                dados, P-12) ou 'banco'.
 * Servidor/porta/login: AZURE_SQL_SERVER / AZURE_SQL_PORT / AZURE_SQL_USER /
 * AZURE_SQL_PASSWORD (os do Portal).
 */
const path = require('path');
const sql = require('mssql');
const { criarAipGoalsRouter } = require('./aip-goals-api');

// Prefixo da aplicação no portal: /<nome desta pasta>.
const PASTA = path.basename(__dirname);
const BASE = '/' + PASTA;
const TAG = '[' + PASTA.toLowerCase() + ']';
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = function montarAipGoalsNoPortal(app) {
  const env = process.env;
  const DB = {
    server: env.AZURE_SQL_SERVER || '',
    database: env.AIPGOALS_AZURE_SQL_DATABASE || env.AZURE_SQL_DATABASE || '',
    user: env.AZURE_SQL_USER || '',
    password: env.AZURE_SQL_PASSWORD || '',
    port: parseInt(env.AZURE_SQL_PORT || '1433', 10),
  };
  const FONTE = env.AIPGOALS_FONTE === 'banco' ? 'banco' : 'exemplo';

  let poolPromise = null;
  let ultimaFalha = null; // falha recente reaproveitada por 30 s (evita esperar o timeout a cada rota)

  function getPool() {
    if (!poolPromise && ultimaFalha && Date.now() - ultimaFalha.em < 30000) return Promise.reject(ultimaFalha.erro);
    if (!poolPromise) {
      const faltando = ['server', 'database', 'user', 'password'].filter((k) => !DB[k]);
      if (faltando.length) return Promise.reject(new Error(`AIP Goals: configuração do banco ausente (${faltando.join(', ')})`));
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
      pool.on('error', (err) => { console.error(TAG + ' erro no pool:', err.message); poolPromise = null; });
      poolPromise = pool.connect().then((p) => {
        ultimaFalha = null;
        console.log(`${TAG} conectado a ${DB.server}/${DB.database}`);
        return p;
      }).catch((err) => {
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

  // Health devolve só { status }; o motivo da falha fica no log.
  app.get(BASE + '/api/health', semCache, async (req, res) => {
    if (FONTE === 'exemplo') return res.json({ status: 'healthy' });
    try {
      await runQuery('SELECT 1 AS ok');
      res.json({ status: 'healthy' });
    } catch (err) {
      console.error(TAG + ' health:', err.message);
      res.status(503).json({ status: 'unhealthy' });
    }
  });

  app.use(BASE + '/api', semCache, criarAipGoalsRouter({ runQuery, fonte: FONTE }));

  // Da pasta só a página (/, index.html) e os assets são públicos:
  // portal.js, aip-goals-api.js, dados-exemplo.js, server.js, tests/, database/,
  // package*.json, .env* ficam bloqueados (o express.static do Portal serve a pasta).
  const PUBLICO = new RegExp('^' + escaparRegex(BASE) + '\\/?(index\\.html|assets\\/.+)?$', 'i');
  app.use(BASE, (req, res, next) => {
    const caminho = req.originalUrl.split('?')[0];
    if (PUBLICO.test(caminho) && !/\.\.|%2e|%5c|\\/i.test(caminho)) return next();
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Não encontrado.' });
  });

  console.log(`${TAG} rotas em ${BASE}/api — fonte ${FONTE}${FONTE === 'banco' ? ` (${DB.server || '?'}/${DB.database || '?'})` : ''}`);
  return { runQuery };
};
