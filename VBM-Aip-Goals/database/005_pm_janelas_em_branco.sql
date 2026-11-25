/* =====================================================================================================================
   AIP Goals — janelas do ciclo podem ficar em branco (D-35): o novo ciclo nasce sem datas e o administrador as escolhe
   na aba Ciclo. Rode uma vez nos bancos que já têm o 001 (DEV e, depois, PRD). Pode repetir: só altera o que falta.
   A regra CK_AIP_CICLO_JORNADA continua valendo quando as datas estão preenchidas (com NULL o CHECK não recusa).
   ===================================================================================================================== */
SET NOCOUNT ON;
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

SELECT name AS COLUNA, is_nullable AS ACEITA_EM_BRANCO FROM sys.columns
WHERE object_id = OBJECT_ID('PM.AIP_CICLO') AND name LIKE 'DT[_]INI[_]%' OR (object_id = OBJECT_ID('PM.AIP_CICLO') AND name LIKE 'DT[_]FIM[_]%');
