// =====================================================================
// background.js — service worker
//   • clic sull'icona (ovunque tranne che nel registro) → accesso al
//     registro: compila il codice scuola, preme "SPID - CIE - EIDAS" e
//     sceglie provider o CIE (login.js / eid.js)
//   • nel registro il clic apre invece il popup (impostato per scheda)
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
// Popup solo nelle schede del registro
// (senza il permesso "tabs" l'URL è visibile solo per le pagine Argo:
//  per tutte le altre tab.url è vuoto e il clic va a onClicked)
// ---------------------------------------------------------------------

async function syncPopup(tabId, url, settings) {
  try {
    const s = settings || await loadSettings();
    await chrome.action.setPopup({ tabId, popup: isArgoDashboardUrl(url, s) ? 'popup.html' : '' });
  } catch (e) { /* scheda chiusa */ }
}

async function syncAllTabs() {
  await chrome.action.setPopup({ popup: '' });
  const s = await loadSettings();
  const tabs = await chrome.tabs.query({ url: ARGO_TABS });
  await Promise.all(tabs.map(t => syncPopup(t.id, t.url, s)));
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url !== undefined || info.status === 'loading') syncPopup(tabId, tab.url);
});

chrome.tabs.onReplaced.addListener(addedTabId => {
  chrome.tabs.get(addedTabId).then(t => syncPopup(t.id, t.url)).catch(() => {});
});

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

chrome.action.onClicked.addListener(async tab => {
  // File aggiornati sul disco: prima si ricarica l'estensione, poi l'accesso riparte da solo.
  if (await reloadIfStale({ action: 'go-registro' })) return;
  // Registro aperto prima dell'installazione: imposta il popup e mostralo.
  if (tab && isArgoPortalUrl(tab.url)) {
    const s = await loadSettings();
    if (isArgoDashboardUrl(tab.url, s)) {
      await syncPopup(tab.id, tab.url, s);
      try { await chrome.action.openPopup(); return; } catch (e) { /* versioni senza openPopup */ }
    }
  }
  await goToRegistro(tab);
});

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
        target, files: ['settings.js', 'content-common.js', 'keepalive.js', 'argomenti.js', 'azioni.js']
      }))
      .catch(() => { /* scheda non accessibile (es. scartata) */ });
  }
}

// Dopo che il popup o le impostazioni hanno ricaricato l'estensione
// (file aggiornati sul disco) si completa quello che l'utente voleva fare.
async function resumeAfterSelfReload() {
  const { selfReload } = await chrome.storage.local.get('selfReload');
  if (!selfReload || selfReload.handled || !selfReload.after) return;
  await chrome.storage.local.set({ selfReload: { ...selfReload, handled: true } });
  if (Date.now() - selfReload.at > SELF_RELOAD_GUARD_MS) return;
  if (selfReload.after.action === 'go-registro') await goToRegistro();
  else if (selfReload.after.action === 'open-options') await chrome.runtime.openOptionsPage();
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Ogni passo è indipendente: se uno fallisce gli altri vanno comunque eseguiti.
  const steps = [updateBadge, syncAllTabs, injectIntoOpenArgoTabs, async () => {
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
  await syncAllTabs();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('codiceScuola' in changes) updateBadge();
  if ('argoDashboardPattern' in changes || 'argoLoginUrl' in changes) syncAllTabs();
});

// ---------------------------------------------------------------------
// Messaggi da popup e content script
// ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  switch (msg.type) {
    case 'keepalive-state':
      // Mentre il keep-alive è attivo la scheda non deve essere scaricata
      // da "Risparmio memoria", altrimenti la sessione andrebbe persa.
      if (sender.tab && sender.tab.id !== undefined) {
        chrome.tabs.update(sender.tab.id, { autoDiscardable: !msg.active }).catch(() => {});
      }
      return;
    case 'open-options':
      chrome.runtime.openOptionsPage();
      return;
    case 'go-registro':
      goToRegistro(msg.tab || null).then(sendResponse, err => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
  }
});
