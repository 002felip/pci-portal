/**
 * VBM Stable & Capable — "Importar dados": PCI Master -> IBP.PEDRAVISAODIARIA.
 *
 * Substitui o fluxo manual de todo mês (rodar mapeamento.py no Colab e subir
 * o resultado.xlsx no banco):
 *
 *   1. POST /previa      a pessoa envia o PCI Master + mês/ano. O Python
 *                        (python/scripts/importar_pci_master.py, mesma lógica do
 *                        mapeamento.py) gera as linhas com o mapeamento de
 *                        python/data/mapeamento_bu_kpi.xlsx. Nada é gravado:
 *                        a resposta mostra linhas, campos sem dados e quantas
 *                        linhas JÁ EXISTEM no banco para aquele mês.
 *   2. POST /previa/:id/confirmar {modo}
 *                        grava numa ÚNICA transação (tudo ou nada):
 *                          'atualizar'  linhas que já existem têm só o VL_REAL
 *                                       atualizado; as demais são inseridas
 *                          'novos'      só insere as que não existem
 *                        Linha existente NUNCA é apagada: VL_D30/VL_CS/VL_PD/
 *                        VL_PROJ de outra origem ficam como estão.
 *   3. Arquivos (PCI Master enviado + resultado.xlsx) e o registro vão para
 *      o Azure Blob, em <pasta>/importacoes/<id>/ e importacoes.json.
 *
 * Antes de gravar, as colunas da tabela são conferidas no próprio banco
 * (INFORMATION_SCHEMA): faltar coluna, ou existir coluna obrigatória sem
 * valor padrão que o arquivo não preenche, bloqueia a gravação.
 *
 * Tabela: STABLECAPABLE_TABELA_IMPORTACAO (padrão IBP.PEDRAVISAODIARIA),
 * no mesmo banco do resto do Stable & Capable.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const sql = require('mssql');

const TAG = '[stable-and-capable:importacao]';
const RAIZ = __dirname;
const SCRIPT = path.join(RAIZ, 'python', 'scripts', 'importar_pci_master.py');
const MAPEAMENTO = path.join(RAIZ, 'python', 'data', 'mapeamento_bu_kpi.xlsx');
const VALIDADE_PREVIA_MS = 60 * 60 * 1000;   // prévia esquecida some em 1 h
const LOTE = 300;                            // linhas por INSERT (6 parâmetros cada; limite do SQL Server: 2100)
const HISTORICO_MAX = 300;
const COLUNAS = ['DT_REF', 'ID_SISTEMA', 'ID_SITE', 'ID_OPERACAO', 'ID_KPI', 'VL_D30', 'VL_CS', 'VL_PD', 'VL_REAL', 'VL_PROJ'];

/** "IBP.PEDRAVISAODIARIA" -> { schema, tabela, sql: "[IBP].[PEDRAVISAODIARIA]" }; só letras/dígitos/_ */
function nomeTabela(valor) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(String(valor || '').trim());
  if (!m) throw new Error(`STABLECAPABLE_TABELA_IMPORTACAO inválida: "${valor}" (use ESQUEMA.TABELA)`);
  return { schema: m[1], tabela: m[2], sql: `[${m[1]}].[${m[2]}]`, nome: `${m[1]}.${m[2]}` };
}

const iso = (d) => d.toISOString().slice(0, 10);
function limitesDoMes(ano, mes) {
  return { inicio: new Date(Date.UTC(ano, mes - 1, 1)), fimExclusivo: new Date(Date.UTC(ano, mes, 1)) };
}
const chave = (l) => `${String(l.DT_REF).slice(0, 10)}|${l.ID_SISTEMA}|${l.ID_SITE}|${l.ID_OPERACAO}|${l.ID_KPI}`;

function criarImportacaoRouter({ runQuery, obterPool, store, pasta, python }) {
  const router = express.Router();
  const TABELA = nomeTabela(process.env.STABLECAPABLE_TABELA_IMPORTACAO || 'IBP.PEDRAVISAODIARIA');
  const PASTA = `${pasta}/importacoes`;
  const ARQ_HISTORICO = `${PASTA}/importacoes.json`;
  const previas = new Map();
  let gravando = false;

  // Upload em disco (o PCI Master tem ~10 MB). multer já é dependência do Portal.
  const multer = require('multer');
  const upload = multer({
    dest: path.join(os.tmpdir(), 'stable-capable-upload'),
    limits: { fileSize: 80 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(null, /\.xlsx?m?$/i.test(file.originalname || '')),
  });

  // Prévias antigas: apaga os arquivos temporários
  setInterval(() => {
    const agora = Date.now();
    for (const [id, p] of previas) {
      if (agora - p.criadaEm > VALIDADE_PREVIA_MS) { previas.delete(id); fs.promises.rm(p.dir, { recursive: true, force: true }).catch(() => {}); }
    }
  }, 10 * 60 * 1000).unref();

  // ── Histórico (JSON no Blob, como o das execuções) ──
  let historico = null;
  async function carregarHistorico() {
    if (historico) return historico;
    try {
      const { buffer } = await store.baixar(ARQ_HISTORICO);
      const d = JSON.parse(buffer.toString('utf8'));
      historico = Array.isArray(d) ? d : [];
    } catch (err) {
      if (!/404|ENOENT|BlobNotFound/i.test(err.message)) console.warn(TAG, 'histórico ilegível:', err.message);
      historico = [];
    }
    return historico;
  }
  async function salvarHistorico() {
    try { await store.enviar(ARQ_HISTORICO, Buffer.from(JSON.stringify(historico.slice(0, HISTORICO_MAX), null, 1), 'utf8'), 'application/json'); }
    catch (err) { console.error(TAG, 'falha ao gravar histórico:', err.message); }
  }

  /** Linhas da prévia que já existem no banco (mesma data + sistema + site + operação + KPI). */
  async function conferirExistentes(linhas, ano, mes) {
    if (!linhas.length) return { existentes: 0, novas: 0, diferentes: 0, duplicadasNoBanco: 0 };
    const { inicio, fimExclusivo } = limitesDoMes(ano, mes);
    const sites = [...new Set(linhas.map((l) => Number(l.ID_SITE)))];
    const r = await runQuery(
      `SELECT CONVERT(char(10), CAST(DT_REF AS date), 23) AS DT_REF, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI,
              COUNT(*) AS N, MAX(VL_REAL) AS VL_REAL
         FROM ${TABELA.sql}
        WHERE DT_REF >= @ini AND DT_REF < @fim
          AND ID_SITE IN (${sites.map((s, i) => '@s' + i).join(',')})
        GROUP BY CAST(DT_REF AS date), ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI`,
      Object.fromEntries([['ini', [sql.Date, inicio]], ['fim', [sql.Date, fimExclusivo]], ...sites.map((s, i) => ['s' + i, [sql.Int, s]])]),
    );
    const noBanco = new Map((r.recordset || []).map((x) => [chave(x), x]));
    let existentes = 0, diferentes = 0, duplicadasNoBanco = 0;
    for (const l of linhas) {
      const x = noBanco.get(chave(l));
      if (!x) continue;
      existentes += 1;
      if (x.N > 1) duplicadasNoBanco += 1;
      if (x.VL_REAL == null || Math.abs(Number(x.VL_REAL) - Number(l.VL_REAL)) > 1e-9 * Math.max(1, Math.abs(Number(l.VL_REAL)))) diferentes += 1;
    }
    return { existentes, novas: linhas.length - existentes, diferentes, duplicadasNoBanco };
  }

  /** Colunas da tabela no banco: as do arquivo existem? Há obrigatória que o arquivo não preenche? */
  async function conferirColunas(pool) {
    const r = await pool.request()
      .input('s', sql.NVarChar(128), TABELA.schema).input('t', sql.NVarChar(128), TABELA.tabela).input('obj', sql.NVarChar(300), TABELA.sql)
      .query(`SELECT c.COLUMN_NAME, c.IS_NULLABLE, c.COLUMN_DEFAULT,
                     COLUMNPROPERTY(OBJECT_ID(@obj), c.COLUMN_NAME, 'IsIdentity') AS IDENT,
                     COLUMNPROPERTY(OBJECT_ID(@obj), c.COLUMN_NAME, 'IsComputed') AS COMP
                FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = @s AND c.TABLE_NAME = @t`);
    const cols = r.recordset || [];
    if (!cols.length) throw new Error(`Tabela ${TABELA.nome} não encontrada no banco (ou sem permissão de leitura do esquema).`);
    const nomes = new Set(cols.map((c) => String(c.COLUMN_NAME).toUpperCase()));
    const faltando = COLUNAS.filter((c) => !nomes.has(c));
    if (faltando.length) throw new Error(`A tabela ${TABELA.nome} não tem as colunas: ${faltando.join(', ')}.`);
    const obrigatorias = cols.filter((c) => c.IS_NULLABLE === 'NO' && c.COLUMN_DEFAULT == null && !c.IDENT && !c.COMP
      && !COLUNAS.includes(String(c.COLUMN_NAME).toUpperCase()));
    if (obrigatorias.length) {
      throw new Error(`A tabela ${TABELA.nome} tem colunas obrigatórias que o arquivo não preenche: ${obrigatorias.map((c) => c.COLUMN_NAME).join(', ')}.`);
    }
  }

  const usuario = (req) => String(req.get('X-Forwarded-Email') || req.get('X-Forwarded-Preferred-Username') || '').trim() || null;
  const erro = (res, status, msg) => res.status(status).json({ error: msg });

  // ── Rotas ──
  router.get('/config', (req, res) => {
    const hoje = new Date();
    const anterior = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
    res.json({
      tabela: TABELA.nome,
      sugestao: { ano: anterior.getUTCFullYear(), mes: anterior.getUTCMonth() + 1 },
      mapeamento: fs.existsSync(MAPEAMENTO) ? path.basename(MAPEAMENTO) : null,
      gravacao: !!obterPool,
    });
  });

  router.get('/mapeamento', (req, res) => {
    if (!fs.existsSync(MAPEAMENTO)) return erro(res, 404, 'Mapeamento não encontrado.');
    res.download(MAPEAMENTO, path.basename(MAPEAMENTO));
  });

  router.post('/previa', (req, res, next) => upload.single('arquivo')(req, res, (err) => {
    if (err) return erro(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo grande demais (máx. 80 MB).' : 'Falha no envio do arquivo.');
    next();
  }), async (req, res) => {
    const enviado = req.file;
    const ano = Number(req.body && req.body.ano);
    const mes = Number(req.body && req.body.mes);
    const limpar = () => enviado && fs.promises.rm(enviado.path, { force: true }).catch(() => {});
    if (!enviado) return erro(res, 400, 'Envie o PCI Master (.xlsx).');
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) { limpar(); return erro(res, 400, 'Informe mês e ano válidos.'); }
    if (!fs.existsSync(MAPEAMENTO)) { limpar(); return erro(res, 500, 'Planilha de mapeamento ausente no app (python/data/mapeamento_bu_kpi.xlsx).'); }

    const id = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + '-' + crypto.randomBytes(2).toString('hex');
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stable-capable-imp-'));
    const master = path.join(dir, 'PCI_Master.xlsx');
    try {
      await fs.promises.rename(enviado.path, master).catch(async () => { await fs.promises.copyFile(enviado.path, master); limpar(); });
      await python.prepararAmbiente();
      const saidaXlsx = path.join(dir, 'resultado.xlsx');
      const saidaJson = path.join(dir, 'previa.json');
      const r = await python.rodar(python.ambiente.python, [SCRIPT, '--master', master, '--mapeamento', MAPEAMENTO,
        '--ano', String(ano), '--mes', String(mes), '--saida-xlsx', saidaXlsx, '--saida-json', saidaJson],
        { cwd: python.CWD_PY, env: python.envPython(), timeout: 5 * 60 * 1000 });
      if (!r.ok) {
        const msg = (r.stderr || '').trim().split('\n').filter((l) => !/Warning|warn\(|^\s/.test(l)).pop() || 'falha ao processar o arquivo';
        throw Object.assign(new Error(msg), { status: 422 });
      }
      const dados = JSON.parse(await fs.promises.readFile(saidaJson, 'utf8'));
      if (!dados.linhas.length) throw Object.assign(new Error(`Nenhum dado de ${String(mes).padStart(2, '0')}/${ano} no arquivo para os campos do mapeamento.`), { status: 422 });

      let conflitos = null, erroBanco = null;
      try { conflitos = await conferirExistentes(dados.linhas, ano, mes); }
      catch (err) { erroBanco = 'Não foi possível consultar o banco: ' + err.message; console.error(TAG, 'conferir existentes:', err.message); }

      previas.set(id, { id, dir, master, saidaXlsx, dados, ano, mes, nomeOriginal: enviado.originalname, usuario: usuario(req), criadaEm: Date.now() });
      res.json({
        id, tabela: TABELA.nome, periodo: dados.periodo, total: dados.linhas.length,
        campos: dados.campos, avisos: dados.avisos, conflitos, erroBanco,
        arquivo: enviado.originalname, amostra: dados.linhas.slice(0, 8),
      });
    } catch (err) {
      fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
      console.error(TAG, 'prévia:', err.message);
      erro(res, err.status || 500, err.message);
    }
  });

  router.get('/previa/:id/resultado', (req, res) => {
    const p = previas.get(req.params.id);
    if (!p) return erro(res, 404, 'Prévia expirada. Envie o arquivo de novo.');
    res.download(p.saidaXlsx, `resultado_${p.ano}-${String(p.mes).padStart(2, '0')}.xlsx`);
  });

  router.post('/previa/:id/confirmar', async (req, res) => {
    const p = previas.get(req.params.id);
    const modo = req.body && req.body.modo;
    if (!p) return erro(res, 404, 'Prévia expirada. Envie o arquivo de novo.');
    if (!['atualizar', 'novos'].includes(modo)) return erro(res, 400, 'Escolha como tratar as linhas que já existem.');
    if (!obterPool) return erro(res, 503, 'Gravação no banco indisponível neste ambiente.');
    if (gravando) return erro(res, 409, 'Já existe uma importação sendo gravada. Aguarde e tente de novo.');
    gravando = true;

    const { inicio, fimExclusivo } = limitesDoMes(p.ano, p.mes);
    let tx = null;
    try {
      const pool = await obterPool();
      await conferirColunas(pool);

      tx = new sql.Transaction(pool);
      await tx.begin();
      await new sql.Request(tx).query(`CREATE TABLE #imp (DT_REF date NOT NULL, ID_SISTEMA int NOT NULL, ID_SITE int NOT NULL,
        ID_OPERACAO int NOT NULL, ID_KPI int NOT NULL, VL_REAL float NOT NULL)`);
      for (let i = 0; i < p.dados.linhas.length; i += LOTE) {
        const lote = p.dados.linhas.slice(i, i + LOTE);
        const rq = new sql.Request(tx);
        const valores = lote.map((l, j) => {
          rq.input(`d${j}`, sql.Date, new Date(String(l.DT_REF).slice(0, 10) + 'T00:00:00Z'));
          rq.input(`a${j}`, sql.Int, l.ID_SISTEMA); rq.input(`b${j}`, sql.Int, l.ID_SITE);
          rq.input(`c${j}`, sql.Int, l.ID_OPERACAO); rq.input(`k${j}`, sql.Int, l.ID_KPI);
          rq.input(`v${j}`, sql.Float, l.VL_REAL);
          return `(@d${j},@a${j},@b${j},@c${j},@k${j},@v${j})`;
        });
        await rq.query(`INSERT INTO #imp (DT_REF, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI, VL_REAL) VALUES ${valores.join(',')}`);
      }

      const junta = `t.DT_REF >= @ini AND t.DT_REF < @fim AND CAST(t.DT_REF AS date) = i.DT_REF
        AND t.ID_SISTEMA = i.ID_SISTEMA AND t.ID_SITE = i.ID_SITE AND t.ID_OPERACAO = i.ID_OPERACAO AND t.ID_KPI = i.ID_KPI`;
      const comPeriodo = () => new sql.Request(tx).input('ini', sql.Date, inicio).input('fim', sql.Date, fimExclusivo);
      let atualizadas = 0;
      if (modo === 'atualizar') {
        const u = await comPeriodo().query(`UPDATE t SET t.VL_REAL = i.VL_REAL FROM ${TABELA.sql} t JOIN #imp i ON ${junta}`);
        atualizadas = u.rowsAffected[0] || 0;
      }
      const ins = await comPeriodo().query(`INSERT INTO ${TABELA.sql} (${COLUNAS.join(', ')})
        SELECT i.DT_REF, i.ID_SISTEMA, i.ID_SITE, i.ID_OPERACAO, i.ID_KPI, 0, 0, 0, i.VL_REAL, 0
          FROM #imp i WHERE NOT EXISTS (SELECT 1 FROM ${TABELA.sql} t WHERE ${junta})`);
      const inseridas = ins.rowsAffected[0] || 0;
      await new sql.Request(tx).query('DROP TABLE #imp');
      await tx.commit();
      tx = null;
      console.log(`${TAG} ${p.id}: ${p.mes}/${p.ano} gravado em ${TABELA.nome} — ${inseridas} inseridas, ${atualizadas} atualizadas (modo ${modo}, ${p.usuario || 'sem usuário'})`);

      // Arquivos + histórico (falha aqui não desfaz a gravação: só fica no log)
      const rotulo = `${p.ano}-${String(p.mes).padStart(2, '0')}`;
      const destino = `${PASTA}/${p.id}`;
      const arquivos = [];
      for (const [local, nome, tipo] of [[p.saidaXlsx, `resultado_${rotulo}.xlsx`, 'resultado'], [p.master, `PCI_Master_${rotulo}.xlsx`, 'master']]) {
        try {
          const buffer = await fs.promises.readFile(local);
          await store.enviar(`${destino}/${nome}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          arquivos.push({ nome, tipo, caminho: `${destino}/${nome}`, tamanho: buffer.length });
        } catch (err) { console.error(TAG, `arquivo ${nome}:`, err.message); }
      }
      await carregarHistorico();
      const registro = {
        id: p.id, ano: p.ano, mes: p.mes, tabela: TABELA.nome, modo, linhas: p.dados.linhas.length,
        inseridas, atualizadas, avisos: p.dados.avisos.length, usuario: p.usuario, arquivoOriginal: p.nomeOriginal,
        gravadaEm: new Date().toISOString(), arquivos,
      };
      historico.unshift(registro);
      await salvarHistorico();
      previas.delete(p.id);
      fs.promises.rm(p.dir, { recursive: true, force: true }).catch(() => {});
      res.json(registro);
    } catch (err) {
      if (tx) { try { await tx.rollback(); } catch (e) { /* conexão já caiu: o SQL Server desfaz sozinho */ } }
      console.error(TAG, 'gravação:', err.message);
      erro(res, 500, 'Nada foi gravado. ' + err.message);
    } finally {
      gravando = false;
    }
  });

  router.get('/historico', async (req, res) => {
    try { res.json({ importacoes: await carregarHistorico() }); }
    catch (err) { erro(res, 500, 'Falha ao ler o histórico.'); }
  });

  router.get('/historico/:id/arquivos/:nome', async (req, res) => {
    try {
      const reg = (await carregarHistorico()).find((x) => x.id === req.params.id);
      const arq = reg && (reg.arquivos || []).find((a) => a.nome === req.params.nome);
      if (!arq) return erro(res, 404, 'Arquivo não encontrado.');
      const { buffer } = await store.baixar(arq.caminho);
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(arq.nome)}`);
      res.send(buffer);
    } catch (err) {
      console.error(TAG, 'download:', err.message);
      erro(res, 502, 'Não foi possível baixar o arquivo do armazenamento.');
    }
  });

  console.log(`${TAG} importação para ${TABELA.nome} (mapeamento: ${fs.existsSync(MAPEAMENTO) ? path.basename(MAPEAMENTO) : 'AUSENTE'})`);
  return router;
}

module.exports = { criarImportacaoRouter, nomeTabela };
