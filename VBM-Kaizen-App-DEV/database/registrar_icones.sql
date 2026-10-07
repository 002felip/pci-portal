/* =====================================================================
   Registro das URLs dos ícones da tela de Administração (URL_ICONE)
   ---------------------------------------------------------------------
   Os arquivos dos ícones estão em assets/icons/ (ver assets/icons/icones.json,
   que traz, para cada ícone, o arquivo local e a origem oficial de onde foi
   baixado: pacote Font Awesome Free 6.6.0, a MESMA versão já vendorizada em
   css/vendor/e5e202e3c8995079_all.min.css).

   A aplicação JÁ lê URL_ICONE dinamicamente e monta <img src="URL_ICONE">
   (js/cadastro-bilingue.js e js/categorias.js, renderItem). Quando a coluna
   está NULL o card cai no glifo padrão da aba. Por isso o caminho gravado
   aqui é RELATIVO à raiz da aplicação — é exatamente o que o <img> precisa.

   Só as 4 tabelas abaixo têm a coluna URL_ICONE. kzn_tipo_resultado e
   kzn_motivo_reprovacao não têm (ver server.js, temIcone:false) e por isso
   não aparecem neste script.

   IDEMPOTENTE: cada UPDATE só toca linhas com URL_ICONE IS NULL, então
   rodar de novo não sobrescreve ícone nenhum já escolhido. Nenhuma
   estrutura é alterada — só dados na coluna que já existe.

   Schema: 'ci' (AZURE_SQL_SCHEMA em app.yaml).
   ===================================================================== */

SET NOCOUNT ON;
BEGIN TRANSACTION;

/* --- Categorias — ícone padrão da aba: fa-tag ---------------------- */
UPDATE [ci].[kzn_categoria]
   SET URL_ICONE = 'assets/icons/categorias/fa-solid-tag.svg'
 WHERE URL_ICONE IS NULL;

/* --- Potencial de Replicação — ícone padrão da aba: fa-globe ------- */
UPDATE [ci].[kzn_replicacao]
   SET URL_ICONE = 'assets/icons/replicacao/fa-solid-globe.svg'
 WHERE URL_ICONE IS NULL;

/* --- Redução de Desperdícios — ícone padrão da aba: fa-recycle ----- */
UPDATE [ci].[kzn_desperdicio]
   SET URL_ICONE = 'assets/icons/desperdicios/fa-solid-recycle.svg'
 WHERE URL_ICONE IS NULL;

/* --- Resultados — ícone padrão da aba: fa-trophy ------------------- */
UPDATE [ci].[kzn_resultados]
   SET URL_ICONE = 'assets/icons/resultados/fa-solid-trophy.svg'
 WHERE URL_ICONE IS NULL;

COMMIT;

/* --- Conferência: nenhuma linha deve sobrar sem ícone -------------- */
SELECT 'kzn_categoria'  AS TABELA, COUNT(*) AS SEM_ICONE FROM [ci].[kzn_categoria]  WHERE URL_ICONE IS NULL
UNION ALL SELECT 'kzn_replicacao',  COUNT(*) FROM [ci].[kzn_replicacao]  WHERE URL_ICONE IS NULL
UNION ALL SELECT 'kzn_desperdicio', COUNT(*) FROM [ci].[kzn_desperdicio] WHERE URL_ICONE IS NULL
UNION ALL SELECT 'kzn_resultados',  COUNT(*) FROM [ci].[kzn_resultados]  WHERE URL_ICONE IS NULL;

/* --- Para trocar o ícone de UM registro específico ------------------
   Basta apontar para outro arquivo de assets/icons (os ícones de cada aba estão
   na pasta da própria aba, ver assets/icons/icones.json). Exemplo:

     UPDATE [ci].[kzn_categoria]
        SET URL_ICONE = 'assets/icons/categorias/fa-solid-helmet-safety.svg'
      WHERE ID_CATEGORIA = 1;   -- vale para as 2 linhas (PT e EN) do registro
   ------------------------------------------------------------------- */
