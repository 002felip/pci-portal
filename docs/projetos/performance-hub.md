# VBM Performance Hub

Página que reúne os dashboards de performance e "casca" que monta as aplicações da pasta.

- **Endereço:** `/VBM-Performance-Hub/`
- **Código:** `VBM-Performance-Hub/`
- **Acesso:** regra do Portal (`IBP.USERS` com `CD_MATRICULA`), aplicada pelo `server.js` da raiz a
  tudo em `/VBM-Performance-Hub`, inclusive às APIs
- **Banco:** `BDIBPBMSA_PRD` em todas as aplicações

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | página do Hub: um card por aplicação, barra `setup-dashboards`, escala compacta para telas menores |
| `portal.js` | monta cada aplicação de `APLICACOES` e bloqueia o que não é público na raiz da pasta; devolve a conexão PRD (`{ runQuery }`) da primeira aplicação para o controle de acesso do Portal |
| `assets/` | CSS (Poppins) e imagens comuns |
| `<aplicação>/` | uma pasta por aplicação (ver abaixo) |

## Aplicações

| Pasta (= caminho) | Documento |
|---|---|
| `VBM-Performance-Studio` | [performance-studio.md](performance-studio.md) |
| `COO-Business-Units-Dashboard` | [coo-dashboards.md](coo-dashboards.md) |
| `COO-Business-Units-Dashboard-Historical` | [coo-dashboards.md](coo-dashboards.md#coo-business-units-dashboard-historical) |
| `VBM-Health-of-the-Business` | [health-of-the-business.md](health-of-the-business.md) |
| `VBM-Lean-Six-Sigma` | [lean-six-sigma.md](lean-six-sigma.md) (sem banco: lê as planilhas de `data/`) |

A **primeira** da lista (`VBM-Performance-Studio`) também empresta a conexão PRD ao controle de
acesso do Portal. Mudar a ordem muda quem fornece essa conexão.

## Contrato comum das aplicações

Todas seguem o mesmo molde. Para criar uma nova, copie uma pasta e acrescente o nome em
`APLICACOES`.

```
<aplicação>/
├── index.html          tela única (setup-dashboards + filtros no padrão do COO)
├── assets/             CSS, imagens, bibliotecas JS
├── portal.js           montagem DENTRO do Portal: pool próprio + /<pasta>/api + bloqueio de arquivos internos
├── server.js           montagem STANDALONE (desenvolvimento): Express + pool próprio
├── <nome>-api.js       router com toda a lógica de dados (o mesmo nos dois modos)
├── database/           SQL do time de dados (carregada pela API) + scripts operacionais
├── tests/              node --test, banco simulado
└── package.json
```

- **Endereço** = nome da pasta: `BASE = '/VBM-Performance-Hub/' + path.basename(__dirname)`.
- **Um router, dois pontos de entrada:** `portal.js` (Portal) e `server.js` (standalone) montam o
  mesmo router e injetam o próprio `runQuery`. A SQL existe uma vez só. Essa regra existe porque
  já houve SQL duplicada nos dois `server.js`, e editar a de um não mudava a de produção.
- **Contrato do `runQuery`:** `runQuery(sql, { nome: [tipoMssql, valor] })` devolve `.recordset`;
  cada parâmetro vira `request.input`, e nada da requisição é concatenado na SQL.
- **Pool:** cada aplicação abre o seu, sempre na PRD, com `PERFORMANCEHUB_SQL_SERVER`, `_DATABASE`,
  `_PORT`, `_USER` e `_PASSWORD`. Sem elas, usa o servidor e a base PRD e o login do Portal
  (`AZURE_SQL_USER` / `AZURE_SQL_PASSWORD`). `PERFORMANCEHUB_AZURE_SQL_DATABASE` é a convenção do
  `app.yaml`.
- **Isolamento:** uma aplicação que falha ao montar só registra o erro, e o Hub e as demais seguem
  no ar.
- **Proteção da pasta:** da raiz do Hub, só `index.html` e `assets/` são públicos; os caminhos das
  aplicações passam pelo filtro de cada uma. `..`, `%2e` e `\` recebem 404.
- **Cargas mensais:** os dashboards leem cargas gravadas em `IBP.PHUB_PERFORMANCESTUDIO`,
  identificadas por `ID_DASH` (cadastro em `IBP.DASHBOARD`) e `DT_REF`. `DT_REF` é o dia 1 do mês de
  referência: `2026-10-01` significa realizado até setembro e projeção a partir de outubro. Cada
  carga é um **ciclo** que a tela pode escolher.

## Tabelas comuns (PRD, esquema `IBP`)

| Tabela | Papel |
|---|---|
| `PHUB_PERFORMANCESTUDIO` | resultado mensal dos gráficos, uma carga por `ID_DASH` + `DT_REF` |
| `DASHBOARD` | cadastro dos dashboards e dos KPIs: nome, ordem, unidade, casas decimais |
| `PHUB_PS_SETUP` | dashboards do Studio (JSON) e configurações de tela do COO e do Health of the Business (`CD_VISAO`) |
| `PHUB_PS_ACESSO` | editores de cada dashboard do Studio |
| `CONTROLE_PROCESSOS` | data de referência dos processos (`ID_PROCESSO = 2` → `DT_REF` da carga) |
| `USERS` | usuários do Portal (`CD_MATRICULA`) |
| `SITES`, `KPI`, `KPI_TIPO`, `OPERACAO`, `SISTEMA` | cadastros |
| `PEDRAVISAOCONSOLIDADA`, `PEDRAVISAOTRIMESTRE`, `PEDRAVISAOANO`, `WATERFALL`, `HIST_SUPPLY` | bases de origem das consultas |
