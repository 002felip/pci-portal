# Acessibilidade e idioma

## Acessibilidade

- **Contraste AA**: texto normal ≥ 4,5:1; texto ≥ 24px (ou ≥ 18,66px negrito) e ícones ≥ 3:1.
  `--accent` só em texto grande; texto de delta usa a cor de texto AA (#007E7A / #B91C1C).
- **Foco**: `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }`. Não remova.
- **Alvos** ≥ 32px de altura em controles principais (26px dentro de segmentados).
- **Estados por aria**: `aria-pressed` (segmentado), `role="switch"` + `aria-checked`
  (interruptor), `aria-expanded` (popover), `aria-current` (item atual), `aria-selected` (lista).
- **Nada só por cor**: pendência com ícone + texto; delta com sinal (+/−); seleção com borda e rótulo.
- **Avisos**: `role="status" aria-live="polite"`; função `announce()` para leitores de tela.
- **Movimento**: animações curtas (≤ 1 s) e sem piscar; respeite `prefers-reduced-motion` em
  animações novas.

## Idioma (setup-dashboards)

- Textos fixos com `data-i18n="chave"` (e `data-i18n-aria`, `data-i18n-title`, `data-i18n-ph`).
- Registre e aplique:
  ```js
  VBMSetup.registrar({ 'pt-BR': { 'f.ano': 'Ano:' }, en: { 'f.ano': 'Year:' } });
  VBMSetup.traduzir();
  ```
- Rótulos de dados (meses, séries, períodos: `OctA 26`, `Q4F 26`) ficam em inglês nos dois idiomas,
  como nas cargas.
- Formato numérico pela engrenagem (`pt-BR` 1.234,5 / `en-CA` 1,234.5); `font-variant-numeric:
  tabular-nums` em valores.
- Nome de arquivo baixado sem acento (alguns navegadores trocam o nome por "download").
