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
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/ext/')) {
    const file = path.join(EXT, decodeURIComponent(url.pathname.slice(5)));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
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

// Sessione: un solo metodo (ricarica dopo un periodo senza uso), si può solo attivare o disattivare
check(await evaluate(`return !document.getElementById('keepAliveInterval') && !document.querySelector('input[name=keepAliveMethod]')`), 'sessione: nessuna scelta di intervallo o metodo');
check(await evaluate(`return document.querySelector('#sec-sessione .switch-row').textContent.trim() === 'Mantieni attiva la sessione dopo l\\'accesso'`), 'testo dell\'interruttore: «Mantieni attiva la sessione dopo l\'accesso»');
await evaluate(`document.getElementById('keepAliveEnabled').click();`);
await sleep(200);
check((await store()).keepAliveEnabled === false && /disattivato/.test(await evaluate(`return document.getElementById('keepalive-status').textContent`)), 'mantenimento disattivato: salvato e indicato');
await evaluate(`document.getElementById('keepAliveEnabled').click();`);
await sleep(200);
await evaluate(`await chrome.storage.local.set({ keepAliveStatus: { time: Date.now(), ok: true, action: 'check', idleMin: 10, nextReloadAt: Date.now() + 7 * 60e3, tokenExpiresAt: Date.now() + 40 * 60e3 } });`);
await sleep(150);
let ks = await evaluate(`return document.getElementById('keepalive-status').textContent`);
check(/Sessione attiva/.test(ks) && /prossima ricarica verso le/.test(ks) && /token di accesso di Argo valido fino alle/.test(ks), 'stato: sessione attiva, prossima ricarica e scadenza del token', ks);
await evaluate(`await chrome.storage.local.set({ keepAliveStatus: { time: Date.now(), ok: true, action: 'reload', reason: 'inattività', idleMin: 10, lastReloadAt: Date.now() } });`);
await sleep(150);
ks = await evaluate(`return document.getElementById('keepalive-status').textContent`);
check(/Registro ricaricato alle .* dopo 10 minuti senza uso/.test(ks), 'stato: ricarica per inattività', ks);
await evaluate(`await chrome.storage.local.set({ keepAliveStatus: { time: Date.now(), ok: false, expired: true, why: 'box', action: 'wait-busy', busy: 'è aperta una finestra di DidUP (per esempio la modifica di una lezione)' },
  sessionLog: [{ at: Date.now(), why: 'box', sinceLoadMin: 59, idleMin: 3 }], keepAliveIdleMin: 6 });`);
await sleep(150);
ks = await evaluate(`return document.getElementById('keepalive-status').textContent`);
check(/Sessione scaduta/.test(ks) && /modifica di una lezione/.test(ks) && /Scadenze osservate/.test(ks) && /59 minuti dopo il caricamento/.test(ks) && /Ricordami/.test(ks) &&
  await evaluate(`return document.getElementById('idle-min').textContent`) === '6', 'stato: scaduta ma finestra aperta, scadenze osservate con la causa, soglia accorciata', ks);
await evaluate(`await chrome.storage.local.set({ keepAliveStatus: { time: Date.now(), ok: false, expired: true, action: 'login', loginRequired: true, lastReloadAt: Date.now() }, keepAliveIdleMin: 10 });`);
await sleep(150);
ks = await evaluate(`return document.getElementById('keepalive-status').textContent`);
check(/ha chiesto di nuovo l'accesso/.test(ks), 'stato: dopo la ricarica Argo ha chiesto un nuovo accesso', ks);
await shot('03a-sessione', '#sec-sessione');

// «Ricordami» (predefinito: attivo)
check(await evaluate(`return document.getElementById('ricordami').checked`), '«Ricordami» attivo in modo predefinito');
await evaluate(`document.getElementById('ricordami').click();`);
await sleep(150);
check((await store()).ricordami === false, '«Ricordami» disattivato e salvato');
await evaluate(`document.getElementById('ricordami').click();`);
await sleep(150);

// Link al repository
const repo = await evaluate(`return [document.getElementById('repo-link').href, document.getElementById('repo-link-foot').href, document.getElementById('repo-link').target]`);
check(repo[0] === 'https://github.com/madxit/argo_didup_booster' && repo[1] === repo[0] && repo[2] === '_blank', 'link al repository GitHub in cima e in fondo', JSON.stringify(repo));

// Funzioni nel registro e guide
let fz = await evaluate(`return ['showFirma', 'showAppello', 'showArgomenti', 'guidaPulsanti', 'guidaArgomenti'].map(id => document.getElementById(id).checked)`);
check(fz.every(Boolean), 'funzioni tutte attive e guide da mostrare in modo predefinito', JSON.stringify(fz));
const pv = js => evaluate(`const b = document.getElementById('pv-buttons'); const root = b.shadowRoot; ${js}`);
const visibleInPreview = () => pv(`return { buttons: [...root.querySelectorAll('button.b')].filter(x => getComputedStyle(x).display !== 'none').map(x => x.dataset.action),
  pill: getComputedStyle(document.getElementById('pv-topics').shadowRoot.querySelector('.pill')).display !== 'none' };`);
await evaluate(`document.getElementById('showAppello').click(); document.getElementById('showArgomenti').click(); document.getElementById('guidaPulsanti').click();`);
await sleep(200);
s = await store();
let vis = await visibleInPreview();
check(s.showAppello === false && s.showArgomenti === false && s.showFirma !== false && s.guidaPulsanti === false && vis.buttons.join() === 'firma' && !vis.pill,
  'Appello e Argomenti tolti: salvati e spariti dall\'anteprima; guida dei pulsanti spenta', JSON.stringify(vis));
await shot('03d-funzioni', '#sec-funzioni');
await evaluate(`document.getElementById('showAppello').click(); document.getElementById('showArgomenti').click(); document.getElementById('guidaPulsanti').click();`);
await sleep(200);
vis = await visibleInPreview();
check(vis.buttons.join() === 'firma,appello' && vis.pill && (await store()).guidaPulsanti === true, '…e rimessi', JSON.stringify(vis));
// la guida mostrata nel registro spegne la casella anche con le impostazioni aperte
await evaluate(`await chrome.storage.local.set({ guidaArgomenti: false });`);
await sleep(150);
check(await evaluate(`return document.getElementById('guidaArgomenti').checked === false`), 'guida mostrata nel registro: la casella si spegne da sola anche qui');
await evaluate(`await chrome.storage.local.set({ guidaArgomenti: true });`);

// Aspetto dei pulsanti: «Simil Argo» predefinito e primo dell'elenco
let pvs = await pv(`return { n: root.querySelectorAll('button.b').length, themes: [...document.querySelectorAll('input[name=buttonsTheme]')].map(i => i.value),
  firstLabel: document.querySelector('.theme-option strong').textContent,
  checked: document.querySelector('input[name=buttonsTheme]:checked').value, pos: document.querySelector('input[name=buttonsPosition]:checked').value,
  right: b.style.right, bg: getComputedStyle(root.querySelector('.b')).backgroundColor, border: getComputedStyle(root.querySelector('.b')).borderTopColor,
  pill: !!document.getElementById('pv-topics').shadowRoot.querySelector('.pill') };`);
check(pvs.n === 2 && pvs.themes.length === 6 && pvs.themes[0] === 'argo' && pvs.firstLabel === 'Simil Argo (predefinito)' && pvs.checked === 'argo' && pvs.pos === 'right' &&
  pvs.right && pvs.pill && pvs.bg === 'rgb(255, 255, 255)' && pvs.border === 'rgb(255, 150, 37)',
  'pulsanti: 6 stili, «Simil Argo» predefinito e in cima, a destra, anteprima con Firma, Appello e «Argomenti e compiti»', JSON.stringify(pvs));
await shot('03b-pulsanti-simil-argo', '#sec-pulsanti');
await evaluate(`document.querySelector('input[name=buttonsTheme][value=contrast]').click(); document.querySelector('input[name=buttonsPosition][value=center]').click();`);
await sleep(200);
s = await store();
pvs = await pv(`return { left: b.style.left, bg: getComputedStyle(root.querySelector('.b')).backgroundColor, fg: getComputedStyle(root.querySelector('.b')).color };`);
check(s.buttonsTheme === 'contrast' && s.buttonsPosition === 'center' && pvs.left === '50%' && pvs.bg === 'rgb(0, 0, 0)' && pvs.fg === 'rgb(255, 235, 59)',
  'scelta salvata e anteprima aggiornata (alto contrasto, al centro)', JSON.stringify(pvs));
await shot('03c-pulsanti-contrasto', '#sec-pulsanti');
await evaluate(`document.querySelector('input[name=buttonsTheme][value=argo]').click(); document.querySelector('input[name=buttonsPosition][value=right]').click();`);
await sleep(200);
check(sanitizeOk(await evaluate(`return sanitizeSettings({ buttonsTheme: 'rosa', buttonsPosition: 'sotto' })`)), 'import: stile o posizione sconosciuti → valori predefiniti con avviso');
function sanitizeOk(r) { return r.settings.buttonsTheme === 'argo' && r.settings.buttonsPosition === 'right' && r.warnings.length === 2; }

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
  settings: { ...exp.settings, codiceScuola: 'ab99999', buttonsTheme: 'sepia', keepAliveInterval: 99999, keepAliveMethod: 'boh',
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
check(s.codiceScuola === 'AB99999' && s.buttonsTheme === 'sepia' && !('keepAliveInterval' in s) && !('keepAliveMethod' in s) &&
  JSON.stringify(s.discipline) === JSON.stringify([{ nome: 'Storia', argomenti: ['Roma antica', 'Medioevo'], compiti: ['Ripassare Roma'] }]), 'import "sostituisci" con valori ripuliti/validati (anche i compiti)', JSON.stringify(s.discipline));
check(await evaluate(`return document.getElementById('codiceScuola').value === 'AB99999' && document.querySelector('#discipline-list li .item-text').textContent === 'Storia'`), 'form aggiornato dopo l\'import');

// ---- Import: aggiungi (merge) dal file esportato ----
await setImportFile(exported);
await evaluate(`document.querySelector('#choice-buttons button[value=merge]').click();`);
await sleep(400);
s = await store();
check(s.codiceScuola === 'AB99999' && s.discipline.map(d => d.nome).join('|') === 'Storia|Fisica|Matematica' &&
  s.discipline.some(d => d.compiti.includes('Studiare il capitolo 3')), 'import "aggiungi argomenti e compiti" unisce senza toccare il codice scuola', JSON.stringify(s.discipline));

// ---- Versione in cima alla pagina ----
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const ver = await evaluate(`return { v: document.getElementById('info-version').textContent, info: !!document.getElementById('sec-info'), commit: !!document.getElementById('info-commit') }`);
check(ver.v === 'v' + manifest.version && !ver.info && !ver.commit, `Versione in cima alle impostazioni (v${manifest.version}), niente sezione commit`, JSON.stringify(ver));

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
