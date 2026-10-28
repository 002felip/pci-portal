/**
 * COO Business Units Dashboard Historical — app independente (desenvolvimento ou
 * Databricks App próprio). Em produção a página roda DENTRO do Portal
 * (portal.js); este arquivo segue o server.js do COO-Business-Units-Dashboard.
 *
 * Conexão DIRETA ao Azure SQL de PRODUÇÃO (BDIBPBMSA_PRD), com pool próprio.
 * A SQL vem de coo-api.js (scripts de database/), a mesma usada no Portal.
 * Acesso: a mesma regra do Portal (portal-acesso.js da raiz — IBP.USERS com
 * CD_MATRICULA, identidade pelo X-Forwarded-Email do proxy do Databricks Apps).
 *
 * Variáveis de ambiente:
 *   AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_PORT
 *   AZURE_SQL_USER, AZURE_SQL_PASSWORD   ← secrets (valueFrom), nunca em texto puro
 *   COO_ID_DASH                          ← opcional (padrão 15)
 *   COO_ACESSO_LOCAL_EMAIL               ← só com NODE_ENV=development e fora do
 *                                          Databricks: simula o X-Forwarded-Email
 *   COO_CACHE_TTL_S / COO_FRESCO_S / COO_DESATUALIZADO_MAX_S ← ver coo-api.js
 */
const path = require('path');
const express = require('express');
const compression = require('compression');
const sql = require('mssql');
const { criarCooRouter } = require('./coo-api');
const criarControleDeAcesso = require(path.join(__dirname, '..', '..', 'portal-acesso'));

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

// ── Pool (criado na 1ª consulta; recriado se cair) ──────────────────
// Sem banco configurado o servidor SOBE mesmo assim: a página abre e mostra
// que não há conexão, em vez de derrubar o app inteiro.
let poolPromise = null;
// Falha recente de conexão é reaproveitada por 30 s (evita esperar o timeout a cada rota)
let ultimaFalha = null;
const JANELA_FALHA_MS = 30000;

function getPool() {
  if (!poolPromise && ultimaFalha && Date.now() - ultimaFalha.em < JANELA_FALHA_MS) {
    return Promise.reject(ultimaFalha.erro);
  }
  if (!poolPromise) {
    const faltando = configAusente();
    if (faltando.length) return Promise.reject(new Error(`Variáveis de ambiente ausentes: ${faltando.join(', ')}`));
    const pool = new sql.ConnectionPool({
      server: DB.server,
      database: DB.database,
      user: DB.user,
      password: DB.password,
      port: DB.port,
      options: { encrypt: true, trustServerCertificate: false },
      connectionTimeout: 30000,
      requestTimeout: 60000,
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    });
    pool.on('error', err => { console.error('[sql] erro no pool:', err.message); poolPromise = null; });
    poolPromise = pool.connect().then(p => {
      ultimaFalha = null;
      console.log(`[sql] conectado a ${DB.server}/${DB.database}`);
      return p;
    }).catch(err => {
      poolPromise = null;
      ultimaFalha = { erro: err, em: Date.now() };
      console.error('[sql] falha ao conectar:', err.message);
      throw err;
    });
  }
  return poolPromise;
}

// params: { nome: [tipoMssql, valor] } → request.input (ver coo-api.js)
async function runQuery(query, params) {
  const t = Date.now();
  const pool = await getPool();
  const request = pool.request();
  Object.entries(params || {}).forEach(([nome, [tipo, valor]]) => request.input(nome, tipo, valor));
  const result = await request.query(query);
  console.log(`[sql] ${Date.now() - t}ms linhas=${(result.recordset || []).length}`);
  return result;
}

// ── App ─────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

// Health check com o banco: fora do controle de acesso (diagnóstico do deploy),
// sem expor credenciais nem o texto do erro (o motivo vai para o log)
async function health(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    await runQuery('SELECT 1 AS ok');
    res.json({ status: 'healthy' }); // fora do controle de acesso: sem servidor nem base na resposta
  } catch (err) {
    console.error('[sql] health:', err.message);
    res.status(503).json({ status: 'unhealthy' });
  }
}
const BASES_API = ['/api', '/COO-Business-Units-Dashboard-Historical/api'];
for (const base of BASES_API) app.get(`${base}/health`, health);

// Controle de acesso: o mesmo módulo e a mesma regra do Portal
// Só em desenvolvimento explícito (NODE_ENV=development) e fora do Databricks: publicado em outro
// lugar com a variável esquecida, todo visitante entraria com esse e-mail
const LOCAL = process.env.NODE_ENV === 'development' && !process.env.DATABRICKS_APP_PORT && process.env.COO_ACESSO_LOCAL_EMAIL;
if (!LOCAL && process.env.COO_ACESSO_LOCAL_EMAIL) console.warn('[coo-historical] COO_ACESSO_LOCAL_EMAIL ignorado: só vale com NODE_ENV=development e fora do Databricks');
if (LOCAL) {
  console.warn(`[coo-historical] ATENÇÃO: X-Forwarded-Email simulado (${LOCAL}) — use só em desenvolvimento`);
  app.use((req, res, next) => { req.headers['x-forwarded-email'] = LOCAL; next(); });
}
const acesso = criarControleDeAcesso({ conexoes: [{ nome: 'PRD', runQuery }] });
app.use(acesso.exigir);

// Só a página e os assets são públicos — server.js, coo-api.js, database/,
// .env e package.json nunca são servidos (não há express.static na pasta raiz).
const PAGINA = path.join(__dirname, 'index.html');
const enviarPagina = (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(PAGINA); };
for (const rota of ['/', '/index.html', '/COO-Business-Units-Dashboard-Historical', '/COO-Business-Units-Dashboard-Historical/', '/COO-Business-Units-Dashboard-Historical/index.html']) {
  app.get(rota, enviarPagina);
}
const assets = express.static(path.join(__dirname, 'assets'), { index: false, maxAge: '1d' });
app.use('/assets', assets);
app.use('/COO-Business-Units-Dashboard-Historical/assets', assets);

// A MESMA instância do router em todos os caminhos compartilha o cache de 5 min
const router = criarCooRouter({ runQuery, idDash: process.env.COO_ID_DASH });
for (const base of BASES_API) {
  app.use(base, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, router);
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('[erro]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start / shutdown ────────────────────────────────────────────────
const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[coo-historical] ouvindo na porta ${PORT} — banco: ${DB.server || '(não configurado)'}/${DB.database || '(não configurado)'}`);
  const faltando = configAusente();
  if (faltando.length) console.warn(`[coo-historical] ATENÇÃO: sem conexão com o banco — faltam ${faltando.join(', ')}`);
  if (DB.database && !/_PRD$/i.test(DB.database)) console.warn(`[coo-historical] ATENÇÃO: AZURE_SQL_DATABASE="${DB.database}" não é a base de produção (*_PRD)`);
});

async function encerrar(sinal) {
  console.log(`[coo-historical] ${sinal} recebido, encerrando`);
  server.close(async () => {
    try { if (poolPromise) await (await poolPromise).close(); } catch (e) { /* pool já fechado */ }
    process.exit(0);
  });
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
