/* =====================================================================
   Ícones de "Replication Potential" (kzn_replicacao.URL_ICONE) pelo nome
   ---------------------------------------------------------------------
   Os registros ficaram com ícones da paleta antiga (globo, prédio, mapa,
   proibido), sem relação com a área do processo. A tela já mostra o ícone
   certo pelo nome (js/replicacao.js, iconesPorNome) e grava ao editar;
   este script grava de uma vez.

   Casa pelo nome em INGLÊS (ID_IDIOMA = 2) e atualiza as duas linhas
   (PT e EN) do mesmo ID. Nome que não está na lista não é tocado.
   Rodar no SSMS, na base do Kaizen. Schema: 'ci'.
   ===================================================================== */
SET NOCOUNT ON;
BEGIN TRANSACTION;

UPDATE r
   SET URL_ICONE = 'assets/icons/replicacao/fa-solid-' + m.ICONE + '.svg'
  FROM [ci].[kzn_replicacao] r
  JOIN [ci].[kzn_replicacao] en ON en.ID_REPLICACAO = r.ID_REPLICACAO AND en.ID_IDIOMA = 2
  JOIN (VALUES
        ('Concentration',  'filter'),
        ('Crusher',        'hammer'),
        ('No replication', 'ban'),
        ('Open Pit',       'mountain'),
        ('Others',         'shapes'),
        ('Projects',       'diagram-project'),
        ('Refinery',       'industry'),
        ('Smelter',        'fire-flame-curved'),
        ('Underground',    'person-digging')
       ) m (NOME, ICONE) ON LTRIM(RTRIM(en.NM_REPLICACAO)) = m.NOME;

COMMIT;

/* Conferência: um ícone diferente por registro */
SELECT r.ID_REPLICACAO, r.ID_IDIOMA, r.NM_REPLICACAO, r.URL_ICONE
  FROM [ci].[kzn_replicacao] r
 ORDER BY r.ID_REPLICACAO, r.ID_IDIOMA;
