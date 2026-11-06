DECLARE

@DT_INI AS DATE,
@DT_FIM AS DATE,
@DT_REF AS DATE

SET @DT_INI = '2026-01-01'
SET @DT_FIM =  (SELECT DATEADD(MONTH, -1, DT_INI) AS DT_INI_MENOS_1_MES FROM IBP.CONTROLE_PROCESSOS WHERE ID_PROCESSO = 2)
SET @DT_REF =  (SELECT DATEADD(MONTH, -1, DT_INI) AS DT_INI_MENOS_1_MES FROM IBP.CONTROLE_PROCESSOS WHERE ID_PROCESSO = 2)

-- ════════════════════════════════════════════════════════════════════
-- VBM Health of the Business — CONFERÊNCIA da carga (só leitura, não grava nada)
-- A mesma consulta de 003_carga_mensal_hob.sql, sem a parte de gravação: mostra as linhas, com os
-- campos de IBP.PHUB_PERFORMANCESTUDIO (DT_IND, ID_TIPO_VISAO_VBM, CD_PERIODO, ORDEM_VISAO, ORDEM_ANO,
-- ORDEM_PERIODO) para o ID_DASH 16. A carga grava só CD_PERIODO MONTH, QUARTER, YTD e YEAR (o YTG,
-- ORDEM_VISAO 6, aparece aqui para conferência) e, em QUARTER e YEAR, só ORDEM_ANO = ano de DT_IND.
-- ════════════════════════════════════════════════════════════════════
DECLARE @ID_DASH INT = 16;

----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                                           MONTH                                               -----------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------

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
					ELSE 1 END AS 'ID_TYPE',
		
		'4' AS ID_VISAO,

		CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' 
					WHEN UnpivotedData.Type = 'Supply' THEN 'Plan'
					ELSE 'Act/Fcst' END AS 'NM_TYPE',


		CASE WHEN UnpivotedData.Type = 'Budget'  THEN CONCAT(FORMAT(DT_REF, 'MMM'),' B')
					WHEN UnpivotedData.Type = 'Supply'  THEN CONCAT(FORMAT(DT_REF, 'MMM'),' P')
					--WHEN UnpivotedData.Type = 'Forecast'  AND PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) THEN CONCAT(FORMAT(DT_REF, 'MMM'),' A')
					WHEN UnpivotedData.Type = 'Forecast'  AND PVC.DT_REF <= @DT_REF THEN CONCAT(FORMAT(DT_REF, 'MMM'),' A')
					WHEN UnpivotedData.Type = 'Forecast'  THEN CONCAT(FORMAT(DT_REF, 'MMM'),' F')
					--ELSE CONCAT(FORMAT(DT_REF, 'MMM'),' A')
					--ELSE '1'
					END AS 'Type',



		UnpivotedData.Value,
		-- Campos para IBP.PHUB_PERFORMANCESTUDIO (VBM)
		PVC.DT_REF AS 'DT_IND',
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 WHEN UnpivotedData.Type = 'Supply' THEN 2 ELSE 3 END AS 'ID_TIPO_VISAO_VBM',
		'MONTH' AS 'CD_PERIODO',
		1 AS 'ORDEM_VISAO',
		YEAR(PVC.DT_REF) AS 'ORDEM_ANO',
		MONTH(PVC.DT_REF) AS 'ORDEM_PERIODO'
		--,(UnpivotedData.Value * 2.5) AS 'Range_Month',
		--NULL AS 'Range_Quarter',
		--NULL   AS 'Range_Year'


	FROM 
		IBP.PEDRAVISAOCONSOLIDADA PVC 
		INNER JOIN IBP.DASHBOARD DASH 
			ON PVC.ID_SISTEMA = DASH.ID_SISTEMA 
			AND CONCAT(PVC.ID_SITE, '|', PVC.ID_OPERACAO, '|', PVC.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
		CROSS APPLY (
			SELECT 'Budget' AS Type, PVC.VL_ORC  * DASH.VL_FATOR AS Value
			--UNION ALL
			--SELECT 'Supply' AS Type, PVC.VL_SUPPLY  * DASH.VL_FATOR AS Value
			--UNION ALL
			--SELECT 'Actual' AS Type, PVC.VL_REAL  * DASH.VL_FATOR AS Value 
			UNION ALL
			SELECT 'Forecast' AS Type, 
			CASE WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
						WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS  NOT NULL THEN PVC.VL_REAL  * DASH.VL_FATOR 
			ELSE PVC.VL_PROJ  * DASH.VL_FATOR END AS Value 
			--DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1)
		) AS UnpivotedData
	WHERE 
		PVC.DT_REF BETWEEN @DT_INI  AND @DT_FIM
		AND DASH.ID_DASH = @ID_DASH



		UNION ALL



----------------------------------------------------------------------------------------------------------------------------------
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
ID_TYPE,
ID_VISAO,
NM_TYPE,
[Type],
[Value],
-- Campos para IBP.PHUB_PERFORMANCESTUDIO (VBM)
DT_REF AS 'DT_IND',
ID_TYPE_VBM AS 'ID_TIPO_VISAO_VBM',
'QUARTER' AS 'CD_PERIODO',
2 AS 'ORDEM_VISAO',
YEAR(DT_REF_T) AS 'ORDEM_ANO',
DATEPART(QUARTER, DT_REF_T) AS 'ORDEM_PERIODO'
--,Range_Month,
--Range_Quarter,
--Range_Year




FROM (


	SELECT 
		PVC.DT_REF,
		PVT.DT_REF AS 'DT_REF_T',
		CASE WHEN  (MONTH(PVT.DT_REF) <= 3) AND (MONTH(PVC.DT_REF) <= 3)   THEN '1'
					WHEN  (MONTH(PVT.DT_REF) > 3 AND MONTH(PVT.DT_REF) <= 6) AND (MONTH(PVC.DT_REF) > 3 AND MONTH(PVC.DT_REF) <= 6)  THEN '2'
					WHEN  (MONTH(PVT.DT_REF) > 6 AND MONTH(PVT.DT_REF) <= 9) AND (MONTH(PVC.DT_REF) > 6 AND MONTH(PVC.DT_REF) <= 9)  THEN '3'
					WHEN  (MONTH(PVT.DT_REF) > 9 AND MONTH(PVT.DT_REF) <= 12) AND (MONTH(PVC.DT_REF) > 9 AND MONTH(PVC.DT_REF) <= 12)  THEN '4'
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

		'5' AS ID_VISAO,


		CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' 
					WHEN UnpivotedData.Type = 'Supply' THEN 'Plan'
					ELSE 'Act/Fcst' END AS 'NM_TYPE',


		CASE WHEN UnpivotedData.Type = 'Budget' AND (MONTH(PVT.DT_REF) <= 3)  THEN 'Q1B'
					WHEN UnpivotedData.Type = 'Budget' AND (MONTH(PVT.DT_REF) > 3 AND MONTH(PVT.DT_REF) <= 6)  THEN 'Q2B'
					WHEN UnpivotedData.Type = 'Budget' AND (MONTH(PVT.DT_REF) > 6 AND MONTH(PVT.DT_REF) <= 9)  THEN 'Q3B'
					WHEN UnpivotedData.Type = 'Budget' AND (MONTH(PVT.DT_REF) > 9 AND MONTH(PVT.DT_REF) <= 12)  THEN 'Q4B'
				
				
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-03','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-03','-01')) as date) THEN 'Q1A'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-06','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-06','-01')) as date) THEN 'Q2A'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-09','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-09','-01')) as date) THEN 'Q3A'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-12','-01')) as date) <= @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-12','-01')) as date)  THEN 'Q4A'


					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-04','-01')) as date) > @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-03','-01')) as date) THEN 'Q1F'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-07','-01')) as date) > @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-06','-01')) as date) THEN 'Q2F'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-10','-01')) as date) > @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-09','-01')) as date) THEN 'Q3F'
					WHEN (UnpivotedData.Type = 'Forecast') AND  CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-12','-01')) as date) > @DT_REF AND  PVT.DT_REF < CAST (DATEADD ( MONTH ,0,CONCAT(YEAR(PVT.DT_REF),'-12','-01')) as date)  THEN 'Q4F'
				

					--WHEN (UnpivotedData.Type = 'Forecast') AND (YEAR(PVT.DT_REF) = YEAR(@DT_REF))  AND (MONTH(PVT.DT_REF) >= 1 AND MONTH(PVT.DT_REF) <= 3 ) THEN 'Q1A'
					--WHEN (UnpivotedData.Type = 'Forecast') AND (YEAR(PVT.DT_REF) = YEAR(@DT_REF)) AND (MONTH(PVT.DT_REF) > 3 AND MONTH(PVT.DT_REF) <= 6)   THEN 'Q2A'
					--WHEN (UnpivotedData.Type = 'Forecast') AND (YEAR(PVT.DT_REF) = YEAR(@DT_REF)) AND (MONTH(PVT.DT_REF) > 6 AND MONTH(PVT.DT_REF) <= 9)  THEN 'Q3A'
					--WHEN (UnpivotedData.Type = 'Forecast') AND (YEAR(PVT.DT_REF) = YEAR(@DT_REF)) AND (MONTH(PVT.DT_REF) > 9 AND MONTH(PVT.DT_REF) <= 12)   THEN 'Q4A'




					END AS 'Type',

				
		UnpivotedData.Value
		--,
		--NULL AS 'Range_Month',
		--(UnpivotedData.Value * 1.4) AS 'Range_Quarter',
		--NULL  AS 'Range_Year'


	FROM 
		IBP.DASHBOARD DASH INNER JOIN
		IBP.PEDRAVISAOTRIMESTRE PVT 
			ON  CONCAT(PVT.ID_SISTEMA, '|', PVT.ID_SITE, '|', PVT.ID_OPERACAO, '|', PVT.ID_KPI) = CONCAT(DASH.ID_SISTEMA, '|', DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
		CROSS APPLY (
			SELECT 'Budget' AS Type, PVT.VL_ORC  * DASH.VL_FATOR AS Value
			UNION ALL
			--SELECT 'Supply' AS Type, PVT.VL_SUPPLY  * DASH.VL_FATOR AS Value
			--UNION ALL
			--SELECT 'Actual' AS Type, PVT.VL_REAL  * DASH.VL_FATOR AS Value
			--UNION ALL
			SELECT 'Forecast' AS Type, PVT.VL_PROJ  * DASH.VL_FATOR AS Value
		) AS UnpivotedData
		
		CROSS APPLY (
			SELECT DISTINCT DT_REF, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI FROM IBP.PEDRAVISAOCONSOLIDADA WHERE DT_REF BETWEEN @DT_INI  AND @DT_FIM 
		) AS PVC
		
		
		--LEFT JOIN IBP.PEDRAVISAOCONSOLIDADA PVC ON YEAR(PVC.DT_REF) = YEAR(PVT.DT_REF) AND CONCAT(PVT.ID_SITE, PVT.ID_OPERACAO, PVT.ID_KPI) = CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI)
	
	
	WHERE 
		PVT.DT_REF BETWEEN @DT_INI  AND @DT_FIM
		AND CONCAT(PVT.ID_SISTEMA, '|', PVT.ID_SITE, '|', PVT.ID_OPERACAO, '|', PVT.ID_KPI) = CONCAT(PVC.ID_SISTEMA, '|', PVC.ID_SITE, '|', PVC.ID_OPERACAO, '|', PVC.ID_KPI)
		AND DASH.ID_DASH = @ID_DASH

		) AS QUERY
		WHERE QREF <> 0 AND [Type] <> 'NULL'


		UNION ALL




----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                                    YEAR TO DATE                                  -----------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------

	SELECT 
		PVC.DT_REF,
		PVC.ID_SISTEMA,
		PVC.ID_SITE,
		PVC.ID_OPERACAO,
		PVC.ID_KPI,
		DASH.NM_KPIS_DASH AS 'NM_KPI',
		DASH.ID_ORDEM,
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 5 
					--WHEN UnpivotedData.Type = 'Supply' THEN 6 
					ELSE 7 END AS 'ORDEM_GRAFICO',

		CASE WHEN UnpivotedData.Type = 'Budget' THEN 0
					--WHEN UnpivotedData.Type = 'Supply' THEN 2
					ELSE 1 END AS 'ID_TYPE',

		'6' AS ID_VISAO,

		CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' 
					--WHEN UnpivotedData.Type = 'Supply' THEN 'Plan'
					ELSE 'Act/Fcst' END AS 'NM_TYPE',


		CASE WHEN UnpivotedData.Type = 'Budget'  THEN CONCAT('YTD',' B')
					WHEN UnpivotedData.Type = 'Supply'  THEN CONCAT('YTD',' P')
					--WHEN UnpivotedData.Type = 'Forecast'  AND PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) THEN CONCAT(FORMAT(DT_REF, 'MMM'),' A')
					--WHEN UnpivotedData.Type = 'Forecast'  AND PVC.DT_REF <= @DT_REF THEN CONCAT('YTD',' A')
					WHEN UnpivotedData.Type = 'Actual'  THEN CONCAT('YTD',' A')
					--ELSE CONCAT(FORMAT(DT_REF, 'MMM'),' A')
					--ELSE '1'
					END AS 'Type',



		UnpivotedData.Value,
		-- Campos para IBP.PHUB_PERFORMANCESTUDIO (VBM)
		PVC.DT_REF AS 'DT_IND',
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 ELSE 3 END AS 'ID_TIPO_VISAO_VBM',
		'YTD' AS 'CD_PERIODO',
		4 AS 'ORDEM_VISAO',
		YEAR(PVC.DT_REF) AS 'ORDEM_ANO',
		MONTH(PVC.DT_REF) AS 'ORDEM_PERIODO'
		--,
		--(UnpivotedData.Value * 2.5) AS 'Range_Month',
		--NULL AS 'Range_Quarter',
		--NULL   AS 'Range_Year'


	FROM 
		IBP.PEDRAVISAOYEARTODATE PVC 
		INNER JOIN IBP.DASHBOARD DASH 
			ON PVC.ID_SISTEMA = DASH.ID_SISTEMA 
			AND CONCAT(PVC.ID_SITE, '|', PVC.ID_OPERACAO, '|', PVC.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
		CROSS APPLY (
			SELECT 'Budget' AS Type, PVC.VL_ORC  * DASH.VL_FATOR AS Value
			--UNION ALL
			--SELECT 'Supply' AS Type, PVC.VL_SUPPLY  * DASH.VL_FATOR AS Value
			UNION ALL
			SELECT 'Actual' AS Type, PVC.VL_REAL  * DASH.VL_FATOR AS Value 
			--------UNION ALL
			--------SELECT 'Forecast' AS Type, 
			--------CASE WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
			--------			WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS  NOT NULL THEN PVC.VL_REAL  * DASH.VL_FATOR 
			--------ELSE PVC.VL_PROJ  * DASH.VL_FATOR END AS Value 
			--DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1)
		) AS UnpivotedData
	WHERE 
		PVC.DT_REF BETWEEN @DT_INI  AND @DT_FIM
		AND DASH.ID_DASH = @ID_DASH





		UNION ALL






----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                                      YEAR TO GO                                    -----------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------





SELECT 
		PVC.DT_REF,
		PVC.ID_SISTEMA,
		PVC.ID_SITE,
		PVC.ID_OPERACAO,
		PVC.ID_KPI,
		DASH.NM_KPIS_DASH AS 'NM_KPI',
		DASH.ID_ORDEM,
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 8 
					ELSE 9 END AS 'ORDEM_GRAFICO',

		CASE WHEN UnpivotedData.Type = 'Budget' THEN 0
					ELSE 1 END AS 'ID_TYPE',

		'7' AS ID_VISAO,

		CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' 
					ELSE 'Act/Fcst' END AS 'NM_TYPE',


		CASE WHEN UnpivotedData.Type = 'Budget'  THEN CONCAT('YTG',' B')
					WHEN UnpivotedData.Type = 'Forecast'  THEN CONCAT('YTG',' F')

					END AS 'Type',

		UnpivotedData.Value,
		-- Campos para IBP.PHUB_PERFORMANCESTUDIO (VBM)
		PVC.DT_REF AS 'DT_IND',
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 ELSE 3 END AS 'ID_TIPO_VISAO_VBM',
		'YTG' AS 'CD_PERIODO',
		6 AS 'ORDEM_VISAO',
		YEAR(PVC.DT_REF) AS 'ORDEM_ANO',
		MONTH(PVC.DT_REF) AS 'ORDEM_PERIODO'
		--,(UnpivotedData.Value * 2.5) AS 'Range_Month',
		--NULL AS 'Range_Quarter',
		--NULL   AS 'Range_Year'


	FROM 
		IBP.PEDRAVISAOYEARTOGO PVC 
		INNER JOIN IBP.DASHBOARD DASH 
			ON PVC.ID_SISTEMA = DASH.ID_SISTEMA 
			AND CONCAT(PVC.ID_SITE, '|', PVC.ID_OPERACAO, '|', PVC.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
		CROSS APPLY (
			SELECT 'Budget' AS Type, PVC.VL_ORC  * DASH.VL_FATOR AS Value
			--UNION ALL
			--SELECT 'Supply' AS Type, PVC.VL_SUPPLY  * DASH.VL_FATOR AS Value
			--UNION ALL
			--SELECT 'Actual' AS Type, PVC.VL_REAL  * DASH.VL_FATOR AS Value 
			UNION ALL
			SELECT 'Forecast' AS Type, 
			CASE WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS NULL THEN 0
						WHEN PVC.DT_REF <= DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1) AND PVC.VL_REAL IS  NOT NULL THEN PVC.VL_REAL  * DASH.VL_FATOR 
			ELSE PVC.VL_PROJ  * DASH.VL_FATOR END AS Value 
			--DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, @DT_REF)), MONTH(DATEADD(MONTH, -1, @DT_REF)), 1)
		) AS UnpivotedData
	WHERE 
		PVC.DT_REF BETWEEN @DT_INI  AND @DT_FIM
		AND DASH.ID_DASH = @ID_DASH










		UNION ALL

----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                                              YEAR                                                -----------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------






SELECT 
    PVC.DT_REF,
    PVA.ID_SISTEMA,
    PVA.ID_SITE,
    PVA.ID_OPERACAO,
    PVA.ID_KPI,
	DASH.NM_KPIS_DASH AS 'NM_KPI',
    DASH.ID_ORDEM,
	CASE WHEN UnpivotedData.Type = 'Budget' THEN RIGHT(PVA.ANO,2) + 10  ELSE RIGHT(PVA.ANO,2) + 11 END AS 'ORDEM_GRAFICO',
	CASE WHEN UnpivotedData.Type = 'Budget' THEN 0 ELSE 1 END AS 'ID_TYPE',

	'8' AS ID_VISAO,


	CASE WHEN UnpivotedData.Type = 'Budget' THEN 'Budget' 
				WHEN UnpivotedData.Type = 'Supply' THEN 'Plan'
				ELSE 'Act/Fcst' END AS 'NM_TYPE',

    CASE WHEN UnpivotedData.Type = 'Budget' THEN  CONCAT(RIGHT(PVA.ANO,2),'B')
				WHEN PVA.ANO < YEAR(@DT_REF)  THEN CONCAT(RIGHT(PVA.ANO,2),'A')
	ELSE CONCAT(RIGHT(PVA.ANO,2),'F')
	END AS 'Type',
		UnpivotedData.Value,
		-- Campos para IBP.PHUB_PERFORMANCESTUDIO (VBM)
		PVC.DT_REF AS 'DT_IND',
		CASE WHEN UnpivotedData.Type = 'Budget' THEN 1 ELSE 3 END AS 'ID_TIPO_VISAO_VBM',
		'YEAR' AS 'CD_PERIODO',
		5 AS 'ORDEM_VISAO',
		PVA.ANO AS 'ORDEM_ANO',
		PVA.ANO AS 'ORDEM_PERIODO'
		--,
		--NULL AS 'Range_Month',
		--NULL AS 'Range_Quarter',
		--(UnpivotedData.Value * 0.85) AS 'Range_Year'



FROM 
    IBP.PEDRAVISAOANO PVA 
    INNER JOIN IBP.DASHBOARD DASH 
        ON PVA.ID_SISTEMA = DASH.ID_SISTEMA 
        AND CONCAT(PVA.ID_SITE, '|', PVA.ID_OPERACAO, '|', PVA.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
    CROSS APPLY (
        SELECT 'Budget' AS Type, PVA.VL_ORC  * DASH.VL_FATOR AS Value
        UNION ALL

        SELECT 'Forecast' AS Type, PVA.VL_PROJ  * DASH.VL_FATOR AS Value
    ) AS UnpivotedData
	    
		CROSS APPLY (
			SELECT DISTINCT DT_REF FROM IBP.PEDRAVISAOCONSOLIDADA WHERE DT_REF BETWEEN @DT_INI  AND @DT_FIM
		) AS PVC		
		
		
		--EFT JOIN IBP.PEDRAVISAOCONSOLIDADA PVC ON YEAR(PVC.DT_REF) = PVA.ANO AND CONCAT(PVA.ID_SITE, PVA.ID_OPERACAO, PVA.ID_KPI) = CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI)
WHERE 
    1 = 1
	AND PVA.ANO BETWEEN YEAR(@DT_INI)  AND YEAR(@DT_FIM)
	AND DASH.ID_DASH = @ID_DASH
