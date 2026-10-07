/**
 * VBM Kaizen — filtro de múltipla seleção (checkboxes + "Selecionar
 * Todos" / "Limpar Seleção" + chips no gatilho).
 *
 * Mesmo componente de criarFiltroMultiplo() em biblioteca.html, aqui
 * isolado para a aba Usuários de admin.html usar o MESMO comportamento
 * e visual (CSS .ms-filter-* no <style> da página).
 *
 *   var f = VBMFiltroMultiplo.criar(container, { placeholder, onChange });
 *   f.setItens(lista, valorDe, textoDe); f.getSelecionados();
 *   f.setSelecionados([...]); f.limpar(); f.setPlaceholder(txt);
 *   f.setDesabilitado(bool);
 *
 * onChange só dispara em ação do usuário; os métodos acima não disparam.
 */
(function () {
  var abertos = []; // fechar() de cada filtro: abrir um fecha os demais

  function txt(chave, padrao) {
    return (window.__i18n && window.__i18n[chave]) || padrao;
  }

  function escaparHtml(t) {
    var d = document.createElement("div");
    d.textContent = t == null ? "" : String(t);
    return d.innerHTML;
  }

  function criar(container, opts) {
    var vazioApi = {
      setItens: function () {}, getSelecionados: function () { return []; },
      setSelecionados: function () {}, limpar: function () {},
      setPlaceholder: function () {}, setDesabilitado: function () {},
    };
    if (!container) return vazioApi;
    opts = opts || {};
    var placeholder = opts.placeholder || "";
    var mudou = opts.onChange || function () {};
    var itens = [];
    var selecionados = [];
    var aberto = false;

    container.classList.add("ms-filter");
    container.innerHTML =
      '<button type="button" class="ms-filter-trigger" aria-haspopup="true" aria-expanded="false">' +
        '<span class="ms-filter-label"></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>' +
      '<div class="ms-filter-panel">' +
        '<div class="ms-filter-toolbar">' +
          '<button type="button" class="ms-filter-toolbtn" data-acao="todos" data-i18n="msFilter.selectAll">' + escaparHtml(txt("msFilter.selectAll", "Selecionar Todos")) + "</button>" +
          '<button type="button" class="ms-filter-toolbtn" data-acao="limpar" data-i18n="msFilter.clearSelection">' + escaparHtml(txt("msFilter.clearSelection", "Limpar Seleção")) + "</button>" +
        "</div>" +
        '<div class="ms-filter-list"></div>' +
        '<div class="ms-filter-empty" hidden data-i18n="msFilter.noResults">' + escaparHtml(txt("msFilter.noResults", "Nenhum item encontrado")) + "</div>" +
      "</div>";

    var trigger = container.querySelector(".ms-filter-trigger");
    var label = container.querySelector(".ms-filter-label");
    var panel = container.querySelector(".ms-filter-panel");
    var lista = container.querySelector(".ms-filter-list");
    var vazio = container.querySelector(".ms-filter-empty");
    var cardPai = container.closest(".section-card");
    if (opts.ariaLabel) trigger.setAttribute("aria-label", opts.ariaLabel);

    function renderLabel() {
      if (!selecionados.length) {
        label.textContent = placeholder;
        trigger.classList.remove("ms-filter-ativo");
        return;
      }
      trigger.classList.add("ms-filter-ativo");
      var nomes = itens.filter(function (i) { return selecionados.indexOf(i.valor) !== -1; })
        .map(function (i) { return i.texto; });
      var html = nomes.slice(0, 2).map(function (n) { return '<span class="ms-filter-chip">' + escaparHtml(n) + "</span>"; }).join("");
      if (nomes.length > 2) html += '<span class="ms-filter-chip ms-filter-chip-mais">+' + (nomes.length - 2) + "</span>";
      label.innerHTML = html;
    }

    function renderLista() {
      vazio.hidden = itens.length > 0;
      lista.innerHTML = itens.map(function (i) {
        var marcado = selecionados.indexOf(i.valor) !== -1;
        return '<label class="ms-filter-item' + (marcado ? " ms-filter-item-marcado" : "") + '">' +
          '<input type="checkbox" value="' + escaparHtml(i.valor) + '"' + (marcado ? " checked" : "") + ">" +
          '<span class="ms-filter-item-check"><i class="fa-solid fa-check"></i></span>' +
          '<span class="ms-filter-item-texto">' + escaparHtml(i.texto) + "</span></label>";
      }).join("");
    }

    // Não nasce cortado à direita em telas estreitas.
    function posicionar() {
      panel.classList.remove("ms-filter-panel-esquerda");
      var r = container.getBoundingClientRect();
      if (r.left + panel.offsetWidth > window.innerWidth - 8) panel.classList.add("ms-filter-panel-esquerda");
    }

    function abrir() {
      if (aberto) return;
      abertos.forEach(function (f) { if (f !== fechar) f(); });
      aberto = true;
      trigger.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
      panel.classList.add("open");
      if (cardPai) cardPai.classList.add("ms-filter-open");
      renderLista();
      posicionar();
    }

    function fechar() {
      if (!aberto) return;
      aberto = false;
      trigger.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      panel.classList.remove("open");
      if (cardPai) cardPai.classList.remove("ms-filter-open");
    }

    trigger.addEventListener("click", function (e) { e.stopPropagation(); aberto ? fechar() : abrir(); });
    panel.addEventListener("click", function (e) { e.stopPropagation(); });

    lista.addEventListener("change", function (e) {
      var chk = e.target.closest('input[type="checkbox"]');
      if (!chk) return;
      var v = chk.value;
      var idx = selecionados.indexOf(v);
      if (chk.checked && idx === -1) selecionados.push(v);
      else if (!chk.checked && idx !== -1) selecionados.splice(idx, 1);
      chk.closest(".ms-filter-item").classList.toggle("ms-filter-item-marcado", chk.checked);
      renderLabel();
      mudou();
    });

    container.querySelector('[data-acao="todos"]').addEventListener("click", function () {
      itens.forEach(function (i) { if (selecionados.indexOf(i.valor) === -1) selecionados.push(i.valor); });
      renderLista(); renderLabel(); mudou();
    });
    container.querySelector('[data-acao="limpar"]').addEventListener("click", function () {
      selecionados = [];
      renderLista(); renderLabel(); mudou();
    });

    document.addEventListener("click", function (e) { if (aberto && !container.contains(e.target)) fechar(); });
    document.addEventListener("keydown", function (e) {
      if (aberto && e.key === "Escape") { fechar(); trigger.focus(); }
    });
    window.addEventListener("resize", function () { if (aberto) posicionar(); });
    abertos.push(fechar);

    renderLabel();

    return {
      setItens: function (novosItens, valorDe, textoDe) {
        var validos = {};
        itens = (novosItens || []).map(function (i) {
          var v = String(valorDe(i));
          validos[v] = true;
          return { valor: v, texto: textoDe(i) };
        });
        selecionados = selecionados.filter(function (v) { return validos[v]; });
        renderLista();
        renderLabel();
      },
      getSelecionados: function () { return selecionados.slice(); },
      setSelecionados: function (valores) {
        selecionados = (valores || []).map(String);
        renderLista();
        renderLabel();
      },
      limpar: function () { selecionados = []; renderLista(); renderLabel(); },
      setPlaceholder: function (novoTexto) { placeholder = novoTexto; renderLabel(); },
      setDesabilitado: function (sim) { trigger.disabled = !!sim; if (sim) fechar(); },
    };
  }

  window.VBMFiltroMultiplo = { criar: criar };
})();
