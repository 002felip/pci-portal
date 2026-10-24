/* ════════════════════════════════════════════════════════════════════
   VBM-Performance-Studio — carga mensal de IBP.PHUB_PERFORMANCESTUDIO
   Banco: BDIBPBMSA_PRD

   Grava o resultado da CHART_DATA_AO_VIVO_SQL (performancehub-api.js) para um mês
   fechado. Pode rodar de novo para o mesmo mês: apaga e regrava só aquele
   DT_REF + ID_DASH, numa transação (tudo ou nada).

   Parâmetros (bloco abaixo):
     @DT_REF     último mês FECHADO. NULL = IBP.CONTROLE_PROCESSOS.DT_INI - 1 mês
                 (ID_PROCESSO = 2), o mesmo valor que a query da API usa.
     @NM_USUARIO quem roda a carga. NULL = login da conexão (SUSER_SNAME()).
     @ID_DASH    dashboard de origem (21 = VBM Production Analytics).
     @ANOS_ANTES anos anteriores incluídos para comparação (1 = desde jan do ano anterior).

   Datas derivadas de @DT_REF (a query da API usa GETDATE(); aqui não, para
   que reprocessar um mês dê o mesmo recorte):
     @DT_INI  = 1º de janeiro de (ano de @DT_REF - @ANOS_ANTES)
     @DT_FIM  = dezembro do ano do mês seguinte ao fechado (em jan/27, fechado
                dez/26, já inclui 2027, como a API)
     @YTD_FIM = @DT_REF (YTD de janeiro até o mês fechado)

   Atenção: reprocessar um mês antigo usa os valores ATUAIS de
   PEDRAVISAOCONSOLIDADA (projeções e realizados de hoje), não os da época.
   ════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

-- ── Parâmetros ───────────────────────────────────────────────────────
DECLARE @DT_REF     DATE          = NULL;   -- ex.: '2026-09-01'
DECLARE @NM_USUARIO NVARCHAR(200) = NULL;   -- ex.: N'job-carga-mensal'
DECLARE @ID_DASH    INT           = 21;
DECLARE @ANOS_ANTES INT           = 1;

-- ── Datas da carga ───────────────────────────────────────────────────
IF @DT_REF IS NULL
  SET @DT_REF = (SELECT DATEADD(MONTH, -1, DT_INI) FROM IBP.CONTROLE_PROCESSOS WHERE ID_PROCESSO = 2);
IF @DT_REF IS NULL
  THROW 50001, 'DT_REF não informado e não encontrado em IBP.CONTROLE_PROCESSOS (ID_PROCESSO = 2).', 1;
SET @DT_REF = DATEFROMPARTS(YEAR(@DT_REF), MONTH(@DT_REF), 1);
SET @NM_USUARIO = COALESCE(@NM_USUARIO, SUSER_SNAME());

DECLARE @DT_INI  DATE = DATEFROMPARTS(YEAR(@DT_REF) - @ANOS_ANTES, 1, 1);
DECLARE @DT_FIM  DATE = DATEFROMPARTS(YEAR(DATEADD(MONTH, 1, @DT_REF)), 12, 1);
DECLARE @YTD_FIM DATE = @DT_REF;

-- ── 1. Resultado da query numa temporária (nada é apagado se falhar aqui) ──
IF OBJECT_ID('tempdb..#R') IS NOT NULL DROP TABLE #R;

SELECT
  Q.DT_REF        AS DT_IND,
  Q.ID_SISTEMA, Q.ID_SITE, Q.ID_OPERACAO, Q.ID_KPI,
  Q.ORDEM_SERIE   AS ID_TIPO_VISAO,
  Q.NM_TYPE       AS NM_TIPO_VISAO,
  Q.[Type]        AS NM_VISAO,
  Q.[Value]       AS VL_KPI,
  Q.CD_VISAO      AS CD_PERIODO,
  Q.ORDEM_VISAO, Q.ORDEM_ANO, Q.ORDEM_PERIODO
INTO #R
FROM (
    -- CHART_DATA_AO_VIVO_SQL de performancehub-api.js, sem alteração de lógica
    -- (só ID_DASH = 21 virou @ID_DASH e o ORDER BY final saiu)

    -- MONTH
    SELECT
      DATEFROMPARTS(YEAR(PVC.DT_REF), MONTH(PVC.DT_REF), 1) AS DT_REF,
      PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID,
      CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
      CONCAT(
        CHOOSE(MONTH(PVC.DT_REF), 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'),
        CASE
          WHEN UnpivotedData.Type = 'Budget' THEN 'B'
          WHEN UnpivotedData.Type = 'Supply' THEN 'P'
          WHEN UnpivotedData.Type = 'Forecast'
               AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), MONTH(PVC.DT_REF), 1)) <= EOMONTH(@DT_REF)
            THEN 'A'
          WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
        END
      ,' ', (RIGHT(YEAR(PVC.DT_REF), 2))) AS 'Type',
      SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
      'MONTH' AS CD_VISAO, 1 AS ORDEM_VISAO,
      YEAR(PVC.DT_REF) AS ORDEM_ANO, MONTH(PVC.DT_REF) AS ORDEM_PERIODO,
      CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 3 END AS ORDEM_SERIE
    FROM
      IBP.PEDRAVISAOCONSOLIDADA PVC
      INNER JOIN IBP.DASHBOARD DASH
        ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
        AND CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
      CROSS APPLY (
        SELECT 'Budget' AS Type, PVC.VL_ORC * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 'Supply' AS Type, PVC.VL_SUPPLY * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 'Forecast' AS Type,
        CASE
          WHEN PVC.DT_REF <= EOMONTH(@DT_REF) AND PVC.VL_REAL IS NULL THEN 0
          WHEN PVC.DT_REF <= EOMONTH(@DT_REF) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
          ELSE PVC.VL_PROJ * DASH.VL_FATOR
        END AS Value
      ) AS UnpivotedData
    WHERE
      PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
      AND DASH.ID_DASH = @ID_DASH
    GROUP BY
      YEAR(PVC.DT_REF), MONTH(PVC.DT_REF),
      PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      DASH.NM_KPIS_DASH, DASH.SG_UNID, UnpivotedData.Type
    
    UNION ALL
    
    -- QUARTER
    SELECT
      DATEADD(QUARTER, DATEDIFF(QUARTER, 0, PVC.DT_REF), 0) AS DT_REF,
      PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID,
      CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
      CONCAT(
        'Q', DATEPART(QUARTER, PVC.DT_REF),
        CASE
          WHEN UnpivotedData.Type = 'Budget' THEN 'B'
          WHEN UnpivotedData.Type = 'Supply' THEN 'P'
          WHEN UnpivotedData.Type = 'Forecast'
               AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), DATEPART(QUARTER, PVC.DT_REF) * 3, 1)) <= EOMONTH(@DT_REF)
            THEN 'A'
          WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
        END
      ,' ', (RIGHT(YEAR(PVC.DT_REF), 2))) AS 'Type',
      SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
      'QUARTER' AS CD_VISAO, 2 AS ORDEM_VISAO,
      YEAR(PVC.DT_REF) AS ORDEM_ANO, DATEPART(QUARTER, PVC.DT_REF) AS ORDEM_PERIODO,
      CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 3 END AS ORDEM_SERIE
    FROM
      IBP.PEDRAVISAOCONSOLIDADA PVC
      INNER JOIN IBP.DASHBOARD DASH
        ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
        AND CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
      -- Plano trimestral congelado: snapshot de HIST_SUPPLY com DT_REF = 1º mês do
      -- trimestre e DT_IND = mês do registro. Sem snapshot, segue PVC.VL_SUPPLY.
      LEFT JOIN IBP.HIST_SUPPLY HS
        ON HS.ID_SISTEMA = PVC.ID_SISTEMA
        AND HS.ID_SITE = PVC.ID_SITE
        AND HS.ID_OPERACAO = PVC.ID_OPERACAO
        AND HS.ID_KPI = PVC.ID_KPI
        AND HS.DT_REF = DATEADD(QUARTER, DATEDIFF(QUARTER, 0, PVC.DT_REF), 0)
        AND HS.DT_IND = PVC.DT_REF
      CROSS APPLY (
        SELECT 'Budget' AS Type, PVC.VL_ORC * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 'Supply' AS Type, CASE WHEN HS.DT_REF IS NOT NULL THEN HS.VL_SUPPLY ELSE PVC.VL_SUPPLY END * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 'Forecast' AS Type,
        CASE
          WHEN PVC.DT_REF <= EOMONTH(@DT_REF) AND PVC.VL_REAL IS NULL THEN 0
          WHEN PVC.DT_REF <= EOMONTH(@DT_REF) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
          ELSE PVC.VL_PROJ * DASH.VL_FATOR
        END AS Value
      ) AS UnpivotedData
    WHERE
      PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
      AND DASH.ID_DASH = @ID_DASH
    GROUP BY
      DATEADD(QUARTER, DATEDIFF(QUARTER, 0, PVC.DT_REF), 0),
      YEAR(PVC.DT_REF), DATEPART(QUARTER, PVC.DT_REF),
      PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      DASH.NM_KPIS_DASH, DASH.SG_UNID, UnpivotedData.Type
    
    UNION ALL
    
    -- SEMESTER
    SELECT
      DATEFROMPARTS(YEAR(PVC.DT_REF), CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 7 END, 1) AS DT_REF,
      PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID,
      CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
      CONCAT(
        CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 'H1' ELSE 'H2' END,
        CASE
          WHEN UnpivotedData.Type = 'Budget' THEN 'B'
          WHEN UnpivotedData.Type = 'Supply' THEN 'P'
          WHEN UnpivotedData.Type = 'Forecast'
               AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 6 ELSE 12 END, 1)) <= EOMONTH(@DT_REF)
            THEN 'A'
          WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
        END
      ,' ', (RIGHT(YEAR(PVC.DT_REF), 2))) AS 'Type',
      SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
      'SEMESTER' AS CD_VISAO, 3 AS ORDEM_VISAO,
      YEAR(PVC.DT_REF) AS ORDEM_ANO,
      CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 2 END AS ORDEM_PERIODO,
      CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 3 END AS ORDEM_SERIE
    FROM
      IBP.PEDRAVISAOCONSOLIDADA PVC
      INNER JOIN IBP.DASHBOARD DASH
        ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
        AND CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
      CROSS APPLY (
        SELECT 'Budget' AS Type, PVC.VL_ORC * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 'Supply' AS Type, PVC.VL_SUPPLY * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 'Forecast' AS Type,
        CASE
          WHEN PVC.DT_REF <= EOMONTH(@DT_REF) AND PVC.VL_REAL IS NULL THEN 0
          WHEN PVC.DT_REF <= EOMONTH(@DT_REF) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
          ELSE PVC.VL_PROJ * DASH.VL_FATOR
        END AS Value
      ) AS UnpivotedData
    WHERE
      PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
      AND DASH.ID_DASH = @ID_DASH
    GROUP BY
      YEAR(PVC.DT_REF),
      CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 7 END,
      CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 2 END,
      PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      DASH.NM_KPIS_DASH, DASH.SG_UNID, UnpivotedData.Type,
      -- SQL Server exige a expressão de 'Type' repetida verbatim aqui: o
      -- ramo Forecast A/F depende de EOMONTH e não sai das colunas agrupadas.
      CONCAT(
        CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 'H1' ELSE 'H2' END,
        CASE
          WHEN UnpivotedData.Type = 'Budget' THEN 'B'
          WHEN UnpivotedData.Type = 'Supply' THEN 'P'
          WHEN UnpivotedData.Type = 'Forecast'
               AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 6 ELSE 12 END, 1)) <= EOMONTH(@DT_REF)
            THEN 'A'
          WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
        END
      ,' ', (RIGHT(YEAR(PVC.DT_REF), 2)))
    
    UNION ALL
    
    -- YEAR
    SELECT
      DATEFROMPARTS(YEAR(PVC.DT_REF), 1, 1) AS DT_REF,
      PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID,
      CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
      CASE
        WHEN UnpivotedData.Type = 'Budget' THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'B')
        WHEN UnpivotedData.Type = 'Supply' THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'P')
        WHEN UnpivotedData.Type = 'Forecast' AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), 12, 1)) <= EOMONTH(@DT_REF) THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'A')
        WHEN UnpivotedData.Type = 'Forecast' THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'F')
      END AS 'Type',
      SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
      'YEAR' AS CD_VISAO, 5 AS ORDEM_VISAO,
      YEAR(PVC.DT_REF) AS ORDEM_ANO, YEAR(PVC.DT_REF) AS ORDEM_PERIODO,
      CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 3 END AS ORDEM_SERIE
    FROM
      IBP.PEDRAVISAOCONSOLIDADA PVC
      INNER JOIN IBP.DASHBOARD DASH
        ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
        AND CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
      CROSS APPLY (
        SELECT 'Budget' AS Type, PVC.VL_ORC * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 'Supply' AS Type, PVC.VL_SUPPLY * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 'Forecast' AS Type,
        CASE
          WHEN PVC.DT_REF <= EOMONTH(@DT_REF) AND PVC.VL_REAL IS NULL THEN 0
          WHEN PVC.DT_REF <= EOMONTH(@DT_REF) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
          ELSE PVC.VL_PROJ * DASH.VL_FATOR
        END AS Value
      ) AS UnpivotedData
    WHERE
      PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
      AND DASH.ID_DASH = @ID_DASH
    GROUP BY
      YEAR(PVC.DT_REF), PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      DASH.NM_KPIS_DASH, DASH.SG_UNID, UnpivotedData.Type
    
    UNION ALL
    
    -- YTD: jan até o mês de @YTD_FIM, mesmo limite de meses em todos os anos
    SELECT
      DATEFROMPARTS(YEAR(PVC.DT_REF), 1, 1) AS DT_REF,
      PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID,
      CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
      -- YTD só cobre meses já fechados: Act/Fcst é sempre 'A' (realizado)
      CONCAT('YTD',
        CASE
          WHEN UnpivotedData.Type = 'Budget' THEN 'B'
          WHEN UnpivotedData.Type = 'Supply' THEN 'P'
          ELSE 'A'
        END, ' ', RIGHT(YEAR(PVC.DT_REF), 2)) AS 'Type',
      SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
      'YTD' AS CD_VISAO, 4 AS ORDEM_VISAO,
      YEAR(PVC.DT_REF) AS ORDEM_ANO, YEAR(PVC.DT_REF) AS ORDEM_PERIODO,
      CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 3 END AS ORDEM_SERIE
    FROM
      IBP.PEDRAVISAOCONSOLIDADA PVC
      INNER JOIN IBP.DASHBOARD DASH
        ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
        AND CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
      CROSS APPLY (
        SELECT 'Budget' AS Type, PVC.VL_ORC * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 'Supply' AS Type, PVC.VL_SUPPLY * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 'Forecast' AS Type,
        CASE
          WHEN PVC.DT_REF <= EOMONTH(@DT_REF) AND PVC.VL_REAL IS NULL THEN 0
          WHEN PVC.DT_REF <= EOMONTH(@DT_REF) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
          ELSE PVC.VL_PROJ * DASH.VL_FATOR
        END AS Value
      ) AS UnpivotedData
    WHERE
      PVC.DT_REF BETWEEN @DT_INI AND @YTD_FIM
      AND MONTH(PVC.DT_REF) <= MONTH(@YTD_FIM)
      AND DASH.ID_DASH = @ID_DASH
    GROUP BY
      YEAR(PVC.DT_REF), PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      DASH.NM_KPIS_DASH, DASH.SG_UNID, UnpivotedData.Type
) AS Q;

DECLARE @LINHAS INT = (SELECT COUNT(*) FROM #R);
IF @LINHAS = 0
  THROW 50002, 'A query não retornou linhas: nada foi gravado e a carga anterior foi mantida.', 1;

-- Chave repetida (IBP.DASHBOARD com mais de um nome/unidade para o mesmo KPI)
IF EXISTS (
  SELECT 1 FROM #R
  GROUP BY DT_IND, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI, CD_PERIODO, ID_TIPO_VISAO
  HAVING COUNT(*) > 1
)
  THROW 50003, 'Chave repetida no resultado (verifique IBP.DASHBOARD do dashboard): nada foi gravado.', 1;

-- ── 2. Regrava o mês numa transação ──────────────────────────────────
BEGIN TRY
  BEGIN TRANSACTION;

  DELETE FROM IBP.PHUB_PERFORMANCESTUDIO
  WHERE DT_REF = @DT_REF AND ID_DASH = @ID_DASH;

  INSERT INTO IBP.PHUB_PERFORMANCESTUDIO
    (DT_REF, DT_IND, ID_DASH, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI,
     ID_TIPO_VISAO, NM_TIPO_VISAO, NM_VISAO, VL_KPI,
     CD_PERIODO, ORDEM_VISAO, ORDEM_ANO, ORDEM_PERIODO, NM_USUARIO)
  SELECT
     @DT_REF, DT_IND, @ID_DASH, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI,
     ID_TIPO_VISAO, NM_TIPO_VISAO, NM_VISAO, VL_KPI,
     CD_PERIODO, ORDEM_VISAO, ORDEM_ANO, ORDEM_PERIODO, @NM_USUARIO
  FROM #R;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

-- ── 3. Resumo da carga ───────────────────────────────────────────────
SELECT @DT_REF AS DT_REF, @ID_DASH AS ID_DASH, @LINHAS AS LINHAS_GRAVADAS,
       @DT_INI AS DT_INI, @DT_FIM AS DT_FIM, @YTD_FIM AS YTD_FIM, @NM_USUARIO AS NM_USUARIO;

SELECT CD_PERIODO, NM_TIPO_VISAO, COUNT(*) AS LINHAS
FROM IBP.PHUB_PERFORMANCESTUDIO
WHERE DT_REF = @DT_REF AND ID_DASH = @ID_DASH
GROUP BY CD_PERIODO, ORDEM_VISAO, ID_TIPO_VISAO, NM_TIPO_VISAO
ORDER BY ORDEM_VISAO, ID_TIPO_VISAO;

DROP TABLE #R;
