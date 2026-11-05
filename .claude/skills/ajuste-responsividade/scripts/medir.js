#!/usr/bin/env node
/**
 * Tira prints de uma tela do Portal nos tamanhos de referência e acusa rolagem lateral.
 *
 *   node medir.js <url> [pasta-dos-prints]
 *
 * Variáveis opcionais:
 *   TEMA=light|dark            tema gravado em localStorage['vdt-theme'] (padrão: light)
 *   TAMANHOS="1440x900,..."    lista de tamanhos (padrão: os de referência da skill)
 *   ESPERA=3500                ms de espera depois de carregar (dados + animações)
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PADRAO = '390x844,1100x800,1280x590,1440x900,1920x1080,2560x1440,3840x2160';

(async () => {
  const [, , url, pasta = 'prints-responsividade'] = process.argv;
  if (!url) { console.error('uso: node medir.js <url> [pasta-dos-prints]'); process.exit(1); }
  const tema = process.env.TEMA || 'light';
  const espera = Number(process.env.ESPERA || 3500);
  const tamanhos = (process.env.TAMANHOS || PADRAO).split(',').map(function (t) { return t.trim().split('x').map(Number); });
  fs.mkdirSync(pasta, { recursive: true });

  const navegador = await chromium.launch();
  let comProblema = 0;
  for (const [w, h] of tamanhos) {
    // Janela alta o bastante para não redimensionar no print (o resize redesenha os gráficos)
    const pagina = await navegador.newPage({ viewport: { width: w, height: h } });
    const erros = [];
    pagina.on('pageerror', function (e) { erros.push(e.message); });
    await pagina.addInitScript(function (t) { try { localStorage.setItem('vdt-theme', t); } catch (e) {} }, tema);
    await pagina.goto(url);
    await pagina.waitForTimeout(espera);

    const r = await pagina.evaluate(function () {
      const doc = document.documentElement;
      // Só procura culpados quando a página de fato rola para o lado. Ignora o que não gera
      // rolagem: elementos fixos (painéis fora da tela, como o de Configurações) e o que é
      // recortado por um ancestral com overflow (brilhos decorativos, faixas de gráfico).
      const recortado = function (el) {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== 'visible') return true;
        }
        return false;
      };
      const vazam = [];
      if (doc.scrollWidth > doc.clientWidth + 1) {
        document.querySelectorAll('body *').forEach(function (el) {
          if (!el.offsetParent || getComputedStyle(el).position === 'fixed' || recortado(el)) return;
          const b = el.getBoundingClientRect();
          if (b.width && b.right > doc.clientWidth + 1) vazam.push(el);
        });
      }
      // só os mais externos (o filho de quem vaza também vaza)
      const raiz = vazam.filter(function (el) { return !vazam.some(function (o) { return o !== el && o.contains(el); }); });
      const rolagens = [];
      document.querySelectorAll('body *').forEach(function (el) {
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.offsetParent) rolagens.push(el);
      });
      const nome = function (el) { return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''); };
      return {
        docLargura: doc.scrollWidth, janela: doc.clientWidth, docAltura: doc.scrollHeight,
        vazam: raiz.slice(0, 6).map(function (el) { return nome(el) + ' → ' + Math.round(el.getBoundingClientRect().right) + 'px'; }),
        rolagemInterna: rolagens.slice(0, 6).map(function (el) { return nome(el) + ' (' + el.scrollWidth + ' > ' + el.clientWidth + ')'; })
      };
    });

    const arquivo = path.join(pasta, w + 'x' + h + (tema === 'dark' ? '-escuro' : '') + '.png');
    await pagina.screenshot({ path: arquivo });
    const ok = r.docLargura <= r.janela && !r.vazam.length && !r.rolagemInterna.length && !erros.length;
    if (!ok) comProblema++;
    console.log((ok ? 'OK  ' : 'VER ') + w + 'x' + h + '  documento ' + r.docLargura + '×' + r.docAltura + '  → ' + arquivo);
    r.vazam.forEach(function (v) { console.log('      passa da borda: ' + v); });
    r.rolagemInterna.forEach(function (v) { console.log('      rolagem lateral: ' + v); });
    erros.forEach(function (e) { console.log('      erro de JS: ' + e); });
    await pagina.close();
  }
  await navegador.close();
  process.exit(comProblema ? 2 : 0);
})();
