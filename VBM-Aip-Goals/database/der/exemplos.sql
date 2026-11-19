-- Dados de exemplo do DER (fictícios): uma história só, gravada num banco de TESTE para passar por todas as regras.
-- AIP 2026 fechado; AIP 2027 aberto, criado a partir dele. Ontario recebeu a meta 04 de volta para ajuste; Onça Puma já tem a 04 aprovada.
insert into aip_ciclo (no_ano, nm_ciclo, tp_status, ds_texto_padrao_excecoes, id_ciclo_origem, dt_criacao, cd_matricula_criacao, dt_fechamento, cd_matricula_fechamento) values
 (2026, 'AIP 2026', 'FECHADO', 'Efeitos de força maior, mudanças regulatórias e decisões de portfólio aprovadas pelo COO ficam fora do resultado.', null, '2025-09-15 09:00-03', 'C410644', '2026-01-30 18:00-03', 'C410644'),
 (2027, 'AIP 2027', 'ABERTO', 'Efeitos de força maior, mudanças regulatórias e decisões de portfólio aprovadas pelo COO ficam fora do resultado.', 1, '2026-09-20 10:30-03', 'C410644', null, null);

insert into aip_ciclo_janela values
 (2, 'DESDOBRAMENTO', 1, '2026-10-01', '2026-10-29'),
 (2, 'PROPOSTA', 2, null, '2026-12-01'),
 (2, 'CALIBRACAO', 3, null, '2026-12-15'),
 (2, 'OFICIAL', 4, null, '2026-12-22');

insert into sites (id_site, id_sistema, nm_site, nm_pais, sg_regiao) values
 (12, 1, 'Onça Puma', 'Brasil', null),
 (15, 1, 'Ontario', 'Canadá', null);

insert into aip_ciclo_bu values (2, 12, 'S'), (2, 15, 'S'), (1, 12, 'S'), (1, 15, 'S');

insert into aip_nivel (id_ciclo, cd_nivel, no_ordem, nm_nivel, qtde_pontos_total, qtde_pontos_herdados, sg_obrigatorio, sg_ativo) values
 (2, 'CEO', 1, 'CEO', 100, 0, 'S', 'S'),
 (2, 'COO', 2, 'COO', 100, 75, 'S', 'S'),
 (2, 'BU', 3, 'Business Unit', 100, 40, 'S', 'S'),
 (2, 'GG', 4, 'Gerência Geral (GG)', 100, 50, 'N', 'N');

insert into aip_unidade (id_nivel, nm_unidade, id_site, id_unidade_pai) values
 (1, 'CEO VBM', null, null),
 (2, 'COO VBM', null, 1),
 (3, 'Onça Puma', 12, 2),
 (3, 'Ontario', 15, 2);

insert into aip_meta (id_nivel, no_meta, nm_titulo, tp_meta, tp_polaridade, id_meta_origem, sg_ativa) values
 (2, 2, 'Strengthen a Culture of Chronic Unease', 'FORMULA', 'MAIOR', null, 'S'),
 (3, 4, 'BU Adherence to Production Budget', 'FORMULA', 'MAIOR', null, 'S'),
 (3, 5, 'BU Chronic Unease', 'FORMULA', 'MAIOR', 1, 'S');

insert into aip_meta_peso values (1, 2, 5), (2, 3, 10), (2, 4, 10), (3, 3, 5);

insert into aip_papel (id_ciclo, cd_matricula, tp_grupo, id_site, sg_ativo, dt_inclusao, cd_matricula_inclusao) values
 (2, 'C410385', 'CONTRIBUIDOR', 15, 'S', '2026-10-02 08:40-03', 'C410644'),
 (2, 'C410459', 'APROVACAO', null, 'S', '2026-10-02 08:45-03', 'C410644'),
 (2, 'C410644', 'ADMIN', null, 'S', '2026-09-20 10:30-03', 'C410644');

insert into aip_goal_card (cd_goal_card, id_meta, id_unidade, tp_estado, no_versao_oficial, ds_rascunho, dt_atualizacao, cd_matricula_atualizacao) values
 ('GC-ONT-04', 2, 4, 'EM_REVISAO', null, '{"unit": "%", "ruler": {"min": 95, "meta": 100, "exc": 105}}', '2026-11-18 15:20-03', 'C410459'),
 ('GC-ONP-04', 2, 3, 'APROVADO', 1, null, '2026-11-10 11:00-03', 'C410459');

insert into aip_goal_card_versao (id_goal_card, no_versao, tp_motivo, ds_campos, dt_versao, cd_matricula_autor) values
 (1, 1, 'SUBMISSAO', '{"objective": "Deliver the production budget for the year", "unit": "t", "ruler": {"min": 95, "meta": 100, "exc": 105}}', '2026-11-13 09:40-03', 'C410385'),
 (2, 1, 'SUBMISSAO', '{"objective": "Deliver the production budget for the year", "unit": "%", "ruler": {"min": 95, "meta": 100, "exc": 105}}', '2026-11-05 16:10-03', 'C410200');

insert into aip_decisao (id_versao, tp_decisao, ds_comentario, dt_decisao, cd_matricula_decisao) values
 (1, 'DEVOLVIDO', 'Use the same unit as the COO scorecard (%).', '2026-11-18 15:20-03', 'C410459'),
 (2, 'APROVADO', null, '2026-11-10 11:00-03', 'C410459');

insert into aip_revisao_secao values (1, 'OBJECTIVE', 'OK'), (1, 'UNIT', 'AJUSTAR'), (1, 'RULER', 'AJUSTAR');

insert into aip_comentario (id_goal_card, cd_secao, ds_comentario, id_comentario_pai, dt_comentario, cd_matricula_autor) values
 (1, 'UNIT', 'Use the same unit as the COO scorecard (%).', null, '2026-11-17 11:27-03', 'C410459'),
 (1, 'UNIT', 'Ajustado para %, conforme o scorecard do COO.', 1, '2026-11-19 09:05-03', 'C410385');

insert into aip_evento_log (id_ciclo, tp_evento, dt_evento, cd_matricula, tp_grupo, id_goal_card, cd_secao, ds_antes, ds_depois) values
 (1, 'CICLO_FECHADO', '2026-01-30 18:00-03', 'C410644', 'ADMIN', null, null, '{"status": "ABERTO"}', '{"status": "FECHADO"}'),
 (2, 'SUBMISSAO', '2026-11-13 09:40-03', 'C410385', 'CONTRIBUIDOR', 1, null, null, '{"versao": 1}'),
 (2, 'DECISAO', '2026-11-18 15:20-03', 'C410459', 'APROVACAO', 1, 'UNIT', '{"estado": "EM_APROVACAO"}', '{"estado": "EM_REVISAO"}');

insert into aip_notificacao (id_evento, cd_matricula_destino, tp_canal, dt_envio, dt_leitura) values
 (3, 'C410385', 'EMAIL', '2026-11-18 15:21-03', '2026-11-18 16:02-03'),
 (3, 'C410385', 'APP', '2026-11-18 15:21-03', null);
