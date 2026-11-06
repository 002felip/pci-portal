/* ════════════════════════════════════════════════════════════════════
   VBM Health of the Business — configuração da tela em IBP.PHUB_PS_SETUP
   Banco: BDIBPBMSA_PRD · rodar uma vez (e de novo a cada alteração do JSON)

   Mesmo cadastro de dashboards do VBM Performance Studio (DS_LAYOUT em JSON), num registro
   próprio, como o do COO (005_config_coo.sql):
     CD_VISAO           = 'VBM_HEALTH_OF_THE_BUSINESS'  (a API lê por este código)
     SG_ATIVO           = 'N'                           (não aparece na lista do Studio)
     NM_USUARIO_CRIACAO = 'vbm-health-of-the-business'  (dono técnico: ninguém o edita pelo Studio)

   Conteúdo (o mesmo de CONFIG_PADRAO em hob-api.js; sem registro, a tela usa o código):
     fcf          FCF YEAR: site, tipo (ID_TIPO 2) e ano inicial da consulta em IBP.WATERFALL (database/002_hob_waterfall.sql)
     ebitdaPonte  2026 EBITDA YEAR: a mesma consulta de IBP.WATERFALL com ID_TIPO 3
     ebitda       EBITDA por período: ID_DASH 16 (carga do Health of the Business), ID_KPI 73 nos sites
                  cu 38 e ni 39 (barras) e vbm 40 (total, por fora); outros = KPIs 45 + 102 + 46 da operação 11
     coo          demais gráficos mês a mês: ID_KPI da carga do dashboard (ID_DASH 16) por série, no site da página
                  (vbm 40, cu 38, ni 39). Ex.: "cu.prod": <ID_KPI de Production>. null = segue na demonstração.
                  Séries: vbm.capex; cu/ni: prod, sales, ebitda (73), capex, fcf e o All-in: sus, cost, byp
     bus          sites (IBP.DASHBOARD.ID_SITE) de cada Business Unit: vbm, cu (Copper), ni (Nickel).
                  Vazio = qualquer site do dashboard. Obrigatório quando o mesmo nome de KPI
                  (ex.: EBITDA, CAPEX) existe em mais de uma BU.
     indicadores  série da tela → nomes do KPI em IBP.DASHBOARD.NM_KPIS_DASH (vale o primeiro que existir)
                  vbm: ebitdaCu, ebitdaNi, ebitdaOut (EBITDA por segmento), capex (Capex | S Curve)
                  cu / ni: prod, sales, ebitda, capex, fcf e o All-in: sus, cost, byp
     pontes       degraus de 2026 EBITDA YEAR (ebitdaYear) e FCF YEAR (fcfYear), na ordem.
                  tipo: tot (barra cheia) | d (variação) | sub (subtotal calculado) | ref (referência)
                        | zero (reinicia em 0); kpi + serie ('B' | 'AF') + ano (0 = ano da tela,
                  -1 = anterior) dão o valor (CD_PERIODO 'YEAR'); {ano} no rótulo vira o ano do valor;
                  cinza: true pinta a coluna no cinza do Budget.
   ════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CD_VISAO VARCHAR(40)    = 'VBM_HEALTH_OF_THE_BUSINESS';
DECLARE @DONO     NVARCHAR(200)  = N'vbm-health-of-the-business';
DECLARE @LAYOUT   NVARCHAR(MAX)  = N'{
  "versao": 1,
  "fcf": {
    "site": 40,
    "tipo": 2,
    "anoInicial": 2025
  },
  "ebitdaPonte": {
    "site": 40,
    "tipo": 3,
    "anoInicial": 2025
  },
  "ebitda": {
    "idDash": 16,
    "idKpi": 73,
    "sites": {
      "vbm": [
        40
      ],
      "cu": [
        38
      ],
      "ni": [
        39
      ]
    },
    "outros": {
      "idOperacao": 11,
      "kpis": [
        45,
        102,
        46
      ],
      "sites": []
    }
  },
  "coo": {
    "idDash": 16,
    "sites": {
      "vbm": 40,
      "cu": 38,
      "ni": 39
    },
    "kpis": {
      "vbm.capex": null,
      "cu.prod": null,
      "cu.sales": null,
      "cu.ebitda": 73,
      "cu.capex": null,
      "cu.fcf": null,
      "cu.sus": null,
      "cu.cost": null,
      "cu.byp": null,
      "ni.prod": null,
      "ni.sales": null,
      "ni.ebitda": 73,
      "ni.capex": null,
      "ni.fcf": null,
      "ni.sus": null,
      "ni.cost": null,
      "ni.byp": null
    }
  },
  "bus": {
    "vbm": {
      "sites": []
    },
    "cu": {
      "sites": []
    },
    "ni": {
      "sites": []
    }
  },
  "indicadores": {
    "vbm": {
      "ebitdaCu": [
        "EBITDA Copper"
      ],
      "ebitdaNi": [
        "EBITDA Nickel"
      ],
      "ebitdaOut": [
        "EBITDA Others",
        "EBITDA Other Segments"
      ],
      "capex": [
        "CAPEX"
      ]
    },
    "cu": {
      "prod": [
        "Production"
      ],
      "sales": [
        "Sales"
      ],
      "ebitda": [
        "EBITDA"
      ],
      "capex": [
        "CAPEX"
      ],
      "fcf": [
        "FCF",
        "Free Cash Flow"
      ],
      "sus": [
        "All-in | Sustaining",
        "Sustaining"
      ],
      "cost": [
        "All-in | Cost",
        "Cost"
      ],
      "byp": [
        "All-in | By Product",
        "By Product"
      ]
    },
    "ni": {
      "prod": [
        "Production"
      ],
      "sales": [
        "Sales"
      ],
      "ebitda": [
        "EBITDA"
      ],
      "capex": [
        "CAPEX"
      ],
      "fcf": [
        "FCF",
        "Free Cash Flow"
      ],
      "sus": [
        "All-in | Sustaining",
        "Sustaining"
      ],
      "cost": [
        "All-in | Cost",
        "Cost"
      ],
      "byp": [
        "All-in | By Product",
        "By Product"
      ]
    }
  },
  "pontes": {
    "ebitdaYear": [
      {
        "lbl": "FY M-1 (Act/Fcst)",
        "tipo": "tot",
        "kpi": [
          "EBITDA FY M-1"
        ]
      },
      {
        "lbl": "FX impact",
        "tipo": "d",
        "kpi": [
          "EBITDA Bridge | FX impact"
        ]
      },
      {
        "lbl": "Price",
        "tipo": "d",
        "kpi": [
          "EBITDA Bridge | Price"
        ]
      },
      {
        "lbl": "Volume",
        "tipo": "d",
        "kpi": [
          "EBITDA Bridge | Volume"
        ]
      },
      {
        "lbl": "Unit COGS",
        "tipo": "d",
        "kpi": [
          "EBITDA Bridge | Unit COGS"
        ]
      },
      {
        "lbl": "Other",
        "tipo": "d",
        "kpi": [
          "EBITDA Bridge | Other"
        ]
      },
      {
        "lbl": "FY Act/Fcst",
        "tipo": "sub"
      },
      {
        "tipo": "zero"
      },
      {
        "lbl": "Copper",
        "tipo": "d",
        "kpi": [
          "EBITDA Copper"
        ]
      },
      {
        "lbl": "Nickel",
        "tipo": "d",
        "kpi": [
          "EBITDA Nickel"
        ]
      },
      {
        "lbl": "Other Seg.",
        "tipo": "d",
        "kpi": [
          "EBITDA Others",
          "EBITDA Other Segments"
        ]
      },
      {
        "lbl": "Non-Alloc.",
        "tipo": "d",
        "kpi": [
          "EBITDA Non-Allocated"
        ]
      }
    ],
    "fcfYear": [
      {
        "lbl": "{ano} Net Debt",
        "tipo": "tot",
        "kpi": [
          "Net Debt"
        ],
        "ano": -1
      },
      {
        "lbl": "EBITDA",
        "tipo": "tot",
        "kpi": [
          "EBITDA"
        ]
      },
      {
        "lbl": "Streaming & Wheaton Bonus",
        "tipo": "d",
        "kpi": [
          "FCF Bridge | Streaming & Wheaton Bonus"
        ]
      },
      {
        "lbl": "ARO, PTVI, Energy",
        "tipo": "d",
        "kpi": [
          "FCF Bridge | ARO, PTVI, Energy"
        ]
      },
      {
        "lbl": "Working Capital",
        "tipo": "d",
        "kpi": [
          "FCF Bridge | Working Capital"
        ]
      },
      {
        "lbl": "Gross Operational Cash Flow",
        "tipo": "sub",
        "cinza": true
      },
      {
        "lbl": "Investments",
        "tipo": "d",
        "kpi": [
          "FCF Bridge | Investments"
        ]
      },
      {
        "lbl": "Income Tax",
        "tipo": "d",
        "kpi": [
          "FCF Bridge | Income Tax"
        ]
      },
      {
        "lbl": "Financial Expenses / Income",
        "tipo": "d",
        "kpi": [
          "FCF Bridge | Financial Expenses / Income"
        ]
      },
      {
        "lbl": "Others",
        "tipo": "d",
        "kpi": [
          "FCF Bridge | Others"
        ]
      },
      {
        "lbl": "Free Cash Flow",
        "tipo": "sub",
        "cinza": true
      },
      {
        "lbl": "Debt Adjustments (accrued interest, FX variation)",
        "tipo": "tot",
        "kpi": [
          "FCF Bridge | Debt Adjustments"
        ],
        "cinza": true
      },
      {
        "lbl": "{ano}B Net Debt",
        "tipo": "ref",
        "kpi": [
          "Net Debt"
        ],
        "serie": "B",
        "cinza": true
      },
      {
        "lbl": "{ano}F Net Debt",
        "tipo": "tot",
        "kpi": [
          "Net Debt"
        ]
      }
    ]
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
    (N'VBM Health of the Business - Configuração', N'Configuração da tela do Health of the Business (não é um dashboard do Studio)',
     @CD_VISAO, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1), @LAYOUT, 'N', @DONO, @DONO);

SELECT ID_DASHBOARD, NM_DASHBOARD, CD_VISAO, SG_ATIVO, DT_ATUALIZACAO
FROM IBP.PHUB_PS_SETUP WHERE CD_VISAO = @CD_VISAO;

/* Permissão do login do app do Portal (só leitura):
GRANT SELECT ON IBP.PHUB_PS_SETUP TO [<usuario-do-app>];
*/
