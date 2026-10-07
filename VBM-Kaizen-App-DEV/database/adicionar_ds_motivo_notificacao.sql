/* =====================================================================
   KZN_TB_NOTIFICACAO.DS_MOTIVO — nova coluna (06/10/2026)
   ---------------------------------------------------------------------
   Guarda, em cada notificação, o motivo/comentário que estava gravado
   no Kaizen (KZN_PEDRAVISAOCONSOLIDADA.DS_MOTIVO) no momento do evento:
     · Rejeitado / Solicitado alterações → o texto do aprovador;
     · Revisado → o pedido de alteração que o autor atendeu;
     · Aprovado → o comentário opcional (ou NULL);
     · Aguardando aprovação → NULL (Kaizen recém-cadastrado).
   É o campo que os e-mails 2, 3, 6, 7, 8 e 9 do fluxo usam.

   Mesmo tipo e tamanho da coluna de origem (VARCHAR(300), ver DER):
   o texto copiado sempre cabe.

   O APLICATIVO NÃO DEPENDE DA ORDEM: enquanto a coluna não existir, ele
   grava a notificação sem ela; depois que existir, passa a preenchê-la
   sozinho (confere a cada minuto) — sem reiniciar o app.

   Rode a ETAPA 1 primeiro e confira o que já existe.
   Schema: 'ci' (AZURE_SQL_SCHEMA em app.yaml).
   ===================================================================== */

SET NOCOUNT ON;

/* ── ETAPA 1 — conferência (só leitura) ─────────────────────────────── */
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA = 'ci'
   AND TABLE_NAME IN ('KZN_TB_NOTIFICACAO', 'kzn_pedravisaoconsolidada')
   AND COLUMN_NAME = 'DS_MOTIVO';
-- Esperado ANTES de rodar a etapa 2: só a linha de kzn_pedravisaoconsolidada.

/* ── ETAPA 2 — cria a coluna (idempotente: rodar duas vezes não faz nada) */
IF COL_LENGTH('ci.KZN_TB_NOTIFICACAO', 'DS_MOTIVO') IS NULL
BEGIN
    ALTER TABLE ci.KZN_TB_NOTIFICACAO ADD DS_MOTIVO VARCHAR(300) NULL;
    PRINT 'DS_MOTIVO criada em ci.KZN_TB_NOTIFICACAO.';
END
ELSE
    PRINT 'DS_MOTIVO já existia em ci.KZN_TB_NOTIFICACAO — nada feito.';

/* ── ETAPA 3 — conferência depois ───────────────────────────────────── */
SELECT TOP (20) ID_NOTIFICACAO, ID_KAIZEN, TIPO_NOTIFICACAO, DT_CRIACAO, DS_MOTIVO
  FROM ci.KZN_TB_NOTIFICACAO
 ORDER BY DT_CRIACAO DESC;
-- As notificações gravadas ANTES da coluna existir ficam com DS_MOTIVO
-- NULL (não há como saber, hoje, qual era o motivo naquele instante).
