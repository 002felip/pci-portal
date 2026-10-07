/* =====================================================================
   KZN_PEDRAVISAOCONSOLIDADA.NM_KAIZEN — de VARCHAR(30) para VARCHAR(100)
   ---------------------------------------------------------------------
   O título do Kaizen nascia com o mesmo limite curto das tabelas de
   cadastro (30 caracteres), apertado demais para um nome compreensível.
   A tela e o servidor já trabalham com 100; falta a coluna acompanhar.

   Alargar é seguro: o que cabia em 30 cabe em 100, nenhuma linha
   existente é tocada e nenhum valor é reescrito. O caminho contrário
   (voltar para 30) é que truncaria dados — por isso não há script de
   volta aqui.

   ENQUANTO ESTE SCRIPT NÃO RODAR o aplicativo continua aceitando só o
   tamanho REAL da coluna: ele lê o valor em INFORMATION_SCHEMA e recusa
   o título longo com uma mensagem clara, em vez de deixar o SQL Server
   devolver erro de truncamento. Depois de rodar, REINICIE o aplicativo —
   o tamanho é lido uma vez e guardado em memória.

   Rode a ETAPA 1 primeiro e confira o que já existe.

   Schema: 'ci' (AZURE_SQL_SCHEMA em app.yaml).
   ===================================================================== */

SET NOCOUNT ON;

/* =====================================================================
   ETAPA 1 — DIAGNÓSTICO (só leitura)
   ---------------------------------------------------------------------
   1.1  Como a coluna está hoje.
   1.2  Índices, chaves e constraints que dependem dela. Se algo aparecer
        em 1.2, leia a ETAPA 3 ANTES de rodar a ETAPA 2: um índice sobre
        a coluna precisa ser removido e recriado em volta do ALTER.
   ===================================================================== */
SELECT  c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE,
        c.CHARACTER_MAXIMUM_LENGTH AS TAMANHO_ATUAL, c.IS_NULLABLE
FROM    INFORMATION_SCHEMA.COLUMNS c
WHERE   c.TABLE_SCHEMA = 'ci'
  AND   c.TABLE_NAME   = 'kzn_pedravisaoconsolidada'
  AND   c.COLUMN_NAME  = 'NM_KAIZEN';

SELECT  i.name AS INDICE, i.type_desc AS TIPO, i.is_unique AS EH_UNICO,
        i.is_primary_key AS EH_PK
FROM    sys.indexes i
JOIN    sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN    sys.columns col      ON col.object_id = ic.object_id AND col.column_id = ic.column_id
WHERE   i.object_id = OBJECT_ID('[ci].[kzn_pedravisaoconsolidada]')
  AND   col.name = 'NM_KAIZEN';

/* Maior título já gravado — só para conferência; nenhum deles é alterado. */
SELECT  MAX(LEN(NM_KAIZEN)) AS MAIOR_TITULO_GRAVADO, COUNT(*) AS LINHAS
FROM    [ci].[kzn_pedravisaoconsolidada];

/* =====================================================================
   ETAPA 2 — ALTERAÇÃO
   ---------------------------------------------------------------------
   Só roda se a coluna ainda estiver menor que 100 — repetir o script não
   causa efeito nenhum. A nulidade atual da coluna é preservada: o ALTER
   é montado com o NOT NULL / NULL que ela já tem, porque omitir isso no
   SQL Server transforma a coluna em NULL sem avisar.
   ===================================================================== */
DECLARE @tamanho INT, @nulidade NVARCHAR(10), @cmd NVARCHAR(MAX);

SELECT  @tamanho = c.CHARACTER_MAXIMUM_LENGTH,
        @nulidade = CASE WHEN c.IS_NULLABLE = 'YES' THEN N'NULL' ELSE N'NOT NULL' END
FROM    INFORMATION_SCHEMA.COLUMNS c
WHERE   c.TABLE_SCHEMA = 'ci'
  AND   c.TABLE_NAME   = 'kzn_pedravisaoconsolidada'
  AND   c.COLUMN_NAME  = 'NM_KAIZEN';

IF @tamanho IS NULL
    PRINT 'NM_KAIZEN nao encontrada em ci.kzn_pedravisaoconsolidada — confira o schema e o nome da tabela em app.yaml.';
ELSE IF @tamanho = -1
    PRINT 'NM_KAIZEN ja e VARCHAR(MAX) — nada a fazer.';
ELSE IF @tamanho >= 100
    PRINT 'NM_KAIZEN ja comporta 100 caracteres — nada a fazer.';
ELSE
BEGIN
    SET @cmd = N'ALTER TABLE [ci].[kzn_pedravisaoconsolidada] ALTER COLUMN NM_KAIZEN VARCHAR(100) ' + @nulidade + N';';
    PRINT @cmd;
    EXEC sp_executesql @cmd;
    PRINT 'NM_KAIZEN alterada para VARCHAR(100).';
END

/* =====================================================================
   ETAPA 3 — CONFERÊNCIA
   ---------------------------------------------------------------------
   TAMANHO_ATUAL tem de voltar 100, com a mesma IS_NULLABLE da ETAPA 1.
   Depois disso, REINICIE o aplicativo: o servidor lê o tamanho da coluna
   uma vez e guarda em memória — sem reiniciar, continuaria recusando
   títulos acima do tamanho antigo.
   ===================================================================== */
SELECT  c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH AS TAMANHO_ATUAL, c.IS_NULLABLE
FROM    INFORMATION_SCHEMA.COLUMNS c
WHERE   c.TABLE_SCHEMA = 'ci'
  AND   c.TABLE_NAME   = 'kzn_pedravisaoconsolidada'
  AND   c.COLUMN_NAME  = 'NM_KAIZEN';

/* ---------------------------------------------------------------------
   SE A ETAPA 1 LISTOU ALGUM ÍNDICE SOBRE NM_KAIZEN
   ---------------------------------------------------------------------
   O SQL Server recusa alterar uma coluna que participa de índice, com a
   mensagem "The index ... is dependent on column 'NM_KAIZEN'". Nesse
   caso o caminho é remover o índice, rodar a ETAPA 2 e recriá-lo com a
   MESMA definição que a ETAPA 1 mostrou (nome, unicidade e colunas):

       DROP INDEX [nome_do_indice] ON [ci].[kzn_pedravisaoconsolidada];
       -- rodar a ETAPA 2 --
       CREATE [UNIQUE] INDEX [nome_do_indice]
           ON [ci].[kzn_pedravisaoconsolidada] (NM_KAIZEN);

   Índice de chave primária ou constraint UNIQUE pede DROP/ADD da
   constraint, não DROP INDEX. Não há nada disso previsto no DER para
   esta coluna — o bloco está aqui para o caso de o banco em produção ter
   algo que o DER não registra.
   --------------------------------------------------------------------- */
