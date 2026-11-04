# VBM Health of the Business: proposta de layout

Endereço: `/VBM-Performance-Hub/VBM-Health-of-the-Business/` (já listado em `APLICACOES` do Hub).

## Base

- Topo: skill **setup-dashboards** (logo Vale, nome ao centro, engrenagem com tema, idioma e formato numérico, usuário logado).
- Cabeçalho e filtros: padrão do **COO-Business-Units-Dashboard**. O drill-down País › Site virou **Business Units**: `VBM` · `Copper Business` · `Nickel Business`, seguido de **Year**, **Quarter** e **Month**. O Month mostra os três meses do trimestre escolhido.
- Cores: Budget | Adjusted Budget (B) em cinza e Forecast | Actual (F | A) em azul. Nas pontes, verde significa ganho e vermelho perda.
- Recortes das barras, como no PDF: `Mês B/A · Q B/A · YTD B/A · YTG B/F · AA B/F`.
- Os filtros e as escolhas dos seletores ficam na URL (`?bu=cu&ano=2026&mes=9&allin=cost`), então o link pode ser compartilhado.

## Vale Base Metals | Consolidated View

Os gráficos usam o mesmo modelo do COO: barras em degradê, valores acima das barras, fontes e tamanhos do COO e cota de diferença com o interruptor **Delta** (ligado ou desligado) nos filtros.

| Antes (PDF) | Proposta |
|---|---|
| EBITDA (US$ bn): Copper + Nickel empilhados, com tabela de Other Segment | Barras B × A\|F com Delta e **seletor no card** (mesma estratégia do All-in do COO): `VBM` · `Copper` · `Nickel` · `Others`. **Sem tabela**: o seletor escolhe o que o gráfico mostra |
| Catalyst Savings 2025F (US$ M) | **Descontinuado (removido)** |
| Capex \| S Curve na metade esquerda | **Largura toda** (12 meses + 26B/26F com Delta). O espaço do Catalyst e da tabela foi redistribuído assim |
| 2026 EBITDA YEAR (ponte) | Mantido, ao lado do EBITDA, na 1ª linha |
| FCF YEAR (ponte) | Mantido, na largura toda, embaixo |

```
┌──────────────────────────┬──────────────────────────┐
│ EBITDA (US$ bn)          │ 2026 EBITDA YEAR (ponte) │
│ [VBM|Copper|Nickel|Oth.] │                          │
├──────────────────────────┴──────────────────────────┤
│ Capex | S Curve (meses + 26B/26F)                   │
├─────────────────────────────────────────────────────┤
│ FCF YEAR (ponte)                                    │
└─────────────────────────────────────────────────────┘
```


## Copper Business / Nickel Business

As duas telas têm o mesmo molde e só muda o produto. Os dados vêm do filtro Business Units.

```
┌──────────────────────────┬──────────────────────────┐
│ Production (Kt)          │ EBITDA (US$ M)           │
├──────────────────────────┼──────────────────────────┤
│ Sales (Kt)               │ Capex | S Curve          │
├──────────────────────────┼──────────────────────────┤
│ All-In (AISC) (US$ k/t)  │ FCF (US$ M) acumulado    │
│ [All-in|Sust.|Cost|ByP]  │                          │
│ + tabela (linha ativa)   │                          │
└──────────────────────────┴──────────────────────────┘
```

- **Copper — All-In (AISC):** usa a mesma estratégia do All-in do COO. Um seletor no card troca a visão entre `All-in` · `Sustaining` · `Cost` · `By Product`. Não tem tabela.
- **Nickel — All-In (AISC):** proposta para avaliação. Não tem seletor: é um gráfico empilhado, como o slide do PDF, com By Products abaixo do zero e Sustaining + Cap. Replac. e Costs acima. O total (All-in) aparece em cima de cada coluna, e todo segmento mostra o valor, mesmo quando é 0: dentro do segmento quando cabe, senão ao lado da coluna. O Delta é calculado sobre o All-in e segue o interruptor.

Filtro Business Units: `VBM` · `Copper` · `Nickel`.

## Dados do banco

Mesma estrutura dos demais dashboards do Hub (COO e COO Historical):

| Arquivo | Papel |
|---|---|
| `portal.js` | Monta a página e a API em `/VBM-Performance-Hub/VBM-Health-of-the-Business/`, com pool próprio no Azure SQL PRD (variáveis `PERFORMANCEHUB_SQL_*`, como o COO) |
| `hob-api.js` | Rotas `api/ping`, `api/health`, `api/ciclos`, `api/config`, `api/indicadores?ciclo=` e `api/waterfall`. Mesmo cache, refresh (`?fresco=1`), tolerância a banco fora e limite por usuário do COO |
| `database/001_hob_dashboard.sql` | Leitura de uma carga (`DT_REF`) em `IBP.PHUB_PERFORMANCESTUDIO` + cadastro em `IBP.DASHBOARD` (`@idDash`, `@dtRef`) |
| `database/002_hob_waterfall.sql` | FCF YEAR: `IBP.WATERFALL` do site 40, tipo 2, desde 2025 (`@site`, `@tipo`, `@anoIni`) |
| `database/003_carga_mensal_hob.sql` | Carga mensal em `IBP.PHUB_PERFORMANCESTUDIO` (mesmo `DELETE`/`INSERT` do COO). **Pendente:** a consulta de origem |
| `database/005_config_hob.sql` | Configuração da tela em `IBP.PHUB_PS_SETUP` (`CD_VISAO 'VBM_HEALTH_OF_THE_BUSINESS'`): sites de cada BU, KPI de cada gráfico, degraus das pontes e origem do FCF |
| `server.js`, `package.json` | App independente (desenvolvimento), igual ao do COO |
| `tests/hob-api.test.js` | `npm test`: banco simulado, sem rede |

Variáveis (no `app.yaml` do Portal):

| Variável | Uso |
|---|---|
| `HOB_ID_DASH` | `IBP.DASHBOARD.ID_DASH` do Health of the Business. Sem ela, só o FCF YEAR vem do banco |
| `HOB_CACHE_TTL_S`, `HOB_FRESCO_S`, `HOB_DESATUALIZADO_MAX_S` | Opcionais, mesmos padrões do COO (300 s, 15 s, 2 h) |
| `HOB_DIAGNOSTICO=1` | Liga `api/waterfall?bruto=1` (colunas e linhas de `IBP.WATERFALL` como vieram) |

**Já vem do banco:** FCF YEAR, de `IBP.WATERFALL`. Para cada ano vale a referência mais recente (maior `DT_REF`). Rótulo, valor e ordem saem das colunas da tabela (padrão de nomes do IBP: `DS_`/`NM_`, `VL_`, `ORDEM`). O tipo e o cinza de cada degrau saem da configuração, e os subtotais são calculados pela tela.

**Para o restante vir do banco:**
1. Cadastrar o dashboard e os KPIs em `IBP.DASHBOARD` (novo `ID_DASH`), com os nomes de `005_config_hob.sql` (ou ajustar o JSON).
2. Preencher a consulta de origem em `003_carga_mensal_hob.sql` e o `@ID_DASH`, e agendar no Data Factory como a do COO.
3. Rodar `005_config_hob.sql` (com os sites de cada BU em `bus`).
4. Definir `HOB_ID_DASH` no `app.yaml` e fazer o redeploy.

Enquanto não houver carga, a página usa a demonstração com o selo "Dados demo · FCF YEAR do banco".

## Pendências

1. **Carga mensal**: consulta de origem de `003_carga_mensal_hob.sql` e o `ID_DASH` do dashboard.
2. Conferir as colunas de `IBP.WATERFALL` no Portal (`HOB_DIAGNOSTICO=1` → `api/waterfall?bruto=1`).
3. Validar com a área de negócio o nome e a ordem das categorias das pontes (EBITDA e FCF).
