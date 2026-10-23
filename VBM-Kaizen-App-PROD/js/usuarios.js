/**
 * VBM Kaizen — aba "Usuários" (admin.html).
 *
 * Cadastro dos usuários TERCEIROS do MDM: kzn_mdm_hierarquia com
 * ID_TIPO_USUARIO = 2. Esse recorte é do SERVIDOR (ver as rotas
 * /api/usuarios em server.js), não um filtro da tela — busca, empresa
 * e unidade só estreitam o resultado, nunca ampliam, e o tipo nunca
 * viaja no corpo da requisição.
 *
 * Colunas da grade, todas do MDM:
 *   Usuário  NM_USUARIO      Site     NM_SITE
 *   E-mail   CD_EMAIL        Função   NM_POSICAO
 *   Empresa  NM_EMPRESA      Status   SG_ATIVO
 *
 * A CHAVE É COMPOSTA — (ID_USUARIO, CD_MATRICULA, ID_TIPO_USUARIO).
 * Por isso toda ação de linha manda ID e matrícula: só o ID poderia
 * casar com mais de um registro. E por isso os dois campos abrem
 * travados na edição: trocá-los seria criar outro registro.
 *
 *   GET    /api/usuarios?q=&empresa=a,b&unidade=a,b&status=ativo,inativo&pagina=&tamanho=
 *                                               lista paginada (só terceiros)
 *   GET    /api/usuarios/empresas               filtro Empresa
 *   GET    /api/usuarios/unidades               filtro Unidade
 *   GET    /api/usuarios/formulario            próximo ID + sugestões
 *   POST   /api/usuarios                        inserir
 *   PUT    /api/usuarios/:id                    editar
 *   PUT    /api/usuarios/:id/status             ativar/desativar
 *
 * Depende de funções globais de vbm-app.js: openModal / closeModal /
 * showToast / confirmarAcao.
 */
(function () {
  var tbody = document.getElementById("usuariosTableBody");
  if (!tbody) return; // esta página não tem a aba Usuários

  var COLUNAS = 7;
  var BUSCA_MIN = 2; // mesmo mínimo do servidor
  var buscaEl = document.getElementById("usuariosBusca");
  // Empresa, Unidade e Status: filtro de múltipla seleção, o mesmo da
  // Biblioteca (js/filtro-multiplo.js). Nenhum marcado = todos.
  function txtFiltro(chave, padrao) {
    return (window.__i18n && window.__i18n[chave]) || padrao;
  }
  function novoFiltro(id, chave, padrao) {
    return window.VBMFiltroMultiplo.criar(document.getElementById(id), {
      placeholder: txtFiltro(chave, padrao),
      ariaLabel: padrao,
      onChange: function () { carregar(0); },
    });
  }
  var filtroEmpresa = novoFiltro("usuariosEmpresa", "filter.allCompanies", "Todas as empresas");
  var filtroUnidade = novoFiltro("usuariosUnidade", "filter.allUnits", "Todas as unidades");
  var filtroStatus = novoFiltro("usuariosStatus", "filter.allStatus", "Todos os status");
  function itensStatus() {
    return [
      { v: "ativo", t: txtFiltro("status.ativo", "Ativo") },
      { v: "inativo", t: txtFiltro("status.inativo", "Inativo") },
    ];
  }
  filtroStatus.setItens(itensStatus(), function (i) { return i.v; }, function (i) { return i.t; });
  filtroStatus.setSelecionados(["ativo"]); // 1ª carga: só ativos
  var contagemEl = document.getElementById("usuariosContagem");
  // Rodapé + atalho no topo: mesmos controles, mesmo estado.
  function porIds(ids) {
    return ids.map(function (id) { return document.getElementById(id); }).filter(Boolean);
  }
  var btnsAnterior = porIds(["usuariosPaginaAnterior", "usuariosPaginaAnteriorTopo"]);
  var btnsProxima = porIds(["usuariosPaginaProxima", "usuariosPaginaProximaTopo"]);
  var paginaAtualEls = porIds(["usuariosPaginaAtual", "usuariosPaginaAtualTopo"]);
  var tamanhoEls = porIds(["usuariosTamanhoPagina", "usuariosTamanhoPaginaTopo"]);

  // Paginação no servidor, mesmo comportamento da Biblioteca.
  var paginaAtual = 0;
  var total = 0;
  var requisicaoAtual = 0;

  // Mesma lista do servidor (COLUNAS_MDM_TEXTO em server.js), na mesma
  // ordem. É o contrato dos dois modais: cada campo do HTML se declara
  // com data-campo="<COLUNA>".
  var CAMPOS_TEXTO = [
    "NM_USUARIO", "CD_EMAIL", "NM_POSICAO", "NM_EMPRESA",
    "NM_PAIS", "NM_ESTADO", "NM_CIDADE", "NM_SITE",
    "NM_HIERARQUIA_N1", "NM_HIERARQUIA_N2", "NM_HIERARQUIA_N3", "NM_HIERARQUIA_N4",
    "NM_HIERARQUIA_N5", "NM_HIERARQUIA_N6", "NM_HIERARQUIA_N7", "NM_HIERARQUIA_N8",
  ];

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function initials(nome) {
    var p = String(nome || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "?";
    return (p[0][0] + (p[1] ? p[1][0] : "")).toUpperCase();
  }

  function linhaAviso(texto, erro) {
    return '<tr><td colspan="' + COLUNAS + '" style="padding:1.25rem;font-size:.8rem;color:' +
      (erro ? "#c0392b" : "var(--vbm-mid)") + ';">' + escapeHtml(texto) + "</td></tr>";
  }

  function emIngles() {
    var idioma = (window.VBMIdioma && window.VBMIdioma.atual()) || "pt-BR";
    return String(idioma).toLowerCase().indexOf("en") === 0;
  }

  // "Ativo"/"Inativo" é rótulo de tela: SG_ATIVO não é bilíngue no
  // banco, então a tradução é local. O data-i18n faz o badge acompanhar
  // trocas de idioma seguintes sem re-render (ver translatePanel no
  // <script> de idioma de admin.html).
  function statusBadge(ativo) {
    var chave = ativo ? "status.ativo" : "status.inativo";
    var texto = ativo
      ? (emIngles() ? "Active" : "Ativo")
      : (emIngles() ? "Inactive" : "Inativo");
    return '<span class="admin-item-badge" data-i18n="' + chave + '">' + escapeHtml(texto) + "</span>";
  }

  function celula(valor) {
    return valor
      ? "<td>" + escapeHtml(valor) + "</td>"
      : '<td style="color:var(--vbm-mid);">—</td>';
  }

  // Mesmo par de botões das outras abas: lápis para editar, banir/
  // recuperar para alternar o status.
  function acoes(ativo) {
    return '<td><div class="row-actions" style="display:inline-flex;gap:.35rem;">' +
      '<button type="button" class="btn-icon btn-icon-blue btn-icon-sm" data-action="editar" title="Editar" data-i18n-title="common.editar"><i class="fa-solid fa-pen"></i></button>' +
      '<button type="button" class="btn-icon ' + (ativo ? "btn-icon-red" : "btn-icon-blue") +
        ' btn-icon-sm" data-action="status" title="' + (ativo ? "Desativar" : "Reativar") + '">' +
        '<i class="fa-solid ' + (ativo ? "fa-ban" : "fa-rotate-right") + '"></i></button>' +
      "</div></td>";
  }

  function linhaHtml(u) {
    return '<tr class="' + (u.ATIVO ? "" : "admin-item-inactive") + '">' +
      '<td><div style="display:flex;align-items:center;gap:.5rem;">' +
        '<div class="admin-avatar" style="width:28px;height:28px;font-size:.65rem;background:linear-gradient(135deg,#3cb5e5,#1a8bbf);">' + escapeHtml(initials(u.NM_USUARIO)) + "</div>" +
        "<span>" + escapeHtml(u.NM_USUARIO || "—") + "</span></div></td>" +
      '<td style="font-size:.78rem;">' + escapeHtml(u.CD_EMAIL || "—") + "</td>" +
      celula(u.NM_SITE) +
      celula(u.NM_POSICAO) +
      celula(u.NM_EMPRESA) +
      "<td>" + statusBadge(u.ATIVO) + "</td>" +
      acoes(u.ATIVO) +
    "</tr>";
  }

  // A linha guarda a chave inteira; os handlers leem daqui, nunca de
  // uma posição de array que a próxima busca invalidaria.
  function render(usuarios) {
    if (!usuarios.length) {
      tbody.innerHTML = linhaAviso("Nenhum usuário encontrado.", false);
      return;
    }
    tbody.innerHTML = usuarios.map(linhaHtml).join("");
    Array.prototype.forEach.call(tbody.querySelectorAll("tr"), function (tr, i) {
      var u = usuarios[i];
      tr.dataset.id = u.ID_USUARIO;
      tr.dataset.matricula = u.CD_MATRICULA == null ? "" : u.CD_MATRICULA;
      tr.querySelector('[data-action="editar"]').addEventListener("click", function () {
        abrirEdicao(u);
      });
      tr.querySelector('[data-action="status"]').addEventListener("click", function () {
        alternarStatus(u);
      });
    });
  }

  var jaCarregou = false;

  // Busca com menos de 2 caracteres não vai para o servidor: a lista
  // fica como está (sem filtro de texto), que é o gatilho mínimo pedido.
  function parametros() {
    var termo = buscaEl ? buscaEl.value.trim() : "";
    var partes = [];
    if (termo.length >= BUSCA_MIN) partes.push("q=" + encodeURIComponent(termo));
    [["empresa", filtroEmpresa], ["unidade", filtroUnidade], ["status", filtroStatus]].forEach(function (par) {
      var valores = par[1].getSelecionados();
      if (valores.length) partes.push(par[0] + "=" + encodeURIComponent(valores.join(",")));
    });
    partes.push("pagina=" + paginaAtual, "tamanho=" + tamanhoPagina());
    return "?" + partes.join("&");
  }

  function tamanhoPagina() {
    return (tamanhoEls[0] && parseInt(tamanhoEls[0].value, 10)) || 24;
  }

  function texto(chave, padrao) {
    return (window.__i18n && window.__i18n[chave]) || padrao;
  }

  function atualizarPaginacao() {
    var tam = tamanhoPagina();
    var totalPaginas = Math.max(1, Math.ceil(total / tam));
    if (contagemEl) {
      contagemEl.textContent = texto("adm.usersCountTemplate", "Exibindo {inicio}–{fim} de {total} usuários")
        .replace("{inicio}", total === 0 ? 0 : paginaAtual * tam + 1)
        .replace("{fim}", Math.min((paginaAtual + 1) * tam, total))
        .replace("{total}", total.toLocaleString("pt-BR"));
    }
    var rotulo = texto("adm.pageTemplate", "Página {atual} de {totalPaginas}")
      .replace("{atual}", paginaAtual + 1)
      .replace("{totalPaginas}", totalPaginas);
    paginaAtualEls.forEach(function (el) { el.textContent = rotulo; });
    btnsAnterior.forEach(function (b) { b.disabled = paginaAtual <= 0; });
    btnsProxima.forEach(function (b) { b.disabled = paginaAtual + 1 >= totalPaginas; });
  }

  function comoJson(res) {
    return res.text().then(function (texto) {
      var dados = null;
      try { dados = texto ? JSON.parse(texto) : null; } catch (e) { /* resposta não-JSON */ }
      if (!res.ok) throw new Error((dados && dados.error) || ("HTTP " + res.status));
      return dados;
    });
  }

  // Sem argumento recarrega a página atual (após salvar/ativar/desativar);
  // filtro alterado chama carregar(0).
  function carregar(pagina) {
    if (typeof pagina === "number") paginaAtual = pagina;
    var meuPedido = ++requisicaoAtual;
    // Overlay no WRAP da tabela (padrão global — window.VBMLoading), não
    // na tbody: linha absoluta dentro de <tbody> não é um contêiner de
    // posicionamento confiável entre navegadores. As linhas atuais
    // continuam na tela, só esmaecidas, até a resposta nova chegar.
    var wrap = tbody.closest(".data-table-wrap");
    if (window.VBMLoading && wrap && jaCarregou) {
      VBMLoading.overlay(wrap, true, { texto: "Carregando…" });
    } else {
      tbody.innerHTML = linhaAviso("Carregando usuários…", false);
    }
    jaCarregou = true;
    return fetch("/api/usuarios" + parametros())
      .then(comoJson)
      .then(function (dados) {
        if (meuPedido !== requisicaoAtual) return;
        if (window.VBMLoading && wrap) VBMLoading.overlay(wrap, false);
        total = dados.total || 0;
        // Página ficou vazia (último item desativado/filtrado): volta
        // para a última página que existe.
        var ultima = Math.max(0, Math.ceil(total / tamanhoPagina()) - 1);
        if (!dados.itens.length && paginaAtual > ultima) return carregar(ultima);
        atualizarPaginacao();
        return render(dados.itens);
      })
      .catch(function (err) {
        if (meuPedido !== requisicaoAtual) return;
        console.error("[usuarios] falha ao carregar:", err);
        if (window.VBMLoading && wrap) VBMLoading.overlay(wrap, false);
        tbody.innerHTML = linhaAviso("Erro ao carregar usuários: " + err.message, true);
      });
  }

  // Opções dos filtros Empresa (NM_EMPRESA) e Unidade (NM_SITE), ambos
  // com os valores distintos dos terceiros. A 1ª opção ("Todas as ...")
  // é a do HTML e fica preservada.
  //
  // Sem nenhum valor no banco (coluna vazia no MDM) o combo é
  // desabilitado: um filtro que só tem "Todas as ..." não filtra nada, e
  // deixá-lo clicável faz parecer que a tela perdeu as opções.
  //
  // Falha aqui não derruba a lista: o combo fica só com a opção "Todas"
  // e a tabela continua funcionando.
  function carregarOpcoes(filtro, rota, rotulo) {
    fetch("/api/usuarios/" + rota)
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (valores) {
        var proprio = function (v) { return v; };
        filtro.setItens(valores, proprio, proprio);
        filtro.setDesabilitado(valores.length === 0);
      })
      .catch(function (err) {
        console.error("[usuarios] falha ao carregar " + rotulo + ":", err);
        filtro.setDesabilitado(true);
      });
  }

  function recarregarFiltros() {
    carregarOpcoes(filtroEmpresa, "empresas", "empresas");
    carregarOpcoes(filtroUnidade, "unidades", "unidades");
  }

  // ── Apoio do formulário: próximo ID e sugestões dos campos ──
  //
  // Uma requisição só traz as duas coisas. As sugestões vão para os
  // <datalist> do HTML, compartilhados pelos dois modais: o campo
  // continua livre para digitar, só ganha a lista do que já existe.
  var proximoId = null;

  function carregarFormulario() {
    return fetch("/api/usuarios/formulario")
      .then(comoJson)
      .then(function (dados) {
        proximoId = dados.proximoId;
        Object.keys(dados.opcoes || {}).forEach(function (coluna) {
          var lista = document.getElementById("opt-" + coluna);
          if (!lista) return;
          lista.innerHTML = "";
          dados.opcoes[coluna].forEach(function (valor) {
            var op = document.createElement("option");
            op.value = valor;
            lista.appendChild(op);
          });
        });
      })
      .catch(function (err) {
        // Sem isso o cadastro continua funcionando: o ID passa a ser
        // digitado e os campos ficam sem sugestão.
        console.error("[usuarios] falha ao carregar apoio do formulário:", err);
      });
  }

  // ── Formulário (mesmos campos nos dois modais) ──
  //
  // Cada campo se identifica por data-campo="<COLUNA>", então ler e
  // escrever o formulário é percorrer as colunas — sem uma lista de
  // ids paralela para sair de sincronia.
  function campo(modalId, coluna) {
    return document.querySelector("#" + modalId + ' [data-campo="' + coluna + '"]');
  }

  function limparFormulario(modalId) {
    ["ID_USUARIO", "CD_MATRICULA"].concat(CAMPOS_TEXTO).forEach(function (c) {
      var el = campo(modalId, c);
      if (el) el.value = "";
    });
    var st = campo(modalId, "SG_ATIVO");
    if (st) st.value = "S";
  }

  function preencherFormulario(modalId, dados) {
    ["ID_USUARIO", "CD_MATRICULA"].concat(CAMPOS_TEXTO).forEach(function (c) {
      var el = campo(modalId, c);
      if (el) el.value = dados[c] == null ? "" : dados[c];
    });
    var st = campo(modalId, "SG_ATIVO");
    if (st) st.value = dados.ATIVO === false ? "N" : "S";
  }

  function lerFormulario(modalId) {
    var corpo = {};
    CAMPOS_TEXTO.forEach(function (c) {
      var el = campo(modalId, c);
      corpo[c] = el ? el.value : "";
    });
    var id = campo(modalId, "ID_USUARIO");
    var mat = campo(modalId, "CD_MATRICULA");
    var st = campo(modalId, "SG_ATIVO");
    corpo.ID_USUARIO = id ? id.value.trim() : "";
    corpo.CD_MATRICULA = mat ? mat.value.trim() : "";
    corpo.ATIVO = !st || st.value === "S";
    return corpo;
  }

  // Validação mínima, igual à do servidor: sem chave não há registro, e
  // sem nome a linha não diz nada na grade.
  function faltando(corpo, exigirChave) {
    if (exigirChave && !/^\d+$/.test(corpo.ID_USUARIO)) return "Informe o ID do usuário (MDM), só números.";
    if (exigirChave && !corpo.CD_MATRICULA) return "Informe a matrícula.";
    if (!String(corpo.NM_USUARIO || "").trim()) return "Informe o nome completo.";
    return null;
  }

  function enviar(url, metodo, corpo) {
    return fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }).then(comoJson);
  }

  // ── Inserir ──
  var btnAdd = document.getElementById("btnSaveAddUser");
  var gatilhoAdd = document.querySelector('[data-modal-open="modalAddUser"]');
  if (gatilhoAdd) {
    gatilhoAdd.addEventListener("click", function () {
      limparFormulario("modalAddUser");
      // Sugere o próximo ID livre; o servidor recusa qualquer valor que
      // não seja maior que o maior já cadastrado.
      var campoId = campo("modalAddUser", "ID_USUARIO");
      if (campoId && proximoId != null) campoId.value = proximoId;
    });
  }

  function salvarNovo() {
    var corpo = lerFormulario("modalAddUser");
    var erro = faltando(corpo, true);
    if (erro) {
      if (window.showToast) showToast("warning", "Campo obrigatório", erro);
      return;
    }
    if (btnAdd) { if (window.VBMLoading) VBMLoading.botao(btnAdd, true); else btnAdd.disabled = true; }
    enviar("/api/usuarios", "POST", corpo)
      .then(function () {
        if (window.closeModal) closeModal("modalAddUser");
        if (window.showToast) showToast("success", "Usuário criado", "Usuário cadastrado com sucesso!");
        limparFormulario("modalAddUser");
        carregar();
        // Empresa e unidade novas passam a existir nos combos; o
        // próximo ID e as sugestões dos campos também mudaram.
        recarregarFiltros();
        carregarFormulario();
      })
      .catch(function (err) {
        console.error("[usuarios] falha ao inserir:", err);
        if (window.showToast) showToast("error", "Erro ao salvar", err.message);
      })
      .finally(function () { if (btnAdd) { if (window.VBMLoading) VBMLoading.botao(btnAdd, false); else btnAdd.disabled = false; } });
  }

  // ── Editar ──
  //
  // Abrir a edição NÃO consulta nada: a listagem já devolve o registro
  // inteiro, inclusive país, cidade e os 8 níveis de hierarquia, que a
  // grade não mostra. O modal só copia o que está em mãos.
  var btnEdit = document.getElementById("btnSaveEditUser");
  var chaveEmEdicao = null;

  function abrirEdicao(u) {
    chaveEmEdicao = { id: u.ID_USUARIO, matricula: u.CD_MATRICULA };
    limparFormulario("modalEditUser");
    preencherFormulario("modalEditUser", u);
    if (window.openModal) openModal("modalEditUser");
  }

  function salvarEdicao() {
    if (!chaveEmEdicao) return;
    var corpo = lerFormulario("modalEditUser");
    var erro = faltando(corpo, false);
    if (erro) {
      if (window.showToast) showToast("warning", "Campo obrigatório", erro);
      return;
    }
    // A chave vem do registro aberto, não dos campos travados: o que
    // identifica a linha é o que foi clicado.
    corpo.CD_MATRICULA = chaveEmEdicao.matricula;
    if (btnEdit) { if (window.VBMLoading) VBMLoading.botao(btnEdit, true); else btnEdit.disabled = true; }
    enviar("/api/usuarios/" + encodeURIComponent(chaveEmEdicao.id), "PUT", corpo)
      .then(function () {
        if (window.closeModal) closeModal("modalEditUser");
        if (window.showToast) showToast("success", "Salvo", "Usuário atualizado com sucesso!");
        carregar();
        recarregarFiltros();
        carregarFormulario();
      })
      .catch(function (err) {
        console.error("[usuarios] falha ao salvar:", err);
        if (window.showToast) showToast("error", "Erro ao salvar", err.message);
      })
      .finally(function () { if (btnEdit) { if (window.VBMLoading) VBMLoading.botao(btnEdit, false); else btnEdit.disabled = false; } });
  }

  // ── Ativar/Desativar — grava SG_ATIVO no banco, nunca só visual ──
  function alternarStatus(u) {
    var ativar = !u.ATIVO;
    var nome = u.NM_USUARIO || "ID " + u.ID_USUARIO;
    Promise.resolve(
      window.confirmarAcao
        ? confirmarAcao({
            variant: ativar ? "ativar" : "desativar",
            titulo: ativar ? ('Reativar "' + nome + '"?') : ('Desativar "' + nome + '"?'),
            mensagem: ativar ? "" : "Deixará de aparecer como usuário ativo, mas não será excluído.",
          })
        : true
    ).then(function (confirmado) {
      if (!confirmado) return;
      return enviar(
        "/api/usuarios/" + encodeURIComponent(u.ID_USUARIO) + "/status",
        "PUT",
        { ativo: ativar, CD_MATRICULA: u.CD_MATRICULA }
      ).then(function () {
        u.ATIVO = ativar;
        carregar();
        if (window.showToast) {
          showToast("success", ativar ? "Reativado" : "Desativado",
            '"' + nome + '" ' + (ativar ? "reativado" : "desativado") + " com sucesso.");
        }
      });
    }).catch(function (err) {
      console.error("[usuarios] erro ao atualizar status:", err);
      if (window.showToast) showToast("error", "Erro", "Não foi possível atualizar o status. " + err.message);
    });
  }

  if (btnAdd) btnAdd.addEventListener("click", salvarNovo);
  if (btnEdit) btnEdit.addEventListener("click", salvarEdicao);

  // Debounce: uma consulta depois que a digitação para, não uma por tecla.
  var timerBusca = null;
  if (buscaEl) {
    buscaEl.addEventListener("input", function () {
      clearTimeout(timerBusca);
      timerBusca = setTimeout(function () { carregar(0); }, 300);
    });
  }
  // Os dois "Por página" (topo e rodapé) andam juntos.
  tamanhoEls.forEach(function (sel) {
    sel.addEventListener("change", function () {
      tamanhoEls.forEach(function (outro) { outro.value = sel.value; });
      carregar(0);
    });
  });
  var btnLimpar = document.getElementById("usuariosLimparFiltros");
  if (btnLimpar) btnLimpar.addEventListener("click", function () {
    clearTimeout(timerBusca);
    if (buscaEl) buscaEl.value = "";
    // Limpa TODOS os filtros da aba (inclusive Status = todos).
    filtroEmpresa.limpar();
    filtroUnidade.limpar();
    filtroStatus.limpar();
    carregar(0);
  });
  btnsAnterior.forEach(function (b) {
    b.addEventListener("click", function () { if (paginaAtual > 0) carregar(paginaAtual - 1); });
  });
  btnsProxima.forEach(function (b) {
    b.addEventListener("click", function () {
      if (paginaAtual + 1 < Math.ceil(total / tamanhoPagina())) carregar(paginaAtual + 1);
    });
  });
  // Rótulos montados em JS acompanham a troca de idioma.
  window.addEventListener("vbm:idioma", function () {
    filtroEmpresa.setPlaceholder(txtFiltro("filter.allCompanies", "Todas as empresas"));
    filtroUnidade.setPlaceholder(txtFiltro("filter.allUnits", "Todas as unidades"));
    filtroStatus.setPlaceholder(txtFiltro("filter.allStatus", "Todos os status"));
    filtroStatus.setItens(itensStatus(), function (i) { return i.v; }, function (i) { return i.t; });
    if (jaCarregou) atualizarPaginacao();
  });

  // Carrega sob demanda: esta aba nasce escondida, mas antes já
  // consultava o MDM no load da página. Agora só na primeira vez que
  // for realmente aberta.
  var painel = tbody.closest(".admin-panel");

  function abaAberta() {
    return !painel || painel.classList.contains("active");
  }

  function aoAbrirAba() {
    if (jaCarregou) return;
    recarregarFiltros();
    carregarFormulario();
    carregar();
  }

  if (abaAberta() || typeof MutationObserver === "undefined") {
    aoAbrirAba();
  } else {
    new MutationObserver(function () {
      if (painel.classList.contains("active")) aoAbrirAba();
    }).observe(painel, { attributes: true, attributeFilter: ["class"] });
  }
})();
