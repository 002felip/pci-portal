/**
 * AIP Goals — app independente, para desenvolvimento/testes.
 * Em produção a página roda DENTRO do Portal (portal.js). Este arquivo monta o
 * MESMO portal.js (mesma API, mesmo banco) num Express próprio.
 *
 *   NODE_ENV=development AIPGOALS_EMAIL_LOCAL=voce@vale.com \
 *   AZURE_SQL_SERVER=... AZURE_SQL_USER=... AZURE_SQL_PASSWORD=... \
 *   AIPGOALS_AZURE_SQL_DATABASE=BDIBPBMSA_DEV node server.js
 *   → http://localhost:8020/VBM-Aip-Goals/
 *
 * Identidade: no Portal vem SOMENTE do X-Forwarded-Email do proxy. Aqui,
 * AIPGOALS_EMAIL_LOCAL simula esse cabeçalho, e só com NODE_ENV=development
 * fora do Databricks (sem DATABRICKS_APP_PORT). O e-mail precisa estar na
 * IBP.USERS (com matrícula) do mesmo banco.
 */
const path = require('path');
const express = require('express');

const env = process.env;
const PORT = parseInt(env.PORT || '8020', 10);
const PODE_SIMULAR = env.NODE_ENV === 'development' && !env.DATABRICKS_APP_PORT;

const app = express();
app.disable('x-powered-by');
if (env.AIPGOALS_EMAIL_LOCAL) {
  if (PODE_SIMULAR) app.use((req, res, next) => { req.headers['x-forwarded-email'] = env.AIPGOALS_EMAIL_LOCAL; next(); });
  else console.warn('[aip-goals] AIPGOALS_EMAIL_LOCAL ignorada: a simulação exige NODE_ENV=development fora do Databricks.');
}
require('./portal')(app);
app.get('/', (req, res) => res.redirect('/VBM-Aip-Goals/'));
app.use('/VBM-Aip-Goals', express.static(__dirname, { index: 'index.html', dotfiles: 'ignore' }));
app.listen(PORT, () => console.log(`[aip-goals] http://localhost:${PORT}/VBM-Aip-Goals/`));
