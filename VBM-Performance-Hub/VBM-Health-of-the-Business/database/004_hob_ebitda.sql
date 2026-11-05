/* ════════════════════════════════════════════════════════════════════
   VBM Health of the Business — EBITDA (gráfico por período da visão consolidada)
   Banco: BDIBPBMSA_PRD · lido pela API (hob-api.js), parâmetros @idDash, @idKpi e @dtRef

   Fonte: a carga do COO Business Units Dashboard em IBP.PHUB_PERFORMANCESTUDIO
   (ID_DASH 15), KPI EBITDA (ID_KPI 73) — configuração da tela: ebitda.idDash e ebitda.idKpi.
   @dtRef = ciclo (DT_REF da carga, dia 1); a API usa o mais recente.

   Regras:
     só o mês (CD_PERIODO 'MONTH'); a tela soma trimestre, YTD, YTG e ano.
     ID_TIPO_VISAO (padrão VBM da tabela): 1 = Budget, 3 = Act/Fcst (Plan não é usado).
     Sites (ebitda.sites na configuração): VBM 40, Copper 38, Nickel 39, Others 45 + 102 + 46.
     IBP.DASHBOARD entra só para unidade e casas decimais (LEFT JOIN: o KPI não precisa estar
     cadastrado no ID_DASH para ser lido).
   ════════════════════════════════════════════════════════════════════ */
SELECT
  YEAR(R.DT_IND) AS ANO, MONTH(R.DT_IND) AS MES, R.ID_SITE, LTRIM(RTRIM(S.NM_SITE)) AS NM_SITE,
  COALESCE(LTRIM(RTRIM(DASH.NM_KPIS_DASH)), 'EBITDA') AS NM_KPI, LTRIM(RTRIM(DASH.SG_UNID)) AS SG_UNID, DASH.VL_CASADECIMAL,
  CASE R.ID_TIPO_VISAO WHEN 1 THEN 'B' ELSE 'AF' END AS SERIE,
  R.NM_VISAO, R.VL_KPI
FROM IBP.PHUB_PERFORMANCESTUDIO R
LEFT JOIN IBP.DASHBOARD DASH
  ON DASH.ID_DASH = @idDash
  AND R.ID_SISTEMA = DASH.ID_SISTEMA
  AND CONCAT(R.ID_SITE, '|', R.ID_OPERACAO, '|', R.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
LEFT JOIN IBP.SITES S
  ON S.ID_SITE = R.ID_SITE
WHERE R.ID_DASH = @idDash
  AND R.ID_KPI = @idKpi
  AND R.DT_REF = @dtRef
  AND R.CD_PERIODO = 'MONTH'
  AND R.ID_TIPO_VISAO IN (1, 3)
ORDER BY R.ID_SITE, ANO, MES
