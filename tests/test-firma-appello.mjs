// Test di "Firma ora" e "Appello" (azioni.js) su un DidUP finto che riproduce
// la struttura del vero: menu Ext treelist, Home con le schede delle classi,
// registro di classe con la tabella delle ore, pulsante Appello.
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
const PORT = 9341;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MOCK = fs.readFileSync(path.join(ROOT, 'mock', 'didup-mock.html'), 'utf8');
const APP_SCRIPTS = ['page-bridge.js', 'mock-chrome.js', 'settings.js', 'content-common.js', 'azioni.js', 'toolbar.js'];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/ext/')) {
    const file = path.join(EXT, decodeURIComponent(url.pathname.slice(5)));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  if (url.pathname === '/voti/app') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(MOCK.replace('</body>', APP_SCRIPTS.map(f => `<script src="/ext/${f}"></script>`).join('') + '</body>'));
  }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(workDir('profiles'), 'p-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
killOnExit(chrome);
let failures = 0;
const check = (cond, label, extra = '') => { console.log(`${cond ? '  ✔' : '  ✘'} ${label}${!cond && extra ? '\n      → ' + extra : ''}`); if (!cond) failures++; };

try {
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch (e) {}
    await sleep(200);
  }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const loadWaiters = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach(fn => fn());
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, m => m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('Eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  let navCount = 0;
  async function navigate(url, wait = 600) {
    const loaded = new Promise(r => { loadWaiters.push(r); setTimeout(r, 5000); });
    await send('Page.navigate', { url });
    await loaded;
    await sleep(wait);
  }
  async function shot(name) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  }
  await send('Page.enable');
  await send('Runtime.enable');
  // Impostazioni del finto chrome.storage: il registro finto è servito da questo server.
  // (guide della prima volta spente: hanno un test a parte più sotto)
  const STORE = { schemaVersion: 1, argoDashboardPattern: `${BASE}/voti/`, argoLoginUrl: `${BASE}/auth/sso/login`, basePortalUrl: `${BASE}/voti/`,
    guidaPulsanti: false, guidaArgomenti: false };
  await navigate(`${BASE}/voti/app?n=0`, 300);
  await evaluate(`localStorage.setItem('__mockStore', ${JSON.stringify(JSON.stringify(STORE))})`);

  async function run(cfg, action, now, answers = []) {
    await navigate(`${BASE}/voti/app?n=${++navCount}#${encodeURIComponent(JSON.stringify(cfg))}`, 900);
    return evaluate(`window.__steps = []; window.__asked = [];
      const answers = ${JSON.stringify(answers)};
      const ask = async (q, o) => { window.__asked.push({ q, yes: o.confirmLabel, no: o.cancelLabel }); return answers.length ? answers.shift() : true; };
      const r = await ArgoAzioni.esegui(${JSON.stringify(action)}, s => window.__steps.push(s), { now: new Date(${JSON.stringify('2026-11-05T' + now + ':00')}), ask });
      return { r, log: window.__didup, steps: window.__steps.map(s => s.text), asked: window.__asked };`);
  }
  const nowReal = new Date();
  const nowRealMin = nowReal.getHours() * 60 + nowReal.getMinutes();
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const slotNow = `${hhmm(Math.max(0, nowRealMin - 10))} - ${hhmm(Math.min(1439, nowRealMin + 50))}`;
  const slotOther = nowRealMin > 300 ? `${hhmm(nowRealMin - 300)} - ${hhmm(nowRealMin - 240)}` : `${hhmm(nowRealMin + 120)} - ${hhmm(nowRealMin + 180)}`;
  const stepsText = res => res.steps.join(' | ');

  // ------------------------------------------------------------------
  console.log('\n[Scelta della lezione (funzione pura)]');
  const L = (classe, numOra, stato, ini, fin) => ({ classe, numOra, stato, inizio: ini, fine: fin });
  const lez = [L('3A', 1, 'firmata', 480, 540), L('3A', 2, 'da-firmare', 540, 600), L('4B', 3, 'da-firmare', 600, 660), L('5C', 5, 'da-firmare', 720, 780)];
  const pick = (mode, list, hh, mm) => evaluate(`const s = ArgoAzioni.scegliLezione(${JSON.stringify(mode)}, ${JSON.stringify(list)}, ${hh * 60 + mm});
    return { who: s.lezione ? s.lezione.classe + '#' + s.lezione.numOra : null, motivo: s.motivo, inCorso: s.inCorso ? s.inCorso.classe + '#' + s.inCorso.numOra : null, prossima: s.prossima ? s.prossima.classe + '#' + s.prossima.numOra : null };`);
  await navigate(`${BASE}/voti/app?n=${++navCount}`, 700);
  let p = await pick('firma', lez, 9, 30);
  check(p.who === '3A#2' && p.motivo === 'in-corso', 'firma 09:30 → lezione in corso (3A 2ª)', JSON.stringify(p));
  p = await pick('firma', lez, 11, 20);
  check(p.who === '5C#5' && p.motivo === 'prossima', 'firma 11:20 (intervallo) → la prossima più vicina (5C 5ª)', JSON.stringify(p));
  p = await pick('firma', lez, 8, 30);
  check(!p.who && p.motivo === 'in-corso-gia-firmata' && p.inCorso === '3A#1' && p.prossima === '3A#2', 'firma 08:30 con la lezione in corso già firmata → nessun clic, indica la prossima', JSON.stringify(p));
  p = await pick('firma', [L('3A', 2, 'firmata', 540, 600), L('4B', 3, 'da-firmare', 600, 660)], 14, 0);
  check(p.who === '4B#3' && p.motivo === 'passata', 'firma 14:00 → l\'ultima passata non firmata', JSON.stringify(p));
  p = await pick('firma', [L('3A', 3, 'da-firmare', null, null), L('3A', 1, 'da-firmare', null, null)], 10, 0);
  check(p.who === '3A#1' && p.motivo === 'senza-orari', 'firma senza orari → la prima ora da firmare', JSON.stringify(p));
  p = await pick('appello', lez, 10, 12);
  check(p.who === '4B#3' && p.motivo === 'in-corso', 'appello 10:12 → in corso (4B 3ª)', JSON.stringify(p));
  p = await pick('appello', lez, 11, 50);
  check(p.who === '5C#5' && p.motivo === 'prossima', 'appello 11:50 → inizia entro 15 minuti (5C 5ª)', JSON.stringify(p));
  p = await pick('appello', lez, 11, 20);
  check(p.who === '4B#3' && p.motivo === 'appena-finita', 'appello 11:20 → quella appena finita (4B 3ª)', JSON.stringify(p));
  p = await pick('appello', lez, 7, 30);
  check(p.who === '3A#1' && p.motivo === 'prossima', 'appello 07:30 → la prima della giornata', JSON.stringify(p));
  p = await evaluate(`return ArgoAzioni.parseRange('<div>Lezione</div><div>08:00 - 09:00</div>')`);
  check(p && p.inizio === 480 && p.fine === 540, 'orario letto da "08:00 - 09:00"');

  // ------------------------------------------------------------------
  console.log('\n[Firma ora]');
  let res = await run({ start: 'registro:3A:1' }, 'firma', '10:12');
  check(res.log.homeClicks === 1, 'da un registro aperto: clic su «Home» nel menu', JSON.stringify(res.log));
  check(res.log.opened.at(-1) === '4B#3' && res.r.ok && res.log.signClicks.join() === '4B#3', 'alle 10:12 firma la lezione in corso: 4B 3ª ora', stepsText(res));
  check(/Firmata la 3ª ora · 4B · TPSIT \(10:00–11:00\)/.test(res.r.summary), 'riepilogo con classe, materia e orario', res.r.summary);
  check(res.steps.some(s => /Ora attuale 10:12 → lezione in corso: 3ª ora · 4B · TPSIT \(10:00–11:00\)/.test(s)), 'il popup spiega perché ha scelto quella lezione', stepsText(res));
  check(res.log.unsignAttempts === 0, 'nessun clic su ore già firmate');
  check(res.asked.length === 0, 'lezione in corso (fascia che contiene l\'ora attuale): firmata subito, senza domande', JSON.stringify(res.asked));
  await shot('20-azioni-firma-4B');

  res = await run({}, 'firma', '09:30');
  check(res.asked.length === 1 && /La 2ª ora \(09:00–10:00\) è in corso e la firmo/.test(res.asked[0].q) && /1ª ora \(08:00–09:00\)/.test(res.asked[0].q),
    'ore consecutive fuori orario (1ª): chiede il permesso indicando le fasce', JSON.stringify(res.asked));
  check(res.r.ok && res.log.signClicks.join() === '3A#1,3A#2' && /Firmate la 1ª e la 2ª ora · 3A/.test(res.r.summary),
    '«Firma anche quella»: firma in sequenza la 1ª e la 2ª ora', res.log.signClicks.join() + ' · ' + res.r.summary);
  res = await run({}, 'firma', '09:30', [false]);
  check(res.r.ok && res.log.signClicks.join() === '3A#2' && /Firmata la 2ª ora · 3A · INFORMATICA \(09:00–10:00\)/.test(res.r.summary) && res.asked[0].no === 'Solo la 2ª ora',
    '«Solo la 2ª ora»: firma solo quella in corso', res.log.signClicks.join() + ' · ' + res.r.summary);

  res = await run({ signed: ['4B#3'] }, 'firma', '10:40');
  check(res.r.ok && res.log.signClicks.length === 0 && /lezione in corso \(3ª ora · 4B · TPSIT \(10:00–11:00\)\) è già firmata/.test(res.r.summary) && /5ª ora · 5C/.test(res.r.summary),
    'lezione in corso già firmata: nessun clic, indica la prossima', res.r.summary);

  res = await run({ signed: ['3A#1', '3A#2', '4B#3'] }, 'firma', '11:20');
  check(res.asked.length === 1 && /La 5ª ora \(12:00–13:00\) · 5C · SISTEMI E RETI non è in corso: adesso sono le 11:20/.test(res.asked[0].q) && res.asked[0].yes === 'Firma lo stesso',
    'prossima lezione (fascia che non contiene l\'ora attuale): chiede «Vuoi firmarla lo stesso?»', JSON.stringify(res.asked));
  check(res.r.ok && res.log.signClicks.join() === '5C#5', '…risposta sì: firma la prossima lezione più vicina (5C 5ª)', stepsText(res));
  res = await run({ signed: ['3A#1', '3A#2', '4B#3'] }, 'firma', '11:20', [false]);
  check(res.r.ok && res.r.cancelled && res.log.signClicks.length === 0 && /Non ho firmato nulla/.test(res.r.summary), '…risposta no: non firma nulla e lo dice', res.r.summary);
  res = await run({ signed: ['3A#1', '3A#2', '4B#3'] }, 'firma', '14:00');
  check(res.asked.length === 1 && res.log.signClicks.join() === '5C#5', 'lezione già passata e non firmata: chiede prima di firmarla', JSON.stringify(res.asked));

  res = await run({ timesInDashboard: false }, 'firma', '10:12');
  check(res.r.ok && res.log.opened.join() === '3A#1,4B#3' && res.log.homeClicks === 2 && res.log.signClicks.join() === '4B#3',
    'orari non nella Home: li legge dal registro di 3A, poi torna alla Home e firma 4B', JSON.stringify(res.log.opened) + ' · ' + stepsText(res));
  check(res.steps.some(s => /Orari letti dal registro di 3A: 1ª 08:00–09:00, 2ª 09:00–10:00, 3ª 10:00–11:00/.test(s)), 'mostra gli orari letti dalla pagina', stepsText(res));

  res = await run({ timesInDashboard: false, timesInRegistro: false }, 'firma', '10:12');
  check(res.asked.length === 1 && /orario non indicato/.test(res.asked[0].q) && /non so se è in corso/.test(res.asked[0].q),
    'nessun orario nella pagina: chiede il permesso perché non sa se l\'ora è in corso', JSON.stringify(res.asked));
  check(res.r.ok && res.log.signClicks.join() === '3A#1,3A#2' && res.steps.some(s => /orari non disponibili/.test(s)),
    '…e con il sì firma la prima ora da firmare', stepsText(res));

  res = await run({ signed: ['3A#1', '3A#2', '4B#3', '5C#5'] }, 'firma', '10:12');
  check(res.r.ok && res.log.signClicks.length === 0 && res.log.opened.join() === '4B#3' && /lezione in corso \(3ª ora · 4B · TPSIT \(10:00–11:00\)\) è già firmata da te \(MADDALUNO DANIELE\)/.test(res.r.summary),
    'tutto già firmato: controlla nel registro che la firma dell\'ora in corso sia tua, non clicca nulla', res.r.summary + ' · ' + res.log.opened);
  res = await run({ signed: ['3A#1', '3A#2', '4B#3', '5C#5'] }, 'firma', '14:00');
  check(res.r.ok && res.log.signClicks.length === 0 && res.log.opened.length === 0 && /Tutte le tue lezioni di oggi risultano già firmate/.test(res.r.summary), 'tutto firmato e nessuna lezione in corso: lo dice senza aprire registri', res.r.summary);

  console.log('\n[Classe articolata / compresenza: più docenti nella stessa ora]');
  const ART = { articolata: { '4B': { 3: { docente: 'BIANCHI ANNA', materia: 'LABORATORIO', firmata: true } } } };
  res = await run(ART, 'firma', '10:12');
  check(res.r.ok && res.log.signClicks.join() === '4B#3' && res.log.otherClicks === 0 && res.log.unsignAttempts === 0 && /Firmata la 3ª ora · 4B/.test(res.r.summary),
    'ora firmata dal collega prima della tua riga: firma la TUA riga (non la considera già firmata)', stepsText(res));
  check(res.steps.some(s => /Nella 3ª ora di 4B ci sono 2 righe: BIANCHI ANNA \(firmata, di un altro docente\); MADDALUNO DANIELE \(da firmare, tua\)/.test(s)),
    'i passi dicono di chi è ogni riga di quell\'ora', stepsText(res));
  check(res.steps.some(s => /Cliccata l'icona arancione «da firmare» della 3ª ora \(riga di MADDALUNO DANIELE\)/.test(s)), 'il passo del clic indica la riga del docente', stepsText(res));

  res = await run({ ...ART, homeFirmataDaAltri: true }, 'firma', '10:12');
  check(res.r.ok && res.log.signClicks.join() === '4B#3' && res.steps.some(s => /La Home indica come già firmata la lezione in corso/.test(s)) &&
    res.steps.some(s => /La tua riga della 3ª ora non è firmata: la firmo/.test(s)),
    'la Home la mostra firmata per la firma del collega: lo verifica nel registro e firma la tua riga', stepsText(res));

  res = await run({ ...ART, signed: ['4B#3'], homeFirmataDaAltri: true }, 'firma', '10:12');
  check(res.r.ok && res.log.signClicks.length === 0 && /è già firmata da te \(MADDALUNO DANIELE\)/.test(res.r.summary), '…se anche la tua riga è firmata: non clicca nulla', res.r.summary);

  res = await run({ ...ART, pk: false, docenteRiga: 'Maddaluno Daniele' }, 'firma', '10:12');
  check(res.r.ok && res.log.signClicks.join() === '4B#3' && res.log.otherClicks === 0, 'senza i dati di DidUP sul docente: riconosce la riga da nome e cognome (maiuscole e ordine diversi)', stepsText(res));

  res = await run({ ...ART, pk: false, utente: '', docenteRiga: 'MADDALUNO DANIELE' }, 'firma', '10:12');
  check(res.r.ok && res.log.signClicks.join() === '4B#3', 'senza nome e senza dati: riconosce la riga dall\'icona («da firmare» solo sulle tue, «altro docente» sui colleghi)', stepsText(res));

  res = await run({ ...ART, pk: false, utente: 'ROSSI MARIO' }, 'firma', '10:12');
  check(!res.r.ok && res.log.signClicks.length === 0 && /non trovo la tua riga per la 3ª ora/.test(res.r.error) && /BIANCHI ANNA, MADDALUNO DANIELE/.test(res.r.error),
    'nessuna riga con il tuo nome: non clicca nulla e dice quali docenti ha trovato', res.r.error);
  p = await evaluate(`return [ArgoAzioni.sameName('ROSSI MARIO', 'Mario Rossi'), ArgoAzioni.sameName('ROSSI MARIO', 'ROSSI MARIO GIUSEPPE'), ArgoAzioni.sameName('ROSSI MARIO', 'ROSSI ANNA'), ArgoAzioni.sameName('ROSSI', 'ROSSI ANNA')]`);
  check(JSON.stringify(p) === '[true,true,false,false]', 'confronto dei nomi: stesso nome in ordine diverso sì, altro docente con lo stesso cognome no', JSON.stringify(p));

  res = await run({ start: 'editing' }, 'firma', '10:12');
  check(!res.r.ok && res.log.homeClicks === 0 && /Stai modificando una lezione/.test(res.r.error), 'lezione in modifica: non clicca «Home» e spiega perché', res.r.error);

  res = await run({ homeMenu: false }, 'firma', '10:12');
  check(res.r.ok && res.log.apiHome === 1 && res.steps.some(s => /Voce «Home» non trovata nel menu/.test(s)), 'voce «Home» assente: usa il comando interno di DidUP e lo segnala', stepsText(res));

  res = await run({ start: 'registro:3A:1', homeClickBroken: true }, 'firma', '10:12');
  check(res.r.ok && res.log.homeClicks === 1 && res.log.apiHome === 1 && res.log.signClicks.join() === '4B#3' &&
    res.steps.some(s => /La Home non si è aperta col clic: riaperta con il comando interno di DidUP/.test(s)),
    'se il clic su «Home» non ha effetto: secondo tentativo con il comando di DidUP, segnalato', stepsText(res));

  res = await run({ iconCls: 'icon-ora-nuova' }, 'firma', '10:12');
  check(!res.r.ok && res.log.signClicks.length === 0 && /non riconosco lo stato di firma/.test(res.r.error), 'icone di firma sconosciute: non clicca nulla e lo dice', res.r.error);

  res = await run({ classi: [{ classe: '3A', lezioni: [] }, { classe: '4B', lezioni: [] }] }, 'firma', '10:12');
  check(!res.r.ok && /Nella Home non ci sono lezioni per oggi: ho trovato 2 classi ma nessuna ora/.test(res.r.error), 'nessuna lezione oggi: errore esplicito', res.r.error);

  // ------------------------------------------------------------------
  console.log('\n[Appello]');
  res = await run({ start: 'registro:5C:5', signed: ['4B#3'] }, 'appello', '10:12');
  check(res.log.homeClicks === 1 && res.log.opened.at(-1) === '4B#3' && res.log.appelloOpened === 1 && res.r.ok,
    'da un altro registro: «Home» → 4B 3ª ora (in corso) → «Appello» aperto', stepsText(res));
  check(/Appello aperto · 3ª ora · 4B · TPSIT \(10:00–11:00\)/.test(res.r.summary), 'riepilogo con la lezione scelta', res.r.summary);
  await shot('21-azioni-appello-4B');

  res = await run({}, 'appello', '10:12');
  check(!res.r.ok && res.log.appelloOpened === 0 && /Il pulsante «Appello» è disattivato per la 3ª ora di 4B/.test(res.r.error) && /Firma prima/.test(res.r.error),
    'ora non firmata: «Appello» disattivato, errore esplicito con il motivo', res.r.error);

  res = await run({ classeDocente: true }, 'appello', '11:50');
  check(res.r.ok && res.log.opened.at(-1) === '5C#5' && res.log.appelloOpened === 1, 'alle 11:50 appello della lezione che sta per iniziare (5C)', stepsText(res));

  res = await run({ timesInDashboard: false, classeDocente: true }, 'appello', '10:12');
  check(res.r.ok && res.log.opened.join() === '3A#1,4B#3' && res.log.appelloOpened === 1, 'appello senza orari nella Home: orari dal registro, poi l\'ora giusta', JSON.stringify(res.log.opened));

  // ------------------------------------------------------------------
  console.log('\n[Aggiornamento con una pagina già aperta]');
  await navigate(`${BASE}/voti/app?n=${++navCount}`, 900);
  const oldBridge = await evaluate(`
    window.__oldBridgeHits = 0;   // ponte della versione precedente (canale senza versione)
    document.addEventListener('argo-assistant:request', () => window.__oldBridgeHits++);
    const r = await callPageBridge('session', {}, 2000);
    return { hits: window.__oldBridgeHits, state: r.state };`);
  check(oldBridge.hits === 0 && oldBridge.state === 'logged', 'il ponte vecchio rimasto nella pagina non riceve le nuove richieste (niente doppi inserimenti)', JSON.stringify(oldBridge));

  // ------------------------------------------------------------------
  console.log('\n[Pulsanti nella barra di DidUP]');
  const oneLesson = slot => `${BASE}/voti/app?n=${++navCount}#${encodeURIComponent(JSON.stringify({ classi: [{ classe: '3A', lezioni: [{ numOra: 2, materia: 'INFORMATICA' }] }], times: { 2: slot } }))}`;
  const tb = js => evaluate(`const host = document.querySelector('[data-argo-assistant="toolbar"]'); const root = host && host.shadowRoot;
    const run = document.querySelector('[data-argo-assistant="run"]'); const pr = run && run.shadowRoot; ${js}`);
  await navigate(oneLesson(slotNow), 1200);
  let t = await tb(`const r = host.getBoundingClientRect(); const help = document.querySelector('#btnNews img').getBoundingClientRect();
    const hdr = document.querySelector('.header').getBoundingClientRect(); const b0 = root.querySelector('button.b');
    return { n: root.querySelectorAll('button.b').length, where: host.dataset.where, theme: host.dataset.theme, right: r.right, helpLeft: help.left,
      midY: r.top + r.height / 2, helpMid: help.top + help.height / 2, hdrMid: hdr.top + hdr.height / 2, size: b0.getBoundingClientRect().height,
      bg: getComputedStyle(b0).backgroundColor, border: getComputedStyle(b0).borderTopColor,
      labels: [...root.querySelectorAll('button.b')].map(b => b.getAttribute('aria-label')), tips: [...root.querySelectorAll('.tip')].map(x => x.textContent) };`);
  check(t.n === 2 && t.labels.join('|') === 'Firma ora (Argo DidUP Booster)|Appello (Argo DidUP Booster)', 'due pulsanti rotondi «Firma ora» e «Appello» nella pagina', JSON.stringify(t));
  check(t.where === 'right' && t.right <= t.helpLeft - 10 && t.right > t.helpLeft - 20 && Math.abs(t.midY - t.helpMid) < 1.5 && Math.abs(t.helpMid - t.hdrMid) > 5 && t.size === 34,
    'predefinito: a destra, accanto all\'icona di aiuto e centrati su di lei (non sulla barra), stessa altezza (34 px)', JSON.stringify(t));
  check(t.theme === 'argo' && t.bg === 'rgb(255, 255, 255)' && t.border === 'rgb(255, 150, 37)' && /Firma ora: la tua lezione/.test(t.tips[0]),
    'stile predefinito «Simil Argo» (bianco con il bordo arancione, come l\'aiuto); la scritta compare passando sopra', JSON.stringify(t));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(t.right - 60), y: Math.round(t.midY) });
  await sleep(250);
  t = await tb(`return getComputedStyle(root.querySelectorAll('.tip')[0]).opacity`);
  check(t === '1', 'al passaggio del mouse la scritta è visibile', t);
  await shot('26-pulsanti-barra');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 500 });

  await evaluate(`await chrome.storage.local.set({ buttonsPosition: 'left', buttonsTheme: 'vivid' }); await new Promise(r => setTimeout(r, 300));`);
  t = await tb(`const r = host.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(document.getElementById('intestazioneId'));
    return { where: host.dataset.where, theme: host.dataset.theme, left: r.left, textRight: range.getBoundingClientRect().right };`);
  check(t.where === 'left' && t.theme === 'vivid' && t.left >= t.textRight + 10 && t.left < t.textRight + 40, 'a sinistra (dopo il nome della scuola) e stile «Evidenziato» appena cambiati nelle impostazioni', JSON.stringify(t));
  await evaluate(`await chrome.storage.local.set({ buttonsPosition: 'center' }); await new Promise(r => setTimeout(r, 300));`);
  t = await tb(`const r = host.getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - innerWidth / 2);`);
  check(t < 2, 'al centro della barra', t);
  await evaluate(`await chrome.storage.local.set({ buttonsPosition: 'right', buttonsTheme: 'argo' }); await new Promise(r => setTimeout(r, 200));`);

  // Funzioni tolte dalle impostazioni
  await evaluate(`await chrome.storage.local.set({ showAppello: false }); await new Promise(r => setTimeout(r, 800));`);
  t = await tb(`const help = document.querySelector('#btnNews img').getBoundingClientRect();
    return { ids: [...root.querySelectorAll('button.b')].map(b => b.dataset.action), right: host.getBoundingClientRect().right, helpLeft: help.left };`);
  check(t.ids.join() === 'firma' && t.right <= t.helpLeft - 10 && t.right > t.helpLeft - 20, 'Appello tolto nelle impostazioni: resta solo «Firma ora», sempre accanto all\'aiuto', JSON.stringify(t));
  await evaluate(`await chrome.storage.local.set({ showFirma: false }); await new Promise(r => setTimeout(r, 800));`);
  t = await evaluate(`const h = document.querySelector('[data-argo-assistant="toolbar"]'); return { display: h ? h.style.display : 'assente', n: h ? h.shadowRoot.querySelectorAll('button.b').length : 0 };`);
  check(t.display === 'none' && t.n === 0, 'tolti entrambi: nessun pulsante nella barra', JSON.stringify(t));
  await evaluate(`await chrome.storage.local.set({ showFirma: true, showAppello: true }); await new Promise(r => setTimeout(r, 800));`);
  t = await tb(`return [...root.querySelectorAll('button.b')].map(b => b.dataset.action).join() + '|' + host.style.display;`);
  check(t === 'firma,appello|', '…e rimessi', t);

  await tb(`root.querySelector('[data-action="firma"]').click();`);
  t = await tb(`for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 100)); if (pr && pr.querySelector('.result') && !pr.querySelector('.result').hidden) break; }
    const p2 = document.querySelector('[data-argo-assistant="run"]').shadowRoot;
    return { cls: p2.querySelector('.p').className, steps: [...p2.querySelectorAll('li')].map(l => l.textContent), result: p2.querySelector('.result').textContent, signed: window.__didup.signClicks.join() };`);
  check(t.signed === '3A#2' && t.cls.includes('done') && /Firmata la 2ª ora · 3A/.test(t.result) && t.steps.some(s => /Cliccato «Home»/.test(s)),
    'clic su «Firma ora»: pannello sotto i pulsanti con i passi e l\'esito', JSON.stringify(t));
  await shot('27-pannello-firma');
  // clic dell'utente dentro il pannello: resta aperto; fuori dal pannello: si chiude
  const mouseClick = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await sleep(200);
  };
  let pt = await tb(`const r = pr.querySelector('.p').getBoundingClientRect(); return { x: Math.round(r.left + 40), y: Math.round(r.top + 60) };`);
  await mouseClick(pt.x, pt.y);
  check(await tb(`return !run.hidden`), 'clic dentro il pannello: resta aperto');
  await mouseClick(300, 600);
  check(await tb(`return run.hidden`), 'clic fuori dal pannello: si chiude');
  // il clic su un pulsante della barra non conta come «fuori»
  await tb(`root.querySelector('[data-action="firma"]').click();`);
  await sleep(300);
  await tb(`for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 100)); if (!pr.querySelector('.result').hidden) break; }`);
  pt = await tb(`const r = root.querySelector('[data-action="appello"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };`);
  await mouseClick(pt.x, pt.y);
  t = await tb(`for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 100)); if (!pr.querySelector('.result').hidden) break; }
    return { hidden: run.hidden, title: pr.querySelector('.title').textContent };`);
  check(!t.hidden && t.title === 'Appello', 'con il pannello aperto, il clic su un altro pulsante della barra non lo chiude: parte quell\'azione', JSON.stringify(t));

  await navigate(oneLesson(slotOther), 1200);
  await tb(`root.querySelector('[data-action="firma"]').click();`);
  t = await tb(`let p2 = null;
    for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 100)); p2 = document.querySelector('[data-argo-assistant="run"]')?.shadowRoot; if (p2 && !p2.querySelector('.askbox').hidden) break; }
    const q = p2.querySelector('.q').textContent, yes = p2.querySelector('.yes').textContent, no = p2.querySelector('.no').textContent;
    const before = window.__didup.signClicks.length;
    return { q, yes, no, before, cls: p2.querySelector('.p').className };`);
  check(/Vuoi firmarla lo stesso\?/.test(t.q) && t.yes === 'Firma lo stesso' && t.no === 'Non firmare' && t.before === 0 && t.cls.includes('asking'),
    'ora fuori fascia: la domanda compare nel pannello e non firma prima della risposta', JSON.stringify(t));
  await shot('28-pannello-domanda');
  t = await tb(`pr.querySelector('.yes').click();
    for (let i = 0; i < 80 && !window.__didup.signClicks.length; i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 900));
    return { signed: window.__didup.signClicks.join(), result: pr.querySelector('.result').textContent };`);
  check(t.signed === '3A#2' && /Firmata la 2ª ora/.test(t.result), '…«Firma lo stesso»: firma e mostra l\'esito', JSON.stringify(t));

  await navigate(oneLesson(slotOther), 1200);
  await tb(`root.querySelector('[data-action="firma"]').click();`);
  t = await tb(`let p2 = null;
    for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 100)); p2 = document.querySelector('[data-argo-assistant="run"]')?.shadowRoot; if (p2 && !p2.querySelector('.askbox').hidden) break; }
    p2.querySelector('.x').click();
    await new Promise(r => setTimeout(r, 800));
    return { signed: window.__didup.signClicks.length, result: p2.querySelector('.result').textContent };`);
  check(t.signed === 0 && /Non ho firmato nulla/.test(t.result), 'pannello chiuso durante la domanda: vale «no», non firma', JSON.stringify(t));

  await navigate(oneLesson(slotOther), 1200);
  await tb(`root.querySelector('[data-action="firma"]').click();`);
  await tb(`for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 100)); const p2 = document.querySelector('[data-argo-assistant="run"]')?.shadowRoot; if (p2 && !p2.querySelector('.askbox').hidden) break; }`);
  await mouseClick(300, 600);
  t = await tb(`await new Promise(r => setTimeout(r, 800)); return { signed: window.__didup.signClicks.length, hidden: run.hidden, result: pr.querySelector('.result').textContent };`);
  check(t.signed === 0 && /Non ho firmato nulla/.test(t.result), 'clic fuori durante la domanda: pannello chiuso, vale «no»', JSON.stringify(t));

  await navigate(`${BASE}/voti/app?n=${++navCount}`, 1200);
  await tb(`root.querySelector('[data-action="appello"]').click();`);
  t = await tb(`for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 100)); if (pr && !pr.querySelector('.result').hidden) break; }
    const p2 = document.querySelector('[data-argo-assistant="run"]').shadowRoot;
    return { cls: p2.querySelector('.p').className, last: [...p2.querySelectorAll('li')].pop().className, text: [...p2.querySelectorAll('li')].pop().textContent };`);
  check(t.cls.includes('failed') && t.last === 'error' && /Appello/.test(t.text), 'errore in rosso nel pannello (Appello su un\'ora non firmata)', JSON.stringify(t));
  await shot('29-pannello-errore');

  t = await evaluate(`window.__listeners['runtime.onMessage'].forEach(fn => fn({ type: 'argo-session-expired', text: 'Ricarico il registro appena smetti di usarlo.' }, {}, () => {}));
    await new Promise(r => setTimeout(r, 100));
    const h = document.querySelector('[data-argo-assistant="toast"]');
    return { text: h ? h.shadowRoot.querySelector('.t').innerText : '', buttons: h ? [...h.shadowRoot.querySelectorAll('.actions button')].map(b => b.textContent) : [] };`);
  check(/Sessione di Argo scaduta/.test(t.text) && /Ricarico il registro/.test(t.text) && t.buttons.join() === 'Ricarica ora,Più tardi', 'sessione scaduta: avviso nella pagina con «Ricarica ora»', JSON.stringify(t));
  navCount++;
  const loaded = new Promise(r => { loadWaiters.push(r); setTimeout(r, 5000); });
  await evaluate(`[...document.querySelector('[data-argo-assistant="toast"]').shadowRoot.querySelectorAll('.actions button')].find(b => b.textContent === 'Ricarica ora').click(); window.__beforeReload = 1;`);
  await loaded;
  await sleep(500);
  check(await evaluate(`return window.__beforeReload === undefined && !!window.__didup`), '«Ricarica ora» ricarica la pagina del registro');

  // ------------------------------------------------------------------
  console.log('\n[Guida della prima volta]');
  await evaluate(`await chrome.storage.local.set({ guidaPulsanti: true });`);
  await navigate(`${BASE}/voti/app?n=${++navCount}`, 600);
  t = await evaluate(`for (let i = 0; i < 60 && !document.querySelector('[data-argo-assistant="guide"]'); i++) await new Promise(r => setTimeout(r, 100));
    const g = document.querySelector('[data-argo-assistant="guide"]'); if (!g) return null;
    const gr = g.shadowRoot; await new Promise(r => setTimeout(r, 400));
    const hole = gr.querySelector('.hole').getBoundingClientRect(), bar = document.querySelector('[data-argo-assistant="toolbar"]').getBoundingClientRect();
    return { title: gr.querySelector('h3').textContent, text: gr.querySelector('.text').textContent, count: gr.querySelector('.count').textContent,
      covers: hole.left <= bar.left && hole.right >= bar.right && hole.top <= bar.top && hole.bottom >= bar.bottom,
      shadow: getComputedStyle(gr.querySelector('.hole')).boxShadow, stored: (await chrome.storage.local.get('guidaPulsanti')).guidaPulsanti };`);
  check(t && /Argo DidUP Booster/.test(t.text) && t.count === '1 di 4' && t.covers && /rgba\(15, 23, 42, 0\.68\)/.test(t.shadow) && t.stored === false,
    'prima apertura del registro: guida con lo sfondo scuro sui pulsanti, dice che li ha aggiunti l\'estensione; poi non si ripresenta', JSON.stringify(t));
  await shot('30-guida-pulsanti');
  // i clic sulla pagina sono bloccati mentre la guida è aperta
  await mouseClick(600, 400);
  check(await evaluate(`return !!document.querySelector('[data-argo-assistant="guide"]')`), 'clic sulla pagina con la guida aperta: la guida resta (niente clic accidentali su DidUP)');
  t = await evaluate(`const gr = document.querySelector('[data-argo-assistant="guide"]').shadowRoot; const titles = [];
    for (let i = 0; i < 6 && document.querySelector('[data-argo-assistant="guide"]'); i++) { titles.push(gr.querySelector('h3').textContent); gr.querySelector('.next').click(); await new Promise(r => setTimeout(r, 100)); }
    return { titles, open: !!document.querySelector('[data-argo-assistant="guide"]') };`);
  check(t.titles.join('|') === 'Nuovi pulsanti nel registro|Firma ora|Appello|Puoi cambiarli quando vuoi' && !t.open, 'quattro passi (pulsanti, Firma ora, Appello, impostazioni) e poi si chiude', JSON.stringify(t));
  await navigate(`${BASE}/voti/app?n=${++navCount}`, 3500);
  check(await evaluate(`return !document.querySelector('[data-argo-assistant="guide"]')`), 'alla riapertura del registro la guida non ricompare');
  // riattivata dalle impostazioni, con solo «Firma ora»: Esc la chiude
  await evaluate(`await chrome.storage.local.set({ guidaPulsanti: true, showAppello: false });`);
  t = await evaluate(`for (let i = 0; i < 60 && !document.querySelector('[data-argo-assistant="guide"]'); i++) await new Promise(r => setTimeout(r, 100));
    const g = document.querySelector('[data-argo-assistant="guide"]'); return g ? g.shadowRoot.querySelector('.count').textContent : null;`);
  check(t === '1 di 3', 'riattivata dalle impostazioni (con solo «Firma ora»): ricompare subito, senza il passo di Appello', t);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
  check(await evaluate(`return !document.querySelector('[data-argo-assistant="guide"]')`), 'Esc chiude la guida');
  await evaluate(`await chrome.storage.local.set({ showAppello: true });`);

  console.log('\nErrori JS in console:', consoleErrors.length ? consoleErrors : 'nessuno');
  if (consoleErrors.length) failures++;
  console.log(failures ? `\n✘ ${failures} verifiche fallite` : '\n✔ Tutte le verifiche superate');
  ws.close();
} catch (e) {
  console.log('ERRORE NEL TEST:', e.stack || e.message);
  failures++;
} finally {
  chrome.kill('SIGKILL');
  server.close();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}
process.exit(failures ? 1 : 0);
