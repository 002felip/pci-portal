# Estrutura — COO Dashboard

Mesmo desenho do VBM Performance Hub (rotas num módulo, dois pontos de entrada)
com as regras de segurança do VBM Kaizen (helmet, checkConfig, deny by default,
segredos só por `valueFrom`, testes com dublê do `mssql`).

```
COO - Dashboard/
├── index.html              a página (única rota pública)
├── coo-api.js              router: /ping, /unidades, /indicadores, /atualizacao
├── portal.js               modo Portal: pool PRD próprio + rotas + bloqueio de arquivos
├── server.js               modo standalone: helmet, compression, pool, acesso, shutdown
├── acesso.js               IBP.USERS + CD_MATRICULA (só no modo standalone)
├── app.yaml                Databricks App (segredos por valueFrom)
├── package.json            express, helmet, compression, mssql
├── .env.example            modelo para execução local (o .env nunca vai para o git)
├── .gitignore
├── database/
│   ├── coo_dashboard.sql               script principal do time de dados
│   └── coo_dashboard_atualizacao.sql   status de atualização por gráfico
├── docs/
│   ├── ESTRUTURA.md        este arquivo
│   └── DEPLOYMENT.md       publicação (Portal e standalone) e validação
└── tests/
    ├── regressao.sh        roda tudo (npm test)
    ├── teste-api.js        modo standalone: acesso, dados, validação, arquivos, cabeçalhos
    ├── teste-portal.js     modo Portal: rotas e arquivos bloqueados
    ├── fake-mssql.js       dublê do mssql (nunca conecta; acusa valor literal na SQL)
    ├── preload.js          troca o mssql pelo dublê
    ├── env-exemplo.sh      variáveis FICTÍCIAS para os testes
    └── verifica-segredos.sh  nenhuma credencial em texto puro
```

## Regras que valem para qualquer mudança

**Banco**
- Toda consulta passa por `runQuery(sql, { nome: [tipo, valor] })`; valor vindo da requisição
  **nunca** é concatenado na SQL. O dublê dos testes falha se isso acontecer.
- A SQL de negócio vive em `database/*.sql` (scripts do time de dados). O código só troca o
  filtro `DASH.ID_DASH = <n>` por `@ID_DASH`; se o script mudar e a troca não acontecer, o
  servidor não sobe (melhor que consultar o dashboard errado).
- Resultado em cache de 5 min por instância; uma ida ao banco atende todos os usuários.
- Pool com `encrypt: true`, falha de conexão memorizada por 30 s, pool fechado no `SIGTERM`.

**Acesso**
- Identidade só pelo `X-Forwarded-Email` do proxy do Databricks Apps (não forjável pelo navegador).
- Deny by default: sem cabeçalho, sem cadastro, sem matrícula ou erro de banco ⇒ negado.
- Só o acesso autorizado vai para o cache (10 min); negativa nunca.
- No Portal, quem decide é o `portal-acesso.js` do Portal; `acesso.js` é só do standalone.

**Arquivos**
- Só `index.html` sai do servidor. Não existe `express.static` para esta pasta; código, `.sql`,
  `.env`, `app.yaml`, docs e testes respondem 404 (coberto pelos testes).
- Cabeçalhos: helmet (nosniff, frame-options, referrer…), sem `X-Powered-By`, API com `no-store`.
  CSP/COEP/COOP desligados pelo mesmo motivo do Kaizen (scripts e estilos inline).

**Segredos**
- `AZURE_SQL_USER`/`AZURE_SQL_PASSWORD` só por `valueFrom` (App resources do Databricks).
- Criar os resources **antes** do deploy (lição do incidente do Kaizen em 20/09/2026).
- `npm run verifica-segredos` precisa terminar em OK antes de qualquer publicação.

**Página**
- Dados reais pela API; se ela não responder, a página usa os valores de exemplo e o selo avisa.
- Identidade visual do VBM Performance Hub (ver a skill `vbm-ecossistema` na raiz do repositório).
