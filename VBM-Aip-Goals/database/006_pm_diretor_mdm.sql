/* =====================================================================================================================
   AIP Goals — diretor das BUs pela hierarquia N4 do MDM (CI.KZN_MDM_HIERARQUIA). Rode no BDIBPBMSA_DEV.

   O app usa o N4 do MDM sempre que a BU não tem diretor escolhido na Administração. O 003_pm_teste_metas.sql gravou a
   matrícula 81059384 como diretor das BUs de teste; este script tira essa matrícula, para valer o N4.
   No fim, mostra para cada BU do ciclo aberto o diretor que o app vai usar e, se o N4 não aparecer, os nomes de site do
   MDM, para comparar com os da IBP.SITES.
   ===================================================================================================================== */
SET NOCOUNT ON;

DECLARE @CICLO INT = (SELECT ID_CICLO FROM PM.AIP_CICLO WHERE SG_STATUS = 'S');
IF @CICLO IS NULL THROW 50000, N'Não há ciclo aberto.', 1;

-- 1) Diretor de teste fora: a BU passa a seguir o N4 do MDM
UPDATE PM.AIP_CICLO_SITE SET CD_MATRICULA_DIRETOR = NULL
WHERE ID_CICLO = @CICLO AND CD_MATRICULA_DIRETOR = '81059384';
PRINT CONCAT(@@ROWCOUNT, ' BU(s) voltaram a usar o diretor do MDM (N4).');

-- 2) Diretor que o app vai mostrar em cada BU (mesma regra do app: o N4 mais comum entre as pessoas ativas do site)
SELECT s.NM_SITE AS BU,
       cs.CD_MATRICULA_DIRETOR AS DIRETOR_ESCOLHIDO,
       n4.NOME AS DIRETOR_N4_MDM, n4.QT AS PESSOAS_NO_SITE_COM_ESSE_N4,
       p.CD_MATRICULA AS MATRICULA_DO_N4, p.CD_EMAIL AS EMAIL_DO_N4
FROM PM.AIP_CICLO_SITE cs
JOIN IBP.SITES s ON s.ID_SITE = cs.ID_SITE
OUTER APPLY (SELECT TOP (1) LTRIM(RTRIM(m.NM_HIERARQUIA_N4)) AS NOME, COUNT(*) AS QT
             FROM CI.KZN_MDM_HIERARQUIA m
             WHERE m.SG_ATIVO = 'A' AND m.NM_HIERARQUIA_N4 IS NOT NULL
               AND LTRIM(RTRIM(m.NM_SITE)) COLLATE Latin1_General_CI_AI = LTRIM(RTRIM(s.NM_SITE)) COLLATE Latin1_General_CI_AI
               AND UPPER(LTRIM(RTRIM(m.NM_HIERARQUIA_N4))) NOT IN ('', 'NULL', 'N.A', 'N/A', 'NA', '-')
             GROUP BY LTRIM(RTRIM(m.NM_HIERARQUIA_N4)) ORDER BY COUNT(*) DESC) n4
OUTER APPLY (SELECT TOP (1) x.CD_MATRICULA, x.CD_EMAIL FROM CI.KZN_MDM_HIERARQUIA x
             WHERE LTRIM(RTRIM(x.NM_USUARIO)) COLLATE Latin1_General_CI_AI = n4.NOME COLLATE Latin1_General_CI_AI
             ORDER BY CASE WHEN x.SG_ATIVO = 'A' THEN 0 ELSE 1 END, x.ID_TIPO_USUARIO) p
WHERE cs.ID_CICLO = @CICLO
ORDER BY s.NM_SITE;

-- 3) Se DIRETOR_N4_MDM saiu vazio: nomes de site do MDM (compare com a coluna BU acima)
SELECT LTRIM(RTRIM(NM_SITE)) AS SITE_NO_MDM, COUNT(*) AS PESSOAS_ATIVAS
FROM CI.KZN_MDM_HIERARQUIA WHERE SG_ATIVO = 'A' AND NM_SITE IS NOT NULL
GROUP BY LTRIM(RTRIM(NM_SITE)) ORDER BY LTRIM(RTRIM(NM_SITE));
