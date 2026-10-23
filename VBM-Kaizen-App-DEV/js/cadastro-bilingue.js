/**
 * VBM Kaizen — motor compartilhado dos cadastros bilíngues do admin.html.
 *
 * As 6 abas de cadastro (Categorias, Pot. Replicação, Red. Desperdícios,
 * Resultados, Tipo Resultados, Mot. Reprovação) têm o MESMO desenho no
 * banco (ver DER: PK + ID_IDIOMA + NM/DS/URL_ICONE/SG_ATIVO/ID_USUARIO,
 * 1 linha por idioma) e a mesma tela (lista de .admin-item + modais
 * Add/Edit bilíngues). Este arquivo define o motor único
 * (window.criarCadastroBilingue) usado por js/replicacao.js,
 * js/desperdicios.js, js/resultados.js, js/tiporesultados.js e
 * js/status.js — cada um só passando a configuração da sua
 * própria aba (rota, ids dos elementos, textos, limites de campo).
 * js/categorias.js é a exceção: fica de fora deste motor de propósito
 * (ver header desse arquivo). Precisa ser carregado ANTES dos 5 acima.
 *
 * Rotas REST que cada aba usa (registradas em server.js por
 * registrarCadastroBilingue(), o espelho desta fábrica no servidor):
 *
 *   GET    /api/<rota>            lista (com SG_ATIVO real)
 *   GET    /api/<rota>/:id        as 2 linhas (PT/EN) para editar
 *   POST   /api/<rota>            criar
 *   PUT    /api/<rota>/:id        editar (PT + EN)
 *   PUT    /api/<rota>/:id/status ativar/desativar (SG_ATIVO)
 *
 * Nada é estático: a lista inteira vem do banco a cada carregamento,
 * inclusive o estado ativo/inativo. Falha ao carregar mostra erro com
 * "tentar novamente" (não há fallback local — a lista É o banco).
 *
 * cfg.comboExtra (opcional): 1 FK escolhida pelo NOME num <select> do
 * modal (ex.: "Tipo de Resultado" em Resultados), gravada como ID —
 * ver comentário na declaração de comboExtra logo abaixo.
 */
window.criarCadastroBilingue = function (cfg) {
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  var list = document.getElementById(cfg.listaId);
  if (!list) return; // esta página não tem esta aba

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
        if (jaCarregouAlgumaVez) {
          carregarLista();
          carregarOpcoesCombo(); // nomes do combo também mudam de idioma
        }
      })
    : function () { return "pt-BR"; };

  var el = function (id) { return document.getElementById(id); };
  var addNamePt = el(cfg.prefixoAdd + "NamePt");
  var addNameEn = el(cfg.prefixoAdd + "NameEn");
  var addDescPt = el(cfg.prefixoAdd + "DescPt");
  var addDescEn = el(cfg.prefixoAdd + "DescEn");
  var addSaveBtn = el(cfg.btnSalvarAddId);
  var addTrigger = document.querySelector('[data-modal-open="' + cfg.modalAddId + '"]');

  var editNamePt = el(cfg.prefixoEdit + "NamePt");
  var editNameEn = el(cfg.prefixoEdit + "NameEn");
  var editDescPt = el(cfg.prefixoEdit + "DescPt");
  var editDescEn = el(cfg.prefixoEdit + "DescEn");
  var editSaveBtn = el(cfg.btnSalvarEditId);

  var idEmEdicao = null;

  // Algumas tabelas (ex.: kzn_tipo_resultado) não têm coluna de
  // descrição — inferimos isso pela ausência dos campos DS no modal,
  // sem precisar de uma flag extra na config das 4 abas existentes.
  var temDescricao = !!(addDescPt || editDescPt);

  // Combo opcional de 1 FK escolhida pelo nome (ex.: "Tipo de
  // Resultado" em Resultados) — grava o ID. cfg.comboExtra = { campo,
  // rota, addSelectId, editSelectId }; sem essa chave, tudo abaixo vira
  // no-op e a aba funciona exatamente como antes.
  var comboExtra = cfg.comboExtra || null;
  var addComboEl = comboExtra ? el(comboExtra.addSelectId) : null;
  var editComboEl = comboExtra ? el(comboExtra.editSelectId) : null;

  // Mesmos limites do server.js (que os tira do DER). A checagem no
  // cliente é só uma resposta mais rápida — o servidor valida de
  // novo antes de gravar, sempre.
  function validar(nomePt, descPt, nomeEn, descEn, comboValor) {
    if (!nomePt || !nomeEn || (temDescricao && (!descPt || !descEn))) {
      return temDescricao
        ? "Preencha nome e descrição nos dois idiomas antes de salvar."
        : "Preencha o nome nos dois idiomas antes de salvar.";
    }
    if (nomePt.length > cfg.maxNome || nomeEn.length > cfg.maxNome) {
      return "O nome deve ter no máximo " + cfg.maxNome + " caracteres (em cada idioma).";
    }
    if (temDescricao && (descPt.length > cfg.maxDescricao || descEn.length > cfg.maxDescricao)) {
      return "A descrição deve ter no máximo " + cfg.maxDescricao + " caracteres (em cada idioma).";
    }
    // A coluna real pode ser NOT NULL (ex.: ID_TIPO_RESULTADO em
    // kzn_resultados) — sem essa checagem, o erro só aparece lá no
    // servidor, num SQL cru que não diz ao usuário qual campo faltou.
    if (comboExtra && comboExtra.obrigatorio && !comboValor) {
      return (comboExtra.rotulo || "Campo") + " é obrigatório.";
    }
    return null;
  }

  // ---- ícone do registro (URL_ICONE) --------------------------------
  // Mesma lógica já validada na aba Categorias (js/categorias.js), aqui
  // no motor para valer também em Replicação, Desperdícios e Resultados.
  // Aba sem seletor de ícone (Tipo Resultados, Mot. Reprovação) não tem
  // a grade nem o campo no HTML, e a coluna não existe na tabela: tudo
  // abaixo devolve null e nada vai no corpo — a aba segue igual.
  //
  // A pasta sai do próprio iconePadrao, que já aponta para a pasta da
  // aba (assets/icons/<aba>/), então nenhuma configuração muda.
  var PASTA_ICONES = String(cfg.iconePadrao || "").replace(/[^/]+$/, "");

  // "fa-solid fa-globe" -> "assets/icons/replicacao/fa-solid-globe.svg".
  // O "fa-" do segundo termo NÃO se repete no nome do arquivo.
  function caminhoDoIcone(classe) {
    var partes = String(classe || "").trim().split(/\s+/).filter(Boolean);
    if (partes.length < 2 || !PASTA_ICONES) return null;
    return PASTA_ICONES + partes[0] + "-" + partes[partes.length - 1].replace(/^fa-/, "") + ".svg";
  }

  // O inverso: usado para reacender o botão certo ao abrir a edição.
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

  // Deixa a paleta mostrando o ícone gravado: acende o botão e alinha o
  // campo escondido. Caminho fora da paleta (registro antigo, ícone
  // próprio) não acende nada — e é aí que iconeAlterado protege o valor.
  function aplicarIconeNaPaleta(prefixo, caminho) {
    var grade = el(prefixo + "IconGrid");
    if (!grade) return;
    var classe = classeDoCaminho(caminho);
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
  var gradeEdicao = el(cfg.prefixoEdit + "IconGrid");
  if (gradeEdicao) {
    gradeEdicao.addEventListener("click", function (e) {
      if (e.target.closest(".icon-swatch")) iconeAlterado = true;
    });
  }

  function montarPayload(nomePtEl, descPtEl, nomeEnEl, descEnEl, comboEl, prefixoIcone) {
    var payload = {
      pt: { NM: nomePtEl ? nomePtEl.value.trim() : "", DS: descPtEl ? descPtEl.value.trim() : "" },
      en: { NM: nomeEnEl ? nomeEnEl.value.trim() : "", DS: descEnEl ? descEnEl.value.trim() : "" },
    };
    if (comboExtra) {
      var bruto = comboEl ? comboEl.value : "";
      payload[comboExtra.campo] = bruto ? parseInt(bruto, 10) : null;
    }
    // Só vai no corpo quando há o que gravar: na criação, sempre (o
    // registro nasce com o ícone da paleta); na edição, apenas se o
    // usuário escolheu outro. Ausente, o servidor preserva o URL_ICONE
    // que já está gravado.
    var podeEnviar = prefixoIcone !== cfg.prefixoEdit || iconeAlterado;
    var icone = podeEnviar ? iconeSelecionado(prefixoIcone) : null;
    if (icone) payload.urlIcone = icone;
    return payload;
  }

  // Preenche um <select> com as opções vindas de /api/<comboExtra.rota>
  // (mesmo endpoint que a aba de origem já usa para listar) — sem
  // valorForcado, mantém o que já estava selecionado nele.
  // incompletos: IDs que existem só em português. A FK no banco é
  // composta (id + ID_IDIOMA), então escolher um deles faz a metade em
  // inglês do salvamento falhar — a opção aparece, sinalizada e
  // desabilitada, em vez de virar erro de SQL só depois de salvar.
  function popularCombo(sel, registros, incompletos, valorForcado) {
    if (!sel) return;
    var manter = valorForcado !== undefined ? valorForcado : sel.value;
    sel.innerHTML = '<option value="">Selecione...</option>' +
      registros.map(function (r) {
        var falta = incompletos[r.ID];
        return '<option value="' + r.ID + '"' + (falta ? " disabled" : "") + ">" +
          escapeHtml(r.NM) + (falta ? " (sem tradução)" : "") + "</option>";
      }).join("");
    sel.value = manter != null ? String(manter) : "";
  }

  // Avisa as outras abas que esta tabela mudou. Quem mostra dados dela
  // (ex.: o combo de Resultados mostra Tipo Resultados) recarrega ao
  // ser aberta, sem F5 — ver window.VBMDados em js/vbm-app.js.
  function avisarMudanca() {
    if (window.VBMDados) window.VBMDados.mudou(cfg.rota);
  }

  function buscarLista(idioma) {
    return fetch("/api/" + comboExtra.rota + "?idioma=" + encodeURIComponent(idioma))
      .then(function (res) { return res.ok ? res.json() : []; });
  }

  // valorEdicao: força a seleção do combo de EDITAR (ex.: valor já
  // gravado no registro, vindo do GET /:id). O combo de CRIAR nunca é
  // forçado aqui — mantém o que o usuário já tiver escolhido.
  function carregarOpcoesCombo(valorEdicao) {
    if (!comboExtra) return;
    var idioma = idiomaEmUso();
    var emIngles = /^en/i.test(idioma);
    var pedidos = emIngles ? [buscarLista(idioma)] : [buscarLista(idioma), buscarLista("en-US")];
    Promise.all(pedidos)
      .then(function (respostas) {
        var registros = respostas[0];
        var incompletos = {};
        (emIngles ? registros : respostas[1]).forEach(function (r) {
          if (r.SEM_TRADUCAO) incompletos[r.ID] = true;
        });
        popularCombo(addComboEl, registros, incompletos);
        popularCombo(editComboEl, registros, incompletos, valorEdicao);
      })
      .catch(function (err) {
        console.error("[" + cfg.rota + "] falha ao carregar opções de " + comboExtra.rota + ":", err);
      });
  }

  function statusEl(texto, erro) {
    var div = document.createElement("div");
    div.className = "admin-list-status" + (erro ? " is-error" : "");
    div.textContent = texto;
    return div;
  }

  function badgeHtml(qtd) {
    if (!cfg.palavraBadge) return "";
    var texto = qtd == null ? "—" : qtd + " " + (qtd === 1 ? cfg.palavraBadgeSingular : cfg.palavraBadge);
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
      '<div class="admin-item-icon ' + cfg.classeIcone + '">' +
        // Os dois lados são URL de assets/icons: o banco (URL_ICONE) quando
        // o registro tem ícone próprio, senão o ícone padrão da aba. Mesmo
        // <img> nos dois casos — só muda de onde vem o endereço.
        '<img src="' + escapeHtml(reg.URL_ICONE || cfg.iconePadrao) + '" alt="" loading="lazy">' +
      "</div>" +
      '<div class="admin-item-body">' +
        '<div class="admin-item-name">' + escapeHtml(reg.NM) + semTraducaoHtml(reg) + "</div>" +
        (temDescricao ? '<div class="admin-item-sub">' + escapeHtml(reg.DS) + "</div>" : "") +
      "</div>" +
      badgeHtml(reg.QTD) +
      '<div class="admin-item-actions">' +
        '<button type="button" class="btn-icon btn-icon-blue btn-icon-sm" data-action="editar" title="Editar" data-i18n-title="common.editar"><i class="fa-solid fa-pen"></i></button>' +
        '<button type="button" class="btn-icon ' + (reg.ATIVO ? "btn-icon-red" : "btn-icon-blue") + ' btn-icon-sm" data-action="status" title="' + (reg.ATIVO ? "Desativar" : "Reativar") + '"><i class="fa-solid ' + (reg.ATIVO ? "fa-ban" : "fa-rotate-right") + '"></i></button>' +
      "</div>";

    // Ícone que não carrega — arquivo SVG ainda não publicado, ou
    // URL_ICONE apontando para um caminho que não existe mais — deixava
    // o cartão com o símbolo de imagem quebrada do navegador. Cai no
    // glifo do Font Awesome correspondente, que é vendorizado junto com
    // a aplicação e não depende de nenhum arquivo em assets/icons.
    var img = item.querySelector(".admin-item-icon img");
    if (img) {
      img.addEventListener("error", function () {
        var classe = classeDoCaminho(img.getAttribute("src")) ||
                     classeDoCaminho(cfg.iconePadrao);
        if (!classe) return; // sem classe reconhecível, deixa como está
        var glifo = document.createElement("i");
        glifo.className = classe;
        img.replaceWith(glifo);
      }, { once: true });
    }

    item.querySelector('[data-action="editar"]').addEventListener("click", function () { abrirEdicao(reg); });
    item.querySelector('[data-action="status"]').addEventListener("click", function () { alternarStatus(reg, item); });
    return item;
  }

  // Recarrega sempre do banco — nunca reaproveita estado anterior,
  // então o ativo/inativo exibido é o SG_ATIVO atual.
  function carregarLista() {
    // Overlay por cima da lista ATUAL (padrão global — window.VBMLoading
    // em vbm-app.js), em vez de apagar tudo para o texto "Carregando…":
    // recarregar depois de ativar/desativar/editar um item piscava a
    // aba inteira em branco por um instante. Na primeira carga da aba
    // (nada na tela ainda) cai na rede de segurança de sempre.
    if (window.VBMLoading && jaCarregouAlgumaVez) {
      VBMLoading.overlay(list, true, { texto: cfg.textoCarregando });
    } else {
      list.innerHTML = "";
      list.appendChild(statusEl(cfg.textoCarregando, false));
    }
    jaCarregouAlgumaVez = true;

    // cache: "no-store" — esta leitura acontece logo depois de gravar e
    // precisa refletir a gravação. Sem isso, uma resposta guardada em
    // qualquer ponto do caminho (navegador ou proxy) faria o registro
    // recém-criado só aparecer quando o prazo do cache vencesse.
    fetch("/api/" + cfg.rota + "?idioma=" + encodeURIComponent(idiomaEmUso()), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (e) { throw new Error(e.error || res.statusText); });
        return res.json();
      })
      .then(function (registros) {
        list.innerHTML = "";
        if (!registros.length) {
          list.appendChild(statusEl(cfg.textoVazio, false));
          return;
        }
        registros.forEach(function (reg) { list.appendChild(renderItem(reg)); });
      })
      .catch(function (err) {
        console.error("[" + cfg.rota + "] falha ao carregar lista:", err);
        if (window.VBMLoading) VBMLoading.overlay(list, false);
        list.innerHTML = "";
        var box = statusEl("", true);
        box.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span></span>';
        // Mostra o motivo real (erro do banco/rede), não só o texto genérico
        // — sem isso, uma falha de conexão/permissão no Azure SQL aparecia
        // igual a qualquer outra, sem nenhuma pista do que checar.
        box.querySelector("span").textContent =
          cfg.textoErro + (err && err.message ? " Detalhe: " + err.message : "");
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
    aplicarIconeNaPaleta(cfg.prefixoEdit, reg.URL_ICONE || cfg.iconePadrao);
    if (window.openModal) openModal(cfg.modalEditId);

    fetch("/api/" + cfg.rota + "/" + encodeURIComponent(reg.ID))
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
          if (window.updateCategoryDescCounter) updateCategoryDescCounter(editDescPt, cfg.prefixoEdit, cfg.maxDescricao);
        }
        if (editDescEn) editDescEn.value = (data.en && data.en.DS) || "";
        if (comboExtra) carregarOpcoesCombo(data[comboExtra.campo]);
        // O ícone é do registro (mesmo nos 2 idiomas) e vem do banco —
        // mas esta resposta é assíncrona e não pode passar por cima de
        // uma escolha que o usuário já fez enquanto ela vinha (rede
        // lenta), nem pintar a paleta de um registro que já não é o
        // aberto. Nos dois casos gravaria um ícone que ninguém escolheu.
        if (!iconeAlterado && idEmEdicao === reg.ID) {
          aplicarIconeNaPaleta(cfg.prefixoEdit, data.urlIcone || cfg.iconePadrao);
        }
      })
      .catch(function (err) {
        console.error("[" + cfg.rota + "] falha ao carregar para edição:", err);
        if (window.showToast) showToast("error", "Erro ao carregar", "Não foi possível buscar os dados no banco. " + err.message);
      });
  }

  function salvarEdicao() {
    if (idEmEdicao == null) {
      if (window.showToast) showToast("error", "Erro", "Registro não identificado — feche e abra o formulário de novo.");
      return;
    }
    var payload = montarPayload(editNamePt, editDescPt, editNameEn, editDescEn, editComboEl, cfg.prefixoEdit);
    var erro = validar(payload.pt.NM, payload.pt.DS, payload.en.NM, payload.en.DS, editComboEl ? editComboEl.value : null);
    if (erro) {
      if (window.showToast) showToast("warning", "Campo inválido", erro);
      return;
    }

    if (editSaveBtn) { if (window.VBMLoading) VBMLoading.botao(editSaveBtn, true); else editSaveBtn.disabled = true; }
    fetch("/api/" + cfg.rota + "/" + encodeURIComponent(idEmEdicao), {
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
        if (window.closeModal) closeModal(cfg.modalEditId);
        if (window.showToast) showToast("success", "Salvo", cfg.rotuloSingular + " atualizado com sucesso!");
        carregarLista();
        avisarMudanca();
      })
      .catch(function (err) {
        console.error("[" + cfg.rota + "] falha ao salvar:", err);
        if (window.showToast) showToast("error", "Erro ao salvar", err.message);
      })
      .finally(function () {
        if (editSaveBtn) { if (window.VBMLoading) VBMLoading.botao(editSaveBtn, false); else editSaveBtn.disabled = false; }
      });
  }

  // ── Criar ──
  function limparFormularioCriacao() {
    if (addNamePt) addNamePt.value = "";
    if (addNameEn) addNameEn.value = "";
    if (addDescPt) {
      addDescPt.value = "";
      if (window.updateCategoryDescCounter) updateCategoryDescCounter(addDescPt, cfg.prefixoAdd, cfg.maxDescricao);
    }
    if (addDescEn) addDescEn.value = "";
    if (addComboEl) addComboEl.value = "";
  }

  function salvarCriacao() {
    var payload = montarPayload(addNamePt, addDescPt, addNameEn, addDescEn, addComboEl, cfg.prefixoAdd);
    var erro = validar(payload.pt.NM, payload.pt.DS, payload.en.NM, payload.en.DS, addComboEl ? addComboEl.value : null);
    if (erro) {
      if (window.showToast) showToast("warning", "Campo inválido", erro);
      return;
    }

    if (addSaveBtn) { if (window.VBMLoading) VBMLoading.botao(addSaveBtn, true); else addSaveBtn.disabled = true; }
    fetch("/api/" + cfg.rota, {
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
        if (window.closeModal) closeModal(cfg.modalAddId);
        if (window.showToast) showToast("success", "Criado", cfg.rotuloSingular + " adicionado com sucesso!");
        carregarLista();
        avisarMudanca();
      })
      .catch(function (err) {
        console.error("[" + cfg.rota + "] falha ao criar:", err);
        if (window.showToast) showToast("error", "Erro ao criar", err.message);
      })
      .finally(function () {
        if (addSaveBtn) { if (window.VBMLoading) VBMLoading.botao(addSaveBtn, false); else addSaveBtn.disabled = false; }
      });
  }

  // ── Ativar/Desativar — grava SG_ATIVO no banco, nunca só visual ──
  async function alternarStatus(reg, item) {
    var ativar = !reg.ATIVO;
    var confirmado = await confirmarAcao({
      variant: ativar ? "ativar" : "desativar",
      titulo: (ativar ? 'Reativar "' : 'Desativar "') + reg.NM + '"?',
      mensagem: ativar ? "" : "Deixará de aparecer como opção ativa, mas não será excluído.",
    });
    if (!confirmado) return;

    fetch("/api/" + cfg.rota + "/" + encodeURIComponent(reg.ID) + "/status", {
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
        // Redesenhar só o item deixaria a tela apoiada no estado local.
        // Relendo a lista, o que aparece é sempre o que está gravado —
        // mesma regra do criar e do editar. A aba não muda: a releitura
        // acontece dentro dela.
        carregarLista();
        avisarMudanca();
        if (window.showToast) {
          showToast("success", ativar ? "Reativado" : "Desativado",
            '"' + reg.NM + '" ' + (ativar ? "reativado" : "desativado") + " com sucesso.");
        }
      })
      .catch(function (err) {
        console.error("[" + cfg.rota + "] falha ao atualizar status:", err);
        if (window.showToast) showToast("error", "Erro", "Não foi possível atualizar o status. " + err.message);
      });
  }

  if (editSaveBtn) editSaveBtn.addEventListener("click", salvarEdicao);
  if (addSaveBtn) addSaveBtn.addEventListener("click", salvarCriacao);
  // Limpa o formulário ao abrir — nunca deixa sobrar texto de uma
  // tentativa anterior (evita reenviar sem querer).
  if (addTrigger) addTrigger.addEventListener("click", limparFormularioCriacao);

  // Carrega sob demanda: as 6 abas do admin ficam todas no mesmo HTML,
  // mas só uma está visível. Antes, cada aba disparava sua consulta no
  // load da página — 6 idas ao Azure SQL para mostrar 1 lista. Agora a
  // aba visível carrega na hora e as demais só na primeira vez que são
  // abertas.
  //
  // Depois da primeira carga a aba NÃO reconsulta a cada reabertura (a
  // lista dela só muda por ação dela mesma, que já recarrega na hora).
  // A exceção é o combo, que mostra dados de OUTRA aba: se aquela aba
  // gravou algo nesse meio tempo, VBMDados marca o combo como
  // desatualizado e ele recarrega aqui, na reabertura — só então, e só
  // ele.
  var painel = list.closest(".admin-panel");

  function abaAberta() {
    return !painel || painel.classList.contains("active");
  }

  var revalidarCombo =
    comboExtra && window.VBMDados
      ? window.VBMDados.aoMudar([comboExtra.rota], carregarOpcoesCombo, abaAberta)
      : null;

  function aoAbrirAba() {
    if (!jaCarregouAlgumaVez) {
      carregarLista();
      carregarOpcoesCombo();
      return;
    }
    if (revalidarCombo) revalidarCombo(); // no-op se nada mudou
  }

  if (abaAberta() || typeof MutationObserver === "undefined") {
    aoAbrirAba();
  } else {
    new MutationObserver(function () {
      if (painel.classList.contains("active")) aoAbrirAba();
    }).observe(painel, { attributes: true, attributeFilter: ["class"] });
  }
};
