/**
 * Aplicações PYTHON dentro do Portal (VBM-Vdt, VBM-Cockpit).
 *
 * Um Databricks App roda UM processo, e o do Portal é Node. Cada aplicação
 * Python (FastAPI/uvicorn) roda aqui como PROCESSO FILHO numa porta interna
 * (127.0.0.1), e o Portal encaminha /<pasta>/... para ela, tirando o prefixo.
 * A aplicação continua igual à versão standalone: ela acha que está na raiz.
 *
 *   montarAppPython(portal, {
 *     pasta: 'VBM-Vdt',                // pasta no disco = prefixo na URL
 *     porta: 8101,                     // porta interna (STABLE p/ log)
 *     args: (porta) => [...],          // argumentos do Python
 *     env: (pastaAbs) => ({...}),      // variáveis só desta aplicação
 *     testeImport: 'import fastapi',   // bibliotecas que precisam existir
 *     reescrever: true,                // ajustar caminhos absolutos (ver abaixo)
 *   });
 *
 * PYTHON E BIBLIOTECAS — mesmas lições do VBM-Stable-and-Capable:
 *   · o PATH do Databricks Apps tem entradas RELATIVAS (".venv/bin"), então
 *     o executável é resolvido para caminho ABSOLUTO e o PATH dos filhos
 *     também (o filho roda com cwd na própria pasta);
 *   · se o Python não importar as bibliotecas da aplicação, o Portal instala
 *     <pasta>/requirements.txt em <pasta>/.pylibs (pip --target) e usa essa
 *     pasta no PYTHONPATH. Na 1ª subida após o deploy leva alguns minutos;
 *     a tela mostra "iniciando" e recarrega sozinha.
 *
 * CAMINHOS ABSOLUTOS (reescrever: true) — o frontend compilado do VDT pede
 * /assets/... e /api/..., que no Portal são do Portal e do Kaizen. Em HTML,
 * CSS e JS vindos da aplicação, o Portal troca esses caminhos por
 * /<pasta>/assets/... e /<pasta>/api/... Assim um build novo do VDT funciona
 * só copiando a pasta, sem rebuild. O Cockpit NÃO precisa: ele usa rotas no
 * navegador, então o build já sai com o prefixo (npm run build:portal).
 *
 * Uma aplicação que não sobe NUNCA derruba o Portal: a rota responde 503 com
 * o motivo, e o processo é reiniciado com espera crescente.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');

const RAIZ = __dirname;
// Processos filhos de todas as aplicações: encerrados JUNTOS com o Portal.
const filhos = new Set();
let encerrando = false;
function encerrarFilhos() {
  encerrando = true;
  for (const pid of filhos) { try { process.kill(pid, 'SIGTERM'); } catch (e) { /* já saiu */ } }
}
process.once('exit', encerrarFilhos);
['SIGTERM', 'SIGINT'].forEach((sinal) => process.once(sinal, () => { encerrarFilhos(); process.exit(0); }));

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

// ── Python (compartilhado pelas aplicações) ─────────────────────────
const absolutoDoApp = (p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p));
const pathAbsoluto = () => String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(absolutoDoApp).join(path.delimiter);

function rodar(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), erro: err }));
  });
}
const motivo = (r) => {
  const saida = (r.stderr || r.stdout || '').trim().split('\n').filter(Boolean).pop();
  if (saida) return saida;
  const e = r.erro || {};
  return [e.code, e.syscall, e.path, e.message].filter(Boolean).join(' · ') || 'falha';
};

let pythonPromessa = null;
/** Pythons disponíveis, com caminho ABSOLUTO (sys.executable pode vir relativo). */
function pythonsDisponiveis() {
  if (!pythonPromessa) {
    pythonPromessa = (async () => {
      const nomes = [process.env.PORTAL_PYTHON, 'python3', 'python', '/usr/bin/python3', '/usr/local/bin/python3'].filter(Boolean);
      const lista = [];
      for (const nome of [...new Set(nomes)]) {
        const r = await rodar(nome, ['-c', 'import sys; print(sys.executable); print(sys.version.split()[0])']);
        if (!r.ok) continue;
        const [exe, versao] = r.stdout.trim().split('\n');
        const abs = exe && absolutoDoApp(exe.trim());
        if (abs && fs.existsSync(abs) && !lista.some((p) => p.cmd === abs)) lista.push({ cmd: abs, versao: 'Python ' + versao });
      }
      if (!lista.length) throw new Error('Python não encontrado (tentado: ' + nomes.join(', ') + ')');
      return lista;
    })();
    pythonPromessa.catch(() => { pythonPromessa = null; });
  }
  return pythonPromessa;
}

// ── Reescrita de caminhos absolutos ─────────────────────────────────
function reescritor(prefixo) {
  const p = prefixo.replace(/\/$/, '');
  const jaTem = p.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/'; // "VBM-Vdt/"
  return {
    html: (s) => s.replace(new RegExp(`(\\s(?:src|href)=["'])\\/(?!\\/)(?!${jaTem})`, 'g'), `$1${p}/`),
    css: (s) => s.replace(new RegExp(`url\\((["']?)\\/(?!\\/)(?!${jaTem})`, 'g'), `url($1${p}/`),
    js: (s) => s
      // fetch(`/api/...`), "/api/...", '/assets/...'
      .replace(/([`"'])\/(api|assets)(\/|[`"'?])/g, `$1${p}/$2$3`)
      // carregador de módulos do Vite: function(e){return"/"+e}
      .replace(/return"\/"\+([A-Za-z_$][\w$]*)/g, `return"${p}/"+$1`),
  };
}

// ── Página de espera / erro ─────────────────────────────────────────
function paginaEspera(titulo, estado) {
  const iniciando = estado.estado !== 'erro';
  const msg = iniciando
    ? (estado.estado === 'instalando'
      ? 'Preparando o ambiente Python da aplicação (só na primeira vez após o deploy, alguns minutos).'
      : 'A aplicação está iniciando.')
    : 'A aplicação não conseguiu iniciar. O administrador pode ver o motivo nos logs do Portal.';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${iniciando ? '<meta http-equiv="refresh" content="6">' : ''}
<title>${titulo}</title><link rel="stylesheet" href="/assets/css/poppins.css">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:Poppins,system-ui,sans-serif;
background:linear-gradient(135deg,#041523 0%,#072842 55%,#0b3a64 100%);color:#f4f7fb}
.c{max-width:440px;padding:1.75rem;border-radius:1rem;text-align:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16)}
h1{font-size:1.1rem;font-weight:600;margin:0 0 .6rem}p{font-size:.85rem;line-height:1.5;color:rgba(255,255,255,.72);margin:0}
.s{width:28px;height:28px;margin:0 auto 1rem;border-radius:50%;border:3px solid rgba(255,255,255,.2);border-top-color:#3cb5e5;animation:g 1s linear infinite}
@keyframes g{to{transform:rotate(360deg)}}a{color:#7dd3f0}</style></head>
<body><div class="c">${iniciando ? '<div class="s"></div>' : ''}<h1>${titulo}</h1><p>${msg}</p>
<p style="margin-top:1rem"><a href="/">Voltar ao Portal</a></p></div></body></html>`;
}

// ════════════════════════════════════════════════════════════════════
module.exports = function montarAppPython(portal, cfg) {
  const pastaAbs = path.join(RAIZ, cfg.pasta);
  const prefixo = '/' + cfg.pasta;
  const TAG = `[${cfg.pasta.toLowerCase()}]`;
  const titulo = cfg.titulo || cfg.pasta;
  const porta = parseInt(process.env[cfg.variavelPorta || ''] || cfg.porta, 10);
  const reescrever = cfg.reescrever ? reescritor(prefixo) : null;
  const estado = { estado: 'iniciando', mensagem: null, python: null, libdir: null, pid: null, reinicios: 0 };

  function envFilho() {
    return {
      ...process.env,
      PATH: pathAbsoluto(),
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONPATH: [pastaAbs, estado.libdir].filter(Boolean).join(path.delimiter),
      ...(cfg.env ? cfg.env(pastaAbs) : {}),
    };
  }

  /** Python que importa tudo desta aplicação; instala em <pasta>/.pylibs se preciso. */
  async function prepararPython() {
    const pythons = await pythonsDisponiveis();
    const libdir = path.join(pastaAbs, '.pylibs');
    const opcoes = [null, fs.existsSync(libdir) ? libdir : null].filter((x, i) => i === 0 || x);
    for (const py of pythons) {
      for (const lib of opcoes) {
        estado.libdir = lib;
        const r = await rodar(py.cmd, ['-c', cfg.testeImport], { cwd: pastaAbs, env: envFilho() });
        if (r.ok) return Object.assign(estado, { python: py.cmd, versao: py.versao });
      }
    }
    estado.estado = 'instalando';
    const requisitos = path.join(pastaAbs, 'requirements.txt');
    console.log(`${TAG} bibliotecas Python ausentes — instalando ${requisitos} em ${libdir} (alguns minutos)…`);
    let ultima = '';
    for (const py of pythons) {
      const inst = await rodar(py.cmd, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-warn-script-location',
        '--upgrade', '--target', libdir, '-r', requisitos], { timeout: 30 * 60 * 1000, env: { ...process.env, PATH: pathAbsoluto(), PIP_NO_CACHE_DIR: '1' } });
      if (!inst.ok) { ultima = `pip install falhou (${py.versao}): ${motivo(inst)}`; console.error(TAG, ultima); continue; }
      estado.libdir = libdir;
      const r = await rodar(py.cmd, ['-c', cfg.testeImport], { cwd: pastaAbs, env: envFilho() });
      if (r.ok) { console.log(`${TAG} bibliotecas instaladas (${py.versao}).`); return Object.assign(estado, { python: py.cmd, versao: py.versao }); }
      ultima = `instalou, mas o import falhou (${py.versao}): ${motivo(r)}`;
    }
    throw new Error(ultima || 'não foi possível preparar o Python');
  }

  /** Pronto = responde HTTP (qualquer status: o /api/health pode acusar o banco). */
  function aguardarPorta(limiteMs) {
    const fim = Date.now() + limiteMs;
    return new Promise((resolve, reject) => {
      const tentar = () => {
        const r = http.get({ host: '127.0.0.1', port: porta, path: cfg.saude || '/', timeout: 3000 }, (res) => { res.resume(); resolve(); });
        r.on('error', () => (Date.now() > fim ? reject(new Error('não respondeu na porta ' + porta)) : setTimeout(tentar, 1000)));
        r.on('timeout', () => r.destroy());
      };
      tentar();
    });
  }

  async function iniciar() {
    try {
      if (!fs.existsSync(pastaAbs)) throw new Error(`pasta ${cfg.pasta} não publicada com o Portal`);
      estado.estado = 'iniciando';
      await prepararPython();
      estado.estado = 'iniciando';
      const args = cfg.args(porta);
      console.log(`${TAG} iniciando: ${estado.python} ${args.join(' ')} (porta interna ${porta})`);
      const filho = spawn(estado.python, args, { cwd: pastaAbs, env: envFilho(), stdio: ['ignore', 'pipe', 'pipe'] });
      estado.pid = filho.pid;
      filhos.add(filho.pid);
      const log = (chunk) => String(chunk).split(/\r?\n/).filter((l) => l.trim()).forEach((l) => console.log(`${TAG} ${l}`));
      filho.stdout.on('data', log);
      filho.stderr.on('data', log);
      filho.on('error', (err) => console.error(TAG, 'processo:', err.message));
      filho.on('exit', (codigo, sinal) => {
        filhos.delete(filho.pid);
        estado.pid = null;
        if (encerrando) return;
        estado.estado = 'erro';
        estado.mensagem = `processo terminou (código ${codigo}${sinal ? ', sinal ' + sinal : ''})`;
        reiniciarDepois();
      });
      await aguardarPorta(180000);
      if (estado.pid) { estado.estado = 'pronto'; estado.mensagem = null; estado.reinicios = 0; console.log(`${TAG} pronto em ${prefixo}/`); }
    } catch (err) {
      estado.estado = 'erro';
      estado.mensagem = err.message;
      console.error(TAG, 'não iniciou:', err.message);
      reiniciarDepois();
    }
  }
  let agendado = null;
  function reiniciarDepois() {
    if (agendado) return;
    estado.reinicios += 1;
    const espera = Math.min(60000, 5000 * estado.reinicios);
    console.warn(`${TAG} nova tentativa em ${espera / 1000}s`);
    agendado = setTimeout(() => { agendado = null; iniciar(); }, espera);
  }

  // ── Rotas ──
  portal.get(`${prefixo}/__estado`, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ estado: estado.estado, mensagem: estado.mensagem, python: estado.versao || null, bibliotecas: estado.libdir || '(do próprio Python)', porta });
  });
  portal.use(prefixo, (req, res, next) => {
    // Pasta sem barra final: os caminhos relativos resolveriam na raiz do Portal.
    const [caminho, consulta] = req.originalUrl.split('?');
    if (caminho === prefixo) return res.redirect(301, prefixo + '/' + (consulta ? '?' + consulta : ''));

    // Página só quando o navegador pede HTML explicitamente (fetch manda */*).
    const htmlPedido = req.method === 'GET' && /text\/html/i.test(req.headers.accept || '');
    if (estado.estado !== 'pronto') {
      res.set('Cache-Control', 'no-store').set('Retry-After', '10');
      if (htmlPedido) return res.status(503).type('html').send(paginaEspera(titulo, estado));
      return res.status(503).json({ error: `${titulo} indisponível (${estado.estado})`, detalhe: estado.mensagem });
    }

    const cabecalhos = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) cabecalhos[k] = v;
    cabecalhos['x-forwarded-host'] = req.headers['x-forwarded-host'] || req.headers.host || '';
    cabecalhos['x-forwarded-prefix'] = prefixo;
    cabecalhos.host = `127.0.0.1:${porta}`;
    if (reescrever) cabecalhos['accept-encoding'] = 'identity'; // corpo em texto puro para reescrever

    const pedido = http.request({ host: '127.0.0.1', port: porta, method: req.method, path: req.url || '/', headers: cabecalhos, timeout: 15 * 60 * 1000 }, (resp) => {
      const saida = {};
      for (const [k, v] of Object.entries(resp.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) saida[k] = v;
      if (typeof saida.location === 'string' && saida.location.startsWith('/') && !saida.location.startsWith('//') && !saida.location.startsWith(prefixo + '/')) {
        saida.location = prefixo + saida.location;
      }
      const tipo = String(resp.headers['content-type'] || '');
      const qual = !reescrever || resp.headers['content-encoding'] ? null
        : /text\/html/.test(tipo) ? 'html' : /text\/css/.test(tipo) ? 'css' : /javascript/.test(tipo) ? 'js' : null;
      if (!qual) {
        res.status(resp.statusCode);
        for (const [k, v] of Object.entries(saida)) res.setHeader(k, v);
        return resp.pipe(res);
      }
      const partes = [];
      resp.on('data', (c) => partes.push(c));
      resp.on('end', () => {
        const corpo = reescrever[qual](Buffer.concat(partes).toString('utf8'));
        delete saida['content-length'];
        delete saida.etag; // o conteúdo mudou
        res.status(resp.statusCode);
        for (const [k, v] of Object.entries(saida)) res.setHeader(k, v);
        res.send(Buffer.from(corpo, 'utf8'));
      });
    });
    pedido.on('timeout', () => pedido.destroy(new Error('tempo esgotado')));
    pedido.on('error', (err) => {
      console.error(TAG, `${req.method} ${req.originalUrl}:`, err.message);
      if (res.headersSent) return res.destroy();
      if (htmlPedido) return res.status(502).type('html').send(paginaEspera(titulo, { estado: 'iniciando' }));
      res.status(502).json({ error: `${titulo} não respondeu.` });
    });
    res.on('close', () => { if (!res.writableEnded) pedido.destroy(); });
    req.pipe(pedido);
  });

  iniciar();
  console.log(`${TAG} montado em ${prefixo}/ (porta interna ${porta})`);
  return { estado };
};
