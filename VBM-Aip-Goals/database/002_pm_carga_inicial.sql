/* =====================================================================================================================
   AIP Goals — carga inicial (rode UMA vez, depois do 001_pm_criar_tabelas.sql).
   Cria a estrutura de topo (Presidente › CEO › COO), o primeiro ciclo aberto (janelas em branco, escolhidas na aba Ciclo)
   e os administradores. As BUs (nível 4) se cadastram na Administração › Unidades organizacionais, assim como grupos,
   metas, pesos e exceções. Os nomes do topo podem ser trocados depois na mesma tela.
   ===================================================================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @ANO          SMALLINT      = 2027;
DECLARE @NOME         NVARCHAR(100) = N'AIP 2027';
DECLARE @HERDADOS_COO SMALLINT      = 75;   -- pontos do COO vindos do resultado do CEO
DECLARE @HERDADOS_BU  SMALLINT      = 40;   -- pontos de cada BU vindos do resultado do COO
DECLARE @ADMIN1       VARCHAR(20)   = '81059384';
DECLARE @ADMIN2       VARCHAR(20)   = '01181222';

IF EXISTS (SELECT 1 FROM PM.AIP_CICLO) OR EXISTS (SELECT 1 FROM PM.UNIDADE_ORGANIZACIONAL)
  THROW 50000, N'Já existem dados: a carga inicial não é necessária (para recomeçar no DEV, rode o 000 e o 001).', 1;

BEGIN TRANSACTION;

-- Estrutura de topo (D-40): nível 1 Presidente, 2 CEO, 3 COO; as BUs (nível 4) ficam abaixo do COO
INSERT PM.UNIDADE_ORGANIZACIONAL (NM_UNIDADE_ORGANIZACIONAL, NO_NIVEL_HIERARQUIA, ID_UNIDADE_PAI, NM_ESCOPO_ATUACAO, CD_MATRICULA)
VALUES (N'Presidente', 1, NULL, N'Corporativo', @ADMIN1);
DECLARE @PRES INT = SCOPE_IDENTITY();
INSERT PM.UNIDADE_ORGANIZACIONAL (NM_UNIDADE_ORGANIZACIONAL, NO_NIVEL_HIERARQUIA, ID_UNIDADE_PAI, NM_ESCOPO_ATUACAO, CD_MATRICULA)
VALUES (N'CEO VBM', 2, @PRES, N'Corporativo', @ADMIN1);
DECLARE @CEO INT = SCOPE_IDENTITY();
INSERT PM.UNIDADE_ORGANIZACIONAL (NM_UNIDADE_ORGANIZACIONAL, NO_NIVEL_HIERARQUIA, ID_UNIDADE_PAI, NM_ESCOPO_ATUACAO, CD_MATRICULA)
VALUES (N'COO VBM', 3, @CEO, N'Corporativo', @ADMIN1);

-- Ciclo aberto, com as janelas em branco
INSERT PM.AIP_CICLO (NO_ANO, NM_CICLO, SG_STATUS, CD_MATRICULA_CRIACAO, QTDE_PONTOS_HERDADOS_COO, QTDE_PONTOS_HERDADOS_BU)
VALUES (@ANO, @NOME, 'S', @ADMIN1, @HERDADOS_COO, @HERDADOS_BU);
DECLARE @CICLO INT = SCOPE_IDENTITY();

-- Meta nº 0 da BU: o resultado do scorecard do COO (pontos herdados). A aplicação cria os Goal Cards dela.
INSERT PM.AIP_META (ID_CICLO, CD_NIVEL, NO_META, NM_TITULO, TP_META, TP_ORIENTACAO)
VALUES (@CICLO, 'BU', 0, N'COO''s Scorecard Result', 'FORMULA', 'MAIOR');

-- Administradores
INSERT PM.AIP_PAPEL (ID_CICLO, CD_MATRICULA, TP_GRUPO) VALUES (@CICLO, @ADMIN1, 'ADMIN'), (@CICLO, @ADMIN2, 'ADMIN');

INSERT PM.AIP_EVENTO_LOG (ID_CICLO, TP_EVENTO, CD_MATRICULA, TP_GRUPO, CD_SECAO, DS_COMENTARIO, DS_DEPOIS)
VALUES (@CICLO, 'CICLO_ABERTO', @ADMIN1, 'ADMIN', 'ciclo', N'abriu o ciclo (carga inicial)', N'Aberto');

COMMIT;

SELECT ID_UNIDADE_ORGANIZACIONAL, NM_UNIDADE_ORGANIZACIONAL, NO_NIVEL_HIERARQUIA, ID_UNIDADE_PAI FROM PM.UNIDADE_ORGANIZACIONAL;
SELECT c.ID_CICLO, c.NM_CICLO, p.CD_MATRICULA AS ADMIN FROM PM.AIP_CICLO c JOIN PM.AIP_PAPEL p ON p.ID_CICLO = c.ID_CICLO;
