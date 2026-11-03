/* ════════════════════════════════════════════════════════════════════
   VBM Health of the Business — leitura de uma carga para a tela
   Banco: BDIBPBMSA_PRD · lido pela API (hob-api.js), parâmetros @idDash e @dtRef

   Fonte: IBP.PHUB_PERFORMANCESTUDIO (a mesma tabela do COO e do Studio), gravada por
   database/003_carga_mensal_hob.sql com o ID_DASH do Health of the Business (HOB_ID_DASH).

   Regras:
     @dtRef     ciclo escolhido na tela (DT_REF da carga, dia 1).
     CD_PERIODO 'MONTH' alimenta os gráficos mês a mês (a tela soma trimestre, YTD, YTG e ano);
                'YEAR' alimenta as pontes (2026 EBITDA YEAR e FCF YEAR).
     ID_TIPO_VISAO (padrão VBM da tabela): 1 = Budget, 3 = Act/Fcst (Plan não é usado).
     RK_LINHA   a carga grava a linha anual uma vez por mês do ano (DT_IND), sempre com o mesmo
                valor do ano: fica uma linha por KPI, série e ano (a mesma regra do COO Historical).
   Nome, ordem, unidade e casas decimais do KPI: IBP.DASHBOARD, como no COO.
   ════════════════════════════════════════════════════════════════════ */
WITH CARGA AS (
  SELECT
    YEAR(R.DT_IND) AS ANO, MONTH(R.DT_IND) AS MES, R.CD_PERIODO,
    R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI, R.ID_TIPO_VISAO, R.NM_VISAO, R.VL_KPI,
    ROW_NUMBER() OVER (
      PARTITION BY R.CD_PERIODO, YEAR(R.DT_IND), CASE WHEN R.CD_PERIODO = 'MONTH' THEN MONTH(R.DT_IND) ELSE 0 END,
                   R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI, R.ID_TIPO_VISAO
      ORDER BY R.DT_IND DESC) AS RK_LINHA
  FROM IBP.PHUB_PERFORMANCESTUDIO R
  WHERE R.ID_DASH = @idDash
    AND R.DT_REF = @dtRef
    AND R.CD_PERIODO IN ('MONTH', 'YEAR')
    AND R.ID_TIPO_VISAO IN (1, 3)
)
SELECT
  C.ANO, C.MES, C.CD_PERIODO, C.ID_SISTEMA, C.ID_SITE, C.ID_OPERACAO, C.ID_KPI,
  LTRIM(RTRIM(DASH.NM_KPIS_DASH)) AS NM_KPI, DASH.ID_ORDEM, LTRIM(RTRIM(DASH.SG_UNID)) AS SG_UNID, DASH.VL_CASADECIMAL,
  CASE C.ID_TIPO_VISAO WHEN 1 THEN 'B' ELSE 'AF' END AS SERIE,
  C.NM_VISAO, C.VL_KPI
FROM CARGA C
INNER JOIN IBP.DASHBOARD DASH
  ON DASH.ID_DASH = @idDash
  AND C.ID_SISTEMA = DASH.ID_SISTEMA
  AND CONCAT(C.ID_SITE, '|', C.ID_OPERACAO, '|', C.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
WHERE C.RK_LINHA = 1
ORDER BY C.ID_SITE, DASH.ID_ORDEM, C.CD_PERIODO, C.ANO, C.MES
