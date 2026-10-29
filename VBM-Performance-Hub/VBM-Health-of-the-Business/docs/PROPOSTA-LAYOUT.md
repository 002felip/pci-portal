# VBM Health of the Business: proposta de layout

Endereço: `/VBM-Performance-Hub/VBM-Health-of-the-Business/` (já listado em `APLICACOES` do Hub).

## Base

- Topo: skill **setup-dashboards** (logo Vale, nome ao centro, engrenagem com tema, idioma e formato numérico, usuário logado).
- Cabeçalho e filtros: padrão do **COO-Business-Units-Dashboard**. O drill-down País › Site virou **Business Units**: `VBM` · `Copper Business` · `Nickel Business`, seguido de **Year**, **Quarter** e **Month**. O Month mostra os três meses do trimestre escolhido.
- Cores: Budget | Adjusted Budget (B) em cinza e Forecast | Actual (F | A) em azul. Nas pontes, verde significa ganho e vermelho perda.
- Recortes das barras, como no PDF: `Mês B/A · Q B/A · YTD B/A · YTG B/F · AA B/F`.
- Os filtros e as escolhas dos seletores ficam na URL (`?bu=cu&ano=2026&mes=9&allin=cost`), então o link pode ser compartilhado.

## Vale Base Metals | Consolidated View

| Antes (PDF) | Proposta |
|---|---|
| EBITDA (US$ bn): só Copper + Nickel empilhados | **Seletor no card** no padrão do All-in do COO: `VBM` (Copper + Nickel empilhados, com a tabela de Other Segment) · `Copper` · `Nickel` · `Others` |
| Catalyst Savings 2025F (US$ M) | **Descontinuado (removido)** |
| Capex \| S Curve na coluna esquerda | Sobe para a **coluna direita, no lugar do Catalyst**, abaixo da ponte do EBITDA |
| — | O **EBITDA passa a ocupar a altura das duas linhas** na coluna esquerda e ganha espaço para o seletor e a tabela |
| 2026 EBITDA YEAR (ponte) | Mantido, à direita no alto |
| FCF YEAR (ponte) | Mantido, na largura toda, embaixo |

```
┌──────────────────────────┬──────────────────────────┐
│ EBITDA (US$ bn)          │ 2026 EBITDA YEAR (ponte) │
│ [VBM|Copper|Nickel|Oth.] ├──────────────────────────┤
│ + tabela Other Segment   │ Capex | S Curve          │
├──────────────────────────┴──────────────────────────┤
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

O **All-In (AISC)** usa a mesma estratégia do All-in do COO. Um seletor no card troca a visão entre `All-in` · `Sustaining` · `Cost` · `By Product`, e a linha escolhida fica destacada na tabela abaixo do gráfico.

## Pendências

1. **Dados**: hoje a tela usa `assets/hob-data.js`, com valores ilustrativos e o selo "Demo data". Para ligar ao banco, crie a API em `portal.js` (molde do `coo-api.js`) devolvendo o mesmo formato descrito no topo do arquivo.
2. Validar com a área de negócio o nome e a ordem das categorias das pontes (EBITDA e FCF).
3. Confirmar se o seletor do EBITDA deve ter a opção `Non-Alloc.`.
