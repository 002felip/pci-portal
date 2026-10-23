/* =====================================================================
   Correção de KZN_APROVADOR.CD_MATRICULA
   ---------------------------------------------------------------------
   O valor gravado nessa coluna deve ser o CD_MATRICULA da pessoa em
   KZN_MDM_HIERARQUIA. A aplicação resolvia isso com

       SELECT TOP (1) CD_MATRICULA FROM kzn_mdm_hierarquia
        WHERE ID_USUARIO = @id            -- SEM ORDER BY

   e a PK do MDM é (ID_USUARIO, CD_MATRICULA, ID_TIPO_USUARIO): a MESMA
   pessoa pode ter mais de uma linha, com matrículas diferentes. Sem
   ORDER BY o banco devolve qualquer uma — daí a matrícula errada.

   ATENÇÃO — leia antes de rodar:

   Este script identifica o aprovador pelo ID_USUARIO da linha. Isso só
   vale para as linhas gravadas ATÉ a versão em que ID_USUARIO passou a
   ser QUEM CONCEDEU o direito. Nas linhas gravadas depois, o ID_USUARIO
   é o concedente e NÃO serve para achar o aprovador — corrigi-las por
   aqui trocaria o aprovador pela pessoa errada.

   Rode a ETAPA 1 primeiro e confira. Só rode a ETAPA 2 depois de ver
   que as linhas listadas são mesmo as antigas.

   Schema: 'ci' (AZURE_SQL_SCHEMA em app.yaml).
   ===================================================================== */

SET NOCOUNT ON;

/* =====================================================================
   ETAPA 1 — DIAGNÓSTICO (só leitura, não altera nada)
   ---------------------------------------------------------------------
   Mostra, por aprovador: o que está gravado, quantas linhas a pessoa tem
   no MDM e qual matrícula o MDM traz. SITUACAO diz o que fazer.
   ===================================================================== */
WITH mdm AS (
    SELECT  m.ID_USUARIO,
            QTD_LINHAS   = COUNT(*)      OVER (PARTITION BY m.ID_USUARIO),
            m.CD_MATRICULA,
            ORDEM        = ROW_NUMBER()  OVER (PARTITION BY m.ID_USUARIO
                                               ORDER BY m.ID_TIPO_USUARIO, m.CD_MATRICULA),
            m.NM_USUARIO
    FROM [ci].[kzn_mdm_hierarquia] m
)
SELECT  a.ID_APROVADOR,
        a.ID_USUARIO,
        MATRICULA_GRAVADA = a.CD_MATRICULA,
        MATRICULA_NO_MDM  = x.CD_MATRICULA,
        x.NM_USUARIO,
        LINHAS_NO_MDM     = ISNULL(x.QTD_LINHAS, 0),
        SITUACAO =
            CASE
                WHEN x.ID_USUARIO IS NULL                       THEN 'SEM PESSOA NO MDM - revisar a mao'
                WHEN x.QTD_LINHAS > 1                           THEN 'AMBIGUO - pessoa tem mais de 1 matricula, revisar a mao'
                WHEN CAST(a.CD_MATRICULA AS VARCHAR(30))
                     = CAST(x.CD_MATRICULA AS VARCHAR(30))      THEN 'OK - ja esta certo'
                ELSE                                                 'CORRIGIR - a etapa 2 ajusta'
            END
FROM        [ci].[kzn_aprovador] a
LEFT JOIN   mdm x ON x.ID_USUARIO = a.ID_USUARIO AND x.ORDEM = 1
ORDER BY    SITUACAO, a.ID_APROVADOR;

/* =====================================================================
   ETAPA 2 — CORREÇÃO
   ---------------------------------------------------------------------
   Ajusta SÓ o que é seguro: pessoa existe no MDM, tem UMA única
   matrícula lá (sem ambiguidade) e o valor gravado diverge dela.
   Linhas ambíguas ou sem pessoa no MDM ficam como estão, de propósito —
   aparecem na etapa 1 para tratamento manual.

   Descomente o BEGIN TRAN / ROLLBACK para ensaiar antes de valer.
   ===================================================================== */
-- BEGIN TRANSACTION;

WITH unica AS (
    SELECT  m.ID_USUARIO, m.CD_MATRICULA
    FROM    [ci].[kzn_mdm_hierarquia] m
    GROUP BY m.ID_USUARIO, m.CD_MATRICULA
    HAVING  COUNT(*) >= 1
),
so_uma AS (
    SELECT  ID_USUARIO
    FROM    unica
    GROUP BY ID_USUARIO
    HAVING  COUNT(*) = 1
)
UPDATE  a
SET     a.CD_MATRICULA  = u.CD_MATRICULA,
        a.DT_ATUALIZACAO = CAST((SYSDATETIMEOFFSET()
                                 AT TIME ZONE 'E. South America Standard Time') AS DATETIME2)
FROM        [ci].[kzn_aprovador] a
INNER JOIN  unica  u ON u.ID_USUARIO = a.ID_USUARIO
INNER JOIN  so_uma s ON s.ID_USUARIO = a.ID_USUARIO
WHERE       CAST(a.CD_MATRICULA AS VARCHAR(30)) <> CAST(u.CD_MATRICULA AS VARCHAR(30));

-- ROLLBACK;   -- troque por COMMIT quando o resultado estiver certo

/* =====================================================================
   ETAPA 3 — CONFERÊNCIA (rode a etapa 1 de novo)
   ---------------------------------------------------------------------
   Não pode sobrar nenhuma linha com SITUACAO = 'CORRIGIR'. As marcadas
   como AMBIGUO precisam de decisão humana: escolha a matrícula certa e
   ajuste uma a uma, por exemplo

       UPDATE [ci].[kzn_aprovador]
          SET CD_MATRICULA = '<a matricula correta>'
        WHERE ID_APROVADOR = <id>;
   ===================================================================== */

/* ---------------------------------------------------------------------
   SE A ETAPA 2 FALHAR com erro de conversão
   ---------------------------------------------------------------------
   Significa que kzn_aprovador.CD_MATRICULA é numérica e alguma matrícula
   do MDM tem letra (ex.: 'FG002634') — ou seja, essa pessoa não cabe na
   coluna. Nesse caso a coluna precisa virar VARCHAR para comportar todos
   os aprovadores; me avise que preparo essa alteração à parte.
   --------------------------------------------------------------------- */
