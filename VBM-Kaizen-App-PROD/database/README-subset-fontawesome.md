# Como regerar o subconjunto do Font Awesome

As telas usam `css/fontawesome-subset.css` + `assets/fonts/<hash>_fa-solid-900-subset.woff2`,
que contêm **apenas os ícones referenciados pelo projeto** — 69 dos 2.482 do
pacote completo. Isso tirou 96 KB de CSS e 146 KB de fonte de cada
navegação.

O pacote completo continua no repositório em
`css/vendor/e5e202e3c8995079_all.min.css` e
`assets/fonts/1f0189e087fcefbf_fa-solid-900.woff2`. **Os dois ficam FORA do
deploy** — servem só de origem para regerar o subconjunto.

## Quando regerar

Sempre que uma tela passar a usar um ícone que ainda não estava no
subconjunto. O sintoma é um quadradinho vazio no lugar do ícone.

## Passo a passo

Requer `pyftsubset` (pacote `fonttools`).

1. Levantar os ícones usados hoje:

       grep -rhoE '\bfa-[a-z0-9-]+\b' *.html js/*.js css/vbm-app.css \
         | sort -u > /tmp/classes.txt

   Descarte da lista os modificadores (`fa-solid`, `fa-fw`, `fa-spin`,
   `fa-lg`, `fa-2x`, …) — só os NOMES de ícone entram.

2. Para cada nome, pegar o codepoint no CSS completo, no formato
   `.fa-nome:before{content:"\fXXX"}`, e montar a lista de `U+XXXX`.

3. Gerar a fonte:

       pyftsubset assets/fonts/1f0189e087fcefbf_fa-solid-900.woff2 \
         --unicodes=U+f015,U+f002,... \
         --flavor=woff2 --layout-features='' --no-hinting --desubroutinize \
         --output-file=assets/fonts/<novo-hash>_fa-solid-900-subset.woff2

4. Atualizar `css/fontawesome-subset.css`: o `src:` do `@font-face` com o
   novo nome de arquivo e uma linha `.fa-nome::before{content:"\fXXX"}`
   por ícone.

5. Subir a versão na query das páginas
   (`css/fontawesome-subset.css?v=AAAAMMDD-N`) para o navegador buscar a
   folha nova — ela é servida com cache imutável.

## Licença

Font Awesome Free 6 — CC BY 4.0 (ícones), SIL OFL 1.1 (fontes), MIT
(código). https://fontawesome.com/license/free
