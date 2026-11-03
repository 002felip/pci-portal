/**
 * VBM Health of the Business — app independente (desenvolvimento ou Databricks App próprio).
 * Em produção a página roda DENTRO do Portal (portal.js); este arquivo segue o server.js
 * do COO-Business-Units-Dashboard.
 *
 * Conexão DIRETA ao Azure SQL, com pool próprio. A SQL vem de hob-api.js (scripts de
 * database/), a mesma usada no Portal. Acesso: a mesma regra do Portal (portal-acesso.js
 * da raiz — IBP.USERS com CD_MATRICULA, identidade pelo X-Forwarded-Email do proxy).
 *
 * Variáveis de ambiente:
 *   AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_PORT
 *   AZURE_SQL_USER, AZURE_SQL_PASSWORD   ← secrets (valueFrom), nunca em texto puro
 *   HOB_ACESSO_LOCAL_EMAIL               ← só com NODE_ENV=development e fora do
 *                                          Databricks: simula o X-Forwarded-Email
 *   HOB_CACHE_TTL_S                      ← ver hob-api.js
 */
const path = require('path');
const express = require('express');
const compression = require('compression');
const sql = require('mssql');
const { criarHobRouter } = require('./hob-api');
const criarControleDeAcesso = require(path.join(__dirname, '..', '..', 'portal-acesso'));

const PASTA = path.basename(__dirname);
const DB = {
  server: process.env.AZURE_SQL_SERVER || '',
  database: process.env.AZURE_SQL_DATABASE || '',
  user: process.env.AZURE_SQL_USER || '',
  password: process.env.AZURE_SQL_PASSWORD || '',
  port: parseInt(process.env.AZURE_SQL_PORT || '1433', 10),
};
function configAusente() {
  return ['server', 'database', 'user', 'password']
    .filter(k => !DB[k])
    .map(k => ({ server: 'AZURE_SQL_SERVER', database: 'AZURE_SQL_DATABASE', user: 'AZURE_SQL_USER', password: 'AZURE_SQL_PASSWORD' })[k]);
}

// ── Pool (criado na 1ª consulta; recriado se cair). Sem banco o servidor sobe e a página usa a demonstração ──
let poolPromise = null, ultimaFalha = null;
function getPool() {
  if (!poolPromise && ultimaFalha && Date.now() - ultimaFalha.em < 30000) return Promise.reject(ultimaFalha.erro);
  if (!poolPromise) {
    const faltando = configAusente();
    if (faltando.length) return Promise.reject(new Error(`Variáveis de ambiente ausentes: ${faltando.join(', ')}`));
    const pool = new sql.ConnectionPool({
      server: DB.server, database: DB.database, user: DB.user, password: DB.password, port: DB.port,
      options: { encrypt: true, trustServerCertificate: false },
      connectionTimeout: 30000, requestTimeout: 60000,
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    });
    pool.on('error', err => { console.error('[sql] erro no pool:', err.message); poolPromise = null; });
    poolPromise = pool.connect().then(p => { ultimaFalha = null; console.log(`[sql] conectado a ${DB.server}/${DB.database}`); return p; })
      .catch(err => { poolPromise = null; ultimaFalha = { erro: err, em: Date.now() }; console.error('[sql] falha ao conectar:', err.message); throw err; });
  }
  return poolPromise;
}
async function runQuery(query, params) {
  const t = Date.now();
  const request = (await getPool()).request();
  Object.entries(params || {}).forEach(([nome, [tipo, valor]]) => request.input(nome, tipo, valor));
  const result = await request.query(query);
  console.log(`[sql] ${Date.now() - t}ms linhas=${(result.recordset || []).length}`);
  return result;
}

// ── App ──
const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

const BASES_API = ['/api', `/${PASTA}/api`];
async function health(req, res) {
  res.set('Cache-Control', 'no-store');
  try { await runQuery('SELECT 1 AS ok'); res.json({ status: 'healthy' }); }
  catch (err) { console.error('[sql] health:', err.message); res.status(503).json({ status: 'unhealthy' }); }
}
for (const base of BASES_API) app.get(`${base}/health`, health);

// Controle de acesso: o mesmo módulo e a mesma regra do Portal
const LOCAL = process.env.NODE_ENV === 'development' && !process.env.DATABRICKS_APP_PORT && process.env.HOB_ACESSO_LOCAL_EMAIL;
if (!LOCAL && process.env.HOB_ACESSO_LOCAL_EMAIL) console.warn('[health-of-the-business] HOB_ACESSO_LOCAL_EMAIL ignorado: só vale com NODE_ENV=development e fora do Databricks');
if (LOCAL) {
  console.warn(`[health-of-the-business] ATENÇÃO: X-Forwarded-Email simulado (${LOCAL}) — use só em desenvolvimento`);
  app.use((req, res, next) => { req.headers['x-forwarded-email'] = LOCAL; next(); });
}
app.use(criarControleDeAcesso({ conexoes: [{ nome: 'PRD', runQuery }] }).exigir);

// Só a página e os assets são públicos (não há express.static na pasta raiz)
const PAGINA = path.join(__dirname, 'index.html');
const enviarPagina = (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(PAGINA); };
for (const rota of ['/', '/index.html', `/${PASTA}/`, `/${PASTA}/index.html`]) app.get(rota, enviarPagina);
app.get(`/${PASTA}`, (req, res) => res.redirect(`/${PASTA}/`));
const assets = express.static(path.join(__dirname, 'assets'), { index: false, maxAge: '1d' });
app.use('/assets', assets);
app.use(`/${PASTA}/assets`, assets);

const router = criarHobRouter({ runQuery });
for (const base of BASES_API) app.use(base, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, router);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { console.error('[erro]', err); res.status(500).json({ error: 'Internal server error' }); });

const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[health-of-the-business] ouvindo na porta ${PORT} — banco: ${DB.server || '(não configurado)'}/${DB.database || '(não configurado)'}`);
  const faltando = configAusente();
  if (faltando.length) console.warn(`[health-of-the-business] ATENÇÃO: sem conexão com o banco — faltam ${faltando.join(', ')}`);
});
function encerrar(sinal) {
  console.log(`[health-of-the-business] ${sinal} recebido, encerrando`);
  server.close(async () => {
    try { if (poolPromise) await (await poolPromise).close(); } catch (e) { /* pool já fechado */ }
    process.exit(0);
  });
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
