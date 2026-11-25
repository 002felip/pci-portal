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
 * FONTE DOS DADOS: injetada em `dados`. No app (portal.js e server.js), aip-goals-banco.js lê e grava no schema PM
 * do Azure SQL (database/001_pm_criar_tabelas.sql). Os dados de exemplo ficam só nos testes (tests/fonte-exemplo.js).
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
 *   POST /goal-card/rascunho  { card, secoes }   grava o rascunho (mesmas permissões da edição)
 *   POST /goal-card/submeter  { card, secoes }   campos obrigatórios no servidor (RN-03); só contribuidor da BU (AC-04)
 *   POST /goal-card/reabrir   { card }           só o administrador; card aprovado volta a Rascunho
 *   POST /goal-card/decisao   { card, decisao, comentario, revisao }   RN-06, RN-08, RN-09, RN-12 (usada pela fila de aprovação, T14)
 *   POST /goal-card/comentario { card, secao, texto }   comentário ancorado a uma seção (§7.3, RN-13); só o grupo de aprovação, na T14
 *   GET  /configuracao · POST /configuracao/salvar { aba, dados } · POST /configuracao/ciclo { acao, ano }   T11, só admin
 *   GET  /pessoas?q=   busca no MDM (CI.KZN_MDM_HIERARQUIA) para o autopreenchimento; só admin
 *   GET  /aprovacoes?pais=&bu=&idade=   T14 — fila do grupo de aprovação (AC-08: demais perfis, 403):
 *                      { ciclo, parametros, filtro, itens[], total }
 *                      `itens` = cards Em aprovação, os mais antigos primeiro, com a idade em dias úteis,
 *                      se é resubmissão e se o usuário pode decidir (RN-12).
 */
const express = require('express');

const TAG = '[aip-goals]';
// Limite de pedidos por usuário por minuto (proteção contra abuso; a navegação normal fica muito abaixo)
const LIMITE_POR_MINUTO = 240;
const ESTADOS = ['rascunho', 'em_aprovacao', 'em_revisao', 'aprovado']; // sem Negado: a decisão só aprova ou devolve

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
function validarDecisao({ decisao, comentario, revisao, ajustes } = {}) {
  const erros = [];
  const marcadas = Object.keys(revisao || {}).filter((k) => revisao[k] === 'ajustar');
  if (!['aprovar', 'devolver'].includes(decisao)) erros.push('decisao');
  const txt = String(comentario || '').trim();
  if (decisao === 'devolver' && txt.length < LIMITE_COMENTARIO) erros.push('comentario');
  if (decisao === 'devolver' && !marcadas.length) erros.push('secaoAjustar');
  // Cada item marcado para ajuste exige o seu comentário; aprovar não combina com item marcado para ajuste
  if (decisao === 'devolver' && marcadas.some((k) => !String((ajustes || {})[k] || '').trim())) erros.push('ajusteSemComentario');
  if (decisao === 'aprovar' && marcadas.length) erros.push('aprovarComAjuste');
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
const ABAS_CONFIG = ['ciclo', 'bus', 'grupos', 'metas', 'parametros', 'excecoes'];
const MAX_EXCECAO = 2000; // tamanho máximo de um texto de exceções e considerações
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
// Novo ciclo: ano maior que o ano atual. As janelas nascem em branco e são preenchidas na aba Ciclo; se vierem
// etapas, valem as mesmas regras de lá (no ano atual ou no seguinte e em ordem). Devolve a lista de erros (vazia = pode criar).
function validarNovoCiclo(ano, etapas, hoje) {
  const erros = [], atual = hoje.getFullYear();
  if (!Number.isInteger(ano) || ano <= atual || ano > 2100) erros.push({ campo: 'ano', codigo: 'ANO' });
  if (etapas == null) return erros;
  const et = Array.isArray(etapas) ? etapas : [];
  if (et.length !== 4) return erros.concat({ campo: 'etapas', codigo: 'ETAPAS' });
  const noPeriodo = (v) => dataValida(v) && [atual, atual + 1].includes(Number(String(v).slice(0, 4)));
  let ant = null;
  et.forEach((e, i) => {
    const ini = i === 0 ? e.inicio : ant;
    if (!noPeriodo(ini)) erros.push({ campo: `etapas.${i}.inicio`, codigo: dataValida(ini) ? 'PERIODO' : 'DATA' });
    if (!noPeriodo(e.fim)) erros.push({ campo: `etapas.${i}.fim`, codigo: dataValida(e.fim) ? 'PERIODO' : 'DATA' });
    else if (dataValida(ini) && e.fim <= ini) erros.push({ campo: `etapas.${i}.fim`, codigo: 'ORDEM' });
    ant = e.fim;
  });
  return erros;
}
// Valida uma aba da configuração; devolve a lista de erros ({ campo, codigo, ... }) — vazia = pode gravar.
function validarConfiguracao(aba, dados, base, hoje = new Date()) {
  const erros = [];
  const d = dados || {};
  if (!ABAS_CONFIG.includes(aba)) return [{ campo: 'aba', codigo: 'ABA' }];
  if (aba === 'ciclo') {
    const ano = Number(d.ano);
    if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) erros.push({ campo: 'ano', codigo: 'ANO' });
    if (!String(d.nome || '').trim()) erros.push({ campo: 'nome', codigo: 'OBRIGATORIO' });
    const et = Array.isArray(d.etapas) ? d.etapas : [];
    if (et.length !== 4) erros.push({ campo: 'etapas', codigo: 'ETAPAS' });
    // Cada etapa tem início (padrão: fim da etapa anterior) e fim depois do início; os inícios seguem a ordem das etapas
    let iniAnt = null;
    et.forEach((e, i) => {
      const ini = e.inicio || (i > 0 ? et[i - 1].fim : null);
      // Datas das janelas: só no ano atual ou no seguinte (D-35)
      const fora = (v) => dataValida(v) && ![hoje.getFullYear(), hoje.getFullYear() + 1].includes(Number(String(v).slice(0, 4)));
      if (fora(ini)) erros.push({ campo: `etapas.${i}.inicio`, codigo: 'PERIODO' });
      if (fora(e.fim)) erros.push({ campo: `etapas.${i}.fim`, codigo: 'PERIODO' });
      if (!dataValida(ini)) erros.push({ campo: `etapas.${i}.inicio`, codigo: 'DATA' });
      else if (iniAnt && ini < iniAnt) erros.push({ campo: `etapas.${i}.inicio`, codigo: 'ORDEM' });
      if (!dataValida(e.fim)) erros.push({ campo: `etapas.${i}.fim`, codigo: 'DATA' });
      else if (dataValida(ini) && e.fim <= ini) erros.push({ campo: `etapas.${i}.fim`, codigo: 'ORDEM' });
      if (dataValida(ini)) iniAnt = ini;
    });
  }
  if (aba === 'metas') {
    const niveis = d.niveis || base.niveis, unidades = d.unidades || base.unidades, bus = d.bus || base.bus;
    Object.entries(d.metasNivel || {}).forEach(([nivel, lista]) => (lista || []).forEach((m, i) => {
      if (!String(m.titulo || '').trim()) erros.push({ campo: `metas.${nivel}.${i}.titulo`, codigo: 'OBRIGATORIO' });
      Object.values(m.pesos || {}).forEach((p) => { if (!(Number(p) >= 0 && Number(p) <= 1000)) erros.push({ campo: `metas.${nivel}.${i}.pesos`, codigo: 'PESO' }); });
    }));
    somaPesosPorNivel(d.metasNivel, niveis, unidades, bus).filter((x) => x.soma !== x.total)
      .forEach((x) => erros.push({ campo: 'pesos', codigo: 'RN16', aviso: x.soma < x.total, nivel: x.nivel, unidade: x.unidade, soma: x.soma, total: x.total })); // abaixo do total é aviso (grava parcial); acima do total bloqueia
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
  // Exceções e considerações: texto por site (não editável pela BU) e se aparece no Goal Card
  if (aba === 'excecoes') {
    // Texto por site (só sites do cadastro): até MAX_EXCECAO caracteres e se aparece no Goal Card
    Object.entries(d.bus || {}).forEach(([sigla, v]) => {
      if (!base.bus.some((b) => b.sigla === sigla) || !v || typeof v.ver !== 'boolean') erros.push({ campo: `bus.${sigla}`, codigo: 'BU' });
      else if (String(v.texto || '').length > MAX_EXCECAO) erros.push({ campo: `bus.${sigla}.texto`, codigo: 'TAMANHO' });
    });
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

const veTodas = (papeis) => papeis.some((p) => p.papel === 'pci_coo' || p.papel === 'admin');
const ACOES_CICLO = ['fechar', 'reabrir', 'novo'];
// Campos internos da fonte (começam com _) não vão para o navegador
const publico = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith('_')));

/**
 * dados: fonte injetada — criarFonteBanco (aip-goals-banco.js, a do app) ou a de exemplo dos testes
 * (tests/fonte-exemplo.js). Contrato: contexto(email) → { papeis, quem, nome }; painel, desdobramento, goalCard,
 * versoes, actionLog, configuracao (leituras; null = não há ciclo); salvarRascunho, submeter, reabrir, decidir,
 * comentar, salvarConfiguracao, acaoCiclo, registrarNegado (gravações).
 */
function criarAipGoalsRouter({ dados, agora = () => new Date() } = {}) {
  if (!dados || typeof dados.contexto !== 'function') throw new Error('criarAipGoalsRouter: `dados` é obrigatório (fonte do banco ou de exemplo)');
  const router = express.Router();
  const marca = () => ({ exemplo: !!dados.exemplo, desatualizado: false });

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

  router.get('/ping', (req, res) => res.json({ ok: true, fonte: dados.fonte || 'banco' }));

  // Identidade SOMENTE do proxy (AC-01); contexto = papéis do usuário no ciclo atual e a matrícula (RN-12)
  async function contexto(req, res) {
    const email = String(req.get('X-Forwarded-Email') || '').trim().toLowerCase();
    if (!email) { res.status(401).json({ error: 'Usuário não identificado.', codigo: 'SEM_IDENTIDADE' }); return null; }
    const hoje = agora();
    const c = await dados.contexto(email, hoje);
    return { email, hoje, papeis: c.papeis || [], quem: c.quem || null, nome: c.nome || email, idCiclo: c.idCiclo };
  }
  const semCiclo = (res) => res.status(409).json({ error: 'Nenhum ciclo cadastrado. Rode a carga inicial (database/002_pm_carga_inicial.sql).', codigo: 'SEM_CICLO' });
  // Acesso negado vira evento do Action Log (T12); falha ao registrar não muda a resposta
  const negar = (res, ctx, msg, detalhe, codigo = 'SEM_ACESSO') => {
    if (dados.registrarNegado) Promise.resolve().then(() => dados.registrarNegado(ctx, detalhe)).catch((err) => console.error(`${TAG} acesso negado (log):`, err.message));
    return res.status(403).json({ error: msg, codigo });
  };
  // Erro: conflito de estado (409) passa a mensagem; o resto fica só no log
  const falha = (res, rota, err, msg) => {
    if (err && err.status === 409) return res.status(409).json({ error: err.message, codigo: err.codigo || 'ESTADO' });
    console.error(`${TAG} ${rota}:`, err && err.message);
    return res.status(500).json({ error: msg, codigo: 'ERRO' });
  };

  // T00 Início: ciclo atual (etapa, janelas, BUs) e os papéis do usuário para o menu (AC-02)
  router.get('/inicio', async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      const ciclo = await dados.ciclo(ctx.hoje);
      res.json({ ciclo, usuario: { papeis: ctx.papeis, nome: ctx.nome }, atualizadoEm: ctx.hoje.toISOString(), ...marca() });
    } catch (err) { falha(res, '/inicio', err, 'Não foi possível carregar o início.'); }
  });

  router.get('/painel', async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      // O Painel é do grupo P&CI/COO e do administrador (AC-07); demais perfis, 403.
      if (!veTodas(ctx.papeis)) return res.status(403).json({ error: 'Sem acesso a esta tela.', codigo: 'SEM_ACESSO' });
      const base = await dados.painel(ctx.hoje); if (!base) return semCiclo(res);
      const limite = Number(base.parametros.diasParado) || 3;
      const pais = String(req.query.pais || ''), bu = String(req.query.bu || '');
      const paises = [...new Set(base.ciclo.bus.map((b) => b.pais))];
      if (pais && !paises.includes(pais)) return res.status(400).json({ error: 'País inválido.', codigo: 'FILTRO' });
      if (bu && !base.ciclo.bus.some((b) => b.sigla === bu && (!pais || b.pais === pais))) return res.status(400).json({ error: 'BU inválida.', codigo: 'FILTRO' });
      const filtrados = base.cards.filter((c) => (!pais || c.bu.pais === pais) && (!bu || c.bu.sigla === bu));
      const ordem = base.ciclo.bus.filter((b) => (!pais || b.pais === pais) && (!bu || b.sigla === bu));
      res.json({ ciclo: base.ciclo, parametros: { diasParado: limite }, filtro: { pais, bu }, ...agregarPainel(filtrados, ordem, limite, ctx.hoje), atualizadoEm: ctx.hoje.toISOString(), ...marca() });
    } catch (err) { falha(res, '/painel', err, 'Não foi possível carregar o painel.'); }
  });

  router.get('/metas', async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      const base = await dados.painel(ctx.hoje); if (!base) return semCiclo(res);
      // Leitura aberta (AC-05): todas as BUs; sem ?bu=, abre na BU do contribuidor
      const bus = base.ciclo.bus;
      const limite = Number(base.parametros.diasParado) || 3, pesoTotal = Number(base.parametros.pesoTotal) || 100;
      if (!bus.length) return res.json({ ciclo: base.ciclo, bu: null, bus, parametros: { diasParado: limite, pesoTotal }, ...agregarMetas([], pesoTotal, limite, ctx.hoje), atualizadoEm: ctx.hoje.toISOString(), ...marca() });
      const minha = ctx.papeis.find((p) => p.bu && bus.some((b) => b.sigla === p.bu));
      const sigla = String(req.query.bu || (minha ? minha.bu : bus[0].sigla));
      const bu = bus.find((b) => b.sigla === sigla);
      if (!bu) return res.status(404).json({ error: 'Não encontrado.', codigo: 'NAO_ENCONTRADO' });
      const ag = agregarMetas(base.cards.filter((c) => c.bu.sigla === bu.sigla), pesoTotal, limite, ctx.hoje);
      res.json({ ciclo: base.ciclo, bu, bus, parametros: { diasParado: limite, pesoTotal: ag.totais.pesoEsperado }, ...ag, atualizadoEm: ctx.hoje.toISOString(), ...marca() });
    } catch (err) { falha(res, '/metas', err, 'Não foi possível carregar as metas.'); }
  });

  router.get('/desdobramento', async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      const base = await dados.desdobramento(ctx.hoje); if (!base) return semCiclo(res);
      const bus = base.ciclo.bus; // leitura aberta: todas as BUs (AC-05)
      const cards = (await dados.painel(ctx.hoje)).cards.filter((c) => bus.some((b) => b.sigla === c.bu.sigla));
      res.json({ ciclo: base.ciclo, parametros: base.parametros, scorecardCoo: base.scorecardCoo, bus, ...agregarDesdobramento(base, cards, bus), atualizadoEm: ctx.hoje.toISOString(), ...marca() });
    } catch (err) { falha(res, '/desdobramento', err, 'Não foi possível carregar o desdobramento.'); }
  });

  // ── T04 Goal Card ──
  async function lerCard(req, res, hoje) {
    const codigo = String((req.query && req.query.card) || (req.body && req.body.card) || '');
    if (!/^GC-[A-Z]{2,3}-\d{2}$/.test(codigo)) { res.status(400).json({ error: 'Card inválido.', codigo: 'PARAMETRO' }); return null; }
    const card = await dados.goalCard(codigo, hoje);
    if (!card) { res.status(404).json({ error: 'Não encontrado.', codigo: 'NAO_ENCONTRADO' }); return null; }
    return card;
  }

  router.get('/goal-card', async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      const card = await lerCard(req, res, ctx.hoje); if (!card) return; // leitura aberta (AC-07)
      const modo = modoDoCard(card, ctx.papeis);
      res.json({ ...publico(card), modo, obrigatorios: camposObrigatorios(card.secoes), linha: linhaDoCard(card),
        permissoes: { editar: modo === 'edicao', reabrir: ehAdmin(ctx.papeis) && card.estado === 'aprovado' },
        parametros: { minComentario: LIMITE_COMENTARIO }, atualizadoEm: ctx.hoje.toISOString(), ...marca() });
    } catch (err) { falha(res, '/goal-card', err, 'Não foi possível carregar o Goal Card.'); }
  });

  // Rascunho gravado no banco (Salvar rascunho): mesmas permissões da edição
  router.post('/goal-card/rascunho', express.json({ limit: '100kb' }), async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      const card = await lerCard(req, res, ctx.hoje); if (!card) return;
      if (!podeEditar(ctx.papeis, card.bu.sigla)) return negar(res, ctx, 'Sem permissão para editar esta BU.', `tentou salvar o rascunho de ${card.card} sem ser contribuidor da BU`);
      if (!['rascunho', 'em_revisao'].includes(card.estado)) return res.status(409).json({ error: 'O card não está em edição.', codigo: 'ESTADO' });
      const secoes = { ...(req.body.secoes || {}), area: card.secoes.area };
      await dados.salvarRascunho(card, secoes, ctx.quem);
      res.json({ ok: true });
    } catch (err) { falha(res, '/goal-card/rascunho', err, 'Não foi possível salvar o rascunho.'); }
  });

  router.post('/goal-card/submeter', express.json({ limit: '100kb' }), async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      const card = await lerCard(req, res, ctx.hoje); if (!card) return;
      // Escrita: contribuidor da BU, aprovador ou administrador (AC-04, AC-05)
      if (!podeEditar(ctx.papeis, card.bu.sigla)) return negar(res, ctx, 'Sem permissão para editar esta BU.', `tentou submeter ${card.card} sem ser contribuidor da BU`);
      if (!['rascunho', 'em_revisao'].includes(card.estado)) return res.status(409).json({ error: 'O card não está em edição.', codigo: 'ESTADO' });
      // Área responsável não é editável: vale a do cadastro da BU
      const secoes = { ...(req.body.secoes || {}), area: card.secoes.area };
      const pend = camposObrigatorios(secoes).filter((x) => !x.ok).map((x) => x.id);
      if (pend.length) return res.status(400).json({ error: 'Campos obrigatórios sem preencher.', codigo: 'OBRIGATORIOS', pendentes: pend });
      const r = await dados.submeter(card, secoes, ctx);
      res.json({ ok: true, ...r });
    } catch (err) { falha(res, '/goal-card/submeter', err, 'Não foi possível submeter.'); }
  });

  // Reabrir um card aprovado: só o administrador; o card volta para Rascunho
  router.post('/goal-card/reabrir', express.json({ limit: '10kb' }), async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      const card = await lerCard(req, res, ctx.hoje); if (!card) return;
      if (!ehAdmin(ctx.papeis)) return negar(res, ctx, 'Só o administrador reabre um card aprovado.', `tentou reabrir ${card.card} sem ser administrador`);
      if (card.estado !== 'aprovado') return res.status(409).json({ error: 'Só um card aprovado pode ser reaberto.', codigo: 'ESTADO' });
      const r = await dados.reabrir(card, ctx);
      res.json({ ok: true, ...r });
    } catch (err) { falha(res, '/goal-card/reabrir', err, 'Não foi possível reabrir o Goal Card.'); }
  });

  router.post('/goal-card/decisao', express.json({ limit: '100kb' }), async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      const card = await lerCard(req, res, ctx.hoje); if (!card) return;
      if (!ehAprovador(ctx.papeis)) return negar(res, ctx, 'Decisão restrita ao grupo de aprovação.', `tentou decidir ${card.card} sem ser do grupo de aprovação`);
      if (card.estado !== 'em_aprovacao') return res.status(409).json({ error: 'O card não está em aprovação.', codigo: 'ESTADO' });
      if (!podeDecidir(card, ctx.papeis, ctx.quem)) return res.status(403).json({ error: 'Quem editou ou submeteu o card não decide (RN-12).', codigo: 'RN12' });
      const erros = validarDecisao(req.body);
      if (erros.length) return res.status(400).json({ error: 'Decisão incompleta.', codigo: 'VALIDACAO', erros });
      const r = await dados.decidir(card, req.body, ctx);
      res.json({ ok: true, ...r });
    } catch (err) { falha(res, '/goal-card/decisao', err, 'Não foi possível registrar a decisão.'); }
  });

  // Comentário ancorado a uma seção (§7.3, RN-13): feito na T14 pelo grupo de aprovação; não muda o estado do card.
  router.post('/goal-card/comentario', express.json({ limit: '20kb' }), async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      const card = await lerCard(req, res, ctx.hoje); if (!card) return;
      if (!ehAprovador(ctx.papeis)) return negar(res, ctx, 'Comentário restrito ao grupo de aprovação.', `tentou comentar ${card.card} sem ser do grupo de aprovação`);
      const secao = String(req.body.secao || ''), texto = String(req.body.texto || '').trim();
      if (!SECOES_CARD.includes(secao)) return res.status(400).json({ error: 'Seção inválida.', codigo: 'VALIDACAO', erros: ['secao'] });
      if (!texto || texto.length > MAX_COMENTARIO) return res.status(400).json({ error: 'Comentário vazio ou longo demais.', codigo: 'VALIDACAO', erros: ['texto'] });
      const comentario = await dados.comentar(card, secao, texto, ctx);
      res.json({ ok: true, comentario, ...(dados.exemplo ? { simulado: true } : {}) });
    } catch (err) { falha(res, '/goal-card/comentario', err, 'Não foi possível publicar o comentário.'); }
  });

  // T14 Aprovações: fila do grupo de aprovação (AC-08, CA-19). Demais perfis: 403 (a tela mostra a T12).
  router.get('/aprovacoes', async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      if (!ehAprovador(ctx.papeis)) return res.status(403).json({ error: 'Sem acesso a esta tela.', codigo: 'SEM_ACESSO' });
      const base = await dados.painel(ctx.hoje); if (!base) return semCiclo(res);
      const filtro = { pais: String(req.query.pais || ''), bu: String(req.query.bu || ''), idade: IDADES.includes(String(req.query.idade)) ? String(req.query.idade) : 'todas' };
      if (filtro.pais && !base.ciclo.bus.some((b) => b.pais === filtro.pais)) filtro.pais = '';
      if (filtro.bu && !base.ciclo.bus.some((b) => b.sigla === filtro.bu && (!filtro.pais || b.pais === filtro.pais))) filtro.bu = '';
      // Na fila, RN-12 pelo autor da versão em aprovação (a decisão confere todos os editores do card)
      const decide = (c) => podeDecidir({ ...c, editores: c.editores || [] }, ctx.papeis, ctx.quem);
      res.json({ ciclo: base.ciclo, parametros: { diasParado: base.parametros.diasParado, minComentario: LIMITE_COMENTARIO, maxComentario: MAX_COMENTARIO },
        filtro, ...filaAprovacao(base.cards, filtro, ctx.hoje, decide), atualizadoEm: ctx.hoje.toISOString(), ...marca() });
    } catch (err) { falha(res, '/aprovacoes', err, 'Não foi possível carregar a fila de aprovação.'); }
  });

  // T11 Configuração do ciclo: leitura e gravação só do administrador (§7.1); demais perfis, 403 (T12).
  async function exigirAdmin(req, res, registrar) {
    const ctx = await contexto(req, res); if (!ctx) return null;
    if (!ehAdmin(ctx.papeis)) {
      if (registrar) negar(res, ctx, 'Sem acesso a esta tela.', 'tentou alterar a Administração sem ser administrador');
      else res.status(403).json({ error: 'Sem acesso a esta tela.', codigo: 'SEM_ACESSO' });
      return null;
    }
    return ctx;
  }
  router.get('/configuracao', async (req, res) => {
    try {
      const ctx = await exigirAdmin(req, res); if (!ctx) return;
      const base = await dados.configuracao(ctx.hoje); if (!base) return semCiclo(res);
      res.json({ ...publico(base), somas: somaPesosPorNivel(base.metasNivel, base.niveis, base.unidades, base.bus), atualizadoEm: ctx.hoje.toISOString(), ...marca() });
    } catch (err) { falha(res, '/configuracao', err, 'Não foi possível carregar a configuração.'); }
  });
  // Autopreenchimento de pessoas (Novo usuário, diretor da BU): MDM, só o administrador
  router.get('/pessoas', async (req, res) => {
    try {
      const ctx = await exigirAdmin(req, res); if (!ctx) return;
      // ?diretorSite=<site>: diretor(es) do site no MDM (Nova BU preenche sozinha; o administrador pode trocar)
      if (req.query.diretorSite !== undefined) return res.json({ pessoas: dados.diretoresDoSite ? await dados.diretoresDoSite(String(req.query.diretorSite).slice(0, 80)) : [] });
      res.json({ pessoas: dados.buscarPessoas ? await dados.buscarPessoas(String(req.query.q || '').slice(0, 80)) : [] });
    } catch (err) { falha(res, '/pessoas', err, 'Não foi possível buscar as pessoas.'); }
  });
  router.post('/configuracao/salvar', express.json({ limit: '200kb' }), async (req, res) => {
    try {
      const ctx = await exigirAdmin(req, res, true); if (!ctx) return;
      const base = await dados.configuracao(ctx.hoje); if (!base) return semCiclo(res);
      const { aba, dados: d } = req.body || {};
      const erros = validarConfiguracao(aba, d, base, ctx.hoje).filter((e) => !e.aviso); // RN-16: abaixo do total é aviso (salva parcial); acima do total bloqueia
      if (erros.length) return res.status(400).json({ error: 'Configuração com pendências.', codigo: erros.some((e) => e.codigo === 'RN16') ? 'RN16' : 'VALIDACAO', erros });
      const r = await dados.salvarConfiguracao(aba, d, ctx, base);
      if (r && r.erros) return res.status(400).json({ error: 'Configuração com pendências.', codigo: 'VALIDACAO', erros: r.erros });
      res.json({ ok: true, aba, ...(r && r.simulado ? { simulado: true } : {}), evento: { tipo: 'configuracao', quem: ctx.email, quando: ctx.hoje.toISOString() } });
    } catch (err) { falha(res, '/configuracao/salvar', err, 'Não foi possível salvar a configuração.'); }
  });
  // Ciclo: fechar, reabrir ou abrir o próximo (só um aberto por vez)
  router.post('/configuracao/ciclo', express.json({ limit: '10kb' }), async (req, res) => {
    try {
      const ctx = await exigirAdmin(req, res, true); if (!ctx) return;
      const acao = String((req.body || {}).acao || ''), ano = Number((req.body || {}).ano);
      if (!ACOES_CICLO.includes(acao) || ((acao !== 'novo' || (req.body || {}).ano != null) && !(Number.isInteger(ano) && ano >= 2020 && ano <= 2100))) return res.status(400).json({ error: 'Ação inválida.', codigo: 'VALIDACAO' });
      const etapas = (req.body || {}).etapas;
      if (acao === 'novo' && (req.body || {}).ano != null) {
        const erros = validarNovoCiclo(ano, etapas, ctx.hoje);
        if (erros.length) return res.status(400).json({ error: 'Novo ciclo com pendências.', codigo: 'VALIDACAO', erros });
      }
      const r = await dados.acaoCiclo(acao, ano, ctx, etapas);
      res.json({ ok: true, ...r });
    } catch (err) { falha(res, '/configuracao/ciclo', err, 'Não foi possível alterar o ciclo.'); }
  });
  router.post('/configuracao/clonar', express.json({ limit: '10kb' }), async (req, res) => {
    try {
      const ctx = await exigirAdmin(req, res, true); if (!ctx) return;
      const r = await dados.acaoCiclo('novo', null, ctx);
      res.json({ ok: true, ...r });
    } catch (err) { falha(res, '/configuracao/clonar', err, 'Não foi possível criar o novo ciclo.'); }
  });

  // T07 Action Log: paginado (40 por página) ou completo para exportar (tudo=1)
  router.get('/action-log', async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      // Histórico de um card (popup): aberto a todos. Action Log geral: aprovador e administrador.
      if (!req.query.card && !ehAprovador(ctx.papeis)) return res.status(403).json({ error: 'Sem acesso a esta tela.', codigo: 'SEM_ACESSO' });
      const base = await dados.actionLog(ctx.hoje); if (!base) return semCiclo(res);
      const r = filtrarEventos(base.eventos, req.query, ctx.hoje, base.metas, base.bus);
      if (r.erros) return res.status(400).json({ error: 'Filtro inválido.', codigo: 'FILTRO', erros: r.erros });
      const tamanho = 40, total = r.lista.length;
      const pagina = Math.max(1, Math.min(Math.ceil(total / tamanho) || 1, parseInt(req.query.pagina, 10) || 1));
      const eventos = req.query.tudo === '1' ? r.lista : r.lista.slice((pagina - 1) * tamanho, pagina * tamanho);
      res.json({ ciclo: base.ciclo, filtro: r.filtro, eventos, total, pagina, paginas: Math.ceil(total / tamanho) || 1, porTipo: r.porTipo, totalSemTipo: r.totalSemTipo,
        opcoes: { bus: base.bus, metas: base.metas, secoes: SECOES_LOG, tipos: TIPOS_EVENTO }, atualizadoEm: ctx.hoje.toISOString(), ...marca() });
    } catch (err) { falha(res, '/action-log', err, 'Não foi possível carregar o Action Log.'); }
  });

  // T06 Versões (§7.2): leitura aberta; ninguém altera. Rascunho não tem versão (lista vazia).
  router.get('/versoes', async (req, res) => {
    try {
      const ctx = await contexto(req, res); if (!ctx) return;
      const codigo = String(req.query.card || '');
      if (!/^GC-[A-Z]{2,3}-\d{2}$/.test(codigo)) return res.status(400).json({ error: 'Goal Card inválido.', codigo: 'CARD' });
      const v = await dados.versoes(codigo, ctx.hoje);
      if (!v) return res.status(404).json({ error: 'Goal Card não encontrado.', codigo: 'NAO_ENCONTRADO' });
      res.json({ ...publico(v), atualizadoEm: ctx.hoje.toISOString(), ...marca() });
    } catch (err) { falha(res, '/versoes', err, 'Não foi possível carregar as versões.'); }
  });

  return router;
}

module.exports = { validarNovoCiclo, filaAprovacao, IDADES, MAX_COMENTARIO, criarAipGoalsRouter, camposObrigatorios, validarDecisao, modoDoCard, podeDecidir, linhaDoCard, ehAprovador, contribuidorDe, ehAdmin, podeEditar, OBRIGATORIOS, LIMITE_COMENTARIO, agregarPainel, agregarMetas, agregarDesdobramento, diasUteisEntre, ESTADOS, validarConfiguracao, somaPesosPorNivel, unidadesAtivas, ABAS_CONFIG, GRUPOS, dataValida, filtrarEventos, TIPOS_EVENTO, SECOES_LOG, PERIODOS };
