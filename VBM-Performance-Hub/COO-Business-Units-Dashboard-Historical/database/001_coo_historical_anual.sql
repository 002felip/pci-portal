/* ════════════════════════════════════════════════════════════════════
   COO Business Units Dashboard Historical — série ANUAL por KPI
   Banco: BDIBPBMSA_PRD · lido pela API (coo-api.js), parâmetros @idDash, @dtRef e @anoIni

   Fonte: a MESMA tabela do COO Business Units Dashboard, IBP.PHUB_PERFORMANCESTUDIO
   (cargas gravadas pela carga mensal do COO, que grava os anos desde 2017).
   Só as linhas da visão ANUAL (CD_PERIODO = 'YEAR') saem do banco: mês e trimestre
   não são lidos.

   Regras:
     @anoIni    primeiro ano da série (COO_HIST_ANO_INICIAL na API; padrão 2017).
     @dtRef     ciclo escolhido na tela (DT_REF da carga, dia 1). Só cargas até ele.
     RK_CARGA   para cada ano, a carga mais recente até @dtRef — o ano fechado
                guarda o Actual da última carga em que apareceu ('25A'); o ano
                corrente, o Budget e o Forecast da carga do ciclo ('26B', '26F').
     RK_LINHA   a carga grava a linha anual uma vez por mês do ano (DT_IND), sempre
                com o mesmo valor do ano: fica uma linha por KPI, série e ano.
     ID_TIPO_VISAO (padrão VBM da tabela): 1 = Budget, 3 = Act/Fcst (o ano não tem Plan).
   Nome, ordem, unidade e casas decimais do KPI: IBP.DASHBOARD, como no COO.
   ════════════════════════════════════════════════════════════════════ */
WITH ANUAL AS (
  SELECT
    R.DT_REF AS DT_CARGA, R.ORDEM_ANO AS ANO, R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI,
    R.ID_TIPO_VISAO, R.NM_VISAO, R.VL_KPI,
    DENSE_RANK() OVER (PARTITION BY R.ORDEM_ANO ORDER BY R.DT_REF DESC) AS RK_CARGA,
    ROW_NUMBER() OVER (
      PARTITION BY R.DT_REF, R.ORDEM_ANO, R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI, R.ID_TIPO_VISAO
      ORDER BY R.DT_IND DESC) AS RK_LINHA
  FROM IBP.PHUB_PERFORMANCESTUDIO R
  WHERE R.ID_DASH = @idDash
    AND R.CD_PERIODO = 'YEAR'
    AND R.ID_TIPO_VISAO IN (1, 3)
    AND R.ORDEM_ANO >= @anoIni
    AND R.DT_REF <= @dtRef
)
SELECT
  A.ANO, A.DT_CARGA, A.ID_SISTEMA, A.ID_SITE, A.ID_OPERACAO, A.ID_KPI,
  DASH.NM_KPIS_DASH AS NM_KPI, DASH.ID_ORDEM, DASH.SG_UNID, DASH.VL_CASADECIMAL,
  CASE A.ID_TIPO_VISAO WHEN 1 THEN 'B' ELSE 'AF' END AS SERIE,
  A.NM_VISAO, A.VL_KPI
FROM ANUAL A
INNER JOIN IBP.DASHBOARD DASH
  ON DASH.ID_DASH = @idDash
  AND A.ID_SISTEMA = DASH.ID_SISTEMA
  AND CONCAT(A.ID_SITE, '|', A.ID_OPERACAO, '|', A.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
WHERE A.RK_CARGA = 1
  AND A.RK_LINHA = 1
ORDER BY A.ID_SITE, DASH.ID_ORDEM, A.ANO
