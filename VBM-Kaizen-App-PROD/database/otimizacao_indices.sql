/* ═══════════════════════════════════════════════════════════════════
   VBM Kaizen — otimização de banco (auditoria de 11/09/2026)

   O QUE ESTE SCRIPT FAZ
     1. Cria a coluna computada persistida DT_REFERENCIA.
     2. Cria os índices que as consultas da aplicação pedem.

   SEGURANÇA
     Todo comando é idempotente: rodar duas vezes não dá erro e não
     duplica nada. Nenhum dado é alterado — só estrutura.

   A APLICAÇÃO NÃO DEPENDE DESTE SCRIPT PARA FUNCIONAR.
     O server.js verifica na primeira consulta se DT_REFERENCIA existe
     (ver expressaoDataReferencia) e, enquanto não existir, usa a
     própria coluna de criação (DT_CRIACAO/DT_ATUALIZACAO, o nome real
     resolvido em runtime). Assim que a coluna aparecer, a mesma
     consulta passa a usá-la — sem novo deploy. Só é preciso REINICIAR
     o app depois de rodar o script, para a verificação ser refeita.

   ANTES DE RODAR EM PRODUÇÃO
     Confira o que já existe (a etapa 0 abaixo) e valide cada índice no
     plano de execução real. Índice desnecessário custa escrita e espaço;
     estas recomendações vieram dos predicados das consultas do
     server.js, não de um plano medido na instância.

   ORDEM SUGERIDA
     Etapa 0 (diagnóstico) → 1 → 2. A etapa 3 é opcional.
   ═══════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;
GO

/* ───────────────────────────────────────────────────────────────────
   ETAPA 0 — DIAGNÓSTICO (não altera nada)
   Rode isto primeiro e guarde o resultado: é o "antes".
   ─────────────────────────────────────────────────────────────────── */

-- Índices que já existem nas tabelas envolvidas
SELECT  t.name  AS TABELA,
        i.name  AS INDICE,
        i.type_desc AS TIPO,
        i.is_unique AS UNICO,
        STUFF((SELECT ', ' + c.name
                 FROM sys.index_columns ic
                 JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                ORDER BY ic.key_ordinal
                FOR XML PATH('')), 1, 2, '') AS COLUNAS_CHAVE,
        STUFF((SELECT ', ' + c.name
                 FROM sys.index_columns ic
                 JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
                FOR XML PATH('')), 1, 2, '') AS COLUNAS_INCLUIDAS
  FROM sys.indexes i
  JOIN sys.tables  t ON t.object_id = i.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
 WHERE s.name = 'ci'
   AND t.name IN ('KZN_PEDRAVISAOCONSOLIDADA','KZN_MDM_HIERARQUIA','KZN_ADMIN',
                  'KZN_APROVADOR','KZN_KAIZEN_DESPERDICIO','KZN_CATEGORIA',
                  'KZN_STATUS','KZN_REPLICACAO','KZN_DESPERDICIO')
   AND i.type > 0
 ORDER BY t.name, i.name;

-- Collation de CD_EMAIL. O server.js deixou de usar LOWER() nesta
-- coluna porque a comparação direta já ignora caixa em collation _CI_.
-- Se aparecer _CS_ aqui, veja a NOTA no fim da Etapa 2.
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, COLLATION_NAME
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA = 'ci' AND TABLE_NAME = 'KZN_MDM_HIERARQUIA'
   AND COLUMN_NAME IN ('CD_EMAIL','ID_USUARIO','ID_TIPO_USUARIO','NM_SITE');

-- Tamanho atual das tabelas (dimensiona o impacto de cada índice)
SELECT t.name AS TABELA, SUM(p.rows) AS LINHAS
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
 WHERE s.name = 'ci' AND t.name LIKE 'KZN[_]%'
 GROUP BY t.name
 ORDER BY LINHAS DESC;
GO


/* ───────────────────────────────────────────────────────────────────
   ETAPA 1 — DT_REFERENCIA

   A Biblioteca ordena e filtra pela data de CRIAÇÃO do Kaizen (coluna
   DT_CRIACAO — renomeada de DT_ATUALIZACAO em produção; troque o nome
   abaixo se o seu ambiente ainda usa o antigo). Escrita direto na
   consulta, a coluna já seria indexável por si só; DT_REFERENCIA existe
   para o nome ficar estável mesmo que a coluna real mude de novo (ver
   colunaAtualizacaoDe() no server.js).

   Correção de 29/09/2026: a fórmula era ISNULL(DT_CONCLUSAO,
   DT_ATUALIZACAO) — a Biblioteca então ordenava/filtrava por data de
   CONCLUSÃO quando ela existisse, só caindo para a de criação nos
   Kaizens ainda sem conclusão. Resultado visível: o filtro de ano e o
   card mostravam datas diferentes (o card foi corrigido para mostrar
   sempre DT_CRIACAO; esta coluna precisa combinar).

   Se DT_REFERENCIA JÁ EXISTE no seu banco com a fórmula antiga, um
   ALTER TABLE não redefine coluna computada — é preciso derrubar e
   recriar:
     ALTER TABLE [ci].[KZN_PEDRAVISAOCONSOLIDADA] DROP COLUMN DT_REFERENCIA;
   e então rodar o bloco abaixo de novo.

   PERSISTED é o que permite indexar: o valor passa a ser gravado na
   linha, calculado pelo SQL Server a cada INSERT/UPDATE. Custo: alguns
   bytes por linha e um pouco de escrita; retorno: a listagem principal
   deixa de varrer a tabela.
   ─────────────────────────────────────────────────────────────────── */

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = 'ci' AND TABLE_NAME = 'KZN_PEDRAVISAOCONSOLIDADA'
                  AND COLUMN_NAME = 'DT_REFERENCIA')
BEGIN
    ALTER TABLE [ci].[KZN_PEDRAVISAOCONSOLIDADA]
      ADD DT_REFERENCIA AS DT_CRIACAO PERSISTED;
    PRINT 'DT_REFERENCIA criada.';
END
ELSE
    PRINT 'DT_REFERENCIA ja existe — nada a fazer.';
GO


/* ───────────────────────────────────────────────────────────────────
   ETAPA 2 — ÍNDICES

   Cada bloco diz qual consulta o índice atende e por quê.
   ─────────────────────────────────────────────────────────────────── */

/* IX_MDM_EMAIL — A CONSULTA MAIS EXECUTADA DO SISTEMA.
   perfilDeAcesso roda ANTES de toda requisição de API, e buscarMdmPorEmail
   monta o cabeçalho. As duas procuram o usuário por e-mail. Sem índice,
   é uma varredura por requisição. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MDM_EMAIL'
                 AND object_id = OBJECT_ID('ci.KZN_MDM_HIERARQUIA'))
    CREATE NONCLUSTERED INDEX IX_MDM_EMAIL
        ON [ci].[KZN_MDM_HIERARQUIA] (CD_EMAIL)
        INCLUDE (ID_USUARIO, CD_MATRICULA, NM_USUARIO, NM_POSICAO);
GO

/* IX_MDM_USUARIO — os dois OUTER APPLY da listagem da Biblioteca
   (SELECT TOP (1) ... WHERE ID_USUARIO = ... ORDER BY ID_TIPO_USUARIO).
   Com ID_TIPO_USUARIO na chave, o TOP (1) vira o primeiro registro do
   índice em vez de uma ordenação. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MDM_USUARIO'
                 AND object_id = OBJECT_ID('ci.KZN_MDM_HIERARQUIA'))
    CREATE NONCLUSTERED INDEX IX_MDM_USUARIO
        ON [ci].[KZN_MDM_HIERARQUIA] (ID_USUARIO, ID_TIPO_USUARIO)
        INCLUDE (NM_USUARIO, NM_SITE, NM_ESTADO, NM_CIDADE, CD_EMAIL);
GO

/* IX_PVC_REFERENCIA — ordenação e paginação da Biblioteca.
   A rota usa ORDER BY DT_REFERENCIA DESC, ID_KAIZEN DESC + OFFSET/FETCH;
   nesta ordem o índice entrega as linhas já ordenadas e o SQL Server
   lê só a página pedida. Depende da ETAPA 1. */
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'ci' AND TABLE_NAME = 'KZN_PEDRAVISAOCONSOLIDADA'
              AND COLUMN_NAME = 'DT_REFERENCIA')
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PVC_REFERENCIA'
                  AND object_id = OBJECT_ID('ci.KZN_PEDRAVISAOCONSOLIDADA'))
    CREATE NONCLUSTERED INDEX IX_PVC_REFERENCIA
        ON [ci].[KZN_PEDRAVISAOCONSOLIDADA] (DT_REFERENCIA DESC, ID_KAIZEN DESC)
        INCLUDE (NM_KAIZEN, ID_STATUS, ID_CATEGORIA, ID_USUARIO_LIDER,
                 ID_USUARIO_CADASTRO, DT_CONCLUSAO, DT_ATUALIZACAO,
                 URL_IMG_ANTES, URL_IMG_DEPOIS);
GO

/* IX_PVC_STATUS — filtro de status da Biblioteca e fila da Aprovação. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PVC_STATUS'
                 AND object_id = OBJECT_ID('ci.KZN_PEDRAVISAOCONSOLIDADA'))
    CREATE NONCLUSTERED INDEX IX_PVC_STATUS
        ON [ci].[KZN_PEDRAVISAOCONSOLIDADA] (ID_STATUS)
        INCLUDE (ID_KAIZEN, NM_KAIZEN, DT_ATUALIZACAO);
GO

/* IX_PVC_CATEGORIA — filtro de categoria da Biblioteca. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PVC_CATEGORIA'
                 AND object_id = OBJECT_ID('ci.KZN_PEDRAVISAOCONSOLIDADA'))
    CREATE NONCLUSTERED INDEX IX_PVC_CATEGORIA
        ON [ci].[KZN_PEDRAVISAOCONSOLIDADA] (ID_CATEGORIA)
        INCLUDE (ID_KAIZEN, DT_ATUALIZACAO);
GO

/* IX_KZ_DESP_KAIZEN — o STRING_AGG correlacionado que monta os balões de
   desperdício. Roda uma vez POR LINHA devolvida; com a paginação isso
   agora são 24 execuções por tela, mas cada uma tem de ser um seek. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KZ_DESP_KAIZEN'
                 AND object_id = OBJECT_ID('ci.KZN_KAIZEN_DESPERDICIO'))
    CREATE NONCLUSTERED INDEX IX_KZ_DESP_KAIZEN
        ON [ci].[KZN_KAIZEN_DESPERDICIO] (ID_KAIZEN)
        INCLUDE (ID_DESPERDICIO);
GO

/* IX_ADMIN_ATIVO / IX_APROVADOR_ATIVO — os dois EXISTS do gate de acesso,
   que rodam junto com IX_MDM_EMAIL em toda requisição. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ADMIN_ATIVO'
                 AND object_id = OBJECT_ID('ci.KZN_ADMIN'))
    CREATE NONCLUSTERED INDEX IX_ADMIN_ATIVO
        ON [ci].[KZN_ADMIN] (ID_USUARIO, SG_ATIVO);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_APROVADOR_ATIVO'
                 AND object_id = OBJECT_ID('ci.KZN_APROVADOR'))
    CREATE NONCLUSTERED INDEX IX_APROVADOR_ATIVO
        ON [ci].[KZN_APROVADOR] (ID_USUARIO, SG_ATIVO);
GO

/* Cadastros bilíngues — toda tela faz JOIN ... AND ID_IDIOMA = @idIdioma.
   São tabelas pequenas, então o ganho é menor; entram por consistência
   do plano, não por volume. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CATEGORIA_IDIOMA'
                 AND object_id = OBJECT_ID('ci.KZN_CATEGORIA'))
    CREATE NONCLUSTERED INDEX IX_CATEGORIA_IDIOMA
        ON [ci].[KZN_CATEGORIA] (ID_IDIOMA, ID_CATEGORIA) INCLUDE (NM_CATEGORIA);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_STATUS_IDIOMA'
                 AND object_id = OBJECT_ID('ci.KZN_STATUS'))
    CREATE NONCLUSTERED INDEX IX_STATUS_IDIOMA
        ON [ci].[KZN_STATUS] (ID_IDIOMA, ID_STATUS) INCLUDE (NM_STATUS, DS_STATUS);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DESPERDICIO_IDIOMA'
                 AND object_id = OBJECT_ID('ci.KZN_DESPERDICIO'))
    CREATE NONCLUSTERED INDEX IX_DESPERDICIO_IDIOMA
        ON [ci].[KZN_DESPERDICIO] (ID_IDIOMA, ID_DESPERDICIO) INCLUDE (NM_DESPERDICIO);
GO

/* NOTA — collation de CD_EMAIL.
   O server.js compara `CD_EMAIL = @email`, sem LOWER(). Isso casa
   independentemente de caixa nas collations _CI_ (o padrão). Se a
   Etapa 0 mostrar uma collation _CS_ nessa coluna, o login passaria a
   depender da caixa do e-mail — nesse caso, e SÓ nesse caso, crie uma
   coluna computada e indexe-a, em vez de voltar o LOWER() à consulta:

     ALTER TABLE [ci].[KZN_MDM_HIERARQUIA]
       ADD CD_EMAIL_NORM AS LOWER(CD_EMAIL) PERSISTED;
     CREATE NONCLUSTERED INDEX IX_MDM_EMAIL_NORM
       ON [ci].[KZN_MDM_HIERARQUIA] (CD_EMAIL_NORM) INCLUDE (ID_USUARIO);

   E troque a consulta para comparar com CD_EMAIL_NORM. */
GO


/* ───────────────────────────────────────────────────────────────────
   ETAPA 3 — OPCIONAL: busca por texto (Full-Text)

   A busca da Biblioteca usa LIKE '%termo%' em NM_KAIZEN. O curinga à
   ESQUERDA impede qualquer seek: o SQL Server precisa olhar todas as
   linhas. Hoje isso é irrelevante — a tabela é pequena e a consulta já
   vem paginada. Passa a pesar quando a base chegar à casa das dezenas
   de milhares.

   Full-Text resolve sem mudar a tela: a rota trocaria o LIKE por
   CONTAINS. NÃO rode agora; deixe documentado para quando o volume
   justificar, e meça antes.

     -- Uma vez por banco:
     -- CREATE FULLTEXT CATALOG FT_KAIZEN AS DEFAULT;

     -- Precisa de um índice ÚNICO de coluna única (a PK serve):
     -- CREATE FULLTEXT INDEX ON [ci].[KZN_PEDRAVISAOCONSOLIDADA] (NM_KAIZEN)
     --   KEY INDEX <nome_da_PK> ON FT_KAIZEN WITH CHANGE_TRACKING AUTO;

     -- E na consulta:  WHERE CONTAINS(p.NM_KAIZEN, @termo)
   ─────────────────────────────────────────────────────────────────── */


/* ───────────────────────────────────────────────────────────────────
   DEPOIS DE RODAR
     1. Reinicie o Databricks App (para ele reconhecer DT_REFERENCIA).
     2. Abra a Biblioteca e confira no log: deve aparecer
        "[kaizens] DT_REFERENCIA disponível — ordenação por índice".
     3. Meça o antes/depois com:
          SET STATISTICS IO, TIME ON;
        rodando a consulta da listagem e comparando leituras lógicas.
   ─────────────────────────────────────────────────────────────────── */
