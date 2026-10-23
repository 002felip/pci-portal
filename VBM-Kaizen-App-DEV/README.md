# VBM Kaizen App

Aplicação web do programa Kaizen da Vale Base Metals: cadastro de
iniciativas de melhoria contínua, fila de aprovação e biblioteca dos
Kaizens aprovados.

Node/Express servindo HTML estático + uma API REST que fala **direto**
com o Azure SQL (sem Databricks SQL Warehouse). Roda como Databricks App.

## Telas

| Arquivo | O que é |
|---|---|
| `index.html` | painel inicial |
| `kaizen-novo.html` | cadastro/edição de um Kaizen, em 4 etapas |
| `biblioteca.html` | repositório dos Kaizens |
| `dashboard.html` | indicadores (atual + histórico), filtros por hierarquia do MDM, Excel |
| `aprovacao.html` | fila de aprovação — restrita a `kzn_aprovador` |
| `admin.html` | cadastros e usuários — restrita a `kzn_admin` |

A estrutura física dos arquivos está em [`docs/ESTRUTURA.md`](docs/ESTRUTURA.md).

## Como roda

`npm start` → `server.js` na porta `DATABRICKS_APP_PORT` (ou `PORT`,
padrão 8000). Configuração por variáveis de ambiente, declaradas em
`app.yaml`.

**A identidade de quem acessa vem do cabeçalho `X-Forwarded-Email`**,
reescrito pelo proxy do Databricks Apps a cada requisição — não é
forjável pelo navegador. Toda autorização é decidida no servidor; o
front-end só esconde links.

## Deploy

**É upload manual de arquivos, não é Git-connected.** Commitar aqui não
publica nada: os arquivos precisam ser enviados para o Databricks App.
Ao subir, confira que a estrutura de pastas (`css/`, `js/`, `assets/`)
foi preservada.

## Banco

`database/DER_VBM_Kaizen_CI.html` é a referência de schema. Os `.sql`
dessa pasta são scripts **operacionais**, rodados à mão no SSMS — não
são executados pela aplicação.

## Pendências conhecidas

- **Credenciais só via Databricks Secrets** (`valueFrom` no `app.yaml`,
  resources `db-user`, `db-password`; SAS ainda pendente).
  A senha do SQL e o SAS antigos seguem no histórico do git:
  **rotacionar os dois**. Verificação: `bash tests/verifica-segredos.sh`.
  Procedimento e evidências: `docs/evidencias-secrets.md`.
- O SAS do Blob não tem a permissão de delete (`sp=racw`): cada cadastro
  novo deixa um arquivo `TEMP_` órfão. Reemitir com `sp=racwd`.
- **Comunicados por e-mail não estão saindo.** O envio é feito pelo
  navegador (Microsoft Graph, com o token de quem está logado) e o
  locatário exige aprovação de um administrador do Entra, ainda não
  concedida. As duas saídas possíveis estão comentadas no `app.yaml`.
- `package-lock.json` está no `.gitignore`: as versões instaladas podem
  variar entre um deploy e outro.

## Dashboard

`dashboard.html` + `js/dashboard.js` (tela) e `dashboard-kaizen.js`
(API, registrada em `server.js` por `registrarRotasDashboard`).

- **Fonte:** a mesma da Biblioteca — `kzn_pedravisaoconsolidada` UNION ALL
  `kzn_hist_pedravisaoconsolidada` (`fonteBiblioteca`). Ano/mês pela
  `DT_REFERENCIA`, igual ao filtro da Biblioteca.
- **Hierarquia (filtros COO … Coord/Sup):** a fotografia por Kaizen,
  `kzn_kaizen_hierarquia` (atual) e `kzn_hist_kaizen_hierarquia`
  (histórico), níveis N3..N8. Kaizen sem fotografia usa a linha do líder
  em `kzn_mdm_hierarquia`. 'NULL', 'N.A' e vazio contam como "Em branco".
- **Desempenho:** uma consulta (UNION ALL) monta a base, guardada em
  cache no servidor e compartilhada por todos; os filtros em cascata rodam
  no navegador. Título e equipe só são buscados ao abrir a aba Base de
  Dados.
- **Variáveis opcionais** (não é preciso declarar nada para funcionar):
  - `KAIZEN_DASHBOARD_CACHE_MS` — validade do cache (padrão 300000 = 5 min).
  - `KAIZEN_DASHBOARD_HIERARQUIA_MDM=false` — Kaizen sem fotografia fica
    "Em branco" em vez de usar o MDM atual do líder.
- **Teste:** `node tests/teste-dashboard.js` (sobe o próprio servidor na
  porta 4002 com o dublê `tests/fake-mssql-dashboard.js`).

## Biblioteca — filtro de hierarquia (drill-down)

Botão "Toda a hierarquia" na barra de filtros: cada clique desce um nível
(COO → Diretoria → Head → Gerência Geral → Gerência de Área →
Coordenação/Supervisão), com a quantidade de Kaizens de cada opção; a
trilha no topo do painel volta a qualquer nível.

- Opções: `GET /api/hierarquia/opcoes?n3=…&n4=…` — servidas do cache do
  Dashboard (mesma base, mesmas regras de "Em branco").
- Filtro: `/api/kaizens`, `/kaizens/resumo` e `/kaizens/exportar`
  aceitam `n3`..`n8` (caminho contíguo a partir do N3) e filtram pela
  mesma hierarquia do Dashboard (fotografia do Kaizen; MDM do líder de
  reserva).

## Equipe do Kaizen (PNR28)

- **Equipe principal:** Líder + até **2** pessoas — 2 Vale, 2 terceiros ou
  1 + 1 (`kzn_membros_equipe`, como antes).
- **Membros envolvidos:** bloco liga/desliga no Novo Kaizen, Vale ou
  terceiros (só ativos no MDM), até **5 pessoas À PARTE da equipe** — o
  Kaizen chega a no máximo 8 (líder + 2 + 5) e pode não ter nenhum
  envolvido. A tela aplica os limites e o servidor confere de novo
  (`lerKaizenDoCorpo`).
- **Banco:** rodar `database/criar_membros_envolvidos.sql` (cria
  `ci.kzn_membros_envolvidos` e `ci.kzn_hist_membros_envolvidos`). Antes
  disso o bloco some da tela (`GET /api/kaizens/recursos`) e nada muda;
  depois, liga sozinho em até 1 minuto. Nomes alteráveis por
  `AZURE_SQL_ENVOLVIDOS_TABLE` / `AZURE_SQL_HIST_ENVOLVIDOS_TABLE`.
- Envolvidos aparecem no detalhe/impressão da Biblioteca e na coluna
  "Membros Envolvidos" da exportação Excel.
- Edição de Kaizen antigo com mais de 2 pessoas na equipe: o excedente
  é carregado como "Membros envolvidos" em vez de sumir.

## Impressão do Kaizen (Biblioteca)

O botão Imprimir abre um diálogo do próprio app (`js/impressao-kaizen.js`)
com prévia ao vivo da folha no formato do template corporativo
"Kaizen | Improve Together": Antes/Depois com foto, Unidade de Negócio,
problema, solução, benefícios, checklist de Resultados Alcançados (catálogo
`kzn_resultados`, marcados os do Kaizen), líder e equipe e os membros
envolvidos.

- **Papel:** A4, A3 ou A2. **Orientação:** horizontal ou vertical. A
  última escolha fica guardada no navegador.
- **Baixar PDF:** o PDF é gerado no app (html2canvas-pro + jsPDF em
  `js/vendor/`, carregados só no primeiro uso), já no papel e na
  orientação escolhidos. Não passa pela janela de impressão do navegador.
- **Imprimir:** abre a folha com `@page` no papel e na orientação
  escolhidos, então a janela do navegador já vem configurada; só falta
  escolher a impressora.
- O logo VPS vem do template (`assets/images/vps-logo.png`).

## Novo Kaizen — ajuda por campo

Ícone ⓘ ao lado do rótulo de cada campo da planilha
"Campos_descricao_Kaizen" abre um pop-up com a orientação (PT/EN, segue o
idioma da tela), dicas em lista e o exemplo destacado. Os textos ficam no
objeto `AJUDA` em `kaizen-novo.html` (chave = `data-i18n` do rótulo); para
incluir um campo novo basta acrescentar a chave lá.

## Novo Kaizen — campos da Etapa 4

- **Lições Aprendidas:** desabilitado por enquanto (escondido; um texto
  já gravado é preservado ao editar). Para religar: tirar o `hidden` de
  `#grupoLicoesAprendidas` e voltar o `exigir()` em `pendenciasEtapa4()`.
- **Comparação com a Meta Inicial:** passou a ser opcional.
