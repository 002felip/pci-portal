/* ════════════════════════════════════════════════════════════════════
   VBM Health of the Business — FCF YEAR (ponte do caixa)
   Banco: BDIBPBMSA_PRD · lido pela API (hob-api.js), parâmetros @site e @anoIni

   Fonte: IBP.WATERFALL, a consulta entregue pelo time de dados:
     SELECT * FROM IBP.WATERFALL WHERE 1 = 1 AND ID_SITE = 40 AND YEAR(DT_REF) >= '2025'
   com o site e o ano inicial trocados por parâmetro (configuração da tela: fcf.site e
   fcf.anoInicial; padrão 40 e 2025).

   Para cada ano a tela usa a referência mais recente (maior DT_REF do ano). Rótulo, valor e
   ordem de cada degrau são lidos das colunas da tabela (ver mapearWaterfall em hob-api.js);
   com HOB_DIAGNOSTICO=1, GET api/waterfall?bruto=1 mostra as colunas e as linhas como vieram.
   ════════════════════════════════════════════════════════════════════ */
SELECT W.*
FROM IBP.WATERFALL W
WHERE 1 = 1
  AND W.ID_SITE = @site
  AND YEAR(W.DT_REF) >= @anoIni
