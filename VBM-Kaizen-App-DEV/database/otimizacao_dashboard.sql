/* ═══════════════════════════════════════════════════════════════════
   VBM Kaizen — índices para a base do DASHBOARD (30/10/2026)

   POR QUE
     GET /api/dashboard/dados monta, numa consulta só, TODOS os Kaizens
     (kzn_pedravisaoconsolidada UNION ALL kzn_hist_pedravisaoconsolidada)
     e, para CADA Kaizen, faz quatro buscas "TOP (1)" (ver
     dashboard-kaizen.js, consultaFatos):
       1. líder ............ MDM da origem por ID_USUARIO
       2. site do autor .... MDM da origem por ID_USUARIO
       3. fotografia ....... kzn_[hist_]kaizen_hierarquia por ID_KAIZEN
                             (ORDER BY DT_ATUALIZACAO DESC)
       4. hierarquia do MDM  kzn_mdm_hierarquia por ID_USUARIO (N3..N8)
     Com milhares de Kaizens, cada busca SEM índice vira uma varredura da
     tabela inteira POR LINHA. O caso mais provável é o da fotografia
     histórica: kzn_hist_kaizen_hierarquia foi carregada por fora do app
     e nada garante índice em ID_KAIZEN. Os índices abaixo transformam
     cada busca numa leitura direta.

   SEGURANÇA
     Idempotente: cada índice só é criado se a tabela existir e ainda não
     houver índice começando pela mesma coluna. Nenhum dado é alterado.
     Rode fora do horário de pico: criar índice lê a tabela inteira.

   ORDEM
     Etapa 0 (diagnóstico — guarde o resultado como "antes") → Etapa 1 →
     Etapa 2. Não precisa reiniciar o app: o plano novo vale na próxima
     montagem da base (até 30 min, ou "Atualizar" no dashboard).

   COMO CONFERIR O GANHO
     No log do app (Databricks), a linha
       [dashboard] base montada: N Kaizens (...) em X ms.
     mostra o tempo da consulta. Compare antes e depois.
   ═══════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;
GO

/* ───────────────────────────────────────────────────────────────────
   ETAPA 0 — DIAGNÓSTICO (não altera nada)
   ─────────────────────────────────────────────────────────────────── */

-- Linhas por tabela e se é HEAP (sem índice clusterizado)
SELECT  t.name AS TABELA,
        SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END) AS LINHAS,
        MAX(CASE WHEN p.index_id = 0 THEN 'SIM' ELSE '' END)      AS HEAP
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  JOIN sys.partitions p ON p.object_id = t.object_id
 WHERE s.name = 'ci'
   AND t.name IN ('kzn_pedravisaoconsolidada', 'kzn_hist_pedravisaoconsolidada',
                  'kzn_kaizen_hierarquia', 'kzn_hist_kaizen_hierarquia',
                  'kzn_mdm_hierarquia', 'kzn_hist_mdm_vbm_terc',
                  'kzn_membros_equipe', 'kzn_hist_membros_equipe',
                  'kzn_aprovador', 'kzn_hist_aprovador')
 GROUP BY t.name
 ORDER BY t.name;

-- Índices que já existem nessas tabelas
SELECT  t.name  AS TABELA,
        i.name  AS INDICE,
        i.type_desc AS TIPO,
        STUFF((SELECT ', ' + c.name
                 FROM sys.index_columns ic
                 JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                ORDER BY ic.key_ordinal
                FOR XML PATH('')), 1, 2, '') AS COLUNAS_CHAVE,
        STUFF((SELECT ', ' + c.name
                 FROM sys.index_columns ic
                 JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
                FOR XML PATH('')), 1, 2, '') AS COLUNAS_INCLUIDAS
  FROM sys.indexes i
  JOIN sys.tables  t ON t.object_id = i.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
 WHERE s.name = 'ci' AND i.type > 0
   AND t.name IN ('kzn_pedravisaoconsolidada', 'kzn_hist_pedravisaoconsolidada',
                  'kzn_kaizen_hierarquia', 'kzn_hist_kaizen_hierarquia',
                  'kzn_mdm_hierarquia', 'kzn_hist_mdm_vbm_terc',
                  'kzn_membros_equipe', 'kzn_hist_membros_equipe')
 ORDER BY t.name, i.index_id;
GO

/* ───────────────────────────────────────────────────────────────────
   ETAPA 1 — ÍNDICES
   Cada bloco: tabela existe + nenhum índice começa pela coluna da busca
   → cria. As colunas incluídas são só as que EXISTEM na tabela (as
   históricas foram carregadas por fora e podem não ter todas).
   ─────────────────────────────────────────────────────────────────── */

/* 1a. Fotografia HISTÓRICA da hierarquia por Kaizen — a suspeita nº 1.
   Busca: WHERE ID_KAIZEN = ? ORDER BY DT_ATUALIZACAO DESC, níveis N3..N8. */
DECLARE @tab SYSNAME = N'ci.kzn_hist_kaizen_hierarquia', @inc NVARCHAR(MAX), @cmd NVARCHAR(MAX);
IF OBJECT_ID(@tab) IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic
                  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                 WHERE ic.object_id = OBJECT_ID(@tab) AND ic.key_ordinal = 1 AND c.name = 'ID_KAIZEN')
BEGIN
    SELECT @inc = STRING_AGG(QUOTENAME(name), ', ') FROM sys.columns
     WHERE object_id = OBJECT_ID(@tab)
       AND name IN ('NM_HIERARQUIA_N3','NM_HIERARQUIA_N4','NM_HIERARQUIA_N5',
                    'NM_HIERARQUIA_N6','NM_HIERARQUIA_N7','NM_HIERARQUIA_N8','DT_ATUALIZACAO');
    SET @cmd = N'CREATE NONCLUSTERED INDEX IX_HIST_KZ_HIER_KAIZEN ON ' + @tab + N' (ID_KAIZEN)'
             + CASE WHEN @inc IS NULL THEN N'' ELSE N' INCLUDE (' + @inc + N')' END + N';';
    PRINT @cmd; EXEC sys.sp_executesql @cmd;
END
ELSE PRINT '1a: kzn_hist_kaizen_hierarquia ausente ou já indexada por ID_KAIZEN — nada a fazer.';
GO

/* 1b. Fotografia ATUAL — a PK já é ID_KAIZEN; só cria se não for. */
DECLARE @tab SYSNAME = N'ci.kzn_kaizen_hierarquia', @inc NVARCHAR(MAX), @cmd NVARCHAR(MAX);
IF OBJECT_ID(@tab) IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic
                  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                 WHERE ic.object_id = OBJECT_ID(@tab) AND ic.key_ordinal = 1 AND c.name = 'ID_KAIZEN')
BEGIN
    SELECT @inc = STRING_AGG(QUOTENAME(name), ', ') FROM sys.columns
     WHERE object_id = OBJECT_ID(@tab)
       AND name IN ('NM_HIERARQUIA_N3','NM_HIERARQUIA_N4','NM_HIERARQUIA_N5',
                    'NM_HIERARQUIA_N6','NM_HIERARQUIA_N7','NM_HIERARQUIA_N8','DT_ATUALIZACAO');
    SET @cmd = N'CREATE NONCLUSTERED INDEX IX_KZ_HIER_KAIZEN ON ' + @tab + N' (ID_KAIZEN)'
             + CASE WHEN @inc IS NULL THEN N'' ELSE N' INCLUDE (' + @inc + N')' END + N';';
    PRINT @cmd; EXEC sys.sp_executesql @cmd;
END
ELSE PRINT '1b: kzn_kaizen_hierarquia já indexada por ID_KAIZEN — nada a fazer.';
GO

/* 1c. MDM atual com os níveis N3..N8 junto.
   O IX_MDM_USUARIO (otimizacao_indices.sql) acha a pessoa, mas não
   carrega os níveis: para cada Kaizen sem fotografia o SQL volta à
   tabela para ler N3..N8. Este cobre a busca inteira. */
DECLARE @tab SYSNAME = N'ci.kzn_mdm_hierarquia', @inc NVARCHAR(MAX), @cmd NVARCHAR(MAX);
IF OBJECT_ID(@tab) IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(@tab) AND name = 'IX_MDM_USUARIO_HIER')
BEGIN
    SELECT @inc = STRING_AGG(QUOTENAME(name), ', ') FROM sys.columns
     WHERE object_id = OBJECT_ID(@tab)
       AND name IN ('NM_USUARIO','NM_SITE','NM_HIERARQUIA_N3','NM_HIERARQUIA_N4','NM_HIERARQUIA_N5',
                    'NM_HIERARQUIA_N6','NM_HIERARQUIA_N7','NM_HIERARQUIA_N8');
    SET @cmd = N'CREATE NONCLUSTERED INDEX IX_MDM_USUARIO_HIER ON ' + @tab + N' (ID_USUARIO, ID_TIPO_USUARIO)'
             + CASE WHEN @inc IS NULL THEN N'' ELSE N' INCLUDE (' + @inc + N')' END + N';';
    PRINT @cmd; EXEC sys.sp_executesql @cmd;
END
ELSE PRINT '1c: IX_MDM_USUARIO_HIER já existe — nada a fazer.';
GO

/* 1d. Espelho histórico do MDM (líder e site dos Kaizens históricos). */
DECLARE @tab SYSNAME = N'ci.kzn_hist_mdm_vbm_terc', @inc NVARCHAR(MAX), @chave NVARCHAR(200), @cmd NVARCHAR(MAX);
IF OBJECT_ID(@tab) IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic
                  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                 WHERE ic.object_id = OBJECT_ID(@tab) AND ic.key_ordinal = 1 AND c.name = 'ID_USUARIO')
BEGIN
    SET @chave = CASE WHEN COL_LENGTH(@tab, 'ID_TIPO_USUARIO') IS NULL THEN N'ID_USUARIO' ELSE N'ID_USUARIO, ID_TIPO_USUARIO' END;
    SELECT @inc = STRING_AGG(QUOTENAME(name), ', ') FROM sys.columns
     WHERE object_id = OBJECT_ID(@tab) AND name IN ('NM_USUARIO','NM_SITE');
    SET @cmd = N'CREATE NONCLUSTERED INDEX IX_HIST_MDM_USUARIO ON ' + @tab + N' (' + @chave + N')'
             + CASE WHEN @inc IS NULL THEN N'' ELSE N' INCLUDE (' + @inc + N')' END + N';';
    PRINT @cmd; EXEC sys.sp_executesql @cmd;
END
ELSE PRINT '1d: kzn_hist_mdm_vbm_terc ausente ou já indexada por ID_USUARIO — nada a fazer.';
GO

/* 1e. Equipe dos Kaizens HISTÓRICOS (aba Base de Dados do dashboard:
   membros por Kaizen). A atual já tem PK (ID_KAIZEN, ID_USUARIO). */
DECLARE @tab SYSNAME = N'ci.kzn_hist_membros_equipe', @cmd NVARCHAR(MAX);
IF OBJECT_ID(@tab) IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic
                  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                 WHERE ic.object_id = OBJECT_ID(@tab) AND ic.key_ordinal = 1 AND c.name = 'ID_KAIZEN')
BEGIN
    SET @cmd = N'CREATE NONCLUSTERED INDEX IX_HIST_MEMBROS_KAIZEN ON ' + @tab + N' (ID_KAIZEN) INCLUDE (ID_USUARIO);';
    PRINT @cmd; EXEC sys.sp_executesql @cmd;
END
ELSE PRINT '1e: kzn_hist_membros_equipe ausente ou já indexada por ID_KAIZEN — nada a fazer.';
GO

/* ───────────────────────────────────────────────────────────────────
   ETAPA 2 — ESTATÍSTICAS
   Tabelas carregadas em lote (as históricas) costumam ficar com
   estatística velha, e o otimizador escolhe plano ruim por isso.
   ─────────────────────────────────────────────────────────────────── */
IF OBJECT_ID('ci.kzn_hist_pedravisaoconsolidada') IS NOT NULL UPDATE STATISTICS ci.kzn_hist_pedravisaoconsolidada WITH FULLSCAN;
IF OBJECT_ID('ci.kzn_hist_kaizen_hierarquia')     IS NOT NULL UPDATE STATISTICS ci.kzn_hist_kaizen_hierarquia     WITH FULLSCAN;
IF OBJECT_ID('ci.kzn_hist_mdm_vbm_terc')          IS NOT NULL UPDATE STATISTICS ci.kzn_hist_mdm_vbm_terc          WITH FULLSCAN;
IF OBJECT_ID('ci.kzn_kaizen_hierarquia')          IS NOT NULL UPDATE STATISTICS ci.kzn_kaizen_hierarquia          WITH FULLSCAN;
IF OBJECT_ID('ci.kzn_mdm_hierarquia')             IS NOT NULL UPDATE STATISTICS ci.kzn_mdm_hierarquia             WITH FULLSCAN;
PRINT 'Estatísticas atualizadas.';
GO
