// Test della pagina delle impostazioni (Chrome headless + server locale).
// Test end-to-end delle pagine dell'estensione con Chrome headless + CDP.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMockExtension, workDir, killOnExit, CHROME as CHROME_BIN } from './lib/prepare.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXT = prepareMockExtension();
const SHOTS = workDir('shots');
const DOWNLOADS = workDir('downloads');
const CHROME = CHROME_BIN;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------- server locale ----------------
const stats = { pageLoads: 0, pings: 0, expire: false };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/ext/')) {
    const file = path.join(EXT, decodeURIComponent(url.pathname.slice(5)));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  if (url.pathname === '/voti/') {
    const isFetch = req.headers['sec-fetch-dest'] === 'empty';
    if (isFetch) stats.pings++; else stats.pageLoads++;
    if (stats.expire) { res.writeHead(302, { location: '/auth/sso/login' }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!DOCTYPE html><html><body><h1>Registro finto</h1><textarea id="ta"></textarea>
      <script src="/ext/mock-chrome.js"></script><script src="/ext/settings.js"></script><script src="/ext/keepalive.js"></script></body></html>`);
  }
  if (url.pathname === '/auth/sso/login') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!DOCTYPE html><html><body>login</body></html>');
  }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------------- Chrome + CDP ----------------
const profile = fs.mkdtempSync(path.join(workDir('profiles'), 'p-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--remote-debugging-port=9337', '--window-size=1100,1500', 'about:blank'
], { stdio: 'ignore' });
killOnExit(chrome);

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch('http://127.0.0.1:9337/json/list')).json(); if (targets.length) break; } catch (e) {}
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
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
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
async function navigate(url) {
  await send('Page.navigate', { url });
  await sleep(700);
}
async function shot(name, clipSelector) {
  let params = { format: 'png' };
  if (clipSelector) {
    const rect = await evaluate(`const r = document.querySelector(${JSON.stringify(clipSelector)}).getBoundingClientRect(); return {x: r.x, y: r.y + scrollY, width: r.width, height: r.height};`);
    params = { ...params, clip: { ...rect, scale: 1 }, captureBeyondViewport: true };
  }
  const { data } = await send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });

let failures = 0;
function check(cond, label, extra = '') {
  console.log(`${cond ? '  ✔' : '  ✘'} ${label}${!cond && extra ? '\n      → ' + extra : ''}`);
  if (!cond) failures++;
}
const store = () => evaluate(`return JSON.parse(localStorage.getItem('__mockStore') || '{}')`);

// ============ TEST PAGINA IMPOSTAZIONI ============
console.log('\n[Impostazioni]');
await navigate(`${BASE}/ext/options.html`);
await evaluate(`localStorage.clear(); localStorage.setItem('__mockSync', JSON.stringify({ docenteNome: 'ROSSI  MARIO', password: 'segreta', username: 'x' }));`);
await navigate(`${BASE}/ext/options.html`);
let s = await store();
check(s.schemaVersion === 1 && s.docenteNome === 'ROSSI MARIO' && !('password' in s), 'migrazione da storage.sync (solo campi utili)');
check(await evaluate(`return !document.getElementById('missing-code-banner').hidden && document.activeElement.id === 'codiceScuola'`), 'banner "codice scuola mancante" visibile e campo a fuoco');
await shot('01-options-vuote');

await evaluate(`const el = document.getElementById('codiceScuola'); el.value = 'sg 12'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));`);
await sleep(500);
check((await store()).codiceScuola === 'SG12', 'codice scuola normalizzato (maiuscolo, senza spazi) e salvato');
await evaluate(`const el = document.getElementById('codiceScuola'); el.value = 'SG-12345'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));`);
await sleep(500);
check((await store()).codiceScuola === 'SG12' && await evaluate(`return !document.getElementById('codiceScuola-error').hidden`), 'codice non valido: errore mostrato e non salvato');
await evaluate(`const el = document.getElementById('codiceScuola'); el.value = 'sg12345'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));`);
await sleep(500);
s = await store();
check(s.codiceScuola === 'SG12345' && await evaluate(`return document.getElementById('missing-code-banner').hidden`), 'codice valido salvato, banner nascosto');

// Sessione
await evaluate(`const el = document.getElementById('keepAliveInterval'); el.value = '5'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));`);
await sleep(200);
check((await store()).keepAliveInterval === 30 && await evaluate(`return document.getElementById('keepAliveInterval').value === '30'`), 'intervallo limitato al minimo (30 s)');
await evaluate(`const el = document.getElementById('keepAliveInterval'); el.value = '300'; el.dispatchEvent(new Event('change'));`);
await evaluate(`document.querySelector('input[name=keepAliveMethod][value=reload]').click();`);
await sleep(200);
s = await store();
check(s.keepAliveInterval === 300 && s.keepAliveMethod === 'reload', 'intervallo e metodo salvati');
check(await evaluate(`return document.getElementById('interval-human').textContent`) === '= 5 min', 'etichetta durata "= 5 min"');
await evaluate(`document.querySelector('input[name=keepAliveMethod][value=ping]').click();`);

// Discipline
const addDisc = nome => evaluate(`document.getElementById('new-disciplina').value = ${JSON.stringify(nome)}; document.getElementById('add-disciplina-form').requestSubmit();`);
await addDisc('Matematica');
await addDisc('Fisica');
await addDisc('matematica');
await sleep(200);
s = await store();
check(s.discipline.length === 2 && s.discipline[1].nome === 'Fisica', 'discipline aggiunte, duplicato ignorato');
check(await evaluate(`return document.querySelector('#discipline-list li.selected .item-text').textContent`) === 'Matematica', 'la disciplina esistente viene selezionata se si reinserisce');

await evaluate(`document.getElementById('new-argomenti').value = '- Sistemi lineari\\n• Equazioni di primo grado\\n\\nequazioni di PRIMO grado\\nDisequazioni\\nArea del cerchio'; document.getElementById('add-argomenti-form').requestSubmit();`);
await sleep(200);
s = await store();
check(JSON.stringify(s.discipline[0].argomenti) === JSON.stringify(['Sistemi lineari', 'Equazioni di primo grado', 'Disequazioni', 'Area del cerchio']), 'argomenti multipli: puntini rimossi, duplicati scartati');
check((await evaluate(`return document.getElementById('toast-msg').textContent`)).includes('4 argomenti aggiunti. 1 già presente'), 'toast con conteggio aggiunti/duplicati');

// Invio nella textarea aggiunge
await evaluate(`const ta = document.getElementById('new-argomenti'); ta.value = 'Teorema di Pitagora'; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
await sleep(200);
check((await store()).discipline[0].argomenti.at(-1) === 'Teorema di Pitagora', 'Invio nella casella aggiunge l\'argomento');

// Frecce
await evaluate(`document.querySelectorAll('#argomenti-list li')[0].querySelector('[data-act=down]').click();`);
await sleep(150);
check((await store()).discipline[0].argomenti.slice(0, 2).join('|') === 'Equazioni di primo grado|Sistemi lineari', 'freccia ▼ sposta l\'argomento');

// Drag & drop: sposta l'ultimo ("Teorema di Pitagora") prima del primo
await evaluate(`
  const items = document.querySelectorAll('#argomenti-list li');
  const src = items[items.length - 1], dst = items[0];
  src.querySelector('.drag-handle').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const dt = new DataTransfer();
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const r = dst.getBoundingClientRect();
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 }));
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 }));
  src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
`);
await sleep(150);
check((await store()).discipline[0].argomenti[0] === 'Teorema di Pitagora', 'drag & drop riordina gli argomenti');

// Drag & drop discipline: Fisica sopra Matematica, la selezione segue Matematica
await evaluate(`
  const items = document.querySelectorAll('#discipline-list li');
  const src = items[1], dst = items[0];
  src.querySelector('.drag-handle').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const dt = new DataTransfer();
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const r = dst.getBoundingClientRect();
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 }));
  src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
`);
await sleep(150);
s = await store();
check(s.discipline.map(d => d.nome).join('|') === 'Fisica|Matematica' &&
  await evaluate(`return document.querySelector('#discipline-list li.selected .item-text').textContent`) === 'Matematica', 'drag & drop discipline, la selezione resta su Matematica');

// Modifica in linea (doppio clic)
await evaluate(`
  const li = document.querySelectorAll('#argomenti-list li')[1];
  li.querySelector('.item-text').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = li.querySelector('.inline-edit'); input.value = 'Equazioni di primo grado intere';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
`);
await sleep(150);
check((await store()).discipline[1].argomenti[1] === 'Equazioni di primo grado intere', 'modifica in linea con doppio clic + Invio');

// Ordina A→Z + annulla
const beforeSort = (await store()).discipline[1].argomenti.join('|');
await evaluate(`document.getElementById('sort-az').click();`);
await sleep(150);
s = await store();
check(s.discipline[1].argomenti.join('|') === 'Area del cerchio|Disequazioni|Equazioni di primo grado intere|Sistemi lineari|Teorema di Pitagora', 'ordina A→Z');
await evaluate(`document.getElementById('toast-action').click();`);
await sleep(150);
check((await store()).discipline[1].argomenti.join('|') === beforeSort, 'annulla ordinamento');

// Argomenti per Fisica
await evaluate(`document.querySelector('#discipline-list li .item-text').click();`);
await evaluate(`document.getElementById('new-argomenti').value = 'Moto rettilineo uniforme\\nLeggi di Newton\\nÈnergia cinetica'; document.getElementById('add-argomenti-form').requestSubmit();`);
await sleep(200);
await shot('02-options-compilate');
await shot('03-argomenti-card', '#sec-argomenti');

// Compiti: seconda scheda della disciplina, stessa logica degli argomenti
await evaluate(`document.querySelectorAll('#discipline-list li .item-text')[0].click();`);
await sleep(150);
const disc0 = (await store()).discipline[0].nome;
await evaluate(`document.querySelector('.kind-tab[data-kind=compiti]').click();`);
await sleep(100);
check(await evaluate(`return document.querySelector('.kind-tab[data-kind=compiti]').getAttribute('aria-selected') === 'true' &&
  document.getElementById('new-argomenti').placeholder.startsWith('Scrivi un compito') && document.getElementById('kind-hint').textContent.includes('«Compiti»')`),
  'scheda «Compiti»: casella e indicazione dedicate (vanno nella casella «Compiti» del registro)');
await evaluate(`document.getElementById('new-argomenti').value = 'Esercizi 1-5 pag. 32\\nStudiare il capitolo 3\\nesercizi 1-5 PAG. 32'; document.getElementById('add-argomenti-form').requestSubmit();`);
await sleep(200);
s = await store();
check(JSON.stringify(s.discipline[0].compiti) === JSON.stringify(['Esercizi 1-5 pag. 32', 'Studiare il capitolo 3']) &&
  s.discipline[0].argomenti.length > 0 && !s.discipline[0].argomenti.includes('Studiare il capitolo 3'),
  'compiti salvati a parte dagli argomenti (duplicati scartati)', JSON.stringify(s.discipline[0]));
check(await evaluate(`return document.getElementById('count-compiti').textContent === '2' &&
  document.getElementById('count-argomenti').textContent === String(${JSON.stringify(s.discipline[0].argomenti.length)}) &&
  document.querySelectorAll('#argomenti-list li').length === 2`), 'conteggi nelle schede Argomenti / Compiti');
check(await evaluate(`const li = [...document.querySelectorAll('#discipline-list li')].find(l => l.querySelector('.item-text').textContent === ${JSON.stringify(disc0)});
  return li.querySelector('.item-sub').textContent`) === `${s.discipline[0].argomenti.length} argomenti · 2 compiti`, 'sotto il nome della disciplina: «N argomenti · 2 compiti»');
await evaluate(`document.querySelectorAll('#argomenti-list li')[1].querySelector('[data-act=up]').click();`);
await sleep(150);
check((await store()).discipline[0].compiti[0] === 'Studiare il capitolo 3', 'anche i compiti si riordinano');
await shot('03b-compiti');
await evaluate(`document.querySelector('.kind-tab[data-kind=argomenti]').click();`);
await sleep(100);

// Elimina disciplina con argomenti: dialog -> Elimina -> Annulla dal toast
await evaluate(`document.querySelectorAll('#discipline-list li')[0].querySelector('[data-act=del]').click();`);
await sleep(200);
check(await evaluate(`return document.getElementById('choice-dialog').open`), 'conferma prima di eliminare una disciplina con argomenti');
await shot('04-dialog-elimina');
await evaluate(`document.querySelector('#choice-buttons button[value=ok]').click();`);
await sleep(200);
check((await store()).discipline.map(d => d.nome).join('|') === 'Matematica', 'disciplina eliminata');
await evaluate(`document.getElementById('toast-action').click();`);
await sleep(200);
s = await store();
check(s.discipline.map(d => d.nome).join('|') === 'Fisica|Matematica' && s.discipline[0].argomenti.length === 3, 'annulla eliminazione ripristina disciplina e argomenti');

// Docente
await evaluate(`const el = document.getElementById('docenteNome'); el.value = '  BIANCHI   ANNA '; el.dispatchEvent(new Event('input'));`);
await sleep(500);
check((await store()).docenteNome === 'BIANCHI ANNA', 'nome docente salvato e ripulito');

// ---- Export ----
for (const f of fs.readdirSync(DOWNLOADS)) fs.unlinkSync(path.join(DOWNLOADS, f));
await evaluate(`document.getElementById('export-btn').click();`);
let exported;
for (let i = 0; i < 30 && !exported; i++) {
  await sleep(200);
  const f = fs.readdirSync(DOWNLOADS).find(n => n.endsWith('.json'));
  if (f) exported = path.join(DOWNLOADS, f);
}
check(Boolean(exported) && /argo-didup-booster-impostazioni-\d{4}-\d{2}-\d{2}\.json$/.test(exported), 'export scarica il file JSON (argo-didup-booster-impostazioni-…)');
const exp = JSON.parse(fs.readFileSync(exported, 'utf8'));
check(exp.type === 'settings-export' && exp.settings.codiceScuola === 'SG12345' && exp.settings.discipline.length === 2 && !('keepAliveStatus' in exp.settings) && !('schemaVersion' in exp.settings), 'contenuto export corretto (solo impostazioni)');

// ---- Import: sostituisci ----
const importFile = path.join(workDir('files'), 'import-test.json');
fs.writeFileSync(importFile, JSON.stringify({
  ...exp,
  settings: { ...exp.settings, codiceScuola: 'ab99999', keepAliveInterval: 99999, keepAliveMethod: 'boh',
    discipline: [{ nome: 'Storia', argomenti: ['Roma antica', 'roma antica', '  Medioevo '], compiti: ['Ripassare  Roma', 'ripassare roma'] }, { nome: '', argomenti: ['x'] }] }
}));
async function setImportFile(file) {
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
  await sleep(400);
}
await setImportFile(importFile);
check(await evaluate(`return document.getElementById('choice-dialog').open`), 'import: dialog di scelta mostrato');
await shot('05-dialog-import');
await evaluate(`document.querySelector('#choice-buttons button[value=replace]').click();`);
await sleep(400);
s = await store();
check(s.codiceScuola === 'AB99999' && s.keepAliveInterval === 3600 && s.keepAliveMethod === 'ping' &&
  JSON.stringify(s.discipline) === JSON.stringify([{ nome: 'Storia', argomenti: ['Roma antica', 'Medioevo'], compiti: ['Ripassare Roma'] }]), 'import "sostituisci" con valori ripuliti/validati (anche i compiti)', JSON.stringify(s.discipline));
check(await evaluate(`return document.getElementById('codiceScuola').value === 'AB99999' && document.querySelector('#discipline-list li .item-text').textContent === 'Storia'`), 'form aggiornato dopo l\'import');

// ---- Import: aggiungi (merge) dal file esportato ----
await setImportFile(exported);
await evaluate(`document.querySelector('#choice-buttons button[value=merge]').click();`);
await sleep(400);
s = await store();
check(s.codiceScuola === 'AB99999' && s.discipline.map(d => d.nome).join('|') === 'Storia|Fisica|Matematica' &&
  s.discipline.some(d => d.compiti.includes('Studiare il capitolo 3')), 'import "aggiungi argomenti e compiti" unisce senza toccare il codice scuola', JSON.stringify(s.discipline));

// ---- Informazioni ----
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const buildInfo = fs.existsSync(path.join(EXT, 'build-info.json')) ? JSON.parse(fs.readFileSync(path.join(EXT, 'build-info.json'), 'utf8')) : null;
const info = await evaluate(`return ['info-name', 'info-version', 'info-commit', 'info-commit-date'].map(id => document.getElementById(id).textContent)`);
check(info[0] === 'Argo DidUP Booster' && info[1] === manifest.version && manifest.version === '1.0.0', 'Informazioni: nome «Argo DidUP Booster» e versione 1.0.0', JSON.stringify(info));
check(buildInfo && buildInfo.commit ? info[2] === buildInfo.commit.slice(0, 7) && info[3] !== '—' : info[2] === 'non disponibile' && info[3] === 'non disponibile',
  'Informazioni: commit e data dal file build-info.json (o «non disponibile» senza git)', JSON.stringify({ info, buildInfo }));
// con git: commit e data letti da build-info.json (scritto dall'hook dopo il commit)
fs.writeFileSync(path.join(EXT, 'build-info.json'), JSON.stringify({ commit: '9f60dde83241503de209e9a5e37f791b76aed08f', commitDate: '2026-11-05T12:22:24+01:00' }));
await navigate(`${BASE}/ext/options.html`, 600);
const info2 = await evaluate(`return { c: document.getElementById('info-commit').textContent, full: document.getElementById('info-commit').title,
  d: document.getElementById('info-commit-date').textContent, hint: document.getElementById('info-hint').hidden }`);
check(info2.c === '9f60dde' && info2.full.length === 40 && /5 novembre 2026/.test(info2.d) && /12:22/.test(info2.d) && info2.hint,
  'Informazioni con git: commit 9f60dde (completo nel tooltip) e data «5 novembre 2026, 12:22»', JSON.stringify(info2));
await evaluate(`document.getElementById('sec-info').scrollIntoView()`);
await shot('07-informazioni');
fs.unlinkSync(path.join(EXT, 'build-info.json'));

// ---- Import: file non valido ----
const badFile = path.join(workDir('files'), 'bad.json');
fs.writeFileSync(badFile, '{ non è json');
await setImportFile(badFile);
check((await evaluate(`return document.getElementById('backup-msg').textContent`)).includes('non è un file JSON valido'), 'import di un file non valido: messaggio di errore');
await shot('06-options-finale');

// ============ TEST POPUP ============
// (sezioni Popup e Keep-alive v2.1 superate dalla v2.2: escluse)
// ============ FINE ============
console.log('\nErrori JS in console:', consoleErrors.length ? consoleErrors : 'nessuno');
if (consoleErrors.length) failures++;
console.log(failures ? `\n✘ ${failures} verifiche fallite` : '\n✔ Tutte le verifiche superate');
ws.close();
chrome.kill();
server.close();
await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
process.exit(failures ? 1 : 0);
