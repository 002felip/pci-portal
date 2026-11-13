DECLARE

@DT_INI AS DATE,
@DT_FIM AS DATE,
@DT_REF AS DATE

SET @DT_INI = '2025-01-01'
SET @DT_FIM = CAST(DATEADD(MONTH, 0, CONCAT(YEAR(DATEFROMPARTS(YEAR(DATEADD(MONTH, 0, GETDATE()-1)), MONTH(DATEADD(MONTH, -1, GETDATE()-1)), 1)), '-12-01')) AS DATE)
SET @DT_REF =  DATEADD(MONTH, -1, GETDATE()-2)  --(SELECT DATEADD(MONTH, -1, DT_INI) AS DT_INI_MENOS_1_MES FROM IBP.CONTROLE_PROCESSOS WHERE ID_PROCESSO = 2)



-- select @DT_REF  -- (depuração: um 2º resultado quebraria o dashboard)
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
--------------------------------------                        DADOS DO SOUTH ATLANTIC                            -----------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                                           MONTH                                               -----------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------

-- ════════════════════════════════════════════════════════════════════
-- VBM Health of the Business — carga mensal em IBP.PHUB_PERFORMANCESTUDIO (ID_DASH 16)
-- Idêntica ao 003_carga_mensal_coo.sql do COO Business Units Dashboard, com estas diferenças:
--   ID_DASH 16 no lugar do 15; dados a partir de 2025 (@DT_INI), sem a série histórica anual;
--   blocos YTD (IBP.PEDRAVISAOYEARTODATE) e YTG (IBP.PEDRAVISAOYEARTOGO) no fim.
-- Campos incluídos na query (como no COO): ID_TIPO_VISAO_VBM, CD_PERIODO, ORDEM_VISAO, ORDEM_ANO e ORDEM_PERIODO.
--   DT_REF (tabela) = mês em fechamento (M-1 de GETDATE()-2), no dia 1: ex.: em 12/11/2026 → 2026-10-01 (fechamento de outubro)
--   DT_IND (tabela), tudo amarrado na DT_REF da carga (@DT_CARGA):
--     MONTH   → todos os meses (DT_REF da linha)
--     QUARTER → um por trimestre, no 1º mês dele (meses 1, 4, 7 e 10)
--     YEAR    → um por ano, no mês da DT_REF (carga 2026-10-01 → 2025-10-01 e 2026-10-01)
--     YTD     → um só, no mês da DT_REF (ano da carga): IBP.PEDRAVISAOYEARTODATE desse mês (jan até o mês)
--     YTG     → um só, no mês da DT_REF (ano da carga): o restante do ano depois do mês da DT_REF (M-1)
--                 Budget   = Budget total do ano (PEDRAVISAOANO.VL_ORC)   − Budget acumulado até M-1 (YEARTODATE.VL_ORC)
--                 Forecast = Forecast total do ano (PEDRAVISAOANO.VL_PROJ) − Actual acumulado até M-1 (YEARTODATE.VL_REAL)
--               M-1 = mês da DT_REF da carga (mês em fechamento): YTD + YTG = ano.
--               CD_PERIODO precisa aceitar 'YTG' (006_cd_periodo_ytg.sql, uma vez só)
--   Rodar de novo no mesmo mês apaga e regrava só DT_REF + ID_DASH 16.
-- ════════════════════════════════════════════════════════════════════
SET XACT_ABORT ON;

DECLARE @ID_DASH  INT  = 16;
DECLARE @DT_CARGA DATE = DATEADD(MONTH, -1, DATEFROMPARTS(YEAR(GETDATE() - 2), MONTH(GETDATE() - 2), 1));  -- mês em fechamento: 12/11/2026 → 2026-10-01

BEGIN TRANSACTION;

DELETE FROM IBP.PHUB_PERFORMANCESTUDIO
WHERE DT_REF = @DT_CARGA AND ID_DASH = @ID_DASH;

INSERT INTO IBP.PHUB_PERFORMANCESTUDIO
  (DT_REF, DT_IND, ID_DASH, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI,
   ID_TIPO_VISAO, NM_TIPO_VISAO, NM_VISAO, VL_KPI,
   CD_PERIODO, ORDEM_VISAO, ORDEM_ANO, ORDEM_PERIODO)
SELECT
  @DT_CARGA, COO.DT_REF, @ID_DASH, COO.ID_SISTEMA, COO.ID_SITE, COO.ID_OPERACAO, COO.ID_KPI,
  COO.ID_TIPO_VISAO_VBM, MAX(COO.NM_TIPO_VISAO), MAX(COO.NM_VISAO), SUM(ISNULL(COO.VL_KPI, 0)),
  COO.CD_PERIODO, COO.ORDEM_VISAO, COO.ORDEM_ANO, COO.ORDEM_PERIODO
FROM (

	SELECT
		PVC.DT_REF,
		PVC.ID_SISTEMA,
		PVC.ID_SITE,
		PVC.ID_OPERACAO,
		PVC.ID_KPI,
		DASH.NM_KPIS_DASH AS 'NM_KPI',
		DASH.ID_ORDEM,
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 0
					WHEN UnpivotedData.Type = 'Supply' THEN 1
					ELSE 2 END AS 'ORDEM_GRAFICO',

		CASE WHEN UnpivotedData.Type = 'Budget' THEN 0
					WHEN UnpivotedData.Type = 'Supply' THEN 2
					ELSE 1 END AS 'ID_TIPO_VISAO',

		CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget'
					WHEN UnpivotedData.Type = 'Supply' THEN 'Plan'
					ELSE 'Act/Fcst' END AS 'NM_TIPO_VISAO',


		CASE WHEN UnpivotedData.Type = 'Budget'  THEN CONCAT(FORMAT(DT_REF, 'MMM'),' B')
					WHEN UnpivotedData.Type = 'Supply'  THEN CONCAT(FORMAT(DT_REF, 'MMM'),' P')
					--WHEN UnpivotedData.Type = 'Forecast'  AND PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) THEN CONCAT(FORMAT(DT_REF, 'MMM'),' A')
					WHEN UnpivotedData.Type = 'Forecast'  AND PVC.DT_REF <= @DT_REF THEN CONCAT(FORMAT(DT_REF, 'MMM'),' A')
					WHEN UnpivotedData.Type = 'Forecast'  THEN CONCAT(FORMAT(DT_REF, 'MMM'),' F')
					--ELSE CONCAT(FORMAT(DT_REF, 'MMM'),' A')
					--ELSE '1'
					END AS 'NM_VISAO',
		DASH.SG_UNID,
		DASH.VL_CASADECIMAL,
		CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END AS VL_KPI,
		-- Campos para IBP.PHUB_PERFORMANCESTUDIO (VBM)
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 3 END AS 'ID_TIPO_VISAO_VBM',
		'MONTH' AS 'CD_PERIODO',
		1 AS 'ORDEM_VISAO',
		YEAR(PVC.DT_REF) AS 'ORDEM_ANO',
		MONTH(PVC.DT_REF) AS 'ORDEM_PERIODO'


	FROM
		IBP.PEDRAVISAOCONSOLIDADA PVC
		INNER JOIN IBP.DASHBOARD DASH
			ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
			AND CONCAT(PVC.ID_SITE, '|', PVC.ID_OPERACAO, '|', PVC.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
		CROSS APPLY (
			SELECT 'Budget' AS Type, PVC.VL_ORC  * DASH.VL_FATOR AS Value
			UNION ALL
			SELECT 'Supply' AS Type, PVC.VL_SUPPLY  * DASH.VL_FATOR AS Value
			--UNION ALL
			--SELECT 'Actual' AS Type, PVC.VL_REAL  * DASH.VL_FATOR AS Value
			UNION ALL
			SELECT 'Forecast' AS Type,
			CASE WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
						WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS  NOT NULL THEN PVC.VL_REAL  * DASH.VL_FATOR
			ELSE PVC.VL_PROJ  * DASH.VL_FATOR END AS Value
		) AS UnpivotedData
	WHERE
		PVC.DT_REF  BETWEEN @DT_INI  AND @DT_FIM
		AND DASH.ID_DASH = 16



		UNION ALL



----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
---------------------------------------                        DADOS DO SOUTH ATLANTIC                     --------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                                          QUARTER                                             -----------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------


SELECT
DT_REF,
ID_SISTEMA,
ID_SITE,
ID_OPERACAO,
ID_KPI,
NM_KPI,
ID_ORDEM,
ORDEM_GRAFICO,
ID_TYPE AS 'ID_TIPO_VISAO',
NM_TYPE AS 'NM_TIPO_VISAO',
[Type] AS 'NM_VISAO',
SG_UNID,
VL_CASADECIMAL,
[Value] AS 'VL_KPI',
-- Campos para IBP.PHUB_PERFORMANCESTUDIO (VBM)
ID_TYPE_VBM AS 'ID_TIPO_VISAO_VBM',
'QUARTER' AS 'CD_PERIODO',
2 AS 'ORDEM_VISAO',
YEAR(DT_REF_T) AS 'ORDEM_ANO',
DATEPART(QUARTER, DT_REF_T) AS 'ORDEM_PERIODO'




FROM (


	SELECT
		DATEFROMPARTS(YEAR(PVT.DT_REF), (DATEPART(QUARTER, PVT.DT_REF) - 1) * 3 + 1, 1) AS DT_REF,  -- 1º mês do trimestre (1, 4, 7, 10)
		PVT.DT_REF AS 'DT_REF_T',
		CASE WHEN  (MONTH(PVT.DT_REF) <= 3) AND (MONTH(PVT.DT_REF) <= 3)   THEN '1'
					WHEN  (MONTH(PVT.DT_REF) > 3 AND MONTH(PVT.DT_REF) <= 6) AND (MONTH(PVT.DT_REF) > 3 AND MONTH(PVT.DT_REF) <= 6)  THEN '2'
					WHEN  (MONTH(PVT.DT_REF) > 6 AND MONTH(PVT.DT_REF) <= 9) AND (MONTH(PVT.DT_REF) > 6 AND MONTH(PVT.DT_REF) <= 9)  THEN '3'
					WHEN  (MONTH(PVT.DT_REF) > 9 AND MONTH(PVT.DT_REF) <= 12) AND (MONTH(PVT.DT_REF) > 9 AND MONTH(PVT.DT_REF) <= 12)  THEN '4'
		ELSE 0
		END 'QREF',

		PVT.ID_SISTEMA,
		PVT.ID_SITE,
		PVT.ID_OPERACAO,
		PVT.ID_KPI,
		DASH.NM_KPIS_DASH AS 'NM_KPI',
		DASH.ID_ORDEM,
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 3 ELSE 4 END AS 'ORDEM_GRAFICO',
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 ELSE 1 END AS 'ID_TYPE',
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 ELSE 3 END AS 'ID_TYPE_VBM',  -- série no padrão do VBM


		CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget'
					WHEN UnpivotedData.Type = 'Supply' THEN 'Plan'
					ELSE 'Act/Fcst' END AS 'NM_TYPE',


		CASE WHEN UnpivotedData.Type = 'Budget' AND (MONTH(PVT.DT_REF) <= 3)  THEN 'Q1B'
					WHEN UnpivotedData.Type = 'Budget' AND (MONTH(PVT.DT_REF) > 3 AND MONTH(PVT.DT_REF) <= 6)  THEN 'Q2B'
					WHEN UnpivotedData.Type = 'Budget' AND (MONTH(PVT.DT_REF) > 6 AND MONTH(PVT.DT_REF) <= 9)  THEN 'Q3B'
					WHEN UnpivotedData.Type = 'Budget' AND (MONTH(PVT.DT_REF) > 9 AND MONTH(PVT.DT_REF) <= 12)  THEN 'Q4B'


					--WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-04','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-03','-01')) as date) THEN 'Q1A'
					--WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-07','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-06','-01')) as date) THEN 'Q2A'
					--WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-10','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-09','-01')) as date) THEN 'Q3A'
					--WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-12','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-12','-01')) as date)  THEN 'Q4A'

					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-03','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-03','-01')) as date) THEN 'Q1A'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-06','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-06','-01')) as date) THEN 'Q2A'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-09','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-09','-01')) as date) THEN 'Q3A'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-12','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-12','-01')) as date)  THEN 'Q4A'


					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-04','-01')) as date) > @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-03','-01')) as date) THEN 'Q1F'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-07','-01')) as date) > @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-06','-01')) as date) THEN 'Q2F'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-10','-01')) as date) > @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-09','-01')) as date) THEN 'Q3F'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-12','-01')) as date) > @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-12','-01')) as date)  THEN 'Q4F'

					END AS 'Type',

		DASH.SG_UNID,
		DASH.VL_CASADECIMAL,
		CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END AS [Value]


	FROM
		IBP.PEDRAVISAOTRIMESTRE PVT
		INNER JOIN IBP.DASHBOARD DASH
			ON PVT.ID_SISTEMA = DASH.ID_SISTEMA
			AND CONCAT(PVT.ID_SITE, '|', PVT.ID_OPERACAO, '|', PVT.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
		CROSS APPLY (
			SELECT 'Budget' AS Type, PVT.VL_ORC  * DASH.VL_FATOR AS Value
			UNION ALL
			--SELECT 'Supply' AS Type, PVT.VL_SUPPLY  * DASH.VL_FATOR AS Value
			--UNION ALL
			--SELECT 'Actual' AS Type, PVT.VL_REAL  * DASH.VL_FATOR AS Value
			--UNION ALL
			SELECT 'Forecast' AS Type, PVT.VL_PROJ  * DASH.VL_FATOR AS Value
		) AS UnpivotedData

		-- (sem repetir o trimestre em cada mês: uma linha por trimestre, no 1º mês dele)

--		LEFT JOIN IBP.PEDRAVISAOCONSOLIDADA PVC ON YEAR(PVC.DT_REF) = YEAR(PVT.DT_REF) AND CONCAT(PVT.ID_SITE, PVT.ID_OPERACAO, PVT.ID_KPI) = CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI)


	WHERE
		PVT.DT_REF  BETWEEN @DT_INI  AND @DT_FIM
		AND DASH.ID_DASH = 16
		-- só trimestres com mês carregado na tabela mensal no período (como antes)
		AND EXISTS (
			SELECT 1 FROM IBP.PEDRAVISAOCONSOLIDADA M
			WHERE M.DT_REF BETWEEN @DT_INI AND @DT_FIM
				AND YEAR(M.DT_REF) = YEAR(PVT.DT_REF)
				AND DATEPART(QUARTER, M.DT_REF) = DATEPART(QUARTER, PVT.DT_REF)
		)

		) AS QUERY
		WHERE QREF <> 0



		UNION ALL






------------------------------------------------------------------------------------------------------------------------------------------------------------
------------------------------------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                        DADOS  SOUTH ATLANTIC                              -----------------------------------------
------------------------------------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                                YEAR                                       -----------------------------------------
------------------------------------------------------------------------------------------------------------------------------------------------------------
------------------------------------------------------------------------------------------------------------------------------------------------------------






SELECT
    DATEFROMPARTS(PVA.ANO, MONTH(@DT_CARGA), 1) AS DT_REF,  -- ano no mês da DT_REF da carga (ex.: 2025-10-01, 2026-10-01)
	--CONCAT(PVA.ANO,'-01-01') AS 'DT_REF',
    PVA.ID_SISTEMA,
    PVA.ID_SITE,
    PVA.ID_OPERACAO,
    PVA.ID_KPI,
	DASH.NM_KPIS_DASH AS 'NM_KPI',
    DASH.ID_ORDEM,
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 6 ELSE 7 END AS 'ORDEM_GRAFICO',
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 ELSE 1 END AS 'ID_TIPO_VISAO',

	CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget'
				WHEN UnpivotedData.Type = 'Supply' THEN 'Plan'
				ELSE 'Act/Fcst' END AS 'NM_TIPO_VISAO',

    CASE WHEN UnpivotedData.Type = 'Budget' THEN  CONCAT(RIGHT(PVA.ANO,2),'B')
				WHEN PVA.ANO < YEAR(@DT_REF)  THEN CONCAT(RIGHT(PVA.ANO,2),'A')
	ELSE CONCAT(RIGHT(PVA.ANO,2),'F')
	END AS 'NM_VISAO',
	DASH.SG_UNID,
	DASH.VL_CASADECIMAL,
	UnpivotedData.Value AS 'VL_KPI',
	-- Campos para IBP.PHUB_PERFORMANCESTUDIO (VBM)
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 ELSE 3 END AS 'ID_TIPO_VISAO_VBM',
	'YEAR' AS 'CD_PERIODO',
	5 AS 'ORDEM_VISAO',
	PVA.ANO AS 'ORDEM_ANO',
	PVA.ANO AS 'ORDEM_PERIODO'




FROM
    IBP.PEDRAVISAOANO PVA
    INNER JOIN IBP.DASHBOARD DASH
        ON PVA.ID_SISTEMA = DASH.ID_SISTEMA
        AND CONCAT(PVA.ID_SITE, '|', PVA.ID_OPERACAO, '|', PVA.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
    CROSS APPLY (
        SELECT 'Budget' AS Type, PVA.VL_ORC  * DASH.VL_FATOR AS Value
        UNION ALL
        --SELECT 'Supply' AS Type, PVC.VL_SUPPLY  * DASH.VL_FATOR AS Value
        --UNION ALL
        --SELECT 'Actual' AS Type, PVC.VL_REAL  * DASH.VL_FATOR AS Value
        --UNION ALL
        SELECT 'Forecast' AS Type, PVA.VL_PROJ  * DASH.VL_FATOR AS Value
    ) AS UnpivotedData

		-- (sem repetir o ano em cada mês: uma linha por ano, no mês da DT_REF da carga)


	   --LEFT JOIN IBP.PEDRAVISAOCONSOLIDADA PVC ON YEAR(PVC.DT_REF) = PVA.ANO AND CONCAT(PVA.ID_SITE, PVA.ID_OPERACAO, PVA.ID_KPI) = CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI)
WHERE
    PVA.ANO BETWEEN YEAR(@DT_INI)  AND YEAR(@DT_FIM)   -- a partir de 2025 (@DT_INI), sem histórico
    AND DASH.ID_DASH = 16
	-- só anos com mês carregado na tabela mensal
	AND EXISTS (
		SELECT 1 FROM IBP.PEDRAVISAOCONSOLIDADA M
		WHERE M.DT_REF BETWEEN @DT_INI AND @DT_FIM AND YEAR(M.DT_REF) = PVA.ANO
	)



		UNION ALL



------------------------------------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                                YEAR TO DATE (YTD)                         -----------------------------------------
------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Uma linha, no mês da DT_REF da carga (carga 2026-10-01 → 2026-10-01: jan a out/2026).
-- Budget = VL_ORC; Act/Fcst = VL_REAL (o YTD é realizado: jan até o mês fechado).

SELECT
	DATEFROMPARTS(YEAR(PVD.DT_REF), MONTH(@DT_CARGA), 1) AS DT_REF,
	PVD.ID_SISTEMA,
	PVD.ID_SITE,
	PVD.ID_OPERACAO,
	PVD.ID_KPI,
	DASH.NM_KPIS_DASH AS 'NM_KPI',
	DASH.ID_ORDEM,
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 4 ELSE 5 END AS 'ORDEM_GRAFICO',
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 ELSE 1 END AS 'ID_TIPO_VISAO',
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' ELSE 'Act/Fcst' END AS 'NM_TIPO_VISAO',
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 'YTD B' ELSE 'YTD A' END AS 'NM_VISAO',
	DASH.SG_UNID,
	DASH.VL_CASADECIMAL,
	CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END AS 'VL_KPI',
	-- Campos para IBP.PHUB_PERFORMANCESTUDIO (VBM)
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 ELSE 3 END AS 'ID_TIPO_VISAO_VBM',
	'YTD' AS 'CD_PERIODO',
	4 AS 'ORDEM_VISAO',
	YEAR(PVD.DT_REF) AS 'ORDEM_ANO',
	MONTH(@DT_CARGA) AS 'ORDEM_PERIODO'

FROM
	IBP.PEDRAVISAOYEARTODATE PVD
	INNER JOIN IBP.DASHBOARD DASH
		ON PVD.ID_SISTEMA = DASH.ID_SISTEMA
		AND CONCAT(PVD.ID_SITE, '|', PVD.ID_OPERACAO, '|', PVD.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
	CROSS APPLY (
		SELECT 'Budget' AS Type, PVD.VL_ORC  * DASH.VL_FATOR AS Value
		UNION ALL
		SELECT 'Actual' AS Type, PVD.VL_REAL  * DASH.VL_FATOR AS Value
	) AS UnpivotedData
WHERE
	PVD.DT_REF = @DT_CARGA
	AND DASH.ID_DASH = 16



		UNION ALL



------------------------------------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                                YEAR TO GO (YTG)                           -----------------------------------------
------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Restante do ano depois do mês da DT_REF da carga (M-1 = mês em fechamento), uma linha no mês da DT_REF:
--   Budget   = Budget total do ano   (PEDRAVISAOANO.VL_ORC)  − Budget acumulado até M-1 (PEDRAVISAOYEARTODATE.VL_ORC)
--   Forecast = Forecast total do ano (PEDRAVISAOANO.VL_PROJ) − Actual acumulado até M-1 (PEDRAVISAOYEARTODATE.VL_REAL)

SELECT
	@DT_CARGA AS DT_REF,
	PVA.ID_SISTEMA,
	PVA.ID_SITE,
	PVA.ID_OPERACAO,
	PVA.ID_KPI,
	DASH.NM_KPIS_DASH AS 'NM_KPI',
	DASH.ID_ORDEM,
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 8 ELSE 9 END AS 'ORDEM_GRAFICO',
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 ELSE 1 END AS 'ID_TIPO_VISAO',
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' ELSE 'Act/Fcst' END AS 'NM_TIPO_VISAO',
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 'YTG B' ELSE 'YTG F' END AS 'NM_VISAO',
	DASH.SG_UNID,
	DASH.VL_CASADECIMAL,
	CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END AS 'VL_KPI',
	-- Campos para IBP.PHUB_PERFORMANCESTUDIO (VBM)
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 ELSE 3 END AS 'ID_TIPO_VISAO_VBM',
	'YTG' AS 'CD_PERIODO',
	6 AS 'ORDEM_VISAO',
	PVA.ANO AS 'ORDEM_ANO',
	MONTH(@DT_CARGA) AS 'ORDEM_PERIODO'

FROM
	IBP.PEDRAVISAOANO PVA
	INNER JOIN IBP.DASHBOARD DASH
		ON PVA.ID_SISTEMA = DASH.ID_SISTEMA
		AND CONCAT(PVA.ID_SITE, '|', PVA.ID_OPERACAO, '|', PVA.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
	LEFT JOIN IBP.PEDRAVISAOYEARTODATE PVD                     -- acumulado até M-1 (mês da DT_REF da carga)
		ON PVD.ID_SISTEMA = PVA.ID_SISTEMA
		AND CONCAT(PVD.ID_SITE, '|', PVD.ID_OPERACAO, '|', PVD.ID_KPI) = CONCAT(PVA.ID_SITE, '|', PVA.ID_OPERACAO, '|', PVA.ID_KPI)
		AND PVD.DT_REF = @DT_CARGA
	CROSS APPLY (
		SELECT 'Budget' AS Type, (ISNULL(PVA.VL_ORC, 0) - ISNULL(PVD.VL_ORC, 0)) * DASH.VL_FATOR AS Value
		UNION ALL
		SELECT 'Forecast' AS Type, (ISNULL(PVA.VL_PROJ, 0) - ISNULL(PVD.VL_REAL, 0)) * DASH.VL_FATOR AS Value
	) AS UnpivotedData
WHERE
	PVA.ANO = YEAR(@DT_CARGA)
	AND DASH.ID_DASH = 16

) AS COO
GROUP BY
  COO.DT_REF, COO.ID_SISTEMA, COO.ID_SITE, COO.ID_OPERACAO, COO.ID_KPI,
 COO.ID_TIPO_VISAO_VBM, COO.CD_PERIODO, COO.ORDEM_VISAO, COO.ORDEM_ANO, COO.ORDEM_PERIODO;

---- Sem o COMMIT a transação fica aberta e é desfeita quando a sessão fecha: NADA é gravado
COMMIT TRANSACTION;

SELECT @DT_CARGA AS DT_REF, @ID_DASH AS ID_DASH, CD_PERIODO, NM_TIPO_VISAO, COUNT(*) AS LINHAS
FROM IBP.PHUB_PERFORMANCESTUDIO
WHERE DT_REF = @DT_CARGA AND ID_DASH = @ID_DASH
GROUP BY CD_PERIODO, ORDEM_VISAO, ID_TIPO_VISAO, NM_TIPO_VISAO
ORDER BY ORDEM_VISAO, ID_TIPO_VISAO;
