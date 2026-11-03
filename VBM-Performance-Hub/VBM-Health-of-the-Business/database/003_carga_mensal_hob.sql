-- ════════════════════════════════════════════════════════════════════
-- VBM Health of the Business — carga mensal em IBP.PHUB_PERFORMANCESTUDIO
-- Banco: BDIBPBMSA_PRD · rodar uma vez por mês (Data Factory), como o 003_carga_mensal_coo.sql
--
-- Mesmo formato da carga do COO (tabela do VBM Performance Studio):
--   DT_REF (tabela) = mês de GETDATE()-2, no dia 1 (ANO-MES-01), com realizado até o mês anterior
--                     (ex.: 2026-10-01 = realizado até setembro)
--   DT_IND (tabela) = mês da linha (para CD_PERIODO 'YEAR', qualquer mês do ano: a leitura fica com uma)
--   ID_TIPO_VISAO   = 1 Budget | 3 Act/Fcst (padrão VBM)
--   NM_VISAO        = rótulo da série: 'Sep B', 'Sep A', 'Oct F' (mês) ou '26B', '26F' (ano)
--   CD_PERIODO      = 'MONTH' (gráficos mês a mês) | 'YEAR' (pontes do EBITDA e do FCF)
--   Rodar de novo no mesmo mês apaga e regrava só DT_REF + ID_DASH do Health of the Business.
--
-- Pré-requisitos:
--   1. O dashboard cadastrado em IBP.DASHBOARD (um ID_DASH novo, com os KPIs: nome em NM_KPIS_DASH,
--      ID_ORDEM, SG_UNID, VL_CASADECIMAL). Os nomes esperados pela tela estão em 005_config_hob.sql.
--   2. O mesmo ID_DASH em @ID_DASH abaixo e em HOB_ID_DASH no app.yaml do Portal.
--
-- PENDENTE: a consulta de origem (bloco ORIGEM) — entregue pelo time de dados, no mesmo formato
-- da query do COO. Enquanto não houver carga gravada, a tela mostra os dados de demonstração.
-- ════════════════════════════════════════════════════════════════════
SET XACT_ABORT ON;

DECLARE @ID_DASH  INT  = NULL;  -- ← IBP.DASHBOARD.ID_DASH do Health of the Business (o mesmo de HOB_ID_DASH)
DECLARE @DT_CARGA DATE = DATEFROMPARTS(YEAR(GETDATE() - 2), MONTH(GETDATE() - 2), 1);  -- ex.: 28/10/2026 → 2026-10-01
DECLARE @DT_REF   DATE = DATEADD(MONTH, -1, GETDATE() - 2);                            -- último mês realizado

IF @ID_DASH IS NULL THROW 50020, 'Defina @ID_DASH (IBP.DASHBOARD.ID_DASH do Health of the Business): nada foi gravado.', 1;

BEGIN TRANSACTION;

DELETE FROM IBP.PHUB_PERFORMANCESTUDIO
WHERE DT_REF = @DT_CARGA AND ID_DASH = @ID_DASH;

INSERT INTO IBP.PHUB_PERFORMANCESTUDIO
  (DT_REF, DT_IND, ID_DASH, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI,
   ID_TIPO_VISAO, NM_TIPO_VISAO, NM_VISAO, VL_KPI,
   CD_PERIODO, ORDEM_VISAO, ORDEM_ANO, ORDEM_PERIODO, NM_USUARIO)
SELECT
  @DT_CARGA, ORIGEM.DT_REF, @ID_DASH, ORIGEM.ID_SISTEMA, ORIGEM.ID_SITE, ORIGEM.ID_OPERACAO, ORIGEM.ID_KPI,
  ORIGEM.ID_TIPO_VISAO_VBM, MAX(ORIGEM.NM_TIPO_VISAO), MAX(ORIGEM.NM_VISAO), SUM(ISNULL(ORIGEM.VL_KPI, 0)),
  ORIGEM.CD_PERIODO, ORIGEM.ORDEM_VISAO, ORIGEM.ORDEM_ANO, ORIGEM.ORDEM_PERIODO, SUSER_SNAME()
FROM (
  -- ── ORIGEM (PENDENTE) ─────────────────────────────────────────────
  -- Substituir pelo SELECT do time de dados, com estas colunas (mesmas da carga do COO):
  --   DT_REF (mês da linha), ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI  → chaves de IBP.DASHBOARD (@ID_DASH)
  --   ID_TIPO_VISAO_VBM (1 Budget | 3 Act/Fcst), NM_TIPO_VISAO ('Budget' | 'Act/Fcst'),
  --   NM_VISAO ('Sep B' / 'Sep A' / 'Oct F' ou '26B' / '26F'; A = mês até @DT_REF, F = depois),
  --   VL_KPI, CD_PERIODO ('MONTH' | 'YEAR'), ORDEM_VISAO, ORDEM_ANO (ano), ORDEM_PERIODO (mês, 1..12)
  SELECT
    CAST(NULL AS DATE)         AS DT_REF,
    CAST(NULL AS INT)          AS ID_SISTEMA,
    CAST(NULL AS INT)          AS ID_SITE,
    CAST(NULL AS INT)          AS ID_OPERACAO,
    CAST(NULL AS INT)          AS ID_KPI,
    CAST(NULL AS INT)          AS ID_TIPO_VISAO_VBM,
    CAST(NULL AS VARCHAR(20))  AS NM_TIPO_VISAO,
    CAST(NULL AS VARCHAR(20))  AS NM_VISAO,
    CAST(NULL AS FLOAT)        AS VL_KPI,
    CAST(NULL AS VARCHAR(10))  AS CD_PERIODO,
    CAST(NULL AS INT)          AS ORDEM_VISAO,
    CAST(NULL AS INT)          AS ORDEM_ANO,
    CAST(NULL AS INT)          AS ORDEM_PERIODO
  WHERE 1 = 0
  -- ──────────────────────────────────────────────────────────────────
) ORIGEM
GROUP BY ORIGEM.DT_REF, ORIGEM.ID_SISTEMA, ORIGEM.ID_SITE, ORIGEM.ID_OPERACAO, ORIGEM.ID_KPI,
         ORIGEM.ID_TIPO_VISAO_VBM, ORIGEM.CD_PERIODO, ORIGEM.ORDEM_VISAO, ORIGEM.ORDEM_ANO, ORIGEM.ORDEM_PERIODO;

COMMIT TRANSACTION;

-- Conferência da carga gravada
SELECT @DT_CARGA AS DT_REF, @ID_DASH AS ID_DASH, CD_PERIODO, NM_TIPO_VISAO, COUNT(*) AS LINHAS
FROM IBP.PHUB_PERFORMANCESTUDIO
WHERE DT_REF = @DT_CARGA AND ID_DASH = @ID_DASH
GROUP BY CD_PERIODO, NM_TIPO_VISAO
ORDER BY CD_PERIODO, NM_TIPO_VISAO;
