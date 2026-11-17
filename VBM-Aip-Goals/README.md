# VBM - AIP Goals

Definição, aprovação e registro das **metas de AIP** das Business Units de VBM (Brasil e Canadá): leva cada meta
do desdobramento do COO até o **Goal Card** aprovado, versionado e rastreável, no lugar do PPT e do e-mail.
Endereço: `/VBM-Aip-Goals/`, aplicação da raiz do Portal, montada pelo `server.js` da raiz depois do controle de
acesso do Portal (`IBP.USERS` com `CD_MATRICULA`).

Documento técnico completo: [`docs/projetos/aip-goals.md`](../docs/projetos/aip-goals.md). Especificação e levantamento
de requisitos: [`docs/ESPECIFICACAO-TECNICA.md`](docs/ESPECIFICACAO-TECNICA.md) e
[`docs/LEVANTAMENTO-REQUISITOS.md`](docs/LEVANTAMENTO-REQUISITOS.md).

## Telas (página única, vistas pelo hash)

| Vista | Tela | Situação |
|---|---|---|
| `#inicio` (padrão) | T00 Início — abertura do ciclo AIP, jornada e índice das telas | publicada |
| `#pendencias` | T01 Minhas pendências — fila pessoal com filtros e status | publicada |
| `#painel` | T02 Painel do ciclo — jornada com anéis por etapa, matriz BU × situação, funil, tempo por nível e cards parados (P&CI/COO e administrador) | publicada |
| `#goal-card?card=` | T04 Goal Card — edição (contribuidores), análise (grupo de aprovação) ou leitura, com pré-checagem, revisão por seção, decisão e comentários | publicada |
| `#desdobramento` | T13 Desdobramento — barra do scorecard do COO em degradê (uma cor por meta), cards das metas com a fatia dos 100% em ênfase e os Goal Cards gerados nas BUs, e matriz meta × BU (peso e situação do card) | publicada |
| `#metas` | T03 Metas da BU — anéis por peso, alerta de soma dos pesos (RN-16) e tabela de metas, no recorte do usuário | publicada |
| `#goal-card`, `#action-log`, `#acoes`, `#configuracao` | T04 a T08 e T11 | "Tela em construção" |

Uso em **notebook e desktop** (1024 px a 4K); celular fora do escopo.

## Estrutura

```
VBM-Aip-Goals/
├── index.html          página única (tokens vbm-design e barra setup-dashboards embutidos)
├── assets/
│   ├── css/poppins.css         Poppins local
│   └── images/                 fundos dos três minerais (claro e original)
├── portal.js           montagem no Portal: pool próprio, /api/health, router, bloqueio dos arquivos internos
├── aip-goals-api.js    rotas de dados (o mesmo router no Portal e no standalone)
├── dados-exemplo.js    dados de exemplo até a validação do modelo de dados (P-12)
├── server.js           app standalone para desenvolvimento (porta 8020)
├── database/           scripts SQL do time de dados (ver database/README.md)
├── docs/               especificação técnica e levantamento de requisitos
├── tests/              testes node --test
└── package.json
```

Da pasta, só `index.html` e `assets/` são públicos; o resto responde 404 (`portal.js`).

## API (`/VBM-Aip-Goals/api`)

| Rota | O que faz |
|---|---|
| `GET /pendencias` | T01: fila do usuário (identidade pelo `X-Forwarded-Email`) |
| `GET /painel?pais=&bu=` | T02: agregados do ciclo, só P&CI/COO e administrador; filtro validado |
| `GET /metas?bu=` | T03: metas de uma BU no recorte do usuário (fora do recorte → 404) |
| `GET /goal-card?card=` · `POST /goal-card/submeter` · `POST /goal-card/decisao` | T04: Goal Card e escritas validadas (simulação até o P-12) |
| `GET /desdobramento` | T13: scorecard do COO e matriz meta × BU no recorte do usuário |
| `GET /health` · `GET /ping` | saúde e diagnóstico |

## Rodar e testar

```bash
npm test
NODE_ENV=development AIPGOALS_EMAIL_LOCAL=voce@vale.com node server.js   # http://localhost:8020/
```

Variáveis: `AIPGOALS_FONTE` (`exemplo` até a P-12; `banco` depois), `AIPGOALS_AZURE_SQL_DATABASE` e as de conexão do
Portal (`AZURE_SQL_*`). Detalhe em `docs/projetos/aip-goals.md`.

## Pendências

- **P-12 — modelo de dados:** validar a proposta (`database/README.md`) com o time de dados; enquanto isso as telas
  mostram "Dados de exemplo".
- **Aprovação em nível único (D-09)** pelo grupo de aprovação, com os grupos contribuidores, aprovadores e consulta (D-10). O protótipo ainda mostra dois níveis e os papéis antigos; o ajuste entra na próxima entrega.
- **Leitura aberta e regras ajustadas (D-11, D-12):** todos veem todas as BUs e só os contribuidores da BU editam; sem alerta de pendência parada; soma dos pesos validada na gravação; card Aprovado reabre só na janela inicial do ciclo.
- Card do AIP Goals na página inicial do Portal.
