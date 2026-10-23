/* =====================================================================
   KZN_STATUS — cadastro do status "Revisado" (ID_STATUS = 5)
   ---------------------------------------------------------------------
   A edição de um Kaizen grava ID_STATUS = 5 ao salvar a revisão. O
   número vem da regra de negócio, mas o app NÃO confia nele de olho
   fechado: antes de gravar, confere no banco se a linha existe, está
   ATIVA e se chama "Revisado". Enquanto não estiver assim, salvar a
   edição é recusado com mensagem clara — de propósito, para não
   carimbar um status que não significa o que se espera.

   Rode a ETAPA 1 primeiro e confira o que já existe.

   Schema: 'ci' (AZURE_SQL_SCHEMA em app.yaml).
   ===================================================================== */

SET NOCOUNT ON;

/* =====================================================================
   ETAPA 1 — DIAGNÓSTICO (só leitura)
   ===================================================================== */
SELECT  s.ID_STATUS, s.ID_IDIOMA, s.NM_STATUS, s.DS_STATUS, s.SG_ATIVO, s.URL_ICONE
FROM    [ci].[kzn_status] s
ORDER BY s.ID_STATUS, s.ID_IDIOMA;

/* =====================================================================
   ETAPA 2 — CRIA O ID 5 NOS DOIS IDIOMAS
   ---------------------------------------------------------------------
   Só insere o que faltar: rodar de novo não duplica nem sobrescreve o
   que já estiver cadastrado (mesmo cuidado do popular_status.sql).
   O ID_USUARIO abaixo é quem fica registrado como responsável pelo
   cadastro — troque pelo seu ID_USUARIO em kzn_mdm_hierarquia.
   ===================================================================== */
DECLARE @ID_USUARIO INT = 181222;   /* <<< ajuste antes de rodar */

INSERT INTO [ci].[kzn_status] (ID_STATUS, ID_IDIOMA, NM_STATUS, DS_STATUS, SG_ATIVO, URL_ICONE, ID_USUARIO, DT_ATUALIZACAO)
SELECT  v.ID_STATUS, v.ID_IDIOMA, v.NM_STATUS, v.DS_STATUS, 'S',
        'assets/icons/status/fa-solid-pen.svg', @ID_USUARIO,
        CAST((SYSDATETIMEOFFSET() AT TIME ZONE 'E. South America Standard Time') AS DATETIME2)
FROM    (VALUES
            (5, 1, 'Revisado', 'Kaizen ajustado pelo autor e reenviado para aprovação.'),
            (5, 2, 'Reviewed', 'Kaizen adjusted by the author and resubmitted for approval.')
        ) v (ID_STATUS, ID_IDIOMA, NM_STATUS, DS_STATUS)
WHERE   NOT EXISTS (SELECT 1 FROM [ci].[kzn_status] s
                     WHERE s.ID_STATUS = v.ID_STATUS AND s.ID_IDIOMA = v.ID_IDIOMA);

/* =====================================================================
   ETAPA 3 — CONFERÊNCIA
   ---------------------------------------------------------------------
   Tem de voltar 2 linhas, com SG_ATIVO = 'S'. Se o nome em português
   não for exatamente "Revisado", o app recusa a gravação e diz qual
   nome encontrou — ajuste aqui ou pela aba Administração > Status
   Kaizen, que edita esta mesma tabela.
   ===================================================================== */
SELECT  s.ID_STATUS, s.ID_IDIOMA, s.NM_STATUS, s.SG_ATIVO
FROM    [ci].[kzn_status] s
WHERE   s.ID_STATUS = 5
ORDER BY s.ID_IDIOMA;

/* ---------------------------------------------------------------------
   OBSERVAÇÃO SOBRE A FILA DE APROVAÇÃO
   ---------------------------------------------------------------------
   A fila da tela de Aprovação lista os Kaizens com o status de
   "Aguardando aprovação" (ID 3). Um Kaizen salvo como "Revisado"
   (ID 5) NÃO aparece nessa fila — o aprovador é avisado por e-mail,
   mas precisa de um caminho para vê-lo. Duas saídas possíveis, ambas
   dependendo da sua decisão:

     a) a revisão gravar ID_STATUS = 3 em vez de 5; ou
     b) a fila passar a aceitar 3 OU 5.

   Enquanto isso não for definido, o Kaizen revisado fica visível na
   Biblioteca (que lista todos os status), não na fila de aprovação.
   --------------------------------------------------------------------- */
