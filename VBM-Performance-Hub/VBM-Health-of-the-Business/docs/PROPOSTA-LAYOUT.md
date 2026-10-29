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

Prévia sem servidor: `docs/preview-health-of-the-business.html` (arquivo único, abre direto no navegador).

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

## Pendências

1. **Dados**: hoje a tela usa `assets/hob-data.js`, com valores ilustrativos e o selo "Demo data". Para ligar ao banco, crie a API em `portal.js` (molde do `coo-api.js`) devolvendo o mesmo formato descrito no topo do arquivo.
2. Validar com a área de negócio o nome e a ordem das categorias das pontes (EBITDA e FCF).
3. Confirmar se o seletor do EBITDA deve ter a opção `Non-Alloc.`.
