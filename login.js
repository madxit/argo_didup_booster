// =====================================================================
// login.js — accesso automatico sulle pagine di Argo (portaleargo.it).
//   1. pagina di login: compila il codice scuola, spunta «Ricordami» (se
//      attivo nelle impostazioni) e preme "SPID - CIE - EIDAS" (prosegue
//      poi eid.js sulla pagina del Ministero)
//   2. scelta del profilo dopo SPID: seleziona quello del codice scuola
//   3. registro aperto e con le credenziali: chiude il flusso
// Protezione anti-loop: dopo un tentativo automatico, per 90 secondi non
// riparte da solo (es. SPID annullato o fallito) e propone "Riprova".
// Un clic sull'icona dell'estensione invece lo fa ripartire sempre.
// =====================================================================

(() => {
  if (window.__argoAssistantLogin) return;
  window.__argoAssistantLogin = true;

  const SELECT_TTL_MS = 10 * 60 * 1000;
  const PAGE_WAIT_MS = 10000;          // la pagina può comparire dopo il caricamento
  const LOGGED_WAIT_MS = 2 * 60 * 1000;
  let autoClicking = false;   // il clic su "SPID - CIE - EIDAS" lo sta facendo l'estensione
  let lastFlow = null;

  function findSpidButton() {
    return document.querySelector('#spidForm a.button-spid, a.button-spid') ||
      [...document.querySelectorAll('a, button')].find(el => /SPID\s*-\s*CIE/i.test(el.textContent || ''));
  }

  function findLoginForm() {
    const field = document.getElementById('customer_code');
    const button = findSpidButton();
    return field && button ? { field, button } : null;
  }

  // «Ricordami» di Argo: senza, Argo non rinnova l'accesso da solo e dopo
  // circa un'ora chiede di nuovo SPID o CIE (lo dice anche il messaggio
  // «Sessione scaduta» di DidUP). Si spunta la casella senza cliccarla: il
  // clic aprirebbe la finestra informativa di Argo. Il pulsante SPID copia
  // poi la casella nel campo nascosto remember_me del modulo.
  function applyRicordami(settings) {
    const cb = document.getElementById('shared_remember_me');
    if (!cb || !settings.ricordami) return false;
    if (!cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const hidden = document.getElementById('spid_remember_me');
    if (hidden) hidden.value = 'true';
    return true;
  }

  function fillCode(field, code) {
    field.focus();
    field.value = code;
    for (const type of ['input', 'change', 'keyup']) field.dispatchEvent(new Event(type, { bubbles: true }));
  }

  async function startLogin(settings, { manual = false } = {}) {
    const form = findLoginForm();
    if (!form) return false;
    if (!settings.codiceScuola) {
      showMissingCode();
      return false;
    }
    fillCode(form.field, settings.codiceScuola);
    const ricordami = applyRicordami(settings);
    await setLoginFlow({ startedAt: Date.now(), stage: 'eid', autoAt: Date.now(), manual });
    assistantToast.show('Accesso automatico', `Codice ${settings.codiceScuola} inserito${ricordami ? ' · «Ricordami» spuntato' : ''} · ${describeLoginMethod(settings)}…`);
    // Il pulsante di Argo copia "Ricordami" e invia #spidForm.
    autoClicking = true;
    form.button.click();
    autoClicking = false;
    return true;
  }

  function showMissingCode() {
    assistantToast.show('Codice scuola non impostato',
      'Impostalo nelle impostazioni di Argo DidUP Booster per usare l\'accesso automatico.',
      { warn: true, actions: [{ label: 'Apri impostazioni', onClick: openExtensionOptions }] });
  }

  // Dopo SPID, se l'utente ha più profili Argo, sceglie quello della scuola.
  function selectIdentity(settings) {
    const identities = [...document.querySelectorAll('.selectable-identity:not(.disabled)')];
    if (identities.length === 0) return false;
    const code = settings.codiceScuola.toUpperCase();
    const matches = identities.filter(el => (el.getAttribute('data-customer_code') || '').toUpperCase() === code);
    if (matches.length !== 1) {
      assistantToast.show('Scegli il profilo', matches.length > 1
        ? `Ci sono più profili per la scuola ${code}: scegli quello giusto.`
        : `Nessun profilo trovato per la scuola ${code}: scegli tu.`, { duration: 8000 });
      return false;
    }
    assistantToast.show('Accesso automatico', `Profilo della scuola ${code} selezionato…`, { duration: 6000 });
    matches[0].click();
    return true;
  }

  // Nel registro: il flusso si chiude solo quando l'app ha davvero le
  // credenziali. (/voti/ si apre anche PRIMA dell'accesso, per poi
  // rimandare alla pagina di login: lì il flusso serve ancora.)
  async function clearFlowWhenLogged() {
    const until = Date.now() + LOGGED_WAIT_MS;
    while (Date.now() < until && extensionAlive()) {
      try {
        const r = await callPageBridge('session', {}, 2000);
        if (r.state === 'logged') {
          await clearLoginFlow();
          return;
        }
      } catch (e) { /* bridge non ancora pronto */ }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async function run() {
    const settings = await loadSettings();
    const url = location.href;

    if (isArgoDashboardUrl(url, settings)) {
      if (await getLoginFlow()) clearFlowWhenLogged();
      return;
    }

    const page = await waitForElement(() =>
      document.querySelector('.selectable-identity') ? 'identity' : (findLoginForm() ? 'login' : null), PAGE_WAIT_MS);
    if (!page) return;

    const flow = await getLoginFlow();
    lastFlow = flow;

    // Scelta del profilo (dopo SPID/CIE).
    if (page === 'identity') {
      if (flow && Date.now() - (flow.startedAt || 0) < SELECT_TTL_MS && settings.codiceScuola) {
        selectIdentity(settings);
      }
      return;
    }

    // Anche se l'utente preme a mano "SPID - CIE - EIDAS", eid.js sceglierà il provider.
    // (scrittura immediata: la pagina sta per essere abbandonata)
    // (in fase di cattura: prima del gestore di Argo, che copia «Ricordami» e invia il modulo)
    findSpidButton().addEventListener('click', () => {
      if (autoClicking || !extensionAlive()) return;
      applyRicordami(settings);
      setLoginFlow({ startedAt: Date.now(), stage: 'eid', autoAt: lastFlow && lastFlow.autoAt, manual: true });
    }, true);

    const requested = isFlowStage(flow, 'argo');                       // clic sull'icona / "Accedi ora"
    const recentlyTried = flow && flow.autoAt && Date.now() - flow.autoAt < LOGIN_RETRY_GUARD_MS;

    if (!settings.codiceScuola) {
      if (requested || settings.autoLogin) showMissingCode();
      return;
    }
    if (requested || (settings.autoLogin && !recentlyTried)) {
      await startLogin(settings);
    } else if (settings.autoLogin && recentlyTried) {
      assistantToast.show('Accesso automatico in pausa',
        'L\'ultimo tentativo non è andato a buon fine o è stato annullato.',
        { actions: [{ label: 'Riprova', onClick: () => startLogin(settings, { manual: true }) }] });
    }
  }

  // Clic sull'icona dell'estensione (o "Accedi ora") su questa pagina.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'argo-login-now') return;
    Promise.all([loadSettings(), waitForElement(findLoginForm, 3000)])
      .then(([s, form]) => (form ? startLogin(s, { manual: true }) : false))
      .then(ok => sendResponse({ ok }))
      .catch(err => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  });

  run().catch(err => console.warn('[Argo DidUP Booster] Accesso automatico:', err));
})();
