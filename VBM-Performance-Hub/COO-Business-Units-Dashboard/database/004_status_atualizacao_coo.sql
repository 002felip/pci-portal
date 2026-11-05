/* ════════════════════════════════════════════════════════════════════
   COO Business Units Dashboard — situação de atualização dos KPIs na carga do ciclo
   Banco: BDIBPBMSA_PRD · agendar no Data Factory depois de 003_carga_mensal_coo.sql

   Atualiza, nas linhas do ciclo atual do COO em IBP.PHUB_PERFORMANCESTUDIO
   (ID_DASH 15, DT_REF = mês de GETDATE()-2, dia 1; sem essa carga, a mais recente gravada):
     DT_ATUALIZACAO = última atualização do KPI em IBP.LOG_PEDRAVISAOCONSOLIDADA
                      (NULL quando o KPI não tem linha no mês ou não tem log)
     SG_STATUS      = 'S' atualizado | 'N' pendente

   Regra = SQL - COO DASHBOARD ATUALIZACAO (por KPI e DT_IND):
     sem linha em PEDRAVISAOCONSOLIDADA no DT_IND ou sem log  → 'N'
     DT_IND anterior ao mês de @DT_REF                        → 'S'
     DT_ATUALIZACAO >= referência (1º dia do mês de GETDATE()-2) → 'S'
     demais                                                   → 'N'
   Referência = 1º dia do mês de GETDATE()-2 (ex.: 2026-11-01), mesmo quando a carga do mês ainda
   não foi gravada e as linhas atualizadas são as da carga mais recente. @DT_REF = mês anterior (como no
   002_coo_dashboard_atualizacao.sql em produção): o mês do ciclo só conta como
   atualizado com atualização no mês seguinte.

   Pré-requisitos na tabela: coluna SG_STATUS CHAR(1) NULL e DT_ATUALIZACAO
   aceitando NULL (hoje é NOT NULL com padrão SYSUTCDATETIME()):
     ALTER TABLE IBP.PHUB_PERFORMANCESTUDIO ADD SG_STATUS CHAR(1) NULL;
     ALTER TABLE IBP.PHUB_PERFORMANCESTUDIO ALTER COLUMN DT_ATUALIZACAO DATETIME2(0) NULL;
   ════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @ID_DASH  INT  = 15;
-- Referência da atualização: 1º dia do mês de GETDATE()-2 (ex.: 05/11/2026 → 2026-11-01).
-- KPI atualizado = última atualização com data maior ou igual a essa referência
DECLARE @DT_CORTE DATE = DATEFROMPARTS(YEAR(GETDATE() - 2), MONTH(GETDATE() - 2), 1);
-- Mês do ciclo (último mês realizado): o mês anterior à referência (2026-11-01 → 2026-10-01)
DECLARE @DT_REF   DATE = DATEADD(MONTH, -1, @DT_CORTE);
DECLARE @DT_CARGA DATE = @DT_CORTE;
-- Carga do mês ainda não gravada (ex.: dia 5 sem a carga do mês): usa a carga mais recente do dashboard
IF NOT EXISTS (SELECT 1 FROM IBP.PHUB_PERFORMANCESTUDIO WHERE ID_DASH = @ID_DASH AND DT_REF = @DT_CARGA)
  SET @DT_CARGA = (SELECT MAX(DT_REF) FROM IBP.PHUB_PERFORMANCESTUDIO WHERE ID_DASH = @ID_DASH AND DT_REF <= @DT_CARGA);
IF @DT_CARGA IS NULL
  THROW 50020, 'Nenhuma carga do dashboard em IBP.PHUB_PERFORMANCESTUDIO: rode antes o 003_carga_mensal_coo.sql.', 1;
DECLARE @LINHAS   INT;

-- Última atualização por KPI e DT_IND (KPI com linha no mês em PEDRAVISAOCONSOLIDADA)
IF OBJECT_ID('tempdb..#A') IS NOT NULL DROP TABLE #A;

SELECT
  R.ID_DASH, R.DT_IND, R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI,
  MAX(CASE WHEN PVC.DT_REF IS NOT NULL THEN L.DT_ATUALIZACAO END) AS DT_ATUALIZACAO
INTO #A
FROM (
  SELECT DISTINCT ID_DASH, DT_IND, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI
  FROM IBP.PHUB_PERFORMANCESTUDIO
  WHERE ID_DASH = @ID_DASH AND DT_REF = @DT_CARGA
) R
LEFT JOIN IBP.PEDRAVISAOCONSOLIDADA PVC
  ON PVC.ID_SISTEMA = R.ID_SISTEMA AND PVC.ID_SITE = R.ID_SITE
  AND PVC.ID_OPERACAO = R.ID_OPERACAO AND PVC.ID_KPI = R.ID_KPI
  AND PVC.DT_REF = R.DT_IND
LEFT JOIN (
  SELECT ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI, MAX(DT_ATUALIZACAO) AS DT_ATUALIZACAO
  FROM IBP.LOG_PEDRAVISAOCONSOLIDADA
  GROUP BY ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI
) L
  ON L.ID_SISTEMA = R.ID_SISTEMA AND L.ID_SITE = R.ID_SITE
  AND L.ID_OPERACAO = R.ID_OPERACAO AND L.ID_KPI = R.ID_KPI
GROUP BY R.ID_DASH, R.DT_IND, R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI;

BEGIN TRANSACTION;

UPDATE R
SET
  R.DT_ATUALIZACAO = A.DT_ATUALIZACAO,
  R.SG_STATUS = CASE
    WHEN A.DT_ATUALIZACAO IS NULL THEN 'N'
    WHEN R.DT_IND < @DT_REF THEN 'S'
    WHEN A.DT_ATUALIZACAO >= @DT_CORTE THEN 'S'  -- atualização a partir da referência (2026-11-01)
    ELSE 'N'
  END
FROM IBP.PHUB_PERFORMANCESTUDIO R
INNER JOIN #A A
  ON A.ID_DASH = R.ID_DASH AND A.DT_IND = R.DT_IND AND A.ID_SISTEMA = R.ID_SISTEMA AND A.ID_SITE = R.ID_SITE
  AND A.ID_OPERACAO = R.ID_OPERACAO AND A.ID_KPI = R.ID_KPI
WHERE R.ID_DASH = @ID_DASH
  AND R.DT_REF = @DT_CARGA;
SET @LINHAS = @@ROWCOUNT;

COMMIT TRANSACTION;

SELECT ID_DASH = @ID_DASH, DT_REF = @DT_CARGA, REFERENCIA = @DT_CORTE, MES_CICLO = @DT_REF, LINHAS_ATUALIZADAS = @LINHAS;

-- Resumo (linhas por situação)
SELECT ID_DASH, @DT_CARGA AS DT_REF, @DT_REF AS MES_CICLO, SG_STATUS, COUNT(*) AS LINHAS
FROM IBP.PHUB_PERFORMANCESTUDIO
WHERE ID_DASH = @ID_DASH AND DT_REF = @DT_CARGA
GROUP BY ID_DASH, SG_STATUS;

DROP TABLE #A;
