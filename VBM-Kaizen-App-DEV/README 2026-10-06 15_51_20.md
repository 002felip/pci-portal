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
