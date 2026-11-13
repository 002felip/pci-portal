---
name: vbm-design
description: Design system das telas VBM do Portal PCI — tokens de cor claro/escuro (marca do VBM Kaizen + semânticos do COO Dashboard), tipografia Poppins local, título do dashboard, botões de ação do topo, filtros no padrão COO (rótulo em itálico, segmentado, interruptor, seletor País › Site), painéis, cards, legenda, pílula de situação, toast, acessibilidade e idioma. Use SEMPRE que for criar ou ajustar o visual de uma tela, dashboard ou componente do Portal (Performance Hub, COO, Studio, Kaizen, Health of the Business, Stable & Capable), ou quando o pedido citar "padrão VBM", "design system", "cores", "tema escuro", "tema claro", "token", "fonte", "Poppins", "filtro", "card", "botão", "igual ao COO", "igual ao Kaizen" ou "identidade visual".
---

# VBM Design (tokens e componentes)

Uma tela VBM = barra superior da skill **`setup-dashboards`** + tokens e componentes desta
skill. Os blocos de `assets/` são a fonte: copie, não reescreva.

| Arquivo | Para quê |
|---|---|
| `assets/vbm-tokens.css` | `:root` (claro), `prefers-color-scheme` e `:root[data-theme="dark"]` (escuro); marca, semânticos, séries, status e âmbar de ciclo |
| `assets/vbm-componentes.css` | título do dashboard, botões de ação, filtros (`.filters`, `.seg`, `.switch`, `.unit`), painéis, cards, legenda, pílula de situação, toast |
| `assets/exemplo.html` | tela mínima com tudo aplicado (abrir no navegador para conferir claro/escuro) |
| `references/tokens.md` | tabela de tokens, origem, uso e contraste |
| `references/componentes.md` | anatomia e marcação de cada componente |
| `references/acessibilidade-i18n.md` | foco, aria, contraste, idioma e formato numérico |

Referências vivas no repositório: `VBM-Performance-Hub/COO-Business-Units-Dashboard/index.html`
(tokens e filtros), `VBM-Kaizen-App-PROD/css/vbm-app.css` (marca) e
`VBM-Performance-Hub/VBM-Performance-Studio/index.html` (título, ações, toast).

## Regras

1. **Toda cor sai de um token.** Nada de hex solto na tela; se faltar, crie o token com o par
   escuro em `:root[data-theme="dark"]` e no bloco `prefers-color-scheme`.
2. **Tema na engrenagem** (`setup-dashboards` grava `data-theme`/`data-bg` no `<html>`). Não crie
   botão de tema próprio.
3. **Poppins local** (`VBM-Performance-Hub/assets/css/poppins.css`, faces embutidas). Nada de
   Google Fonts nem CDN: em rede corporativa fechada o carregamento travava.
4. **Ícones** pelo Font Awesome já servido pelo app (subset local), nunca por CDN novo.
5. **`--accent` (#1E8FC4) só em texto ≥ 24px** (3,9:1). Texto menor: `--accent-strong` (#0B6E99).
6. **Desempenho = verde/vermelho** (`--good` / `--bad`); **ciclo/atualização = âmbar** (`--wait`).
   Não misture: âmbar nunca indica desempenho.
7. **Nada só por cor**: situação com ícone e texto; seleção com borda e rótulo.
8. **Textos fixos com `data-i18n`** (pt-BR / en) e formato numérico pela engrenagem.
9. **Responsividade** pela skill `ajuste-responsividade` (1366, 1920, 2560/4K, celular).

## Passo a passo

1. Aplique a `setup-dashboards` (barra + engrenagem).
2. Cole `vbm-tokens.css` e `vbm-componentes.css` no `<style>` do `index.html` (ou em
   `assets/css/` da pasta) e o `<link>` do `poppins.css` do Hub.
3. Monte título, ações e filtros com as classes de `references/componentes.md`.
4. Gráficos: séries com `--serie-b` / `--serie-p` / `--serie-a`, deltas com `--good` / `--bad` / `--flat`
   e pendência com `--wait` (referência viva: gráficos do VBM Performance Studio).
5. Confira o checklist.

## Checklist

- [ ] nenhuma cor fora de token; tema escuro conferido (todos os textos legíveis);
- [ ] contraste AA: texto normal ≥ 4,5:1, texto grande e ícones ≥ 3:1;
- [ ] foco visível (`--focus`) em tudo que é clicável; alvos ≥ 32px;
- [ ] `aria-pressed` nos segmentados, `role="switch"` + `aria-checked` no interruptor,
      `aria-expanded` nos popovers, `aria-label`/`title` nos botões só com ícone;
- [ ] avisos em `role="status" aria-live="polite"`;
- [ ] inglês conferido (nenhum texto fixo sem `data-i18n`);
- [ ] sem fonte, ícone ou script de CDN novo.
