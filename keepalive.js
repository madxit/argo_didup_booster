// =====================================================================
// keepalive.js — content script attivo sulle pagine di portaleargo.it.
// Una volta dentro l'applicazione (dopo l'accesso SPID) mantiene viva la
// sessione:
//   • "ping"   → ogni N secondi fa una chiamata API leggera e di sola
//                lettura con le stesse credenziali del registro (token OIDC
//                + x-auth-token, tramite page-bridge.js): il server vede la
//                sessione come attiva. La pagina NON viene ricaricata.
//                (DidUP tiene i token nella scheda: chiedere di nuovo la
//                pagina /voti/ non rinnoverebbe nulla.)
//   • "reload" → ricarica la pagina, ma solo se non la stai usando e non
//                hai digitato nulla; altrimenti esegue un ping.
// =====================================================================

(() => {
  const instanceId = Math.random().toString(36).slice(2);
  // L'ultima istanza iniettata "vince" (utile dopo un aggiornamento
  // dell'estensione, quando la vecchia istanza resta orfana).
  document.documentElement.dataset.argoAssistantKa = instanceId;

  let settings = null;
  let timer = null;
  let active = null;
  let lastUserActivity = Date.now();
  let typedSinceLoad = false;

  const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'];
  for (const ev of ACTIVITY_EVENTS) {
    window.addEventListener(ev, e => {
      if (e.isTrusted) lastUserActivity = Date.now();
    }, { capture: true, passive: true });
  }
  window.addEventListener('input', e => {
    if (e.isTrusted) typedSinceLoad = true;
  }, true);

  function isCurrentInstance() {
    return document.documentElement.dataset.argoAssistantKa === instanceId &&
      typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
  }

  function setActive(value) {
    if (active === value) return;
    active = value;
    // Il service worker impedisce a Chrome di "scaricare" la scheda
    // (Risparmio memoria) mentre la sessione va mantenuta.
    chrome.runtime.sendMessage({ type: 'keepalive-state', active: value }).catch(() => {});
    // Nuovo avvio (es. dopo un nuovo accesso): azzera l'eventuale stato
    // "sessione scaduta" lasciato dalla pagina precedente.
    if (value) writeStatus({ ok: true, action: 'start' }).catch(() => {});
  }

  function shouldRun() {
    return settings && settings.keepAliveEnabled && isArgoDashboardUrl(location.href, settings);
  }

  function schedule() {
    stop();
    if (!isCurrentInstance()) return;
    const run = shouldRun();
    setActive(run);
    if (!run) return;
    timer = setTimeout(tick, settings.keepAliveInterval * 1000);
  }

  async function ping() {
    const r = await callPageBridge('ping');
    if (r.reason === 'app-not-ready' || r.reason === 'not-logged') {
      // Registro non ancora caricato (o in fase di accesso): si riprova al giro dopo.
      return { ok: true, skipped: r.reason };
    }
    if (r.reason === 'error') throw new Error(r.error || 'errore');
    return { ok: Boolean(r.ok), expired: Boolean(r.expired), httpStatus: r.httpStatus };
  }

  async function writeStatus(status) {
    await chrome.storage.local.set({
      keepAliveStatus: { time: Date.now(), method: settings.keepAliveMethod, ...status }
    });
  }

  async function tick() {
    timer = null;
    if (!isCurrentInstance()) return;
    if (!shouldRun()) { schedule(); return; }

    try {
      const intervalMs = settings.keepAliveInterval * 1000;
      const idle = Date.now() - lastUserActivity >= intervalMs;
      if (settings.keepAliveMethod === 'reload' && idle && !typedSinceLoad) {
        await writeStatus({ ok: true, action: 'reload' });
        location.reload();
        return;
      }
      const result = await ping();
      if (!result.skipped) await writeStatus({ ...result, action: 'ping' });
      if (result.expired) {
        console.warn('[Argo DidUP Booster] Sessione scaduta: mantenimento sospeso.');
        setActive(false);
        return;
      }
    } catch (err) {
      if (!isCurrentInstance()) return;
      console.warn('[Argo DidUP Booster] Keep-alive non riuscito:', err);
      try { await writeStatus({ ok: false, action: 'ping', error: String(err.message || err) }); } catch (e) { return; }
    }
    schedule();
  }

  const WATCHED_KEYS = ['keepAliveEnabled', 'keepAliveInterval', 'keepAliveMethod', 'argoLoginUrl', 'argoDashboardPattern'];

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !isCurrentInstance()) return;
    if (!WATCHED_KEYS.some(k => k in changes)) return;
    settings = await loadSettings();
    schedule();
  });

  loadSettings().then(s => {
    settings = s;
    schedule();
  }).catch(err => console.warn('[Argo DidUP Booster] Impossibile leggere le impostazioni:', err));
})();
