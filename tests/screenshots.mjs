// Rigenera le immagini del README (docs/img) con dati di fantasia:
//   node tests/screenshots.mjs
// Impostazioni e pulsanti sono quelli veri dell'estensione (con il finto chrome.*);
// il registro è il DidUP finto dei test (tests/mock/didup-mock.html) e una pagina
// finta che imita la schermata di modifica della lezione.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { prepareMockExtension, workDir, killOnExit, CHROME, PROJECT } from './lib/prepare.mjs';

const EXT = prepareMockExtension();
const MOCK = fs.readFileSync(path.join(PROJECT, 'tests', 'mock', 'didup-mock.html'), 'utf8');
const OUT = path.join(PROJECT, 'docs', 'img');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 9343;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SETTINGS = {
  schemaVersion: 1, codiceScuola: 'SG12345', docenteNome: 'ROSSI MARIO', loginMethod: 'spid', spidProvider: 'posteid',
  autoLogin: true, ricordami: true, keepAliveEnabled: true, buttonsPosition: 'right', buttonsTheme: 'argo', guidaPulsanti: false, guidaArgomenti: false,
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
  ${['page-bridge.js', 'mock-chrome.js', 'settings.js', 'content-common.js', 'sessione.js', 'argomenti.js'].map(f => `<script src="/ext/${f}"></script>`).join('')}
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
  if (url.pathname === '/voti/app') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(MOCK.replace('</body>', ['page-bridge.js', 'mock-chrome.js', 'settings.js', 'content-common.js', 'sessione.js', 'azioni.js', 'toolbar.js']
      .map(f => `<script src="/ext/${f}"></script>`).join('') + '</body>'));
  }
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
  const [base, hash = ''] = url.split(/(?=#)/);
  await send('Page.navigate', { url: base + (base.includes('?') ? '&' : '?') + 'n=' + (++nav) + hash });
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

// ---------------- pulsanti nella barra di DidUP ----------------
// Fuso orario emulato in cui sono circa le 10:10: la 3ª ora (4B) è in corso.
const now = new Date();
let tzOffset = (10 - now.getUTCHours() + 24) % 24;
if (tzOffset > 14) tzOffset -= 24;
await send('Emulation.setTimezoneOverride', { timezoneId: tzOffset === 0 ? 'Etc/GMT' : `Etc/GMT${tzOffset > 0 ? '-' : '+'}${Math.abs(tzOffset)}` });
const nowMin = (now.getUTCHours() + tzOffset + 24) % 24 * 60 + now.getUTCMinutes();
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const times = {};
for (let n = 1; n <= 5; n++) times[n] = `${hm(nowMin - 10 + (n - 3) * 60)} - ${hm(nowMin - 10 + (n - 2) * 60)}`;
const DIDUP = { times, utente: 'ROSSI MARIO', docenteRiga: 'ROSSI MARIO',
  classi: [{ classe: '3A', lezioni: [{ numOra: 1, materia: 'INFORMATICA' }, { numOra: 2, materia: 'INFORMATICA' }] },
    { classe: '4B', lezioni: [{ numOra: 3, materia: 'TPSIT' }] }, { classe: '2C', lezioni: [{ numOra: 5, materia: 'INFORMATICA' }] }] };
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 640, deviceScaleFactor: 1.5, mobile: false });
const didup = async (cfg, extraSettings = {}, wait = 1300) => {
  await navigate(`${BASE}/voti/app`, 100);
  await store({ ...SETTINGS, argoDashboardPattern: `${BASE}/voti/`, argoLoginUrl: `${BASE}/auth/sso/login`, basePortalUrl: `${BASE}/voti/`, ...extraSettings });
  await navigate(`${BASE}/voti/app#${encodeURIComponent(JSON.stringify({ ...DIDUP, ...cfg }))}`, wait);
};
const waitGuide = () => evaluate(`for (let i = 0; i < 80 && !document.querySelector('[data-argo-assistant="guide"]'); i++) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 600));`);
const tb = js => evaluate(`const root = document.querySelector('[data-argo-assistant="toolbar"]').shadowRoot; ${js}`);
// ritaglio: dalla barra in alto fino al pannello dei passi
async function shotPanel(name) {
  const r = await evaluate(`const t = document.querySelector('[data-argo-assistant="toolbar"]').getBoundingClientRect();
    const p = document.querySelector('[data-argo-assistant="run"]').shadowRoot.querySelector('.p').getBoundingClientRect();
    return { x: Math.min(t.left, p.left) - 16, y: 0, w: Math.max(t.right, p.right) - Math.min(t.left, p.left) + 32 + 140, h: p.bottom + 16 };`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r.x), y: 0, width: Math.min(r.w, 1100 - Math.max(0, r.x)), height: r.h, scale: 1 } });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('  ✔', path.join('docs', 'img', name));
}
const waitResult = (answer = null) => evaluate(`for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100));
    const run = document.querySelector('[data-argo-assistant="run"]'); if (!run) continue;
    const ask = run.shadowRoot.querySelector('.askbox');
    if (${JSON.stringify(answer)} === 'stop' && ask && !ask.hidden) return;
    const res = run.shadowRoot.querySelector('.result'); if (res && !res.hidden) return;
  }`);

await didup({});
const pos = await tb(`const r = root.host.getBoundingClientRect(); return { x: r.left + 18, y: r.top + 18 };`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(pos.x), y: Math.round(pos.y) });
await sleep(300);
{
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 520, y: 0, width: 580, height: 110, scale: 1 } });
  fs.writeFileSync(path.join(OUT, 'pulsanti-barra.png'), Buffer.from(data, 'base64'));
  console.log('  ✔', path.join('docs', 'img', 'pulsanti-barra.png'));
}
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 600 });

// Guida della prima volta sui pulsanti
await didup({}, { guidaPulsanti: true }, 300);
await waitGuide();
{
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 440, y: 0, width: 660, height: 330, scale: 1 } });
  fs.writeFileSync(path.join(OUT, 'guida-pulsanti.png'), Buffer.from(data, 'base64'));
  console.log('  ✔', path.join('docs', 'img', 'guida-pulsanti.png'));
}

// Firma in una classe articolata: il collega ha già firmato la sua riga della stessa ora
await didup({ articolata: { '4B': { 3: { docente: 'BIANCHI ANNA', materia: 'LABORATORIO', firmata: true } } }, signed: ['3A#1', '3A#2'] });
await tb(`root.querySelector('[data-action="firma"]').click()`);
await waitResult();
await shotPanel('pannello-firma.png');

// Prossima lezione non ancora iniziata: chiede il permesso
await didup({ signed: ['3A#1', '3A#2', '4B#3'], times: { ...times, 3: `${hm(nowMin - 70)} - ${hm(nowMin - 10)}`, 4: `${hm(nowMin - 10)} - ${hm(nowMin + 20)}`, 5: `${hm(nowMin + 20)} - ${hm(nowMin + 80)}` } });
await tb(`root.querySelector('[data-action="firma"]').click()`);
await waitResult('stop');
await shotPanel('pannello-domanda.png');

// Appello su un'ora non firmata: errore in rosso
await didup({ signed: ['3A#1', '3A#2'] });
await tb(`root.querySelector('[data-action="appello"]').click()`);
await waitResult();
await shotPanel('pannello-errore.png');
await send('Emulation.clearTimezoneOverride').catch(() => send('Emulation.setTimezoneOverride', { timezoneId: '' }));

// ---------------- impostazioni ----------------
await send('Emulation.setDeviceMetricsOverride', { width: 980, height: 1200, deviceScaleFactor: 1.5, mobile: false });
await navigate(`${BASE}/ext/options.html`, 100);
// stato della sessione di esempio: ultimo controllo adesso, ultima ricarica automatica 25 minuti fa
const t0 = Date.now();
await store({ ...SETTINGS, keepAliveStatus: { time: t0, tabId: 1, ok: true, expired: false, action: 'check', idleMin: 10, idleSec: 120,
  lastUse: t0 - 2 * 60000, nextReloadAt: t0 + 8 * 60000, tokenExpiresAt: t0 + 41 * 60000, lastReloadAt: t0 - 25 * 60000, lastReloadReason: 'inattività' } });
await navigate(`${BASE}/ext/options.html`, 700);
await shot('impostazioni-accesso.png', '#sec-scuola', 6);
await shot('impostazioni-sessione.png', '#sec-sessione', 6);
await shot('impostazioni-funzioni.png', '#sec-funzioni', 6);
await shot('impostazioni-pulsanti.png', '#sec-pulsanti', 6);
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

// Guida della prima volta su «Argomenti e compiti»
await navigate(`${BASE}/voti/?classic`, 100);
await store({ ...SETTINGS, guidaArgomenti: true, argoDashboardPattern: `${BASE}/voti/?classic`, argoLoginUrl: `${BASE}/auth/sso/login`, basePortalUrl: `${BASE}/voti/` });
await navigate(`${BASE}/voti/?classic`, 300);
await waitGuide();
await shot('guida-argomenti.png');

ws.close();
chrome.kill('SIGKILL');
server.close();
console.log('immagini in', OUT);
process.exit(0);
