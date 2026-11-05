# VBM Strategic Cockpit

Acompanhamento do portfólio de iniciativas estratégicas: carteira por período, comparação entre
períodos, edição das iniciativas e qualidade dos dados.

- **Endereço:** `/VBM-Cockpit/`
- **Código:** `VBM-Cockpit/`
- **Acesso:** aberto, sem a regra `IBP.USERS`. A única restrição interna é reabrir um período
  fechado, permitida a `UNLOCK_ADMINS`.
- **Stack:**
  - back-end: Python, FastAPI + SQLAlchemy;
  - front-end: React + TanStack Query/Table, Recharts, react-d3-tree, html2canvas + jsPDF;
  - dados: Databricks Lakebase (Postgres) e SQL Warehouse.
- **Documentos da pasta:** `PORTAL.md` (o que muda no Portal), `README.md` (o projeto v2, em
  inglês), `databricks.md`

## Como roda no Portal

- Processo filho do Portal (ver [portal-nucleo.md](portal-nucleo.md#aplicações-python-apps-pythonjs)):
  `python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8102 --workers $COCKPIT_WEB_CONCURRENCY`
  (padrão 1 worker).
- **Front-end:** é compilado com `npm run build:portal` (`vite build --base=/VBM-Cockpit/`) e já sai
  com o prefixo, então o Portal **não** reescreve caminhos. São três ajustes no código-fonte (o build
  padrão não muda):
  - `frontend/src/api.ts`: `BASE_PATH` vem de `import.meta.env.BASE_URL`;
  - `frontend/src/App.tsx`: `<BrowserRouter basename>`;
  - `frontend/package.json`: script `build:portal`.
- **Variáveis:** as do Portal com prefixo `COCKPIT_` chegam sem o prefixo (`COCKPIT_UNLOCK_ADMINS` →
  `UNLOCK_ADMINS`). O Portal fixa `ENVIRONMENT=prod` e `DATA_BACKEND=sql`.
- **Papel no Postgres:** `PGUSER` é o service principal do app do Portal (`DATABRICKS_CLIENT_ID`).
- O `app.yaml`, o `app_entry.py` e o `databricks.yml` da pasta valem só para o app standalone.

## Estrutura

```
VBM-Cockpit/
├── backend/app/
│   ├── registry.py      ★ o schema: tudo abaixo deriva dele (FieldSpec)
│   ├── core.py          settings, caminhos, engine do Lakebase (token OAuth com renovação)
│   ├── models.py        tabelas SQLAlchemy, colunas geradas do registry
│   ├── schemas.py       contratos Pydantic, gerados do registry
│   ├── periods.py       descoberta e resolução de snapshots e anos (PeriodResolver)
│   ├── analytics.py     regras de negócio, independentes de período e de campo
│   ├── repositories.py  Protocols + implementações Json e Sql
│   ├── etl.py           vocabulário, leitura do Excel, validação, carga idempotente
│   ├── api.py           todas as rotas
│   ├── main.py          app ASGI: /api + a SPA (backend/app/static)
│   └── static/          front-end compilado (build:portal)
├── backend/seed_demo.py, smoke_test.py   utilitários de desenvolvimento
└── frontend/src/
    ├── api.ts, ui.tsx, charts.tsx, pdf.ts, App.tsx
    └── pages/  Portfolio · Compare · Initiatives · DataQuality · Snapshots
```

## Conceitos

- **Registry único:** cada campo da iniciativa é um `FieldSpec` em `registry.py`. Tabelas, contratos
  Pydantic, validação (`registry.coerce()`, usada pelo ETL e pela edição na tela) e a grade da tela
  (`/api/meta/fields`) derivam dele. Um campo novo = uma entrada no registry.
- **Períodos descobertos, não configurados:**
  - os snapshots vêm da tabela `snapshot`, e os anos vêm dos fatos mensais;
  - códigos como `Q3`, `Q3-27`, `FY27` e `H1-26` viram `(ano, índice)`;
  - o padrão é "último com dados" comparado com "o anterior";
  - `PeriodResolver.resolve()` é a única fonte; um código desconhecido recebe 400;
  - o período escolhido vai na URL (comparação compartilhável);
  - `PINNED_SNAPSHOT` / `PINNED_YEAR` fixam um período por ambiente, se preciso.
- **Ciclo do snapshot:** publicar, fechar (trava a edição), reabrir (`UNLOCK_ADMINS`), arquivar e
  baseline do plano.
- **Edição das iniciativas:**
  - `PATCH` envia só as células alteradas, com atualização otimista na tela;
  - as colunas editadas à mão ficam em `initiative.edited_fields` (JSONB), e a próxima carga do Excel
    **não** as sobrescreve.

## API (`/VBM-Cockpit/api`)

| Grupo | Rotas |
|---|---|
| Saúde e metadados | `GET /health`, `GET /meta`, `GET /meta/fields`, `GET /meta/periods` |
| Análises | `GET /analytics/compare`, `/completeness`, `/completeness/rules`, `/monthly`, `/quarters`, `/stage-matrix`, `/top`, `/tree` |
| Iniciativas | `GET` / `POST /initiatives`, `PATCH` / `DELETE /initiatives/{id}` |
| Snapshots | `GET /snapshots`, `GET /snapshots/resolve`, `PATCH /snapshots/{id}`, `POST /snapshots/{id}/publish`, `POST` / `DELETE /snapshots/{id}/close`, `POST` / `DELETE /snapshots/{id}/archive`, `POST` / `DELETE /snapshots/{id}/plan-baseline` |
| Carga | `GET /uploads/template`, `POST /uploads/excel` (exige `snapshot_code`; até `MAX_UPLOAD_MB`, 40 MB) |
| Ajustes | `GET` / `PUT` / `DELETE /overrides/{scope}[/{scope_key}]`, `GET` / `PUT` / `DELETE /settings/{key}` |

Fora de `/api`, qualquer caminho devolve a SPA (`GET /{full_path:path}`).

## Dados (Lakebase)

| Tabela | Conteúdo |
|---|---|
| `load_batch` | cada carga do Excel |
| `vocab_term`, `vocab_alias` | vocabulário controlado e sinônimos (ex.: "at risk" → `AT_RISK`) |
| `snapshot` | períodos e o estado de cada um |
| `initiative` | iniciativas por snapshot, com `edited_fields` |
| `initiative_metric_monthly` | fatos mensais |
| `override` | ajustes manuais por escopo |
| `app_setting` | configurações |

- **Conexão:** `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` e `PGSSLMODE` vêm do resource `database`.
  A senha é um token OAuth do Lakebase, renovado antes de vencer
  (`LAKEBASE_TOKEN_REFRESH_MARGIN_SECONDS`, 600). O pool é reciclado a cada
  `DB_POOL_RECYCLE_SECONDS` (1800).
- **SQL Warehouse:** resource `sql-warehouse` (`DATABRICKS_WAREHOUSE_ID`).
- **Schema:** `ensure_schema()` cria e altera tabelas na subida. Para isso, o service principal do
  Portal precisa ser **dono** das tabelas. Sem isso, o log registra `Could not ensure schema` e o
  Cockpit segue com o schema existente.

## Configuração no Portal (`app.yaml` da raiz)

| Item | Valor |
|---|---|
| Resources do app do Portal | `database` (Lakebase do Cockpit) e `sql-warehouse` |
| Variáveis | `COCKPIT_UNLOCK_ADMINS`, `LAKEBASE_INSTANCE_NAME` / `LAKEBASE_ENDPOINT` (`valueFrom: database`), `DATABRICKS_WAREHOUSE_ID` (`valueFrom: sql-warehouse`), `DB_POOL_RECYCLE_SECONDS`, `LAKEBASE_TOKEN_REFRESH_MARGIN_SECONDS` |
| Opcionais | `COCKPIT_WEB_CONCURRENCY`, `COCKPIT_PINNED_SNAPSHOT`, `COCKPIT_PINNED_YEAR`, `COCKPIT_MAX_UPLOAD_MB` |
| Permissão no Postgres | `GRANT USAGE` no schema e `SELECT/INSERT/UPDATE/DELETE` nas tabelas para o service principal do Portal (comandos no `PORTAL.md`) |

Sem os resources, o Cockpit abre sem dados, e o resto do Portal não é afetado.

## Atualizar a versão

1. Substitua a pasta pela versão nova, mantendo o `PORTAL.md`.
2. Reaplique os três ajustes de prefixo, se a versão nova não os tiver.
3. Gere o build com `cd frontend && npm ci && npm run build:portal`.
4. Confira que `backend/app/static/index.html` aponta para `/VBM-Cockpit/assets/...`. Não publique
   `frontend/node_modules`.
5. Atualize o `requirements.txt` da raiz se as dependências Python mudarem.

## Desenvolvimento

- Local: `make dev-api` (porta 8000) e `cd frontend && npm run dev` (porta 5173). Com
  `DATA_BACKEND=json`, usa o seed.
- `backend/seed_demo.py` gera dados **sintéticos**; o `README.md` pede para trocá-los pelos reais.
- `backend/smoke_test.py`: 33 verificações dos endpoints.
- `docker compose up -d && make migrate`: Postgres local para exercitar o back-end SQL.

## Pontos de atenção

- Segundo o próprio README, o back-end SQL e o `tsc` / `vite build` reais não foram verificados na
  entrega da v2. Confira depois de cada atualização.
- As permissões no Lakebase precisam ser concedidas ao service principal do **Portal**, não ao do
  app standalone.
- O acesso é aberto a quem chega pelo Databricks Apps.
