# Tokens

Arquivo: `assets/vbm-tokens.css`. Valores do tema claro / escuro.

## Marca (VBM Kaizen)

| Token | Valor | Uso |
|---|---|---|
| `--vbm-blue` | #3CB5E5 | Azul-Vale: série realizada, destaque, sublinhado do título |
| `--vbm-blue-dark` | #1A8BBF | hover/realce sobre azul |
| `--vbm-blue-deep` | #0D2640 | fundos escuros, bordas de controle |
| `--vbm-blue-navy` | #041523 | barra superior (gradiente `--nav-bg`) |
| `--vbm-blue-light` / `--vbm-blue-pale` | #7DD3F0 / #E8F7FD | foco no escuro / fundos suaves |
| `--vbm-green` | #007E7A | Verde-Vale |
| `--vbm-grey` | #BCBEC0 | Cinza-Médio (Budget) |
| `--vbm-steel` | #6E8CBA | Azul-Aço (Plan) |
| `--status-*` | draft #888, pending #C2770E, approved #16A34A, rejected #DC2626, review #3CB5E5 | fluxo de aprovação (Kaizen) |

## Tela (COO)

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--page` | #FFFFFF | #06192B | fundo da página |
| `--text` / `--text-soft` / `--text-faint` | #1F2937 / #6B7280 / #9CA3AF | #E8EEF5 / 66% / 42% | texto principal / secundário / apoio |
| `--line` | #E5E7EB | branco 10% | divisórias |
| `--panel` | #F3F4F5 | #0C2438 | fundo de painel e card |
| `--accent` | #1E8FC4 | #5CC6EE | **só texto ≥ 24px** (títulos editoriais) |
| `--accent-strong` | #0B6E99 | #7DD3F0 | links, ícones de ação, texto de destaque pequeno |
| `--chart-title` | #1B7F7B | #5FD0C9 | título do gráfico |
| `--ink-strong` / `--ink-soft` | #111827 / #6B7280 | #F1F5F9 / 62% | valores / eixos |
| `--ctl-bg` / `--ctl-border` / `--ctl-text` | branco / navy 16% / #1F2937 | branco 5% / branco 16% / #E5EDF5 | controles |
| `--ctl-on-bg` / `--ctl-on-text` | #0B6E99 / branco | #3CB5E5 / #02101C | controle ligado / selecionado |
| `--focus` | #0B6E99 | #7DD3F0 | contorno de foco |
| `--nav-bg` | gradiente navy | — | barra superior |
| `--table-head` | #0B6E99 | #11577A | cabeçalho de tabela |
| `--font-display` / `--font-ui` | Poppins, Segoe UI, system-ui | — | títulos / controles |

## Dados

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--serie-b` | #BCBEC0 | #8E949B | Budget |
| `--serie-p` | #9DB1CF | #9DB1CF | Plan (no Studio: #6E8CBA) |
| `--serie-a` | #3CB5E5 | — | Actual / Forecast |
| `--good` / `--good-bg` | #007E7A / 10% | #34C3B8 / 14% | delta favorável |
| `--bad` / `--bad-bg` | #B91C1C / 9% | #F87171 / 14% | delta desfavorável |
| `--flat` / `--flat-bg` | #5B5E61 / 12% | #B0B5BA / 14% | sem variação |
| `--pill-bg` / `--pill-line` | branco / navy 6% | #0F2C44 / branco 10% | pílula do delta |
| `--d-stroke` / `--d-hair` | cinza 45% / 30% | claro 45% / 28% | linhas da cota do delta |
| `--wait` / `--wait-bg` / `--wait-line` | #9A5B00 / âmbar 10% / 55% | #F5B94A / 12% / 55% | **ciclo / atualização pendente** |
| `--late` / `--late-bg` | branco / #B76A00 | #1C1203 / #F5B94A | atraso (selo cheio) |

## Divergências conhecidas (decida antes de unificar)

- **Plan**: `--serie-p` #9DB1CF (COO) × #6E8CBA (Studio, `DEFAULT_SERIES_COLORS.P`).
- **Delta desfavorável**: COO `--bad` #B91C1C × Studio `.is-down` traço #DC2626 com texto #B91C1C
  (o texto usa #B91C1C nos dois: contraste AA).
- **Título do dashboard**: Studio usa texto branco 88% sobre fundo escuro e `#0B3A50` no claro.
