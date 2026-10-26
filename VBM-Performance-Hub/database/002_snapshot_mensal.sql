/* ════════════════════════════════════════════════════════════════════
   VBM-Performance-Hub — resultado mensal dos gráficos (tabela solta)
   Banco: BDIBPBMSA_PRD  (PERFORMANCEHUB_AZURE_SQL_DATABASE no app.yaml)

   PROPOSTA PARA AVALIAÇÃO — não executar antes da aprovação da estrutura.

   Grava o RESULTADO da CHART_DATA_AO_VIVO_SQL (performancehub-api.js), já calculado, uma carga por mês
   fechado. Só as colunas que o dashboard usa; nome do KPI e unidade
   vêm por join com IBP.DASHBOARD na leitura (ver final do arquivo).

   DT_REF  = último mês FECHADO da carga (= @DT_REF da query =
             IBP.CONTROLE_PROCESSOS.DT_INI - 1 mês, ID_PROCESSO = 2).
             Ex.: 2026-09-01 → realizado até 09/2026; projeção e planos a
             partir de 10/2026; YTD de janeiro a setembro em todos os anos.
             A carga roda no mês seguinte ao fechado (o YTD da query usa GETDATE()).
   DT_IND  = início do período da linha (o "DT_REF" que a query devolve).
   ID_DASH = dashboard de origem em IBP.DASHBOARD (21 = VBM Production Analytics).

   Nomes x query atual:
     ID_TIPO_VISAO  ← ORDEM_SERIE    NM_TIPO_VISAO ← NM_TYPE
     NM_VISAO       ← Type           VL_KPI        ← Value
     CD_PERIODO     ← CD_VISAO
   ════════════════════════════════════════════════════════════════════ */
IF OBJECT_ID(N'IBP.PHUB_PERFORMANCESTUDIO', N'U') IS NULL
BEGIN
  CREATE TABLE IBP.PHUB_PERFORMANCESTUDIO (
    DT_REF            DATE           NOT NULL,  -- último mês fechado da carga (ex.: 2026-09-01)
    DT_IND            DATE           NOT NULL,  -- início do período da linha (mês, trimestre, semestre ou ano)
    ID_DASH           INT            NOT NULL,  -- IBP.DASHBOARD.ID_DASH (21)
    ID_SISTEMA        INT            NOT NULL,
    ID_SITE           INT            NOT NULL,
    ID_OPERACAO       INT            NOT NULL,
    ID_KPI            INT            NOT NULL,
    ID_TIPO_VISAO     TINYINT        NOT NULL,  -- série: 1 Budget | 2 Plan | 3 Act/Fcst
    NM_TIPO_VISAO     NVARCHAR(20)   NOT NULL,  -- Budget | Plan | Act/Fcst
    NM_VISAO          NVARCHAR(20)   NOT NULL,  -- rótulo do eixo (ex.: SepA 26, Q4F 26, YTDA 25, 26F)
    VL_KPI            FLOAT          NOT NULL,  -- valor calculado (com VL_FATOR aplicado)
    CD_PERIODO        VARCHAR(10)    NOT NULL,  -- recorte: MONTH | QUARTER | SEMESTER | YTD | YEAR
    ORDEM_VISAO       TINYINT        NOT NULL,  -- 1 MONTH | 2 QUARTER | 3 SEMESTER | 4 YTD | 5 YEAR
    ORDEM_ANO         SMALLINT       NOT NULL,
    ORDEM_PERIODO     SMALLINT       NOT NULL,  -- mês (1–12), trimestre (1–4), semestre (1–2) ou ano
    NM_USUARIO        NVARCHAR(200)  NULL,      -- quem gerou a carga (X-Forwarded-Email ou job)
    DT_ATUALIZACAO    DATETIME2(0)   NOT NULL CONSTRAINT DF_PHUB_PERFORMANCESTUDIO_ATUALIZACAO DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_PHUB_PERFORMANCESTUDIO PRIMARY KEY CLUSTERED
      (DT_REF, DT_IND, ID_DASH, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI, CD_PERIODO, ID_TIPO_VISAO),
    CONSTRAINT CK_PHUB_PERFORMANCESTUDIO_DT_REF CHECK (DAY(DT_REF) = 1),
    CONSTRAINT CK_PHUB_PERFORMANCESTUDIO_PERIODO CHECK (CD_PERIODO IN ('MONTH', 'QUARTER', 'SEMESTER', 'YTD', 'YEAR')),
    CONSTRAINT CK_PHUB_PERFORMANCESTUDIO_TIPO_VISAO CHECK (ID_TIPO_VISAO IN (1, 2, 3))
  );
END
GO

/* Permissão mínima para o login do app (o mesmo de db-user/db-password).
   DELETE só para regravar um mês (apaga e insere DT_REF + ID_DASH numa transação).

GRANT SELECT, INSERT, DELETE ON IBP.PHUB_PERFORMANCESTUDIO TO [<usuario-do-app>];
*/

/* ── Leitura com nome do KPI e unidade (join com IBP.DASHBOARD) ────────
   Devolve as mesmas colunas que a API entrega hoje ao dashboard (apelidos).

SELECT R.DT_IND AS DT_REF, R.ID_SISTEMA, R.ID_SITE, R.ID_OPERACAO, R.ID_KPI,
       D.NM_KPIS_DASH AS NM_KPI, D.SG_UNID,
       R.NM_TIPO_VISAO AS NM_TYPE, R.NM_VISAO AS [Type], R.VL_KPI AS [Value],
       R.CD_PERIODO AS CD_VISAO, R.ORDEM_VISAO, R.ORDEM_ANO, R.ORDEM_PERIODO,
       R.ID_TIPO_VISAO AS ORDEM_SERIE
FROM IBP.PHUB_PERFORMANCESTUDIO R
INNER JOIN IBP.DASHBOARD D
  ON D.ID_DASH = R.ID_DASH
  AND D.ID_SISTEMA = R.ID_SISTEMA AND D.ID_SITE = R.ID_SITE
  AND D.ID_OPERACAO = R.ID_OPERACAO AND D.ID_KPI = R.ID_KPI
WHERE R.DT_REF = @DT_REF AND R.ID_DASH = 21
ORDER BY R.ORDEM_ANO, R.ORDEM_VISAO, R.ORDEM_PERIODO, R.ID_TIPO_VISAO;
*/

/* ── Conferências antes de aprovar (somente leitura) ───────────────────
   Rodar sobre o resultado da CHART_DATA_AO_VIVO_SQL gravado numa temporária:
   SELECT ... INTO #R FROM (<query sem ORDER BY>) Q

   1) A chave não repete (deve voltar vazio). Se voltar linhas, IBP.DASHBOARD
      tem mais de um nome/unidade para o mesmo KPI no dashboard 21:
      SELECT DT_REF, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI, CD_VISAO, ORDEM_SERIE, COUNT(*) AS QTD
      FROM #R
      GROUP BY DT_REF, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI, CD_VISAO, ORDEM_SERIE
      HAVING COUNT(*) > 1;

   2) Volume por carga:
      SELECT COUNT(*) AS LINHAS FROM #R;

   3) Tamanho máximo do rótulo x NVARCHAR(20) de NM_VISAO:
      SELECT MAX(LEN([Type])) AS NM_VISAO FROM #R;

   4) Tipos de origem (FLOAT x DECIMAL em VL_KPI; INT nas chaves ID_*):
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'IBP' AND TABLE_NAME IN ('PEDRAVISAOCONSOLIDADA', 'HIST_SUPPLY', 'DASHBOARD')
        AND COLUMN_NAME IN ('VL_REAL', 'VL_PROJ', 'VL_ORC', 'VL_SUPPLY', 'VL_FATOR',
                            'ID_SISTEMA', 'ID_SITE', 'ID_OPERACAO', 'ID_KPI', 'ID_DASH');
*/
