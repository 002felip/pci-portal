# AIP Goals — banco de dados

Scripts SQL do time de dados para a aplicação, no padrão das demais pastas do Portal: `00N_<assunto>.sql`, lidos
pela API **como foram entregues** (só literais viram parâmetros, com contagem conferida em teste).

## Situação

Nenhum script ainda: o **modelo de dados está em validação com o time de dados (pendência P-12)**. Até lá,
`AIPGOALS_FONTE=exemplo` (padrão) faz a API responder com `dados-exemplo.js`; com `AIPGOALS_FONTE=banco`, as rotas
respondem 501 até os scripts abaixo existirem.

## Modelo proposto (Especificação técnica §9)

| Tabela | Conteúdo |
|---|---|
| `AIP_CICLO` | ano, nome, janelas (desdobramento, proposta, calibração, oficial), textos padrão, status |
| `AIP_CICLO_BU` | BU do ciclo, país, ativo |
| `AIP_PAPEL` | matrícula, ciclo, BU (nula para aprovadores e administrador), papel (contribuidor, aprovador, consulta, administrador), ativo |
| `AIP_NIVEL` | ciclo, nível (CEO, COO, BU, GG, GA), nome, total por unidade, herdado do nível acima, ativo |
| `AIP_UNIDADE` | ciclo, nível, unidade, nome, unidade-mãe |
| `AIP_META` | ciclo, nível, número, título, tipo, polaridade, ativo |
| `AIP_META_PESO` | meta, unidade, peso |
| `AIP_GOAL_CARD` | estado atual, versão oficial, rascunho corrente |
| `AIP_GOAL_CARD_VERSAO` | snapshot imutável dos campos, vN, motivo, autor, data |
| `AIP_DECISAO` | versão, decisão, comentário, decidido por, data (nível único, D-09) |
| `AIP_REVISAO_SECAO` | decisão, seção, marcação (OK ou Ajustar) |
| `AIP_COMENTARIO` | card, seção, texto, autor, data, resposta a |
| `AIP_EVENTO_LOG` | tipo, quem, papel, quando, BU, meta, seção, antes, depois |
| `AIP_NOTIFICACAO` | destinatário, evento, canal, enviado em, lido em |
| `AIP_PARAMETRO` | limites configuráveis (caracteres mínimos, tamanho de anexo) |

A antiga `AIP_ACAO` saiu do modelo com a descontinuação da T08 Ações (D-20).

Fases 2 e 3: `AIP_CHANGE_REQUEST` e `AIP_EVIDENCIA`. Esquema (`IBP` ou próprio) a definir com o time de dados.

## Consultas que a API vai precisar

| Script previsto | Rota | Parâmetros |
|---|---|---|
| `001_ciclo_ativo.sql` | `/inicio`, `/painel` | — |
| `002_papeis_usuario.sql` | `/inicio` (papéis para o menu) | `@email`, `@ciclo` |
| `003_goal_cards_ciclo.sql` | `/painel` (T02) | `@ciclo` (filtro País › BU aplicado na API) |
| `004_papeis_usuario.sql` | autorização (AC-01 a AC-07) | `@email`, `@ciclo` |
