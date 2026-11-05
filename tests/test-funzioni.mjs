// Test end-to-end v2.2 con Chrome headless + CDP e un finto server che
// riproduce la struttura reale di: login Argo, eid-gateway del Ministero,
// scelta profilo e vista Ext JS "attivita-dettaglio-view" del registro.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMockExtension, workDir, killOnExit, CHROME as CHROME_BIN } from './lib/prepare.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXT = prepareMockExtension();
const SHOTS = workDir('shots');
const CHROME = CHROME_BIN;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MATERIA = 'TECNOLOGIE E PROGETTAZIONE DI SISTEMI INFORMATICI E DI TELECOMUNICAZIONI';
const IDPS = ['intesigroup', 'namirialid', 'sielteid', 'arubaid', 'etnaid', 'spiditalia', 'posteid', 'timid', 'infocertid', 'lepida', 'infocamereid', 'teamsystemid'];

// ---------------- finto server ----------------
const stats = {};
function resetStats() { Object.assign(stats, { eidPosts: [], idp: [], identity: [], pings: 0, pingHeaders: null, expire: false, loggedIn: false }); }
resetStats();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const scripts = list => list.map(f => `<script src="/ext/${f}"></script>`).join('');
const html = (res, body) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`); };
const readBody = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });

const REGISTRO = `
  <h1>Registro finto</h1>
  <div class="x-window" style="position:absolute;left:40px;top:60px;width:900px;background:#fff;border:1px solid #ccc;padding:16px">
    <fieldset class="x-fieldset lightBorder" style="padding:10px 20px">
      <legend class="x-fieldset-header"><div class="x-fieldset-header-text" id="title1"><span class="argo-blue-color ml-2">Registro di classe</span><span class="argo-grey-color ml-2" style="font-style:italic;">Docenti ed alunni</span></div></legend>
      <div class="tab">Attività svolta</div>
      <textarea id="wsxtextarea-1-inputEl" style="width:100%;height:80px" placeholder="Puoi scrivere del testo che sarà visibile a docenti e alunni"></textarea>
      <div class="tab">Compiti</div>
      <!-- scheda "Compiti" nascosta (panelCompiti2): Ext la sposta fuori schermo e viene prima nel DOM -->
      <div style="position:absolute;left:-10000px;top:-10000px"><textarea id="wsxtextarea-3-inputEl" style="width:300px;height:60px"></textarea></div>
      <textarea id="wsxtextarea-2-inputEl" style="width:100%;height:60px"></textarea>
      <textarea id="wsxtextarea-4-inputEl" style="display:none"></textarea>
    </fieldset>
    <fieldset class="x-fieldset" style="margin-top:14px">
      <legend class="x-fieldset-header"><div class="x-fieldset-header-text"><span>Registro del professore</span><span>Solo docente</span></div></legend>
      <textarea id="wsxtextarea-9-inputEl" style="width:100%;height:40px"></textarea>
    </fieldset>
  </div>
  <script>
    window.__setValueCalls = [];
    window.__escapesSeenByPage = 0;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') window.__escapesSeenByPage++; });
    const cmps = {};
    const BIND = { 1: 'desArgomento', 2: 'desCompiti', 3: 'desCompiti2', 4: 'desCompiti3', 9: 'desCompitiProf' };
    for (const n of [1, 2, 3, 4, 9]) {
      const el = document.getElementById('wsxtextarea-' + n + '-inputEl');
      cmps['wsxtextarea-' + n] = { readOnly: false, disabled: false, maxLength: n === 9 ? 1000 : 500, enforceMaxLength: true,
        initialConfig: { bind: { value: '{theAttivita.' + BIND[n] + '}', readOnly: '{readAttAssRegCla}' } },
        isVisible: () => n === 1 || n === 2 || n === 9,
        getValue: () => el.value, setValue: v => { el.value = v; window.__setValueCalls.push(['wsxtextarea-' + n, v]); },
        lookupViewModel: () => ({ get: k => k === 'theAttivita' ? { get: f => f === 'materia' ? ${JSON.stringify(MATERIA)} : null } : null }) };
    }
    window.Ext = { getCmp: id => cmps[id], Ajax: { getDefaultHeaders: () => ({ Accept: 'application/json', Authorization: 'Bearer tok-123', 'x-auth-token': 'sid-456' }) } };
    window.getUrlBase = () => '/api/';
  </script>`;

const reqLog = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!req.url.startsWith('/ext/')) reqLog.push(req.method + ' ' + req.url);
  const p = url.pathname;
  if (p.startsWith('/ext/')) {
    const file = path.join(EXT, decodeURIComponent(p.slice(5)));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  if (p === '/voti/') {
    if (!stats.loggedIn) { res.writeHead(302, { location: '/auth/sso/login/?login_challenge=abc' }); return res.end(); }
    return html(res, REGISTRO + scripts(['page-bridge.js', 'mock-chrome.js', 'settings.js', 'content-common.js', 'login.js', 'keepalive.js', 'argomenti.js']));
  }
  if (p === '/auth/sso/login/') {
    return html(res, `
      <form id="loginForm"><input id="username"><input id="password" type="password"></form>
      <form id="spidForm" method="post" action="/auth/eid-gateway/sso">
        <input type="hidden" id="spid_remember_me" name="remember_me" value="false">
        <label>Codice Scuola</label><input type="text" id="customer_code" name="customer_code" required autofocus value="">
        <a href="#" type="button" class="auth-button italia-it-button button-spid d-flex" onclick="event.preventDefault(); const form = document.getElementById('spidForm'); const sharedCheckbox = document.getElementById('shared_remember_me'); if(sharedCheckbox) document.getElementById('spid_remember_me').value = sharedCheckbox.checked ? 'true' : 'false'; form.submit();"><span class="italia-it-button-text">SPID - CIE - EIDAS</span></a>
      </form>
      <label><input type="checkbox" id="shared_remember_me"> Ricordami</label>` +
      scripts(['page-bridge.js', 'mock-chrome.js', 'settings.js', 'content-common.js', 'login.js', 'keepalive.js', 'argomenti.js']));
  }
  if (p === '/auth/eid-gateway/sso' && req.method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    stats.eidPosts.push(body.get('customer_code'));
    res.writeHead(302, { location: '/eid-gateway/?client_id=9e75&state=s1' });
    return res.end();
  }
  if (p === '/eid-gateway/') {
    const shuffled = [...IDPS].sort(() => Math.random() - .5);
    return html(res, `<h1>Autenticazione</h1>
      <div class="dropdown"><a href="/eid-gateway/" class="idp-btn italia-it-btn dropdown" data-toggle="dropdown" aria-expanded="false" onclick="event.preventDefault(); this.setAttribute('aria-expanded','true')">Entra con SPID</a>
      <div class="spid-idp-btn dropdown-menu" style="display:none">${shuffled.map(id => `<a href="/eid-gateway/sp/idps/spid/${id}/authenticate/?q=1"><img alt="${id}">${id}</a>`).join('')}</div></div>
      <a href="/eid-gateway/sp/idps/cie/authenticate/?q=1" class="cie-btn">Entra con CIE</a>` +
      scripts(['mock-chrome.js', 'settings.js', 'content-common.js', 'eid.js']));
  }
  const idp = p.match(/^\/eid-gateway\/sp\/idps\/(?:spid\/(\w+)|(cie))\/authenticate\/$/);
  if (idp) { stats.idp.push(idp[1] || idp[2]); return html(res, `<h1>IdP ${idp[1] || idp[2]}</h1>`); }
  if (p === '/auth/select/') {
    return html(res, `<form id="selectForm" method="post" action="/auth/select/">
      <div class="selectable-identity" data-username="d.rossi.SG11111" data-customer_code="SG11111">Altra scuola</div>
      <div class="selectable-identity" data-username="d.rossi.SG18328" data-customer_code="SG18328">ITT Buzzi</div></form>
      <script>document.querySelectorAll('.selectable-identity').forEach(a => a.addEventListener('click', () => fetch('/__identity?c=' + a.dataset.customer_code)));</script>` +
      scripts(['mock-chrome.js', 'settings.js', 'content-common.js', 'login.js']));
  }
  if (p === '/voti/pre') {
    return html(res, `<h1>DidUP in avvio</h1><script>window.Ext = { getCmp: () => null, Ajax: { getDefaultHeaders: () => ({ Accept: 'application/json' }) } }; window.getUrlBase = () => '/api/';</script>` +
      scripts(['page-bridge.js', 'mock-chrome.js', 'settings.js', 'content-common.js', 'login.js']));
  }
  if (p === '/__blank') return html(res, '');
  if (p === '/__identity') { stats.identity.push(url.searchParams.get('c')); res.writeHead(204); return res.end(); }
  if (p === '/api/archiviostampe/struttura') {
    stats.pings++;
    stats.pingHeaders = { auth: req.headers.authorization, sid: req.headers['x-auth-token'], method: req.method };
    const ok = req.headers.authorization === 'Bearer tok-123' && req.headers['x-auth-token'] === 'sid-456' && !stats.expire;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    return res.end(ok ? '{"data":[]}' : '{"msg":"sessione scaduta"}');
  }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------------- Chrome + CDP ----------------
const profile = fs.mkdtempSync(path.join(workDir('profiles'), 'p-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--remote-debugging-port=9338', '--window-size=1100,1300', 'about:blank'], { stdio: 'ignore' });
killOnExit(chrome);
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch('http://127.0.0.1:9338/json/list')).json(); if (targets.length) break; } catch (e) {}
  await sleep(200);
}
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let msgId = 0;
const pendingMsgs = new Map();
const consoleErrors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pendingMsgs.has(m.id)) { pendingMsgs.get(m.id)(m); pendingMsgs.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') { consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); console.log('   !! EXC at', lastNav, (m.params.exceptionDetails.exception?.description || '').split('\n')[0]); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  pendingMsgs.set(id, m => m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result));
  ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('Eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
const loadWaiters = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach(fn => fn());
});
let lastNav = '';
async function navigate(url, wait = 700) {
  lastNav = url;
  const loaded = new Promise(r => { loadWaiters.push(r); setTimeout(r, 5000); });
  const res = await send('Page.navigate', { url });
  if (res.errorText) console.log('   (navigazione:', res.errorText, url, ')');
  await loaded;
  await sleep(wait);
}
async function shot(name, clip) {
  const params = { format: 'png' };
  if (clip) {
    const rect = await evaluate(`${clip}; return {x: r.x, y: r.y + scrollY, width: r.width, height: r.height};`);
    Object.assign(params, { clip: { ...rect, scale: 1 }, captureBeyondViewport: true });
  }
  const { data } = await send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
}
await send('Page.enable');
await send('Runtime.enable');

let failures = 0;
const check = (cond, label) => { console.log(`${cond ? '  ✔' : '  ✘'} ${label}`); if (!cond) failures++; };
const store = () => evaluate(`return JSON.parse(localStorage.getItem('__mockStore') || '{}')`);
const URLS = { argoLoginUrl: `${BASE}/auth/sso/login`, argoDashboardPattern: `${BASE}/voti/?classic`, basePortalUrl: `${BASE}/voti/` };
async function setStore(obj, extra = '') {
  await navigate(`${BASE}/ext/options.html`, 400);
  await evaluate(`localStorage.clear(); ${extra}
    localStorage.setItem('__mockStore', JSON.stringify(${JSON.stringify({ schemaVersion: 1, ...obj })}));`);
}
const toast = () => evaluate(`const h = document.querySelector('[data-argo-assistant="toast"]'); return h ? h.shadowRoot.querySelector('.t').innerText : null;`);

// ============ ACCESSO AUTOMATICO ============
console.log('\n[Accesso automatico]');
const base = { codiceScuola: 'SG18328', loginMethod: 'spid', spidProvider: 'posteid', autoLogin: true, ...URLS };

resetStats();
await setStore(base);
await navigate(`${BASE}/voti/`, 2500);
check(stats.eidPosts[0] === 'SG18328', 'login Argo: codice scuola compilato e "SPID - CIE - EIDAS" premuto');
check(stats.idp[0] === 'posteid', 'pagina del Ministero: scelto il provider impostato (Poste ID) tra i provider in ordine casuale');
let s = await store();
check(s.loginFlow && s.loginFlow.stage === 'idp', 'flusso passato al provider (non riparte se si torna indietro)');

// Anti-loop: si torna alla pagina di login subito dopo un tentativo
const postsBefore = stats.eidPosts.length;
await navigate(`${BASE}/auth/sso/login/?login_challenge=again`, 1200);
check(stats.eidPosts.length === postsBefore, 'anti-loop: dopo un tentativo appena fatto non riparte da solo');
check(await evaluate(`return !!document.documentElement && !!document.getElementById('customer_code')`), 'la pagina di login resta intatta (regressione: <html> rimosso)');
check((await toast() || '').includes('Accesso automatico in pausa'), 'avviso "in pausa" con pulsante Riprova');
await evaluate(`document.querySelector('[data-argo-assistant="toast"]').shadowRoot.querySelector('.actions button').click();`);
await sleep(2000);
check(stats.eidPosts.length === postsBefore + 1 && stats.idp.at(-1) === 'posteid', '"Riprova" riavvia l\'accesso');

// Ritorno sul registro: il flusso viene chiuso
stats.loggedIn = true;
await navigate(`${BASE}/voti/?classic`, 800);
check(!('loginFlow' in await store()), 'registro aperto: flusso di accesso chiuso');
stats.loggedIn = false;

// CIE
resetStats();
await setStore({ ...base, loginMethod: 'cie' });
await navigate(`${BASE}/voti/`, 2500);
check(stats.idp[0] === 'cie', 'metodo CIE: clic su "Entra con CIE"');

// Provider non scelto: apre il menu SPID e si ferma
resetStats();
await setStore({ ...base, spidProvider: '' });
await navigate(`${BASE}/voti/`, 2500);
check(stats.idp.length === 0 && await evaluate(`return document.querySelector('a.idp-btn').getAttribute('aria-expanded')`) === 'true',
  'provider "scelgo ogni volta": apre il menu SPID e lascia scegliere');
await shot('11-eid-scegli-provider');

// Codice mancante
resetStats();
await setStore({ ...base, codiceScuola: '' });
await navigate(`${BASE}/voti/`, 1500);
check(stats.eidPosts.length === 0 && (await toast() || '').includes('Codice scuola non impostato'), 'senza codice scuola: nessun invio, avviso con "Apri impostazioni"');
await shot('12-login-senza-codice');

// Accesso automatico disattivato: fermo, ma il clic sull'icona (flusso "argo") lo avvia
resetStats();
await setStore({ ...base, autoLogin: false });
await navigate(`${BASE}/voti/`, 1500);
check(stats.eidPosts.length === 0, 'accesso automatico disattivato: la pagina di login resta ferma');
await evaluate(`await chrome.storage.local.set({ loginFlow: { startedAt: Date.now(), stage: 'argo' } });`);
await navigate(`${BASE}/voti/`, 2500);
check(stats.eidPosts.length === 1 && stats.idp[0] === 'posteid', '…ma il clic sull\'icona dell\'estensione lo avvia comunque');

// Clic manuale su SPID con auto disattivato: il provider viene comunque scelto
resetStats();
await setStore({ ...base, autoLogin: false });
await navigate(`${BASE}/voti/`, 1200);
await evaluate(`document.getElementById('customer_code').value = 'SG18328'; document.querySelector('a.button-spid').click();`);
await sleep(2000);
check(stats.idp[0] === 'posteid', 'clic manuale su "SPID - CIE - EIDAS": la pagina del Ministero sceglie il provider');

// Pagina del Ministero aperta senza passare da Argo: non fa nulla
resetStats();
await setStore(base);
await navigate(`${BASE}/eid-gateway/?client_id=altro`, 1200);
check(stats.idp.length === 0, 'eid-gateway aperto per altri servizi: nessuna scelta automatica');

// Scelta del profilo dopo SPID
resetStats();
await setStore({ ...base, loginFlow: { startedAt: Date.now(), stage: 'idp' } });
await evaluate(`localStorage.setItem('__mockStore', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('__mockStore')), { loginFlow: { startedAt: Date.now(), stage: 'idp' } })));`);
await navigate(`${BASE}/auth/select/`, 1500);
check(JSON.stringify(stats.identity) === '["SG18328"]', 'più profili Argo: scelto quello del codice scuola');

// "Accedi ora" (messaggio dal popup)
resetStats();
await setStore({ ...base, autoLogin: false });
await navigate(`${BASE}/voti/`, 1000);
const reply = await evaluate(`return await new Promise(r => window.__listeners['runtime.onMessage'][0]({ type: 'argo-login-now' }, {}, r));`);
await sleep(1800);
check(reply && reply.ok && stats.eidPosts.length === 1, '"Accedi ora" dal popup avvia subito l\'accesso');

// ============ KEEP-ALIVE ============
console.log('\n[Keep-alive] (timer accelerati 100x)');
resetStats();
stats.loggedIn = true;
await setStore({ ...base, keepAliveEnabled: true, keepAliveInterval: 30, keepAliveMethod: 'ping' }, `localStorage.setItem('__fastTimers', '1');`);
await navigate(`${BASE}/voti/?classic`, 1500);
s = await store();
check(stats.pings >= 3, `ping sull'API autenticata: ${stats.pings} chiamate a archiviostampe/struttura`);
check(stats.pingHeaders && stats.pingHeaders.auth === 'Bearer tok-123' && stats.pingHeaders.sid === 'sid-456' && stats.pingHeaders.method === 'GET',
  'il ping usa le credenziali dell\'app (Authorization + x-auth-token), metodo GET');
check(s.keepAliveStatus && s.keepAliveStatus.ok && s.keepAliveStatus.action === 'ping', 'stato "sessione rinnovata" salvato');
stats.expire = true;
await sleep(800);
const pingsAtExpire = stats.pings;
await sleep(800);
s = await store();
check(s.keepAliveStatus.expired === true && stats.pings === pingsAtExpire, 'risposta 401: sessione scaduta rilevata, ping sospesi');
stats.loggedIn = false;

// ============ I MIEI ARGOMENTI NEL REGISTRO ============
console.log('\n[I miei argomenti nel registro]');
resetStats();
stats.loggedIn = true;
await setStore({ ...base, keepAliveEnabled: false, discipline: [
  { nome: 'Sistemi e reti', argomenti: ['Modello ISO/OSI', 'Indirizzamento IPv4'], compiti: [] },
  { nome: 'TPSIT', argomenti: ['Thread e processi', 'Socket TCP', 'Sincronizzazione: semafori', 'Protocollo HTTP', 'Architetture client-server', 'Programmazione concorrente'],
    compiti: ['Esercizi sui thread pag. 40', 'Studiare i semafori'] }
] });
await navigate(`${BASE}/voti/?classic`, 1200);
check(await evaluate(`return !!document.documentElement && !!document.querySelector('.x-window')`), 'il registro resta intatto dopo l\'avvio degli script');
check(await evaluate(`return document.querySelectorAll('[data-argo-assistant-topics="button"]').length`) === 1 &&
  await evaluate(`return !!document.querySelector('#title1 [data-argo-assistant-topics="button"]')`), 'pulsante solo accanto a "Registro di classe · Docenti ed alunni"');
await shot('13-registro-pulsante', `const r = document.querySelector('.x-window').getBoundingClientRect()`);

const openPicker = () => evaluate(`document.querySelector('[data-argo-assistant-topics="button"]').shadowRoot.querySelector('button').click();`);
const pk = expr => evaluate(`const root = document.querySelector('[data-argo-assistant-topics="picker"]')?.shadowRoot; ${expr}`);
await openPicker();
await sleep(400);
check(await pk(`return !!root`), 'il pannello si apre');
check(await pk(`const sel = root.querySelector('select'); return sel.options[sel.selectedIndex].textContent`) === 'TPSIT', 'disciplina proposta dalla materia della lezione (sigla TPSIT)');
check(await pk(`return [...root.querySelectorAll('select option')].map(o => o.textContent).join('|')`) === 'Sistemi e reti|TPSIT', 'nel menu solo i nomi delle discipline (niente "(6)")');
check(await pk(`return [...root.querySelectorAll('.tabs button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim()).join('|')`) === 'Argomenti 6|Compiti 2', 'conteggi nelle schede Argomenti / Compiti sotto il menu');
check(await pk(`return root.querySelectorAll('li').length`) === 6 && (await pk(`return root.querySelector('.dest').textContent`)).includes('«Attività svolta»'), 'elenco degli argomenti: vanno in «Attività svolta»');
await shot('14-registro-pannello');

await pk(`root.querySelectorAll('li button')[1].click();`);
await sleep(200);
await pk(`root.querySelectorAll('li button')[0].click();`);
await sleep(200);
check(await evaluate(`return document.getElementById('wsxtextarea-1-inputEl').value`) === 'Socket TCP\nThread e processi', 'inserito in "Attività svolta", a capo tra un argomento e l\'altro (come Argo)');
check(await evaluate(`return window.__setValueCalls.length === 2 && window.__setValueCalls.every(c => c[0] === 'wsxtextarea-1')`), 'inserimento tramite Ext JS (setValue del componente)');
check((await pk(`return root.querySelector('.status').textContent`)).includes('Inserito in «Attività svolta» · 28/500'), 'conferma con conteggio caratteri');
await shot('15-registro-inserito');

check(await pk(`return root.querySelectorAll('.seg button').length`) === 0, 'niente più "Inserisci in: Attività svolta / Compiti / Compiti"');
await pk(`root.querySelector('.tabs button[data-kind=compiti]').click();`);
await sleep(100);
check(await pk(`return [...root.querySelectorAll('li .t')].map(t => t.textContent).join('|')`) === 'Esercizi sui thread pag. 40|Studiare i semafori' &&
  (await pk(`return root.querySelector('.dest').textContent`)).includes('«Compiti»'), 'scheda Compiti: l\'elenco dei compiti, che vanno in «Compiti»');
await shot('14b-registro-compiti');
await pk(`const q = root.querySelector('input'); q.value = 'semafori'; q.dispatchEvent(new Event('input')); q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
await sleep(300);
check(await evaluate(`return document.getElementById('wsxtextarea-2-inputEl').value`) === 'Studiare i semafori' &&
  await evaluate(`return document.getElementById('wsxtextarea-3-inputEl').value`) === '',
  'ricerca + Invio: il compito va nella casella «Compiti» visibile, non in quella della scheda nascosta');
check((await pk(`return root.querySelector('.status').textContent`)).includes('Inserito in «Compiti»'), 'conferma «Inserito in «Compiti»»');

await evaluate(`document.getElementById('wsxtextarea-1-inputEl').value = 'x'.repeat(495); window.__copied = []; navigator.clipboard.writeText = async t => { window.__copied.push(t); };`);
await pk(`root.querySelector('.tabs button[data-kind=argomenti]').click(); const q = root.querySelector('input'); q.value = ''; q.dispatchEvent(new Event('input'));`);
await pk(`root.querySelectorAll('li button')[3].click();`);
await sleep(200);
check(await evaluate(`return document.getElementById('wsxtextarea-1-inputEl').value.length`) === 495 &&
  (await pk(`return root.querySelector('.status').textContent`)).includes('limite di 500') &&
  (await evaluate(`return window.__copied`))[0] === 'Protocollo HTTP', 'oltre 500 caratteri: non inserisce, avvisa e copia negli appunti');

await evaluate(`Ext.getCmp('wsxtextarea-1').readOnly = true;`);
await pk(`root.querySelectorAll('li button')[4].click();`);
await sleep(200);
check((await pk(`return root.querySelector('.status').textContent`)).includes('non è modificabile'), 'casella in sola lettura: avviso + copia');

await pk(`root.querySelector('select').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));`);
await sleep(100);
check(await evaluate(`return !document.querySelector('[data-argo-assistant-topics="picker"]') && window.__escapesSeenByPage === 0`), 'Esc chiude il pannello senza arrivare a Ext JS (non chiude la finestra del registro)');

// Ext ridisegna il titolo: il pulsante ricompare
await evaluate(`document.getElementById('title1').innerHTML = '<span>Registro di classe</span><span>Docenti ed alunni</span>';`);
await sleep(700);
check(await evaluate(`return !!document.querySelector('#title1 [data-argo-assistant-topics="button"]')`), 'se Ext JS ridisegna il titolo, il pulsante viene reinserito');

// Clic fuori chiude
await openPicker();
await sleep(300);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1000, y: 1200, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1000, y: 1200, button: 'left', clickCount: 1 });
await sleep(150);
check(await evaluate(`return !document.querySelector('[data-argo-assistant-topics="picker"]')`), 'clic fuori dal pannello lo chiude');
stats.loggedIn = false;

// ============ POPUP ============
console.log('\n[Popup]');
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 420, deviceScaleFactor: 2, mobile: false });
const popup = async (tabUrl, settingsObj, status) => {
  await setStore({ ...settingsObj, ...(status ? { keepAliveStatus: status } : {}) },
    `localStorage.setItem('__mockTab', JSON.stringify({ id: 7, url: ${JSON.stringify(tabUrl)} }));`);
  await navigate(`${BASE}/ext/popup.html`, 500);
};
const def = { codiceScuola: 'SG18328', loginMethod: 'spid', spidProvider: 'posteid', autoLogin: true, docenteNome: 'MADDALUNO DANIELE', keepAliveEnabled: true, keepAliveInterval: 240 };

await popup('https://www.portaleargo.it/voti/?classic', def, { time: Date.now(), ok: true, action: 'ping' });
check(await evaluate(`return !document.getElementById('view-registro').hidden && document.getElementById('missing-code').hidden`), 'registro: riquadri Firma / Appello');
check((await evaluate(`return document.getElementById('session-text').textContent`)).startsWith('Sessione attiva · rinnovata alle'), 'registro: stato sessione');
await shot('16-popup-registro');
await popup('https://www.portaleargo.it/voti/?classic', def, { time: Date.now(), ok: false, expired: true, action: 'ping' });
check(await evaluate(`return document.getElementById('session-text').textContent === 'Sessione scaduta' && !document.getElementById('btn-relogin').hidden`), 'registro: sessione scaduta con "Accedi di nuovo"');
await shot('16b-popup-sessione-scaduta');
await evaluate(`window.__calls = []; document.getElementById('btn-relogin').click();`);
await sleep(200);
check((await evaluate(`return window.__calls`)).some(c => c[0] === 'tabs.update' && c[1] === 7 && c[2].url === 'https://www.portaleargo.it/voti/') && (await store()).loginFlow?.stage === 'argo', '"Accedi di nuovo" rifà l\'accesso nella scheda');
await popup('https://www.portaleargo.it/voti/?classic', def, { time: Date.now(), ok: true, action: 'ping' });
await evaluate(`document.getElementById('btn-appello').click();`);
await sleep(3600);
let pc = await evaluate(`return window.__calls`);
check(pc.some(c => c[0] === 'tabs.connect' && c[1] === 7 && c[2].name === 'argo-azione') &&
  pc.some(c => c[0] === 'executeScript' && (c[1].files || []).includes('azioni.js')) &&
  (await evaluate(`return document.querySelector('#run-steps li.error')?.textContent || ''`)).includes('Non riesco a comunicare con la pagina'),
  'Appello: si collega alla pagina (inietta gli script se mancano) e spiega se non risponde');

await popup('https://www.portaleargo.it/voti/?classic', { ...def, docenteNome: '' });
await evaluate(`document.getElementById('btn-firma').click();`);
await sleep(200);
check((await evaluate(`return window.__calls`)).some(c => c[0] === 'tabs.connect'), 'Firma senza nome docente: parte lo stesso (le tue ore si riconoscono dalle icone)');

await popup('https://www.portaleargo.it/auth/sso/login/?login_challenge=x', def);
check(await evaluate(`return !document.getElementById('view-login').hidden && document.getElementById('login-method').textContent`) === 'SPID · Poste ID', 'pagina di accesso: codice e metodo (SPID · Poste ID)');
await shot('17-popup-login');
await evaluate(`window.__tabsSendMessageReply = { ok: true }; document.getElementById('btn-login').click();`);
await sleep(200);
check((await evaluate(`return window.__calls`)).some(c => c[0] === 'tabs.sendMessage' && c[2].type === 'argo-login-now'), '"Accedi ora" chiede alla pagina di avviare l\'accesso');

await popup('https://www.portaleargo.it/auth/sso/login/', { ...def, codiceScuola: '' });
check(await evaluate(`return !document.getElementById('missing-code').hidden && document.getElementById('btn-login').disabled`), 'senza codice scuola: errore e "Accedi ora" disattivato');
await shot('18-popup-senza-codice');

await popup('https://example.com/', { ...def, loginMethod: 'cie' });
check(await evaluate(`return !document.getElementById('view-out').hidden && document.getElementById('out-hint').textContent`) === 'Codice SG18328 · CIE', 'fuori da Argo (ripiego): "Apri il registro"');
await send('Emulation.clearDeviceMetricsOverride');

// ============ SERVICE WORKER ============
console.log('\n[Service worker]');
async function loadBackground(settingsObj, argoTabs) {
  await setStore(settingsObj, `localStorage.setItem('__mockArgoTabs', JSON.stringify(${JSON.stringify(argoTabs)}));`);
  await navigate(`${BASE}/__blank`, 300);
  await evaluate(`window.importScripts = () => {};
    for (const f of ['mock-chrome.js', 'settings.js', 'background.js']) {
      const sc = document.createElement('script'); sc.src = '/ext/' + f; document.body.append(sc);
      await new Promise(r => sc.onload = r);
    }`);
}
await loadBackground({ codiceScuola: 'SG18328' }, []);
await evaluate(`window.__calls = []; await window.__listeners['action.onClicked'][0]({ id: 3, url: undefined });`);
await sleep(100);
let calls = await evaluate(`return window.__calls`);
check(calls.some(c => c[0] === 'tabs.create' && c[1].url === 'https://www.portaleargo.it/voti/') && (await store()).loginFlow?.stage === 'argo',
  'clic sull\'icona fuori da Argo: apre /voti e avvia l\'accesso');

await loadBackground({ codiceScuola: 'SG18328' }, [{ id: 21, windowId: 2, url: 'https://www.portaleargo.it/voti/?classic' }]);
await evaluate(`window.__calls = []; await window.__listeners['action.onClicked'][0]({ id: 3 });`);
calls = await evaluate(`return window.__calls`);
check(calls.some(c => c[0] === 'tabs.update' && c[1] === 21 && c[2].active) && !calls.some(c => c[0] === 'tabs.create'), 'registro già aperto: porta in primo piano quella scheda');

await loadBackground({ codiceScuola: 'SG18328' }, [{ id: 22, windowId: 2, url: 'https://www.portaleargo.it/auth/sso/login/?login_challenge=old' }]);
await evaluate(`window.__calls = []; await window.__listeners['action.onClicked'][0]({ id: 3 });`);
calls = await evaluate(`return window.__calls`);
check(calls.some(c => c[0] === 'tabs.update' && c[1] === 22 && c[2].url === 'https://www.portaleargo.it/voti/'), 'pagina di login già aperta: la riparte da /voti');

await loadBackground({ codiceScuola: '' }, []);
await evaluate(`window.__calls = []; await window.__listeners['action.onClicked'][0]({ id: 3 });`);
calls = await evaluate(`return window.__calls`);
check(calls.some(c => c[0] === 'openOptionsPage') && !calls.some(c => c[0] === 'tabs.create'), 'senza codice scuola: apre le impostazioni');

await evaluate(`window.__calls = [];
  window.__listeners['tabs.onUpdated'][0](5, { status: 'loading', url: 'https://www.portaleargo.it/voti/' }, { id: 5, url: 'https://www.portaleargo.it/voti/' });
  window.__listeners['tabs.onUpdated'][0](6, { status: 'loading' }, { id: 6 });`);
await sleep(50);
calls = await evaluate(`return window.__calls.filter(c => c[0] === 'action.setPopup')`);
check(calls.some(c => c[1].tabId === 5 && c[1].popup === 'popup.html') && calls.some(c => c[1].tabId === 6 && c[1].popup === ''), 'popup solo sulle schede Argo, altrove il clic va al registro');

// ============ v2.3 ============
console.log('\n[v2.3 · registro già aperto, popup, ricarica automatica]');
await loadBackground({ codiceScuola: 'SG18328' }, [{ id: 31, windowId: 4, active: false, url: 'https://www.portaleargo.it/voti/?classic' }]);
await evaluate(`window.__calls = []; window.__executeScriptReply = [{ result: 'expired' }]; await window.__listeners['action.onClicked'][0]({ id: 3 });`);
calls = await evaluate(`return window.__calls`);
check(calls.some(c => c[0] === 'executeScript' && c[1].world === 'MAIN' && c[1].target.tabId === 31) &&
  calls.some(c => c[0] === 'tabs.update' && c[1] === 31 && c[2].url === 'https://www.portaleargo.it/voti/') && (await store()).loginFlow?.stage === 'argo',
  'registro aperto ma sessione scaduta: rifà l\'accesso in quella scheda');

await loadBackground({ codiceScuola: 'SG18328' }, [{ id: 32, windowId: 4, url: 'https://www.portaleargo.it/voti/?classic' }]);
await evaluate(`window.__calls = []; window.__executeScriptReply = [{ result: 'ok' }]; await window.__listeners['action.onClicked'][0]({ id: 3 });`);
calls = await evaluate(`return window.__calls`);
check(calls.some(c => c[0] === 'tabs.update' && c[1] === 32 && c[2].active && !c[2].url) && !(await store()).loginFlow,
  'registro aperto e sessione valida: lo mostra senza toccarlo');

await loadBackground({ codiceScuola: 'SG18328' }, [{ id: 33, windowId: 4, url: 'https://www.portaleargo.it/auth/sso/login/?login_challenge=x' }]);
await evaluate(`window.__calls = []; window.__tabsSendMessageReply = { ok: true }; await window.__listeners['action.onClicked'][0]({ id: 33, url: 'https://www.portaleargo.it/auth/sso/login/?login_challenge=x' });`);
calls = await evaluate(`return window.__calls`);
check(calls.some(c => c[0] === 'tabs.sendMessage' && c[1] === 33 && c[2].type === 'argo-login-now') && !calls.some(c => c[0] === 'tabs.update' || c[0] === 'tabs.create'),
  'clic sull\'icona sulla pagina di accesso: l\'accesso parte lì');

await evaluate(`window.__calls = [];
  window.__listeners['tabs.onUpdated'][0](8, { status: 'loading', url: 'https://www.portaleargo.it/auth/sso/login/?login_challenge=y' }, { id: 8, url: 'https://www.portaleargo.it/auth/sso/login/?login_challenge=y' });
  window.__listeners['tabs.onUpdated'][0](9, { status: 'loading', url: 'https://www.portaleargo.it/voti/?classic' }, { id: 9, url: 'https://www.portaleargo.it/voti/?classic' });`);
await sleep(80);
calls = await evaluate(`return window.__calls.filter(c => c[0] === 'action.setPopup')`);
check(calls.some(c => c[1].tabId === 8 && c[1].popup === '') && calls.some(c => c[1].tabId === 9 && c[1].popup === 'popup.html'),
  'popup solo nel registro: sulla pagina di accesso il clic avvia l\'accesso');

// SW riavviato dopo la ricarica automatica: completa l'azione richiesta, una volta sola
await loadBackground({ codiceScuola: 'SG18328', selfReload: { from: '2.1', to: '2.3', at: Date.now(), after: { action: 'go-registro' } } }, []);
await evaluate(`window.__calls = []; await window.__listeners['runtime.onInstalled'][0]({ reason: 'update' });`);
calls = await evaluate(`return window.__calls`);
let st = await store();
check(calls.some(c => c[0] === 'tabs.create' && c[1].url === 'https://www.portaleargo.it/voti/') && st.selfReload.handled === true,
  'dopo la ricarica automatica apre il registro e avvia l\'accesso');
await evaluate(`window.__calls = []; await window.__listeners['runtime.onInstalled'][0]({ reason: 'update' });`);
check(!(await evaluate(`return window.__calls`)).some(c => c[0] === 'tabs.create'), '…e non lo rifà a ogni avvio');

// popup aperto con l'estensione "vecchia" in memoria e file nuovi sul disco
await setStore(def, `localStorage.setItem('__mockTab', JSON.stringify({ id: 7, url: 'https://example.com/' })); localStorage.setItem('__mockLoadedVersion', '2.1');`);
await navigate(`${BASE}/ext/popup.html`, 500);
calls = await evaluate(`return window.__calls`);
st = await store();
check(calls.some(c => c[0] === 'runtime.reload') && st.selfReload?.to === JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version && st.selfReload?.after?.action === 'go-registro',
  'popup con versione vecchia in memoria: si ricarica da solo (poi apre il registro)');
await navigate(`${BASE}/ext/popup.html`, 500);
check(!(await evaluate(`return window.__calls`)).some(c => c[0] === 'runtime.reload') && await evaluate(`return !document.getElementById('view-out').hidden`),
  'niente ricariche a ripetizione se la versione non cambia');
await setStore(def, `localStorage.setItem('__mockTab', JSON.stringify({ id: 7, url: 'https://www.portaleargo.it/voti/?classic' })); localStorage.setItem('__mockLoadedVersion', '2.1');`);
await navigate(`${BASE}/ext/popup.html`, 500);
st = await store();
check((await evaluate(`return window.__calls`)).some(c => c[0] === 'runtime.reload') && st.selfReload.after === null,
  'dal registro: si ricarica senza aprire altre schede');
await setStore({ codiceScuola: 'SG18328' }, `localStorage.setItem('__mockLoadedVersion', '2.1');`);
await navigate(`${BASE}/ext/options.html`, 500);
st = await store();
check((await evaluate(`return window.__calls`)).some(c => c[0] === 'runtime.reload') && st.selfReload?.after?.action === 'open-options',
  'impostazioni con versione vecchia: si ricarica e le riapre');
await evaluate(`localStorage.removeItem('__mockLoadedVersion')`);

// /voti/ aperto PRIMA dell'accesso: il flusso "argo" non va perso
await setStore({ codiceScuola: 'SG18328', ...URLS, loginFlow: { startedAt: Date.now(), stage: 'argo' } });
await navigate(`${BASE}/voti/pre`, 1500);
check((await store()).loginFlow?.stage === 'argo', '/voti senza credenziali (prima del rimando al login): il flusso resta attivo');
await evaluate(`window.Ext.Ajax.getDefaultHeaders = () => ({ Authorization: 'Bearer t' });`);
await sleep(1600);
check(!(await store()).loginFlow, '…e si chiude appena il registro ha le credenziali');

// ============ IMPOSTAZIONI ============
console.log('\n[Impostazioni]');
await setStore({ codiceScuola: 'SG18328' });
await navigate(`${BASE}/ext/options.html`, 600);
check(await evaluate(`return document.getElementById('spidProvider').options.length`) === 13, 'elenco dei 12 provider SPID + "scelgo ogni volta"');
await evaluate(`const sel = document.getElementById('spidProvider'); sel.value = 'arubaid'; sel.dispatchEvent(new Event('change'));`);
await evaluate(`document.querySelector('input[name=loginMethod][value=cie]').click();`);
await sleep(150);
s = await store();
check(s.spidProvider === 'arubaid' && s.loginMethod === 'cie' && await evaluate(`return document.getElementById('spidProvider').disabled`), 'metodo CIE salvato, provider disattivato');
await evaluate(`document.querySelector('input[name=loginMethod][value=spid]').click(); document.getElementById('autoLogin').click();`);
await sleep(150);
s = await store();
check(s.loginMethod === 'spid' && s.autoLogin === false, 'SPID + accesso automatico disattivato salvati');
await evaluate(`document.getElementById('autoLogin').click();`);
await sleep(150);
await shot('19-impostazioni-accesso', `const r = document.getElementById('sec-scuola').getBoundingClientRect()`);
const exp = await evaluate(`return buildExport(state)`);
check(exp.settings.spidProvider === 'arubaid' && exp.settings.loginMethod === 'spid' && exp.settings.autoLogin === true, 'export include metodo e provider');
const san = await evaluate(`return sanitizeSettings({ loginMethod: 'x', spidProvider: 'nonesiste', autoLogin: 0 })`);
check(san.settings.loginMethod === 'spid' && san.settings.spidProvider === '' && san.settings.autoLogin === false && san.warnings.length === 1, 'import: metodo/provider non validi ripuliti');

// ============ FINE ============
console.log('\nErrori JS in console:', consoleErrors.length ? consoleErrors : 'nessuno');
if (consoleErrors.length) failures++;
console.log(failures ? `\n✘ ${failures} verifiche fallite` : '\n✔ Tutte le verifiche superate');
ws.close();
chrome.kill();
server.close();
await sleep(500);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
process.exit(failures ? 1 : 0);
