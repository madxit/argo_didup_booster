// =====================================================================
// settings.js — modulo condiviso (pagina impostazioni,
// content script e service worker).
// Tutte le impostazioni sono salvate in chrome.storage.local.
// =====================================================================

var SETTINGS_SCHEMA_VERSION = 1;

// Repository del progetto (link nelle impostazioni).
var REPO_URL = 'https://github.com/madxit/argo_didup_booster';

// Mantenimento della sessione (unico metodo, guidato dal service worker,
// vedi background.js): ogni minuto controlla le schede del registro, anche
// quelle in secondo piano, e le ricarica quando non le stai usando.
var KEEPALIVE_IDLE_MIN = 10;           // ricarica dopo 10 minuti senza clic, tasti o cambi di schermata
var KEEPALIVE_IDLE_MIN_FLOOR = 3;      // soglia minima se la sessione si è dimostrata più corta
var KEEPALIVE_EXPIRED_IDLE_SEC = 60;   // sessione già scaduta: ricarica dopo 1 minuto di inattività
var KEEPALIVE_EXPIRED_RETRY_MIN = 5;   // al massimo una ricarica "per scadenza" ogni 5 minuti per scheda

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
  ricordami: true,                 // spunta «Ricordami» nella pagina di accesso di Argo
  docenteNome: '',
  keepAliveEnabled: true,
  showFirma: true,                 // funzioni aggiunte al registro (si possono togliere)
  showAppello: true,
  showArgomenti: true,
  guidaPulsanti: true,             // guida dei pulsanti alla prossima apertura del registro (si spegne dopo)
  guidaArgomenti: true,            // guida di «Argomenti e compiti» alla prossima modifica di una lezione
  buttonsPosition: 'right',        // pulsanti nella barra di DidUP: 'right' | 'left' | 'center'
  buttonsTheme: 'argo',            // id di BUTTON_THEMES
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
  for (const key of ['autoLogin', 'ricordami', 'keepAliveEnabled', 'showFirma', 'showAppello', 'showArgomenti', 'guidaPulsanti', 'guidaArgomenti']) {
    if (src[key] !== undefined) s[key] = Boolean(src[key]);
  }
  if (src.docenteNome !== undefined) s.docenteNome = cleanText(src.docenteNome);
  if (src.buttonsPosition !== undefined) {
    if (BUTTON_POSITIONS.some(p => p.id === src.buttonsPosition)) s.buttonsPosition = src.buttonsPosition;
    else warnings.push(`Posizione dei pulsanti "${src.buttonsPosition}" sconosciuta: uso "${DEFAULT_SETTINGS.buttonsPosition}".`);
  }
  if (src.buttonsTheme !== undefined) {
    if (BUTTON_THEMES.some(t => t.id === src.buttonsTheme)) s.buttonsTheme = src.buttonsTheme;
    else warnings.push(`Stile dei pulsanti "${src.buttonsTheme}" sconosciuto: uso quello predefinito.`);
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
// Aspetto dei pulsanti aggiunti al registro (Firma, Appello, Argomenti e
// compiti). Ogni stile è un insieme di variabili CSS usate da toolbar.js,
// argomenti.js e dall'anteprima nelle impostazioni.
// ---------------------------------------------------------------------

var BUTTON_POSITIONS = [
  { id: 'right', nome: 'A destra', desc: 'accanto al pulsante di aiuto' },
  { id: 'center', nome: 'Al centro', desc: 'al centro della barra' },
  { id: 'left', nome: 'A sinistra', desc: 'dopo il nome della scuola' }
];

// Il primo è quello predefinito. «Simil Argo» imita il pulsante di aiuto di
// DidUP (cerchio bianco con il bordo arancione, help2.png).
var BUTTON_THEMES = [
  { id: 'argo', nome: 'Simil Argo', desc: 'come il pulsante di aiuto di DidUP: bianco con il bordo arancione',
    vars: { bg: '#ffffff', fg: '#ff9625', border: '#ff9625', hoverBg: '#fff3e6', ring: 'rgba(255,150,37,.3)', shadow: 'none',
      tipBg: '#234e66', tipFg: '#ffffff', mark: 'transparent' } },
  { id: 'vivid', nome: 'Evidenziato', desc: 'viola acceso: si vede subito che è un pulsante dell\'estensione',
    vars: { bg: '#7c3aed', fg: '#ffffff', border: '#6d28d9', hoverBg: '#6d28d9', ring: 'rgba(124,58,237,.35)', shadow: '0 2px 8px rgba(124,58,237,.45)',
      tipBg: '#2e1065', tipFg: '#ffffff', mark: '#facc15' } },
  { id: 'contrast', nome: 'Alto contrasto', desc: 'nero e giallo, la massima leggibilità',
    vars: { bg: '#000000', fg: '#ffeb3b', border: '#ffeb3b', hoverBg: '#1f1f1f', ring: 'rgba(255,235,59,.6)', shadow: '0 0 0 2px #000',
      tipBg: '#000000', tipFg: '#ffeb3b', mark: '#ffeb3b' } },
  { id: 'sepia', nome: 'Seppia', desc: 'toni caldi, riposanti per la vista',
    vars: { bg: '#f4e8d0', fg: '#5b4636', border: '#c8ad86', hoverBg: '#ead9b8', ring: 'rgba(139,94,52,.3)', shadow: '0 1px 3px rgba(91,70,54,.3)',
      tipBg: '#5b4636', tipFg: '#f4e8d0', mark: '#b5651d' } },
  { id: 'light', nome: 'Chiaro', desc: 'bianco con icone blu',
    vars: { bg: '#ffffff', fg: '#1d4ed8', border: '#bfdbfe', hoverBg: '#eff6ff', ring: 'rgba(29,78,216,.25)', shadow: '0 1px 3px rgba(15,23,42,.18)',
      tipBg: '#1f2937', tipFg: '#ffffff', mark: '#1d4ed8' } },
  { id: 'dark', nome: 'Scuro', desc: 'grafite con icone chiare',
    vars: { bg: '#1f2937', fg: '#f9fafb', border: '#374151', hoverBg: '#374151', ring: 'rgba(148,163,184,.4)', shadow: '0 2px 6px rgba(0,0,0,.35)',
      tipBg: '#111827', tipFg: '#f9fafb', mark: '#60a5fa' } }
];

function buttonTheme(id) {
  return BUTTON_THEMES.find(t => t.id === id) || BUTTON_THEMES[0];
}

// Variabili CSS dello stile, da mettere in un selettore (es. ":host").
function buttonThemeCss(id) {
  const v = buttonTheme(id).vars;
  return `--b-bg:${v.bg};--b-fg:${v.fg};--b-border:${v.border};--b-hover:${v.hoverBg};--b-ring:${v.ring};` +
    `--b-shadow:${v.shadow};--b-tip-bg:${v.tipBg};--b-tip-fg:${v.tipFg};--b-mark:${v.mark};` +
    // contorno del puntino: senza puntino niente contorno (taglierebbe il bordo)
    `--b-mark-ring:${v.mark === 'transparent' ? 'transparent' : v.bg};`;
}

// Icone e aspetto dei pulsanti: gli stessi nel registro e nell'anteprima delle impostazioni.
var BOOSTER_ICONS = {
  firma: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  appello: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
};

var BOOSTER_ACTIONS = [
  { id: 'firma', setting: 'showFirma', label: 'Firma ora', tip: 'Firma ora: la tua lezione in corso o la prossima' },
  { id: 'appello', setting: 'showAppello', label: 'Appello', tip: 'Appello: apre l\'appello della lezione più vicina all\'ora' }
];

// Pulsanti della barra attivi nelle impostazioni (Funzioni nel registro).
function enabledActions(s) {
  return BOOSTER_ACTIONS.filter(a => !s || s[a.setting] !== false);
}

var BOOSTER_BUTTON_SIZE = 34;       // come l'immagine del pulsante di aiuto di DidUP (alta 34 px)
var BOOSTER_BUTTON_GAP = 8;

// Pulsanti rotondi con la scritta che compare al passaggio del mouse (classe .b).
function boosterButtonsCss() {
  return `
    .bar { display: flex; gap: ${BOOSTER_BUTTON_GAP}px; }
    .b { position: relative; box-sizing: border-box; width: ${BOOSTER_BUTTON_SIZE}px; height: ${BOOSTER_BUTTON_SIZE}px; padding: 0; margin: 0;
         display: grid; place-items: center; border-radius: 50%; border: 2px solid var(--b-border);
         background: var(--b-bg); color: var(--b-fg); box-shadow: var(--b-shadow); cursor: pointer;
         transition: background .15s, transform .1s; }
    .b:hover { background: var(--b-hover); }
    .b:active { transform: scale(.94); }
    .b:focus-visible { outline: none; box-shadow: 0 0 0 4px var(--b-ring); }
    .b[disabled] { cursor: progress; opacity: .7; }
    .b.busy::before { content: ''; position: absolute; inset: -4px; border-radius: 50%;
                      border: 2px solid transparent; border-top-color: var(--b-fg); animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    /* puntino: pulsante aggiunto dall'estensione */
    .b::after { content: ''; position: absolute; top: -1px; right: -1px; width: 9px; height: 9px; border-radius: 50%;
                background: var(--b-mark); box-shadow: 0 0 0 1.5px var(--b-mark-ring); }
    .tip { position: absolute; top: calc(100% + 8px); left: 50%; transform: translateX(-50%); white-space: nowrap;
           padding: 5px 9px; border-radius: 7px; background: var(--b-tip-bg); color: var(--b-tip-fg);
           font: 600 12px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; pointer-events: none;
           opacity: 0; transition: opacity .12s; box-shadow: 0 4px 14px rgba(0,0,0,.2); z-index: 1; }
    .tip small { display: block; font-weight: 400; opacity: .8; }
    .b:hover .tip, .b:focus-visible .tip { opacity: 1; }`;
}

// Pulsante con icona e testo («Argomenti e compiti»), stesso stile (classe .pill).
function boosterPillCss() {
  return `
    .pill { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 3px 12px 3px 9px; margin: 0;
            border: 1.5px solid var(--b-border); border-radius: 999px; background: var(--b-bg); color: var(--b-fg);
            box-shadow: var(--b-shadow); font: 600 12px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif; font-style: normal;
            cursor: pointer; white-space: nowrap; }
    .pill:hover { background: var(--b-hover); }
    .pill:focus-visible { outline: none; box-shadow: 0 0 0 4px var(--b-ring); }
    .pill[aria-expanded="true"] { box-shadow: 0 0 0 3px var(--b-ring); }
    .pill::after { content: ''; position: absolute; top: -2px; right: -2px; width: 8px; height: 8px; border-radius: 50%;
                   background: var(--b-mark); box-shadow: 0 0 0 1.5px var(--b-mark-ring); }`;
}

// HTML di un pulsante rotondo (senza gestori di eventi).
function boosterButtonHtml(action) {
  return `<button type="button" class="b" data-action="${action.id}" aria-label="${action.label} (Argo DidUP Booster)">` +
    `${BOOSTER_ICONS[action.id]}<span class="tip">${action.tip}<small>Argo DidUP Booster</small></span></button>`;
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
// Chrome rilegge dal disco la pagina delle impostazioni a ogni apertura, ma il
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
