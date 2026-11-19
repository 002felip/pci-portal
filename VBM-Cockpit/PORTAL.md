# VBM Strategic Cockpit dentro do Portal PCI

Endereço: `/VBM-Cockpit/` (card na página inicial do Portal). O resto desta pasta é o projeto do Cockpit como ele é. Este arquivo explica só o que muda dentro do Portal.

## Como roda

O Portal é um único processo Node (Databricks App). Ao subir, ele inicia o Cockpit como **processo filho**, com o mesmo `backend.app.main:app`, na porta interna `127.0.0.1:8102`. Depois encaminha `/VBM-Cockpit/...` para lá, tirando o prefixo. Ver `apps-python.js` e `server.js` na raiz.

- O `app.yaml` e o `app_entry.py` desta pasta continuam valendo só para o **app standalone**. Dentro do Portal, quem manda é o `app.yaml` da raiz.
- **Acesso aberto:** qualquer pessoa que chega pelo Databricks Apps pode usar, sem a regra do Portal (`IBP.USERS`). O `X-Forwarded-Email` chega ao Cockpit normalmente; a única restrição continua sendo a do próprio Cockpit: só quem está em `UNLOCK_ADMINS` reabre um período travado.

## Frontend: build com o prefixo

O Cockpit usa rotas no navegador (`/portfolio`, `/data-quality`...). Por isso, dentro do Portal, o build precisa saber o prefixo. Três ajustes no código-fonte permitem isso, e **no build padrão (`npm run build`) nada muda**:

| Arquivo | Ajuste |
|---|---|
| `frontend/src/api.ts` | `BASE_PATH` vem de `import.meta.env.BASE_URL`; a API fica em `${BASE_PATH}/api` |
| `frontend/src/App.tsx` | `<BrowserRouter basename={BASE_PATH \|\| undefined}>` |
| `frontend/package.json` | script `build:portal` = `vite build --base=/VBM-Cockpit/` |

O build em `backend/app/static/` já foi gerado com `npm run build:portal`.

> Leve esses três ajustes para o repositório do Cockpit. Assim, as próximas versões já saem prontas para o Portal.

## Atualizar o Cockpit no Portal

1. Substitua o conteúdo desta pasta pela versão nova do Cockpit, mantendo este `PORTAL.md`.
2. Se a versão nova ainda não tiver os três ajustes acima, reaplique-os.
3. Gere o build:
   ```bash
   cd VBM-Cockpit/frontend
   npm ci
   npm run build:portal
   ```
4. Confira em `backend/app/static/index.html` se os arquivos apontam para `/VBM-Cockpit/assets/...`. Não publique `frontend/node_modules`.

Se as dependências Python mudarem, atualize também o `requirements.txt` da raiz do Portal.

## Banco (Lakebase) e SQL Warehouse

O Cockpit usa os recursos do **Databricks App**. Dentro do Portal, quem precisa deles é o **app do Portal**:

1. **App resources > + Add resource** no app do Portal, com estas chaves exatas:
   - `database`: a instância Lakebase do Cockpit (a mesma do app standalone, para manter os dados);
   - `sql-warehouse`: o SQL Warehouse.
2. **Permissão nas tabelas.** O Postgres do Lakebase usa como papel o **service principal do app** (`PGUSER` = `DATABRICKS_CLIENT_ID`). As tabelas existentes foram criadas pelo service principal do app standalone. Então o service principal do **Portal** precisa receber permissão. Rode, como dono das tabelas ou administrador do Lakebase:
   ```sql
   -- <sp-portal> = client id do service principal do app do Portal
   GRANT USAGE ON SCHEMA public TO "<sp-portal>";
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "<sp-portal>";
   GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "<sp-portal>";
   ```
   O `ensure_schema()` do Cockpit cria e altera tabelas na subida. Para isso funcionar, o service principal do Portal precisa ser **dono** das tabelas (`ALTER TABLE ... OWNER TO "<sp-portal>"`). Sem isso, a subida registra `Could not ensure schema` no log e o Cockpit segue funcionando com o schema que já existe.

Sem os recursos, as variáveis ficam vazias: o Cockpit abre, mas não acessa o banco. O resto do Portal não é afetado.

## Variáveis (app.yaml da raiz)

As variáveis do Cockpit levam o prefixo `COCKPIT_` e chegam a ele **sem** o prefixo (`COCKPIT_UNLOCK_ADMINS` → `UNLOCK_ADMINS`). Assim não colidem com as do Portal. Padrões aplicados pelo Portal: `ENVIRONMENT=prod`, `DATA_BACKEND=sql` e 1 worker (`COCKPIT_WEB_CONCURRENCY`).

As variáveis do Lakebase (`PG*`, `LAKEBASE_*`, `DATABRICKS_WAREHOUSE_ID`, `DB_POOL_RECYCLE_SECONDS`) passam como estão.

## Diagnóstico

- `/VBM-Cockpit/__estado`: estado do processo (`iniciando`, `instalando`, `pronto` ou `erro`), com o motivo.
- `/VBM-Cockpit/api/health`: a saúde do próprio Cockpit.
- Logs do Portal: as linhas do Cockpit saem com o prefixo `[vbm-cockpit]`.

## Permissões do Portal nas tabelas (`SCHEMA_GRANT_TO`)

As tabelas do Lakebase pertencem ao service principal do **app standalone**, que as criou. No Postgres, só o dono altera uma tabela ou dá `GRANT` nela; nem o administrador do Lakebase consegue (`must be owner of table`). Por isso, quando uma versão nova traz coluna ou tabela nova (ex.: `snapshot.restored_from` e `snapshot_revision`), quem aplica a mudança é o standalone:

1. No `app.yaml` desta pasta (o do standalone), preencha `SCHEMA_GRANT_TO` com o client id do service principal do app do Portal.
2. Publique a versão nova no app standalone (`databricks bundle deploy` e `databricks bundle run`) ou reinicie o app.
3. Na subida, o standalone roda `ensure_schema()` como dono (cria as colunas e tabelas novas) e concede ao Portal leitura e escrita em todas as tabelas e sequências, inclusive nas criadas depois (`ALTER DEFAULT PRIVILEGES`). O log mostra `Schema access granted to …`.
4. Reinicie o app do Portal.

No Portal, a subida continua registrando `Could not ensure schema` (o Portal não é dono); o Cockpit funciona porque o standalone já aplicou o schema.
