/**
 * VBM Kaizen — tela Dashboard (dashboard.html).
 *
 * Recebe a base inteira de /api/dashboard/dados UMA vez (atual +
 * histórico, compactada) e faz aqui os filtros em cascata e as
 * agregações. Nada de biblioteca de gráfico: as colunas e a "cota" de
 * variação são HTML/CSS, no mesmo desenho dos gráficos do VBM Quarterly.
 *
 * Dependências: js/vbm-app.js (showToast, VBMLoading) e o bloco de
 * idioma da própria página (window.__i18n / window.__i18nLang e o evento
 * 'vbm:idioma').
 */
(function () {
  'use strict';

  /* ════════════ utilidades ════════════ */
  function $(id) { return document.getElementById(id); }
  function tx(chave, padrao) {
    var d = window.__i18n || {};
    return d[chave] != null ? d[chave] : padrao;
  }
  function emIngles() { return window.__i18nLang === 'en'; }
  function localidade() { return emIngles() ? 'en-US' : 'pt-BR'; }
  function fmt(n) { return Number(n || 0).toLocaleString(localidade()); }
  function pct(n, d, casas) {
    if (!d) return '0%';
    return (n / d * 100).toLocaleString(localidade(), { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function modelo(texto, vals) {
    return String(texto).replace(/\{(\w+)\}/g, function (_, k) { return vals[k] != null ? vals[k] : ''; });
  }
  function semAcento(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  var SVG_ALTA = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5L9 8H1z" fill="currentColor"></path></svg>';
  var SVG_QUEDA = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5L1 2h8z" fill="currentColor"></path></svg>';

  /* ════════════ estado ════════════ */
  var BASE = null;        // payload de /api/dashboard/dados
  var TODAS = [];         // um objeto por Kaizen
  var VIS = [];           // os que passam nos filtros
  var STATUS = new Map(); // ID_STATUS -> {pt, en, momento}
  var ORDEM_STATUS = [];  // ids na ordem do cadastro
  var CATS = new Map();
  var DET = null;         // Map chave -> {titulo, membros, externos}
  var detEmCurso = null;
  var visao = 'total';
  var nivel = 'coo';

  var CAMPOS = [
    { k: 'st', l: 'dash.fStatus', g: 'dash.gPeriodo', ordem: 'catalogo' },
    { k: 'o', l: 'dash.fOrigem', g: 'dash.gPeriodo', ordem: 'fixa', fixos: [0, 1] },
    { k: 'y', l: 'dash.fAno', g: 'dash.gPeriodo', ordem: 'desc' },
    { k: 'm', l: 'dash.fMes', g: 'dash.gPeriodo', ordem: 'asc' },
    { k: 'cat', l: 'dash.fCategoria', g: 'dash.gPeriodo', ordem: 'qtd' },
    { k: 'site', l: 'dash.fSite', g: 'dash.gPeriodo', ordem: 'qtd', busca: true },
    { k: 'coo', l: 'dash.fCoo', g: 'dash.gEstrutura', ordem: 'qtd', busca: true },
    { k: 'dir', l: 'dash.fDir', g: 'dash.gEstrutura', ordem: 'qtd', busca: true },
    { k: 'head', l: 'dash.fHead', g: 'dash.gEstrutura', ordem: 'qtd', busca: true },
    { k: 'gg', l: 'dash.fGg', g: 'dash.gEstrutura', ordem: 'qtd', busca: true },
    { k: 'ga', l: 'dash.fGa', g: 'dash.gEstrutura', ordem: 'qtd', busca: true },
    { k: 'cs', l: 'dash.fCs', g: 'dash.gEstrutura', ordem: 'qtd', busca: true },
    { k: 'ld', l: 'dash.fLider', g: 'dash.gPessoas', ordem: 'qtd', busca: true },
    { k: 'ap', l: 'dash.fAprovador', g: 'dash.gPessoas', ordem: 'qtd', busca: true }
  ];
  var CAMPO = {};
  var sel = {};
  CAMPOS.forEach(function (c) { CAMPO[c.k] = c; sel[c.k] = new Set(); });
  var filtroIds = [];
  var TEXTO = { site: 1, coo: 1, dir: 1, head: 1, gg: 1, ga: 1, cs: 1, ld: 1, ap: 1 };
  var NIVEIS = [['coo', 'dash.fCoo'], ['dir', 'dash.fDir'], ['head', 'dash.fHead'], ['gg', 'dash.fGg'], ['ga', 'dash.fGa'], ['cs', 'dash.fCs']];

  /* ════════════ rótulos ════════════ */
  function texto(i) { return i >= 0 && BASE ? BASE.textos[i] : null; }
  function nomeStatus(id) {
    var s = STATUS.get(id);
    if (!s) return id < 0 ? tx('dash.semStatus', 'Sem status') : String(id);
    return (emIngles() ? s.en || s.pt : s.pt || s.en) || String(id);
  }
  function nomeCategoria(id) {
    var c = CATS.get(id);
    if (!c) return tx('dash.emBranco', '(Em branco)');
    return (emIngles() ? c.en || c.pt : c.pt || c.en) || String(id);
  }
  function rotulo(k, v) {
    if (k === 'st') return nomeStatus(v);
    if (k === 'o') return v ? tx('dash.historico', 'Histórico') : tx('dash.atual', 'Atual');
    if (k === 'y') return v ? String(v) : tx('dash.semData', 'Sem data');
    if (k === 'm') return v ? tx('dash.mesesLongos', [])[v - 1] || String(v) : tx('dash.semData', 'Sem data');
    if (k === 'cat') return v >= 0 ? nomeCategoria(v) : tx('dash.emBranco', '(Em branco)');
    return texto(v) || tx('dash.emBranco', '(Em branco)');
  }
  function corStatus(id) {
    var s = STATUS.get(id);
    return 'var(--st-' + (s && s.momento ? s.momento : 'outro') + ')';
  }
  function classeSelo(id) {
    var s = STATUS.get(id), m = s && s.momento;
    if (m === 'aprovado') return 'badge-aprovado';
    if (m === 'emAprovacao') return 'badge-aguardando';
    if (m === 'reprovado') return 'badge-reprovado';
    if (m === 'alteracao') return 'badge-rascunho';
    return 'badge-blue';
  }
  function dataTxt(r) {
    if (!r.dt) return '—';
    var dd = ('0' + r.d).slice(-2), mm = ('0' + r.m).slice(-2);
    return emIngles() ? mm + '/' + dd + '/' + r.y : dd + '/' + mm + '/' + r.y;
  }

  /* ════════════ base ════════════ */
  function decodificar(p) {
    var pos = {};
    p.colunas.forEach(function (c, i) { pos[c] = i; });
    function col(l, nome) { return pos[nome] == null ? -1 : l[pos[nome]]; }
    TODAS = p.linhas.map(function (l) {
      var dt = col(l, 'data') || 0;
      return {
        o: col(l, 'origem') ? 1 : 0,
        id: col(l, 'id'),
        dt: dt,
        y: dt ? Math.floor(dt / 10000) : 0,
        m: dt ? Math.floor(dt / 100) % 100 : 0,
        d: dt ? dt % 100 : 0,
        st: col(l, 'status'),
        cat: col(l, 'categoria'),
        ld: col(l, 'lider'),
        ap: col(l, 'aprovador'),
        site: col(l, 'site'),
        coo: col(l, 'coo'), dir: col(l, 'dir'), head: col(l, 'head'),
        gg: col(l, 'gg'), ga: col(l, 'ga'), cs: col(l, 'cs'),
        k: (col(l, 'origem') ? 'H' : 'A') + col(l, 'id')
      };
    });
    STATUS = new Map();
    ORDEM_STATUS = [];
    (p.status || []).forEach(function (s) { STATUS.set(s.id, s); ORDEM_STATUS.push(s.id); });
    CATS = new Map();
    (p.categorias || []).forEach(function (c) { CATS.set(c.id, c); });
  }

  function passa(r, exceto) {
    for (var i = 0; i < CAMPOS.length; i++) {
      var k = CAMPOS[i].k;
      if (k === exceto) continue;
      if (sel[k].size && !sel[k].has(r[k])) return false;
    }
    // ID exato (como o filtro "ID Kaizen" do Power BI): "100" não traz
    // o 1000 nem o 10045.
    if (filtroIds.length && exceto !== 'id' && filtroIds.indexOf(String(r.id)) < 0) return false;
    return true;
  }
  function recalcular() { VIS = TODAS.filter(function (r) { return passa(r, null); }); }
  function qtdFiltros() {
    var n = filtroIds.length ? 1 : 0;
    CAMPOS.forEach(function (c) { if (sel[c.k].size) n++; });
    return n;
  }
  function contarPor(lista, k) {
    var m = new Map();
    lista.forEach(function (r) { m.set(r[k], (m.get(r[k]) || 0) + 1); });
    return m;
  }

  /* ════════════ painel de filtros ════════════ */
  var aberto = null, buscaOpcao = {}, MAX_OPCOES = 150;

  function opcoes(c) {
    var cont = new Map();
    TODAS.forEach(function (r) { if (passa(r, c.k)) cont.set(r[c.k], (cont.get(r[c.k]) || 0) + 1); });
    var vals;
    if (c.ordem === 'fixa') vals = c.fixos.slice();
    else if (c.ordem === 'catalogo') {
      vals = ORDEM_STATUS.filter(function (id) { return cont.has(id) || sel.st.has(id); });
      if (cont.has(-1)) vals.push(-1);
    } else {
      var conj = new Set(cont.keys());
      sel[c.k].forEach(function (v) { conj.add(v); });
      vals = Array.from(conj);
      if (c.ordem === 'asc') vals.sort(function (a, b) { return a - b; });
      else if (c.ordem === 'desc') vals.sort(function (a, b) { return b - a; });
      else vals.sort(function (a, b) { return (cont.get(b) || 0) - (cont.get(a) || 0) || rotulo(c.k, a).localeCompare(rotulo(c.k, b)); });
    }
    return vals.map(function (v) { return { v: v, n: cont.get(v) || 0 }; });
  }

  function desenharPainel() {
    var html = '', grupo = '';
    CAMPOS.forEach(function (c) {
      if (c.g !== grupo) { html += '<div class="fp-grupo">' + esc(tx(c.g, '')) + '</div>'; grupo = c.g; }
      var s = sel[c.k], abre = aberto === c.k, rot;
      if (!s.size) rot = '<span class="txt">' + esc(tx('dash.todos', 'Todos')) + '</span>';
      else {
        var primeiro = s.values().next().value;
        rot = '<span class="txt">' + esc(rotulo(c.k, primeiro)) + '</span>' + (s.size > 1 ? '<span class="mais">+' + (s.size - 1) + '</span>' : '');
      }
      html += '<div class="qf-campo' + (abre ? ' open' : '') + '" data-k="' + c.k + '">' +
        '<span class="qf-rotulo" id="qfr-' + c.k + '">' + esc(tx(c.l, c.k)) + '</span>' +
        '<button type="button" class="qf-gatilho' + (s.size ? ' ativo' : '') + '" id="qfg-' + c.k + '" aria-expanded="' + abre + '" aria-controls="qfp-' + c.k + '" aria-labelledby="qfr-' + c.k + ' qfg-' + c.k + '">' + rot + '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>';
      if (abre) html += listaHtml(c);
      html += '</div>';
    });
    html += '<div><label class="qf-rotulo" for="qfId">' + esc(tx('dash.fId', 'ID Kaizen')) + '</label>' +
      '<input class="qf-texto" id="qfId" type="text" inputmode="numeric" autocomplete="off" placeholder="' + esc(tx('dash.idEx', '')) + '" value="' + esc(filtroIds.join(', ')) + '">' +
      '<div class="qf-dica">' + esc(tx('dash.idDica', '')) + '</div></div>';
    $('fpCorpo').innerHTML = html;
    var n = qtdFiltros();
    $('fpConta').textContent = n ? '· ' + n : '';
  }

  function listaHtml(c) {
    var lista = opcoes(c), q = semAcento(buscaOpcao[c.k] || '');
    if (q) lista = lista.filter(function (o) { return semAcento(rotulo(c.k, o.v)).indexOf(q) > -1; });
    var total = lista.length, mostra = lista.slice(0, MAX_OPCOES);
    var h = '<div class="qf-lista-painel" id="qfp-' + c.k + '">';
    if (c.busca) h += '<div class="qf-busca"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" id="qfb-' + c.k + '" data-k="' + c.k + '" aria-label="' + esc(tx('dash.buscar', '') + ' ' + tx(c.l, '')) + '" placeholder="' + esc(tx('dash.buscar', 'Buscar…')) + '" value="' + esc(buscaOpcao[c.k] || '') + '"></div>';
    h += '<div class="qf-acoes"><button type="button" class="qf-link" data-acao="todos" data-k="' + c.k + '">' + esc(tx('dash.selTodos', 'Selecionar todos')) + '</button>' +
      '<button type="button" class="qf-link" data-acao="limpar" data-k="' + c.k + '">' + esc(tx('dash.limpar', 'Limpar')) + '</button></div>';
    h += '<div class="qf-opcoes" role="listbox" aria-multiselectable="true" aria-labelledby="qfr-' + c.k + '">';
    mostra.forEach(function (o) {
      var marcado = sel[c.k].has(o.v), nome = rotulo(c.k, o.v);
      h += '<button type="button" role="option" class="qf-opcao' + (o.n ? '' : ' zero') + '" aria-selected="' + marcado + '" data-k="' + c.k + '" data-v="' + o.v + '">' +
        '<span class="qf-check"><i class="fa-solid fa-check" aria-hidden="true"></i></span><span class="nm" title="' + esc(nome) + '">' + esc(nome) + '</span><span class="ct">' + fmt(o.n) + '</span></button>';
    });
    h += '</div>';
    if (total > mostra.length) h += '<div class="qf-mais">' + esc(modelo(tx('dash.maisOpcoes', ''), { n: fmt(mostra.length), t: fmt(total) })) + '</div>';
    return h + '</div>';
  }

  function alternar(k, v) { if (sel[k].has(v)) sel[k].delete(v); else sel[k].add(v); }

  $('fpCorpo').addEventListener('click', function (e) {
    var g = e.target.closest('.qf-gatilho');
    if (g) {
      var k = g.parentNode.dataset.k;
      aberto = aberto === k ? null : k;
      desenharPainel();
      var novo = $('qfg-' + k); if (novo) novo.focus();
      return;
    }
    var op = e.target.closest('.qf-opcao');
    if (op) {
      var ko = op.dataset.k, vo = Number(op.dataset.v);
      var lista = op.parentNode, rol = lista.scrollTop;
      alternar(ko, vo);
      aplicar();
      desenharPainel();
      var nl = document.querySelector('#qfp-' + ko + ' .qf-opcoes'); if (nl) nl.scrollTop = rol;
      var mesmo = document.querySelector('#qfp-' + ko + ' .qf-opcao[data-v="' + vo + '"]'); if (mesmo) mesmo.focus();
      return;
    }
    var ac = e.target.closest('.qf-link');
    if (ac) {
      var c = CAMPO[ac.dataset.k];
      if (ac.dataset.acao === 'limpar') sel[c.k].clear();
      else {
        var q = semAcento(buscaOpcao[c.k] || '');
        opcoes(c).forEach(function (o) { if (o.n && (!q || semAcento(rotulo(c.k, o.v)).indexOf(q) > -1)) sel[c.k].add(o.v); });
      }
      aplicar();
      desenharPainel();
    }
  });
  $('fpCorpo').addEventListener('input', function (e) {
    if (e.target.id === 'qfId') {
      filtroIds = e.target.value.split(/[,;\s]+/).map(function (s) { return s.replace(/\D/g, '').replace(/^0+(?=\d)/, ''); }).filter(Boolean);
      aplicar();
      $('fpConta').textContent = qtdFiltros() ? '· ' + qtdFiltros() : '';
      return;
    }
    var k = e.target.dataset.k;
    if (k && e.target.id === 'qfb-' + k) {
      var pos = e.target.selectionStart;
      buscaOpcao[k] = e.target.value;
      desenharPainel();
      var inp = $('qfb-' + k);
      if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (er) {} }
    }
  });

  var focoAntes = null;
  function painelFiltros(abrir) {
    var p = $('filtrosPainel');
    p.classList.toggle('open', abrir);
    $('filtrosFundo').classList.toggle('open', abrir);
    p.setAttribute('aria-hidden', String(!abrir));
    $('dashAbrirFiltros').setAttribute('aria-expanded', String(abrir));
    if (abrir) {
      p.removeAttribute('inert');
      focoAntes = document.activeElement;
      desenharPainel();
      setTimeout(function () { $('fpFechar').focus(); }, 40);
    } else {
      p.setAttribute('inert', '');
      if (focoAntes && focoAntes.focus) focoAntes.focus();
    }
  }
  $('dashAbrirFiltros').addEventListener('click', function () { painelFiltros(true); });
  $('fpFechar').addEventListener('click', function () { painelFiltros(false); });
  $('fpVer').addEventListener('click', function () { painelFiltros(false); });
  $('filtrosFundo').addEventListener('click', function () { painelFiltros(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('filtrosPainel').classList.contains('open')) painelFiltros(false);
  });
  function limparTudo() {
    CAMPOS.forEach(function (c) { sel[c.k].clear(); });
    filtroIds = [];
    aplicar();
    if ($('filtrosPainel').classList.contains('open')) desenharPainel();
  }
  $('fpLimpar').addEventListener('click', limparTudo);

  /* ════════════ etiquetas de filtro ativo ════════════ */
  function desenharChips() {
    var h = '';
    CAMPOS.forEach(function (c) {
      var s = sel[c.k]; if (!s.size) return;
      var primeiro = s.values().next().value;
      h += '<button type="button" class="dash-chip" data-k="' + c.k + '" aria-label="' + esc(tx('dash.remover', '') + ': ' + tx(c.l, '')) + '"><b>' + esc(tx(c.l, c.k)) + ':</b><span class="v">' +
        esc(rotulo(c.k, primeiro)) + (s.size > 1 ? ' +' + (s.size - 1) : '') + '</span><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
    });
    if (filtroIds.length) h += '<button type="button" class="dash-chip" data-k="id"><b>' + esc(tx('dash.fId', 'ID')) + ':</b><span class="v">' + esc(filtroIds.join(', ')) + '</span><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
    if (h) h += '<button type="button" class="dash-chip dash-chip-limpar" data-k="*">' + esc(tx('dash.limparTudo', 'Limpar tudo')) + '</button>';
    $('dashChips').innerHTML = h;
    $('dashChips').hidden = !h;
    var n = qtdFiltros();
    $('dashContaFiltros').hidden = !n;
    $('dashContaFiltros').textContent = n;
  }
  $('dashChips').addEventListener('click', function (e) {
    var b = e.target.closest('.dash-chip'); if (!b) return;
    var k = b.dataset.k;
    if (k === '*') { limparTudo(); return; }
    if (k === 'id') filtroIds = []; else sel[k].clear();
    aplicar();
  });

  /* ════════════ cards de status ════════════ */
  function desenharResumo() {
    var cont = contarPor(VIS, 'st'), tot = VIS.length;
    var ordem = ORDEM_STATUS.filter(function (id) { return cont.has(id); });
    if (cont.has(-1)) ordem.push(-1);
    cont.forEach(function (_, id) { if (ordem.indexOf(id) < 0) ordem.push(id); });

    var acum = 0;
    var conic = tot ? 'conic-gradient(' + ordem.map(function (id) {
      var a = acum / tot * 100; acum += cont.get(id); return corStatus(id) + ' ' + a + '% ' + (acum / tot * 100) + '%';
    }).join(', ') + ')' : 'conic-gradient(var(--d-track) 0 100%)';

    // Dois cards próprios: Aprovado e Aguardando aprovação. Se o
    // cadastro não tiver um deles, entra o status com mais Kaizens.
    var porMomento = {};
    ORDEM_STATUS.forEach(function (id) { var s = STATUS.get(id); if (s && s.momento && porMomento[s.momento] == null) porMomento[s.momento] = id; });
    var principais = [porMomento.aprovado, porMomento.emAprovacao].filter(function (x) { return x != null; });
    ordem.slice().sort(function (a, b) { return (cont.get(b) || 0) - (cont.get(a) || 0); }).forEach(function (id) {
      if (principais.length < 2 && principais.indexOf(id) < 0) principais.push(id);
    });
    var outros = ordem.filter(function (id) { return principais.indexOf(id) < 0; });
    var aprov = porMomento.aprovado != null ? cont.get(porMomento.aprovado) || 0 : 0;

    var h = '<button type="button" class="dash-tile dash-tile-total" data-st="" aria-label="' + esc(tx('dash.limparStatus', '')) + '">' +
      '<div class="t-head">' + esc(tx('dash.total', 'Total de kaizens')) + '</div>' +
      '<div class="tt-corpo"><div><div class="tt-num">' + fmt(tot) + '</div><div class="tt-sub">' + esc(tx('dash.totalSub', '')) + '</div></div>' +
      '<div class="donut" style="--conic:' + conic + '" aria-hidden="true"><b>' + pct(aprov, tot, 0) + '</b><small>' + esc(tx('dash.aprovados', 'aprovados')) + '</small></div></div></button>';
    principais.forEach(function (id) {
      var n = cont.get(id) || 0;
      h += '<button type="button" class="dash-tile" data-st="' + id + '" aria-pressed="' + sel.st.has(id) + '" style="--c:' + corStatus(id) + '">' +
        '<div class="t-head"><i class="q"></i>' + esc(nomeStatus(id)) + '</div><div class="t-num">' + fmt(n) + '</div>' +
        '<div class="t-foot"><span class="t-bar" aria-hidden="true"><span style="--w:' + (tot ? n / tot * 100 : 0) + '%"></span></span><span class="t-pct">' + pct(n, tot, 1) + '</span></div></button>';
    });
    var somaOutros = outros.reduce(function (s, id) { return s + (cont.get(id) || 0); }, 0);
    h += '<div class="dash-tile dash-tile-outros"><div class="t-head">' + esc(tx('dash.outros', 'Outros status')) + ' · ' + fmt(somaOutros) + '</div>' +
      outros.map(function (id) {
        var n = cont.get(id) || 0;
        return '<button type="button" class="orow" data-st="' + id + '" aria-pressed="' + sel.st.has(id) + '" style="--c:' + corStatus(id) + '"><i></i><span>' + esc(nomeStatus(id)) + '</span><b>' + fmt(n) + '</b><em>' + pct(n, tot, 1) + '</em></button>';
      }).join('') + '</div>';
    $('dashTiles').className = 'dash-tiles' + (sel.st.size ? ' tem-status' : '');
    $('dashTiles').innerHTML = h;
  }
  $('dashTiles').addEventListener('click', function (e) {
    var b = e.target.closest('button.dash-tile, .orow'); if (!b || !BASE) return;
    var v = b.dataset.st;
    if (v === '') sel.st.clear();
    else {
      var id = Number(v);
      if (sel.st.size === 1 && sel.st.has(id)) sel.st.clear();
      else { sel.st.clear(); sel.st.add(id); }
    }
    aplicar();
  });

  /* ════════════ gráficos ════════════ */
  function colunas(el, o) {
    var max = Math.max.apply(null, o.valores.concat([0]));
    if (!max) { el.innerHTML = '<div class="dash-vazio">' + esc(tx('dash.vazio', '')) + '</div>'; return; }
    var hs = o.valores.map(function (v) { return v / max * 100; });
    var pico = o.valores.indexOf(max);
    var h = o.valores.map(function (v, i) {
      var alt = hs[i], cota = '';
      if (o.deltas && i > 0 && o.valores[i - 1] > 0) {
        var ant = o.valores[i - 1], d = (v - ant) / ant;
        var cls = Math.abs(d) < 0.01 ? 'is-flat' : d > 0 ? 'is-up' : 'is-down';
        var hMin = Math.min(alt, hs[i - 1]), hMax = Math.max(alt, hs[i - 1]);
        var t = (d > 0 ? '+' : '') + (d * 100).toLocaleString(localidade(), { maximumFractionDigits: 0 }) + '%';
        cota = '<div class="dcnx ' + cls + '" style="--h-base:' + hs[i - 1] + '%;--h-min:' + hMin + '%;--h-dif:' + (hMax - hMin) + '%;--h-max:' + hMax + '%;--lift:' + (i % 2 ? 0 : 24) + 'px">' +
          '<div class="dref"></div><div class="dnow"></div><div class="dfill ' + (d >= 0 ? 'up' : 'dn') + '"></div><div class="dspan"></div><div class="dtrack"></div>' +
          '<div class="dpill" title="' + esc((v - ant > 0 ? '+' : '') + fmt(v - ant) + ' ' + tx('dash.vsAnterior', '')) + '">' + (d >= 0 ? SVG_ALTA : SVG_QUEDA) + t + '</div></div>';
      }
      var cor = o.pico && i === pico ? 'var(--vbm-blue-dark)' : 'var(--vbm-blue)';
      return '<div class="col" role="img" aria-label="' + esc(o.rotulos[i] + ': ' + fmt(v)) + '" style="--h:' + alt + '%;--c:' + cor + '">' + cota +
        '<div class="bar"></div><div class="v-lbl">' + fmt(v) + '</div><div class="x-lbl">' + esc(o.rotulos[i]) + '</div></div>';
    }).join('');
    var media = '';
    if (o.media) {
      var a = o.valores.reduce(function (s, x) { return s + x; }, 0) / o.valores.length;
      media = '<div class="avg-line" style="bottom:' + (a / max * 100) + '%"><span>' + esc(tx('dash.media', 'média')) + ' ' + fmt(Math.round(a)) + '</span></div>';
    }
    el.innerHTML = '<div class="cc' + (o.denso ? ' denso' : '') + '" style="--area-h:' + o.altura + 'px;--minw:' + o.minw + 'px;--gap:' + o.gap + 'px;--top-extra:' + o.topo + 'px"><div class="cc-area">' + media + h + '</div></div>';
  }

  function ranking(el, k, limite, opts) {
    opts = opts || {};
    var linhas = Array.from(contarPor(VIS, k).entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, limite);
    if (!linhas.length) { el.innerHTML = '<div class="dash-vazio">' + esc(tx('dash.vazio', '')) + '</div>'; return; }
    var max = linhas[0][1], primeiro = -1;
    for (var i = 0; i < linhas.length; i++) if (linhas[i][0] >= 0) { primeiro = i; break; }
    el.innerHTML = linhas.map(function (l, i) {
      var branco = l[0] < 0, nome = rotulo(k, l[0]);
      var cor = branco ? 'var(--d-blank)' : i === primeiro ? 'var(--vbm-blue-dark)' : 'var(--vbm-blue)';
      return '<button type="button" class="rk" data-k="' + k + '" data-v="' + l[0] + '" aria-pressed="' + sel[k].has(l[0]) + '" aria-label="' + esc(nome + ': ' + fmt(l[1])) + '">' +
        '<span class="rk-nome' + (branco ? ' branco' : '') + '" title="' + esc(nome) + '">' + esc(nome) + '</span>' +
        '<span class="rk-trilho" aria-hidden="true"><span class="rk-barra" style="--w:' + (l[1] / max * 100) + '%;--c:' + cor + ';animation-delay:' + (i * 30) + 'ms"></span></span>' +
        '<span class="rk-val">' + fmt(l[1]) + '</span><span class="rk-pct">' + (opts.semPct ? '' : pct(l[1], VIS.length, 1)) + '</span></button>';
    }).join('');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button.rk'); if (!b) return;
    alternar(b.dataset.k, Number(b.dataset.v));
    aplicar();
  });

  function desenharNiveis() {
    $('dashNiveis').innerHTML = NIVEIS.map(function (n) {
      return '<button type="button" role="tab" aria-selected="' + (n[0] === nivel) + '" data-n="' + n[0] + '">' + esc(tx(n[1], n[0])) + (sel[n[0]].size ? ' •' : '') + '</button>';
    }).join('');
    ranking($('rankHier'), nivel, 12);
  }
  $('dashNiveis').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    nivel = b.dataset.n; desenharNiveis();
  });

  function desenharTotal() {
    var mes = new Array(12).fill(0), dia = new Array(31).fill(0), anos = new Map();
    VIS.forEach(function (r) {
      if (!r.dt) return;
      mes[r.m - 1]++; dia[r.d - 1]++;
      anos.set(r.y, (anos.get(r.y) || 0) + 1);
    });
    var listaAnos = Array.from(anos.keys()).sort(function (a, b) { return a - b; });
    var escopo = sel.y.size ? Array.from(sel.y).sort().join(', ') : tx('dash.todosAnos', 'todos os anos');
    $('dashMesSub').textContent = modelo(tx('dash.mesSub', ''), { anos: escopo });
    colunas($('grafMes'), { valores: mes, rotulos: tx('dash.meses', []), deltas: true, altura: 220, minw: 560, gap: 12, topo: 56 });
    colunas($('grafAno'), { valores: listaAnos.map(function (a) { return anos.get(a); }), rotulos: listaAnos.map(String), deltas: true, altura: 220, minw: Math.max(240, listaAnos.length * 52), gap: 10, topo: 56 });
    colunas($('grafDia'), { valores: dia, rotulos: dia.map(function (_, i) { return String(i + 1); }), media: true, pico: true, denso: true, altura: 200, minw: 760, gap: 5, topo: 8 });
    desenharNiveis();
  }

  function desenharLider() {
    ranking($('rankLider'), 'ld', 15, { semPct: true });
    ranking($('rankAprov'), 'ap', 15);
    var topo = Array.from(contarPor(VIS, 'ap').entries()).filter(function (x) { return x[0] >= 0; }).sort(function (a, b) { return b[1] - a[1]; })[0];
    $('dashApSub').textContent = topo ? modelo(tx('dash.apSub', ''), { nome: rotulo('ap', topo[0]), p: pct(topo[1], VIS.length, 0) }) : '';
  }

  /* ════════════ tabelas ════════════ */
  var POR_PAGINA = 25;
  function cmp(a, b, dir) { return a < b ? -dir : a > b ? dir : 0; }
  function cabecalho(colunasTab, ordem) {
    return colunasTab.map(function (c) {
      if (c.semOrdem) return '<th scope="col">' + '<button type="button" disabled style="cursor:default">' + esc(c.t) + '</button></th>';
      var s = ordem.k === c.k ? (ordem.dir > 0 ? 'ascending' : 'descending') : 'none';
      return '<th scope="col" aria-sort="' + s + '"' + (c.num ? ' class="num"' : '') + '><button type="button" data-ordem="' + c.k + '">' + esc(c.t) + '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button></th>';
    }).join('');
  }
  function paginador(pagina, total) {
    if (!total) return '';
    var a = pagina * POR_PAGINA + 1, b = Math.min(total, (pagina + 1) * POR_PAGINA);
    return '<span>' + esc(modelo(tx('dash.paginas', ''), { a: fmt(a), b: fmt(b), t: fmt(total) })) + '</span>' +
      '<button type="button" data-pg="-1" aria-label="' + esc(tx('dash.anterior', '')) + '"' + (pagina === 0 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>' +
      '<button type="button" data-pg="1" aria-label="' + esc(tx('dash.proxima', '')) + '"' + (b >= total ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>';
  }

  /* Detalhamento por líder */
  var ordemDet = { k: 'total', dir: -1 }, pagDet = 0;
  function linhasDet() {
    var m = new Map();
    VIS.forEach(function (r) {
      var o = m.get(r.ld);
      if (!o) { o = { ld: r.ld, nome: rotulo('ld', r.ld), total: 0, st: new Map(), aprov: 0 }; m.set(r.ld, o); }
      o.total++;
      o.st.set(r.st, (o.st.get(r.st) || 0) + 1);
      var s = STATUS.get(r.st); if (s && s.momento === 'aprovado') o.aprov++;
    });
    var q = semAcento($('buscaDet').value.trim());
    var lista = Array.from(m.values()).filter(function (o) { return !q || semAcento(o.nome).indexOf(q) > -1; });
    lista.forEach(function (o) { o.taxa = o.total ? o.aprov / o.total : 0; });
    var k = ordemDet.k, d = ordemDet.dir;
    lista.sort(function (a, b) {
      var va = k === 'nome' ? a.nome : k === 'total' ? a.total : k === 'taxa' ? a.taxa : a.st.get(Number(k.slice(1))) || 0;
      var vb = k === 'nome' ? b.nome : k === 'total' ? b.total : k === 'taxa' ? b.taxa : b.st.get(Number(k.slice(1))) || 0;
      return cmp(va, vb, d) || cmp(a.nome, b.nome, 1);
    });
    return lista;
  }
  function statusPresentes() {
    var c = contarPor(VIS, 'st');
    var l = ORDEM_STATUS.filter(function (id) { return c.has(id); });
    if (c.has(-1)) l.push(-1);
    return l;
  }
  function desenharDetalhe() {
    var sts = statusPresentes();
    var cols = [{ k: 'nome', t: tx('dash.thLider', 'Kaizen Líder') }, { k: 'total', t: tx('dash.thTotal', 'Total'), num: true }]
      .concat(sts.map(function (id) { return { k: 's' + id, t: nomeStatus(id), num: true }; }))
      .concat([{ k: 'taxa', t: tx('dash.thTaxa', '% aprovação'), num: true }, { k: 'mix', t: tx('dash.thMix', 'Distribuição'), semOrdem: true }]);
    var lista = linhasDet();
    var ult = Math.max(0, Math.ceil(lista.length / POR_PAGINA) - 1); if (pagDet > ult) pagDet = ult;
    $('cabDet').innerHTML = cabecalho(cols, ordemDet);
    var fatia = lista.slice(pagDet * POR_PAGINA, (pagDet + 1) * POR_PAGINA);
    $('corpoDet').innerHTML = fatia.length ? fatia.map(function (o) {
      var mix = '<div class="dash-mix" aria-hidden="true">' + sts.map(function (id) { var n = o.st.get(id) || 0; return n ? '<span style="--c:' + corStatus(id) + ';width:' + (n / o.total * 100) + '%"></span>' : ''; }).join('') + '</div>';
      return '<tr><td class="titulo' + (o.ld < 0 ? ' mudo' : '') + '">' + esc(o.nome) + '</td><td class="num"><b>' + fmt(o.total) + '</b></td>' +
        sts.map(function (id) { var n = o.st.get(id) || 0; return '<td class="num' + (n ? '' : ' mudo') + '">' + (n ? fmt(n) : '—') + '</td>'; }).join('') +
        '<td class="num">' + pct(o.aprov, o.total, 0) + '</td><td>' + mix + '</td></tr>';
    }).join('') : '<tr><td colspan="' + cols.length + '" class="dash-vazio">' + esc(tx('dash.vazio', '')) + '</td></tr>';
    $('contaDet').textContent = modelo(tx('dash.contaLideres', '{n}'), { n: fmt(lista.length) });
    $('pagDet').innerHTML = paginador(pagDet, lista.length);
  }
  $('buscaDet').addEventListener('input', function () { pagDet = 0; desenharDetalhe(); });
  $('cabDet').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ordem]'); if (!b || b.dataset.ordem === 'mix') return;
    var k = b.dataset.ordem;
    ordemDet = { k: k, dir: ordemDet.k === k ? -ordemDet.dir : (k === 'nome' ? 1 : -1) };
    pagDet = 0; desenharDetalhe();
  });
  $('pagDet').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pg]'); if (!b || b.disabled) return;
    pagDet += Number(b.dataset.pg); desenharDetalhe();
  });

  /* Base de dados */
  var ordemBase = { k: 'dt', dir: -1 }, pagBase = 0;
  function det(r) { return DET ? DET.get(r.k) || { titulo: '', membros: '', externos: '' } : null; }
  function linhasBase() {
    var q = semAcento($('buscaBase').value.trim());
    var lista = q ? VIS.filter(function (r) {
      if (String(r.id).indexOf(q) === 0) return true;
      var x = det(r);
      var alvo = (texto(r.ld) || '') + ' ' + (texto(r.ap) || '') + (x ? ' ' + x.titulo + ' ' + x.membros + ' ' + x.externos : '');
      return semAcento(alvo).indexOf(q) > -1;
    }) : VIS.slice();
    var k = ordemBase.k, d = ordemBase.dir;
    function valor(r) {
      if (k === 'id') return r.id;
      if (k === 'dt') return r.dt;
      if (k === 'st') return ORDEM_STATUS.indexOf(r.st);
      if (k === 'ap' || k === 'ld') return semAcento(texto(r[k]) || '￿');
      var x = det(r); return x ? semAcento(x[k] || '￿') : '';
    }
    lista.sort(function (a, b) { return cmp(valor(a), valor(b), d) || cmp(a.id, b.id, -1); });
    return lista;
  }
  function desenharBase() {
    var cols = [
      { k: 'id', t: tx('dash.thId', 'ID') }, { k: 'dt', t: tx('dash.thData', 'Data') }, { k: 'st', t: tx('dash.thStatus', 'Status') },
      { k: 'ap', t: tx('dash.thAprovador', 'Aprovador') }, { k: 'ld', t: tx('dash.thLider', 'Líder') },
      { k: 'membros', t: tx('dash.thMembros', 'Membros') }, { k: 'externos', t: tx('dash.thExternos', 'Externos') }, { k: 'titulo', t: tx('dash.thTitulo', 'Título') }
    ];
    var lista = linhasBase();
    var ult = Math.max(0, Math.ceil(lista.length / POR_PAGINA) - 1); if (pagBase > ult) pagBase = ult;
    $('cabBase').innerHTML = cabecalho(cols, ordemBase);
    var carregando = '<span class="dash-carregando-txt">' + esc(tx('dash.carregandoDetalhes', '…')) + '</span>';
    var fatia = lista.slice(pagBase * POR_PAGINA, (pagBase + 1) * POR_PAGINA);
    $('corpoBase').innerHTML = fatia.length ? fatia.map(function (r) {
      var x = det(r);
      function cel(v, cls) { return x ? (v ? '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(v) + '</td>' : '<td class="mudo">—</td>') : '<td>' + carregando + '</td>'; }
      return '<tr><td class="id">' + r.id + (r.o ? '<span class="dash-tag-hist" title="' + esc(tx('dash.historico', '')) + '">' + esc(tx('dash.hist', 'HIST')) + '</span>' : '') + '</td>' +
        '<td class="data">' + dataTxt(r) + '</td>' +
        '<td><span class="badge ' + classeSelo(r.st) + '">' + esc(nomeStatus(r.st)) + '</span></td>' +
        '<td' + (r.ap < 0 ? ' class="mudo"' : '') + '>' + esc(texto(r.ap) || '—') + '</td>' +
        '<td' + (r.ld < 0 ? ' class="mudo"' : '') + '>' + esc(texto(r.ld) || '—') + '</td>' +
        cel(x && x.membros) + cel(x && x.externos) + cel(x && x.titulo, 'titulo') + '</tr>';
    }).join('') : '<tr><td colspan="8" class="dash-vazio">' + esc(tx('dash.vazio', '')) + '</td></tr>';
    $('contaBase').textContent = modelo(tx('dash.contaKaizens', '{n}'), { n: fmt(lista.length) });
    $('pagBase').innerHTML = paginador(pagBase, lista.length);
  }
  var temporizador = null;
  $('buscaBase').addEventListener('input', function () {
    clearTimeout(temporizador);
    temporizador = setTimeout(function () { pagBase = 0; desenharBase(); }, 150);
  });
  $('cabBase').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ordem]'); if (!b) return;
    var k = b.dataset.ordem;
    ordemBase = { k: k, dir: ordemBase.k === k ? -ordemBase.dir : (k === 'id' || k === 'dt' ? -1 : 1) };
    pagBase = 0; desenharBase();
  });
  $('pagBase').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pg]'); if (!b || b.disabled) return;
    pagBase += Number(b.dataset.pg); desenharBase();
  });

  function carregarDetalhes(forcar) {
    if (DET && !forcar) return Promise.resolve(DET);
    if (!detEmCurso) {
      detEmCurso = fetch('/api/dashboard/detalhes' + (forcar ? '?atualizar=1' : ''), { headers: { Accept: 'application/json' } })
        .then(respostaJson)
        .then(function (j) {
          var m = new Map();
          j.linhas.forEach(function (l) { m.set((l[0] ? 'H' : 'A') + l[1], { titulo: l[2] || '', membros: l[3] || '', externos: l[4] || '' }); });
          DET = m;
          if (visao === 'base') desenharBase();
          return m;
        })
        .catch(function (err) {
          showToast('error', tx('dash.erroTitulo', 'Erro'), err.message);
          throw err;
        })
        .finally(function () { detEmCurso = null; });
    }
    return detEmCurso;
  }

  /* ════════════ exportação ════════════ */
  // IDs viram faixas ("1000-1450,1452"): a base inteira cabe em poucos KB.
  function faixas(ids) {
    var u = Array.from(new Set(ids)).sort(function (a, b) { return a - b; });
    var out = [], i = 0;
    while (i < u.length) {
      var ini = u[i], fim = ini;
      while (i + 1 < u.length && u[i + 1] === fim + 1) { i++; fim = u[i]; }
      out.push(ini === fim ? String(ini) : ini + '-' + fim);
      i++;
    }
    return out.join(',');
  }
  function exportar(aba, linhas, botao) {
    if (botao.disabled) return;
    var A = [], H = [];
    linhas.forEach(function (r) { (r.o ? H : A).push(r.id); });
    if (window.VBMLoading) VBMLoading.botao(botao, true, { texto: tx('dash.exportando', 'Exportando…') });
    fetch('/api/dashboard/exportar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: '*/*' },
      body: JSON.stringify({ idioma: emIngles() ? 'en' : 'pt-BR', aba: aba, chaves: { A: faixas(A), H: faixas(H) } })
    })
      .then(function (r) {
        if (!r.ok) return r.json().catch(function () { return null; }).then(function (c) { throw new Error((c && c.error) || 'HTTP ' + r.status); });
        var disp = r.headers.get('Content-Disposition') || '';
        var m = /filename="?([^";]+)"?/i.exec(disp);
        return r.blob().then(function (b) { return { b: b, nome: m ? m[1] : 'dashboard-kaizen.xlsx' }; });
      })
      .then(function (x) {
        var url = URL.createObjectURL(x.b);
        var a = document.createElement('a');
        a.href = url; a.download = x.nome;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      })
      .catch(function (err) { showToast('error', tx('dash.erroExportar', 'Erro ao exportar'), err.message); })
      .finally(function () { if (window.VBMLoading) VBMLoading.botao(botao, false); });
  }
  $('exportarBase').addEventListener('click', function () { exportar('base', linhasBase(), this); });
  $('exportarDet').addEventListener('click', function () {
    var lideres = new Set(linhasDet().map(function (o) { return o.ld; }));
    exportar('lideres', VIS.filter(function (r) { return lideres.has(r.ld); }), this);
  });

  /* ════════════ páginas, carga e idioma ════════════ */
  var VISOES = ['total', 'lider', 'detalhe', 'base'];
  function desenharVisao() {
    if (!BASE) return;
    if (visao === 'total') desenharTotal();
    else if (visao === 'lider') desenharLider();
    else if (visao === 'detalhe') desenharDetalhe();
    else { desenharBase(); if (!DET) carregarDetalhes(false).catch(function () {}); }
  }
  function mostrarVisao(v, trocarHash) {
    if (VISOES.indexOf(v) < 0) v = 'total';
    visao = v;
    VISOES.forEach(function (k) {
      $('vis-' + k).hidden = !BASE || k !== v;
      $('aba-' + k).setAttribute('aria-selected', String(k === v));
      $('aba-' + k).tabIndex = k === v ? 0 : -1;
    });
    if (trocarHash) { try { history.replaceState(null, '', '#' + v); } catch (e) {} }
    desenharVisao();
  }
  $('dashAbas').addEventListener('click', function (e) {
    var b = e.target.closest('.dash-aba'); if (b) mostrarVisao(b.dataset.vis, true);
  });
  $('dashAbas').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var i = (VISOES.indexOf(visao) + (e.key === 'ArrowRight' ? 1 : -1) + VISOES.length) % VISOES.length;
    mostrarVisao(VISOES[i], true); $('aba-' + VISOES[i]).focus();
  });

  function aplicar() {
    if (!BASE) return;
    recalcular();
    pagBase = 0; pagDet = 0;
    desenharChips();
    desenharResumo();
    desenharVisao();
  }

  function respostaJson(r) {
    if (r.ok) return r.json();
    return r.json().catch(function () { return null; }).then(function (c) {
      throw new Error((c && c.error) || ('HTTP ' + r.status));
    });
  }

  function desenharCabecalhoBase() {
    if (!BASE) return;
    $('dashQtdAtual').textContent = fmt(BASE.origem ? BASE.origem.atual : 0);
    $('dashQtdHist').textContent = fmt(BASE.origem ? BASE.origem.historico : 0);
    var d = new Date(BASE.geradoEm);
    var quando = isNaN(d) ? '' : d.toLocaleString(localidade(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    $('dashAtualizado').textContent = modelo(tx('dash.atualizadoEm', ''), { data: quando, min: Math.max(1, Math.round((BASE.validadeSegundos || 300) / 60)) });
  }

  function carregar(forcar) {
    var btn = $('dashAtualizar');
    $('dashErro').hidden = true;
    if (forcar && window.VBMLoading) VBMLoading.botao(btn, true);
    else btn.disabled = true;
    return fetch('/api/dashboard/dados' + (forcar ? '?atualizar=1' : ''), { headers: { Accept: 'application/json' } })
      .then(respostaJson)
      .then(function (p) {
        BASE = p;
        decodificar(p);
        if (forcar) { DET = null; }
        desenharCabecalhoBase();
        $('dashAbrirFiltros').disabled = false;
        aplicar();
        mostrarVisao(visao, false);
        if (forcar && visao === 'base') carregarDetalhes(true).catch(function () {});
      })
      .catch(function (err) {
        if (!BASE) {
          $('dashTiles').innerHTML = '';
          $('dashErroMsg').textContent = err.message;
          $('dashErro').hidden = false;
        } else {
          showToast('error', tx('dash.erroTitulo', 'Erro'), err.message);
        }
      })
      .finally(function () {
        if (forcar && window.VBMLoading) VBMLoading.botao(btn, false);
        btn.disabled = false;
      });
  }
  $('dashAtualizar').addEventListener('click', function () { carregar(true); });
  $('dashTentar').addEventListener('click', function () { carregar(false); });

  window.addEventListener('vbm:idioma', function () {
    if (!BASE) return;
    desenharCabecalhoBase();
    desenharChips();
    desenharResumo();
    desenharVisao();
    if ($('filtrosPainel').classList.contains('open')) desenharPainel();
  });

  visao = (location.hash || '').replace('#', '');
  if (VISOES.indexOf(visao) < 0) visao = 'total';
  VISOES.forEach(function (k) { $('aba-' + k).setAttribute('aria-selected', String(k === visao)); });
  carregar(false);

  // Exposto só para os testes automatizados (tests/teste-dashboard.js).
  window.__dashboard = { faixas: faixas, estado: function () { return { total: TODAS.length, visiveis: VIS.length, filtros: qtdFiltros() }; } };
})();
