/* =====================================================================
   Impressão do Kaizen — folha no formato do template corporativo
   "Kaizen | Improve Together" (New_Kaizen_Templete_2026.pptx).

   window.printKaizen(k, opcoes)
     k       — o objeto de GET /api/kaizens/:id
     opcoes  — { idioma: 'pt-BR'|'en', urlImagem: fn(caminho, larguraPx) }

   Abre um diálogo DO APP (não o do navegador) para escolher:
     · papel: A4, A3 ou A2
     · orientação: horizontal ou vertical
   com prévia ao vivo, e três saídas:
     · "Baixar PPT" — PowerPoint EDITÁVEL (caixas de texto, formas e fotos
       soltas, não uma imagem da folha), no mesmo papel, orientação e
       idioma, com a mesma disposição da folha. Gerado aqui mesmo
       (PptxGenJS, carregado só na primeira vez).
     · "Baixar PDF" — o PDF é gerado aqui mesmo (html2canvas-pro + jsPDF,
       carregados só na primeira vez), já no papel e orientação
       escolhidos. Não passa pela janela de impressão do navegador.
     · "Imprimir" — abre a folha com @page { size: <papel> <orientação> },
       então o diálogo do navegador já chega com papel e orientação
       definidos; é só escolher a impressora.
   A última escolha fica guardada (localStorage) para a próxima vez.

   Mapeamento template → dados do Kaizen:
     Before / Antes ............ URL_IMG_ANTES + DS_ESTADO_ANTES
     After / Depois ............ URL_IMG_DEPOIS
     Business Unit ............. NM_SITE
     What was the problem? ..... DS_PROBLEMA (+ Meta / Objetivo)
     What was the solution? .... DS_ESTADO_DEPOIS
     What are the benefits? .... DS_RESULTADO_ALCANCADO, resultado
                                 financeiro, comparação com a meta,
                                 desperdícios reduzidos
     Results Achieved .......... catálogo kzn_resultados, marcados os
                                 resultados do Kaizen
     Fotos da equipe ........... Líder + equipe (iniciais + nome);
                                 membros envolvidos listados abaixo
   ===================================================================== */
(function () {
  'use strict';

  var PAPEIS = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };
  var PREF = 'vbm-impressao-kaizen';
  var LIBS = {
    h2c: 'js/vendor/html2canvas-pro-2.5.2.min.js',
    pdf: 'js/vendor/jspdf-4.2.1.umd.min.js',
    ppt: 'js/vendor/pptxgenjs-3.12.0.bundle.min.js'
  };

  var T = {
    pt: {
      improve: 'Improve Together', results: 'Resultados Alcançados', before: 'Antes', after: 'Depois',
      bu: 'Unidade de Negócio', problem: 'Qual era o problema?', solution: 'Qual foi a solução?',
      benefits: 'Quais são os benefícios?', goal: 'Meta / Objetivo', leader: 'Líder',
      involved: 'Membros envolvidos', financial: 'Resultado financeiro', comparison: 'Comparação com a meta',
      waste: 'Desperdícios reduzidos', noImage: 'Sem imagem registrada', imgFail: 'Imagem não disponível',
      dialogTitle: 'Imprimir Kaizen', paper: 'Papel', orientation: 'Orientação', landscape: 'Horizontal',
      portrait: 'Vertical', preview: 'Prévia', cancel: 'Cancelar', print: 'Imprimir', pdf: 'Baixar PDF',
      generating: 'Gerando PDF…', preparing: 'Preparando…', size: 'Tamanho',
      hint: 'O papel e a orientação escolhidos aqui já vão definidos para a impressora, o PDF e o PPT.',
      errTitle: 'Não foi possível gerar o PDF', errMsg: 'Tente de novo ou use "Imprimir".',
      popupTitle: 'Janela bloqueada', popupMsg: 'Permita pop-ups para este site para imprimir.',
      done: 'PDF gerado', concluded: 'Concluído em',
      ppt: 'Baixar PPT', generatingPpt: 'Gerando PPT…', donePpt: 'PPT gerado',
      errPptTitle: 'Não foi possível gerar o PPT', errPptMsg: 'Tente de novo ou use "Baixar PDF".'
    },
    en: {
      improve: 'Improve Together', results: 'Results Achieved', before: 'Before', after: 'After',
      bu: 'Business Unit', problem: 'What was the problem?', solution: 'What was the solution?',
      benefits: 'What are the benefits?', goal: 'Goal / Objective', leader: 'Leader',
      involved: 'Involved members', financial: 'Financial result', comparison: 'Comparison with goal',
      waste: 'Waste reduced', noImage: 'No image recorded', imgFail: 'Image not available',
      dialogTitle: 'Print Kaizen', paper: 'Paper', orientation: 'Orientation', landscape: 'Landscape',
      portrait: 'Portrait', preview: 'Preview', cancel: 'Cancel', print: 'Print', pdf: 'Download PDF',
      generating: 'Generating PDF…', preparing: 'Preparing…', size: 'Size',
      hint: 'The paper and orientation chosen here go straight to the printer, the PDF and the PPT.',
      errTitle: 'Could not generate the PDF', errMsg: 'Try again or use "Print".',
      popupTitle: 'Window blocked', popupMsg: 'Allow pop-ups for this site to print.',
      done: 'PDF generated', concluded: 'Completed on',
      ppt: 'Download PPT', generatingPpt: 'Generating PPT…', donePpt: 'PPT generated',
      errPptTitle: 'Could not generate the PPT', errPptMsg: 'Try again or use "Download PDF".'
    }
  };

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function iniciais(n) {
    return String(n || '?').split(' ').filter(Boolean).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase();
  }
  function primeiroEUltimo(n) {
    var p = String(n || '').trim().split(/\s+/);
    if (p.length <= 2) return p.join(' ');
    return p[0] + ' ' + p[p.length - 1];
  }
  function dataCurta(v, en) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    if (!m) return '';
    return en ? m[1] + '/' + m[2] + '/' + m[3] : m[3] + '/' + m[2] + '/' + m[1];
  }
  function nomeArquivo(partes) {
    return partes.filter(Boolean).map(function (p) {
      return String(p).normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9 _-]/g, ' ').trim().replace(/\s+/g, '-');
    }).filter(Boolean).join('-').replace(/-{2,}/g, '-').toUpperCase().slice(0, 120) || 'KAIZEN';
  }
  function absoluto(u) {
    try { return new URL(u, window.location.href).href; } catch (e) { return u; }
  }
  function lerPref() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF) || '{}');
      return { papel: PAPEIS[p.papel] ? p.papel : 'A4', orientacao: p.orientacao === 'retrato' ? 'retrato' : 'paisagem' };
    } catch (e) { return { papel: 'A4', orientacao: 'paisagem' }; }
  }
  function gravarPref(cfg) { try { localStorage.setItem(PREF, JSON.stringify(cfg)); } catch (e) {} }
  function dimensoes(cfg) {
    var p = PAPEIS[cfg.papel];
    return cfg.orientacao === 'paisagem' ? { w: p[1], h: p[0] } : { w: p[0], h: p[1] };
  }

  /* ── CSS da folha ───────────────────────────────────────────────────
     Tudo em `em` sobre UM tamanho-base proporcional ao lado menor do
     papel: A3 sai exatamente como A4 ampliado, A2 idem. Cores do
     template: azul #3CB5E5 (faixas), verde-Vale #007E79 (bordas e
     título), cinza #7C7F84 (texto). */
  var CSS = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'html,body{background:#e9edf1}',
    'body{font-family:"Vale Sans","Poppins",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:#7C7F84}',
    '.pg{position:relative;overflow:hidden;background:#fff;margin:0 auto;line-height:1.28}',
    '.faixa{position:absolute;left:0;top:0;bottom:0;width:1.6%;background:#3CB5E5}',
    '.onda{position:absolute;right:0;top:0;width:20%;height:13%}',
    '.onda svg{position:absolute;inset:0;width:100%;height:100%}',
    '.onda img{position:absolute;right:9%;top:22%;height:30%}',
    '.miolo{position:absolute;left:4.2%;right:2.6%;top:2.2%;bottom:2.4%;display:grid;gap:1.1em}',
    /* cabeçalho */
    '.marca{display:flex;align-items:center;gap:.8em}',
    '.marca-txt{color:#007E79;line-height:1.02}',
    '.marca-txt b{display:block;font-weight:500;font-size:3.5em;letter-spacing:-.01em}',
    '.marca-txt span{display:block;font-size:1.95em;font-weight:400}',
    '.marca img{height:6.2em;width:auto}',
    '.res h3{font-weight:400;font-size:1.45em;color:#7C7F84;margin-bottom:.25em;text-align:center}',
    '.res ul{list-style:none;columns:2;column-gap:1.2em;font-size:1em}',
    '.res li{display:flex;gap:.45em;align-items:flex-start;break-inside:avoid;margin-bottom:.12em;color:#7C7F84}',
    '.res li i{flex:0 0 .95em;height:.95em;margin-top:.12em;border:.09em solid #555;display:inline-flex;align-items:center;justify-content:center;font-style:normal}',
    '.res li.on{color:#2f3337;font-weight:500}',
    '.res li.on i{border-color:#007E79;background:#007E79}',
    '.res li.on i:after{content:"";width:.28em;height:.5em;border:solid #fff;border-width:0 .12em .12em 0;transform:rotate(45deg) translate(-.03em,-.05em)}',
    '.res .fin{margin-top:.25em;font-size:.95em;color:#007E79;font-weight:600;text-align:center}',
    '.eqp{display:flex;flex-direction:column;align-items:flex-start;gap:.35em;min-width:0}',
    '.fotos{display:flex;gap:.7em}',
    '.pes{width:6.4em;text-align:center}',
    '.pes-cx{width:6.4em;height:6.4em;border:.16em solid #007E79;display:flex;align-items:center;justify-content:center;background:#f6fbfb}',
    '.pes-cx span{width:3.8em;height:3.8em;border-radius:50%;background:#3CB5E5;color:#fff;font-weight:600;font-size:1.05em;display:flex;align-items:center;justify-content:center;letter-spacing:.02em}',
    '.pes.lider .pes-cx span{background:#007E79}',
    '.pes-nm{font-size:.9em;color:#555;margin-top:.25em;line-height:1.15;word-break:break-word}',
    '.pes-pp{font-size:.72em;color:#007E79;font-weight:600;text-transform:uppercase;letter-spacing:.05em}',
    '.env{font-size:.85em;color:#555;line-height:1.25}',
    '.env b{color:#007E79;font-weight:600}',
    /* faixas azuis e caixas */
    '.bar{background:#3CB5E5;color:#fff;border:.13em solid #007E79;font-weight:400;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.05}',
    '.bar-g{font-size:2.6em;height:1.62em}',
    '.bar-m{font-size:1.75em;height:1.5em}',
    '.bar-bu{font-size:1.5em;height:1.6em;justify-content:space-between;padding:0 .55em;gap:.6em}',
    '.bar-bu u{text-decoration:underline;text-underline-offset:.15em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.bar-bu small{font-size:.62em;opacity:.95;white-space:nowrap}',
    '.seta-e{clip-path:polygon(4% 0,100% 0,100% 100%,4% 100%,0 50%);border:none;padding-left:4%}',
    '.seta-d{clip-path:polygon(0 0,96% 0,100% 50%,96% 100%,0 100%);border:none;padding-right:4%}',
    '.cx{border:.16em solid #007E79;background:#fff;min-height:0;overflow:hidden;display:flex;flex-direction:column}',
    '.txt{padding:.7em .9em;font-style:italic;font-size:1.22em;color:#7C7F84;line-height:1.35;overflow:hidden;flex:1;min-height:0;white-space:pre-line}',
    '.txt b{font-style:normal;color:#007E79;font-weight:600}',
    '.txt p+p{margin-top:.45em}',
    '.titulo{font-size:1.32em;font-weight:600;color:#007E79;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.foto{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#fff;padding:.4em}',
    '.foto img{max-width:100%;max-height:100%;object-fit:contain;display:block}',
    '.vazia{font-size:1.1em;color:#BCBEC0;font-style:italic}',
    '.leg{border-top:.1em solid #E6E7E8;padding:.55em .8em;font-style:italic;font-size:1.08em;color:#7C7F84;line-height:1.32;max-height:38%;overflow:hidden}',
    '.col{display:flex;flex-direction:column;gap:.55em;min-height:0}',
    '.rod{position:absolute;right:2.6%;bottom:.7%;font-size:.78em;color:#BCBEC0}',
    /* PAISAGEM: cabeçalho em linha, 3 colunas como o template */
    '.paisagem .miolo{grid-template-rows:auto 1fr}',
    '.paisagem .cab{display:grid;grid-template-columns:auto minmax(0,22em) minmax(0,1fr);gap:2.2em;align-items:start;padding-right:16.5%}',
    '.paisagem .corpo{display:grid;grid-template-columns:28fr 34fr 28fr;gap:2.2em;min-height:0}',
    '.paisagem .centro{display:grid;grid-template-rows:auto auto auto 1fr auto 1fr auto 1fr;gap:.45em;min-height:0}',
    '.paisagem .lado .cx{flex:1}',
    /* RETRATO: cabeçalho em 2 linhas, Antes|Depois lado a lado, textos embaixo */
    '.retrato .miolo{grid-template-rows:auto auto auto minmax(0,1fr) minmax(0,1.3fr)}',
    '.retrato .cab{display:grid;grid-template-columns:1fr;gap:1em;padding-right:24%}',
    '.retrato .cab2{display:grid;grid-template-columns:auto 1fr;gap:2em;align-items:start}',
    '.retrato .bu{display:flex;flex-direction:column;gap:.45em}',
    '.retrato .ba{display:grid;grid-template-columns:1fr 1fr;gap:1.4em;min-height:0}',
    '.retrato .ba .cx{flex:1}',
    '.retrato .centro{display:grid;grid-template-rows:auto 1fr auto 1fr auto 1fr;gap:.45em;min-height:0}',
    '@media print{html,body{background:#fff}.pg{margin:0}}'
  ].join('\n');

  /* SVG da onda azul do canto (curva do template). */
  var ONDA = '<svg viewBox="0 0 1356 451" preserveAspectRatio="none"><path fill="#3CB5E5" d="M0 0H1356V451C1180 451 1050 400 900 330 760 265 650 170 520 105 390 40 240 0 0 0Z"/></svg>';

  /* ── Montagem da folha ───────────────────────────────────────────── */
  function montarFolha(k, cfg, ctx) {
    var en = ctx.idioma === 'en';
    var t = T[en ? 'en' : 'pt'];
    var d = dimensoes(cfg);
    var base = Math.min(d.w, d.h) * 0.0148;   // mm → A4 ≈ 3,1 mm (~8,8 pt)
    var paisagem = cfg.orientacao === 'paisagem';

    // Results Achieved: catálogo inteiro, marcados os do Kaizen. Resultado
    // do Kaizen que saiu do catálogo (inativo) entra também, marcado.
    var marcados = {};
    (k.RESULTADOS || []).forEach(function (r) { marcados[r.ID_RESULTADO != null ? 'i' + r.ID_RESULTADO : 'n' + r.NM_RESULTADO] = r; });
    var itens = [];
    var vistos = {};
    (ctx.catalogo || []).forEach(function (c) {
      var on = !!marcados['i' + c.ID] || Object.keys(marcados).some(function (key) { return marcados[key].NM_RESULTADO === c.NM; });
      if (!c.ATIVO && !on) return;
      vistos[c.NM] = true;
      itens.push({ nm: c.NM, on: on });
    });
    (k.RESULTADOS || []).forEach(function (r) { if (!vistos[r.NM_RESULTADO]) itens.push({ nm: r.NM_RESULTADO, on: true }); });
    var fin = '';
    if (k.VL_RESULTADO_FINANCEIRO != null && k.VL_RESULTADO_FINANCEIRO !== '') {
      fin = (k.SG_MOEDA ? k.SG_MOEDA + ' ' : '') + Number(k.VL_RESULTADO_FINANCEIRO)
        .toLocaleString(en ? 'en-US' : 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    var blocoRes = '<div class="res"><h3>' + esc(t.results) + '</h3><ul>' +
      itens.map(function (i) { return '<li class="' + (i.on ? 'on' : '') + '"><i></i><span>' + esc(i.nm) + '</span></li>'; }).join('') +
      '</ul>' + (fin ? '<div class="fin">' + esc(t.financial) + ': ' + esc(fin) + '</div>' : '') + '</div>';

    // Equipe: líder + equipe principal nas "fotos"; envolvidos em texto.
    var vistosP = {};
    var unico = function (p) { var c = String(p.NM_USUARIO || '').trim().toUpperCase(); if (!c || vistosP[c]) return false; vistosP[c] = true; return true; };
    var pessoas = [{ NM_USUARIO: k.NM_LIDER, lider: true }].filter(unico).concat((k.MEMBROS || []).filter(unico));
    var envolvidos = (k.ENVOLVIDOS || []).filter(unico).map(function (p) { return p.NM_USUARIO; });
    var blocoEqp = '<div class="eqp"><div class="fotos">' + pessoas.map(function (p) {
      return '<div class="pes' + (p.lider ? ' lider' : '') + '"><div class="pes-cx"><span>' + esc(iniciais(p.NM_USUARIO)) + '</span></div>' +
        '<div class="pes-nm">' + esc(primeiroEUltimo(p.NM_USUARIO)) + '</div>' +
        (p.lider ? '<div class="pes-pp">' + esc(t.leader) + '</div>' : '') + '</div>';
    }).join('') + '</div>' +
      (envolvidos.length ? '<div class="env"><b>' + esc(t.involved) + ':</b> ' + esc(envolvidos.join(', ')) + '</div>' : '') + '</div>';

    var marca = '<div class="marca"><div class="marca-txt"><b>Kaizen</b><span>' + esc(t.improve) + '</span></div>' +
      '<img src="' + esc(absoluto('assets/images/vps-logo.png')) + '" alt="VPS"/></div>';

    var larguraFoto = Math.round(Math.min(2600, d.w * 5.5));
    var foto = function (caminho) {
      if (!caminho) return '<div class="foto"><span class="vazia">' + esc(t.noImage) + '</span></div>';
      return '<div class="foto"><img src="' + esc(absoluto(ctx.urlImagem(caminho, larguraFoto))) + '" alt="" data-falha="' + esc(t.imgFail) + '"/></div>';
    };
    var caixaAntes = '<div class="cx">' + foto(k.URL_IMG_ANTES) +
      (k.DS_ESTADO_ANTES ? '<div class="leg">' + esc(k.DS_ESTADO_ANTES) + '</div>' : '') + '</div>';
    var caixaDepois = '<div class="cx">' + foto(k.URL_IMG_DEPOIS) + '</div>';

    var problema = '<p>' + esc(k.DS_PROBLEMA || '—') + '</p>' +
      (k.DS_OBJETIVO ? '<p><b>' + esc(t.goal) + ':</b> ' + esc(k.DS_OBJETIVO) + '</p>' : '');
    var beneficios = [];
    if (k.DS_RESULTADO_ALCANCADO) beneficios.push('<p>' + esc(k.DS_RESULTADO_ALCANCADO) + '</p>');
    if (fin) beneficios.push('<p><b>' + esc(t.financial) + ':</b> ' + esc(fin) + '</p>');
    if (k.DS_RESULTADO_ESPERADO) beneficios.push('<p><b>' + esc(t.comparison) + ':</b> ' + esc(k.DS_RESULTADO_ESPERADO) + '</p>');
    if ((k.DESPERDICIOS || []).length) beneficios.push('<p><b>' + esc(t.waste) + ':</b> ' + esc(k.DESPERDICIOS.join(', ')) + '</p>');
    if (!beneficios.length) beneficios.push('<p>—</p>');

    var dataRef = dataCurta(k.DT_CONCLUSAO || k.DT_CRIACAO, en);
    var bu = '<div class="bar bar-bu"><u>' + esc(t.bu) + ': ' + esc(k.NM_SITE || '—') + '</u><small>' +
      esc([k.ROTULO, dataRef].filter(Boolean).join(' · ')) + '</small></div>';
    var titulo = '<div class="titulo">' + esc(k.NM_KAIZEN || '') + '</div>';
    var centro = (paisagem ? bu + titulo : '') +
      '<div class="bar bar-m seta-e">' + esc(t.problem) + '</div>' +
      '<div class="cx"><div class="txt">' + problema + '</div></div>' +
      '<div class="bar bar-m seta-d">' + esc(t.solution) + '</div>' +
      '<div class="cx"><div class="txt">' + esc(k.DS_ESTADO_DEPOIS || '—') + '</div></div>' +
      '<div class="bar bar-m">' + esc(t.benefits) + '</div>' +
      '<div class="cx"><div class="txt">' + beneficios.join('') + '</div></div>';

    var corpo;
    if (paisagem) {
      corpo = '<div class="cab">' + marca + blocoRes + blocoEqp + '</div>' +
        '<div class="corpo">' +
          '<div class="col lado"><div class="bar bar-g">' + esc(t.before) + '</div>' + caixaAntes + '</div>' +
          '<div class="centro">' + centro + '</div>' +
          '<div class="col lado"><div class="bar bar-g">' + esc(t.after) + '</div>' + caixaDepois + '</div>' +
        '</div>';
    } else {
      corpo = '<div class="cab">' + marca + '</div>' +
        '<div class="cab2">' + blocoRes + blocoEqp + '</div>' +
        '<div class="bu">' + bu + titulo + '</div>' +
        '<div class="ba">' +
          '<div class="col"><div class="bar bar-g">' + esc(t.before) + '</div>' + caixaAntes + '</div>' +
          '<div class="col"><div class="bar bar-g">' + esc(t.after) + '</div>' + caixaDepois + '</div>' +
        '</div>' +
        '<div class="centro">' + centro + '</div>';
    }

    var fontes = Array.prototype.slice.call(document.querySelectorAll('link[rel~="stylesheet"]'))
      .map(function (l) { return l.href; })
      .filter(function (h) { return /poppins\.css/i.test(h); })
      .map(function (h) { return '<link rel="stylesheet" href="' + esc(h) + '"/>'; }).join('');

    var html = '<!doctype html><html lang="' + (en ? 'en' : 'pt-BR') + '"><head><meta charset="utf-8"/>' +
      '<title>' + esc(nomeArquivo([k.ROTULO, k.NM_SITE, k.NM_LIDER])) + '</title>' + fontes +
      '<style>@page{size:' + d.w + 'mm ' + d.h + 'mm;margin:0}' + CSS +
      '.pg{width:' + d.w + 'mm;height:' + d.h + 'mm;font-size:' + base.toFixed(3) + 'mm}</style></head><body>' +
      '<div class="pg ' + (paisagem ? 'paisagem' : 'retrato') + '">' +
        '<div class="faixa"></div><div class="onda">' + ONDA +
        '<img src="' + esc(absoluto('assets/images/vale-logo.svg')) + '" alt="Vale"/></div>' +
        '<div class="miolo">' + corpo + '</div>' +
        '<div class="rod">' + esc([k.ROTULO, k.NM_CATEGORIA, k.NM_STATUS].filter(Boolean).join(' · ')) + '</div>' +
      '</div></body></html>';
    return { html: html, w: d.w, h: d.h };
  }

  /* Espera imagens e fontes; foto que falha vira aviso no lugar. */
  function quandoPronto(doc) {
    var imgs = Array.prototype.slice.call(doc.images || []);
    var pend = imgs.map(function (img) {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(function (ok) {
        var falhou = function () {
          var cx = img.parentNode;
          if (cx) cx.innerHTML = '<span class="vazia">' + esc(img.getAttribute('data-falha') || '') + '</span>';
          ok();
        };
        if (img.complete) { falhou(); return; }
        img.addEventListener('load', function () { ok(); }, { once: true });
        img.addEventListener('error', falhou, { once: true });
      });
    });
    var fontes = doc.fonts && doc.fonts.ready ? Promise.resolve(doc.fonts.ready).catch(function () {}) : Promise.resolve();
    return Promise.race([
      Promise.all(pend.concat([fontes])),
      new Promise(function (ok) { setTimeout(ok, 20000); })
    ]).then(function () { return new Promise(function (ok) { setTimeout(ok, 60); }); });
  }

  /* Texto que não cabe na caixa encolhe aos poucos (até 62%) em vez de
     ser cortado — 300 caracteres numa caixa pequena do A4 retrato. */
  function ajustarTextos(doc) {
    Array.prototype.forEach.call(doc.querySelectorAll('.txt, .leg, .env'), function (el) {
      var tam = 100;
      el.style.fontSize = '';
      var base = parseFloat(doc.defaultView.getComputedStyle(el).fontSize);
      while (el.scrollHeight > el.clientHeight + 1 && tam > 62) {
        tam -= 4;
        el.style.fontSize = (base * tam / 100) + 'px';
      }
    });
  }

  function carregarScript(src) {
    return new Promise(function (ok, erro) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { erro(new Error('falha ao carregar ' + src)); };
      document.head.appendChild(s);
    });
  }
  var libsPromessa = null;
  function carregarLibs() {
    if (window.html2canvas && window.jspdf) return Promise.resolve();
    if (!libsPromessa) {
      libsPromessa = Promise.all([
        window.html2canvas ? Promise.resolve() : carregarScript(LIBS.h2c),
        window.jspdf ? Promise.resolve() : carregarScript(LIBS.pdf)
      ]).catch(function (e) { libsPromessa = null; throw e; });
    }
    return libsPromessa;
  }

  /* Folha num iframe fora da tela (mesma origem: html2canvas lê o DOM e
     as fotos de /api/kaizens/imagem sem restrição de CORS). */
  function folhaEmIframe(folha) {
    var ifr = document.createElement('iframe');
    ifr.setAttribute('aria-hidden', 'true');
    ifr.tabIndex = -1;
    ifr.style.cssText = 'position:fixed;left:-20000px;top:0;border:0;width:' + folha.w + 'mm;height:' + folha.h + 'mm;';
    document.body.appendChild(ifr);
    var doc = ifr.contentDocument;
    doc.open(); doc.write(folha.html); doc.close();
    return new Promise(function (ok) {
      var ir = function () { quandoPronto(doc).then(function () { ajustarTextos(doc); ok(ifr); }); };
      if (doc.readyState === 'complete') ir(); else ifr.addEventListener('load', ir, { once: true });
    });
  }

  function gerarPdf(k, cfg, ctx) {
    var folha = montarFolha(k, cfg, ctx);
    return carregarLibs().then(function () { return folhaEmIframe(folha); }).then(function (ifr) {
      var alvo = ifr.contentDocument.querySelector('.pg');
      var pxLargura = alvo.getBoundingClientRect().width;
      // ~200 dpi no A4; A3/A2 sobem a resolução, com teto de 7000 px.
      var escala = Math.max(1, Math.min(7000 / pxLargura, folha.w * 3.78 * 2.2 / pxLargura * (folha.w > 300 ? 0.85 : 1)));
      return window.html2canvas(alvo, { scale: escala, backgroundColor: '#ffffff', useCORS: true, logging: false })
        .then(function (canvas) {
          var JsPDF = window.jspdf.jsPDF;
          var pdf = new JsPDF({ orientation: folha.w > folha.h ? 'landscape' : 'portrait', unit: 'mm', format: [Math.min(folha.w, folha.h), Math.max(folha.w, folha.h)], compress: true });
          pdf.setProperties({ title: (k.ROTULO || '') + ' — ' + (k.NM_KAIZEN || ''), creator: 'VBM Kaizen' });
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, folha.w, folha.h, undefined, 'FAST');
          pdf.save(nomeArquivo([k.ROTULO, k.NM_SITE, k.NM_LIDER, cfg.papel]) + '.pdf');
        })
        .finally(function () { ifr.remove(); });
    });
  }

  /* ── PowerPoint editável ─────────────────────────────────────────────
     Mesma folha, desenhada com objetos do PowerPoint: cada texto é uma
     caixa de texto, cada faixa uma forma e cada foto uma imagem solta —
     dá para editar, mover e reaproveitar no PPT. Medidas em mm, as
     mesmas proporções do CSS da folha (`e` = 1em da folha). O PowerPoint
     não encolhe texto sozinho ao abrir o arquivo, então o tamanho da
     fonte de cada caixa é estimado aqui (até 62%, como na folha). */
  var pptPromessa = null;
  function carregarPpt() {
    if (window.PptxGenJS) return Promise.resolve();
    if (!pptPromessa) pptPromessa = carregarScript(LIBS.ppt).catch(function (e) { pptPromessa = null; throw e; });
    return pptPromessa;
  }

  function imagemDeUrl(src) {
    return new Promise(function (ok, erro) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { erro(new Error('imagem não carregou: ' + src)); };
      img.src = src;
    });
  }
  /* Foto -> JPEG (o PowerPoint não abre WEBP), no máximo `maxPx` de lado. */
  function rasterizar(img, tipo, maxPx) {
    var r = Math.min(1, maxPx / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    var w = Math.max(1, Math.round((img.naturalWidth || img.width) * r)), h = Math.max(1, Math.round((img.naturalHeight || img.height) * r));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    if (tipo === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
    g.drawImage(img, 0, 0, w, h);
    return { data: c.toDataURL(tipo, 0.88), w: w, h: h };
  }
  function foto(url, maxPx) {
    if (!url) return Promise.resolve(null);
    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(function (b) {
        var u = URL.createObjectURL(b);
        return imagemDeUrl(u).then(function (img) { var x = rasterizar(img, 'image/jpeg', maxPx); URL.revokeObjectURL(u); return x; },
          function (e) { URL.revokeObjectURL(u); throw e; });
      })
      .catch(function (e) { console.warn('[impressão] PPT sem a foto:', e.message); return null; });
  }
  function svgPng(svg, w, h) {
    // Sem xmlns o navegador não desenha o SVG como imagem (caso da ONDA).
    var marcado = svg.replace(/<svg\b/, '<svg width="' + w + '" height="' + h + '"' +
      (/xmlns=/.test(svg) ? '' : ' xmlns="http://www.w3.org/2000/svg"'));
    return imagemDeUrl('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(marcado))
      .then(function (img) { return rasterizar(img, 'image/png', Math.max(w, h)); })
      .catch(function () { return null; });
  }
  function logoPng(caminho, alturaPx) {
    return fetch(absoluto(caminho)).then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (svg) {
        var vb = /viewBox="\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(svg);
        var prop = vb ? parseFloat(vb[1]) / parseFloat(vb[2]) : 71 / 28;
        return svgPng(svg.replace(/\s(width|height)="[^"]*"/g, ''), Math.round(alturaPx * prop), alturaPx);
      })
      .catch(function () { return null; });
  }
  function pngDeUrl(caminho) {
    return imagemDeUrl(absoluto(caminho)).then(function (img) { return rasterizar(img, 'image/png', 1200); }).catch(function () { return null; });
  }

  /* Fonte que cabe na caixa: estimativa pela largura média do caractere. */
  function linhasDe(textos, wMm, fMm) {
    var porLinha = Math.max(1, Math.floor(wMm / (fMm * 0.52)));
    return textos.reduce(function (n, p) { return n + Math.max(1, Math.ceil(String(p).length / porLinha)); }, 0);
  }
  function fonteQueCabe(paragrafos, wMm, hMm, pt, minimo) {
    var textos = paragrafos.join('\n').split('\n');
    var espacos = Math.max(0, paragrafos.length - 1) * 4 * 0.3528;   // paraSpaceAfter: 4 pt
    for (var r = 1; r >= (minimo || 0.62); r -= 0.04) {
      var fMm = pt * r * 0.3528;
      if (linhasDe(textos, wMm, fMm) * fMm * 1.38 + espacos <= hMm) return +(pt * r).toFixed(1);
    }
    return +(pt * (minimo || 0.62)).toFixed(1);
  }

  function gerarPpt(k, cfg, ctx) {
    var en = ctx.idioma === 'en';
    var t = T[en ? 'en' : 'pt'];
    var d = dimensoes(cfg), W = d.w, H = d.h;
    var paisagem = cfg.orientacao === 'paisagem';
    var e = Math.min(W, H) * 0.0148;                 // 1em da folha, em mm
    var PT = e * 2.8346;                             // 1em em pontos
    var IN = function (mm) { return +(mm / 25.4).toFixed(4); };
    var FONTE = 'Arial', VERDE = '007E79', AZUL = '3CB5E5', CINZA = '7C7F84';
    var larguraFoto = Math.round(Math.min(2600, W * 5.5));

    // Mesmo conteúdo da folha (montarFolha).
    var marcados = {};
    (k.RESULTADOS || []).forEach(function (r) { marcados[r.ID_RESULTADO != null ? 'i' + r.ID_RESULTADO : 'n' + r.NM_RESULTADO] = r; });
    var itens = [], vistos = {};
    (ctx.catalogo || []).forEach(function (c) {
      var on = !!marcados['i' + c.ID] || Object.keys(marcados).some(function (key) { return marcados[key].NM_RESULTADO === c.NM; });
      if (!c.ATIVO && !on) return;
      vistos[c.NM] = true; itens.push({ nm: c.NM, on: on });
    });
    (k.RESULTADOS || []).forEach(function (r) { if (!vistos[r.NM_RESULTADO]) itens.push({ nm: r.NM_RESULTADO, on: true }); });
    var fin = '';
    if (k.VL_RESULTADO_FINANCEIRO != null && k.VL_RESULTADO_FINANCEIRO !== '') {
      fin = (k.SG_MOEDA ? k.SG_MOEDA + ' ' : '') + Number(k.VL_RESULTADO_FINANCEIRO)
        .toLocaleString(en ? 'en-US' : 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    var vistosP = {};
    var unico = function (p) { var c = String(p.NM_USUARIO || '').trim().toUpperCase(); if (!c || vistosP[c]) return false; vistosP[c] = true; return true; };
    var pessoas = [{ NM_USUARIO: k.NM_LIDER, lider: true }].filter(unico).concat((k.MEMBROS || []).filter(unico));
    var envolvidos = (k.ENVOLVIDOS || []).filter(unico).map(function (p) { return p.NM_USUARIO; });

    return carregarPpt().then(function () {
      return Promise.all([
        foto(k.URL_IMG_ANTES ? absoluto(ctx.urlImagem(k.URL_IMG_ANTES, larguraFoto)) : null, 1800),
        foto(k.URL_IMG_DEPOIS ? absoluto(ctx.urlImagem(k.URL_IMG_DEPOIS, larguraFoto)) : null, 1800),
        pngDeUrl('assets/images/vps-logo.png'),
        logoPng('assets/images/vale-logo.svg', 240),
        svgPng(ONDA, Math.round(W * 0.2 * 12), Math.round(H * 0.13 * 12))
      ]);
    }).then(function (img) {
      var fotoAntes = img[0], fotoDepois = img[1], vps = img[2], vale = img[3], onda = img[4];
      var pptx = new window.PptxGenJS();
      pptx.defineLayout({ name: 'KAIZEN', width: IN(W), height: IN(H) });
      pptx.layout = 'KAIZEN';
      pptx.title = (k.ROTULO || '') + ' — ' + (k.NM_KAIZEN || '');
      pptx.company = 'Vale';
      var sl = pptx.addSlide();
      sl.background = { color: 'FFFFFF' };
      var S = pptx.ShapeType;
      var borda = { color: VERDE, width: +(0.16 * PT).toFixed(2) };

      function texto(runs, x, y, w, h, o) {
        sl.addText(runs, Object.assign({ x: IN(x), y: IN(y), w: IN(w), h: IN(h), fontFace: FONTE, color: CINZA, margin: 0, valign: 'top' }, o || {}));
      }
      function imagem(im, x, y, w, h) {
        if (!im) return;
        var r = Math.min(w / im.w, h / im.h), iw = im.w * r, ih = im.h * r;
        sl.addImage({ data: im.data.replace(/^data:/, ''), x: IN(x + (w - iw) / 2), y: IN(y + (h - ih) / 2), w: IN(iw), h: IN(ih) });
      }
      function barra(txt, x, y, w, h, em, forma, inverter) {
        sl.addText(txt, { x: IN(x), y: IN(y), w: IN(w), h: IN(h), shape: forma || S.rect, flipH: !!inverter,
          fill: { color: AZUL }, line: forma ? undefined : borda, fontFace: FONTE, fontSize: +(em * PT).toFixed(1),
          color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0 });
      }
      // Caixa de texto do template: borda verde, itálico cinza, rótulos em verde.
      function caixa(pars, x, y, w, h) {
        sl.addShape(S.rect, { x: IN(x), y: IN(y), w: IN(w), h: IN(h), fill: { color: 'FFFFFF' }, line: borda });
        var pad = 0.8 * e;
        var tam = fonteQueCabe(pars.map(function (p) { return (p.rot ? p.rot + ': ' : '') + p.txt; }), w - 2 * pad, h - 2 * pad, 1.22 * PT);
        var runs = [];
        pars.forEach(function (p, i) {
          var fim = i === pars.length - 1;
          if (p.rot) runs.push({ text: p.rot + ': ', options: { bold: true, italic: false, color: VERDE } });
          runs.push({ text: p.txt, options: { italic: true, color: CINZA, breakLine: !fim, paraSpaceAfter: fim ? 0 : 4 } });
        });
        texto(runs, x + pad, y + pad, w - 2 * pad, h - 2 * pad, { fontSize: tam, lineSpacingMultiple: 1.1 });
      }
      function caixaFoto(im, legenda, x, y, w, h) {
        sl.addShape(S.rect, { x: IN(x), y: IN(y), w: IN(w), h: IN(h), fill: { color: 'FFFFFF' }, line: borda });
        var hLeg = 0;
        if (legenda) {
          hLeg = Math.min(h * 0.38, Math.max(3 * e, Math.ceil(legenda.length / Math.max(1, (w - 1.6 * e) / (1.08 * e * 0.5))) * 1.08 * e * 1.35 + 1.2 * e));
          var yL = y + h - hLeg;
          sl.addShape(S.line, { x: IN(x), y: IN(yL), w: IN(w), h: 0, line: { color: 'E6E7E8', width: 0.75 } });
          texto(legenda, x + 0.8 * e, yL + 0.5 * e, w - 1.6 * e, hLeg - e,
            { italic: true, fontSize: fonteQueCabe([legenda], w - 1.6 * e, hLeg - e, 1.08 * PT) });
        }
        var pad = 0.4 * e;
        if (im) imagem(im, x + pad, y + pad, w - 2 * pad, h - hLeg - 2 * pad);
        else texto(t.noImage, x, y, w, h - hLeg, { italic: true, color: 'BCBEC0', fontSize: +(1.1 * PT).toFixed(1), align: 'center', valign: 'middle' });
      }

      // Faixa lateral, onda do canto com o logo Vale, rodapé.
      sl.addShape(S.rect, { x: 0, y: 0, w: IN(W * 0.016), h: IN(H), fill: { color: AZUL }, line: { color: AZUL, width: 0 } });
      if (onda) sl.addImage({ data: onda.data.replace(/^data:/, ''), x: IN(W * 0.8), y: 0, w: IN(W * 0.2), h: IN(H * 0.13) });
      if (vale) {
        var lh = H * 0.13 * 0.3, lw = lh * vale.w / vale.h;
        sl.addImage({ data: vale.data.replace(/^data:/, ''), x: IN(W - W * 0.2 * 0.09 - lw), y: IN(H * 0.13 * 0.22), w: IN(lw), h: IN(lh) });
      }
      texto([k.ROTULO, k.NM_CATEGORIA, k.NM_STATUS].filter(Boolean).join(' · '), W * 0.3, H - H * 0.007 - 1.3 * e, W * 0.674, 1.3 * e,
        { fontSize: +(0.78 * PT).toFixed(1), color: 'BCBEC0', align: 'right' });

      var x0 = W * 0.042, x1 = W - W * 0.026, y0 = H * 0.022, y1 = H - H * 0.024, iw = x1 - x0;

      // Marca "Kaizen / Improve Together" + logo VPS.
      function marca(x, y) {
        texto([{ text: 'Kaizen', options: { fontSize: +(3.5 * PT).toFixed(1), breakLine: true } },
               { text: t.improve, options: { fontSize: +(1.95 * PT).toFixed(1) } }],
          x, y, 17 * e, 6.2 * e, { color: VERDE, valign: 'middle', lineSpacingMultiple: 0.95 });
        var lwV = 0;
        if (vps) { lwV = 6.2 * e * vps.w / vps.h; imagem(vps, x + 17.5 * e, y, lwV, 6.2 * e); }
        return 17.5 * e + lwV;
      }
      // "Resultados Alcançados": título + lista em duas colunas.
      function resultados(x, y, w) {
        texto(t.results, x, y, w, 1.8 * e, { fontSize: +(1.45 * PT).toFixed(1), align: 'center' });
        var metade = Math.ceil(itens.length / 2), colW = (w - 1.2 * e) / 2;
        var cols = [itens.slice(0, metade), itens.slice(metade)];
        // Fonte da lista: o item mais longo cabe numa linha (até 72% de 1em).
        // Se nem assim couber, quebra — e a altura sai da coluna com mais linhas.
        var maior = itens.reduce(function (m, i) { return Math.max(m, i.nm.length + 2); }, 1);
        var ptLista = Math.max(0.72 * PT, Math.min(PT, colW / (maior * 0.56 * 0.3528)));
        var fLista = ptLista * 0.3528;
        var hLista = Math.max.apply(null, cols.map(function (col) {
          var porLinha = Math.max(1, Math.floor(colW / (fLista * 0.56)));
          return col.reduce(function (n, i) { return n + Math.max(1, Math.ceil((i.nm.length + 2) / porLinha)); }, 0) * fLista * 1.35;
        })) + 0.3 * e;
        cols.forEach(function (col, ci) {
          if (!col.length) return;
          texto(col.map(function (i, n) {
            return { text: (i.on ? '☑ ' : '☐ ') + i.nm, options: { bold: i.on, color: i.on ? '2F3337' : CINZA, breakLine: n < col.length - 1 } };
          }), x + ci * (colW + 1.2 * e), y + 1.9 * e, colW, hLista, { fontSize: +ptLista.toFixed(1), lineSpacingMultiple: 1.05 });
        });
        var h = 1.9 * e + hLista;
        if (fin) { texto(t.financial + ': ' + fin, x, y + h + 0.2 * e, w, 1.4 * e, { fontSize: +(0.95 * PT).toFixed(1), bold: true, color: VERDE, align: 'center' }); h += 1.6 * e; }
        return h;
      }
      // Equipe: "fotos" com iniciais (líder em verde), nome e papel; envolvidos em texto.
      function equipe(x, y, w) {
        var lado = 6.4 * e, passo = lado + 0.7 * e, cabem = Math.max(1, Math.floor((w + 0.7 * e) / passo));
        pessoas.slice(0, cabem).forEach(function (p, i) {
          var px = x + i * passo;
          sl.addShape(S.rect, { x: IN(px), y: IN(y), w: IN(lado), h: IN(lado), fill: { color: 'F6FBFB' }, line: borda });
          var dc = 3.8 * e;
          sl.addText(iniciais(p.NM_USUARIO), { x: IN(px + (lado - dc) / 2), y: IN(y + (lado - dc) / 2), w: IN(dc), h: IN(dc), shape: S.ellipse,
            fill: { color: p.lider ? VERDE : AZUL }, line: { color: p.lider ? VERDE : AZUL, width: 0 }, fontFace: FONTE,
            fontSize: +(1.05 * PT).toFixed(1), bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0 });
          var runs = [{ text: primeiroEUltimo(p.NM_USUARIO), options: { color: '555555', fontSize: +(0.9 * PT).toFixed(1), breakLine: !!p.lider } }];
          if (p.lider) runs.push({ text: t.leader.toUpperCase(), options: { color: VERDE, bold: true, fontSize: +(0.72 * PT).toFixed(1) } });
          texto(runs, px - 0.3 * e, y + lado + 0.25 * e, lado + 0.6 * e, 3.2 * e, { align: 'center' });
        });
        var h = lado + 3.5 * e;
        if (envolvidos.length) {
          var txtEnv = envolvidos.join(', ');
          var hEnv = Math.min(4.5 * e, Math.ceil((t.involved.length + txtEnv.length + 2) / Math.max(1, w / (0.85 * e * 0.5))) * 0.85 * e * 1.3 + 0.4 * e);
          texto([{ text: t.involved + ': ', options: { bold: true, color: VERDE } }, { text: txtEnv, options: { color: '555555' } }],
            x, y + h, w, hEnv, { fontSize: fonteQueCabe([t.involved + ': ' + txtEnv], w, hEnv, 0.85 * PT) });
          h += hEnv;
        }
        return h;
      }
      // Faixa da Unidade de Negócio + título do Kaizen.
      function unidade(x, y, w) {
        var h = 2.4 * e;
        sl.addShape(S.rect, { x: IN(x), y: IN(y), w: IN(w), h: IN(h), fill: { color: AZUL }, line: borda });
        texto(t.bu + ': ' + (k.NM_SITE || '—'), x + 0.8 * e, y, w * 0.62, h, { fontSize: +(1.5 * PT).toFixed(1), color: 'FFFFFF', underline: { style: 'sng' }, valign: 'middle' });
        texto([k.ROTULO, dataCurta(k.DT_CONCLUSAO || k.DT_CRIACAO, en)].filter(Boolean).join(' · '), x + w * 0.62, y, w * 0.38 - 0.8 * e, h,
          { fontSize: +(0.93 * PT).toFixed(1), color: 'FFFFFF', align: 'right', valign: 'middle' });
        var hT = 3.3 * e;
        texto(k.NM_KAIZEN || '', x, y + h + 0.45 * e, w, hT, { fontSize: fonteQueCabe([k.NM_KAIZEN || ''], w, hT, 1.32 * PT, 0.75), bold: true, color: VERDE });
        return h + 0.45 * e + hT;
      }
      // Problema / Solução / Benefícios, com as faixas em seta do template.
      function centro(x, y, w, h) {
        var hb = 2.6 * e, g = 0.45 * e, hc = (h - 3 * hb - 5 * g) / 3;
        var problema = [{ txt: k.DS_PROBLEMA || '—' }];
        if (k.DS_OBJETIVO) problema.push({ rot: t.goal, txt: k.DS_OBJETIVO });
        var benef = [];
        if (k.DS_RESULTADO_ALCANCADO) benef.push({ txt: k.DS_RESULTADO_ALCANCADO });
        if (fin) benef.push({ rot: t.financial, txt: fin });
        if (k.DS_RESULTADO_ESPERADO) benef.push({ rot: t.comparison, txt: k.DS_RESULTADO_ESPERADO });
        if ((k.DESPERDICIOS || []).length) benef.push({ rot: t.waste, txt: k.DESPERDICIOS.join(', ') });
        if (!benef.length) benef.push({ txt: '—' });
        var yy = y;
        barra(t.problem, x, yy, w, hb, 1.75, S.homePlate, true); yy += hb + g;
        caixa(problema, x, yy, w, hc); yy += hc + g;
        barra(t.solution, x, yy, w, hb, 1.75, S.homePlate, false); yy += hb + g;
        caixa([{ txt: k.DS_ESTADO_DEPOIS || '—' }], x, yy, w, hc); yy += hc + g;
        barra(t.benefits, x, yy, w, hb, 1.75); yy += hb + g;
        caixa(benef, x, yy, w, hc);
      }
      function colunaFoto(rot, im, legenda, x, y, w, h) {
        var hb = 1.62 * 2.6 * e;
        barra(rot, x, y, w, hb, 2.6);
        caixaFoto(im, legenda, x, y + hb + 0.55 * e, w, h - hb - 0.55 * e);
      }

      if (paisagem) {
        var limite = x1 - iw * 0.165, gap = 2.2 * e;
        var wm = marca(x0, y0);
        var xr = x0 + wm + gap, wr = Math.min(22 * e, (limite - xr) * 0.5);
        var hr = resultados(xr, y0, wr);
        var xe = xr + wr + gap;
        var he = equipe(xe, y0, Math.max(10 * e, limite - xe));
        var yc = y0 + Math.max(6.2 * e, hr, he) + 1.1 * e, hcorpo = y1 - yc;
        var tot = iw - 2 * gap, wl = tot * 28 / 90, wc = tot * 34 / 90;
        colunaFoto(t.before, fotoAntes, k.DS_ESTADO_ANTES, x0, yc, wl, hcorpo);
        var xc = x0 + wl + gap;
        var hu = unidade(xc, yc, wc);
        centro(xc, yc + hu + 0.45 * e, wc, hcorpo - hu - 0.45 * e);
        colunaFoto(t.after, fotoDepois, '', xc + wc + gap, yc, wl, hcorpo);
      } else {
        marca(x0, y0);
        var y2 = y0 + 6.2 * e + 1.1 * e, wR = iw * 0.46;
        var hR = resultados(x0, y2, wR);
        var hE = equipe(x0 + wR + 2 * e, y2, iw - wR - 2 * e);
        var y3 = y2 + Math.max(hR, hE) + 1.1 * e;
        var hU = unidade(x0, y3, iw);
        var y4 = y3 + hU + 1.1 * e, resto = y1 - y4 - 1.1 * e;
        var hBA = resto / 2.3, wBA = (iw - 1.4 * e) / 2;
        colunaFoto(t.before, fotoAntes, k.DS_ESTADO_ANTES, x0, y4, wBA, hBA);
        colunaFoto(t.after, fotoDepois, '', x0 + wBA + 1.4 * e, y4, wBA, hBA);
        centro(x0, y4 + hBA + 1.1 * e, iw, resto - hBA);
      }

      return pptx.writeFile({ fileName: nomeArquivo([k.ROTULO, k.NM_SITE, k.NM_LIDER, cfg.papel]) + '.pptx' });
    });
  }

  function imprimir(k, cfg, ctx) {
    var folha = montarFolha(k, cfg, ctx);
    var win = window.open('', '_blank');
    if (!win) return false;
    win.document.open();
    win.document.write(folha.html.replace('<body>', '<body><div id="pkAviso" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#fff;font:14px Poppins,Arial;color:#7C7F84;z-index:9">' + esc(T[ctx.idioma === 'en' ? 'en' : 'pt'].preparing) + '</div>'));
    win.document.close();
    var ir = function () {
      quandoPronto(win.document).then(function () {
        ajustarTextos(win.document);
        var a = win.document.getElementById('pkAviso');
        if (a) a.remove();
        win.focus();
        win.print();
      });
    };
    if (win.document.readyState === 'complete') ir(); else win.addEventListener('load', ir, { once: true });
    return true;
  }

  /* ── Diálogo do app ─────────────────────────────────────────────── */
  var DLG_CSS = [
    '#modalImpressaoKaizen .modal{max-width:980px}',
    '.imp-grade{display:grid;grid-template-columns:250px 1fr;gap:1.5rem;align-items:stretch}',
    '.imp-op h4{font-size:.68rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--vbm-mid);margin:0 0 .5rem}',
    '.imp-op + .imp-op{margin-top:1.25rem}',
    '.imp-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem}',
    '.imp-seg button,.imp-ori button{font-family:"Poppins",sans-serif;border:1.5px solid #e0e0e0;background:#fff;border-radius:.55rem;cursor:pointer;color:var(--vbm-dark);transition:border-color .15s,background-color .15s}',
    '.imp-seg button{padding:.55rem 0;font-size:.85rem;font-weight:600}',
    '.imp-seg button small{display:block;font-size:.6rem;font-weight:400;color:var(--vbm-mid);margin-top:.1rem}',
    '.imp-ori{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}',
    '.imp-ori button{padding:.7rem .4rem .55rem;font-size:.74rem;display:flex;flex-direction:column;align-items:center;gap:.45rem}',
    '.imp-ori i{display:block;border:2px solid currentColor;border-radius:3px;opacity:.55}',
    '.imp-ori .h i{width:34px;height:24px}.imp-ori .v i{width:24px;height:34px}',
    '.imp-seg button[aria-pressed="true"],.imp-ori button[aria-pressed="true"]{border-color:var(--vbm-blue);background:var(--vbm-blue-pale);color:var(--vbm-blue-dark,#0074a8)}',
    '.imp-ori button[aria-pressed="true"] i{opacity:1}',
    '.imp-seg button:focus-visible,.imp-ori button:focus-visible{outline:2px solid var(--vbm-blue);outline-offset:2px}',
    '.imp-info{margin-top:1.1rem;font-size:.72rem;color:var(--vbm-mid);line-height:1.5}',
    '.imp-info b{color:var(--vbm-dark);font-weight:600}',
    '.imp-prev{background:#eef1f4;border-radius:.75rem;display:flex;align-items:center;justify-content:center;min-height:420px;position:relative;overflow:hidden}',
    '.imp-prev-cx{position:relative;box-shadow:0 8px 24px rgba(16,24,40,.18);background:#fff;overflow:hidden}',
    '.imp-prev iframe{border:0;transform-origin:0 0;position:absolute;left:0;top:0;pointer-events:none}',
    '.imp-prev-rot{position:absolute;left:.75rem;top:.6rem;font-size:.62rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--vbm-mid)}',
    '#modalImpressaoKaizen .modal-foot{display:flex;gap:.6rem;justify-content:flex-end}',
    '@media (max-width:760px){.imp-grade{grid-template-columns:1fr}.imp-prev{min-height:260px}}',
    '[data-bg="dark"] .imp-seg button,[data-bg="dark"] .imp-ori button{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.14);color:#fff}',
    '[data-bg="dark"] .imp-seg button[aria-pressed="true"],[data-bg="dark"] .imp-ori button[aria-pressed="true"]{border-color:var(--vbm-blue-light);background:rgba(60,181,229,.14);color:var(--vbm-blue-light)}',
    '[data-bg="dark"] .imp-prev{background:rgba(255,255,255,.05)}',
    '[data-bg="dark"] .imp-info b{color:#fff}'
  ].join('\n');

  // Ícone do botão PDF em SVG: o subconjunto do Font Awesome do app não
  // tem "file-pdf", e regerar a fonte só por um ícone não compensa.
  var ICONE_PDF = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="vertical-align:-2px">' +
    '<path d="M8 1.5v8.2M4.6 6.6 8 10l3.4-3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M2.5 11v2.2c0 .7.6 1.3 1.3 1.3h8.4c.7 0 1.3-.6 1.3-1.3V11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  var dlg = null;
  function garantirDialogo() {
    if (dlg) return dlg;
    var st = document.createElement('style');
    st.textContent = DLG_CSS;
    document.head.appendChild(st);
    var el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.id = 'modalImpressaoKaizen';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'impTitulo');
    el.innerHTML =
      '<div class="modal modal-xl">' +
        '<div class="modal-head"><div class="modal-icon" style="background:var(--vbm-blue-pale);--hue:60,181,229;"><i class="fa-solid fa-print" style="color:var(--vbm-blue);"></i></div>' +
          '<div class="modal-title" id="impTitulo"></div>' +
          '<button class="modal-close" type="button" data-imp="fechar"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="modal-body"><div class="imp-grade">' +
          '<div>' +
            '<div class="imp-op"><h4 data-t="paper"></h4><div class="imp-seg" role="group">' +
              Object.keys(PAPEIS).map(function (p) {
                return '<button type="button" data-papel="' + p + '">' + p + '<small>' + PAPEIS[p][0] + '×' + PAPEIS[p][1] + ' mm</small></button>';
              }).join('') + '</div></div>' +
            '<div class="imp-op"><h4 data-t="orientation"></h4><div class="imp-ori" role="group">' +
              '<button type="button" class="h" data-ori="paisagem"><i></i><span data-t="landscape"></span></button>' +
              '<button type="button" class="v" data-ori="retrato"><i></i><span data-t="portrait"></span></button>' +
            '</div></div>' +
            '<div class="imp-info"><div><span data-t="size"></span>: <b id="impTamanho"></b></div><p style="margin-top:.5rem;" data-t="hint"></p></div>' +
          '</div>' +
          '<div class="imp-prev"><span class="imp-prev-rot" data-t="preview"></span><div class="imp-prev-cx" id="impPrevCx"><iframe id="impPrev" title="preview" tabindex="-1"></iframe></div></div>' +
        '</div></div>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-ghost" type="button" data-imp="fechar" data-t="cancel"></button>' +
          '<button class="btn btn-outline" type="button" data-imp="ppt">' + ICONE_PDF + ' <span data-t="ppt"></span></button>' +
          '<button class="btn btn-outline" type="button" data-imp="pdf">' + ICONE_PDF + ' <span data-t="pdf"></span></button>' +
          '<button class="btn btn-primary" type="button" data-imp="imprimir"><i class="fa-solid fa-print"></i> <span data-t="print"></span></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    dlg = { el: el, estado: null };

    el.addEventListener('click', function (e) {
      if (e.target === el) return fechar();
      var b = e.target.closest('button');
      if (!b || !dlg.estado) return;
      var s = dlg.estado;
      if (b.dataset.papel) { s.cfg.papel = b.dataset.papel; gravarPref(s.cfg); atualizar(); }
      else if (b.dataset.ori) { s.cfg.orientacao = b.dataset.ori; gravarPref(s.cfg); atualizar(); }
      else if (b.dataset.imp === 'fechar') fechar();
      else if (b.dataset.imp === 'imprimir') {
        if (!imprimir(s.k, s.cfg, s.ctx) && window.showToast) showToast('warning', s.t.popupTitle, s.t.popupMsg);
        else fechar();
      } else if (b.dataset.imp === 'ppt') {
        var rotP = b.querySelector('span');
        b.disabled = true; rotP.textContent = s.t.generatingPpt;
        gerarPpt(s.k, s.cfg, s.ctx).then(function () {
          if (window.showToast) showToast('success', s.t.donePpt, '', 2500);
        }).catch(function (err) {
          console.error('[impressão] PPT:', err);
          if (window.showToast) showToast('error', s.t.errPptTitle, s.t.errPptMsg, 5000);
        }).then(function () { b.disabled = false; rotP.textContent = s.t.ppt; });
      } else if (b.dataset.imp === 'pdf') {
        var rot = b.querySelector('span');
        b.disabled = true; rot.textContent = s.t.generating;
        gerarPdf(s.k, s.cfg, s.ctx).then(function () {
          if (window.showToast) showToast('success', s.t.done, '', 2500);
        }).catch(function (err) {
          console.error('[impressão] PDF:', err);
          if (window.showToast) showToast('error', s.t.errTitle, s.t.errMsg, 5000);
        }).then(function () { b.disabled = false; rot.textContent = s.t.pdf; });
      }
    });
    // Esc fecha SÓ este diálogo — sem a captura, o Esc genérico de
    // initModals() fecharia também o modal do Kaizen que está por baixo.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.classList.contains('open')) { e.stopImmediatePropagation(); fechar(); }
    }, true);
    window.addEventListener('resize', function () { if (el.classList.contains('open')) escalarPrevia(); });
    return dlg;
  }

  function fechar() {
    if (!dlg) return;
    dlg.el.classList.remove('open');
    document.body.style.overflow = dlg.overflowAntes || '';
  }

  function escalarPrevia() {
    var s = dlg.estado;
    var d = dimensoes(s.cfg);
    var ifr = dlg.el.querySelector('#impPrev');
    var cx = dlg.el.querySelector('#impPrevCx');
    var area = dlg.el.querySelector('.imp-prev');
    var pxW = d.w * 3.7795, pxH = d.h * 3.7795;
    var esc_ = Math.min((area.clientWidth - 40) / pxW, (area.clientHeight - 50) / pxH);
    if (!(esc_ > 0)) esc_ = 0.3;
    ifr.style.width = pxW + 'px';
    ifr.style.height = pxH + 'px';
    ifr.style.transform = 'scale(' + esc_ + ')';
    cx.style.width = (pxW * esc_) + 'px';
    cx.style.height = (pxH * esc_) + 'px';
  }

  function atualizar() {
    var s = dlg.estado;
    var el = dlg.el;
    Array.prototype.forEach.call(el.querySelectorAll('[data-papel]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.papel === s.cfg.papel)); });
    Array.prototype.forEach.call(el.querySelectorAll('[data-ori]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.ori === s.cfg.orientacao)); });
    var d = dimensoes(s.cfg);
    el.querySelector('#impTamanho').textContent = s.cfg.papel + ' · ' + d.w + ' × ' + d.h + ' mm';
    var folha = montarFolha(s.k, s.cfg, s.ctx);
    var ifr = el.querySelector('#impPrev');
    var doc = ifr.contentDocument;
    doc.open(); doc.write(folha.html.replace('html,body{background:#e9edf1}', 'html,body{background:#fff}')); doc.close();
    escalarPrevia();
    var meu = (dlg.versao = (dlg.versao || 0) + 1);
    quandoPronto(doc).then(function () { if (meu === dlg.versao) ajustarTextos(doc); });
  }

  /* Catálogo de resultados (checklist "Resultados Alcançados"), por
     idioma, guardado depois da 1ª leitura. */
  var catalogos = {};
  function catalogo(idioma) {
    if (catalogos[idioma]) return Promise.resolve(catalogos[idioma]);
    return fetch('/api/resultados?idioma=' + encodeURIComponent(idioma), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (l) { catalogos[idioma] = Array.isArray(l) ? l : []; return catalogos[idioma]; })
      .catch(function () { return []; });
  }

  window.printKaizen = function (k, opcoes) {
    var o = opcoes || {};
    var idioma = o.idioma === 'en' ? 'en' : 'pt-BR';
    var t = T[idioma === 'en' ? 'en' : 'pt'];
    var urlImg = typeof o.urlImagem === 'function' ? o.urlImagem : function (u) { return u; };
    catalogo(idioma).then(function (cat) {
      var d = garantirDialogo();
      d.estado = { k: k || {}, cfg: lerPref(), t: t, ctx: { idioma: idioma, catalogo: cat, urlImagem: urlImg } };
      Array.prototype.forEach.call(d.el.querySelectorAll('[data-t]'), function (n) { n.textContent = t[n.dataset.t]; });
      d.el.querySelector('#impTitulo').textContent = t.dialogTitle + (k && k.ROTULO ? ' — ' + k.ROTULO : '');
      d.el.querySelector('.modal-close').setAttribute('aria-label', t.cancel);
      d.overflowAntes = document.body.style.overflow;
      d.el.classList.add('open');
      document.body.style.overflow = 'hidden';
      atualizar();
      var foco = d.el.querySelector('[data-imp="imprimir"]');
      if (foco) foco.focus();
    });
  };

  // Exposto para testes e para outras telas que queiram a folha pronta.
  window.KaizenFolha = { montar: montarFolha, gerarPdf: gerarPdf, gerarPpt: gerarPpt, PAPEIS: PAPEIS };
})();
