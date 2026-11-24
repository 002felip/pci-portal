# VBM - AIP Goals

Definição, aprovação e registro das **metas de AIP** das Business Units de VBM (Brasil, Canadá e International Refineries): leva cada meta
do desdobramento do COO até o **Goal Card** aprovado, versionado e rastreável, no lugar do PPT e do e-mail.
Endereço: `/VBM-Aip-Goals/`, aplicação da raiz do Portal, montada pelo `server.js` da raiz depois do controle de
acesso do Portal (`IBP.USERS` com `CD_MATRICULA`).

Documento técnico completo: [`docs/projetos/aip-goals.md`](../docs/projetos/aip-goals.md). Especificação e levantamento
de requisitos: [`docs/ESPECIFICACAO-TECNICA.md`](docs/ESPECIFICACAO-TECNICA.md) e
[`docs/LEVANTAMENTO-REQUISITOS.md`](docs/LEVANTAMENTO-REQUISITOS.md).

## Telas (página única, vistas pelo hash)

| Vista | Tela | Situação |
|---|---|---|
| `#inicio` (padrão) | T00 Início — abertura do ciclo AIP com a jornada do ciclo na vertical | publicada |
| `#desdobramento` | COO AIP — scorecard do COO e matriz meta × BU com peso e situação dos Goal Cards | publicada |
| `#painel` | T02 Painel do ciclo — jornada com anéis por etapa, matriz BU × situação, funil, tempo por nível e cards parados (P&CI/COO e administrador) | publicada |
| `#metas` | T03 AIP BU's — jornada do ciclo da BU e tabela de metas (peso em cascata, Status, Contribuidor, Versão, Última atualização); Abrir mostra o Goal Card em popup | publicada |
| `#goal-card?card=` | T04 Goal Card — ficha de cadastro da meta pelos contribuidores e pelo administrador (campos obrigatórios, Salvar rascunho e Submeter, comentários em pop-up); leitura para os demais | publicada |
| `#versoes?card=` | T06 Versões — linha das versões e comparação campo a campo | publicada |
| `#action-log` | T07 Action Log — linha do tempo do ciclo com filtros e exportação (item do menu) | publicada |
| `#configuracao` | T11 Configuração do ciclo — ciclo, BUs, grupos, metas e pesos, parâmetros (só o administrador) | publicada |
| `#aprovacoes` | T14 Aprovações — fila das fichas em aprovação, revisão OK/Ajustar e comentários por seção e decisão Aprovar/Devolver (só o grupo de aprovação) | pronta |

Painel do ciclo (T02): oculto, fora do menu e sem rota (`#painel` volta ao Início); a tela segue no código e reativa-se devolvendo o link e o item em `VISTAS`.

Menu: Início · COO AIP · AIP BU's · Aprovações · Action Log · Administração. T05 e T08 foram descontinuadas (D-20). Todas as telas ocupam a largura da janela; em tela cheia, a barra com o menu continua visível.

Uso em **notebook e desktop** (1024 px a 4K); celular fora do escopo.

## Estrutura

```
VBM-Aip-Goals/
├── index.html          página única (tokens vbm-design e barra setup-dashboards embutidos)
├── assets/
│   ├── css/poppins.css         Poppins local
│   └── images/                 fundos dos três minerais (claro e original)
├── portal.js           montagem no Portal: pool próprio, /api/health, router, bloqueio dos arquivos internos
├── aip-goals-api.js    rotas e regras (o mesmo router no Portal e no standalone)
├── aip-goals-banco.js  leitura e gravação no Azure SQL (schema PM)
├── server.js           app standalone para desenvolvimento (porta 8020)
├── database/           scripts do schema PM e ordem de ligação (ver database/README.md)
├── docs/               especificação técnica e levantamento de requisitos
├── tests/              testes node --test (os dados de exemplo ficam só aqui)
└── package.json
```

Da pasta, só `index.html` e `assets/` são públicos; o resto responde 404 (`portal.js`).

## API (`/VBM-Aip-Goals/api`)

| Rota | O que faz |
|---|---|
| `GET /inicio` | T00: ciclo ativo e papéis do usuário (identidade pelo `X-Forwarded-Email`) |
| `GET /painel?pais=&bu=` | T02: agregados do ciclo, só P&CI/COO e administrador; filtro validado |
| `GET /metas?bu=` | T03: metas de uma BU no recorte do usuário (fora do recorte → 404), com o contribuidor de cada card |
| `GET /desdobramento` | Desdobramento: scorecard do COO e matriz meta × BU |
| `GET /versoes?card=` | T06: versões do Goal Card |
| `GET /action-log` | T07: eventos filtrados e paginados |
| `GET /configuracao` · `POST /configuracao/salvar` · `POST /configuracao/ciclo` | T11: só o administrador; RN-16 validada no servidor; fechar, reabrir e abrir o próximo ciclo |
| `GET /goal-card?card=` · `POST /goal-card/rascunho` · `POST /goal-card/submeter` · `POST /goal-card/reabrir` · `POST /goal-card/decisao` | T04: Goal Card; escritas validadas e gravadas |
| `GET /aprovacoes` · `POST /goal-card/comentario` | T14: fila do grupo de aprovação e comentário por seção (só o grupo de aprovação) |
| `GET /health` · `GET /ping` | saúde e diagnóstico |

## Rodar e testar

```bash
npm test
NODE_ENV=development AIPGOALS_EMAIL_LOCAL=voce@vale.com AIPGOALS_AZURE_SQL_DATABASE=BDIBPBMSA_DEV \
  AZURE_SQL_SERVER=... AZURE_SQL_USER=... AZURE_SQL_PASSWORD=... node server.js   # http://localhost:8020/VBM-Aip-Goals/
```

Variáveis: `AIPGOALS_AZURE_SQL_DATABASE` (`BDIBPBMSA_DEV`, depois `BDIBPBMSA_PRD`), as de conexão do Portal (`AZURE_SQL_*`)
e, opcionais, `AIPGOALS_SITES_TABELA` (padrão `IBP.SITES`) e `AIPGOALS_FUSO` (padrão `America/Sao_Paulo`). Detalhe em
`docs/projetos/aip-goals.md`.

## Pendências

- **Banco:** tabelas no schema `PM` (`database/001_pm_criar_tabelas.sql`) e carga inicial (`002`); ordem de ligação
  das telas em `database/README.md`. Começa no `BDIBPBMSA_DEV`.
- **Aprovação em nível único (D-09)** pelo grupo de aprovação, com os grupos contribuidores, aprovadores e consulta (D-10). O protótipo ainda mostra dois níveis e os papéis antigos; o ajuste entra na próxima entrega.
- **Leitura aberta e regras ajustadas (D-11, D-12, D-16):** todos veem todas as BUs; editam os contribuidores da BU e o administrador; sem alerta de pendência parada; soma dos pesos validada na gravação; card Aprovado reabre só na janela inicial do ciclo.
- Card do AIP Goals na página inicial do Portal.
