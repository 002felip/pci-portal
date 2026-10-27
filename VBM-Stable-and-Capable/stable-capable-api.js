/**
 * VBM Stable & Capable — rotas e execução do gerador de PDFs, como MÓDULO.
 *
 * Mesmo contrato dos módulos de API das outras aplicações do Hub
 * (coo-api.js, performancehub-api.js): quem monta (portal.js no Portal,
 * server.js standalone) injeta `runQuery(sql, params?)`, que devolve
 * `.recordset` (pacote `mssql`); `params` = { nome: [tipoMssql, valor] } e
 * vira `request.input` — nada da requisição é concatenado na SQL.
 *
 * FLUXO DE UMA EXECUÇÃO (uma por vez):
 *   1. consulta  database/query_stable_and_capable.sql com @dtInicio/@dtFim
 *                (as duas datas fixas do script viram parâmetro; ver CONSULTA)
 *   2. entrada   resultado gravado como Stable.xlsx (aba "base"), o MESMO
 *                arquivo que antes era exportado à mão
 *   3. pdfs      python/scripts/generate_multi_kpi_report.py, uma BU por vez
 *                (uma BU com erro não impede as outras)
 *   4. blob      PDFs + Stable.xlsx + log em <pasta>/<id da execução>/, e o
 *                histórico em <pasta>/execucoes.json
 *
 * O SAS do Blob não chega ao navegador: os downloads passam por
 * GET /execucoes/:id/arquivos/:nome, que busca os bytes e repassa.
 * O histórico fica num JSON no próprio Blob porque o SAS atual (sp=racw)
 * não tem 'l' (listar) — não dá para descobrir as pastas pelo Azure.
 *
 * Rotas:
 *   GET  /ping                              diagnóstico sem banco
 *   GET  /config                            BUs, período sugerido, limites, estado
 *   GET  /diagnostico                       Python + bibliotecas + Blob (sem banco)
 *   GET  /execucoes                         histórico (mais recente primeiro)
 *   POST /execucoes  {inicio, fim, bus[]}   inicia; 409 se já houver uma rodando
 *   GET  /execucoes/:id                     estado, progresso por BU e fim do log
 *   POST /execucoes/:id/cancelar            interrompe a execução em andamento
 *   GET  /execucoes/:id/arquivos/:nome      download (?inline=1 abre o PDF no navegador)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const express = require('express');
const sql = require('mssql');

const TAG = '[stable-and-capable]';
const RAIZ = __dirname;
const PYTHON_DIR = path.join(RAIZ, 'python');
const SCRIPT_PY = path.join(PYTHON_DIR, 'scripts', 'generate_multi_kpi_report.py');
const CONFIG_PY = path.join(PYTHON_DIR, 'config', 'report_config.yaml');

// BUs do CASE do script (o 'outros' do ELSE não gera relatório).
const BUS = ['Manitoba', 'Onça Puma', 'Ontario', 'Salobo', 'Sossego', 'VNL+IR'];
const MAX_ANOS = 10;                       // limite do gerador (max_years 1..10)
const TIMEOUT_BU_MS = 20 * 60 * 1000;      // uma BU leva ~30 s; 20 min = travou
const HISTORICO_MAX = 300;
const LOG_MEMORIA = 400;                   // linhas de log mantidas por execução

// ── SQL ─────────────────────────────────────────────────────────────
// O script vem do time como foi entregue (database/). Todo mês só a data
// fim mudava; aqui o par de datas do WHERE vira parâmetro. Se o script
// mudar e o padrão não aparecer exatamente 1 vez, o módulo falha ao subir
// em vez de consultar um período errado.
const CONSULTA = (() => {
  const arquivo = path.join(RAIZ, 'database', 'query_stable_and_capable.sql');
  const original = fs.readFileSync(arquivo, 'utf8');
  // Só o que vem ANTES do bloco /* ... */ final (versão antiga, comentada).
  const ativo = original.replace(/\/\*[\s\S]*?\*\//g, '');
  const PADRAO = /PVC\.DT_REF\s+BETWEEN\s+convert\(\s*datetime\s*,\s*'\d{4}-\d{2}-\d{2}'\s*,\s*121\s*\)\s+AND\s+convert\(\s*datetime\s*,\s*'\d{4}-\d{2}-\d{2}'\s*,\s*121\s*\)/gi;
  const achados = ativo.match(PADRAO) || [];
  if (achados.length !== 1) {
    throw new Error(`${TAG} query_stable_and_capable.sql: esperado 1 filtro "PVC.DT_REF BETWEEN convert(datetime,'AAAA-MM-DD',121) AND convert(...)", encontrado ${achados.length}.`);
  }
  return ativo.replace(PADRAO, 'PVC.DT_REF BETWEEN @dtInicio AND @dtFim');
})();

// ── Datas ───────────────────────────────────────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function dataIso(s) {
  if (!ISO.test(String(s || ''))) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}
const iso = (d) => d.toISOString().slice(0, 10);

/** Período do fluxo mensal: 1º de janeiro do ano anterior → último dia do mês anterior. */
function periodoSugerido(hoje = new Date()) {
  const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 0));
  const inicio = new Date(Date.UTC(fim.getUTCFullYear() - 1, 0, 1));
  return { inicio: iso(inicio), fim: iso(fim) };
}

// ── Python ──────────────────────────────────────────────────────────
let pythonCache = null;
function rodar(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60000, ...opts }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), erro: err }));
  });
}
/** Primeiro executável que existe: STABLECAPABLE_PYTHON, python3, python. */
async function acharPython() {
  if (pythonCache) return pythonCache;
  const candidatos = [process.env.STABLECAPABLE_PYTHON, 'python3', 'python'].filter(Boolean);
  for (const c of candidatos) {
    const r = await rodar(c, ['--version']);
    if (r.ok) { pythonCache = { cmd: c, versao: (r.stdout || r.stderr).trim() }; return pythonCache; }
  }
  throw new Error('Python não encontrado (tentado: ' + candidatos.join(', ') + ').');
}

function envPython() {
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    MPLBACKEND: 'Agg',
    // Não herdar módulos de outro lugar: o gerador importa `src` da própria pasta.
    PYTHONPATH: PYTHON_DIR,
  };
}

// ── Excel de entrada (o mesmo Stable.xlsx de antes, aba "base") ──────
async function gravarExcel(recordset, destino) {
  const ExcelJS = require('exceljs');
  const colunas = Object.keys(recordset.columns || (recordset[0] || {}));
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: destino, useStyles: false, useSharedStrings: false });
  const ws = wb.addWorksheet('base');
  ws.columns = colunas.map((c) => ({ header: c, key: c }));
  for (const linha of recordset) ws.addRow(linha).commit();
  ws.commit();
  await wb.commit();
}

// ── Armazenamento ───────────────────────────────────────────────────
/** Sem Blob configurado (desenvolvimento local): grava numa pasta do disco,
 *  com a mesma interface { configurado, enviar, baixar } do azure-blob. */
function armazenamentoLocal(pasta) {
  const raiz = pasta || path.join(os.tmpdir(), 'stable-and-capable-arquivos');
  const caminho = (rel) => {
    const alvo = path.resolve(raiz, ...String(rel).split('/').filter(Boolean));
    if (!alvo.startsWith(path.resolve(raiz))) throw new Error('caminho inválido');
    return alvo;
  };
  return {
    local: true,
    raiz,
    configurado: () => true,
    async enviar(rel, buffer) { const a = caminho(rel); await fs.promises.mkdir(path.dirname(a), { recursive: true }); await fs.promises.writeFile(a, buffer); },
    async baixar(rel) { return { buffer: await fs.promises.readFile(caminho(rel)), contentType: 'application/octet-stream' }; },
  };
}

const TIPOS = { '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.log': 'text/plain; charset=utf-8', '.json': 'application/json' };
const tipo = (nome) => TIPOS[path.extname(nome).toLowerCase()] || 'application/octet-stream';
const nomeArquivoBu = (bu) => String(bu).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9+]+/g, '_').replace(/^_|_$/g, '');

// ════════════════════════════════════════════════════════════════════
function criarStableCapableRouter({ runQuery, armazenamento, pastaBlob }) {
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));

  const PASTA = String(pastaBlob || '01 - Imagens/Stable & Capable').replace(/^\/+|\/+$/g, '');
  const store = armazenamento && armazenamento.configurado && armazenamento.configurado()
    ? armazenamento
    : armazenamentoLocal(process.env.STABLECAPABLE_PASTA_LOCAL);
  if (store.local) console.warn(`${TAG} Azure Blob não configurado — arquivos gravados em ${store.raiz} (somem quando o app reinicia).`);
  const ARQ_HISTORICO = PASTA + '/execucoes.json';

  // ── Histórico ──
  let historico = null;           // [{...execução sem log}], mais recente primeiro
  let atual = null;               // execução em andamento (com processo e log)

  async function carregarHistorico() {
    if (historico) return historico;
    try {
      const { buffer } = await store.baixar(ARQ_HISTORICO);
      const dados = JSON.parse(buffer.toString('utf8'));
      historico = Array.isArray(dados) ? dados : [];
    } catch (err) {
      if (!/404|ENOENT|BlobNotFound/i.test(err.message)) console.warn(`${TAG} histórico ilegível (${err.message}) — começando vazio.`);
      historico = [];
    }
    return historico;
  }
  async function salvarHistorico() {
    const dados = historico.slice(0, HISTORICO_MAX);
    try { await store.enviar(ARQ_HISTORICO, Buffer.from(JSON.stringify(dados, null, 1), 'utf8'), 'application/json'); }
    catch (err) { console.error(`${TAG} falha ao gravar histórico:`, err.message); }
  }
  const publico = (e) => { if (!e) return e; const { log, processo, cancelar, ...resto } = e; return resto; };

  // ── Rotas ──
  router.get('/ping', (req, res) => res.json({ ok: true, app: 'stable-and-capable' }));

  router.get('/config', async (req, res) => {
    res.json({
      bus: BUS,
      periodoSugerido: periodoSugerido(),
      maxAnos: MAX_ANOS,
      armazenamento: store.local ? 'local' : 'blob',
      pasta: PASTA,
      emExecucao: atual ? publico(atual) : null,
    });
  });

  router.get('/diagnostico', async (req, res) => {
    const out = { armazenamento: store.local ? 'local (' + store.raiz + ')' : 'Azure Blob: ' + PASTA };
    try {
      const py = await acharPython();
      out.python = py.versao;
      const r = await rodar(py.cmd, ['-c', 'import pandas, numpy, matplotlib, plotly, kaleido, scipy, openpyxl, reportlab, PIL, yaml; print("ok")'], { env: envPython(), cwd: PYTHON_DIR });
      out.bibliotecas = r.ok ? 'ok' : (r.stderr.trim().split('\n').pop() || 'falha ao importar');
    } catch (err) {
      out.python = err.message;
    }
    out.pronto = out.bibliotecas === 'ok';
    res.status(out.pronto ? 200 : 503).json(out);
  });

  router.get('/execucoes', async (req, res) => {
    try {
      const lista = await carregarHistorico();
      res.json({ emExecucao: atual ? publico(atual) : null, execucoes: lista.filter((e) => !atual || e.id !== atual.id) });
    } catch (err) {
      console.error(TAG, 'histórico:', err.message);
      res.status(500).json({ error: 'Falha ao ler o histórico.' });
    }
  });

  router.get('/execucoes/:id', async (req, res) => {
    if (atual && atual.id === req.params.id) return res.json({ ...publico(atual), log: atual.log.slice(-120) });
    const e = (await carregarHistorico()).find((x) => x.id === req.params.id);
    if (!e) return res.status(404).json({ error: 'Execução não encontrada.' });
    res.json(e);
  });

  router.post('/execucoes/:id/cancelar', (req, res) => {
    if (!atual || atual.id !== req.params.id) return res.status(409).json({ error: 'Esta execução não está em andamento.' });
    atual.cancelar();
    res.json({ ok: true });
  });

  router.get('/execucoes/:id/arquivos/:nome', async (req, res) => {
    try {
      const lista = await carregarHistorico();
      const e = (atual && atual.id === req.params.id) ? atual : lista.find((x) => x.id === req.params.id);
      const arq = e && (e.arquivos || []).find((a) => a.nome === req.params.nome);
      if (!arq) return res.status(404).json({ error: 'Arquivo não encontrado.' });
      const { buffer } = await store.baixar(arq.caminho);
      const disp = req.query.inline === '1' && /\.pdf$/i.test(arq.nome) ? 'inline' : 'attachment';
      res.set('Content-Type', tipo(arq.nome));
      res.set('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(arq.nome)}`);
      res.send(buffer);
    } catch (err) {
      console.error(TAG, 'download:', err.message);
      res.status(502).json({ error: 'Não foi possível baixar o arquivo do armazenamento.' });
    }
  });

  router.post('/execucoes', async (req, res) => {
    if (atual) return res.status(409).json({ error: 'Já existe uma execução em andamento.', emExecucao: publico(atual) });

    const inicio = dataIso(req.body && req.body.inicio);
    const fim = dataIso(req.body && req.body.fim);
    const hoje = new Date();
    if (!inicio || !fim) return res.status(400).json({ error: 'Informe data início e data fim (AAAA-MM-DD).' });
    if (fim < inicio) return res.status(400).json({ error: 'A data fim deve ser igual ou posterior à data início.' });
    if (fim > hoje) return res.status(400).json({ error: 'A data fim não pode estar no futuro.' });
    const anos = fim.getUTCFullYear() - inicio.getUTCFullYear() + 1;
    if (anos > MAX_ANOS) return res.status(400).json({ error: `O período pode abranger no máximo ${MAX_ANOS} anos.` });

    const pedidas = Array.isArray(req.body.bus) && req.body.bus.length ? req.body.bus : BUS;
    const bus = BUS.filter((b) => pedidas.includes(b));
    if (!bus.length) return res.status(400).json({ error: 'Selecione ao menos uma Business Unit.' });

    try { await acharPython(); } catch (err) {
      return res.status(503).json({ error: 'O ambiente Python do app não está disponível: ' + err.message });
    }
    await carregarHistorico();

    const agora = new Date();
    const id = agora.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + '-' + crypto.randomBytes(2).toString('hex');
    atual = {
      id,
      status: 'consultando',
      inicio: iso(inicio),
      fim: iso(fim),
      anos,
      usuario: String(req.get('X-Forwarded-Email') || req.get('X-Forwarded-Preferred-Username') || '').trim() || null,
      criadaEm: agora.toISOString(),
      terminadaEm: null,
      linhas: null,
      pasta: PASTA + '/' + id,
      bus: bus.map((b) => ({ bu: b, status: 'aguardando', paginas: null })),
      arquivos: [],
      erro: null,
      log: [],
    };
    res.status(202).json(publico(atual));
    executar(atual).catch((err) => console.error(TAG, 'execução', id, err));
  });

  // ── Execução ──
  async function executar(ex) {
    let cancelado = false;
    ex.cancelar = () => { cancelado = true; if (ex.processo) ex.processo.kill('SIGTERM'); registrar('Cancelamento solicitado.'); };
    function registrar(linha) {
      const l = `${new Date().toISOString().slice(11, 19)} ${linha}`;
      ex.log.push(l);
      if (ex.log.length > LOG_MEMORIA * 4) ex.log.splice(0, ex.log.length - LOG_MEMORIA * 4);
    }
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stable-capable-'));
    const logCompleto = [];
    const anotar = (l) => { logCompleto.push(l); registrar(l); };

    try {
      // 1. Consulta
      anotar(`Consultando o banco: ${ex.inicio} → ${ex.fim}`);
      const t0 = Date.now();
      const r = await runQuery(CONSULTA, {
        dtInicio: [sql.Date, new Date(ex.inicio + 'T00:00:00Z')],
        dtFim: [sql.Date, new Date(ex.fim + 'T00:00:00Z')],
      });
      const linhas = r.recordset || [];
      ex.linhas = linhas.length;
      anotar(`Consulta concluída: ${linhas.length} linhas em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      if (!linhas.length) throw new Error('A consulta não retornou dados para o período escolhido.');
      if (cancelado) throw new Error('Cancelada.');

      const comDados = new Set(linhas.map((l) => l['BUSINESS UNIT']));
      for (const b of ex.bus) if (!comDados.has(b.bu)) { b.status = 'sem-dados'; b.erro = 'Sem dados no período.'; }

      // 2. Stable.xlsx
      const xlsx = path.join(tmp, 'Stable.xlsx');
      await gravarExcel(linhas, xlsx);
      const nomeEntrada = `Stable_${ex.inicio}_${ex.fim}.xlsx`;
      await store.enviar(ex.pasta + '/' + nomeEntrada, await fs.promises.readFile(xlsx), tipo('.xlsx'));
      ex.arquivos.push({ nome: nomeEntrada, caminho: ex.pasta + '/' + nomeEntrada, tipo: 'entrada', tamanho: (await fs.promises.stat(xlsx)).size });
      anotar(`Entrada gravada: ${nomeEntrada}`);

      // 3. PDFs, uma BU por vez
      ex.status = 'gerando';
      const py = await acharPython();
      for (const b of ex.bus) {
        if (cancelado) break;
        if (b.status === 'sem-dados') continue;
        b.status = 'gerando';
        const saida = path.join(tmp, 'pdf', nomeArquivoBu(b.bu));
        const args = [SCRIPT_PY, '--bu', b.bu, '--config', CONFIG_PY, '--data-file', xlsx,
          '--output-dir', saida, '--log-dir', path.join(tmp, 'logs'),
          '--years', String(Math.min(Math.max(ex.anos, 1), MAX_ANOS)), '--reference-year', ex.fim.slice(0, 4)];
        anotar(`── ${b.bu}: gerando PDF`);
        const codigo = await new Promise((resolve) => {
          const p = spawn(py.cmd, args, { cwd: PYTHON_DIR, env: envPython() });
          ex.processo = p;
          const limite = setTimeout(() => { anotar(`${b.bu}: tempo limite excedido — interrompendo.`); p.kill('SIGKILL'); }, TIMEOUT_BU_MS);
          let resto = '';
          const ler = (chunk) => {
            const partes = (resto + chunk.toString('utf8')).split(/\r?\n/);
            resto = partes.pop();
            for (const linha of partes) {
              if (!linha.trim() || /FutureWarning|^\s*(The behavior|Downcasting)/.test(linha)) continue;
              logCompleto.push(linha);
              const m = linha.match(/\[(\d+)\/(\d+)\]/);
              if (m) b.paginas = { atual: Number(m[1]), total: Number(m[2]) };
              if (/\| (INFO|WARNING|ERROR)/.test(linha)) registrar(linha.replace(/^\S+ \S+ \| /, ''));
              const falha = linha.match(/(?:FAILED|ERROR)[^:]*:\s*(.+)$/);
              if (falha && !b.erro) b.erro = falha[1].trim();
            }
          };
          p.stdout.on('data', ler);
          p.stderr.on('data', ler);
          p.on('error', (err) => { b.erro = err.message; });
          p.on('close', (code) => { clearTimeout(limite); ex.processo = null; if (resto.trim()) ler('\n'); resolve(code); });
        });

        if (cancelado) { b.status = 'cancelada'; break; }
        const pdf = codigo === 0 && fs.existsSync(saida) ? fs.readdirSync(saida).find((f) => f.toLowerCase().endsWith('.pdf')) : null;
        if (!pdf) {
          b.status = 'erro';
          b.erro = b.erro || `O gerador terminou com código ${codigo}.`;
          anotar(`${b.bu}: ERRO — ${b.erro}`);
          continue;
        }
        const nome = `${nomeArquivoBu(b.bu)}_${ex.inicio}_${ex.fim}.pdf`;
        const buffer = await fs.promises.readFile(path.join(saida, pdf));
        await store.enviar(ex.pasta + '/' + nome, buffer, 'application/pdf');
        ex.arquivos.push({ nome, caminho: ex.pasta + '/' + nome, tipo: 'pdf', bu: b.bu, tamanho: buffer.length });
        b.status = 'ok';
        b.arquivo = nome;
        anotar(`${b.bu}: PDF salvo (${(buffer.length / 1048576).toFixed(1)} MB)`);
      }

      if (cancelado) for (const b of ex.bus) if (b.status === 'aguardando' || b.status === 'gerando') b.status = 'cancelada';
      const ok = ex.bus.filter((b) => b.status === 'ok').length;
      const falhas = ex.bus.filter((b) => b.status === 'erro').length;
      ex.status = cancelado ? 'cancelada' : (ok === 0 ? 'erro' : (falhas ? 'concluida-com-erros' : 'concluida'));
      if (!ok && !cancelado) ex.erro = 'Nenhum PDF foi gerado.';
    } catch (err) {
      ex.status = cancelado ? 'cancelada' : 'erro';
      ex.erro = cancelado ? null : (/Cancelada/.test(err.message) ? null : err.message);
      if (ex.erro) console.error(TAG, ex.id, err.message);
      anotar('ERRO: ' + (ex.erro || 'cancelada'));
      for (const b of ex.bus) if (b.status === 'aguardando' || b.status === 'gerando') b.status = cancelado ? 'cancelada' : 'nao-gerada';
    } finally {
      ex.terminadaEm = new Date().toISOString();
      anotar(`Fim: ${ex.status}`);
      // Log completo junto dos PDFs (ajuda a investigar sem acesso ao terminal do app)
      try {
        const nomeLog = 'execucao.log';
        await store.enviar(ex.pasta + '/' + nomeLog, Buffer.from(logCompleto.join('\n'), 'utf8'), tipo('.log'));
        ex.arquivos.push({ nome: nomeLog, caminho: ex.pasta + '/' + nomeLog, tipo: 'log' });
      } catch (err) { console.warn(TAG, 'log:', err.message); }
      historico.unshift(publico(ex));
      await salvarHistorico();
      atual = null;
      fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  return router;
}

module.exports = { criarStableCapableRouter, periodoSugerido, BUS, CONSULTA };
