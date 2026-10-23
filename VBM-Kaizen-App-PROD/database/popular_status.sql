/* =====================================================================
   ci.kzn_status — o catálogo do ciclo de vida do Kaizen
   ---------------------------------------------------------------------
   kzn_pedravisaoconsolidada.ID_STATUS passou a apontar para cá (DER
   atual). Com a tabela VAZIA não existe ID válido para gravar, então
   hoje o sistema fica assim:

     · criar Kaizen  ...... funciona, e não grava ID_STATUS;
     · fila de aprovação .. mostra os Kaizens sem status como pendentes;
     · aprovar/reprovar ... RECUSAM, com mensagem pedindo a configuração.

   Este script resolve isso: cria os 3 status do fluxo (nos 2 idiomas,
   como toda tabela bilíngue do sistema) e devolve, no fim, as linhas
   prontas para colar no app.yaml.

   Você pode cadastrar os status pela tela também — Administração >
   Status Kaizen. O script existe porque é mais rápido e já entrega os
   IDs. De qualquer jeito, os IDs precisam ir para o app.yaml.

   NÃO apaga nem altera nada: se um status de mesmo nome já existir, ele
   é reaproveitado.
   ===================================================================== */

SET NOCOUNT ON;

/* ETAPA 1 — cria o que faltar -------------------------------------- */
;WITH desejados (ORDEM, NM_PT, DS_PT, NM_EN, DS_EN, URL_ICONE) AS (
    SELECT 1, 'Em aprovação', 'Aguardando decisão do aprovador',
              'Under review',  'Waiting for the approver',
              'assets/icons/status/fa-solid-clipboard-check.svg'
    UNION ALL
    SELECT 2, 'Aprovado',  'Kaizen aprovado pelo aprovador',
              'Approved',  'Kaizen approved by the approver',
              'assets/icons/status/fa-solid-circle-check.svg'
    UNION ALL
    SELECT 3, 'Reprovado', 'Kaizen reprovado — ver o motivo no Kaizen',
              'Rejected',  'Kaizen rejected — see the reason on the Kaizen',
              'assets/icons/status/fa-solid-circle-xmark.svg'
),
faltando AS (
    SELECT  d.*,
            NOVO_ID = (SELECT ISNULL(MAX(ID_STATUS), 0) FROM [ci].[kzn_status])
                      + ROW_NUMBER() OVER (ORDER BY d.ORDEM)
    FROM    desejados d
    WHERE   NOT EXISTS (SELECT 1 FROM [ci].[kzn_status] s
                         WHERE s.ID_IDIOMA = 1 AND s.NM_STATUS = d.NM_PT)
)
INSERT INTO [ci].[kzn_status]
       (ID_STATUS, ID_IDIOMA, URL_ICONE, NM_STATUS, DS_STATUS, SG_ATIVO, DT_ATUALIZACAO)
SELECT  f.NOVO_ID, i.ID_IDIOMA, f.URL_ICONE,
        CASE i.ID_IDIOMA WHEN 1 THEN f.NM_PT ELSE f.NM_EN END,
        CASE i.ID_IDIOMA WHEN 1 THEN f.DS_PT ELSE f.DS_EN END,
        'S',
        CAST((SYSDATETIMEOFFSET() AT TIME ZONE 'E. South America Standard Time') AS DATETIME2)
FROM        faltando f
CROSS JOIN  (SELECT 1 AS ID_IDIOMA UNION ALL SELECT 2) i;

/* ETAPA 2 — o catálogo como ficou ---------------------------------- */
SELECT  s.ID_STATUS, s.NM_STATUS, s.DS_STATUS, s.SG_ATIVO, s.URL_ICONE
FROM    [ci].[kzn_status] s
WHERE   s.ID_IDIOMA = 1
ORDER BY s.ID_STATUS;

/* ETAPA 3 — conferência final --------------------------------------
   O app resolve o ID_STATUS lendo esta tabela pelo NOME do status, em
   qualquer idioma, e só considera SG_ATIVO = 'S'. Não há mais variável
   de ambiente no caminho: o que está cadastrado aqui é o que vale.

   Os nomes que o app reconhece para cada momento do ciclo:
     · aguardando  -> 'Aguardando aprovação' / 'Awaiting approval'
     · aprovado    -> 'Aprovado'             / 'Approved'
     · reprovado   -> 'Rejeitado'            / 'Reject'
     · alteração   -> 'Solicitado alterações'/ 'Request changes'
   ------------------------------------------------------------------- */
SELECT  s.ID_STATUS, s.ID_IDIOMA, s.NM_STATUS, s.SG_ATIVO
FROM    [ci].[kzn_status] s
ORDER BY s.ID_STATUS, s.ID_IDIOMA;

/* ---------------------------------------------------------------------
   Se você já tinha Kaizens gravados antes desta mudança, eles estão com
   ID_STATUS nulo (a coluna SG_STATUS antiga saiu do DER). Para marcá-los
   com um status, ajuste e rode à mão — de propósito não faço isso
   automaticamente, já que só você sabe em que ponto cada um parou:

       UPDATE [ci].[kzn_pedravisaoconsolidada]
          SET ID_STATUS = <id de 'Em aprovação'>
        WHERE ID_STATUS IS NULL;
   --------------------------------------------------------------------- */
