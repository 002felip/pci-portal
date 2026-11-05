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
    porAno: false,
    sel: { bu: '', site: '', kpi: '', op: '' } // seleção atual (BU › Site, KPI, Operação)
  };
  var buNav = null; // BU aberta na coluna da esquerda do seletor BU › Site (ainda sem escolher o site)
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
  var REGRAS = [['r1', '--c-r1', 'bi.r.r1'], ['r2', '--c-r2', 'bi.r.r2'], ['r3', '--c-r3', 'bi.r.r3'], ['r4', '--c-r4', 'bi.r.r4']];

  function unicos(lista, campo) { var s = []; lista.forEach(function (c) { if (s.indexOf(c[campo]) < 0) s.push(c[campo]); }); return s; }
  function escolher(valores, atual) { return valores.indexOf(atual) >= 0 ? atual : (valores[0] || ''); }

  /** Cascata BU → Site → KPI → Operação (operação só aparece quando há mais de uma) */
  function montarFiltros(pref) {
    var lista = st.filtros.combinacoes;
    var bu = escolher(unicos(lista, 'bu'), pref.bu);
    var l1 = lista.filter(function (c) { return c.bu === bu; });
    var site = escolher(unicos(l1, 'site'), pref.site);
    var l2 = l1.filter(function (c) { return c.site === site; });
    var kpi = escolher(unicos(l2, 'kpi'), pref.kpi);
    var l3 = l2.filter(function (c) { return c.kpi === kpi; });
    var op = escolher(unicos(l3, 'op'), pref.op);
    st.sel = { bu: bu, site: site, kpi: kpi, op: op };
    $('biOpGrupo').hidden = unicos(l3, 'op').length < 2;
    st.combo = l3.filter(function (c) { return c.op === op; })[0] || null;
    buNav = bu;
    desenharSeletores();
  }
  function lerPreferencia() { return { bu: st.sel.bu, site: st.sel.site, kpi: st.sel.kpi, op: st.sel.op }; }

  /** Seletores no padrão do COO – Business Units Dashboard: gatilho com o valor atual e lista em popover */
  function botaoLista(attr, v, marcado, extra) {
    return '<button type="button" ' + attr + '="' + esc(v) + '" aria-pressed="' + marcado + '"><span>' + esc(v || '—') + '</span>' + (extra || '') + '</button>';
  }
  function desenharSeletores() {
    if (!st.filtros) return;
    var lista = st.filtros.combinacoes, s = st.sel;
    $('biBuTxt').textContent = s.bu || '—'; $('biSiteTxt').textContent = s.site || '—';
    $('biKpiTxt').textContent = s.kpi || '—'; $('biOpTxt').textContent = s.op || '—';
    $('biBuLista').innerHTML = unicos(lista, 'bu').map(function (b) {
      var n = unicos(lista.filter(function (c) { return c.bu === b; }), 'site').length;
      return '<button type="button" data-bu="' + esc(b) + '" aria-current="' + (b === buNav) + '"><span>' + esc(b) + '</span><span class="n">' + n + '</span></button>';
    }).join('');
    $('biSiteLista').innerHTML = unicos(lista.filter(function (c) { return c.bu === buNav; }), 'site').map(function (x) {
      return botaoLista('data-site', x, buNav === s.bu && x === s.site);
    }).join('');
    var l2 = lista.filter(function (c) { return c.bu === s.bu && c.site === s.site; });
    $('biKpiLista').innerHTML = unicos(l2, 'kpi').map(function (k) { return botaoLista('data-kpi', k, k === s.kpi); }).join('');
    $('biOpLista').innerHTML = unicos(l2.filter(function (c) { return c.kpi === s.kpi; }), 'op').map(function (o) { return botaoLista('data-op', o, o === s.op); }).join('');
  }
  var popAberto = null;
  function abrirPop(id) {
    if (popAberto && popAberto !== id) fecharPop(false);
    var pop = $(id), gat = document.querySelector('[aria-controls="' + id + '"]');
    if (!pop.hidden) { fecharPop(true); return; }
    if (id === 'biBuPop') { buNav = st.sel.bu; desenharSeletores(); }
    pop.hidden = false; gat.setAttribute('aria-expanded', 'true'); popAberto = id;
    var foco = pop.querySelector('[aria-pressed="true"]') || pop.querySelector('[aria-current="true"]') || pop.querySelector('button');
    if (foco) foco.focus();
  }
  function fecharPop(focarGatilho) {
    if (!popAberto) return;
    var id = popAberto, gat = document.querySelector('[aria-controls="' + id + '"]');
    $(id).hidden = true; gat.setAttribute('aria-expanded', 'false'); popAberto = null;
    if (focarGatilho) gat.focus();
  }
  function escolherFiltro(pref) { fecharPop(true); montarFiltros(pref); carregarSerie(); }

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
    return {
      p: p, porAno: porAno, grupos: grupos,
      decCarta: decimaisCarta(p, porAno), decMed: decimaisMedidas(p, porAno),
      t0: p.linhas[0].t, t1: p.linhas[p.linhas.length - 1].t
    };
  }

  // ═══════════════════════════════ desenho ═════════════════════════════
  /** Alturas dos gráficos. Até 1600 px de largura ficam fixas (como antes); em telas maiores
   *  acompanham a altura da janela, com piso e teto, para a página não sobrar em branco nem
   *  esticar demais. As barras de Medidas seguem o histograma ao lado (legenda + gráfico). */
  var redimensionando = false; // redesenho por resize: sem a animação de crescer as barras de novo
  function alturasDashboard() {
    var vw = window.innerWidth, vh = window.innerHeight;
    if (vw < 1600) return { carta: 380, hist: 300, barras: null };
    var gigante = vw >= 3000; // 4K a 100% de escala: tetos maiores
    var carta = Math.round(Math.min(gigante ? 760 : 520, Math.max(380, vh * 0.36)));
    var hist = Math.round(Math.min(gigante ? 600 : 420, Math.max(300, vh * 0.28)));
    return { carta: carta, hist: hist, barras: hist + 40 };
  }
  function vazioHtml(msg) { return '<div class="dsc-vazio">' + esc(msg) + '</div>'; }
  var ALVOS = ['biCarta', 'biMedidas', 'biHist'];

  function desenhar() {
    if (!ctx) return;
    desenharHero();
    document.querySelectorAll('[data-bi-agrup]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.getAttribute('data-bi-agrup') === 'ano') === st.porAno)); });
    ALVOS.forEach(function (id) { $(id).classList.toggle('carregando', st.carregando); });
    res = null;
    var msg = st.erro || (!st.serie ? (st.carregando ? null : t('bi.selecione')) : null);
    if (!msg && st.serie) {
      var p = preparar(st.serie, st.op);
      if (!p.linhas.length) msg = t('bi.semDados'); else res = calcular(p);
    }
    if (!res) {
      if (msg) {
        ALVOS.forEach(function (id) { $(id).innerHTML = vazioHtml(msg); });
        ['biAnosCab', 'biAnosCorpo', 'biLegendaCarta', 'biLegendaMedidas', 'biVariacao'].forEach(function (id) { $(id).innerHTML = ''; });
        $('biCartaSub').textContent = '';
      }
      return;
    }
    desenharHero();
    desenharVisao();
  }

  /** A página do .pbix tem os três visuais juntos: carta, medidas e histograma */
  function desenharVisao() {
    if (!res) return;
    desenharCarta(); desenharMedidas(); desenharCapab();
  }

  // ── Hero e etiquetas ──
  function desenharHero() {
    var s = st.combo;
    $('biTitulo').textContent = s ? (s.site + (s.op ? ' ' + s.op : '')) : t('bi.selecione');
    $('biSub').textContent = s ? [s.kpi, unidadeTitulo(s), s.bu].filter(Boolean).join(' · ') : '';
    $('biQtdPeriodo').textContent = res ? fmtData(res.t0, true) + ' – ' + fmtData(res.t1, true) : '—';
    var f = st.filtros;
    $('biAtualizado').textContent = f ? t('bi.atualizado', { quando: new Date(f.atualizadoEm).toLocaleString(L(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), banco: f.banco }) : '';
    $('biFiltrosLimpar').disabled = qtdFiltros() === 0;
  }
  function periodoCompleto() {
    var f = st.filtros; if (!f) return true;
    return (!st.op.inicio || st.op.inicio <= f.periodo.min) && (!st.op.fim || st.op.fim >= f.periodo.max);
  }
  function qtdFiltros() { return (periodoCompleto() ? 0 : 1) + (st.op.removerZeros ? 1 : 0) + (st.op.removerOutliers ? 1 : 0); }

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
    var W = Math.max(alvo.clientWidth, 480), H = alturasDashboard().carta, m = { l: 52, r: 16, t: 40, b: 30 };
    var vals = p.linhas.filter(function (r) { return r.v != null; }).map(function (r) { return r.v; });
    gs.forEach(function (x) { if (x.spc) vals.push(x.spc.ucl, x.spc.lcl); });
    var ymin = Math.min.apply(null, vals), ymax = Math.max.apply(null, vals);
    var pad = (ymax - ymin || Math.abs(ymax) || 1) * 0.06; ymin -= pad; ymax += pad;
    var t0 = res.t0, t1 = res.t1;
    var x = escala(t0, t1 + DIA * 0.5, m.l, W - m.r), y = escala(ymin, ymax, H - m.b, m.t);
    alvo.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, class: 'dsc-svg', role: 'img', 'aria-label': t('bi.carta') }, alvo);
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
          el('circle', { cx: x(r.t), cy: y(r.v), r: rg[0] === 'r1' ? 3.8 : 3.2, fill: c, stroke: solido, 'stroke-width': 1, class: 'sinal ' + rg[0] }, svg);
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

  // ── Medidas por período (v4 trimestre / v5 ano) ──
  /** v4/v5 do .pbix: quatro barras por período (Mean, Best 30 Days, P75, Budget), com o
   *  "zoom automático no eixo Y" do script (mín. e máx. ± 15% da amplitude), desenhadas no
   *  estilo das colunas do Kaizen. Ao lado, a caixa "Variação da média" (pct_change). */
  var MEDIDAS = ['mean', 'best', 'p75', 'budget'];
  function desenharMedidas() {
    var gs = res.grupos, dec = res.decMed, alvo = $('biMedidas');
    $('biLegendaMedidas').innerHTML = MEDIDAS.map(function (k) { return '<span><i class="lg-faixa" style="--c:var(--m-' + k + ')"></i>' + esc(t('bi.serie.' + k)) + '</span>'; }).join('');
    var todos = []; gs.forEach(function (g) { MEDIDAS.forEach(function (k) { if (isFinite(g[k])) todos.push(g[k]); }); });
    if (!todos.length) { alvo.innerHTML = vazioHtml(t('bi.semDados')); }
    else {
      var lo = Math.min.apply(null, todos), hi = Math.max.apply(null, todos), pad = (hi - lo || Math.abs(hi) || 1) * 0.15;
      lo -= pad; hi += pad;
      // Sem rolagem lateral (como no .pbix): as barras se ajustam à largura do card e os
      // rótulos acompanham — valor menor quando a coluna estreita, ano em segunda linha no eixo
      var larg = Math.max(alvo.clientWidth, 200), porGrupo = larg / gs.length;
      var gap = Math.round(Math.max(4, Math.min(18, porGrupo * 0.14)));
      var colw = Math.max(2, (porGrupo - gap) / MEDIDAS.length - 3);
      var maxChars = 1; gs.forEach(function (g) { MEDIDAS.forEach(function (k) { if (isFinite(g[k])) maxChars = Math.max(maxChars, fmt(g[k], dec).length); }); });
      var fvPx = Math.min(window.innerWidth >= 3000 ? 15 : window.innerWidth >= 1600 ? 12 : 10.5, (colw + 3) / (maxChars * 0.62));
      var duasLinhas = porGrupo < 58;
      var classes = 'cg' + (redimensionando ? ' cg-estatico' : '') + (fvPx < 6.5 ? ' cg-sem-valor' : '') + (duasLinhas ? ' cg-eixo2' : '');
      alvo.innerHTML = '<div class="' + classes + '" style="--gap:' + gap + 'px;--fv:' + fvPx.toFixed(1) + 'px' + (alturasDashboard().barras ? ';--area-h:' + alturasDashboard().barras + 'px' : '') + '"><div class="cg-area">' + gs.map(function (g) {
        return '<div class="cg-grupo">' + MEDIDAS.map(function (k) {
          var v = g[k], alt = isFinite(v) ? Math.max(0, (v - lo) / (hi - lo) * 100) : 0;
          return '<div class="cg-col" role="img" aria-label="' + esc(g.rotulo + ' · ' + t('bi.serie.' + k) + ': ' + fmt(v, dec)) + '" title="' + esc(t('bi.serie.' + k) + ': ' + fmt(v, dec)) + '" style="--h:' + alt + '%;--c:var(--m-' + k + ')">' +
            (isFinite(v) ? '<div class="cg-bar"></div><div class="cg-v">' + fmt(v, dec) + '</div>' : '') + '</div>';
        }).join('') + '<div class="x-lbl">' + (duasLinhas ? esc(g.rotulo).replace(' ', '<br>') : esc(g.rotulo)) + '</div></div>';
      }).join('') + '</div></div>';
    }

    // Variação da média (pct_change do script)
    var itens = [];
    for (var i = 1; i < gs.length; i++) {
      var a = gs[i - 1].mean, b = gs[i].mean;
      if (!isFinite(a) || !isFinite(b) || a === 0) continue;
      var dd = (b - a) / a, cls = dd > 0 ? 'is-up' : 'is-down';
      itens.push('<li class="' + cls + '"><span>' + esc(gs[i - 1].rotulo + ' → ' + gs[i].rotulo) + '</span><b>' + (dd > 0 ? SVG_ALTA + '+' : SVG_QUEDA) + fmt(dd * 100, 1) + '%</b></li>');
    }
    $('biVariacao').innerHTML = itens.length ? itens.join('') : '<li><span>—</span></li>';

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
    $('biAnosCab').innerHTML = [t('bi.h.ano'), t('bi.serie.mean'), t('bi.th.desvio'), 'CV', 'N'].map(function (c, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(c) + '</th>'; }).join('');
    $('biAnosCorpo').innerHTML = anos.map(function (a) {
      return '<tr><td class="per"><i class="dsc-ano-cor" style="--c:' + a.cor + '"></i>' + a.ano + '</td><td class="num"><b>' + fmt(a.media, 2) + '</b></td><td class="num">' + fmt(a.sd, 2) +
        '</td><td class="num">' + fmt(a.cv, 1) + '%</td><td class="num">' + fmt(a.n, 0) + '</td></tr>';
    }).join('');
    if (!anos.length) { alvo.innerHTML = vazioHtml(t('bi.semDados')); return; }

    var vis = anos;
    var W = Math.max(alvo.clientWidth, 300), H = alturasDashboard().hist, m = { l: 40, r: 12, t: 12, b: 28 };
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
  function marcarFlags() {
    document.querySelectorAll('[data-bi-flag]').forEach(function (o) {
      var k = o.getAttribute('data-bi-flag');
      o.setAttribute('aria-checked', String(!!st.op[k]));
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
    document.querySelectorAll('.dsc .unit-trigger').forEach(function (g) {
      g.addEventListener('click', function (e) { e.stopPropagation(); abrirPop(g.getAttribute('aria-controls')); });
    });
    $('biBuLista').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bu]'); if (!b) return;
      buNav = b.getAttribute('data-bu'); desenharSeletores();
      var primeiro = $('biSiteLista').querySelector('button'); if (primeiro) primeiro.focus();
    });
    $('biSiteLista').addEventListener('click', function (e) {
      var b = e.target.closest('[data-site]'); if (b) escolherFiltro({ bu: buNav, site: b.getAttribute('data-site'), kpi: st.sel.kpi, op: st.sel.op });
    });
    $('biKpiLista').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kpi]'); if (b) escolherFiltro({ bu: st.sel.bu, site: st.sel.site, kpi: b.getAttribute('data-kpi'), op: st.sel.op });
    });
    $('biOpLista').addEventListener('click', function (e) {
      var b = e.target.closest('[data-op]'); if (b) escolherFiltro({ bu: st.sel.bu, site: st.sel.site, kpi: st.sel.kpi, op: b.getAttribute('data-op') });
    });
    // o clique numa BU redesenha a lista (o alvo sai do DOM): só fecha com clique fora do seletor
    document.addEventListener('click', function (e) { if (popAberto && e.target.isConnected && !e.target.closest('.unit')) fecharPop(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && popAberto) fecharPop(true); });
    ['biInicio', 'biFim'].forEach(function (id) {
      $(id).addEventListener('change', function () { st.op.inicio = $('biInicio').value || null; st.op.fim = $('biFim').value || null; desenhar(); });
    });
    document.querySelectorAll('[data-bi-flag]').forEach(function (b) {
      b.addEventListener('click', function () { var k = b.getAttribute('data-bi-flag'); st.op[k] = !st.op[k]; marcarFlags(); desenhar(); });
    });
    document.querySelectorAll('[data-bi-agrup]').forEach(function (b) {
      b.addEventListener('click', function () { st.porAno = b.getAttribute('data-bi-agrup') === 'ano'; desenhar(); });
    });
    $('biFiltrosLimpar').addEventListener('click', function () {
      if (st.filtros) definirPeriodo(st.filtros.periodo.min, st.filtros.periodo.max);
      st.op.removerZeros = false; st.op.removerOutliers = false; marcarFlags(); desenhar();
    });
    $('biAtualizar').addEventListener('click', function () { carregarFiltros(true); });
    var pend = null;
    window.addEventListener('resize', function () { clearTimeout(pend); pend = setTimeout(function () { if (!$('vista-powerbi').hidden) { redimensionando = true; desenharVisao(); redimensionando = false; } }, 150); });
  }

  window.PainelSPC = {
    iniciar: function (c) {
      ctx = c;
      if (iniciado) { desenhar(); return; }
      iniciado = true;
      ligarEventos(); marcarFlags();
      st.carregando = true;
      ALVOS.forEach(function (id) { $(id).innerHTML = vazioHtml(t('ui.loading')); });
      carregarFiltros(false);
    },
    // troca de idioma, formato numérico ou tema (as cores dos gráficos dependem do tema)
    redesenhar: function () { if (iniciado) desenhar(); }
  };
})();
