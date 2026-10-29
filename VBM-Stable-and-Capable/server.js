/**
 * VBM Stable & Capable — app independente, para desenvolvimento/testes.
 * Em produção a página roda DENTRO do Portal (portal.js). Este arquivo
 * serve a mesma página e a mesma API (stable-capable-api.js) sozinho.
 *
 *   node server.js                     → http://localhost:8010/
 *
 * Banco (mesmas variáveis do Portal):
 *   AZURE_SQL_SERVER, KAIZEN_AZURE_SQL_DATABASE (ou AZURE_SQL_DATABASE),
 *   AZURE_SQL_PORT, AZURE_SQL_USER, AZURE_SQL_PASSWORD
 *
 * SEM BANCO (teste da tela e do gerador):
 *   STABLECAPABLE_EXCEL_TESTE=/caminho/Stable.xlsx node server.js
 *   → a "consulta" lê esse Excel (aba base) e filtra DT_REF pelo período.
 *
 * Arquivos: Azure Blob se AZURE_STORAGE_* estiverem definidas; senão,
 * pasta local (STABLECAPABLE_PASTA_LOCAL ou o temp do sistema).
 * Identidade: STABLECAPABLE_EMAIL_LOCAL simula o X-Forwarded-Email.
 */
const path = require('path');
const express = require('express');
const sql = require('mssql');
const { criarStableCapableRouter } = require('./stable-capable-api');

const PORT = parseInt(process.env.PORT || process.env.DATABRICKS_APP_PORT || '8010', 10);
const env = process.env;

async function runQueryTeste(arquivo) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);
  const ws = wb.getWorksheet('base') || wb.worksheets[0];
  const cab = ws.getRow(1).values.slice(1).map(String);
  const linhas = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    cab.forEach((c, i) => { let v = row.getCell(i + 1).value; if (v && typeof v === 'object' && 'result' in v) v = v.result; o[c] = v; });
    linhas.push(o);
  });
  console.log(`[teste] ${linhas.length} linhas lidas de ${arquivo}`);
  return async (query, params = {}) => {
    if (/^\s*SELECT 1/i.test(query)) return { recordset: [{ ok: 1 }] };
    const ini = params.dtInicio ? params.dtInicio[1] : new Date(0);
    const fim = params.dtFim ? params.dtFim[1] : new Date(8.64e15);
    const recordset = linhas.filter((l) => { const d = new Date(l.DT_REF); return d >= ini && d <= fim; });
    recordset.columns = Object.fromEntries(cab.map((c) => [c, {}]));
    await new Promise((r) => setTimeout(r, 600)); // parece uma consulta
    return { recordset };
  };
}

function runQueryBanco() {
  const DB = {
    server: env.AZURE_SQL_SERVER, database: env.STABLECAPABLE_AZURE_SQL_DATABASE || env.KAIZEN_AZURE_SQL_DATABASE || env.AZURE_SQL_DATABASE,
    user: env.AZURE_SQL_USER, password: env.AZURE_SQL_PASSWORD, port: parseInt(env.AZURE_SQL_PORT || '1433', 10),
    options: { encrypt: true, trustServerCertificate: false }, connectionTimeout: 30000, requestTimeout: 600000,
  };
  let pool = null;
  const obterPool = () => (pool = pool || new sql.ConnectionPool(DB).connect().catch((e) => { pool = null; throw e; }));
  const runQuery = async (query, params) => {
    const request = (await obterPool()).request();
    Object.entries(params || {}).forEach(([n, [tipo, v]]) => request.input(n, tipo, v));
    return request.query(query);
  };
  return { runQuery, obterPool };
}

(async () => {
  // Modo teste (Excel): sem banco de verdade, a importação mostra a prévia mas não grava.
  const banco = env.STABLECAPABLE_EXCEL_TESTE ? { runQuery: await runQueryTeste(env.STABLECAPABLE_EXCEL_TESTE), obterPool: null } : runQueryBanco();
  const { runQuery, obterPool } = banco;

  let armazenamento = null;
  if (env.AZURE_STORAGE_ACCOUNT) {
    try {
      const blob = require(path.join(__dirname, '..', env.KAIZEN_PASTA || 'VBM-Kaizen-App-DEV', 'azure-blob'));
      armazenamento = { configurado: blob.blobConfigurado, enviar: blob.enviarArquivoParaBlob, baixar: blob.baixarArquivoDoBlob };
    } catch (e) { console.warn('[stable-and-capable] Blob indisponível:', e.message); }
  }

  const app = express();
  app.disable('x-powered-by');
  if (env.STABLECAPABLE_EMAIL_LOCAL) app.use((req, res, next) => { req.headers['x-forwarded-email'] = env.STABLECAPABLE_EMAIL_LOCAL; next(); });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
    criarStableCapableRouter({ runQuery, obterPool, armazenamento, pastaBlob: env.STABLECAPABLE_BLOB_PASTA }));
  app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  app.use('/assets', express.static(path.join(__dirname, 'assets')));
  app.listen(PORT, () => console.log(`[stable-and-capable] http://localhost:${PORT}/ ${env.STABLECAPABLE_EXCEL_TESTE ? '(modo teste: Excel)' : ''}`));
})();
