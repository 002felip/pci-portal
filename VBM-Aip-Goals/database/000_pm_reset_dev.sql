/* =====================================================================================================================
   AIP Goals — APAGA todas as tabelas do schema PM do AIP (só no banco de DESENVOLVIMENTO), para recriar com o 001 e o 002.
   Uso na troca para PM.UNIDADE_ORGANIZACIONAL (D-40): 000 → 001 → 002 e, logo em seguida, publicar a versão nova do app.
   Recusa rodar fora de um banco cujo nome termina em _DEV. A IBP.SITES e as demais tabelas do banco não são tocadas.
   ===================================================================================================================== */
SET NOCOUNT ON;
IF DB_NAME() NOT LIKE '%[_]DEV' THROW 50000, N'000_pm_reset_dev.sql só roda em banco _DEV.', 1;
GO
IF OBJECT_ID('PM.TG_AIP_EVENTO_IMUTAVEL', 'TR') IS NOT NULL DROP TRIGGER PM.TG_AIP_EVENTO_IMUTAVEL;
DROP TABLE IF EXISTS PM.AIP_NOTIFICACAO;
DROP TABLE IF EXISTS PM.AIP_EVENTO_LOG;
DROP TABLE IF EXISTS PM.AIP_GOAL_CARD_VERSAO;
DROP TABLE IF EXISTS PM.AIP_GOAL_CARD;
DROP TABLE IF EXISTS PM.AIP_META_PESO;
DROP TABLE IF EXISTS PM.AIP_PAPEL;
DROP TABLE IF EXISTS PM.AIP_CICLO_SITE;
DROP TABLE IF EXISTS PM.AIP_META;
DROP TABLE IF EXISTS PM.AIP_CICLO;
DROP TABLE IF EXISTS PM.UNIDADE_ORGANIZACIONAL;
GO
SELECT name AS TABELA_QUE_SOBROU FROM sys.tables WHERE schema_id = SCHEMA_ID('PM') AND (name LIKE 'AIP[_]%' OR name = 'UNIDADE_ORGANIZACIONAL');
