/* ════════════════════════════════════════════════════════════════════
   VBM Health of the Business — EBITDA (gráfico por período da visão consolidada)
   Banco: BDIBPBMSA_PRD · lido pela API (hob-api.js), parâmetros @idDash, @idKpi e @dtRef

   Fonte: a carga do Health of the Business em IBP.PHUB_PERFORMANCESTUDIO (ID_DASH 16, gravada por
   003_carga_mensal_hob.sql), um KPI por consulta (@idKpi) — configuração da tela: ebitda.idDash e ebitda.idKpi.
   A API lê o KPI 73 (EBITDA); Others = o mesmo KPI 73 nos sites 45, 102 e 46 (operação 11).
   @dtRef = ciclo (DT_REF da carga, dia 1); a API usa o mais recente.

   Regras:
     CD_PERIODO: MONTH (a série mês a mês) e QUARTER, YTD, YTG e YEAR gravados pela carga para cada mês (DT_IND):
     a tela usa os gravados no mês escolhido; sem eles (mês fora da carga), soma os meses.
     ID_TIPO_VISAO (padrão VBM da tabela): 1 = Budget, 3 = Act/Fcst (Plan não é usado).
     KPI 73: VBM = site 40, Copper = site 38, Nickel = site 39 (um negócio por vez no seletor da tela).
     Others = soma do KPI 73 dos sites 45 + 102 + 46 da operação 11 (ebitda.outros) — por isso ID_OPERACAO no resultado.
     IBP.DASHBOARD entra só para unidade e casas decimais (OUTER APPLY TOP 1: o KPI não precisa estar
     cadastrado no ID_DASH para ser lido, e cadastro repetido não duplica valores). Prefere o cadastro do
     mesmo site e operação; sem ele, o do mesmo KPI em outro site do ID_DASH.
   ════════════════════════════════════════════════════════════════════ */
SELECT
  YEAR(R.DT_IND) AS ANO, MONTH(R.DT_IND) AS MES, R.ID_SITE, LTRIM(RTRIM(S.NM_SITE)) AS NM_SITE, R.ID_OPERACAO, R.ID_KPI,
  COALESCE(LTRIM(RTRIM(DASH.NM_KPIS_DASH)), 'EBITDA') AS NM_KPI, LTRIM(RTRIM(DASH.SG_UNID)) AS SG_UNID, DASH.VL_CASADECIMAL,
  CASE R.ID_TIPO_VISAO WHEN 1 THEN 'B' ELSE 'AF' END AS SERIE, R.CD_PERIODO,
  R.NM_VISAO, R.VL_KPI
FROM IBP.PHUB_PERFORMANCESTUDIO R
OUTER APPLY (
  SELECT TOP 1 D.NM_KPIS_DASH, D.SG_UNID, D.VL_CASADECIMAL
  FROM IBP.DASHBOARD D
  WHERE D.ID_DASH = @idDash
    AND D.ID_SISTEMA = R.ID_SISTEMA
    AND D.ID_KPI = R.ID_KPI
  ORDER BY
    CASE WHEN D.ID_SITE = R.ID_SITE AND D.ID_OPERACAO = R.ID_OPERACAO THEN 0 ELSE 1 END,
    CASE WHEN D.VL_CASADECIMAL IS NULL THEN 1 ELSE 0 END
) DASH
LEFT JOIN IBP.SITES S
  ON S.ID_SITE = R.ID_SITE
WHERE R.ID_DASH = @idDash
  AND R.ID_KPI = @idKpi
  AND R.DT_REF = @dtRef
  AND R.CD_PERIODO IN ('MONTH', 'QUARTER', 'YTD', 'YTG', 'YEAR')
  AND R.ID_TIPO_VISAO IN (1, 3)
ORDER BY R.ID_SITE, R.ORDEM_VISAO, ANO, MES
