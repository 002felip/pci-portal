/* =====================================================================
   Ícones de "Waste Reduction" (kzn_desperdicio.URL_ICONE) pelo nome
   ---------------------------------------------------------------------
   Os registros ficaram quase todos com o mesmo ícone (raio, da paleta
   antiga). A tela já mostra o ícone certo pelo nome (js/desperdicios.js,
   iconesPorNome) e grava ao editar; este script grava de uma vez.

   Casa pelo nome em INGLÊS (ID_IDIOMA = 2) e atualiza as duas linhas
   (PT e EN) do mesmo ID. Nome que não está na lista não é tocado.
   Rodar no SSMS, na base do Kaizen. Schema: 'ci'.
   ===================================================================== */
SET NOCOUNT ON;
BEGIN TRANSACTION;

UPDATE d
   SET URL_ICONE = 'assets/icons/desperdicios/fa-solid-' + m.ICONE + '.svg'
  FROM [ci].[kzn_desperdicio] d
  JOIN [ci].[kzn_desperdicio] en ON en.ID_DESPERDICIO = d.ID_DESPERDICIO AND en.ID_IDIOMA = 2
  JOIN (VALUES
        ('Defects',        'triangle-exclamation'),
        ('Ergonomics',     'user-injured'),
        ('Inventory',      'warehouse'),
        ('Motion',         'person-walking'),
        ('None',           'circle-minus'),
        ('Overburden',     'weight-hanging'),
        ('Overprocessing', 'gears'),
        ('Overproduction', 'boxes-stacked'),
        ('Transportation', 'truck-fast'),
        ('Waiting',        'hourglass-half')
       ) m (NOME, ICONE) ON LTRIM(RTRIM(en.NM_DESPERDICIO)) = m.NOME;

COMMIT;

/* Conferência: um ícone diferente por registro */
SELECT d.ID_DESPERDICIO, d.ID_IDIOMA, d.NM_DESPERDICIO, d.URL_ICONE
  FROM [ci].[kzn_desperdicio] d
 ORDER BY d.ID_DESPERDICIO, d.ID_IDIOMA;
