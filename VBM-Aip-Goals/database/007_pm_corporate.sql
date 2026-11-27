/* =====================================================================================================================
   AIP Goals — Corporate (ID_SITE 40) e papéis por BU. Rode uma vez no BDIBPBMSA_DEV e, depois, no PRD.
   Pode repetir sem problema.

   1) Papéis por BU: o aprovador e o administrador podem ser de TODAS as BUs (ID_SITE vazio, como hoje) ou de UMA BU,
      como o time do Corporate. O contribuidor continua sempre de uma BU.
   2) Conferência do Corporate na IBP.SITES (o nome original "Global" é mantido; o app mostra "Corporate").
   3) Conferência das áreas corporativas no MDM: o N4 das pessoas do Corporate, de onde o app tira as áreas e os
      responsáveis, sem nomes fixos no código.
   ===================================================================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

-- 1) Regra da AIP_PAPEL: só o contribuidor exige BU
BEGIN TRANSACTION;
IF OBJECT_ID('PM.CK_AIP_PAPEL_BU', 'C') IS NOT NULL
  AND OBJECT_DEFINITION(OBJECT_ID('PM.CK_AIP_PAPEL_BU')) LIKE '%IS NULL%'
  ALTER TABLE PM.AIP_PAPEL DROP CONSTRAINT CK_AIP_PAPEL_BU;
IF OBJECT_ID('PM.CK_AIP_PAPEL_BU', 'C') IS NULL
  EXEC(N'ALTER TABLE PM.AIP_PAPEL WITH CHECK ADD CONSTRAINT CK_AIP_PAPEL_BU CHECK (TP_GRUPO <> ''CONTRIBUIDOR'' OR ID_SITE IS NOT NULL)');
COMMIT;
SELECT name AS REGRA, definition AS DEFINICAO FROM sys.check_constraints WHERE name = 'CK_AIP_PAPEL_BU';

-- 2) Corporate na IBP.SITES (o app mostra "Corporate" e o coloca no nível Global, ao lado das BUs)
SELECT ID_SITE, NM_SITE AS NOME_ORIGINAL, N'Corporate' AS NOME_NO_APP, NM_PAIS AS PAIS_ORIGINAL, N'Global' AS NIVEL_NO_APP
FROM IBP.SITES WHERE ID_SITE = 40;

-- 3) Áreas corporativas no MDM: pessoas do Corporate pelo NM_SITE (o mesmo nome da IBP.SITES, ex.: "Global").
--    Se sair vazio, o NM_SITE do Corporate no MDM é outro: veja a consulta 3b e informe o valor em
--    AIPGOALS_CORPORATE_MDM_SITE no app.yaml.
SELECT LTRIM(RTRIM(m.NM_HIERARQUIA_N4)) AS AREA_N4, COUNT(*) AS PESSOAS
FROM CI.KZN_MDM_HIERARQUIA m
JOIN IBP.SITES s ON s.ID_SITE = 40
WHERE m.SG_ATIVO = 'A' AND m.NM_HIERARQUIA_N4 IS NOT NULL
  AND LTRIM(RTRIM(m.NM_SITE)) COLLATE Latin1_General_CI_AI = LTRIM(RTRIM(s.NM_SITE)) COLLATE Latin1_General_CI_AI
GROUP BY LTRIM(RTRIM(m.NM_HIERARQUIA_N4)) ORDER BY COUNT(*) DESC;

-- 3b) Onde estão as áreas corporativas no MDM (ex.: CORPORATE AFFAIRS, PERFORMANCE & CI): o NM_SITE dessas pessoas
SELECT TOP (20) LTRIM(RTRIM(NM_SITE)) AS NM_SITE_NO_MDM, LTRIM(RTRIM(NM_HIERARQUIA_N4)) AS AREA_N4, COUNT(*) AS PESSOAS
FROM CI.KZN_MDM_HIERARQUIA
WHERE SG_ATIVO = 'A' AND (NM_HIERARQUIA_N4 LIKE '%CORPORATE%' OR NM_HIERARQUIA_N4 LIKE '%PERFORMANCE%')
GROUP BY LTRIM(RTRIM(NM_SITE)), LTRIM(RTRIM(NM_HIERARQUIA_N4)) ORDER BY COUNT(*) DESC;
