# AIP Goals — banco de dados

Scripts SQL do time de dados para a aplicação, no padrão das demais pastas do Portal: `00N_<assunto>.sql`, lidos
pela API **como foram entregues** (só literais viram parâmetros, com contagem conferida em teste).

## Situação

Nenhum script ainda: o **modelo de dados está em validação com o time de dados (pendência P-12)**. Até lá,
`AIPGOALS_FONTE=exemplo` (padrão) faz a API responder com `dados-exemplo.js`; com `AIPGOALS_FONTE=banco`, as rotas
respondem 501 até os scripts abaixo existirem.

## Modelo proposto (versão de 19/11/2026)

DDL, exemplos e DER em `der/`:

| Arquivo | Conteúdo |
|---|---|
| `der/der.html` | DER navegável (abra no navegador): clique numa tabela para ver cada campo explicado, com exemplos, ligações e regras |
| `der/modelo.sql` | DDL proposto, testado em PostgreSQL 16 (a versão T-SQL para o Azure SQL sai dele com o time de dados) |
| `der/exemplos.sql` | Dados fictícios que passam por todas as regras |
| `der/schema.json`, `der/config.json`, `der/exemplos.json`, `der/montar_config.py` | Entradas para gerar o DER de novo (skill-der-model) quando o modelo mudar |

16 tabelas, padrão IBP de nomes (ID_, NM_, DS_, DT_, NO_, CD_, TP_, SG_, QTDE_, VL_):

| Grupo | Tabelas |
|---|---|
| Ciclo e pessoas | `AIP_CICLO` (só um aberto por vez), `AIP_CICLO_JANELA`, `AIP_PAPEL` (matrícula; nome, e-mail, cargo, estado e cidade vêm do MDM) |
| Desdobramento | `AIP_BU`, `AIP_CICLO_BU`, `AIP_NIVEL` (obrigatório/opcional, herdado), `AIP_UNIDADE`, `AIP_META`, `AIP_META_PESO` |
| Goal Card | `AIP_GOAL_CARD`, `AIP_GOAL_CARD_VERSAO`, `AIP_DECISAO`, `AIP_REVISAO_SECAO`, `AIP_COMENTARIO` |
| Log e avisos | `AIP_EVENTO_LOG` (imutável, por gatilho), `AIP_NOTIFICACAO` |

Mudanças desta versão: ciclo com status e fechamento (um aberto, fechar, reabrir, abrir a partir de outro), janelas em
tabela própria, cadastro de BU separado da participação no ciclo, nível com obrigatório/opcional, meta com origem
(desdobrada de), papel por matrícula do MDM. Saiu `AIP_PARAMETRO` (limites ficam na aplicação) e, antes, `AIP_ACAO` (D-20).

Fases 2 e 3: `AIP_CHANGE_REQUEST` e `AIP_EVIDENCIA`. Esquema (`IBP` ou próprio) a definir com o time de dados.

## Consultas que a API vai precisar

| Script previsto | Rota | Parâmetros |
|---|---|---|
| `001_ciclo_ativo.sql` | `/inicio`, `/painel` | — |
| `002_papeis_usuario.sql` | `/inicio` (papéis para o menu) | `@email`, `@ciclo` |
| `003_goal_cards_ciclo.sql` | `/painel` (T02) | `@ciclo` (filtro País › BU aplicado na API) |
| `004_papeis_usuario.sql` | autorização (AC-01 a AC-07) | `@email`, `@ciclo` |
