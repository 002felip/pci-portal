/**
 * Quartely — app independente (Databricks App próprio).
 *
 * Conexão DIRETA ao Azure SQL de PRODUÇÃO (BDIBPBMSA_PRD), com pool
 * próprio — não depende do servidor do VBM Kaizen. A SQL vem de
 * quartely-api.js, a mesma usada pelo VBM, para as duas publicações
 * nunca divergirem.
 *
 * Variáveis de ambiente (ver app.yaml / .env.example):
 *   AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_PORT
 *   AZURE_SQL_USER, AZURE_SQL_PASSWORD   ← secrets, nunca em texto puro
 */
const path = require('path');
const express = require('express');
const compression = require('compression');
const sql = require('mssql');
const { criarQuartelyRouter } = require('./quartely-api');

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
// Sem banco configurado o servidor SOBE mesmo assim: a página abre e
// mostra o aviso de dados de exemplo, em vez de derrubar o app inteiro.
let poolPromise = null;
// Falha recente de conexão é reaproveitada por 30 s: sem isso cada caminho
// de API que a página tenta esperaria o timeout de novo (~2 min no total).
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

// params: { nome: [tipoMssql, valor] } → request.input (ver quartely-api.js)
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

// Só a página e os assets são públicos — server.js, app.yaml, .env e
// package.json nunca são servidos (não há express.static na pasta raiz).
const PAGINA = path.join(__dirname, 'quartely.html');
const enviarPagina = (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(PAGINA); };
for (const rota of ['/', '/index.html', '/quartely.html', '/Quartely', '/Quartely/', '/Quartely/quartely.html']) {
  app.get(rota, enviarPagina);
}
const assets = express.static(path.join(__dirname, 'assets'), { index: false, maxAge: '1d' });
app.use('/assets', assets);
app.use('/Quartely/assets', assets);

// Health check com o banco: 200 conectado, 503 com o motivo (sem expor credenciais)
async function health(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    await runQuery('SELECT 1 AS ok');
    res.json({ status: 'healthy', database: DB.database, server: DB.server });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', database: DB.database || null, error: err.message });
  }
}

// O front-end tenta api/, ../api/, /api/ e /Quartely/api/ (ver
// QUARTELY_API_BASES em quartely.html): a MESMA instância do router em
// todos os caminhos compartilha o cache de 5 min.
// Imagens de fundo: mesmo Azure Blob do portal (AZURE_STORAGE_*, módulo do
// Kaizen). Sem ele, o upload responde 503 e o resto do Quartely segue normal.
let armazenamento = null;
try {
  const blob = require('../VBM-Kaizen-App/azure-blob');
  armazenamento = { configurado: blob.blobConfigurado, enviar: blob.enviarArquivoParaBlob, baixar: blob.baixarArquivoDoBlob };
} catch (e) {
  console.warn('[quartely] armazenamento de imagens indisponível:', e.message);
}
const router = criarQuartelyRouter({ runQuery, tabelaConfiguracao: process.env.QUARTELY_CONFIG_TABLE, armazenamento, pastaFundos: process.env.QUARTELY_BG_PASTA });
for (const base of ['/api', '/Quartely/api', '/quartely/api']) {
  app.get(`${base}/health`, health);
  app.use(base, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, router);
}

app.use((req, res) => res.status(404).json({ error: 'Não encontrado' }));
app.use((err, req, res, next) => {
  console.error('[erro]', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ── Start / shutdown ────────────────────────────────────────────────
const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[quartely] ouvindo na porta ${PORT} — banco: ${DB.server || '(não configurado)'}/${DB.database || '(não configurado)'}`);
  const faltando = configAusente();
  if (faltando.length) console.warn(`[quartely] ATENÇÃO: sem conexão com o banco — faltam ${faltando.join(', ')}`);
  if (DB.database && !/_PRD$/i.test(DB.database)) console.warn(`[quartely] ATENÇÃO: AZURE_SQL_DATABASE="${DB.database}" não é a base de produção (*_PRD)`);
});

async function encerrar(sinal) {
  console.log(`[quartely] ${sinal} recebido, encerrando`);
  server.close(async () => {
    try { if (poolPromise) await (await poolPromise).close(); } catch (e) { /* pool já fechado */ }
    process.exit(0);
  });
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
