---
name: ajuste-responsividade
description: Ajusta a responsividade de uma tela do Portal VBM para telas menores (notebook com escala de 125–150%, tablet, celular) e para telas maiores (1920, 2560, 4K), sem mexer no visual e sem afetar as outras telas. Use SEMPRE que o pedido citar "telas menores", "telas maiores", "tela grande", "monitor grande", "4K", "notebook", "celular", "responsivo", "responsividade", "está muito grande", "está muito pequeno", "sobra espaço", "scroll pro lado", "rolagem lateral", "não cabe na tela" ou "ajuste de tamanho de tela".
---

# Ajuste de responsividade (telas menores e maiores)

Padrão usado no Portal (tela inicial, Performance Hub, COO, Studio, Stable & Capable,
Health of the Business). O objetivo é sempre o mesmo: **a tela cabe e respira em
qualquer tamanho, sem mudar o design** — cores, componentes e disposição continuam os
mesmos; só mudam tamanhos, espaços, alturas e a largura útil.

## Antes de mexer

1. **Meça, não chute.** Rode `scripts/medir.js` na tela (ver abaixo): ele tira os prints
   nos tamanhos de referência e acusa rolagem lateral (`scrollWidth > clientWidth`) e
   o elemento que vaza. Olhe os prints antes de decidir.
2. **Escopo.** Ajuste só a tela pedida. Se o pedido é "só o dashboard", prenda as regras
   na vista dele (ex.: `.pagina:has(#vista-powerbi:not([hidden]))`), não na `.pagina`
   inteira. Telas que o usuário disse que estão boas não podem mudar: confira com o
   mesmo script que elas continuam iguais.
3. **Kaizen, VDT e Cockpit têm layout próprio** e ficam fora desses ajustes, salvo pedido
   explícito.

## Pontos de quebra (os mesmos em todo o Portal)

| Faixa | Media query | O que muda |
|---|---|---|
| Celular | `max-width: 720px` | uma coluna, gutter de 16 px, sem rolagem lateral da página |
| Toque | `pointer: coarse` | alvos de toque com 44 px (botões, segmentados, interruptores) |
| **Telas menores** | `(min-width: 721px) and (max-width: 1440px), (min-width: 721px) and (max-height: 820px)` | barra superior com 56 px (64 nas demais), títulos, cartões, controles e espaços um degrau menores |
| Padrão | — | o layout como foi desenhado (referência 1440×900) |
| **Telas maiores** | `min-width: 1600px` | largura útil maior (`max-width: min(94vw, 2400px)`), gráficos acompanham a altura da janela, textos um degrau acima |
| Muito grandes | `min-width: 2200px` | mais um degrau de texto e respiro |
| 4K a 100% | `min-width: 3000px` | `max-width: min(94vw, 3400px)`, tetos de altura maiores, texto ~1.3× |

"Telas menores" é sobretudo o notebook corporativo com Windows em 125–150%: **~1280×600
úteis**. Por isso o critério também olha a **altura** (≤ 820 px), não só a largura.
As faixas de cima nunca alteram a faixa padrão: quem já está bom em 1440 continua igual.

## Técnicas

### Telas menores
- Reduza por **degraus** dentro da media query de telas menores: título da página,
  cards, paddings, `gap`, fonte de controles. Nada de `transform: scale` nem `zoom`.
- Barra superior da skill `setup-dashboards`: 56 px nessa faixa (já está no CSS da skill).
  Se algum `calc()` ou JS usa `64px` fixo, troque junto.
- Grades de 12 colunas: cards lado a lado viram coluna inteira abaixo de ~960 px
  (`.s4`, `.s8` → `span 12`).

### Sem rolagem lateral em gráficos
- **Não use `min-width` fixo** nem wrapper com `overflow-x: auto` para gráficos de
  barras: o usuário não quer rolar para o lado. O gráfico se ajusta à largura do card.
- Calcule no JS a largura por grupo (`alvo.clientWidth / grupos`) e derive dela:
  - `gap` entre grupos (`clamp` entre 4 e 18 px);
  - fonte do valor ajustada à coluna (`(largColuna) / (caracteres × 0.62)`, teto 10.5 px;
    12 px ≥ 1600; 15 px ≥ 3000) e **esconda o valor** se ficar < 6.5 px (continua na dica / `title`);
  - eixo em **duas linhas** (`Q1<br>2025`) quando o grupo tiver menos de ~58 px.
- Filhos flex precisam de `min-width: 0` para poder encolher. Em layout que vira
  coluna no celular (`flex-direction: column`), use `align-items: stretch`, senão o
  filho mede o conteúdo e vaza a página.

### Telas maiores
- Aumente a largura útil só da tela pedida (ver Escopo) — é o que mais resolve
  "sobra espaço dos lados".
- **Alturas dos gráficos pela altura da janela, com piso e teto**: até 1600 px de largura
  ficam fixas; acima, `carta = clamp(380, 0.36·vh, 520)`, `histograma = clamp(300, 0.28·vh, 420)`
  (tetos 760/600 a partir de 3000 px). Gráficos lado a lado usam a mesma altura útil para os
  cards alinharem (ex.: barras = histograma + 40 px).
- Textos de SVG (`.ex`, rótulos de CL/UCL, pílulas) e de legenda sobem um degrau por faixa.
- Redesenhe no `resize` (com debounce de ~150 ms) **sem a animação de entrada** — senão
  as barras "crescem" de novo a cada redimensionamento.

## Conferir antes de entregar

- Tamanhos: **390×844, 1100×800, 1280×590, 1440×900, 1920×1080, 2560×1440, 3840×2160**;
  tema claro e escuro (`localStorage['vdt-theme']`).
- Nenhum tamanho com rolagem lateral (página e cards).
- As faixas que não eram para mudar (ex.: 1440) ficam idênticas às de antes, assim como as
  outras telas do mesmo app.
- Print de página inteira (`fullPage: true`) **redimensiona a janela** quando a página é mais
  alta que ela: o `resize` redesenha e o print pode sair no meio de uma animação. Para conferir
  barras animadas, use uma janela alta o bastante (ou espere e use `fullPage: false`).

## Script

`scripts/medir.js` (Playwright já instalado no ambiente):

```bash
node .claude/skills/ajuste-responsividade/scripts/medir.js "http://localhost:8018/#powerbi" /caminho/prints
# opcional: TEMA=dark TAMANHOS="1440x900,2560x1440" ESPERA=4000
```

Para cada tamanho, grava `<largura>x<altura>.png` e imprime a largura do documento e os
primeiros elementos que passam da borda direita. Suba o servidor da tela antes (ex.:
Stable & Capable em modo teste com `STABLECAPABLE_EXCEL_TESTE=… PORT=8018 node server.js`).
