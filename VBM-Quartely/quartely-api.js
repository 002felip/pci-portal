/**
 * Quartely — rotas de dados (chart-data / sites) como MÓDULO.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O Quartely tem dois pontos de entrada possíveis:
 *
 *   1. Standalone, para desenvolvimento: `cd Quartely && npm start`
 *      (Quartely/server.js sobe o próprio Express + pool).
 *   2. Dentro do app publicado: o Databricks App roda `npm start` na
 *      RAIZ do projeto (ver app.yaml), ou seja, o server.js da raiz —
 *      Quartely/server.js não roda em produção.
 *
 * Antes deste módulo, a SQL vivia duplicada nos dois server.js: editar
 * a query no Quartely não mudava nada em produção, que é exatamente a
 * armadilha que fez o filtro Product parecer quebrado por semanas.
 * Aqui a query existe UMA vez, e os dois pontos de entrada montam o
 * mesmo router.
 *
 * `runQuery` entra por injeção porque cada entrada tem seu próprio
 * pool: a raiz já mantém um (com instrumentação de tempo), o
 * standalone abre o seu. Contrato: `runQuery(sql, params?)` devolve algo
 * com `.recordset` (o formato do pacote `mssql`); `params` é
 * `{ nome: [tipoMssql, valor] }` e cada entrada vira `request.input`.
 */
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sql = require('mssql');

// Janela e data de referência vêm do banco (IBP.CONTROLE_PROCESSOS),
// nunca do relógio do servidor de aplicação: é @DT_REF que decide o
// corte Actual/Forecast ('A' vs 'F') de cada período.
const CHART_DATA_SQL = `
DECLARE @DT_INI AS DATE, @DT_FIM AS DATE, @DT_REF AS DATE, @YTD_FIM AS DATE

SET @DT_INI = '2025-01-01'
SET @DT_FIM = CAST(DATEADD(MONTH, 0, CONCAT(YEAR(DATEFROMPARTS(YEAR(DATEADD(MONTH, 0, GETDATE()-1)), MONTH(DATEADD(MONTH, -1, GETDATE()-1)), 1)), '-12-01')) AS DATE)
SET @DT_REF = (SELECT DATEADD(MONTH, -1, DT_INI) AS DT_INI_MENOS_1_MES FROM IBP.CONTROLE_PROCESSOS WHERE ID_PROCESSO = 2)
-- YTD: último mês fechado = mês anterior ao atual (jan → dez do ano anterior, ano completo)
SET @YTD_FIM = DATEADD(MONTH, -1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))

-- MONTH: um período por mês de IBP.PEDRAVISAOCONSOLIDADA ("JanB 26", "JanA 26"...)
SELECT
  DATEFROMPARTS(YEAR(PVC.DT_REF), MONTH(PVC.DT_REF), 1) AS DT_REF,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID, DASH.ID_ORDEM,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 1 ELSE 2 END AS 'ORDEM_GRAFICO',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 1 END AS 'ID_TYPE',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
  CONCAT(
    CHOOSE(MONTH(PVC.DT_REF), 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'),
    CASE
      WHEN UnpivotedData.Type = 'Budget' THEN 'B'
      WHEN UnpivotedData.Type = 'Supply' THEN 'P'
      WHEN UnpivotedData.Type = 'Forecast'
           AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), MONTH(PVC.DT_REF), 1)) <= CAST(@DT_REF AS DATE)
        THEN 'A'
      WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
    END
  ,' ', (RIGHT(YEAR(PVC.DT_REF), 2))) AS 'Type',
  SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
  'MONTH' AS CD_VISAO, 'Mensal' AS NM_VISAO, 1 AS ORDEM_VISAO,
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
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
      ELSE PVC.VL_PROJ * DASH.VL_FATOR
    END AS Value
  ) AS UnpivotedData
WHERE
  PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
  AND DASH.ID_DASH = 21
GROUP BY
  YEAR(PVC.DT_REF), MONTH(PVC.DT_REF),
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH, DASH.SG_UNID, DASH.ID_ORDEM, UnpivotedData.Type

UNION ALL

-- QUARTER
SELECT
  DATEADD(QUARTER, DATEDIFF(QUARTER, 0, PVC.DT_REF), 0) AS DT_REF,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID, DASH.ID_ORDEM,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 1 ELSE 2 END AS 'ORDEM_GRAFICO',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 1 END AS 'ID_TYPE',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
  CONCAT(
    'Q', DATEPART(QUARTER, PVC.DT_REF),
    CASE
      WHEN UnpivotedData.Type = 'Budget' THEN 'B'
      WHEN UnpivotedData.Type = 'Supply' THEN 'P'
      WHEN UnpivotedData.Type = 'Forecast'
           AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), DATEPART(QUARTER, PVC.DT_REF) * 3, 1)) <= CAST(@DT_REF AS DATE)
        THEN 'A'
      WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
    END
  ,' ', (RIGHT(YEAR(PVC.DT_REF), 2))) AS 'Type',
  SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
  'QUARTER' AS CD_VISAO, 'Trimestral' AS NM_VISAO, 2 AS ORDEM_VISAO,
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
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
      ELSE PVC.VL_PROJ * DASH.VL_FATOR
    END AS Value
  ) AS UnpivotedData
WHERE
  PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
  AND DASH.ID_DASH = 21
GROUP BY
  DATEADD(QUARTER, DATEDIFF(QUARTER, 0, PVC.DT_REF), 0),
  YEAR(PVC.DT_REF), DATEPART(QUARTER, PVC.DT_REF),
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH, DASH.SG_UNID, DASH.ID_ORDEM, UnpivotedData.Type

UNION ALL

-- SEMESTER
SELECT
  DATEFROMPARTS(YEAR(PVC.DT_REF), CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 7 END, 1) AS DT_REF,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID, DASH.ID_ORDEM,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 1 ELSE 2 END AS 'ORDEM_GRAFICO',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 1 END AS 'ID_TYPE',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
  CONCAT(
    CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 'H1' ELSE 'H2' END,
    CASE
      WHEN UnpivotedData.Type = 'Budget' THEN 'B'
      WHEN UnpivotedData.Type = 'Supply' THEN 'P'
      WHEN UnpivotedData.Type = 'Forecast'
           AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 6 ELSE 12 END, 1)) <= CAST(@DT_REF AS DATE)
        THEN 'A'
      WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
    END
  ,' ', (RIGHT(YEAR(PVC.DT_REF), 2))) AS 'Type',
  SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
  'SEMESTER' AS CD_VISAO, 'Semestral' AS NM_VISAO, 3 AS ORDEM_VISAO,
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
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
      ELSE PVC.VL_PROJ * DASH.VL_FATOR
    END AS Value
  ) AS UnpivotedData
WHERE
  PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
  AND DASH.ID_DASH = 21
GROUP BY
  YEAR(PVC.DT_REF),
  CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 7 END,
  CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 1 ELSE 2 END,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH, DASH.SG_UNID, DASH.ID_ORDEM, UnpivotedData.Type,
  -- SQL Server exige a expressão de 'Type' repetida verbatim aqui: os
  -- CASEs numéricos acima não cobrem o ramo Forecast A/F, que depende
  -- de EOMONTH. Mesma forma da QUARTELY.sql de origem.
  CONCAT(
    CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 'H1' ELSE 'H2' END,
    CASE
      WHEN UnpivotedData.Type = 'Budget' THEN 'B'
      WHEN UnpivotedData.Type = 'Supply' THEN 'P'
      WHEN UnpivotedData.Type = 'Forecast'
           AND EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), CASE WHEN MONTH(PVC.DT_REF) BETWEEN 1 AND 6 THEN 6 ELSE 12 END, 1)) <= CAST(@DT_REF AS DATE)
        THEN 'A'
      WHEN UnpivotedData.Type = 'Forecast' THEN 'F'
    END
  ,' ', (RIGHT(YEAR(PVC.DT_REF), 2)))

UNION ALL

-- YEAR
SELECT
  DATEFROMPARTS(YEAR(PVC.DT_REF), 1, 1) AS DT_REF,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID, DASH.ID_ORDEM,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 6 ELSE 7 END AS 'ORDEM_GRAFICO',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 1 END AS 'ID_TYPE',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
  CASE
    WHEN UnpivotedData.Type = 'Budget' THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'B')
    WHEN UnpivotedData.Type = 'Supply' THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'P')
    WHEN UnpivotedData.Type = 'Forecast' AND YEAR(PVC.DT_REF) < YEAR(@DT_REF) THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'A')
    WHEN UnpivotedData.Type = 'Forecast' THEN CONCAT(RIGHT(YEAR(PVC.DT_REF), 2), 'F')
  END AS 'Type',
  SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
  'YEAR' AS CD_VISAO, 'Anual' AS NM_VISAO, 4 AS ORDEM_VISAO,
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
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
      ELSE PVC.VL_PROJ * DASH.VL_FATOR
    END AS Value
  ) AS UnpivotedData
WHERE
  PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
  AND DASH.ID_DASH = 21
GROUP BY
  YEAR(PVC.DT_REF), PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH, DASH.SG_UNID, DASH.ID_ORDEM, UnpivotedData.Type

UNION ALL

-- YTD: jan até o mês de @YTD_FIM, mesmo limite de meses em todos os anos
SELECT
  DATEFROMPARTS(YEAR(PVC.DT_REF), 1, 1) AS DT_REF,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH AS 'NM_KPI', DASH.SG_UNID, DASH.ID_ORDEM,
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 6 ELSE 7 END AS 'ORDEM_GRAFICO',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 1 END AS 'ID_TYPE',
  CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' WHEN UnpivotedData.Type = 'Supply' THEN 'Plan' ELSE 'Act/Fcst' END AS 'NM_TYPE',
  CONCAT('YTD',
    CASE
      WHEN UnpivotedData.Type = 'Budget' THEN 'B'
      WHEN UnpivotedData.Type = 'Supply' THEN 'P'
      WHEN EOMONTH(DATEFROMPARTS(YEAR(PVC.DT_REF), MONTH(@YTD_FIM), 1)) <= CAST(@DT_REF AS DATE) THEN 'A'
      ELSE 'F'
    END, ' ', RIGHT(YEAR(PVC.DT_REF), 2)) AS 'Type',
  SUM(CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END) AS [Value],
  'YTD' AS CD_VISAO, 'Year To Date (YTD)' AS NM_VISAO, 5 AS ORDEM_VISAO,
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
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
      WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NOT NULL THEN PVC.VL_REAL * DASH.VL_FATOR
      ELSE PVC.VL_PROJ * DASH.VL_FATOR
    END AS Value
  ) AS UnpivotedData
WHERE
  PVC.DT_REF BETWEEN @DT_INI AND @YTD_FIM
  AND MONTH(PVC.DT_REF) <= MONTH(@YTD_FIM)
  AND DASH.ID_DASH = 21
GROUP BY
  YEAR(PVC.DT_REF), PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH, DASH.SG_UNID, DASH.ID_ORDEM, UnpivotedData.Type

ORDER BY ORDEM_ANO, ORDEM_VISAO, ORDEM_PERIODO, ORDEM_SERIE`;

// A origem correta é IBP.DASHBOARD.ID_SITE (todo site configurado para
// este dashboard), não IBP.PEDRAVISAOCONSOLIDADA: partir de PVC por
// INNER JOIN omite qualquer site cadastrado no DASHBOARD mas ainda sem
// linhas de fato/orçamento — causa-raiz de sites "faltando" no filtro.
const SITES_SQL = `
SELECT DISTINCT
  S.ID_SITE,
  LTRIM(RTRIM(S.NM_SITE)) AS NM_SITE
FROM IBP.SITES S
RIGHT JOIN IBP.DASHBOARD D
  ON D.ID_SITE = S.ID_SITE
WHERE D.ID_DASH = 21
  AND S.NM_SITE IS NOT NULL
  AND LTRIM(RTRIM(S.NM_SITE)) <> ''
ORDER BY NM_SITE`;

const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Configuração dos gráficos (painel de edição do quartely.html) ──────
// Uma linha por gráfico salvo: NM_GRAFICO (único) + DS_CONFIG (JSON só com
// apresentação: título, casas decimais, unidade e cores — nunca dados).
// Script da tabela: database/001_config_grafico.sql. O nome da tabela vem
// de QUARTELY_CONFIG_TABLE (padrão abaixo) e é validado antes de entrar
// na SQL; todos os VALORES entram por parâmetro.
const CONFIG_TABELA_PADRAO = 'IBP.QUARTELY_CONFIG_GRAFICO';
const NOME_MAX = 100; // = NVARCHAR(100) de NM_GRAFICO

const CONFIG_CORES = ['serie:AF', 'serie:P', 'serie:B', 'bgChart', 'delta:up', 'delta:down', 'delta:flat', 'conector'];
// Cor por coluna do gráfico (modo "Por Coluna"): 'col:<rótulo da coluna>'
const CONFIG_COR_COLUNA = /^col:[A-Za-z0-9 ._\/-]{1,24}$/;
const CONFIG_COR_COLUNA_MAX = 80;
const CONFIG_PALETAS = ['vale', 'executiva', 'azul', 'verde', 'performance', 'gradiente'];
const CONFIG_CAMPOS_TITULO = ['product', 'sites', 'visoes', 'horizontes', 'ano'];
const CONFIG_SEPARADORES = [' ', ' - ', ' / ', ' | ', '\n'];
const CONFIG_UNIDADES = ['', 't', 'Kt', 'Mt', '%', 'US$', 'KUSD', 'MUSD', 'custom'];

function tabelaConfig(nome) {
  const t = nome || CONFIG_TABELA_PADRAO;
  if (!/^[A-Za-z_]\w{0,63}\.[A-Za-z_]\w{0,127}$/.test(t)) throw new Error(`QUARTELY_CONFIG_TABLE inválida: "${t}" (use ESQUEMA.TABELA)`);
  return t.split('.').map(p => `[${p}]`).join('.');
}

// Mantém só as chaves e os valores conhecidos — o JSON gravado nunca
// carrega nada além do que o painel sabe aplicar.
function normalizarConfig(entrada) {
  const c = entrada && typeof entrada === 'object' ? entrada : {};
  const t = c.titulo && typeof c.titulo === 'object' ? c.titulo : {};
  const u = c.unidade && typeof c.unidade === 'object' ? c.unidade : {};
  const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const inteiro = (v, min, max, padrao) => (Number.isInteger(v) && v >= min && v <= max ? v : padrao);
  const vistos = new Set();
  const campos = (Array.isArray(t.campos) ? t.campos : [])
    .filter(f => f && CONFIG_CAMPOS_TITULO.includes(f.k) && !vistos.has(f.k) && vistos.add(f.k))
    .map(f => ({ k: f.k, on: !!f.on }));
  CONFIG_CAMPOS_TITULO.forEach(k => { if (!vistos.has(k)) campos.push({ k, on: false }); });
  const fator = Number(u.fator);
  const cores = {};
  let porColuna = 0;
  Object.entries(c.cores && typeof c.cores === 'object' ? c.cores : {}).forEach(([k, v]) => {
    if (!/^#[0-9A-F]{6}$/i.test(v)) return;
    if (CONFIG_CORES.includes(k)) cores[k] = v.toUpperCase();
    else if (CONFIG_COR_COLUNA.test(k) && porColuna++ < CONFIG_COR_COLUNA_MAX) cores[k] = v.toUpperCase();
  });
  return {
    versao: 1,
    titulo: {
      modo: ['auto', 'fixo', 'dinamico'].includes(t.modo) ? t.modo : 'auto',
      fixo: texto(t.fixo, 120),
      campos,
      sep: CONFIG_SEPARADORES.includes(t.sep) ? t.sep : ' - ',
      prefixo: texto(t.prefixo, 40),
      sufixo: texto(t.sufixo, 40),
    },
    decBar: inteiro(c.decBar, 0, 3, 2),
    decDelta: inteiro(c.decDelta, 0, 3, 1),
    unidade: {
      valor: CONFIG_UNIDADES.includes(u.valor) ? u.valor : '',
      custom: texto(u.custom, 12),
      fator: Number.isFinite(fator) && fator > 0 && fator <= 1e9 ? fator : 1,
      nosRotulos: u.nosRotulos !== false,
    },
    // Id do tipo de gráfico (catálogo TIPOS_GRAFICO no quartely.html); padrão 'bar'
    tipoGrafico: typeof c.tipoGrafico === 'string' && /^[a-z][a-z0-9-]{0,19}$/.test(c.tipoGrafico) ? c.tipoGrafico : 'bar',
    exibirDelta: c.exibirDelta !== false,
    linhas: normalizarLinhas(c.linhas),
    modoCor: c.modoCor === 'coluna' ? 'coluna' : 'grupo',
    paletaColunas: CONFIG_PALETAS.includes(c.paletaColunas) ? c.paletaColunas : '',
    cores,
  };
}

// ── Background da apresentação ──────────────────────────────────────────
// Configuração GLOBAL do dashboard (o Quartely não tem preferência por
// usuário): uma linha reservada na mesma tabela de configuração, com o
// nome abaixo. Nomes que começam com "__" são reservados e ficam fora da
// lista de gráficos salvos. A imagem vai para o armazenamento existente
// (Azure Blob do portal); o banco guarda só a referência gerada aqui.
const FUNDO_NOME = '__QUARTERLY_BACKGROUND__';
const FUNDO_IMG_MAX = 5 * 1024 * 1024; // 5 MB
const FUNDO_REF = /^bg-[0-9a-f]{32}\.(png|jpg|webp)$/;
const FUNDO_MIME_POR_EXT = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const FUNDO_TAMANHOS = ['cover', 'contain', 'auto'];
const FUNDO_POSICOES = ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right'];

// Tipo real pelos primeiros bytes (não confia no nome nem no Content-Type do navegador)
function extensaoPorAssinatura(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function normalizarFundo(entrada) {
  const c = entrada && typeof entrada === 'object' ? entrada : {};
  const img = c.imagem && typeof c.imagem === 'object' ? c.imagem : {};
  const cor = v => (/^#[0-9A-F]{6}$/i.test(v) ? v.toUpperCase() : null);
  const cores = (Array.isArray(c.cores) ? c.cores : []).map(cor).filter(Boolean).slice(0, 3);
  const angulo = Number(c.angulo);
  const opac = Number(img.overlayOpacidade);
  const f = {
    versao: 1,
    tipo: ['padrao', 'solido', 'gradiente', 'imagem'].includes(c.tipo) ? c.tipo : 'padrao',
    cor: cor(c.cor) || '#0D2640',
    cores: cores.length >= 2 ? cores : ['#041523', '#0D3D6B'],
    angulo: Number.isInteger(angulo) && angulo >= 0 && angulo <= 360 ? angulo : 135,
    imagem: {
      ref: FUNDO_REF.test(img.ref) ? img.ref : null,
      tamanho: FUNDO_TAMANHOS.includes(img.tamanho) ? img.tamanho : 'cover',
      repetir: img.repetir === true,
      posicao: FUNDO_POSICOES.includes(img.posicao) ? img.posicao : 'center',
      overlayCor: cor(img.overlayCor) || '#041523',
      overlayOpacidade: Number.isFinite(opac) && opac >= 0 && opac <= 0.9 ? Math.round(opac * 100) / 100 : 0.35,
    },
  };
  if (f.tipo === 'imagem' && !f.imagem.ref) f.tipo = 'padrao';
  return f;
}

// Configuração das Linhas (tipo 'line-smooth'): só valores conhecidos
function normalizarLinhas(entrada) {
  const l = entrada && typeof entrada === 'object' ? entrada : {};
  const padraoEstilo = { 'serie:AF': 'solida', 'serie:B': 'tracejada', 'serie:P': 'tracejada' };
  const series = {};
  Object.keys(padraoEstilo).forEach(k => {
    const e = l.series && typeof l.series[k] === 'object' ? l.series[k] : {};
    const op = Number(e.opacidade);
    series[k] = {
      estilo: ['solida', 'tracejada', 'pontilhada'].includes(e.estilo) ? e.estilo : padraoEstilo[k],
      opacidade: Number.isFinite(op) && op >= 0.2 && op <= 1 ? Math.round(op * 100) / 100 : 1,
    };
  });
  return {
    marcadores: l.marcadores !== false,
    rotulos: l.rotulos !== false,
    legenda: l.legenda !== false,
    suave: l.suave !== false,
    espessura: ['fina', 'media', 'grossa'].includes(l.espessura) ? l.espessura : 'media',
    series,
  };
}

function lerConfigGravada(json) {
  try { return normalizarConfig(JSON.parse(json)); } catch (e) { return normalizarConfig(null); }
}

// 208 = objeto inexistente (tabela ainda não criada); 229/230 = sem permissão.
function respostaDeErroConfig(res, err, acao) {
  console.error(`[quartely] config-graficos (${acao}):`, err.message);
  if (err.number === 208) return res.status(503).json({ error: 'Tabela de configuração dos gráficos não encontrada no banco.', codigo: 'SEM_TABELA' });
  if (err.number === 229 || err.number === 230) return res.status(503).json({ error: 'Sem permissão na tabela de configuração dos gráficos.', codigo: 'SEM_PERMISSAO' });
  return res.status(500).json({ error: `Falha ao ${acao} a configuração.`, codigo: 'ERRO_BANCO' });
}

/**
 * Monta o router com /chart-data, /sites e /ping.
 *
 * O router pode ser montado em VÁRIOS caminhos (a raiz monta nos quatro
 * candidatos, porque de fora não dá para saber se o Databricks Apps
 * entrega "/Quartely/api/..." ou já sem o prefixo da pasta). Montar a
 * MESMA instância em todos compartilha o cache — não multiplica ida ao
 * banco.
 */
function criarQuartelyRouter({ runQuery, tabelaConfiguracao, armazenamento, pastaFundos }) {
  if (typeof runQuery !== 'function') {
    throw new Error('criarQuartelyRouter: `runQuery` é obrigatório');
  }
  const T = tabelaConfig(tabelaConfiguracao);

  const router = express.Router();
  const cache = new Map();

  async function comCache(chave, buscar) {
    const item = cache.get(chave);
    if (item && item.expiraEm > Date.now()) return item.dados;
    const dados = await buscar();
    cache.set(chave, { dados, expiraEm: Date.now() + CACHE_TTL_MS });
    return dados;
  }

  function rota(caminho, chaveCache, consulta, oQueFalhou) {
    router.get(caminho, async (req, res) => {
      try {
        const dados = await comCache(chaveCache, async () => (await runQuery(consulta)).recordset);
        res.json(dados);
      } catch (err) {
        console.error(`[quartely] Erro ao buscar ${chaveCache}:`, err.message);
        res.status(500).json({ error: oQueFalhou, detalhe: err.message });
      }
    });
  }

  // Diagnóstico que NÃO toca no banco: separa "código não publicado"
  // (404 aqui) de "publicado, mas o banco falha" (200 aqui + 500 abaixo).
  router.get('/ping', (req, res) => {
    res.json({ ok: true, caminhoRecebido: req.originalUrl });
  });

  rota('/chart-data', 'chart-data', CHART_DATA_SQL, 'Failed to fetch chart data');
  rota('/sites', 'sites', SITES_SQL, 'Failed to fetch sites');

  // Lista das configurações salvas (sem cache: reflete a última gravação).
  router.get('/config-graficos', async (req, res) => {
    try {
      const r = await runQuery(`SELECT ID_CONFIG, NM_GRAFICO, DS_CONFIG, DT_ATUALIZACAO FROM ${T} WHERE NM_GRAFICO NOT LIKE '[_][_]%' ORDER BY NM_GRAFICO`);
      res.json({
        limiteNome: NOME_MAX,
        itens: r.recordset.map(l => ({ id: l.ID_CONFIG, nome: l.NM_GRAFICO, config: lerConfigGravada(l.DS_CONFIG), atualizadoEm: l.DT_ATUALIZACAO })),
      });
    } catch (err) {
      respostaDeErroConfig(res, err, 'ler');
    }
  });

  // Grava pelo NOME: com `id` atualiza aquele registro (inclusive renomear);
  // sem `id` cria. Nome já usado por OUTRO registro → 409, nunca duplica.
  router.put('/config-graficos', express.json({ limit: '32kb' }), async (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envie JSON.' });
    const corpo = req.body && typeof req.body === 'object' ? req.body : {};
    const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : '';
    if (!nome) return res.status(400).json({ error: 'Informe o nome do gráfico.', campo: 'nome' });
    if (nome.length > NOME_MAX) return res.status(400).json({ error: `O nome do gráfico aceita no máximo ${NOME_MAX} caracteres.`, campo: 'nome' });
    if (nome.startsWith('__')) return res.status(400).json({ error: 'Nomes iniciados por "__" são reservados. Escolha outro nome.', campo: 'nome' });
    let id = null;
    if (corpo.id != null) {
      id = Number(corpo.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Identificador de configuração inválido.' });
    }
    const json = JSON.stringify(normalizarConfig(corpo.config));
    const email = String(req.get('X-Forwarded-Email') || '').slice(0, 200) || null;
    const DUPLICADO = { error: 'Já existe um gráfico salvo com este nome. Escolha outro nome.', campo: 'nome', codigo: 'NOME_DUPLICADO' };

    try {
      const mesmoNome = await runQuery(`SELECT ID_CONFIG FROM ${T} WHERE NM_GRAFICO = @nome`, { nome: [sql.NVarChar(NOME_MAX), nome] });
      const dono = mesmoNome.recordset[0];
      if (dono && dono.ID_CONFIG !== id) return res.status(409).json(DUPLICADO);

      const params = {
        nome: [sql.NVarChar(NOME_MAX), nome],
        config: [sql.NVarChar(sql.MAX), json],
        email: [sql.NVarChar(200), email],
      };
      let gravado = null;
      if (id) {
        const r = await runQuery(
          `UPDATE ${T} SET NM_GRAFICO = @nome, DS_CONFIG = @config, DT_ATUALIZACAO = SYSUTCDATETIME(), CD_EMAIL_ATUALIZACAO = @email
           OUTPUT INSERTED.ID_CONFIG, INSERTED.NM_GRAFICO, INSERTED.DT_ATUALIZACAO
           WHERE ID_CONFIG = @id`,
          { ...params, id: [sql.Int, id] });
        gravado = r.recordset[0] || null;
      }
      // Sem id, ou o registro vinculado foi removido do banco: cria.
      if (!gravado) {
        const r = await runQuery(
          `INSERT INTO ${T} (NM_GRAFICO, DS_CONFIG, CD_EMAIL_ATUALIZACAO)
           OUTPUT INSERTED.ID_CONFIG, INSERTED.NM_GRAFICO, INSERTED.DT_ATUALIZACAO
           VALUES (@nome, @config, @email)`,
          params);
        gravado = r.recordset[0];
      }
      res.json({ id: gravado.ID_CONFIG, nome: gravado.NM_GRAFICO, atualizadoEm: gravado.DT_ATUALIZACAO });
    } catch (err) {
      // Corrida entre dois "Salvar" com o mesmo nome: a UNIQUE do banco decide.
      if (err.number === 2627 || err.number === 2601) return res.status(409).json(DUPLICADO);
      respostaDeErroConfig(res, err, 'salvar');
    }
  });

  // ── Background (configuração global do dashboard) ──
  router.get('/background', async (req, res) => {
    try {
      const r = await runQuery(`SELECT DS_CONFIG, DT_ATUALIZACAO FROM ${T} WHERE NM_GRAFICO = @nome`, { nome: [sql.NVarChar(NOME_MAX), FUNDO_NOME] });
      const l = r.recordset[0];
      let fundo = null;
      if (l) { try { fundo = normalizarFundo(JSON.parse(l.DS_CONFIG)); } catch (e) { fundo = null; } }
      res.json({ fundo, atualizadoEm: l ? l.DT_ATUALIZACAO : null });
    } catch (err) {
      respostaDeErroConfig(res, err, 'ler');
    }
  });

  router.put('/background', express.json({ limit: '8kb' }), async (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envie JSON.' });
    const fundo = normalizarFundo(req.body && req.body.fundo);
    const params = {
      nome: [sql.NVarChar(NOME_MAX), FUNDO_NOME],
      config: [sql.NVarChar(sql.MAX), JSON.stringify(fundo)],
      email: [sql.NVarChar(200), String(req.get('X-Forwarded-Email') || '').slice(0, 200) || null],
    };
    try {
      let r = await runQuery(
        `UPDATE ${T} SET DS_CONFIG = @config, DT_ATUALIZACAO = SYSUTCDATETIME(), CD_EMAIL_ATUALIZACAO = @email
         OUTPUT INSERTED.DT_ATUALIZACAO WHERE NM_GRAFICO = @nome`, params);
      if (!r.recordset.length) {
        r = await runQuery(
          `INSERT INTO ${T} (NM_GRAFICO, DS_CONFIG, CD_EMAIL_ATUALIZACAO) OUTPUT INSERTED.DT_ATUALIZACAO VALUES (@nome, @config, @email)`, params);
      }
      res.json({ fundo, atualizadoEm: r.recordset[0].DT_ATUALIZACAO });
    } catch (err) {
      respostaDeErroConfig(res, err, 'salvar');
    }
  });

  // Upload da imagem de fundo: só PNG/JPG/WEBP (conferido pelos bytes),
  // até 5 MB, nome gerado aqui. Devolve só a referência.
  const pasta = String(pastaFundos || 'Quartely/Backgrounds').split('/').filter(p => p && p !== '.' && p !== '..').join('/');
  const receberImagem = multer({ storage: multer.memoryStorage(), limits: { fileSize: FUNDO_IMG_MAX, files: 1 } }).single('imagem');
  router.post('/background/imagem', (req, res) => {
    if (!armazenamento || !armazenamento.configurado()) {
      console.error('[quartely] upload de fundo: armazenamento de imagens não configurado');
      return res.status(503).json({ error: 'Armazenamento de imagens indisponível no momento.' });
    }
    receberImagem(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'A imagem deve ter no máximo 5 MB.' : 'Envio de imagem inválido.' });
      const ext = req.file && extensaoPorAssinatura(req.file.buffer);
      if (!ext) return res.status(400).json({ error: 'Formato não aceito. Use PNG, JPG ou WEBP.' });
      const ref = `bg-${crypto.randomBytes(16).toString('hex')}.${ext}`;
      try {
        await armazenamento.enviar(`${pasta}/${ref}`, req.file.buffer, FUNDO_MIME_POR_EXT[ext]);
        res.json({ ref });
      } catch (e) {
        console.error('[quartely] upload de fundo falhou:', e.message);
        res.status(502).json({ error: 'Não foi possível enviar a imagem. Tente novamente.' });
      }
    });
  });

  router.get('/background/imagem', async (req, res) => {
    const ref = String(req.query.ref || '');
    if (!FUNDO_REF.test(ref) || !armazenamento || !armazenamento.configurado()) return res.status(404).json({ error: 'Imagem não encontrada.' });
    try {
      const { buffer } = await armazenamento.baixar(`${pasta}/${ref}`);
      res.set({
        'Content-Type': FUNDO_MIME_POR_EXT[ref.split('.').pop()],
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=604800, immutable', // ref é única: nunca muda de conteúdo
      });
      res.send(buffer);
    } catch (e) {
      console.error('[quartely] leitura de fundo falhou:', e.message);
      res.status(404).json({ error: 'Imagem não encontrada.' });
    }
  });

  return router;
}

module.exports = { criarQuartelyRouter, normalizarConfig, normalizarFundo, CHART_DATA_SQL, SITES_SQL };
