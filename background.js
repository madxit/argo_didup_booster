// =====================================================================
// background.js — service worker
//   • clic sull'icona → si arriva ad Argo: registro già aperto e con la
//     sessione valida in primo piano, altrimenti accesso automatico
//     (codice scuola, "SPID - CIE - EIDAS", provider o CIE: login.js / eid.js).
//     Se sei già nel registro con la sessione valida, il clic apre le
//     impostazioni. Senza codice scuola apre le impostazioni.
//   • mantenimento della sessione: ogni minuto (chrome.alarms, anche con il
//     registro in una scheda in secondo piano) rinnova il token di accesso
//     prima che scada e fa una richiesta autenticata al server
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
// Mantenimento della sessione (unico metodo)
// DidUP usa due credenziali (vedi CLAUDE.md):
//   • il token OIDC (Authorization: Bearer), che dura circa un'ora: DidUP
//     prova a rinnovarlo da solo un minuto prima che scada, ma se la scheda
//     è in secondo piano o il tentativo fallisce la sessione si perde;
//   • la sessione applicativa (x-auth-token), che il server chiude se non
//     riceve richieste.
// Ogni minuto, per ogni scheda del registro (anche in secondo piano):
//   1. se il token scade entro 10 minuti lo rinnova con lo stesso comando
//      di DidUP (signinSilent, senza ricaricare la pagina);
//   2. ogni 4 minuti fa una richiesta autenticata di sola lettura.
// Ricaricare la pagina non serve: DidUP rilegge lo stesso token.
// ---------------------------------------------------------------------

const KEEPALIVE_ALARM = 'argo-keepalive';

async function ensureKeepAliveAlarm() {
  const a = await chrome.alarms.get(KEEPALIVE_ALARM);
  if (!a) await chrome.alarms.create(KEEPALIVE_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}

// Eseguita nella pagina (world MAIN). Lo stato tra un giro e l'altro resta nella pagina.
async function keepAliveInPage(pingEveryMs, renewBeforeSec) {
  const E = window.Ext, W = window.WSX;
  if (!E || !E.Ajax || typeof window.getUrlBase !== 'function') return { state: 'not-ready' };
  const headersNow = () => Object.assign({}, E.Ajax.getDefaultHeaders && E.Ajax.getDefaultHeaders());
  if (!headersNow().Authorization) return { state: 'not-logged' };
  const st = window.__argoBoosterKa || (window.__argoBoosterKa = { lastPing: 0, lastRenewTry: 0, lastRenew: 0, expired: false });
  const out = { state: 'ok', pinged: false, renewed: false };
  const errText = e => String((e && (e.error || e.message)) || e);

  // 1. Token di accesso
  const mgr = W && W.util && W.util.userManager;
  let user = null;
  if (mgr && typeof mgr.getUser === 'function') {
    try { user = await mgr.getUser(); } catch (e) { out.tokenError = errText(e); }
  } else {
    out.noOidc = true;
  }
  if (user && typeof user.expires_in === 'number') {
    out.expiresIn = user.expires_in;
    if (user.expires_in <= renewBeforeSec && Date.now() - st.lastRenewTry > 50000 && typeof mgr.signinSilent === 'function') {
      st.lastRenewTry = Date.now();
      out.renewTried = true;
      try {
        const nu = await mgr.signinSilent();
        if (nu && nu.access_token) {
          if (W.util.handleAuthSessionRenewed) W.util.handleAuthSessionRenewed(nu);
          else E.Ajax.setDefaultHeaders(Object.assign(headersNow(), { Authorization: 'Bearer ' + nu.access_token }));
          out.renewed = true;
          out.expiresIn = nu.expires_in;
          st.lastRenew = Date.now();
        } else {
          out.renewError = 'nessun token ricevuto';
        }
      } catch (e) {
        out.renewError = errText(e);
      }
    }
  }

  // 2. Richiesta autenticata (come quelle del registro)
  if (out.renewed || Date.now() - st.lastPing >= pingEveryMs) {
    st.lastPing = Date.now();
    out.pinged = true;
    try {
      const res = await fetch(window.getUrlBase() + 'archiviostampe/struttura', {
        method: 'GET', headers: Object.assign(headersNow(), { 'Content-Type': 'application/json' }), credentials: 'include', cache: 'no-store'
      });
      try { await res.body?.cancel(); } catch (e) { /* ignora */ }
      out.httpStatus = res.status;
      if ([401, 402, 406].includes(res.status)) out.state = 'expired';
      else if (!res.ok) out.state = 'error';
    } catch (e) {
      out.state = 'error';
      out.error = errText(e);
    }
  }
  if (user && user.expired && !out.renewed) out.state = 'expired';
  out.firstExpired = out.state === 'expired' && !st.expired;
  st.expired = out.state === 'expired';
  out.lastRenew = st.lastRenew;
  return out;
}

function describeRenewError(err) {
  if (/login_required|interaction_required|consent_required/i.test(err || '')) {
    return 'Argo non permette di rinnovare l\'accesso senza di te: serve un nuovo accesso con SPID o CIE';
  }
  if (/timeout/i.test(err || '')) return 'il server di Argo non ha risposto in tempo';
  return err || 'errore sconosciuto';
}

let keepAliveRunning = false;
async function keepAliveTick() {
  if (keepAliveRunning) return;
  keepAliveRunning = true;
  try {
    const s = await loadSettings();
    const tabs = (await chrome.tabs.query({ url: ARGO_TABS })).filter(t => isArgoDashboardUrl(t.url, s));
    // Con il mantenimento attivo Chrome non deve "scaricare" la scheda (Risparmio memoria).
    for (const t of tabs) {
      if (t.autoDiscardable !== !s.keepAliveEnabled) chrome.tabs.update(t.id, { autoDiscardable: !s.keepAliveEnabled }).catch(() => {});
    }
    if (!s.keepAliveEnabled) return;
    let status = null;
    for (const tab of tabs) {
      if (tab.discarded) continue;
      let r = null;
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN', func: keepAliveInPage,
          args: [KEEPALIVE_PING_EVERY_SEC * 1000, KEEPALIVE_RENEW_BEFORE_SEC]
        });
        r = res && res[0] && res[0].result;
      } catch (e) {
        r = null;            // scheda non accessibile in questo momento
      }
      if (!r || r.state === 'not-ready' || r.state === 'not-logged') continue;
      if (r.firstExpired) {
        const text = r.renewError ? `${describeRenewError(r.renewError)}.` : 'Il server di Argo ha chiuso la sessione.';
        chrome.tabs.sendMessage(tab.id, { type: 'argo-session-expired', text }).catch(() => {});
      }
      if (!r.pinged && !r.renewed && !r.renewTried && r.state === 'ok') continue;
      const entry = {
        time: Date.now(), tabId: tab.id, ok: r.state === 'ok', expired: r.state === 'expired',
        action: r.renewed ? 'renew' : r.pinged ? 'ping' : 'check', httpStatus: r.httpStatus,
        tokenExpiresAt: typeof r.expiresIn === 'number' ? Date.now() + r.expiresIn * 1000 : null,
        lastRenewAt: r.lastRenew || null, renewError: r.renewError ? describeRenewError(r.renewError) : null,
        error: r.error || null, noOidc: Boolean(r.noOidc)
      };
      // Con più schede del registro conta quella che va meglio.
      if (!status || (entry.ok && !status.ok)) status = entry;
    }
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
        target, files: ['settings.js', 'content-common.js', 'argomenti.js', 'azioni.js', 'toolbar.js']
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
    case 'relogin-tab':
      // «Accedi di nuovo» dall'avviso di sessione scaduta nella pagina.
      if (sender.tab) loadSettings().then(st => restartLoginIn(sender.tab, st)).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
      return true;
    case 'open-options':
      chrome.runtime.openOptionsPage();
      return;
    case 'go-registro':
      goToRegistro(msg.tab || null).then(sendResponse, err => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
  }
});
