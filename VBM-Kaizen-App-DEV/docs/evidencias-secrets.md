# Credenciais via Databricks Secrets — procedimento e evidências

App: VBM Kaizen (Databricks Apps) · Workspace `dbw-ibp-bmsa-001-prd`
Nenhum valor de segredo aparece neste documento.

## 1. Inventário de credenciais

| Variável (app) | App resource (tipo Secret) | Segredo Unity Catalog | Situação |
|---|---|---|---|
| `AZURE_SQL_USER` | `db-user` | `franquia_bmsa_insight.ci.azure_sql_user` | existe |
| `AZURE_SQL_PASSWORD` | `db-password` | `franquia_bmsa_insight.ci.azure_sql_password` | existe |
| `AZURE_STORAGE_SAS_TOKEN` | `azure-storage-sas` | `franquia_bmsa_insight.ci.azure_storage_sas` | existe |
| `DATABRICKS_CLIENT_ID/SECRET` | — | injetados pelo runtime (SP do app) | nada a fazer |

Server, database, schema e URL do storage não são credenciais e seguem em `app.yaml`.

## 2. Ordem de execução (não inverter — incidente de 20/09/2026)

1. **App → Edit → App resources → + Add resource → Secret**: criar os 3 resources da tabela (`db-user`, `db-password`, `azure-storage-sas`), com as chaves exatas. Confirmar que aparecem salvos **antes** do deploy.
2. **Deploy** do `app.yaml` (credenciais por `valueFrom`) e do `server.js`.
3. **Logs do app** devem mostrar:
   `credenciais: AZURE_SQL_USER presente, AZURE_SQL_PASSWORD presente, AZURE_STORAGE_SAS_TOKEN presente`
   `teste de conexão Azure SQL: OK`
4. **Rotacionar** (os valores antigos estão no histórico do git):
   - trocar a senha do login SQL da aplicação → atualizar `azure_sql_password` → reiniciar o app → repetir o passo 4;
   - gerar SAS novo (`sp=racwd`) → atualizar `azure_storage_sas` → reiniciar → testar foto → revogar o SAS antigo no Azure.
5. Teste funcional: abrir Biblioteca, Aprovação e salvar um Kaizen com foto.

Reversão: até o passo 4, redeploy da versão anterior. Depois da rotação, não há volta para os valores antigos.

## 3. Permissões dos segredos (menor privilégio)

Aba **Permissões** dos 3 segredos (`azure_sql_user`, `azure_sql_password`, `azure_storage_sas`) em `franquia_bmsa_insight.ci`:

| Principal | Permissão |
|---|---|
| Service principal do app VBM Kaizen | somente leitura do valor (concedida ao adicionar o resource) |
| Grupo administrador da plataforma (definir) | gerenciar |
| Qualquer outro usuário/grupo (inclusive `account users`) | **remover** |

Revisar também quem tem `MANAGE`/`ALL PRIVILEGES` no schema `ci` e no catálogo `franquia_bmsa_insight`: esses privilégios herdam acesso aos segredos.

## 4. Checklist de aceite

| Critério | Evidência | Status |
|---|---|---|
| Credenciais obtidas via Databricks Secrets | `app.yaml` só com `valueFrom` + print dos 3 App resources | ☐ |
| Nenhuma senha em código/config/notebooks | saída de `bash tests/verifica-segredos.sh --historico` (seção 5) | ☐ |
| Permissões restritas | print da aba Permissões dos 3 segredos + do schema `ci` | ☐ |
| Teste de conexão com Secrets | print do log com `teste de conexão Azure SQL: OK` | ☐ |
| Rotação da senha do banco e do SAS | data/responsável da troca | ☐ |
| Evidências compartilhadas | link/pasta onde este documento e os prints foram publicados | ☐ |

## 5. Varredura do repositório (executada em 30/09/2026)

```
=== 1. app.yaml: credenciais só por valueFrom ===
  OK    AZURE_SQL_USER -> valueFrom
  OK    AZURE_SQL_PASSWORD -> valueFrom
  OK    AZURE_STORAGE_SAS_TOKEN -> valueFrom
=== 2. Padrões de credencial nos arquivos versionados ===
  OK    nenhum achado: SAS com assinatura
  OK    nenhum achado: connection string
  OK    nenhum achado: atribuição literal de credencial
  OK    nenhum achado: chave de storage
=== 3. Histórico git (credenciais já versionadas) ===
  INFO  4 linha(s) no histórico com SAS/senha versionados.
RESULTADO: OK — nenhuma credencial em texto puro
```

Outro app do mesmo workspace (Value Driver Tree, repositório `teste-conexao`): sem credencial em arquivos nem no histórico; autentica pelo service principal do app (`DATABRICKS_CLIENT_ID/SECRET` injetados) e o warehouse vem por `valueFrom: sql-warehouse`.

Prova negativa: a mesma varredura sobre o `app.yaml` anterior retorna 4 falhas (3 variáveis sem `valueFrom` + SAS com assinatura).

Complementos já existentes no servidor: `app.yaml`, `database/`, `docs/` e os `.js` da raiz não são servidos por HTTP (`ARQUIVOS_DO_SERVIDOR` em `server.js`); os logs mostram só presença/ausência das credenciais, nunca o valor.
