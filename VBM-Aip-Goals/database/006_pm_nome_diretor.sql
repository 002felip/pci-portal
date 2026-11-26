/* =====================================================================================================================
   AIP Goals — nome do diretor da BU quando a pessoa não é achada no MDM (D-38).
   O diretor é gravado pela matrícula (CD_MATRICULA_DIRETOR). Quando o nome que veio da hierarquia N4 (ou foi digitado)
   não tem matrícula no MDM, a aplicação guarda o nome em NM_DIRETOR, para ele não sumir ao salvar.
   Rode uma vez nos bancos que já têm o 001 (DEV, depois PRD). Pode repetir: só cria se faltar.
   ===================================================================================================================== */
SET NOCOUNT ON;
IF COL_LENGTH('PM.AIP_CICLO_SITE', 'NM_DIRETOR') IS NULL
  ALTER TABLE PM.AIP_CICLO_SITE ADD NM_DIRETOR NVARCHAR(150) NULL;
GO
SELECT COL_LENGTH('PM.AIP_CICLO_SITE', 'NM_DIRETOR') AS NM_DIRETOR_TAMANHO_BYTES;
