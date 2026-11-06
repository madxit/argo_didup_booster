// =====================================================================
// toolbar.js — pulsanti dell'estensione nella barra in alto di DidUP
// (content script sulle pagine del registro).
//   • due pulsanti rotondi con un'icona: «Firma ora» e «Appello»; passando
//     sopra con il mouse compare la scritta di cosa fanno
//   • posizione (destra, accanto al pulsante di aiuto · centro · sinistra)
//     e stile si scelgono nelle impostazioni (BUTTON_THEMES in settings.js)
//   • pannello dei passi sotto i pulsanti: cosa è stato cliccato, cosa non
//     è stato trovato, le domande (es. ora fuori dalla sua fascia) e l'esito
//   • avviso «Sessione scaduta» con «Accedi di nuovo» quando il service
//     worker (mantenimento della sessione) lo segnala
// I pulsanti stanno in un elemento proprio, sopra la barra di DidUP: non si
// tocca il layout di Ext JS, che li ricalcolerebbe o li sovrapporrebbe.
// =====================================================================

(() => {
  const ATTR = 'data-argo-assistant';
  const instanceId = Math.random().toString(36).slice(2);
  document.documentElement.dataset.argoAssistantToolbar = instanceId;
  document.querySelectorAll(`[${ATTR}="toolbar"], [${ATTR}="run"]`).forEach(el => el.remove());
  const isCurrent = () => document.documentElement.dataset.argoAssistantToolbar === instanceId && extensionAlive();

  const BTN = BOOSTER_BUTTON_SIZE;
  const GAP = BOOSTER_BUTTON_GAP;
  const MARGIN = 18;           // distanza dagli elementi di DidUP
  const ASK_TIMEOUT_MS = 2 * 60 * 1000;
  const ACTIONS = BOOSTER_ACTIONS;

  let settings = null;
  let bar = null;              // { host, root, themeStyle, buttons }
  let running = false;

  // ------------------------------------------------------------------
  // Dove mettere i pulsanti
  // ------------------------------------------------------------------

  function shown(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  // Barra in alto di DidUP (WSX.view.main.HeaderPanel): logo e nome della
  // scuola a sinistra, «Aggiorna APP», aiuto e profilo a destra.
  function headerParts() {
    const header = [...document.querySelectorAll('.header')].find(h =>
      shown(h) && (h.querySelector('.logo_programma, #intestazioneId') || h.querySelector('img[src*="help"]')));
    if (!header) return null;
    const help = header.querySelector('img[src*="help"]');
    const helpBtn = help ? help.closest('.x-btn') || help : null;
    const profile = header.querySelector('.btn-profile');
    // Gruppo di destra: i pulsanti visibili accanto ad aiuto e profilo.
    const rightBtns = [...header.querySelectorAll('.x-btn')].filter(b => shown(b) &&
      (b === helpBtn || b === profile || (helpBtn && b.parentElement === helpBtn.parentElement)));
    const rightLeft = rightBtns.length ? Math.min(...rightBtns.map(b => b.getBoundingClientRect().left)) : null;
    // Fine del nome della scuola (il testo, non il riquadro che può essere largo).
    let leftEnd = null;
    const intest = header.querySelector('#intestazioneId');
    const logo = header.querySelector('.logo_programma');
    if (intest && shown(intest)) {
      const range = document.createRange();
      range.selectNodeContents(intest);
      const r = range.getBoundingClientRect();
      leftEnd = r.width > 0 ? r.right : intest.getBoundingClientRect().right;
    } else if (logo && shown(logo)) {
      leftEnd = logo.getBoundingClientRect().right;
    }
    return { header, rect: header.getBoundingClientRect(), rightLeft, leftEnd };
  }

  function place() {
    if (!bar) return;
    const width = ACTIONS.length * BTN + (ACTIONS.length - 1) * GAP;
    const parts = headerParts();
    const h = bar.host.style;
    if (!parts) {
      // Barra di DidUP nascosta (es. schermata ingrandita): pulsanti in basso a destra, se il registro è aperto.
      const app = document.querySelector('.x-treelist') && shown(document.querySelector('.x-treelist'));
      h.display = app ? '' : 'none';
      h.left = `${window.innerWidth - width - 24}px`;
      h.top = `${window.innerHeight - BTN - 24}px`;
      bar.host.dataset.where = app ? 'floating' : 'hidden';
      return;
    }
    const { rect, rightLeft, leftEnd } = parts;
    const minX = (leftEnd != null ? leftEnd : rect.left) + MARGIN;
    const maxX = (rightLeft != null ? rightLeft : rect.right) - MARGIN - width;
    let x;
    const pos = settings.buttonsPosition;
    if (pos === 'left') x = minX;
    else if (pos === 'center') x = rect.left + (rect.width - width) / 2;
    else x = maxX;
    if (maxX >= minX) x = Math.min(Math.max(x, minX), maxX);
    h.display = '';
    h.left = `${Math.round(x)}px`;
    h.top = `${Math.round(rect.top + (rect.height - BTN) / 2)}px`;
    bar.host.dataset.where = pos;
  }

  // ------------------------------------------------------------------
  // Pulsanti
  // ------------------------------------------------------------------

  function applyTheme() {
    if (!bar) return;
    bar.themeStyle.textContent = `:host { ${buttonThemeCss(settings.buttonsTheme)} }`;
    bar.host.dataset.theme = buttonTheme(settings.buttonsTheme).id;
  }

  function createBar() {
    const host = document.createElement('div');
    host.setAttribute(ATTR, 'toolbar');
    // Sopra la barra di DidUP ma sotto le sue finestre e maschere (z-index da 19000 in su).
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:10000;display:none;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        ${boosterButtonsCss()}
        :host([data-where="floating"]) .tip { top: auto; bottom: calc(100% + 8px); }
      </style>
      <style class="theme"></style>
      <div class="bar" role="toolbar" aria-label="Argo DidUP Booster"></div>`;
    const wrap = root.querySelector('.bar');
    const buttons = {};
    for (const a of ACTIONS) {
      wrap.insertAdjacentHTML('beforeend', boosterButtonHtml(a));
      const b = wrap.lastElementChild;
      for (const type of ['mousedown', 'pointerdown', 'mouseup', 'keydown']) b.addEventListener(type, e => e.stopPropagation());
      b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); runAction(a.id); });
      wrap.appendChild(b);
      buttons[a.id] = b;
    }
    document.body.appendChild(host);
    bar = { host, root, themeStyle: root.querySelector('.theme'), buttons };
    applyTheme();
    place();
  }

  function setBusy(action) {
    if (!bar) return;
    for (const [id, b] of Object.entries(bar.buttons)) {
      b.disabled = Boolean(action);
      b.classList.toggle('busy', id === action);
    }
  }

  // ------------------------------------------------------------------
  // Pannello dei passi
  // ------------------------------------------------------------------

  const panel = (() => {
    let host = null, root = null, pendingAsk = null;
    const $ = sel => root.querySelector(sel);

    function ensure() {
      if (host && host.isConnected) return;
      host = document.createElement('div');
      host.setAttribute(ATTR, 'run');
      host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483000;';
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .p { width: 390px; max-width: calc(100vw - 16px); max-height: calc(100vh - 80px); display: flex; flex-direction: column;
               background: #fff; color: #1f2937; border: 1px solid #d7dde5; border-radius: 14px; overflow: hidden;
               box-shadow: 0 18px 50px rgba(15,23,42,.25); font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; }
          .head { display: flex; align-items: center; gap: 9px; padding: 11px 12px 10px 14px; border-bottom: 1px solid #eef0f3; }
          .dot { width: 10px; height: 10px; border-radius: 50%; background: #2563eb; flex: none; }
          .p.running .dot { animation: pulse 1s ease-in-out infinite; }
          .p.asking .dot { background: #d97706; }
          .p.done .dot { background: #16a34a; }
          .p.failed .dot { background: #dc2626; }
          .p.cancelled .dot { background: #6b7280; }
          @keyframes pulse { 50% { opacity: .3; } }
          .head strong { flex: 1; font-size: 14px; }
          .brand { font-size: 11px; color: #6b7280; }
          .x { border: 0; background: transparent; font-size: 18px; line-height: 1; color: #6b7280; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
          .x:hover { background: #f1f5f9; color: #111827; }
          ol { flex: 1 1 auto; min-height: 0; margin: 0; padding: 8px 14px 8px 32px; overflow-y: auto; }
          li { margin: 3px 0; }
          li.warn { color: #92400e; }
          li.ask { color: #92400e; font-weight: 600; }
          li.error { color: #b91c1c; font-weight: 600; }
          .askbox { flex: none; margin: 0 12px 10px; padding: 10px 12px; border-radius: 10px; background: #fffbeb; border: 1px solid #fcd34d; }
          .askbox p { margin: 0 0 9px; }
          .btns { display: flex; gap: 8px; flex-wrap: wrap; }
          button.btn { font: inherit; font-weight: 600; border: 1px solid transparent; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
          .yes { background: #2563eb; color: #fff; }
          .yes:hover { background: #1d4ed8; }
          .no { background: #fff; color: #374151; border-color: #d1d5db !important; }
          .no:hover { background: #f3f4f6; }
          .result { margin: 0; padding: 10px 14px; border-top: 1px solid #eef0f3; background: #fafbfc; font-weight: 600; }
          .p.done .result { color: #166534; }
          .p.failed .result { color: #b91c1c; }
          [hidden] { display: none !important; }
        </style>
        <div class="p" role="dialog" aria-live="polite">
          <div class="head"><span class="dot" aria-hidden="true"></span><strong class="title"></strong>
            <span class="brand">Argo DidUP Booster</span><button class="x" title="Chiudi" aria-label="Chiudi">×</button></div>
          <ol class="steps"></ol>
          <div class="askbox" hidden><p class="q"></p><div class="btns"><button class="btn yes"></button><button class="btn no"></button></div></div>
          <p class="result" hidden></p>
        </div>`;
      const p = $('.p');
      for (const type of ['keydown', 'keyup', 'mousedown', 'pointerdown', 'mouseup', 'click', 'wheel']) p.addEventListener(type, e => e.stopPropagation());
      $('.x').addEventListener('click', close);
      document.body.appendChild(host);
      window.addEventListener('resize', position);
    }

    function position() {
      if (!host || !host.isConnected) return;
      const p = $('.p');
      const w = p.offsetWidth;
      const a = bar && bar.host.style.display !== 'none' ? bar.host.getBoundingClientRect() : null;
      let left = a ? a.right - w : window.innerWidth - w - 16;
      left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
      let top = a ? a.bottom + 10 : 70;
      if (a && bar.host.dataset.where === 'floating') top = Math.max(8, a.top - p.offsetHeight - 10);
      host.style.left = `${Math.round(left)}px`;
      host.style.top = `${Math.round(top)}px`;
    }

    function setState(cls) { $('.p').className = 'p ' + cls; }

    function open(title) {
      ensure();
      $('.title').textContent = title;
      $('.steps').textContent = '';
      $('.askbox').hidden = true;
      $('.result').hidden = true;
      setState('running');
      host.hidden = false;
      position();
    }

    function show() { if (host) { host.hidden = false; position(); } }

    function close() {
      if (!host) return;
      host.hidden = true;
      // Pannello chiuso durante una domanda: vale come «no».
      if (pendingAsk) pendingAsk(false);
    }

    function addStep({ text, kind }) {
      ensure();
      const li = document.createElement('li');
      li.className = kind || 'ok';
      li.textContent = text;
      $('.steps').appendChild(li);
      li.scrollIntoView({ block: 'nearest' });
      position();
    }

    function ask(question, { confirmLabel = 'Sì', cancelLabel = 'No' } = {}) {
      ensure();
      show();
      return new Promise(resolve => {
        const box = $('.askbox');
        $('.q').textContent = question;
        const yes = $('.yes'), no = $('.no');
        yes.textContent = confirmLabel;
        no.textContent = cancelLabel;
        box.hidden = false;
        setState('asking');
        position();
        yes.focus({ preventScroll: true });
        const timer = setTimeout(() => finish(false), ASK_TIMEOUT_MS);
        function finish(ok) {
          clearTimeout(timer);
          pendingAsk = null;
          yes.onclick = no.onclick = null;
          box.hidden = true;
          setState('running');
          resolve(ok);
        }
        pendingAsk = finish;
        yes.onclick = () => finish(true);
        no.onclick = () => finish(false);
      });
    }

    function done(result) {
      ensure();
      $('.askbox').hidden = true;
      setState(result.ok ? (result.cancelled ? 'cancelled' : 'done') : 'failed');
      const r = $('.result');
      r.hidden = false;
      // l'errore è già l'ultimo passo dell'elenco: qui va il riepilogo
      r.textContent = result.ok ? result.summary : 'Non completato: leggi il passo in rosso.';
      show();
    }

    return { open, show, close, addStep, ask, done, position };
  })();

  async function runAction(action) {
    const title = action === 'appello' ? 'Appello' : 'Firma ora';
    if (running) { panel.show(); return; }
    if (typeof ArgoAzioni === 'undefined') {
      panel.open(title);
      panel.addStep({ text: 'La pagina non ha caricato gli script dell\'estensione: ricaricala e riprova.', kind: 'error' });
      panel.done({ ok: false });
      return;
    }
    running = true;
    setBusy(action);
    panel.open(title);
    let result;
    try {
      result = await ArgoAzioni.esegui(action, s => panel.addStep(s), {
        ask: (q, o) => panel.ask(q, o),
        docenteNome: settings.docenteNome
      });
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err) };
      panel.addStep({ text: 'Errore imprevisto: ' + result.error, kind: 'error' });
    } finally {
      running = false;
      setBusy(null);
    }
    panel.done(result);
  }

  // ------------------------------------------------------------------
  // Sessione scaduta (segnalata dal service worker)
  // ------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !isCurrent()) return;
    if (msg.type === 'argo-session-expired') {
      assistantToast.show('Sessione di Argo scaduta', msg.text || 'Argo chiede di rifare l\'accesso.', {
        warn: true,
        actions: [
          { label: 'Accedi di nuovo', onClick: () => chrome.runtime.sendMessage({ type: 'relogin-tab' }).catch(() => {}) },
          { label: 'Più tardi', ghost: true, onClick: () => {} }
        ]
      });
      sendResponse({ ok: true });
    }
  });

  // ------------------------------------------------------------------
  // Avvio
  // ------------------------------------------------------------------

  function tick() {
    if (!isCurrent()) {
      clearInterval(timer);
      if (bar) bar.host.remove();
      return;
    }
    if (!settings || !isArgoDashboardUrl(location.href, settings)) {
      if (bar) bar.host.style.display = 'none';
      return;
    }
    if (!bar || !bar.host.isConnected) createBar();
    place();
  }

  let timer = null;
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !isCurrent()) return;
    if (['buttonsTheme', 'buttonsPosition', 'docenteNome', 'argoDashboardPattern', 'argoLoginUrl'].some(k => k in changes)) {
      settings = await loadSettings();
      applyTheme();
      tick();
      panel.position();
    }
  });

  loadSettings().then(s => {
    settings = s;
    if (!isArgoPortalUrl(location.href) && !isArgoDashboardUrl(location.href, s)) return;
    tick();
    // La barra di DidUP compare dopo l'accesso e cambia con la finestra: si ricontrolla spesso (costa poco).
    timer = setInterval(tick, 600);
    window.addEventListener('resize', () => { place(); panel.position(); });
  }).catch(err => console.warn('[Argo DidUP Booster] Pulsanti:', err));
})();
