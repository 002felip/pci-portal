/* =====================================================================================================================
   AIP Goals — níveis do desdobramento abaixo da BU (D-43): as metas aceitam os níveis N5 a N9 (unidades de nível 5 a 9 da
   PM.UNIDADE_ORGANIZACIONAL). CEO e COO continuam com peso único; BU e N5+ com peso por unidade (AIP_META_PESO); a meta
   nº 0 de um nível N5+ guarda em VL_PESO os pontos herdados do nível acima. Só troca duas regras: nenhum dado é apagado.
   Rode uma vez nos bancos que já têm o 001 (DEV, depois PRD). Pode repetir.
   ===================================================================================================================== */
SET NOCOUNT ON;
IF OBJECT_ID('PM.CK_AIP_META_NIVEL', 'C') IS NOT NULL ALTER TABLE PM.AIP_META DROP CONSTRAINT CK_AIP_META_NIVEL;
IF OBJECT_ID('PM.CK_AIP_META_PESO_UNICO', 'C') IS NOT NULL ALTER TABLE PM.AIP_META DROP CONSTRAINT CK_AIP_META_PESO_UNICO;
GO
ALTER TABLE PM.AIP_META ADD CONSTRAINT CK_AIP_META_NIVEL CHECK (CD_NIVEL IN ('CEO', 'COO', 'BU', 'N5', 'N6', 'N7', 'N8', 'N9'));
ALTER TABLE PM.AIP_META ADD CONSTRAINT CK_AIP_META_PESO_UNICO CHECK ((CD_NIVEL IN ('CEO', 'COO') AND VL_PESO IS NOT NULL) OR (CD_NIVEL = 'BU' AND VL_PESO IS NULL) OR (CD_NIVEL LIKE 'N[5-9]' AND (NO_META = 0 OR VL_PESO IS NULL)));
GO
SELECT name, definition FROM sys.check_constraints WHERE name IN ('CK_AIP_META_NIVEL', 'CK_AIP_META_PESO_UNICO');
