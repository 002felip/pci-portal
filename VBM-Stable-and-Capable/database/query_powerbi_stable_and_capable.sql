-- Consulta da tabela 'base' do Power BI Stable_and_Capable_3.pbix (BDIBPBMSA_PRD),
-- copiada como está. Usada pela aba Power BI do VBM-Stable-and-Capable (bi-api.js).

DECLARE
    @DT_INI AS DATE,
    @DT_FIM AS DATE;

SET @DT_INI = '2023-01-01';
SET @DT_FIM = EOMONTH(GETDATE(), -1);

-- TABELA STABLE & CAPABLE

;WITH TABELA_STABLE_CAPABLE AS 
(
    SELECT 
        SIST.NM_REGIAOGLOBAL,
        SIT.NM_PAIS,
        OPE.TP_OPERACAO AS [TYPE OPERATION],

        CASE 
            WHEN PVC.ID_SITE IN ('1','28','29') THEN 'Salobo'
            WHEN PVC.ID_SITE IN ('2') THEN 'Sossego'
            WHEN PVC.ID_SITE IN ('3', '43','44') THEN 'Onça Puma'
            WHEN PVC.ID_SITE IN ('36','37','13','18','16','26') THEN 'VNL+IR'
            WHEN PVC.ID_SITE IN ('8','9','10','11','12','15','31','32') THEN 'Ontario'
            WHEN PVC.ID_SITE IN ('14') THEN 'Manitoba'
            ELSE 'outros'
        END AS [BUSINESS UNIT],

        SIT.NM_SITE AS [NAME SITE],
        KPI.NM_KPI AS [NAME KPI],

        CASE 
            WHEN KPI.SG_UNID_KPI = 't' THEN 'tonnes/day' 
            WHEN KPI.SG_UNID_KPI = '%' THEN '%/day' 
            WHEN KPI.SG_UNID_KPI = 'eqm' THEN 'eqm/day' 
            WHEN KPI.SG_UNID_KPI = 'eqm/d' THEN 'eqm/day' 
            WHEN KPI.ID_KPI = '15' AND KPI.SG_UNID_KPI = 't' THEN 'eqm/day' 
            ELSE KPI.SG_UNID_KPI 
        END AS [UNIT],

        PVC.DT_REF,
        -- REMOÇÃO DOS OUTLIER DA RECUPERAÇÃO METALURGICA DO SALOBO III
		CASE WHEN PVC.ID_KPI = 18 AND PVC.VL_REAL > 3 THEN NULL
				   WHEN PVC.ID_KPI = 122 AND PVC.VL_REAL > 3 THEN NULL
				    WHEN PVC.ID_KPI = 125 AND PVC.VL_REAL > 3 THEN NULL
					ELSE PVC.VL_REAL END AS [ACTUAL],



        CASE 
            WHEN KPI.SG_UNID_KPI <> '%' THEN 
                SUM(PVD.VL_ORC) / DATEDIFF(
                    DAY, 
                    DATEADD(DAY, 1 - DAY(PVC.DT_REF), PVC.DT_REF), 
                    DATEADD(MONTH, 1, DATEADD(DAY, 1 - DAY(PVC.DT_REF), PVC.DT_REF))
                ) 
            ELSE AVG(PVD.VL_ORC) 
        END AS [BUDGET],

        CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI, PVC.ID_SISTEMA) AS KPI_FINAL, 
        PVC.ID_SITE,
        PVC.ID_OPERACAO,
        PVC.ID_KPI,
        PVC.ID_SISTEMA

    FROM IBP.PEDRAVISAODIARIA PVC  

    LEFT JOIN IBP.PEDRAVISAOCONSOLIDADA PVD 
        ON MONTH(PVD.DT_REF) = MONTH(PVC.DT_REF) 
        AND YEAR(PVD.DT_REF) = YEAR(PVC.DT_REF)
        AND PVD.ID_KPI = PVC.ID_KPI 
        AND PVD.ID_OPERACAO = PVC.ID_OPERACAO 
        AND PVD.ID_SITE = PVC.ID_SITE  

    LEFT JOIN IBP.SISTEMA SIST 
        ON SIST.ID_SISTEMA = PVC.ID_SISTEMA 

    LEFT JOIN IBP.OPERACAO OPE 
        ON OPE.ID_OPERACAO = PVC.ID_OPERACAO 

    LEFT JOIN IBP.SITES SIT 
        ON SIT.ID_SITE = PVC.ID_SITE 

    LEFT JOIN IBP.KPI KPI 
        ON KPI.ID_KPI = PVC.ID_KPI 

    LEFT JOIN IBP.KPI_TIPO KPI_TIPO 
        ON KPI_TIPO.ID_KPI_TIPO = KPI.ID_KPI_TIPO 

    WHERE PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM

    GROUP BY 
        SIST.NM_REGIAOGLOBAL,
        SIT.NM_PAIS,
        OPE.TP_OPERACAO,

        CASE 
            WHEN KPI.SG_UNID_KPI = 't' THEN 'tonnes/day' 
            WHEN KPI.SG_UNID_KPI = '%' THEN '%/day' 
            WHEN KPI.SG_UNID_KPI = 'eqm' THEN 'eqm/day' 
            WHEN KPI.SG_UNID_KPI = 'eqm/d' THEN 'eqm/day' 
            WHEN KPI.ID_KPI = '15' AND KPI.SG_UNID_KPI = 't' THEN 'eqm/day' 
            ELSE KPI.SG_UNID_KPI 
        END,

        CASE 
            WHEN PVC.ID_SITE IN ('1','28','29') THEN 'Salobo'
            WHEN PVC.ID_SITE IN ('2') THEN 'Sossego'
            WHEN PVC.ID_SITE IN ('3','43','44') THEN 'Onça Puma'
            WHEN PVC.ID_SITE IN ('36','37','13','18','16','26') THEN 'VNL+IR'
            WHEN PVC.ID_SITE IN ('8','9','10','11','12','15','31','32') THEN 'Ontario'
            WHEN PVC.ID_SITE IN ('14') THEN 'Manitoba'
            ELSE 'outros'
        END,

        KPI.SG_UNID_KPI,
        SIT.NM_SITE,
        KPI.NM_KPI,
        PVC.DT_REF,
        PVC.VL_REAL,
        CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI, PVC.ID_SISTEMA), 
        PVC.ID_SITE,
        PVC.ID_OPERACAO,
        PVC.ID_KPI,
        PVC.ID_SISTEMA
)

SELECT * 
FROM TABELA_STABLE_CAPABLE
WHERE KPI_FINAL IN 
(
    -- SALOBO
    '1114', '1154', '282184', '292184',
    '1134', '1144', '282234', '292234', '2821494', '2921494', '282164', '292164',  
    '282224', '292224', '2824074', '2924074', '2824114', '2924114',
    '282174', '292174', '282204', '292204',
    '1124','2824034', '2924034', '12224',

    -- SOSSEGO 
    '2114',  '2154', '22164', '22184', '22224',
    '2144', '2134', '221494', '22204', '22174', '22234', '224074',
    '2124',

    -- ONCA PUMA
    '3124', '3144', '36444', '36494', '361224', '36514',
    '3114', '311094', '36504', '364034', '364074', '36524','436494','436504','436514','446494','446504','446514'

    -- ONTARIO
    ,'8141', '9141', '10141', '11141', '12141', '31141', 
    '81151', '91151', '101151', '111151', '121151', 
    '152171', '152441', '152161', '3261291', '107511',

    -- VNL E IR
    '361151', '371151', '36141', '37141', 
    '132161', '187511', '167513', '267512',

    -- MANITOBA
    '141151', '14141', '141441', '142161', '142511'
)
ORDER BY 
    NM_REGIAOGLOBAL DESC, 
    NM_PAIS, 
    [TYPE OPERATION], 
    [BUSINESS UNIT], 
    [NAME SITE], 
    ID_KPI, 
    DT_REF
