-- AIP Goals — modelo de dados proposto (fase 1), versão 19/11/2026.
-- Proposta para validação com o time de dados (P-12). Escrita e testada em PostgreSQL 16 para gerar o DER;
-- a versão final para o Azure SQL (T-SQL) sai deste modelo com o time de dados.
-- Padrão de nomes IBP: ID_ identificador, NM_ nome, DS_ descrição, DT_ data, NO_ número, CD_ código,
-- TP_ lista fixa, SG_ sim/não, QTDE_ quantidade, VL_ valor.
-- Pessoas: nome, e-mail, cargo, estado e cidade são lidos do MDM pela matrícula (CD_MATRICULA); o AIP guarda só a matrícula.
-- Limites das regras (mínimo de caracteres no comentário, tamanho de anexo) ficam na aplicação, fora do banco.

-- ═══ CICLO ═══
create table aip_ciclo (
  id_ciclo bigint generated always as identity primary key,
  no_ano smallint not null,
  nm_ciclo text not null,
  tp_status text not null default 'ABERTO',
  ds_texto_padrao_excecoes text,
  id_ciclo_origem bigint references aip_ciclo (id_ciclo),
  dt_criacao timestamptz not null default now(),
  cd_matricula_criacao text not null,
  dt_fechamento timestamptz,
  cd_matricula_fechamento text,
  constraint uq_aip_ciclo_ano unique (no_ano),
  constraint ck_aip_ciclo_ano check (no_ano between 2020 and 2100),
  constraint ck_aip_ciclo_status check (tp_status in ('ABERTO', 'FECHADO')),
  constraint ck_aip_ciclo_fechamento check ((tp_status = 'FECHADO') = (dt_fechamento is not null and cd_matricula_fechamento is not null))
);
-- Só um ciclo aberto por vez
create unique index ux_aip_ciclo_um_aberto on aip_ciclo (tp_status) where tp_status = 'ABERTO';

create table aip_ciclo_janela (
  id_ciclo bigint not null references aip_ciclo (id_ciclo),
  tp_etapa text not null,
  no_ordem smallint not null,
  dt_inicio date,
  dt_fim date not null,
  primary key (id_ciclo, tp_etapa),
  constraint ck_aip_janela_etapa check (tp_etapa in ('DESDOBRAMENTO', 'PROPOSTA', 'CALIBRACAO', 'OFICIAL')),
  constraint ck_aip_janela_inicio check ((no_ordem = 1) = (dt_inicio is not null)),
  constraint ck_aip_janela_datas check (dt_inicio is null or dt_fim > dt_inicio),
  constraint uq_aip_janela_ordem unique (id_ciclo, no_ordem)
);

-- ═══ DESDOBRAMENTO ═══
create table aip_bu (
  id_bu bigint generated always as identity primary key,
  nm_bu text not null,
  nm_pais text not null,
  dt_criacao timestamptz not null default now(),
  constraint uq_aip_bu_nome unique (nm_bu)
);

create table aip_ciclo_bu (
  id_ciclo bigint not null references aip_ciclo (id_ciclo),
  id_bu bigint not null references aip_bu (id_bu),
  sg_ativa boolean not null default true,
  primary key (id_ciclo, id_bu)
);

create table aip_nivel (
  id_nivel bigint generated always as identity primary key,
  id_ciclo bigint not null references aip_ciclo (id_ciclo),
  cd_nivel text not null,
  no_ordem smallint not null,
  nm_nivel text not null,
  qtde_pontos_total integer not null,
  qtde_pontos_herdados integer not null default 0,
  sg_obrigatorio boolean not null,
  sg_ativo boolean not null default true,
  constraint uq_aip_nivel unique (id_ciclo, cd_nivel),
  constraint ck_aip_nivel_cd check (cd_nivel in ('CEO', 'COO', 'BU', 'GG', 'GA')),
  constraint ck_aip_nivel_total check (qtde_pontos_total between 1 and 1000),
  constraint ck_aip_nivel_herdado check (qtde_pontos_herdados >= 0 and qtde_pontos_herdados < qtde_pontos_total and (no_ordem > 1 or qtde_pontos_herdados = 0)),
  constraint ck_aip_nivel_obrigatorio check (not sg_obrigatorio or sg_ativo)
);

create table aip_unidade (
  id_unidade bigint generated always as identity primary key,
  id_nivel bigint not null references aip_nivel (id_nivel),
  nm_unidade text not null,
  id_bu bigint references aip_bu (id_bu),
  id_unidade_pai bigint references aip_unidade (id_unidade),
  constraint uq_aip_unidade unique (id_nivel, nm_unidade)
);

create table aip_meta (
  id_meta bigint generated always as identity primary key,
  id_nivel bigint not null references aip_nivel (id_nivel),
  no_meta smallint not null,
  nm_titulo text not null,
  tp_meta text not null,
  tp_polaridade text not null,
  id_meta_origem bigint references aip_meta (id_meta),
  sg_ativa boolean not null default true,
  constraint uq_aip_meta unique (id_nivel, no_meta),
  constraint ck_aip_meta_tipo check (tp_meta in ('FORMULA', 'MARCOS')),
  constraint ck_aip_meta_polaridade check (tp_polaridade in ('MAIOR', 'MENOR'))
);

create table aip_meta_peso (
  id_meta bigint not null references aip_meta (id_meta),
  id_unidade bigint not null references aip_unidade (id_unidade),
  vl_peso numeric(6,2) not null,
  primary key (id_meta, id_unidade),
  constraint ck_aip_peso check (vl_peso > 0)
);

-- ═══ PESSOAS ═══
create table aip_papel (
  id_papel bigint generated always as identity primary key,
  id_ciclo bigint not null references aip_ciclo (id_ciclo),
  cd_matricula text not null,
  tp_grupo text not null,
  id_bu bigint references aip_bu (id_bu),
  sg_ativo boolean not null default true,
  dt_inclusao timestamptz not null default now(),
  cd_matricula_inclusao text not null,
  constraint ck_aip_papel_grupo check (tp_grupo in ('CONTRIBUIDOR', 'APROVACAO', 'CONSULTA', 'ADMIN')),
  constraint ck_aip_papel_bu check ((tp_grupo in ('CONTRIBUIDOR', 'CONSULTA')) = (id_bu is not null))
);
create unique index ux_aip_papel on aip_papel (id_ciclo, cd_matricula, tp_grupo, coalesce(id_bu, 0));

-- ═══ GOAL CARD ═══
create table aip_goal_card (
  id_goal_card bigint generated always as identity primary key,
  cd_goal_card text not null,
  id_meta bigint not null references aip_meta (id_meta),
  id_unidade bigint not null references aip_unidade (id_unidade),
  tp_estado text not null default 'RASCUNHO',
  no_versao_oficial smallint,
  ds_rascunho jsonb,
  dt_atualizacao timestamptz not null default now(),
  cd_matricula_atualizacao text not null,
  constraint uq_aip_goal_card_cd unique (cd_goal_card),
  constraint uq_aip_goal_card unique (id_meta, id_unidade),
  constraint ck_aip_goal_card_estado check (tp_estado in ('RASCUNHO', 'EM_APROVACAO', 'EM_REVISAO', 'APROVADO', 'NEGADO')),
  constraint ck_aip_goal_card_oficial check ((tp_estado = 'APROVADO') = (no_versao_oficial is not null))
);

create table aip_goal_card_versao (
  id_versao bigint generated always as identity primary key,
  id_goal_card bigint not null references aip_goal_card (id_goal_card),
  no_versao smallint not null,
  tp_motivo text not null,
  ds_campos jsonb not null,
  dt_versao timestamptz not null default now(),
  cd_matricula_autor text not null,
  constraint uq_aip_versao unique (id_goal_card, no_versao),
  constraint ck_aip_versao_motivo check (tp_motivo in ('SUBMISSAO', 'RESUBMISSAO', 'REABERTURA'))
);

create table aip_decisao (
  id_decisao bigint generated always as identity primary key,
  id_versao bigint not null references aip_goal_card_versao (id_versao),
  tp_decisao text not null,
  ds_comentario text,
  dt_decisao timestamptz not null default now(),
  cd_matricula_decisao text not null,
  constraint uq_aip_decisao unique (id_versao),
  constraint ck_aip_decisao_tipo check (tp_decisao in ('APROVADO', 'DEVOLVIDO', 'NEGADO')),
  constraint ck_aip_decisao_comentario check (tp_decisao = 'APROVADO' or ds_comentario is not null)
);

create table aip_revisao_secao (
  id_decisao bigint not null references aip_decisao (id_decisao),
  cd_secao text not null,
  tp_marcacao text not null,
  primary key (id_decisao, cd_secao),
  constraint ck_aip_revisao_secao check (cd_secao in ('OBJECTIVE', 'FORMULA', 'UNIT', 'RULER', 'AREA', 'EVIDENCE', 'EXCEPTIONS')),
  constraint ck_aip_revisao_marcacao check (tp_marcacao in ('OK', 'AJUSTAR'))
);

create table aip_comentario (
  id_comentario bigint generated always as identity primary key,
  id_goal_card bigint not null references aip_goal_card (id_goal_card),
  cd_secao text not null,
  ds_texto text not null,
  id_comentario_pai bigint references aip_comentario (id_comentario),
  dt_comentario timestamptz not null default now(),
  cd_matricula_autor text not null,
  constraint ck_aip_comentario_secao check (cd_secao in ('OBJECTIVE', 'FORMULA', 'UNIT', 'RULER', 'AREA', 'EVIDENCE', 'EXCEPTIONS'))
);

-- ═══ AUDITORIA E AVISOS ═══
create table aip_evento_log (
  id_evento bigint generated always as identity primary key,
  id_ciclo bigint not null references aip_ciclo (id_ciclo),
  tp_evento text not null,
  dt_evento timestamptz not null default now(),
  cd_matricula text not null,
  tp_grupo text,
  id_goal_card bigint references aip_goal_card (id_goal_card),
  cd_secao text,
  ds_antes jsonb,
  ds_depois jsonb,
  constraint ck_aip_evento_tipo check (tp_evento in ('SUBMISSAO', 'RECOLHIMENTO', 'DECISAO', 'REABERTURA', 'COMENTARIO', 'CONFIGURACAO', 'CICLO_ABERTO', 'CICLO_FECHADO', 'CICLO_REABERTO', 'ACESSO_NEGADO'))
);
-- Registro imutável: nenhum evento pode ser editado ou apagado
create function aip_evento_imutavel() returns trigger language plpgsql as $$
begin raise exception 'AIP_EVENTO_LOG é imutável'; end $$;
create trigger tg_aip_evento_imutavel before update or delete on aip_evento_log for each row execute function aip_evento_imutavel();

create table aip_notificacao (
  id_notificacao bigint generated always as identity primary key,
  id_evento bigint not null references aip_evento_log (id_evento),
  cd_matricula_destino text not null,
  tp_canal text not null,
  dt_envio timestamptz,
  dt_leitura timestamptz,
  constraint ck_aip_notificacao_canal check (tp_canal in ('EMAIL', 'APP')),
  constraint ck_aip_notificacao_leitura check (dt_leitura is null or dt_envio is not null)
);
