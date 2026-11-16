/**
 * AIP Goals — rotas de dados como MÓDULO.
 *
 * Mesmo contrato das outras aplicações do Portal: os dois pontos de entrada
 * (portal.js, dentro do Portal; server.js, standalone) montam ESTE router, e
 * cada um injeta o seu `runQuery`.
 * Contrato: `runQuery(sql, params?)` devolve algo com `.recordset` (pacote
 * `mssql`); `params` é `{ nome: [tipoMssql, valor] }` e cada entrada vira
 * `request.input` — nada da requisição é concatenado na SQL.
 *
 * FONTE DOS DADOS: o modelo de dados (Especificação técnica §9) ainda depende da
 * validação do time de dados (P-12). Até lá, /pendencias responde com os dados de
 * exemplo de dados-exemplo.js, marcados `exemplo: true` (a tela mostra a pílula
 * "Dados de exemplo"). Quando as tabelas existirem, a consulta entra em
 * database/00N_*.sql e `fonte: 'banco'` passa a lê-la por aqui.
 *
 * Identidade: SOMENTE o X-Forwarded-Email do proxy do Databricks Apps.
 *
 * Rotas:
 *   GET /ping          diagnóstico sem banco
 *   GET /pendencias    T01 — fila pessoal do usuário no ciclo ativo:
 *                      { ciclo, usuario, parametros, itens[], atualizadoEm, exemplo }
 *                      Cada item já sai com `diasUteis`, `parada` (RN-14) e `atrasada`.
 */
const express = require('express');
const { pendenciasExemplo } = require('./dados-exemplo');

const TAG = '[aip-goals]';
// Limite de pedidos por usuário por minuto (proteção contra abuso; a navegação normal fica muito abaixo)
const LIMITE_POR_MINUTO = 240;
const TIPOS = ['preencher', 'decidir', 'comentario', 'acao'];
const ESTADOS = ['rascunho', 'em_aprovacao', 'em_revisao', 'aprovado', 'negado'];

// Dias úteis (seg–sex) entre duas datas AAAA-MM-DD, sem contar o dia inicial.
function diasUteisEntre(inicioIso, fim) {
  const [a, m, d] = String(inicioIso).split('-').map(Number);
  const ini = new Date(a, m - 1, d);
  const ate = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
  if (!(ini < ate)) return 0;
  let n = 0;
  for (const x = new Date(ini); x < ate;) {
    x.setDate(x.getDate() + 1);
    if (x.getDay() !== 0 && x.getDay() !== 6) n++;
  }
  return n;
}

// Regras de idade e prazo no servidor (a tela só exibe):
//   parada  = mesmo nível há MAIS que parametros.diasParado dias úteis (RN-14, CA-11)
//   atrasada = prazo anterior a hoje
function enriquecer(dados, hoje = new Date()) {
  const limite = Number(dados.parametros && dados.parametros.diasParado) || 3;
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const itens = (dados.itens || [])
    .filter((it) => TIPOS.includes(it.tipo) && ESTADOS.includes(it.estado))
    .map((it) => {
      const diasUteis = it.desde ? diasUteisEntre(it.desde, hoje) : 0;
      return { ...it, diasUteis, parada: diasUteis > limite, atrasada: !!it.prazo && it.prazo < hojeIso };
    });
  return { ...dados, parametros: { ...dados.parametros, diasParado: limite }, itens };
}

function criarAipGoalsRouter({ runQuery, fonte = 'exemplo', agora = () => new Date() } = {}) {
  if (fonte === 'banco' && typeof runQuery !== 'function') {
    throw new Error('criarAipGoalsRouter: `runQuery` é obrigatório com fonte "banco"');
  }
  const router = express.Router();

  // Limite de pedidos por usuário (X-Forwarded-Email do proxy; sem ele, o IP) por minuto
  const contagem = new Map();
  let janela = Date.now();
  router.use((req, res, next) => {
    if (Date.now() - janela > 60000) { contagem.clear(); janela = Date.now(); }
    const quem = String(req.get('X-Forwarded-Email') || req.ip || '').toLowerCase();
    const n = (contagem.get(quem) || 0) + 1;
    contagem.set(quem, n);
    if (n > LIMITE_POR_MINUTO) return res.status(429).json({ error: 'Muitos pedidos. Tente de novo em um minuto.', codigo: 'LIMITE' });
    next();
  });

  router.get('/ping', (req, res) => res.json({ ok: true, fonte }));

  router.get('/pendencias', async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    // Sem identidade do proxy não há fila pessoal (AC-01). Mensagem neutra (AC-04).
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      if (fonte !== 'exemplo') {
        // Modelo de dados pendente (P-12): a consulta real entra aqui, parametrizada por @email e @ciclo.
        return res.status(501).json({ error: 'Fonte de dados ainda não disponível.', codigo: 'MODELO_PENDENTE' });
      }
      const hoje = agora();
      const dados = enriquecer(pendenciasExemplo(hoje), hoje);
      res.json({ ...dados, atualizadoEm: hoje.toISOString(), exemplo: true, desatualizado: false });
    } catch (err) {
      // O motivo fica no log; a resposta não leva texto do banco.
      console.error(`${TAG} /pendencias:`, err.message);
      res.status(500).json({ error: 'Não foi possível carregar as pendências.', codigo: 'ERRO' });
    }
  });

  return router;
}

module.exports = { criarAipGoalsRouter, diasUteisEntre, enriquecer, TIPOS, ESTADOS };
