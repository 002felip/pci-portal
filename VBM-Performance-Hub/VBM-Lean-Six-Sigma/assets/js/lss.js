/**
 * VBM Lean Six Sigma — tela (7 páginas do LSS_3.pbix, no design dos dashboards do Portal).
 *
 * Os dados vêm de GET api/dados (lss-api.js: as planilhas de data/). Toda a lógica das medidas
 * DAX do .pbix está aqui, uma função por visual, com o nome da medida de origem no comentário:
 *
 *   Visão geral ........ Card_HTML_* (5 cartões), Grafico_Etapas, Grafico_Projetos_Site(_Concluidos)
 *   Projetos em detalhe  Grafico_Cycle_Site, Card_HTML_Insights, Grid (Grafico_Status_<site>)
 *   Por Business Unit .. Grafico_Status, Matrix_Status_Etapa_HTML, Grafico_Gantt_Projetos, Card_HTML_By_BU_Insights
 *   Timeline e coaching  Grafico_Gantt_Projetos_2
 *   Calendário ......... Calendario_Sessoes_Projetos
 *   Treinamentos ....... Card_HTML_Treinamentos (+ certificação por site: a medida Grafico_Treinamentos
 *                        do layout não existe no modelo do .pbix)
 *   Tabela ............. Tabela_HTML_Projetos
 *
 * Filtros (padrão do COO): Site, Status, Ciclo, Etapa — na URL, para o link poder ser compartilhado.
 * Como no .pbix, o calendário de coaching (Gantt e Calendário) só responde ao Site.
 */
(function () {
  'use strict';
  var S = window.VBMSetup;
  var t = function (k, v) { return S.t(k, v); };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var chave = function (s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  var fmt = function (n, c) { return S.fmt(n || 0, c || 0); };
  var EN = function () { return S.idioma === 'en'; };
  var DIA = 86400000;

  // ═════════════════════════════ textos ═════════════════════════════
  S.registrar({
    'pt-BR': {
      'hero.ante': 'Melhoria contínua · Lean Six Sigma', 'hero.sub': 'Green Belt · portfólio de projetos e coaching',
      'hero.desc': 'Acompanhamento dos projetos Green Belt por site, etapa DMAIC e ciclo, com a timeline de coaching de cada projeto.',
      'hero.projetos': 'Projetos', 'hero.projetosMin': 'projetos', 'hero.site': 'Site', 'hero.atualizado': 'Planilhas: Training Tracker {t} · Coach Manager {c}',
      'f.aria': 'Filtros', 'f.site': 'Site:', 'f.status': 'Status:', 'f.ciclo': 'Ciclo:', 'f.etapa': 'Etapa:', 'f.limpar': 'Restaurar padrão', 'f.todos': 'Todos',
      'fs.on': 'Tela cheia', 'fs.onTitle': 'Tela cheia (F11)', 'fs.off': 'Sair da tela cheia', 'fs.offTitle': 'Sair da tela cheia (Esc)',
      'aba.aria': 'Páginas do dashboard', 'aba.geral': 'Visão geral', 'aba.detalhe': 'Projetos em detalhe', 'aba.bu': 'Por Business Unit',
      'aba.gantt': 'Timeline e coaching', 'aba.calendario': 'Calendário de coaching', 'aba.treinamentos': 'Treinamentos', 'aba.tabela': 'Tabela',
      'aplica.coach': 'Nesta página vale só o filtro de Site (a planilha de coaching não tem status, ciclo nem etapa).',
      'aplica.grade': 'Os cartões por site seguem os filtros de status, ciclo e etapa.',
      'ui.carregando': 'Carregando as planilhas…', 'ui.erro': 'Não foi possível carregar os dados: {m}', 'ui.semDados': 'Sem projetos para os filtros escolhidos.',
      'ui.semCoach': 'Nenhum projeto com calendário de coaching para este site.',
      'st.concluido': 'Concluído', 'st.cancelado': 'Cancelado', 'st.atrasado': 'Atrasado', 'st.andamento': 'Em andamento', 'st.inicio': 'A iniciar', 'st.outro': 'Outro',
      'tile.projetos': 'Quantidade de projetos', 'tile.andamento': 'Projetos em andamento', 'tile.concluidos': 'Projetos concluídos',
      'tile.atrasados': 'Projetos atrasados', 'tile.cancelados': 'Projetos cancelados', 'tile.de': '/ {n} projetos', 'tile.restante': '{p}% restante',
      'tile.pAndamento': 'Em andamento {p}%', 'tile.pAtrasado': 'Atrasados {p}%', 'tile.pConcluido': '{p}% concluído', 'tile.pAtrasadoS': '{p}% atrasado', 'tile.pCancelado': '{p}% cancelado',
      'g.etapas': 'Projetos em andamento por etapa', 'g.etapasSub': 'Distribuição por fase do processo (em andamento e atrasados)',
      'g.sites': 'Projetos em andamento por site', 'g.sitesSub': 'Distribuição por site', 'g.concluidos': 'Projetos concluídos por site',
      'g.noPrazo': 'Dentro do prazo', 'g.atrasado': 'Atrasado', 'etapa.start': 'A iniciar',
      'd.ciclo': 'Distribuição por ciclo e site', 'd.cicloSub': 'Cada cor representa um site', 'd.insights': 'Insights', 'd.mes': 'Mês dos comentários',
      'd.insightsSub': 'Comentários de {m}', 'd.semInsights': 'Sem comentários para este mês.', 'd.insightsMesAtual': ' (mês atual sem comentários)',
      'd.grade': 'Status dos projetos por site', 'd.gradeSub': 'VBM e cada site, nos filtros de status, ciclo e etapa',
      'b.status': 'Distribuição do status do projeto', 'b.statusSub': '{s}', 'b.todos': 'Todos os sites', 'b.matriz': 'Status × etapa',
      'b.matrizSub': 'Quantidade de projetos por status e etapa DMAIC', 'b.gantt': 'Timeline dos projetos', 'b.ganttSub': 'Previsão por projeto, status e sessões de coaching',
      'b.insights': 'Insights da Business Unit',
      't.gantt': 'Timeline dos projetos e aderência ao coaching', 't.ganttSub': 'Progresso real × previsto por projeto, com as sessões de coaching e as etapas DMAIC',
      'gt.projeto': 'Projeto', 'gt.site': 'Site', 'gt.coaching': 'Coaching', 'gt.coachCab': 'Real. · Falta · Prev. · Ader.', 'gt.real': 'Real', 'gt.plan': 'Planejado',
      'gt.falta': 'Falta do belt', 'gt.hoje': 'Hoje', 'gt.agendada': 'Agendada', 'gt.futura': 'Futura',
      'gt.tSite': 'Site', 'gt.tStatus': 'Status', 'gt.tFaseAtual': 'Fase atual (real)', 'gt.tEtapaFalta': 'Etapa atual (1ª falta)', 'gt.tEtapaPrev': 'Etapa prevista (hoje)',
      'gt.tInicio': 'Início', 'gt.tFim': 'Fim planejado', 'gt.tCoaching': 'Coaching', 'gt.naoIniciado': 'Não iniciado', 'gt.concluido': 'Concluído', 'gt.semFaltas': 'Sem faltas',
      'gt.sesReal': 'Sessão {c} ({f}) — realizada em {d}', 'gt.sesReposta': ' — reposta após falta do belt',
      'gt.sesPlan': 'Sessão {n} ({f}) — prevista para {d}', 'gt.sesFalta': 'Falta do belt — sessão {c} ({f}){d}{q} — ainda não reposta', 'gt.faltas': ' ({n} faltas)',
      'c.titulo': 'Calendário de sessões de coaching', 'c.sub': 'Sessões previstas de cada projeto (a cada 15 dias a partir do início), por mês, na cor da etapa',
      'c.projeto': 'Projeto', 'c.sessao': 'Sessão {n} · {f} · {d}',
      'tr.tile': 'Quantidade de treinamentos', 'tr.graf': 'Certificação por site', 'tr.grafSub': 'Green Belts certificados e em treinamento',
      'tr.cert': 'Certificados', 'tr.trein': 'Em treinamento', 'tr.sem': 'Sem classificação',
      'tb.titulo': 'Gestão de projetos', 'tb.sub': '{n} projetos', 'tb.busca': 'Buscar projeto, responsável, site…', 'tb.buscaAria': 'Buscar na tabela',
      'tb.projeto': 'Projeto / Site', 'tb.objetivo': 'Objetivo', 'tb.lider': 'Responsável', 'tb.status': 'Status', 'tb.ciclo': 'Ciclo', 'tb.etapa': 'Etapa',
      'tb.apuracao': 'Apuração (USD)', 'tb.cert': 'Cert.', 'tb.rating': 'Rating', 'tb.trein': 'Treinamento', 'tb.coment': 'Comentários'
    },
    en: {
      'hero.ante': 'Continuous improvement · Lean Six Sigma', 'hero.sub': 'Green Belt · project portfolio and coaching',
      'hero.desc': 'Green Belt projects by site, DMAIC stage and cycle, with the coaching timeline of each project.',
      'hero.projetos': 'Projects', 'hero.projetosMin': 'projects', 'hero.site': 'Site', 'hero.atualizado': 'Spreadsheets: Training Tracker {t} · Coach Manager {c}',
      'f.aria': 'Filters', 'f.site': 'Site:', 'f.status': 'Status:', 'f.ciclo': 'Cycle:', 'f.etapa': 'Stage:', 'f.limpar': 'Reset', 'f.todos': 'All',
      'fs.on': 'Full screen', 'fs.onTitle': 'Full screen (F11)', 'fs.off': 'Exit full screen', 'fs.offTitle': 'Exit full screen (Esc)',
      'aba.aria': 'Dashboard pages', 'aba.geral': 'Overview', 'aba.detalhe': 'Projects in detail', 'aba.bu': 'By Business Unit',
      'aba.gantt': 'Timeline and coaching', 'aba.calendario': 'Coaching calendar', 'aba.treinamentos': 'Trainings', 'aba.tabela': 'Table',
      'aplica.coach': 'Only the Site filter applies here (the coaching spreadsheet has no status, cycle or stage).',
      'aplica.grade': 'The site cards follow the status, cycle and stage filters.',
      'ui.carregando': 'Loading the spreadsheets…', 'ui.erro': 'Could not load the data: {m}', 'ui.semDados': 'No projects for the selected filters.',
      'ui.semCoach': 'No project with a coaching calendar for this site.',
      'st.concluido': 'Completed', 'st.cancelado': 'Cancelled', 'st.atrasado': 'Delayed', 'st.andamento': 'In progress', 'st.inicio': 'To start', 'st.outro': 'Other',
      'tile.projetos': 'Number of projects', 'tile.andamento': 'Ongoing projects', 'tile.concluidos': 'Completed projects',
      'tile.atrasados': 'Overdue projects', 'tile.cancelados': 'Cancelled projects', 'tile.de': '/ {n} projects', 'tile.restante': '{p}% remaining',
      'tile.pAndamento': 'In progress {p}%', 'tile.pAtrasado': 'Delayed {p}%', 'tile.pConcluido': '{p}% completed', 'tile.pAtrasadoS': '{p}% delayed', 'tile.pCancelado': '{p}% cancelled',
      'g.etapas': 'Projects in progress by stage', 'g.etapasSub': 'Distribution by process phase (in progress and delayed)',
      'g.sites': 'Projects in progress by site', 'g.sitesSub': 'Distribution by site', 'g.concluidos': 'Completed projects by site',
      'g.noPrazo': 'On time', 'g.atrasado': 'Delayed', 'etapa.start': 'To start',
      'd.ciclo': 'Distribution by cycle and site', 'd.cicloSub': 'Each color is a site', 'd.insights': 'Insights', 'd.mes': 'Comments month',
      'd.insightsSub': 'Comments for {m}', 'd.semInsights': 'No comments for this month.', 'd.insightsMesAtual': ' (no comments for the current month)',
      'd.grade': 'Project status by site', 'd.gradeSub': 'VBM and each site, within the status, cycle and stage filters',
      'b.status': 'Project status distribution', 'b.statusSub': '{s}', 'b.todos': 'All sites', 'b.matriz': 'Status × stage',
      'b.matrizSub': 'Number of projects by status and DMAIC stage', 'b.gantt': 'Project timeline', 'b.ganttSub': 'Forecast by project, status and coaching sessions',
      'b.insights': 'Business Unit insights',
      't.gantt': 'Project timeline and adherence to coaching', 't.ganttSub': 'Actual vs planned progress by project, with coaching sessions and DMAIC stages',
      'gt.projeto': 'Project', 'gt.site': 'Site', 'gt.coaching': 'Coaching', 'gt.coachCab': 'Act. · Miss. · Plan. · Adh.', 'gt.real': 'Actual', 'gt.plan': 'Planned',
      'gt.falta': 'Belt absence', 'gt.hoje': 'Today', 'gt.agendada': 'Scheduled', 'gt.futura': 'Future',
      'gt.tSite': 'Site', 'gt.tStatus': 'Status', 'gt.tFaseAtual': 'Current stage (actual)', 'gt.tEtapaFalta': 'Current stage (1st absence)', 'gt.tEtapaPrev': 'Expected stage (today)',
      'gt.tInicio': 'Start', 'gt.tFim': 'Planned end', 'gt.tCoaching': 'Coaching', 'gt.naoIniciado': 'Not started', 'gt.concluido': 'Completed', 'gt.semFaltas': 'No absences',
      'gt.sesReal': 'Session {c} ({f}) — completed on {d}', 'gt.sesReposta': ' — rescheduled after belt absence',
      'gt.sesPlan': 'Session {n} ({f}) — planned for {d}', 'gt.sesFalta': 'Belt absence — session {c} ({f}){d}{q} — not yet rescheduled', 'gt.faltas': ' ({n} absences)',
      'c.titulo': 'Coaching sessions calendar', 'c.sub': 'Planned sessions of each project (every 15 days from the start), by month, in the stage color',
      'c.projeto': 'Project', 'c.sessao': 'Session {n} · {f} · {d}',
      'tr.tile': 'Number of trainings', 'tr.graf': 'Certification by site', 'tr.grafSub': 'Certified Green Belts and Green Belts in training',
      'tr.cert': 'Certified', 'tr.trein': 'In training', 'tr.sem': 'Not rated',
      'tb.titulo': 'Project management', 'tb.sub': '{n} projects', 'tb.busca': 'Search project, leader, site…', 'tb.buscaAria': 'Search the table',
      'tb.projeto': 'Project / Site', 'tb.objetivo': 'Objective', 'tb.lider': 'Leader', 'tb.status': 'Status', 'tb.ciclo': 'Cycle', 'tb.etapa': 'Stage',
      'tb.apuracao': 'Final result (USD)', 'tb.cert': 'Cert.', 'tb.rating': 'Rating', 'tb.trein': 'Training', 'tb.coment': 'Comments'
    }
  });

  // ═════════════════════════════ domínio ═════════════════════════════
  // Status do projeto (Status Detail). Ordem das medidas Grafico_Status_*: Completed, Cancelled, Delayed, In Progress, Start.
  var STATUS = ['concluido', 'cancelado', 'atrasado', 'andamento', 'inicio'];
  function statusDe(s) {
    var k = chave(s);
    if (!k) return 'outro';
    if (k.indexOf('delay') >= 0 || k.indexOf('atras') >= 0) return 'atrasado';
    if (k.indexOf('complet') >= 0 || k.indexOf('conclu') >= 0) return 'concluido';
    if (k.indexOf('cancel') >= 0) return 'cancelado';
    if (k.indexOf('progress') >= 0 || k.indexOf('andamento') >= 0) return 'andamento';
    if (k.indexOf('start') >= 0 || k.indexOf('iniciar') >= 0) return 'inicio';
    return 'outro';
  }
  // Etapas DMAIC (coluna Etapa: "1-Define" … "5-Control")
  var ETAPAS = [
    { k: 'S', rot: function () { return t('etapa.start'); }, cor: '--st-inicio' },
    { k: '1', rot: function () { return '1-Define'; }, fase: 'D' }, { k: '2', rot: function () { return '2-Measure'; }, fase: 'M' },
    { k: '3', rot: function () { return '3-Analyze'; }, fase: 'A' }, { k: '4', rot: function () { return '4-Improve'; }, fase: 'I' },
    { k: '5', rot: function () { return '5-Control'; }, fase: 'C' }
  ];
  function etapaDe(e) { var s = chave(e); if (!s) return null; if (/^[1-5]/.test(s)) return s[0]; if (s.indexOf('start') >= 0) return 'S'; return 'X:' + s; }
  // Fases das sessões de coaching (Gantt e calendário)
  var FASES = { D: 'Define', M: 'Measure', A: 'Analyze', I: 'Improve', C: 'Control', F: 'Final' };
  // Modelos de sessões (Grafico_Gantt_Projetos_2): 15 sessões e 8 sessões, a cada 15 dias
  var MODELOS = {
    15: [['D', 1], ['D', 2], ['M', 1], ['M', 2], ['M', 3], ['M', 4], ['A', 1], ['A', 2], ['A', 3], ['A', 4], ['I', 1], ['I', 2], ['C', 1], ['C', 2], ['F', 1]],
    8: [['D', 1], ['M', 1], ['M', 2], ['A', 1], ['A', 2], ['I', 1], ['C', 1], ['F', 1]]
  };
  function sessoesDoModelo(m) { return MODELOS[m].map(function (s, i) { return { n: i + 1, sigla: s[0], ordem: s[1], fase: FASES[s[0]], offset: (i + 1) * 15 }; }); }
  // Sites: ordem e cores do Grafico_Cycle_Site (ajustadas à paleta do Portal)
  var ORDEM_SITES = ["Voisey's Bay", 'Long Harbour', 'Salobo', 'Onca Puma', 'Clydach', 'Sossego', 'Ontario', 'Asset Management', 'VNL Commercial'];
  var COR_SITE = {
    light: { "voisey's bay": '#c3ccd6', 'long harbour': '#0d2640', salobo: '#3cb5e5', 'onca puma': '#9ddaf2', clydach: '#6f7d90', sossego: '#00897a', ontario: '#1a6ea8', 'asset management': '#e0a43a', 'vnl commercial': '#b4535e' },
    dark: { "voisey's bay": '#8a96a6', 'long harbour': '#e8eef5', salobo: '#3cb5e5', 'onca puma': '#9ddaf2', clydach: '#4f5d70', sossego: '#34c3b8', ontario: '#4a90d9', 'asset management': '#f0b44c', 'vnl commercial': '#e58b95' }
  };
  function corSite(s) { var m = COR_SITE[S.tema === 'dark' ? 'dark' : 'light']; return m[chave(s)] || (S.tema === 'dark' ? '#6f8aa0' : '#aec6d4'); }
  function ordemSite(s) { var i = ORDEM_SITES.map(chave).indexOf(chave(s)); return i < 0 ? 99 : i; }
  // Nomes de BU/unidade que aparecem nas planilhas de coaching e de comentários → site do Portfolio
  var APELIDOS = { lh: 'long harbour', cnr: 'clydach', corporate: 'asset management', 'onça puma': 'onca puma' };
  function siteChave(s) { var k = chave(s); return APELIDOS[k] || k; }

  function cssVar(nome) { return getComputedStyle($('lss')).getPropertyValue(nome).trim(); }
  function corStatus(k) { return 'var(--st-' + (STATUS.indexOf(k) >= 0 ? k : 'cancelado') + ')'; }
  function corFase(sigla) { return 'var(--fx-' + sigla + ')'; }
  function tintaFase(sigla) { return 'var(--fx-' + sigla + '-ink)'; }

  // Datas (ISO 'AAAA-MM-DD' ↔ dias)
  function dIso(s) { return s ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null; }
  function hojeUtc() { var d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dTxt(ms) { if (ms == null) return '—'; var d = new Date(ms); return d.toLocaleDateString(EN() ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }); }
  function mesTxt(ms, ano) {
    var d = new Date(ms), m = d.toLocaleDateString(EN() ? 'en-US' : 'pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
    return ano ? m + '/' + String(d.getUTCFullYear()).slice(2) : m;
  }
  function mesLongo(iso) { var d = new Date(dIso(iso)); return d.toLocaleDateString(EN() ? 'en-US' : 'pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  function inicioMes(ms) { var d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
  function addMeses(ms, n) { var d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1); }

  // ═════════════════════════════ estado ═════════════════════════════
  var ABAS = ['geral', 'detalhe', 'bu', 'gantt', 'calendario', 'treinamentos', 'tabela'];
  var SO_SITE = { gantt: true, calendario: true };
  var st = { dados: null, erro: null, aba: 'geral', f: { site: null, status: null, ciclo: null, etapa: null }, mesG: null, mesB: null, busca: '', ordem: { col: null, dir: 1 } };

  function lerUrl() {
    var q = new URLSearchParams(location.search);
    if (ABAS.indexOf(q.get('aba')) >= 0) st.aba = q.get('aba');
    ['site', 'status', 'ciclo', 'etapa'].forEach(function (k) { if (q.get(k)) st.f[k] = q.get(k); });
  }
  function gravarUrl() {
    var q = new URLSearchParams();
    if (st.aba !== 'geral') q.set('aba', st.aba);
    ['site', 'status', 'ciclo', 'etapa'].forEach(function (k) { if (st.f[k]) q.set(k, st.f[k]); });
    var s = q.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '')); } catch (e) { /* sem history */ }
  }

  // Projetos nos filtros (ignorar: lista de filtros que não valem para o visual)
  function projetos(ignorar) {
    ignorar = ignorar || [];
    return (st.dados ? st.dados.projetos : []).filter(function (p) {
      if (st.f.site && ignorar.indexOf('site') < 0 && chave(p.site) !== chave(st.f.site)) return false;
      if (st.f.status && ignorar.indexOf('status') < 0 && p.statusDetalhe !== st.f.status) return false;
      if (st.f.ciclo && ignorar.indexOf('ciclo') < 0 && p.ciclo !== st.f.ciclo) return false;
      if (st.f.etapa && ignorar.indexOf('etapa') < 0 && p.etapa !== st.f.etapa) return false;
      return true;
    });
  }
  function contar(lista, fn) { return lista.reduce(function (n, p) { return n + (fn(p) ? 1 : 0); }, 0); }
  function porStatus(lista, k) { return contar(lista, function (p) { return statusDe(p.statusDetalhe) === k; }); }
  function unicos(lista, campo) { var s = []; lista.forEach(function (p) { if (p[campo] != null && s.indexOf(p[campo]) < 0) s.push(p[campo]); }); return s; }
  function anoDoCiclo(c) { var m = /(20\d\d)/.exec(c || ''); return m ? +m[1] : 9999; }
  function rotuloCiclo(c) { return String(c || '').replace(/cycle/i, '').trim() || c; }

  // ═════════════════════════════ filtros ═════════════════════════════
  var popAberto = null;
  function opcoesDoFiltro(k) {
    var todos = st.dados ? st.dados.projetos : [];
    var campo = { site: 'site', status: 'statusDetalhe', ciclo: 'ciclo', etapa: 'etapa' }[k];
    var vals = unicos(todos, campo);
    if (k === 'site') vals.sort(function (a, b) { return ordemSite(a) - ordemSite(b) || a.localeCompare(b); });
    else if (k === 'status') vals.sort(function (a, b) { return STATUS.indexOf(statusDe(a)) - STATUS.indexOf(statusDe(b)); });
    else if (k === 'ciclo') vals.sort(function (a, b) { return anoDoCiclo(a) - anoDoCiclo(b); });
    else vals.sort();
    return vals.map(function (v) { return { v: v, n: contar(todos, function (p) { return p[campo] === v; }) }; });
  }
  function rotuloValor(k, v) { return k === 'status' ? t('st.' + statusDe(v)) + (statusDe(v) === 'atrasado' && /20\d\d/.test(v) ? ' (' + /20\d\d/.exec(v)[0] + ')' : '') : v; }
  function desenharFiltros() {
    document.querySelectorAll('#lss [data-filtro]').forEach(function (el) {
      var k = el.getAttribute('data-filtro');
      el.hidden = SO_SITE[st.aba] && k !== 'site';
      el.querySelector('[data-valor]').textContent = st.f[k] ? rotuloValor(k, st.f[k]) : t('f.todos');
      el.querySelector('.unit-list').innerHTML = '<button type="button" data-v="" aria-pressed="' + !st.f[k] + '"><span>' + esc(t('f.todos')) + '</span></button>' +
        opcoesDoFiltro(k).map(function (o) {
          return '<button type="button" data-v="' + esc(o.v) + '" aria-pressed="' + (st.f[k] === o.v) + '"><span>' + esc(rotuloValor(k, o.v)) + '</span><span class="n">' + o.n + '</span></button>';
        }).join('');
    });
    $('lssLimpar').disabled = !st.f.site && !st.f.status && !st.f.ciclo && !st.f.etapa;
  }
  function abrirPop(el) {
    var pop = el.querySelector('.unit-pop'), gat = el.querySelector('.unit-trigger');
    if (popAberto && popAberto !== el) fecharPop(false);
    if (!pop.hidden) { fecharPop(true); return; }
    pop.hidden = false; gat.setAttribute('aria-expanded', 'true'); popAberto = el;
    var foco = pop.querySelector('[aria-pressed="true"]') || pop.querySelector('button'); if (foco) foco.focus();
  }
  function fecharPop(focar) {
    if (!popAberto) return;
    popAberto.querySelector('.unit-pop').hidden = true;
    var gat = popAberto.querySelector('.unit-trigger'); gat.setAttribute('aria-expanded', 'false');
    if (focar) gat.focus();
    popAberto = null;
  }

  // ═════════════════════════════ componentes ═════════════════════════════
  function vazio(msg) { return '<div class="dsc-vazio">' + esc(msg) + '</div>'; }
  function legenda(itens) {
    return itens.map(function (i) { return '<span><i class="lg-faixa' + (i.hachura ? ' hachura' : '') + '" style="--c:' + i.c + '"></i>' + esc(i.nome) + '</span>'; }).join('');
  }
  /** Colunas simples ou empilhadas, ajustadas à largura do card (sem rolagem lateral).
   *  cols: [{ rot, segs: [{ v, c, nome, hachura }] }] */
  function colunas(alvo, cols, op) {
    op = op || {};
    if (!cols.length) { alvo.innerHTML = vazio(t('ui.semDados')); return; }
    var max = Math.max.apply(null, cols.map(function (c) { return c.segs.reduce(function (s, x) { return s + (x.v || 0); }, 0); })) || 1;
    var larg = Math.max(alvo.clientWidth, 160), porCol = larg / cols.length;
    var gap = Math.round(Math.max(4, Math.min(16, porCol * .16)));
    var eixo2 = porCol < 66 && !op.semX;
    var cls = 'lc' + (eixo2 ? ' lc-eixo2' : '') + (porCol < 22 ? ' lc-sem-valor' : '');
    alvo.innerHTML = '<div class="' + cls + '" style="--gap:' + gap + 'px;--area-h:' + (op.altura || 210) + 'px' + (op.colMax ? ';--col-max:' + op.colMax + 'px' : '') + (op.semX ? ';padding-bottom:6px' : '') + '"><div class="lc-area">' +
      cols.map(function (c) {
        var tot = c.segs.reduce(function (s, x) { return s + (x.v || 0); }, 0);
        var h = tot / max * 100, alturaPx = (op.altura || 210) * tot / max;
        var dica = c.rot + ': ' + fmt(tot) + (c.segs.length > 1 ? ' (' + c.segs.filter(function (x) { return x.v; }).map(function (x) { return x.nome + ' ' + fmt(x.v); }).join(', ') + ')' : '');
        var nSegs = c.segs.filter(function (x) { return x.v > 0; }).length;
        var segs = c.segs.filter(function (x) { return x.v > 0; }).map(function (x) {
          var px = alturaPx * x.v / (tot || 1);
          return '<div class="lc-seg' + (x.hachura ? ' hachura' : '') + '" style="--p:' + (x.v / (tot || 1) * 100) + '%;--c:' + x.c + '">' + (nSegs > 1 && px >= 16 ? fmt(x.v) : '') + '</div>';
        }).join('');
        return '<div class="lc-col" title="' + esc(dica) + '" role="img" aria-label="' + esc(dica) + '"><div class="lc-pilha" style="--h:' + h + '%">' + segs + '</div>' +
          (tot > 0 || op.zeros ? '<div class="lc-v" style="--h:' + h + '%">' + fmt(tot) + '</div>' : '') +
          (op.semX ? '' : '<div class="lc-x">' + esc(c.rot) + '</div>') + '</div>';
      }).join('') + '</div></div>';
  }

  // ── Visão geral: Card_HTML_Projetos / _IN_Progress / _Concluidos / _Atrasados / _Cancelados ──
  var ICONES = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 5-5"/></svg>',
    and: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    atr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M12 12v3M12 17.5h.01"/></svg>',
    can: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
    proj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'
  };
  var pctR = function (a, b) { return b ? Math.round(a / b * 100) : 0; };
  function tile(o) {
    return '<div class="dsc-tile' + (o.total ? ' dsc-tile-total' : '') + '" style="--c:' + (o.c || 'var(--vbm-blue)') + '">' +
      '<div class="t-head"><span class="lss-tile-ico">' + o.ico + '</span>' + esc(o.rot) + '</div>' +
      '<div class="t-num">' + fmt(o.v) + (o.de != null ? '<small>' + esc(t('tile.de', { n: fmt(o.de) })) + '</small>' : '') + '</div>' +
      (o.barras ? '<div class="t-foot"><div class="lss-barra">' + o.barras.map(function (b) { return '<span style="--w:' + b.p + '%;--c:' + b.c + '"></span>'; }).join('') + '</div>' +
        '<div class="lss-barra-leg">' + o.legenda + '</div></div>' : '') + '</div>';
  }
  function desenharGeral() {
    var ps = projetos();
    var total = contar(ps, function (p) { return p.projeto; });
    var nAnd = porStatus(ps, 'andamento'), nAtr = porStatus(ps, 'atrasado'), nCon = porStatus(ps, 'concluido'), nCan = porStatus(ps, 'cancelado');
    // Card_HTML_IN_Progress: em andamento = In progress + Delayed; barra dividida
    var pTot = pctR(nAnd + nAtr, total), pAnd = pctR(nAnd, total), pAtr = Math.max(pTot - pAnd, 0);
    var umPct = function (n, cor, chaveTxt) {
      var p = pctR(n, total);
      return { barras: [{ p: p, c: cor }], legenda: '<span><b style="--c:' + cor + '">' + esc(t(chaveTxt, { p: p })) + '</b></span><span>' + esc(t('tile.restante', { p: 100 - p })) + '</span>' };
    };
    var con = umPct(nCon, 'var(--st-concluido)', 'tile.pConcluido'), atr = umPct(nAtr, 'var(--st-atrasado)', 'tile.pAtrasadoS'), can = umPct(nCan, 'var(--st-cancelado)', 'tile.pCancelado');
    $('lssTiles').innerHTML =
      tile({ rot: t('tile.projetos'), v: total, ico: ICONES.proj, total: true }) +
      tile({ rot: t('tile.andamento'), v: nAnd + nAtr, de: total, ico: ICONES.and, c: 'var(--st-andamento)',
        barras: [{ p: pAnd, c: 'var(--st-andamento)' }, { p: pAtr, c: 'var(--st-atrasado)' }],
        legenda: '<span><b style="--c:var(--st-andamento)">' + esc(t('tile.pAndamento', { p: pAnd })) + '</b></span><span><b style="--c:var(--st-atrasado)">' + esc(t('tile.pAtrasado', { p: pAtr })) + '</b></span><span>' + esc(t('tile.restante', { p: 100 - pAnd - pAtr })) + '</span>' }) +
      tile({ rot: t('tile.concluidos'), v: nCon, de: total, ico: ICONES.ok, c: 'var(--st-concluido)', barras: con.barras, legenda: con.legenda }) +
      tile({ rot: t('tile.atrasados'), v: nAtr, de: total, ico: ICONES.atr, c: 'var(--st-atrasado)', barras: atr.barras, legenda: atr.legenda }) +
      tile({ rot: t('tile.cancelados'), v: nCan, de: total, ico: ICONES.can, c: 'var(--st-cancelado)', barras: can.barras, legenda: can.legenda });

    // Grafico_Etapas: em andamento (In progress + Delayed) por etapa, eixo fixo Start … 5-Control
    var ativos = ps.filter(function (p) { var k = statusDe(p.statusDetalhe); return k === 'andamento' || k === 'atrasado'; });
    colunas($('gEtapas'), ETAPAS.map(function (e) {
      var n = contar(ativos, function (p) { return etapaDe(p.etapa) === e.k; });
      return { rot: e.rot(), segs: [{ v: n, c: e.fase ? corFase(e.fase) : 'var(--st-inicio)', nome: e.rot(), hachura: !e.fase }] };
    }), { zeros: true });

    // Grafico_Projetos_Site: por site do filtro, Dentro do prazo (In progress) + Atrasado (Delayed 2025)
    var sites = unicos(ps, 'site').sort(function (a, b) { return ordemSite(a) - ordemSite(b) || a.localeCompare(b); });
    $('gSitesLeg').innerHTML = legenda([{ nome: t('g.noPrazo'), c: 'var(--st-andamento)' }, { nome: t('g.atrasado'), c: 'var(--st-atrasado)' }]);
    colunas($('gSites'), sites.map(function (s) {
      var doSite = ps.filter(function (p) { return p.site === s; });
      return { rot: s, segs: [{ v: porStatus(doSite, 'andamento'), c: 'var(--st-andamento)', nome: t('g.noPrazo') }, { v: porStatus(doSite, 'atrasado'), c: 'var(--st-atrasado)', nome: t('g.atrasado') }] };
    }));
    // Grafico_Projetos_Site_Concluidos
    colunas($('gConcluidos'), sites.map(function (s) {
      return { rot: s, segs: [{ v: porStatus(ps.filter(function (p) { return p.site === s; }), 'concluido'), c: 'var(--st-concluido)', nome: t('st.concluido') }] };
    }));
  }

  // ── Insights (Card_HTML_Insights / Card_HTML_By_BU_Insights): o .pbix mostra o mês de hoje; aqui o mês
  //    mais recente com comentários (o de hoje, quando houver), com a escolha dos meses anteriores ──
  function mesesDe(lista) { var m = unicos(lista, 'mes').sort(); return m.reverse(); }
  function mesPadrao(meses) {
    var hoje = new Date(), atual = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-01';
    if (meses.indexOf(atual) >= 0) return atual;
    return meses.filter(function (m) { return m <= atual; })[0] || meses[0] || null;
  }
  function desenharMeses(alvo, meses, atual) {
    alvo.innerHTML = meses.slice(0, 6).map(function (m) {
      return '<button type="button" data-mes="' + m + '" aria-pressed="' + (m === atual) + '">' + esc(mesTxt(dIso(m), true)) + '</button>';
    }).join('');
    alvo.hidden = meses.length < 2;
  }
  function itensInsight(lista) {
    if (!lista.length) return vazio(t('d.semInsights'));
    return '<div class="lss-insights-rolagem"><ol class="lss-insights">' + lista.map(function (c, i) {
      return '<li><b>' + (i + 1) + '</b><span>' + esc(c.txt) + (c.bu ? '<em>' + esc(c.bu) + '</em>' : '') + '</span></li>';
    }).join('') + '</ol></div>';
  }
  function subInsight(mes) {
    var hoje = new Date(), atual = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-01';
    return mes ? t('d.insightsSub', { m: mesLongo(mes) }) + (mes !== atual ? t('d.insightsMesAtual') : '') : '';
  }

  // ── Projetos em detalhe ──
  function desenharDetalhe() {
    var ps = projetos();
    // Grafico_Cycle_Site: colunas por ciclo, empilhadas por site
    var ciclos = unicos(ps, 'ciclo').sort(function (a, b) { return anoDoCiclo(a) - anoDoCiclo(b); });
    var sites = unicos(ps, 'site').sort(function (a, b) { return ordemSite(a) - ordemSite(b) || a.localeCompare(b); });
    $('dCicloLeg').innerHTML = legenda(sites.map(function (s) { return { nome: s, c: corSite(s) }; }));
    colunas($('dCiclo'), ciclos.map(function (c) {
      return { rot: rotuloCiclo(c), segs: sites.map(function (s) { return { v: contar(ps, function (p) { return p.ciclo === c && p.site === s; }), c: corSite(s), nome: s }; }) };
    }), { altura: 220, colMax: 96 });

    // Card_HTML_Insights (comentário geral do mês, PT ou EN; numerados em ordem alfabética do texto em PT)
    var cg = st.dados.comentariosGerais, meses = mesesDe(cg);
    if (!st.mesG || meses.indexOf(st.mesG) < 0) st.mesG = mesPadrao(meses);
    desenharMeses($('dInsightsMes'), meses, st.mesG);
    $('dInsightsSub').textContent = subInsight(st.mesG);
    $('dInsights').innerHTML = itensInsight(cg.filter(function (c) { return c.mes === st.mesG; })
      .sort(function (a, b) { return String(a.pt || '').localeCompare(String(b.pt || '')); })
      .map(function (c) { return { txt: (EN() ? c.en : c.pt) || c.pt || c.en }; }));

    // Grid: VBM + um minigráfico por site (Grafico_Status_<site>), sem o filtro de site
    var base = projetos(['site']);
    var GRADE = [
      { rot: 'VBM', total: true, f: function () { return true; } },
      { rot: 'Salobo', s: ['salobo'] }, { rot: 'Sossego', s: ['sossego'] }, { rot: 'Onça Puma', s: ['onca puma'] },
      { rot: "Voisey's Bay", s: ["voisey's bay"] }, { rot: 'Long Harbour', s: ['long harbour'] }, { rot: 'Clydach', s: ['clydach'] },
      { rot: 'Ontario', s: ['ontario'] }, { rot: 'Corporate', s: ['corporate', 'asset management'] }
    ];
    $('dGradeLeg').innerHTML = legenda(STATUS.map(function (k) { return { nome: t('st.' + k), c: corStatus(k), hachura: k === 'inicio' }; }));
    $('dGrade').innerHTML = '<div class="lss-multi">' + GRADE.map(function (g, i) {
      var doSite = g.total ? base : base.filter(function (p) { return g.s.indexOf(chave(p.site)) >= 0; });
      return '<div class="lss-mini' + (g.total ? ' total' : '') + '"><h4>' + esc(g.rot) + '<small>' + fmt(doSite.length) + '</small></h4><div id="dMini' + i + '"></div></div>';
    }).join('') + '</div>';
    GRADE.forEach(function (g, i) {
      var doSite = g.total ? base : base.filter(function (p) { return g.s.indexOf(chave(p.site)) >= 0; });
      colunas($('dMini' + i), STATUS.map(function (k) { return { rot: t('st.' + k), segs: [{ v: porStatus(doSite, k), c: corStatus(k), nome: t('st.' + k), hachura: k === 'inicio' }] }; }), { altura: 92, semX: true, zeros: true });
    });
  }

  // ── Por Business Unit ──
  function desenharBU() {
    var ps = projetos();
    $('bStatusSub').textContent = t('b.statusSub', { s: st.f.site || t('b.todos') });
    // Grafico_Status: projetos por Status Detail (os que existem no filtro)
    var presentes = STATUS.filter(function (k) { return porStatus(ps, k) > 0; });
    colunas($('bStatus'), presentes.map(function (k) { return { rot: t('st.' + k), segs: [{ v: porStatus(ps, k), c: corStatus(k), nome: t('st.' + k), hachura: k === 'inicio' }] }; }), { altura: 220, colMax: 90 });

    // Matrix_Status_Etapa_HTML: linhas = todos os status da base (sem filtro), colunas = etapas fixas
    var todosStatus = STATUS.filter(function (k) { return porStatus(st.dados.projetos, k) > 0; });
    var COLS = [
      { rot: t('etapa.start'), f: function (e) { return chave(e).indexOf('start') >= 0; } },
      { rot: 'D', f: function (e) { return /^1/.test(chave(e)); } }, { rot: 'M', f: function (e) { return /^2/.test(chave(e)); } },
      { rot: 'A', f: function (e) { return /^3/.test(chave(e)); } }, { rot: 'I', f: function (e) { return /^4/.test(chave(e)); } },
      { rot: 'C', f: function (e) { return /^5/.test(chave(e)); } }, { rot: 'FP&A', f: function (e) { return chave(e) === 'fp&a'; } },
      { rot: 'Certification', f: function (e) { return chave(e).indexOf('certif') >= 0; } }, { rot: 'Monitoring', f: function (e) { return chave(e).indexOf('monitor') >= 0; } }
    ];
    var valores = todosStatus.map(function (k) { return COLS.map(function (c) { return contar(ps, function (p) { return statusDe(p.statusDetalhe) === k && c.f(p.etapa); }); }); });
    var max = Math.max.apply(null, [1].concat([].concat.apply([], valores)));
    $('bMatriz').innerHTML = '<thead><tr><th></th>' + COLS.map(function (c) { return '<th>' + esc(c.rot) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      todosStatus.map(function (k, i) {
        return '<tr><td class="rot" style="--c:' + corStatus(k) + '"><i></i>' + esc(t('st.' + k)) + '</td>' + valores[i].map(function (v) {
          return '<td class="' + (v ? 'cheia' : '') + '" style="--c:' + corStatus(k) + ';--i:' + (v / max).toFixed(3) + '">' + (v ? fmt(v) : '') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody>';

    // Grafico_Gantt_Projetos (filtrado pelo site)
    gantt($('bGantt'), $('bGanttLeg'), true);

    // Card_HTML_By_BU_Insights: comentários da BU do filtro (ou de todas), no mês escolhido
    var cb = st.dados.comentariosBU, meses = mesesDe(cb);
    if (!st.mesB || meses.indexOf(st.mesB) < 0) st.mesB = mesPadrao(meses);
    desenharMeses($('bInsightsMes'), meses, st.mesB);
    $('bInsightsSub').textContent = subInsight(st.mesB);
    $('bInsights').innerHTML = itensInsight(cb.filter(function (c) { return c.mes === st.mesB && (!st.f.site || siteChave(c.bu) === chave(st.f.site)); })
      .sort(function (a, b) { return String(a.texto).localeCompare(String(b.texto)); })
      .map(function (c) { return { txt: c.texto, bu: st.f.site ? null : c.bu }; }));
  }

  // ═══════════════ Gantt (Grafico_Gantt_Projetos_2), padrão novo ═══════════════
  var GT = []; // linhas do último Gantt desenhado (dica)
  function linhasDoGantt() {
    var hoje = hojeUtc();
    var cal = st.dados.calendario.filter(function (c) { return !st.f.site || siteChave(c.unidade) === chave(st.f.site); });
    // Historico: só "Realizada" e "Belt faltou"
    var hist = st.dados.historico.filter(function (h) { var r = chave(h.resultado); return r.indexOf('belt faltou') >= 0 || r.indexOf('realizad') >= 0; });
    var linhas = cal.map(function (c) {
      var modelo = Math.round(c.previstas || 0) === 8 ? 8 : 15;
      var ini = dIso(c.inicio), fim = dIso(c.conclusaoPrevista);
      if (ini != null && fim == null) fim = ini + (modelo === 8 ? 150 : 255) * DIA;
      if (!c.projeto || ini == null || fim == null) return null;
      var ses = sessoesDoModelo(modelo);
      var sk = chave(c.statusDetalhe);
      var ordem = sk.indexOf('delay') >= 0 ? 1 : sk.indexOf('start') >= 0 ? 2 : 3;
      var stk = statusDe(c.statusDetalhe);
      // Sessões do Historico mapeadas para o número da sessão do modelo (ex.: M4 num projeto de 8 → última de Measure)
      var mapeadas = hist.filter(function (h) { return chave(h.projeto) === chave(c.projeto); }).map(function (h) {
        var s = String(h.sessao || '').toUpperCase().trim(), f = chave(h.fase), sig;
        if (s) sig = s[0];
        else sig = f.indexOf('def') >= 0 ? 'D' : (f.indexOf('meas') >= 0 || f.indexOf('med') >= 0) ? 'M' : f.indexOf('anal') >= 0 ? 'A' : (f.indexOf('impr') >= 0 || f.indexOf('melh') >= 0) ? 'I' : f.indexOf('contr') >= 0 ? 'C' : f.indexOf('fin') >= 0 ? 'F' : '';
        var ord = parseInt(s.slice(1, 4), 10); if (!(ord >= 1)) ord = 1;
        var exato = ses.filter(function (x) { return x.sigla === sig && x.ordem === ord; })[0];
        var ultima = ses.filter(function (x) { return x.sigla === sig; }).pop();
        var num = (exato || ultima || {}).n;
        return num ? { n: num, tipo: chave(h.resultado).indexOf('belt faltou') >= 0 ? 'F' : 'R', data: dIso(h.data) } : null;
      }).filter(Boolean);
      var realHist = mapeadas.filter(function (m) { return m.tipo === 'R'; }), faltas = mapeadas.filter(function (m) { return m.tipo === 'F'; });
      // Sem nenhuma "Realizada" no Historico: as N primeiras sessões (N = Sessões Realizadas)
      var setReal = realHist.length ? realHist.map(function (m) { return m.n; }) : ses.filter(function (x) { return x.n <= (c.realizadas || 0); }).map(function (x) { return x.n; });
      setReal = setReal.filter(function (n, i, a) { return a.indexOf(n) === i; });
      var setFalta = faltas.map(function (m) { return m.n; });
      var maxReal = setReal.length ? Math.max.apply(null, setReal) : null;
      var faseAtual = maxReal ? ses[maxReal - 1].fase : t('gt.naoIniciado');
      var primFalta = faltas.length ? Math.min.apply(null, setFalta) : null;
      // Etapas planejadas: entregas da planilha ou início + 15 dias por sessão
      var lim = modelo === 8 ? { D: 1, M: 3, A: 5, I: 6, C: 7 } : { D: 2, M: 6, A: 10, I: 12, C: 14 };
      var ent = {
        D: dIso(c.entregaDefinir) || ini + lim.D * 15 * DIA, M: dIso(c.entregaMedir) || ini + lim.M * 15 * DIA,
        A: dIso(c.entregaAnalisar) || ini + lim.A * 15 * DIA, I: dIso(c.entregaMelhorar) || ini + lim.I * 15 * DIA,
        C: dIso(c.entregaControlar) || ini + lim.C * 15 * DIA
      };
      var fases = [
        { s: 'D', sessIni: 0, ini: ini, fim: ent.D }, { s: 'M', sessIni: lim.D, ini: ent.D, fim: ent.M },
        { s: 'A', sessIni: lim.M, ini: ent.M, fim: ent.A }, { s: 'I', sessIni: lim.A, ini: ent.A, fim: ent.I },
        { s: 'C', sessIni: lim.I, ini: ent.I, fim: ent.C }, { s: 'F', sessIni: lim.C, ini: ent.C, fim: fim }
      ];
      var prevHoje = fases.filter(function (f) { return f.ini <= hoje; }).sort(function (a, b) { return b.sessIni - a.sessIni; })[0];
      var etapaPrev = hoje < ini ? { txt: t('gt.naoIniciado'), c: 'var(--st-inicio)' } : hoje > fim ? { txt: t('gt.concluido'), c: 'var(--st-inicio)' }
        : { txt: FASES[(prevHoje || { s: 'D' }).s], c: corFase((prevHoje || { s: 'D' }).s) };
      return {
        c: c, ordem: ordem, ini: ini, fim: fim, modelo: modelo, ses: ses, setReal: setReal, setFalta: setFalta, faltas: faltas, realHist: realHist,
        maxReal: maxReal, faseAtual: faseAtual, primFalta: primFalta, fases: fases, etapaPrev: etapaPrev,
        cor: stk === 'atrasado' ? 'var(--st-atrasado)' : stk === 'inicio' ? 'var(--st-inicio)' : stk === 'andamento' ? 'var(--st-andamento)' : stk === 'concluido' ? 'var(--st-concluido)' : stk === 'cancelado' ? 'var(--st-cancelado)' : 'var(--vbm-blue)',
        coach: [c.realizadas || 0, c.faltas || 0, c.previstas || 0, Math.round((c.aderenciaAcumulada || 0) * 100)]
      };
    }).filter(Boolean);
    linhas.sort(function (a, b) { return a.ordem - b.ordem || a.ini - b.ini; });
    return linhas;
  }
  function legendaFases(comTrilhas) {
    return (comTrilhas ? '<span><i class="tr"></i>' + esc(t('gt.real')) + '</span><span><i class="tr p"></i>' + esc(t('gt.plan')) + '</span><span><i class="fl"></i>' + esc(t('gt.falta')) + '</span><span><i class="hj"></i>' + esc(t('gt.hoje')) + '</span>' : '') +
      ['D', 'M', 'A', 'I', 'C', 'F'].map(function (s) { return '<span><i class="fx" style="--c:' + corFase(s) + ';--ci:' + tintaFase(s) + '">' + s + '</i>' + FASES[s] + '</span>'; }).join('');
  }
  function gantt(alvo, legAlvo, compacto) {
    legAlvo.innerHTML = legendaFases(true);
    var linhas = linhasDoGantt();
    GT = linhas;
    if (!linhas.length) { alvo.innerHTML = vazio(t('ui.semCoach')); return; }
    var hoje = hojeUtc();
    var e0 = inicioMes(Math.min.apply(null, linhas.map(function (l) { return l.ini; })));
    var fimMax = Math.max.apply(null, linhas.map(function (l) { return l.fim; }));
    var e1 = addMeses(inicioMes(fimMax), 1); // fim do eixo = 1º dia do mês seguinte (EOMONTH + 1)
    var nMeses = Math.round((e1 - e0) / DIA / 30.44), dias = (e1 - e0) / DIA;
    var pos = function (ms) { return Math.max(0, Math.min(100, (ms - e0) / DIA / dias * 100)); };
    var dentro = function (ms) { return ms >= e0 && ms <= e1; };
    var meses = []; for (var i = 0; i < nMeses; i++) meses.push(addMeses(e0, i));
    var hojeP = dentro(hoje) ? pos(hoje) : null;
    var cab = '<div class="gt-cab"><span></span><span>' + esc(t('gt.projeto')) + '</span><span>' + esc(t('gt.site')) + '</span><span class="gt-coach-cab">' + esc(t('gt.coaching')) + '<small>' + esc(t('gt.coachCab')) + '</small></span>' +
      '<div class="gt-meses" style="--n:' + nMeses + '">' + meses.map(function (m, i) { var jan = new Date(m).getUTCMonth() === 0; return '<span class="' + (jan || i === 0 ? 'ano' : '') + '">' + esc(mesTxt(m, jan || i === 0)) + '</span>'; }).join('') +
      (hojeP != null ? '<span class="gt-hoje-tag" style="left:' + hojeP + '%">' + esc(t('gt.hoje')) + '</span>' : '') + '</div></div>';
    var grade = '<div class="gt-grade" style="--n:' + nMeses + '">' + meses.map(function () { return '<span></span>'; }).join('') + '</div>';
    var corpo = linhas.map(function (l, i) {
      var c = l.c, real = '', plan = '';
      // Barra real: um trecho de 15 dias por sessão realizada (falta não reposta = lacuna)
      l.ses.filter(function (s) { return l.setReal.indexOf(s.n) >= 0; }).forEach(function (s) {
        var a = l.ini + (s.n - 1) * 15 * DIA, b = l.ini + s.n * 15 * DIA;
        if (b < e0 || a > e1) return;
        var ant = l.setReal.indexOf(s.n - 1) >= 0, prox = l.setReal.indexOf(s.n + 1) >= 0;
        var r = (ant ? '0' : '3px') + ' ' + (prox ? '0' : '3px') + ' ' + (prox ? '0' : '3px') + ' ' + (ant ? '0' : '3px');
        real += '<i class="gt-seg" style="left:' + pos(a) + '%;width:' + Math.max(pos(b) - pos(a), .15) + '%;--c:' + corFase(s.sigla) + ';border-radius:' + r + '"></i>';
      });
      // Barra planejada: as etapas pelas datas de entrega
      l.fases.forEach(function (f, j) {
        var a = Math.max(f.ini, e0), b = Math.min(f.fim, e1);
        if (b <= a) return;
        plan += '<i class="gt-seg" style="left:' + pos(a) + '%;width:' + Math.max(pos(b) - pos(a), .15) + '%;--c:' + corFase(f.s) + ';border-radius:' + (j === 0 ? '3px 0 0 3px' : j === 5 ? '0 3px 3px 0' : '0') + '"></i>';
      });
      l.ses.forEach(function (s) {
        var dt = l.ini + s.offset * DIA;
        if (!dentro(dt) || dt > l.fim) return;
        var cod = s.sigla + s.ordem, estilo = 'left:' + pos(dt) + '%;--c:' + corFase(s.sigla) + ';--ci:' + tintaFase(s.sigla);
        var feita = l.setReal.indexOf(s.n) >= 0, faltou = l.setFalta.indexOf(s.n) >= 0;
        if (feita) {
          var dReal = l.realHist.filter(function (m) { return m.n === s.n && m.data; }).map(function (m) { return m.data; }).sort().pop();
          var dicaR = t('gt.sesReal', { c: cod, f: s.fase, d: dTxt(dReal || dt) }) + (faltou ? t('gt.sesReposta') : '');
          real += '<i class="gt-ses' + (faltou ? ' reposta' : '') + '" style="' + estilo + '" data-dica="' + esc(dicaR) + '">' + s.sigla + '</i>';
        } else if (faltou) {
          var fs = l.faltas.filter(function (m) { return m.n === s.n; });
          var dF = fs.map(function (m) { return m.data; }).filter(Boolean).sort().pop();
          real += '<i class="gt-falta" style="left:' + pos(dt) + '%" data-dica="' + esc(t('gt.sesFalta', { c: cod, f: s.fase, d: dF ? ' — ' + dTxt(dF) : '', q: fs.length > 1 ? t('gt.faltas', { n: fs.length }) : '' })) + '"></i>';
        }
        var cls = feita ? '' : (s.n > (l.maxReal || 0) && s.n <= (l.maxReal || 0) + (c.agendadasMes || 0)) ? ' agendada' : ' futura';
        plan += '<i class="gt-ses' + cls + '" style="' + estilo + '" data-dica="' + esc(t('gt.sesPlan', { n: s.n, f: s.fase, d: dTxt(dt) }) + (cls === ' agendada' ? ' · ' + t('gt.agendada') : '')) + '"></i>';
      });
      var dots = ''; for (var k = 1; k <= 4; k++) dots += '<i class="' + (k <= Math.min(Math.round(l.coach[1]), 4) ? 'on' : '') + '"></i>';
      return '<div class="gt-linha" data-i="' + i + '"><span class="gt-faixa' + (statusDe(c.statusDetalhe) === 'inicio' ? ' hachura' : '') + '" style="--c:' + l.cor + '"></span>' +
        '<span class="gt-proj" title="' + esc(c.projeto) + '">' + esc(c.projeto) + '</span><span class="gt-site">' + esc(c.unidade) + '</span>' +
        '<span class="gt-coach">' + l.coach[0] + ' <small>·</small> ' + l.coach[1] + ' <small>·</small> ' + l.coach[2] + ' <small>·</small> ' + l.coach[3] + '%<span class="gt-dots">' + dots + '</span></span>' +
        '<div class="gt-tempo">' + grade + (hojeP != null ? '<i class="gt-hoje" style="left:' + hojeP + '%"></i>' : '') +
        '<div class="gt-trilha real" data-r="R">' + real + '</div><div class="gt-trilha plan" data-r="P">' + plan + '</div></div></div>';
    }).join('');
    alvo.innerHTML = '<div class="gt-rolagem' + (compacto ? ' compacto' : '') + '"><div class="gt gt-min"' + (compacto ? ' style="--col-proj:minmax(130px,2fr);--col-coach:104px"' : '') + '>' + cab + '<div class="gt-corpo">' + corpo + '</div></div></div>';
  }
  function dicaDaLinha(l) {
    var c = l.c;
    var falta = l.primFalta ? { txt: l.ses[l.primFalta - 1].fase, c: corFase(l.ses[l.primFalta - 1].sigla) } : { txt: t('gt.semFaltas'), c: 'var(--st-concluido)' };
    var linha = function (r, v) { return '<dt>' + esc(r) + '</dt><dd>' + v + '</dd>'; };
    var chip = function (o) { return '<span class="chip" style="--c:' + o.c + '"><i></i>' + esc(o.txt) + '</span>'; };
    return '<h5>' + esc(c.projeto) + '</h5><dl>' +
      linha(t('gt.tSite'), esc(c.unidade)) + linha(t('gt.tStatus'), esc(t('st.' + statusDe(c.statusDetalhe)))) + linha(t('gt.tFaseAtual'), esc(l.faseAtual)) + '<hr>' +
      linha(t('gt.tEtapaFalta'), chip(falta)) + linha(t('gt.tEtapaPrev'), chip(l.etapaPrev)) + '<hr>' +
      linha(t('gt.tInicio'), esc(dTxt(l.ini))) + linha(t('gt.tFim'), esc(dTxt(l.fim))) +
      linha(t('gt.tCoaching'), l.coach[0] + ' | ' + l.coach[1] + ' | ' + l.coach[2] + ' | ' + l.coach[3] + '%') + '</dl>';
  }

  // ═══════════════ Calendário (Calendario_Sessoes_Projetos), padrão novo: projeto × mês ═══════════════
  function desenharCalendario() {
    $('cCalLeg').innerHTML = legendaFases(false);
    var hoje = hojeUtc();
    var cal = st.dados.calendario.filter(function (c) { return c.inicio && (!st.f.site || siteChave(c.unidade) === chave(st.f.site)); })
      .sort(function (a, b) { return String(a.projeto).localeCompare(String(b.projeto)); });
    if (!cal.length) { $('cCal').innerHTML = vazio(t('ui.semCoach')); return; }
    var linhas = cal.map(function (c) {
      var modelo = Math.round(c.previstas || 0) === 8 ? 8 : 15, ini = dIso(c.inicio);
      return { c: c, ses: sessoesDoModelo(modelo).map(function (s) { return { s: s, dt: ini + s.offset * DIA }; }) };
    });
    var todas = [].concat.apply([], linhas.map(function (l) { return l.ses.map(function (x) { return x.dt; }); }));
    var m0 = inicioMes(Math.min.apply(null, todas)), m1 = inicioMes(Math.max.apply(null, todas));
    var meses = []; for (var m = m0; m <= m1; m = addMeses(m, 1)) meses.push(m);
    var mesHoje = inicioMes(hoje);
    var tab = '<table class="cl" style="min-width:' + (260 + meses.length * 50) + 'px"><thead><tr><th>' + esc(t('c.projeto')) + '</th>' +
      meses.map(function (mm, i) { var jan = new Date(mm).getUTCMonth() === 0; return '<th class="' + (mm === mesHoje ? 'atual' : '') + '">' + esc(mesTxt(mm, jan || i === 0)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      linhas.map(function (l) {
        return '<tr><td><span class="cl-proj" title="' + esc(l.c.projeto) + '">' + esc(l.c.projeto) + '</span><span class="cl-site">' + esc(l.c.unidade) + '</span></td>' + meses.map(function (mm) {
          var doMes = l.ses.filter(function (x) { return inicioMes(x.dt) === mm; });
          return '<td class="' + (mm === mesHoje ? 'atual' : '') + '"><div class="fichas">' + doMes.map(function (x) {
            return '<span class="ficha' + (x.dt < hoje ? ' passada' : '') + '" style="--c:' + corFase(x.s.sigla) + ';--ci:' + tintaFase(x.s.sigla) + '" title="' + esc(t('c.sessao', { n: x.s.n, f: x.s.fase, d: dTxt(x.dt) })) + '"><b>S' + x.s.n + '</b><small>' + new Date(x.dt).getUTCDate() + '</small></span>';
          }).join('') + '</div></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    $('cCal').innerHTML = tab;
  }

  // ── Treinamentos (Card_HTML_Treinamentos + certificação por site) ──
  function desenharTreinamentos() {
    var ps = projetos();
    var n = contar(ps, function (p) { return p.certificacao; });
    $('trTile').innerHTML = tile({ rot: t('tr.tile'), v: n, ico: ICONES.ok, total: true });
    var sites = unicos(ps, 'site').sort(function (a, b) { return ordemSite(a) - ordemSite(b) || a.localeCompare(b); });
    var grupo = function (p) { var r = chave(p.rating); return r.indexOf('certified') >= 0 ? 'cert' : r.indexOf('training') >= 0 ? 'trein' : 'sem'; };
    var itens = [{ k: 'cert', c: 'var(--st-concluido)' }, { k: 'trein', c: 'var(--st-andamento)' }, { k: 'sem', c: 'var(--st-cancelado)' }];
    $('trGrafLeg').innerHTML = legenda(itens.map(function (i) { return { nome: t('tr.' + i.k), c: i.c }; }));
    colunas($('trGraf'), sites.map(function (s) {
      var doSite = ps.filter(function (p) { return p.site === s; });
      return { rot: s, segs: itens.map(function (i) { return { v: contar(doSite, function (p) { return grupo(p) === i.k; }), c: i.c, nome: t('tr.' + i.k) }; }) };
    }), { altura: 230 });
  }

  // ── Tabela (Tabela_HTML_Projetos) ──
  var COLS_TB = [
    { k: 'projeto', rot: 'tb.projeto', cls: 'c-proj' }, { k: 'objetivo', rot: 'tb.objetivo', cls: 'c-obj' }, { k: 'lider', rot: 'tb.lider' },
    { k: 'statusDetalhe', rot: 'tb.status' }, { k: 'ciclo', rot: 'tb.ciclo' }, { k: 'etapa', rot: 'tb.etapa' }, { k: 'apuracao', rot: 'tb.apuracao' },
    { k: 'certificacao', rot: 'tb.cert' }, { k: 'rating', rot: 'tb.rating' }, { k: 'statusTreinamento', rot: 'tb.trein' }, { k: 'comentarios', rot: 'tb.coment', cls: 'c-com' }
  ];
  function badge(txt, c, extra) { return txt ? '<span class="lss-badge" style="--c:' + c + '"' + (extra || '') + '><i></i>' + esc(txt) + '</span>' : '<span class="lss-mudo">—</span>'; }
  function desenharTabela() {
    var q = chave(st.busca);
    var ps = projetos().filter(function (p) {
      return !q || COLS_TB.some(function (c) { return chave(p[c.k]).indexOf(q) >= 0; }) || chave(p.site).indexOf(q) >= 0 || chave(p.businessCase).indexOf(q) >= 0;
    });
    if (st.ordem.col) {
      var k = st.ordem.col, d = st.ordem.dir;
      ps = ps.slice().sort(function (a, b) { return String(a[k] || '').localeCompare(String(b[k] || ''), undefined, { numeric: true }) * d; });
    }
    $('tbTabelaSub').textContent = t('tb.sub', { n: fmt(ps.length) });
    var linha = function (p) {
      var stk = statusDe(p.statusDetalhe), et = etapaDe(p.etapa), fase = et && /^[1-5]$/.test(et) ? 'DMAIC'[+et - 1] : null;
      var trein = chave(p.statusTreinamento);
      var bc = p.businessCase ? '<span class="meta">' + esc(p.businessCase + (p.estrategia ? ' · ' + p.estrategia : '')) + '</span>' : '';
      var apur = p.apuracao ? (/^[\d.,]/.test(p.apuracao) ? 'US$ ' : '') + p.apuracao : null;
      return '<tr><td class="c-proj"><span class="nome">' + esc(p.projeto || '—') + '</span><span class="meta">' + esc(p.site || '') + '</span>' + bc + '</td>' +
        '<td class="c-obj">' + (p.objetivo ? esc(p.objetivo) : '<span class="lss-mudo">—</span>') + '</td>' +
        '<td>' + esc(p.lider || '—') + '</td>' +
        '<td>' + badge(t('st.' + stk), corStatus(stk)) + (p.statusDetalhe && p.statusDetalhe !== p.status ? '<span class="meta">' + esc(p.statusDetalhe) + '</span>' : '') + '</td>' +
        '<td>' + esc(p.ciclo || '—') + '</td>' +
        '<td>' + (fase ? '<span class="lss-badge fx" style="--c:' + corFase(fase) + ';--ci:' + tintaFase(fase) + '">' + esc(p.etapa) + '</span>' : badge(p.etapa, 'var(--st-inicio)')) + '</td>' +
        '<td class="num">' + (apur ? esc(apur) : '<span class="lss-mudo">—</span>') + '</td>' +
        '<td>' + badge(p.certificacao, p.certificacao === 'Y' ? 'var(--st-concluido)' : 'var(--st-cancelado)') + '</td>' +
        '<td>' + badge(p.rating, chave(p.rating).indexOf('certified') >= 0 ? 'var(--st-concluido)' : 'var(--st-andamento)') + '</td>' +
        '<td>' + badge(p.statusTreinamento, trein === 'completed' || trein === 'ok' ? 'var(--st-concluido)' : trein.indexOf('pend') >= 0 ? 'var(--st-andamento)' : trein.indexOf('atras') >= 0 || trein.indexOf('delay') >= 0 ? 'var(--st-atrasado)' : 'var(--st-cancelado)') + '</td>' +
        '<td class="c-com">' + (p.comentarios ? esc(p.comentarios) : '<span class="lss-mudo">—</span>') + '</td></tr>';
    };
    $('tbTabela').innerHTML = '<thead><tr>' + COLS_TB.map(function (c) {
      var ord = st.ordem.col === c.k ? (st.ordem.dir > 0 ? 'ascending' : 'descending') : 'none';
      return '<th class="' + (c.cls || '') + (c.k === 'apuracao' ? ' num' : '') + '" data-col="' + c.k + '" aria-sort="' + ord + '" tabindex="0">' + esc(t(c.rot)) + '</th>';
    }).join('') + '</tr></thead><tbody>' + (ps.length ? ps.map(linha).join('') : '<tr><td colspan="' + COLS_TB.length + '">' + vazio(t('ui.semDados')) + '</td></tr>') + '</tbody>';
  }

  // ═════════════════════════════ página ═════════════════════════════
  function desenharHero() {
    var ps = projetos();
    $('lssQtd').textContent = st.dados ? fmt(contar(ps, function (p) { return p.projeto; })) : '—';
    $('lssSiteHero').textContent = st.f.site || t('b.todos');
    var a = st.dados ? st.dados.arquivos : [];
    var quando = function (tipo) { var x = a.filter(function (f) { return f.tipo === tipo; })[0]; return x ? S.dataHora(new Date(x.modificadoEm)).replace(/:\d\d$/, '') : '—'; };
    $('lssAtualizado').textContent = st.dados ? t('hero.atualizado', { t: quando('tracker'), c: quando('coach') }) : '';
    $('lssAtualizado').title = a.map(function (f) { return f.nome; }).join('\n');
  }
  function mostrarAba() {
    ABAS.forEach(function (k) {
      var on = k === st.aba;
      $('painel-' + k).hidden = !on || !st.dados;
      var b = $('aba-' + k); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    $('lssAplica').textContent = SO_SITE[st.aba] ? t('aplica.coach') : st.aba === 'detalhe' ? t('aplica.grade') : '';
  }
  function desenhar() {
    desenharFiltros(); desenharHero(); mostrarAba(); gravarUrl();
    var est = $('lssEstado');
    if (st.erro) { est.hidden = false; est.textContent = t('ui.erro', { m: st.erro }); return; }
    if (!st.dados) { est.hidden = false; est.textContent = t('ui.carregando'); return; }
    est.hidden = true;
    ({ geral: desenharGeral, detalhe: desenharDetalhe, bu: desenharBU, gantt: function () { gantt($('tGantt'), $('tGanttLeg'), false); },
      calendario: desenharCalendario, treinamentos: desenharTreinamentos, tabela: desenharTabela })[st.aba]();
  }

  // ═════════════════════════════ eventos ═════════════════════════════
  function ligar() {
    document.querySelectorAll('#lss [data-filtro]').forEach(function (el) {
      var k = el.getAttribute('data-filtro');
      el.querySelector('.unit-trigger').addEventListener('click', function (e) { e.stopPropagation(); abrirPop(el); });
      el.querySelector('.unit-list').addEventListener('click', function (e) {
        var b = e.target.closest('[data-v]'); if (!b) return;
        st.f[k] = b.getAttribute('data-v') || null; fecharPop(true); desenhar();
      });
    });
    document.addEventListener('click', function (e) { if (popAberto && e.target.isConnected && !e.target.closest('.unit')) fecharPop(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && popAberto) fecharPop(true); });
    $('lssLimpar').addEventListener('click', function () { st.f = { site: null, status: null, ciclo: null, etapa: null }; desenhar(); });
    var abas = document.querySelector('.lss-abas');
    abas.addEventListener('click', function (e) { var b = e.target.closest('[data-aba]'); if (b) { st.aba = b.getAttribute('data-aba'); desenhar(); } });
    abas.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = (ABAS.indexOf(st.aba) + (e.key === 'ArrowRight' ? 1 : -1) + ABAS.length) % ABAS.length;
      st.aba = ABAS[i]; desenhar(); $('aba-' + st.aba).focus();
    });
    ['dInsightsMes', 'bInsightsMes'].forEach(function (id, j) {
      $(id).addEventListener('click', function (e) { var b = e.target.closest('[data-mes]'); if (!b) return; if (j) st.mesB = b.getAttribute('data-mes'); else st.mesG = b.getAttribute('data-mes'); desenhar(); });
    });
    $('tbBusca').addEventListener('input', function () { st.busca = this.value; desenharTabela(); });
    $('tbTabela').addEventListener('click', function (e) {
      var th = e.target.closest('th[data-col]'); if (!th) return;
      var k = th.getAttribute('data-col');
      st.ordem = { col: k, dir: st.ordem.col === k ? -st.ordem.dir : 1 }; desenharTabela();
    });
    $('tbTabela').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('th[data-col]')) { e.preventDefault(); e.target.click(); } });

    // Dica do Gantt: a sessão sob o mouse, ou o resumo do projeto
    var dica = $('lssDica');
    document.addEventListener('mousemove', function (e) {
      var linha = e.target.closest && e.target.closest('.gt-linha');
      if (!linha) { dica.hidden = true; return; }
      var ses = e.target.closest('[data-dica]');
      dica.innerHTML = ses ? '<h5>' + esc(ses.getAttribute('data-dica')) + '</h5>' : dicaDaLinha(GT[+linha.getAttribute('data-i')]);
      dica.hidden = false;
      var w = dica.offsetWidth, h = dica.offsetHeight;
      dica.style.left = Math.min(window.innerWidth - w - 12, e.clientX + 16) + 'px';
      dica.style.top = (e.clientY + h + 24 > window.innerHeight ? e.clientY - h - 12 : e.clientY + 16) + 'px';
    });
    window.addEventListener('scroll', function () { dica.hidden = true; }, { passive: true });

    // Tela cheia (igual aos dashboards do Hub)
    document.querySelectorAll('#lss .js-full').forEach(function (b) {
      b.addEventListener('click', function () {
        try { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {}); } catch (e) { /* sem suporte */ }
      });
    });
    var rotuloFs = function () {
      var on = !!document.fullscreenElement;
      document.querySelectorAll('#lss .js-full').forEach(function (b) { b.setAttribute('aria-label', t(on ? 'fs.off' : 'fs.on')); b.title = t(on ? 'fs.offTitle' : 'fs.onTitle'); });
    };
    document.addEventListener('fullscreenchange', rotuloFs);

    var pend = null;
    window.addEventListener('resize', function () { clearTimeout(pend); pend = setTimeout(desenhar, 150); });
    S.on('idioma', function () { S.traduzir(); rotuloFs(); desenhar(); });
    S.on('numero', desenhar);
    S.on('tema', desenhar);
  }

  function carregar() {
    fetch('api/dados', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function (d) {
        st.dados = d;
        // filtros da URL que não existem mais nos dados são descartados
        var ps = d.projetos;
        if (st.f.site && !ps.some(function (p) { return p.site === st.f.site; })) st.f.site = null;
        if (st.f.status && !ps.some(function (p) { return p.statusDetalhe === st.f.status; })) st.f.status = null;
        if (st.f.ciclo && !ps.some(function (p) { return p.ciclo === st.f.ciclo; })) st.f.ciclo = null;
        if (st.f.etapa && !ps.some(function (p) { return p.etapa === st.f.etapa; })) st.f.etapa = null;
        desenhar();
      })
      .catch(function (e) { st.erro = e.message; desenhar(); });
  }

  lerUrl();
  S.traduzir();
  ligar();
  desenhar();
  carregar();
})();
