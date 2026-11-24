/* =====================================================================================================================
   AIP Goals — carga inicial (rode UMA vez, depois do 001_pm_criar_tabelas.sql).
   Cria o primeiro ciclo aberto e o primeiro administrador. Sem isso ninguém entra na Administração, porque o papel de
   administrador fica na PM.AIP_PAPEL, ligado a um ciclo. O resto (BUs, grupos, metas e pesos, exceções) se cadastra
   pela própria tela Administração.

   Pronto para rodar: administrador 81059384 (felipe.santos.souza@vale.com), ciclo AIP 2027. O app reconhece o
   e-mail de login pela matrícula no MDM (CI.KZN_MDM_HIERARQUIA, a mesma tabela do Kaizen). Datas e pontos herdados podem ser trocados depois em Administração.
   ===================================================================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @MATRICULA_ADMIN VARCHAR(20)   = '81059384';   -- felipe.santos.souza@vale.com
DECLARE @ANO             SMALLINT      = 2027;
DECLARE @NOME            NVARCHAR(100) = N'AIP 2027';
DECLARE @HERDADOS_COO    SMALLINT      = 75;           -- pontos do COO vindos do resultado do CEO
DECLARE @HERDADOS_BU     SMALLINT      = 40;           -- pontos de cada BU vindos do resultado do COO

IF EXISTS (SELECT 1 FROM PM.AIP_CICLO) THROW 50000, N'Já existe ciclo cadastrado: a carga inicial não é necessária.', 1;

BEGIN TRANSACTION;

INSERT PM.AIP_CICLO (NO_ANO, NM_CICLO, SG_STATUS, CD_MATRICULA_CRIACAO,
  DT_INI_DESDOBRAMENTO, DT_FIM_DESDOBRAMENTO, DT_INI_PROPOSTA, DT_FIM_PROPOSTA,
  DT_INI_CALIBRACAO, DT_FIM_CALIBRACAO, DT_INI_OFICIAL, DT_FIM_OFICIAL,
  QTDE_PONTOS_HERDADOS_COO, QTDE_PONTOS_HERDADOS_BU)
VALUES (@ANO, @NOME, 'S', @MATRICULA_ADMIN,
  '2026-11-02', '2026-11-27', '2026-11-27', '2026-12-18',
  '2026-12-18', '2027-01-15', '2027-01-15', '2027-01-29',
  @HERDADOS_COO, @HERDADOS_BU);
DECLARE @CICLO INT = SCOPE_IDENTITY();

-- Meta nº 0 da BU: o resultado do scorecard do COO (pontos herdados). A aplicação cria os Goal Cards dela.
INSERT PM.AIP_META (ID_CICLO, CD_NIVEL, NO_META, NM_TITULO, TP_META, TP_ORIENTACAO)
VALUES (@CICLO, 'BU', 0, N'COO''s Scorecard Result', 'FORMULA', 'MAIOR');

-- Primeiro administrador
INSERT PM.AIP_PAPEL (ID_CICLO, CD_MATRICULA, TP_GRUPO) VALUES (@CICLO, @MATRICULA_ADMIN, 'ADMIN');

INSERT PM.AIP_EVENTO_LOG (ID_CICLO, TP_EVENTO, CD_MATRICULA, TP_GRUPO, CD_SECAO, DS_COMENTARIO, DS_DEPOIS)
VALUES (@CICLO, 'CICLO_ABERTO', @MATRICULA_ADMIN, 'ADMIN', 'ciclo', N'abriu o ciclo (carga inicial)', N'Aberto');

/* Opcional: já incluir as BUs no ciclo pelos nomes da IBP.SITES (descomente e ajuste a lista).
INSERT PM.AIP_CICLO_SITE (ID_CICLO, ID_SITE)
SELECT @CICLO, s.ID_SITE FROM IBP.SITES s
WHERE s.NM_SITE IN (N'Onça Puma', N'Salobo', N'Sossego', N'Ontario', N'VNL', N'Clydach', N'Matsusaka');
*/

COMMIT;

SELECT c.ID_CICLO, c.NO_ANO, c.NM_CICLO, c.SG_STATUS, p.CD_MATRICULA AS ADMIN
FROM PM.AIP_CICLO c JOIN PM.AIP_PAPEL p ON p.ID_CICLO = c.ID_CICLO;
