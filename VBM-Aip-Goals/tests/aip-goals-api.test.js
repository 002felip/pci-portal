// Testes do módulo de dados do AIP Goals (node --test). Sem banco e sem rede.
// Rodar na pasta do AIP Goals: npm test
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const path = require('path');
const { criarFonteExemplo } = require('./fonte-exemplo');
const { validarNovoCiclo, criarAipGoalsRouter: criarRouter, diasUteisEntre, agregarMetas, camposObrigatorios, validarDecisao, modoDoCard } = require('../aip-goals-api');

// Router com a fonte de exemplo (papeisDe simula o perfil do usuário)
const criarAipGoalsRouter = ({ papeisDe, ...o } = {}) => criarRouter({ ...o, dados: criarFonteExemplo(papeisDe ? { papeisDe } : {}) });

// Segunda-feira, 16/11/2026
const HOJE = new Date(2026, 10, 16, 10, 0, 0);

async function servidor(router, montar) {
  const app = express();
  if (montar) montar(app); else app.use('/api', router);
  return new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
}
async function pedir(s, caminho, headers = {}) {
  const r = await fetch(`http://127.0.0.1:${s.address().port}${caminho}`, { headers });
  let corpo = null; try { corpo = await r.json(); } catch (e) { /* sem JSON */ }
  return { status: r.status, corpo, headers: r.headers };
}

test('diasUteisEntre ignora fins de semana e não conta o dia inicial', () => {
  assert.strictEqual(diasUteisEntre('2026-11-13', HOJE), 1); // sexta → segunda
  assert.strictEqual(diasUteisEntre('2026-11-09', HOJE), 5); // segunda anterior
  assert.strictEqual(diasUteisEntre('2026-11-16', HOJE), 0);
  assert.strictEqual(diasUteisEntre('2026-11-20', HOJE), 0); // futuro
});

test('GET /inicio exige a identidade do proxy (X-Forwarded-Email) e devolve ciclo e papéis', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    assert.strictEqual((await pedir(s, '/api/inicio')).status, 401);
    const com = await pedir(s, '/api/inicio', { 'X-Forwarded-Email': 'pessoa@vale.com' });
    assert.strictEqual(com.status, 200);
    assert.strictEqual(com.corpo.exemplo, true);
    assert.strictEqual(com.corpo.ciclo.etapas.length, 4);
    assert.ok(Array.isArray(com.corpo.usuario.papeis) && com.corpo.usuario.papeis.length > 0);
    assert.strictEqual((await pedir(s, '/api/pendencias', { 'X-Forwarded-Email': 'pessoa@vale.com' })).status, 404); // T01 retirada
  } finally { s.close(); }
});

test('router exige a fonte de dados e não traz dados de exemplo no app', () => {
  assert.throws(() => criarRouter({}), /dados/);
  const fs = require('fs');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'dados-exemplo.js')), 'dados de exemplo ficam só em tests/');
});

test('portal.js: só index.html e assets/ são públicos; arquivos internos dão 404', async () => {
  const montar = require('../portal');
  const raiz = path.join(__dirname, '..');
  const s = await servidor(null, (app) => { montar(app); app.use('/VBM-Aip-Goals', express.static(raiz)); });
  try {
    for (const interno of ['portal.js', 'aip-goals-api.js', 'aip-goals-banco.js', 'tests/dados-exemplo.js', 'server.js', 'package.json', 'tests/aip-goals-api.test.js', 'assets/../portal.js']) {
      assert.strictEqual((await pedir(s, '/VBM-Aip-Goals/' + interno)).status, 404, interno);
    }
    const h = await pedir(s, '/VBM-Aip-Goals/api/health'); // sem banco configurado: unhealthy, sem o motivo
    assert.strictEqual(h.status, 503); assert.deepStrictEqual(h.corpo, { status: 'unhealthy' });
    const pag = await fetch(`http://127.0.0.1:${s.address().port}/VBM-Aip-Goals/index.html`);
    assert.strictEqual(pag.status, 200);
  } finally { s.close(); }
});

test('GET /painel: contagens batem com a lista de cards (CA-15) e o funil não cresce', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const r = await pedir(s, '/api/painel', { 'X-Forwarded-Email': 'pessoa@vale.com' });
    assert.strictEqual(r.status, 200);
    const { cards, totais, porBu, funil, niveis } = r.corpo;
    assert.strictEqual(totais.total, cards.length);
    for (const e of ['rascunho', 'em_aprovacao', 'em_revisao', 'aprovado']) {
      assert.strictEqual(totais[e], cards.filter((c) => c.estado === e).length, e);
      assert.strictEqual(porBu.reduce((a, b) => a + b[e], 0), totais[e], 'matriz ' + e);
    }
    for (const linha of porBu) assert.strictEqual(linha.total, cards.filter((c) => c.bu.sigla === linha.bu.sigla).length, linha.bu.sigla);
    for (let i = 1; i < funil.length; i++) assert.ok(funil[i].n <= funil[i - 1].n, 'funil ' + funil[i].id);
    assert.strictEqual(niveis.reduce((a, n) => a + n.cards, 0), totais.em_aprovacao);
  } finally { s.close(); }
});

test('GET /painel: filtro País › BU validado e aplicado', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const h = { 'X-Forwarded-Email': 'pessoa@vale.com' };
    const br = await pedir(s, '/api/painel?pais=' + encodeURIComponent('Brasil'), h);
    assert.ok(br.corpo.cards.length > 0 && br.corpo.cards.every((c) => c.bu.pais === 'Brasil'));
    const sal = await pedir(s, '/api/painel?pais=Brasil&bu=Salobo', h);
    assert.ok(sal.corpo.cards.every((c) => c.bu.sigla === 'Salobo'));
    assert.strictEqual((await pedir(s, '/api/painel?pais=Chile', h)).status, 400);
    assert.strictEqual((await pedir(s, '/api/painel?pais=Brasil&bu=VNL', h)).status, 400);
    assert.strictEqual((await pedir(s, '/api/painel')).status, 401);
  } finally { s.close(); }
});

test('GET /metas: soma dos pesos, peso por situação e alerta da RN-16', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const h = { 'X-Forwarded-Email': 'pessoa@vale.com' };
    const sal = await pedir(s, '/api/metas?bu=Salobo', h);
    assert.strictEqual(sal.status, 200);
    const { metas, totais } = sal.corpo;
    assert.ok(metas.length > 0 && metas.every((m) => m.bu.sigla === 'Salobo'));
    assert.strictEqual(totais.pesoTotal, metas.reduce((t, m) => t + m.meta.peso, 0));
    assert.strictEqual(Object.values(totais.peso).reduce((a, b) => a + b, 0), totais.pesoTotal);
    assert.strictEqual(totais.pesoSubmetido, totais.pesoTotal - totais.peso.rascunho);
    assert.strictEqual(sal.corpo.alertaPesos, totais.pesoTotal !== totais.pesoEsperado);
    assert.strictEqual(sal.corpo.alertaPesos, false); // desdobramento de referência: 40 + 60 = 100
    // Soma diferente do total acende o alerta da RN-16
    const curta = agregarMetas([{ meta: { numero: 1, peso: 40 }, estado: 'rascunho' }, { meta: { numero: 2, peso: 55 }, estado: 'aprovado' }], 100, 3, HOJE);
    assert.strictEqual(curta.totais.pesoTotal, 95);
    assert.strictEqual(curta.alertaPesos, true);
  } finally { s.close(); }
});

test('GET /metas: leitura aberta a todas as BUs; abre na BU do contribuidor; BU inexistente responde 404', async () => {
  const pontoFocal = () => [{ papel: 'ponto_focal', bu: 'Salobo' }];
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: pontoFocal }));
  try {
    const h = { 'X-Forwarded-Email': 'focal@vale.com' };
    const padrao = await pedir(s, '/api/metas', h);
    assert.strictEqual(padrao.corpo.bu.sigla, 'Salobo');
    assert.strictEqual(padrao.corpo.bus.length, 7);
    assert.strictEqual((await pedir(s, '/api/metas?bu=VNL', h)).status, 200);
    assert.strictEqual((await pedir(s, '/api/metas?bu=Inexistente', h)).status, 404);
    assert.strictEqual((await pedir(s, '/api/painel', h)).status, 403); // painel é só do P&CI/COO
  } finally { s.close(); }
});

test('GET /desdobramento: matriz CEO → COO → BUs, totais por BU e situação de cada célula (CA-15)', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const h = { 'X-Forwarded-Email': 'pessoa@vale.com' };
    const r = await pedir(s, '/api/desdobramento', h);
    assert.strictEqual(r.status, 200);
    const { scorecardCoo, bus, linhas, totais, parametros } = r.corpo;
    assert.strictEqual(scorecardCoo.reduce((t, m) => t + m.peso, 0), 100);
    assert.strictEqual(bus.length, 7);
    assert.ok(linhas[0].resultado && Object.values(linhas[0].celulas).every((c) => c.peso === parametros.pesoResultadoCoo));
    totais.forEach((t) => { assert.strictEqual(t.total, parametros.pesoTotal); assert.strictEqual(t.alerta, false); });
    // Cada célula aponta para o Goal Card da mesma BU e meta, com a situação do painel
    const painel = (await pedir(s, '/api/painel', h)).corpo.cards;
    linhas.forEach((l) => bus.forEach((b) => {
      const c = l.celulas[b.sigla]; if (!c) return;
      const card = painel.find((x) => x.card === c.card);
      assert.ok(card && card.bu.sigla === b.sigla && card.meta.numero === l.numero && card.estado === c.estado);
    }));
    // Metas do COO desdobradas para as BUs apontam para a meta de origem
    assert.deepStrictEqual(linhas.filter((l) => l.origem === '2027_05').map((l) => l.numero), [8, 9]);
    assert.strictEqual((await pedir(s, '/api/desdobramento')).status, 401);
  } finally { s.close(); }
});

test('GET /desdobramento: leitura aberta, todas as BUs para qualquer usuário (AC-05)', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [{ papel: 'ponto_focal', bu: 'Salobo' }] }));
  try {
    const r = await pedir(s, '/api/desdobramento', { 'X-Forwarded-Email': 'focal@vale.com' });
    assert.strictEqual(r.corpo.bus.length, 7);
  } finally { s.close(); }
  const s2 = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [] }));
  try { assert.strictEqual((await pedir(s2, '/api/desdobramento', { 'X-Forwarded-Email': 'x@vale.com' })).status, 200); } finally { s2.close(); }
});

// ── T04 Goal Card ──
async function enviar(s, caminho, corpo, h) {
  const r = await fetch(`http://127.0.0.1:${s.address().port}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json() };
}

test('camposObrigatorios e validarDecisao: envio bloqueado sem os obrigatórios, RN-08 e RN-09', () => {
  const ok = { objective: 'Meta', formula: 'a ÷ b', unit: '%', ruler: { min: 1, meta: 2, exc: 3 }, area: { area: 'A', responsavel: 'B' }, evidence: 'Relatório' };
  assert.ok(camposObrigatorios(ok).every((x) => x.ok));
  assert.strictEqual(camposObrigatorios(ok).length, 6); // exceções da BU não são obrigatórias
  const falta = camposObrigatorios({ ...ok, ruler: { min: 1, meta: '', exc: 3 }, area: { area: 'A', responsavel: ' ' } });
  assert.deepStrictEqual(falta.filter((x) => !x.ok).map((x) => x.id), ['ruler', 'area']);
  assert.deepStrictEqual(validarDecisao({ decisao: 'aprovar' }), []);
  assert.deepStrictEqual(validarDecisao({ decisao: 'devolver', comentario: 'curto', revisao: { ruler: 'ok' } }), ['comentario', 'secaoAjustar']);
  assert.deepStrictEqual(validarDecisao({ decisao: 'negar', comentario: 'Meta fora do desdobramento' }), ['decisao']); // Negar não existe no modelo
});

test('GET /goal-card: ficha do contribuidor (edição) ou leitura, campos obrigatórios', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const h = { 'X-Forwarded-Email': 'pessoa@vale.com' };
    const analise = await pedir(s, '/api/goal-card?card=GC-VNL-04', h); // em aprovação: a T04 só mostra (decisão na fila, T14)
    assert.strictEqual(analise.status, 200);
    assert.strictEqual(analise.corpo.modo, 'leitura');
    assert.strictEqual(analise.corpo.obrigatorios.length, 6);
    const edicao = await pedir(s, '/api/goal-card?card=GC-SAL-09', h); // rascunho de BU do contribuidor
    assert.strictEqual(edicao.corpo.modo, 'edicao');
    assert.strictEqual((await pedir(s, '/api/goal-card?card=GC-XX', h)).status, 400);
    assert.strictEqual((await pedir(s, '/api/goal-card?card=GC-ZZZ-99', h)).status, 404);
  } finally { s.close(); }
  const leitor = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [] }));
  try {
    const h = { 'X-Forwarded-Email': 'leitor@vale.com' };
    const r = await pedir(leitor, '/api/goal-card?card=GC-VNL-04', h);
    assert.strictEqual(r.corpo.modo, 'leitura'); // sem papel: lê todas as BUs, sem editar nem decidir
    assert.strictEqual((await enviar(leitor, '/api/goal-card/decisao', { card: 'GC-VNL-04', decisao: 'aprovar' }, h)).status, 403);
    assert.strictEqual((await enviar(leitor, '/api/goal-card/submeter', { card: 'GC-SAL-09', secoes: {} }, h)).status, 403);
  } finally { leitor.close(); }
});

test('POST /goal-card: submissão bloqueada sem campos obrigatórios e decisão validada (simulação)', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const h = { 'X-Forwarded-Email': 'pessoa@vale.com' };
    const card = (await pedir(s, '/api/goal-card?card=GC-SAL-09', h)).corpo;
    const vazio = await enviar(s, '/api/goal-card/submeter', { card: 'GC-SAL-09', secoes: { ...card.secoes, evidence: '' } }, h);
    assert.strictEqual(vazio.status, 400);
    assert.ok(vazio.corpo.pendentes.includes('evidence'));
    const sub = await enviar(s, '/api/goal-card/submeter', { card: 'GC-SAL-09', secoes: { ...card.secoes, area: { area: 'Projects', responsavel: 'X' }, evidence: 'Relatório' } }, h);
    assert.strictEqual(sub.status, 200); assert.strictEqual(sub.corpo.simulado, true);
    assert.strictEqual((await enviar(s, '/api/goal-card/submeter', { card: 'GC-VNL-04', secoes: {} }, h)).status, 409); // admin passa pela BU; card em aprovação não está em edição
    const dev = await enviar(s, '/api/goal-card/decisao', { card: 'GC-VNL-04', decisao: 'devolver', comentario: 'ok', revisao: {} }, h);
    assert.strictEqual(dev.status, 400); assert.deepStrictEqual(dev.corpo.erros, ['comentario', 'secaoAjustar']);
    const apr = await enviar(s, '/api/goal-card/decisao', { card: 'GC-VNL-04', decisao: 'aprovar' }, h);
    assert.strictEqual(apr.corpo.estado, 'aprovado');
  } finally { s.close(); }
});

test('Edição: contribuidor só na própria BU; administrador em todas as BUs (AC-04, AC-05)', async () => {
  const rascunho = (bu) => ({ bu: { sigla: bu }, estado: 'rascunho' });
  const contrib = [{ papel: 'contribuidor', bu: 'Salobo' }], admin = [{ papel: 'admin', bu: null }];
  assert.strictEqual(modoDoCard(rascunho('Salobo'), contrib), 'edicao');
  assert.strictEqual(modoDoCard(rascunho('VNL'), contrib), 'leitura');
  for (const bu of ['Onça Puma', 'Salobo', 'Sossego', 'Ontario', 'VNL', 'Clydach', 'Matsusaka']) assert.strictEqual(modoDoCard(rascunho(bu), admin), 'edicao');
  assert.strictEqual(modoDoCard({ bu: { sigla: 'VNL' }, estado: 'aprovado' }, admin), 'leitura'); // travado: só reabertura (RN-17)
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => contrib }));
  try { assert.strictEqual((await enviar(s, '/api/goal-card/submeter', { card: 'GC-VNL-04', secoes: {} }, { 'X-Forwarded-Email': 'c@vale.com' })).status, 403); } finally { s.close(); }
});

test('T11 Configuração: só o administrador; RN-16 por nível (CEO → BU); ano, janelas e BUs validados', async () => {
  const { validarConfiguracao, somaPesosPorNivel } = require('../aip-goals-api');
  const { configuracaoExemplo } = require('./dados-exemplo');
  const base = configuracaoExemplo(HOJE);
  const somas = somaPesosPorNivel(base.metasNivel, base.niveis, base.unidades, base.bus);
  assert.ok(somas.length > 7 && somas.every((x) => x.soma === x.total)); // exemplo fecha 100 em todos os níveis
  assert.deepStrictEqual([...new Set(somas.map((x) => x.nivel))], ['ceo', 'coo', 'bu']); // GG e GA fora no primeiro momento
  const metasNivel = JSON.parse(JSON.stringify(base.metasNivel)); metasNivel.bu[0].pesos.Salobo = 10;
  const e = validarConfiguracao('metas', { metasNivel }, base);
  assert.deepStrictEqual(e.filter((x) => x.codigo === 'RN16').map((x) => [x.nivel, x.unidade, x.soma]), [['bu', 'Salobo', 105]]);
  // Herdado da BU sobe para 50: todas as BUs passam do total
  const niveis = base.niveis.map((n) => (n.id === 'bu' ? { ...n, herdado: 50 } : n));
  assert.strictEqual(validarConfiguracao('metas', { metasNivel: base.metasNivel, niveis }, base).filter((x) => x.nivel === 'bu').length, 7);
  assert.ok(validarConfiguracao('parametros', { parametros: base.parametros, niveis: base.niveis.map((n) => (n.id === 'bu' ? { ...n, ativo: false } : n)) }, base).some((x) => x.codigo === 'FIXO'));
  const etapas = base.ciclo.etapas.map((x) => ({ ...x })); etapas[2].fim = etapas[1].fim;
  assert.ok(validarConfiguracao('ciclo', { ano: 2027, nome: 'AIP', etapas }, base).some((x) => x.codigo === 'ORDEM'));
  assert.ok(validarConfiguracao('ciclo', { ano: 1999, nome: 'AIP', etapas: base.ciclo.etapas }, base).some((x) => x.codigo === 'ANO'));
  assert.ok(validarConfiguracao('grupos', { membros: [{ matricula: 'C1234', grupo: 'contribuidor', bu: 'X' }] }, base).some((x) => x.codigo === 'BU'));
  // BUs: nova BU entra; BU com Goal Card submetido não pode ser excluída; nome duplicado é recusado
  const bus = base.bus.map((b) => ({ ...b, origem: b.sigla }));
  assert.deepStrictEqual(validarConfiguracao('bus', { bus: bus.concat([{ sigla: "Voisey's Bay", pais: 'Canadá', ativa: true, origem: null }]) }, base), []);
  assert.ok(validarConfiguracao('bus', { bus: bus.slice(1) }, base).some((x) => x.codigo === 'BU_COM_CARDS' && x.bu === bus[0].sigla));
  assert.ok(validarConfiguracao('bus', { bus: bus.concat([{ sigla: 'salobo', pais: 'Brasil', ativa: true }]) }, base).some((x) => x.codigo === 'DUPLICADA'));
  const admin = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [{ papel: 'admin', bu: null }] }));
  const contrib = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [{ papel: 'contribuidor', bu: 'Salobo' }] }));
  try {
    const h = { 'X-Forwarded-Email': 'a@vale.com' };
    assert.strictEqual((await pedir(admin, '/api/configuracao', h)).status, 200);
    assert.strictEqual((await pedir(contrib, '/api/configuracao', h)).status, 403);
    const r = await enviar(admin, '/api/configuracao/salvar', { aba: 'metas', dados: { metasNivel } }, h);
    assert.strictEqual(r.status, 400); assert.strictEqual(r.corpo.codigo, 'RN16'); // soma acima do total (Salobo 105) bloqueia
    const parcial = JSON.parse(JSON.stringify(metasNivel)); parcial.bu.forEach((m) => { Object.keys(m.pesos).forEach((k) => { m.pesos[k] = 1; }); });
    assert.strictEqual((await enviar(admin, '/api/configuracao/salvar', { aba: 'metas', dados: { metasNivel: parcial } }, h)).status, 200); // abaixo do total é só aviso: grava parcial
    assert.strictEqual((await enviar(admin, '/api/configuracao/salvar', { aba: 'metas', dados: { metasNivel: base.metasNivel } }, h)).corpo.simulado, true);
    assert.strictEqual((await enviar(contrib, '/api/configuracao/salvar', { aba: 'metas', dados: { metasNivel: base.metasNivel } }, h)).status, 403);
  } finally { admin.close(); contrib.close(); }
});

test('T07 Action Log: geral só do administrador; histórico de um card aberto a todos; filtros validados; paginação de 40', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [{ papel: 'admin', bu: null }] }));
  const sem = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [] }));
  try {
    const h = { 'X-Forwarded-Email': 'c@vale.com' };
    const todos = await pedir(s, '/api/action-log', h);
    assert.strictEqual(todos.status, 200);
    assert.strictEqual(todos.corpo.eventos.length, Math.min(40, todos.corpo.total));
    const dec = await pedir(s, '/api/action-log?tipo=decisao&bu=Salobo', h);
    assert.ok(dec.corpo.eventos.every((e) => e.tipo === 'decisao' && e.bu === 'Salobo'));
    assert.strictEqual(dec.corpo.porTipo.decisao, dec.corpo.total);
    assert.ok(dec.corpo.totalSemTipo >= dec.corpo.total);
    const tudo = await pedir(s, '/api/action-log?tudo=1', h);
    assert.strictEqual(tudo.corpo.eventos.length, todos.corpo.total);
    assert.ok(tudo.corpo.eventos.every((e, i, l) => i === 0 || l[i - 1].quando >= e.quando)); // mais recente primeiro
    assert.strictEqual((await pedir(s, '/api/action-log?tipo=xx', h)).status, 400);
    assert.strictEqual((await pedir(s, '/api/action-log?bu=Marte', h)).status, 400);
    assert.strictEqual((await pedir(sem, '/api/action-log', h)).status, 403);
    assert.strictEqual((await pedir(sem, '/api/action-log?card=GC-SAL-04', h)).status, 200);
  } finally { s.close(); sem.close(); }
});

test('T06 Versões: rascunho sem versão; versões mais recentes primeiro; oficial = última aprovada; leitura para todos', async () => {
  const { painelExemplo } = require('./dados-exemplo');
  const cards = painelExemplo(HOJE).cards;
  const aprovadoV2 = cards.find((c) => c.estado === 'aprovado' && c.versao > 1) || cards.find((c) => c.versao > 1);
  const rascunho = cards.find((c) => c.estado === 'rascunho');
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [] }));
  try {
    const h = { 'X-Forwarded-Email': 'c@vale.com' };
    const r = await pedir(s, '/api/versoes?card=' + aprovadoV2.card, h);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.corpo.versoes.map((v) => v.versao), [aprovadoV2.versao, 1]);
    assert.strictEqual(r.corpo.versoes[1].decisao.tipo, 'devolver');
    if (aprovadoV2.estado === 'aprovado') assert.strictEqual(r.corpo.oficial, aprovadoV2.versao);
    assert.strictEqual(r.corpo.versoes.filter((v) => v.oficial).length, aprovadoV2.estado === 'aprovado' ? 1 : 0);
    assert.deepStrictEqual((await pedir(s, '/api/versoes?card=' + rascunho.card, h)).corpo.versoes, []);
    assert.strictEqual((await pedir(s, '/api/versoes?card=GC-ZZZ-99', h)).status, 404);
    assert.strictEqual((await pedir(s, '/api/versoes?card=x', h)).status, 400);
  } finally { s.close(); }
});

test('GET /aprovacoes (T14): só o grupo de aprovação; fila Em aprovação com filtros e RN-12', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const h = { 'X-Forwarded-Email': 'pessoa@vale.com' };
    assert.strictEqual((await pedir(s, '/api/aprovacoes')).status, 401);
    const r = await pedir(s, '/api/aprovacoes', h);
    assert.strictEqual(r.status, 200);
    assert.ok(r.corpo.itens.length > 0 && r.corpo.itens.length === r.corpo.total);
    // mais antigos primeiro
    r.corpo.itens.forEach((it, i, l) => { if (i) assert.ok(l[i - 1].idade >= it.idade); });
    // o usuário de demonstração é contribuidor em Salobo e Sossego: lá não decide (RN-12)
    assert.ok(r.corpo.itens.filter((it) => ['Salobo', 'Sossego'].includes(it.bu.sigla)).every((it) => it.podeDecidir === false));
    assert.ok(r.corpo.itens.filter((it) => !['Salobo', 'Sossego'].includes(it.bu.sigla)).every((it) => it.podeDecidir === true));
    const bu = await pedir(s, '/api/aprovacoes?bu=VNL', h);
    assert.ok(bu.corpo.itens.length && bu.corpo.itens.every((it) => it.bu.sigla === 'VNL'));
    const velhos = await pedir(s, '/api/aprovacoes?idade=5', h);
    assert.ok(velhos.corpo.itens.every((it) => it.idade >= 5));
    assert.strictEqual((await pedir(s, '/api/aprovacoes?idade=99', h)).corpo.filtro.idade, 'todas');
  } finally { s.close(); }
  const outros = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [{ papel: 'contribuidor', bu: 'Salobo' }] }));
  try {
    const h = { 'X-Forwarded-Email': 'contrib@vale.com' };
    assert.strictEqual((await pedir(outros, '/api/aprovacoes', h)).status, 403); // AC-08, CA-19
    assert.strictEqual((await enviar(outros, '/api/goal-card/comentario', { card: 'GC-VNL-04', secao: 'ruler', texto: 'Rever a régua' }, h)).status, 403);
  } finally { outros.close(); }
});

test('POST /goal-card/comentario: seção válida e texto obrigatório (simulação, RN-13)', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE }));
  try {
    const h = { 'X-Forwarded-Email': 'pessoa@vale.com' };
    const ok = await enviar(s, '/api/goal-card/comentario', { card: 'GC-VNL-04', secao: 'ruler', texto: 'Rever a régua com o orçamento.' }, h);
    assert.strictEqual(ok.status, 200); assert.strictEqual(ok.corpo.simulado, true); assert.strictEqual(ok.corpo.comentario.secao, 'ruler');
    assert.strictEqual((await enviar(s, '/api/goal-card/comentario', { card: 'GC-VNL-04', secao: 'xyz', texto: 'a' }, h)).status, 400);
    assert.strictEqual((await enviar(s, '/api/goal-card/comentario', { card: 'GC-VNL-04', secao: 'ruler', texto: '   ' }, h)).status, 400);
  } finally { s.close(); }
});

test('Novo ciclo: ano maior que o atual e datas das janelas no ano atual ou no seguinte, em ordem', () => {
  const hoje = new Date(2026, 10, 25), ok = [{ inicio: '2026-12-01', fim: '2026-12-10' }, { inicio: null, fim: '2026-12-20' }, { inicio: null, fim: '2027-01-10' }, { inicio: null, fim: '2027-01-20' }];
  assert.deepStrictEqual(validarNovoCiclo(2029, ok, hoje), []);
  assert.ok(validarNovoCiclo(2026, ok, hoje).some((e) => e.codigo === 'ANO'));
  assert.ok(validarNovoCiclo(2029, [{ inicio: '', fim: '' }, ...ok.slice(1)], hoje).some((e) => e.codigo === 'DATA'));
  assert.ok(validarNovoCiclo(2029, [{ inicio: '2028-01-01', fim: '2028-02-01' }, ...ok.slice(1)], hoje).some((e) => e.codigo === 'PERIODO'));
  assert.ok(validarNovoCiclo(2029, [{ inicio: '2026-12-10', fim: '2026-12-01' }, ...ok.slice(1)], hoje).some((e) => e.codigo === 'ORDEM'));
  assert.ok(validarNovoCiclo(2029, ok.slice(0, 3), hoje).some((e) => e.codigo === 'ETAPAS'));
  assert.deepStrictEqual(validarNovoCiclo(2029, undefined, hoje), []); // pop-up só com o ano: janelas em branco
});
