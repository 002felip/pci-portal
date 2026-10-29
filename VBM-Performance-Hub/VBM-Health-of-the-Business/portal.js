/**
 * Aplicação do Performance Hub montada em /VBM-Performance-Hub/<pasta>/
 * (página: index.html). Mesmo molde do portal.js do COO-Business-Units-Dashboard:
 * o endereço sai do NOME DA PASTA.
 *
 * Quem chama é VBM-Performance-Hub/portal.js (ver a lista APLICACOES lá),
 * ANTES do express.static do Portal. O controle de acesso (portal-acesso.js)
 * já vale para tudo em /VBM-Performance-Hub.
 *
 * Por enquanto o dashboard roda com dados de demonstração (assets/hob-data.js)
 * e não tem API própria. Quando a fonte de dados existir, as rotas entram aqui
 * em BASE + '/api', no mesmo padrão do coo-api.js.
 */
const path = require('path');

const HUB = '/' + path.basename(path.dirname(__dirname));
const PASTA = path.basename(__dirname);
const BASE = HUB + '/' + PASTA;
const TAG = '[' + PASTA.toLowerCase() + ']';
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = function montarHealthOfTheBusinessNoPortal(app) {
  // Da pasta só a página (/, index.html) e os assets são públicos:
  // portal.js, docs/ e o resto ficam bloqueados (o express.static do Portal serve a pasta).
  const PUBLICO = new RegExp('^' + escaparRegex(BASE) + '\\/?(index\\.html|assets\\/.+)?$', 'i');
  app.use(BASE, (req, res, next) => {
    const caminho = req.originalUrl.split('?')[0];
    if (PUBLICO.test(caminho) && !/\.\.|%2e|%5c|\\/i.test(caminho)) return next();
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Not found.' });
  });

  console.log(`${TAG} página em ${BASE}/ (dados de demonstração)`);
  return {};
};
