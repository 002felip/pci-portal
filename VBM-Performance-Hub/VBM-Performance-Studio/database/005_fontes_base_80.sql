/* ════════════════════════════════════════════════════════════════════
   VBM-Performance-Studio — fontes: 80% passa a ser o novo 100%
   Banco: BDIBPBMSA_PRD

   A partir desta versão, 100% na aba Fontes = 80% do tamanho antigo
   (FONTE_BASE no index.html). Este script converte o dashboard informado:
   toda fonte gravada com escala 80 passa a 100, para continuar com o mesmo
   tamanho na tela e aparecer como 100% na edição.

   Onde as fontes ficam gravadas:
     IBP.PHUB_PS_SETUP.DS_LAYOUT         cópia de cada gráfico do dashboard
     tabela de configuração (@TABELA_CONFIG, a mesma de PERFORMANCEHUB_CONFIG_TABLE
     do app; padrão IBP.QUARTELY_CONFIG_GRAFICO).DS_CONFIG: gráficos vinculados
     a um registro (cfg.idConfig) — este prevalece ao abrir. Se a tabela não
     existir no banco, o app usa só o layout e esta parte é pulada.
   Só os registros de configuração usados pelos gráficos deste dashboard são
   alterados. Atenção: se outro app (Health of the Business, COO Historical)
   usar os mesmos registros, as fontes dele também passam de 80% para 100%;
   confira a lista do passo 1 antes de rodar o passo 2.

   Rodar de novo não muda nada (não sobra escala 80 para converter).
   ════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @NM_DASHBOARD  NVARCHAR(100) = N'VBM Performance Studio';
DECLARE @TABELA_CONFIG NVARCHAR(200) = N'IBP.QUARTELY_CONFIG_GRAFICO';

-- Tabela de configuração existe? (senão, só o layout do dashboard é convertido)
DECLARE @TEM_CONFIG BIT = CASE WHEN OBJECT_ID(@TABELA_CONFIG, N'U') IS NOT NULL THEN 1 ELSE 0 END;
DECLARE @T NVARCHAR(300) = QUOTENAME(PARSENAME(@TABELA_CONFIG, 2)) + N'.' + QUOTENAME(PARSENAME(@TABELA_CONFIG, 1));
DECLARE @Q NVARCHAR(MAX);
IF @TEM_CONFIG = 0 PRINT N'Tabela ' + @TABELA_CONFIG + N' não encontrada: só IBP.PHUB_PS_SETUP será convertida.';

-- ── 1. Conferência (antes) ───────────────────────────────────────────
SELECT S.ID_DASHBOARD, S.NM_DASHBOARD, S.NM_USUARIO_CRIACAO, S.SG_ATIVO,
       G.[key] AS GRAFICO, JSON_VALUE(G.value, '$.cfg.nome') AS NM_GRAFICO,
       JSON_VALUE(G.value, '$.cfg.idConfig') AS ID_CONFIG,
       JSON_VALUE(G.value, '$.cfg.fontes.titulo.escala')  AS TITULO,
       JSON_VALUE(G.value, '$.cfg.fontes.unidade.escala') AS UNIDADE,
       JSON_VALUE(G.value, '$.cfg.fontes.valores.escala') AS VALORES,
       JSON_VALUE(G.value, '$.cfg.fontes.deltas.escala')  AS DELTAS,
       JSON_VALUE(G.value, '$.cfg.fontes.eixo.escala')    AS EIXO
FROM IBP.PHUB_PS_SETUP S
CROSS APPLY OPENJSON(S.DS_LAYOUT, '$.charts') G
WHERE S.NM_DASHBOARD = @NM_DASHBOARD;

IF OBJECT_ID('tempdb..#CFG') IS NOT NULL DROP TABLE #CFG;
SELECT DISTINCT TRY_CAST(JSON_VALUE(G.value, '$.cfg.idConfig') AS INT) AS ID_CONFIG
INTO #CFG
FROM IBP.PHUB_PS_SETUP S
CROSS APPLY OPENJSON(S.DS_LAYOUT, '$.charts') G
WHERE S.NM_DASHBOARD = @NM_DASHBOARD
  AND TRY_CAST(JSON_VALUE(G.value, '$.cfg.idConfig') AS INT) IS NOT NULL;

IF @TEM_CONFIG = 1
BEGIN
  SET @Q = N'SELECT C.ID_CONFIG, C.NM_GRAFICO,
       JSON_VALUE(C.DS_CONFIG, ''$.fontes.titulo.escala'')  AS TITULO,
       JSON_VALUE(C.DS_CONFIG, ''$.fontes.unidade.escala'') AS UNIDADE,
       JSON_VALUE(C.DS_CONFIG, ''$.fontes.valores.escala'') AS VALORES,
       JSON_VALUE(C.DS_CONFIG, ''$.fontes.deltas.escala'')  AS DELTAS,
       JSON_VALUE(C.DS_CONFIG, ''$.fontes.eixo.escala'')    AS EIXO
     FROM ' + @T + N' C
     WHERE C.ID_CONFIG IN (SELECT ID_CONFIG FROM #CFG);';
  EXEC sys.sp_executesql @Q;
END

-- ── 2. Conversão 80 → 100 (tudo ou nada) ─────────────────────────────
BEGIN TRY
  BEGIN TRANSACTION;

  UPDATE IBP.PHUB_PS_SETUP
     SET DS_LAYOUT = REPLACE(DS_LAYOUT, '"escala":80', '"escala":100'),
         DT_ATUALIZACAO = SYSUTCDATETIME()
   WHERE NM_DASHBOARD = @NM_DASHBOARD
     AND DS_LAYOUT LIKE '%"escala":80%';
  SELECT @@ROWCOUNT AS DASHBOARDS_ALTERADOS;

  IF @TEM_CONFIG = 1
  BEGIN
    SET @Q = N'UPDATE ' + @T + N'
       SET DS_CONFIG = REPLACE(DS_CONFIG, ''"escala":80'', ''"escala":100''),
           DT_ATUALIZACAO = SYSUTCDATETIME()
     WHERE ID_CONFIG IN (SELECT ID_CONFIG FROM #CFG)
       AND DS_CONFIG LIKE ''%"escala":80%'';
     SELECT @@ROWCOUNT AS CONFIGURACOES_ALTERADAS;';
    EXEC sys.sp_executesql @Q;
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

-- ── 3. Conferência (depois): não deve sobrar escala 80 ────────────────
SELECT S.ID_DASHBOARD, G.[key] AS GRAFICO,
       JSON_VALUE(G.value, '$.cfg.fontes.titulo.escala')  AS TITULO,
       JSON_VALUE(G.value, '$.cfg.fontes.unidade.escala') AS UNIDADE,
       JSON_VALUE(G.value, '$.cfg.fontes.valores.escala') AS VALORES,
       JSON_VALUE(G.value, '$.cfg.fontes.deltas.escala')  AS DELTAS,
       JSON_VALUE(G.value, '$.cfg.fontes.eixo.escala')    AS EIXO
FROM IBP.PHUB_PS_SETUP S
CROSS APPLY OPENJSON(S.DS_LAYOUT, '$.charts') G
WHERE S.NM_DASHBOARD = @NM_DASHBOARD;

DROP TABLE #CFG;
