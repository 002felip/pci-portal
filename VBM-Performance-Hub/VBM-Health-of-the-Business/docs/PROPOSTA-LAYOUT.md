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
| `database/002_hob_waterfall.sql` | Pontes: `IBP.WATERFALL` do site 40 desde 2025 — tipo 2 = FCF YEAR, tipo 3 = 2026 EBITDA YEAR (`@site`, `@tipo`, `@anoIni`) |
| `database/004_hob_ebitda.sql` | Um KPI da carga do COO em `IBP.PHUB_PERFORMANCESTUDIO` (`@idDash` 15, `@idKpi`, `@dtRef`): EBITDA (73) e as séries de `coo.kpis` (rotas `api/ebitda` e `api/coo`) |
| `database/003_carga_mensal_hob.sql` | Carga mensal em `IBP.PHUB_PERFORMANCESTUDIO`, `ID_DASH` 16: a query do time de dados (`IBP.PEDRAVISAO*`, blocos MONTH, QUARTER, YTD, YTG e YEAR) no mesmo `DELETE`/`INSERT`/`GROUP BY` do COO, com os campos `ID_TIPO_VISAO_VBM`, `CD_PERIODO`, `ORDEM_VISAO` (1 a 5), `ORDEM_ANO` e `ORDEM_PERIODO` |
| `database/003b_conferencia_carga_hob.sql` | A mesma consulta da carga, só leitura (sem gravar): mostra as linhas e os campos que o `003` gravaria |
| `database/006_cd_periodo_ytg.sql` | Uma vez só: a regra de `CD_PERIODO` da tabela passa a aceitar `YTG` |
| `database/007_status_atualizacao_hob.sql` | Depois da carga (como o `004` do COO): grava `SG_STATUS` (S/N) e `DT_ATUALIZACAO` de cada KPI pelo `IBP.LOG_PEDRAVISAOCONSOLIDADA`; a tela mostra "Pending final updates" (rota `api/atualizacao`) |
| `database/008_verificacao_atualizacao_hob.sql` | Só leitura: o que está atualizado por KPI (log, último mês de cada tabela de origem, YTD repetido, YTG ausente) |
| `database/005_config_hob.sql` | Configuração da tela em `IBP.PHUB_PS_SETUP` (`CD_VISAO 'VBM_HEALTH_OF_THE_BUSINESS'`): sites de cada BU, KPI de cada gráfico, degraus das pontes e origem do FCF |
| `server.js`, `package.json` | App independente (desenvolvimento), igual ao do COO |
| `tests/hob-api.test.js` | `npm test`: banco simulado, sem rede |

Variáveis (no `app.yaml` do Portal):

| Variável | Uso |
|---|---|
| `HOB_ID_DASH` | Opcional: `IBP.DASHBOARD.ID_DASH` do Health of the Business (padrão 16) |
| `HOB_CACHE_TTL_S`, `HOB_FRESCO_S`, `HOB_DESATUALIZADO_MAX_S` | Opcionais, mesmos padrões do COO (300 s, 15 s, 2 h) |
| `HOB_DIAGNOSTICO=1` | Liga `api/waterfall?bruto=1` (colunas e linhas de `IBP.WATERFALL` como vieram) |

**Já vem do banco** (sincronizado com os filtros Ano e Mês):

| Gráfico | Fonte |
|---|---|
| EBITDA (US$, seletor VBM, Copper, Nickel, Others) | `IBP.PHUB_PERFORMANCESTUDIO`, carga do Health of the Business (`ID_DASH` 16), mês a mês: `ID_KPI` 73, um negócio por vez pelo seletor: VBM = site 40, Copper = site 38, Nickel = site 39 (barras B × A|F); Others = soma do `ID_KPI` 73 dos sites 45 + 102 + 46, operação 11 (`database/004_hob_ebitda.sql`) |
| 2026 EBITDA YEAR | `IBP.WATERFALL`, `ID_SITE` 40, `ID_TIPO` 3, desde 2025 (`database/002_hob_waterfall.sql`) |
| FCF YEAR | `IBP.WATERFALL`, `ID_SITE` 40, `ID_TIPO` 2, desde 2025 |
| Copper e Nickel: EBITDA | Mesma carga (`ID_DASH` 16), `ID_KPI` 73, site 38 (Copper) e 39 (Nickel) |
| Demais gráficos (Capex do consolidado; Production, Sales, All-In, Capex e FCF de Copper e Nickel) | Mesma carga (`ID_DASH` 16), assim que o `ID_KPI` de cada um for definido em `coo.kpis` (`005_config_hob.sql`); até lá, demonstração |

Nas pontes, a tela mostra a referência (`DT_REF`) mais recente do Ano escolhido até o Mês escolhido, e o título indica qual (ex.: "ref. Sep/2026"). No EBITDA, o ciclo é o mais recente da carga do COO (ou o da tela, quando existe nos dois). No Portal esses gráficos nunca usam a demonstração: sem dado, o card mostra o motivo (coluna inexistente, tabela não encontrada, sem permissão, sem referência até o mês, sem carga do COO, API não publicada…). Rótulo, valor e ordem das pontes saem das colunas de `IBP.WATERFALL` (padrão de nomes do IBP: `DS_`/`NM_`, `VL_`, `ORDEM`); tipo e cinza de cada degrau, da configuração; subtotais calculados pela tela.

**Conferir no Portal:** `…/VBM-Health-of-the-Business/api/waterfall/estrutura` (FCF YEAR) e `…/api/waterfall/estrutura?ponte=ebitdaYear` (EBITDA YEAR) mostram as colunas, como a API as entendeu e as referências encontradas — sem os valores.

**Para o restante vir do banco:**
1. Agendar `003_carga_mensal_hob.sql` e, logo depois, `007_status_atualizacao_hob.sql` no Data Factory, como a carga do COO (grava o ciclo do mês para o `ID_DASH` 16 e a situação de atualização).
2. Conferir que os nomes dos KPIs do `ID_DASH` 16 em `IBP.DASHBOARD.NM_KPIS_DASH` batem com `indicadores` do `005_config_hob.sql` (ou ajustar o JSON) e rodar o `005` com os sites de cada BU em `bus`.
3. Redeploy do Portal. KPI esperado que não estiver no cadastro aparece no card como "KPI … não encontrado no cadastro".

Enquanto não houver carga, a página usa a demonstração com o selo "Dados demo · FCF YEAR do banco".

## Pendências

1. **Carga mensal**: agendar `003_carga_mensal_hob.sql` (pronto, `ID_DASH` 16) e conferir os nomes dos KPIs em `indicadores`.
2. Conferir as colunas de `IBP.WATERFALL` no Portal (`api/waterfall/estrutura`).
3. Validar com a área de negócio o nome e a ordem das categorias das pontes (EBITDA e FCF).
