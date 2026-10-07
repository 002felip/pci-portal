/**
 * Controle de acesso ao Portal (página inicial + VBM-Quartely).
 *
 * Regra: o usuário logado (X-Forwarded-Email, injetado pelo proxy do
 * Databricks Apps — o navegador não consegue forjá-lo) precisa existir em
 * IBP.USERS com CD_MATRICULA preenchido. O VBM-Kaizen-App NÃO passa por aqui:
 * é aplicação aberta, com validação própria.
 *
 * Banco: produção (BDIBPBMSA_PRD, conexão do Quartely) — o log informa qual.
 * Colunas: lidas de INFORMATION_SCHEMA (nada é suposto). A coluna de e-mail
 * pode ser fixada com PORTAL_USERS_EMAIL_COLUMN; sem ela, usa a primeira
 * coluna de IBP.USERS cujo nome indique e-mail/UPN/login.
 *
 * Desempenho: o resultado fica em memória por usuário (autorizado: 10 min;
 * negado: 1 min) — as navegações seguintes não consultam o banco. Falha de
 * banco nunca é guardada: bloqueia e tenta de novo na próxima requisição.
 */
const sql = require('mssql');

const TABELA = { esquema: 'IBP', nome: 'USERS' };
const TTL_AUTORIZADO = 10 * 60 * 1000;
const TTL_NEGADO = 60 * 1000;
const CACHE_MAX = 5000;
const PREFERENCIA_EMAIL = ['CD_EMAIL', 'DS_EMAIL', 'NM_EMAIL', 'EMAIL', 'TX_EMAIL', 'CD_UPN', 'UPN', 'DS_LOGIN', 'CD_LOGIN', 'LOGIN'];

const MENSAGEM = {
  negado: 'Acesso não autorizado. Seu usuário não está habilitado para utilização deste Portal. Entre em contato com o administrador do sistema.',
  erro: 'Não foi possível validar suas permissões neste momento. Tente novamente mais tarde ou contate o administrador.',
};

// conexoes: [{ nome, runQuery }] em ordem de preferência; usa a primeira onde
// IBP.USERS existe com CD_MATRICULA (runQuery único continua aceito).
module.exports = function criarControleDeAcesso({ runQuery, conexoes, env = process.env }) {
  const cache = new Map(); // email -> { resultado, expiraEm }
  const candidatas = conexoes && conexoes.length ? conexoes : runQuery ? [{ nome: 'padrão', runQuery }] : [];
  let escolha = null;      // { conexao, coluna } — descoberta uma vez

  async function descobrirTabela() {
    if (escolha) return escolha;
    if (!candidatas.length) throw new Error('nenhuma conexão de banco disponível para o controle de acesso');
    const falhas = [];
    for (const conexao of candidatas) {
      try {
        const coluna = await descobrirColunaEmail(conexao.runQuery);
        escolha = { conexao, coluna };
        console.log(`[portal-acesso] validação por ${TABELA.esquema}.${TABELA.nome}.${coluna} + CD_MATRICULA (banco ${conexao.nome})`);
        return escolha;
      } catch (err) {
        falhas.push(`${conexao.nome}: ${err.message}`);
      }
    }
    throw new Error(falhas.join(' | '));
  }

  async function descobrirColunaEmail(runQuery) {
    const r = await runQuery(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @esquema AND TABLE_NAME = @tabela',
      { esquema: [sql.NVarChar(128), TABELA.esquema], tabela: [sql.NVarChar(128), TABELA.nome] });
    let colunas = r.recordset.map(l => String(l.COLUMN_NAME));
    if (!colunas.length) {
      // INFORMATION_SCHEMA esconde tabelas sem permissão: lê a própria tabela
      // (TOP 0, sem dados) — o erro do SQL Server diz a causa exata no log.
      try {
        const t = await runQuery(`SELECT TOP (0) * FROM [${TABELA.esquema}].[${TABELA.nome}]`);
        colunas = Object.keys((t.recordset && t.recordset.columns) || {});
      } catch (err) {
        throw new Error(`${TABELA.esquema}.${TABELA.nome} inacessível para o usuário do app: ${err.message}`);
      }
    }
    const porNome = n => colunas.find(c => c.toUpperCase() === n.toUpperCase());
    if (!colunas.length) throw new Error(`tabela ${TABELA.esquema}.${TABELA.nome} não encontrada no banco`);
    if (!porNome('CD_MATRICULA')) throw new Error(`coluna CD_MATRICULA não encontrada em ${TABELA.esquema}.${TABELA.nome}`);
    const fixada = env.PORTAL_USERS_EMAIL_COLUMN && porNome(env.PORTAL_USERS_EMAIL_COLUMN);
    const escolhida = fixada
      || PREFERENCIA_EMAIL.map(porNome).find(Boolean)
      || colunas.find(c => /E_?MAIL|UPN|LOGIN/i.test(c));
    if (!escolhida) throw new Error(`nenhuma coluna de e-mail/login em ${TABELA.esquema}.${TABELA.nome} (defina PORTAL_USERS_EMAIL_COLUMN). Colunas: ${colunas.join(', ')}`);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(escolhida)) throw new Error(`nome de coluna inválido: ${escolhida}`);
    return escolhida;
  }

  // Código curto da causa para a tela (sem texto do banco nem dados do cadastro)
  function codigoDoErro(m) {
    if (/permission|permiss/i.test(m)) return 'PA-PERMISSAO';
    if (/Invalid object name|tabela .* não encontrada/i.test(m)) return 'PA-TABELA';
    if (/Login failed|credencial|password/i.test(m)) return 'PA-LOGIN';
    if (/IP address|firewall|ETIMEOUT|ESOCKET|ECONN|connect|timeout/i.test(m)) return 'PA-CONEXAO';
    if (/desatualizado|nenhuma conexão|e-mail\/login|CD_MATRICULA/i.test(m)) return 'PA-CONFIG';
    return 'PA-OUTRO';
  }

  function registrar(email, resultado, motivo) {
    // Sem matrícula nem outros dados do cadastro no log: só quem, quando e o resultado
    console.log(`[portal-acesso] ${new Date().toISOString()} usuario=${email || '(sem identidade)'} resultado=${resultado}${motivo ? ` motivo="${motivo}"` : ''}`);
  }

  // { autorizado, motivo, mensagem } — sempre consultando o banco quando não há cache válido
  async function validar(req) {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) {
      registrar('', 'negado', 'requisição sem usuário autenticado (X-Forwarded-Email)');
      return { autorizado: false, motivo: 'sem-identidade', mensagem: MENSAGEM.negado };
    }
    const emCache = cache.get(email);
    if (emCache && emCache.expiraEm > Date.now()) return emCache.resultado;

    let resultado;
    try {
      const { conexao, coluna } = await descobrirTabela();
      const r = await conexao.runQuery(
        `SELECT TOP (1) CD_MATRICULA FROM [${TABELA.esquema}].[${TABELA.nome}] WHERE LTRIM(RTRIM([${coluna}])) = @email`,
        { email: [sql.NVarChar(320), email] });
      const linha = r.recordset[0];
      if (!linha) {
        resultado = { autorizado: false, motivo: 'nao-encontrado', mensagem: MENSAGEM.negado };
        registrar(email, 'negado', `usuário não encontrado na ${TABELA.esquema}.${TABELA.nome}`);
      } else if (linha.CD_MATRICULA == null || String(linha.CD_MATRICULA).trim() === '') {
        resultado = { autorizado: false, motivo: 'sem-matricula', mensagem: MENSAGEM.negado };
        registrar(email, 'negado', 'CD_MATRICULA não preenchido');
      } else {
        resultado = { autorizado: true, motivo: null, mensagem: null };
        registrar(email, 'autorizado');
      }
    } catch (err) {
      // Falha de banco/configuração: bloqueia por segurança e não guarda no cache
      registrar(email, 'erro', err.message);
      return { autorizado: false, motivo: 'erro', mensagem: MENSAGEM.erro, codigo: codigoDoErro(err.message) };
    }
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(email, { resultado, expiraEm: Date.now() + (resultado.autorizado ? TTL_AUTORIZADO : TTL_NEGADO) });
    return resultado;
  }

  // GET /portal/acesso — usado pelo index.html para decidir o que mostrar
  async function rotaStatus(req, res) {
    const r = await validar(req);
    res.set('Cache-Control', 'no-store').status(r.autorizado ? 200 : r.motivo === 'erro' ? 503 : 403).json({
      autorizado: r.autorizado,
      motivo: r.motivo,
      mensagem: r.mensagem,
      codigo: r.codigo || null,
      sairUrl: env.PORTAL_LOGOUT_URL || env.DATABRICKS_HOST || null,
      contato: env.PORTAL_CONTATO || null,
    });
  }

  // Protege páginas, arquivos e APIs: API recebe 403 JSON; página volta ao
  // Portal, que mostra a tela de acesso negado.
  async function exigir(req, res, next) {
    const r = await validar(req);
    if (r.autorizado) return next();
    res.set('Cache-Control', 'no-store');
    if (/\/api(\/|$)/i.test(req.originalUrl.split('?')[0]) || !req.accepts('html')) {
      return res.status(r.motivo === 'erro' ? 503 : 403).json({ error: r.mensagem });
    }
    res.redirect(302, '/?acesso=negado');
  }

  return { rotaStatus, exigir, validar };
};
