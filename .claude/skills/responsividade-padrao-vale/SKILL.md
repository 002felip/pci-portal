---
name: responsividade-padrao-vale
description: Ajusta a responsividade do VBM AIP Goals (VBM-Aip-Goals/index.html) para notebook com escala 125–150%, desktop e 4K. Use quando o pedido citar AIP Goals e tamanho de tela, telas menores/maiores ou responsividade.
---

# Responsividade padrão Vale — AIP Goals

Exclusiva da aplicação **VBM-Aip-Goals** (`/VBM-Aip-Goals/`, página única `VBM-Aip-Goals/index.html`).
Para as outras telas do Portal vale a skill geral `ajuste-responsividade`: as regras daqui não se aplicam a elas,
e as de lá não devem ser copiadas para cá sem passar por esta skill.

Objetivo: a aplicação cabe e respira em qualquer tela **de 1024 px a 4K**, sem mudar o design (cores, componentes e
disposição ficam iguais; mudam tamanhos e espaços). **Celular está fora do escopo.**

## Como o AIP é construído (e por que isso muda a técnica)

- **Tudo é em `rem`.** A raiz é fluida e é ela que escala a aplicação inteira:
  `html { font-size: clamp(1rem, 0.357vw + 0.643rem, 1.5rem) }`, ou seja, 16 px até 1600 px de largura e 24 px em 3840 px.
  Para mudar o tamanho de **todas as telas** de uma vez, mexa na raiz dentro de uma media query, **sempre em `rem`**
  (ex.: `0.9375rem`), nunca em `px`, para o zoom do navegador seguir valendo (WCAG 1.4.4).
- **Barra superior** com altura fluida pelo token `--barra` (`clamp(3.5rem, 2.6rem + 1.1vw, 5.5rem)`). Não use 56/64 px fixos.
- **Os CSS copiados das skills `vbm-design` e `setup-dashboards` não são editados.** O que eles fixam em px é
  sobrescrito na camada `[RESPONSIVO]`, no fim do `<style>`.
- **Uma vista por hash**, todas no mesmo arquivo: `#inicio` (`#vistaInicio`), `#pendencias` (`#vistaPendencias`),
  `#painel` (`#vistaPainel`) e as telas em construção (`#metas`, `#goal-card`, `#action-log`, `#acoes`,
  `#configuracao`, em `#vistaConstrucao`). **Todo ajuste vale para todas as vistas** — confira todas.

## Faixas usadas no AIP

| Faixa | Media query | O que acontece |
|---|---|---|
| Estrutural | `max-width: 1080px` | menu vira gaveta sob a barra; banner (`.hero`) e abertura (`.abertura`) em uma coluna |
| Painel em uma coluna | `max-width: 1280px` | `.p2-grade` em coluna; funil e tempo lado a lado abaixo da matriz |
| Largura média | `max-width: 1440px, max-height: 820px` | itens do menu e padding do banner um degrau menores |
| **Notebook 125–150%** | `(min-width: 721px) and (max-height: 820px)` | raiz em `0.9375rem` (15 px) e banner/abertura compactos (`.ab-ano`, `.ab-nome`, `.indice-desc` oculta, anéis do Painel em `--anel: 6rem`) |
| Telas grandes | raiz fluida | de 1600 a 3840 px a raiz cresce sozinha até 24 px; não crie degraus fixos por cima sem medir |

Referência do notebook corporativo: Windows em 150% numa tela 1920×1080 dá **~1270×590 úteis** no navegador. A
tela inicial tem de caber inteira nesse tamanho (título, índice "Go to" e a jornada do ciclo), sem rolar.

## Regras

- **Comece pela raiz.** "Está tudo grande/pequeno" num tamanho de tela → ajuste `html { font-size }` na faixa
  certa. Só depois afine componentes (`.ab-ano`, `.hero`, `.p2-trilha`…), se ainda faltar espaço.
- **Regras da T02 precisam de escopo `#vistaPainel`**: as regras base do Painel vêm depois no arquivo e vencem
  uma regra genérica da media query.
- **Cartões da fila são por container query** (`@container fila`, 60rem e 36rem): mexa no container, não na
  viewport.
- **Grids com `minmax(min(Xrem, 100%), …)`** e filhos com `min-width: 0`: nada pode estourar a largura.
- **Vidro com degradação**: sem `backdrop-filter` ou com `prefers-reduced-transparency`, fundo opaco. Não remova.
- **Telas que estão boas não mudam.** Antes de entregar, confira que 1440×900 e 1920×1080 ficaram iguais (raiz em
  16 px) quando o pedido for só para o notebook, e vice-versa.
- Comente cada regra nova com `/* [RESPONSIVO] … */` explicando o tamanho de tela e o motivo.
- Atualize a seção de responsividade de `docs/projetos/aip-goals.md` no mesmo PR.

## Como conferir

1. Suba o standalone com usuário simulado e dados de exemplo (sem o e-mail, as vistas mostram "sem acesso"):

   ```bash
   cd VBM-Aip-Goals
   NODE_ENV=development AIPGOALS_EMAIL_LOCAL=teste@vale.com PORT=8020 node server.js
   ```

2. Tire prints de **todas as vistas** em **1270×587, 1440×900, 1920×1080, 2560×1440 e 3840×2160**, nos temas
   escuro e claro (`localStorage['vdt-theme']`), com o idioma em `localStorage['vdt-lang']`. Para cada print,
   registre `document.documentElement.scrollWidth` (tem de ser igual à largura: sem rolagem lateral) e o
   `font-size` da raiz. O script geral `.claude/skills/ajuste-responsividade/scripts/medir.js` serve para uma URL
   por vez (`http://localhost:8020/#inicio`, `#pendencias`, `#painel`, `#metas`).
3. Critérios:
   - 1270×587: a tela inicial cabe inteira, com a jornada do ciclo visível;
   - nenhuma vista com rolagem lateral em nenhum tamanho;
   - as faixas fora do pedido ficam idênticas às de antes.
4. Rode `npm test` na pasta (`node --test tests/*.test.js`).

## Histórico

- Nov/2026: no notebook a 150% (~1270×590) a jornada da tela inicial saía cortada → raiz em `0.9375rem` na faixa
  `(min-width: 721px) and (max-height: 820px)`; 1440×900 para cima não mudou (PR #95).
