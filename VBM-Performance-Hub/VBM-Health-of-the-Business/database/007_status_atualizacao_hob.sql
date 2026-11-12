/* ════════════════════════════════════════════════════════════════════
   VBM Health of the Business — situação de atualização dos KPIs na carga do ciclo
   Banco: BDIBPBMSA_PRD · agendar no Data Factory depois de 003_carga_mensal_hob.sql
   Mesmo trabalho do 004_status_atualizacao_coo.sql (COO Business Units Dashboard), com o ID_DASH 16.

   Para cada indicador (ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI) da carga do Health of the Business em
   IBP.PHUB_PERFORMANCESTUDIO (ID_DASH 16), compara a data da última atualização em
   IBP.LOG_PEDRAVISAOCONSOLIDADA com a data de referência:
     DT_ATUALIZACAO >= referência  → SG_STATUS = 'S' (atualizado)
     DT_ATUALIZACAO <  referência  → SG_STATUS = 'N' (pendente)
     sem registro no log           → SG_STATUS = 'N' e DT_ATUALIZACAO NULL
   A situação vale para todas as linhas do indicador na carga (MONTH, QUARTER, YTD, YTG e YEAR).
   A tela lê SG_STATUS e DT_ATUALIZACAO (rota api/atualizacao) e marca o gráfico com
   "Pending final updates", como o COO.

   Referência = mês do ciclo = DATEADD(MONTH, -1, GETDATE()-2), no 1º dia do mês
     ex.: 06/11/2026 → 2026-10-01 (indicador atualizado a partir de 01/10/2026 = 'S')

   Linhas atualizadas: carga DT_REF = mês de GETDATE()-2 (ex.: 2026-11-01); sem ela ainda
   gravada, a carga mais recente do dashboard.

   Pré-requisitos na tabela (os mesmos do COO): coluna SG_STATUS e DT_ATUALIZACAO aceitando NULL.
   ════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @ID_DASH  INT  = 16;
-- Data de referência: 1º dia do mês do ciclo (06/11/2026 → 2026-10-01)
DECLARE @DT_REF   DATE = DATEADD(MONTH, -1, GETDATE() - 2);
SET @DT_REF = DATEFROMPARTS(YEAR(@DT_REF), MONTH(@DT_REF), 1);
-- Carga a atualizar: a do mês (2026-11-01); ainda não gravada, a mais recente do dashboard
DECLARE @DT_CARGA DATE = DATEFROMPARTS(YEAR(GETDATE() - 2), MONTH(GETDATE() - 2), 1);
IF NOT EXISTS (SELECT 1 FROM IBP.PHUB_PERFORMANCESTUDIO WHERE ID_DASH = @ID_DASH AND DT_REF = @DT_CARGA)
  SET @DT_CARGA = (SELECT MAX(DT_REF) FROM IBP.PHUB_PERFORMANCESTUDIO WHERE ID_DASH = @ID_DASH AND DT_REF <= @DT_CARGA);
IF @DT_CARGA IS NULL
  THROW 50020, 'Nenhuma carga do dashboard em IBP.PHUB_PERFORMANCESTUDIO: rode antes o 003_carga_mensal_hob.sql.', 1;
DECLARE @LINHAS   INT;

-- Última atualização de cada indicador da carga (log)
IF OBJECT_ID('tempdb..#A') IS NOT NULL DROP TABLE #A;

SELECT
  R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI,
  MAX(L.DT_ATUALIZACAO) AS DT_ATUALIZACAO
INTO #A
FROM (
  SELECT DISTINCT ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI
  FROM IBP.PHUB_PERFORMANCESTUDIO
  WHERE ID_DASH = @ID_DASH AND DT_REF = @DT_CARGA
) R
LEFT JOIN IBP.LOG_PEDRAVISAOCONSOLIDADA L
  ON L.ID_SISTEMA = R.ID_SISTEMA AND L.ID_SITE = R.ID_SITE
  AND L.ID_OPERACAO = R.ID_OPERACAO AND L.ID_KPI = R.ID_KPI
GROUP BY R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI;

BEGIN TRANSACTION;

UPDATE R
SET
  R.DT_ATUALIZACAO = A.DT_ATUALIZACAO,
  R.SG_STATUS = CASE WHEN A.DT_ATUALIZACAO >= @DT_REF THEN 'S' ELSE 'N' END  -- NULL (sem log) → 'N'
FROM IBP.PHUB_PERFORMANCESTUDIO R
INNER JOIN #A A
  ON A.ID_SISTEMA = R.ID_SISTEMA AND A.ID_SITE = R.ID_SITE
  AND A.ID_OPERACAO = R.ID_OPERACAO AND A.ID_KPI = R.ID_KPI
WHERE R.ID_DASH = @ID_DASH
  AND R.DT_REF = @DT_CARGA;
SET @LINHAS = @@ROWCOUNT;

COMMIT TRANSACTION;

-- Resumo: referência, carga atualizada e indicadores por situação
SELECT ID_DASH = @ID_DASH, DT_CARGA = @DT_CARGA, DT_REFERENCIA = @DT_REF, LINHAS_ATUALIZADAS = @LINHAS,
       INDICADORES_S = SUM(CASE WHEN DT_ATUALIZACAO >= @DT_REF THEN 1 ELSE 0 END),
       INDICADORES_N = SUM(CASE WHEN DT_ATUALIZACAO >= @DT_REF THEN 0 ELSE 1 END)
FROM #A;

DROP TABLE #A;
