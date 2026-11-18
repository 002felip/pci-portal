# AIP Goals

Leva cada meta de AIP das BUs de VBM (Brasil, Canadá e International Refineries) do desdobramento do COO até o Goal Card
aprovado, versionado e rastreável, no lugar do PPT e do e-mail. Especificação funcional e técnica:
[`VBM-Aip-Goals/docs/ESPECIFICACAO-TECNICA.md`](../../VBM-Aip-Goals/docs/ESPECIFICACAO-TECNICA.md) e
[`VBM-Aip-Goals/docs/LEVANTAMENTO-REQUISITOS.md`](../../VBM-Aip-Goals/docs/LEVANTAMENTO-REQUISITOS.md).

- **Endereço:** `/VBM-Aip-Goals/`
- **Código:** `VBM-Aip-Goals/`
- **Acesso:** regra do Portal (`IBP.USERS` com `CD_MATRICULA`); papéis por BU e por ciclo virão do modelo de dados
- **Stack:** Node/Express (`aip-goals-api.js`) + HTML/JS numa página única, sem framework e sem biblioteca
- **Situação:** Início, Desdobramento, T02, T03, T04 Goal Card, T06 Versões, T07 Action Log e T11 Configuração do ciclo publicados (a T01 Minhas pendências foi retirada, D-14) com dados de exemplo; demais telas do catálogo em construção


## Modelo de acesso e aprovação (D-09, D-10 — 17/11/2026)

- **Aprovação em nível único**, feita por um grupo de usuários (grupo de aprovação P&CI/COO): qualquer membro
  aprova, devolve ou nega, e a decisão é final. Não existe o nível do Diretor da BU (a P-11 foi encerrada).
- **Contribuidores** (grupo por BU): preenchem, submetem, recolhem e resubmetem os Goal Cards da BU.
- **Aprovadores**: decidem e veem todas as BUs (T02 Painel do ciclo).
- **Consulta**: só leitura (metas, Goal Cards, versões e Action Log); a API recusa escrita com 403.
- **Leitura aberta (D-11):** todos os usuários veem todos os dados de todas as BUs; a edição cabe só aos
  contribuidores da própria BU, conforme o cadastro no banco (`AIP_PAPEL`).
- **Regras ajustadas (D-12):** sem alerta de pendência parada (RN-14 retirada); soma dos pesos garantida na gravação
  (RN-16); card Aprovado reabre dentro da janela inicial do ciclo e, depois, só via Change Request (RN-17).
- **Edição pelo administrador (D-16):** o administrador edita os Goal Cards de todas as BUs, nas mesmas situações
  dos contribuidores.
- **Ajuste pendente no protótipo:** os dados de exemplo e a T02 ainda mostram dois níveis (Diretor da BU e P&CI/COO)
  e o alerta de pendência parada; a API ainda filtra a leitura por BU e a T03 mostra o alerta de soma dos pesos;
  passam às regras D-09 a D-12 na próxima entrega.

## Navegação e layout (D-17, D-19 — 17 e 18/11/2026)

- **Menu no topo:** Início, Desdobramento, Painel do ciclo, Metas da BU e **Administração**, um submenu com
  Aprovações (só o grupo de aprovação), Action Log e Configuração (só o administrador). Abre no clique,
  fecha ao escolher, ao clicar fora ou com Esc; fica destacado quando uma tela dele está aberta e some se o perfil
  não vê nenhuma das telas. No modo gaveta (até 1080 px), as telas aparecem recuadas sob o título.
- **Layout comum:** todas as telas, menos o Início, ocupam a largura da janela (`body.is-largo`) com margens
  fluidas; o topo sobe por trás da barra de vidro, então a foto começa no alto da tela; atualizar e tela cheia
  ficam no canto superior direito (`.topo-acoes`); os blocos usam cinza suave com borda leve. Sem a pílula
  "Dados de exemplo". Em tela cheia, a barra com o menu continua visível.
## Arquivos

| Arquivo | O que é | Público? |
|---|---|---|
| `index.html` | página única; tokens e componentes `vbm-design` e barra `setup-dashboards` colados no `<style>`/`<script>` | sim |
| `assets/css/poppins.css` | Poppins local (faces embutidas) | sim |
| `assets/images/Fundo_VBM_2400x1145.webp` | fundo dos três minerais (Início, T02, T03 e T04 no tema escuro) | sim |
| `assets/images/Fundo_VBM_claro_2400x1145.webp` | versão clara do mesmo fundo (Início e T02 no tema claro) | sim |
| `portal.js` | montagem no Portal (pool próprio, health, router, bloqueio dos arquivos internos) | não |
| `aip-goals-api.js` | rotas de dados (mesmo router no Portal e no standalone) | não |
| `dados-exemplo.js` | ciclo, papéis e Goal Cards de exemplo, com datas relativas a hoje | não |
| `server.js` | app standalone para desenvolvimento (porta 8020) | não |
| `tests/` | testes `node --test` (API, regras de idade/prazo, bloqueio de arquivos) | não |
| `README.md` | documento da pasta (telas, estrutura, API, como rodar) | não |
| `database/` | scripts SQL do time de dados; hoje só o `README.md` com o modelo proposto (P-12) | não |
| `docs/` | especificação técnica e levantamento de requisitos (cópia do documento de especificação) | não |

## Telas (vistas pelo hash)

| Vista | Tela | Situação |
|---|---|---|
| `#inicio` (padrão) | T00 Início: abertura do ciclo | publicada |
| `#desdobramento` | Desdobramento CEO → COO → BUs | publicada |
| `#painel` | T02 Painel do ciclo (P&CI/COO e administrador) | publicada |
| `#metas` | T03 Metas da BU (recorte do usuário) | publicada |
| `#goal-card?card=` | T04 Goal Card (também em popup pela T03) | publicada |
| `#versoes?card=&de=&para=` | T06 Versões (pelos links do Goal Card e do Action Log) | publicada |
| `#action-log?bu=&meta=&secao=&tipo=&periodo=&card=` | T07 Action Log (submenu Administração) | publicada |
| `#configuracao?aba=` | T11 Configuração do ciclo (submenu Administração, só o administrador) | publicada |
| `#aprovacoes` | T14 Aprovações (submenu Administração, só o grupo de aprovação) | em construção |

T05 (visão imprimível) e T08 (Ações) foram descontinuadas (D-20): saíram do menu e do catálogo, e qualquer
endereço fora da lista de vistas (como o antigo `#acoes`) volta ao Início.

### Início (abertura)

Tela de entrada em tela cheia, sobre a foto dos três minerais (versão clara no tema claro; original com
véu navy no escuro):

- **Assinatura:** "AIP Goals" com o ano do ciclo em numerais vazados e uma linha sobre o planejamento
  das metas de AIP do ano. Abaixo, os fatos do ciclo: etapa atual e prazo, data de publicação dos Goal
  Cards oficiais e o número de Business Units do ciclo. A abertura não mostra
  pendências pessoais.
- **Jornada do ciclo** na vertical, em vidro, à direita (no lugar do antigo índice; o acesso às telas é pelo menu do topo): as quatro janelas (Desdobramento do COO, Proposta da BU, Calibração e aprovação,
  Goal Card oficial) com datas e a etapa atual marcada por texto ("Etapa atual") e ponto. Vem de
  `ciclo.etapaAtual` e `ciclo.etapas[]` em `/inicio` (configuração do ciclo, T11).

A barra superior é de vidro em todas as telas (desfoque + fundo translúcido no tom do tema): claro com
logo e menu em navy, escuro com logo e menu em branco.

### T02 Painel do ciclo

Visão do ciclo para o grupo P&CI/COO e o administrador (AC-07; demais perfis recebem 403 e a tela mostra
"Painel restrito"). Filtro País › BU no endereço (`#painel?pais=&bu=`), com o Voltar do navegador.

- **Topo:** "Ciclo AIP" e, embaixo, o ano do ciclo em numerais vazados (modelo da abertura), sobre a foto dos
  minerais com véu no tom da página.
- **Jornada do ciclo:** as quatro etapas ("01 - Desdobramento COO", "02 - Propostas BU's", "03 - Calibração e
  Aprovação", "04 - Goal Card oficial") numa linha contínua preenchida até hoje, com o marcador "Hoje". Cada anel
  mostra o percentual do total do ciclo (metas desdobradas, submetidos, em aprovação, aprovados). Abaixo, o prazo
  discreto e o quantitativo curto ("27 de 41"; o texto completo fica no aria-label). A distância do anel ao texto de cima e ao de baixo
  é a mesma (`--p2-esp`). Números dos totais do servidor, seguindo o filtro País › BU.
- **Faixa de filtro:** País › BU. Atualizar e tela cheia ficam no canto superior direito do topo.
- **Situação por Business Unit:** matriz BU × situação agrupada por país, com barra de composição (cores de
  status + números na linha), total e paradas; a BU leva à T03 filtrada.
- **Funil do ciclo:** Goal Cards → submetidos → aprovados no nível 1 → aprovados, com a perda entre etapas.
- **Tempo em aprovação por nível:** por nível, mediana (ponto), mínimo–máximo (traço) e o limite de dias
  úteis da RN-14 (linha tracejada), com cards e paradas.
- **Cards parados há mais tempo:** os 6 com mais dias úteis acima do limite, com link para a fila de aprovação (T14).

Toda conta sai do servidor (`agregarPainel`) a partir da mesma lista de cards, então as contagens batem com a
lista de metas de cada BU (CA-15, coberto por teste).

### T03 Metas da BU

Metas de uma BU, no recorte do usuário (AC-04/AC-05): P&CI/COO e administrador escolhem qualquer BU; os demais,
só as dos seus papéis. BU no endereço (`#metas?bu=`), com o Voltar do navegador; a matriz da T02 leva direto à BU.

- **Topo** no modelo da T02: "Metas da BU" e, embaixo, o nome da BU em letras vazadas.
- **Jornada do ciclo** igual à da T02 (mesmo componente `jornadaHtml` e mesmo tamanho), na visão da BU: as quatro
  etapas com prazo, linha até hoje e, em cada anel, os Goal Cards da BU naquela etapa (ex.: "6 de 10").
- **Alerta da RN-16:** pílula âmbar "Soma dos pesos: n de 100 pts" quando a soma difere do total do desdobramento
  (nos dados de exemplo, todas as BUs somam 100, como no material de referência).
- **Tabela de metas:** número, título, tipo (fórmula ou marcos) e card; peso com barra curta em cascata (o cinza
  claro é o peso das metas anteriores e o trecho colorido, o da meta, na cor do status; todas somam o total);
  Status do fluxo de aprovação (ponto e rótulo, sem ícone e sem aviso de parada); Contribuidor responsável; Versão;
  Última atualização; Peso, Status, Versão e Última atualização centralizados; total de pesos no rodapé.
- **Abrir:** mostra o Goal Card (a própria vista T04, movida para um `<dialog>`) num popup grande, editável para
  quem pode editar; as setas e a lista trocam de meta sem fechar; X, Esc ou clique fora fecham e a lista se
  atualiza. Ctrl+clique abre a tela inteira.

### T04 Goal Card

`#goal-card?card=GC-ONP-05&secao=ruler` (ou o popup da T03). Ficha de cadastro da meta pelos **contribuidores** (D-13)
e pelo **administrador** (D-16): o servidor decide o modo — **edição** (contribuidores da BU ou administrador, Rascunho ou Em revisão) ou **leitura** (demais casos, com o motivo no
rodapé). A decisão do grupo de aprovação não acontece aqui: fica na **T14 Aprovações** (a construir).

- **Topo** no padrão da T02/T03: "Goal Card" com o número da meta vazado, título, pílula de situação, código e
  versão; linha do tempo do card (rascunho → submetido → em aprovação → decisão).
- **Ficha única** (modelo VBM "CARD"): rótulo à esquerda, valor ao centro e, quando houver comentário, o indicador
  à direita. Goal Title, peso, tipo e direção da meta vêm do desdobramento com cadeado; o texto padrão de exceções
  tem o selo "Padrão do ciclo".
- **Campos para preencher bem marcados:** campos da BU abertos com placeholder de orientação, \* de obrigatório,
  etiqueta "Obrigatório" e borda âmbar enquanto vazios; fórmula de cálculo em uma linha; legenda no rodapé.
- **Seletor de metas da BU** na faixa de filtro (lista e setas): todas as metas da BU na mesma página.
- **Envio no rodapé da ficha:** Salvar rascunho e Submeter, que só é liberado com os obrigatórios preenchidos
  (mesma regra do servidor, `camposObrigatorios`). Sem painel lateral e sem botão de tela cheia.
- **Comentários:** o campo com comentário mostra o indicador com o número; o clique abre um pop-up (`<dialog>`)
  só de leitura com as mensagens; um link com `secao` abre o pop-up do campo.
- **Escritas:** `POST /goal-card/submeter` valida no servidor (403 fora da BU, 409 fora da situação, 400 com os
  campos que faltam) e responde `simulado: true` até o modelo de dados (P-12). `POST /goal-card/decisao` fica
  pronto para a T14 (RN-06, RN-08, RN-09, RN-12).

### T06 Versões

`#versoes?card=GC-SOS-03&de=1&para=2`, aberta pelos links "Versões" do Goal Card (ao lado do modo, também no popup
da T03) e do Action Log. Todos os perfis leem; ninguém altera (§7.2).

- **Linha das versões** (v1 → v2…): motivo, autor, data e a decisão de cada uma, com o selo da oficial; o clique
  numa versão compara com a anterior.
- **Comparação:** de/para em listas, inverter, chave "Só o que mudou"; tabela campo · de · para nas 7 seções, com o
  valor antigo riscado e o novo em destaque, e a marca "Pedido de ajuste" nas seções devolvidas.
- **Casos:** versão única é mostrada inteira; rascunho explica que a v1 nasce na primeira submissão.
- Dados de `GET /versoes?card=` (`versoesExemplo`): snapshot imutável de cada versão.

### T07 Action Log

`#action-log`, no submenu Administração. Linha do tempo única e imutável do ciclo (§7.3).

- **Topo** só com o título, sem o ano e sem cartões de resumo; o total de eventos aparece ao lado de "Linha do tempo".
- **Filtros na URL:** Período (7 dias, 30 dias, ciclo), BU, Meta, Seção, Tipo e Goal Card (chip removível).
- **Linha do tempo** por dia: hora, ponto colorido pelo tipo (decisão pela cor do resultado), frase traduzível
  ("aprovou a v2…"), comentário citado, antes → depois, etiquetas BU/Meta/Seção que viram filtro e links para o
  Goal Card e as Versões. 40 por página, com "Mostrar mais".
- **Exportar:** CSV com BOM e `;` (abre direto no Excel), com os filtros aplicados.
- Dados de `GET /action-log` (`filtrarEventos`, `actionLogExemplo`); filtro inválido → 400 e a tela volta ao ciclo todo.

### T11 Configuração do ciclo

`#configuracao?aba=ciclo|bus|grupos|metas|parametros`, só o administrador (403 → T12). §7.1.

- **Topo** só com o título, sem o ano e sem cartões de resumo; a navegação é pelas abas.
- **Ciclo:** ano editável (2020 a 2100), nome, texto padrão de exceções e as 4 janelas (datas, dias úteis, etapa atual, ordem validada).
- **Business Units:** Nova BU (nome e país ou região), editar (renomear atualiza pesos, pessoas e GGs), chave "No ciclo AIP 2027"
  (vale para o ciclo aberto que está sendo configurado) e excluir só BU sem Goal Card submetido, com confirmação; números
  centralizados (pessoas por grupo, metas, pontos e cards submetidos).
- **Grupos:** inclusão por matrícula ou nome do diretório (IBP.USERS), filtros por grupo e BU, busca e remoção;
  o ciclo precisa de ao menos um aprovador e um administrador.
- **Metas e pesos por nível:** seletor CEO › COO › BU › GG › GA (só os níveis ativos), com a unidade-mãe para GG (BU) e
  GA (GG); matriz meta × unidade editável, linha "Resultado do nível acima" travada com os pontos herdados, nova meta e
  remoção; total por unidade e contador de pendências por nível. Salvar fica bloqueado enquanto alguma unidade não fecha
  o total (RN-16), e o servidor recusa com 400 (`somaPesosPorNivel`).
- **Parâmetros:** níveis do desdobramento (nome, total por unidade, herdado do nível acima, pontos livres; CEO, COO e BU
  obrigatórios, GG e GA ligáveis sem pular nível) e os limites (mínimo de caracteres e tamanho de anexo).
- **Rodapé fixo:** o que mudou, o que impede gravar, Descartar e Salvar (grava só as abas alteradas). Novo ciclo a
  partir deste em diálogo de confirmação. Sem histórico de últimas alterações na tela (fica no Action Log).
- Dados de `GET /configuracao`; escritas em `POST /configuracao/salvar` e `/configuracao/clonar` (`validarConfiguracao`), simuladas até a P-12.

### Desdobramento

`#desdobramento`, segundo item do menu. Visão executiva do desdobramento das metas:

- **CEO → COO · Scorecard do COO:** barra fina dos 100% na paleta executiva em degradê (uma cor por meta) e um card
  por meta do scorecard do COO, com peso, régua e a barra dos 100% com o trecho da meta em destaque; abaixo, um
  ponto por BU na cor da situação do Goal Card. O card selecionado fica em ênfase.
- **COO → Business Units:** matriz meta × BU agrupada por país, com o peso desdobrado e a situação do Goal Card em
  cada célula; legenda de status.
- **Clique na célula:** abre o Goal Card daquela meta na BU no mesmo popup da T03, mas fixo na meta clicada (sem
  seletor nem setas para trocar de meta, `.m3-dlg.is-fixo`); o servidor decide leitura ou edição (contribuidor da BU
  ou administrador, em Rascunho ou Devolvido). Ctrl+clique abre a tela inteira.
- **Versões e Histórico no popup:** os links do Goal Card trocam o conteúdo do mesmo popup pela T06 ou pela T07
  (filtrada pelo card, sem filtros de BU e meta), com o botão "← Goal Card" para voltar; o endereço da página não muda.
  Vale também para o popup da T03.
- **Popup sem barra de rolagem:** o card mantém o mesmo modelo da tela inteira; o popup só ajusta a escala do conteúdo
  à altura disponível (`dlgAjustar`, zoom proporcional, mínimo de 50%). Abaixo desse mínimo (telas muito baixas, como
  1280×590 ou 1024×700), a rolagem volta como último recurso. O Histórico, que é uma lista paginada, não é escalado.
- Dados de `GET /desdobramento` (`agregarDesdobramento`).

### T12 Sem acesso / não encontrado

Mesmo padrão da tela "Acesso não autorizado" do Portal PCI (`index.html` da raiz): cartão central em vidro sobre a
foto dos minerais, cadeado num quadrado vermelho suave, título "Acesso não autorizado", a mesma mensagem neutra em todas as telas
(não revela se o card existe) e os botões Voltar e a ação principal
(Início ou Metas da BU). Aparece no Desdobramento, na T02, na T03 e na T04 quando a API responde 401, 403 ou 404;
o resto da vista sai de cena e o título recebe o foco (leitor de tela). Cores por token, nos dois temas.

### Dados de exemplo

O administrador edita os Goal Cards de todas as BUs (D-16, AC-05); os contribuidores, só os da própria BU.
O contribuidor de cada card é um nome de exemplo (o mesmo que aparece entre os editores do Goal Card).

As BUs usam os nomes dos sites do COO Dashboard (D-15): Onça Puma, Salobo e Sossego (Brasil); Ontario e VNL (Canadá); Clydach e Matsusaka (International Refineries). O código do Goal Card usa 3 letras por site
(ONP, SAL, SOS, ONT, VNL, CLY, MAT).

Os Goal Cards de exemplo (T02 a T04) seguem a estrutura do material de referência do ciclo 2027: por BU, 40% de
resultado do scorecard do COO e 60% de metas específicas (63 cards); os cards com situação inicial definida têm a
mesma situação em todas as telas.

## Responsividade

Aplicação de **notebook e desktop** (1024px a 4K). Celular fica fora do escopo.

- **Largura total:** todas as telas, menos o Início, ocupam a largura da janela com margens fluidas.
- **Raiz fluida:** `html { font-size: clamp(1rem, 0.357vw + 0.643rem, 1.5rem) }` (16px até 1600px, 24px em
  3840px); layout em `rem`; barra com altura fluida (`--barra`).
- **Breakpoint estrutural:** 1080px (menu em gaveta, banner e abertura em uma coluna). Pouca altura
  (≤ 820px, notebook com escala de 125–150%) compacta banner e abertura.
- **Cartão da fila por container query** (`@container fila`), pela largura do próprio cartão.
- **Vidro com degradação:** fundo opaco sem `backdrop-filter` ou com `prefers-reduced-transparency`.
- Conferido sem rolagem lateral em 1024, 1180, 1280×590, 1280×800, 1440, 1920, 2560 e 3840px e com zoom de 200%
  (960×540), nas cinco telas e nos dois temas (demonstração offline, 90 combinações).

## API (`/VBM-Aip-Goals/api`)

| Rota | O que faz |
|---|---|
| `GET /inicio` | T00: ciclo ativo (etapa, janelas, BUs) e papéis do usuário pelo `X-Forwarded-Email` (sem ele, 401) |
| `GET /painel?pais=&bu=` | T02: só P&CI/COO e administrador (403 para os demais). Filtro validado contra as BUs do ciclo (400 fora da lista). Devolve `ciclo`, `filtro`, `cards[]` (com `diasUteis` e `parada`), `totais`, `porBu[]`, `funil[]`, `niveis[]` e `parados[]` |
| `GET /metas?bu=` | T03: metas de uma BU no recorte do usuário (BU fora do recorte ou inexistente → 404; sem BU no recorte → 403). Devolve `ciclo`, `bu`, `bus[]` (recorte), `metas[]` (com `diasUteis` e `parada`), `totais` (quantidade e peso por situação, `pesoTotal`, `pesoEsperado`, `pesoSubmetido`) e `alertaPesos` (RN-16) |
| `GET /desdobramento` | Desdobramento: metas do scorecard do COO e matriz meta × BU com peso e situação do Goal Card |
| `GET /versoes?card=` | T06: versões do card (mais recente primeiro), com snapshot, decisão e a oficial |
| `GET /action-log?bu=&meta=&secao=&tipo=&periodo=&card=&pagina=&tudo=` | T07: eventos filtrados (40 por página; `tudo=1` para exportar), `porTipo` e opções dos filtros |
| `GET /configuracao` · `POST /configuracao/salvar` · `POST /configuracao/clonar` | T11: só o administrador; validação por aba e RN-16 no servidor; simulação até a P-12 |
| `GET /goal-card?card=` | T04: Goal Card com `modo`, `secoes`, `obrigatorios[]`, `comentarios[]`, `linha[]` e `permissoes` |
| `POST /goal-card/submeter` · `POST /goal-card/decisao` | T04: campos obrigatórios e decisão validados no servidor; simulação até o P-12 |
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

- **P-12 (modelo de dados):** enquanto não for validado, as telas usam os dados de exemplo (sem pílula na tela). A
  consulta real entra em `database/00N_*.sql`, parametrizada por e-mail e ciclo, e as rotas
  passa a lê-la com `AIPGOALS_FONTE=banco`.
- **Papéis:** hoje vêm dos dados de exemplo; no modelo validado saem de `AIP_PAPEL` (AC-02, AC-03).
- **Card na página inicial do Portal:** ainda não adicionado.
