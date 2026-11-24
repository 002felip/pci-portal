/* =====================================================================================================================
   AIP Goals — administrador 01181222 no ciclo aberto (rode no BDIBPBMSA_DEV, depois do 001 e do 002).
   Pode rodar mais de uma vez: não duplica; se já existir, apenas reativa. O app reconhece o e-mail de login pela
   matrícula na IBP.USERS (a matrícula precisa existir lá).
   ===================================================================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @MATRICULA VARCHAR(20) = '01181222';
DECLARE @CICLO INT = (SELECT ID_CICLO FROM PM.AIP_CICLO WHERE SG_STATUS = 'S');

IF @CICLO IS NULL THROW 50000, N'Não há ciclo aberto: rode antes o 002_pm_carga_inicial.sql.', 1;

BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM PM.AIP_PAPEL WHERE ID_CICLO = @CICLO AND CD_MATRICULA = @MATRICULA AND TP_GRUPO = 'ADMIN')
  UPDATE PM.AIP_PAPEL SET SG_ATIVO = 'S', DT_ATUALIZACAO = SYSDATETIME()
   WHERE ID_CICLO = @CICLO AND CD_MATRICULA = @MATRICULA AND TP_GRUPO = 'ADMIN';
ELSE
  INSERT PM.AIP_PAPEL (ID_CICLO, CD_MATRICULA, TP_GRUPO) VALUES (@CICLO, @MATRICULA, 'ADMIN');

INSERT PM.AIP_EVENTO_LOG (ID_CICLO, TP_EVENTO, CD_MATRICULA, TP_GRUPO, CD_SECAO, DS_COMENTARIO, DS_DEPOIS)
VALUES (@CICLO, 'CONFIGURACAO', @MATRICULA, 'ADMIN', 'grupos', N'cadastrou o administrador 01181222', N'Administrador');

COMMIT;

SELECT p.ID_PAPEL, p.ID_CICLO, p.CD_MATRICULA, p.TP_GRUPO, p.SG_ATIVO, u.CD_MATRICULA AS EXISTE_NA_IBP_USERS
FROM PM.AIP_PAPEL p LEFT JOIN IBP.USERS u ON u.CD_MATRICULA = p.CD_MATRICULA
WHERE p.ID_CICLO = @CICLO AND p.CD_MATRICULA = @MATRICULA;
