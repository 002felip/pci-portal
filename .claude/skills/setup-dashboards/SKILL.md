---
name: setup-dashboards
description: Aplica a barra superior e o painel de Configurações padrão dos dashboards VBM (logo Vale, nome do dashboard ao centro, engrenagem de Configurações com Tema Claro/Escuro, Idioma e Formato numérico, e nome/cargo/iniciais do usuário logado), no mesmo padrão do VBM Performance Studio e do VBM Kaizen. A barra sai de cena em tela cheia. Use SEMPRE que for criar um dashboard novo no Portal (VBM-Performance-Hub e outras pastas), ou quando o pedido citar "Setup Dashboards", "barra superior", "topbar", "engrenagem", "configurações do dashboard", "tema claro/escuro", "idioma", "formato numérico", "usuário no topo" ou "igual ao Performance Studio".
---

# Setup Dashboards

Barra superior + painel de Configurações iguais aos do VBM Performance Studio (que copiou o
VBM Kaizen), prontos para qualquer dashboard do Portal. Os três blocos de `assets/` são a
fonte: copie, não reescreva.

| Arquivo | O que é | Onde vai no dashboard |
|---|---|---|
| `assets/setup-dashboards.css` | Estilos da barra, do painel e a regra de tela cheia | dentro do `<style>` (ou como `assets/setup-dashboards.css` da pasta) |
| `assets/setup-dashboards.html` | Marcação da barra e do painel | primeira coisa dentro do `<body>` |
| `assets/setup-dashboards.js` | Painel, tema, idioma, número, usuário e tela cheia (`window.VBMSetup`) | `<script>` logo depois da marcação e ANTES do script do dashboard |

Os dashboards do Hub são uma página só e cada pasta serve apenas `index.html` e `assets/`
(ver o `portal.js` da pasta): o padrão é colar os blocos no próprio `index.html`.

## Passo a passo

1. **Nome do dashboard.** Na marcação, troque `__NOME_DASHBOARD__` pelo nome exibido ao
   centro da barra (ex.: `COO Business Units Dashboard`, `VBM Performance Studio`).
   O link do logo (`../`) volta ao Hub; ajuste se a pasta morar em outro nível.
2. **Configuração (opcional)**, antes do `setup-dashboards.js`:
   ```html
   <script>window.VBM_SETUP = { idiomaPadrao: 'en', numeroPadrao: 'en-CA' };</script>
   ```
   Sem ela: português e formato numérico pelo idioma do navegador.
3. **Tema.** O JS grava `data-bg` (barra e painel) e `data-theme` (tokens do dashboard) no
   `<html>`. Defina as cores do dashboard em `:root` e `:root[data-theme="dark"]` (padrão
   da skill `vbm-ecossistema`) e remova qualquer botão de tema próprio: o tema fica na
   engrenagem.
4. **Idioma.** Textos fixos com `data-i18n="chave"` (e `data-i18n-aria`, `data-i18n-title`,
   `data-i18n-ph`). Registre os textos do dashboard e aplique:
   ```js
   VBMSetup.registrar({ 'pt-BR': { 'f.ano': 'Ano:' }, en: { 'f.ano': 'Year:' } });
   VBMSetup.traduzir();
   ```
   Texto montado pelo JS usa `VBMSetup.t('chave', { variavel })` e redesenha em
   `VBMSetup.on('idioma', render)`. Meses, rótulos de eixo e datas também mudam de idioma
   (`VBMSetup.dataHora(data)`). Nomes vindos do banco (indicadores, sites) não são traduzidos.
5. **Formato numérico.** Todo número da tela passa por `VBMSetup.fmt(valor, casas)`
   (Brasil `1.234,56` · Canadá `1,234.56`) e os gráficos se redesenham em
   `VBMSetup.on('numero', render)`.
6. **Tela cheia.** O botão de tela cheia do dashboard continua seu
   (`document.documentElement.requestFullscreen()`). O `setup-dashboards.js` marca
   `html.is-fs` no `fullscreenchange` e o CSS esconde a barra; no F11 vale
   `@media (display-mode: fullscreen)`. Se o layout calcula alturas (ex.: `ajustarAltura`),
   ele precisa reagir ao tamanho da área (`ResizeObserver`), não a um valor fixo.
7. **Layout.** A barra tem 64 px e é `position: sticky`. Em página de altura fixa
   (`body` em coluna com `height: 100%`), a área do dashboard deve ser `flex: 1; min-height: 0`
   para encolher com a barra e crescer de volta na tela cheia, sem rolagem.
8. **Usuário logado.** O JS chama `GET /api/me` (rota do Portal/Kaizen; devolve `nome`,
   `email` e `cargo` pelo `X-Forwarded-Email`). Fora do Portal a rota não existe e o bloco
   do usuário fica escondido — nada a configurar.

## Regras

- Preferências por pessoa, no navegador, com as chaves do Kaizen e do Studio: `vdt-theme`,
  `vdt-lang`, `vdt-num`. Não crie chaves novas: a escolha vale para todas as aplicações.
- Não altere outros projetos ao aplicar a skill: tudo vai na pasta do dashboard.
- Acessibilidade: engrenagem com `aria-expanded`, painel com `role="dialog"`, Esc fecha,
  foco volta para a engrenagem. Mantenha esses atributos ao copiar.
- Conferir antes de entregar: 1920×1080, 1440×860 e 390 px; tema claro e escuro; troca de
  idioma e de formato numérico redesenhando os gráficos; tela cheia (botão e F11) sem a barra.
