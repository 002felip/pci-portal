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
 *   GET /painel?pais=&bu=   T02 — Painel do ciclo (só P&CI/COO e administrador, AC-07):
 *                      { ciclo, parametros, filtro, cards[], totais, porBu[], funil[], niveis[], parados[] }
 *                      Tudo calculado aqui a partir de `cards` (CA-15: as contagens batem com a lista).
 *   GET /metas?bu=     T03 — Metas da BU no recorte do usuário (AC-04/AC-05: BU fora do recorte → 404):
 *                      { ciclo, bu, bus[], parametros, metas[], totais, alertaPesos }
 *                      `totais` traz quantidade e peso por situação; `alertaPesos` = soma ≠ total (RN-16).
 */
const express = require('express');
const { pendenciasExemplo, painelExemplo } = require('./dados-exemplo');

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

// T02 — agregados do Painel do ciclo, a partir da lista de Goal Cards já filtrada.
// Funil: Goal Cards → submetidos (saíram do rascunho) → passaram do nível 1 → aprovados.
function agregarPainel(cards, ordemBus, limite, hoje = new Date()) {
  const comIdade = cards.map((c) => {
    const diasUteis = c.desde ? diasUteisEntre(c.desde, hoje) : 0;
    return { ...c, diasUteis, parada: c.estado === 'em_aprovacao' && diasUteis > limite };
  });
  const porEstado = (lista) => Object.fromEntries(ESTADOS.map((e) => [e, lista.filter((c) => c.estado === e).length]));
  const total = comIdade.length;
  const est = porEstado(comIdade);
  const submetidos = total - est.rascunho;
  const passaramNivel1 = est.aprovado + comIdade.filter((c) => c.estado === 'em_aprovacao' && c.nivel && c.nivel.atual > 1).length;
  const totais = { total, ...est, submetidos, aprovadosPct: total ? est.aprovado / total : null, paradas: comIdade.filter((c) => c.parada).length };
  const porBu = ordemBus
    .map((b) => { const l = comIdade.filter((c) => c.bu.sigla === b.sigla); return { bu: b, total: l.length, ...porEstado(l), paradas: l.filter((c) => c.parada).length }; })
    .filter((x) => x.total > 0);
  const funil = [
    { id: 'cards', n: total }, { id: 'submetidos', n: submetidos },
    { id: 'nivel1', n: passaramNivel1 }, { id: 'aprovados', n: est.aprovado },
  ];
  const mediana = (v) => { if (!v.length) return null; const o = [...v].sort((a, b) => a - b); const m = Math.floor(o.length / 2); return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };
  const emAprov = comIdade.filter((c) => c.estado === 'em_aprovacao' && c.nivel);
  const niveis = [1, 2].map((n) => {
    const l = emAprov.filter((c) => c.nivel.atual === n); const d = l.map((c) => c.diasUteis);
    return { nivel: n, nome: n === 1 ? 'Diretor da BU' : 'P&CI/COO', cards: l.length, mediana: mediana(d),
      min: d.length ? Math.min(...d) : null, max: d.length ? Math.max(...d) : null, paradas: l.filter((c) => c.parada).length };
  });
  const parados = emAprov.filter((c) => c.parada).sort((a, b) => b.diasUteis - a.diasUteis).slice(0, 6);
  return { cards: comIdade, totais, porBu, funil, niveis, parados };
}

// T03 — metas de uma BU: quantidade e peso por situação, soma dos pesos e alerta da RN-16.
function agregarMetas(cards, pesoEsperado, limite, hoje = new Date()) {
  const metas = cards
    .map((c) => {
      const diasUteis = c.desde ? diasUteisEntre(c.desde, hoje) : 0;
      return { ...c, diasUteis, parada: c.estado === 'em_aprovacao' && diasUteis > limite };
    })
    .sort((a, b) => a.meta.numero - b.meta.numero);
  const soma = (l) => l.reduce((t, c) => t + (Number(c.meta.peso) || 0), 0);
  const peso = Object.fromEntries(ESTADOS.map((e) => [e, soma(metas.filter((c) => c.estado === e))]));
  const qtd = Object.fromEntries(ESTADOS.map((e) => [e, metas.filter((c) => c.estado === e).length]));
  const pesoTotal = soma(metas);
  return {
    metas,
    totais: { metas: metas.length, pesoTotal, pesoEsperado, pesoSubmetido: pesoTotal - peso.rascunho, peso, qtd },
    alertaPesos: pesoTotal !== pesoEsperado,
  };
}

// Papéis do usuário no ciclo. Até o modelo de dados (P-12), vêm dos dados de exemplo; nos testes, são injetados.
const papeisExemplo = (email, hoje) => pendenciasExemplo(hoje).usuario.papeis || [];
const veTodas = (papeis) => papeis.some((p) => p.papel === 'pci_coo' || p.papel === 'admin');

function criarAipGoalsRouter({ runQuery, fonte = 'exemplo', agora = () => new Date(), papeisDe = papeisExemplo } = {}) {
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

  router.get('/painel', async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      if (fonte !== 'exemplo') return res.status(501).json({ error: 'Fonte de dados ainda não disponível.', codigo: 'MODELO_PENDENTE' });
      const hoje = agora();
      // Papéis do usuário no ciclo: o Painel é do grupo P&CI/COO e do administrador (AC-07); demais perfis, 403.
      if (!veTodas(papeisDe(email, hoje))) return res.status(403).json({ error: 'Sem acesso a esta tela.', codigo: 'SEM_ACESSO' });
      const base = painelExemplo(hoje);
      const limite = Number(base.parametros.diasParado) || 3;
      // Filtro País › BU validado contra as BUs do ciclo (valor fora da lista → 400)
      const pais = String(req.query.pais || ''), bu = String(req.query.bu || '');
      const paises = [...new Set(base.ciclo.bus.map((b) => b.pais))];
      if (pais && !paises.includes(pais)) return res.status(400).json({ error: 'País inválido.', codigo: 'FILTRO' });
      if (bu && !base.ciclo.bus.some((b) => b.sigla === bu && (!pais || b.pais === pais))) return res.status(400).json({ error: 'BU inválida.', codigo: 'FILTRO' });
      const filtrados = base.cards.filter((c) => (!pais || c.bu.pais === pais) && (!bu || c.bu.sigla === bu));
      const ordem = base.ciclo.bus.filter((b) => (!pais || b.pais === pais) && (!bu || b.sigla === bu));
      res.json({ ciclo: base.ciclo, parametros: { diasParado: limite }, filtro: { pais, bu }, ...agregarPainel(filtrados, ordem, limite, hoje),
        atualizadoEm: hoje.toISOString(), exemplo: true, desatualizado: false });
    } catch (err) {
      console.error(`${TAG} /painel:`, err.message);
      res.status(500).json({ error: 'Não foi possível carregar o painel.', codigo: 'ERRO' });
    }
  });

  router.get('/metas', async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      if (fonte !== 'exemplo') return res.status(501).json({ error: 'Fonte de dados ainda não disponível.', codigo: 'MODELO_PENDENTE' });
      const hoje = agora();
      const papeis = papeisDe(email, hoje);
      const base = painelExemplo(hoje);
      // Recorte (AC-04/AC-05): P&CI/COO e administrador veem todas as BUs; os demais, só as dos seus papéis
      const minhas = new Set(papeis.filter((p) => p.bu).map((p) => p.bu));
      const bus = base.ciclo.bus.filter((b) => veTodas(papeis) || minhas.has(b.sigla));
      if (!bus.length) return res.status(403).json({ error: 'Sem acesso a esta tela.', codigo: 'SEM_ACESSO' });
      const sigla = String(req.query.bu || bus[0].sigla);
      const bu = bus.find((b) => b.sigla === sigla);
      // BU inexistente ou fora do recorte: 404, sem revelar se existe (AC-04)
      if (!bu) return res.status(404).json({ error: 'Não encontrado.', codigo: 'NAO_ENCONTRADO' });
      const limite = Number(base.parametros.diasParado) || 3;
      const ag = agregarMetas(base.cards.filter((c) => c.bu.sigla === bu.sigla), Number(base.parametros.pesoTotal) || 100, limite, hoje);
      res.json({ ciclo: base.ciclo, bu, bus, parametros: { diasParado: limite, pesoTotal: ag.totais.pesoEsperado },
        ...ag, atualizadoEm: hoje.toISOString(), exemplo: true, desatualizado: false });
    } catch (err) {
      console.error(`${TAG} /metas:`, err.message);
      res.status(500).json({ error: 'Não foi possível carregar as metas.', codigo: 'ERRO' });
    }
  });

  return router;
}

module.exports = { criarAipGoalsRouter, agregarPainel, agregarMetas, diasUteisEntre, enriquecer, TIPOS, ESTADOS };
