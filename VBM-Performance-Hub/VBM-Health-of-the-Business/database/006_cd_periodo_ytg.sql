/* ════════════════════════════════════════════════════════════════════
   VBM Health of the Business — CD_PERIODO aceita YTG (rodar UMA vez, com permissão de ALTER na tabela)
   Banco: BDIBPBMSA_PRD · tabela IBP.PHUB_PERFORMANCESTUDIO

   A regra (CHECK) de CD_PERIODO vem do Performance Studio e aceita MONTH, QUARTER, SEMESTER, YTD e YEAR.
   Este script troca a regra pela mesma lista + YTG. Os valores já aceitos continuam aceitos (não muda
   nenhuma linha). Se a regra já aceita YTG, não faz nada. No fim mostra a regra como ficou.
   ════════════════════════════════════════════════════════════════════ */
SET XACT_ABORT ON;

DECLARE @CK SYSNAME = (
  SELECT TOP 1 CC.name
  FROM sys.check_constraints CC
  WHERE CC.parent_object_id = OBJECT_ID('IBP.PHUB_PERFORMANCESTUDIO')
    AND CC.definition LIKE '%CD_PERIODO%' AND CC.definition NOT LIKE '%YTG%');

IF @CK IS NULL
  PRINT 'Nada a fazer: a tabela já aceita YTG em CD_PERIODO (ou não tem regra de CD_PERIODO).';
ELSE
BEGIN
  BEGIN TRANSACTION;
  DECLARE @DROP NVARCHAR(400) = N'ALTER TABLE IBP.PHUB_PERFORMANCESTUDIO DROP CONSTRAINT ' + QUOTENAME(@CK);
  EXEC sp_executesql @DROP;
  ALTER TABLE IBP.PHUB_PERFORMANCESTUDIO ADD CONSTRAINT CK_PHUB_PERFORMANCESTUDIO_PERIODO
    CHECK (CD_PERIODO IN ('MONTH', 'QUARTER', 'SEMESTER', 'YTD', 'YEAR', 'YTG'));
  COMMIT TRANSACTION;
  PRINT 'Regra de CD_PERIODO ajustada: YTG aceito.';
END;

SELECT CC.name AS REGRA, CC.definition AS DEFINICAO
FROM sys.check_constraints CC
WHERE CC.parent_object_id = OBJECT_ID('IBP.PHUB_PERFORMANCESTUDIO') AND CC.definition LIKE '%CD_PERIODO%';
