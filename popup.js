// =====================================================================
// popup.js — popup dell'estensione (si apre nel registro: altrove il
// clic sull'icona avvia direttamente l'accesso).
// "Firma ora" e "Appello" sono eseguite da azioni.js nella pagina: il
// popup mostra passo per passo cosa viene cliccato e cosa (non) si trova.
// (loadSettings, describeLoginMethod, ... arrivano da settings.js)
// =====================================================================

const $ = id => document.getElementById(id);

// =================== POPUP ===================

let statusTimer;
function showStatus(msg, { error = false } = {}) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('err', error);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ''; }, 6000);
}

function openSettings() {
  chrome.runtime.openOptionsPage();
  window.close();
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} s`;
  return s ? `${m} min ${s} s` : `${m} min`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

// ---------- Firma / Appello (eseguite da azioni.js nella pagina) ----------

const PAGE_SCRIPTS = ['settings.js', 'content-common.js', 'azioni.js'];

// Porta verso azioni.js; se la pagina è stata aperta prima di un
// aggiornamento dell'estensione, gli script vengono iniettati al volo.
function connectToPage(tabId) {
  return new Promise(resolve => {
    const port = chrome.tabs.connect(tabId, { name: 'argo-azione' });
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value); } };
    port.onMessage.addListener(function onReady(msg) {
      if (msg && msg.type === 'ready') { port.onMessage.removeListener(onReady); done(port); }
    });
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; done(null); });
    setTimeout(() => done(null), 1500);
  });
}

async function openPagePort(tabId) {
  let port = await connectToPage(tabId);
  if (port) return port;
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page-bridge.js'], world: 'MAIN' });
  await chrome.scripting.executeScript({ target: { tabId }, files: PAGE_SCRIPTS });
  port = await connectToPage(tabId);
  if (!port) throw new Error('la pagina del registro non risponde: ricaricala e riprova');
  return port;
}

function renderRun(title) {
  const run = $('run');
  run.hidden = false;
  run.className = 'run running';
  $('run-title').textContent = title;
  $('run-steps').textContent = '';
  $('run-result').textContent = '';
}

function addRunStep({ text, kind }) {
  const li = document.createElement('li');
  li.className = kind || 'ok';
  li.textContent = text;
  $('run-steps').appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
}

// Domanda della pagina (es. ora da firmare fuori dalla sua fascia oraria).
function askInPopup(port, { id, question, confirmLabel, cancelLabel }) {
  const box = $('run-ask');
  $('run-ask-text').textContent = question;
  $('run-ask-yes').textContent = confirmLabel || 'Sì';
  $('run-ask-no').textContent = cancelLabel || 'No';
  box.hidden = false;
  $('run').className = 'run asking';
  box.scrollIntoView({ block: 'nearest' });
  const answer = ok => {
    box.hidden = true;
    $('run').className = 'run running';
    $('run-ask-yes').onclick = $('run-ask-no').onclick = null;
    try { port.postMessage({ type: 'answer', id, ok }); } catch (e) { /* pagina chiusa */ }
  };
  $('run-ask-yes').onclick = () => answer(true);
  $('run-ask-no').onclick = () => answer(false);
  $('run-ask-yes').focus();
}

function finishRun(result) {
  const run = $('run');
  $('run-ask').hidden = true;
  run.className = 'run ' + (result.ok ? (result.cancelled ? 'cancelled' : 'done') : 'failed');
  // l'errore è già l'ultimo passo dell'elenco: qui va il riepilogo
  $('run-result').textContent = result.ok ? result.summary : 'Non completato: leggi il passo in rosso.';
}

async function performAction(tab, action) {
  const title = action === 'appello' ? 'Appello' : 'Firma ora';
  renderRun(title);
  let port;
  try {
    port = await openPagePort(tab.id);
  } catch (err) {
    addRunStep({ text: 'Non riesco a comunicare con la pagina del registro: ' + err.message, kind: 'error' });
    finishRun({ ok: false });
    return;
  }
  await new Promise(resolve => {
    port.onMessage.addListener(msg => {
      if (!msg) return;
      if (msg.type === 'step') addRunStep(msg.step);
      if (msg.type === 'ask') askInPopup(port, msg);
      if (msg.type === 'done') { finishRun(msg.result || { ok: false }); resolve(); }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if ($('run').classList.contains('running') || $('run').classList.contains('asking')) {
        addRunStep({ text: 'La pagina del registro si è chiusa o ricaricata durante l\'operazione.', kind: 'error' });
        finishRun({ ok: false });
      }
      resolve();
    });
    port.postMessage({ type: 'run', action });
  });
}

function bindActionButton(btn, handler) {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.tile').forEach(b => { b.disabled = true; });
    try { await handler(); } finally {
      document.querySelectorAll('.tile').forEach(b => { b.disabled = false; });
    }
  });
}

// ---------- Registro ----------

async function renderSession(tab, settings) {
  const box = $('session');
  const text = $('session-text');
  box.className = 'session';
  if (!settings.keepAliveEnabled) {
    text.textContent = 'Mantenimento sessione disattivato';
    return;
  }
  const { keepAliveStatus: st } = await chrome.storage.local.get('keepAliveStatus');
  if (st && st.expired) {
    box.classList.add('warn');
    text.textContent = 'Sessione scaduta';
    const btn = $('btn-relogin');
    btn.hidden = !settings.codiceScuola;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await relogin(tab, settings);
      window.close();
    });
  } else if (st && !st.ok) {
    box.classList.add('warn');
    text.textContent = `Rinnovo non riuscito alle ${formatTime(st.time)}`;
  } else if (st && (st.action === 'ping' || st.action === 'reload')) {
    box.classList.add('ok');
    text.textContent = `Sessione attiva · rinnovata alle ${formatTime(st.time)}`;
  } else {
    box.classList.add('ok');
    text.textContent = `Sessione mantenuta attiva · ogni ${formatDuration(settings.keepAliveInterval)}`;
  }
}

function setupRegistro(tab, settings) {
  $('view-registro').hidden = false;
  $('hdr-sub').textContent = settings.docenteNome || 'Registro elettronico';
  bindActionButton($('btn-firma'), () => performAction(tab, 'firma'));
  bindActionButton($('btn-appello'), () => performAction(tab, 'appello'));
  renderSession(tab, settings);
}

// Nuovo accesso automatico nella scheda indicata (riparte da /voti).
async function relogin(tab, settings) {
  await setLoginFlow({ startedAt: Date.now(), stage: 'argo' });
  await chrome.tabs.update(tab.id, { url: settings.basePortalUrl });
}

// ---------- Accesso ----------

function setupLogin(tab, settings) {
  $('view-login').hidden = false;
  $('hdr-sub').textContent = 'Accesso al registro';
  $('login-code').textContent = settings.codiceScuola || 'non impostato';
  $('login-method').textContent = describeLoginMethod(settings);
  $('login-hint').textContent = settings.autoLogin
    ? 'L\'accesso parte da solo quando si apre la pagina di Argo.'
    : 'Accesso automatico all\'apertura disattivato nelle impostazioni.';

  const btn = $('btn-login');
  btn.disabled = !settings.codiceScuola;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    let ok = false;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'argo-login-now' });
      ok = Boolean(res && res.ok);
    } catch (e) { /* nessun content script su questa pagina */ }
    if (!ok) await relogin(tab, settings);   // pagina non di login: riparte da /voti
    window.close();
  });
}

// ---------- Fuori da Argo ----------

function setupOutside(settings) {
  $('view-out').hidden = false;
  $('out-hint').textContent = settings.codiceScuola
    ? `Codice ${settings.codiceScuola} · ${describeLoginMethod(settings)}`
    : '';
  const btn = $('btn-go');
  btn.disabled = !settings.codiceScuola;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'go-registro' });
      if (res && res.ok === false && res.error) throw new Error(res.error);
      window.close();
    } catch (err) {
      btn.disabled = false;
      showStatus('Non riesco ad avviare l\'accesso: ricarica l\'estensione da chrome://extensions.', { error: true });
    }
  });
}

// =================== AVVIO ===================

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || '';

  // File dell'estensione aggiornati ma Chrome usa ancora quelli vecchi:
  // si ricarica da sola e poi (fuori dal registro) avvia l'accesso.
  if (await reloadIfStale(isArgoDashboardUrl(url, settings) ? null : { action: 'go-registro' })) {
    $('hdr-sub').textContent = 'Aggiornamento in corso…';
    return;
  }

  $('open-settings').addEventListener('click', openSettings);
  $('missing-code-btn').addEventListener('click', openSettings);
  $('missing-code').hidden = Boolean(settings.codiceScuola);

  if (isArgoDashboardUrl(url, settings)) setupRegistro(tab, settings);
  else if (isArgoPortalUrl(url)) setupLogin(tab, settings);
  else setupOutside(settings);
});
