// =====================================================================
// content-common.js — utilità condivise dai content script
// (portaleargo.it ed eid.istruzione.it).
// =====================================================================

// Deve coincidere con CHANNEL di page-bridge.js.
var PAGE_BRIDGE_CHANNEL = 'v4';

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

// Guida interattiva (prima volta che compaiono le funzioni dell'estensione):
// sfondo scuro, l'elemento spiegato resta illuminato e accanto c'è un riquadro
// con il testo e i pulsanti Indietro / Avanti / Fine.
//   steps: [{ target: () => Element | null, title, text, round, action: { label, onClick } }]
// Restituisce una Promise che si risolve alla chiusura.
var assistantGuide = (() => {
  let current = null;

  function close() {
    if (!current) return;
    const { host, timer, onKey, resolve } = current;
    clearInterval(timer);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', current.place);
    host.remove();
    current = null;
    resolve();
  }

  function show(steps, { brand = 'Argo DidUP Booster' } = {}) {
    close();
    steps = steps.filter(Boolean);
    if (!steps.length) return Promise.resolve();
    return new Promise(resolve => {
      const host = document.createElement('div');
      host.setAttribute('data-argo-assistant', 'guide');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .catch { position: fixed; inset: 0; }
          .hole { position: fixed; border-radius: 12px; pointer-events: none;
                  box-shadow: 0 0 0 3px #fff, 0 0 0 200vmax rgba(15, 23, 42, .68);
                  transition: left .25s, top .25s, width .25s, height .25s; }
          .hole.round { border-radius: 999px; }
          .hole::after { content: ''; position: absolute; inset: -9px; border-radius: inherit; border: 2px solid rgba(255,255,255,.75);
                         animation: ring 1.6s ease-out infinite; }
          @keyframes ring { from { opacity: 1; transform: scale(.92); } to { opacity: 0; transform: scale(1.25); } }
          .card { position: fixed; width: 360px; max-width: calc(100vw - 24px); background: #fff; color: #1f2937; border-radius: 14px;
                  box-shadow: 0 24px 60px rgba(0,0,0,.35); font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; overflow: hidden; }
          .brand { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #f1f5f9; color: #475569;
                   font-size: 12px; font-weight: 600; letter-spacing: .01em; }
          .logo { width: 20px; height: 20px; border-radius: 6px; background: #1d4ed8; color: #fff; display: grid; place-items: center; font-size: 11px; font-weight: 700; }
          .count { margin-left: auto; font-weight: 500; }
          .body { padding: 12px 16px 6px; }
          h3 { margin: 0 0 6px; font-size: 16px; color: #0f172a; }
          p { margin: 0 0 8px; white-space: pre-line; }
          .foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px 14px; flex-wrap: wrap; }
          .sp { flex: 1; }
          button { font: inherit; font-weight: 600; border-radius: 9px; padding: 7px 14px; cursor: pointer; border: 1px solid transparent; }
          .next { background: #1d4ed8; color: #fff; }
          .next:hover { background: #1e40af; }
          .back, .extra { background: #fff; color: #334155; border-color: #cbd5e1; }
          .back:hover, .extra:hover { background: #f1f5f9; }
          .skip { background: transparent; color: #64748b; padding: 7px 6px; }
          .skip:hover { color: #0f172a; text-decoration: underline; }
          [hidden] { display: none !important; }
        </style>
        <div class="catch"></div>
        <div class="hole"></div>
        <div class="card" role="dialog" aria-modal="true" aria-labelledby="g-title">
          <div class="brand"><span class="logo">A</span><span></span><span class="count"></span></div>
          <div class="body"><h3 id="g-title"></h3><p class="text"></p></div>
          <div class="foot"><button class="skip" type="button">Salta la guida</button><span class="sp"></span>
            <button class="extra" type="button" hidden></button><button class="back" type="button">Indietro</button><button class="next" type="button"></button></div>
        </div>`;
      const $ = s => root.querySelector(s);
      $('.brand span:nth-child(2)').textContent = brand;
      const card = $('.card'), hole = $('.hole');
      // Né clic né tasti devono arrivare a DidUP mentre la guida è aperta.
      for (const type of ['mousedown', 'pointerdown', 'mouseup', 'click', 'keydown', 'keyup', 'wheel']) {
        root.addEventListener(type, e => e.stopPropagation());
      }
      let i = 0;
      const place = () => {
        const step = steps[i];
        const el = step.target && step.target();
        const vw = window.innerWidth, vh = window.innerHeight;
        let r = el && el.isConnected ? el.getBoundingClientRect() : null;
        if (r && r.width === 0 && r.height === 0) r = null;
        const pad = step.round ? 7 : 8;
        if (r) {
          hole.hidden = false;
          hole.classList.toggle('round', Boolean(step.round));
          Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
        } else {
          hole.hidden = true;
        }
        const cw = card.offsetWidth, ch = card.offsetHeight;
        let left, top;
        if (r) {
          left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), vw - cw - 12);
          top = r.bottom + pad + 14;
          if (top + ch > vh - 12) top = Math.max(12, r.top - pad - 14 - ch);
        } else {
          left = (vw - cw) / 2;
          top = Math.max(12, (vh - ch) / 2);
        }
        card.style.left = `${Math.round(left)}px`;
        card.style.top = `${Math.round(top)}px`;
      };
      const render = () => {
        const step = steps[i];
        $('h3').textContent = step.title;
        $('.text').textContent = step.text;
        $('.count').textContent = steps.length > 1 ? `${i + 1} di ${steps.length}` : '';
        $('.back').hidden = i === 0;
        $('.next').textContent = i === steps.length - 1 ? 'Ho capito' : 'Avanti';
        $('.skip').hidden = i === steps.length - 1;
        const extra = $('.extra');
        extra.hidden = !step.action;
        if (step.action) extra.textContent = step.action.label;
        place();
        $('.next').focus({ preventScroll: true });
      };
      $('.next').addEventListener('click', () => { if (i < steps.length - 1) { i++; render(); } else close(); });
      $('.back').addEventListener('click', () => { if (i > 0) { i--; render(); } });
      $('.skip').addEventListener('click', close);
      $('.extra').addEventListener('click', () => { const a = steps[i].action; if (a) a.onClick(); });
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); $('.next').click(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); $('.back').click(); }
      };
      (document.body || document.documentElement).appendChild(host);
      current = { host, resolve, onKey, place, timer: setInterval(() => place(), 400) };
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', place);
      render();
    });
  }

  return { show, close, isOpen: () => Boolean(current) };
})();
