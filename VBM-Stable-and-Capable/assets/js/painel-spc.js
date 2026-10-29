/*
 * VBM Stable & Capable — painel SPC (aba "Power BI").
 *
 * Reprodução da página "Stable and capable" do Stable_and_Capable_3.pbix, com
 * a MESMA lógica dos visuais Python de lá (control chart por trimestre/ano,
 * estatísticas e comparações, histograma de capabilidade). Cada bloco abaixo
 * cita o trecho de origem. Os dados vêm de api/bi (bi-api.js, banco PRD).
 *
 * Desenho em SVG próprio (sem biblioteca externa: a rede corporativa bloqueia
 * CDNs, ver poppins.css). Cores das séries iguais às do .pbix.
 *
 *   PainelSPC.iniciar({ api, t, lang: () => lang })   // uma vez
 *   PainelSPC.redesenhar()                            // troca de idioma/tema
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

  /** Cores do .pbix; no tema escuro, as que somem no fundo azul vêm do CSS (--bi-media, --bi-r3) */
  function corTema(nome, padrao) { var v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim(); return v || padrao; }

  // ═════════════════════════════ estado/UI ═════════════════════════════
  var ctx = null; // { api, t, lang }
  var st = { filtros: null, combo: null, serie: null, op: { removerZeros: false, removerOutliers: false, inicio: null, fim: null }, porAno: false, carregando: false, erro: null };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var t = function (k, v) { return ctx.t(k, v); };
  var L = function () { return ctx.lang(); };
  function fmt(x, dec) { return (x == null || isNaN(x)) ? '—' : Number(x).toLocaleString(L(), { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
  function fmtData(ms, comAno) { var d = new Date(ms); return d.toLocaleDateString(L(), comAno ? { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', timeZone: 'UTC' }); }
  function mesCurto(ms) { return new Date(ms).toLocaleDateString(L(), { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', ''); }

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
    st.carregando = true; desenharTitulo();
    ctx.api('bi/serie?id=' + encodeURIComponent(id)).then(function (s) {
      if (!st.combo || st.combo.id !== id) return; // trocou no meio
      st.serie = s; st.erro = null;
    }).catch(function (e) { st.erro = e.message; st.serie = null; })
      .then(function () { st.carregando = false; desenhar(); });
  }

  // ═══════════════════════════════ desenho ═════════════════════════════
  function desenharTitulo() {
    var s = st.combo;
    $('biTitulo').textContent = s ? s.site + ' ' + s.op + ' - ' + s.kpi + ' (' + unidadeTitulo(s) + ')' : t('bi.selecione');
  }

  function vazio(alvo, msg) { alvo.innerHTML = '<div class="bi-msg">' + esc(msg) + '</div>'; }

  function desenhar() {
    if (!ctx) return;
    desenharTitulo();
    document.querySelectorAll('[data-bi-agrup]').forEach(function (b) { b.classList.toggle('active', (b.getAttribute('data-bi-agrup') === 'ano') === st.porAno); });
    ['biCarta', 'biMedidas', 'biHist'].forEach(function (id) { $(id).classList.toggle('carregando', st.carregando); });
    if (st.erro) { ['biCarta', 'biMedidas', 'biHist'].forEach(function (id) { vazio($(id), st.erro); }); return; }
    if (!st.serie) { if (!st.carregando) ['biCarta', 'biMedidas', 'biHist'].forEach(function (id) { vazio($(id), t('bi.selecione')); }); return; }
    var p = preparar(st.serie, st.op);
    if (!p.linhas.length) { ['biCarta', 'biMedidas', 'biHist'].forEach(function (id) { vazio($(id), t('bi.semDados')); }); return; }
    desenharCarta(p); desenharMedidas(p); desenharHistograma(p);
  }

  // ── Control Chart (v1 trimestre / v2 ano) ──
  function desenharCarta(p) {
    var alvo = $('biCarta'), porAno = st.porAno;
    var W = Math.max(alvo.clientWidth, 480), H = 400, m = { l: 58, r: 14, t: 34, b: 30 };
    var grupos = agrupar(p.linhas, porAno), dec = decimaisCarta(p, porAno);
    var spc = grupos.map(function (g) { return spcGrupo(g, porAno); });
    var vals = p.linhas.filter(function (r) { return r.v != null; }).map(function (r) { return r.v; });
    spc.forEach(function (s) { if (s) { vals.push(s.ucl, s.lcl); } });
    var ymin = Math.min.apply(null, vals), ymax = Math.max.apply(null, vals);
    var pad = (ymax - ymin || Math.abs(ymax) || 1) * 0.06; ymin -= pad; ymax += pad;
    var t0 = p.linhas[0].t, t1 = p.linhas[p.linhas.length - 1].t;
    var x = escala(t0, t1 + DIA * 0.5, m.l, W - m.r), y = escala(ymin, ymax, H - m.b, m.t);
    alvo.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, class: 'bi-svg', role: 'img', 'aria-label': t('bi.carta') }, alvo);

    // Best 30 Days (faixa dourada) por grupo
    grupos.forEach(function (g) {
      var b = melhor30(g.linhas);
      if (!b) return;
      el('rect', { x: x(b.inicio), y: m.t, width: Math.max(1, x(b.fim) - x(b.inicio)), height: H - m.b - m.t, fill: 'gold', opacity: porAno ? 0.28 : 0.13 }, svg);
      var cx = (x(b.inicio) + x(b.fim)) / 2;
      var txt = fmtData(b.inicio) + ' - ' + fmtData(b.fim);
      var gr = el('g', { class: 'bi-best' }, svg);
      el('rect', { x: cx - 44, y: H - m.b - 30, width: 88, height: 26, rx: 4, fill: 'var(--bi-caixa)', stroke: '#B8860B', 'stroke-width': .8, opacity: .9 }, gr);
      el('text', { x: cx, y: H - m.b - 19, 'text-anchor': 'middle', class: 'bi-t-best' }, gr, t('bi.periodo'));
      el('text', { x: cx, y: H - m.b - 8, 'text-anchor': 'middle', class: 'bi-t-best' }, gr, txt);
    });

    // eixos
    ticksBons(ymin, ymax, 5).forEach(function (v) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'bi-grade' }, svg);
      el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'bi-eixo' }, svg, fmt(v, Math.abs(ymax - ymin) < 10 ? 2 : 0));
    });
    var meses = [], d = new Date(t0); d.setUTCDate(1);
    while (d.getTime() <= t1) { if (d.getTime() >= t0) meses.push(d.getTime()); d.setUTCMonth(d.getUTCMonth() + 1); }
    var passoMes = Math.max(1, Math.ceil(meses.length / Math.floor((W - m.l - m.r) / 70)));
    meses.forEach(function (ms, i) { if (i % passoMes === 0) el('text', { x: x(ms), y: H - m.b + 18, 'text-anchor': 'middle', class: 'bi-eixo' }, svg, mesCurto(ms)); });
    el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'bi-base' }, svg);
    el('line', { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: 'bi-base' }, svg);

    // separadores de grupo
    grupos.slice(1).forEach(function (g) { var xx = x(g.linhas[0].t); el('line', { x1: xx, x2: xx, y1: m.t, y2: H - m.b, stroke: '#c0c0c0', 'stroke-width': 1.1 }, svg); });

    // série
    var dpath = '', aberto = false;
    p.linhas.forEach(function (r) { if (r.v == null) { aberto = false; return; } dpath += (aberto ? 'L' : 'M') + x(r.t).toFixed(1) + ',' + y(r.v).toFixed(1); aberto = true; });
    el('path', { d: dpath, fill: 'none', stroke: '#c0c0c0', 'stroke-width': 1, opacity: porAno ? .7 : .85 }, svg);

    // limites + rótulos + nome do grupo
    grupos.forEach(function (g, i) {
      var s = spc[i], xa = x(g.linhas[0].t), xb = x(g.linhas[g.linhas.length - 1].t), xm = x(g.linhas[Math.floor(g.linhas.length / 2)].t);
      if (!s) return; // como no script: grupo sem limites também fica sem rótulo
      var rot = el('g', {}, svg);
      el('rect', { x: xm - 26, y: 6, width: 52, height: 20, rx: 6, fill: 'var(--bi-rotulo)', stroke: '#555', 'stroke-width': .8 }, rot);
      el('text', { x: xm, y: 20, 'text-anchor': 'middle', class: 'bi-t-grupo' }, rot, g.chave);
      el('line', { x1: xa, x2: xb, y1: y(s.ucl), y2: y(s.ucl), stroke: 'red', 'stroke-width': 1, 'stroke-dasharray': '2 3' }, svg);
      el('line', { x1: xa, x2: xb, y1: y(s.lcl), y2: y(s.lcl), stroke: 'red', 'stroke-width': 1, 'stroke-dasharray': '2 3' }, svg);
      el('line', { x1: xa, x2: xb, y1: y(s.cl), y2: y(s.cl), stroke: 'green', 'stroke-width': 3 }, svg);
      var xl = x(g.linhas[0].t + (porAno ? 5 : 10) * DIA);
      [['UCL', s.ucl, 'red', 'bi-t-lim'], ['CL', s.cl, corTema('--bi-cl', 'green'), 'bi-t-cl'], ['LCL', s.lcl, 'red', 'bi-t-lim']].forEach(function (a) {
        el('text', { x: xl, y: y(a[1]) - 5, class: a[3], fill: a[2] }, svg, a[0] + ' = ' + fmt(a[1], dec));
      });
    });

    // violações (ordem de desenho do script: 4, 3, 2, 1)
    var r3 = corTema('--bi-r3', '#000000');
    var regras = [['r4', '#ffa500', '#8a2be2'], ['r3', r3, r3], ['r2', '#007e7a', '#007e7a'], ['r1', '#ff0000', '#ff0000']];
    regras.forEach(function (rg) {
      spc.forEach(function (s) { if (s) s[rg[0]].forEach(function (r) { el('circle', { cx: x(r.t), cy: y(r.v), r: 3.2, fill: rg[1], stroke: rg[2], 'stroke-width': 1 }, svg); }); });
    });

    // dica ao passar o mouse
    var guia = el('line', { y1: m.t, y2: H - m.b, class: 'bi-guia', visibility: 'hidden' }, svg);
    var ponto = el('circle', { r: 4, class: 'bi-ponto', visibility: 'hidden' }, svg);
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

  // ── Statistical Measures and Comparisons (v4 trimestre / v5 ano) ──
  var CORES_BARRA = { mean: '#0B3C5D', best: '#6C83B5', p75: '#A6B1D9', budget: '#00A3E0' };
  function desenharMedidas(p) {
    var alvo = $('biMedidas'), porAno = st.porAno, dec = decimaisMedidas(p, porAno);
    CORES_BARRA.mean = corTema('--bi-media', '#0B3C5D');
    var grupos = agrupar(p.linhas, porAno).map(function (g) {
      var b = melhor30(g.linhas);
      return {
        rotulo: porAno ? String(g.ano) : 'Q' + g.tri + ' ' + g.ano,
        mean: media(g.linhas.map(function (r) { return r.v; })),
        best: b ? b.media : NaN,
        p75: quantil(g.linhas.map(function (r) { return r.v; }), 0.75),
        budget: media(g.linhas.map(function (r) { return r.b; })),
      };
    });
    var todos = []; grupos.forEach(function (g) { ['mean', 'best', 'p75', 'budget'].forEach(function (k) { if (!isNaN(g[k])) todos.push(g[k]); }); });
    alvo.innerHTML = '';
    if (!todos.length) { vazio(alvo, t('bi.semDados')); return; }
    var lo = Math.min.apply(null, todos), hi = Math.max.apply(null, todos), pad = (hi - lo || Math.abs(hi) || 1) * 0.15;
    lo -= pad; hi += pad; // "Zoom automático no eixo Y" do script

    var leg = document.createElement('div'); leg.className = 'bi-legenda';
    leg.innerHTML = [['mean', 'Mean'], ['best', 'Best 30 Days'], ['p75', 'P75'], ['budget', 'Budget']]
      .map(function (k) { return '<span><i style="background:' + CORES_BARRA[k[0]] + '"></i>' + esc(t('bi.serie.' + k[0])) + '</span>'; }).join('');
    alvo.appendChild(leg);
    var linha = document.createElement('div'); linha.className = 'bi-medidas-linha'; alvo.appendChild(linha);
    var caixaSvg = document.createElement('div'); caixaSvg.className = 'bi-medidas-svg'; linha.appendChild(caixaSvg);

    // variação da média (pct_change)
    var varia = document.createElement('div'); varia.className = 'bi-variacao';
    var itens = [];
    for (var i = 1; i < grupos.length; i++) {
      var a = grupos[i - 1].mean, b2 = grupos[i].mean;
      if (isNaN(a) || isNaN(b2) || a === 0) continue;
      var pct = (b2 - a) / a * 100;
      itens.push('<li class="' + (pct > 0 ? 'sobe' : 'desce') + '"><span>' + esc(grupos[i - 1].rotulo) + ' → ' + esc(grupos[i].rotulo) + '</span><b>' + (pct > 0 ? '▲ +' : '▼ ') + fmt(pct, 1) + '%</b></li>');
    }
    varia.innerHTML = '<h4>' + esc(t('bi.variacao')) + '</h4>' + (itens.length ? '<ul>' + itens.join('') + '</ul>' : '<p>—</p>');
    linha.appendChild(varia);

    var W = Math.max(caixaSvg.clientWidth, 320), H = 280, m = { l: 8, r: 8, t: 24, b: 28 };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, class: 'bi-svg', role: 'img', 'aria-label': t('bi.medidas') }, caixaSvg);
    var y = escala(lo, hi, H - m.b, m.t), larg = (W - m.l - m.r) / Math.max(grupos.length, 1), bw = Math.min(larg * 0.21, 46);
    var fonte = porAno ? 13 : (grupos.length > 8 ? 8 : grupos.length > 5 ? 9 : 10.5);
    grupos.forEach(function (g, gi) {
      var cx = m.l + larg * (gi + 0.5);
      [['mean', -1.5], ['best', -0.5], ['p75', 0.5], ['budget', 1.5]].forEach(function (k) {
        var v = g[k[0]]; if (isNaN(v)) return;
        var bx = cx + k[1] * bw - bw / 2, by = y(v);
        el('rect', { x: bx, y: by, width: bw - 1, height: Math.max(0, H - m.b - by), fill: CORES_BARRA[k[0]] }, svg);
        el('text', { x: bx + bw / 2, y: by - 4, 'text-anchor': 'middle', fill: CORES_BARRA[k[0]], class: 'bi-t-barra', 'font-size': fonte }, svg, fmt(v, dec));
      });
      el('text', { x: cx, y: H - m.b + 18, 'text-anchor': 'middle', class: 'bi-eixo' }, svg, g.rotulo);
    });
    el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'bi-base' }, svg);
  }

  // ── Capability Histogram (v3) ──
  var HIST_PREENCH = { 2024: '#f6caca', 2025: '#e9f0f8', 2026: '#D5F5E3' };
  var HIST_LINHA = { 2024: '#e56768', 2025: '#3985e4', 2026: '#006D5B' };
  function desenharHistograma(p) {
    var alvo = $('biHist');
    var todos = p.linhas.filter(function (r) { return r.v != null; }).map(function (r) { return r.v; });
    alvo.innerHTML = '';
    if (!todos.length) { vazio(alvo, t('bi.semDados')); return; }
    var gmin = Math.min.apply(null, todos), gmax = Math.max.apply(null, todos), BINS = 35;
    var largBin = (gmax - gmin) / BINS || 1;
    var anos = [];
    agrupar(p.linhas, true).forEach(function (g) {
      var v = g.linhas.filter(function (r) { return r.v != null; }).map(function (r) { return r.v; });
      if (v.length < 5) return;
      var cont = new Array(BINS).fill(0);
      v.forEach(function (x) { var i = Math.min(BINS - 1, Math.floor((x - gmin) / largBin)); cont[Math.max(0, i)]++; });
      var mm = media(v), sd = desvio(v);
      anos.push({ ano: g.ano, v: v, pct: cont.map(function (c) { return c / v.length * 100; }), media: mm, sd: sd, cv: mm !== 0 ? sd / mm * 100 : NaN, n: v.length, min: Math.min.apply(null, v), max: Math.max.apply(null, v) });
    });
    if (!anos.length) { vazio(alvo, t('bi.semDados')); return; }

    var tab = document.createElement('table'); tab.className = 'bi-hist-legenda';
    tab.innerHTML = '<thead><tr><th></th><th>' + esc(t('bi.h.ano')) + '</th><th>Mean</th><th>StDev</th><th>CV(%)</th><th>N</th></tr></thead><tbody>' +
      anos.map(function (a) {
        return '<tr><td><span class="bi-amostra" style="background:' + (HIST_PREENCH[a.ano] || '#D5D8DC') + ';--cor-linha:' + (HIST_LINHA[a.ano] || '#000') + '"></span></td><td>' + a.ano + '</td><td>' + fmt(a.media, 2) +
          '</td><td>' + fmt(a.sd, 2) + '</td><td>' + fmt(a.cv, 1) + '%</td><td>' + a.n + '</td></tr>';
      }).join('') + '</tbody>';
    alvo.appendChild(tab);

    var W = Math.max(alvo.clientWidth, 300), H = 250, m = { l: 34, r: 10, t: 10, b: 26 };
    var curvas = anos.map(function (a) {
      var pts = [];
      for (var i = 0; i <= 120; i++) {
        var xx = a.min + (a.max - a.min) * i / 120;
        var yy = a.sd > 0 ? (1 / (a.sd * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((xx - a.media) / a.sd, 2)) * 100 * largBin : 0;
        pts.push([xx, yy]);
      }
      return pts;
    });
    var ymax = 0;
    anos.forEach(function (a, i) { a.pct.forEach(function (v) { ymax = Math.max(ymax, v); }); curvas[i].forEach(function (q) { ymax = Math.max(ymax, q[1]); }); });
    ymax *= 1.08;
    var x = escala(gmin, gmax, m.l, W - m.r), y = escala(0, ymax || 1, H - m.b, m.t);
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, class: 'bi-svg', role: 'img', 'aria-label': t('bi.hist') }, alvo);
    ticksBons(0, ymax, 4).forEach(function (v) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'bi-grade' }, svg);
      el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'bi-eixo' }, svg, fmt(v, 0));
    });
    anos.forEach(function (a) {
      a.pct.forEach(function (v, i) {
        if (!v) return;
        el('rect', { x: x(gmin + i * largBin), y: y(v), width: Math.max(0.5, x(gmin + largBin) - x(gmin)), height: H - m.b - y(v), fill: HIST_PREENCH[a.ano] || '#D5D8DC', opacity: .5, stroke: 'var(--bi-borda-barra)', 'stroke-width': 1 }, svg);
      });
    });
    anos.forEach(function (a, i) {
      el('path', { d: curvas[i].map(function (q, j) { return (j ? 'L' : 'M') + x(q[0]).toFixed(1) + ',' + y(q[1]).toFixed(1); }).join(''), fill: 'none', stroke: HIST_LINHA[a.ano] || '#000', 'stroke-width': 2.5, 'stroke-dasharray': '7 4' }, svg);
    });
    ticksBons(gmin, gmax, Math.max(3, Math.floor(W / 90))).forEach(function (v) {
      el('text', { x: x(v), y: H - m.b + 16, 'text-anchor': 'middle', class: 'bi-eixo' }, svg, fmt(v, Math.abs(gmax - gmin) < 10 ? 1 : 0));
    });
    el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'bi-base' }, svg);
  }

  // ═══════════════════════════════ início ══════════════════════════════
  function legendaCarta() {
    $('biLegendaCarta').innerHTML = [
      ['linha', '#c0c0c0', t('bi.r.valores')], ['ponto', '#ff0000', t('bi.r.r1')], ['ponto', '#007e7a', t('bi.r.r2')],
      ['ponto', corTema('--bi-r3', '#000000'), t('bi.r.r3')], ['ponto4', '#ffa500', t('bi.r.r4')], ['faixa', 'gold', t('bi.r.best')],
    ].map(function (i) { return '<span><i class="bi-sym ' + i[0] + '" style="--c:' + i[1] + '"></i>' + esc(i[2]) + '</span>'; }).join('');
  }

  function atualizarRodape() {
    var f = st.filtros;
    $('biAtualizado').textContent = f ? t('bi.atualizado', { quando: new Date(f.atualizadoEm).toLocaleString(L(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), banco: f.banco }) : '';
  }

  function carregarFiltros(forcar) {
    $('biAtualizar').disabled = true;
    var pedido = forcar ? ctx.api('bi/atualizar', { method: 'POST' }).then(function () { return ctx.api('bi/filtros'); }) : ctx.api('bi/filtros');
    return pedido.then(function (f) {
      st.filtros = f; st.erro = null;
      var pref = st.combo ? lerPreferencia() : { bu: 'Salobo', site: 'Salobo', kpi: 'Ore Mined', op: '' }; // padrão do .pbix
      if (!$('biInicio').value) { $('biInicio').value = f.periodo.min; $('biFim').value = f.periodo.max; }
      $('biInicio').min = $('biFim').min = f.periodo.min; $('biInicio').max = $('biFim').max = f.periodo.max;
      st.op.inicio = $('biInicio').value; st.op.fim = $('biFim').value;
      montarFiltros(pref); atualizarRodape(); carregarSerie();
    }).catch(function (e) {
      st.erro = (e.dados && e.dados.detalhe) ? e.message + ' (' + e.dados.detalhe + ')' : e.message; desenhar();
    }).then(function () { $('biAtualizar').disabled = false; });
  }

  var iniciado = false;
  window.PainelSPC = {
    iniciar: function (c) {
      ctx = c;
      legendaCarta();
      if (iniciado) { desenhar(); return; }
      iniciado = true;
      ['biBu', 'biSite', 'biKpi', 'biOp'].forEach(function (id) {
        $(id).addEventListener('change', function () { montarFiltros(lerPreferencia()); carregarSerie(); });
      });
      ['biInicio', 'biFim'].forEach(function (id) {
        $(id).addEventListener('change', function () { st.op.inicio = $('biInicio').value || null; st.op.fim = $('biFim').value || null; desenhar(); });
      });
      document.querySelectorAll('[data-bi-flag]').forEach(function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-bi-flag'), v = b.getAttribute('data-valor') === 'sim';
          st.op[k] = v;
          document.querySelectorAll('[data-bi-flag="' + k + '"]').forEach(function (o) { o.classList.toggle('active', (o.getAttribute('data-valor') === 'sim') === v); });
          desenhar();
        });
      });
      document.querySelectorAll('[data-bi-agrup]').forEach(function (b) {
        b.addEventListener('click', function () { st.porAno = b.getAttribute('data-bi-agrup') === 'ano'; desenhar(); });
      });
      $('biAtualizar').addEventListener('click', function () { carregarFiltros(true); });
      var pend = null;
      window.addEventListener('resize', function () { clearTimeout(pend); pend = setTimeout(function () { if (!$('vista-powerbi').hidden) desenhar(); }, 150); });
      ['biCarta', 'biMedidas', 'biHist'].forEach(function (id) { vazio($(id), t('ui.loading')); });
      carregarFiltros(false);
    },
    redesenhar: function () { if (iniciado) { legendaCarta(); atualizarRodape(); desenhar(); } },
  };
})();
