/**
 * VBM Kaizen — dados do usuário logado (Microsoft Graph).
 *
 * Consome o token JÁ obtido pelo fluxo de login existente (MSAL/Entra ID
 * no index.html, escopo delegado User.Read) — este arquivo NÃO faz
 * login, não pede escopo novo e não altera o fluxo de autenticação.
 *
 * O que faz:
 *   1. Busca o perfil completo em /me, o gestor em /me/manager e a foto
 *      em /me/photo/$value (uma vez por sessão, no index.html, que é a
 *      porta de entrada da aplicação e o único lugar com MSAL).
 *   2. Guarda o resultado em sessionStorage, para as demais telas
 *      (admin, biblioteca, aprovação, kaizen-novo) mostrarem o mesmo
 *      usuário sem repetir a chamada ao Graph nem embutir MSAL nelas.
 *   3. Renderiza no canto superior direito nome + cargo + foto
 *      (bolinha), reaproveitando a estrutura .topnav-user que já
 *      existe nas 5 páginas — sem markup ou CSS novos. O cargo não vem
 *      do Graph nem do proxy: é o NM_POSICAO do MDM (mesma tabela das
 *      abas Aprovadores/Usuários), buscado pelo e-mail via GET /api/me.
 *   4. Deixa o restante dos campos (e-mail, cargo, empresa, departamento,
 *      localização, telefones, idioma, Object ID, gestor) disponível
 *      para o resto da aplicação via window.VBMUsuario.dados().
 *
 * Tudo é tolerante a falha: token expirado, permissão negada, usuário
 * sem foto, sem matrícula no MDM ou campo nulo não quebram a tela — o
 * campo em questão simplesmente não é preenchido (o HTML não tem mais
 * usuário mockado: os 3 elementos nascem vazios e só ganham conteúdo
 * quando um dado real chega).
 *
 * Segurança: guarda só os campos de perfil abaixo, nunca o access token
 * (quem gerencia o token é o MSAL). sessionStorage é limpo ao fechar a
 * aba, e nada é gravado em localStorage nem enviado ao backend.
 */
(function () {
  "use strict";

  // Sufixo de versão: perfis gravados antes de o cargo existir não têm
  // o campo, e reaproveitá-los deixaria a 2ª linha do cabeçalho vazia
  // até a sessão acabar. Trocar a chave descarta o cache antigo uma vez.
  var CHAVE = "vbm-usuario-v2";
  var GRAPH = "https://graph.microsoft.com/v1.0";
  // Exatamente os campos pedidos no /me — nada além disso (menor
  // privilégio: o escopo continua sendo só User.Read).
  var CAMPOS = [
    "displayName", "givenName", "surname", "mail", "userPrincipalName",
    "jobTitle", "department", "companyName", "officeLocation",
    "mobilePhone", "businessPhones", "preferredLanguage", "id",
  ].join(",");

  var perfil = null;
  var inscritos = [];

  function lerCache() {
    try {
      var bruto = sessionStorage.getItem(CHAVE);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) {
      return null;
    }
  }

  function gravarCache(dados) {
    try { sessionStorage.setItem(CHAVE, JSON.stringify(dados)); }
    catch (e) { /* cota cheia/modo privado: segue sem cache */ }
  }

  function iniciais(nome) {
    var partes = String(nome || "").trim().split(/\s+/);
    var primeiro = partes[0] ? partes[0][0] : "";
    var ultimo = partes.length > 1 ? partes[partes.length - 1][0] : "";
    return (primeiro + ultimo).toUpperCase();
  }

  /**
   * Aplica nome + cargo + foto no bloco .topnav-user (canto superior
   * direito). Usa as classes que já existem nas 5 páginas, então não
   * depende de id novo nem de alteração de markup.
   *
   * A 2ª linha mostra o CARGO (NM_POSICAO do MDM), não a matrícula.
   * Campo vazio nunca apaga o que está na tela: sem cargo ainda
   * carregado, a linha só é tocada quando o valor chegar.
   */
  function aplicarNoTopo(dados) {
    if (!dados) return;
    try {
      var nomeEl = document.querySelector(".topnav-user-name");
      var cargoEl = document.querySelector(".topnav-user-role");
      var avatarEl = document.querySelector(".topnav-user-avatar");

      var nome = dados.displayName
        || [dados.givenName, dados.surname].filter(Boolean).join(" ")
        || dados.mail || dados.userPrincipalName;

      if (nomeEl && nome) nomeEl.textContent = nome;
      if (cargoEl && dados.cargo) cargoEl.textContent = dados.cargo;

      if (avatarEl) {
        if (dados.fotoBase64) {
          // Mesma bolinha de sempre (32px, border-radius:50%, borda
          // branca): só troca o conteúdo por imagem de fundo recortada.
          // Nenhuma regra de CSS nova — o círculo já vem do .topnav-user-avatar.
          avatarEl.textContent = "";
          avatarEl.style.backgroundImage = 'url("' + dados.fotoBase64 + '")';
          avatarEl.style.backgroundSize = "cover";
          avatarEl.style.backgroundPosition = "center";
          if (nome) avatarEl.setAttribute("title", nome);
        } else if (nome) {
          // Sem foto no Entra ID: mantém o padrão de iniciais já usado.
          avatarEl.textContent = iniciais(nome);
        }
      }
    } catch (e) {
      // Layout do cabeçalho diferente do esperado: não é motivo para
      // derrubar a página — os dados seguem disponíveis via dados().
      console.warn("[usuario] não foi possível aplicar os dados no cabeçalho.", e);
    }
  }

  function publicar(dados) {
    perfil = dados;
    aplicarNoTopo(dados);
    inscritos.forEach(function (cb) {
      try { cb(dados); } catch (e) { console.warn("[usuario] assinante falhou:", e); }
    });
    try { window.dispatchEvent(new CustomEvent("vbm:usuario", { detail: dados })); }
    catch (e) { /* navegador sem CustomEvent: assinantes acima já foram avisados */ }
  }

  /** GET no Graph com o token informado. Devolve null em qualquer falha. */
  async function graphJson(url, token) {
    try {
      var res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) return null; // 401/403/404 tratados como "sem dado"
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  /**
   * Cargo + matrícula + nome do MDM pelo e-mail, via GET /api/me?email=...
   * (o mesmo endpoint do piso Databricks, aqui só para a consulta ao
   * MDM — o Graph não tem esses campos). Falha em silêncio: sem cargo,
   * a 2ª linha do cabeçalho simplesmente não é preenchida.
   */
  async function buscarMatriculaLocal(email) {
    if (!email) return null;
    try {
      var res = await fetch("/api/me?email=" + encodeURIComponent(email), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      var dados = await res.json();
      return dados || null;
    } catch (e) {
      return null;
    }
  }

  /** Foto do usuário como data URL. null quando não há foto cadastrada. */
  async function graphFoto(token) {
    try {
      var res = await fetch(GRAPH + "/me/photo/$value", {
        headers: { Authorization: "Bearer " + token },
      });
      if (!res.ok) return null; // 404 = usuário sem foto (caso comum)
      var blob = await res.blob();
      if (!blob || !blob.size) return null;
      return await new Promise(function (resolve) {
        var leitor = new FileReader();
        leitor.onload = function () { resolve(leitor.result); };
        leitor.onerror = function () { resolve(null); };
        leitor.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }

  window.VBMUsuario = {
    /** Perfil completo do usuário logado (null se ainda não carregou). */
    dados: function () { return perfil; },

    /**
     * Assina o carregamento do perfil. Se os dados já estiverem
     * disponíveis, o callback roda na hora.
     * @param {function(Object)} cb recebe o perfil completo.
     */
    aoCarregar: function (cb) {
      if (typeof cb !== "function") return;
      if (perfil) { try { cb(perfil); } catch (e) { /* isolado */ } }
      inscritos.push(cb);
    },

    /** Reaplica os dados no cabeçalho (após re-render do topo, se houver). */
    aplicarNoTopo: function () { aplicarNoTopo(perfil); },

    /**
     * Busca o perfil no Graph com o token do login já existente.
     * Chamado pelo index.html depois que o MSAL resolve a conta.
     *
     * @param {function(): Promise<string>} obterToken devolve o access
     *        token (o index.html passa um acquireTokenSilent).
     * @returns {Promise<Object|null>} perfil, ou null se o Graph falhar.
     */
    carregarDoGraph: async function (obterToken) {
      try {
        var token = await obterToken();
        if (!token) return null;

        // /me e /me/manager em paralelo — a foto vem junto, e cada uma
        // falha de forma independente (manager e foto são opcionais).
        var resultados = await Promise.all([
          graphJson(GRAPH + "/me?$select=" + CAMPOS, token),
          graphJson(GRAPH + "/me/manager", token),
          graphFoto(token),
        ]);
        var me = resultados[0];
        var gestor = resultados[1];
        var foto = resultados[2];

        if (!me) return null; // sem o /me não há o que exibir

        // A matrícula não existe no Graph — só depois de saber o e-mail
        // real (me.mail) é que dá para buscá-la no MDM.
        var emailReal = me.mail || me.userPrincipalName || null;
        var mdm = await buscarMatriculaLocal(emailReal);

        var dados = {
          displayName: me.displayName || null,
          givenName: me.givenName || null,
          surname: me.surname || null,
          mail: me.mail || me.userPrincipalName || null,
          userPrincipalName: me.userPrincipalName || null,
          jobTitle: me.jobTitle || null,
          department: me.department || null,
          companyName: me.companyName || null,
          officeLocation: me.officeLocation || null,
          mobilePhone: me.mobilePhone || null,
          businessPhones: me.businessPhones || [],
          preferredLanguage: me.preferredLanguage || null,
          id: me.id || null,
          // Só o essencial do gestor — não replica o perfil inteiro dele.
          gestor: gestor
            ? {
                displayName: gestor.displayName || null,
                mail: gestor.mail || gestor.userPrincipalName || null,
                id: gestor.id || null,
              }
            : null,
          fotoBase64: foto,
          matricula: (mdm && mdm.matricula) || null,
          // Cargo vem do MDM, não do jobTitle do Graph: é o dado que o
          // resto da tela usa (ver a aba Aprovadores).
          cargo: (mdm && mdm.cargo) || null,
        };

        gravarCache(dados);
        publicar(dados);
        return dados;
      } catch (e) {
        // Token expirado, permissão negada, rede fora: silencioso, a
        // tela continua com o usuário padrão do HTML.
        console.warn("[usuario] não foi possível carregar o perfil do Graph.", e);
        return null;
      }
    },
  };

  /**
   * Piso de identidade, sem depender de MSAL: o Databricks Apps já
   * autenticou a pessoa e repassa e-mail/usuário ao servidor, que os
   * expõe em GET /api/me. Serve para o cabeçalho mostrar quem está
   * logado de verdade mesmo antes de o MSAL estar configurado.
   *
   * Nunca sobrepõe dados do Graph: se o perfil completo já chegou (ou
   * veio do cache da sessão), esta função não faz nada.
   */
  async function carregarDoDatabricks() {
    if (perfil) return null; // Graph já respondeu: ele manda
    try {
      // Mesma resposta que window.VBMAcesso já pede para esconder os
      // links das páginas restritas — reusa a promessa em vez de fazer
      // um segundo GET /api/me na mesma página.
      var dados = window.VBMAcesso
        ? await window.VBMAcesso.me()
        : await fetch("/api/me", { headers: { Accept: "application/json" } })
            .then(function (res) { return res.ok ? res.json() : null; });
      if (!dados || !dados.autenticado) return null;

      // Só os campos que o proxy realmente conhece. O resto continua
      // null até o Graph responder — nada é inventado aqui.
      var parcial = {
        displayName: dados.nome || null,
        givenName: null, surname: null,
        mail: dados.email || null,
        userPrincipalName: dados.usuario || dados.email || null,
        jobTitle: null, department: null, companyName: null,
        officeLocation: null, mobilePhone: null, businessPhones: [],
        preferredLanguage: null,
        id: dados.idUsuario || null,
        gestor: null,
        fotoBase64: null,
        matricula: dados.matricula || null,
        cargo: dados.cargo || null,
        // Marca a procedência: quem consumir dados() sabe que este
        // perfil é o parcial do proxy, não o completo do Graph.
        origem: "databricks",
      };
      if (perfil) return null; // o Graph pode ter respondido nesse meio-tempo
      publicar(parcial);
      return parcial;
    } catch (e) {
      return null; // sem /api/me (front servido fora do Databricks): silencioso
    }
  }

  // Nas telas sem MSAL (admin, biblioteca, aprovação, kaizen-novo), o
  // perfil vem do que o index.html já buscou nesta mesma aba. Sem cache
  // (acesso direto à URL, aba nova), cai no /api/me do Databricks e, se
  // nem isso existir, o cabeçalho segue com o conteúdo padrão do HTML.
  function iniciar() {
    var doCache = lerCache();
    if (doCache) {
      perfil = doCache;
      aplicarNoTopo(perfil);
      return;
    }
    carregarDoDatabricks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
