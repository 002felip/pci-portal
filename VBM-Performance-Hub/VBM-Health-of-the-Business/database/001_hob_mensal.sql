-- HOB:PENDENTE  ← apague esta linha quando a consulta abaixo estiver pronta
-- ═══ VBM Health of the Business — valores mensais (Budget e Actual|Forecast) ═══
-- Uma linha por BU × indicador × ano × mês. Lida por hob-api.js (GET /api/dados).
--
-- Colunas (nomes exatos):
--   CD_BU         'VBM' | 'CU' | 'NI'
--   NR_ANO        ano (ex.: 2026)
--   NR_MES        1..12
--   CD_INDICADOR  ver a tabela abaixo
--   VL_B          Budget | Adjusted Budget do mês
--   VL_AF         Actual (meses fechados) ou Forecast (meses seguintes) do mês
--
--   CD_BU  CD_INDICADOR  Gráfico                                   Unidade
--   VBM    EBITDA_CU     EBITDA (segmento Copper)                  US$ bn
--   VBM    EBITDA_NI     EBITDA (segmento Nickel)                  US$ bn
--   VBM    EBITDA_OUT    EBITDA (Others)                           US$ bn
--   VBM    CAPEX         Capex | S Curve                           US$ M
--   CU/NI  PROD          Production                                Kt
--   CU/NI  SALES         Sales                                     Kt
--   CU/NI  EBITDA        EBITDA                                    US$ M
--   CU/NI  CAPEX         Capex | S Curve                           US$ M
--   CU/NI  FCF           FCF (valor do mês; a página acumula)      US$ M
--   CU/NI  AISC_SUS      All-In (AISC) — Sustaining + Cap. Replac. US$ k/t
--   CU/NI  AISC_COST     All-In (AISC) — Costs                     US$ k/t
--   CU/NI  AISC_BYP      All-In (AISC) — By Products (negativo)    US$ k/t
--
-- Mês sem valor aparece como 0 na página e é registrado no log do Portal.

SELECT CAST(NULL AS varchar(3))  AS CD_BU,
       CAST(NULL AS int)         AS NR_ANO,
       CAST(NULL AS int)         AS NR_MES,
       CAST(NULL AS varchar(20)) AS CD_INDICADOR,
       CAST(NULL AS float)       AS VL_B,
       CAST(NULL AS float)       AS VL_AF
WHERE 1 = 0;
