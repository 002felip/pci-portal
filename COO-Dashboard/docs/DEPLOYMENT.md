# Deploy — COO Dashboard

## Antes de qualquer publicação
```bash
npm install && npm test        # regressão + varredura de segredos: tudo OK
```
O usuário SQL precisa de **SELECT** em:
`IBP.PEDRAVISAOCONSOLIDADA`, `IBP.PEDRAVISAOTRIMESTRE`, `IBP.PEDRAVISAOANO`,
`IBP.LOG_PEDRAVISAOCONSOLIDADA`, `IBP.DASHBOARD`, `IBP.CONTROLE_PROCESSOS`,
`IBP.SITES` e `IBP.USERS` (esta última só no modo standalone), além de leitura em
`INFORMATION_SCHEMA.COLUMNS`.

---

## Modo Portal (recomendado): /COO-Dashboard/ no app Portal
1. Copie a pasta `COO - Dashboard/` para a raiz do projeto do Portal (sem `node_modules` e sem `.env`).
2. No `server.js` do Portal, antes do gate de páginas e do `express.static`:
   ```js
   portal.use("/COO-Dashboard", aguardarAcesso("exigir"));
   require("./COO - Dashboard/portal")(portal);
   ```
   A primeira linha aplica o controle de acesso do Portal (IBP.USERS + CD_MATRICULA).
3. Opcional no `app.yaml` do Portal: `COO_ID_DASH` (padrão 15) e `COO_AZURE_SQL_DATABASE`
   (padrão `BDIBPBMSA_PRD`). Usuário e senha são os do Portal (`AZURE_SQL_USER`/`AZURE_SQL_PASSWORD`).
4. (Opcional) Card no menu inicial do Portal ou atalho no Performance Hub — ver
   `propostas/navegacao-performance-hub.html`.
5. Deploy do Portal e validação (abaixo).

## Modo standalone (opcional): Databricks App próprio
1. Criar o app: **Compute › Apps › Create app › Custom** (ex.: `coo-dashboard`).
2. Em **Edit › App resources › + Add resource › Secret**, criar e **confirmar antes do deploy**:
   - `azure-sql-user` → usuário SQL
   - `azure-sql-password` → senha
3. Publicar só esta pasta:
   ```bash
   databricks sync "./COO - Dashboard" /Workspace/Users/<seu-email>/coo-dashboard
   databricks apps deploy coo-dashboard --source-code-path /Workspace/Users/<seu-email>/coo-dashboard
   ```
   O runtime executa `npm install` e `npm start` (definido no `app.yaml`).

## Validar após o deploy
| Chamada | Esperado | Se falhar |
|---|---|---|
| `…/api/ping` | `{"ok":true,"idDash":15}` | 404 → código não publicado / rota errada |
| `…/api/health` | `{"status":"healthy","database":"BDIBPBMSA_PRD"}` | `Variáveis de ambiente ausentes` → secrets; `Login failed` → usuário/senha; `Failed to connect` → rede/firewall |
| `…/api/unidades` | lista de países e sites | 403 → usuário sem cadastro/matrícula; 500 → permissão em `IBP.SITES`/`IBP.DASHBOARD` |
| `…/api/indicadores?site=<id>&ano=2026&mes=9` | `linhas` com MONTH/QUARTER/YEAR | 500 → permissão nas tabelas do script |
| Abrir a página | sem o selo **dados de exemplo** | selo **dados parciais** → passe o mouse: cards sem KPI correspondente |
| `…/server.js`, `…/app.yaml`, `…/database/coo_dashboard.sql` | 404 | qualquer outra resposta é falha de segurança |

## Rollback
No Portal: remover as duas linhas do `server.js` e a pasta. Standalone: parar/reverter o app.
Nenhum dos dois afeta o Kaizen ou o Performance Hub (pools e rotas próprios).
