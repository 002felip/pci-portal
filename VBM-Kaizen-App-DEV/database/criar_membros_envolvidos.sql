/* =====================================================================
   ci.kzn_membros_envolvidos  e  ci.kzn_hist_membros_envolvidos
   ---------------------------------------------------------------------
   PNR28 — "Membros envolvidos": pessoas (Vale ou terceiros) que ajudaram
   no Kaizen além da equipe principal. A equipe continua em
   kzn_membros_equipe (Líder + até 2 pessoas); os envolvidos ficam AQUI,
   até 5 por Kaizen, À PARTE da equipe — no máximo 8 pessoas no total
   (líder + 2 + 5). A regra é aplicada pelo server.js.

   Mesmo desenho de kzn_membros_equipe — é exatamente o que o app grava:

       INSERT INTO [ci].[kzn_membros_envolvidos]
              (ID_KAIZEN, ID_USUARIO, DT_ATUALIZACAO)
       VALUES (@idKaizen, @idUsuario, <agora em Brasília>)

   Enquanto este script não rodar, o app segue funcionando: a tela do
   Novo Kaizen esconde o bloco "Membros envolvidos" e a exportação traz
   a coluna vazia. Depois de rodar, o recurso liga sozinho em até 1
   minuto, sem reiniciar o app.

   Seguro para rodar mais de uma vez (só cria o que falta).
   ===================================================================== */

SET NOCOUNT ON;

/* ---------- Kaizens atuais ---------- */
IF OBJECT_ID('ci.kzn_membros_envolvidos', 'U') IS NOT NULL
    PRINT 'ci.kzn_membros_envolvidos ja existe - nada a fazer.';
ELSE
BEGIN
    CREATE TABLE [ci].[kzn_membros_envolvidos]
    (
        [ID_KAIZEN]       INT       NOT NULL,
        [ID_USUARIO]      INT       NOT NULL,
        [DT_ATUALIZACAO]  DATETIME2 NULL,
        CONSTRAINT [PK_kzn_membros_envolvidos] PRIMARY KEY CLUSTERED
            ([ID_KAIZEN] ASC, [ID_USUARIO] ASC)
    );
    PRINT 'ci.kzn_membros_envolvidos criada.';
END
GO

/* ---------- Kaizens históricos (editados pela tela de edição) ---------- */
IF OBJECT_ID('ci.kzn_hist_membros_envolvidos', 'U') IS NOT NULL
    PRINT 'ci.kzn_hist_membros_envolvidos ja existe - nada a fazer.';
ELSE
BEGIN
    CREATE TABLE [ci].[kzn_hist_membros_envolvidos]
    (
        [ID_KAIZEN]       INT       NOT NULL,
        [ID_USUARIO]      INT       NOT NULL,
        [DT_ATUALIZACAO]  DATETIME2 NULL,
        CONSTRAINT [PK_kzn_hist_membros_envolvidos] PRIMARY KEY CLUSTERED
            ([ID_KAIZEN] ASC, [ID_USUARIO] ASC)
    );
    PRINT 'ci.kzn_hist_membros_envolvidos criada.';
END
GO

/* ---------------------------------------------------------------------
   FKs para o Kaizen — opcionais, mas recomendadas (impedem linha órfã).
   Só entram se a PK da tabela do Kaizen for ID_KAIZEN sozinho; se não
   der, o script avisa e segue. Sem FK para o MDM pelo mesmo motivo
   explicado em criar_membros_equipe.sql (ID_USUARIO não é único lá).
   --------------------------------------------------------------------- */
IF OBJECT_ID('ci.kzn_pedravisaoconsolidada', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_kzn_membros_envolvidos_kaizen')
BEGIN
    BEGIN TRY
        ALTER TABLE [ci].[kzn_membros_envolvidos]
          ADD CONSTRAINT [FK_kzn_membros_envolvidos_kaizen]
              FOREIGN KEY ([ID_KAIZEN])
              REFERENCES [ci].[kzn_pedravisaoconsolidada] ([ID_KAIZEN])
              ON DELETE CASCADE;
        PRINT 'FK de kzn_membros_envolvidos criada.';
    END TRY
    BEGIN CATCH
        PRINT 'FK de kzn_membros_envolvidos nao criada: ' + ERROR_MESSAGE();
    END CATCH
END
GO

IF OBJECT_ID('ci.kzn_hist_pedravisaoconsolidada', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_kzn_hist_membros_envolvidos_kaizen')
BEGIN
    BEGIN TRY
        ALTER TABLE [ci].[kzn_hist_membros_envolvidos]
          ADD CONSTRAINT [FK_kzn_hist_membros_envolvidos_kaizen]
              FOREIGN KEY ([ID_KAIZEN])
              REFERENCES [ci].[kzn_hist_pedravisaoconsolidada] ([ID_KAIZEN])
              ON DELETE CASCADE;
        PRINT 'FK de kzn_hist_membros_envolvidos criada.';
    END TRY
    BEGIN CATCH
        PRINT 'FK de kzn_hist_membros_envolvidos nao criada: ' + ERROR_MESSAGE();
    END CATCH
END
GO

/* ---------- Conferência ---------- */
SELECT  TABELA = OBJECT_NAME(c.object_id), COLUNA = c.name, TIPO = ty.name,
        ACEITA_NULO = CASE WHEN c.is_nullable = 1 THEN 'sim' ELSE 'NAO' END
FROM        sys.columns c
INNER JOIN  sys.types   ty ON ty.user_type_id = c.user_type_id
WHERE       c.object_id IN (OBJECT_ID('ci.kzn_membros_envolvidos'),
                            OBJECT_ID('ci.kzn_hist_membros_envolvidos'))
ORDER BY    TABELA, c.column_id;
