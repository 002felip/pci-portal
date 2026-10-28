DECLARE

@DT_INI AS DATE,
@DT_FIM AS DATE,
@DT_REF AS DATE

SET @DT_INI = '2025-01-01'
SET @DT_FIM = CAST(DATEADD(MONTH, 0, CONCAT(YEAR(DATEFROMPARTS(YEAR(DATEADD(MONTH, 0, GETDATE()-1)), MONTH(DATEADD(MONTH, -1, GETDATE()-1)), 1)), '-12-01')) AS DATE)
SET @DT_REF =  (SELECT DATEADD(MONTH, -1, DT_INI) AS DT_INI_MENOS_1_MES FROM IBP.CONTROLE_PROCESSOS WHERE ID_PROCESSO = 2)



----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
--------------------------------------                        DADOS DO SOUTH ATLANTIC                            -----------------------------------------
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
		CASE WHEN UnpivotedData.Value IS NULL THEN 0 ELSE UnpivotedData.Value END AS VL_KPI


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
		AND DASH.ID_DASH = 15



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
[Value] AS 'VL_KPI'




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
		
		CROSS APPLY (
			SELECT DISTINCT DT_REF FROM IBP.PEDRAVISAOCONSOLIDADA WHERE DT_REF BETWEEN @DT_INI  AND @DT_FIM
		) AS PVC		
		
--		LEFT JOIN IBP.PEDRAVISAOCONSOLIDADA PVC ON YEAR(PVC.DT_REF) = YEAR(PVT.DT_REF) AND CONCAT(PVT.ID_SITE, PVT.ID_OPERACAO, PVT.ID_KPI) = CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI)
	
	
	WHERE 
		PVT.DT_REF  BETWEEN @DT_INI  AND @DT_FIM
		AND YEAR(PVT.DT_REF) = YEAR(PVC.DT_REF) 
		AND DASH.ID_DASH = 15

		) AS QUERY
		WHERE QREF <> 0



		UNION ALL






----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                        DADOS  SOUTH ATLANTIC                              -----------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------                                              YEAR                                                -----------------------------------------
----------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------






SELECT 
    PVC.DT_REF,
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
	UnpivotedData.Value AS 'VL_KPI'




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
	   
		CROSS APPLY (
			SELECT DISTINCT DT_REF FROM IBP.PEDRAVISAOCONSOLIDADA WHERE DT_REF BETWEEN @DT_INI  AND @DT_FIM
		) AS PVC	   
	   
	   
	   --LEFT JOIN IBP.PEDRAVISAOCONSOLIDADA PVC ON YEAR(PVC.DT_REF) = PVA.ANO AND CONCAT(PVA.ID_SITE, PVA.ID_OPERACAO, PVA.ID_KPI) = CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI)
WHERE 
    PVA.ANO BETWEEN YEAR(@DT_INI)  AND YEAR(@DT_FIM)
	AND (YEAR(PVC.DT_REF) = PVA.ANO)
    AND DASH.ID_DASH = 15
















