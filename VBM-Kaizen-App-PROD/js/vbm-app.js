/* ═══════════════════════════════════════════════════════
   VBM KAIZEN — Application JS
   Vale Base Metals Design System v1.0
═══════════════════════════════════════════════════════ */

(function() {
  'use strict';

  /* ── Sidebar Toggle ── */
  function initSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('appSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!toggle || !sidebar) return;

    toggle.addEventListener('click', function() {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('show');
    });
    if (overlay) {
      overlay.addEventListener('click', function() {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
      });
    }
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
      }
    });
  }

  /* ── Active Nav Link ── */
  function initActiveNav() {
    const links = document.querySelectorAll('.sidebar-link');
    const current = window.location.pathname.split('/').pop() || 'index.html';
    links.forEach(function(link) {
      const href = link.getAttribute('href');
      if (href && (href === current || href.includes(current.split('.')[0]))) {
        link.classList.add('active');
      }
    });
  }

  /* ── Animated Stats Counter ── */
  function animateCounter(el) {
    const target = parseFloat(el.dataset.target || el.textContent) || 0;
    const duration = 1400;
    const start = performance.now();
    const isDecimal = String(target).includes('.');

    function update(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;
      el.textContent = isDecimal ? current.toFixed(1) : Math.round(current).toLocaleString('pt-BR');
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  function initCounters() {
    const els = document.querySelectorAll('[data-counter]');
    if (!els.length) return;
    const obs = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) {
          animateCounter(e.target);
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.5 });
    els.forEach(function(el) { obs.observe(el); });
  }

  /* ── Reveal on Scroll ── */
  function initReveal() {
    const els = document.querySelectorAll('.reveal, .reveal-left, .reveal-scale');
    if (!els.length) return;
    const obs = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) {
          // stagger siblings
          const siblings = e.target.parentElement ? e.target.parentElement.querySelectorAll('.reveal, .reveal-left, .reveal-scale') : [];
          let delay = 0;
          siblings.forEach(function(s, i) { if (s === e.target) delay = i * 60; });
          setTimeout(function() { e.target.classList.add('visible'); }, delay);
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    els.forEach(function(el) { obs.observe(el); });
  }

  /* ── Modals ── */
  function initModals() {
    // Open triggers
    document.querySelectorAll('[data-modal-open]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const id = btn.dataset.modalOpen;
        openModal(id);
      });
    });
    // Close triggers
    document.querySelectorAll('[data-modal-close], .modal-close').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const backdrop = btn.closest('.modal-backdrop');
        if (backdrop) closeModal(backdrop.id);
      });
    });
    // Click outside
    document.querySelectorAll('.modal-backdrop').forEach(function(bd) {
      bd.addEventListener('click', function(e) {
        if (e.target === bd) closeModal(bd.id);
      });
    });
    // Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(function(m) {
          closeModal(m.id);
        });
      }
    });
  }

  window.openModal = function(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('open');
      document.body.style.overflow = 'hidden';
      // O conteúdo do modal pode ter sido montado agora por script:
      // rotula o que entrou depois da passagem inicial.
      if (window.VBMRotulos) window.VBMRotulos(el);
    }
  };
  window.closeModal = function(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
  };

  /* ── Tabs ── */
  function initTabs() {
    document.querySelectorAll('[data-tab-group]').forEach(function(group) {
      const tabs = group.querySelectorAll('.app-tab');
      const panels = group.querySelectorAll('.tab-content');
      tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
          const target = tab.dataset.tab;
          tabs.forEach(function(t) { t.classList.remove('active'); });
          panels.forEach(function(p) { p.classList.remove('active'); });
          tab.classList.add('active');
          const panel = group.querySelector('[data-tab-panel="' + target + '"]');
          if (panel) panel.classList.add('active');
        });
      });
    });
  }

  /* ── Wizard / Multi-step ── */
  function initWizard() {
    const wizards = document.querySelectorAll('[data-wizard]');
    wizards.forEach(function(wizard) {
      let currentStep = 0;
      const steps = wizard.querySelectorAll('.wizard-step-item');
      const panels = wizard.querySelectorAll('.wizard-panel');
      const prevBtns = wizard.querySelectorAll('[data-wizard-prev]');
      const nextBtns = wizard.querySelectorAll('[data-wizard-next]');
      const submitBtn = wizard.querySelector('[data-wizard-submit]');
      const progressBar = wizard.querySelector('.wizard-progress-fill');

      function goTo(n) {
        if (n < 0 || n >= panels.length) return;
        panels[currentStep].classList.remove('active');
        steps[currentStep].classList.remove('active');
        if (n > currentStep) steps[currentStep].classList.add('completed');
        else steps[n].classList.remove('completed');
        currentStep = n;
        panels[currentStep].classList.add('active');
        steps[currentStep].classList.add('active');
        updateProgress();
        wizard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      function updateProgress() {
        if (progressBar) {
          const pct = ((currentStep) / (panels.length - 1)) * 100;
          progressBar.style.width = pct + '%';
        }
        // Show/hide prev/next/submit
        prevBtns.forEach(function(b) { b.style.display = currentStep === 0 ? 'none' : ''; });
        if (submitBtn) submitBtn.style.display = currentStep === panels.length - 1 ? '' : 'none';
        nextBtns.forEach(function(b) { b.style.display = currentStep === panels.length - 1 ? 'none' : ''; });
      }

      prevBtns.forEach(function(b) {
        b.addEventListener('click', function() { goTo(currentStep - 1); });
      });
      nextBtns.forEach(function(b) {
        b.addEventListener('click', function() { goTo(currentStep + 1); });
      });
      // data-wizard-custom-submit: a própria página trata o clique (ver
      // kaizen-novo.html) — precisa validar e mandar pro servidor de
      // verdade antes de comemorar. Sem esse atributo, mantém o mock
      // de sempre (toast + redirect), pra não quebrar nenhum outro
      // wizard que só queira o comportamento visual.
      if (submitBtn && !wizard.hasAttribute('data-wizard-custom-submit')) {
        submitBtn.addEventListener('click', function(e) {
          e.preventDefault();
          showToast('success', 'Kaizen Salvo!', 'Seu Kaizen foi enviado para aprovação com sucesso.');
          setTimeout(function() { window.location.href = 'meus-projetos.html'; }, 1800);
        });
      }

      // Step click navigation
      steps.forEach(function(step, i) {
        step.addEventListener('click', function() {
          if (i < currentStep || steps[i].classList.contains('completed')) goTo(i);
        });
      });

      goTo(0);
    });
  }

  /* ── PNR28 Type Selector ── */
  function initPNR() {
    document.querySelectorAll('.pnr-item').forEach(function(item) {
      item.addEventListener('click', function() {
        const group = item.closest('.pnr-grid');
        if (group) group.querySelectorAll('.pnr-item').forEach(function(i) { i.classList.remove('selected'); });
        item.classList.add('selected');
        const input = item.closest('[data-pnr-group]');
        if (input) {
          const hidden = input.querySelector('input[type=hidden]');
          if (hidden) hidden.value = item.dataset.value || item.querySelector('.pnr-label').textContent;
        }
      });
    });
  }

  /* ── Photo Preview ── */
  function initPhotoUpload() {
    document.querySelectorAll('.photo-upload-zone').forEach(function(zone) {
      const input = zone.querySelector('input[type=file]');
      // A pré-visualização era SEMPRE a irmã seguinte da zona. Deixou de
      // ser: no Novo Kaizen a <img> passou a morar dentro do palco
      // (.foto-palco), que envolve imagem, ações e legenda. Procurar no
      // grupo do campo cobre os dois arranjos — o antigo, em que a irmã
      // seguinte é a própria imagem, e o novo.
      const grupo = zone.closest('.form-group') || zone.parentElement;
      const preview = (grupo && grupo.querySelector('.photo-preview-img')) || zone.nextElementSibling;
      if (!input) return;
      input.addEventListener('change', function() {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
          if (preview && preview.classList.contains('photo-preview-img')) {
            preview.src = e.target.result;
            preview.style.display = 'block';
            zone.style.display = 'none';
          }
        };
        reader.readAsDataURL(file);
      });
    });
  }

  /* ── Filter / Search ── */
  function initFilters() {
    const filterInputs = document.querySelectorAll('[data-filter-input]');
    filterInputs.forEach(function(input) {
      const targetId = input.dataset.filterInput;
      const target = document.getElementById(targetId);
      if (!target) return;
      input.addEventListener('input', function() {
        const q = input.value.toLowerCase().trim();
        target.querySelectorAll('[data-filter-item]').forEach(function(item) {
          const text = item.textContent.toLowerCase();
          item.style.display = q && !text.includes(q) ? 'none' : '';
        });
      });
    });

    const filterSelects = document.querySelectorAll('[data-filter-select]');
    filterSelects.forEach(function(sel) {
      const targetId = sel.dataset.filterSelect;
      const field = sel.dataset.filterField || 'status';
      const target = document.getElementById(targetId);
      if (!target) return;
      sel.addEventListener('change', function() {
        const val = sel.value;
        target.querySelectorAll('[data-filter-item]').forEach(function(item) {
          if (!val) { item.style.display = ''; return; }
          item.style.display = item.dataset[field] === val ? '' : 'none';
        });
      });
    });
  }

  /* ── View Toggle (grid/list) ── */
  function initViewToggle() {
    document.querySelectorAll('[data-view-toggle]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const group = btn.dataset.viewToggle;
        const view = btn.dataset.view;
        document.querySelectorAll('[data-view-toggle="' + group + '"]').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('[data-view="' + group + '"]').forEach(function(el) {
          el.style.display = el.dataset.viewMode === view ? '' : 'none';
        });
      });
    });
  }

  /* ── Toggle Switch ── */
  function initToggles() {
    document.querySelectorAll('.toggle').forEach(function(toggle) {
      toggle.addEventListener('click', function() {
        toggle.classList.toggle('on');
      });
    });
  }

  /* ── Avisos (window.showToast) ──
     O aviso sai como um cartão centralizado sobre overlay, no mesmo
     desenho do modal de validação do Novo Kaizen e do
     window.confirmarAcao — os três dividem .confirm-backdrop/.modal e
     o ritmo definido em vbm-app.css. Antes era um toast no canto
     inferior direito.

     A APRESENTAÇÃO é o que mudou. A assinatura, os tipos, as cores por
     tipo, os textos e a temporização (4 s) são os de sempre, então as
     44 chamadas espalhadas pelo sistema continuam valendo como estão.

     Só um cartão por vez: um aviso novo reaproveita o que está aberto,
     troca o conteúdo e reinicia o relógio. O toast antigo empilhava,
     mas na prática as chamadas são uma por ação do usuário.

     Fecha pelo "X", pelo clique fora e sozinho ao fim do tempo. O
     clique fora existe porque o overlay cobre a tela: sem ele a página
     ficaria intocável durante o aviso, e o toast que este cartão
     substitui nunca barrou um clique. */
  const AVISO_ICONES = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  // [--hue do badge, cor do glifo] — as mesmas cores por tipo de antes.
  const AVISO_CORES = {
    success: ['22,163,74', '#16a34a'], error: ['220,38,38', '#dc2626'],
    warning: ['194,119,14', '#c2770e'], info: ['60,181,229', '#3cb5e5'],
  };
  let avisoEl = null;
  let avisoTimer = null;

  function avisoModal() {
    if (avisoEl) return avisoEl;
    const el = document.createElement('div');
    el.className = 'confirm-backdrop';
    el.id = 'avisoApp';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'avisoAppTitulo');
    el.innerHTML =
      '<div class="modal">' +
        '<div class="modal-head">' +
          '<div class="modal-icon" data-role="icone"><i class="fa-solid"></i></div>' +
          '<div class="modal-title" id="avisoAppTitulo" data-role="titulo"></div>' +
          '<button class="modal-close" type="button" data-role="fechar" aria-label="Fechar">' +
            '<i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="aviso-conteudo"><p data-role="mensagem"></p></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('[data-role="fechar"]').addEventListener('click', fecharAviso);
    el.addEventListener('click', function (e) { if (e.target === el) fecharAviso(); });
    avisoEl = el;
    return el;
  }

  function fecharAviso() {
    if (!avisoEl || !avisoEl.classList.contains('open')) return;
    clearTimeout(avisoTimer);
    avisoEl.classList.add('closing');
    let fechado = false;
    function finalizar() {
      if (fechado) return;
      fechado = true;
      avisoEl.classList.remove('open', 'closing');
    }
    avisoEl.addEventListener('animationend', finalizar, { once: true });
    setTimeout(finalizar, 300); // salvaguarda se a animação não disparar
  }

  window.showToast = function(type, title, msg, duration) {
    duration = duration || 4000;
    let el = null;
    try { el = avisoModal(); } catch (e) { el = null; }
    // Sem o cartão a mensagem ainda aparece — nunca em silêncio.
    if (!el) return toastNoCanto(type, title, msg, duration);

    const cor = AVISO_CORES[type] || AVISO_CORES.info;
    const badge = el.querySelector('[data-role="icone"]');
    const glifo = badge.querySelector('i');
    // Mesma convenção dos outros modais: --hue dirige o tom translúcido
    // no modo escuro; o modo claro fica explícito aqui.
    badge.style.setProperty('--hue', cor[0]);
    badge.style.background = 'rgba(' + cor[0] + ',.12)';
    badge.style.borderColor = 'rgba(' + cor[0] + ',.28)';
    glifo.className = 'fa-solid ' + (AVISO_ICONES[type] || AVISO_ICONES.info);
    glifo.style.color = cor[1];
    el.querySelector('[data-role="titulo"]').textContent = title == null ? '' : title;
    el.querySelector('[data-role="mensagem"]').textContent = msg == null ? '' : msg;
    clearTimeout(avisoTimer);
    el.classList.remove('closing');
    el.classList.add('open');
    const x = el.querySelector('[data-role="fechar"]');
    if (x && x.focus) x.focus();
    avisoTimer = setTimeout(fecharAviso, duration);
  };

  /* Rede de segurança: o toast no canto, como era antes. Só roda se o
     cartão não puder ser criado. */
  function toastNoCanto(type, title, msg, duration) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const colors = { success: '#16a34a', error: '#dc2626', warning: '#c2770e', info: '#3cb5e5' };
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML = '<i class="fa-solid ' + (icons[type] || 'fa-circle-info') + ' toast-icon" style="color:' + (colors[type] || '#3cb5e5') + '"></i><div class="toast-body"><div class="toast-title">' + title + '</div><div class="toast-msg">' + msg + '</div></div><button type="button" class="toast-close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>';
    container.appendChild(toast);

    let fechado = false;
    function fechar() {
      if (fechado || !toast.parentElement) return;
      fechado = true;
      toast.classList.add('closing');
      toast.addEventListener('animationend', function () { toast.remove(); }, { once: true });
      setTimeout(function () { toast.remove(); }, 400); // salvaguarda se a animação não disparar
    }
    toast.querySelector('.toast-close').addEventListener('click', fechar);
    setTimeout(fechar, duration);
  }

  /* ── Confirmação de ação (window.confirmarAcao) ──
     Substitui o window.confirm() nativo nas ações de ativar/desativar
     por um modal do próprio Design System — mesmas classes dos modais
     de Add/Edit (.modal/.modal-head/.modal-icon/.modal-body/.modal-foot),
     só numa camada própria (.confirm-backdrop, ver vbm-app.css) pra não
     cair nos listeners genéricos de .modal-backdrop em initModals()
     (Escape/clique-fora), que assumem modais fixos no HTML — este é
     criado em runtime e precisa resolver uma Promise ao fechar.

     Uso: const ok = await confirmarAcao({ variant, titulo, mensagem });
     variant: 'ativar' (azul) | 'desativar' (vermelho suave).
     Resolve true se confirmado, false se cancelado (botão, clique fora,
     Esc ou X) — mesmo contrato de retorno booleano do confirm() nativo
     que substitui, então os call sites só trocam o gatilho, não o fluxo. */
  let confirmAcaoEl = null;
  function confirmAcaoModal() {
    if (confirmAcaoEl) return confirmAcaoEl;
    const el = document.createElement('div');
    el.className = 'confirm-backdrop';
    el.innerHTML =
      '<div class="modal">' +
        '<div class="modal-head">' +
          '<div class="modal-icon" data-role="icon"><i class="fa-solid"></i></div>' +
          '<div class="modal-title" data-role="title"></div>' +
        '</div>' +
        '<div class="modal-body"><p class="confirm-msg" data-role="msg"></p></div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn btn-ghost" data-role="cancelar">Cancelar</button>' +
          '<button type="button" class="btn" data-role="confirmar"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    confirmAcaoEl = el;
    return el;
  }

  window.confirmarAcao = function (opcoes) {
    opcoes = opcoes || {};
    const perigoso = opcoes.variant === 'desativar';
    const el = confirmAcaoModal();
    const icone = el.querySelector('[data-role="icon"]');
    const iconeI = icone.querySelector('i');
    const titulo = el.querySelector('[data-role="title"]');
    const msg = el.querySelector('[data-role="msg"]');
    const btnOk = el.querySelector('[data-role="confirmar"]');
    const btnCancelar = el.querySelector('[data-role="cancelar"]');

    titulo.textContent = opcoes.titulo || 'Confirmar ação?';
    msg.textContent = opcoes.mensagem || '';
    msg.style.display = opcoes.mensagem ? '' : 'none';
    // Sem mensagem o corpo fica vazio e o padding dele viraria um vão
    // solto entre o título e os botões.
    msg.parentElement.classList.toggle('is-vazio', !opcoes.mensagem);
    iconeI.className = 'fa-solid ' + (perigoso ? 'fa-triangle-exclamation' : 'fa-circle-check');
    btnOk.textContent = opcoes.confirmarLabel || (perigoso ? 'Desativar' : 'Confirmar');
    btnOk.className = 'btn ' + (perigoso ? 'btn-danger' : 'btn-primary');

    // Mesma convenção visual dos ícones de cabeçalho dos outros modais
    // (--hue dirige o tom translúcido no modo escuro; o modo claro fica
    // explícito aqui mesmo, já que cada instância tem sua própria cor).
    icone.style.setProperty('--hue', perigoso ? '220,38,38' : '60,181,229');
    icone.style.background = perigoso ? '#fef2f2' : '#e8f3fb';
    icone.style.borderColor = perigoso ? 'rgba(220,38,38,.28)' : 'rgba(60,181,229,.28)';
    iconeI.style.color = perigoso ? '#dc2626' : 'var(--vbm-blue)';

    return new Promise(function (resolve) {
      function fechar(resultado) {
        document.removeEventListener('keydown', onKey);
        el.removeEventListener('click', onBackdrop);
        btnOk.removeEventListener('click', onOk);
        btnCancelar.removeEventListener('click', onCancel);

        el.classList.add('closing');
        let fechado = false;
        function finalizar() {
          if (fechado) return;
          fechado = true;
          el.classList.remove('open', 'closing');
          document.body.style.overflow = '';
        }
        el.addEventListener('animationend', finalizar, { once: true });
        setTimeout(finalizar, 300); // salvaguarda se a animação não disparar
        resolve(resultado);
      }
      function onOk() { fechar(true); }
      function onCancel() { fechar(false); }
      function onKey(e) { if (e.key === 'Escape') onCancel(); }
      function onBackdrop(e) { if (e.target === el) onCancel(); }

      btnOk.addEventListener('click', onOk);
      btnCancelar.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
      el.addEventListener('click', onBackdrop);

      el.classList.remove('closing');
      el.classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  };

  /* ── Loading (window.VBMLoading) ──
     Padrão único reutilizável, nas três formas descritas em
     vbm-app.css (.vbm-spinner / .vbm-loading-overlay /
     .vbm-loading-fullpage). Antes cada tela tinha o próprio jeito de
     indicar carregamento — texto "Carregando…" solto na Biblioteca,
     swap manual de innerHTML no botão de enviar do Novo Kaizen, nada
     nos demais lugares. Aqui thread para o sistema inteiro usar igual.

     botao(el, true/false, opts): trava contra duplo clique — desabilita
     o elemento e troca o conteúdo por um spinner, sem mudar a largura;
     restaura o HTML de antes ao desligar. Chamável em qualquer botão
     (<button> ou <a class="btn">), então cabe em Salvar, Aprovar,
     Rejeitar, Exportar — qualquer ação que não pode rodar duas vezes ao
     mesmo tempo.

     overlay(container, true/false, opts): cobre o CONTAINER passado
     (precisa de position:relative ou position:absolute — se não tiver,
     esta função aplica position:relative nele) com o spinner
     centralizado; o conteúdo anterior continua por baixo, sem sumir
     nem saltar de tamanho. Serve para listas, cards e corpo de modal.
     opts.texto: legenda abaixo do spinner (ex.: "Carregando…").

     fullpage(true/false): cobre a janela inteira — troca de tela. Um
     elemento só, reaproveitado. */
  window.VBMLoading = (function () {
    const BOTAO_KEY = 'vbmHtmlOriginal';

    function botao(el, ligar, opts) {
      if (!el) return;
      opts = opts || {};
      if (ligar) {
        if (el.dataset[BOTAO_KEY] == null) el.dataset[BOTAO_KEY] = el.innerHTML;
        el.disabled = true;
        el.classList.add('vbm-btn-loading');
        el.setAttribute('aria-busy', 'true');
        el.innerHTML = '<span class="vbm-spinner" aria-hidden="true"></span>' +
          (opts.texto ? '<span>' + opts.texto + '</span>' : '');
      } else {
        el.disabled = false;
        el.classList.remove('vbm-btn-loading');
        el.removeAttribute('aria-busy');
        if (el.dataset[BOTAO_KEY] != null) {
          el.innerHTML = el.dataset[BOTAO_KEY];
          delete el.dataset[BOTAO_KEY];
        }
      }
    }

    function overlay(container, ligar, opts) {
      if (!container) return;
      opts = opts || {};
      let el = container.querySelector(':scope > .vbm-loading-overlay');
      if (ligar) {
        const posicao = getComputedStyle(container).position;
        if (posicao === 'static') container.style.position = 'relative';
        if (!el) {
          el = document.createElement('div');
          el.className = 'vbm-loading-overlay';
          el.innerHTML = '<span class="vbm-spinner" aria-hidden="true"></span>' +
            (opts.texto ? '<span class="vbm-loading-texto"></span>' : '');
          container.appendChild(el);
        }
        const texto = el.querySelector('.vbm-loading-texto');
        if (texto) texto.textContent = opts.texto || '';
        el.setAttribute('aria-busy', 'true');
      } else if (el) {
        el.remove();
      }
    }

    let fullpageEl = null;
    function fullpage(ligar) {
      if (ligar) {
        if (!fullpageEl) {
          fullpageEl = document.createElement('div');
          fullpageEl.className = 'vbm-loading-fullpage';
          fullpageEl.innerHTML = '<span class="vbm-spinner vbm-spinner-lg" aria-hidden="true"></span>';
          document.body.appendChild(fullpageEl);
        }
        fullpageEl.classList.add('open');
      } else if (fullpageEl) {
        fullpageEl.classList.remove('open');
      }
    }

    return { botao: botao, overlay: overlay, fullpage: fullpage };
  })();

  /* CSS do relatório — vive aqui, e não no vbm-app.css, porque a janela
     de impressão é um documento separado: puxar a folha do app traria
     centenas de regras de tela para um papel.

     O desenho é o MESMO do modal "Visualizar" da Biblioteca
     (.kaizen-detail-head / .kd-section / .kd-photo-box em vbm-app.css):
     faixa escura com a identificação do Kaizen, cartões brancos de canto
     arredondado com cabeçalho cinza-claro e pastilha de ícone azul. Quem
     imprime reconhece na folha a tela que acabou de ver. As medidas não
     são copiadas dali: lá elas estão em `rem` sobre o corpo do app, aqui
     em `em` sobre um único tamanho-base, então trocar o corpo do texto
     reacomoda a página inteira — 15px na tela, 9.4pt no papel. */
  var PK_CSS = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    ':root{--az:#3cb5e5;--az-esc:#1a8bbf;--prof:#0d2640;--navy:#041523;--pale:#e8f7fd;' +
      '--tinta:#1a1a1a;--texto:#333;--cinza:#888;--linha:#eaeaea;--linha-fina:#f0f0f0;' +
      '--fundo-cab:#fafafa;--off:#f6f6f6;--verde:#16a34a;' +
      "--tit:'Poppins','Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
    'body{background:#e9edf1;font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--texto);' +
      '-webkit-print-color-adjust:exact;print-color-adjust:exact}',

    /* ── folha ── */
    '.folha{font-size:15px;line-height:1.45;background:#fff;width:min(96vw,1180px);margin:22px auto;' +
      'padding:26px 30px 20px;box-shadow:0 10px 40px rgba(13,38,64,.18);border-radius:6px;display:flex;' +
      'flex-direction:column;gap:1em}',

    /* ── faixa de identificação: o .kaizen-detail-head do modal ──
       Inclusive a trama de linhas do ::before, que é o que dá o
       acabamento à faixa em vez de um bloco de cor chapado. */
    '.cab{background:linear-gradient(135deg,var(--navy),#082d4f);border-radius:.75em;padding:1.4em 1.5em;' +
      'position:relative;overflow:hidden;color:#fff}',
    '.cab::before{content:"";position:absolute;inset:0;' +
      'background-image:linear-gradient(rgba(60,181,229,.04) 1px,transparent 1px),' +
      'linear-gradient(90deg,rgba(60,181,229,.04) 1px,transparent 1px);background-size:25px 25px}',
    '.cab>*{position:relative;z-index:1}',
    '.cab-topo{display:flex;align-items:flex-start;justify-content:space-between;gap:1em}',
    '.cab-id{font-size:.66em;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.62);' +
      'font-weight:600}',
    '.cab-status{flex:none;border:1px solid var(--az);color:var(--az);border-radius:2em;padding:.2em .9em;' +
      'font-size:.6em;font-weight:700;text-transform:uppercase;letter-spacing:.12em;white-space:nowrap}',
    '.cab h1{font-family:var(--tit);font-weight:700;font-size:1.5em;line-height:1.25;color:#fff;' +
      'margin:.45em 0 .6em}',
    /* Texto claro sobre fundo escuro fica mais fino do que o mesmo texto
       sobre branco — no papel, mais ainda. Por isso a linha de metas não
       repete os 55%/80% de opacidade do modal: corpo com mais contraste
       e um pouco maior, rótulo em branco cheio. */
    '.cab-metas{display:flex;flex-wrap:wrap;gap:.45em 1.4em}',
    // Sem nenhum item, a faixa não deve virar um espaço em branco.
    '.cab-metas:empty{display:none}',
    '.cab-metas+.cab-metas{margin-top:.5em}',
    '.cab-meta{font-size:.78em;color:rgba(255,255,255,.86);display:flex;align-items:center;gap:.35em;' +
      'font-weight:500}',
    '.cab-meta i{color:var(--az)}',
    '.cab-meta strong{color:#fff;font-weight:600}',

    /* ── cartões: o .kd-section do modal ── */
    '.duas{display:grid;grid-template-columns:1fr 1fr;gap:1em}',
    '.sec{background:#fff;border:1px solid var(--linha);border-radius:.75em;overflow:hidden;' +
      'break-inside:avoid;page-break-inside:avoid}',
    '.sec-cab{display:flex;align-items:center;gap:.5em;padding:.7em 1.1em;background:var(--fundo-cab);' +
      'border-bottom:1px solid var(--linha-fina)}',
    '.sec-ico{width:1.85em;height:1.85em;flex:none;border-radius:.35em;background:var(--pale);color:var(--az);' +
      'display:flex;align-items:center;justify-content:center;font-size:.75em}',
    '.sec-tit{font-family:var(--tit);font-weight:600;font-size:.88em;color:var(--tinta)}',
    // pre-line preserva os parágrafos digitados nos textos longos; as
    // grades dentro do corpo voltam ao normal para que a quebra de linha
    // do HTML não vire espaço visível entre os cartões.
    '.sec-corpo{padding:1em 1.2em;font-size:.86em;line-height:1.65;white-space:pre-line}',
    '.sec-corpo strong{color:var(--tinta)}',
    '.sec-corpo>.fotos,.sec-corpo>.res-grade{white-space:normal}',

    /* ── evidências: o .kd-photo-box do modal, com a foto inteira
       (contain sobre fundo neutro) em vez de cortada ── */
    '.fotos{display:grid;grid-template-columns:1fr 1fr;gap:1.4em}',
    '.foto{border:1px solid var(--linha);border-radius:.5em;overflow:hidden;' +
      'break-inside:avoid;page-break-inside:avoid}',
    '.foto-img{height:17em;background:#f4f6f8;display:flex;align-items:center;justify-content:center;overflow:hidden}',
    '.foto-img img{width:100%;height:100%;object-fit:contain}',
    '.foto-vazia{font-size:.78em;color:var(--cinza);text-align:center;padding:1em}',
    '.foto-corpo{padding:.7em .85em}',
    '.foto-rot{font-size:.66em;text-transform:uppercase;letter-spacing:.15em;color:var(--cinza);' +
      'margin-bottom:.3em;font-weight:600}',
    '.foto-rot-depois{color:var(--verde)}',
    '.foto-desc{font-size:.86em;line-height:1.5;color:var(--texto);white-space:pre-line}',

    /* ── resultados: os mesmos cartões do modal ── */
    '.res-grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(11.5em,1fr));gap:.75em}',
    '.res{background:var(--off);border-radius:.5em;padding:.85em;border-left:3px solid var(--az);' +
      'break-inside:avoid;page-break-inside:avoid}',
    '.res-fin{border-left-color:var(--verde);text-align:center}',
    '.res-num{font-family:var(--tit);font-weight:700;font-size:1.3em;color:var(--verde);line-height:1.2}',
    '.res-rot{font-size:.7em;color:var(--cinza)}',
    '.res-tit{font-family:var(--tit);font-weight:700;font-size:.82em;color:var(--tinta)}',
    '.res-txt{font-size:.7em;color:var(--cinza);margin-top:.2em;line-height:1.45}',

    /* ── rodapé ── */
    '.rodape{display:flex;justify-content:space-between;gap:1em;border-top:1px solid var(--linha);' +
      'padding-top:.6em;font-size:.66em;color:var(--cinza);letter-spacing:.06em}',

    /* ── aviso de preparação ── */
    '.aviso{position:fixed;inset:0;background:rgba(4,21,35,.94);display:flex;align-items:center;' +
      'justify-content:center;z-index:99}',
    '.aviso-cx{text-align:center;color:#fff}',
    '.aviso-spin{width:2.4em;height:2.4em;margin:0 auto .9em;border:3px solid rgba(255,255,255,.25);' +
      'border-top-color:var(--az);border-radius:50%;animation:pkGira .8s linear infinite}',
    '.aviso-txt{font-family:var(--tit);font-size:.95em;letter-spacing:.04em}',
    '@keyframes pkGira{to{transform:rotate(360deg)}}',

    /* ── papel ──
       A folha na tela é uma prévia larga; no papel ela vira a área útil
       do A4 e nada mais: sem sombra, sem borda, sem largura fixa. O
       tamanho-base menor é o que reacomoda a página inteira. */
    '@media print{',
    /* margem 0 em cima e embaixo: é NESSA faixa que o navegador imprime
       a data e o título do documento. Sem ela o cabeçalho e o rodapé do
       Chrome/Edge não têm onde ser desenhados e a folha sai limpa. O
       respiro de 10mm volta como padding da própria folha, e as margens
       laterais ficam na @page para continuarem valendo em cada página. */
    '  @page{size:A4 portrait;margin:0 10mm}',
    '  body{background:#fff}',
    '  .aviso{display:none!important}',
    '  .folha{font-size:9.4pt;width:auto;max-width:none;margin:0;padding:10mm 0;box-shadow:none;' +
      'border-radius:0;gap:.8em}',
    '  .cab{padding:1.1em 1.2em}',
    '  .foto-img{height:56mm}',
    '  .cab,.duas,.rodape{break-inside:avoid;page-break-inside:avoid}',
    '}',

    /* ── telas estreitas: a prévia empilha, o papel não muda ── */
    '@media screen and (max-width:820px){',
    '  .folha{width:100%;margin:0;border-radius:0;padding:16px}',
    '  .duas,.fotos{grid-template-columns:1fr}',
    '  .cab-topo{flex-direction:column}',
    '}'
  ].join('\n');

  /* ── Relatório A4 do Kaizen ────────────────────────────────────────
     Abre uma janela com um one-page executivo montado a partir dos DADOS
     do Kaizen — não é mais uma cópia do modal reduzida por transform.

     Por que mudou: a versão anterior clonava o corpo do modal, encolhia
     tudo com scale() até caber em 182mm e mandava imprimir depois de
     450ms fixos. Isso dava três problemas de uma vez: a folha ocupava um
     pedaço pequeno da tela, o texto ficava minúsculo, e a impressão
     saía antes de as imagens carregarem — daí os campos vazios e as
     evidências quebradas.

     Agora: HTML próprio, CSS próprio, e a impressão só é liberada
     depois que TODAS as imagens terminam (ou falham, explicitamente).
     Enquanto isso a janela mostra "Preparando relatório...".

     printKaizen(dados, opcoes)
       dados  — o mesmo objeto de GET /api/kaizens/:id
       opcoes — { rotulos, idioma } para os títulos no idioma da tela */
  function pk_escapar(txt) {
    return String(txt == null ? '' : txt)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Nome do arquivo sugerido ao salvar em PDF. O Chrome e o Edge usam o
   *  <title> do documento, então é ele que vira "KZN26-001-SOSSEGO-
   *  CRISTIAN-ARLAN-ALVES.pdf". Sem acento, sem caractere que o Windows
   *  recusa (\ / : * ? " < > |) e sem hífen repetido ou sobrando. */
  function pk_nomeArquivo(partes) {
    return partes
      .filter(Boolean)
      .map(function (p) {
        return String(p).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[\\/:*?"<>|]/g, ' ')
          .replace(/[^A-Za-z0-9 _-]/g, ' ')
          .trim().replace(/\s+/g, '-');
      })
      .filter(Boolean).join('-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
      .toUpperCase().slice(0, 120);
  }

  /** As folhas que o relatório herda do app: os ÍCONES (Font Awesome) e a
   *  Poppins dos títulos — sem elas a faixa e os cabeçalhos dos cartões
   *  não ficariam iguais ao modal. Os endereços são lidos do próprio
   *  documento que abriu a janela, já absolutos, em vez de repetidos
   *  aqui: o arquivo do vendor tem hash no nome e mudaria a cada build.
   *  A folha do app NÃO entra — o relatório tem o CSS dele. */
  function pk_folhasHerdadas() {
    return Array.prototype.slice.call(document.querySelectorAll('link[rel~="stylesheet"]'))
      .map(function (l) { return l.href; })
      .filter(function (h) { return /fontawesome|all\.min\.css/i.test(h) || /poppins\.css/i.test(h); })
      .map(function (h) { return '<link rel="stylesheet" href="' + pk_escapar(h) + '"/>'; })
      .join('');
  }

  /** "2026-08-15T00:00:00" -> "15/08/2026" (ou o formato do idioma).
   *  Lê os números do texto em vez de criar um Date: a data vem sem
   *  fuso (ver relogioLocal em server.js) e deixar o navegador
   *  interpretar mudaria o dia de quem está em outro fuso. */
  function pk_data(valor, idioma) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ''));
    if (!m) return '';
    return (idioma === 'en')
      ? m[1] + '/' + m[2] + '/' + m[3]
      : m[3] + '/' + m[2] + '/' + m[1];
  }

  window.printKaizen = function (dados, opcoes) {
    var k = dados || {};
    var o = opcoes || {};
    var R = o.rotulos || {};
    var idioma = o.idioma === 'en' ? 'en' : 'pt-BR';
    var r = function (chave, padrao) { return R[chave] || padrao; };

    var win = window.open('', '_blank');
    if (!win) return;   // bloqueador de pop-up: nada a fazer aqui

    var titulo = pk_nomeArquivo([k.ROTULO, k.NM_SITE, k.NM_LIDER]) || 'KAIZEN';

    // A foto não é servida pelo caminho do volume: quem entrega os bytes
    // é GET /api/kaizens/imagem (ver server.js). Quem chama passa a
    // função que monta essa URL — a MESMA que a tela usa para o <img> do
    // modal, então não há duas formas de montar o mesmo endereço.
    // Depois disso vira absoluta: a janela nova tem base própria e um
    // caminho relativo poderia resolver para outro lugar.
    var comApi = typeof o.urlImagem === 'function' ? o.urlImagem : function (u) { return u; };
    var absoluto = function (u) {
      if (!u) return '';
      try { return new URL(comApi(u), window.location.href).href; } catch (e) { return u; }
    };
    var foto = function (url, marca, descricao) {
      var depois = marca === 'depois';
      return '<figure class="foto">' +
        (url
          ? '<div class="foto-img"><img src="' + pk_escapar(absoluto(url)) + '" alt=""/></div>'
          : '<div class="foto-img foto-vazia">' + pk_escapar(r('semImagem', 'Sem imagem registrada')) + '</div>') +
        '<div class="foto-corpo">' +
          '<div class="foto-rot' + (depois ? ' foto-rot-depois' : '') + '">' +
            pk_escapar(depois ? r('depois', 'Depois') : r('antes', 'Antes')) + '</div>' +
          '<div class="foto-desc">' + pk_escapar(descricao || '—') + '</div>' +
        '</div>' +
      '</figure>';
    };

    /* Cartão: a mesma casca do .kd-section do modal — cabeçalho com
       pastilha de ícone e título, corpo embaixo. */
    var secao = function (icone, titulo, corpo, classe) {
      return '<section class="sec' + (classe ? ' ' + classe : '') + '">' +
        '<div class="sec-cab"><div class="sec-ico"><i class="fa-solid ' + icone + '"></i></div>' +
        '<div class="sec-tit">' + pk_escapar(titulo) + '</div></div>' +
        '<div class="sec-corpo">' + corpo + '</div></section>';
    };

    // Meta da faixa: ícone + "Rótulo: valor", igual ao meta() da Biblioteca.
    var linhaMeta = function (icone, rotulo, valor) {
      if (!valor) return '';
      return '<div class="cab-meta"><i class="fa-solid ' + icone + '"></i> <strong>' +
             pk_escapar(rotulo) + ':</strong> ' + pk_escapar(valor) + '</div>';
    };

    var desperdicios = (k.DESPERDICIOS || []).filter(Boolean).join(' · ');
    var equipe = (k.MEMBROS || []).map(function (m) { return m.NM_USUARIO; }).filter(Boolean).join(', ');
    var dataRef = pk_data(k.DT_CONCLUSAO || k.DT_CRIACAO, idioma);
    var identificacao = [k.ROTULO, k.NM_CATEGORIA, k.NM_SITE].filter(Boolean).join(' · ');

    // Resultados: o financeiro vira um destaque proprio, os demais
    // entram como cartoes. Esta e a secao que o relatorio existe para
    // mostrar, entao ela ocupa a largura inteira.
    var destaques = [];
    if (k.VL_RESULTADO_FINANCEIRO != null) {
      var valor = Number(k.VL_RESULTADO_FINANCEIRO)
        .toLocaleString(idioma === 'en' ? 'en-US' : 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      destaques.push('<div class="res res-fin"><div class="res-num">' +
        pk_escapar((k.SG_MOEDA || '') + ' ' + valor) + '</div><div class="res-rot">' +
        pk_escapar(r('resultadoFinanceiro', 'Resultado financeiro')) + '</div></div>');
    }
    (k.RESULTADOS || []).forEach(function (x) {
      destaques.push('<div class="res"><div class="res-tit">' + pk_escapar(x.NM_RESULTADO) +
        '</div><div class="res-txt">' + pk_escapar(x.DS_RESULTADO || '') + '</div></div>');
    });

    // Aprendizados: os mesmos três itens rotulados que o modal mostra.
    var licoes = [];
    if (k.DS_LICOES_APRENDIDAS) {
      licoes.push('<strong>' + pk_escapar(r('licoesAprendidas', 'Lições Aprendidas')) + ':</strong> ' +
        pk_escapar(k.DS_LICOES_APRENDIDAS));
    }
    if (k.DS_RESULTADO_ESPERADO) {
      licoes.push('<strong>' + pk_escapar(r('comparacaoMeta', 'Comparação com a meta')) + ':</strong> ' +
        pk_escapar(k.DS_RESULTADO_ESPERADO));
    }
    if (desperdicios) {
      licoes.push('<strong>' + pk_escapar(r('desperdiciosReduzidos', 'Desperdícios reduzidos')) + ':</strong> ' +
        pk_escapar(desperdicios));
    }

    var html =
      '<!doctype html><html lang="' + (idioma === 'en' ? 'en' : 'pt-BR') + '"><head><meta charset="utf-8"/>' +
      '<title>' + pk_escapar(titulo) + '</title>' +
      pk_folhasHerdadas() +
      '<style>' + PK_CSS + '</style></head><body>' +
      '<div class="aviso" id="pkAviso"><div class="aviso-cx">' +
        '<div class="aviso-spin"></div>' +
        '<div class="aviso-txt">' + pk_escapar(r('preparando', 'Preparando relatório para impressão...')) + '</div>' +
      '</div></div>' +
      '<div class="folha">' +

        '<header class="cab">' +
          '<div class="cab-topo">' +
            '<div class="cab-id">' + pk_escapar(identificacao) + '</div>' +
            (k.NM_STATUS ? '<div class="cab-status">' + pk_escapar(k.NM_STATUS) + '</div>' : '') +
          '</div>' +
          '<h1>' + pk_escapar(k.NM_KAIZEN || '') + '</h1>' +
          // Duas faixas de propósito: primeiro QUEM e QUANDO, depois
          // COMO o Kaizen se classifica. Cada uma é uma linha própria —
          // juntas numa só, a quebra caía onde coubesse e separava
          // rótulo de valor sem critério.
          '<div class="cab-metas">' +
            linhaMeta('fa-user', r('lider', 'Líder'), k.NM_LIDER) +
            linhaMeta('fa-users', r('equipe', 'Equipe'), equipe) +
            linhaMeta('fa-calendar-day', r('data', 'Data'), dataRef) +
          '</div>' +
          '<div class="cab-metas">' +
            linhaMeta('fa-tag', r('categoria', 'Categoria'), k.NM_CATEGORIA) +
            linhaMeta('fa-globe', r('replicacao', 'Replicação'), k.NM_REPLICACAO) +
            linhaMeta('fa-recycle', r('desperdicios', 'Redução de Desperdícios'), desperdicios) +
          '</div>' +
        '</header>' +

        '<div class="duas">' +
          secao('fa-bullseye', r('problema', 'Declaração do Problema'), pk_escapar(k.DS_PROBLEMA || '—')) +
          secao('fa-flag', r('objetivo', 'Meta / Objetivo'), pk_escapar(k.DS_OBJETIVO || '—')) +
        '</div>' +

        secao('fa-camera', r('evidencias', 'Evidências Antes & Depois'),
          '<div class="fotos">' +
            foto(k.URL_IMG_ANTES, 'antes', k.DS_ESTADO_ANTES) +
            foto(k.URL_IMG_DEPOIS, 'depois', k.DS_ESTADO_DEPOIS) +
          '</div>') +

        (destaques.length
          ? secao('fa-chart-bar', r('resultados', 'Resultados Alcançados'),
              '<div class="res-grade">' + destaques.join('') + '</div>')
          : '') +

        (licoes.length
          ? secao('fa-lightbulb', r('licoes', 'Aprendizados & Potencial de Replicação'),
              licoes.join('<br/><br/>'))
          : '') +

        '<footer class="rodape">' +
          '<span>' + pk_escapar(k.ROTULO || '') + (k.NM_SITE ? ' · ' + pk_escapar(k.NM_SITE) : '') + '</span>' +
          '<span>' + pk_escapar(r('rodape', 'VBM Problem Solving & Continuous Improvement')) + '</span>' +
        '</footer>' +

      '</div></body></html>';

    win.document.open();
    win.document.write(html);
    win.document.close();

    /* A impressão só é liberada quando TODAS as imagens terminam.
       decode() resolve quando a imagem está pronta para pintar; a falha
       é tratada como "terminou" também — uma foto que não carregou não
       pode travar o relatório, e o lugar dela mostra o aviso. O teto de
       tempo existe para o caso de uma requisição ficar pendurada. */
    function quandoPronto(janela, aoFim) {
      var imgs = Array.prototype.slice.call(janela.document.images || []);
      var pendentes = imgs.map(function (img) {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise(function (resolve) {
          img.addEventListener('load', function () { resolve(); }, { once: true });
          img.addEventListener('error', function () {
            var cx = img.parentNode;
            if (cx) { cx.classList.add('ev-vazia'); cx.textContent = r('imagemFalhou', 'Imagem não disponível'); }
            resolve();
          }, { once: true });
        });
      });
      // Os ícones e a Poppins entram por webfont: imprimir antes de a
      // fonte chegar sairia com quadradinhos no lugar dos ícones. fonts.ready
      // resolve tanto no sucesso quanto na falha, então uma fonte
      // inalcançável não prende o relatório — só o deixa sem ícone.
      var fontes = (janela.document.fonts && janela.document.fonts.ready)
        ? Promise.resolve(janela.document.fonts.ready).catch(function () {})
        : Promise.resolve();

      var acabou = false;
      var fim = function () { if (!acabou) { acabou = true; aoFim(); } };
      Promise.all(pendentes.concat([fontes])).then(function () {
        // Um quadro a mais para o layout assentar antes de medir/imprimir.
        if (janela.requestAnimationFrame) janela.requestAnimationFrame(function () { janela.requestAnimationFrame(fim); });
        else setTimeout(fim, 50);
      });
      setTimeout(fim, 20000);   // teto: nunca deixa a janela presa
    }

    var iniciar = function () {
      quandoPronto(win, function () {
        var aviso = win.document.getElementById('pkAviso');
        if (aviso) aviso.parentNode.removeChild(aviso);
        win.focus();
        win.print();
      });
    };

    if (win.document.readyState === 'complete') iniciar();
    else win.addEventListener('load', iniciar, { once: true });
  };

  /* ── Approval workflow ── */
  function initApproval() {
    document.querySelectorAll('.approval-item').forEach(function(item) {
      item.addEventListener('click', function() {
        document.querySelectorAll('.approval-item').forEach(function(i) { i.classList.remove('selected'); });
        item.classList.add('selected');
        const detailPanel = document.getElementById('approvalDetail');
        if (detailPanel) {
          detailPanel.style.display = 'block';
          detailPanel.classList.add('visible');
        }
      });
    });
  }

  /* ── Admin CRUD helpers ── */
  window.toggleAdminItemStatus = async function(btn, label) {
    const row = btn.closest('.admin-item') || btn.closest('tr');
    if (!row) return;
    const icon = btn.querySelector('i');
    const activating = icon.classList.contains('fa-rotate-right');
    const confirmado = await confirmarAcao({
      variant: activating ? 'ativar' : 'desativar',
      titulo: activating ? ('Reativar ' + (label || 'este item') + '?') : ('Desativar ' + (label || 'este item') + '?'),
      mensagem: activating ? '' : 'Ele deixará de aparecer como opção ativa, mas não será excluído.',
    });
    if (!confirmado) return;

    icon.className = activating ? 'fa-solid fa-ban' : 'fa-solid fa-rotate-right';
    btn.classList.toggle('btn-icon-red', activating);
    btn.classList.toggle('btn-icon-blue', !activating);
    btn.title = activating ? 'Desativar' : 'Reativar';
    btn.setAttribute('data-i18n-title', activating ? 'common.desativar' : 'adm.reactivate');
    row.classList.toggle('admin-item-inactive', !activating);

    const badge = row.querySelector('[data-i18n="adm.ativo"], [data-i18n="adm.inativo"]');
    if (badge) {
      badge.textContent = activating ? 'Ativo' : 'Inativo';
      badge.setAttribute('data-i18n', activating ? 'adm.ativo' : 'adm.inativo');
      badge.className = activating ? 'badge badge-aprovado' : 'badge';
      badge.style.cssText = activating ? '' : 'background:#fef3c7;color:#92400e;border:1px solid #fde68a;';
    }

    showToast('success', activating ? 'Ativado' : 'Desativado',
      (label || 'Item') + (activating ? ' ativado com sucesso.' : ' desativado com sucesso.'));
  };

  /* ── Init AOS if available ── */
  function initAOS() {
    if (typeof AOS !== 'undefined') {
      AOS.init({ duration: 500, easing: 'ease', once: true, offset: 50 });
    }
  }

  /* ── DOM Ready ── */
  /* ── Badge do menu "Aprovação": qtd de pendentes do usuário logado ── */
  function initBadgeAprovacao() {
    var badges = document.querySelectorAll('.topnav-badge');
    if (!badges.length) return;
    fetch('/api/aprovacoes/contagem', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { qtd: 0 }; })
      .then(function (d) {
        badges.forEach(function (b) {
          b.textContent = d.qtd;
          b.style.display = d.qtd > 0 ? '' : 'none';
        });
      })
      .catch(function () {});
  }

  /* ── Rótulos acessíveis ────────────────────────────────────────────
     Campo sem rótulo programático é anunciado pelo leitor de tela só
     como "caixa de edição", sem dizer qual — a auditoria encontrou 75
     assim só na Administração. O rótulo VISUAL existe em quase todos;
     o que falta é a ligação, e em dois casos ela não cabe no HTML:

       · campos bilíngues: um <label> serve DOIS campos (PT e EN), então
         `for=` não resolve — cada um recebe "Rótulo (PT-BR)" / "(EN)",
         lido da própria etiqueta de idioma que está na tela;
       · modais da Administração: o conteúdo é montado por script depois
         do carregamento, então marcação estática não alcançaria.

     Por isso a passagem é feita aqui, em runtime, e repetida quando um
     modal abre. Nada de layout muda: só entram atributos.

     O que NÃO é tocado: quem já tem label[for], aria-label,
     aria-labelledby ou placeholder — o rótulo existente sempre vence. */
  function textoDoRotulo(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim().replace(/[:*]+$/, '');
  }

  function rotularControle(campo) {
    if (campo.type === 'hidden' || campo.disabled) return;
    if (campo.getAttribute('aria-label') || campo.getAttribute('aria-labelledby')) return;
    if (campo.id && document.querySelector('label[for="' + CSS.escape(campo.id) + '"]')) return;
    if (campo.getAttribute('placeholder')) return;

    // Sobe até o bloco do campo e pega o rótulo visual dele.
    var bloco = campo.closest('.form-group, .settings-section, .filter-bar, .lang-slot-group') || campo.parentElement;
    var rotulo = bloco ? bloco.querySelector('label, .form-label, .settings-section-title, .filter-label') : null;
    var texto = rotulo ? textoDoRotulo(rotulo) : '';

    // Dentro de um slot bilíngue, o idioma entra junto: sem isso os dois
    // campos do mesmo rótulo seriam anunciados com o mesmo nome.
    var slot = campo.closest('.lang-slot');
    if (slot) {
      var tag = slot.querySelector('.lang-slot-tag');
      var idioma = tag ? textoDoRotulo(tag) : (campo.dataset.lang || '');
      if (idioma) texto = texto ? texto + ' (' + idioma + ')' : idioma;
    }

    // Combo de filtro não tem rótulo visual: a primeira opção ("Todas
    // as unidades", "Todos os status") é exatamente o nome do campo, e
    // já vem traduzida pelo dicionário da página.
    if (!texto && campo.tagName === 'SELECT' && campo.options.length) {
      texto = textoDoRotulo(campo.options[0]);
    }
    // Caixa de seleção: o texto que fica ao lado dela é o rótulo.
    if (!texto && (campo.type === 'checkbox' || campo.type === 'radio')) {
      var vizinho = campo.closest('label') || campo.parentElement;
      if (vizinho) texto = textoDoRotulo(vizinho);
    }

    if (texto) campo.setAttribute('aria-label', texto);
  }

  function rotularBotao(botao) {
    if (botao.getAttribute('aria-label') || botao.textContent.trim()) return;
    var titulo = botao.getAttribute('title');
    if (titulo) { botao.setAttribute('aria-label', titulo); return; }
    // Botão só com ícone e sem título: o nome do ícone é o melhor sinal
    // disponível. "fa-solid fa-xmark" tem DOIS fa-*, e o primeiro é o
    // estilo — ler o primeiro daria "solid" e não identificaria nada.
    var icone = botao.querySelector('i[class*="fa-"]');
    var estilos = { solid: 1, regular: 1, brands: 1, light: 1, thin: 1, duotone: 1, fw: 1, spin: 1, lg: 1, sm: 1, xs: 1 };
    var nome = null;
    if (icone) {
      String(icone.className).split(/\s+/).forEach(function (c) {
        var m = /^fa-([a-z0-9-]+)$/.exec(c);
        if (m && !estilos[m[1]] && !nome) nome = m[1];
      });
    }
    var conhecidos = {
      xmark: 'common.fechar', times: 'common.fechar', bars: 'a11y.abrirMenu',
      'chevron-down': 'a11y.expandir', 'chevron-right': 'a11y.avancar',
      'arrow-left': 'a11y.voltar', plus: 'a11y.adicionar',
    };
    var padroes = {
      'common.fechar': 'Fechar', 'a11y.abrirMenu': 'Abrir menu', 'a11y.expandir': 'Expandir',
      'a11y.avancar': 'Avançar', 'a11y.voltar': 'Voltar', 'a11y.adicionar': 'Adicionar',
    };
    var chave = nome && conhecidos[nome];
    if (!chave) return;
    // data-i18n-aria: o próprio tradutor da página reescreve o rótulo na
    // troca de idioma, sem esta função precisar rodar de novo.
    botao.setAttribute('data-i18n-aria', chave);
    var dicionario = window.__i18n || {};
    botao.setAttribute('aria-label', dicionario[chave] || padroes[chave]);
  }

  window.VBMRotulos = function (raiz) {
    var alvo = raiz || document;
    alvo.querySelectorAll('input, select, textarea').forEach(rotularControle);
    alvo.querySelectorAll('button').forEach(rotularBotao);
  };

  document.addEventListener('DOMContentLoaded', function() {
    initSidebar();
    initActiveNav();
    initCounters();
    initReveal();
    initModals();
    initTabs();
    initWizard();
    initPNR();
    initPhotoUpload();
    initFilters();
    initViewToggle();
    initToggles();
    initApproval();
    initAOS();
    initBadgeAprovacao();
    window.VBMRotulos();
  });

  /* ──────────────────────────────────────────────────────────────
     IDIOMA DOS DADOS (window.VBMIdioma)
     ──────────────────────────────────────────────────────────────
     O seletor de idioma das configurações traduz só os textos fixos
     da tela (data-i18n). As listas vindas do banco são bilíngues no
     próprio banco (1 linha por ID_IDIOMA), então precisam ser
     RECONSULTADAS quando o idioma muda — senão a tela fica em inglês
     com os dados em português.

     Este helper avisa quem estiver mostrando dados do banco. Cobre as
     três formas de o idioma mudar:
       • nesta mesma página  -> evento 'vbm:idioma' (disparado pelo
         applyLang de cada tela);
       • em OUTRA aba/página -> evento 'storage' do localStorage;
       • enquanto esta página estava oculta -> ao voltar o foco
         (visibilitychange/focus), compara o idioma guardado com o que
         está em uso e recarrega se divergir.

     A recarga só acontece com a página VISÍVEL: se o idioma mudar com
     a aba em segundo plano, ela fica pendente e dispara quando o
     usuário volta — evita ir ao banco para uma tela que ninguém está
     olhando.
     ────────────────────────────────────────────────────────────── */
  var CHAVE_IDIOMA = 'vdt-lang';

  function idiomaAtual() {
    try { return localStorage.getItem(CHAVE_IDIOMA) || 'pt-BR'; }
    catch (e) { return 'pt-BR'; }
  }

  window.VBMIdioma = {
    /** Idioma da tela agora ('pt-BR' | 'en'). */
    atual: idiomaAtual,

    /**
     * Registra um recarregador de dados.
     * @param {function(string)} recarregar chamado com o novo idioma
     *        sempre que ele mudar e a página estiver visível.
     * @returns {function(): string} idioma em uso pelo assinante —
     *        usado para montar a URL da consulta.
     */
    aoMudar: function (recarregar) {
      var emUso = idiomaAtual();

      function verificar() {
        var agora = idiomaAtual();
        if (agora === emUso) return;
        // Página oculta: não consulta agora. Ao voltar o foco esta
        // mesma função roda de novo e faz a recarga.
        if (document.hidden) return;
        emUso = agora;
        try { recarregar(agora); }
        catch (e) { console.error('[idioma] falha ao recarregar dados:', e); }
      }

      window.addEventListener('vbm:idioma', verificar);
      window.addEventListener('storage', function (e) {
        if (!e.key || e.key === CHAVE_IDIOMA) verificar();
      });
      document.addEventListener('visibilitychange', verificar);
      window.addEventListener('focus', verificar);

      return function () { return emUso; };
    },
  };

  /* ──────────────────────────────────────────────────────────────
     DADOS COMPARTILHADOS ENTRE ABAS (window.VBMDados)
     ──────────────────────────────────────────────────────────────
     Cada aba do admin carrega sua lista UMA vez (sob demanda, na
     primeira abertura) e nunca mais. Isso quebrava as abas que
     mostram dados de OUTRA tabela: cadastrar um item em "Tipo
     Resultados" não fazia o combo de "Resultados" enxergá-lo — só
     recarregando a página inteira (F5).

     Dependência real entre abas do admin hoje:
       tiporesultados -> resultados (combo "Tipo de Resultado")

     A aba Usuários já dependeu de Aprovadores (a coluna Função era
     derivada de kzn_aprovador); hoje ela mostra NM_POSICAO do MDM e
     não depende de mais ninguém.

     Quem GRAVA avisa qual rota mudou (mudou); quem MOSTRA aquela rota
     se inscreve (aoMudar). Não é cache nem estado paralelo: só marca o
     assinante como desatualizado e reusa o MESMO carregador que a aba
     já tinha.

     A recarga fica pendente enquanto a aba estiver fechada ou a página
     oculta, e é aplicada quando ela abre — assim gravar numa aba não
     dispara consultas nas outras, que ninguém está olhando.
     ────────────────────────────────────────────────────────────── */
  window.VBMDados = {
    /**
     * Avisa que uma rota da API mudou no banco (criar/editar/status).
     * @param {string} rota a mesma usada no fetch (ex.: 'resultados').
     */
    mudou: function (rota) {
      window.dispatchEvent(new CustomEvent('vbm:dados', { detail: { rota: rota } }));
    },

    /**
     * Registra um recarregador que depende de rotas de OUTRAS abas.
     * @param {string[]} rotas rotas observadas.
     * @param {function()} recarregar o carregador que a aba já usa.
     * @param {function(): boolean} [pronto] false adia a recarga (ex.:
     *        aba fechada); sem ele, recarrega na hora.
     * @returns {function()} chame quando o assinante ficar pronto de
     *        novo (ex.: a aba foi reaberta) para aplicar o pendente.
     */
    aoMudar: function (rotas, recarregar, pronto) {
      var pendente = false;

      function aplicar() {
        if (!pendente || document.hidden) return;
        if (pronto && !pronto()) return;
        pendente = false;
        try { recarregar(); }
        catch (e) { console.error('[dados] falha ao recarregar:', e); }
      }

      window.addEventListener('vbm:dados', function (e) {
        var rota = e.detail && e.detail.rota;
        if (rotas.indexOf(rota) === -1) return;
        pendente = true;
        aplicar();
      });
      document.addEventListener('visibilitychange', aplicar);
      window.addEventListener('focus', aplicar);

      return aplicar;
    },
  };

  /* ──────────────────────────────────────────────────────────────
     PÁGINAS RESTRITAS (window.VBMAcesso)
     ──────────────────────────────────────────────────────────────
     Duas páginas dependem de cadastro no banco:

       admin.html     -> kzn_admin
       aprovacao.html -> kzn_aprovador

     Quem decide é o SERVIDOR: ele recusa a página e a API para quem
     não tem o papel (ver PAGINAS_RESTRITAS e o gate da API em
     server.js), inclusive quando a URL é digitada direto. O que este
     bloco faz é só REFORÇO VISUAL — esconder da barra de navegação os
     links que levariam a um bloqueio. Mexer nisso pelo DevTools não
     abre nada: reexibir o link só leva à tela de acesso negado.

     Os papéis vêm de GET /api/me, que o cabeçalho já consulta — a
     promessa é memorizada aqui e reusada por js/usuario-graph.js, para
     a página não pedir /api/me duas vezes.
     ────────────────────────────────────────────────────────────── */
  var PAGINAS_RESTRITAS = { 'admin.html': 'admin', 'aprovacao.html': 'aprovador' };
  var promessaMe = null;

  function linksPara(pagina) {
    return document.querySelectorAll('a[href="' + pagina + '"]');
  }

  // O atributo hidden SOZINHO não basta aqui: .topnav-link declara
  // display:flex, que vence a regra [hidden]{display:none} do navegador
  // (especificidade de classe > seletor de atributo do UA stylesheet) —
  // o link ficava marcado como escondido e continuava aparecendo na
  // barra. O display inline garante o resultado sem depender de nova
  // regra de CSS em cada página; voltar para "" devolve o valor da
  // folha de estilo.
  function alternarLinks(pagina, visivel) {
    Array.prototype.forEach.call(linksPara(pagina), function (a) {
      a.hidden = !visivel;
      a.style.display = visivel ? "" : "none";
    });
  }

  // Os links das páginas restritas nascem ESCONDIDOS e só aparecem se
  // /api/me confirmar o papel. Se ficassem visíveis até a resposta
  // chegar, apareceriam por um instante em toda navegação para quem não
  // tem permissão. Sem resposta (front fora do Databricks) eles seguem
  // escondidos — mesma regra do servidor: na dúvida, não mostra.
  function esconderLinksRestritos() {
    Object.keys(PAGINAS_RESTRITAS).forEach(function (pagina) {
      alternarLinks(pagina, false);
    });
  }

  function revelarLinksPermitidos(me) {
    Object.keys(PAGINAS_RESTRITAS).forEach(function (pagina) {
      if (me && me[PAGINAS_RESTRITAS[pagina]]) alternarLinks(pagina, true);
    });
  }

  window.VBMAcesso = {
    /** GET /api/me memorizado — null se a rota não existir/responder. */
    me: function () {
      if (!promessaMe) {
        promessaMe = fetch('/api/me', { headers: { Accept: 'application/json' } })
          .then(function (res) { return res.ok ? res.json() : null; })
          .catch(function () { return null; });
      }
      return promessaMe;
    },
  };

  function aplicarRestricoesDeNavegacao() {
    esconderLinksRestritos();
    window.VBMAcesso.me().then(revelarLinksPermitidos);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aplicarRestricoesDeNavegacao);
  } else {
    aplicarRestricoesDeNavegacao();
  }

})();
