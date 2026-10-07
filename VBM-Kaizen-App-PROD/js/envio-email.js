/**
 * VBM Kaizen — envio dos comunicados do Kaizen pelo Microsoft Graph.
 *
 * Cobre o cadastro (equipe + aprovador) e as três decisões.
 *
 * Quem envia é o NAVEGADOR, com o token delegado de quem está logado:
 * é o perfil dele que autentica, e a mensagem sai pela caixa
 * compartilhada PCI.Base.Metals@Vale.com (ele precisa ter "Enviar Como"
 * nessa caixa). Não há client secret nem identidade de aplicação em
 * nenhum ponto — ver js/msal-config.js.
 *
 * O CONTEÚDO NÃO É MONTADO AQUI. O servidor devolve os comunicados
 * prontos (destinatários, assunto e corpo) na resposta, gerados a
 * partir da linha já gravada no banco (email-kaizen.js). Esta camada só
 * entrega ao Graph e informa o resultado de volta, para o log ficar no
 * servidor como o dos demais fluxos.
 */
(function () {
  'use strict';

  var GRAPH = 'https://graph.microsoft.com/v1.0';
  var ESCOPOS = ['Mail.Send.Shared'];
  var enviados = {};   // chave da decisão -> true; evita disparo repetido

  function destinatarios(para) {
    return Array.isArray(para) ? para : [para];
  }

  function avisarServidor(idKaizen, chave, ok, motivo) {
    // Falha aqui não afeta nada na tela: é só o registro do envio.
    fetch('/api/kaizens/' + encodeURIComponent(idKaizen) + '/aviso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: chave, enviado: !!ok, motivo: motivo || null })
    }).catch(function () { /* silencioso de propósito */ });
  }

  /** Token do Graph para o usuário logado. Silencioso quando já há
   *  sessão; cai no popup quando o consentimento ainda não foi dado —
   *  o clique na decisão é o gesto do usuário que o navegador exige. */
  function obterToken(app) {
    var conta = app.getActiveAccount() || app.getAllAccounts()[0];
    var pedido = { scopes: ESCOPOS, account: conta || undefined };
    return app.acquireTokenSilent(pedido)
      .catch(function () { return app.acquireTokenPopup({ scopes: ESCOPOS }); })
      .then(function (r) { return r.accessToken; });
  }

  /**
   * @param {object} aviso  { chave, de, para, assunto, html } vindo da
   *                        resposta da decisão. `erro` no lugar disso
   *                        significa que não há a quem enviar.
   * @param {number} idKaizen
   */
  function enviar(aviso, idKaizen) {
    if (!aviso || aviso.erro) {
      if (aviso && aviso.erro) avisarServidor(idKaizen, null, false, aviso.erro);
      return Promise.resolve({ enviado: false, motivo: (aviso && aviso.erro) || 'sem aviso' });
    }
    if (enviados[aviso.chave]) {
      return Promise.resolve({ enviado: false, motivo: 'já enviado' });
    }
    if (!window.VBMMsal || !window.VBMMsal.estaConfigurado()) {
      avisarServidor(idKaizen, aviso.chave, false, 'MSAL não configurado (js/msal-config.js)');
      return Promise.resolve({ enviado: false, motivo: 'MSAL não configurado' });
    }

    // Marca antes de enviar: um segundo clique enquanto o primeiro está
    // em voo não pode virar um segundo e-mail.
    enviados[aviso.chave] = true;

    return window.VBMMsal.obterInstancia()
      .then(obterToken)
      .then(function (token) {
        // Com "de" preenchido, a mensagem sai pela caixa COMPARTILHADA —
        // e quem envia precisa ter "Enviar Como" nela. Sem "de", sai
        // pela caixa da PRÓPRIA pessoa logada (/me), que não depende de
        // liberação nenhuma no Exchange. Quem decide é o servidor, pela
        // variável KAIZEN_EMAIL_DO_USUARIO — ver email-kaizen.js.
        var destino = aviso.de
          ? '/users/' + encodeURIComponent(aviso.de) + '/sendMail'
          : '/me/sendMail';
        return fetch(GRAPH + destino, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              subject: aviso.assunto,
              body: { contentType: 'HTML', content: aviso.html },
              // `para` é lista: o dono do Kaizen e os participantes da
              // equipe recebem o MESMO comunicado, num envio só.
              toRecipients: destinatarios(aviso.para).map(function (e) {
                return { emailAddress: { address: e } };
              })
            },
            saveToSentItems: true
          })
        });
      })
      .then(function (r) {
        if (!r.ok) {
          return r.text().catch(function () { return ''; }).then(function (t) {
            throw new Error('Graph HTTP ' + r.status + ': ' + String(t).slice(0, 200));
          });
        }
        avisarServidor(idKaizen, aviso.chave, true, null);
        return { enviado: true };
      })
      .catch(function (err) {
        // Solta a chave: a decisão já valeu, e o aviso pode ser
        // reenviado numa próxima tentativa em vez de ficar travado.
        delete enviados[aviso.chave];
        avisarServidor(idKaizen, aviso.chave, false, err.message);
        return { enviado: false, motivo: err.message };
      });
  }

  /** Envia a lista de comunicados que veio na resposta (cadastro manda
   *  dois: equipe e aprovador; decisão manda um). Em sequência, não em
   *  paralelo: o token é o mesmo e o primeiro envio já o deixa em cache. */
  function enviarTodos(avisos, idKaizen) {
    var lista = Array.isArray(avisos) ? avisos : (avisos ? [avisos] : []);
    return lista.reduce(function (fila, aviso) {
      return fila.then(function (acc) {
        return enviar(aviso, idKaizen).then(function (r) { return acc.concat([r]); });
      });
    }, Promise.resolve([]));
  }

  /** Mostra na TELA o motivo de um comunicado não ter saído.
   *
   *  Até aqui a falha ia só para o log do servidor (POST .../aviso) e
   *  quem estava usando o sistema não via nada: o Kaizen era gravado, a
   *  tela trocava e o e-mail simplesmente não chegava. Sem esse aviso,
   *  descobrir a causa exigia acesso ao log do app — que quem usa o
   *  sistema não tem.
   *
   *  Não é erro de gravação, e por isso é um toast de ATENÇÃO: o Kaizen
   *  (ou a decisão) já está salvo. O texto traz o motivo cru vindo do
   *  Graph ou da MSAL, porque é ele que diz o que fazer — falta de
   *  consentimento, falta de "Enviar Como", CDN bloqueado. */
  function avisarNaTela(resultados) {
    if (typeof showToast !== 'function') return resultados;
    var falhas = (resultados || []).filter(function (r) {
      return r && r.enviado === false && r.motivo
        && r.motivo !== 'já enviado' && r.motivo !== 'sem aviso';
    });
    if (!falhas.length) return resultados;
    var motivo = falhas[0].motivo;
    var titulo = (window.__i18n && window.__i18n['email.failTitle']) || 'E-mail não enviado';
    var texto = (window.__i18n && window.__i18n['email.failMsg'])
      || 'O registro foi salvo normalmente, mas o comunicado não saiu.';
    showToast('warning', titulo, texto + ' Motivo: ' + motivo, 12000);
    return resultados;
  }

  window.VBMEmail = { enviar: enviar, enviarTodos: function (avisos, idKaizen) {
    // Rastro no console do navegador (F12). O log do servidor já
    // registra cada envio, mas quem usa o sistema não tem acesso a ele —
    // e é sempre a primeira pergunta quando "o e-mail não chegou":
    // quantos comunicados vieram e o que aconteceu com cada um.
    var lista = Array.isArray(avisos) ? avisos : (avisos ? [avisos] : []);
    console.info('[VBMEmail] comunicados recebidos do servidor:', lista.length, lista);
    if (!lista.length) {
      console.warn('[VBMEmail] o servidor não devolveu comunicado nenhum — nada a enviar.');
    }
    return enviarTodos(avisos, idKaizen).then(function (resultados) {
      console.info('[VBMEmail] resultado do envio:', resultados);
      return avisarNaTela(resultados);
    });
  } };
})();
