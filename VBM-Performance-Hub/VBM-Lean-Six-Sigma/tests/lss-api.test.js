// Testes do módulo de dados do LSS (node --test). Usam as planilhas reais de data/.
// Rodar na pasta: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { criarLeitor, criarLssRouter, _interno } = require('../lss-api');

const DADOS = path.join(__dirname, '..', 'data');

test('lê as duas planilhas com as regras do Power Query do .pbix', async () => {
  const d = await criarLeitor(DADOS).ler();
  assert.ok(d.projetos.length > 0, 'Portfolio sem projetos');
  assert.ok(d.projetos.every((p) => p.site), 'linha sem Site entrou (o .pbix filtra [Site] <> null)');
  assert.ok(!d.projetos.some((p) => p.ciclo === '2025 Cycle Online'), '"2025 Cycle Online" deveria virar "2025 Cycle"');
  assert.ok(!d.projetos.some((p) => /^delayed 2025 cycle$/i.test(p.statusDetalhe || '')), '"Delayed 2025 cycle" deveria virar "Delayed 2025"');
  assert.ok(d.projetos.every((p) => p.site === p.site.trim()), 'site com espaço sobrando');
  assert.ok(d.calendario.length > 0 && d.calendario.every((c) => c.projeto && c.inicio), 'Calendário por Projeto vazio ou sem início');
  assert.ok(d.historico.length > 0 && d.historico.every((h) => h.projeto), 'Historico vazio');
  assert.strictEqual(d.arquivos.length, 2);
  d.arquivos.forEach((a) => assert.ok(!isNaN(Date.parse(a.modificadoEm))));
});

test('cache: a segunda leitura devolve o mesmo objeto enquanto os arquivos não mudam', async () => {
  const l = criarLeitor(DADOS);
  const a = await l.ler(), b = await l.ler();
  assert.strictEqual(a, b);
});

test('pasta sem planilha responde 503 SEM_PLANILHA', async () => {
  const vazia = fs.mkdtempSync(path.join(os.tmpdir(), 'lss-'));
  const { router } = criarLssRouter({ pastaDados: vazia });
  const app = express(); app.use('/api', router);
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/dados`);
    assert.strictEqual(r.status, 503);
    assert.strictEqual((await r.json()).codigo, 'SEM_PLANILHA');
  } finally { srv.close(); }
});

test('cabeçalho é achado em qualquer linha e por nome sem acento/caixa', () => {
  const linhas = [['título'], [], ['Project ', 'Site', 'Status Detail', 'Etapa'], ['A', 'Salobo ', 'Delayed 2025 cycle', '2-Measure'], ['B', null, 'Completed', '5-Control']];
  const ps = _interno.projetosDoPortfolio(linhas);
  assert.strictEqual(ps.length, 1);
  assert.strictEqual(ps[0].site, 'Salobo');
  assert.strictEqual(ps[0].statusDetalhe, 'Delayed 2025');
});

test('valores de fórmula usam o resultado gravado e datas viram AAAA-MM-DD', () => {
  assert.strictEqual(_interno.numero({ formula: 'X', result: 0.5 }), 0.5);
  assert.strictEqual(_interno.data(new Date(Date.UTC(2026, 9, 31, 12))), '2026-10-31');
  assert.strictEqual(_interno.texto({ richText: [{ text: 'a ' }, { text: ' b' }] }), 'a b');
});
