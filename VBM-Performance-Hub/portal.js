/**
 * VBM-Performance-Hub — agrupa as aplicações de indicadores do Portal.
 *
 *   /VBM-Performance-Hub/                                   página do Hub (index.html)
 *   /VBM-Performance-Hub/VBM-Performance-Studio/            Performance Studio
 *   /VBM-Performance-Hub/COO-Business-Units-Dashboard/      COO Business Units Dashboard
 *   /VBM-Performance-Hub/COO-Business-Units-Dashboard-Historical/
 *   /VBM-Performance-Hub/VBM-Health-of-the-Business/
 *
 * Cada subpasta tem a MESMA estrutura (index.html, portal.js,
 * performancehub-api.js, server.js, database/, assets/) e o seu portal.js
 * deduz o endereço do próprio nome da pasta. Nova aplicação no Hub =
 * copiar uma subpasta com outro nome + acrescentar o nome em APLICACOES.
 *
 * O server.js do Portal só faz require("./VBM-Performance-Hub/portal")(portal),
 * ANTES do express.static da pasta.
 */
const path = require('path');

const APLICACOES = [
  'VBM-Performance-Studio',          // a primeira também empresta a conexão PRD ao controle de acesso
  'COO-Business-Units-Dashboard',
  'COO-Business-Units-Dashboard-Historical',
  'VBM-Health-of-the-Business',
];
const BASE = '/' + path.basename(__dirname);

module.exports = function montarPerformanceHub(app) {
  let principal = {};
  for (const pasta of APLICACOES) {
    try {
      const montada = require(path.join(__dirname, pasta, 'portal'))(app) || {};
      if (pasta === APLICACOES[0]) principal = montada;
    } catch (err) {
      // Uma aplicação quebrada não derruba o Hub nem as outras.
      console.error(`[performance-hub] falha ao montar ${pasta}:`, err.message);
    }
  }

  // Da raiz do Hub, só a página e os assets são públicos; o resto das
  // subpastas já passou pelo filtro da própria aplicação (registrado acima).
  const subpastas = APLICACOES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const PUBLICO = new RegExp('^' + BASE + '\\/?(index\\.html|assets\\/.+)?$', 'i');
  const DA_APLICACAO = new RegExp('^' + BASE + '\\/(' + subpastas + ')(\\/|$)', 'i');
  app.use(BASE, (req, res, next) => {
    const caminho = req.originalUrl.split('?')[0];
    if (/\.\.|%2e|%5c|\\/i.test(caminho)) return res.status(404).json({ error: 'Não encontrado.' });
    if (PUBLICO.test(caminho) || DA_APLICACAO.test(caminho)) return next();
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Não encontrado.' });
  });

  console.log(`[performance-hub] aplicações: ${APLICACOES.map((p) => BASE + '/' + p + '/').join(', ')}`);
  // Conexão PRD reaproveitada pelo controle de acesso do Portal (portal-acesso.js).
  return principal;
};
