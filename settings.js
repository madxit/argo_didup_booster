// =====================================================================
// settings.js — modulo condiviso (popup, pagina impostazioni,
// content script e service worker).
// Tutte le impostazioni sono salvate in chrome.storage.local.
// =====================================================================

var SETTINGS_SCHEMA_VERSION = 1;

var KEEPALIVE_MIN_SEC = 30;
var KEEPALIVE_MAX_SEC = 3600;

// Provider SPID presenti sulla pagina del Ministero (eid.istruzione.it):
// l'id è il segmento del link .../sp/idps/spid/<id>/authenticate/
var SPID_PROVIDERS = [
  { id: 'arubaid', nome: 'Aruba ID' },
  { id: 'etnaid', nome: 'Etna ID' },
  { id: 'infocamereid', nome: 'InfoCamere ID' },
  { id: 'infocertid', nome: 'InfoCert ID' },
  { id: 'intesigroup', nome: 'Intesi Group ID' },
  { id: 'lepida', nome: 'Lepida ID' },
  { id: 'namirialid', nome: 'Namirial ID' },
  { id: 'posteid', nome: 'Poste ID' },
  { id: 'sielteid', nome: 'Sielte ID' },
  { id: 'spiditalia', nome: 'SpidItalia (Register.it)' },
  { id: 'teamsystemid', nome: 'TeamSystem ID' },
  { id: 'timid', nome: 'TIM ID' }
];

var DEFAULT_SETTINGS = {
  codiceScuola: '',
  loginMethod: 'spid',             // 'spid' | 'cie'
  spidProvider: '',                // id di SPID_PROVIDERS, '' = scegli ogni volta
  autoLogin: true,                 // avvia l'accesso appena si apre la pagina di login
  docenteNome: '',
  keepAliveEnabled: true,
  keepAliveInterval: 240,          // secondi
  keepAliveMethod: 'ping',         // 'ping' | 'reload'
  discipline: [],                  // [{ nome, argomenti: string[], compiti: string[] }]
  argoLoginUrl: 'https://www.portaleargo.it/auth/sso/login',
  argoDashboardPattern: 'https://www.portaleargo.it/voti/?classic',
  basePortalUrl: 'https://www.portaleargo.it/voti/'
};

var SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

// ---------------------------------------------------------------------
// Normalizzazione / validazione (usata anche dall'import)
// ---------------------------------------------------------------------

function normalizeCodiceScuola(value) {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

function isValidCodiceScuola(code) {
  return /^[A-Z0-9]{3,16}$/.test(code);
}

function clampInterval(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.keepAliveInterval;
  return Math.min(KEEPALIVE_MAX_SEC, Math.max(KEEPALIVE_MIN_SEC, n));
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// Confronto senza maiuscole e accenti (ricerche, abbinamento materie).
function foldText(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

function sanitizeDiscipline(list, warnings = []) {
  if (!Array.isArray(list)) {
    if (list !== undefined) warnings.push('Elenco discipline non valido: ignorato.');
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const d of list) {
    const nome = cleanText(d && d.nome);
    if (!nome) continue;
    const key = nome.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`Disciplina duplicata "${nome}": unita alla prima.`);
      const existing = out.find(x => x.nome.toLowerCase() === key);
      for (const tipo of TIPI_VOCE) mergeArgomenti(existing[tipo], d[tipo]);
      continue;
    }
    seen.add(key);
    const item = { nome };
    for (const tipo of TIPI_VOCE) {
      item[tipo] = [];
      mergeArgomenti(item[tipo], d[tipo]);
    }
    out.push(item);
  }
  return out;
}

// Ogni disciplina ha due elenchi: gli argomenti (vanno in "Attività svolta")
// e i compiti (vanno in "Compiti").
var TIPI_VOCE = ['argomenti', 'compiti'];

function contaVoci(discipline, tipo) {
  return discipline.reduce((n, d) => n + ((d && d[tipo]) || []).length, 0);
}

// Aggiunge a `target` le voci (argomenti o compiti) di `source` non ancora
// presenti. Restituisce il numero di voci aggiunte.
function mergeArgomenti(target, source) {
  if (!Array.isArray(source)) return 0;
  const seen = new Set(target.map(a => a.toLowerCase()));
  let added = 0;
  for (const a of source) {
    const testo = cleanText(a);
    if (!testo || seen.has(testo.toLowerCase())) continue;
    seen.add(testo.toLowerCase());
    target.push(testo);
    added++;
  }
  return added;
}

// Restituisce { settings, warnings } con tutti i campi validati.
function sanitizeSettings(raw) {
  const warnings = [];
  const src = raw && typeof raw === 'object' ? raw : {};
  const s = { ...DEFAULT_SETTINGS };

  if (src.codiceScuola !== undefined) {
    const code = normalizeCodiceScuola(src.codiceScuola);
    if (!code || isValidCodiceScuola(code)) s.codiceScuola = code;
    else warnings.push(`Codice scuola "${src.codiceScuola}" non valido: ignorato.`);
  }
  if (src.loginMethod !== undefined) s.loginMethod = src.loginMethod === 'cie' ? 'cie' : 'spid';
  if (src.spidProvider !== undefined) {
    const id = String(src.spidProvider || '');
    if (!id || SPID_PROVIDERS.some(p => p.id === id)) s.spidProvider = id;
    else warnings.push(`Provider SPID "${id}" sconosciuto: ignorato.`);
  }
  if (src.autoLogin !== undefined) s.autoLogin = Boolean(src.autoLogin);
  if (src.docenteNome !== undefined) s.docenteNome = cleanText(src.docenteNome);
  if (src.keepAliveEnabled !== undefined) s.keepAliveEnabled = Boolean(src.keepAliveEnabled);
  if (src.keepAliveInterval !== undefined) s.keepAliveInterval = clampInterval(src.keepAliveInterval);
  if (src.keepAliveMethod !== undefined) {
    s.keepAliveMethod = src.keepAliveMethod === 'reload' ? 'reload' : 'ping';
  }
  s.discipline = sanitizeDiscipline(src.discipline, warnings);

  for (const key of ['argoLoginUrl', 'argoDashboardPattern', 'basePortalUrl']) {
    if (src[key] === undefined) continue;
    if (isHttpUrl(src[key])) s[key] = String(src[key]).trim();
    else warnings.push(`URL "${key}" non valido: uso il valore predefinito.`);
  }
  return { settings: s, warnings };
}

// ---------------------------------------------------------------------
// Lettura / scrittura
// ---------------------------------------------------------------------

// Alla prima esecuzione recupera i pochi valori utili salvati dalla
// versione precedente in chrome.storage.sync.
async function migrateFromSyncIfNeeded() {
  const { schemaVersion } = await chrome.storage.local.get('schemaVersion');
  if (schemaVersion) return;
  let legacy = {};
  try {
    legacy = await chrome.storage.sync.get([
      'codiceScuola', 'docenteNome', 'argoLoginUrl', 'argoDashboardPattern', 'basePortalUrl'
    ]);
  } catch (e) { /* storage.sync non disponibile */ }
  const { settings } = sanitizeSettings(legacy);
  const toSave = { schemaVersion: SETTINGS_SCHEMA_VERSION };
  for (const key of Object.keys(legacy)) toSave[key] = settings[key];
  await chrome.storage.local.set(toSave);
}

async function loadSettings() {
  await migrateFromSyncIfNeeded();
  const stored = await chrome.storage.local.get(SETTINGS_KEYS);
  return sanitizeSettings(stored).settings;
}

function saveSettings(partial) {
  return chrome.storage.local.set(partial);
}

// Sostituisce completamente le impostazioni (usato dall'import).
async function replaceSettings(settings) {
  await chrome.storage.local.remove(SETTINGS_KEYS);
  await chrome.storage.local.set({ ...settings, schemaVersion: SETTINGS_SCHEMA_VERSION });
}

function buildExport(settings) {
  const data = {};
  for (const key of SETTINGS_KEYS) data[key] = settings[key];
  return {
    app: 'Argo DidUP Booster',
    type: 'settings-export',
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: data
  };
}

// Accetta sia il file di export completo sia un oggetto impostazioni "nudo".
// Restituisce { settings, warnings, presentKeys }.
function parseImport(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Il file non contiene un oggetto JSON valido.');
  }
  const raw = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : parsed;
  const known = SETTINGS_KEYS.filter(k => raw[k] !== undefined);
  if (known.length === 0) {
    throw new Error('Il file non contiene impostazioni di Argo DidUP Booster.');
  }
  return { ...sanitizeSettings(raw), presentKeys: known };
}

// ---------------------------------------------------------------------
// Riconoscimento delle pagine Argo
// ---------------------------------------------------------------------

function urlMatchesBase(url, base) {
  if (!url || !base) return false;
  try {
    const u = new URL(url);
    const b = new URL(base);
    const uHost = u.hostname.replace(/^www\./, '');
    const bHost = b.hostname.replace(/^www\./, '');
    if (uHost !== bHost) return false;
    const uPath = u.pathname.replace(/\/$/, '') || '/';
    const bPath = b.pathname.replace(/\/$/, '') || '/';
    return uPath.startsWith(bPath);
  } catch (e) {
    return url.startsWith(base);
  }
}

function isArgoLoginUrl(url, s) {
  return urlMatchesBase(url, s.argoLoginUrl);
}

function isArgoDashboardUrl(url, s) {
  return urlMatchesBase(url, s.argoDashboardPattern) && !isArgoLoginUrl(url, s);
}

// Qualsiasi pagina del portale Argo (login, registro, ...).
function isArgoPortalUrl(url) {
  try {
    return /(^|\.)portaleargo\.it$/.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

function spidProviderName(id) {
  const p = SPID_PROVIDERS.find(x => x.id === id);
  return p ? p.nome : '';
}

// Descrizione breve del metodo di accesso, es. "SPID · Poste ID" o "CIE".
function describeLoginMethod(s) {
  if (s.loginMethod === 'cie') return 'CIE';
  const nome = spidProviderName(s.spidProvider);
  return nome ? `SPID · ${nome}` : 'SPID (provider da scegliere)';
}

// ---------------------------------------------------------------------
// Flusso di accesso automatico (stato condiviso tra le pagine)
//   loginFlow = { startedAt, stage: 'argo' | 'eid' | 'idp', autoAt }
// ---------------------------------------------------------------------

var LOGIN_FLOW_TTL_MS = 3 * 60 * 1000;     // validità di un passaggio
var LOGIN_RETRY_GUARD_MS = 90 * 1000;      // anti-loop dopo un tentativo automatico

async function getLoginFlow() {
  const { loginFlow } = await chrome.storage.local.get('loginFlow');
  return loginFlow || null;
}

function setLoginFlow(flow) {
  return chrome.storage.local.set({ loginFlow: flow });
}

function clearLoginFlow() {
  return chrome.storage.local.remove('loginFlow');
}

function isFlowStage(flow, stage, ttl = LOGIN_FLOW_TTL_MS) {
  return Boolean(flow && flow.stage === stage && Date.now() - (flow.startedAt || 0) < ttl);
}

// ---------------------------------------------------------------------
// File aggiornati sul disco (estensione caricata "decompressa").
// Chrome rilegge dal disco popup e impostazioni a ogni apertura, ma il
// service worker e gli script delle pagine restano quelli caricati finché
// l'estensione non viene ricaricata: in quel caso l'accesso automatico non
// parte. Se la versione sul disco è diversa da quella in esecuzione,
// l'estensione si ricarica da sola e poi esegue `after` (vedi background.js).
// ---------------------------------------------------------------------

var SELF_RELOAD_GUARD_MS = 60 * 1000;

async function reloadIfStale(after = null) {
  let onDisk;
  try {
    const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    onDisk = (await res.json()).version;
  } catch (e) {
    return false;              // manifest non leggibile: meglio non toccare nulla
  }
  const loaded = chrome.runtime.getManifest().version;
  if (!onDisk || onDisk === loaded) return false;
  const { selfReload } = await chrome.storage.local.get('selfReload');
  if (selfReload && selfReload.to === onDisk && Date.now() - selfReload.at < SELF_RELOAD_GUARD_MS) {
    return false;              // già tentato da poco: niente cicli
  }
  await chrome.storage.local.set({ selfReload: { from: loaded, to: onDisk, at: Date.now(), after } });
  chrome.runtime.reload();
  return true;
}
