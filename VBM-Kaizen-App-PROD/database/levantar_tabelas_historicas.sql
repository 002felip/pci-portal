/* ============================================================
   Levantamento das tabelas históricas
   ------------------------------------------------------------
   SOMENTE LEITURA. Não cria, não altera e não apaga nada — só lê
   INFORMATION_SCHEMA e conta linhas.

   Rode e me mande o resultado dos quatro blocos. Sem isso não dá para
   escrever o UNION ALL: o comando precisa citar coluna por coluna, na
   mesma ordem e com tipos compatíveis dos dois lados, e uma coluna com
   nome diferente do esperado derruba a consulta inteira (foi o que
   aconteceu com ID_DESPERDICIO).
   ============================================================ */

/* ── 1. Colunas de cada tabela histórica ──────────────────────
   É o bloco essencial: nomes, tipos e tamanhos. */
SELECT  TABLE_NAME,
        ORDINAL_POSITION,
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE,
        IS_NULLABLE
  FROM  INFORMATION_SCHEMA.COLUMNS
 WHERE  TABLE_SCHEMA = 'ci'
   AND  TABLE_NAME LIKE 'kzn_hist[_]%'
 ORDER BY TABLE_NAME, ORDINAL_POSITION;
GO

/* ── 2. Quantas linhas há em cada uma ─────────────────────────
   Define se a paginação e os índices aguentam. */
SELECT  t.name AS TABELA,
        SUM(p.rows) AS LINHAS
  FROM  sys.tables t
  JOIN  sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
  JOIN  sys.schemas s    ON s.schema_id = t.schema_id
 WHERE  s.name = 'ci' AND t.name LIKE 'kzn_hist[_]%'
 GROUP BY t.name
 ORDER BY t.name;
GO

/* ── 3. Os ID_KAIZEN do histórico COLIDEM com os atuais? ──────
   Esta é a pergunta que decide se dá para simplesmente unir as duas
   tabelas. O rótulo do card e a rota de detalhe (/api/kaizens/:id) usam
   o ID_KAIZEN como chave única. Se o mesmo número existir nas duas
   tabelas, abrir um card histórico mostraria o Kaizen atual de mesmo
   número — dado errado na tela, sem nenhum erro aparecer.

   FAIXA_SOBREPOSTA = 0 e IDS_EM_COMUM = 0 é o que se espera. Qualquer
   outra coisa e o histórico precisa de ID_KAIZEN deslocado ou de uma
   coluna que diga de qual origem a linha veio. */
SELECT  MIN_HIST  = (SELECT MIN(ID_KAIZEN) FROM ci.kzn_hist_pedravisaoconsolidada),
        MAX_HIST  = (SELECT MAX(ID_KAIZEN) FROM ci.kzn_hist_pedravisaoconsolidada),
        MIN_ATUAL = (SELECT MIN(ID_KAIZEN) FROM ci.kzn_pedravisaoconsolidada),
        MAX_ATUAL = (SELECT MAX(ID_KAIZEN) FROM ci.kzn_pedravisaoconsolidada),
        IDS_EM_COMUM = (
            SELECT COUNT(*)
              FROM ci.kzn_hist_pedravisaoconsolidada h
              JOIN ci.kzn_pedravisaoconsolidada a ON a.ID_KAIZEN = h.ID_KAIZEN
        );
GO

/* ── 4. Como o histórico se distribui ─────────────────────────
   Diz se ele entra na fila de Aprovação ou só na Biblioteca, e como
   preencher o filtro de anos.

   Se ID_STATUS não existir na tabela histórica, este bloco falha — e
   isso já é uma resposta: o histórico não tem status e precisa de um
   valor fixo no UNION. */
SELECT  h.ID_STATUS,
        st.NM_STATUS,
        QTD = COUNT(*),
        ANO_MAIS_ANTIGO = MIN(YEAR(h.DT_ATUALIZACAO)),
        ANO_MAIS_NOVO   = MAX(YEAR(h.DT_ATUALIZACAO))
  FROM  ci.kzn_hist_pedravisaoconsolidada h
  LEFT JOIN ci.kzn_status st ON st.ID_STATUS = h.ID_STATUS AND st.ID_IDIOMA = 1
 GROUP BY h.ID_STATUS, st.NM_STATUS
 ORDER BY QTD DESC;
GO

/* ── 5. Uma linha de amostra, para conferir o conteúdo ────────
   Dado real esclarece o que o nome da coluna não diz — por exemplo se
   KZN_HIST_KAIZEN_HIERARQUIA guarda o nome da pessoa (e substitui o
   JOIN com kzn_mdm_hierarquia) ou só o ID. */
SELECT TOP (1) * FROM ci.kzn_hist_pedravisaoconsolidada ORDER BY ID_KAIZEN DESC;
GO
SELECT TOP (3) * FROM ci.kzn_hist_kaizen_hierarquia;
GO
