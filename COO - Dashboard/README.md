# COO – Business Units Dashboard

Dashboard executivo do COO no VBM Performance Hub: Production Drivers (3×3) e
Financial Drivers (2×3) por unidade, com Budget × Actual/Forecast no mês, no
trimestre e no ano. Conexão **direta ao Azure SQL de produção**
(`rdb-ibp-bmsa-prd` / `BDIBPBMSA_PRD`), no mesmo padrão do VBM Performance Hub
e do VBM Kaizen.

| Arquivo | Função |
|---|---|
| `index.html` | A página (HTML/CSS/JS num arquivo só; fonte Poppins via Google Fonts) |
| `coo-api.js` | Rotas `/ping`, `/unidades`, `/indicadores`, `/atualizacao` — usado pelos dois modos |
| `database/coo_dashboard.sql` | Script principal do time de dados (mês, trimestre e ano) — **fonte única da SQL** |
| `database/coo_dashboard_atualizacao.sql` | Status de atualização por gráfico (regras de exibição a definir) |
| `portal.js` | **Modo Portal**: monta rotas, pool próprio no PRD e bloqueio dos arquivos internos |
| `server.js` | **Modo standalone**: Express + helmet + pool `mssql` + controle de acesso |
| `acesso.js` | Controle de acesso do modo standalone (IBP.USERS + CD_MATRICULA, deny by default) |
| `app.yaml` | Databricks App (credenciais só por secret/`valueFrom`) |
| `tests/` | Regressão com dublê do `mssql` (nunca toca no banco) + varredura de segredos |
| `docs/` | `ESTRUTURA.md` (organização e regras) e `DEPLOYMENT.md` (publicação) |

## No Portal
No `server.js` do Portal, antes do gate de páginas e do `express.static`:
```js
portal.use("/COO-Dashboard", aguardarAcesso("exigir"));   // controle de acesso do Portal
require("./COO - Dashboard/portal")(portal);
```
Rotas: `/COO-Dashboard/`, `/COO-Dashboard/api/health`, `/COO-Dashboard/api/unidades`,
`/COO-Dashboard/api/indicadores?site=&ano=&mes=`, `/COO-Dashboard/api/atualizacao?site=&ano=&mes=`.

## Rodar localmente
```bash
cp .env.example .env      # preencha AZURE_SQL_USER / AZURE_SQL_PASSWORD e COO_ACESSO_LOCAL_EMAIL
npm install
npm run start:local       # http://localhost:8000
```
O banco PRD só aceita conexões da rede Vale / do workspace Databricks. Sem acesso,
a página abre com o selo **dados de exemplo**.

## Testes
```bash
npm test                  # regressão completa (dublê do mssql) + varredura de segredos
npm run verifica-segredos # só a varredura de credenciais
```

## Origem dos números na tela
O selo ao lado de "Last updated" sempre diz de onde vêm os números:
- **dados de exemplo** — API indisponível ou sem dados para o site/período (valores do print);
- **dados parciais** — algum card sem KPI correspondente em `IBP.DASHBOARD` (passe o mouse para ver quais);
- sem selo — todos os cards com dados do banco.

## Unidades (fase de teste de dados)
Por enquanto só **Sossego** e **Salobo** estão liberadas, para o teste de dados: aparecem no
seletor e são as únicas com dados na API — outro site pedido direto responde 404.
Para ampliar, ajuste `COO_SITES` no `app.yaml`: nomes de `IBP.SITES` separados por vírgula,
ou `*` para liberar todos os sites do dashboard. Não é preciso mexer no código.

Cada card é ligado ao KPI pelo nome em `IBP.DASHBOARD.NM_KPIS_DASH` (o título do card,
sem diferenciar maiúsculas/espaços). Se o nome no banco for outro, informe `kpi: '<nome>'`
no indicador dentro do `index.html`.
