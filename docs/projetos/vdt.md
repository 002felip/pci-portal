# VBM Value Driver Tree (VDT)

Árvores de direcionadores de valor (FCF geral e regional, produção, custo). Permite importar e
publicar datasets, comparar contextos (Actuals, Budget, LoBP, Benchmark) e simular cenários com
fórmulas.

- **Endereço:** `/VBM-Vdt/`
- **Código:** `VBM-Vdt/` (versão em `VERSION`, hoje `2026.10.1`)
- **Acesso:** aberto, sem a regra `IBP.USERS`, por decisão do negócio
- **Stack:** Python, FastAPI + uvicorn, SQLite, openpyxl; front-end compilado em `app/static/`
- **Documento da pasta:** `PORTAL.md` (o que muda dentro do Portal)

## Como roda no Portal

- Processo filho do Portal (ver [portal-nucleo.md](portal-nucleo.md#aplicações-python-apps-pythonjs)):
  `python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8101`, o mesmo comando
  do app standalone.
- O Portal encaminha `/VBM-Vdt/...` sem o prefixo, então o VDT funciona como se estivesse na raiz.
- O front-end compilado pede `/assets/...` e `/api/...`. O Portal **reescreve** esses caminhos
  (`reescrever: true`) em HTML, CSS e JS. Um build novo funciona só copiando a pasta, sem recompilar.
- **Saúde:** `/VBM-Vdt/api/health` (do VDT, com a versão) e `/VBM-Vdt/__estado` (do Portal).
- O log usa o prefixo `[vbm-vdt]`.

## Estrutura

```
VBM-Vdt/
├── app/
│   ├── main.py                create_app(): conexão SQLite, schema, routers, SPA estática
│   ├── domain/                enums e modelos (Dataset, Tree, Node, Formula, Value…)
│   ├── infrastructure/        db.py (conexão + apply_schema), db/sqlite (DDL), version.py
│   ├── modules/
│   │   ├── imports/           validação, issues, diff de estrutura, publicação, arquivo
│   │   ├── datasets/          repositórios (árvore, estrutura, valores, períodos), grafo, causa raiz
│   │   ├── formulas/          tokens, parser, AST, avaliador, dependências
│   │   ├── comparisons/       seleção, favorabilidade, comparação de árvores
│   │   └── simulations/       baseline + overrides → avaliação
│   └── static/                front-end compilado (index.html + assets/)
├── vdt.db                     banco SQLite publicado
├── requirements.txt           fastapi, uvicorn[standard], openpyxl, python-multipart (versões fixas)
├── app.yaml                   só para o app standalone
└── PORTAL.md
```

## Domínio

| Conceito | Valores |
|---|---|
| Dataset | `REGION` ou `GLOBAL`, com ciclos de revisão (`vdt_dataset_cycle`) |
| Árvore (`TreeType`) | `GENERAL_FCF`, `REGIONAL_FCF`, `PRODUCTION`, `COST`; pares de árvores (`vdt_tree_pair`) |
| Nó (`NodeType`) | `GROUP`, `INPUT`, `CALCULATED` (com fórmula e dependências) |
| Contexto do valor | `ACTUALS`, `BUDGET`, `LOBP`, `BENCHMARK` |
| Status do valor | `AVAILABLE`, `MISSING`, `MISSING_DEPENDENCY`, `NOT_INFORMED`, `CALCULATION_ERROR` |
| Direção favorável | `HIGHER_IS_BETTER`, `LOWER_IS_BETTER`, `NEUTRAL` |

- **Fórmulas:** os nós calculados têm fórmula própria (`modules/formulas`: tokenizador, parser para
  AST e avaliador), e as dependências entre nós formam um grafo.
- **Erros de cálculo:** vão para `vdt_calculation_issue`.

## API

| Rota | O que faz |
|---|---|
| `GET /api/health` | saúde e versão |
| `POST /api/imports/validate` | recebe o Excel (multipart), valida e devolve as issues e o diff de estrutura |
| `GET /api/imports/{import_id}` | estado de uma importação |
| `POST /api/imports/{import_id}/publish` | publica a importação validada no banco |
| `GET /api/datasets` | datasets disponíveis |
| `GET /api/datasets/{dataset_id}/selections` | combinações válidas para comparar |
| `GET /api/datasets/{dataset_id}/dependencies?revision_cycle_year=` | grafo de dependências |
| `GET /api/trees/{tree_id}/comparison` | comparação entre contextos e períodos, com favorabilidade |
| `POST /api/simulations/evaluate` | avalia um cenário: baseline (contexto, ano de referência, ciclo) + overrides |

Rotas que não existem no servidor caem no `index.html` (SPA) em vez de dar 404.

## Dados (SQLite)

- **Arquivo:** `VDT_DB_PATH`. No Portal, o padrão é `vdt.db` dentro da pasta. Fora do Portal, o
  padrão do código é `:memory:`.
- **Tabelas:**
  - referência: `ref_region`, `ref_revision_cycle`, `ref_unit`, `ref_reporting_period`;
  - árvores: `vdt_dataset`, `vdt_dataset_cycle`, `vdt_global_region_reference`, `vdt_tree`,
    `vdt_tree_pair`, `vdt_tree_structure`, `vdt_tree_node`, `vdt_node_formula`,
    `vdt_node_dependency`, `vdt_node_value`, `vdt_calculation_issue`;
  - auditoria: `audit_import_batch`, `audit_user_session`, `audit_application_event`.
- **Schema:** `apply_schema` roda a cada subida.
- **Concorrência:** há uma conexão compartilhada, e as gravações são serializadas por um lock.
- **Arquivo das importações:** `VDT_ARCHIVE_DIR`, opcional.

## Atualizar a versão

1. Substitua o conteúdo da pasta, **mantendo `PORTAL.md` e `.gitignore`**.
2. Se as dependências mudarem, atualize também o `requirements.txt` da raiz.

## Pontos de atenção

- **`vdt.db` não é persistente.** Um deploy volta ao arquivo do repositório, e o que foi publicado pelo
  app e não está no `vdt.db` novo se perde. Substituir a pasta também substitui o banco. Para os
  dados sobreviverem, aponte `VDT_DB_PATH` para um armazenamento persistente.
- **Acesso aberto**, e não há controle de quem publica além da auditoria interna.
