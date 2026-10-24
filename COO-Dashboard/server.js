/**
 * COO Dashboard — modo STANDALONE (Databricks App próprio ou desenvolvimento).
 *
 * Conexão DIRETA ao Azure SQL de PRODUÇÃO (BDIBPBMSA_PRD), com pool próprio.
 * A SQL vem de coo-api.js — a mesma usada dentro do Portal (portal.js) — para
 * as duas publicações nunca divergirem.
 *
 * Variáveis de ambiente (ver app.yaml / .env.example):
 *   AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_PORT
 *   AZURE_SQL_USER, AZURE_SQL_PASSWORD   ← secrets (valueFrom), nunca em texto puro
 *   COO_ID_DASH                          ← IBP.DASHBOARD.ID_DASH (padrão 15, o dos scripts em database/)
 *   COO_SITES                            ← unidades liberadas (padrão "Sossego,Salobo")
 *   COO_ACESSO, COO_ACESSO_LOCAL_EMAIL, COO_USERS_EMAIL_COLUMN (ver acesso.js)
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const sql = require('mssql');
const { criarCooRouter } = require('./coo-api');
const criarControleDeAcesso = require('./acesso');

const DB = {
  server: process.env.AZURE_SQL_SERVER || '',
  database: process.env.AZURE_SQL_DATABASE || '',
  user: process.env.AZURE_SQL_USER || '',
  password: process.env.AZURE_SQL_PASSWORD || '',
  port: parseInt(process.env.AZURE_SQL_PORT || '1433', 10),
};

// Mesma ideia do checkConfig() do Kaizen: diz exatamente o que falta, sem
// expor valores. Sem banco configurado o servidor SOBE mesmo assim — a página
// abre com os dados de exemplo em vez de derrubar o app inteiro.
function configAusente() {
  return [['AZURE_SQL_SERVER', DB.server], ['AZURE_SQL_DATABASE', DB.database], ['AZURE_SQL_USER', DB.user], ['AZURE_SQL_PASSWORD', DB.password]]
    .filter(([, v]) => !v).map(([nome]) => nome);
}

// ── Pool (criado na 1ª consulta; recriado se cair) ──────────────────
let poolPromise = null;
// Falha recente de conexão reaproveitada por 30 s: sem isso cada rota
// esperaria o timeout de novo.
let ultimaFalha = null;
const JANELA_FALHA_MS = 30000;

function getPool() {
  if (!poolPromise && ultimaFalha && Date.now() - ultimaFalha.em < JANELA_FALHA_MS) return Promise.reject(ultimaFalha.erro);
  if (!poolPromise) {
    const faltando = configAusente();
    if (faltando.length) return Promise.reject(new Error(`Variáveis de ambiente ausentes: ${faltando.join(', ')} (usuário/senha vêm dos App resources via valueFrom no app.yaml)`));
    const pool = new sql.ConnectionPool({
      server: DB.server,
      database: DB.database,
      user: DB.user,
      password: DB.password,
      port: DB.port,
      options: { encrypt: true, trustServerCertificate: false }, // obrigatório no Azure SQL
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
      poolPromise = null; // não cacheia promise quebrada
      ultimaFalha = { erro: err, em: Date.now() };
      console.error('[sql] falha ao conectar:', err.message);
      throw err;
    });
  }
  return poolPromise;
}

// params: { nome: [tipoMssql, valor] } → request.input (nunca concatenado na SQL)
async function runQuery(query, params) {
  const t = Date.now();
  const request = (await getPool()).request();
  Object.entries(params || {}).forEach(([nome, [tipo, valor]]) => request.input(nome, tipo, valor));
  try {
    const result = await request.query(query);
    console.log(`[sql] ${Date.now() - t}ms linhas=${(result.recordset || []).length}`);
    return result;
  } catch (err) {
    // O texto da consulta vai só para o LOG (diagnóstico), nunca para a resposta HTTP
    console.error(`[sql] falhou em ${Date.now() - t}ms: ${err.message}\n${query.trim().slice(0, 400)}`);
    throw err;
  }
}

// ── App ─────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
// Cabeçalhos de segurança (mesmas exceções do Kaizen): CSP desligado porque a
// página tem <script>/<style> inline sem nonce; COEP/COOP desligados para não
// interferir no carregamento das fontes e da janela de tela cheia.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginOpenerPolicy: false }));
app.use(compression());

const acesso = criarControleDeAcesso({ runQuery });

// Health check e ping ficam ANTES do controle de acesso: são usados pelo
// Databricks Apps e por quem publica, e não expõem dados nem credenciais.
async function health(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    await runQuery('SELECT 1 AS ok');
    res.json({ status: 'healthy', database: DB.database, server: DB.server });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', database: DB.database || null, error: err.message });
  }
}
const ping = (req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, caminhoRecebido: req.originalUrl });

// O front-end tenta api/, ../api/, /COO-Dashboard/api/ e /api/ (ver API_BASES
// no index.html): a MESMA instância do router em todos os caminhos
// compartilha o cache de 5 min.
const router = criarCooRouter({ runQuery, idDash: process.env.COO_ID_DASH, sites: process.env.COO_SITES });
for (const base of ['/api', '/COO-Dashboard/api']) {
  app.get(`${base}/health`, health);
  app.get(`${base}/ping`, ping);
  app.use(base, acesso.exigir, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, router);
}

// Só a página é pública (depois do controle de acesso) — server.js, app.yaml,
// .env, package.json e docs nunca são servidos (não há express.static na pasta).
const PAGINA = path.join(__dirname, 'index.html');
const enviarPagina = (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(PAGINA); };
for (const rota of ['/', '/index.html', '/COO-Dashboard', '/COO-Dashboard/', '/COO-Dashboard/index.html']) {
  app.get(rota, acesso.exigir, enviarPagina);
}

app.use((req, res) => res.status(404).json({ error: 'Não encontrado' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[erro]', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ── Start / shutdown ────────────────────────────────────────────────
const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[coo-dashboard] ouvindo na porta ${PORT} — banco: ${DB.server || '(não configurado)'}/${DB.database || '(não configurado)'}`);
  const faltando = configAusente();
  if (faltando.length) console.warn(`[coo-dashboard] ATENÇÃO: sem conexão com o banco — faltam ${faltando.join(', ')}`);
  if (DB.database && !/_PRD$/i.test(DB.database)) console.warn(`[coo-dashboard] ATENÇÃO: AZURE_SQL_DATABASE="${DB.database}" não é a base de produção (*_PRD)`);
  if (!process.env.COO_ID_DASH) console.log('[coo-dashboard] COO_ID_DASH não definido — usando 15 (scripts em database/)');
});

async function encerrar(sinal) {
  console.log(`[coo-dashboard] ${sinal} recebido, encerrando`);
  server.close(async () => {
    try { if (poolPromise) await (await poolPromise).close(); } catch (e) { /* pool já fechado */ }
    process.exit(0);
  });
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));

module.exports = { app, server }; // usado pelos testes
