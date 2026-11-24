# AIP Goals — banco de dados

As telas leem e gravam no **Azure SQL**, no schema próprio **`PM`**. A conexão é a mesma do Kaizen e do Performance Hub:
mesmo servidor e login do `app.yaml`. Só o banco muda, em `AIPGOALS_AZURE_SQL_DATABASE`. Começa em `BDIBPBMSA_DEV` e depois
passa para `BDIBPBMSA_PRD`. A aplicação não tem mais dados de exemplo: os de exemplo ficam só nos testes (`tests/`).

| Script | O que faz | Quando rodar |
|---|---|---|
| `001_pm_criar_tabelas.sql` | Cria o schema `PM`, as 9 tabelas, as restrições, os índices, o gatilho que torna o log imutável e as FKs para `IBP.SITES` | Uma vez por banco. Pode repetir: só cria o que falta |
| `002_pm_carga_inicial.sql` | Cria o 1º ciclo aberto, a meta nº 0 da BU (resultado do COO) e o 1º administrador | Uma vez, depois do 001, com a sua matrícula preenchida |

## Ordem de ligação (passo a passo)

### 1. Banco (SSMS ou Azure Data Studio, no `BDIBPBMSA_DEV`)
1. Rode `001_pm_criar_tabelas.sql` inteiro. No fim, a consulta de conferência lista as 9 tabelas.
   - Se aparecer o aviso "IBP.SITES não existe neste banco", o DEV não tem a tabela de sites. A aplicação lista as BUs pela `IBP.SITES`: copie-a do PRD ou aponte `AIPGOALS_SITES_TABELA` para outra tabela com as colunas `ID_SITE`, `NM_SITE` e `NM_PAIS`.
   - Se quem rodou o script **não** for o login do app (`AZURE_SQL_USER`), descomente o `GRANT ... ON SCHEMA::PM` do fim do script.
2. Rode `002_pm_carga_inicial.sql` (já com o administrador 81059384, felipe.santos.souza@vale.com, e o ciclo AIP 2027).

### 2. Aplicação
3. O `app.yaml` da raiz já tem `AIPGOALS_AZURE_SQL_DATABASE = BDIBPBMSA_DEV`. Publique e reinicie o Portal.
4. Confira `/VBM-Aip-Goals/api/health`. `{"status":"healthy"}` quer dizer que o app chegou ao banco e à `PM.AIP_CICLO`. Se vier `unhealthy`, o motivo está no log do app, com a tag `[vbm-aip-goals]`.

### 3. Telas, nesta ordem (cada uma depende da anterior)
| # | Tela | Lê | Grava | O que conferir |
|---|---|---|---|---|
| 1 | **Início** | `AIP_CICLO`, `AIP_PAPEL`, `IBP.USERS` | — | Nome do ciclo e etapa atual vindos da carga inicial; o menu mostra Administração (você é admin) |
| 2 | **Administração › Ciclo** | `AIP_CICLO` | `AIP_CICLO`, `AIP_EVENTO_LOG` | Mude uma data e salve; ao recarregar, a data continua (1º teste de gravação) |
| 3 | **Administração › Grupos** | `AIP_PAPEL`, `IBP.USERS` (diretório) | `AIP_PAPEL` | Inclua o grupo de aprovação e os outros administradores; pode salvar sozinha |
| 4 | **Administração › Business Units** + **Metas e pesos** | `AIP_CICLO_SITE`, `IBP.SITES`, `AIP_META`, `AIP_META_PESO` | as mesmas + `AIP_GOAL_CARD` (criados ao salvar) | Ver abaixo: as duas abas se salvam juntas |
| 5 | **Administração › Exceções** | `AIP_CICLO_SITE` | `AIP_CICLO_SITE` | Texto por site; aparece no Goal Card da BU |
| 6 | **Administração › Grupos** (de novo) | `AIP_PAPEL` | `AIP_PAPEL` | Contribuidores por BU, já com as BUs cadastradas |
| 7 | **COO AIP** | `AIP_CICLO`, `AIP_META`, `AIP_META_PESO`, `AIP_GOAL_CARD` | — | Matriz CEO → COO → BUs com os pesos cadastrados |
| 8 | **AIP BU's** | `AIP_GOAL_CARD`, `AIP_META_PESO` | — | Um Goal Card por meta com peso em cada BU, todos em Rascunho |
| 9 | **Goal Card** (como contribuidor) | `AIP_GOAL_CARD`, `AIP_GOAL_CARD_VERSAO`, `AIP_EVENTO_LOG` | `DS_RASCUNHO`, depois a `VERSAO` v1 | "Salvar rascunho" grava no banco; "Submeter" cria a v1 e o card vai para Em aprovação |
| 10 | **Aprovações** (como aprovador, outra pessoa) | os mesmos | decisão na `VERSAO`, estado do card, eventos | Devolver com ajuste → o card volta Devolvido, com o comentário na seção; resubmeter → v2; aprovar → oficial |
| 11 | **Versões** e **Action Log** | `AIP_GOAL_CARD_VERSAO`, `AIP_EVENTO_LOG` | — | Todas as ações anteriores aparecem, com quem e quando (horário de Brasília) |

**Por que BUs e Metas e pesos se salvam juntas:** a regra RN-16 exige que cada nível feche 100 pts: CEO = 100, COO =
herdados + metas do COO, e cada BU = herdados + metas da BU. Num banco vazio nada fecha ainda, então o botão Salvar fica
travado até você:
- incluir as BUs (o nome precisa ser um site da `IBP.SITES`; a tela sugere a lista e preenche o país);
- cadastrar as metas do CEO (somando 100), as do COO (somando 100 − herdados) e as da BU, com o peso de cada BU somando 100 − herdados.

Ao salvar, a aplicação cria os Goal Cards de cada BU: um por meta com peso, mais o "COO's Scorecard Result" quando há
pontos herdados. O código é `GC-<3 letras do site>-<nº da meta>`, como `GC-SAL-01`.

### 4. Passar para produção
1. Rode `001` e `002` no `BDIBPBMSA_PRD`, com a matrícula do administrador de produção.
2. No `app.yaml`, troque `AIPGOALS_AZURE_SQL_DATABASE` para `BDIBPBMSA_PRD`, publique e repita o passo 4 da aplicação.
3. Os dados do DEV não passam para o PRD: cadastre o ciclo de produção pela Administração.

## Como a aplicação usa o banco

- **Quem é o usuário:** o e-mail do proxy (`X-Forwarded-Email`) vira matrícula pela `IBP.USERS`. No Portal, essa consulta usa a conexão do PRD, a mesma do controle de acesso. Os papéis são as linhas ativas da `PM.AIP_PAPEL` no ciclo atual. Nome, e-mail e cargo também vêm da `IBP.USERS`; sem nome cadastrado, a tela mostra a matrícula.
- **Ciclo atual:** é o aberto ou, se não houver, o mais recente, para que a Administração possa reabrir ou abrir o próximo. "Novo ciclo" copia BUs, grupos, metas e pesos e passa as datas para o ano seguinte.
- **Gravações** são transacionais: ou grava tudo, ou nada. Cada uma gera um evento no `AIP_EVENTO_LOG`. Os comentários e os ajustes pedidos na devolução são eventos `COMENTARIO`. Tentativas sem permissão geram `ACESSO_NEGADO`.
- **SQL:** fica em `aip-goals-banco.js`, sempre parametrizado (`@nome`). Nada da requisição é concatenado.

Diferenças em relação ao DER (`der/modelo.sql`, PostgreSQL):
- schema `PM`;
- `CD_GOAL_CARD` único por ciclo, garantido pela aplicação, porque o mesmo código volta em cada ciclo;
- texto digitado em `NVARCHAR`;
- datas de auditoria por `SYSDATETIME()` em UTC, mostradas no horário de Brasília (`AIPGOALS_FUSO`).

## Modelo (versão de 19/11/2026)

DER navegável em `der/der.html`; DDL de referência em `der/modelo.sql`. São 9 tabelas, mais a `IBP.SITES`, que já
existe e é a BU.

| Grupo | Tabelas |
|---|---|
| Ciclo e pessoas | `AIP_CICLO` (um aberto por vez; datas das 4 etapas; pontos herdados pelo COO e pelas BUs), `AIP_PAPEL` (matrícula, grupo e, para contribuidor, o site) |
| Desdobramento | `AIP_CICLO_SITE` (site no ciclo: participa, diretor e exceção), `AIP_META` (CEO, COO e BU; peso do CEO e do COO), `AIP_META_PESO` (peso da BU por site) |
| Goal Card | `AIP_GOAL_CARD` (estado e rascunho), `AIP_GOAL_CARD_VERSAO` (seções congeladas e decisão) |
| Log e avisos | `AIP_EVENTO_LOG` (imutável, por gatilho), `AIP_NOTIFICACAO` (ainda sem envio) |

Convenções do Schema IBP:
- prefixos de campo `ID_`, `NM_`, `DS_`, `DT_`, `NO_`, `CD_`, `TP_`, `SG_` (`'S'`/`'N'`), `QTDE_` e `VL_`;
- nomes de restrição `PK_`, `FK_<FILHA>_<PAI>`, `UQ_`, `CK_` e `IX_<TABELA>_FK_<PAI>`;
- toda FK tem índice de apoio.

Fases 2 e 3 (fora deste script): `AIP_CHANGE_REQUEST` e `AIP_EVIDENCIA`.
