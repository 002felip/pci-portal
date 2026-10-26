/**
 * Performance Hub — rotas de dados (chart-data / sites) como MÓDULO.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O Performance Hub tem dois pontos de entrada possíveis:
 *
 *   1. Standalone, para desenvolvimento: `cd VBM-Performance-Hub && npm start`
 *      (VBM-Performance-Hub/server.js sobe o próprio Express + pool).
 *   2. Dentro do app publicado: o Databricks App roda `npm start` na
 *      RAIZ do projeto (ver app.yaml), ou seja, o server.js da raiz —
 *      VBM-Performance-Hub/server.js não roda em produção.
 *
 * Antes deste módulo, a SQL vivia duplicada nos dois server.js: editar
 * a query no Performance Hub não mudava nada em produção, que é exatamente a
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

// Consulta AO VIVO às bases de origem. É a mesma lógica que a carga mensal
// (database/003_carga_mensal.sql) grava em IBP.PHUB_PERFORMANCESTUDIO; o
// dashboard só a usa enquanto a tabela não existe ou não tem carga.
// Janela e data de referência vêm do banco (IBP.CONTROLE_PROCESSOS),
// nunca do relógio do servidor de aplicação: é @DT_REF que decide o
// corte Actual/Forecast ('A' vs 'F') de cada período.
const CHART_DATA_AO_VIVO_SQL = `
DECLARE @DT_INI AS DATE, @DT_FIM AS DATE, @DT_REF AS DATE, @YTD_FIM AS DATE

SET @DT_INI = '2025-01-01'
SET @DT_FIM = CAST(DATEADD(MONTH, 0, CONCAT(YEAR(DATEFROMPARTS(YEAR(DATEADD(MONTH, 0, GETDATE()-1)), MONTH(DATEADD(MONTH, -1, GETDATE()-1)), 1)), '-12-01')) AS DATE)
-- @DT_REF = último mês FECHADO (DT_INI do processo - 1 mês): ele e os anteriores são
-- realizado ('A', VL_REAL); os seguintes, projeção ('F', VL_PROJ)
SET @DT_REF = (SELECT DATEADD(MONTH, -1, DT_INI) AS DT_INI_MENOS_1_MES FROM IBP.CONTROLE_PROCESSOS WHERE ID_PROCESSO = 2)
-- YTD: último mês fechado = mês anterior ao atual (jan → dez do ano anterior, ano completo)
SET @YTD_FIM = DATEADD(MONTH, -1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))

-- MONTH: um período por mês de IBP.PEDRAVISAOCONSOLIDADA ("JanB 26", "JanA 26"...)
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
  AND DASH.ID_DASH = 21
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
  AND DASH.ID_DASH = 21
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
  AND DASH.ID_DASH = 21
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
  AND DASH.ID_DASH = 21
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
  AND DASH.ID_DASH = 21
GROUP BY
  YEAR(PVC.DT_REF), PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  DASH.NM_KPIS_DASH, DASH.SG_UNID, UnpivotedData.Type

ORDER BY ORDEM_ANO, ORDEM_VISAO, ORDEM_PERIODO, ORDEM_SERIE`;

// Dashboard servido por /chart-data (IBP.DASHBOARD.ID_DASH)
const ID_DASH = 21;

// Fonte do dashboard: uma carga mensal de IBP.PHUB_PERFORMANCESTUDIO
// (database/002_snapshot_mensal.sql e 003_carga_mensal.sql). Só leitura.
//   @dtRef  = mês de referência escolhido = mês final do YTD (ex.: 2026-06-01 →
//             YTD jan–jun/26 e a projeção feita em junho). NULL = carga mais recente.
//   @idDash = dashboard. Os dois entram por parâmetro tipado.
// Cada linha traz DT_REF (a referência da carga) e DT_IND (o período da linha);
// as demais colunas têm os nomes que o index.html já usa. Nome do KPI e unidade
// vêm de IBP.DASHBOARD (mesmo join da consulta ao vivo).
const CHART_DATA_SQL = `
DECLARE @DT_CARGA DATE = COALESCE(@dtRef,
  (SELECT MAX(DT_REF) FROM IBP.PHUB_PERFORMANCESTUDIO WHERE ID_DASH = @idDash))

SELECT
  R.DT_REF, R.DT_IND,
  R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI,
  DASH.NM_KPIS_DASH AS NM_KPI, DASH.SG_UNID,
  R.NM_TIPO_VISAO AS NM_TYPE,
  R.NM_VISAO AS [Type],
  R.VL_KPI AS [Value],
  R.CD_PERIODO AS CD_VISAO, R.ORDEM_VISAO,
  R.ORDEM_ANO, R.ORDEM_PERIODO,
  R.ID_TIPO_VISAO AS ORDEM_SERIE
FROM IBP.PHUB_PERFORMANCESTUDIO R
  INNER JOIN IBP.DASHBOARD DASH
    ON DASH.ID_DASH = R.ID_DASH
    AND R.ID_SISTEMA = DASH.ID_SISTEMA
    AND CONCAT(R.ID_SITE, R.ID_OPERACAO, R.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
WHERE R.DT_REF = @DT_CARGA
  AND R.ID_DASH = @idDash
ORDER BY R.ORDEM_ANO, R.ORDEM_VISAO, R.ORDEM_PERIODO, R.ID_TIPO_VISAO`;

// Referências (meses de YTD) com carga gravada, da mais recente para a mais antiga.
// NM_YTD é o rótulo para a escolha na tela (ex.: "YTD Jun 26").
const REFERENCIAS_SQL = `
SELECT
  R.DT_REF,
  CONCAT('YTD ',
    CHOOSE(MONTH(R.DT_REF), 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'),
    ' ', RIGHT(YEAR(R.DT_REF), 2)) AS NM_YTD,
  MAX(R.DT_ATUALIZACAO) AS DT_ATUALIZACAO
FROM IBP.PHUB_PERFORMANCESTUDIO R
WHERE R.ID_DASH = @idDash
GROUP BY R.DT_REF
ORDER BY R.DT_REF DESC`;

// ?dtRef=AAAA-MM (ou AAAA-MM-01) → 'AAAA-MM-01'; vazio → null; inválido → undefined
function lerDtRef(valor) {
  if (valor === undefined || valor === '') return null;
  const m = typeof valor === 'string' && /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(valor);
  if (!m || +m[1] < 2000 || +m[1] > 2100) return undefined;
  return `${m[1]}-${m[2]}-01`;
}

// 208 = "Invalid object name": a tabela ainda não foi criada nesta base
const SQL_OBJETO_INEXISTENTE = 208;

// A origem correta é IBP.DASHBOARD.ID_SITE (todo site configurado para
// este dashboard), não IBP.PEDRAVISAOCONSOLIDADA: partir de PVC por
// INNER JOIN omite qualquer site cadastrado no DASHBOARD mas ainda sem
// linhas de fato/orçamento — causa-raiz de sites "faltando" no filtro.
const SITES_SQL = `
SELECT DISTINCT
  S.ID_SITE,
  CASE LTRIM(RTRIM(S.NM_SITE))
    WHEN 'VNL Operations'      THEN 'VNL'
    WHEN 'Ontario Operations'  THEN 'Ontario'
    WHEN 'Matsusaka | Tonimet' THEN 'Matsusaka'
    WHEN 'Clydach | CNR'       THEN 'Clydach'
    ELSE LTRIM(RTRIM(S.NM_SITE))
  END AS NM_SITE
FROM IBP.SITES S
RIGHT JOIN IBP.DASHBOARD D
  ON D.ID_SITE = S.ID_SITE
WHERE D.ID_DASH = 21
  AND S.NM_SITE IS NOT NULL
  AND LTRIM(RTRIM(S.NM_SITE)) <> ''
ORDER BY NM_SITE`;

const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Configuração dos gráficos (painel de edição do index.html) ──────
// Uma linha por gráfico salvo: NM_GRAFICO (único) + DS_CONFIG (JSON só com
// apresentação: título, casas decimais, unidade e cores — nunca dados).
// Script da tabela: database/001_config_grafico.sql. O nome da tabela vem
// de PERFORMANCEHUB_CONFIG_TABLE (padrão abaixo) e é validado antes de entrar
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
const CONFIG_UNIDADES = ['', 't', 'Kt', 'Mt', '%', 'US$', 'KUSD', 'MUSD', 'BUSD', 'custom'];

function tabelaConfig(nome) {
  const t = nome || CONFIG_TABELA_PADRAO;
  if (!/^[A-Za-z_]\w{0,63}\.[A-Za-z_]\w{0,127}$/.test(t)) throw new Error(`PERFORMANCEHUB_CONFIG_TABLE inválida: "${t}" (use ESQUEMA.TABELA)`);
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
    // Id do tipo de gráfico (catálogo TIPOS_GRAFICO no index.html); padrão 'bar'
    tipoGrafico: typeof c.tipoGrafico === 'string' && /^[a-z][a-z0-9-]{0,19}$/.test(c.tipoGrafico) ? c.tipoGrafico : 'bar',
    exibirDelta: c.exibirDelta !== false,
    linhas: normalizarLinhas(c.linhas),
    modoCor: c.modoCor === 'coluna' ? 'coluna' : 'grupo',
    paletaColunas: CONFIG_PALETAS.includes(c.paletaColunas) ? c.paletaColunas : '',
    fontes: normalizarFontes(c.fontes),
    // Ordem das colunas (seção Colunas): rótulos de Type na ordem escolhida
    ordemColunas: normalizarOrdemColunas(c.ordemColunas),
    // Deltas ligados manualmente (seção Colunas): rótulo da coluna que compara com a anterior
    deltasManuais: normalizarOrdemColunas(c.deltasManuais),
    cores,
  };
}

const CONFIG_ORDEM_ROTULO = /^[A-Za-z0-9 ._\/-]{1,24}$/;
const CONFIG_ORDEM_MAX = 200;
function normalizarOrdemColunas(v) {
  const vistos = new Set();
  return (Array.isArray(v) ? v : [])
    .filter(t => typeof t === 'string' && CONFIG_ORDEM_ROTULO.test(t) && !vistos.has(t) && vistos.add(t))
    .slice(0, CONFIG_ORDEM_MAX);
}

// Fontes do gráfico (aba Fontes): escala 70–160% em passos de 10, negrito,
// itálico e cor (#RRGGBB ou '' = automática). Deltas não têm cor própria.
const FONTE_PADRAO = { titulo: false, unidade: false, valores: false, deltas: false, eixo: false }; // Regular: negrito só se marcado
function normalizarFontes(entrada) {
  const f = entrada && typeof entrada === 'object' ? entrada : {};
  const saida = {};
  Object.keys(FONTE_PADRAO).forEach(k => {
    const e = f[k] && typeof f[k] === 'object' ? f[k] : {};
    const n = Math.round(Number(e.escala) / 10) * 10;
    saida[k] = {
      escala: n >= 70 && n <= 160 ? n : 100,
      negrito: typeof e.negrito === 'boolean' ? e.negrito : FONTE_PADRAO[k],
      italico: e.italico === true,
      cor: k !== 'deltas' && /^#[0-9A-F]{6}$/i.test(e.cor || '') ? e.cor.toUpperCase() : '',
    };
  });
  return saida;
}

// ── Background da apresentação ──────────────────────────────────────────
// Configuração GLOBAL do dashboard (o Performance Hub não tem preferência por
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
    // Percentis exibidos como linhas de referência (1–99, até 5) e a série-base
    percentis: [...new Set((Array.isArray(l.percentis) ? l.percentis : []).map(Number)
      .filter(x => Number.isInteger(x) && x >= 1 && x <= 99))].sort((x, y) => x - y).slice(0, 5),
    percentilBase: ['serie:AF', 'serie:B', 'serie:P', 'todas'].includes(l.percentilBase) ? l.percentilBase : 'serie:AF',
  };
}

function lerConfigGravada(json) {
  try { return normalizarConfig(JSON.parse(json)); } catch (e) { return normalizarConfig(null); }
}

// 208 = objeto inexistente (tabela ainda não criada); 229/230 = sem permissão.
function respostaDeErroConfig(res, err, acao) {
  console.error(`[performance-hub] config-graficos (${acao}):`, err.message);
  if (err.number === 208) return res.status(503).json({ error: 'Tabela de configuração dos gráficos não encontrada no banco.', codigo: 'SEM_TABELA' });
  if (err.number === 229 || err.number === 230) return res.status(503).json({ error: 'Sem permissão na tabela de configuração dos gráficos.', codigo: 'SEM_PERMISSAO' });
  return res.status(500).json({ error: `Falha ao ${acao} a configuração.`, codigo: 'ERRO_BANCO' });
}

/**
 * Monta o router com /chart-data, /sites e /ping.
 *
 * O router pode ser montado em VÁRIOS caminhos (a raiz monta nos quatro
 * candidatos, porque de fora não dá para saber se o Databricks Apps
 * entrega "/Performance-Hub/api/..." ou já sem o prefixo da pasta). Montar a
 * MESMA instância em todos compartilha o cache — não multiplica ida ao
 * banco.
 */
// ── Dashboards gravados no banco (database/004_dashboards.sql) ──────────
// IBP.PHUB_PS_SETUP: um dashboard por linha, gráficos em JSON (DS_LAYOUT).
// IBP.PHUB_PS_ACESSO: editores escolhidos pelo dono (e-mails da IBP.USERS).
// Dono altera, ativa/desativa, exclui e define editores; editor altera e
// reutiliza; os demais usuários do Performance Hub só visualizam os ativos.
const DASH_SETUP = 'IBP.PHUB_PS_SETUP';
const DASH_ACESSO = 'IBP.PHUB_PS_ACESSO';
const DASH_VISOES = ['VBM_PRODUCTION_ANALYTICS'];
const DASH_NOME_MAX = 100;     // = NVARCHAR(100) de NM_DASHBOARD
const DASH_DESC_MAX = 500;     // = NVARCHAR(500) de DS_DASHBOARD
const DASH_GRAFICOS_MAX = 30;
const DASH_EDITORES_MAX = 50;
const EMAIL_MAX = 200;         // = NVARCHAR(200) de NM_USUARIO
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[A-Za-z]{2,}$/;

// E-mail em minúsculas, ou null se vazio/inválido
function lerEmail(valor) {
  const e = String(valor || '').trim().toLowerCase();
  return e.length <= EMAIL_MAX && EMAIL_RE.test(e) ? e : null;
}

// Corpo de criação/alteração → valores prontos para gravar, ou { erro, campo }
function normalizarDashboard(entrada) {
  const c = entrada && typeof entrada === 'object' ? entrada : {};
  const nome = typeof c.nome === 'string' ? c.nome.trim() : '';
  if (!nome) return { erro: 'Informe o nome do dashboard.', campo: 'nome' };
  if (nome.length > DASH_NOME_MAX) return { erro: `O nome do dashboard aceita no máximo ${DASH_NOME_MAX} caracteres.`, campo: 'nome' };
  const descricao = typeof c.descricao === 'string' ? c.descricao.trim().slice(0, DASH_DESC_MAX) : '';
  if (!DASH_VISOES.includes(c.visao)) return { erro: 'Visão inválida.', campo: 'visao' };
  const dtRef = lerDtRef(c.dtRef);
  if (!dtRef) return { erro: 'Mês de referência inválido: use AAAA-MM.', campo: 'dtRef' };
  const g = c.layout && c.layout.charts;
  if (!Array.isArray(g) || g.length > DASH_GRAFICOS_MAX || g.some(x => !x || typeof x !== 'object' || Array.isArray(x))) {
    return { erro: `Gráficos inválidos (até ${DASH_GRAFICOS_MAX} por dashboard).`, campo: 'layout' };
  }
  return { nome, descricao: descricao || null, visao: c.visao, dtRef, layout: JSON.stringify({ charts: g }) };
}

// Linha do banco → objeto da API (papel do usuário: dono, editor ou leitor)
function dashboardDaLinha(l, email) {
  let layout = { charts: [] };
  try { layout = JSON.parse(l.DS_LAYOUT); } catch (e) { /* CHECK ISJSON garante; defesa */ }
  return {
    id: l.ID_DASHBOARD,
    nome: l.NM_DASHBOARD,
    descricao: l.DS_DASHBOARD || '',
    visao: l.CD_VISAO,
    dtRef: new Date(l.DT_REF).toISOString().slice(0, 7),
    ativo: l.SG_ATIVO === 'S',
    dono: l.NM_USUARIO_CRIACAO,
    papel: l.NM_USUARIO_CRIACAO === email ? 'dono' : l.EDITOR ? 'editor' : 'leitor',
    criadoEm: l.DT_CRIACAO,
    atualizadoEm: l.DT_ATUALIZACAO,
    atualizadoPor: l.NM_USUARIO,
    layout,
  };
}

function criarPerformanceHubRouter({ runQuery, tabelaConfiguracao, armazenamento, pastaFundos }) {
  if (typeof runQuery !== 'function') {
    throw new Error('criarPerformanceHubRouter: `runQuery` é obrigatório');
  }
  const T = tabelaConfig(tabelaConfiguracao);

  const router = express.Router();
  const cache = new Map();

  async function comCache(chave, buscar) {
    const item = cache.get(chave);
    if (item && item.expiraEm > Date.now()) return item.dados;
    const dados = await buscar();
    if (dados !== null) cache.set(chave, { dados, expiraEm: Date.now() + CACHE_TTL_MS }); // "sem carga" não fica em cache
    return dados;
  }

  // `buscar`: função que devolve as linhas (vai para o cache)
  function rota(caminho, chaveCache, buscar, oQueFalhou) {
    router.get(caminho, async (req, res) => {
      try {
        const dados = await comCache(chaveCache, buscar);
        res.json(dados);
      } catch (err) {
        console.error(`[performance-hub] Erro ao buscar ${chaveCache}:`, err.message);
        res.status(500).json({ error: oQueFalhou, detalhe: err.message });
      }
    });
  }

  // Diagnóstico que NÃO toca no banco: separa "código não publicado"
  // (404 aqui) de "publicado, mas o banco falha" (200 aqui + 500 abaixo).
  router.get('/ping', (req, res) => {
    res.json({ ok: true, caminhoRecebido: req.originalUrl });
  });

  const tabelaInexistente = (err) => (err.number ?? err.originalError?.info?.number) === SQL_OBJETO_INEXISTENTE;

  // Lê uma carga de IBP.PHUB_PERFORMANCESTUDIO: a do mês escolhido (dtRef) ou,
  // sem escolha, a mais recente. Mês escolhido sem carga → null (a rota
  // responde 404; nunca troca por outro mês). Sem escolha e sem tabela/carga,
  // cai na consulta ao vivo e avisa no log; outro erro do banco segue como erro.
  async function buscarChartData(dtRef) {
    try {
      const r = await runQuery(CHART_DATA_SQL, {
        dtRef: [sql.Date, dtRef && new Date(`${dtRef}T00:00:00Z`)],
        idDash: [sql.Int, ID_DASH],
      });
      if (r.recordset.length) return r.recordset;
      if (dtRef) return null;
      console.warn('[performance-hub] IBP.PHUB_PERFORMANCESTUDIO sem carga para o dashboard: usando a consulta ao vivo');
    } catch (err) {
      if (!tabelaInexistente(err)) throw err;
      if (dtRef) return null;
      console.warn('[performance-hub] IBP.PHUB_PERFORMANCESTUDIO não existe nesta base: usando a consulta ao vivo');
    }
    // Ao vivo, o DT_REF da query é o período da linha: vira DT_IND, como na tabela
    const r = await runQuery(CHART_DATA_AO_VIVO_SQL);
    return r.recordset.map(({ DT_REF, ...linha }) => ({ DT_REF: null, DT_IND: DT_REF, ...linha }));
  }

  // ?dtRef=AAAA-MM = mês de referência = mês final do YTD (opcional)
  router.get('/chart-data', async (req, res) => {
    const dtRef = lerDtRef(req.query.dtRef);
    if (dtRef === undefined) {
      return res.status(400).json({ error: 'dtRef inválido: use AAAA-MM (mês de referência do YTD).', campo: 'dtRef' });
    }
    try {
      const dados = await comCache(`chart-data:${dtRef || 'ultima'}`, () => buscarChartData(dtRef));
      if (dados === null) {
        return res.status(404).json({ error: `Sem carga para a referência ${dtRef.slice(0, 7)}.`, codigo: 'SEM_CARGA', dtRef: dtRef.slice(0, 7) });
      }
      res.json(dados);
    } catch (err) {
      console.error('[performance-hub] Erro ao buscar chart-data:', err.message);
      res.status(500).json({ error: 'Failed to fetch chart data', detalhe: err.message });
    }
  });

  // Meses de referência (YTD) com carga, para a escolha na tela; sem tabela → []
  rota('/chart-data/referencias', 'referencias', async () => {
    try {
      const r = await runQuery(REFERENCIAS_SQL, { idDash: [sql.Int, ID_DASH] });
      return r.recordset.map(l => ({ dtRef: new Date(l.DT_REF).toISOString().slice(0, 7), nome: l.NM_YTD, atualizadoEm: l.DT_ATUALIZACAO }));
    } catch (err) {
      if (tabelaInexistente(err)) return [];
      throw err;
    }
  }, 'Failed to fetch references');
  rota('/sites', 'sites', async () => (await runQuery(SITES_SQL)).recordset, 'Failed to fetch sites');

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
      console.error('[performance-hub] upload de fundo: armazenamento de imagens não configurado');
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
        console.error('[performance-hub] upload de fundo falhou:', e.message);
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
      console.error('[performance-hub] leitura de fundo falhou:', e.message);
      res.status(404).json({ error: 'Imagem não encontrada.' });
    }
  });

  // ── Dashboards ───────────────────────────────────────────────────────
  // Usuário = X-Forwarded-Email (proxy do Databricks Apps; o navegador não o
  // forja). Sem ele: 401. Todos os valores entram por parâmetro.
  const jsonDash = express.json({ limit: '256kb' });
  const DASH_DUPLICADO = { error: 'Já existe um dashboard ativo deste dono com este nome. Escolha outro nome.', campo: 'nome', codigo: 'NOME_DUPLICADO' };
  const nomeDuplicado = err => err.number === 2627 || err.number === 2601;
  const lerId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };
  const COLUNAS_DASH = `S.ID_DASHBOARD, S.NM_DASHBOARD, S.DS_DASHBOARD, S.CD_VISAO, S.DT_REF, S.DS_LAYOUT, S.SG_ATIVO,
    S.NM_USUARIO_CRIACAO, S.DT_CRIACAO, S.NM_USUARIO, S.DT_ATUALIZACAO,
    CASE WHEN A.NM_USUARIO IS NULL THEN 0 ELSE 1 END AS EDITOR
    FROM ${DASH_SETUP} S
    LEFT JOIN ${DASH_ACESSO} A ON A.ID_DASHBOARD = S.ID_DASHBOARD AND A.NM_USUARIO = @email`;

  // Rota com usuário identificado; erro de banco → 500 sem detalhes internos
  const comUsuario = (acao, handler) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const email = lerEmail(req.get('X-Forwarded-Email'));
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.' });
    try {
      await handler(req, res, email);
    } catch (err) {
      console.error(`[performance-hub] dashboards (${acao}):`, err.message);
      if (!res.headersSent) res.status(500).json({ error: `Falha ao ${acao} o dashboard.`, codigo: 'ERRO_BANCO' });
    }
  };

  // Um dashboard visível para o usuário (inativo só para o dono); null = não existe
  async function lerUmDashboard(id, email) {
    const r = await runQuery(`SELECT ${COLUNAS_DASH} WHERE S.ID_DASHBOARD = @id`,
      { id: [sql.Int, id], email: [sql.NVarChar(EMAIL_MAX), email] });
    const l = r.recordset[0];
    return l && (l.SG_ATIVO === 'S' || l.NM_USUARIO_CRIACAO === email) ? dashboardDaLinha(l, email) : null;
  }
  // Dashboard de :id se o papel do usuário estiver em `papeis`; senão responde e devolve null
  async function dashboardPermitido(req, res, email, papeis) {
    const id = lerId(req.params.id);
    if (!id) { res.status(400).json({ error: 'Identificador de dashboard inválido.' }); return null; }
    const d = await lerUmDashboard(id, email);
    if (!d) { res.status(404).json({ error: 'Dashboard não encontrado.' }); return null; }
    if (!papeis.includes(d.papel)) {
      res.status(403).json({ error: d.papel === 'leitor' ? 'Você tem acesso só de leitura a este dashboard.' : 'Só o dono do dashboard pode fazer isso.' });
      return null;
    }
    return d;
  }
  const paramsDash = (v, email) => ({
    nome: [sql.NVarChar(DASH_NOME_MAX), v.nome],
    descricao: [sql.NVarChar(DASH_DESC_MAX), v.descricao],
    visao: [sql.VarChar(40), v.visao],
    dtRef: [sql.Date, new Date(`${v.dtRef}T00:00:00Z`)],
    layout: [sql.NVarChar(sql.MAX), v.layout],
    email: [sql.NVarChar(EMAIL_MAX), email],
  });

  // Usuários da IBP.USERS com CD_MATRICULA (mesma regra do controle de acesso do Portal)
  let colunaUsuarios = null;
  function colunaEmailUsuarios() {
    if (!colunaUsuarios) {
      colunaUsuarios = Promise.resolve()
        .then(() => require('../portal-acesso'))
        .then(m => m.descobrirColunaEmail(runQuery).then(coluna => ({ coluna, tabela: `[${m.TABELA_USUARIOS.esquema}].[${m.TABELA_USUARIOS.nome}]` })))
        .catch(err => { colunaUsuarios = null; throw err; });
    }
    return colunaUsuarios;
  }
  const filtroMatricula = `CD_MATRICULA IS NOT NULL AND LTRIM(RTRIM(CAST(CD_MATRICULA AS NVARCHAR(100)))) <> ''`;

  router.get('/dashboards', comUsuario('listar', async (req, res, email) => {
    const r = await runQuery(`SELECT ${COLUNAS_DASH} WHERE S.SG_ATIVO = 'S' OR S.NM_USUARIO_CRIACAO = @email ORDER BY S.NM_DASHBOARD`,
      { email: [sql.NVarChar(EMAIL_MAX), email] });
    res.json({ usuario: email, itens: r.recordset.map(l => dashboardDaLinha(l, email)) });
  }));

  // Criar (origemId = reutilizar outro: exige ser dono ou editor da origem)
  router.post('/dashboards', jsonDash, comUsuario('criar', async (req, res, email) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envie JSON.' });
    const v = normalizarDashboard(req.body);
    if (v.erro) return res.status(400).json({ error: v.erro, campo: v.campo });
    if (req.body.origemId != null) {
      const id = lerId(req.body.origemId);
      const origem = id && await lerUmDashboard(id, email);
      if (!origem) return res.status(404).json({ error: 'Dashboard de origem não encontrado.' });
      if (origem.papel === 'leitor') return res.status(403).json({ error: 'Você tem acesso só de leitura ao dashboard de origem.' });
    }
    try {
      const r = await runQuery(
        `INSERT INTO ${DASH_SETUP} (NM_DASHBOARD, DS_DASHBOARD, CD_VISAO, DT_REF, DS_LAYOUT, NM_USUARIO_CRIACAO, NM_USUARIO)
         OUTPUT INSERTED.ID_DASHBOARD
         VALUES (@nome, @descricao, @visao, @dtRef, @layout, @email, @email)`, paramsDash(v, email));
      res.status(201).json(await lerUmDashboard(r.recordset[0].ID_DASHBOARD, email));
    } catch (err) {
      if (nomeDuplicado(err)) return res.status(409).json(DASH_DUPLICADO);
      throw err;
    }
  }));

  // Alterar nome, descrição, referência e gráficos (dono ou editor)
  router.put('/dashboards/:id', jsonDash, comUsuario('alterar', async (req, res, email) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envie JSON.' });
    const d = await dashboardPermitido(req, res, email, ['dono', 'editor']);
    if (!d) return;
    const v = normalizarDashboard(req.body);
    if (v.erro) return res.status(400).json({ error: v.erro, campo: v.campo });
    try {
      await runQuery(
        `UPDATE ${DASH_SETUP}
         SET NM_DASHBOARD = @nome, DS_DASHBOARD = @descricao, CD_VISAO = @visao, DT_REF = @dtRef, DS_LAYOUT = @layout,
             NM_USUARIO = @email, DT_ATUALIZACAO = SYSUTCDATETIME()
         WHERE ID_DASHBOARD = @id`, { ...paramsDash(v, email), id: [sql.Int, d.id] });
      res.json(await lerUmDashboard(d.id, email));
    } catch (err) {
      if (nomeDuplicado(err)) return res.status(409).json(DASH_DUPLICADO);
      throw err;
    }
  }));

  // Ativar / desativar (dono)
  router.put('/dashboards/:id/ativo', jsonDash, comUsuario('ativar ou desativar', async (req, res, email) => {
    const ativo = req.body && req.body.ativo;
    if (typeof ativo !== 'boolean') return res.status(400).json({ error: 'Informe ativo: true ou false.', campo: 'ativo' });
    const d = await dashboardPermitido(req, res, email, ['dono']);
    if (!d) return;
    try {
      await runQuery(
        `UPDATE ${DASH_SETUP} SET SG_ATIVO = @ativo, NM_USUARIO = @email, DT_ATUALIZACAO = SYSUTCDATETIME() WHERE ID_DASHBOARD = @id`,
        { ativo: [sql.Char(1), ativo ? 'S' : 'N'], email: [sql.NVarChar(EMAIL_MAX), email], id: [sql.Int, d.id] });
      res.json(await lerUmDashboard(d.id, email));
    } catch (err) {
      // Reativar com o nome já usado por outro dashboard ativo do dono
      if (nomeDuplicado(err)) return res.status(409).json(DASH_DUPLICADO);
      throw err;
    }
  }));

  // Excluir de vez (dono); os editores saem junto (ON DELETE CASCADE)
  router.delete('/dashboards/:id', comUsuario('excluir', async (req, res, email) => {
    const d = await dashboardPermitido(req, res, email, ['dono']);
    if (!d) return;
    await runQuery(`DELETE FROM ${DASH_SETUP} WHERE ID_DASHBOARD = @id AND NM_USUARIO_CRIACAO = @email`,
      { id: [sql.Int, d.id], email: [sql.NVarChar(EMAIL_MAX), email] });
    res.json({ ok: true, id: d.id });
  }));

  // Editores (dono)
  router.get('/dashboards/:id/acessos', comUsuario('ler os editores do', async (req, res, email) => {
    const d = await dashboardPermitido(req, res, email, ['dono']);
    if (!d) return;
    const r = await runQuery(`SELECT NM_USUARIO FROM ${DASH_ACESSO} WHERE ID_DASHBOARD = @id ORDER BY NM_USUARIO`, { id: [sql.Int, d.id] });
    res.json({ editores: r.recordset.map(l => l.NM_USUARIO) });
  }));

  // Substitui a lista de editores; só e-mails da IBP.USERS com CD_MATRICULA
  router.put('/dashboards/:id/acessos', jsonDash, comUsuario('compartilhar', async (req, res, email) => {
    const lista = req.body && req.body.editores;
    if (!Array.isArray(lista) || lista.length > DASH_EDITORES_MAX) {
      return res.status(400).json({ error: `Informe a lista de editores (até ${DASH_EDITORES_MAX}).`, campo: 'editores' });
    }
    const invalidos = lista.filter(e => !lerEmail(e));
    if (invalidos.length) return res.status(400).json({ error: 'E-mail inválido.', campo: 'editores', invalidos });
    const d = await dashboardPermitido(req, res, email, ['dono']);
    if (!d) return;
    const editores = [...new Set(lista.map(lerEmail))].filter(e => e !== d.dono);
    const paramsEmails = Object.fromEntries(editores.map((e, i) => [`e${i}`, [sql.NVarChar(EMAIL_MAX), e]]));
    if (editores.length) {
      const { coluna, tabela } = await colunaEmailUsuarios();
      const r = await runQuery(
        `SELECT DISTINCT LOWER(LTRIM(RTRIM([${coluna}]))) AS EMAIL FROM ${tabela}
         WHERE LOWER(LTRIM(RTRIM([${coluna}]))) IN (${editores.map((_, i) => `@e${i}`).join(', ')}) AND ${filtroMatricula}`, paramsEmails);
      const cadastrados = new Set(r.recordset.map(l => l.EMAIL));
      const fora = editores.filter(e => !cadastrados.has(e));
      if (fora.length) return res.status(400).json({ error: 'Só é possível compartilhar com usuários cadastrados no Portal.', campo: 'editores', invalidos: fora });
    }
    await runQuery(
      `SET XACT_ABORT ON;
       BEGIN TRANSACTION;
       DELETE FROM ${DASH_ACESSO} WHERE ID_DASHBOARD = @id;
       ${editores.length ? `INSERT INTO ${DASH_ACESSO} (ID_DASHBOARD, NM_USUARIO) VALUES ${editores.map((_, i) => `(@id, @e${i})`).join(', ')};` : ''}
       COMMIT TRANSACTION;`,
      { id: [sql.Int, d.id], ...paramsEmails });
    res.json({ editores });
  }));

  // E-mails que podem ser editores (sugestões na tela); 10 min em cache
  let usuariosCache = null;
  router.get('/usuarios', comUsuario('listar os usuários para o', async (req, res) => {
    if (!usuariosCache || usuariosCache.expiraEm < Date.now()) {
      const { coluna, tabela } = await colunaEmailUsuarios();
      const r = await runQuery(
        `SELECT DISTINCT TOP (5000) LOWER(LTRIM(RTRIM([${coluna}]))) AS EMAIL FROM ${tabela}
         WHERE [${coluna}] IS NOT NULL AND ${filtroMatricula} ORDER BY EMAIL`);
      usuariosCache = { itens: r.recordset.map(l => l.EMAIL).filter(e => lerEmail(e)), expiraEm: Date.now() + 10 * 60 * 1000 };
    }
    res.json({ itens: usuariosCache.itens });
  }));

  return router;
}

module.exports = { criarPerformanceHubRouter, normalizarConfig, normalizarFundo, normalizarDashboard, CHART_DATA_SQL, CHART_DATA_AO_VIVO_SQL, REFERENCIAS_SQL, SITES_SQL, lerDtRef };
