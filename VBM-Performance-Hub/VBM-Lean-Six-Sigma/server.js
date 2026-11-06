/**
 * VBM Lean Six Sigma — app standalone, só para DESENVOLVIMENTO (em produção a página roda dentro
 * do Portal, por portal.js). Sem banco e sem o controle de acesso do Portal: não publicar assim.
 *
 *   node server.js            → http://localhost:8000/
 *   LSS_PASTA_DADOS=/outra/pasta node server.js
 */
const path = require('path');
const express = require('express');
const compression = require('compression');
const { criarLssRouter } = require('./lss-api');

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, criarLssRouter().router);
app.use('/assets', express.static(path.join(__dirname, 'assets')));
// Poppins do Hub (a página usa ../assets/css/poppins.css)
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000;
app.listen(PORT, () => console.log(`[vbm-lean-six-sigma] standalone em http://localhost:${PORT}/`));
