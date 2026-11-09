/* ════════════════════════════════════════════════════════════════════
   VBM Performance Studio — situação de atualização dos KPIs na carga do ciclo
   Banco: BDIBPBMSA_PRD · agendar no Data Factory depois de 003_carga_mensal.sql
   Baseado no 004 do COO (COO-Business-Units-Dashboard/database/004_status_atualizacao_coo.sql);
   a tela do Studio marca os gráficos com KPI pendente (rota /chart-data/status).

   Para cada indicador (ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI) da carga do Studio em
   IBP.PHUB_PERFORMANCESTUDIO (ID_DASH 21), compara a data da última atualização em
   IBP.LOG_PEDRAVISAOCONSOLIDADA com a data de referência:
     DT_ATUALIZACAO >= referência  → SG_STATUS = 'S' (atualizado)
     DT_ATUALIZACAO <  referência  → SG_STATUS = 'N' (pendente)
     sem registro no log           → SG_STATUS = 'N' e DT_ATUALIZACAO NULL
   A situação vale para todas as linhas do indicador na carga (meses, trimestres e anos).

   Referência = DT_REF da carga (1º dia do mês do dashboard): só conta como atualizado o
   indicador alterado A PARTIR desse dia. Ex.: carga 2026-11-01 → atualizado em 01/11/2026
   ou depois = 'S'; atualizado em outubro (ciclo anterior) = 'N'.

   Carga a atualizar: @DT_CARGA_PARAM (ex.: '2026-11-01'); NULL = carga do mês de
   GETDATE()-2 (ex.: 2026-11-01) ou, sem ela gravada, a mais recente do dashboard.

   Indicadores consolidados (gravados pela carga automática 'Carga_Auto', que soma os sites
   e registra no log a data da própria execução): a data do consolidado não diz nada sobre
   os dados de origem. Por isso ele só fica 'S' quando TODOS os sites que o compõem estão
   atualizados; a data gravada é a do componente mais atrasado (NULL se algum não tem log).
   Composição (#COMPOSICAO, a mesma da carga automática; ID_OPERACAO <> 10):
     Copper  site 38 · KPI 22  = sites 1, 2, 14, 32, 33
     Nickel  site 39 · KPI 51  = sites 3, 14, 16, 26, 32, 33   (sem Onça Puma)
     Cobalt  site 35 · KPI 722 = sites 14, 32, 33
     Global  site 40 · KPI 22, 51 e 722 = os mesmos sites do 38, 39 e 35 (38 pendente → 40 Copper pendente)
   Mudou a carga automática? Atualize a lista #COMPOSICAO abaixo.

   Pré-requisitos na tabela (os mesmos do COO; se o COO já roda, já existem):
     ALTER TABLE IBP.PHUB_PERFORMANCESTUDIO ADD SG_STATUS CHAR(1) NULL;
     ALTER TABLE IBP.PHUB_PERFORMANCESTUDIO ALTER COLUMN DT_ATUALIZACAO DATETIME2(0) NULL;
   ════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @ID_DASH        INT  = 21;
DECLARE @DT_CARGA_PARAM DATE = NULL;   -- ex.: '2026-11-01' para reprocessar uma carga
-- Carga a atualizar: a informada; senão a do mês (2026-11-01); ainda não gravada, a mais recente
DECLARE @DT_CARGA DATE = COALESCE(@DT_CARGA_PARAM, DATEFROMPARTS(YEAR(GETDATE() - 2), MONTH(GETDATE() - 2), 1));
SET @DT_CARGA = DATEFROMPARTS(YEAR(@DT_CARGA), MONTH(@DT_CARGA), 1);
IF NOT EXISTS (SELECT 1 FROM IBP.PHUB_PERFORMANCESTUDIO WHERE ID_DASH = @ID_DASH AND DT_REF = @DT_CARGA)
  SET @DT_CARGA = (SELECT MAX(DT_REF) FROM IBP.PHUB_PERFORMANCESTUDIO WHERE ID_DASH = @ID_DASH AND DT_REF <= @DT_CARGA);
IF @DT_CARGA IS NULL
  THROW 50020, 'Nenhuma carga do dashboard em IBP.PHUB_PERFORMANCESTUDIO: rode antes o 003_carga_mensal.sql.', 1;
-- Data de referência: 1º dia do mês da carga (carga 2026-11-01 → atualizado a partir de 01/11/2026)
DECLARE @DT_REF   DATE = @DT_CARGA;
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

-- Consolidados: situação = a dos sites que os compõem (o log do consolidado é da carga automática)
IF OBJECT_ID('tempdb..#COMPOSICAO') IS NOT NULL DROP TABLE #COMPOSICAO;
CREATE TABLE #COMPOSICAO (ID_SITE_AGREGADO INT NOT NULL, ID_KPI INT NOT NULL, ID_SITE INT NOT NULL);
INSERT INTO #COMPOSICAO (ID_SITE_AGREGADO, ID_KPI, ID_SITE) VALUES
  (38, 22, 1), (38, 22, 2), (38, 22, 14), (38, 22, 32), (38, 22, 33),                -- Copper
  (39, 51, 3), (39, 51, 14), (39, 51, 16), (39, 51, 26), (39, 51, 32), (39, 51, 33), -- Nickel (sem Onça Puma)
  (35, 722, 14), (35, 722, 32), (35, 722, 33);                                        -- Cobalt
-- Global (site 40): Copper, Nickel e Cobalt com os mesmos sites do 38, 39 e 35
INSERT INTO #COMPOSICAO (ID_SITE_AGREGADO, ID_KPI, ID_SITE)
SELECT 40, ID_KPI, ID_SITE FROM #COMPOSICAO WHERE ID_SITE_AGREGADO IN (38, 39, 35);

-- Última atualização de cada componente que existe no ano da referência (como na carga automática)
IF OBJECT_ID('tempdb..#COMP') IS NOT NULL DROP TABLE #COMP;
SELECT C.ID_SITE_AGREGADO, C.ID_KPI, P.ID_SISTEMA, P.ID_SITE, P.ID_OPERACAO, MAX(L.DT_ATUALIZACAO) AS DT_ATUALIZACAO
INTO #COMP
FROM #COMPOSICAO C
INNER JOIN (
  SELECT DISTINCT ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI
  FROM IBP.PEDRAVISAOCONSOLIDADA
  WHERE YEAR(DT_REF) = YEAR(DATEADD(MONTH, -1, @DT_REF)) AND ID_OPERACAO <> 10  -- ano do último mês realizado, como a carga automática
) P ON P.ID_SITE = C.ID_SITE AND P.ID_KPI = C.ID_KPI
LEFT JOIN IBP.LOG_PEDRAVISAOCONSOLIDADA L
  ON L.ID_SISTEMA = P.ID_SISTEMA AND L.ID_SITE = P.ID_SITE
  AND L.ID_OPERACAO = P.ID_OPERACAO AND L.ID_KPI = P.ID_KPI
GROUP BY C.ID_SITE_AGREGADO, C.ID_KPI, P.ID_SISTEMA, P.ID_SITE, P.ID_OPERACAO;

-- Consolidado: data do componente mais atrasado; algum componente sem log → NULL ('N')
UPDATE A
SET A.DT_ATUALIZACAO = X.DT_MAIS_ANTIGA
FROM #A A
INNER JOIN (
  SELECT ID_SITE_AGREGADO, ID_KPI,
    CASE WHEN COUNT(*) = COUNT(DT_ATUALIZACAO) THEN MIN(DT_ATUALIZACAO) END AS DT_MAIS_ANTIGA
  FROM #COMP
  GROUP BY ID_SITE_AGREGADO, ID_KPI
) X ON X.ID_SITE_AGREGADO = A.ID_SITE AND X.ID_KPI = A.ID_KPI;

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

-- Consolidados: componente por componente (o pendente aparece com SG_STATUS 'N')
SELECT C.ID_SITE_AGREGADO, C.ID_KPI, C.ID_SISTEMA, C.ID_SITE, C.ID_OPERACAO, C.DT_ATUALIZACAO,
       SG_STATUS = CASE WHEN C.DT_ATUALIZACAO >= @DT_REF THEN 'S' ELSE 'N' END
FROM #COMP C
ORDER BY C.ID_SITE_AGREGADO, SG_STATUS, C.ID_SITE;

DROP TABLE #A;
DROP TABLE #COMP;
DROP TABLE #COMPOSICAO;
