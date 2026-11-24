/* =====================================================================================================================
   AIP Goals — metas de TESTE (só para conferir a ligação no DEV). Rode depois do 001 e do 002, sem editar nada.

   Inclui no ciclo aberto:
   - 3 BUs: Salobo, Sossego e Onça Puma, se existirem na IBP.SITES; senão, os 3 primeiros sites da tabela;
   - metas do CEO (60 + 40 = 100), do COO (15 + 10 = 25, mais 75 herdados) e da BU (20 + 25 + 15 = 60, mais 40 herdados);
   - os Goal Cards de cada BU, em Rascunho: o resultado do COO (nº 0) e as metas 1 a 3.
   Tudo fecha 100 pts por nível (RN-16): dá para abrir e salvar a Administração sem pendência.
   Para apagar os dados de teste, use o bloco comentado no fim.
   ===================================================================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CICLO INT, @ADMIN VARCHAR(20) = '81059384';
SELECT @CICLO = ID_CICLO FROM PM.AIP_CICLO WHERE SG_STATUS = 'S';
IF @CICLO IS NULL THROW 50000, N'Nenhum ciclo aberto: rode antes o 002_pm_carga_inicial.sql.', 1;
IF EXISTS (SELECT 1 FROM PM.AIP_META WHERE ID_CICLO = @CICLO AND NO_META > 0) THROW 50000, N'O ciclo já tem metas cadastradas: o teste não foi aplicado.', 1;
IF EXISTS (SELECT 1 FROM PM.AIP_CICLO WHERE ID_CICLO = @CICLO AND (QTDE_PONTOS_HERDADOS_COO <> 75 OR QTDE_PONTOS_HERDADOS_BU <> 40))
  THROW 50000, N'Os pontos herdados do ciclo não são 75 (COO) e 40 (BU): ajuste os pesos deste script.', 1;

BEGIN TRANSACTION;

-- BUs do teste
DECLARE @SITES TABLE (ID_SITE INT PRIMARY KEY, NM_SITE NVARCHAR(100));
INSERT @SITES SELECT ID_SITE, NM_SITE FROM IBP.SITES WHERE NM_SITE IN (N'Salobo', N'Sossego', N'Onça Puma');
IF NOT EXISTS (SELECT 1 FROM @SITES)
  INSERT @SITES SELECT TOP (3) ID_SITE, NM_SITE FROM IBP.SITES WHERE NM_SITE IS NOT NULL ORDER BY ID_SITE;

INSERT PM.AIP_CICLO_SITE (ID_CICLO, ID_SITE, CD_MATRICULA_DIRETOR, DS_EXCECAO)
SELECT @CICLO, s.ID_SITE, @ADMIN, N'Teste: efeitos de força maior não contam no resultado.'
FROM @SITES s WHERE NOT EXISTS (SELECT 1 FROM PM.AIP_CICLO_SITE cs WHERE cs.ID_CICLO = @CICLO AND cs.ID_SITE = s.ID_SITE);

-- Metas do CEO e do COO (peso único)
INSERT PM.AIP_META (ID_CICLO, CD_NIVEL, NO_META, NM_TITULO, TP_META, TP_ORIENTACAO, VL_PESO) VALUES
  (@CICLO, 'CEO', 1, N'Financial Results (EBITDA)',        'FORMULA', 'MAIOR', 60),
  (@CICLO, 'CEO', 2, N'Safety & Sustainability',           'FORMULA', 'MAIOR', 40),
  (@CICLO, 'COO', 2, N'Strengthen a Culture of Chronic Unease', 'FORMULA', 'MAIOR', 15),
  (@CICLO, 'COO', 3, N'Asset Management program',          'MARCOS',  'MAIOR', 10);

-- Metas da BU (peso por site); a 1 e a 3 vêm das metas do COO
DECLARE @COO2 INT = (SELECT ID_META FROM PM.AIP_META WHERE ID_CICLO = @CICLO AND CD_NIVEL = 'COO' AND NO_META = 2);
DECLARE @COO3 INT = (SELECT ID_META FROM PM.AIP_META WHERE ID_CICLO = @CICLO AND CD_NIVEL = 'COO' AND NO_META = 3);
INSERT PM.AIP_META (ID_CICLO, CD_NIVEL, NO_META, NM_TITULO, TP_META, TP_ORIENTACAO, ID_META_ORIGEM) VALUES
  (@CICLO, 'BU', 1, N'BU Chronic Unease',               'FORMULA', 'MAIOR', @COO2),
  (@CICLO, 'BU', 2, N'BU Unit Cost and Investments',    'FORMULA', 'MENOR', NULL),
  (@CICLO, 'BU', 3, N'BU Asset Management',             'MARCOS',  'MAIOR', @COO3);

INSERT PM.AIP_META_PESO (ID_META, ID_SITE, VL_PESO)
SELECT m.ID_META, s.ID_SITE, CASE m.NO_META WHEN 1 THEN 20 WHEN 2 THEN 25 ELSE 15 END
FROM PM.AIP_META m CROSS JOIN @SITES s
WHERE m.ID_CICLO = @CICLO AND m.CD_NIVEL = 'BU' AND m.NO_META BETWEEN 1 AND 3;

-- Goal Cards em Rascunho: GC-<3 letras do site, sem acento>-<nº da meta>
INSERT PM.AIP_GOAL_CARD (CD_GOAL_CARD, ID_META, ID_SITE, CD_MATRICULA)
SELECT 'GC-' + UPPER(LEFT(CAST(REPLACE(s.NM_SITE, N' ', N'') AS VARCHAR(100)) COLLATE SQL_Latin1_General_Cp1251_CS_AS, 3))
       + '-' + RIGHT('0' + CAST(m.NO_META AS VARCHAR(2)), 2),
       m.ID_META, s.ID_SITE, @ADMIN
FROM PM.AIP_META m CROSS JOIN @SITES s
WHERE m.ID_CICLO = @CICLO AND m.CD_NIVEL = 'BU' AND m.NO_META BETWEEN 0 AND 3
  AND NOT EXISTS (SELECT 1 FROM PM.AIP_GOAL_CARD gc WHERE gc.ID_META = m.ID_META AND gc.ID_SITE = s.ID_SITE);

INSERT PM.AIP_EVENTO_LOG (ID_CICLO, TP_EVENTO, CD_MATRICULA, TP_GRUPO, CD_SECAO, DS_COMENTARIO)
VALUES (@CICLO, 'CONFIGURACAO', @ADMIN, 'ADMIN', 'metas', N'metas de teste (003_pm_teste_metas.sql)');

COMMIT;

-- Conferência: Goal Cards criados e soma de pontos por BU (deve ser 100)
SELECT s.NM_SITE, gc.CD_GOAL_CARD, m.NO_META, m.NM_TITULO,
       CASE WHEN m.NO_META = 0 THEN c.QTDE_PONTOS_HERDADOS_BU ELSE mp.VL_PESO END AS PESO
FROM PM.AIP_GOAL_CARD gc
JOIN PM.AIP_META m ON m.ID_META = gc.ID_META
JOIN PM.AIP_CICLO c ON c.ID_CICLO = m.ID_CICLO
JOIN IBP.SITES s ON s.ID_SITE = gc.ID_SITE
LEFT JOIN PM.AIP_META_PESO mp ON mp.ID_META = m.ID_META AND mp.ID_SITE = gc.ID_SITE
WHERE c.ID_CICLO = @CICLO ORDER BY s.NM_SITE, m.NO_META;

/* ═══ APAGAR OS DADOS DE TESTE (enquanto nenhum Goal Card tiver sido submetido) ═══
DECLARE @C INT = (SELECT ID_CICLO FROM PM.AIP_CICLO WHERE SG_STATUS = 'S');
BEGIN TRANSACTION;
DELETE gc FROM PM.AIP_GOAL_CARD gc JOIN PM.AIP_META m ON m.ID_META = gc.ID_META
  WHERE m.ID_CICLO = @C AND NOT EXISTS (SELECT 1 FROM PM.AIP_EVENTO_LOG e WHERE e.ID_GOAL_CARD = gc.ID_GOAL_CARD);
DELETE mp FROM PM.AIP_META_PESO mp JOIN PM.AIP_META m ON m.ID_META = mp.ID_META WHERE m.ID_CICLO = @C;
UPDATE PM.AIP_META SET ID_META_ORIGEM = NULL WHERE ID_CICLO = @C;
DELETE FROM PM.AIP_META WHERE ID_CICLO = @C AND NO_META > 0;
DELETE FROM PM.AIP_CICLO_SITE WHERE ID_CICLO = @C;
COMMIT;
*/
