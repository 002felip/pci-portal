/* ════════════════════════════════════════════════════════════════════
   VBM Health of the Business — EBITDA (gráfico por período da visão consolidada)
   Banco: BDIBPBMSA_PRD · lido pela API (hob-api.js), parâmetros @idDash, @idKpi e @dtRef

   Fonte: a carga do Health of the Business em IBP.PHUB_PERFORMANCESTUDIO (ID_DASH 16, gravada por
   003_carga_mensal_hob.sql), um KPI por consulta (@idKpi) — configuração da tela: ebitda.idDash e ebitda.idKpi.
   A API lê o KPI 73 (EBITDA) e os KPIs de Others (45, 102 e 46, filtrados pela operação 11).
   @dtRef = ciclo (DT_REF da carga, dia 1); a API usa o mais recente.

   Regras:
     só o mês (CD_PERIODO 'MONTH'); a tela soma trimestre, YTD, YTG e ano.
     ID_TIPO_VISAO (padrão VBM da tabela): 1 = Budget, 3 = Act/Fcst (Plan não é usado).
     KPI 73: VBM = site 40, Copper = site 38, Nickel = site 39 (um negócio por vez no seletor da tela).
     Others = soma dos KPIs 45 + 102 + 46 da operação 11 (ebitda.outros) — por isso ID_OPERACAO no resultado.
     IBP.DASHBOARD entra só para unidade e casas decimais (LEFT JOIN: o KPI não precisa estar
     cadastrado no ID_DASH para ser lido).
   ════════════════════════════════════════════════════════════════════ */
SELECT
  YEAR(R.DT_IND) AS ANO, MONTH(R.DT_IND) AS MES, R.ID_SITE, LTRIM(RTRIM(S.NM_SITE)) AS NM_SITE, R.ID_OPERACAO, R.ID_KPI,
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
