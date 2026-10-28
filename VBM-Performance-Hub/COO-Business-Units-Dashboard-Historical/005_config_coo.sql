/* ════════════════════════════════════════════════════════════════════
   COO Business Units Dashboard — configuração da tela em IBP.PHUB_PS_SETUP
   Banco: BDIBPBMSA_PRD · rodar uma vez (e de novo a cada alteração do JSON)

   Mesmo cadastro de dashboards do VBM Performance Studio (DS_LAYOUT em JSON),
   num registro próprio do COO:
     CD_VISAO           = 'COO_BUSINESS_UNITS'  (a API do COO lê por este código)
     SG_ATIVO           = 'N'                   (não aparece na lista do Studio)
     NM_USUARIO_CRIACAO = 'coo-business-units-dashboard' (dono técnico: ninguém o edita pelo Studio)

   Conteúdo (o mesmo que hoje está no código da tela; sem registro, a tela usa o código):
     seletores  cards com seletor, pelo código do card na tela:
                CAPEX_MINA (minas), ALL_IN (All-in e componentes), TEOR_CU_AU (Cu/Au).
                Cada opção: chave (fixa: vai no endereço da tela), lbl (botão), titulo (card),
                kpi (nomes em IBP.DASHBOARD.NM_KPIS_DASH, opcional), unid (trecho da
                unidade para escolher entre homônimos, opcional). A ordem dos botões segue o
                ID_ORDEM da query; sem dados, a ordem abaixo.
     apelidos   nome do card → nomes do KPI em IBP.DASHBOARD.NM_KPIS_DASH
   ════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CD_VISAO VARCHAR(40)    = 'COO_BUSINESS_UNITS';
DECLARE @DONO     NVARCHAR(200)  = N'coo-business-units-dashboard';
DECLARE @LAYOUT   NVARCHAR(MAX)  = N'{
  "versao": 1,
  "seletores": {
    "CAPEX_MINA": { "opcoes": [
      { "chave": "cost", "lbl": "Cost",       "titulo": "CAPEX (Cost)",       "kpi": ["CAPEX"] },
      { "chave": "sus",  "lbl": "Sustaining", "titulo": "CAPEX (sustaining)", "kpi": ["CAPEX Sustaining"] },
      { "chave": "gcap", "lbl": "G Cap Rep",  "titulo": "CAPEX (G Cap Rep)",  "kpi": ["CAPEX G Cap Rep"] }
    ] },
    "ALL_IN": { "opcoes": [
      { "chave": "allin", "lbl": "All-in",     "titulo": "All-in",              "unid": "k" },
      { "chave": "byp",   "lbl": "By Product", "titulo": "All-in | By Product", "kpi": ["By Product"], "unid": "k" },
      { "chave": "sus",   "lbl": "Sustaining", "titulo": "All-in | Sustaining", "kpi": ["Sustaining"], "unid": "k" },
      { "chave": "cost",  "lbl": "Cost",       "titulo": "All-in | Cost",       "kpi": ["Cost"],       "unid": "k" }
    ] },
    "TEOR_CU_AU": { "opcoes": [
      { "chave": "cu", "lbl": "Cu", "titulo": "Copper Feed Grade" },
      { "chave": "au", "lbl": "Au", "titulo": "Gold Feed Grade" }
    ] }
  },
  "apelidos": {
    "Revenues": ["Net Revenue", "Net Revenues", "Revenue"],
    "Ore Hoisted | Mined (Dry)": ["Ore Mined (Dry)", "Ore Mined"],
    "Ore Milled | ROP": ["Ore Milled | ROP (Dry)"],
    "Matsuzaka Production": ["Matsusaka Production"],
    "Vale - Lateral Mine Development Cost": ["Lateral Mine Development Cost"]
  }
}';

IF ISJSON(@LAYOUT) <> 1 THROW 50010, 'JSON inválido: nada foi gravado.', 1;

IF EXISTS (SELECT 1 FROM IBP.PHUB_PS_SETUP WHERE CD_VISAO = @CD_VISAO)
  UPDATE IBP.PHUB_PS_SETUP
     SET DS_LAYOUT = @LAYOUT, NM_USUARIO = @DONO, DT_ATUALIZACAO = SYSUTCDATETIME()
   WHERE CD_VISAO = @CD_VISAO;
ELSE
  INSERT INTO IBP.PHUB_PS_SETUP
    (NM_DASHBOARD, DS_DASHBOARD, CD_VISAO, DT_REF, DS_LAYOUT, SG_ATIVO, NM_USUARIO_CRIACAO, NM_USUARIO)
  VALUES
    (N'COO Business Units Dashboard - Configuração', N'Configuração da tela do COO (não é um dashboard do Studio)',
     @CD_VISAO, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1), @LAYOUT, 'N', @DONO, @DONO);

SELECT ID_DASHBOARD, NM_DASHBOARD, CD_VISAO, SG_ATIVO, DT_ATUALIZACAO
FROM IBP.PHUB_PS_SETUP WHERE CD_VISAO = @CD_VISAO;

/* Permissão do login do app do COO (só leitura):
GRANT SELECT ON IBP.PHUB_PS_SETUP TO [<usuario-do-app-coo>];
*/
