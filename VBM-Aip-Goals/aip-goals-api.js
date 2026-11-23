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
 * validação do time de dados (P-12). Até lá, as rotas respondem com os dados de
 * exemplo de dados-exemplo.js, marcados `exemplo: true` (a tela mostra a pílula
 * "Dados de exemplo"). Quando as tabelas existirem, a consulta entra em
 * database/00N_*.sql e `fonte: 'banco'` passa a lê-la por aqui.
 *
 * Identidade: SOMENTE o X-Forwarded-Email do proxy do Databricks Apps.
 *
 * Rotas:
 *   GET /ping          diagnóstico sem banco
 *   GET /inicio        T00 — ciclo ativo e papéis do usuário: { ciclo, usuario: { papeis[] }, atualizadoEm, exemplo }
 *   GET /painel?pais=&bu=   T02 — Painel do ciclo (só P&CI/COO e administrador, AC-07):
 *                      { ciclo, parametros, filtro, cards[], totais, porBu[], funil[], niveis[], parados[] }
 *                      Tudo calculado aqui a partir de `cards` (CA-15: as contagens batem com a lista).
 *   GET /metas?bu=     T03 — Metas da BU no recorte do usuário (AC-04/AC-05: BU fora do recorte → 404):
 *                      { ciclo, bu, bus[], parametros, metas[], totais, alertaPesos }
 *                      `totais` traz quantidade e peso por situação; `alertaPesos` = soma ≠ total (RN-16).
 *   GET /desdobramento T13 — Desdobramento CEO → COO → BUs no recorte do usuário:
 *                      { ciclo, parametros, scorecardCoo[], bus[], linhas[], totais[] }
 *                      Cada célula da matriz traz peso e a situação do Goal Card da BU naquela meta.
 *   GET  /goal-card?card=   T04 — Goal Card (leitura aberta a todos, AC-05/AC-07):
 *                      { card, bu, meta, estado, versao, secoes, obrigatorios[], comentarios[], linha[], modo, permissoes }
 *                      `modo` sai do grupo do usuário e da situação: edicao (contribuidor da BU, Rascunho/Em revisão)
 *                      ou leitura. A T04 não tem decisão: ela fica na fila de aprovação (T14).
 *   POST /goal-card/submeter  { card, secoes }   campos obrigatórios no servidor (RN-03); só contribuidor da BU (AC-04)
 *   POST /goal-card/decisao   { card, decisao, comentario, revisao }   RN-06, RN-08, RN-09, RN-12 (usada pela fila de aprovação, T14)
 *   POST /goal-card/comentario { card, secao, texto }   comentário ancorado a uma seção (§7.3, RN-13); só o grupo de aprovação, na T14
 *   GET  /aprovacoes?pais=&bu=&idade=   T14 — fila do grupo de aprovação (AC-08: demais perfis, 403):
 *                      { ciclo, parametros, filtro, itens[], total }
 *                      `itens` = cards Em aprovação, os mais antigos primeiro, com a idade em dias úteis,
 *                      se é resubmissão e se o usuário pode decidir (RN-12).
 *                      Até o modelo de dados (P-12) as escritas são validadas e respondidas como simulação (`simulado: true`).
 */
const express = require('express');
const { pendenciasExemplo, painelExemplo, desdobramentoExemplo, goalCardExemplo, configuracaoExemplo, actionLogExemplo, versoesExemplo, cicloExemplo } = require('./dados-exemplo');

const TAG = '[aip-goals]';
// Limite de pedidos por usuário por minuto (proteção contra abuso; a navegação normal fica muito abaixo)
const LIMITE_POR_MINUTO = 240;
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

// T13 — matriz do desdobramento: uma linha por meta (resultado do COO + específicas), uma coluna por BU do recorte.
// Cada célula leva o peso desdobrado e a situação do Goal Card correspondente; totais por BU validam a RN-16.
function agregarDesdobramento(base, cards, bus) {
  const pesoTotal = Number(base.parametros.pesoTotal) || 100;
  const resultado = Number(base.parametros.pesoResultadoCoo) || 0;
  const cardDe = (sigla, numero) => cards.find((c) => c.bu.sigla === sigla && c.meta.numero === numero);
  const celula = (sigla, numero, peso) => {
    if (!peso) return null;
    const c = cardDe(sigla, numero);
    return { peso, estado: c ? c.estado : null, card: c ? c.card : null };
  };
  const linhas = [{ numero: 0, titulo: "COO's Scorecard Result", tipo: 'formula', resultado: true, origem: null, nova: false,
    celulas: Object.fromEntries(bus.map((b) => [b.sigla, celula(b.sigla, 0, resultado)])) }]
    .concat(base.metasBu
      .map((m) => ({ numero: m.numero, titulo: m.titulo, tipo: m.tipo, resultado: false, origem: m.origem || null, nova: !!m.nova,
        celulas: Object.fromEntries(bus.map((b) => [b.sigla, celula(b.sigla, m.numero, m.pesos[b.sigla])])) }))
      .filter((l) => Object.values(l.celulas).some(Boolean)));
  const totais = bus.map((b) => {
    const especificas = linhas.filter((l) => !l.resultado).reduce((t, l) => t + (l.celulas[b.sigla] ? l.celulas[b.sigla].peso : 0), 0);
    const aprovado = linhas.reduce((t, l) => t + (l.celulas[b.sigla] && l.celulas[b.sigla].estado === 'aprovado' ? l.celulas[b.sigla].peso : 0), 0);
    const total = resultado + especificas;
    return { bu: b.sigla, resultado, especificas, total, aprovado, alerta: total !== pesoTotal };
  });
  return { linhas, totais };
}

// ── T04 Goal Card ──
// Regra de acesso: qualquer usuário do Portal lê tudo; contribuidor edita os cards da sua BU; aprovador edita e aprova
// todos os cards (sem telas administrativas); administrador tem todas as telas. Papéis antigos dos exemplos são mapeados.
const ehAprovador = (papeis) => papeis.some((p) => ['aprovador', 'pci_coo', 'admin'].includes(p.papel));
const contribuidorDe = (papeis, sigla) => papeis.some((p) => ['contribuidor', 'ponto_focal'].includes(p.papel) && p.bu === sigla);
// Edição (AC-05): contribuidor da BU do card, aprovador ou administrador
const ehAdmin = (papeis) => papeis.some((p) => p.papel === 'admin');
const podeEditar = (papeis, sigla) => ehAprovador(papeis) || contribuidorDe(papeis, sigla);
const LIMITE_COMENTARIO = 10; // RN-08/RN-09 (limite definido na aplicação)
const MAX_COMENTARIO = 2000;  // tamanho máximo de um comentário de seção
const SECOES_CARD = ['objective', 'formula', 'unit', 'ruler', 'area', 'evidence', 'exceptions'];
const IDADES = ['todas', '3', '5']; // filtro de idade da T14: todas, há 3+ ou 5+ dias úteis na fila

// T14 Aprovações: fila do grupo de aprovação a partir da lista de cards (mesma fonte do Painel, CA-15)
function filaAprovacao(cards, filtro, hoje, podeDecidirCard) {
  const f = filtro || {};
  const min = f.idade && f.idade !== 'todas' ? Number(f.idade) : 0;
  const pend = cards.filter((c) => c.estado === 'em_aprovacao');
  const itens = pend
    .filter((c) => (!f.pais || c.bu.pais === f.pais) && (!f.bu || c.bu.sigla === f.bu))
    .map((c) => ({ card: c.card, bu: c.bu, meta: c.meta, versao: c.versao, desde: c.desde, idade: diasUteisEntre(c.desde, hoje),
      resubmissao: (c.versao || 0) > 1, contribuidor: c.contribuidor || null, podeDecidir: podeDecidirCard(c) }))
    .filter((it) => it.idade >= min)
    .sort((a, b) => b.idade - a.idade || a.card.localeCompare(b.card));
  return { itens, total: pend.length };
}

// Campos obrigatórios (§5): Submeter fica bloqueado enquanto algum estiver vazio (cliente e servidor).
const OBRIGATORIOS = ['objective', 'formula', 'unit', 'ruler', 'area', 'evidence'];
function camposObrigatorios(secoes) {
  const s = secoes || {}, r = s.ruler || {}, a = s.area || {};
  const vazio = (v) => v == null || String(v).trim() === '';
  const ok = {
    objective: !vazio(s.objective), formula: !vazio(s.formula), unit: !vazio(s.unit),
    ruler: !['min', 'meta', 'exc'].some((k) => vazio(r[k])), area: !vazio(a.area) && !vazio(a.responsavel), evidence: !vazio(s.evidence),
  };
  return OBRIGATORIOS.map((id) => ({ id, ok: ok[id] }));
}

// Decisão do grupo de aprovação (nível único, D-09): Devolver exige comentário e uma seção Ajustar (RN-08); Negar, justificativa (RN-09).
function validarDecisao({ decisao, comentario, revisao } = {}) {
  const erros = [];
  if (!['aprovar', 'devolver', 'negar'].includes(decisao)) erros.push('decisao');
  const txt = String(comentario || '').trim();
  if ((decisao === 'devolver' || decisao === 'negar') && txt.length < LIMITE_COMENTARIO) erros.push('comentario');
  if (decisao === 'devolver' && !Object.values(revisao || {}).includes('ajustar')) erros.push('secaoAjustar');
  return erros;
}

// T04 é a ficha dos contribuidores: edição (contribuidor da BU, Rascunho ou Em revisão) ou leitura (demais casos).
// A decisão do grupo de aprovação acontece em outra tela (fila de aprovação, T14).
function modoDoCard(card, papeis) {
  return podeEditar(papeis, card.bu.sigla) && (card.estado === 'rascunho' || card.estado === 'em_revisao') ? 'edicao' : 'leitura';
}
// Quem pode decidir (fila de aprovação): grupo de aprovação, card Em aprovação, sem ter editado ou submetido o card (RN-12)
function podeDecidir(card, papeis, nomeUsuario) {
  const editou = podeEditar(papeis, card.bu.sigla) && (card.editores || []).includes(nomeUsuario);
  return ehAprovador(papeis) && card.estado === 'em_aprovacao' && !editou;
}

// Linha do tempo do card: rascunho → submissão (vN) → decisão
function linhaDoCard(card) {
  const ev = [{ id: 'rascunho', feito: true, quando: null }];
  const sub = card.estado !== 'rascunho';
  ev.push({ id: 'submetido', feito: sub, quando: sub ? card.desde : null, versao: card.versao, quem: card.submetidoPor });
  const decidido = ['aprovado', 'negado', 'em_revisao'].includes(card.estado);
  ev.push({ id: 'em_aprovacao', feito: sub, atual: card.estado === 'em_aprovacao' });
  ev.push({ id: card.estado === 'negado' ? 'negado' : card.estado === 'em_revisao' ? 'em_revisao' : 'aprovado', feito: decidido, quando: decidido ? card.desde : null });
  return ev;
}

// ── T11 Configuração do ciclo (só o administrador, §7.1) ──
const ABAS_CONFIG = ['ciclo', 'bus', 'grupos', 'metas', 'parametros'];
const GRUPOS = ['contribuidor', 'aprovacao', 'admin'];
const dataValida = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
// Unidades ativas de cada nível: CEO e COO (unidades), BUs ativas, GG das BUs ativas e GA dessas GG
function unidadesAtivas(nivel, unidades, bus) {
  const busOn = (bus || []).filter((b) => b.ativa !== false).map((b) => b.sigla);
  if (nivel === 'bu') return busOn.map((b) => ({ id: b, nome: b, nivel: 'bu' }));
  const gg = (unidades || []).filter((u) => u.nivel === 'gg' && busOn.includes(u.pai));
  if (nivel === 'gg') return gg;
  if (nivel === 'ga') return (unidades || []).filter((u) => u.nivel === 'ga' && gg.some((g) => g.id === u.pai));
  return (unidades || []).filter((u) => u.nivel === nivel);
}
// Soma por unidade de cada nível ativo: pontos herdados do nível acima + pesos das metas do nível (RN-16: fecha o total)
function somaPesosPorNivel(metasNivel, niveis, unidades, bus) {
  const r = [];
  (niveis || []).filter((n) => n.ativo).forEach((n) => {
    unidadesAtivas(n.id, unidades, bus).forEach((u) => {
      const soma = Number(n.herdado || 0) + ((metasNivel || {})[n.id] || []).reduce((t, m) => t + (Number((m.pesos || {})[u.id]) || 0), 0);
      r.push({ nivel: n.id, unidade: u.id, nome: u.nome, soma, total: Number(n.total) });
    });
  });
  return r;
}
// Valida uma aba da configuração; devolve a lista de erros ({ campo, codigo, ... }) — vazia = pode gravar.
function validarConfiguracao(aba, dados, base) {
  const erros = [];
  const d = dados || {};
  if (!ABAS_CONFIG.includes(aba)) return [{ campo: 'aba', codigo: 'ABA' }];
  if (aba === 'ciclo') {
    const ano = Number(d.ano);
    if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) erros.push({ campo: 'ano', codigo: 'ANO' });
    if (!String(d.nome || '').trim()) erros.push({ campo: 'nome', codigo: 'OBRIGATORIO' });
    const et = Array.isArray(d.etapas) ? d.etapas : [];
    if (et.length !== 4) erros.push({ campo: 'etapas', codigo: 'ETAPAS' });
    let anterior = et[0] && et[0].inicio;
    if (!dataValida(anterior)) erros.push({ campo: 'etapas.0.inicio', codigo: 'DATA' });
    et.forEach((e, i) => {
      if (!dataValida(e.fim)) erros.push({ campo: `etapas.${i}.fim`, codigo: 'DATA' });
      else if (dataValida(anterior) && e.fim <= anterior) erros.push({ campo: `etapas.${i}.fim`, codigo: 'ORDEM' });
      anterior = e.fim;
    });
  }
  if (aba === 'metas') {
    const niveis = d.niveis || base.niveis, unidades = d.unidades || base.unidades, bus = d.bus || base.bus;
    Object.entries(d.metasNivel || {}).forEach(([nivel, lista]) => (lista || []).forEach((m, i) => {
      if (!String(m.titulo || '').trim()) erros.push({ campo: `metas.${nivel}.${i}.titulo`, codigo: 'OBRIGATORIO' });
      Object.values(m.pesos || {}).forEach((p) => { if (!(Number(p) >= 0 && Number(p) <= 1000)) erros.push({ campo: `metas.${nivel}.${i}.pesos`, codigo: 'PESO' }); });
    }));
    somaPesosPorNivel(d.metasNivel, niveis, unidades, bus).filter((x) => x.soma !== x.total)
      .forEach((x) => erros.push({ campo: 'pesos', codigo: 'RN16', nivel: x.nivel, unidade: x.unidade, soma: x.soma, total: x.total }));
  }
  if (aba === 'grupos') {
    const siglas = base.bus.map((b) => b.sigla).concat((d.bus || []).map((b) => b.sigla));
    (d.membros || []).forEach((m, i) => {
      if (!/^[A-Za-z0-9]{4,12}$/.test(String(m.matricula || ''))) erros.push({ campo: `membros.${i}.matricula`, codigo: 'MATRICULA' });
      if (!GRUPOS.includes(m.grupo)) erros.push({ campo: `membros.${i}.grupo`, codigo: 'GRUPO' });
      const precisaBu = m.grupo === 'contribuidor';
      if (precisaBu && !siglas.includes(m.bu)) erros.push({ campo: `membros.${i}.bu`, codigo: 'BU' });
    });
    if (!(d.membros || []).some((m) => m.grupo === 'aprovacao')) erros.push({ campo: 'membros', codigo: 'SEM_APROVADOR' });
    if (!(d.membros || []).some((m) => m.grupo === 'admin')) erros.push({ campo: 'membros', codigo: 'SEM_ADMIN' });
  }
  if (aba === 'parametros') {
    (d.parametros || []).forEach((p, i) => {
      const ref = base.parametros.find((x) => x.id === p.id);
      const v = Number(p.valor);
      if (!ref || !Number.isFinite(v) || v < ref.min || v > ref.max) erros.push({ campo: `parametros.${i}`, codigo: 'FAIXA', id: p.id });
    });
    (d.niveis || []).forEach((n, i) => {
      const ref = base.niveis.find((x) => x.id === n.id);
      if (!ref) return erros.push({ campo: `niveis.${i}`, codigo: 'NIVEL' });
      if (!String(n.nome || '').trim()) erros.push({ campo: `niveis.${i}.nome`, codigo: 'OBRIGATORIO' });
      const t = Number(n.total), h = Number(n.herdado);
      if (!Number.isFinite(t) || t < 1 || t > 1000) erros.push({ campo: `niveis.${i}.total`, codigo: 'FAIXA' });
      if (!Number.isFinite(h) || h < 0 || h >= t || (i === 0 && h !== 0)) erros.push({ campo: `niveis.${i}.herdado`, codigo: 'FAIXA' });
      if (n.fixo && !n.ativo) erros.push({ campo: `niveis.${i}.ativo`, codigo: 'FIXO' });
    });
    // GA só fica ativo com a GG ativa (o desdobramento não pula nível)
    const nv = Object.fromEntries((d.niveis || []).map((n) => [n.id, n]));
    if (nv.ga && nv.ga.ativo && nv.gg && !nv.gg.ativo) erros.push({ campo: 'niveis.ga.ativo', codigo: 'SALTO' });
  }
  if (aba === 'bus') {
    const bus = d.bus || [];
    if (!bus.some((b) => b.ativa)) erros.push({ campo: 'bus', codigo: 'SEM_BU' });
    const vistos = new Set();
    bus.forEach((b, i) => {
      const nome = String(b.sigla || '').trim();
      if (!nome) erros.push({ campo: `bus.${i}.sigla`, codigo: 'OBRIGATORIO' });
      else if (vistos.has(nome.toLowerCase())) erros.push({ campo: `bus.${i}.sigla`, codigo: 'DUPLICADA' });
      vistos.add(nome.toLowerCase());
      if (!String(b.pais || '').trim()) erros.push({ campo: `bus.${i}.pais`, codigo: 'OBRIGATORIO' });
    });
    // Exclusão: só BU sem Goal Card submetido no ciclo (com card, tira-se do ciclo)
    base.bus.filter((o) => o.cardsSubmetidos > 0 && !bus.some((b) => (b.origem || b.sigla) === o.sigla))
      .forEach((o) => erros.push({ campo: 'bus', codigo: 'BU_COM_CARDS', bu: o.sigla }));
  }
  return erros;
}

// ── T07 Action Log (§7.3): filtros BU, Meta, Seção, Tipo, Período e Goal Card; leitura aberta a quem tem papel no ciclo ──
const TIPOS_EVENTO = ['submissao', 'recolhimento', 'decisao', 'reabertura', 'comentario', 'configuracao', 'acesso_negado'];
const SECOES_LOG = ['objective', 'formula', 'unit', 'ruler', 'area', 'evidence', 'exceptions', 'ciclo', 'bus', 'grupos', 'metas', 'parametros'];
const PERIODOS = ['7', '30', 'ciclo'];
// Valida o filtro (valor fora da lista → erro) e devolve os eventos que passam; `porTipo` ignora o filtro de tipo,
// para os cartões do topo mostrarem quanto há de cada tipo no recorte atual.
function filtrarEventos(eventos, q, hoje, metas, bus) {
  const f = { bu: String(q.bu || ''), meta: String(q.meta || ''), secao: String(q.secao || ''), tipo: String(q.tipo || ''), periodo: String(q.periodo || 'ciclo'), card: String(q.card || '') };
  const erros = [];
  if (f.bu && !bus.some((b) => b.sigla === f.bu)) erros.push('bu');
  if (f.meta && !metas.some((m) => String(m.numero) === f.meta)) erros.push('meta');
  if (f.secao && !SECOES_LOG.includes(f.secao)) erros.push('secao');
  if (f.tipo && !TIPOS_EVENTO.includes(f.tipo)) erros.push('tipo');
  if (!PERIODOS.includes(f.periodo)) erros.push('periodo');
  if (f.card && !/^GC-[A-Z]{2,3}-\d{2}$/.test(f.card)) erros.push('card');
  if (erros.length) return { erros };
  let limite = '';
  if (f.periodo !== 'ciclo') {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - Number(f.periodo) + 1);
    limite = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const semTipo = eventos.filter((e) => (!f.bu || e.bu === f.bu) && (!f.meta || (e.meta && String(e.meta.numero) === f.meta)) &&
    (!f.secao || e.secao === f.secao) && (!limite || e.quando.slice(0, 10) >= limite) && (!f.card || e.card === f.card));
  const porTipo = Object.fromEntries(TIPOS_EVENTO.map((t) => [t, semTipo.filter((e) => e.tipo === t).length]));
  return { filtro: f, lista: f.tipo ? semTipo.filter((e) => e.tipo === f.tipo) : semTipo, porTipo, totalSemTipo: semTipo.length };
}

// Papéis do usuário no ciclo. Até o modelo de dados (P-12), vêm dos dados de exemplo; nos testes, são injetados.
// Em desenvolvimento, AIPGOALS_PERFIL_LOCAL simula um perfil: leitor, contribuidor (Salobo), aprovador ou admin.
const PERFIS_LOCAIS = { leitor: [], contribuidor: [{ papel: 'contribuidor', bu: 'Salobo' }], aprovador: [{ papel: 'aprovador', bu: null }], admin: [{ papel: 'admin', bu: null }] };
const papeisExemplo = (email, hoje) => {
  const p = process.env.NODE_ENV === 'development' && PERFIS_LOCAIS[process.env.AIPGOALS_PERFIL_LOCAL];
  return p || pendenciasExemplo(hoje).usuario.papeis || [];
};
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

  // T00 Início: ciclo ativo (etapa, janelas, BUs) e os papéis do usuário para o menu (AC-02)
  router.get('/inicio', async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    // Sem identidade do proxy não há acesso (AC-01). Mensagem neutra (AC-04).
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      // Modelo de dados pendente (P-12): a consulta real entra aqui, parametrizada por @email e @ciclo.
      if (fonte !== 'exemplo') return res.status(501).json({ error: 'Fonte de dados ainda não disponível.', codigo: 'MODELO_PENDENTE' });
      const hoje = agora();
      res.json({ ciclo: cicloExemplo(hoje), usuario: { papeis: papeisDe(email, hoje) }, atualizadoEm: hoje.toISOString(), exemplo: true, desatualizado: false });
    } catch (err) {
      // O motivo fica no log; a resposta não leva texto do banco.
      console.error(`${TAG} /inicio:`, err.message);
      res.status(500).json({ error: 'Não foi possível carregar o início.', codigo: 'ERRO' });
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
      // Leitura aberta (AC-05): todas as BUs para qualquer usuário; sem ?bu=, abre na BU do contribuidor
      const bus = base.ciclo.bus;
      const minha = papeis.find((p) => p.bu && bus.some((b) => b.sigla === p.bu));
      const sigla = String(req.query.bu || (minha ? minha.bu : bus[0].sigla));
      const bu = bus.find((b) => b.sigla === sigla);
      // BU inexistente: 404
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

  router.get('/desdobramento', async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      if (fonte !== 'exemplo') return res.status(501).json({ error: 'Fonte de dados ainda não disponível.', codigo: 'MODELO_PENDENTE' });
      const hoje = agora();
      const papeis = papeisDe(email, hoje);
      const base = desdobramentoExemplo(hoje);
      // Recorte (AC-04/AC-05): o scorecard do COO é a origem comum; as colunas de BU seguem os papéis do usuário
      const bus = base.ciclo.bus; // leitura aberta: todas as BUs para qualquer usuário (AC-05)
      const cards = painelExemplo(hoje).cards.filter((c) => bus.some((b) => b.sigla === c.bu.sigla));
      res.json({ ciclo: base.ciclo, parametros: base.parametros, scorecardCoo: base.scorecardCoo, bus,
        ...agregarDesdobramento(base, cards, bus), atualizadoEm: hoje.toISOString(), exemplo: true, desatualizado: false });
    } catch (err) {
      console.error(`${TAG} /desdobramento:`, err.message);
      res.status(500).json({ error: 'Não foi possível carregar o desdobramento.', codigo: 'ERRO' });
    }
  });

  // ── T04 Goal Card ──
  const lerCard = (req, res, hoje) => {
    const codigo = String((req.query && req.query.card) || (req.body && req.body.card) || '');
    if (!/^GC-[A-Z]{2,3}-\d{2}$/.test(codigo)) { res.status(400).json({ error: 'Card inválido.', codigo: 'PARAMETRO' }); return null; }
    const card = goalCardExemplo(codigo, hoje);
    if (!card) { res.status(404).json({ error: 'Não encontrado.', codigo: 'NAO_ENCONTRADO' }); return null; }
    return card;
  };
  // Nome do usuário (diretório); no exemplo, uma pessoa fora da lista de editores
  const nomeDe = () => 'Usuário Demonstração';

  router.get('/goal-card', async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      if (fonte !== 'exemplo') return res.status(501).json({ error: 'Fonte de dados ainda não disponível.', codigo: 'MODELO_PENDENTE' });
      const hoje = agora();
      const papeis = papeisDe(email, hoje);
      const card = lerCard(req, res, hoje); if (!card) return; // leitura aberta a qualquer usuário do Portal (AC-07)
      const modo = modoDoCard(card, papeis);
      res.json({ ...card, modo, obrigatorios: camposObrigatorios(card.secoes), linha: linhaDoCard(card),
        permissoes: { editar: modo === 'edicao' },
        parametros: { minComentario: LIMITE_COMENTARIO }, atualizadoEm: hoje.toISOString(), exemplo: true, desatualizado: false });
    } catch (err) {
      console.error(`${TAG} /goal-card:`, err.message);
      res.status(500).json({ error: 'Não foi possível carregar o Goal Card.', codigo: 'ERRO' });
    }
  });

  router.post('/goal-card/submeter', express.json({ limit: '100kb' }), async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      const hoje = agora(); const papeis = papeisDe(email, hoje);
      const card = lerCard(req, res, hoje); if (!card) return;
      // Escrita: contribuidor da BU, aprovador ou administrador (AC-04, AC-05); demais: 403
      if (!podeEditar(papeis, card.bu.sigla)) return res.status(403).json({ error: 'Sem permissão para editar esta BU.', codigo: 'SEM_ACESSO' });
      if (!['rascunho', 'em_revisao'].includes(card.estado)) return res.status(409).json({ error: 'O card não está em edição.', codigo: 'ESTADO' });
      const pend = camposObrigatorios(req.body.secoes).filter((x) => !x.ok).map((x) => x.id);
      if (pend.length) return res.status(400).json({ error: 'Campos obrigatórios sem preencher.', codigo: 'OBRIGATORIOS', pendentes: pend });
      res.json({ ok: true, simulado: true, estado: 'em_aprovacao', versao: (card.versao || 0) + 1 });
    } catch (err) {
      console.error(`${TAG} /goal-card/submeter:`, err.message);
      res.status(500).json({ error: 'Não foi possível submeter.', codigo: 'ERRO' });
    }
  });

  router.post('/goal-card/decisao', express.json({ limit: '100kb' }), async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      const hoje = agora(); const papeis = papeisDe(email, hoje);
      const card = lerCard(req, res, hoje); if (!card) return;
      if (!ehAprovador(papeis)) return res.status(403).json({ error: 'Decisão restrita ao grupo de aprovação.', codigo: 'SEM_ACESSO' });
      if (card.estado !== 'em_aprovacao') return res.status(409).json({ error: 'O card não está em aprovação.', codigo: 'ESTADO' });
      if (!podeDecidir(card, papeis, nomeDe(email))) return res.status(403).json({ error: 'Quem editou ou submeteu o card não decide (RN-12).', codigo: 'RN12' });
      const erros = validarDecisao(req.body);
      if (erros.length) return res.status(400).json({ error: 'Decisão incompleta.', codigo: 'VALIDACAO', erros });
      const estado = { aprovar: 'aprovado', devolver: 'em_revisao', negar: 'negado' }[req.body.decisao];
      res.json({ ok: true, simulado: true, estado });
    } catch (err) {
      console.error(`${TAG} /goal-card/decisao:`, err.message);
      res.status(500).json({ error: 'Não foi possível registrar a decisão.', codigo: 'ERRO' });
    }
  });

  // Comentário ancorado a uma seção (§7.3, RN-13): feito na T14 pelo grupo de aprovação; não muda o estado do card.
  router.post('/goal-card/comentario', express.json({ limit: '20kb' }), async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      const hoje = agora(); const papeis = papeisDe(email, hoje);
      const card = lerCard(req, res, hoje); if (!card) return;
      // Consulta nunca comenta (RN-19); na T14, só o grupo de aprovação (AC-08)
      if (!ehAprovador(papeis)) return res.status(403).json({ error: 'Comentário restrito ao grupo de aprovação.', codigo: 'SEM_ACESSO' });
      const secao = String(req.body.secao || ''), texto = String(req.body.texto || '').trim();
      if (!SECOES_CARD.includes(secao)) return res.status(400).json({ error: 'Seção inválida.', codigo: 'VALIDACAO', erros: ['secao'] });
      if (!texto || texto.length > MAX_COMENTARIO) return res.status(400).json({ error: 'Comentário vazio ou longo demais.', codigo: 'VALIDACAO', erros: ['texto'] });
      res.json({ ok: true, simulado: true, comentario: { id: `${card.card}-n${Date.now()}`, secao, autor: nomeDe(email), papel: 'aprovador', quando: hoje.toISOString().slice(0, 10), texto, respostas: [] } });
    } catch (err) {
      console.error(`${TAG} /goal-card/comentario:`, err.message);
      res.status(500).json({ error: 'Não foi possível publicar o comentário.', codigo: 'ERRO' });
    }
  });

  // T14 Aprovações: fila do grupo de aprovação (AC-08, CA-19). Demais perfis: 403 (a tela mostra a T12).
  router.get('/aprovacoes', async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      if (fonte !== 'exemplo') return res.status(501).json({ error: 'Fonte de dados ainda não disponível.', codigo: 'MODELO_PENDENTE' });
      const hoje = agora(); const papeis = papeisDe(email, hoje);
      if (!ehAprovador(papeis)) return res.status(403).json({ error: 'Sem acesso a esta tela.', codigo: 'SEM_ACESSO' });
      const base = painelExemplo(hoje);
      const filtro = { pais: String(req.query.pais || ''), bu: String(req.query.bu || ''), idade: IDADES.includes(String(req.query.idade)) ? String(req.query.idade) : 'todas' };
      if (filtro.pais && !base.ciclo.bus.some((b) => b.pais === filtro.pais)) filtro.pais = '';
      if (filtro.bu && !base.ciclo.bus.some((b) => b.sigla === filtro.bu && (!filtro.pais || b.pais === filtro.pais))) filtro.bu = '';
      const nome = nomeDe(email);
      const decide = (c) => { const gc = goalCardExemplo(c.card, hoje); return !!gc && podeDecidir(gc, papeis, nome); };
      res.json({ ciclo: base.ciclo, parametros: { diasParado: base.parametros.diasParado, minComentario: LIMITE_COMENTARIO, maxComentario: MAX_COMENTARIO },
        filtro, ...filaAprovacao(base.cards, filtro, hoje, decide), atualizadoEm: hoje.toISOString(), exemplo: true, desatualizado: false });
    } catch (err) {
      console.error(`${TAG} /aprovacoes:`, err.message);
      res.status(500).json({ error: 'Não foi possível carregar a fila de aprovação.', codigo: 'ERRO' });
    }
  });

  // T11 Configuração do ciclo: leitura e gravação só do administrador (§7.1, T11); demais perfis, 403 (T12).
  const exigirAdmin = (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) { res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' }); return null; }
    if (fonte !== 'exemplo') { res.status(501).json({ error: 'Fonte de dados ainda não disponível.', codigo: 'MODELO_PENDENTE' }); return null; }
    const hoje = agora();
    if (!ehAdmin(papeisDe(email, hoje))) { res.status(403).json({ error: 'Sem acesso a esta tela.', codigo: 'SEM_ACESSO' }); return null; }
    return { email, hoje };
  };
  router.get('/configuracao', async (req, res) => {
    try {
      const ctx = exigirAdmin(req, res); if (!ctx) return;
      const base = configuracaoExemplo(ctx.hoje);
      res.json({ ...base, somas: somaPesosPorNivel(base.metasNivel, base.niveis, base.unidades, base.bus), atualizadoEm: ctx.hoje.toISOString(), exemplo: true, desatualizado: false });
    } catch (err) {
      console.error(`${TAG} /configuracao:`, err.message);
      res.status(500).json({ error: 'Não foi possível carregar a configuração.', codigo: 'ERRO' });
    }
  });
  router.post('/configuracao/salvar', express.json({ limit: '200kb' }), async (req, res) => {
    try {
      const ctx = exigirAdmin(req, res); if (!ctx) return;
      const base = configuracaoExemplo(ctx.hoje);
      const { aba, dados } = req.body || {};
      const erros = validarConfiguracao(aba, dados, base);
      if (erros.length) return res.status(400).json({ error: 'Configuração com pendências.', codigo: erros.some((e) => e.codigo === 'RN16') ? 'RN16' : 'VALIDACAO', erros });
      // Modelo de dados pendente (P-12): a gravação e o evento "Configuração" no Action Log (antes e depois) entram aqui.
      res.json({ ok: true, simulado: true, aba, evento: { tipo: 'configuracao', quem: ctx.email, quando: ctx.hoje.toISOString() } });
    } catch (err) {
      console.error(`${TAG} /configuracao/salvar:`, err.message);
      res.status(500).json({ error: 'Não foi possível salvar a configuração.', codigo: 'ERRO' });
    }
  });
  router.post('/configuracao/clonar', express.json({ limit: '10kb' }), async (req, res) => {
    try {
      const ctx = exigirAdmin(req, res); if (!ctx) return;
      const base = configuracaoExemplo(ctx.hoje);
      const ano = base.ciclo.ano + 1;
      res.json({ ok: true, simulado: true, novoCiclo: { id: `AIP-${ano}`, nome: `AIP ${ano}`, bus: base.bus.length, membros: base.membros.length, metas: base.metas.length } });
    } catch (err) {
      console.error(`${TAG} /configuracao/clonar:`, err.message);
      res.status(500).json({ error: 'Não foi possível criar o novo ciclo.', codigo: 'ERRO' });
    }
  });

  // T07 Action Log: todos os perfis com papel no ciclo leem (AC-07); paginado (40 por página) ou completo para exportar (tudo=1)
  router.get('/action-log', async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      if (fonte !== 'exemplo') return res.status(501).json({ error: 'Fonte de dados ainda não disponível.', codigo: 'MODELO_PENDENTE' });
      const hoje = agora();
      // Histórico de um card (popup): aberto a todos. Action Log geral: tela administrativa, só o administrador.
      if (!req.query.card && !ehAdmin(papeisDe(email, hoje))) return res.status(403).json({ error: 'Sem acesso a esta tela.', codigo: 'SEM_ACESSO' });
      const base = actionLogExemplo(hoje);
      const r = filtrarEventos(base.eventos, req.query, hoje, base.metas, base.bus);
      if (r.erros) return res.status(400).json({ error: 'Filtro inválido.', codigo: 'FILTRO', erros: r.erros });
      const tamanho = 40, total = r.lista.length;
      const pagina = Math.max(1, Math.min(Math.ceil(total / tamanho) || 1, parseInt(req.query.pagina, 10) || 1));
      const eventos = req.query.tudo === '1' ? r.lista : r.lista.slice((pagina - 1) * tamanho, pagina * tamanho);
      res.json({ ciclo: base.ciclo, filtro: r.filtro, eventos, total, pagina, paginas: Math.ceil(total / tamanho) || 1, porTipo: r.porTipo, totalSemTipo: r.totalSemTipo,
        opcoes: { bus: base.bus, metas: base.metas, secoes: SECOES_LOG, tipos: TIPOS_EVENTO },
        atualizadoEm: hoje.toISOString(), exemplo: true, desatualizado: false });
    } catch (err) {
      console.error(`${TAG} /action-log:`, err.message);
      res.status(500).json({ error: 'Não foi possível carregar o Action Log.', codigo: 'ERRO' });
    }
  });

  // T06 Versões (§7.2): todos os perfis com papel leem; ninguém altera. Rascunho não tem versão (lista vazia).
  router.get('/versoes', async (req, res) => {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' });
    try {
      if (fonte !== 'exemplo') return res.status(501).json({ error: 'Fonte de dados ainda não disponível.', codigo: 'MODELO_PENDENTE' });
      const hoje = agora();
      const codigo = String(req.query.card || ''); // Versões: leitura aberta (AC-07)
      if (!/^GC-[A-Z]{2,3}-\d{2}$/.test(codigo)) return res.status(400).json({ error: 'Goal Card inválido.', codigo: 'CARD' });
      const v = versoesExemplo(codigo, hoje);
      if (!v) return res.status(404).json({ error: 'Goal Card não encontrado.', codigo: 'NAO_ENCONTRADO' });
      res.json({ ...v, atualizadoEm: hoje.toISOString(), exemplo: true, desatualizado: false });
    } catch (err) {
      console.error(`${TAG} /versoes:`, err.message);
      res.status(500).json({ error: 'Não foi possível carregar as versões.', codigo: 'ERRO' });
    }
  });

  return router;
}

module.exports = { filaAprovacao, IDADES, MAX_COMENTARIO, criarAipGoalsRouter, camposObrigatorios, validarDecisao, modoDoCard, podeDecidir, linhaDoCard, ehAprovador, contribuidorDe, ehAdmin, podeEditar, OBRIGATORIOS, LIMITE_COMENTARIO, agregarPainel, agregarMetas, agregarDesdobramento, diasUteisEntre, ESTADOS, validarConfiguracao, somaPesosPorNivel, unidadesAtivas, ABAS_CONFIG, GRUPOS, dataValida, filtrarEventos, TIPOS_EVENTO, SECOES_LOG, PERIODOS };
