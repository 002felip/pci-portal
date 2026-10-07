/**
 * VBM Kaizen — aba "Categorias" (admin.html).
 *
 * Lista TODAS as categorias reais de GET /api/categorias (server.js ->
 * kzn_categoria + contagem em kzn_pendenciaconsolidada). Nenhum item
 * estático: a lista inteira vem do banco a cada carregamento da tela,
 * inclusive o status ativo/inativo (SG_ATIVO).
 *
 * Arquivo AUTOSSUFICIENTE de propósito — não depende de
 * js/cadastro-bilingue.js. Esse motor compartilhado (usado por
 * Replicação/Desperdícios/Resultados) já causou a tela de Categorias
 * inteira parar de responder quando esse arquivo extra não chegava ao
 * ambiente publicado (ver "Falha ao carregar o motor de cadastros").
 * Categorias não pode depender de mais um arquivo estático para
 * funcionar, então a lógica (que é a mesma dos outros 3) está
 * duplicada aqui, só para esta aba.
 *
 * Cada card tem 2 ações:
 *   - Editar: modal bilíngue PT/EN (GET/PUT /api/categorias/:id).
 *   - Ativar/Desativar: grava SG_ATIVO no banco
 *     (PUT /api/categorias/:id/status) — nunca só visual.
 *
 * Falha ao carregar a lista: mostra o motivo real do erro (vindo do
 * servidor) com botão de tentar de novo — não há mais fallback
 * estático, a lista É o banco.
 */
(function () {
  var list = document.getElementById("categoriasList");
  if (!list) return; // esta página não tem a aba Categorias

  var ROTA = "categorias";
  var CLASSE_ICONE = "green";
  var PASTA_ICONES = "assets/icons/categorias/";
  var ICONE_PADRAO = PASTA_ICONES + "fa-solid-tag.svg";
  var PALAVRA_BADGE = "kaizens";
  var PALAVRA_BADGE_SINGULAR = "kaizen";
  var ROTULO_SINGULAR = "Categoria";
  var TEXTO_CARREGANDO = "Carregando categorias…";
  var TEXTO_VAZIO = "Nenhuma categoria cadastrada.";
  var TEXTO_ERRO = "Não foi possível carregar as categorias no momento. Tente novamente em instantes.";

  // Mesmos limites do server.js (do DER: NM VARCHAR(30) / DS
  // VARCHAR(100), igual nas 4 tabelas bilíngues) — checagem no
  // cliente é só uma resposta mais rápida; o servidor sempre valida
  // de novo antes de gravar.
  var NOME_MAX = 30;
  var DESCRICAO_MAX = 100;

  var el = function (id) { return document.getElementById(id); };
  var addNamePt = el("catAddNamePt");
  var addNameEn = el("catAddNameEn");
  var addDescPt = el("catAddDescPt");
  var addDescEn = el("catAddDescEn");
  var addSaveBtn = el("btnSaveAddCategoria");
  var addTrigger = document.querySelector('[data-modal-open="modalAddCategoria"]');

  var editNamePt = el("catEditNamePt");
  var editNameEn = el("catEditNameEn");
  var editDescPt = el("catEditDescPt");
  var editDescEn = el("catEditDescEn");
  var editSaveBtn = el("btnSaveEditCategoria");

  var idEmEdicao = null;

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // Idioma em uso pelos DADOS desta aba + recarga automática quando ele
  // muda (só com a página visível). Sem o helper, cai para português e
  // a aba segue funcionando como antes.
  var jaCarregouAlgumaVez = false;
  var idiomaEmUso = window.VBMIdioma
    ? window.VBMIdioma.aoMudar(function () {
        // Só reconsulta abas que o usuário já abriu. Uma aba que nunca
        // carregou não precisa de nada agora: quando for aberta, já vai
        // buscar direto no idioma novo (ver carregamento sob demanda no
        // fim do arquivo).
        if (jaCarregouAlgumaVez) carregarLista();
      })
    : function () { return "pt-BR"; };

  function validar(nomePt, descPt, nomeEn, descEn) {
    if (!nomePt || !descPt || !nomeEn || !descEn) {
      return "Preencha nome e descrição nos dois idiomas antes de salvar.";
    }
    if (nomePt.length > NOME_MAX || nomeEn.length > NOME_MAX) {
      return "O nome deve ter no máximo " + NOME_MAX + " caracteres (em cada idioma).";
    }
    if (descPt.length > DESCRICAO_MAX || descEn.length > DESCRICAO_MAX) {
      return "A descrição deve ter no máximo " + DESCRICAO_MAX + " caracteres (em cada idioma).";
    }
    return null;
  }

  // Caminho do arquivo a partir da classe do seletor: os botões da paleta
  // guardam "fa-solid fa-leaf" (data-icon, em admin.html) e o arquivo
  // correspondente é assets/icons/categorias/fa-solid-leaf.svg. Cada tab
  // tem a sua pasta com os ícones da própria paleta (ver
  // assets/icons/icones.json), então o caminho sai de PASTA_ICONES + nome,
  // sem tabela de exceções. Converter aqui evita mexer nos 20 botões do
  // HTML e mantém pickCategoryIcon() como está.
  // "fa-solid fa-leaf" -> "assets/icons/categorias/fa-solid-leaf.svg". O "fa-" do
  // segundo termo NÃO se repete no nome do arquivo (ver icones.json).
  function caminhoDoIcone(classe) {
    var partes = String(classe || "").trim().split(/\s+/).filter(Boolean);
    if (partes.length < 2) return null;
    return PASTA_ICONES + partes[0] + "-" + partes[partes.length - 1].replace(/^fa-/, "") + ".svg";
  }

  // Classe equivalente a um caminho — o inverso de caminhoDoIcone(), usado
  // para reacender o botão certo da paleta ao abrir a edição.
  function classeDoCaminho(caminho) {
    var arquivo = String(caminho || "").split("/").pop();
    if (!/^fa-[a-z]+-[a-z0-9-]+\.svg$/.test(arquivo)) return null;
    var partes = arquivo.replace(/\.svg$/, "").split("-");
    return partes[0] + "-" + partes[1] + " fa-" + partes.slice(2).join("-");
  }

  function iconeSelecionado(prefixo) {
    var input = el(prefixo + "IconInput");
    return input ? caminhoDoIcone(input.value) : null;
  }

  // Deixa a paleta mostrando o ícone que está gravado no banco: acende o
  // botão correspondente e alinha o campo escondido. Caminho fora da
  // paleta (registro antigo, ícone próprio) não acende nada — e é
  // justamente aí que iconeAlterado protege o valor original.
  function aplicarIconeNaPaleta(prefixo, caminho) {
    var classe = classeDoCaminho(caminho);
    var grade = el(prefixo + "IconGrid");
    if (!grade) return;
    var alvo = classe ? grade.querySelector('[data-icon="' + classe + '"]') : null;
    grade.querySelectorAll(".icon-swatch").forEach(function (s) {
      s.classList.toggle("active", s === alvo);
    });
    var input = el(prefixo + "IconInput");
    if (input && classe) input.value = classe;
  }

  // false = o usuário não tocou na paleta nesta edição, então o ícone não
  // vai no corpo e o servidor preserva o que já está gravado. Sem isso,
  // editar só o nome de um registro com ícone fora da paleta trocaria o
  // ícone dele sem ninguém pedir.
  var iconeAlterado = false;
  var gradeEdicao = el("catEditIconGrid");
  if (gradeEdicao) {
    gradeEdicao.addEventListener("click", function (e) {
      if (e.target.closest(".icon-swatch")) iconeAlterado = true;
    });
  }

  function montarPayload(nomePtEl, descPtEl, nomeEnEl, descEnEl, prefixoIcone) {
    var payload = {
      pt: { NM: nomePtEl ? nomePtEl.value.trim() : "", DS: descPtEl ? descPtEl.value.trim() : "" },
      en: { NM: nomeEnEl ? nomeEnEl.value.trim() : "", DS: descEnEl ? descEnEl.value.trim() : "" },
    };
    // Só vai no corpo quando há o que gravar: na criação, sempre (o
    // registro nasce com o ícone da paleta); na edição, apenas se o
    // usuário escolheu outro. Ausente, o servidor preserva o URL_ICONE
    // que já está gravado.
    var podeEnviar = prefixoIcone !== "catEdit" || iconeAlterado;
    var icone = podeEnviar ? iconeSelecionado(prefixoIcone) : null;
    if (icone) payload.urlIcone = icone;
    return payload;
  }

  function statusEl(texto, erro) {
    var div = document.createElement("div");
    div.className = "admin-list-status" + (erro ? " is-error" : "");
    div.textContent = texto;
    return div;
  }

  function badgeHtml(qtd) {
    var texto = qtd == null ? "—" : qtd + " " + (qtd === 1 ? PALAVRA_BADGE_SINGULAR : PALAVRA_BADGE);
    return '<span class="admin-item-badge">' + escapeHtml(texto) + "</span>";
  }

  // Sinaliza quando o nome/descrição exibidos são o texto em português
  // por FALTA de tradução (não porque o usuário pediu português) — sem
  // isso, o card em inglês mostra texto em português sem nenhuma pista
  // de que a tradução simplesmente não foi cadastrada ainda.
  function semTraducaoHtml(reg) {
    if (!reg.SEM_TRADUCAO) return "";
    return ' <i class="fa-solid fa-language" style="opacity:.55;font-size:.75em;" ' +
      'title="Tradução em inglês não cadastrada — mostrando o texto em português"></i>';
  }

  function renderItem(reg) {
    var item = document.createElement("div");
    item.className = "admin-item" + (reg.ATIVO ? "" : " admin-item-inactive");
    item.dataset.id = reg.ID;
    item.innerHTML =
      '<div class="admin-item-icon ' + CLASSE_ICONE + '">' +
        // Os dois lados são URL de assets/icons: o banco (URL_ICONE) quando
        // o registro tem ícone próprio, senão o ícone padrão da aba. Mesmo
        // <img> nos dois casos — só muda de onde vem o endereço.
        '<img src="' + escapeHtml(reg.URL_ICONE || ICONE_PADRAO) + '" alt="" loading="lazy">' +
      "</div>" +
      '<div class="admin-item-body">' +
        '<div class="admin-item-name">' + escapeHtml(reg.NM) + semTraducaoHtml(reg) + "</div>" +
        '<div class="admin-item-sub">' + escapeHtml(reg.DS) + "</div>" +
      "</div>" +
      badgeHtml(reg.QTD) +
      '<div class="admin-item-actions">' +
        '<button type="button" class="btn-icon btn-icon-blue btn-icon-sm" data-action="editar" title="Editar" data-i18n-title="common.editar"><i class="fa-solid fa-pen"></i></button>' +
        '<button type="button" class="btn-icon ' + (reg.ATIVO ? "btn-icon-red" : "btn-icon-blue") + ' btn-icon-sm" data-action="status" title="' + (reg.ATIVO ? "Desativar" : "Reativar") + '"><i class="fa-solid ' + (reg.ATIVO ? "fa-ban" : "fa-rotate-right") + '"></i></button>' +
      "</div>";

    item.querySelector('[data-action="editar"]').addEventListener("click", function () { abrirEdicao(reg); });
    item.querySelector('[data-action="status"]').addEventListener("click", function () { alternarStatus(reg, item); });
    return item;
  }

  // Recarrega sempre do banco — nunca reaproveita estado anterior,
  // então o ativo/inativo exibido é o SG_ATIVO atual.
  //
  // IDIOMA: nome e descrição vêm do banco (1 linha por ID_IDIOMA), por
  // isso a consulta informa em qual idioma quer os dados. Quando o
  // idioma da tela muda e a página está visível, o assinante logo
  // abaixo reconsulta o banco. Ver window.VBMIdioma em js/vbm-app.js.
  function carregarLista() {
    jaCarregouAlgumaVez = true;
    list.innerHTML = "";
    list.appendChild(statusEl(TEXTO_CARREGANDO, false));

    fetch("/api/" + ROTA + "?idioma=" + encodeURIComponent(idiomaEmUso()))
      .then(function (res) {
        if (!res.ok) return res.json().then(function (e) { throw new Error(e.error || res.statusText); });
        return res.json();
      })
      .then(function (registros) {
        list.innerHTML = "";
        if (!registros.length) {
          list.appendChild(statusEl(TEXTO_VAZIO, false));
          return;
        }
        registros.forEach(function (reg) { list.appendChild(renderItem(reg)); });
      })
      .catch(function (err) {
        console.error("[categorias] falha ao carregar lista:", err);
        list.innerHTML = "";
        var box = statusEl("", true);
        box.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span></span>';
        // Mostra o motivo real (erro do banco/rede), não só o texto
        // genérico — sem isso, uma falha de conexão/permissão no Azure
        // SQL aparecia igual a qualquer outra, sem nenhuma pista.
        box.querySelector("span").textContent =
          TEXTO_ERRO + (err && err.message ? " Detalhe: " + err.message : "");
        var retry = document.createElement("button");
        retry.className = "btn btn-outline btn-sm";
        retry.type = "button";
        retry.textContent = "Tentar novamente";
        retry.addEventListener("click", carregarLista);
        box.appendChild(retry);
        list.appendChild(box);
      });
  }

  // ── Editar ──
  function abrirEdicao(reg) {
    idEmEdicao = reg.ID;
    iconeAlterado = false;
    // Já acende com o que a listagem trouxe do banco; o GET abaixo
    // confirma. Sem isso a paleta abriria no valor fixo do HTML.
    aplicarIconeNaPaleta("catEdit", reg.URL_ICONE || ICONE_PADRAO);
    if (window.openModal) openModal("modalEditCategoria");

    fetch("/api/" + ROTA + "/" + encodeURIComponent(reg.ID))
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || res.statusText);
          return data;
        });
      })
      .then(function (data) {
        // Sempre atribui, mesmo vazio — nunca deixa no campo o texto
        // de uma edição anterior quando o idioma ainda não existe.
        if (editNamePt) editNamePt.value = (data.pt && data.pt.NM) || "";
        if (editNameEn) editNameEn.value = (data.en && data.en.NM) || "";
        if (editDescPt) {
          editDescPt.value = (data.pt && data.pt.DS) || "";
          if (window.updateCategoryDescCounter) updateCategoryDescCounter(editDescPt, "catEdit", DESCRICAO_MAX);
        }
        if (editDescEn) editDescEn.value = (data.en && data.en.DS) || "";
        // O ícone é do registro (mesmo nos 2 idiomas) e vem do banco —
        // mas esta resposta é assíncrona e não pode passar por cima de
        // uma escolha que o usuário já fez enquanto ela vinha (rede
        // lenta), nem pintar a paleta de um registro que já não é o
        // aberto. Nos dois casos gravaria um ícone que ninguém escolheu.
        if (!iconeAlterado && idEmEdicao === reg.ID) {
          aplicarIconeNaPaleta("catEdit", data.urlIcone || ICONE_PADRAO);
        }
      })
      .catch(function (err) {
        console.error("[categorias] falha ao carregar para edição:", err);
        if (window.showToast) showToast("error", "Erro ao carregar", "Não foi possível buscar os dados no banco. " + err.message);
      });
  }

  function salvarEdicao() {
    if (idEmEdicao == null) {
      if (window.showToast) showToast("error", "Erro", "Registro não identificado — feche e abra o formulário de novo.");
      return;
    }
    var payload = montarPayload(editNamePt, editDescPt, editNameEn, editDescEn, "catEdit");
    var erro = validar(payload.pt.NM, payload.pt.DS, payload.en.NM, payload.en.DS);
    if (erro) {
      if (window.showToast) showToast("warning", "Campo inválido", erro);
      return;
    }

    if (editSaveBtn) editSaveBtn.disabled = true;
    fetch("/api/" + ROTA + "/" + encodeURIComponent(idEmEdicao), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || res.statusText);
          return data;
        });
      })
      .then(function () {
        if (window.closeModal) closeModal("modalEditCategoria");
        if (window.showToast) showToast("success", "Salvo", ROTULO_SINGULAR + " atualizada com sucesso!");
        carregarLista();
        avisarMudanca();
      })
      .catch(function (err) {
        console.error("[categorias] falha ao salvar:", err);
        if (window.showToast) showToast("error", "Erro ao salvar", err.message);
      })
      .finally(function () {
        if (editSaveBtn) editSaveBtn.disabled = false;
      });
  }

  // Avisa as outras abas que esta tabela mudou — mesmo contrato do
  // motor compartilhado (ver window.VBMDados em js/vbm-app.js).
  function avisarMudanca() {
    if (window.VBMDados) window.VBMDados.mudou(ROTA);
  }

  // ── Criar ──
  function limparFormularioCriacao() {
    if (addNamePt) addNamePt.value = "";
    if (addNameEn) addNameEn.value = "";
    if (addDescPt) {
      addDescPt.value = "";
      if (window.updateCategoryDescCounter) updateCategoryDescCounter(addDescPt, "catAdd", DESCRICAO_MAX);
    }
    if (addDescEn) addDescEn.value = "";
  }

  function salvarCriacao() {
    var payload = montarPayload(addNamePt, addDescPt, addNameEn, addDescEn, "catAdd");
    var erro = validar(payload.pt.NM, payload.pt.DS, payload.en.NM, payload.en.DS);
    if (erro) {
      if (window.showToast) showToast("warning", "Campo inválido", erro);
      return;
    }

    if (addSaveBtn) addSaveBtn.disabled = true;
    fetch("/api/" + ROTA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || res.statusText);
          return data;
        });
      })
      .then(function () {
        limparFormularioCriacao();
        if (window.closeModal) closeModal("modalAddCategoria");
        if (window.showToast) showToast("success", "Categoria criada", "Nova categoria adicionada com sucesso!");
        carregarLista();
        avisarMudanca();
      })
      .catch(function (err) {
        console.error("[categorias] falha ao criar:", err);
        if (window.showToast) showToast("error", "Erro ao criar", err.message);
      })
      .finally(function () {
        if (addSaveBtn) addSaveBtn.disabled = false;
      });
  }

  // ── Ativar/Desativar — grava SG_ATIVO no banco, nunca só visual ──
  async function alternarStatus(reg, item) {
    var ativar = !reg.ATIVO;
    var confirmado = await confirmarAcao({
      variant: ativar ? "ativar" : "desativar",
      titulo: (ativar ? 'Reativar "' : 'Desativar "') + reg.NM + '"?',
      mensagem: ativar ? "" : "Ela deixará de aparecer como opção ativa, mas não será excluída.",
    });
    if (!confirmado) return;

    fetch("/api/" + ROTA + "/" + encodeURIComponent(reg.ID) + "/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo: ativar }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || res.statusText);
          return data;
        });
      })
      .then(function () {
        reg.ATIVO = ativar;
        item.replaceWith(renderItem(reg));
        avisarMudanca();
        if (window.showToast) {
          showToast(
            "success",
            ativar ? "Reativada" : "Desativada",
            'Categoria "' + reg.NM + '" ' + (ativar ? "reativada" : "desativada") + " com sucesso."
          );
        }
      })
      .catch(function (err) {
        console.error("[categorias] falha ao atualizar status:", err);
        if (window.showToast) showToast("error", "Erro", "Não foi possível atualizar o status. " + err.message);
      });
  }

  if (editSaveBtn) editSaveBtn.addEventListener("click", salvarEdicao);
  if (addSaveBtn) addSaveBtn.addEventListener("click", salvarCriacao);
  // Limpa o formulário sempre que o modal é aberto — nunca deixa
  // sobrar texto de uma tentativa anterior (evita reenviar sem querer).
  if (addTrigger) addTrigger.addEventListener("click", limparFormularioCriacao);

  // Carrega sob demanda: as 6 abas do admin ficam todas no mesmo HTML,
  // mas só uma está visível. Antes, cada aba disparava sua consulta no
  // load da página — 6 idas ao Azure SQL para mostrar 1 lista. Agora a
  // aba visível carrega na hora e as demais só na primeira vez que são
  // abertas (uma vez só; depois disso o comportamento é o de sempre).
  var painel = list.closest(".admin-panel");
  if (!painel || painel.classList.contains("active") || typeof MutationObserver === "undefined") {
    carregarLista();
  } else {
    var observador = new MutationObserver(function () {
      if (painel.classList.contains("active")) {
        observador.disconnect();
        carregarLista();
      }
    });
    observador.observe(painel, { attributes: true, attributeFilter: ["class"] });
  }
})();
