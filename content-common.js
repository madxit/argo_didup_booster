// =====================================================================
// content-common.js — utilità condivise dai content script
// (portaleargo.it ed eid.istruzione.it).
// =====================================================================

// Deve coincidere con CHANNEL di page-bridge.js.
var PAGE_BRIDGE_CHANNEL = 'v3';

// Chiama page-bridge.js (world MAIN) e attende la risposta.
function callPageBridge(action, payload = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const onResponse = e => {
      let msg;
      try { msg = JSON.parse(e.detail); } catch (err) { return; }
      if (!msg || msg.id !== id) return;
      cleanup();
      resolve(msg.result || { ok: false, reason: 'empty' });
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('La pagina non risponde (bridge)'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      document.removeEventListener('argo-assistant:response:' + PAGE_BRIDGE_CHANNEL, onResponse);
    }
    document.addEventListener('argo-assistant:response:' + PAGE_BRIDGE_CHANNEL, onResponse);
    document.dispatchEvent(new CustomEvent('argo-assistant:request:' + PAGE_BRIDGE_CHANNEL, {
      detail: JSON.stringify({ id, action, payload })
    }));
  });
}

// Attende che `check()` restituisca qualcosa (la pagina può comporre il
// contenuto dopo il caricamento). Restituisce il risultato o null.
function waitForElement(check, timeoutMs = 10000) {
  return new Promise(resolve => {
    const first = check();
    if (first) { resolve(first); return; }
    let timer = null;
    const obs = new MutationObserver(() => {
      const found = check();
      if (!found) return;
      obs.disconnect();
      clearTimeout(timer);
      resolve(found);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    timer = setTimeout(() => { obs.disconnect(); resolve(check() || null); }, timeoutMs);
  });
}

function extensionAlive() {
  return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
}

function openExtensionOptions() {
  chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {});
}

// Piccolo avviso flottante (in shadow DOM per non subire gli stili della pagina).
var assistantToast = (() => {
  let host, box, timer, onDismiss = null;
  function ensure() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-argo-assistant', 'toast');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .t { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; max-width: 360px;
             display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px;
             background: #111827; color: #fff; font: 13.5px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
             box-shadow: 0 10px 30px rgba(0,0,0,.25); }
        .t.warn { background: #7f1d1d; }
        .logo { flex: none; width: 22px; height: 22px; border-radius: 6px; background: #2563eb;
                display: grid; place-items: center; font-weight: 700; font-size: 12px; }
        .body { flex: 1; }
        .title { font-weight: 700; display: block; margin-bottom: 1px; }
        .actions { margin-top: 8px; display: flex; gap: 8px; }
        button { font: inherit; font-weight: 600; border: 0; border-radius: 7px; padding: 5px 10px; cursor: pointer;
                 background: #2563eb; color: #fff; }
        button.ghost { background: rgba(255,255,255,.12); }
        .x { background: transparent; color: #9ca3af; padding: 0 2px; font-size: 16px; line-height: 1; }
        [hidden] { display: none !important; }
      </style>
      <div class="t" role="status" aria-live="polite">
        <div class="logo">A</div>
        <div class="body"><span class="title"></span><span class="msg"></span><div class="actions"></div></div>
        <button class="x" title="Chiudi" aria-label="Chiudi">×</button>
      </div>`;
    box = root.querySelector('.t');
    root.querySelector('.x').addEventListener('click', () => {
      const cb = onDismiss;
      hide();
      if (cb) cb();
    });
    (document.body || document.documentElement).appendChild(host);
  }
  function hide() {
    clearTimeout(timer);
    onDismiss = null;
    if (host) host.remove();
    host = null;
  }
  // actions: [{ label, onClick, ghost }]; onDismiss: chiuso con ×
  function show(title, msg, { warn = false, actions = [], duration = 0, onDismiss: dismiss = null } = {}) {
    ensure();
    onDismiss = dismiss;
    box.classList.toggle('warn', warn);
    box.querySelector('.title').textContent = title;
    box.querySelector('.msg').textContent = msg || '';
    const act = box.querySelector('.actions');
    act.textContent = '';
    act.hidden = actions.length === 0;
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.ghost) b.className = 'ghost';
      b.addEventListener('click', () => { hide(); a.onClick(); });
      act.appendChild(b);
    }
    clearTimeout(timer);
    if (duration) timer = setTimeout(hide, duration);
  }
  return { show, hide };
})();
