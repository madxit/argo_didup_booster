// Rigenera le immagini del README (docs/img) con dati di fantasia:
//   node tests/screenshots.mjs
// Popup e impostazioni sono le pagine vere dell'estensione (con il finto chrome.*),
// il registro è una pagina finta che imita la schermata di modifica della lezione.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { prepareMockExtension, workDir, killOnExit, CHROME, PROJECT } from './lib/prepare.mjs';

const EXT = prepareMockExtension();
const OUT = path.join(PROJECT, 'docs', 'img');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 9343;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SETTINGS = {
  schemaVersion: 1, codiceScuola: 'SG12345', docenteNome: 'ROSSI MARIO', loginMethod: 'spid', spidProvider: 'posteid',
  autoLogin: true, keepAliveEnabled: true, keepAliveInterval: 240, keepAliveMethod: 'ping',
  discipline: [
    { nome: 'Informatica', argomenti: ['Algoritmi e diagrammi di flusso', 'Variabili e tipi di dato', 'Strutture di selezione', 'Cicli for e while', 'Array e matrici'],
      compiti: ['Esercizi 1-5 pag. 32', 'Scrivere il diagramma di flusso del problema 3'] },
    { nome: 'TPSIT', argomenti: ['Processi e thread', 'Sincronizzazione e semafori', 'Socket TCP/UDP', 'Protocollo HTTP'],
      compiti: ['Studiare il capitolo 4', 'Completare l\'esercizio sui thread', 'Ripassare i semafori'] },
    { nome: 'Matematica', argomenti: ['Equazioni di primo grado', 'Sistemi lineari', 'Disequazioni'], compiti: ['Esercizi pag. 120 n. 1-10'] }
  ]
};

const REGISTRO = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><style>
  body { margin: 0; font: 13px "Helvetica Neue", Arial, sans-serif; background: #eef2f6; color: #222; }
  .bar { height: 48px; background: #1f5c8b; color: #fff; display: flex; align-items: center; padding: 0 18px; font-size: 16px; font-weight: 600; }
  .x-window { position: absolute; left: 40px; top: 72px; width: 860px; background: #fff; border-radius: 6px; box-shadow: 0 6px 24px rgba(0,0,0,.18); }
  .x-window-header { padding: 12px 16px; border-bottom: 1px solid #e4e8ee; font-weight: 600; color: #1f5c8b; }
  .body { padding: 14px 18px 18px; }
  fieldset { border: 1px solid #d6dde6; border-radius: 6px; padding: 10px 16px 16px; margin: 0 0 14px; }
  legend { padding: 0 6px; }
  .argo-blue-color { color: #1f5c8b; font-weight: 600; } .argo-grey-color { color: #888; font-style: italic; }
  .tab { margin: 10px 0 6px; font-weight: 600; color: #444; }
  textarea { width: 100%; box-sizing: border-box; border: 1px solid #cfd6df; border-radius: 4px; padding: 8px; font: inherit; resize: none; }
</style></head><body>
  <div class="bar">didUP · Registro elettronico</div>
  <div class="x-window"><div class="x-window-header">2ª ora · Classe 4B · TPSIT — Modifica lezione</div><div class="body">
    <fieldset class="x-fieldset">
      <legend class="x-fieldset-header"><div class="x-fieldset-header-text" id="title1"><span class="argo-blue-color ml-2">Registro di classe</span> <span class="argo-grey-color ml-2">Docenti ed alunni</span></div></legend>
      <div class="tab">Attività svolta</div>
      <textarea id="wsxtextarea-1-inputEl" style="height:90px">Processi e thread</textarea>
      <div class="tab">Compiti</div>
      <textarea id="wsxtextarea-2-inputEl" style="height:60px">Studiare il capitolo 4</textarea>
    </fieldset>
    <fieldset class="x-fieldset"><legend class="x-fieldset-header"><div class="x-fieldset-header-text"><span class="argo-blue-color">Registro del professore</span> <span class="argo-grey-color">Solo docente</span></div></legend>
      <textarea id="wsxtextarea-9-inputEl" style="height:40px"></textarea></fieldset>
  </div></div>
  <script>
    const cmps = {};
    for (const n of [1, 2, 9]) {
      const el = document.getElementById('wsxtextarea-' + n + '-inputEl');
      const bind = { 1: 'desArgomento', 2: 'desCompiti', 9: 'desArgomentoProf' }[n];
      cmps['wsxtextarea-' + n] = { readOnly: false, disabled: false, maxLength: 500, enforceMaxLength: true, getValue: () => el.value, setValue: v => { el.value = v; },
        initialConfig: { bind: { value: '{theAttivita.' + bind + '}' } }, isVisible: () => true,
        lookupViewModel: () => ({ get: k => k === 'theAttivita' ? { get: f => f === 'materia' ? 'TECNOLOGIE E PROGETTAZIONE DI SISTEMI INFORMATICI E DI TELECOMUNICAZIONI' : null } : null }) };
    }
    window.Ext = { getCmp: id => cmps[id], Ajax: { getDefaultHeaders: () => ({ Authorization: 'Bearer x' }) } };
    window.getUrlBase = () => '/api/';
  </script>
  ${['page-bridge.js', 'mock-chrome.js', 'settings.js', 'content-common.js', 'argomenti.js'].map(f => `<script src="/ext/${f}"></script>`).join('')}
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/ext/')) {
    const file = path.join(EXT, decodeURIComponent(url.pathname.slice(5)));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  if (url.pathname === '/voti/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(REGISTRO); }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(workDir('profiles'), 'p-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
killOnExit(chrome);
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch (e) { /* avvio */ }
  await sleep(200);
}
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const loadWaiters = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach(fn => fn());
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, m => m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
let nav = 0;
const navigate = async (url, wait = 500) => {
  const loaded = new Promise(r => { loadWaiters.push(r); setTimeout(r, 5000); });
  await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'n=' + (++nav) });
  await loaded;
  await sleep(wait);
};
async function shot(name, selector = null, pad = 0) {
  const params = { format: 'png' };
  if (selector) {
    const r = await evaluate(`const e = document.querySelector(${JSON.stringify(selector)}); const b = e.getBoundingClientRect(); return { x: b.x + scrollX, y: b.y + scrollY, w: b.width, h: b.height };`);
    params.clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad, scale: 1 };
    params.captureBeyondViewport = true;
  }
  const { data } = await send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('  ✔', path.join('docs', 'img', name));
}
await send('Page.enable');
await send('Runtime.enable');

const store = (settings, extra = '') => evaluate(`localStorage.clear(); localStorage.setItem('__mockStore', ${JSON.stringify(JSON.stringify(settings))}); ${extra}`);

// ---------------- popup ----------------
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 600, deviceScaleFactor: 2, mobile: false });
async function popup(fakePort = null, after = 700) {
  await navigate(`${BASE}/ext/popup.html`, 100);
  await store({ ...SETTINGS, keepAliveStatus: { time: Date.now() - 60000, ok: true, action: 'ping', method: 'ping' } },
    `localStorage.setItem('__mockTab', JSON.stringify({ id: 7, url: 'https://www.portaleargo.it/voti/?classic' }));`);
  await navigate(`${BASE}/ext/popup.html`, 400);
  if (fakePort) {
    await evaluate(`window.__makePort = () => {
      const l = { msg: [], disc: [] };
      const emit = x => l.msg.forEach(fn => fn(x));
      const port = { onMessage: { addListener: fn => l.msg.push(fn), removeListener: fn => { l.msg = l.msg.filter(x => x !== fn); } },
        onDisconnect: { addListener: fn => l.disc.push(fn) },
        postMessage(m) { if (m.type === 'run') ${JSON.stringify(fakePort)}.forEach((x, i) => setTimeout(() => emit(x), 30 * (i + 1))); } };
      setTimeout(() => emit({ type: 'ready' }), 5);
      return port;
    }; document.getElementById(${JSON.stringify(fakePort.button || 'btn-firma')}).click();`);
    await sleep(after);
  }
  // altezza reale del contenuto (il popup di Chrome si adatta)
  // per la documentazione l'elenco dei passi si mostra per intero, dall'inizio
  await evaluate(`document.querySelectorAll('.run-steps').forEach(l => { l.style.maxHeight = 'none'; }); window.scrollTo(0, 0);`);
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 200, deviceScaleFactor: 2, mobile: false });
  await sleep(100);
  const h = await evaluate(`return Math.ceil(Math.max(...[...document.body.children].filter(e => e.offsetParent || e.tagName === 'MAIN')
    .map(e => e.getBoundingClientRect().bottom))) + 12`);
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: Math.min(820, h), deviceScaleFactor: 2, mobile: false });
  await sleep(150);
  await evaluate(`window.scrollTo(0, 0)`);
}
const step = (text, kind = 'ok') => ({ type: 'step', step: { text, kind } });

await popup();
await shot('popup-registro.png');

const firmaOk = [
  step('Cliccato «Home» nel menu a sinistra'),
  step('Lezioni di oggi nella Home: 3A 1ª ✓, 3A 2ª ✓, 4B 3ª, 2C 5ª'),
  step('Ora attuale 10:12 → lezione in corso: 3ª ora · 4B · TPSIT (10:00–11:00)'),
  step('Cliccato «3ª ora - TPSIT» della classe 4B nella Home'),
  step('Aperto il registro di classe 4B'),
  step('Cliccata l\'icona arancione «da firmare» della 3ª ora'),
  step('3ª ora firmata'),
  { type: 'done', result: { ok: true, summary: 'Firmata la 3ª ora · 4B · TPSIT (10:00–11:00)' } }
];
await popup(firmaOk, 600);
await shot('popup-firma.png');

const domanda = [
  step('Cliccato «Home» nel menu a sinistra'),
  step('Lezioni di oggi nella Home: 3A 1ª ✓, 3A 2ª ✓, 4B 3ª ✓, 2C 5ª'),
  step('Ora attuale 11:20 → nessuna lezione in corso: la prossima più vicina: 5ª ora · 2C · INFORMATICA (12:00–13:00)'),
  step('Cliccato «5ª ora - INFORMATICA» della classe 2C nella Home'),
  step('Aperto il registro di classe 2C'),
  step('Chiesto il permesso: la 5ª non è in corso (adesso sono le 11:20)', 'ask'),
  { type: 'ask', id: 'q', question: 'La 5ª ora (12:00–13:00) · 2C · INFORMATICA non è in corso: adesso sono le 11:20. Vuoi firmarla lo stesso?', confirmLabel: 'Firma lo stesso', cancelLabel: 'Non firmare' }
];
await popup(domanda, 600);
await shot('popup-domanda.png');

const errore = [
  step('Cliccato «Home» nel menu a sinistra'),
  step('Lezioni di oggi nella Home: 3A 1ª, 3A 2ª, 4B 3ª, 2C 5ª'),
  step('Ora attuale 10:12 → lezione in corso: 3ª ora · 4B · TPSIT (10:00–11:00)'),
  step('Cliccato «3ª ora - TPSIT» della classe 4B nella Home'),
  step('Aperto il registro di classe 4B'),
  step('Il pulsante «Appello» è disattivato per la 3ª ora di 4B: DidUP lo attiva quando l\'ora è firmata da te. Firma prima con «Firma ora», poi riprova.', 'error'),
  { type: 'done', result: { ok: false, error: 'Il pulsante «Appello» è disattivato…' } }
];
errore.button = 'btn-appello';
await popup(Object.assign(errore, { button: 'btn-appello' }), 500);
await evaluate(`document.getElementById('run-title').textContent = 'Appello'`);
await shot('popup-errore.png');

// ---------------- impostazioni ----------------
await send('Emulation.setDeviceMetricsOverride', { width: 980, height: 1200, deviceScaleFactor: 1.5, mobile: false });
await navigate(`${BASE}/ext/options.html`, 100);
await store(SETTINGS);
await navigate(`${BASE}/ext/options.html`, 700);
await shot('impostazioni-accesso.png', '#sec-scuola', 6);
await shot('impostazioni-sessione.png', '#sec-sessione', 6);
await evaluate(`document.querySelectorAll('#discipline-list li')[1].click()`);
await sleep(300);
await shot('impostazioni-argomenti.png', '#sec-argomenti', 6);
await evaluate(`document.querySelector('.kind-tab[data-kind=compiti]').click()`);
await sleep(300);
await shot('impostazioni-compiti.png', '#sec-argomenti', 6);
await shot('impostazioni-backup.png', '#sec-backup', 6);

// ---------------- "I miei argomenti" nel registro ----------------
await send('Emulation.setDeviceMetricsOverride', { width: 940, height: 620, deviceScaleFactor: 1.5, mobile: false });
// gli script del registro si attivano solo sull'indirizzo del registro (qui il server locale)
await navigate(`${BASE}/voti/?classic`, 100);
await store({ ...SETTINGS, argoDashboardPattern: `${BASE}/voti/?classic`, argoLoginUrl: `${BASE}/auth/sso/login`, basePortalUrl: `${BASE}/voti/` });
await navigate(`${BASE}/voti/?classic`, 1200);
await evaluate(`document.querySelector('[data-argo-assistant-topics="button"]').shadowRoot.querySelector('button').click();`);
await sleep(500);
await shot('argomenti-registro.png');
await evaluate(`document.querySelector('[data-argo-assistant-topics="picker"]').shadowRoot.querySelector('.tabs button[data-kind=compiti]').click();`);
await sleep(300);
await shot('compiti-registro.png');

ws.close();
chrome.kill('SIGKILL');
server.close();
console.log('immagini in', OUT);
process.exit(0);
