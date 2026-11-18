// Testes do módulo de dados do AIP Goals (node --test). Sem banco e sem rede.
// Rodar na pasta do AIP Goals: npm test
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const path = require('path');
const { criarAipGoalsRouter, diasUteisEntre, agregarMetas, camposObrigatorios, validarDecisao, modoDoCard } = require('../aip-goals-api');

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

test('fonte "banco" sem modelo de dados responde 501 sem texto do banco', async () => {
  const s = await servidor(criarAipGoalsRouter({ fonte: 'banco', runQuery: async () => ({ recordset: [] }) }));
  try {
    const r = await pedir(s, '/api/inicio', { 'X-Forwarded-Email': 'pessoa@vale.com' });
    assert.strictEqual(r.status, 501);
    assert.strictEqual(r.corpo.codigo, 'MODELO_PENDENTE');
  } finally { s.close(); }
});

test('portal.js: só index.html e assets/ são públicos; arquivos internos dão 404', async () => {
  const montar = require('../portal');
  const raiz = path.join(__dirname, '..');
  const s = await servidor(null, (app) => { montar(app); app.use('/VBM-Aip-Goals', express.static(raiz)); });
  try {
    for (const interno of ['portal.js', 'aip-goals-api.js', 'dados-exemplo.js', 'server.js', 'package.json', 'tests/aip-goals-api.test.js', 'assets/../portal.js']) {
      assert.strictEqual((await pedir(s, '/VBM-Aip-Goals/' + interno)).status, 404, interno);
    }
    assert.strictEqual((await pedir(s, '/VBM-Aip-Goals/api/health')).corpo.status, 'healthy');
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
    for (const e of ['rascunho', 'em_aprovacao', 'em_revisao', 'aprovado', 'negado']) {
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

test('GET /metas: recorte por papel (AC-04/AC-05) e BU fora do recorte responde 404', async () => {
  const pontoFocal = () => [{ papel: 'ponto_focal', bu: 'Salobo' }];
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: pontoFocal }));
  try {
    const h = { 'X-Forwarded-Email': 'focal@vale.com' };
    const padrao = await pedir(s, '/api/metas', h);
    assert.strictEqual(padrao.corpo.bu.sigla, 'Salobo');
    assert.deepStrictEqual(padrao.corpo.bus.map((b) => b.sigla), ['Salobo']);
    assert.strictEqual((await pedir(s, '/api/metas?bu=VNL', h)).status, 404);
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

test('GET /desdobramento: colunas só das BUs do recorte (AC-04/AC-05)', async () => {
  const s = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [{ papel: 'ponto_focal', bu: 'Salobo' }] }));
  try {
    const r = await pedir(s, '/api/desdobramento', { 'X-Forwarded-Email': 'focal@vale.com' });
    assert.deepStrictEqual(r.corpo.bus.map((b) => b.sigla), ['Salobo']);
    assert.ok(r.corpo.linhas.every((l) => Object.keys(l.celulas).join() === 'Salobo' && l.celulas.Salobo));
    assert.ok(!r.corpo.linhas.some((l) => l.numero === 8)); // Bacaba é só de Sossego
  } finally { s.close(); }
  const s2 = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [] }));
  try { assert.strictEqual((await pedir(s2, '/api/desdobramento', { 'X-Forwarded-Email': 'x@vale.com' })).status, 403); } finally { s2.close(); }
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
  assert.deepStrictEqual(validarDecisao({ decisao: 'negar', comentario: 'Meta fora do desdobramento' }), []);
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
  const leitor = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [{ papel: 'consulta', bu: null }] }));
  try {
    const h = { 'X-Forwarded-Email': 'leitor@vale.com' };
    const r = await pedir(leitor, '/api/goal-card?card=GC-VNL-04', h);
    assert.strictEqual(r.corpo.modo, 'leitura'); // consulta vê todas as BUs, sem editar nem decidir
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

test('T11 Configuração: só o administrador; RN-16 recusa soma diferente do total; janelas em ordem', async () => {
  const { validarConfiguracao, somaPesosPorBu } = require('../aip-goals-api');
  const { configuracaoExemplo } = require('../dados-exemplo');
  const base = configuracaoExemplo(HOJE);
  assert.ok(somaPesosPorBu(base.metas, base.bus).every((x) => x.soma === 100)); // exemplo fecha 100 em todas as BUs
  const metas = JSON.parse(JSON.stringify(base.metas)); metas[1].pesos.Salobo = 10;
  const e = validarConfiguracao('metas', { metas }, base);
  assert.deepStrictEqual(e.filter((x) => x.codigo === 'RN16').map((x) => [x.bu, x.soma]), [['Salobo', 105]]);
  const etapas = base.ciclo.etapas.map((x) => ({ ...x })); etapas[2].fim = etapas[1].fim;
  assert.ok(validarConfiguracao('ciclo', { nome: 'AIP', etapas }, base).some((x) => x.codigo === 'ORDEM'));
  assert.ok(validarConfiguracao('grupos', { membros: [{ matricula: 'C1234', grupo: 'contribuidor', bu: 'X' }] }, base).some((x) => x.codigo === 'BU'));
  const admin = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [{ papel: 'admin', bu: null }] }));
  const contrib = await servidor(criarAipGoalsRouter({ agora: () => HOJE, papeisDe: () => [{ papel: 'contribuidor', bu: 'Salobo' }] }));
  try {
    const h = { 'X-Forwarded-Email': 'a@vale.com' };
    assert.strictEqual((await pedir(admin, '/api/configuracao', h)).status, 200);
    assert.strictEqual((await pedir(contrib, '/api/configuracao', h)).status, 403);
    const r = await enviar(admin, '/api/configuracao/salvar', { aba: 'metas', dados: { metas } }, h);
    assert.strictEqual(r.status, 400); assert.strictEqual(r.corpo.codigo, 'RN16');
    assert.strictEqual((await enviar(admin, '/api/configuracao/salvar', { aba: 'metas', dados: { metas: base.metas } }, h)).corpo.simulado, true);
    assert.strictEqual((await enviar(contrib, '/api/configuracao/salvar', { aba: 'metas', dados: { metas: base.metas } }, h)).status, 403);
  } finally { admin.close(); contrib.close(); }
});
