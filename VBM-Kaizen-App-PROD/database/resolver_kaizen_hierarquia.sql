/* =====================================================================
   VBM Kaizen — RESOLVE ci.kzn_kaizen_hierarquia de uma vez
   =====================================================================

   Um script só: diagnostica, corrige o que estiver errado, grava os
   Kaizens que já existem e diz em português o que aconteceu.

   Execute e me mande a aba "Mensagens" inteira. Ela contém tudo o que
   falta saber — não é preciso consultar mais nada.

   Para só olhar sem alterar nada, troque @APLICAR para 0.
   ===================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT OFF;   /* o TRY/CATCH do passo 4 precisa disto */

DECLARE @APLICAR bit = 1;

PRINT '===================================================================';
PRINT ' 1. COMO A TABELA ESTA AMARRADA HOJE';
PRINT '===================================================================';

DECLARE @linha nvarchar(max);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT CONCAT('   ', fk.name, ' : ', cp.name, '  ->  ',
                OBJECT_SCHEMA_NAME(fk.referenced_object_id), '.',
                OBJECT_NAME(fk.referenced_object_id), ' . ', cr.name)
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id
    JOIN sys.columns cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
   WHERE fk.parent_object_id = OBJECT_ID('ci.kzn_kaizen_hierarquia');
OPEN c; FETCH NEXT FROM c INTO @linha;
IF @@FETCH_STATUS <> 0 PRINT '   (nenhuma FOREIGN KEY)';
WHILE @@FETCH_STATUS = 0 BEGIN PRINT @linha; FETCH NEXT FROM c INTO @linha; END
CLOSE c; DEALLOCATE c;

/* Gatilhos: um gatilho quebrado barra TODA gravacao na tabela, e o erro
   sai com o nome dele, nao com o nome da tabela. Foi o caso aqui:
   TR_KZN_KAIZEN_HIERARQUIA_UPD referencia a coluna ID_KAIZEN_HIERARQUIA,
   que nao existe (a PK da tabela chama ID_KAIZEN). Por isso o texto de
   cada gatilho e impresso por inteiro: e nele que esta o defeito. */
PRINT '';
PRINT '   Gatilhos na tabela:';
DECLARE t CURSOR LOCAL FAST_FORWARD FOR
  SELECT CONCAT('   ', name, CASE WHEN is_disabled = 1 THEN ' (DESABILITADO)' ELSE '' END,
                CHAR(13), CHAR(10), '   ---------- texto ----------', CHAR(13), CHAR(10),
                OBJECT_DEFINITION(object_id))
    FROM sys.triggers WHERE parent_id = OBJECT_ID('ci.kzn_kaizen_hierarquia');
OPEN t; FETCH NEXT FROM t INTO @linha;
IF @@FETCH_STATUS <> 0 PRINT '   (nenhum)';
WHILE @@FETCH_STATUS = 0 BEGIN PRINT @linha; FETCH NEXT FROM t INTO @linha; END
CLOSE t; DEALLOCATE t;

/* Colunas reais da tabela, para comparar com o que o gatilho cita. */
PRINT '';
PRINT '   Colunas que a tabela REALMENTE tem:';
DECLARE k CURSOR LOCAL FAST_FORWARD FOR
  SELECT CONCAT('   ', name) FROM sys.columns
   WHERE object_id = OBJECT_ID('ci.kzn_kaizen_hierarquia') ORDER BY column_id;
OPEN k; FETCH NEXT FROM k INTO @linha;
WHILE @@FETCH_STATUS = 0 BEGIN PRINT @linha; FETCH NEXT FROM k INTO @linha; END
CLOSE k; DEALLOCATE k;

PRINT '';
PRINT '===================================================================';
PRINT ' 2. O LIDER 181222 EXISTE NO MDM?';
PRINT '===================================================================';
IF EXISTS (SELECT 1 FROM ci.kzn_mdm_hierarquia WHERE ID_USUARIO = 181222)
BEGIN
    PRINT '   SIM. Atencao ao numero de LINHAS abaixo: a PK do MDM e composta';
    PRINT '   (ID_USUARIO + CD_MATRICULA + ID_TIPO_USUARIO), entao o mesmo';
    PRINT '   ID_USUARIO pode aparecer varias vezes. O MERGE usa TOP (1) por';
    PRINT '   ID_TIPO_USUARIO justamente por isso.';
    SELECT ID_USUARIO, CD_MATRICULA, ID_TIPO_USUARIO,
           NM_HIERARQUIA_N1, NM_HIERARQUIA_N2, NM_HIERARQUIA_N3, NM_HIERARQUIA_N4,
           NM_HIERARQUIA_N5, NM_HIERARQUIA_N6, NM_HIERARQUIA_N7, NM_HIERARQUIA_N8
      FROM ci.kzn_mdm_hierarquia WHERE ID_USUARIO = 181222
     ORDER BY ID_TIPO_USUARIO;
END
ELSE
    PRINT '   NAO. Sem linha em ci.kzn_mdm_hierarquia para ID_USUARIO = 181222.';

PRINT '';
PRINT '===================================================================';
PRINT ' 3. CORRIGE AS FKs FORA DO LUGAR';
PRINT '===================================================================';

DECLARE @fkKaizen sysname, @fkKaizenOk bit = 0,
        @fkLider  sysname, @fkLiderOk  bit = 0;

;WITH fks AS (
  SELECT fk.name AS nome, cp.name AS coluna,
         OBJECT_SCHEMA_NAME(fk.referenced_object_id) + '.' + OBJECT_NAME(fk.referenced_object_id) AS ref,
         cr.name AS refcol,
         COUNT(*) OVER (PARTITION BY fk.object_id) AS qtd
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id
    JOIN sys.columns cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
   WHERE fk.parent_object_id = OBJECT_ID('ci.kzn_kaizen_hierarquia')
)
SELECT @fkKaizen = MAX(CASE WHEN coluna='ID_KAIZEN'        AND qtd=1 THEN nome END),
       @fkLider  = MAX(CASE WHEN coluna='ID_USUARIO_LIDER' AND qtd=1 THEN nome END),
       @fkKaizenOk = MAX(CASE WHEN coluna='ID_KAIZEN' AND qtd=1
                               AND ref='ci.kzn_pedravisaoconsolidada' AND refcol='ID_KAIZEN' THEN 1 ELSE 0 END),
       @fkLiderOk  = MAX(CASE WHEN coluna='ID_USUARIO_LIDER' AND qtd=1
                               AND ref='ci.kzn_mdm_hierarquia' AND refcol='ID_USUARIO' THEN 1 ELSE 0 END)
  FROM fks;

PRINT CONCAT('   ID_KAIZEN        : ', CASE WHEN @fkKaizenOk=1 THEN 'ja correta' ELSE 'FORA DO LUGAR' END);
PRINT CONCAT('   ID_USUARIO_LIDER : ', CASE WHEN @fkLiderOk =1 THEN 'ja correta' ELSE 'FORA DO LUGAR' END);

IF @APLICAR = 0
BEGIN
    PRINT '';
    PRINT '   @APLICAR = 0: nada foi alterado nem gravado.';
    RETURN;
END

DECLARE @mdmUnico bit = 0;
SELECT @mdmUnico = 1
  FROM sys.indexes i
  JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
  JOIN sys.columns col ON col.object_id=ic.object_id AND col.column_id=ic.column_id
 WHERE i.object_id = OBJECT_ID('ci.kzn_mdm_hierarquia')
   AND (i.is_primary_key=1 OR i.is_unique=1) AND col.name='ID_USUARIO'
   AND (SELECT COUNT(*) FROM sys.index_columns x
         WHERE x.object_id=i.object_id AND x.index_id=i.index_id AND x.key_ordinal>0) = 1;

DECLARE @cmd nvarchar(max);

IF @fkKaizenOk = 0
BEGIN
    IF @fkKaizen IS NOT NULL
    BEGIN
        SET @cmd = 'ALTER TABLE ci.kzn_kaizen_hierarquia DROP CONSTRAINT ' + QUOTENAME(@fkKaizen) + ';';
        PRINT '   ' + @cmd; EXEC sys.sp_executesql @cmd;
    END
    SET @cmd = 'ALTER TABLE ci.kzn_kaizen_hierarquia WITH CHECK ADD CONSTRAINT FK_KZN_KAIZEN_HIERARQUIA_KAIZEN
                FOREIGN KEY (ID_KAIZEN) REFERENCES ci.kzn_pedravisaoconsolidada (ID_KAIZEN);';
    PRINT '   recriando a FK de ID_KAIZEN'; EXEC sys.sp_executesql @cmd;
END

IF @fkLiderOk = 0
BEGIN
    IF @fkLider IS NOT NULL
    BEGIN
        SET @cmd = 'ALTER TABLE ci.kzn_kaizen_hierarquia DROP CONSTRAINT ' + QUOTENAME(@fkLider) + ';';
        PRINT '   ' + @cmd; EXEC sys.sp_executesql @cmd;
    END
    IF @mdmUnico = 1
    BEGIN
        SET @cmd = 'ALTER TABLE ci.kzn_kaizen_hierarquia WITH CHECK ADD CONSTRAINT FK_KZN_KAIZEN_HIERARQUIA_USUARIO
                    FOREIGN KEY (ID_USUARIO_LIDER) REFERENCES ci.kzn_mdm_hierarquia (ID_USUARIO);';
        PRINT '   recriando a FK de ID_USUARIO_LIDER contra o MDM'; EXEC sys.sp_executesql @cmd;
    END
    ELSE
    BEGIN
        PRINT '   ID_USUARIO NAO e unico no MDM (a PK de la e composta:';
        PRINT '   ID_USUARIO + CD_MATRICULA + ID_TIPO_USUARIO), entao nao existe FK';
        PRINT '   valida para ID_USUARIO_LIDER. Ela foi apenas REMOVIDA — e o certo:';
        PRINT '   quem garante esse numero e a propria PVC, que ja tem a FK dela.';
    END
END

PRINT '';
PRINT '===================================================================';
PRINT ' 4. GRAVA A HIERARQUIA DOS KAIZENS QUE JA EXISTEM';
PRINT '===================================================================';

BEGIN TRY
    MERGE INTO ci.kzn_kaizen_hierarquia AS alvo
    USING (SELECT p.ID_KAIZEN, p.ID_USUARIO_LIDER,
                  m.NM_HIERARQUIA_N1, m.NM_HIERARQUIA_N2, m.NM_HIERARQUIA_N3, m.NM_HIERARQUIA_N4,
                  m.NM_HIERARQUIA_N5, m.NM_HIERARQUIA_N6, m.NM_HIERARQUIA_N7, m.NM_HIERARQUIA_N8
             FROM ci.kzn_pedravisaoconsolidada p
         OUTER APPLY (
           SELECT TOP (1) x.NM_HIERARQUIA_N1, x.NM_HIERARQUIA_N2, x.NM_HIERARQUIA_N3, x.NM_HIERARQUIA_N4, x.NM_HIERARQUIA_N5, x.NM_HIERARQUIA_N6, x.NM_HIERARQUIA_N7, x.NM_HIERARQUIA_N8
             FROM ci.kzn_mdm_hierarquia x
            WHERE x.ID_USUARIO = p.ID_USUARIO_LIDER
            ORDER BY x.ID_TIPO_USUARIO
         ) m) AS origem
       ON alvo.ID_KAIZEN = origem.ID_KAIZEN
    WHEN MATCHED THEN UPDATE SET
           alvo.ID_USUARIO_LIDER = origem.ID_USUARIO_LIDER,
           alvo.NM_HIERARQUIA_N1 = origem.NM_HIERARQUIA_N1, alvo.NM_HIERARQUIA_N2 = origem.NM_HIERARQUIA_N2,
           alvo.NM_HIERARQUIA_N3 = origem.NM_HIERARQUIA_N3, alvo.NM_HIERARQUIA_N4 = origem.NM_HIERARQUIA_N4,
           alvo.NM_HIERARQUIA_N5 = origem.NM_HIERARQUIA_N5, alvo.NM_HIERARQUIA_N6 = origem.NM_HIERARQUIA_N6,
           alvo.NM_HIERARQUIA_N7 = origem.NM_HIERARQUIA_N7, alvo.NM_HIERARQUIA_N8 = origem.NM_HIERARQUIA_N8,
           alvo.DT_ATUALIZACAO = CAST((SYSDATETIMEOFFSET() AT TIME ZONE 'E. South America Standard Time') AS DATETIME2)
    WHEN NOT MATCHED THEN
      INSERT (ID_KAIZEN, ID_USUARIO_LIDER,
              NM_HIERARQUIA_N1, NM_HIERARQUIA_N2, NM_HIERARQUIA_N3, NM_HIERARQUIA_N4,
              NM_HIERARQUIA_N5, NM_HIERARQUIA_N6, NM_HIERARQUIA_N7, NM_HIERARQUIA_N8, DT_ATUALIZACAO)
      VALUES (origem.ID_KAIZEN, origem.ID_USUARIO_LIDER,
              origem.NM_HIERARQUIA_N1, origem.NM_HIERARQUIA_N2, origem.NM_HIERARQUIA_N3, origem.NM_HIERARQUIA_N4,
              origem.NM_HIERARQUIA_N5, origem.NM_HIERARQUIA_N6, origem.NM_HIERARQUIA_N7, origem.NM_HIERARQUIA_N8,
              CAST((SYSDATETIMEOFFSET() AT TIME ZONE 'E. South America Standard Time') AS DATETIME2));

    PRINT CONCAT('   Linhas gravadas/atualizadas: ', @@ROWCOUNT);
END TRY
BEGIN CATCH
    PRINT '   *** A GRAVACAO FALHOU ***';
    PRINT CONCAT('   Erro  : ', ERROR_NUMBER());
    PRINT CONCAT('   Texto : ', ERROR_MESSAGE());
    IF ERROR_NUMBER() = 547
      PRINT '   -> Ainda ha uma FK barrando. O nome dela esta no texto acima.';
    IF ERROR_NUMBER() = 229
      PRINT '   -> Falta permissao: GRANT INSERT, UPDATE ON ci.kzn_kaizen_hierarquia TO <usuario_da_aplicacao>;';
END CATCH

PRINT '';
PRINT '===================================================================';
PRINT ' 5. RESULTADO';
PRINT '===================================================================';
PRINT CONCAT('   Kaizens na PVC          : ', (SELECT COUNT(*) FROM ci.kzn_pedravisaoconsolidada));
PRINT CONCAT('   Linhas na hierarquia    : ', (SELECT COUNT(*) FROM ci.kzn_kaizen_hierarquia));
PRINT CONCAT('   Sem niveis (MDM vazio)  : ', (SELECT COUNT(*) FROM ci.kzn_kaizen_hierarquia WHERE NM_HIERARQUIA_N1 IS NULL));

SELECT * FROM ci.kzn_kaizen_hierarquia;
