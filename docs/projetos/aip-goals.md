# AIP Goals

Leva cada meta de AIP das BUs de VBM (Brasil e Canadá) do desdobramento do COO até o Goal Card
aprovado, versionado e rastreável, no lugar do PPT e do e-mail. Especificação funcional e técnica:
documento "AIP Goals — Especificação funcional e levantamento de requisitos" (abas Especificação
técnica v1 e Levantamento de requisitos).

- **Endereço:** `/VBM-Aip-Goals/`
- **Código:** `VBM-Aip-Goals/`
- **Acesso:** regra do Portal (`IBP.USERS` com `CD_MATRICULA`); papéis por BU e por ciclo virão do modelo de dados
- **Stack:** Node/Express (`aip-goals-api.js`) + HTML/JS numa página única, sem framework e sem biblioteca
- **Situação:** Início, T01 e T02 publicados com dados de exemplo; demais telas do catálogo em construção

## Arquivos

| Arquivo | O que é | Público? |
|---|---|---|
| `index.html` | página única; tokens e componentes `vbm-design` e barra `setup-dashboards` colados no `<style>`/`<script>` | sim |
| `assets/css/poppins.css` | Poppins local (faces embutidas) | sim |
| `assets/images/Fundo_VBM_2400x1145.webp` | fundo dos três minerais (banner da T01 e Início no tema escuro) | sim |
| `assets/images/Fundo_VBM_claro_2400x1145.webp` | versão clara do mesmo fundo (Início no tema claro) | sim |
| `portal.js` | montagem no Portal (pool próprio, health, router, bloqueio dos arquivos internos) | não |
| `aip-goals-api.js` | rotas de dados (mesmo router no Portal e no standalone) | não |
| `dados-exemplo.js` | fila de exemplo da T01, com datas relativas a hoje | não |
| `server.js` | app standalone para desenvolvimento (porta 8020) | não |
| `tests/` | testes `node --test` (API, regras de idade/prazo, bloqueio de arquivos) | não |

## Telas (vistas pelo hash)

| Vista | Tela | Situação |
|---|---|---|
| `#inicio` (padrão) | Início: menu da aplicação | publicada |
| `#pendencias` | T01 Minhas pendências | publicada |
| `#painel` | T02 Painel do ciclo (P&CI/COO e administrador) | publicada |
| `#metas`, `#goal-card`, `#action-log`, `#acoes`, `#configuracao` | T02, T03, T04–T06, T07, T08, T11 | "Tela em construção" |

### Início (abertura)

Tela de entrada em tela cheia, sobre a foto dos três minerais (versão clara no tema claro; original com
véu navy no escuro):

- **Assinatura:** "AIP Goals" com o ano do ciclo em numerais vazados e uma linha sobre o planejamento
  das metas de AIP do ano. Abaixo, os fatos do ciclo: etapa atual e prazo, data de publicação dos Goal
  Cards oficiais e as Business Units do ciclo por país (`ciclo.bus[]`). A abertura não mostra
  pendências pessoais: elas ficam na T01.
- **Índice "Acessar"** em vidro: telas numeradas (01, 02…) só com as que o perfil pode usar, com descrição.
- **Jornada do ciclo:** as quatro janelas (Desdobramento do COO, Proposta da BU, Calibração e aprovação,
  Goal Card oficial) com datas e a etapa atual marcada por texto ("Etapa atual") e ponto. Vem de
  `ciclo.etapaAtual` e `ciclo.etapas[]` em `/pendencias` (configuração do ciclo, T11).

A barra superior é de vidro em todas as telas (desfoque + fundo translúcido no tom do tema): claro com
logo e menu em navy, escuro com logo e menu em branco.

### T01 Minhas pendências

Fila pessoal do ciclo ativo: cards a preencher (rascunho ou devolvidos), decisões pendentes,
comentários sem resposta e ações atribuídas.

- **Menu no topo**, centralizado na própria barra (como as opções do Kaizen), só texto e com o item ativo sublinhado;
  em janelas de até 1080 px vira gaveta aberta pelo botão de menu. Cada perfil vê só as telas que pode usar (§6.4):
  Painel do ciclo só para P&CI/COO e administrador; Configuração só para o administrador.
- **Banner** com o resumo por tipo; cada linha filtra a fila. "Paradas ou atrasadas" conta os itens há
  mais de `parametros.diasParado` dias úteis no mesmo nível (RN-14) ou com prazo vencido.
- **Filtros (padrão COO):** País › BU, Ordenar por (Urgência, Prazo, Idade) e "Só paradas ou atrasadas";
  tudo na URL (`?tipo=&pais=&bu=&ord=&so=1`), e o Voltar do navegador volta com o mesmo filtro.
- **Fila em cartões:** tipo, meta, detalhe, BU, card e versão, status (ícone + rótulo + cor do token
  `--status-*`), nível da rota, prazo, idade e o botão que abre a tela exata (Preencher, Ajustar,
  Analisar, Responder, Ver ação).
- **Estados:** carregando, vazio, nada com os filtros, erro (com "Tentar de novo", sem retry
  automático), sem acesso e desatualizado.
- **Cores:** status pelo fluxo do Kaizen; "Parada" com `--wait` e "Atrasada" com `--late-bg`
  (âmbar de ciclo, nunca verde/vermelho de desempenho).

### T02 Painel do ciclo

Visão do ciclo para o grupo P&CI/COO e o administrador (AC-07; demais perfis recebem 403 e a tela mostra
"Painel restrito"). Filtro País › BU no endereço (`#painel?pais=&bu=`), com o Voltar do navegador.

- **Topo:** "Ciclo AIP" e, embaixo, o ano do ciclo em numerais vazados (modelo da abertura), sobre a foto dos
  minerais com véu no tom da página.
- **Jornada do ciclo:** as quatro etapas ("01 - Desdobramento COO", "02 - Propostas BU's", "03 - Calibração e
  Aprovação", "04 - Goal Card oficial") numa linha contínua preenchida até hoje, com o marcador "Hoje". Cada anel
  mostra o percentual do total do ciclo (metas desdobradas, submetidos, em aprovação, aprovados). Abaixo, o prazo
  discreto e o quantitativo ("27 de 41 Goal Cards submetidos"). A distância do anel ao texto de cima e ao de baixo
  é a mesma (`--p2-esp`). Números dos totais do servidor, seguindo o filtro País › BU.
- **Faixa de filtro:** País › BU, aviso de dados de exemplo e as ações atualizar e tela cheia.
- **Situação por Business Unit:** matriz BU × situação agrupada por país, com barra de composição (cores de
  status + números na linha), total e paradas; a BU leva à T03 filtrada.
- **Funil do ciclo:** Goal Cards → submetidos → aprovados no nível 1 → aprovados, com a perda entre etapas.
- **Tempo em aprovação por nível:** por nível, mediana (ponto), mínimo–máximo (traço) e o limite de dias
  úteis da RN-14 (linha tracejada), com cards e paradas.
- **Cards parados há mais tempo:** os 6 com mais dias úteis acima do limite, com link para a análise (T04).

Toda conta sai do servidor (`agregarPainel`) a partir da mesma lista de cards, então as contagens batem com a
lista de metas de cada BU (CA-15, coberto por teste).

## Responsividade

Aplicação de **notebook e desktop** (1024px a 4K). Celular fica fora do escopo.

- **Raiz fluida:** `html { font-size: clamp(1rem, 0.357vw + 0.643rem, 1.5rem) }` (16px até 1600px, 24px em
  3840px); layout em `rem`; barra com altura fluida (`--barra`).
- **Breakpoint estrutural:** 1080px (menu em gaveta, banner e abertura em uma coluna). Pouca altura
  (≤ 820px, notebook com escala de 125–150%) compacta banner e abertura.
- **Cartão da fila por container query** (`@container fila`), pela largura do próprio cartão.
- **Vidro com degradação:** fundo opaco sem `backdrop-filter` ou com `prefers-reduced-transparency`.
- Conferido sem rolagem lateral em 1024, 1180, 1280×590, 1440, 1920, 2560 e 3840px.

## API (`/VBM-Aip-Goals/api`)

| Rota | O que faz |
|---|---|
| `GET /pendencias` | fila do usuário pelo `X-Forwarded-Email` (sem ele, 401). Devolve `ciclo` (com `etapaAtual` e `etapas[]`), `usuario.papeis`, `parametros.diasParado`, `itens[]` (com `diasUteis`, `parada` e `atrasada` calculados no servidor), `atualizadoEm`, `exemplo` e `desatualizado` |
| `GET /painel?pais=&bu=` | T02: só P&CI/COO e administrador (403 para os demais). Filtro validado contra as BUs do ciclo (400 fora da lista). Devolve `ciclo`, `filtro`, `cards[]` (com `diasUteis` e `parada`), `totais`, `porBu[]`, `funil[]`, `niveis[]` e `parados[]` |
| `GET /health` | `{ status }` |
| `GET /ping` | diagnóstico sem banco |

## Variáveis

| Variável | Padrão | Uso |
|---|---|---|
| `AIPGOALS_FONTE` | `exemplo` | `exemplo` (dados de `dados-exemplo.js`) ou `banco` (responde 501 até a consulta do modelo validado entrar em `database/`) |
| `AIPGOALS_AZURE_SQL_DATABASE` | `AZURE_SQL_DATABASE` | base da aplicação (`BDIBPBMSA_DEV` / `_PRD`) |
| `AIPGOALS_EMAIL_LOCAL` | — | só no `server.js` com `NODE_ENV=development` fora do Databricks: simula o `X-Forwarded-Email` |

Servidor, porta e login do banco: `AZURE_SQL_SERVER`, `AZURE_SQL_PORT`, `AZURE_SQL_USER`, `AZURE_SQL_PASSWORD` (os do Portal).

## Rodar e testar

```bash
cd VBM-Aip-Goals && npm test
NODE_ENV=development AIPGOALS_EMAIL_LOCAL=voce@vale.com node server.js   # http://localhost:8020/
```

## Pontos de atenção

- **P-12 (modelo de dados):** enquanto não for validado, a T01 mostra a pílula "Dados de exemplo". A
  consulta real entra em `database/00N_*.sql`, parametrizada por e-mail e ciclo, e `/pendencias`
  passa a lê-la com `AIPGOALS_FONTE=banco`.
- **Papéis:** hoje vêm dos dados de exemplo; no modelo validado saem de `AIP_PAPEL` (AC-02, AC-03).
- **Card na página inicial do Portal:** ainda não adicionado.
