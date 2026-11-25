/* =====================================================================================================================
   AIP Goals — janelas do ciclo podem ficar em branco (D-35): o novo ciclo nasce sem datas e o administrador as escolhe
   na aba Ciclo. Rode uma vez nos bancos que já têm o 001 (DEV e, depois, PRD). Pode repetir sem problema.

   O SQL Server não altera uma coluna usada numa regra CHECK. Por isso o script tira a CK_AIP_CICLO_JORNADA, deixa as
   8 datas aceitarem em branco e recria a mesma regra. Com as datas preenchidas, a regra continua valendo; com elas em
   branco, a regra não recusa.
   ===================================================================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('PM.AIP_CICLO') AND is_nullable = 0
           AND name IN ('DT_INI_DESDOBRAMENTO','DT_FIM_DESDOBRAMENTO','DT_INI_PROPOSTA','DT_FIM_PROPOSTA',
                        'DT_INI_CALIBRACAO','DT_FIM_CALIBRACAO','DT_INI_OFICIAL','DT_FIM_OFICIAL'))
BEGIN
  IF OBJECT_ID('PM.CK_AIP_CICLO_JORNADA', 'C') IS NOT NULL
    ALTER TABLE PM.AIP_CICLO DROP CONSTRAINT CK_AIP_CICLO_JORNADA;

  DECLARE @c SYSNAME, @sql NVARCHAR(400);
  DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT name FROM sys.columns
    WHERE object_id = OBJECT_ID('PM.AIP_CICLO') AND is_nullable = 0
      AND name IN ('DT_INI_DESDOBRAMENTO','DT_FIM_DESDOBRAMENTO','DT_INI_PROPOSTA','DT_FIM_PROPOSTA',
                   'DT_INI_CALIBRACAO','DT_FIM_CALIBRACAO','DT_INI_OFICIAL','DT_FIM_OFICIAL');
  OPEN c; FETCH NEXT FROM c INTO @c;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @sql = N'ALTER TABLE PM.AIP_CICLO ALTER COLUMN ' + QUOTENAME(@c) + N' DATE NULL;';
    EXEC sp_executesql @sql;
    FETCH NEXT FROM c INTO @c;
  END
  CLOSE c; DEALLOCATE c;
END

IF OBJECT_ID('PM.CK_AIP_CICLO_JORNADA', 'C') IS NULL
  EXEC(N'ALTER TABLE PM.AIP_CICLO WITH CHECK ADD CONSTRAINT CK_AIP_CICLO_JORNADA CHECK (
    DT_INI_DESDOBRAMENTO < DT_FIM_DESDOBRAMENTO AND DT_INI_PROPOSTA < DT_FIM_PROPOSTA
    AND DT_INI_CALIBRACAO < DT_FIM_CALIBRACAO AND DT_INI_OFICIAL < DT_FIM_OFICIAL
    AND DT_INI_DESDOBRAMENTO <= DT_INI_PROPOSTA AND DT_INI_PROPOSTA <= DT_INI_CALIBRACAO AND DT_INI_CALIBRACAO <= DT_INI_OFICIAL)');

COMMIT;

-- Conferência: as 8 datas devem aparecer com ACEITA_EM_BRANCO = 1, e a regra deve existir
SELECT name AS COLUNA, is_nullable AS ACEITA_EM_BRANCO FROM sys.columns
WHERE object_id = OBJECT_ID('PM.AIP_CICLO') AND (name LIKE 'DT[_]INI[_]%' OR name LIKE 'DT[_]FIM[_]%')
ORDER BY column_id;
SELECT name AS REGRA FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('PM.AIP_CICLO') AND name = 'CK_AIP_CICLO_JORNADA';
