-- AIP Goals — modelo de dados proposto (fase 1), versão 19/11/2026.
-- Proposta para validação com o time de dados (P-12). Testada em PostgreSQL 16 para gerar o DER, com tipos que têm
-- equivalente direto no Azure SQL do esquema IBP: integer = int, varchar(n), char(1), date, timestamp(0) = datetime2(0),
-- numeric = decimal, text (JSON) = nvarchar(max). Convenções do Schema IBP (21/10/2026): prefixo da aplicação nas
-- tabelas (como PM_), SG_ com 'S'/'N', DT_INI/DT_FIM, DS_COMENTARIO, CD_MATRICULA, DT_ATUALIZACAO, nomes PK_<TABELA>,
-- FK_<FILHA>_<PAI>, UQ_, CK_ e IX_<TABELA>_FK_<PAI> (índice de apoio em toda FK).
-- Padrão de nomes IBP: ID_ identificador, NM_ nome, DS_ descrição, DT_ data, NO_ número, CD_ código,
-- TP_ lista fixa, SG_ sim/não, QTDE_ quantidade, VL_ valor.
-- Pessoas: nome, e-mail, cargo, estado e cidade são lidos do MDM pela matrícula (CD_MATRICULA, como em IBP.USERS); o AIP guarda só a matrícula.
-- Desdobramento fixo em CEO → COO → BU (GG e GA fora no primeiro momento), 100 pts por unidade; os pontos herdados
-- ficam no AIP_CICLO e o nível é um código (CD_NIVEL) na meta e na unidade.
-- Limites das regras (mínimo de caracteres no comentário, tamanho de anexo) ficam na aplicação, fora do banco.

-- ═══ CICLO ═══
create table aip_ciclo (
  id_ciclo integer generated always as identity constraint pk_aip_ciclo primary key,
  no_ano smallint not null,
  nm_ciclo varchar(100) not null,
  tp_status varchar(20) not null default 'ABERTO',
  ds_texto_padrao_excecoes varchar(4000),
  id_ciclo_origem integer constraint fk_aip_ciclo_aip_ciclo references aip_ciclo (id_ciclo),
  dt_criacao timestamp(0) not null default localtimestamp(0),
  cd_matricula_criacao varchar(20) not null,
  dt_fechamento timestamp(0),
  cd_matricula_fechamento varchar(20),
  -- Jornada do ciclo: 4 etapas fixas; o início de cada etapa vem preenchido com o fim da anterior e pode ser alterado
  dt_ini_desdobramento date not null,
  dt_fim_desdobramento date not null,
  dt_ini_proposta date not null,
  dt_fim_proposta date not null,
  dt_ini_calibracao date not null,
  dt_fim_calibracao date not null,
  dt_ini_oficial date not null,
  dt_fim_oficial date not null,
  -- Desdobramento CEO → COO → BU: cada unidade fecha 100 pts; parte vem do resultado do nível acima
  qtde_pontos_herdados_coo smallint not null,
  qtde_pontos_herdados_bu smallint not null,
  constraint uq_aip_ciclo_ano unique (no_ano),
  constraint ck_aip_ciclo_jornada check (dt_ini_desdobramento < dt_fim_desdobramento and dt_ini_proposta < dt_fim_proposta and dt_ini_calibracao < dt_fim_calibracao and dt_ini_oficial < dt_fim_oficial
    and dt_ini_desdobramento <= dt_ini_proposta and dt_ini_proposta <= dt_ini_calibracao and dt_ini_calibracao <= dt_ini_oficial),
  constraint ck_aip_ciclo_herdados check (qtde_pontos_herdados_coo between 0 and 99 and qtde_pontos_herdados_bu between 0 and 99),
  constraint ck_aip_ciclo_ano check (no_ano between 2020 and 2100),
  constraint ck_aip_ciclo_status check (tp_status in ('ABERTO', 'FECHADO')),
  constraint ck_aip_ciclo_fechamento check ((tp_status = 'FECHADO') = (dt_fechamento is not null and cd_matricula_fechamento is not null))
);
-- Só um ciclo aberto por vez
create unique index uq_aip_ciclo_um_aberto on aip_ciclo (tp_status) where tp_status = 'ABERTO';


-- ═══ DESDOBRAMENTO ═══
-- BU = site do IBP: a tabela IBP.SITES já existe no banco (ID_SITE é o ID da BU). Aqui ela é recriada só para o
-- teste do DER, com a mesma estrutura; no Azure SQL as FKs apontam para IBP.SITES e o AIP não cria esta tabela.
create table sites (
  id_site integer constraint pk_sites primary key,
  id_sistema integer not null,
  nm_site varchar(25),
  nm_pais varchar(25),
  sg_regiao varchar(1)
);


create table aip_unidade (
  id_unidade integer generated always as identity constraint pk_aip_unidade primary key,
  id_ciclo integer not null constraint fk_aip_unidade_aip_ciclo references aip_ciclo (id_ciclo),
  cd_nivel varchar(20) not null,
  nm_unidade varchar(100) not null,
  id_site integer constraint fk_aip_unidade_sites references sites (id_site),
  sg_ativa char(1) not null default 'S' constraint ck_aip_unidade_sg_ativa check (sg_ativa in ('S', 'N')),
  -- Só nas BUs: diretor (responsável da Área Responsible, nome no MDM) e texto próprio de exceções (vazio = padrão do ciclo)
  cd_matricula_diretor varchar(20),
  ds_excecoes varchar(4000),
  constraint ck_aip_unidade_bu check (cd_nivel = 'BU' or (cd_matricula_diretor is null and ds_excecoes is null)),
  constraint uq_aip_unidade unique (id_ciclo, cd_nivel, nm_unidade),
  constraint ck_aip_unidade_nivel check (cd_nivel in ('CEO', 'COO', 'BU')),
  constraint ck_aip_unidade_site check ((cd_nivel = 'BU') = (id_site is not null))
);

create table aip_meta (
  id_meta integer generated always as identity constraint pk_aip_meta primary key,
  id_ciclo integer not null constraint fk_aip_meta_aip_ciclo references aip_ciclo (id_ciclo),
  cd_nivel varchar(20) not null,
  no_meta smallint not null,
  nm_titulo varchar(100) not null,
  tp_meta varchar(20) not null,
  tp_polaridade varchar(20) not null,
  id_meta_origem integer constraint fk_aip_meta_aip_meta references aip_meta (id_meta),
  sg_ativa char(1) not null default 'S' constraint ck_aip_meta_sg_ativa check (sg_ativa in ('S', 'N')),
  constraint uq_aip_meta unique (id_ciclo, cd_nivel, no_meta),
  constraint ck_aip_meta_nivel check (cd_nivel in ('CEO', 'COO', 'BU')),
  constraint ck_aip_meta_tipo check (tp_meta in ('FORMULA', 'MARCOS')),
  constraint ck_aip_meta_polaridade check (tp_polaridade in ('MAIOR', 'MENOR'))
);

create table aip_meta_peso (
  id_meta integer not null constraint fk_aip_meta_peso_aip_meta references aip_meta (id_meta),
  id_unidade integer not null constraint fk_aip_meta_peso_aip_unidade references aip_unidade (id_unidade),
  vl_peso numeric(6,2) not null,
  constraint pk_aip_meta_peso primary key (id_meta, id_unidade),
  constraint ck_aip_peso check (vl_peso > 0)
);

-- ═══ PESSOAS ═══
create table aip_papel (
  id_papel integer generated always as identity constraint pk_aip_papel primary key,
  id_ciclo integer not null constraint fk_aip_papel_aip_ciclo references aip_ciclo (id_ciclo),
  cd_matricula varchar(20) not null,
  tp_grupo varchar(20) not null,
  id_site integer constraint fk_aip_papel_sites references sites (id_site),
  sg_ativo char(1) not null default 'S' constraint ck_aip_papel_sg_ativo check (sg_ativo in ('S', 'N')),
  dt_atualizacao timestamp(0) not null default localtimestamp(0),
  constraint ck_aip_papel_grupo check (tp_grupo in ('CONTRIBUIDOR', 'APROVACAO', 'ADMIN')),
  constraint ck_aip_papel_bu check ((tp_grupo = 'CONTRIBUIDOR') = (id_site is not null))
);
create unique index uq_aip_papel_sem_bu on aip_papel (id_ciclo, cd_matricula, tp_grupo) where id_site is null;
create unique index uq_aip_papel_bu on aip_papel (id_ciclo, cd_matricula, tp_grupo, id_site) where id_site is not null;

-- ═══ GOAL CARD ═══
create table aip_goal_card (
  id_goal_card integer generated always as identity constraint pk_aip_goal_card primary key,
  cd_goal_card varchar(20) not null,
  id_meta integer not null constraint fk_aip_goal_card_aip_meta references aip_meta (id_meta),
  id_unidade integer not null constraint fk_aip_goal_card_aip_unidade references aip_unidade (id_unidade),
  tp_estado varchar(20) not null default 'RASCUNHO',
  no_versao_oficial smallint,
  ds_rascunho text,
  dt_atualizacao timestamp(0) not null default localtimestamp(0),
  cd_matricula_atualizacao varchar(20) not null,
  constraint uq_aip_goal_card_cd unique (cd_goal_card),
  constraint uq_aip_goal_card unique (id_meta, id_unidade),
  constraint ck_aip_goal_card_estado check (tp_estado in ('RASCUNHO', 'EM_APROVACAO', 'EM_REVISAO', 'APROVADO', 'NEGADO')),
  constraint ck_aip_goal_card_oficial check ((tp_estado = 'APROVADO') = (no_versao_oficial is not null))
);

create table aip_goal_card_versao (
  id_versao integer generated always as identity constraint pk_aip_goal_card_versao primary key,
  id_goal_card integer not null constraint fk_aip_goal_card_versao_aip_goal_card references aip_goal_card (id_goal_card),
  no_versao smallint not null,
  tp_motivo varchar(20) not null,
  ds_campos text not null,
  dt_versao timestamp(0) not null default localtimestamp(0),
  cd_matricula_autor varchar(20) not null,
  -- Decisão do grupo de aprovação sobre esta versão (nível único): gravada uma única vez
  tp_decisao varchar(20),
  ds_comentario_decisao varchar(4000),
  ds_revisao_secoes text,
  dt_decisao timestamp(0),
  cd_matricula_decisao varchar(20),
  constraint uq_aip_versao unique (id_goal_card, no_versao),
  constraint ck_aip_versao_motivo check (tp_motivo in ('SUBMISSAO', 'RESUBMISSAO', 'REABERTURA')),
  constraint ck_aip_versao_decisao check (tp_decisao in ('APROVADO', 'DEVOLVIDO', 'NEGADO')),
  constraint ck_aip_versao_decidida check ((tp_decisao is null) = (dt_decisao is null) and (tp_decisao is null) = (cd_matricula_decisao is null)),
  constraint ck_aip_versao_comentario check (tp_decisao is null or tp_decisao = 'APROVADO' or ds_comentario_decisao is not null),
  constraint ck_aip_versao_revisao check ((tp_decisao is null) = (ds_revisao_secoes is null))
);

-- ═══ LOG, COMENTÁRIOS E AVISOS ═══
-- Comentários do Goal Card são eventos COMENTARIO do log (com resposta em ID_EVENTO_PAI): imutáveis como o resto do log
create table aip_evento_log (
  id_evento integer generated always as identity constraint pk_aip_evento_log primary key,
  id_ciclo integer not null constraint fk_aip_evento_log_aip_ciclo references aip_ciclo (id_ciclo),
  tp_evento varchar(20) not null,
  dt_evento timestamp(0) not null default localtimestamp(0),
  cd_matricula varchar(20) not null,
  tp_grupo varchar(20),
  id_goal_card integer constraint fk_aip_evento_log_aip_goal_card references aip_goal_card (id_goal_card),
  cd_secao varchar(20),
  ds_comentario varchar(4000),
  id_evento_pai integer constraint fk_aip_evento_log_aip_evento_log references aip_evento_log (id_evento),
  ds_antes text,
  ds_depois text,
  constraint ck_aip_evento_comentario check (tp_evento <> 'COMENTARIO' or (ds_comentario is not null and id_goal_card is not null and cd_secao is not null)),
  constraint ck_aip_evento_tipo check (tp_evento in ('SUBMISSAO', 'RECOLHIMENTO', 'DECISAO', 'REABERTURA', 'COMENTARIO', 'CONFIGURACAO', 'CICLO_ABERTO', 'CICLO_FECHADO', 'CICLO_REABERTO', 'ACESSO_NEGADO'))
);
-- Registro imutável: nenhum evento pode ser editado ou apagado
create function aip_evento_imutavel() returns trigger language plpgsql as $$
begin raise exception 'AIP_EVENTO_LOG é imutável'; end $$;
create trigger tg_aip_evento_imutavel before update or delete on aip_evento_log for each row execute function aip_evento_imutavel();

create table aip_notificacao (
  id_notificacao integer generated always as identity constraint pk_aip_notificacao primary key,
  id_evento integer not null constraint fk_aip_notificacao_aip_evento_log references aip_evento_log (id_evento),
  cd_matricula_destino varchar(20) not null,
  tp_canal varchar(20) not null,
  dt_envio timestamp(0),
  dt_leitura timestamp(0),
  constraint ck_aip_notificacao_canal check (tp_canal in ('EMAIL', 'APP')),
  constraint ck_aip_notificacao_leitura check (dt_leitura is null or dt_envio is not null)
);

-- Índices de apoio das FKs (FK sem índice na filha é um dos alertas do relatório do Schema IBP)
create index ix_aip_ciclo_fk_aip_ciclo on aip_ciclo (id_ciclo_origem);
create index ix_aip_unidade_fk_sites on aip_unidade (id_site);
create index ix_aip_meta_fk_aip_meta on aip_meta (id_meta_origem);
create index ix_aip_meta_peso_fk_aip_unidade on aip_meta_peso (id_unidade);
create index ix_aip_papel_fk_aip_ciclo on aip_papel (id_ciclo);
create index ix_aip_papel_fk_sites on aip_papel (id_site);
create index ix_aip_goal_card_fk_aip_unidade on aip_goal_card (id_unidade);
create index ix_aip_evento_log_fk_aip_ciclo on aip_evento_log (id_ciclo);
create index ix_aip_evento_log_fk_aip_goal_card on aip_evento_log (id_goal_card);
create index ix_aip_evento_log_fk_aip_evento_log on aip_evento_log (id_evento_pai);
create index ix_aip_notificacao_fk_aip_evento_log on aip_notificacao (id_evento);
