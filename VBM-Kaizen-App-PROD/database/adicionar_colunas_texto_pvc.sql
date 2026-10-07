/* ============================================================
   Colunas de texto da etapa 4 em CI.KZN_PEDRAVISAOCONSOLIDADA
   ------------------------------------------------------------
   Cria as DUAS colunas que a etapa "Resultados & Aprendizados"
   passa a usar:

     DS_RESULTADO_ALCANCADO  VARCHAR(100)  "Descrição dos Resultados
                                            Alcançados" (opcional, ao
                                            lado do combo "Outros")

     DS_COMPARA_META         VARCHAR(300)  "Comparação com a Meta
                                            Inicial / Declaração do
                                            Problema" (obrigatório)

   MAPA FINAL DOS TRÊS TEXTOS DA ETAPA 4

     Lições Aprendidas ................. DS_LICOES_APRENDIDAS  (sem mudança)
     Descrição dos Resultados .......... DS_RESULTADO_ALCANCADO
     Comparação com a Meta Inicial ..... DS_COMPARA_META

   POR QUE AS COLUNAS PRECISAM EXISTIR

   A "Descrição dos Resultados Alcançados" não tinha onde morar: o
   servidor criava uma LINHA NOVA em CI.KZN_RESULTADOS a cada Kaizen
   salvo e usava o DS_RESULTADO dela para guardar o texto. O catálogo
   crescia um registro por Kaizen e a escolha do usuário não era gravada
   como escolha. Com o combo referenciando o catálogo,
   CI.KZN_RESULTADO_KAIZEN voltou a ser o vínculo Kaizen ↔ Resultado, e
   a descrição — que é do KAIZEN — passa a morar aqui.

   A "Comparação com a Meta Inicial" era gravada em
   DS_RESULTADO_ESPERADO. Passa a ter coluna própria.

   Nenhuma das duas reaproveita coluna existente: DS_LICOES_APRENDIDAS é
   das Lições Aprendidas e continua sendo, e dois campos da tela na mesma
   coluna se sobrescreveriam.

   SUBSTITUI database/adicionar_ds_resultado_pvc.sql, que criava uma
   coluna DS_RESULTADO nesta tabela. Se aquele script CHEGOU A SER
   RODADO, o bloco 3 abaixo traz o conteúdo dela para a coluna nova;
   depois disso a DS_RESULTADO da PVC fica sem uso. Este script NÃO a
   remove — apagar coluna é decisão de quem administra o banco.
   (Atenção: CI.KZN_RESULTADOS.DS_RESULTADO é outra coisa — é a
   descrição do item de catálogo, está em uso e não se mexe nela.)

   SEGURANÇA

   VARCHAR NULL nas duas, com o mesmo limite que a tela aplica e que o
   servidor valida (contadores 0/100 e 0/300). NULL porque os Kaizens já
   cadastrados nascem sem elas.

   Idempotente: rodar duas vezes não dá erro.

   O APLICATIVO NÃO DEPENDE DESTE SCRIPT PARA SUBIR. O servidor confere
   as colunas no INFORMATION_SCHEMA uma vez e se adapta:
     · sem DS_RESULTADO_ALCANCADO, a descrição (opcional) não é gravada
       e o log registra "[resultados] ... AUSENTE";
     · sem DS_COMPARA_META, a Comparação com a Meta — que é OBRIGATÓRIA
       — continua sendo gravada em DS_RESULTADO_ESPERADO, como hoje, e o
       log registra "[comparacao] ... AUSENTE". Nada é perdido; o app
       troca de coluna sozinho assim que este script rodar.
   ============================================================ */

/* ── 1. Descrição dos Resultados Alcançados ───────────────── */
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'ci'
       AND TABLE_NAME   = 'kzn_pedravisaoconsolidada'
       AND COLUMN_NAME  = 'DS_RESULTADO_ALCANCADO'
)
BEGIN
    ALTER TABLE ci.kzn_pedravisaoconsolidada
        ADD DS_RESULTADO_ALCANCADO VARCHAR(100) NULL;

    PRINT 'DS_RESULTADO_ALCANCADO criada em ci.kzn_pedravisaoconsolidada.';
END
ELSE
    PRINT 'DS_RESULTADO_ALCANCADO ja existe — nada a fazer.';
GO

/* ── 2. Comparação com a Meta Inicial ─────────────────────── */
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'ci'
       AND TABLE_NAME   = 'kzn_pedravisaoconsolidada'
       AND COLUMN_NAME  = 'DS_COMPARA_META'
)
BEGIN
    ALTER TABLE ci.kzn_pedravisaoconsolidada
        ADD DS_COMPARA_META VARCHAR(300) NULL;

    PRINT 'DS_COMPARA_META criada em ci.kzn_pedravisaoconsolidada.';
END
ELSE
    PRINT 'DS_COMPARA_META ja existe — nada a fazer.';
GO

/* ── 3. Só para quem rodou o script anterior ──────────────────
   Traz o que estiver em DS_RESULTADO (da PVC) para a coluna nova.
   Não sobrescreve nada: só preenche onde a nova está NULL. Se aquele
   script nunca foi rodado, a coluna não existe e este bloco é pulado
   inteiro — por isso o SQL dinâmico, que evita erro de compilação ao
   citar uma coluna inexistente. */
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'ci'
       AND TABLE_NAME   = 'kzn_pedravisaoconsolidada'
       AND COLUMN_NAME  = 'DS_RESULTADO'
)
BEGIN
    EXEC sp_executesql N'
        UPDATE ci.kzn_pedravisaoconsolidada
           SET DS_RESULTADO_ALCANCADO = DS_RESULTADO
         WHERE DS_RESULTADO_ALCANCADO IS NULL
           AND DS_RESULTADO IS NOT NULL;';

    PRINT 'Conteudo de DS_RESULTADO copiado para DS_RESULTADO_ALCANCADO.';
END
ELSE
    PRINT 'DS_RESULTADO nao existe na PVC — nada a copiar (caso normal).';
GO

/* ── 4. OPCIONAL: trazer a Comparação dos Kaizens antigos ─────
   Os Kaizens já gravados têm a Comparação com a Meta em
   DS_RESULTADO_ESPERADO. O aplicativo JÁ LÊ as duas colunas
   (DS_COMPARA_META primeiro, DS_RESULTADO_ESPERADO como reserva), então
   reabrir um Kaizen antigo mostra o texto certo mesmo SEM rodar este
   bloco — ele não é necessário para a tela funcionar.

   Rode-o só se quiser DS_COMPARA_META como fonte única, sem depender da
   reserva. Está comentado de propósito: é um UPDATE em massa na tabela
   principal e a decisão é de quem administra o banco.

UPDATE ci.kzn_pedravisaoconsolidada
   SET DS_COMPARA_META = DS_RESULTADO_ESPERADO
 WHERE DS_COMPARA_META IS NULL
   AND DS_RESULTADO_ESPERADO IS NOT NULL;
GO
*/

/* ── Conferência: devem voltar as duas linhas ─────────────── */
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA = 'ci'
   AND TABLE_NAME   = 'kzn_pedravisaoconsolidada'
   AND COLUMN_NAME IN ('DS_RESULTADO_ALCANCADO', 'DS_COMPARA_META')
 ORDER BY COLUMN_NAME;
GO
