/* =====================================================================
   ci.kzn_membros_equipe — junção Kaizen <-> pessoa
   ---------------------------------------------------------------------
   SÓ RODE DEPOIS de confirmar, com database/diagnostico_membros_equipe.sql,
   que a tabela realmente NÃO existe. Se o banco for case-sensitive ela
   pode estar lá, só com o nome em minúsculas — e aí não há nada a criar.

   É onde os DOIS campos da Etapa 1 do Novo Kaizen gravam:
   "Vale Team Members" e "External Members (Third-parties)". Os dois
   produzem a MESMA linha; o que separa interno de terceiro é o
   ID_TIPO_USUARIO da pessoa em kzn_mdm_hierarquia (1 = Vale,
   2 = terceiro), não uma coluna daqui.

   As 3 colunas e a PK composta são exatamente o que server.js grava:

       INSERT INTO [ci].[kzn_membros_equipe]
              (ID_KAIZEN, ID_USUARIO, DT_ATUALIZACAO)
       VALUES (@idKaizen, @idUsuario, GETDATE())

   Não acrescente coluna NOT NULL sem DEFAULT: o INSERT não a preenche
   e passaria a falhar.
   ===================================================================== */

SET NOCOUNT ON;

IF OBJECT_ID('ci.kzn_membros_equipe', 'U') IS NOT NULL
BEGIN
    PRINT 'ci.kzn_membros_equipe ja existe - nada a fazer.';
END
ELSE
BEGIN
    CREATE TABLE [ci].[kzn_membros_equipe]
    (
        [ID_KAIZEN]       INT       NOT NULL,
        [ID_USUARIO]      INT       NOT NULL,
        [DT_ATUALIZACAO]  DATETIME2 NULL,
        CONSTRAINT [PK_kzn_membros_equipe] PRIMARY KEY CLUSTERED
            ([ID_KAIZEN] ASC, [ID_USUARIO] ASC)
    );

    PRINT 'ci.kzn_membros_equipe criada.';
END
GO

/* ---------------------------------------------------------------------
   FK para o Kaizen — opcional, mas recomendada: impede membro órfão e
   apaga a equipe junto quando o Kaizen é apagado.
   Só entra se a PK de kzn_pedravisaoconsolidada for ID_KAIZEN sozinho.
   --------------------------------------------------------------------- */
IF OBJECT_ID('ci.kzn_membros_equipe', 'U') IS NOT NULL
   AND OBJECT_ID('ci.kzn_pedravisaoconsolidada', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys
                    WHERE name = 'FK_kzn_membros_equipe_kaizen')
BEGIN
    BEGIN TRY
        ALTER TABLE [ci].[kzn_membros_equipe]
          ADD CONSTRAINT [FK_kzn_membros_equipe_kaizen]
              FOREIGN KEY ([ID_KAIZEN])
              REFERENCES [ci].[kzn_pedravisaoconsolidada] ([ID_KAIZEN])
              ON DELETE CASCADE;
        PRINT 'FK para kzn_pedravisaoconsolidada criada.';
    END TRY
    BEGIN CATCH
        PRINT 'FK para o Kaizen nao criada: ' + ERROR_MESSAGE();
    END CATCH
END
GO

/* ---------------------------------------------------------------------
   FK para o MDM — DE PROPÓSITO NÃO ESTÁ AQUI.

   O DER (database/DER_VBM_Kaizen_CI.html) desenha kzn_mdm_hierarquia com
   PK só em ID_USUARIO, mas o banco real não é assim: a mesma pessoa tem
   mais de uma linha, com matrículas diferentes — foi exatamente isso que
   causou o bug da matrícula errada em kzn_aprovador. Sem chave única em
   ID_USUARIO, o SQL Server recusa uma FK apontando para essa coluna.

   Se quiser mesmo a integridade referencial aqui, o caminho é uma
   UNIQUE/índice único em kzn_mdm_hierarquia(ID_USUARIO), o que só é
   possível se a duplicidade for tratada antes. Me avise que preparo.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   Conferência
   --------------------------------------------------------------------- */
SELECT  COLUNA = c.name, TIPO = ty.name,
        ACEITA_NULO = CASE WHEN c.is_nullable = 1 THEN 'sim' ELSE 'NAO' END
FROM        sys.columns c
INNER JOIN  sys.types   ty ON ty.user_type_id = c.user_type_id
WHERE       c.object_id = OBJECT_ID('ci.kzn_membros_equipe')
ORDER BY    c.column_id;
