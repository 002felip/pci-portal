/**
 * VBM Lean Six Sigma — dados do programa LSS (Green Belt) como MÓDULO.
 *
 * Os dados NÃO estão em banco: vêm das duas planilhas que alimentavam o LSS_3.pbix,
 * guardadas em data/ nesta pasta (versionadas no repositório):
 *
 *   *Training*Tracker*.xlsx   abas Portfolio, "Comentario Geral Power BI", "Comentário por BU"
 *   *Coach*Manager*.xls[xm]   abas "Calendário por Projeto", Historico
 *
 * Para atualizar: substituir o arquivo em data/ (o nome pode mudar, desde que continue
 * casando com o padrão) e publicar. Havendo mais de um arquivo para o mesmo padrão, vale
 * o modificado por último. LSS_PASTA_DADOS (opcional) aponta para outra pasta.
 *
 * As mesmas transformações do Power Query do .pbix:
 *   - Portfolio: cabeçalho na linha de "Project"; só linhas com Site preenchido.
 *   - Cycle "2025 Cycle Online" → "2025 Cycle"; Status Detail "Delayed 2025 cycle" → "Delayed 2025".
 * Os cálculos das medidas (cards, gráficos, Gantt, calendário) ficam no navegador
 * (assets/js/lss.js); aqui só se lê e se normaliza.
 *
 * Leitura por streaming (ExcelJS WorkbookReader), só das abas usadas: as duas planilhas
 * são lidas em ~1 s. O resultado fica em memória até um dos arquivos mudar (tamanho ou data).
 *
 * Rotas:
 *   GET /ping    diagnóstico, sem ler as planilhas
 *   GET /dados   tudo o que a tela usa (projetos, comentários, calendário, histórico, arquivos)
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const ExcelJS = require('exceljs');
const unzipper = require('unzipper');

const TAG = '[vbm-lean-six-sigma]';

const ARQUIVOS = {
  tracker: { padrao: /training.*tracker.*\.xlsx$/i, abas: ['Portfolio', 'Comentario Geral Power BI', 'Comentário por BU'] },
  coach: { padrao: /coach.*manager.*\.xls[xm]$/i, abas: ['Calendário por Projeto', 'Historico'] },
};

// ── Valores de célula ────────────────────────────────────────────────
function dataIso(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  // As datas do Excel chegam em UTC à meia-noite (ou meio-dia): vale a data do calendário
  return d.toISOString().slice(0, 10);
}
function valor(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return valor(v.result);          // fórmula: vale o valor gravado
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return valor(v.text);              // hyperlink
    if ('error' in v) return null;
    return null;
  }
  return v;
}
function texto(v) {
  v = valor(v);
  if (v == null) return null;
  if (v instanceof Date) return dataIso(v);
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}
function numero(v) {
  v = valor(v);
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function data(v) {
  v = valor(v);
  if (v instanceof Date) return dataIso(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) return dataIso(new Date(Math.round((v - 25569) * 86400000)));
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}
const chave = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Linhas de uma aba como objetos, a partir da 1ª linha que tem todos os cabeçalhos pedidos. */
function tabela(linhas, obrigatorios) {
  const req = obrigatorios.map(chave);
  const iCab = linhas.findIndex((l) => {
    const nomes = new Set((l || []).map((c) => chave(texto(c))));
    return req.every((n) => nomes.has(n));
  });
  if (iCab < 0) throw new Error(`cabeçalho não encontrado (${obrigatorios.join(', ')})`);
  const cab = linhas[iCab].map((c) => chave(texto(c)));
  return linhas.slice(iCab + 1).map((l) => {
    const o = {};
    cab.forEach((nome, i) => { if (nome && !(nome in o)) o[nome] = l[i]; });
    return o;
  });
}

// ── Arquivos ─────────────────────────────────────────────────────────
function localizar(pasta, padrao) {
  let nomes = [];
  try { nomes = fs.readdirSync(pasta); } catch (e) { return null; }
  const achados = nomes.filter((n) => padrao.test(n) && !n.startsWith('~$'))
    .map((n) => { const p = path.join(pasta, n); const st = fs.statSync(p); return { nome: n, caminho: p, tamanho: st.size, mtime: st.mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime);
  return achados[0] || null;
}

/** Abas pedidas de uma planilha: { nomeDaAba: [[valores da linha], ...] } (índice 0 = coluna A). */
async function lerAbas(caminho, abas) {
  const quero = new Set(abas.map(chave));
  const leitor = new ExcelJS.stream.xlsx.WorkbookReader(caminho, { worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'cache', entries: 'emit' });
  const saida = {};
  for await (const ws of leitor) {
    const nome = ws.name || '';
    const usar = quero.has(chave(nome));
    const linhas = [];
    for await (const row of ws) {
      if (!usar) continue;
      const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
      linhas[row.number - 1] = vals;
    }
    if (usar) saida[chave(nome)] = Array.from(linhas, (l) => l || []);
  }
  const faltando = abas.filter((a) => !saida[chave(a)]);
  if (faltando.length) throw new Error(`aba(s) não encontrada(s) em ${path.basename(caminho)}: ${faltando.join(', ')}`);
  return saida;
}

/** Data de modificação gravada no próprio Excel (docProps/core.xml). A data do arquivo no
 *  disco não serve: muda a cada deploy. Sem ela, null. */
async function modificadoNoExcel(caminho) {
  try {
    const zip = await unzipper.Open.file(caminho);
    const core = zip.files.find((f) => f.path === 'docProps/core.xml');
    if (!core) return null;
    const m = /<dcterms:modified[^>]*>([^<]+)</.exec((await core.buffer()).toString('utf8'));
    const d = m && new Date(m[1]);
    return d && !isNaN(d) ? d.toISOString() : null;
  } catch (e) { return null; }
}

// ── Normalização (as mesmas regras do Power Query do LSS_3.pbix) ─────
function projetosDoPortfolio(linhas) {
  return tabela(linhas, ['Project', 'Site', 'Status Detail', 'Etapa'])
    .filter((r) => texto(r['site']) != null)
    .map((r) => {
      let detalhe = texto(r['status detail']);
      if (detalhe && /^delayed 2025 cycle$/i.test(detalhe)) detalhe = 'Delayed 2025';
      let ciclo = texto(r['cycle']);
      if (ciclo) ciclo = ciclo.replace(/2025 Cycle Online/i, '2025 Cycle');
      return {
        projeto: texto(r['project']),
        objetivo: texto(r['objetivo']),
        site: texto(r['site']),
        idioma: texto(r['language']),
        lider: texto(r['project leader']),
        gestor: texto(r['manager']),
        siteCI: texto(r['site ci']),
        status: texto(r['status']),
        statusDetalhe: detalhe,
        ciclo,
        etapa: texto(r['etapa']),
        inicioPrevisto: data(r['starting date forecast']),
        inicioReal: data(r['starting date actual']),
        conclusaoPrevista: data(r['conclusion date forecast']),
        conclusaoReal: data(r['conclusion date actual (certification ceremony)']),
        businessCase: texto(r['business case or site strategy']),
        estrategia: texto(r['what strategy?']),
        kpi: texto(r['kpi']),
        apuracao: texto(r['apuracao final (usd)']),
        certificacao: texto(r['certification (y/n)']),
        rating: texto(r['certification rating']),
        statusTreinamento: texto(r['status treinamento']),
        comentarios: texto(r['comentarios']),
        traction: texto(r['traction?']),
      };
    });
}
function comentariosGerais(linhas) {
  return tabela(linhas, ['Comment Geral (PT-BR)', 'Comment Geral (ENG)', 'Month'])
    .map((r) => ({ mes: data(r['month']), pt: texto(r['comment geral (pt-br)']), en: texto(r['comment geral (eng)']) }))
    .filter((c) => c.mes && (c.pt || c.en));
}
function comentariosPorBU(linhas) {
  return tabela(linhas, ['BU', 'Comment Geral', 'Month'])
    .map((r) => ({ bu: texto(r['bu']), mes: data(r['month']), texto: texto(r['comment geral']) }))
    .filter((c) => c.bu && c.mes && c.texto);
}
function calendarioPorProjeto(linhas) {
  return tabela(linhas, ['Belt', 'Projeto', 'Unidade', 'Início do Projeto'])
    .filter((r) => texto(r['projeto']) && texto(r['unidade']))
    .map((r) => ({
      belt: texto(r['belt']),
      statusDetalhe: texto(r['status detail']),
      projeto: texto(r['projeto']),
      unidade: texto(r['unidade']),
      realizadas: numero(r['sessoes realizadas']),
      agendadasMes: numero(r['sessoes agendadas no mes']),
      agendadasAteHoje: numero(r['sessoes agendadas ate o momento']),
      faltas: numero(r['faltas (belt faltou)']),
      previstas: numero(r['sessoes previstas']),
      aderenciaAcumulada: numero(r['% aderencia acumulada']),
      aderenciaTotal: numero(r['% aderencia sessoes totais']),
      inicio: data(r['inicio do projeto']),
      entregaDefinir: data(r['entrega definir']),
      entregaMedir: data(r['entrega medir']),
      entregaAnalisar: data(r['entrega analisar']),
      entregaMelhorar: data(r['entrega melhorar']),
      entregaControlar: data(r['entrega controlar']),
      conclusaoPrevista: data(r['conclusao prevista (sessoes coaching)']),
    }));
}
function historicoDeSessoes(linhas) {
  return tabela(linhas, ['Belt', 'Projeto', 'Sessão', 'Resultado da Sessão'])
    .filter((r) => texto(r['projeto']))
    .map((r) => ({
      projeto: texto(r['projeto']),
      unidade: texto(r['unidade']),
      sessao: texto(r['sessao']),
      fase: texto(r['fase']),
      coach: texto(r['coach']),
      data: data(r['data da sessao']),
      resultado: texto(r['resultado da sessao']),
    }));
}

// ── Leitura com cache por arquivo ────────────────────────────────────
function criarLeitor(pasta) {
  let cache = null; // { assinatura, dados }
  let emAndamento = null;

  async function ler() {
    const tracker = localizar(pasta, ARQUIVOS.tracker.padrao);
    const coach = localizar(pasta, ARQUIVOS.coach.padrao);
    const faltando = [!tracker && 'Training Tracker (.xlsx)', !coach && 'Coach Manager (.xlsm)'].filter(Boolean);
    if (faltando.length) {
      const e = new Error(`Planilha não encontrada em data/: ${faltando.join(' e ')}.`);
      e.codigo = 'SEM_PLANILHA';
      throw e;
    }
    const assinatura = [tracker, coach].map((a) => `${a.caminho}:${a.tamanho}:${a.mtime}`).join('|');
    if (cache && cache.assinatura === assinatura) return cache.dados;
    if (emAndamento && emAndamento.assinatura === assinatura) return emAndamento.promessa;

    const promessa = (async () => {
      const t0 = Date.now();
      const [abasT, abasC, modT, modC] = await Promise.all([
        lerAbas(tracker.caminho, ARQUIVOS.tracker.abas),
        lerAbas(coach.caminho, ARQUIVOS.coach.abas),
        modificadoNoExcel(tracker.caminho),
        modificadoNoExcel(coach.caminho),
      ]);
      const dados = {
        geradoEm: new Date().toISOString(),
        arquivos: [
          { tipo: 'tracker', nome: tracker.nome, modificadoEm: modT || new Date(tracker.mtime).toISOString() },
          { tipo: 'coach', nome: coach.nome, modificadoEm: modC || new Date(coach.mtime).toISOString() },
        ],
        projetos: projetosDoPortfolio(abasT[chave('Portfolio')]),
        comentariosGerais: comentariosGerais(abasT[chave('Comentario Geral Power BI')]),
        comentariosBU: comentariosPorBU(abasT[chave('Comentário por BU')]),
        calendario: calendarioPorProjeto(abasC[chave('Calendário por Projeto')]),
        historico: historicoDeSessoes(abasC[chave('Historico')]),
      };
      console.log(`${TAG} planilhas lidas em ${Date.now() - t0} ms: ${dados.projetos.length} projetos, ${dados.calendario.length} no calendário, ${dados.historico.length} sessões no histórico`);
      cache = { assinatura, dados };
      return dados;
    })();
    emAndamento = { assinatura, promessa };
    try { return await promessa; } finally { if (emAndamento && emAndamento.promessa === promessa) emAndamento = null; }
  }
  return { ler };
}

function criarLssRouter({ pastaDados } = {}) {
  const pasta = pastaDados || process.env.LSS_PASTA_DADOS || path.join(__dirname, 'data');
  const leitor = criarLeitor(pasta);
  const router = express.Router();

  router.get('/ping', (req, res) => res.json({ ok: true }));
  router.get('/dados', async (req, res) => {
    try {
      res.json(await leitor.ler());
    } catch (err) {
      console.error(`${TAG} falha ao ler as planilhas:`, err.message);
      res.status(err.codigo === 'SEM_PLANILHA' ? 503 : 500).json({ error: err.codigo === 'SEM_PLANILHA' ? err.message : 'Não foi possível ler as planilhas do LSS.', codigo: err.codigo || 'ERRO_PLANILHA' });
    }
  });
  return { router, leitor };
}

module.exports = { criarLssRouter, criarLeitor, _interno: { tabela, texto, numero, data, chave, projetosDoPortfolio, calendarioPorProjeto, historicoDeSessoes } };
