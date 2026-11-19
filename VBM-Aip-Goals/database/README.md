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
| `der/schema.json`, `der/config.json`, `der/exemplos.json`, `der/montar_config.py`, `der/tipos_ibp.py` | Entradas para gerar o DER de novo (skill-der-model) quando o modelo mudar |

Convenções tiradas do Schema IBP (`BDIBPBMSA_PRD`, levantamento de 21/10/2026):

| Item | Padrão adotado | Como está no IBP |
|---|---|---|
| Tabelas | Prefixo da aplicação: `AIP_` | `PM_COMENTARIO`, `PM_CONFIGURACAO` |
| Campos | `ID_`, `NM_`, `DS_`, `DT_`, `NO_`, `CD_`, `TP_`, `SG_`, `QTDE_`, `VL_` | `ID_KPI`, `NM_SITE`, `DS_COMENTARIO`, `TP_OPERACAO` |
| Sim/não | `SG_` em `char(1)` com `'S'`/`'N'` | `CONTROLE_PROCESSOS.SG_ATIVO char(1)` |
| Período | `DT_INI` / `DT_FIM` | `CONTROLE_PROCESSOS.DT_INI`, `DT_FIM` |
| Pessoa | `CD_MATRICULA` (dados no MDM) | `USERS.CD_MATRICULA`, `DS_EMAIL` |
| Auditoria | `DT_ATUALIZACAO` + matrícula de quem fez | `DT_ATUALIZACAO` nos `LOG_*` |
| Tipos | `int`, `varchar(n)`, `char(1)`, `date`, `datetime2(0)`, `decimal`, JSON em `nvarchar(max)` | `int`, `varchar`, `date`, `datetime2(0)` |
| Restrições | `PK_<TABELA>`, `FK_<FILHA>_<PAI>`, `UQ_`, `CK_`, `IX_<TABELA>_FK_<PAI>` | `PK_VISAO`, `FK_CONTROLE_ACESSO_ASS_KPI`, `IX_DISPERSAO_FK_PEDRAVISAODIARIA` |
| BU = site | A BU é o site da `IBP.SITES`: `ID_SITE` é o ID da BU em todo o modelo (sem tabela de BU própria) | `SITES (ID_SITE, ID_SISTEMA, NM_SITE, NM_PAIS, SG_REGIAO)` |

Todas as FKs têm índice de apoio e nome explícito (o relatório do IBP aponta 49 FKs sem índice na filha e nomes
gerados automaticamente).

10 tabelas do AIP + a `IBP.SITES` (existente; no DER aparece em cinza, só para mostrar as ligações):

| Grupo | Tabelas |
|---|---|
| Ciclo e pessoas | `AIP_CICLO` (só um aberto por vez, com as datas das 4 etapas), `AIP_PAPEL` (matrícula; nome, e-mail, cargo, estado e cidade vêm do MDM) |
| Desdobramento | `AIP_NIVEL` (obrigatório/opcional, herdado), `AIP_UNIDADE` (a unidade de nível BU é a BU no ciclo, com `SG_ATIVA`), `AIP_META`, `AIP_META_PESO` |
| Goal Card | `AIP_GOAL_CARD`, `AIP_GOAL_CARD_VERSAO` (com a decisão e a marcação das seções) |
| Log e avisos | `AIP_EVENTO_LOG` (imutável, por gatilho; os comentários do Goal Card são eventos COMENTARIO), `AIP_NOTIFICACAO` |

Mudanças desta versão: ciclo com status e fechamento (um aberto, fechar, reabrir, abrir a partir de outro), datas das 4
etapas como colunas do `AIP_CICLO` (eram `AIP_CICLO_JANELA`), BU = site da `IBP.SITES` (`ID_SITE`), participação da BU no ciclo na
`AIP_UNIDADE` de nível BU (era `AIP_CICLO_BU`), nível com obrigatório/opcional, meta com origem
(desdobrada de), papel por matrícula do MDM. Revisão enxuta (de 16 para 10 tabelas): decisão e revisão das seções
viraram colunas da `AIP_GOAL_CARD_VERSAO` (eram `AIP_DECISAO` e `AIP_REVISAO_SECAO`), comentários viraram eventos do log
(era `AIP_COMENTARIO`) e GG e GA ficaram fora no primeiro momento (a `AIP_UNIDADE` perdeu a unidade-mãe). Saiu `AIP_PARAMETRO` (limites ficam na aplicação) e, antes, `AIP_ACAO` (D-20).

Fases 2 e 3: `AIP_CHANGE_REQUEST` e `AIP_EVIDENCIA`. Esquema (`IBP` ou próprio) a definir com o time de dados.

## Consultas que a API vai precisar

| Script previsto | Rota | Parâmetros |
|---|---|---|
| `001_ciclo_ativo.sql` | `/inicio`, `/painel` | — |
| `002_papeis_usuario.sql` | `/inicio` (papéis para o menu) | `@email`, `@ciclo` |
| `003_goal_cards_ciclo.sql` | `/painel` (T02) | `@ciclo` (filtro País › BU aplicado na API) |
| `004_papeis_usuario.sql` | autorização (AC-01 a AC-07) | `@email`, `@ciclo` |
