// Fonte do banco (aip-goals-banco.js) com um banco simulado: confere que as linhas das tabelas PM viram os formatos
// das telas e que as gravações mandam os parâmetros certos. Sem SQL Server: as consultas reais são conferidas no DEV.
const test = require('node:test');
const assert = require('node:assert');
const { criarFonteBanco } = require('../aip-goals-banco');
const { criarAipGoalsRouter, validarConfiguracao } = require('../aip-goals-api');

const HOJE = new Date(2026, 10, 24, 10, 0, 0);
const D = (s) => new Date(s + 'T00:00:00Z');
const CICLO = { ID_CICLO: 7, NO_ANO: 2027, NM_CICLO: 'AIP 2027', SG_STATUS: 'S',
  DT_INI_DESDOBRAMENTO: D('2026-11-02'), DT_FIM_DESDOBRAMENTO: D('2026-11-20'), DT_INI_PROPOSTA: D('2026-11-20'), DT_FIM_PROPOSTA: D('2026-12-18'),
  DT_INI_CALIBRACAO: D('2026-12-18'), DT_FIM_CALIBRACAO: D('2027-01-15'), DT_INI_OFICIAL: D('2027-01-15'), DT_FIM_OFICIAL: D('2027-01-29'),
  QTDE_PONTOS_HERDADOS_COO: 75, QTDE_PONTOS_HERDADOS_BU: 40 };
const SITES = [{ ID_SITE: 11, NM_SITE: 'Salobo', NM_PAIS: 'Brasil', SG_ATIVA: 'S', NM_AREA: 'Diretoria Executiva', NM_RESPONSAVEL_AREA: 'Fernanda Lacerda', DS_EXCECAO: 'Força maior excluída.', SG_EXCECAO_VER: 'S' },
  { ID_SITE: 12, NM_SITE: 'VNL', NM_PAIS: 'Canadá', SG_ATIVA: 'S', NM_AREA: null, NM_RESPONSAVEL_AREA: null, DS_EXCECAO: null, SG_EXCECAO_VER: 'S' }];
// Unidades organizacionais (D-40): Presidente › CEO › COO › BUs (nível 4)
const U = (id, nome, nivel, pai, escopo) => ({ ID_UNIDADE_ORGANIZACIONAL: id, NM_UNIDADE_ORGANIZACIONAL: nome, NO_NIVEL_HIERARQUIA: nivel, ID_UNIDADE_PAI: pai, NM_ESCOPO_ATUACAO: escopo, NM_AREA: null, NM_RESPONSAVEL_AREA: null });
const UNIDADES = [U(1, 'Presidente', 1, null, 'Corporativo'), U(2, 'CEO VBM', 2, 1, 'Corporativo'), U(3, 'COO VBM', 3, 2, 'Corporativo'),
  U(11, 'Salobo', 4, 3, 'Brasil'), U(13, 'Sossego', 4, 3, 'Brasil'), U(12, 'VNL', 4, 3, 'Canadá')];
const PESSOAS = [{ MATRICULA: 'C1', NOME: 'Ana Ribeiro', EMAIL: 'ana@vale.com', CARGO: 'Analista' }, { MATRICULA: 'C4', NOME: null, EMAIL: 'carla.mendes@vale.com', CARGO: null }, { MATRICULA: 'D1', NOME: 'Fernanda Lacerda', EMAIL: 'fer@vale.com', CARGO: 'Diretora' },
  { MATRICULA: 'C2', NOME: 'Bruno Costa', EMAIL: 'bruno@vale.com', CARGO: 'Engenheiro' }];
const CAMPOS = { objective: 'Obj', formula: 'F', unit: '%', ruler: { min: 1, meta: 2, exc: 3 }, area: {}, evidence: 'Ev', exceptions: { bu: '' } };

function bancoSimulado(papeis = [{ TP_GRUPO: 'ADMIN', NM_SITE: null }]) {
  const log = [];
  const rs = (recordset, rowsAffected = [recordset.length || 1]) => ({ recordset, rowsAffected });
  const responder = (sql, p = {}) => {
    log.push({ sql, p });
    if (/AS FILHAS/.test(sql)) return rs([{ FILHAS: UNIDADES.filter((u) => u.ID_UNIDADE_PAI === p.id[1]).length, CARDS: p.id[1] === 11 ? 1 : 0 }]);
    if (/FROM sys\.columns/.test(sql)) return rs([{ N: global.AIP_DATAS_OBRIGATORIAS || 0 }]);
    if (/FROM CI\.KZN_MDM_HIERARQUIA WHERE CD_EMAIL = @email/.test(sql)) return rs(PESSOAS.filter((x) => x.EMAIL === p.email[1]));
    if (/NM_USUARIO LIKE @ini/.test(sql)) return rs(PESSOAS.filter((x) => (x.NOME || '').startsWith(p.ini[1].slice(0, -1))));
    if (/= @nome COLLATE/.test(sql)) return rs(PESSOAS.filter((x) => x.NOME === p.nome[1]));
    if (/FROM CI\.KZN_MDM_HIERARQUIA/.test(sql)) return rs(PESSOAS);
    if (/FROM PM\.AIP_CICLO ORDER BY CASE/.test(sql)) return rs([CICLO]);
    if (/SELECT NO_ANO, NM_CICLO, SG_STATUS FROM PM\.AIP_CICLO/.test(sql)) return rs([{ NO_ANO: 2027, NM_CICLO: 'AIP 2027', SG_STATUS: 'S' }, { NO_ANO: 2026, NM_CICLO: 'AIP 2026', SG_STATUS: 'N' }]);
    if (/FROM PM\.AIP_CICLO_SITE cs JOIN/.test(sql)) return rs(SITES);
    if (/TRY_CAST\(p\.CD_MATRICULA AS BIGINT\) = TRY_CAST\(@mat/.test(sql)) return rs(papeis);
    if (/FROM PM\.AIP_PAPEL p LEFT JOIN/.test(sql)) return rs([{ CD_MATRICULA: 'C1', TP_GRUPO: 'ADMIN', NM_SITE: null }, { CD_MATRICULA: 'C2', TP_GRUPO: 'CONTRIBUIDOR', NM_SITE: 'Salobo' }]);
    if (/OUTER APPLY/.test(sql)) return rs([
      { ID_GOAL_CARD: 1, CD_GOAL_CARD: 'GC-SAL-00', TP_ESTADO: 'RASCUNHO', CD_MATRICULA: 'C1', DT_ATUALIZACAO: new Date('2026-11-23T13:00:00Z'), ID_SITE: 11, NO_META: 0, NM_TITULO: "COO's Scorecard Result", TP_META: 'FORMULA', TP_ORIENTACAO: 'MAIOR', NM_SITE: 'Salobo', NM_PAIS: 'Brasil', VL_PESO: 40, NO_VERSAO: null },
      { ID_GOAL_CARD: 2, CD_GOAL_CARD: 'GC-SAL-01', TP_ESTADO: 'EM_APROVACAO', CD_MATRICULA: 'C2', DT_ATUALIZACAO: new Date('2026-11-20T13:00:00Z'), ID_SITE: 11, NO_META: 1, NM_TITULO: 'BU Working Capital', TP_META: 'FORMULA', TP_ORIENTACAO: 'MENOR', NM_SITE: 'Salobo', NM_PAIS: 'Brasil', VL_PESO: 60, NO_VERSAO: 2, DT_VERSAO: new Date('2026-11-18T12:00:00Z'), CD_MATRICULA_AUTOR: 'C2', DT_DECISAO: null },
    ]);
    if (/FROM PM\.AIP_META m LEFT JOIN PM\.AIP_META o/.test(sql)) return rs([
      { ID_META: 100, CD_NIVEL: 'BU', NO_META: 0, NM_TITULO: "COO's Scorecard Result", TP_META: 'FORMULA', TP_ORIENTACAO: 'MAIOR', VL_PESO: null, SG_ATIVA: 'S' },
      { ID_META: 101, CD_NIVEL: 'BU', NO_META: 1, NM_TITULO: 'BU Working Capital', TP_META: 'FORMULA', TP_ORIENTACAO: 'MENOR', VL_PESO: null, SG_ATIVA: 'S', ID_META_ORIGEM: 201, NO_ORIGEM: 2, NIVEL_ORIGEM: 'COO' },
      { ID_META: 201, CD_NIVEL: 'COO', NO_META: 2, NM_TITULO: 'Chronic Unease', TP_META: 'FORMULA', TP_ORIENTACAO: 'MAIOR', VL_PESO: 25, SG_ATIVA: 'S' },
      { ID_META: 301, CD_NIVEL: 'CEO', NO_META: 1, NM_TITULO: 'Safety', TP_META: 'FORMULA', TP_ORIENTACAO: 'MAIOR', VL_PESO: 100, SG_ATIVA: 'S' },
    ]);
    if (/SELECT mp\.ID_META, mp\.ID_SITE, mp\.VL_PESO/.test(sql)) return rs([{ ID_META: 101, ID_SITE: 11, VL_PESO: 60 }, { ID_META: 101, ID_SITE: 12, VL_PESO: 60 }]);
    if (/gc\.CD_GOAL_CARD = @cd/.test(sql)) return rs(p.cd[1] === 'GC-SAL-01' ? [{ ID_GOAL_CARD: 2, CD_GOAL_CARD: 'GC-SAL-01', TP_ESTADO: 'EM_APROVACAO', DS_RASCUNHO: null, CD_MATRICULA: 'C2', DT_ATUALIZACAO: new Date('2026-11-20T13:00:00Z'), ID_SITE: 11,
      ID_META: 101, NO_META: 1, NM_TITULO: 'BU Working Capital', TP_META: 'FORMULA', TP_ORIENTACAO: 'MENOR', NM_SITE: 'Salobo', NM_PAIS: 'Brasil', NM_AREA: 'Diretoria Executiva', NM_RESPONSAVEL_AREA: 'Fernanda Lacerda', DS_EXCECAO: 'Força maior excluída.', SG_EXCECAO_VER: 'S', VL_PESO: 60 }] : []);
    if (/FROM PM\.AIP_GOAL_CARD_VERSAO WHERE ID_GOAL_CARD = @id ORDER BY NO_VERSAO$/.test(sql)) return rs([
      { ID_VERSAO: 1, NO_VERSAO: 1, TP_MOTIVO: 'SUBMISSAO', DS_CAMPOS: JSON.stringify({ ...CAMPOS, formula: 'F0' }), DT_VERSAO: new Date('2026-11-10T12:00:00Z'), CD_MATRICULA_AUTOR: 'C2',
        TP_DECISAO: 'DEVOLVIDO', DS_COMENTARIO_DECISAO: 'Ajustar a fórmula', DS_REVISAO_SECOES: JSON.stringify({ revisao: { formula: 'ajustar' }, ajustes: { formula: 'x' } }), DT_DECISAO: new Date('2026-11-12T12:00:00Z'), CD_MATRICULA_DECISAO: 'C1' },
      { ID_VERSAO: 2, NO_VERSAO: 2, TP_MOTIVO: 'RESUBMISSAO', DS_CAMPOS: JSON.stringify(CAMPOS), DT_VERSAO: new Date('2026-11-18T12:00:00Z'), CD_MATRICULA_AUTOR: 'C2' }]);
    if (/TP_EVENTO = 'COMENTARIO' ORDER BY/.test(sql)) return rs([{ ID_EVENTO: 5, DT_EVENTO: new Date('2026-11-12T12:00:00Z'), CD_MATRICULA: 'C1', TP_GRUPO: 'ADMIN', CD_SECAO: 'formula', DS_COMENTARIO: 'x', ID_EVENTO_PAI: null },
      { ID_EVENTO: 6, DT_EVENTO: new Date('2026-11-13T12:00:00Z'), CD_MATRICULA: 'C2', TP_GRUPO: 'CONTRIBUIDOR', CD_SECAO: 'formula', DS_COMENTARIO: 'ok', ID_EVENTO_PAI: 5 }]);
    if (/FROM PM\.AIP_EVENTO_LOG e/.test(sql)) return rs([{ ID_EVENTO: 9, TP_EVENTO: 'SUBMISSAO', DT_EVENTO: new Date('2026-11-18T12:00:00Z'), CD_MATRICULA: 'C2', TP_GRUPO: 'CONTRIBUIDOR', CD_SECAO: null, DS_COMENTARIO: 'resubmeteu como v2', CD_GOAL_CARD: 'GC-SAL-01', NO_META: 1, NM_TITULO: 'BU Working Capital', NM_SITE: 'Salobo' },
      { ID_EVENTO: 1, TP_EVENTO: 'CICLO_ABERTO', DT_EVENTO: new Date('2026-11-02T12:00:00Z'), CD_MATRICULA: 'C1', TP_GRUPO: 'ADMIN', CD_SECAO: 'ciclo', DS_COMENTARIO: 'abriu', DS_DEPOIS: 'Aberto' }]);
    if (/COUNT\(\*\) AS N/.test(sql)) return rs([{ ID_SITE: 11, N: 1 }]);
    if (/^SELECT \* FROM PM\.UNIDADE_ORGANIZACIONAL/.test(sql)) return rs(UNIDADES);
    if (/^SELECT ID_UNIDADE_ORGANIZACIONAL AS ID_SITE, NM_UNIDADE_ORGANIZACIONAL AS NM_SITE FROM PM\.UNIDADE_ORGANIZACIONAL$/.test(sql)) return rs(UNIDADES.map((u) => ({ ID_SITE: u.ID_UNIDADE_ORGANIZACIONAL, NM_SITE: u.NM_UNIDADE_ORGANIZACIONAL })));
    if (/^SELECT ID_UNIDADE_ORGANIZACIONAL AS ID FROM PM\.UNIDADE_ORGANIZACIONAL$/.test(sql)) return rs(UNIDADES.map((u) => ({ ID: u.ID_UNIDADE_ORGANIZACIONAL })));
    if (/WHERE ID_UNIDADE_PAI = @id$/.test(sql)) return rs(UNIDADES.filter((u) => u.ID_UNIDADE_PAI === p.id[1]).map((u) => ({ ID: u.ID_UNIDADE_ORGANIZACIONAL })));
    if (/ISNULL\(MAX\(NO_VERSAO\)/.test(sql)) return rs([{ N: 2 }]);
    if (/SELECT TOP \(1\) ID_VERSAO, NO_VERSAO/.test(sql)) return rs([{ ID_VERSAO: 2, NO_VERSAO: 2 }]);
    if (/SELECT ID_CICLO FROM PM\.AIP_CICLO WHERE SG_STATUS = 'S'/.test(sql)) return rs([]);
    if (/SELECT 1 AS X FROM PM\.AIP_CICLO WHERE NO_ANO = @ano/.test(sql)) return rs(p.ano[1] === 2027 ? [{ X: 1 }] : []);
    if (/SCOPE_IDENTITY/.test(sql)) return rs([{ ID: 999 }], [1, 1]);
    if (/SELECT ID_PAPEL/.test(sql)) return rs([{ ID_PAPEL: 1, CD_MATRICULA: 'C1', TP_GRUPO: 'ADMIN', ID_SITE: null, SG_ATIVO: 'S' }, { ID_PAPEL: 2, CD_MATRICULA: 'C2', TP_GRUPO: 'CONTRIBUIDOR', ID_SITE: 11, SG_ATIVO: 'S' }]);
    if (/SELECT ID_SITE FROM PM\.AIP_CICLO_SITE/.test(sql)) return rs([{ ID_SITE: 11 }, { ID_SITE: 12 }]);
    if (/SELECT m\.ID_META, m\.NO_META, cs\.ID_SITE, s\.NM_SITE/.test(sql)) return rs([{ ID_META: 101, NO_META: 1, ID_SITE: 13, NM_SITE: 'Sossego' }, { ID_META: 100, NO_META: 0, ID_SITE: 13, NM_SITE: 'Sossego' }]);
    if (/SELECT gc\.CD_GOAL_CARD, gc\.ID_SITE/.test(sql)) return rs([{ CD_GOAL_CARD: 'GC-SAL-01', ID_SITE: 11 }, { CD_GOAL_CARD: 'GC-SOL-01', ID_SITE: 99 }]);
    if (/^\s*(UPDATE|INSERT|DELETE|IF)/.test(sql)) return rs([], [1]);
    throw new Error('consulta sem resposta simulada: ' + sql.slice(0, 120));
  };
  const runQuery = async (s, p) => responder(s, p);
  const transacao = async (fn) => fn(runQuery);
  return { log, fonte: criarFonteBanco({ runQuery, transacao, env: {} }) };
}

test('banco: contexto pelo MDM (CI.KZN_MDM_HIERARQUIA), ciclo atual com etapa do dia e BUs ativas', async () => {
  const { fonte } = bancoSimulado([{ TP_GRUPO: 'CONTRIBUIDOR', NM_SITE: 'Salobo' }, { TP_GRUPO: 'APROVACAO', NM_SITE: null }]);
  const ctx = await fonte.contexto('ana@vale.com', HOJE);
  assert.strictEqual(ctx.quem, 'C1');
  assert.deepStrictEqual(ctx.papeis.map((p) => [p.papel, p.bu]), [['contribuidor', 'Salobo'], ['aprovador', null]]);
  assert.deepStrictEqual((await fonte.contexto('ninguem@vale.com', HOJE)).papeis, []);
  // Autopreenchimento: busca no MDM; sem NM_USUARIO, o nome sai do e-mail (nunca a matrícula)
  assert.deepStrictEqual((await fonte.buscarPessoas('Ana')).map((x) => x.nome), ['Ana Ribeiro']);
  assert.deepStrictEqual(await fonte.buscarPessoas('a'), []);
  const nomes = await fonte.configuracao(HOJE);
  assert.ok(nomes.membros.every((m) => m.nome && m.nome !== m.matricula));
  const c = await fonte.ciclo(HOJE);
  assert.strictEqual(c.etapaAtual, 'proposta');
  assert.deepStrictEqual(c.bus, [{ sigla: 'Salobo', pais: 'Brasil' }, { sigla: 'VNL', pais: 'Canadá' }]);
  assert.strictEqual(c.etapas[3].fim, '2027-01-29');
});

test('banco: painel, Goal Card (rascunho/versões/comentários) e Versões no formato das telas', async () => {
  const { fonte } = bancoSimulado();
  const p = await fonte.painel(HOJE);
  assert.strictEqual(p.cards.length, 2);
  assert.deepStrictEqual(p.cards[0].meta, { numero: 0, titulo: "COO's Scorecard Result", tipo: 'formula', peso: 40, resultado: true });
  assert.strictEqual(p.cards[1].estado, 'em_aprovacao');
  assert.strictEqual(p.cards[1].desde, '2026-11-18');
  assert.strictEqual(p.cards[1].contribuidor, 'Bruno Costa');
  const gc = await fonte.goalCard('GC-SAL-01', HOJE);
  assert.strictEqual(gc.versao, 2);
  assert.deepStrictEqual(gc.secoes.area, { area: 'Diretoria Executiva', responsavel: 'Fernanda Lacerda' });
  assert.strictEqual(gc.secoes.exceptions.padrao, 'Força maior excluída.');
  assert.deepStrictEqual(gc.alteradasDesde, { versao: 1, secoes: ['formula'] });
  assert.strictEqual(gc.comentarios.length, 1);
  assert.strictEqual(gc.comentarios[0].respostas[0].autor, 'Bruno Costa');
  assert.deepStrictEqual(gc.editores, ['C2']);
  assert.strictEqual(await fonte.goalCard('GC-XXX-01', HOJE), null);
  const v = await fonte.versoes('GC-SAL-01', HOJE);
  assert.deepStrictEqual(v.versoes.map((x) => x.versao), [2, 1]);
  assert.deepStrictEqual(v.versoes[1].decisao.secoes, ['formula']);
  assert.strictEqual(v.versoes[1].decisao.tipo, 'devolver');
});

test('banco: desdobramento, Action Log e configuração', async () => {
  const { fonte } = bancoSimulado();
  const d = await fonte.desdobramento(HOJE);
  assert.strictEqual(d.parametros.pesoResultadoCoo, 40);
  assert.deepStrictEqual(d.scorecardCoo.map((m) => [m.id, m.peso]), [['2027_01', 75], ['2027_02', 25]]);
  assert.deepStrictEqual(d.scorecardCoo[1].metasBu, [1]);
  assert.deepStrictEqual(d.metasBu[0].pesos, { Salobo: 60, VNL: 60 });
  const lg = await fonte.actionLog(HOJE);
  assert.deepStrictEqual(lg.eventos.map((e) => [e.tipo, e.versao]), [['submissao', 2], ['configuracao', null]]);
  assert.strictEqual(lg.eventos[0].quando, '2026-11-18T09:00:00'); // UTC → horário de Brasília
  const cf = await fonte.configuracao(HOJE);
  assert.deepStrictEqual(cf.niveis.map((n) => n.herdado), [0, 75, 40]);
  assert.deepStrictEqual(cf.membros.map((m) => [m.nome, m.grupo, m.bu]), [['Ana Ribeiro', 'admin', null], ['Bruno Costa', 'contribuidor', 'Salobo']]);
  // BUs = unidades de nível 4 com a participação no ciclo (área e responsável do ciclo); estrutura = os demais níveis
  assert.deepStrictEqual(cf.bus.map((b) => [b.sigla, b.pais, b.ativa, b.responsavel, b.cardsSubmetidos]), [['Salobo', 'Brasil', true, 'Fernanda Lacerda', 1], ['Sossego', 'Brasil', false, '', 0], ['VNL', 'Canadá', true, '', 0]]);
  assert.deepStrictEqual(cf.org.map((u) => [u.nome, u.nivel, u.pai]), [['Presidente', 1, null], ['CEO VBM', 2, 1], ['COO VBM', 3, 2]]);
  assert.strictEqual(cf.metasNivel.bu[0].origem, '2027_02');
  // A configuração do banco passa pela mesma validação do servidor (RN-16: BU = 40 herdados + 60)
  assert.deepStrictEqual(validarConfiguracao('metas', { metasNivel: cf.metasNivel }, cf).filter((e) => e.codigo === 'RN16' && e.nivel === 'bu'), []);
});

test('banco: gravações — submeter, decidir (ajustes viram comentários), grupos e novos Goal Cards', async () => {
  const { fonte, log } = bancoSimulado();
  const ctx = { quem: 'C1', nome: 'Ana Ribeiro', papeis: [{ papel: 'admin' }] };
  const gc = await fonte.goalCard('GC-SAL-01', HOJE);
  log.length = 0;
  assert.deepStrictEqual(await fonte.submeter({ ...gc, estado: 'em_revisao' }, CAMPOS, ctx), { estado: 'em_aprovacao', versao: 3 });
  assert.ok(log.some((x) => /INSERT PM\.AIP_GOAL_CARD_VERSAO/.test(x.sql) && x.p.motivo[1] === 'RESUBMISSAO'));
  log.length = 0;
  await fonte.decidir(gc, { decisao: 'devolver', comentario: 'Rever a régua', revisao: { ruler: 'ajustar', unit: 'ok' }, ajustes: { ruler: 'Mínimo perto da meta' } }, ctx);
  const ev = log.filter((x) => /INSERT PM\.AIP_EVENTO_LOG/.test(x.sql)).map((x) => [x.p.tipo[1], x.p.secao[1]]);
  assert.deepStrictEqual(ev, [['DECISAO', 'ruler'], ['COMENTARIO', 'ruler']]);
  log.length = 0;
  const base = await fonte.configuracao(HOJE);
  await fonte.salvarConfiguracao('grupos', { membros: [{ matricula: 'C1', grupo: 'admin', bu: null }, { matricula: 'C3', grupo: 'aprovacao', bu: null }] }, ctx, base);
  assert.ok(log.some((x) => /INSERT PM\.AIP_PAPEL/.test(x.sql) && x.p.mat[1] === 'C3' && x.p.grupo[1] === 'APROVACAO'));
  assert.ok(log.some((x) => /SG_ATIVO = 'N'/.test(x.sql) && x.p.id[1] === 2)); // C2 saiu do grupo
  log.length = 0;
  // Unidades (D-40): Sossego entra no ciclo com área e responsável, VNL é excluída (sem histórico), Manitoba é nova
  const org = base.org, bu = (id) => base.bus.find((b) => b.id === id);
  await fonte.salvarConfiguracao('bus', { org, bus: [{ ...bu(11) }, { ...bu(13), ativa: true, area: 'Operações', responsavel: 'Ana Ribeiro' },
    { chave: 'n1', nome: 'Manitoba', sigla: 'Manitoba', nivel: 4, pai: 3, escopo: 'Canadá', ativa: true }] }, ctx, base);
  const cards = log.filter((x) => /INSERT PM\.AIP_GOAL_CARD \(/.test(x.sql)).map((x) => x.p.cd[1]);
  assert.deepStrictEqual(cards, ['GC-SOS-01', 'GC-SOS-00']); // código de 3 letras livre no ciclo
  assert.ok(log.some((x) => /DELETE FROM PM\.UNIDADE_ORGANIZACIONAL/.test(x.sql) && x.p.id[1] === 12)); // VNL excluída
  assert.ok(log.some((x) => /INSERT PM\.AIP_CICLO_SITE/.test(x.sql) && x.p.site[1] === 13 && x.p.area[1] === 'Operações' && x.p.resp[1] === 'Ana Ribeiro'));
  assert.ok(log.some((x) => /INSERT PM\.UNIDADE_ORGANIZACIONAL/.test(x.sql) && x.p.nome[1] === 'Manitoba' && x.p.pai[1] === 3));
  // Unidade com Goal Card submetido não pode ser excluída
  const r = await fonte.salvarConfiguracao('bus', { org, bus: [bu(13), bu(12)] }, ctx, base);
  assert.strictEqual(r.erros[0].codigo, 'VINCULO');
  // Novo ciclo: ano e datas escolhidos na tela (a 2ª etapa começa no fim da 1ª); ano que já tem ciclo é recusado
  log.length = 0;
  await fonte.acaoCiclo('novo', 2030, ctx, [{ inicio: '2026-12-01', fim: '2026-12-10' }, { inicio: null, fim: '2026-12-20' }, { inicio: null, fim: '2027-01-10' }, { inicio: null, fim: '2027-01-20' }]);
  const ins = log.find((x) => /INSERT PM\.AIP_CICLO \(NO_ANO/.test(x.sql));
  assert.deepStrictEqual([ins.p.ano[1], ins.p.nome[1], /@i0, @f0/.test(ins.sql)], [2030, 'AIP 2030', true]);
  assert.deepStrictEqual([ins.p.i1[1], ins.p.f3[1]], ['2026-12-10', '2027-01-20']);
  // Sem etapas (pop-up só com o ano): janelas em branco, escolhidas depois na aba Ciclo
  log.length = 0;
  await fonte.acaoCiclo('novo', 2031, ctx);
  assert.ok(/NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL/.test(log.find((x) => /INSERT PM\.AIP_CICLO \(NO_ANO/.test(x.sql)).sql));
  await assert.rejects(fonte.acaoCiclo('novo', 2027, ctx), /Já existe o ciclo AIP 2027/);
  // Banco sem o 005 (datas ainda obrigatórias): mensagem que diz o que rodar, sem tentar gravar
  global.AIP_DATAS_OBRIGATORIAS = 8; log.length = 0;
  await assert.rejects(fonte.acaoCiclo('novo', 2032, ctx), (e) => e.status === 409 && /005_pm_janelas_em_branco/.test(e.message));
  assert.ok(!log.some((x) => /INSERT PM\.AIP_CICLO \(NO_ANO/.test(x.sql)));
  global.AIP_DATAS_OBRIGATORIAS = 0;
});

test('router com a fonte do banco: sem identidade 401; sem ciclo 409; respostas sem exemplo', async () => {
  const { fonte } = bancoSimulado();
  const express = require('express');
  const app = express();
  app.use('/api', criarAipGoalsRouter({ dados: fonte, agora: () => HOJE }));
  const s = await new Promise((ok) => { const x = app.listen(0, () => ok(x)); });
  const url = `http://127.0.0.1:${s.address().port}/api`;
  try {
    assert.strictEqual((await fetch(url + '/inicio')).status, 401);
    const r = await (await fetch(url + '/inicio', { headers: { 'X-Forwarded-Email': 'ana@vale.com' } })).json();
    assert.strictEqual(r.exemplo, false);
    assert.strictEqual(r.ciclo.nome, 'AIP 2027');
    const cf = await fetch(url + '/configuracao', { headers: { 'X-Forwarded-Email': 'ana@vale.com' } });
    assert.strictEqual(cf.status, 200);
    const j = await cf.json();
    assert.ok(!Object.keys(j).some((k) => k.startsWith('_')), 'campos internos não saem');
  } finally { s.close(); }
  const vazio = criarAipGoalsRouter({ dados: { ...fonte, painel: async () => null }, agora: () => HOJE });
  const app2 = express(); app2.use('/api', vazio);
  const s2 = await new Promise((ok) => { const x = app2.listen(0, () => ok(x)); });
  try {
    const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/metas`, { headers: { 'X-Forwarded-Email': 'ana@vale.com' } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await r.json()).codigo, 'SEM_CICLO');
  } finally { s2.close(); }
});
