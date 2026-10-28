/* ════════════════════════════════════════════════════════════════════
   COO Business Units Dashboard — carga mensal em IBP.PHUB_PERFORMANCESTUDIO
   Banco: BDIBPBMSA_PRD

   A query do COO Dashboard (coo_dashboard.sql) adaptada para INSERT na
   tabela do VBM Performance Studio (VBM-Performance-Studio/database/002_snapshot_mensal.sql),
   com as regras da carga do VBM (VBM-Performance-Studio/database/003_carga_mensal.sql).
   A tabela não muda; as linhas do COO ficam separadas por ID_DASH = 15.
   Studio e Health (ID_DASH 21) não leem nem apagam estas linhas.

   Mantido da query do COO (mesmas tabelas e séries):
     MONTH   IBP.PEDRAVISAOCONSOLIDADA  Budget · Plan · Act/Fcst
     QUARTER IBP.PEDRAVISAOTRIMESTRE    Budget · Act/Fcst (VL_PROJ)
     YEAR    IBP.PEDRAVISAOANO          Budget · Act/Fcst (VL_PROJ)
   O COO repetia trimestre e ano em cada mês (para filtrar por mês na tela);
   aqui cada período é gravado uma vez, com DT_IND = início do período.

   Regras do VBM aplicadas:
     · Datas sem GETDATE(), derivadas de @DT_REF (reprocessar dá o mesmo recorte):
         @DT_REF  = mês em aberto. NULL = IBP.CONTROLE_PROCESSOS.DT_INI - 1 mês (ID_PROCESSO = 2)
         @DT_REAL = @DT_REF - 1 mês (último mês com REALIZADO = mês do ciclo do COO)
         @DT_INI  = 1º de janeiro de (ano de @DT_REAL - @ANOS_ANTES)  (= '2025-01-01' em 2026)
         @DT_FIM  = dezembro do ano de @DT_REF
     · Act/Fcst do mês = VL_REAL (NULL = 0) até @DT_REAL e VL_PROJ depois
       (a query do COO usava VL_REAL só até o mês anterior a @DT_REAL).
     · Rótulo A/F: mês 'A' até @DT_REAL; trimestre 'A' quando termina antes de
       @DT_REF; ano 'A' quando é anterior ao ano de @DT_REF.
       Formato do VBM: 'SepA 26', 'Q3A 26', '26A' (o COO usava 'Sep A', 'Q3A', '26A').
     · Séries: ID_TIPO_VISAO 1 Budget | 2 Plan | 3 Act/Fcst (o COO usava 0 | 2 | 1).
     · Valor vazio grava 0 (VL_KPI é NOT NULL).
   Nome, unidade, casas decimais e ordem do KPI não são gravados: vêm de
   IBP.DASHBOARD na leitura (mesmo join do VBM).

   Pode rodar de novo para o mesmo mês: apaga e regrava só DT_REF + ID_DASH 15,
   numa transação (tudo ou nada). Se a query falhar, vier vazia ou com chave
   repetida, nada é apagado.

   Atenção: reprocessar um mês antigo usa os valores ATUAIS das tabelas de
   origem (projeções e realizados de hoje), não os da época.
   ════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

-- ── Parâmetros ───────────────────────────────────────────────────────
DECLARE @DT_REF     DATE          = NULL;   -- ex.: '2026-10-01'
DECLARE @NM_USUARIO NVARCHAR(200) = NULL;   -- ex.: N'job-carga-coo'
DECLARE @ID_DASH    INT           = 15;
DECLARE @ANOS_ANTES INT           = 1;

-- ── Datas da carga (iguais às do VBM) ────────────────────────────────
IF @DT_REF IS NULL
  SET @DT_REF = (SELECT DATEADD(MONTH, -1, DT_INI) FROM IBP.CONTROLE_PROCESSOS WHERE ID_PROCESSO = 2);
IF @DT_REF IS NULL
  THROW 50001, 'DT_REF não informado e não encontrado em IBP.CONTROLE_PROCESSOS (ID_PROCESSO = 2).', 1;
SET @DT_REF = DATEFROMPARTS(YEAR(@DT_REF), MONTH(@DT_REF), 1);
SET @NM_USUARIO = COALESCE(@NM_USUARIO, SUSER_SNAME());

DECLARE @DT_REAL DATE = DATEADD(MONTH, -1, @DT_REF);
DECLARE @DT_INI  DATE = DATEFROMPARTS(YEAR(@DT_REAL) - @ANOS_ANTES, 1, 1);
DECLARE @DT_FIM  DATE = DATEFROMPARTS(YEAR(@DT_REF), 12, 1);

-- KPI cadastrado mais de uma vez no dashboard somaria em dobro
IF EXISTS (
  SELECT 1 FROM IBP.DASHBOARD
  WHERE ID_DASH = @ID_DASH
  GROUP BY ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI
  HAVING COUNT(*) > 1
)
  THROW 50004, 'KPI repetido em IBP.DASHBOARD para o dashboard: nada foi gravado.', 1;

-- ── 1. Query do COO no formato de IBP.PHUB_PERFORMANCESTUDIO ─────────
IF OBJECT_ID('tempdb..#R') IS NOT NULL DROP TABLE #R;

SELECT
  P.DT_IND,
  P.ID_SISTEMA, P.ID_SITE, P.ID_OPERACAO, P.ID_KPI,
  P.ID_TIPO_VISAO,
  CASE P.ID_TIPO_VISAO WHEN 1 THEN N'Budget' WHEN 2 THEN N'Plan' ELSE N'Act/Fcst' END AS NM_TIPO_VISAO,
  CASE WHEN P.CD_PERIODO = 'YEAR'
       THEN CONCAT(RIGHT(P.ORDEM_ANO, 2), P.LETRA)
       ELSE CONCAT(P.PREFIXO, P.LETRA, ' ', RIGHT(P.ORDEM_ANO, 2))
  END AS NM_VISAO,
  P.VL_KPI,
  P.CD_PERIODO, P.ORDEM_VISAO, P.ORDEM_ANO, P.ORDEM_PERIODO
INTO #R
FROM (

    ------------------------------------------------------------------
    -- MONTH (IBP.PEDRAVISAOCONSOLIDADA)
    ------------------------------------------------------------------
    SELECT
      DATEFROMPARTS(YEAR(PVC.DT_REF), MONTH(PVC.DT_REF), 1) AS DT_IND,
      PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
      UnpivotedData.ID_TIPO_VISAO,
      CHOOSE(MONTH(PVC.DT_REF), 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec') AS PREFIXO,
      CASE
        WHEN UnpivotedData.ID_TIPO_VISAO = 1 THEN 'B'
        WHEN UnpivotedData.ID_TIPO_VISAO = 2 THEN 'P'
        WHEN DATEFROMPARTS(YEAR(PVC.DT_REF), MONTH(PVC.DT_REF), 1) <= @DT_REAL THEN 'A'
        ELSE 'F'
      END AS LETRA,
      SUM(ISNULL(UnpivotedData.Value, 0)) AS VL_KPI,
      'MONTH' AS CD_PERIODO, 1 AS ORDEM_VISAO,
      YEAR(PVC.DT_REF) AS ORDEM_ANO, MONTH(PVC.DT_REF) AS ORDEM_PERIODO
    FROM
      IBP.PEDRAVISAOCONSOLIDADA PVC
      INNER JOIN IBP.DASHBOARD DASH
        ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
        AND CONCAT(PVC.ID_SITE, '|', PVC.ID_OPERACAO, '|', PVC.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
      CROSS APPLY (
        SELECT 1 AS ID_TIPO_VISAO, PVC.VL_ORC * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 2, PVC.VL_SUPPLY * DASH.VL_FATOR
        UNION ALL
        SELECT 3,
          CASE
            WHEN PVC.DT_REF <= @DT_REAL AND PVC.VL_REAL IS NULL THEN 0
            WHEN PVC.DT_REF <= @DT_REAL THEN PVC.VL_REAL * DASH.VL_FATOR
            ELSE PVC.VL_PROJ * DASH.VL_FATOR
          END
      ) AS UnpivotedData
    WHERE
      PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
      AND DASH.ID_DASH = @ID_DASH
    GROUP BY
      YEAR(PVC.DT_REF), MONTH(PVC.DT_REF),
      PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI, UnpivotedData.ID_TIPO_VISAO

    UNION ALL

    ------------------------------------------------------------------
    -- QUARTER (IBP.PEDRAVISAOTRIMESTRE)
    -- Só trimestres com mês carregado em PEDRAVISAOCONSOLIDADA no período,
    -- como no COO (QREF <> 0).
    ------------------------------------------------------------------
    SELECT
      DATEADD(QUARTER, DATEDIFF(QUARTER, 0, PVT.DT_REF), 0) AS DT_IND,
      PVT.ID_SISTEMA, PVT.ID_SITE, PVT.ID_OPERACAO, PVT.ID_KPI,
      UnpivotedData.ID_TIPO_VISAO,
      CONCAT('Q', DATEPART(QUARTER, PVT.DT_REF)) AS PREFIXO,
      CASE
        WHEN UnpivotedData.ID_TIPO_VISAO = 1 THEN 'B'
        WHEN EOMONTH(DATEFROMPARTS(YEAR(PVT.DT_REF), DATEPART(QUARTER, PVT.DT_REF) * 3, 1)) <= @DT_REF THEN 'A'
        ELSE 'F'
      END AS LETRA,
      SUM(ISNULL(UnpivotedData.Value, 0)) AS VL_KPI,
      'QUARTER', 2,
      YEAR(PVT.DT_REF), DATEPART(QUARTER, PVT.DT_REF)
    FROM
      IBP.PEDRAVISAOTRIMESTRE PVT
      INNER JOIN IBP.DASHBOARD DASH
        ON PVT.ID_SISTEMA = DASH.ID_SISTEMA
        AND CONCAT(PVT.ID_SITE, '|', PVT.ID_OPERACAO, '|', PVT.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
      CROSS APPLY (
        SELECT 1 AS ID_TIPO_VISAO, PVT.VL_ORC * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 3, PVT.VL_PROJ * DASH.VL_FATOR
      ) AS UnpivotedData
    WHERE
      PVT.DT_REF BETWEEN @DT_INI AND @DT_FIM
      AND DASH.ID_DASH = @ID_DASH
      AND EXISTS (
        SELECT 1 FROM IBP.PEDRAVISAOCONSOLIDADA M
        WHERE M.DT_REF BETWEEN @DT_INI AND @DT_FIM
          AND YEAR(M.DT_REF) = YEAR(PVT.DT_REF)
          AND DATEPART(QUARTER, M.DT_REF) = DATEPART(QUARTER, PVT.DT_REF)
      )
    GROUP BY
      DATEADD(QUARTER, DATEDIFF(QUARTER, 0, PVT.DT_REF), 0), YEAR(PVT.DT_REF), DATEPART(QUARTER, PVT.DT_REF),
      PVT.ID_SISTEMA, PVT.ID_SITE, PVT.ID_OPERACAO, PVT.ID_KPI, UnpivotedData.ID_TIPO_VISAO

    UNION ALL

    ------------------------------------------------------------------
    -- YEAR (IBP.PEDRAVISAOANO)
    -- Só anos com mês carregado em PEDRAVISAOCONSOLIDADA no período, como no COO.
    ------------------------------------------------------------------
    SELECT
      DATEFROMPARTS(PVA.ANO, 1, 1) AS DT_IND,
      PVA.ID_SISTEMA, PVA.ID_SITE, PVA.ID_OPERACAO, PVA.ID_KPI,
      UnpivotedData.ID_TIPO_VISAO,
      '' AS PREFIXO,
      CASE
        WHEN UnpivotedData.ID_TIPO_VISAO = 1 THEN 'B'
        WHEN PVA.ANO < YEAR(@DT_REF) THEN 'A'
        ELSE 'F'
      END AS LETRA,
      SUM(ISNULL(UnpivotedData.Value, 0)) AS VL_KPI,
      'YEAR', 5,
      PVA.ANO, PVA.ANO
    FROM
      IBP.PEDRAVISAOANO PVA
      INNER JOIN IBP.DASHBOARD DASH
        ON PVA.ID_SISTEMA = DASH.ID_SISTEMA
        AND CONCAT(PVA.ID_SITE, '|', PVA.ID_OPERACAO, '|', PVA.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
      CROSS APPLY (
        SELECT 1 AS ID_TIPO_VISAO, PVA.VL_ORC * DASH.VL_FATOR AS Value
        UNION ALL
        SELECT 3, PVA.VL_PROJ * DASH.VL_FATOR
      ) AS UnpivotedData
    WHERE
      PVA.ANO BETWEEN YEAR(@DT_INI) AND YEAR(@DT_FIM)
      AND DASH.ID_DASH = @ID_DASH
      AND EXISTS (
        SELECT 1 FROM IBP.PEDRAVISAOCONSOLIDADA M
        WHERE M.DT_REF BETWEEN @DT_INI AND @DT_FIM
          AND YEAR(M.DT_REF) = PVA.ANO
      )
    GROUP BY
      PVA.ANO, PVA.ID_SISTEMA, PVA.ID_SITE, PVA.ID_OPERACAO, PVA.ID_KPI, UnpivotedData.ID_TIPO_VISAO

) AS P;

DECLARE @LINHAS INT = (SELECT COUNT(*) FROM #R);
IF @LINHAS = 0
  THROW 50002, 'A query não retornou linhas: nada foi gravado e a carga anterior foi mantida.', 1;

IF EXISTS (
  SELECT 1 FROM #R
  GROUP BY DT_IND, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI, CD_PERIODO, ID_TIPO_VISAO
  HAVING COUNT(*) > 1
)
  THROW 50003, 'Chave repetida no resultado: nada foi gravado.', 1;

-- ── 2. Regrava o mês do COO numa transação ───────────────────────────
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
       @DT_INI AS DT_INI, @DT_FIM AS DT_FIM, @DT_REAL AS DT_REAL, @NM_USUARIO AS NM_USUARIO;

SELECT CD_PERIODO, NM_TIPO_VISAO, COUNT(*) AS LINHAS
FROM IBP.PHUB_PERFORMANCESTUDIO
WHERE DT_REF = @DT_REF AND ID_DASH = @ID_DASH
GROUP BY CD_PERIODO, ORDEM_VISAO, ID_TIPO_VISAO, NM_TIPO_VISAO
ORDER BY ORDEM_VISAO, ID_TIPO_VISAO;

DROP TABLE #R;
