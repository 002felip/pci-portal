/**
 * Controle de acesso do COO Dashboard no modo STANDALONE.
 *
 * Mesma regra do Portal (portal-acesso.js): o usuário logado
 * (X-Forwarded-Email, injetado pelo proxy do Databricks Apps — o navegador
 * não consegue forjá-lo) precisa existir em IBP.USERS com CD_MATRICULA
 * preenchido. Dentro do Portal este módulo NÃO é usado: o próprio Portal
 * protege /COO-Dashboard com o portal-acesso.js dele.
 *
 * DENY BY DEFAULT (mesmo princípio do VBM Kaizen): sem cabeçalho, e-mail sem
 * cadastro, matrícula vazia, tabela inacessível ou erro de consulta => acesso
 * NEGADO. Nenhum desses cenários abre a página ou a API.
 *
 * Coluna de e-mail descoberta em INFORMATION_SCHEMA (ou fixada em
 * COO_USERS_EMAIL_COLUMN). Só o resultado AUTORIZADO fica em memória
 * (10 min); negativa não entra no cache — quem acabou de ser cadastrado não
 * fica barrado esperando expirar (regra do Kaizen). Falha de banco nunca é
 * guardada e sempre BLOQUEIA.
 * Fora do Databricks (execução local) não há X-Forwarded-Email: defina
 * COO_ACESSO_LOCAL_EMAIL para simular um usuário, ou COO_ACESSO=desligado
 * (só em desenvolvimento; o servidor avisa no log).
 */
const sql = require('mssql');

const TTL_AUTORIZADO = 10 * 60 * 1000;
const CACHE_MAX = 5000;
const PREFERENCIA_EMAIL = ['CD_EMAIL', 'DS_EMAIL', 'NM_EMAIL', 'EMAIL', 'TX_EMAIL', 'CD_UPN', 'UPN', 'DS_LOGIN', 'CD_LOGIN', 'LOGIN'];
const MENSAGEM = {
  negado: 'Acesso não autorizado. Seu usuário não está habilitado para o COO Dashboard. Entre em contato com o administrador do sistema.',
  erro: 'Não foi possível validar suas permissões neste momento. Tente novamente mais tarde ou contate o administrador.',
};

module.exports = function criarControleDeAcesso({ runQuery, env = process.env }) {
  const cache = new Map();
  let coluna = null;
  const desligado = String(env.COO_ACESSO || '').toLowerCase() === 'desligado';
  if (desligado) console.warn('[coo-acesso] ATENÇÃO: controle de acesso DESLIGADO (COO_ACESSO=desligado). Use só em desenvolvimento.');

  async function descobrirColuna() {
    if (coluna) return coluna;
    const r = await runQuery(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'IBP' AND TABLE_NAME = 'USERS'");
    const colunas = r.recordset.map(l => String(l.COLUMN_NAME));
    const porNome = n => colunas.find(c => c.toUpperCase() === n.toUpperCase());
    if (!colunas.length) throw new Error('IBP.USERS inacessível ou inexistente para o usuário do app');
    if (!porNome('CD_MATRICULA')) throw new Error('coluna CD_MATRICULA não encontrada em IBP.USERS');
    const escolhida = (env.COO_USERS_EMAIL_COLUMN && porNome(env.COO_USERS_EMAIL_COLUMN))
      || PREFERENCIA_EMAIL.map(porNome).find(Boolean)
      || colunas.find(c => /E_?MAIL|UPN|LOGIN/i.test(c));
    if (!escolhida) throw new Error('nenhuma coluna de e-mail/login em IBP.USERS (defina COO_USERS_EMAIL_COLUMN)');
    // O nome entra na SQL (não há parâmetro para identificadores): só letras, dígitos e _
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(escolhida)) throw new Error(`nome de coluna inválido: ${escolhida}`);
    coluna = escolhida;
    console.log(`[coo-acesso] validação por IBP.USERS.${coluna} + CD_MATRICULA`);
    return coluna;
  }

  function registrar(email, resultado, motivo) {
    // Sem matrícula nem outros dados do cadastro no log
    console.log(`[coo-acesso] ${new Date().toISOString()} usuario=${email || '(sem identidade)'} resultado=${resultado}${motivo ? ` motivo="${motivo}"` : ''}`);
  }

  async function validar(req) {
    if (desligado) return { autorizado: true };
    const email = String(req.get('X-Forwarded-Email') || env.COO_ACESSO_LOCAL_EMAIL || '').trim().toLowerCase();
    if (!email) {
      registrar('', 'negado', 'requisição sem usuário autenticado (X-Forwarded-Email)');
      return { autorizado: false, motivo: 'sem-identidade', mensagem: MENSAGEM.negado };
    }
    const emCache = cache.get(email);
    if (emCache && emCache.expiraEm > Date.now()) return emCache.resultado;

    let resultado;
    try {
      const col = await descobrirColuna();
      // Sem LOWER()/LTRIM() na COLUNA: a função invalidaria o índice e esta
      // consulta roda a cada acesso não cacheado. A collation padrão do SQL
      // Server é case-insensitive, então a comparação direta casa igual.
      const r = await runQuery(
        `SELECT TOP (1) CD_MATRICULA FROM [IBP].[USERS] WHERE [${col}] = @email`,
        { email: [sql.NVarChar(320), email] });
      const linha = r.recordset[0];
      if (!linha) {
        resultado = { autorizado: false, motivo: 'nao-encontrado', mensagem: MENSAGEM.negado };
        registrar(email, 'negado', 'usuário não encontrado em IBP.USERS');
      } else if (linha.CD_MATRICULA == null || String(linha.CD_MATRICULA).trim() === '') {
        resultado = { autorizado: false, motivo: 'sem-matricula', mensagem: MENSAGEM.negado };
        registrar(email, 'negado', 'CD_MATRICULA não preenchido');
      } else {
        resultado = { autorizado: true };
        registrar(email, 'autorizado');
      }
    } catch (err) {
      registrar(email, 'erro', err.message);
      return { autorizado: false, motivo: 'erro', mensagem: MENSAGEM.erro };
    }
    if (resultado.autorizado) {
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(email, { resultado, expiraEm: Date.now() + TTL_AUTORIZADO });
    }
    return resultado;
  }

  // Middleware: API recebe JSON (403/503); página recebe uma tela simples de acesso negado
  async function exigir(req, res, next) {
    const r = await validar(req);
    if (r.autorizado) return next();
    const status = r.motivo === 'erro' ? 503 : 403;
    res.set('Cache-Control', 'no-store');
    if (/\/api(\/|$)/i.test(req.originalUrl.split('?')[0]) || !req.accepts('html')) {
      return res.status(status).json({ error: r.mensagem });
    }
    res.status(status).type('html').send(
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Acesso não autorizado</title>` +
      `<body style="font-family:Segoe UI,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f8fc;color:#1f2937">` +
      `<div style="max-width:440px;padding:28px;border-radius:14px;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.12)">` +
      `<h1 style="margin:0 0 8px;font-size:1.1rem">Acesso não autorizado</h1><p style="margin:0;line-height:1.5">${r.mensagem}</p></div></body></html>`);
  }

  return { validar, exigir };
};
