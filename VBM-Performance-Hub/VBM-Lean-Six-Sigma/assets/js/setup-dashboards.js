/* ═══ Setup Dashboards — barra superior + painel de Configurações (padrão VBM Performance Studio / Kaizen) ═══
   Colar num <script> logo depois da marcação (setup-dashboards.html), ANTES do script do dashboard.
   Configuração opcional, declarada antes deste script:
     window.VBM_SETUP = {
       idiomaPadrao: 'pt-BR' | 'en',          // sem escolha salva; padrão 'pt-BR'
       numeroPadrao: 'pt-BR' | 'en-CA',       // sem escolha salva; padrão: pelo idioma do navegador
       urlUsuario: '/api/me'                  // { nome, email, cargo } — rota do Portal (Kaizen)
     };
   Preferências por pessoa no navegador, com as MESMAS chaves do Kaizen e do Studio,
   para valerem em todas as aplicações do Portal: vdt-theme, vdt-lang, vdt-num.
   API para o dashboard (window.VBMSetup):
     t(chave, vars)         texto no idioma atual ('Olá {nome}' + { nome: 'Ana' })
     registrar(dic)         { 'pt-BR': { chave: texto }, en: { … } } — textos do dashboard
     traduzir(raiz?)        aplica data-i18n / -aria / -title / -ph em raiz (padrão: document)
     fmt(valor, casas)      número no formato escolhido (Brasil 1.234,56 · Canadá 1,234.56)
     dataHora(data)         data e hora no idioma escolhido
     on('tema'|'idioma'|'numero', fn)   redesenhar o que o JS monta
     tema / idioma / numero (leitura) */
window.VBMSetup = (function () {
  'use strict';
  var CFG = window.VBM_SETUP || {};
  var CHAVES = { tema: 'vdt-theme', idioma: 'vdt-lang', numero: 'vdt-num' };
  var IDIOMAS = ['pt-BR', 'en'], NUMEROS = ['pt-BR', 'en-CA'];
  var DIC = {
    'pt-BR': { 'sd.menu': 'Menu', 'sd.configuracoes': 'Configurações', 'sd.fechar': 'Fechar', 'sd.tema': 'Tema', 'sd.claro': 'Claro', 'sd.escuro': 'Escuro',
      'sd.idioma': 'Idioma', 'sd.idiomaInfo': 'Idioma da interface', 'sd.numero': 'Formato numérico', 'sd.numeroInfo': 'Separador decimal e de milhar dos gráficos',
      'sd.numeroBR': 'Brasil — 1.234,56', 'sd.numeroCA': 'Canadá — 1,234.56' },
    en: { 'sd.menu': 'Menu', 'sd.configuracoes': 'Settings', 'sd.fechar': 'Close', 'sd.tema': 'Theme', 'sd.claro': 'Light', 'sd.escuro': 'Dark',
      'sd.idioma': 'Language', 'sd.idiomaInfo': 'Interface language', 'sd.numero': 'Number format', 'sd.numeroInfo': 'Decimal and thousands separators in charts',
      'sd.numeroBR': 'Brazil — 1.234,56', 'sd.numeroCA': 'Canada — 1,234.56' }
  };
  var ouvintes = { tema: [], idioma: [], numero: [] };
  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* só nesta sessão */ } }
  function avisar(evt) { ouvintes[evt].forEach(function (fn) { try { fn(estado[evt]); } catch (e) { console.error('[setup-dashboards]', e); } }); }
  var $ = function (id) { return document.getElementById(id); };

  var estado = {
    tema: ler(CHAVES.tema) === 'dark' ? 'dark' : 'light',
    idioma: IDIOMAS.indexOf(ler(CHAVES.idioma)) >= 0 ? ler(CHAVES.idioma) : (IDIOMAS.indexOf(CFG.idiomaPadrao) >= 0 ? CFG.idiomaPadrao : 'pt-BR'),
    numero: NUMEROS.indexOf(ler(CHAVES.numero)) >= 0 ? ler(CHAVES.numero)
      : NUMEROS.indexOf(CFG.numeroPadrao) >= 0 ? CFG.numeroPadrao : (/^en|^fr/i.test(navigator.language || '') ? 'en-CA' : 'pt-BR')
  };

  function t(chave, vars) {
    var s = (DIC[estado.idioma] || {})[chave];
    if (s == null) s = DIC['pt-BR'][chave];
    if (s == null) return chave;
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  function registrar(dic) {
    Object.keys(dic || {}).forEach(function (l) { DIC[l] = DIC[l] || {}; for (var k in dic[l]) DIC[l][k] = dic[l][k]; });
  }
  function traduzir(raiz) {
    raiz = raiz || document;
    raiz.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    [['data-i18n-aria', 'aria-label'], ['data-i18n-title', 'title'], ['data-i18n-ph', 'placeholder']].forEach(function (par) {
      raiz.querySelectorAll('[' + par[0] + ']').forEach(function (el) { el.setAttribute(par[1], t(el.getAttribute(par[0]))); });
    });
  }
  function fmt(v, casas) {
    return Number(v).toLocaleString(estado.numero, { minimumFractionDigits: casas, maximumFractionDigits: casas }).replace('-', '−');
  }
  function dataHora(d) {
    var l = estado.idioma === 'en' ? 'en-US' : 'pt-BR';
    return d.toLocaleDateString(l) + ' ' + d.toLocaleTimeString(l);
  }

  // ── Tema: data-bg (barra e painel) + data-theme (tokens do dashboard) ──
  function aplicarTema(tema, salvar) {
    estado.tema = tema === 'dark' ? 'dark' : 'light';
    var html = document.documentElement;
    html.setAttribute('data-bg', estado.tema);
    html.setAttribute('data-theme', estado.tema);
    if ($('btnWhite')) $('btnWhite').classList.toggle('active', estado.tema === 'light');
    if ($('btnBusiness')) $('btnBusiness').classList.toggle('active', estado.tema === 'dark');
    if (salvar) { gravar(CHAVES.tema, estado.tema); avisar('tema'); }
  }
  function aplicarIdioma(l, salvar) {
    estado.idioma = IDIOMAS.indexOf(l) >= 0 ? l : 'pt-BR';
    document.documentElement.lang = estado.idioma;
    if ($('langSelect')) $('langSelect').value = estado.idioma;
    traduzir();
    if (salvar) { gravar(CHAVES.idioma, estado.idioma); avisar('idioma'); }
  }
  function aplicarNumero(n, salvar) {
    estado.numero = NUMEROS.indexOf(n) >= 0 ? n : 'pt-BR';
    if ($('numSelect')) $('numSelect').value = estado.numero;
    if (salvar) { gravar(CHAVES.numero, estado.numero); avisar('numero'); }
  }

  // ── Painel de Configurações (engrenagem) ──
  var btn = $('settingsBtn'), painel = $('settingsPanel'), fundo = $('settingsBackdrop');
  function abrir(sim) {
    if (!painel) return;
    painel.classList.toggle('open', sim); fundo.classList.toggle('open', sim);
    btn.setAttribute('aria-expanded', String(sim)); painel.setAttribute('aria-hidden', String(!sim));
    if (sim) { var f = painel.querySelector('.theme-toggle-btn.active') || painel.querySelector('button'); if (f) f.focus(); } else btn.focus();
  }
  if (btn && painel && fundo) {
    btn.addEventListener('click', function () { abrir(!painel.classList.contains('open')); });
    $('settingsClose').addEventListener('click', function () { abrir(false); });
    fundo.addEventListener('click', function () { abrir(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && painel.classList.contains('open')) abrir(false); });
    $('btnWhite').addEventListener('click', function () { aplicarTema('light', true); });
    $('btnBusiness').addEventListener('click', function () { aplicarTema('dark', true); });
    $('langSelect').addEventListener('change', function (e) { aplicarIdioma(e.target.value, true); });
    $('numSelect').addEventListener('change', function (e) { aplicarNumero(e.target.value, true); });
  }

  // ── Tela cheia: html.is-fs (a barra superior sai de cena pelo CSS) ──
  document.addEventListener('fullscreenchange', function () {
    document.documentElement.classList.toggle('is-fs', !!document.fullscreenElement);
    if (document.fullscreenElement) abrir(false);
  });

  // ── Usuário logado: nome, cargo e iniciais (rota do Portal) ──
  fetch(CFG.urlUsuario || '/api/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (me) {
      if (!me || !$('topnavUser')) return;
      var nome = String(me.nome || me.email || '').trim();
      if (!nome) return;
      var partes = nome.split(/\s+/);
      $('topnavUserName').textContent = nome;
      $('topnavUserRole').textContent = me.cargo || '';
      $('topnavUserAvatar').textContent = ((partes[0] || '')[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '');
      $('topnavUserAvatar').title = nome;
      $('topnavUser').hidden = false;
    })
    .catch(function () { /* sem a rota (ex.: fora do Portal): a barra fica sem o usuário */ });

  aplicarTema(estado.tema, false);
  aplicarNumero(estado.numero, false);
  aplicarIdioma(estado.idioma, false);

  return {
    t: t, registrar: registrar, traduzir: traduzir, fmt: fmt, dataHora: dataHora,
    on: function (evt, fn) { if (ouvintes[evt]) ouvintes[evt].push(fn); },
    get tema() { return estado.tema; }, get idioma() { return estado.idioma; }, get numero() { return estado.numero; }
  };
})();
/* ═══ fim Setup Dashboards ═══ */
