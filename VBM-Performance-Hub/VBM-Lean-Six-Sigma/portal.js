/**
 * VBM Lean Six Sigma — aplicação do Performance Hub montada em /VBM-Performance-Hub/<pasta>/
 * (página: index.html). Mesmo molde do portal.js do COO: o endereço sai do NOME DA PASTA.
 *
 * Quem chama é VBM-Performance-Hub/portal.js (lista APLICACOES), ANTES do express.static do
 * Portal. O controle de acesso do Portal (IBP.USERS com CD_MATRICULA) já vale para tudo em
 * /VBM-Performance-Hub, inclusive esta API.
 *
 * SEM BANCO: os dados vêm das planilhas em data/ (ver lss-api.js). Para atualizar, substituir
 * as planilhas e publicar. LSS_PASTA_DADOS (opcional) aponta para outra pasta.
 */
const path = require('path');
const { criarLssRouter } = require('./lss-api');

const HUB = '/' + path.basename(path.dirname(__dirname));
const PASTA = path.basename(__dirname);
const BASE = HUB + '/' + PASTA;
const TAG = '[' + PASTA.toLowerCase() + ']';
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = function montarLeanSixSigmaNoPortal(app) {
  const semCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const { router, leitor } = criarLssRouter();

  // Saúde = as duas planilhas existem e são lidas
  app.get(BASE + '/api/health', semCache, async (req, res) => {
    try {
      const d = await leitor.ler();
      res.json({ status: 'healthy', projetos: d.projetos.length });
    } catch (err) {
      console.error(TAG + ' health:', err.message);
      res.status(503).json({ status: 'unhealthy' });
    }
  });
  app.use(BASE + '/api', semCache, router);

  // Da pasta só a página (/, index.html) e os assets são públicos: data/ (as planilhas),
  // *.js do servidor, tests/ e package*.json ficam bloqueados.
  const PUBLICO = new RegExp('^' + escaparRegex(BASE) + '\\/?(index\\.html|assets\\/.+)?$', 'i');
  app.use(BASE, (req, res, next) => {
    const caminho = req.originalUrl.split('?')[0];
    if (PUBLICO.test(caminho) && !/\.\.|%2e|%5c|\\/i.test(caminho)) return next();
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Not found.' });
  });

  // Lê as planilhas já na subida: a primeira pessoa não espera, e um arquivo com problema aparece no log
  leitor.ler().catch((err) => console.error(TAG + ' planilhas:', err.message));
  console.log(`${TAG} rotas em ${BASE}/api — dados das planilhas em ${PASTA}/data`);
  return {};
};
