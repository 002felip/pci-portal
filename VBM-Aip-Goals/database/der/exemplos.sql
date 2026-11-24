-- Dados de exemplo do DER (fictícios): uma história só, gravada num banco de TESTE para passar por todas as regras.
-- AIP 2026 fechado; AIP 2027 aberto, criado a partir dele. Ontario recebeu a meta 04 de volta para ajuste; Onça Puma já tem a 04 aprovada.
insert into aip_ciclo (no_ano, nm_ciclo, tp_status, id_ciclo_origem, dt_criacao, cd_matricula_criacao, dt_fechamento, cd_matricula_fechamento, dt_ini_desdobramento, dt_fim_desdobramento, dt_ini_proposta, dt_fim_proposta, dt_ini_calibracao, dt_fim_calibracao, dt_ini_oficial, dt_fim_oficial, qtde_pontos_herdados_coo, qtde_pontos_herdados_bu) values
 (2026, 'AIP 2026', 'FECHADO', null, '2025-09-15 09:00-03', 'C410644', '2026-01-30 18:00-03', 'C410644', '2025-10-01', '2025-10-30', '2025-10-30', '2025-12-02', '2025-12-02', '2025-12-16', '2025-12-16', '2025-12-23', 75, 40),
 (2027, 'AIP 2027', 'ABERTO', 1, '2026-09-20 10:30-03', 'C410644', null, null, '2026-10-01', '2026-10-29', '2026-10-29', '2026-12-01', '2026-12-03', '2026-12-15', '2026-12-15', '2026-12-22', 75, 40);

insert into sites (id_site, id_sistema, nm_site, nm_pais, sg_regiao) values
 (12, 1, 'Onça Puma', 'Brasil', null),
 (15, 1, 'Ontario', 'Canadá', null);

insert into aip_unidade (id_ciclo, cd_nivel, nm_unidade, id_site, sg_ativa, cd_matricula_diretor, ds_excecao, sg_excecao_ver) values
 (2, 'CEO', 'CEO VBM', null, 'S', null, null, 'S'),
 (2, 'COO', 'COO VBM', null, 'S', null, null, 'S'),
 (2, 'BU', 'Onça Puma', 12, 'S', 'C410681', 'Força maior, mudanças regulatórias brasileiras (ANM, IBAMA) e decisões de portfólio aprovadas pelo COO ficam fora do resultado.', 'S'),
 (2, 'BU', 'Ontario', 15, 'S', 'C410718', 'Força maior, mudanças regulatórias provinciais do Canadá e decisões de portfólio aprovadas pelo COO ficam fora do resultado.', 'N');

insert into aip_meta (id_ciclo, cd_nivel, no_meta, nm_titulo, tp_meta, tp_polaridade, id_meta_origem, sg_ativa) values
 (2, 'COO', 2, 'Strengthen a Culture of Chronic Unease', 'FORMULA', 'MAIOR', null, 'S'),
 (2, 'BU', 4, 'BU Adherence to Production Budget', 'FORMULA', 'MAIOR', null, 'S'),
 (2, 'BU', 5, 'BU Chronic Unease', 'FORMULA', 'MAIOR', 1, 'S');

insert into aip_meta_peso values (1, 2, 5), (2, 3, 10), (2, 4, 10), (3, 3, 5);

insert into aip_papel (id_ciclo, cd_matricula, tp_grupo, id_site, sg_ativo, dt_atualizacao) values
 (2, 'C410385', 'CONTRIBUIDOR', 15, 'S', '2026-10-02 08:40-03'),
 (2, 'C410459', 'APROVACAO', null, 'S', '2026-10-02 08:45-03'),
 (2, 'C410644', 'ADMIN', null, 'S', '2026-09-20 10:30-03');

insert into aip_goal_card (cd_goal_card, id_meta, id_unidade, tp_estado, no_versao_oficial, ds_rascunho, dt_atualizacao, cd_matricula_atualizacao) values
 ('GC-ONT-04', 2, 4, 'EM_REVISAO', null, '{"unit": "%", "ruler": {"min": 95, "meta": 100, "exc": 105}}', '2026-11-18 15:20-03', 'C410459'),
 ('GC-ONP-04', 2, 3, 'APROVADO', 1, null, '2026-11-10 11:00-03', 'C410459');

insert into aip_goal_card_versao (id_goal_card, no_versao, tp_motivo, ds_campos, dt_versao, cd_matricula_autor, tp_decisao, ds_comentario_decisao, ds_revisao_secoes, dt_decisao, cd_matricula_decisao) values
 (1, 1, 'SUBMISSAO', '{"objective": "Deliver the production budget for the year", "unit": "t", "ruler": {"min": 95, "meta": 100, "exc": 105}}', '2026-11-13 09:40-03', 'C410385',
  'DEVOLVIDO', 'Use the same unit as the COO scorecard (%).', '{"OBJECTIVE": "OK", "UNIT": "AJUSTAR", "RULER": "AJUSTAR"}', '2026-11-18 15:20-03', 'C410459'),
 (2, 1, 'SUBMISSAO', '{"objective": "Deliver the production budget for the year", "unit": "%", "ruler": {"min": 95, "meta": 100, "exc": 105}}', '2026-11-05 16:10-03', 'C410200',
  'APROVADO', null, '{"OBJECTIVE": "OK", "UNIT": "OK", "RULER": "OK"}', '2026-11-10 11:00-03', 'C410459');

insert into aip_evento_log (id_ciclo, tp_evento, dt_evento, cd_matricula, tp_grupo, id_goal_card, cd_secao, ds_comentario, id_evento_pai, ds_antes, ds_depois) values
 (1, 'CICLO_FECHADO', '2026-01-30 18:00-03', 'C410644', 'ADMIN', null, null, null, null, '{"status": "ABERTO"}', '{"status": "FECHADO"}'),
 (2, 'SUBMISSAO', '2026-11-13 09:40-03', 'C410385', 'CONTRIBUIDOR', 1, null, null, null, null, '{"versao": 1}'),
 (2, 'COMENTARIO', '2026-11-17 11:27-03', 'C410459', 'APROVACAO', 1, 'UNIT', 'Use the same unit as the COO scorecard (%).', null, null, null),
 (2, 'DECISAO', '2026-11-18 15:20-03', 'C410459', 'APROVACAO', 1, null, 'Use the same unit as the COO scorecard (%).', null, '{"estado": "EM_APROVACAO"}', '{"estado": "EM_REVISAO"}'),
 (2, 'COMENTARIO', '2026-11-19 09:05-03', 'C410385', 'CONTRIBUIDOR', 1, 'UNIT', 'Ajustado para %, conforme o scorecard do COO.', 3, null, null);

insert into aip_notificacao (id_evento, cd_matricula_destino, tp_canal, dt_envio, dt_leitura) values
 (4, 'C410385', 'EMAIL', '2026-11-18 15:21-03', '2026-11-18 16:02-03'),
 (4, 'C410385', 'APP', '2026-11-18 15:21-03', null);
