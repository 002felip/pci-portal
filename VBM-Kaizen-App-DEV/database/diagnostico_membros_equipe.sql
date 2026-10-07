/* =====================================================================
   "Invalid object name 'CI.KZN_MEMBROS_EQUIPE'"
   ---------------------------------------------------------------------
   Esse erro tem DUAS causas possíveis, e o conserto de uma é o oposto
   do da outra:

   (A) A tabela não existe mesmo. Aí o aplicativo está quebrado em dois
       pontos, não só na sua consulta — veja a nota no fim.

   (B) A tabela existe, mas o banco tem collation CASE-SENSITIVE. O
       aplicativo escreve o nome em MINÚSCULAS ([ci].[kzn_membros_equipe])
       e você consultou em MAIÚSCULAS (CI.KZN_MEMBROS_EQUIPE). Num banco
       CS isso é outro nome, e só a SUA consulta falha — o aplicativo
       segue funcionando.

   Rode as 4 etapas abaixo. Elas são só leitura.
   ===================================================================== */

SET NOCOUNT ON;

/* =====================================================================
   ETAPA 1 — Em que banco você está, e ele diferencia maiúsculas?
   ---------------------------------------------------------------------
   Se COLLATION tiver "_CS_" (ex.: SQL_Latin1_General_CP1_CS_AS), o banco
   é case-sensitive: a causa é a (B).
   Se tiver "_CI_", maiúscula/minúscula não importa e a causa é a (A).
   ===================================================================== */
SELECT  BANCO_ATUAL = DB_NAME(),
        COLLATION   = CONVERT(VARCHAR(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')),
        DIFERENCIA_MAIUSCULAS =
            CASE WHEN CONVERT(VARCHAR(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation'))
                      LIKE '%[_]CS[_]%'
                 THEN 'SIM - causa (B): so o nome em maiusculas falha'
                 ELSE 'NAO - causa (A): a tabela nao existe neste banco'
            END;

/* =====================================================================
   ETAPA 2 — A tabela existe com QUAL nome exato?
   ---------------------------------------------------------------------
   Procura em TODOS os schemas qualquer tabela com "MEMBRO" no nome.
   Vazio aqui = a tabela realmente não existe neste banco.
   ===================================================================== */
SELECT  SCHEMA_NAME = s.name,
        TABELA      = t.name,
        NOME_COMPLETO = QUOTENAME(s.name) + '.' + QUOTENAME(t.name),
        CRIADA_EM  = t.create_date
FROM        sys.tables  t
INNER JOIN  sys.schemas s ON s.schema_id = t.schema_id
WHERE       t.name LIKE '%MEMBRO%'
ORDER BY    s.name, t.name;

/* =====================================================================
   ETAPA 3 — Quais das tabelas que o aplicativo usa existem?
   ---------------------------------------------------------------------
   Se kzn_membros_equipe sumiu, vale conferir as outras duas tabelas de
   junção junto — elas são gravadas no MESMO INSERT do Kaizen e nunca
   foram exercitadas se ninguém salvou um Kaizen completo ainda.
   ===================================================================== */
;WITH esperadas (TABELA) AS (
    SELECT 'kzn_pedravisaoconsolidada' UNION ALL
    SELECT 'kzn_membros_equipe'        UNION ALL   -- Vale Team + External Members
    SELECT 'kzn_kaizen_desperdicio'    UNION ALL
    SELECT 'kzn_resultado_kaizen'      UNION ALL
    SELECT 'kzn_mdm_hierarquia'        UNION ALL
    SELECT 'kzn_aprovador'             UNION ALL
    SELECT 'kzn_categoria'             UNION ALL
    SELECT 'kzn_replicacao'            UNION ALL
    SELECT 'kzn_desperdicio'           UNION ALL
    SELECT 'kzn_resultados'            UNION ALL
    SELECT 'kzn_moeda'
)
SELECT  e.TABELA,
        SITUACAO = CASE WHEN t.name IS NULL THEN 'NAO EXISTE em [ci]' ELSE 'ok' END,
        NOME_REAL = t.name
FROM        esperadas e
LEFT JOIN   sys.tables  t ON t.name = e.TABELA
                         AND t.schema_id = SCHEMA_ID('ci')
ORDER BY    SITUACAO DESC, e.TABELA;

/* =====================================================================
   ETAPA 4 — Se existir, como ela está por dentro?
   ---------------------------------------------------------------------
   O aplicativo grava exatamente 3 colunas:
       ID_KAIZEN (INT), ID_USUARIO (INT), DT_ATUALIZACAO
   Qualquer coluna a mais que seja NOT NULL e sem DEFAULT vai derrubar
   o INSERT — apareceria aqui.
   ===================================================================== */
SELECT  COLUNA      = c.name,
        TIPO        = ty.name,
        TAMANHO     = c.max_length,
        ACEITA_NULO = CASE WHEN c.is_nullable = 1 THEN 'sim' ELSE 'NAO' END,
        TEM_DEFAULT = CASE WHEN dc.object_id IS NULL THEN 'nao' ELSE 'sim' END,
        ORDEM       = c.column_id
FROM        sys.columns c
INNER JOIN  sys.types   ty ON ty.user_type_id = c.user_type_id
LEFT JOIN   sys.default_constraints dc ON dc.parent_object_id = c.object_id
                                      AND dc.parent_column_id = c.column_id
WHERE       c.object_id = OBJECT_ID('ci.kzn_membros_equipe')
ORDER BY    c.column_id;

/* =====================================================================
   O QUE FAZER COM O RESULTADO
   ---------------------------------------------------------------------
   Causa (B) — banco CASE-SENSITIVE, tabela existe:
       Nada a corrigir no sistema. Consulte com o nome em minúsculas:
           SELECT * FROM ci.kzn_membros_equipe;

   Causa (A) — a tabela não existe:
       Duas coisas estão quebradas HOJE em produção, não só a consulta:

       1. Salvar um Kaizen COM qualquer membro de equipe falha por
          inteiro. O INSERT dos membros (server.js, ~linha 2222) está
          dentro da mesma transação do Kaizen: o erro derruba a
          transação e NADA é gravado — nem o Kaizen. Sem nenhum membro
          o laço não roda e o salvamento passa, o que explica o
          problema não ter aparecido antes.

       2. Abrir o detalhe de qualquer Kaizen devolve HTTP 500. A
          consulta dos membros (server.js, ~linha 2443) roda sempre,
          tendo membro ou não.

       Para criar a tabela, rode database/criar_membros_equipe.sql.
   ===================================================================== */
