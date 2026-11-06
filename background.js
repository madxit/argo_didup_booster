// =====================================================================
// background.js — service worker
//   • clic sull'icona → si arriva ad Argo: registro già aperto e con la
//     sessione valida in primo piano, altrimenti accesso automatico
//     (codice scuola, "SPID - CIE - EIDAS", provider o CIE: login.js / eid.js).
//     Se sei già nel registro con la sessione valida, il clic apre le
//     impostazioni. Senza codice scuola apre le impostazioni.
//   • mantenimento della sessione: ogni minuto (chrome.alarms, anche con il
//     registro in una scheda in secondo piano) ricarica il registro quando
//     non lo usi da qualche minuto o quando la sessione è scaduta
//   • badge "!" finché manca il codice scuola
// =====================================================================

importScripts('settings.js');

const ARGO_TABS = 'https://*.portaleargo.it/*';
const PROBE_TIMEOUT_MS = 6000;

// ---------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------

async function updateBadge() {
  const s = await loadSettings();
  if (!s.codiceScuola) {
    await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: 'Argo DidUP Booster — imposta il codice scuola nelle impostazioni' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'Argo DidUP Booster — accedi al registro' });
  }
}

// ---------------------------------------------------------------------
// Niente popup: Firma e Appello sono pulsanti nella pagina del registro
// (toolbar.js). Le versioni fino alla 1.0 impostavano un popup per scheda:
// dopo l'aggiornamento si tolgono, così il clic arriva sempre a onClicked.
// ---------------------------------------------------------------------

async function clearPopups() {
  await chrome.action.setPopup({ popup: '' });
  const tabs = await chrome.tabs.query({ url: ARGO_TABS });
  await Promise.all(tabs.map(t => chrome.action.setPopup({ tabId: t.id, popup: '' }).catch(() => {})));
}

// ---------------------------------------------------------------------
// Stato della sessione in una scheda del registro già aperta
// ---------------------------------------------------------------------

// Eseguita nella pagina (world MAIN): 'ok' | 'expired' | 'not-logged' | 'not-ready' | 'error'
async function probeDidupSession() {
  const E = window.Ext;
  if (!E || !E.Ajax || typeof window.getUrlBase !== 'function') return 'not-ready';
  const headers = Object.assign({}, E.Ajax.getDefaultHeaders && E.Ajax.getDefaultHeaders());
  if (!headers.Authorization) return 'not-logged';
  try {
    const res = await fetch(window.getUrlBase() + 'archiviostampe/struttura', {
      method: 'GET', headers, credentials: 'include', cache: 'no-store'
    });
    try { await res.body?.cancel(); } catch (e) { /* ignora */ }
    if ([401, 402, 406].includes(res.status)) return 'expired';
    return res.ok ? 'ok' : 'error';
  } catch (e) {
    return 'error';
  }
}

async function probeTabSession(tab) {
  if (tab.discarded) return 'discarded';
  try {
    const run = chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: probeDidupSession });
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), PROBE_TIMEOUT_MS));
    const res = await Promise.race([run, timeout]);
    return (res && res[0] && res[0].result) || 'error';
  } catch (e) {
    return 'error';
  }
}

// ---------------------------------------------------------------------
// "Portami al registro"
// ---------------------------------------------------------------------

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function restartLoginIn(tab, s) {
  await setLoginFlow({ startedAt: Date.now(), stage: 'argo' });
  await chrome.tabs.update(tab.id, { url: s.basePortalUrl, active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function goToRegistro(currentTab = null) {
  const s = await loadSettings();
  if (!s.codiceScuola) {
    await chrome.runtime.openOptionsPage();
    return { ok: false, reason: 'missing-code' };
  }

  // Già sulla pagina di accesso di Argo: l'accesso parte da lì.
  if (currentTab && isArgoPortalUrl(currentTab.url) && !isArgoDashboardUrl(currentTab.url, s)) {
    try {
      const r = await chrome.tabs.sendMessage(currentTab.id, { type: 'argo-login-now' });
      if (r && r.ok) return { ok: true, action: 'login-here' };
    } catch (e) { /* pagina senza script (aperta prima di un aggiornamento) */ }
  }

  const tabs = await chrome.tabs.query({ url: ARGO_TABS });

  // Registro già aperto: se la sessione è valida basta mostrarlo,
  // se è scaduta si rifà l'accesso in quella scheda.
  const dashboards = tabs
    .filter(t => isArgoDashboardUrl(t.url, s))
    .sort((a, b) => (b.active - a.active) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
  for (const t of dashboards) {
    const state = await probeTabSession(t);
    if (state === 'expired' || state === 'not-logged') continue;
    if (state === 'discarded') {
      // Chrome la ricarica appena torna attiva: se la sessione non c'è più, l'accesso parte da solo.
      await setLoginFlow({ startedAt: Date.now(), stage: 'argo' });
    }
    await focusTab(t);
    return { ok: true, action: 'focus', state };
  }
  if (dashboards.length) {
    await restartLoginIn(dashboards[0], s);
    return { ok: true, action: 'relogin' };
  }

  // Altre pagine di Argo (es. accesso lasciato a metà): si riparte da /voti.
  const other = (currentTab && isArgoPortalUrl(currentTab.url) && currentTab) || tabs.find(t => isArgoPortalUrl(t.url));
  if (other) {
    await restartLoginIn(other, s);
    return { ok: true, action: 'reuse' };
  }

  await setLoginFlow({ startedAt: Date.now(), stage: 'argo' });
  await chrome.tabs.create({ url: s.basePortalUrl });
  return { ok: true, action: 'create' };
}

// Clic sull'icona: registro aperto e sessione valida → impostazioni;
// altrimenti → Argo (accesso automatico se serve).
async function handleIconClick(tab) {
  const s = await loadSettings();
  if (!s.codiceScuola) {
    await chrome.runtime.openOptionsPage();
    return { ok: false, reason: 'missing-code' };
  }
  if (tab && isArgoDashboardUrl(tab.url, s) && await probeTabSession(tab) === 'ok') {
    await chrome.runtime.openOptionsPage();
    return { ok: true, action: 'options' };
  }
  return goToRegistro(tab);
}

chrome.action.onClicked.addListener(async tab => {
  // File aggiornati sul disco: prima si ricarica l'estensione, poi il clic viene ripetuto da solo.
  if (await reloadIfStale({ action: 'icon-click', tabId: tab && tab.id })) return;
  await handleIconClick(tab);
});

// ---------------------------------------------------------------------
// Mantenimento della sessione (unico metodo): ricarica della pagina quando
// non la stai usando.
// DidUP usa due credenziali (vedi CLAUDE.md):
//   • il token OIDC (Authorization: Bearer), che dura circa un'ora: DidUP lo
//     rinnova da solo, ma Argo lo permette solo se all'accesso è stata
//     spuntata «Ricordami» (lo fa login.js); altrimenti chiede di nuovo SPID;
//   • la sessione sul server (x-auth-token), che si chiude se non riceve
//     richieste.
// Ogni minuto, per ogni scheda del registro (anche in secondo piano):
//   • se non la usi da KEEPALIVE_IDLE_MIN minuti (nessun clic, tasto,
//     movimento del mouse o cambio di schermata: sessione.js) la ricarica,
//     come il tasto Ricarica del browser. Ogni tuo uso o ricarica fa
//     ripartire il conteggio, quindi mentre lavori non succede mai;
//   • se la sessione è già scaduta, la ricarica dopo un minuto di inattività:
//     con il token scaduto DidUP passa dalla pagina di accesso di Argo, che
//     con «Ricordami» fa rientrare senza SPID;
//   • non ricarica mai se è aperta una finestra di DidUP (es. la modifica di
//     una lezione), la guida o Firma/Appello sta lavorando.
// ---------------------------------------------------------------------

const KEEPALIVE_ALARM = 'argo-keepalive';
const SESSION_LOG_MAX = 10;

async function ensureKeepAliveAlarm() {
  const a = await chrome.alarms.get(KEEPALIVE_ALARM);
  if (!a) await chrome.alarms.create(KEEPALIVE_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}

// Eseguita nella pagina (world MAIN): stato della sessione e se la pagina si può ricaricare.
async function sessionInPage() {
  const E = window.Ext, W = window.WSX, root = document.documentElement;
  const num = v => Number(v) || null;
  const out = { state: 'ok', loadedAt: num(root.dataset.argoBoosterLoadedAt), lastActivity: num(root.dataset.argoBoosterActivity) };
  if (!E || !E.Ajax || typeof window.getUrlBase !== 'function') { out.state = 'not-ready'; return out; }
  const headers = Object.assign({}, E.Ajax.getDefaultHeaders && E.Ajax.getDefaultHeaders());
  if (!headers.Authorization) { out.state = 'not-logged'; return out; }
  const shown = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight &&
      getComputedStyle(el).visibility !== 'hidden';
  };
  const EXPIRED_TEXT = /sessione\s+scaduta|accesso non consentito|eseguire il login/i;
  // 1. DidUP ha già mostrato «Sessione scaduta»?
  const boxes = [...document.querySelectorAll('.x-window, .x-message-box')].filter(shown);
  let expiredBox = false;
  try {
    expiredBox = Boolean(E.ComponentQuery && E.ComponentQuery.query('box-sessione-scaduta-view').some(c => c.isVisible && c.isVisible()));
  } catch (e) { /* ignora */ }
  if (expiredBox) { out.state = 'expired'; out.why = 'box'; }
  else if (boxes.some(b => EXPIRED_TEXT.test(b.textContent || ''))) { out.state = 'expired'; out.why = 'msg'; }
  // 2. Token di accesso
  const mgr = W && W.util && W.util.userManager;
  if (mgr && typeof mgr.getUser === 'function') {
    try {
      const user = await mgr.getUser();
      if (user && user.expires_at) out.tokenExpiresAt = user.expires_at * 1000;
      if (user && user.expired && out.state === 'ok') { out.state = 'expired'; out.why = 'token'; }
    } catch (e) { /* ignora */ }
  }
  // 3. Si può ricaricare senza far perdere niente?
  if (root.dataset.argoBoosterBusy) out.busy = 'Firma ora o Appello sta lavorando';
  else if (document.querySelector('[data-argo-assistant="guide"]')) out.busy = 'è aperta la guida dell\'estensione';
  else if (boxes.some(b => !b.classList.contains('x-message-box') && !EXPIRED_TEXT.test(b.textContent || ''))) {
    out.busy = 'è aperta una finestra di DidUP (per esempio la modifica di una lezione)';
  } else {
    const a = document.activeElement;
    if (a && a.tagName === 'TEXTAREA' && a.value) out.busy = 'stai scrivendo in una casella';
  }
  return out;
}

// Stato per scheda tra un giro e l'altro (ultima ricarica e perché).
let kaMemory = {};
async function loadKaTabs() {
  try { return (await chrome.storage.session.get('kaTabs')).kaTabs || {}; } catch (e) { return kaMemory; }
}
async function saveKaTabs(tabs) {
  try { await chrome.storage.session.set({ kaTabs: tabs }); } catch (e) { kaMemory = tabs; }
}

function currentIdleMin(stored) {
  const n = Number(stored);
  return n >= KEEPALIVE_IDLE_MIN_FLOOR && n <= KEEPALIVE_IDLE_MIN ? n : KEEPALIVE_IDLE_MIN;
}

// Ogni scadenza osservata viene annotata (Impostazioni → Sessione): serve a
// capire quanto dura davvero la sessione. Se il server l'ha chiusa prima
// della ricarica, la soglia di inattività si accorcia.
async function noteExpiry(r, idleMs, idleMin, now) {
  const { sessionLog = [] } = await chrome.storage.local.get('sessionLog');
  const entry = {
    at: now, why: r.why,
    sinceLoadMin: r.loadedAt ? Math.round((now - r.loadedAt) / 60000) : null,
    idleMin: Math.round(idleMs / 60000)
  };
  const out = { sessionLog: [entry, ...sessionLog].slice(0, SESSION_LOG_MAX) };
  if (r.why === 'msg' && !r.busy && entry.idleMin <= idleMin + 2) {
    const shorter = Math.max(KEEPALIVE_IDLE_MIN_FLOOR, Math.floor(entry.idleMin * 0.6));
    if (shorter < idleMin) out.keepAliveIdleMin = shorter;
  }
  await chrome.storage.local.set(out);
}

function expiredText(r) {
  if (r.busy) return `È aperta una finestra di DidUP: non ricarico la pagina per non farti perdere quello che stai scrivendo. Copialo, poi premi «Ricarica ora».`;
  return 'Ricarico il registro appena smetti di usarlo (dopo un minuto). Se all\'accesso era spuntato «Ricordami», Argo ti fa rientrare senza SPID.';
}

let keepAliveRunning = false;
async function keepAliveTick() {
  if (keepAliveRunning) return;
  keepAliveRunning = true;
  try {
    const s = await loadSettings();
    const all = await chrome.tabs.query({ url: ARGO_TABS });
    const tabs = all.filter(t => isArgoDashboardUrl(t.url, s));
    // Con il mantenimento attivo Chrome non deve "scaricare" la scheda (Risparmio memoria).
    for (const t of tabs) {
      if (t.autoDiscardable !== !s.keepAliveEnabled) chrome.tabs.update(t.id, { autoDiscardable: !s.keepAliveEnabled }).catch(() => {});
    }
    if (!s.keepAliveEnabled) return;
    const now = Date.now();
    const kt = await loadKaTabs();
    const idleMin = currentIdleMin((await chrome.storage.local.get('keepAliveIdleMin')).keepAliveIdleMin);
    let status = null;

    // Ricaricata da poco ed è finita sulla pagina di accesso: Argo chiede di nuovo SPID o CIE.
    for (const t of all) {
      const k = kt[t.id];
      if (k && k.reloadAt && !k.loginNoted && now - k.reloadAt < 5 * 60000 && !isArgoDashboardUrl(t.url, s)) {
        k.loginNoted = true;
        status = { time: now, tabId: t.id, ok: false, expired: true, action: 'login', loginRequired: true, idleMin,
          lastReloadAt: k.reloadAt, lastReloadReason: k.reason };
      }
    }

    for (const tab of tabs) {
      if (tab.discarded) continue;
      let r = null;
      try {
        const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: sessionInPage });
        r = res && res[0] && res[0].result;
      } catch (e) {
        r = null;            // scheda non accessibile in questo momento
      }
      if (!r || r.state === 'not-ready' || r.state === 'not-logged') continue;
      const k = kt[tab.id] || (kt[tab.id] = {});
      const lastUse = Math.max(r.lastActivity || 0, r.loadedAt || 0) || tab.lastAccessed || now;
      const idleMs = Math.max(0, now - lastUse);
      const entry = {
        time: now, tabId: tab.id, ok: r.state === 'ok', expired: r.state === 'expired', why: r.why || null,
        action: 'check', idleMin, idleSec: Math.round(idleMs / 1000), lastUse, nextReloadAt: lastUse + idleMin * 60000,
        tokenExpiresAt: r.tokenExpiresAt || null, busy: r.busy || null,
        lastReloadAt: k.reloadAt || null, lastReloadReason: k.reason || null
      };
      let reload = null;
      if (r.state === 'expired') {
        if (k.expiredLoadedAt !== (r.loadedAt || 0)) {
          // prima volta che questa pagina risulta scaduta
          k.expiredLoadedAt = r.loadedAt || 0;
          await noteExpiry(r, idleMs, idleMin, now);
          chrome.tabs.sendMessage(tab.id, { type: 'argo-session-expired', text: expiredText(r) }).catch(() => {});
        }
        if (r.busy) entry.action = 'wait-busy';
        else if (idleMs < KEEPALIVE_EXPIRED_IDLE_SEC * 1000) entry.action = 'wait-idle';
        else if (k.expiredReloadAt && now - k.expiredReloadAt < KEEPALIVE_EXPIRED_RETRY_MIN * 60000) entry.action = 'wait-retry';
        else { reload = 'scaduta'; k.expiredReloadAt = now; }
      } else if (idleMs >= idleMin * 60000) {
        if (r.busy) entry.action = 'wait-busy';
        else reload = 'inattività';
      }
      if (reload) {
        try {
          await chrome.tabs.reload(tab.id);
          Object.assign(k, { reloadAt: now, reason: reload, loginNoted: false });
          Object.assign(entry, { action: 'reload', reason: reload, lastReloadAt: now, lastReloadReason: reload, nextReloadAt: now + idleMin * 60000 });
        } catch (e) {
          Object.assign(entry, { action: 'error', error: String((e && e.message) || e) });
        }
      }
      // Con più schede del registro conta quella che va meglio (o quella appena ricaricata).
      if (!status || entry.action === 'reload' || (entry.ok && !status.ok && status.action !== 'reload')) status = entry;
    }
    // Schede chiuse: si dimenticano.
    for (const id of Object.keys(kt)) if (!all.some(t => String(t.id) === id)) delete kt[id];
    await saveKaTabs(kt);
    if (status) await chrome.storage.local.set({ keepAliveStatus: status });
  } finally {
    keepAliveRunning = false;
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === KEEPALIVE_ALARM) keepAliveTick().catch(e => console.warn('[Argo DidUP Booster] keep-alive', e));
});
ensureKeepAliveAlarm().catch(() => {});

// ---------------------------------------------------------------------
// Installazione / aggiornamento / avvio
// ---------------------------------------------------------------------

// Dopo un aggiornamento le schede del registro già aperte non hanno i
// content script: si iniettano subito (senza login.js, che ripartirebbe
// da solo su una pagina di accesso).
async function injectIntoOpenArgoTabs() {
  const s = await loadSettings();
  const tabs = await chrome.tabs.query({ url: ARGO_TABS });
  for (const tab of tabs) {
    if (!isArgoDashboardUrl(tab.url, s)) continue;
    const target = { tabId: tab.id };
    chrome.scripting.executeScript({ target, files: ['page-bridge.js'], world: 'MAIN' })
      .then(() => chrome.scripting.executeScript({
        target, files: ['settings.js', 'content-common.js', 'sessione.js', 'argomenti.js', 'azioni.js', 'toolbar.js']
      }))
      .catch(() => { /* scheda non accessibile (es. scartata) */ });
  }
}

// Dopo che il clic sull'icona o le impostazioni hanno ricaricato l'estensione
// (file aggiornati sul disco) si completa quello che l'utente voleva fare.
async function resumeAfterSelfReload() {
  const { selfReload } = await chrome.storage.local.get('selfReload');
  if (!selfReload || selfReload.handled || !selfReload.after) return;
  await chrome.storage.local.set({ selfReload: { ...selfReload, handled: true } });
  if (Date.now() - selfReload.at > SELF_RELOAD_GUARD_MS) return;
  const { action, tabId } = selfReload.after;
  if (action === 'icon-click') {
    let tab = null;
    try { tab = tabId != null ? await chrome.tabs.get(tabId) : null; } catch (e) { tab = null; }
    await handleIconClick(tab);
  } else if (action === 'go-registro') await goToRegistro();
  else if (action === 'open-options') await chrome.runtime.openOptionsPage();
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Ogni passo è indipendente: se uno fallisce gli altri vanno comunque eseguiti.
  const steps = [updateBadge, clearPopups, ensureKeepAliveAlarm, injectIntoOpenArgoTabs, async () => {
    if (reason !== 'install') return;
    const s = await loadSettings();
    if (!s.codiceScuola) await chrome.runtime.openOptionsPage();
  }, resumeAfterSelfReload];
  for (const step of steps) {
    try { await step(); } catch (e) { console.warn('[Argo DidUP Booster]', step.name || 'install', e); }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
  await ensureKeepAliveAlarm();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('codiceScuola' in changes) updateBadge();
  if ('keepAliveEnabled' in changes) keepAliveTick().catch(() => {});
});

// ---------------------------------------------------------------------
// Messaggi da impostazioni e content script
// ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  switch (msg.type) {
    case 'open-options':
      chrome.runtime.openOptionsPage();
      return;
    case 'go-registro':
      goToRegistro(msg.tab || null).then(sendResponse, err => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
  }
});
