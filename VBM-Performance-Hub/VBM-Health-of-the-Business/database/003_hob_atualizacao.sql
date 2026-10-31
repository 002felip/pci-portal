-- HOB:PENDENTE  ← apague esta linha quando a consulta abaixo estiver pronta
-- ═══ VBM Health of the Business — atualização e último mês real ═══
-- UMA linha. Lida por hob-api.js (GET /api/dados).
--
-- Colunas (nomes exatos):
--   DT_ATUALIZACAO  data e hora da última carga ("Last updated" no topo da página)
--   NR_ANO_REAL     ano do último mês com Actual
--   NR_MES_REAL     último mês com Actual (1..12). Meses seguintes são Forecast (F) nos rótulos,
--                   e o filtro de mês abre nele

SELECT CAST(NULL AS datetime) AS DT_ATUALIZACAO,
       CAST(NULL AS int)      AS NR_ANO_REAL,
       CAST(NULL AS int)      AS NR_MES_REAL
WHERE 1 = 0;
