-- HOB:PENDENTE  ← apague esta linha quando a consulta abaixo estiver pronta
-- ═══ VBM Health of the Business — pontes (waterfall) da visão consolidada ═══
-- Uma linha por item, na ordem de exibição. Lida por hob-api.js (GET /api/dados).
--
-- Colunas (nomes exatos):
--   NR_ANO     ano (ex.: 2026)
--   CD_PONTE   'EBITDA_YEAR' (2026 EBITDA YEAR, US$ M) | 'FCF_YEAR' (FCF YEAR, US$ M)
--   NR_ORDEM   posição do item no gráfico (1, 2, 3…)
--   DS_ITEM    rótulo exibido (ex.: 'FX impact', 'Free Cash Flow')
--   VL_ITEM    valor; NULL nos tipos 'sub' e 'zero'
--   TP_ITEM    'tot'  barra cheia a partir do zero (reinicia o acumulado). Ex.: FY M-1, EBITDA, Net Debt
--              'd'    variação flutuante (verde se positiva, vermelha se negativa). Ex.: Price, Volume
--              'sub'  subtotal calculado pela página (VL_ITEM NULL). Ex.: FY Act/Fcst, Free Cash Flow
--              'ref'  referência isolada, em cinza. Ex.: 2026B Net Debt
--              'zero' espaço que reinicia o acumulado em 0 (DS_ITEM e VL_ITEM NULL). Ex.: antes de Copper/Nickel
--   FL_CINZA   1 = coluna no cinza do Budget (no FCF: Gross Operational Cash Flow, Free Cash Flow,
--              Debt Adjustments, 2026B Net Debt); 0 = cor padrão

SELECT CAST(NULL AS int)          AS NR_ANO,
       CAST(NULL AS varchar(20))  AS CD_PONTE,
       CAST(NULL AS int)          AS NR_ORDEM,
       CAST(NULL AS varchar(100)) AS DS_ITEM,
       CAST(NULL AS float)        AS VL_ITEM,
       CAST(NULL AS varchar(4))   AS TP_ITEM,
       CAST(NULL AS bit)          AS FL_CINZA
WHERE 1 = 0;
