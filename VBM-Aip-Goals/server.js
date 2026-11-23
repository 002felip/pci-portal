/**
 * AIP Goals — app independente, para desenvolvimento/testes.
 * Em produção a página roda DENTRO do Portal (portal.js). Este arquivo serve a
 * mesma página e a mesma API (aip-goals-api.js) sozinho.
 *
 *   NODE_ENV=development AIPGOALS_EMAIL_LOCAL=voce@vale.com node server.js
 *   AIPGOALS_PERFIL_LOCAL=leitor|contribuidor|aprovador|admin simula um perfil (só em desenvolvimento)
 *   → http://localhost:8020/
 *
 * Identidade: no Portal vem SOMENTE do X-Forwarded-Email do proxy. Aqui,
 * AIPGOALS_EMAIL_LOCAL simula esse cabeçalho, e só com NODE_ENV=development
 * fora do Databricks (sem DATABRICKS_APP_PORT).
 * Fonte dos dados: AIPGOALS_FONTE ('exemplo' por padrão; ver portal.js).
 */
const path = require('path');
const express = require('express');
const { criarAipGoalsRouter } = require('./aip-goals-api');

const env = process.env;
const PORT = parseInt(env.PORT || '8020', 10);
const PODE_SIMULAR = env.NODE_ENV === 'development' && !env.DATABRICKS_APP_PORT;

const app = express();
app.disable('x-powered-by');
if (env.AIPGOALS_EMAIL_LOCAL) {
  if (PODE_SIMULAR) app.use((req, res, next) => { req.headers['x-forwarded-email'] = env.AIPGOALS_EMAIL_LOCAL; next(); });
  else console.warn('[aip-goals] AIPGOALS_EMAIL_LOCAL ignorada: a simulação exige NODE_ENV=development fora do Databricks.');
}
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
  criarAipGoalsRouter({ fonte: env.AIPGOALS_FONTE === 'banco' ? 'banco' : 'exemplo' }));
app.get(['/', '/index.html'], (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, 'index.html')); });
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.listen(PORT, () => console.log(`[aip-goals] http://localhost:${PORT}/`));
