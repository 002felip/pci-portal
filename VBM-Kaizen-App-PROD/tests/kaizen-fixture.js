/**
 * Um Kaizen de verdade para a tela de Aprovação, servido por rota do
 * Playwright. O dublê do mssql devolve um esqueleto; sem conteúdo real o
 * modal ampliado abre vazio e "o tema está certo" seria uma afirmação
 * sobre uma tela em branco.
 */
const PNG = require("./png.js").png(1280, 720);

const FILA = [{
  ID_KAIZEN: 7, NM_KAIZEN: "Reducao de refugo na linha 3",
  NM_LIDER: "Cristian Arlan Alves", ROTULO: "KZN26-007",
  NM_STATUS: "Revisado", DT_CRIACAO: "2026-09-08T14:40:00Z",
}];

const DETALHE = {
  ID_KAIZEN: 7, ROTULO: "KZN26-007", NM_KAIZEN: "Reducao de refugo na linha 3",
  NM_CATEGORIA: "5S", NM_CIDADE: "Nova Lima", NM_LIDER: "Cristian Arlan Alves",
  NM_STATUS: "Revisado", DT_CRIACAO: "2026-09-08T14:40:00Z",
  DS_PROBLEMA: "O fechamento mensal exigia conferencia manual de seis sistemas, com 4h de retrabalho por ciclo.",
  DS_OBJETIVO: "Reduzir em 30% o tempo de fechamento e eliminar a digitacao dupla.",
  DS_ESTADO_ANTES: "Planilha paralela alimentada a mao, sem rastreio de quem alterou o que.",
  DS_ESTADO_DEPOIS: "Painel unico no GPV, com trilha de auditoria por lancamento.",
  URL_IMG_ANTES: "05 - Kaizen/7/antes.png", URL_IMG_DEPOIS: "05 - Kaizen/7/depois.png",
  VL_RESULTADO_FINANCEIRO: 128400.5, SG_MOEDA: "BRL",
  RESULTADOS: [
    { NM_RESULTADO: "Reducao de tempo", DS_RESULTADO: "4h para 1h20 por ciclo de fechamento" },
    { NM_RESULTADO: "Qualidade", DS_RESULTADO: "Zero divergencia entre sistemas em 3 meses" },
  ],
};

/** Liga as rotas num BrowserContext do Playwright. */
async function servir(ctx) {
  const json = (corpo) => ({ status: 200, contentType: "application/json", body: JSON.stringify(corpo) });
  await ctx.route("**/api/aprovacoes", (r) => r.fulfill(json(FILA)));
  await ctx.route("**/api/kaizens/7", (r) => r.fulfill(json(DETALHE)));
  await ctx.route("**/api/kaizens/imagem**", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
}

module.exports = { FILA, DETALHE, servir };
