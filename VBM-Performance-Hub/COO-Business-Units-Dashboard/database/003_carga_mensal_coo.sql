/* ════════════════════════════════════════════════════════════════════
   COO Business Units Dashboard — carga mensal em IBP.PHUB_PERFORMANCESTUDIO
   Banco: BDIBPBMSA_PRD

   Adaptação de coo_dashboard.sql para gravar na MESMA tabela do
   VBM Performance Studio (VBM-Performance-Studio/database/002_snapshot_mensal.sql),
   com as MESMAS regras da carga do VBM (VBM-Performance-Studio/database/003_carga_mensal.sql).
   A tabela não muda; as linhas do COO ficam separadas por ID_DASH = 15.
   Studio e Health (ID_DASH 21) não leem nem apagam estas linhas.

   Pode rodar de novo para o mesmo mês: apaga e regrava só DT_REF + ID_DASH 15,
   numa transação (tudo ou nada). Se a query falhar, vier vazia ou com chave
   repetida, nada é apagado.

   Parâmetros (bloco abaixo):
     @DT_REF     mês de referência = mês em aberto (ex.: '2026-10-01' → realizado
                 até setembro, projeção a partir de outubro).
                 NULL = IBP.CONTROLE_PROCESSOS.DT_INI - 1 mês (ID_PROCESSO = 2), como no VBM.
     @NM_USUARIO quem roda a carga. NULL = login da conexão (SUSER_SNAME()).
     @ID_DASH    15 = COO Business Units Dashboard.
     @ANOS_ANTES anos anteriores incluídos (1 = desde jan do ano anterior,
                 = '2025-01-01' da query do COO em 2026).

   Regras do VBM aplicadas (diferenças em relação a coo_dashboard.sql):
     · Datas derivadas de @DT_REF, sem GETDATE(): reprocessar um mês dá o mesmo recorte.
         @DT_REAL = @DT_REF - 1 mês (último mês com REALIZADO = mês do ciclo do COO)
         @DT_INI  = 1º de janeiro de (ano de @DT_REAL - @ANOS_ANTES)
         @DT_FIM  = dezembro do ano de @DT_REF
     · Act/Fcst = VL_REAL (NULL = 0) até @DT_REAL e VL_PROJ depois
       (o COO usava VL_REAL só até o mês anterior a @DT_REAL).
     · Trimestre e ano = soma dos meses de PEDRAVISAOCONSOLIDADA com a regra acima
       (o COO lia PEDRAVISAOTRIMESTRE e PEDRAVISAOANO).
     · Plan também no trimestre e no ano; o do trimestre usa o plano congelado
       de IBP.HIST_SUPPLY (DT_REF = 1º mês do trimestre), senão VL_SUPPLY.
     · Rótulo A/F: mês 'A' até @DT_REAL; trimestre 'A' quando termina antes de
       @DT_REF; ano 'A' quando é anterior ao ano de @DT_REF.
       Formato do VBM: 'SepA 26', 'Q3A 26', '26A'.
     · Valor vazio grava 0 (VL_KPI é NOT NULL), como no VBM.
     · Períodos gravados: os que o COO usa — MONTH, QUARTER e YEAR.
   Nome, unidade, casas decimais e ordem do KPI não são gravados: vêm de
   IBP.DASHBOARD na leitura (mesmo join do VBM).

   Diferença técnica sem efeito no resultado: as junções com IBP.DASHBOARD usam
   separador ('|') no CONCAT, como já é no COO, para não juntar chaves
   diferentes (1|1|15 x 11|1|5).

   Atenção: reprocessar um mês antigo usa os valores ATUAIS de
   PEDRAVISAOCONSOLIDADA (projeções e realizados de hoje), não os da época.
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

-- ── 1. Base mensal com as regras do VBM ──────────────────────────────
IF OBJECT_ID('tempdb..#B') IS NOT NULL DROP TABLE #B;

SELECT
  PVC.DT_REF,
  PVC.ID_SISTEMA, PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI,
  ISNULL(PVC.VL_ORC * DASH.VL_FATOR, 0)    AS VL_B,
  ISNULL(PVC.VL_SUPPLY * DASH.VL_FATOR, 0) AS VL_P,
  -- Plano do trimestre congelado (HIST_SUPPLY); sem registro, segue VL_SUPPLY
  ISNULL(CASE WHEN HS.QT > 0 THEN HS.VL_SUPPLY ELSE PVC.VL_SUPPLY END * DASH.VL_FATOR, 0) AS VL_P_TRIM,
  ISNULL(CASE
           WHEN PVC.DT_REF <= @DT_REAL THEN ISNULL(PVC.VL_REAL, 0) * DASH.VL_FATOR
           ELSE PVC.VL_PROJ * DASH.VL_FATOR
         END, 0) AS VL_AF
INTO #B
FROM IBP.PEDRAVISAOCONSOLIDADA PVC
INNER JOIN IBP.DASHBOARD DASH
  ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
  AND CONCAT(PVC.ID_SITE, '|', PVC.ID_OPERACAO, '|', PVC.ID_KPI) = CONCAT(DASH.ID_SITE, '|', DASH.ID_OPERACAO, '|', DASH.ID_KPI)
OUTER APPLY (
  SELECT SUM(H.VL_SUPPLY) AS VL_SUPPLY, COUNT(*) AS QT
  FROM IBP.HIST_SUPPLY H
  WHERE H.ID_SISTEMA = PVC.ID_SISTEMA
    AND H.ID_SITE = PVC.ID_SITE
    AND H.ID_OPERACAO = PVC.ID_OPERACAO
    AND H.ID_KPI = PVC.ID_KPI
    AND H.DT_REF = DATEADD(QUARTER, DATEDIFF(QUARTER, 0, PVC.DT_REF), 0)
    AND H.DT_IND = PVC.DT_REF
) HS
WHERE PVC.DT_REF BETWEEN @DT_INI AND @DT_FIM
  AND DASH.ID_DASH = @ID_DASH;

-- ── 2. Períodos e séries no formato de IBP.PHUB_PERFORMANCESTUDIO ────
IF OBJECT_ID('tempdb..#R') IS NOT NULL DROP TABLE #R;

SELECT
  P.DT_IND,
  P.ID_SISTEMA, P.ID_SITE, P.ID_OPERACAO, P.ID_KPI,
  S.ID_TIPO_VISAO,
  S.NM_TIPO_VISAO,
  CASE WHEN P.CD_PERIODO = 'YEAR'
       THEN CONCAT(RIGHT(P.ORDEM_ANO, 2), S.LETRA)
       ELSE CONCAT(P.PREFIXO, S.LETRA, ' ', RIGHT(P.ORDEM_ANO, 2))
  END AS NM_VISAO,
  S.VL_KPI,
  P.CD_PERIODO, P.ORDEM_VISAO, P.ORDEM_ANO, P.ORDEM_PERIODO
INTO #R
FROM (
    -- MONTH
    SELECT
      DT_REF AS DT_IND, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI,
      'MONTH' AS CD_PERIODO, 1 AS ORDEM_VISAO, YEAR(DT_REF) AS ORDEM_ANO, MONTH(DT_REF) AS ORDEM_PERIODO,
      CHOOSE(MONTH(DT_REF), 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec') AS PREFIXO,
      CASE WHEN DT_REF <= @DT_REAL THEN 'A' ELSE 'F' END AS LETRA_AF,
      SUM(VL_B) AS VL_B, SUM(VL_P) AS VL_P, SUM(VL_AF) AS VL_AF
    FROM #B
    GROUP BY DT_REF, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI

    UNION ALL

    -- QUARTER
    SELECT
      DATEADD(QUARTER, DATEDIFF(QUARTER, 0, DT_REF), 0), ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI,
      'QUARTER', 2, YEAR(DT_REF), DATEPART(QUARTER, DT_REF),
      CONCAT('Q', DATEPART(QUARTER, DT_REF)),
      CASE WHEN EOMONTH(DATEFROMPARTS(YEAR(DT_REF), DATEPART(QUARTER, DT_REF) * 3, 1)) <= @DT_REF THEN 'A' ELSE 'F' END,
      SUM(VL_B), SUM(VL_P_TRIM), SUM(VL_AF)
    FROM #B
    GROUP BY DATEADD(QUARTER, DATEDIFF(QUARTER, 0, DT_REF), 0), YEAR(DT_REF), DATEPART(QUARTER, DT_REF),
             ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI

    UNION ALL

    -- YEAR
    SELECT
      DATEFROMPARTS(YEAR(DT_REF), 1, 1), ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI,
      'YEAR', 5, YEAR(DT_REF), YEAR(DT_REF),
      '',
      CASE WHEN YEAR(DT_REF) < YEAR(@DT_REF) THEN 'A' ELSE 'F' END,
      SUM(VL_B), SUM(VL_P), SUM(VL_AF)
    FROM #B
    GROUP BY YEAR(DT_REF), ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI
) AS P
CROSS APPLY (VALUES
  (CAST(1 AS TINYINT), N'Budget',   P.VL_B,  'B'),
  (CAST(2 AS TINYINT), N'Plan',     P.VL_P,  'P'),
  (CAST(3 AS TINYINT), N'Act/Fcst', P.VL_AF, P.LETRA_AF)
) AS S (ID_TIPO_VISAO, NM_TIPO_VISAO, VL_KPI, LETRA);

DECLARE @LINHAS INT = (SELECT COUNT(*) FROM #R);
IF @LINHAS = 0
  THROW 50002, 'A query não retornou linhas: nada foi gravado e a carga anterior foi mantida.', 1;

IF EXISTS (
  SELECT 1 FROM #R
  GROUP BY DT_IND, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI, CD_PERIODO, ID_TIPO_VISAO
  HAVING COUNT(*) > 1
)
  THROW 50003, 'Chave repetida no resultado: nada foi gravado.', 1;

-- ── 3. Regrava o mês do COO numa transação ───────────────────────────
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

-- ── 4. Resumo da carga ───────────────────────────────────────────────
SELECT @DT_REF AS DT_REF, @ID_DASH AS ID_DASH, @LINHAS AS LINHAS_GRAVADAS,
       @DT_INI AS DT_INI, @DT_FIM AS DT_FIM, @DT_REAL AS DT_REAL, @NM_USUARIO AS NM_USUARIO;

SELECT CD_PERIODO, NM_TIPO_VISAO, COUNT(*) AS LINHAS
FROM IBP.PHUB_PERFORMANCESTUDIO
WHERE DT_REF = @DT_REF AND ID_DASH = @ID_DASH
GROUP BY CD_PERIODO, ORDEM_VISAO, ID_TIPO_VISAO, NM_TIPO_VISAO
ORDER BY ORDEM_VISAO, ID_TIPO_VISAO;

DROP TABLE #R;
DROP TABLE #B;
