/*
 * VBM Stable & Capable — Dashboard (aba "Dashboard", antes "Power BI").
 *
 * Estabilidade e capabilidade por KPI, no DESENHO do Dashboard do VBM Kaizen:
 * hero com foto, abas, filtros num painel lateral com etiquetas, cartões de
 * resumo, cards com gráficos (colunas com cota de variação, como o Kaizen) e
 * tabelas. Os CÁLCULOS continuam os mesmos visuais Python do
 * Stable_and_Capable_3.pbix (limites por trimestre/ano, regras de Nelson,
 * melhores 30 dias, P75, histograma por ano) — bloco "estatística" abaixo,
 * sem alteração. Dados de api/bi (bi-api.js, banco PRD).
 *
 * Desenho em SVG/HTML próprio (sem biblioteca externa: a rede corporativa
 * bloqueia CDNs). Cores pelos tokens --d-* / --c-* do CSS (.dsc), claro/escuro.
 *
 *   PainelSPC.iniciar({ api, t, lang: () => lang })   // uma vez
 *   PainelSPC.redesenhar()                            // troca de idioma/tema/número
 */
(function () {
  'use strict';

  // ════════════════════════════ estatística ════════════════════════════
  var DIA = 864e5;
  var D2 = 1.128; // constante SPC (MR de 2 pontos)

  function media(a) { var s = 0, n = 0; for (var i = 0; i < a.length; i++) if (a[i] != null && !isNaN(a[i])) { s += a[i]; n++; } return n ? s / n : NaN; }
  function desvio(a) { // pandas .std() (amostral, ddof=1)
    var v = a.filter(function (x) { return x != null && !isNaN(x); });
    if (v.length < 2) return NaN;
    var m = media(v), s = 0;
    v.forEach(function (x) { s += (x - m) * (x - m); });
    return Math.sqrt(s / (v.length - 1));
  }
  function quantil(a, q) { // pandas .quantile (interpolação linear)
    var v = a.filter(function (x) { return x != null && !isNaN(x); }).sort(function (x, y) { return x - y; });
    if (!v.length) return NaN;
    var p = (v.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
    return v[lo] + (v[hi] - v[lo]) * (p - lo);
  }
  /** best_30_days_full: média móvel de 30 PONTOS (não dias), primeiro máximo */
  function melhor30(linhas) {
    var s = linhas.filter(function (r) { return r.v != null; });
    if (s.length < 30) return null;
    var soma = 0, melhor = -Infinity, fimIdx = -1;
    for (var i = 0; i < s.length; i++) {
      soma += s[i].v;
      if (i >= 30) soma -= s[i - 30].v;
      if (i >= 29 && soma / 30 > melhor) { melhor = soma / 30; fimIdx = i; }
    }
    if (fimIdx < 0) return null;
    var fim = s[fimIdx].t;
    return { inicio: fim - 29 * DIA, fim: fim, media: melhor };
  }

  // ════════════════════════════ preparação ═════════════════════════════
  /** Mesmo tratamento de todos os visuais: negativos=0, outliers (±3,5σ), zeros, unidade */
  function preparar(serie, op) {
    var linhas = serie.pontos
      .filter(function (p) { return (!op.inicio || p[0] >= op.inicio) && (!op.fim || p[0] <= op.fim); })
      .map(function (p) {
        var t = Date.parse(p[0] + 'T00:00:00Z'), d = new Date(t);
        return { t: t, d: p[0], v: p[1] == null ? null : Math.max(0, p[1]), b: p[2], ano: d.getUTCFullYear(), tri: Math.floor(d.getUTCMonth() / 3) + 1 };
      });
    if (op.removerOutliers) { // FLAG_OUTLIER = 1 → mantém só mean ± 3,5·std (NaN sai junto, como no pandas)
      var vals = linhas.map(function (r) { return r.v; }), m = media(vals), sd = desvio(vals);
      linhas = linhas.filter(function (r) { return r.v != null && r.v >= m - 3.5 * sd && r.v <= m + 3.5 * sd; });
    }
    if (op.removerZeros) linhas = linhas.filter(function (r) { return r.v !== 0; }); // FLAG_RETIRA_ZEROS = 1

    var u = serie.unit, ton = u === 'tonnes/day', pct = u === '%/day', eqm = u === 'eqm/day';
    var conc = /concentrate/i.test(serie.kpi), onca = serie.site === 'Onça Puma', brasil = serie.pais === 'Brasil';
    var fator = 1;
    if (ton && !brasil) fator = 1;                       // 1) tonelada fora do Brasil → mantém
    else if (ton && onca) fator = 1;                     // 2) Onça Puma → mantém
    else if (ton && !conc && brasil) fator = 1 / 1000;   // 3) tonelada, não concentrado, Brasil → kton
    else if (pct && !conc) fator = 100;                  // 4) percentual → ×100
    if (fator !== 1) linhas.forEach(function (r) { if (r.v != null) r.v *= fator; if (r.b != null) r.b *= fator; });
    return { linhas: linhas, ton: ton, pct: pct, eqm: eqm, onca: onca, brasil: brasil };
  }

  /** Medida DAX "unit_new" do .pbix */
  function unidadeTitulo(s) {
    if (s.kpi === 'Lateral Mine Development') return 'eqm/day';
    if (s.unit === 'tonnes/day' && !/concentrate/i.test(s.kpi) && s.pais === 'Brasil' && s.site !== 'Onça Puma') return 'ktonnes/day';
    return s.unit;
  }

  function decimaisCarta(p, porAno) { // v1 (trimestre) / v2 (ano)
    if (p.pct) return 2;
    if (p.ton && p.onca) return porAno ? 1 : 0;
    if (p.ton && !p.brasil) return 0;
    if (p.eqm && (porAno || !p.brasil)) return porAno ? 2 : 1;
    return 0;
  }
  function decimaisMedidas(p, porAno) { // v4 / v5
    if (p.pct) return 2;
    if (p.ton && (p.onca || !p.brasil)) return 0;
    if (p.eqm) return porAno ? 2 : 1;
    return 0;
  }

  function agrupar(linhas, porAno) {
    var mapa = new Map(), ordem = [];
    linhas.forEach(function (r) {
      var k = porAno ? String(r.ano) : r.ano + 'Q' + r.tri;
      if (!mapa.has(k)) { mapa.set(k, { chave: k, ano: r.ano, tri: r.tri, linhas: [] }); ordem.push(k); }
      mapa.get(k).linhas.push(r);
    });
    return ordem.map(function (k) { return mapa.get(k); })
      .sort(function (a, b) { return a.ano - b.ano || (porAno ? 0 : a.tri - b.tri); });
  }

  /** Limites e regras de Nelson de um grupo — mesma lógica dos scripts v1/v2 */
  function spcGrupo(g, porAno) {
    var calc = g.linhas.filter(function (r) { return r.v != null; });
    if (!calc.length || (!porAno && calc.length < 7)) return null;
    var v = calc.map(function (r) { return r.v; });
    var cl = media(v), mr = [];
    for (var i = 1; i < v.length; i++) mr.push(Math.abs(v[i] - v[i - 1]));
    var sigma = mr.length ? media(mr) / D2 : 0;
    var ucl = cl + 3 * sigma, lcl = Math.max(cl - 3 * sigma, 0);
    var r1 = new Set(), r2 = new Set(), r3 = new Set(), r4 = new Set();
    v.forEach(function (x, j) { if (x > ucl || x < lcl) r1.add(j); });                 // Regra 1
    var lado = v.map(function (x) { return x > cl ? 1 : -1; }), run = 1;                // Regra 2: 7 do mesmo lado
    for (i = 1; i < v.length; i++) { run = lado[i] === lado[i - 1] ? run + 1 : 1; if (run >= 7) for (var k = i - 6; k <= i; k++) r2.add(k); }
    var dif = []; for (i = 1; i < v.length; i++) dif.push(v[i] - v[i - 1]);
    var tend = dif.map(function (d) { return d > 0 ? 1 : d < 0 ? -1 : 0; });           // Regra 3: 7 subindo/descendo
    run = 1;
    for (i = 1; i < tend.length; i++) { run = (tend[i] === tend[i - 1] && tend[i] !== 0) ? run + 1 : 1; if (run >= 6) for (k = i - 5; k <= i + 1; k++) r3.add(k); }
    // Regra 4: 14 alternando. No script a checagem fica FORA do laço (avalia só a
    // sequência que termina no fim do grupo) — mantido igual para bater com o Power BI.
    run = 1; var ultimo = -1;
    for (i = 1; i < tend.length; i++) { run = (tend[i] === -tend[i - 1] && tend[i] !== 0) ? run + 1 : 1; ultimo = i; }
    if (ultimo >= 0 && run >= 13) for (k = ultimo - 12; k <= ultimo + 1; k++) r4.add(k);
    var pts = function (set) { return Array.from(set).filter(function (j) { return j >= 0 && j < calc.length; }).map(function (j) { return calc[j]; }); };
    return { cl: cl, ucl: ucl, lcl: lcl, r1: pts(r1), r2: pts(r2), r3: pts(r3), r4: pts(r4) };
  }

  // ══════════════════════════════ SVG ══════════════════════════════════
  var NS = 'http://www.w3.org/2000/svg';
  function el(nome, attrs, pai, texto) {
    var e = document.createElementNS(NS, nome);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (texto != null) e.textContent = texto;
    if (pai) pai.appendChild(e);
    return e;
  }
  function escala(d0, d1, r0, r1) { var k = (r1 - r0) / ((d1 - d0) || 1); return function (x) { return r0 + (x - d0) * k; }; }
  function ticksBons(min, max, n) {
    var passo = Math.pow(10, Math.floor(Math.log10((max - min) / n || 1))), err = ((max - min) / n) / passo;
    passo *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var out = []; for (var x = Math.ceil(min / passo) * passo; x <= max + passo * 1e-9; x += passo) out.push(+x.toFixed(10));
    return out;
  }

  /** Token de cor do dashboard (CSS .dsc), já resolvido para o tema atual */
  function cor(nome, padrao) { var raiz = $('vista-powerbi'); var v = raiz ? getComputedStyle(raiz).getPropertyValue(nome).trim() : ''; return v || padrao; }

  // ═════════════════════════════ estado/UI ═════════════════════════════
  var ctx = null; // { api, t, lang }
  var st = {
    filtros: null, combo: null, serie: null, carregando: false, erro: null,
    op: { removerZeros: false, removerOutliers: false, inicio: null, fim: null },
    porAno: false, vis: 'carta', regraFoco: null, anoFoco: null
  };
  var res = null; // resultado do último cálculo (grupos, limites, medidas)
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var t = function (k, v) { return ctx.t(k, v); };
  var L = function () { return ctx.lang(); };
  // Números no formato escolhido na engrenagem (Setup Dashboards: Brasil 1.234,56 · Canadá 1,234.56)
  function fmt(x, dec) {
    if (x == null || isNaN(x) || !isFinite(x)) return '—';
    if (window.VBMSetup) return window.VBMSetup.fmt(x, dec);
    return Number(x).toLocaleString(L(), { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function pct(x, dec) { return isFinite(x) ? fmt(x * 100, dec == null ? 0 : dec) + '%' : '—'; }
  function fmtData(ms, comAno) { var d = new Date(ms); return d.toLocaleDateString(L(), comAno ? { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', timeZone: 'UTC' }); }
  function fmtIso(iso, comAno) { return iso ? fmtData(Date.parse(iso + 'T00:00:00Z'), comAno) : '…'; }
  function mesCurto(ms) { return new Date(ms).toLocaleDateString(L(), { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', ''); }
  var SVG_ALTA = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5L9 8H1z" fill="currentColor"></path></svg>';
  var SVG_QUEDA = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5L1 2h8z" fill="currentColor"></path></svg>';
  var SVG_X = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var REGRAS = [['r1', '--c-r1', 'bi.r.r1'], ['r2', '--c-r2', 'bi.r.r2'], ['r3', '--c-r3', 'bi.r.r3'], ['r4', '--c-r4', 'bi.r.r4']];

  function unicos(lista, campo) { var s = []; lista.forEach(function (c) { if (s.indexOf(c[campo]) < 0) s.push(c[campo]); }); return s; }
  function opcoes(sel, valores, atual, rotulo) {
    sel.innerHTML = valores.map(function (v) { return '<option value="' + esc(v) + '">' + esc(rotulo ? rotulo(v) : v) + '</option>'; }).join('');
    sel.value = valores.indexOf(atual) >= 0 ? atual : (valores[0] || '');
    return sel.value;
  }

  /** Cascata BU → Site → KPI → Operação (operação só aparece quando há mais de uma) */
  function montarFiltros(pref) {
    var lista = st.filtros.combinacoes;
    var bu = opcoes($('biBu'), unicos(lista, 'bu'), pref.bu);
    var l1 = lista.filter(function (c) { return c.bu === bu; });
    var site = opcoes($('biSite'), unicos(l1, 'site'), pref.site);
    var l2 = l1.filter(function (c) { return c.site === site; });
    var kpi = opcoes($('biKpi'), unicos(l2, 'kpi'), pref.kpi);
    var l3 = l2.filter(function (c) { return c.kpi === kpi; });
    var op = opcoes($('biOp'), unicos(l3, 'op'), pref.op);
    $('biOpGrupo').hidden = unicos(l3, 'op').length < 2;
    st.combo = l3.filter(function (c) { return c.op === op; })[0] || null;
  }
  function lerPreferencia() { return { bu: $('biBu').value, site: $('biSite').value, kpi: $('biKpi').value, op: $('biOp').value }; }

  function carregarSerie() {
    if (!st.combo) { st.serie = null; desenhar(); return; }
    var id = st.combo.id;
    st.carregando = true; desenhar();
    ctx.api('bi/serie?id=' + encodeURIComponent(id)).then(function (s) {
      if (!st.combo || st.combo.id !== id) return; // trocou no meio
      st.serie = s; st.erro = null;
    }).catch(function (e) { st.erro = e.message; st.serie = null; })
      .then(function () { st.carregando = false; desenhar(); });
  }

  // ═══════════════════════════════ cálculo ═════════════════════════════
  function rotuloGrupo(g, porAno) { return porAno ? String(g.ano) : 'Q' + g.tri + ' ' + g.ano; }

  /** Tudo o que as três abas e os cartões usam, num cálculo só */
  function calcular(p) {
    var porAno = st.porAno;
    var grupos = agrupar(p.linhas, porAno).map(function (g) {
      var v = g.linhas.map(function (r) { return r.v; });
      var b30 = melhor30(g.linhas);
      return {
        g: g, rotulo: rotuloGrupo(g, porAno), spc: spcGrupo(g, porAno), b30: b30,
        n: g.linhas.filter(function (r) { return r.v != null; }).length,
        mean: media(v), best: b30 ? b30.media : NaN, p75: quantil(v, 0.75),
        budget: media(g.linhas.map(function (r) { return r.b; }))
      };
    });
    var sinais = { r1: 0, r2: 0, r3: 0, r4: 0 }, comLimite = 0;
    grupos.forEach(function (x) {
      if (!x.spc) return;
      comLimite += x.n;
      ['r1', 'r2', 'r3', 'r4'].forEach(function (k) { sinais[k] += x.spc[k].length; });
    });
    var comValor = p.linhas.filter(function (r) { return r.v != null; });
    return {
      p: p, porAno: porAno, grupos: grupos, sinais: sinais, comLimite: comLimite,
      decCarta: decimaisCarta(p, porAno), decMed: decimaisMedidas(p, porAno),
      dias: comValor.length, t0: p.linhas[0].t, t1: p.linhas[p.linhas.length - 1].t
    };
  }

  // ═══════════════════════════════ desenho ═════════════════════════════
  function vazioHtml(msg) { return '<div class="dsc-vazio">' + esc(msg) + '</div>'; }
  var ALVOS = ['biCarta', 'biMedidas', 'biRankBudget', 'biHist'];

  function desenhar() {
    if (!ctx) return;
    desenharHero();
    desenharChips();
    document.querySelectorAll('[data-bi-agrup]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.getAttribute('data-bi-agrup') === 'ano') === st.porAno)); });
    ALVOS.forEach(function (id) { $(id).classList.toggle('carregando', st.carregando); });
    res = null;
    var msg = st.erro || (!st.serie ? (st.carregando ? null : t('bi.selecione')) : null);
    if (!msg && st.serie) {
      var p = preparar(st.serie, st.op);
      if (!p.linhas.length) msg = t('bi.semDados'); else res = calcular(p);
    }
    if (!res) {
      if (st.carregando && !st.serie) { esqueleto(); return; }
      if (msg) {
        $('biTiles').innerHTML = '<div class="dsc-tile" style="grid-column:1/-1;min-height:0">' + vazioHtml(msg) + '</div>';
        ALVOS.forEach(function (id) { $(id).innerHTML = vazioHtml(msg); });
        ['biLimCab', 'biLimCorpo', 'biMedCab', 'biMedCorpo', 'biAnosCab', 'biAnosCorpo', 'biLegendaCarta', 'biAnosSeg'].forEach(function (id) { $(id).innerHTML = ''; });
        $('biCartaSub').textContent = '';
      }
      return;
    }
    desenharHero();
    desenharTiles();
    desenharVisao();
  }
  function esqueleto() { $('biTiles').innerHTML = '<div class="dsc-esqueleto"></div><div class="dsc-esqueleto"></div><div class="dsc-esqueleto"></div><div class="dsc-esqueleto"></div>'; }

  function mostrarVisao(v) {
    st.vis = v;
    ['carta', 'medidas', 'capab'].forEach(function (k) {
      $('biVis-' + k).hidden = k !== v;
      var aba = $('biAba-' + k); aba.setAttribute('aria-selected', String(k === v)); aba.tabIndex = k === v ? 0 : -1;
    });
    try { localStorage.setItem('sc-dashboard-aba', v); } catch (e) {}
    desenharVisao();
  }
  /** Só a aba visível é desenhada: as outras têm largura 0 e seriam refeitas ao abrir */
  function desenharVisao() {
    if (!res) return;
    if (st.vis === 'carta') { desenharCarta(); desenharLimites(); }
    else if (st.vis === 'medidas') desenharMedidas();
    else desenharCapab();
  }

  // ── Hero e etiquetas ──
  function desenharHero() {
    var s = st.combo;
    $('biTitulo').textContent = s ? (s.site + (s.op ? ' ' + s.op : '')) : t('bi.selecione');
    $('biSub').textContent = s ? [s.kpi, unidadeTitulo(s), s.bu].filter(Boolean).join(' · ') : '';
    $('biQtdPeriodo').textContent = res ? fmtData(res.t0, true) + ' – ' + fmtData(res.t1, true) : '—';
    $('biQtdDias').textContent = res ? fmt(res.dias, 0) : '—';
    var f = st.filtros;
    $('biAtualizado').textContent = f ? t('bi.atualizado', { quando: new Date(f.atualizadoEm).toLocaleString(L(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), banco: f.banco }) : '';
    var n = qtdFiltros();
    $('biContaFiltros').hidden = !n; $('biContaFiltros').textContent = n;
  }
  function periodoCompleto() {
    var f = st.filtros; if (!f) return true;
    return (!st.op.inicio || st.op.inicio <= f.periodo.min) && (!st.op.fim || st.op.fim >= f.periodo.max);
  }
  function qtdFiltros() { return (periodoCompleto() ? 0 : 1) + (st.op.removerZeros ? 1 : 0) + (st.op.removerOutliers ? 1 : 0); }
  function desenharChips() {
    var s = st.combo, h = '';
    if (s) h += '<button type="button" class="dsc-chip" data-chip="kpi"><b>KPI:</b><span class="v">' + esc([s.bu, s.site, s.kpi].concat(s.op && !$('biOpGrupo').hidden ? [s.op] : []).join(' › ')) + '</span></button>';
    if (st.filtros) h += '<button type="button" class="dsc-chip" data-chip="periodo"' + (periodoCompleto() ? '' : ' data-remover="1"') + '><b>' + esc(t('bi.f.periodo')) + ':</b><span class="v">' +
      esc(fmtIso(st.op.inicio || st.filtros.periodo.min, true) + ' – ' + fmtIso(st.op.fim || st.filtros.periodo.max, true)) + '</span>' + (periodoCompleto() ? '' : SVG_X) + '</button>';
    if (st.op.removerZeros) h += '<button type="button" class="dsc-chip" data-chip="removerZeros" data-remover="1"><span class="v">' + esc(t('bi.semZeros')) + '</span>' + SVG_X + '</button>';
    if (st.op.removerOutliers) h += '<button type="button" class="dsc-chip" data-chip="removerOutliers" data-remover="1"><span class="v">' + esc(t('bi.semOutliers')) + '</span>' + SVG_X + '</button>';
    $('biChips').innerHTML = h;
  }

  // ── Cartões de resumo ──
  function deltaHtml(atual, anterior, rotAnterior) {
    if (!isFinite(atual) || !isFinite(anterior) || anterior === 0) return '';
    var d = (atual - anterior) / Math.abs(anterior), cls = Math.abs(d) < 0.005 ? 'is-flat' : d > 0 ? 'is-up' : 'is-down';
    return '<span class="dsc-delta ' + cls + '">' + (d >= 0 ? SVG_ALTA : SVG_QUEDA) + (d > 0 ? '+' : '') + fmt(d * 100, 1) + '%</span><span>' + esc(t('bi.t.vs', { p: rotAnterior })) + '</span>';
  }
  function desenharTiles() {
    var gs = res.grupos, ult = gs[gs.length - 1], ant = gs.length > 1 ? gs[gs.length - 2] : null, dec = res.decMed;
    var un = esc(unidadeTitulo(st.serie));
    var foraR1 = res.sinais.r1, sob = res.comLimite ? 1 - foraR1 / res.comLimite : NaN;
    var corOk = cor('--vbm-blue', '#3cb5e5'), corFora = cor('--c-r1', '#b91c1c');
    var conic = isFinite(sob) ? 'conic-gradient(' + corOk + ' 0 ' + (sob * 100) + '%, ' + corFora + ' ' + (sob * 100) + '% 100%)' : 'conic-gradient(var(--d-track) 0 100%)';
    var h = '<div class="dsc-tile dsc-tile-total"><div class="t-head">' + esc(t('bi.t.media', { p: ult.rotulo })) + '</div>' +
      '<div class="tt-corpo"><div><div class="tt-num">' + fmt(ult.mean, dec) + '</div><div class="tt-sub"><span>' + un + '</span>' + (ant ? deltaHtml(ult.mean, ant.mean, ant.rotulo) : '') + '</div></div>' +
      '<div class="donut" style="--conic:' + conic + '" title="' + esc(t('bi.t.sobControleDica')) + '"><b>' + pct(sob) + '</b><small>' + esc(t('bi.t.sobControle')) + '</small></div></div></div>';
    // Melhores 30 dias: quanto a média chegou perto do melhor trecho do período
    var rb = ult.mean / ult.best;
    h += '<div class="dsc-tile"><div class="t-head"><i class="q" style="--c:var(--vbm-blue-dark)"></i>' + esc(t('bi.t.melhor', { p: ult.rotulo })) + '</div>' +
      '<div class="t-num">' + fmt(ult.best, dec) + '</div>' +
      '<div><div class="t-foot"><span class="t-bar"><span style="--w:' + (isFinite(rb) ? Math.min(100, rb * 100) : 0) + '%;--c:var(--vbm-blue-dark)"></span></span><span class="t-pct">' + pct(rb) + '</span></div>' +
      '<div class="t-leg">' + esc(ult.b30 ? fmtData(ult.b30.inicio) + ' – ' + fmtData(ult.b30.fim) + ' · ' + t('bi.t.melhorLeg') : t('bi.t.semMelhor')) + '</div></div></div>';
    // Budget: média ÷ budget
    var rbud = ult.mean / ult.budget, bateu = isFinite(rbud) && rbud >= 1;
    h += '<div class="dsc-tile"><div class="t-head"><i class="q" style="--c:' + (bateu ? 'var(--d-up)' : 'var(--vbm-blue)') + '"></i>' + esc(t('bi.t.budget', { p: ult.rotulo })) + '</div>' +
      '<div class="t-num">' + fmt(ult.budget, dec) + '</div>' +
      '<div><div class="t-foot"><span class="t-bar"><span style="--w:' + (isFinite(rbud) ? Math.min(100, rbud * 100) : 0) + '%;--c:' + (bateu ? 'var(--d-up)' : 'var(--vbm-blue)') + '"></span></span><span class="t-pct">' + pct(rbud) + '</span></div>' +
      '<div class="t-leg">' + esc(isFinite(ult.budget) ? t('bi.t.budgetLeg') : t('bi.semBudget')) + '</div></div></div>';
    // Sinais fora de controle (todas as regras, período inteiro) — clicar destaca na carta
    var total = res.sinais.r1 + res.sinais.r2 + res.sinais.r3 + res.sinais.r4;
    h += '<div class="dsc-tile dsc-tile-sinais' + (st.regraFoco ? ' tem-foco' : '') + '"><div class="t-head">' + esc(t('bi.t.sinais')) + ' · ' + fmt(total, 0) + '</div>' +
      REGRAS.map(function (r) {
        return '<button type="button" class="orow" data-regra="' + r[0] + '" aria-pressed="' + (st.regraFoco === r[0]) + '" style="--c:var(' + r[1] + ')" title="' + esc(t(r[2])) + '"><i></i><span>' + esc(t(r[2])) + '</span><b>' + fmt(res.sinais[r[0]], 0) + '</b></button>';
      }).join('') + '</div>';
    $('biTiles').innerHTML = h;
  }

  // ── Carta de controle (v1 trimestre / v2 ano), no desenho do Kaizen ──
  function legendaCarta() {
    $('biLegendaCarta').innerHTML = [
      ['lg-linha', '--c-serie', t('bi.r.valores')], ['lg-linha', '--c-cl', 'CL'], ['lg-linha lg-tracejada', '--c-lim', 'UCL / LCL'], ['lg-faixa', '--c-best', t('bi.r.best')]
    ].concat(REGRAS.map(function (r) { return ['lg-ponto', r[1], t(r[2])]; }))
      .map(function (i) { return '<span><i class="' + i[0] + '" style="--c:var(' + i[1] + ')"></i>' + esc(i[2]) + '</span>'; }).join('');
  }
  function desenharCarta() {
    legendaCarta();
    $('biCartaSub').textContent = t('bi.cartaSub', { agrup: t(res.porAno ? 'bi.ano' : 'bi.trimestre').toLowerCase() });
    var alvo = $('biCarta'), p = res.p, dec = res.decCarta, gs = res.grupos;
    var W = Math.max(alvo.clientWidth, 480), H = 380, m = { l: 52, r: 16, t: 40, b: 30 };
    var vals = p.linhas.filter(function (r) { return r.v != null; }).map(function (r) { return r.v; });
    gs.forEach(function (x) { if (x.spc) vals.push(x.spc.ucl, x.spc.lcl); });
    var ymin = Math.min.apply(null, vals), ymax = Math.max.apply(null, vals);
    var pad = (ymax - ymin || Math.abs(ymax) || 1) * 0.06; ymin -= pad; ymax += pad;
    var t0 = res.t0, t1 = res.t1;
    var x = escala(t0, t1 + DIA * 0.5, m.l, W - m.r), y = escala(ymin, ymax, H - m.b, m.t);
    alvo.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, class: 'dsc-svg' + (st.regraFoco ? ' tem-foco' : ''), role: 'img', 'aria-label': t('bi.carta') }, alvo);
    var cBest = cor('--c-best', 'rgba(60,181,229,.11)'), cSerie = cor('--c-serie', '#a7b8c6'), cCl = cor('--c-cl', '#1a8bbf'), cLim = cor('--c-lim', '#8a96a6');

    // eixos e grade
    ticksBons(ymin, ymax, 5).forEach(function (v) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grade' }, svg);
      el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'ex' }, svg, fmt(v, Math.abs(ymax - ymin) < 10 ? 2 : 0));
    });
    var meses = [], d = new Date(t0); d.setUTCDate(1);
    while (d.getTime() <= t1) { if (d.getTime() >= t0) meses.push(d.getTime()); d.setUTCMonth(d.getUTCMonth() + 1); }
    var passoMes = Math.max(1, Math.ceil(meses.length / Math.floor((W - m.l - m.r) / 70)));
    meses.forEach(function (ms, i) { if (i % passoMes === 0) el('text', { x: x(ms), y: H - m.b + 18, 'text-anchor': 'middle', class: 'ex' }, svg, mesCurto(ms)); });

    // melhores 30 dias (faixa) e separadores de período
    gs.forEach(function (g, i) {
      if (g.b30) {
        el('rect', { x: x(g.b30.inicio), y: m.t, width: Math.max(1, x(g.b30.fim) - x(g.b30.inicio)), height: H - m.b - m.t, fill: cBest, rx: 3 }, svg);
        if (x(g.b30.fim) - x(g.b30.inicio) > 48) el('text', { x: (x(g.b30.inicio) + x(g.b30.fim)) / 2, y: H - m.b - 6, 'text-anchor': 'middle', class: 't-best' }, svg, fmtData(g.b30.inicio) + '–' + fmtData(g.b30.fim));
      }
      if (i > 0) { var xx = x(g.g.linhas[0].t) - DIA * 0; el('line', { x1: xx, x2: xx, y1: m.t - 8, y2: H - m.b, class: 'sep' }, svg); }
    });
    el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'base' }, svg);

    // série diária
    var dpath = '', aberto = false;
    p.linhas.forEach(function (r) { if (r.v == null) { aberto = false; return; } dpath += (aberto ? 'L' : 'M') + x(r.t).toFixed(1) + ',' + y(r.v).toFixed(1); aberto = true; });
    el('path', { d: dpath, fill: 'none', stroke: cSerie, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }, svg);

    // limites, rótulos e pílula do período
    gs.forEach(function (g) {
      var s = g.spc, ls = g.g.linhas, xa = x(ls[0].t), xb = x(ls[ls.length - 1].t), xm = (xa + xb) / 2;
      var pil = el('g', { class: 'pilula' }, svg), lp = Math.max(46, g.rotulo.length * 6.4 + 16);
      el('rect', { x: xm - lp / 2, y: 6, width: lp, height: 20, rx: 10 }, pil);
      el('text', { x: xm, y: 20, 'text-anchor': 'middle' }, pil, g.rotulo);
      if (!s) return; // como no script: grupo sem limites fica sem linhas
      el('line', { x1: xa, x2: xb, y1: y(s.ucl), y2: y(s.ucl), stroke: cLim, 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }, svg);
      el('line', { x1: xa, x2: xb, y1: y(s.lcl), y2: y(s.lcl), stroke: cLim, 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }, svg);
      el('line', { x1: xa, x2: xb, y1: y(s.cl), y2: y(s.cl), stroke: cCl, 'stroke-width': 2.5, 'stroke-linecap': 'round' }, svg);
      var xl = xa + 6;
      el('text', { x: xl, y: y(s.ucl) - 5, class: 't-lim' }, svg, 'UCL ' + fmt(s.ucl, dec));
      el('text', { x: xl, y: y(s.cl) - 6, class: 't-cl' }, svg, 'CL ' + fmt(s.cl, dec));
      el('text', { x: xl, y: y(s.lcl) + 13, class: 't-lim' }, svg, 'LCL ' + fmt(s.lcl, dec));
    });

    // sinais (ordem de desenho do script: 4, 3, 2, 1 — a regra 1 fica por cima)
    var solido = cor('--d-solid', '#fff');
    REGRAS.slice().reverse().forEach(function (rg) {
      var c = cor(rg[1], '#000');
      gs.forEach(function (g) {
        if (g.spc) g.spc[rg[0]].forEach(function (r) {
          el('circle', { cx: x(r.t), cy: y(r.v), r: rg[0] === 'r1' ? 3.8 : 3.2, fill: c, stroke: solido, 'stroke-width': 1, class: 'sinal ' + rg[0] + (st.regraFoco === rg[0] ? ' foco' : '') }, svg);
        });
      });
    });

    // dica ao passar o mouse
    var guia = el('line', { y1: m.t, y2: H - m.b, class: 'guia', visibility: 'hidden' }, svg);
    var ponto = el('circle', { r: 4.5, class: 'marca', visibility: 'hidden' }, svg);
    var area = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.b - m.t, fill: 'transparent' }, svg);
    var dica = $('biDica'), comValor = p.linhas.filter(function (r) { return r.v != null; });
    area.addEventListener('mousemove', function (ev) {
      var cx = (ev.offsetX / svg.clientWidth) * W, alvoT = t0 + (cx - m.l) / ((W - m.r - m.l) / (t1 + DIA * 0.5 - t0));
      var lo = 0, hi = comValor.length - 1;
      while (hi - lo > 1) { var md = (lo + hi) >> 1; if (comValor[md].t < alvoT) lo = md; else hi = md; }
      var r = Math.abs(comValor[lo].t - alvoT) < Math.abs(comValor[hi].t - alvoT) ? comValor[lo] : comValor[hi];
      guia.setAttribute('x1', x(r.t)); guia.setAttribute('x2', x(r.t)); guia.setAttribute('visibility', 'visible');
      ponto.setAttribute('cx', x(r.t)); ponto.setAttribute('cy', y(r.v)); ponto.setAttribute('visibility', 'visible');
      dica.innerHTML = '<b>' + fmtData(r.t, true) + '</b>' + fmt(r.v, Math.max(dec, 1)) + ' ' + esc(unidadeTitulo(st.serie));
      dica.hidden = false;
      var bx = alvo.getBoundingClientRect(), px = (x(r.t) / W) * bx.width;
      dica.style.left = Math.min(bx.width - 150, Math.max(0, px + 12)) + 'px';
      dica.style.top = ((y(r.v) / H) * bx.height - 10) + 'px';
    });
    area.addEventListener('mouseleave', function () { guia.setAttribute('visibility', 'hidden'); ponto.setAttribute('visibility', 'hidden'); dica.hidden = true; });
  }

  function desenharLimites() {
    var dec = res.decCarta;
    $('biLimCab').innerHTML = [t('bi.th.periodo'), t('bi.th.dias'), 'CL', 'UCL', 'LCL'].map(function (c, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(c) + '</th>'; }).join('') +
      REGRAS.map(function (r, i) { return '<th class="num" title="' + esc(t(r[2])) + '">' + esc(t('bi.th.regra', { n: i + 1 })) + '</th>'; }).join('') + '<th>' + esc(t('bi.r.best')) + '</th>';
    $('biLimCorpo').innerHTML = res.grupos.map(function (g) {
      var s = g.spc;
      return '<tr><td class="per">' + esc(g.rotulo) + '</td><td class="num">' + fmt(g.n, 0) + '</td>' +
        (s ? '<td class="num"><b>' + fmt(s.cl, dec) + '</b></td><td class="num">' + fmt(s.ucl, dec) + '</td><td class="num">' + fmt(s.lcl, dec) + '</td>' : '<td class="num mudo" colspan="3">' + esc(t('bi.semLimite')) + '</td>') +
        REGRAS.map(function (r) { var n = s ? s[r[0]].length : 0; return '<td class="num' + (n ? '' : ' mudo') + '">' + (n ? '<span class="sinal-n" style="--c:var(' + r[1] + ')"><i></i>' + fmt(n, 0) + '</span>' : '—') + '</td>'; }).join('') +
        '<td>' + (g.b30 ? esc(fmtData(g.b30.inicio, true) + ' – ' + fmtData(g.b30.fim, true)) : '<span class="mudo">—</span>') + '</td></tr>';
    }).join('');
  }

  // ── Medidas por período (v4 trimestre / v5 ano) ──
  /** Colunas no padrão do Kaizen/VBM Quarterly: barra + cota de variação contra a anterior */
  function colunas(alvo, o) {
    var vals = o.valores, max = Math.max.apply(null, vals.filter(function (v) { return isFinite(v); }).concat([0]));
    if (!max) { alvo.innerHTML = vazioHtml(t('bi.semDados')); return; }
    var hs = vals.map(function (v) { return isFinite(v) ? Math.max(0, v) / max * 100 : 0; });
    var h = vals.map(function (v, i) {
      var alt = hs[i], cota = '';
      if (i > 0 && isFinite(v) && isFinite(vals[i - 1]) && vals[i - 1] > 0) {
        var ant = vals[i - 1], dd = (v - ant) / ant;
        var cls = Math.abs(dd) < 0.005 ? 'is-flat' : dd > 0 ? 'is-up' : 'is-down';
        var hMin = Math.min(alt, hs[i - 1]), hMax = Math.max(alt, hs[i - 1]);
        cota = '<div class="dcnx ' + cls + '" style="--h-base:' + hs[i - 1] + '%;--h-min:' + hMin + '%;--h-dif:' + (hMax - hMin) + '%;--h-max:' + hMax + '%;--lift:' + (i % 2 ? 0 : 24) + 'px">' +
          '<div class="dref"></div><div class="dnow"></div><div class="dfill ' + (dd >= 0 ? 'up' : 'dn') + '"></div><div class="dspan"></div><div class="dtrack"></div>' +
          '<div class="dpill" title="' + esc((v - ant > 0 ? '+' : '') + fmt(v - ant, o.dec) + ' ' + t('bi.vsAnterior')) + '">' + (dd >= 0 ? SVG_ALTA : SVG_QUEDA) + (dd > 0 ? '+' : '') + fmt(dd * 100, 1) + '%</div></div>';
      }
      return '<div class="col" role="img" aria-label="' + esc(o.rotulos[i] + ': ' + fmt(v, o.dec)) + '" style="--h:' + alt + '%;--c:' + (i === vals.length - 1 ? 'var(--vbm-blue-dark)' : 'var(--vbm-blue)') + '">' + cota +
        '<div class="bar"></div><div class="v-lbl">' + fmt(v, o.dec) + '</div><div class="x-lbl">' + esc(o.rotulos[i]) + '</div></div>';
    }).join('');
    alvo.innerHTML = '<div class="cc" style="--area-h:' + o.altura + 'px;--minw:' + o.minw + 'px;--gap:' + o.gap + 'px;--top-extra:' + o.topo + 'px"><div class="cc-area">' + h + '</div></div>';
  }
  function desenharMedidas() {
    var gs = res.grupos, dec = res.decMed;
    colunas($('biMedidas'), { valores: gs.map(function (g) { return g.mean; }), rotulos: gs.map(function (g) { return g.rotulo; }), dec: dec,
      altura: 220, minw: Math.max(320, gs.length * 74), gap: gs.length > 8 ? 8 : 14, topo: 56 });

    // Média ÷ budget por período
    var comBud = gs.filter(function (g) { return isFinite(g.budget) && g.budget > 0 && isFinite(g.mean); });
    if (!comBud.length) $('biRankBudget').innerHTML = vazioHtml(t('bi.semBudget'));
    else {
      var escalaMax = Math.max(1.1, Math.max.apply(null, comBud.map(function (g) { return g.mean / g.budget; })) * 1.05);
      $('biRankBudget').innerHTML = comBud.map(function (g, i) {
        var r = g.mean / g.budget, bateu = r >= 1;
        return '<div class="rk" role="img" aria-label="' + esc(g.rotulo + ': ' + pct(r)) + '"><span class="rk-nome">' + esc(g.rotulo) + '</span>' +
          '<span class="rk-trilho"><span class="rk-barra" style="--w:' + (r / escalaMax * 100) + '%;--c:' + (bateu ? 'var(--d-up)' : 'var(--vbm-blue)') + ';animation-delay:' + (i * 30) + 'ms"></span><span class="rk-meta" style="--m:' + (100 / escalaMax) + '%"></span></span>' +
          '<span class="rk-val">' + pct(r) + '</span><span class="rk-pct">' + fmt(g.budget, dec) + '</span></div>';
      }).join('');
    }

    // Tabela
    $('biMedCab').innerHTML = [t('bi.th.periodo'), t('bi.serie.mean'), t('bi.th.delta'), t('bi.serie.best'), 'P75', 'Budget', t('bi.th.ating')]
      .map(function (c, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(c) + '</th>'; }).join('');
    $('biMedCorpo').innerHTML = gs.map(function (g, i) {
      var ant = i ? gs[i - 1].mean : NaN, dd = (g.mean - ant) / ant, r = g.mean / g.budget;
      var delta = isFinite(dd) ? '<span class="' + (dd > 0.005 ? 'up' : dd < -0.005 ? 'down' : '') + '">' + (dd > 0 ? '▲ +' : dd < 0 ? '▼ ' : '') + fmt(dd * 100, 1) + '%</span>' : '<span class="mudo">—</span>';
      return '<tr><td class="per">' + esc(g.rotulo) + '</td><td class="num"><b>' + fmt(g.mean, dec) + '</b></td><td class="num">' + delta + '</td><td class="num">' + fmt(g.best, dec) +
        '</td><td class="num">' + fmt(g.p75, dec) + '</td><td class="num">' + fmt(g.budget, dec) + '</td><td class="num' + (isFinite(r) ? (r >= 1 ? ' up' : '') : ' mudo') + '">' + pct(r) + '</td></tr>';
    }).join('');
  }

  // ── Capabilidade (v3): histograma por ano + curva normal ──
  function desenharCapab() {
    var p = res.p, alvo = $('biHist');
    var todos = p.linhas.filter(function (r) { return r.v != null; }).map(function (r) { return r.v; });
    var gmin = Math.min.apply(null, todos), gmax = Math.max.apply(null, todos), BINS = 35;
    var largBin = (gmax - gmin) / BINS || 1;
    var anos = [];
    agrupar(p.linhas, true).forEach(function (g) {
      var v = g.linhas.filter(function (r) { return r.v != null; }).map(function (r) { return r.v; });
      if (v.length < 5) return;
      var cont = new Array(BINS).fill(0);
      v.forEach(function (x) { var i = Math.min(BINS - 1, Math.floor((x - gmin) / largBin)); cont[Math.max(0, i)]++; });
      var mm = media(v), sd = desvio(v);
      anos.push({ ano: g.ano, pct: cont.map(function (c) { return c / v.length * 100; }), media: mm, sd: sd, cv: mm !== 0 ? sd / mm * 100 : NaN, n: v.length, min: Math.min.apply(null, v), max: Math.max.apply(null, v) });
    });
    // cor por recência: o ano mais novo em azul Vale, os anteriores em azul escuro e cinzas
    anos.forEach(function (a, i) { a.cor = cor('--ano-' + Math.min(3, anos.length - 1 - i), '#3cb5e5'); });
    if (st.anoFoco && !anos.some(function (a) { return a.ano === st.anoFoco; })) st.anoFoco = null;
    $('biAnosSeg').innerHTML = anos.length > 1 ? ['<button type="button" data-bi-ano="" aria-pressed="' + (!st.anoFoco) + '">' + esc(t('bi.todos')) + '</button>']
      .concat(anos.map(function (a) { return '<button type="button" data-bi-ano="' + a.ano + '" aria-pressed="' + (st.anoFoco === a.ano) + '">' + a.ano + '</button>'; })).join('') : '';
    $('biAnosCab').innerHTML = [t('bi.h.ano'), t('bi.serie.mean'), t('bi.th.desvio'), 'CV', 'N'].map(function (c, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(c) + '</th>'; }).join('');
    $('biAnosCorpo').innerHTML = anos.map(function (a) {
      return '<tr' + (st.anoFoco && st.anoFoco !== a.ano ? ' style="opacity:.45"' : '') + '><td class="per"><i class="dsc-ano-cor" style="--c:' + a.cor + '"></i>' + a.ano + '</td><td class="num"><b>' + fmt(a.media, 2) + '</b></td><td class="num">' + fmt(a.sd, 2) +
        '</td><td class="num">' + fmt(a.cv, 1) + '%</td><td class="num">' + fmt(a.n, 0) + '</td></tr>';
    }).join('');
    if (!anos.length) { alvo.innerHTML = vazioHtml(t('bi.semDados')); return; }

    var vis = anos.filter(function (a) { return !st.anoFoco || a.ano === st.anoFoco; });
    var W = Math.max(alvo.clientWidth, 300), H = 300, m = { l: 40, r: 12, t: 12, b: 28 };
    var curvas = vis.map(function (a) {
      var pts = [];
      for (var i = 0; i <= 120; i++) {
        var xx = a.min + (a.max - a.min) * i / 120;
        var yy = a.sd > 0 ? (1 / (a.sd * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((xx - a.media) / a.sd, 2)) * 100 * largBin : 0;
        pts.push([xx, yy]);
      }
      return pts;
    });
    var ymax = 0;
    vis.forEach(function (a, i) { a.pct.forEach(function (v) { ymax = Math.max(ymax, v); }); curvas[i].forEach(function (q) { ymax = Math.max(ymax, q[1]); }); });
    ymax *= 1.08;
    var x = escala(gmin, gmax, m.l, W - m.r), y = escala(0, ymax || 1, H - m.b, m.t);
    alvo.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, class: 'dsc-svg', role: 'img', 'aria-label': t('bi.histTitulo') }, alvo);
    ticksBons(0, ymax, 4).forEach(function (v) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grade' }, svg);
      el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'ex' }, svg, fmt(v, 0) + '%');
    });
    var bw = Math.max(0.5, x(gmin + largBin) - x(gmin));
    vis.forEach(function (a) {
      a.pct.forEach(function (v, i) {
        if (!v) return;
        el('rect', { x: x(gmin + i * largBin) + 0.75, y: y(v), width: Math.max(0.5, bw - 1.5), height: H - m.b - y(v), rx: 2, fill: a.cor, opacity: vis.length > 1 ? 0.42 : 0.78, class: 'h-bar' }, svg);
      });
    });
    vis.forEach(function (a, i) {
      el('path', { d: curvas[i].map(function (q, j) { return (j ? 'L' : 'M') + x(q[0]).toFixed(1) + ',' + y(q[1]).toFixed(1); }).join(''), fill: 'none', stroke: a.cor, 'stroke-width': 2.2, 'stroke-dasharray': '6 4' }, svg);
    });
    ticksBons(gmin, gmax, Math.max(3, Math.floor(W / 90))).forEach(function (v) {
      el('text', { x: x(v), y: H - m.b + 17, 'text-anchor': 'middle', class: 'ex' }, svg, fmt(v, Math.abs(gmax - gmin) < 10 ? 1 : 0));
    });
    el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'base' }, svg);

    // dica: faixa de valor e % de cada ano visível
    var area = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.b - m.t, fill: 'transparent' }, svg);
    var dica = $('biHistDica'), dc = Math.abs(gmax - gmin) < 10 ? 2 : 0;
    area.addEventListener('mousemove', function (ev) {
      var cx = (ev.offsetX / svg.clientWidth) * W, i = Math.max(0, Math.min(BINS - 1, Math.floor((cx - m.l) / bw)));
      dica.innerHTML = '<b>' + fmt(gmin + i * largBin, dc) + ' – ' + fmt(gmin + (i + 1) * largBin, dc) + '</b>' +
        vis.map(function (a) { return '<span style="color:' + a.cor + '">●</span> ' + a.ano + ': ' + fmt(a.pct[i], 1) + '%'; }).join('<br>');
      dica.hidden = false;
      var bx = alvo.getBoundingClientRect();
      dica.style.left = Math.min(bx.width - 140, Math.max(0, (x(gmin + (i + 0.5) * largBin) / W) * bx.width + 12)) + 'px';
      dica.style.top = '20px';
    });
    area.addEventListener('mouseleave', function () { dica.hidden = true; });
  }

  // ═══════════════════════════════ filtros (painel lateral) ════════════
  var focoAntes = null;
  function painelFiltros(abrir) {
    var pn = $('biFiltros');
    pn.classList.toggle('open', abrir); $('biFiltrosFundo').classList.toggle('open', abrir);
    pn.setAttribute('aria-hidden', String(!abrir)); $('biAbrirFiltros').setAttribute('aria-expanded', String(abrir));
    if (abrir) { pn.removeAttribute('inert'); focoAntes = document.activeElement; setTimeout(function () { $('biBu').focus(); }, 40); }
    else { pn.setAttribute('inert', ''); if (focoAntes && focoAntes.focus) focoAntes.focus(); }
  }
  function marcarFlags() {
    document.querySelectorAll('[data-bi-flag]').forEach(function (o) {
      var k = o.getAttribute('data-bi-flag');
      o.setAttribute('aria-pressed', String((o.getAttribute('data-valor') === 'sim') === !!st.op[k]));
    });
  }
  function definirPeriodo(ini, fim) {
    $('biInicio').value = ini || ''; $('biFim').value = fim || '';
    st.op.inicio = ini || null; st.op.fim = fim || null;
  }

  function carregarFiltros(forcar) {
    $('biAtualizar').disabled = true;
    var pedido = forcar ? ctx.api('bi/atualizar', { method: 'POST' }).then(function () { return ctx.api('bi/filtros'); }) : ctx.api('bi/filtros');
    return pedido.then(function (f) {
      st.filtros = f; st.erro = null;
      var pref = st.combo ? lerPreferencia() : { bu: 'Salobo', site: 'Salobo', kpi: 'Ore Mined', op: '' }; // padrão do .pbix
      if (!$('biInicio').value) definirPeriodo(f.periodo.min, f.periodo.max);
      $('biInicio').min = $('biFim').min = f.periodo.min; $('biInicio').max = $('biFim').max = f.periodo.max;
      st.op.inicio = $('biInicio').value; st.op.fim = $('biFim').value;
      montarFiltros(pref); carregarSerie();
    }).catch(function (e) {
      st.erro = (e.dados && e.dados.detalhe) ? e.message + ' (' + e.dados.detalhe + ')' : e.message; desenhar();
    }).then(function () { $('biAtualizar').disabled = false; });
  }

  var iniciado = false;
  function ligarEventos() {
    ['biBu', 'biSite', 'biKpi', 'biOp'].forEach(function (id) {
      $(id).addEventListener('change', function () { st.regraFoco = null; st.anoFoco = null; montarFiltros(lerPreferencia()); carregarSerie(); });
    });
    ['biInicio', 'biFim'].forEach(function (id) {
      $(id).addEventListener('change', function () { st.op.inicio = $('biInicio').value || null; st.op.fim = $('biFim').value || null; desenhar(); });
    });
    document.querySelectorAll('[data-bi-flag]').forEach(function (b) {
      b.addEventListener('click', function () { st.op[b.getAttribute('data-bi-flag')] = b.getAttribute('data-valor') === 'sim'; marcarFlags(); desenhar(); });
    });
    document.querySelectorAll('[data-bi-agrup]').forEach(function (b) {
      b.addEventListener('click', function () { st.porAno = b.getAttribute('data-bi-agrup') === 'ano'; desenhar(); });
    });
    $('biAbas').addEventListener('click', function (e) { var b = e.target.closest('[data-vis]'); if (b) mostrarVisao(b.getAttribute('data-vis')); });
    $('biAbas').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var ordem = ['carta', 'medidas', 'capab'], i = (ordem.indexOf(st.vis) + (e.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
      mostrarVisao(ordem[i]); $('biAba-' + ordem[i]).focus();
    });
    $('biTiles').addEventListener('click', function (e) {
      var b = e.target.closest('[data-regra]'); if (!b) return;
      var r = b.getAttribute('data-regra'); st.regraFoco = st.regraFoco === r ? null : r;
      desenharTiles();
      if (st.vis !== 'carta') mostrarVisao('carta'); else desenharCarta();
    });
    $('biAnosSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bi-ano]'); if (!b) return;
      st.anoFoco = b.getAttribute('data-bi-ano') ? Number(b.getAttribute('data-bi-ano')) : null; desenharCapab();
    });
    $('biChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-chip]'); if (!b) return;
      var k = b.getAttribute('data-chip');
      if (!b.hasAttribute('data-remover')) { painelFiltros(true); return; }
      if (k === 'periodo') definirPeriodo(st.filtros.periodo.min, st.filtros.periodo.max);
      else { st.op[k] = false; marcarFlags(); }
      desenhar();
    });
    $('biAbrirFiltros').addEventListener('click', function () { painelFiltros(true); });
    $('biFiltrosFechar').addEventListener('click', function () { painelFiltros(false); });
    $('biFiltrosVer').addEventListener('click', function () { painelFiltros(false); });
    $('biFiltrosFundo').addEventListener('click', function () { painelFiltros(false); });
    $('biFiltrosLimpar').addEventListener('click', function () {
      if (st.filtros) definirPeriodo(st.filtros.periodo.min, st.filtros.periodo.max);
      st.op.removerZeros = false; st.op.removerOutliers = false; marcarFlags(); desenhar();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('biFiltros').classList.contains('open')) painelFiltros(false); });
    $('biAtualizar').addEventListener('click', function () { carregarFiltros(true); });
    var pend = null;
    window.addEventListener('resize', function () { clearTimeout(pend); pend = setTimeout(function () { if (!$('vista-powerbi').hidden) desenharVisao(); }, 150); });
  }

  window.PainelSPC = {
    iniciar: function (c) {
      ctx = c;
      if (iniciado) { desenhar(); return; }
      iniciado = true;
      ligarEventos(); marcarFlags();
      var aba = 'carta';
      try { aba = localStorage.getItem('sc-dashboard-aba') || 'carta'; } catch (e) {}
      mostrarVisao(['carta', 'medidas', 'capab'].indexOf(aba) >= 0 ? aba : 'carta');
      st.carregando = true; esqueleto();
      ALVOS.forEach(function (id) { $(id).innerHTML = vazioHtml(t('ui.loading')); });
      carregarFiltros(false);
    },
    // troca de idioma, formato numérico ou tema (as cores dos gráficos dependem do tema)
    redesenhar: function () { if (iniciado) desenhar(); }
  };
})();
