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
const APP_SCRIPTS = ['page-bridge.js', 'mock-chrome.js', 'settings.js', 'content-common.js', 'azioni.js'];

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
  check(res.r.ok && res.log.signClicks.length === 0 && /Tutte le tue lezioni di oggi risultano già firmate/.test(res.r.summary), 'tutto già firmato: lo dice e non clicca nulla', res.r.summary);

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

  console.log('\n[Collegamento popup ↔ pagina]');
  const oneLesson = slot => `${BASE}/voti/app?n=${++navCount}#${encodeURIComponent(JSON.stringify({ classi: [{ classe: '3A', lezioni: [{ numOra: 2, materia: 'INFORMATICA' }] }], times: { 2: slot } }))}`;
  const fakePort = `const port = { name: 'argo-azione', sent: [], msg: [], disc: [], postMessage(m) { this.sent.push(m); },
      onMessage: { addListener(fn) { port.msg.push(fn); } }, onDisconnect: { addListener(fn) { port.disc.push(fn); } } };
    window.__listeners['runtime.onConnect'][0](port);`;
  await navigate(oneLesson(slotNow), 900);
  let port = await evaluate(`${fakePort}
    port.msg.forEach(fn => fn({ type: 'run', action: 'firma' }));
    for (let i = 0; i < 80 && !port.sent.some(m => m.type === 'done'); i++) await new Promise(r => setTimeout(r, 100));
    return port.sent;`);
  check(port[0].type === 'ready' && port.some(m => m.type === 'step') && !port.some(m => m.type === 'ask') && port.at(-1).type === 'done' && port.at(-1).result.ok,
    'ora in corso: la pagina risponde al popup (pronto → passi → esito) senza domande', JSON.stringify(port.map(m => m.type)));

  await navigate(oneLesson(slotOther), 900);
  port = await evaluate(`${fakePort}
    port.msg.forEach(fn => fn({ type: 'run', action: 'firma' }));
    for (let i = 0; i < 80 && !port.sent.some(m => m.type === 'ask'); i++) await new Promise(r => setTimeout(r, 100));
    const ask = port.sent.find(m => m.type === 'ask');
    const before = window.__didup.signClicks.length;
    if (ask) port.msg.forEach(fn => fn({ type: 'answer', id: ask.id, ok: true }));
    for (let i = 0; i < 80 && !port.sent.some(m => m.type === 'done'); i++) await new Promise(r => setTimeout(r, 100));
    return { ask, before, after: window.__didup.signClicks.length, done: port.sent.at(-1) };`);
  check(port.ask && /Vuoi firmarla lo stesso\?/.test(port.ask.question) && port.before === 0 && port.after === 1 && port.done.result.ok,
    'ora fuori fascia: la domanda arriva al popup e la firma parte solo dopo il «sì»', JSON.stringify(port));

  // popup chiuso durante l'operazione: domanda ed esito compaiono nella pagina
  await navigate(oneLesson(slotOther), 900);
  const pageAsk = await evaluate(`${fakePort}
    port.msg.forEach(fn => fn({ type: 'run', action: 'firma' }));
    await new Promise(r => setTimeout(r, 50));
    port.disc.forEach(fn => fn());                              // l'utente chiude il popup
    let btn = null;
    for (let i = 0; i < 100 && !btn; i++) {
      await new Promise(r => setTimeout(r, 100));
      const h = document.querySelector('[data-argo-assistant="toast"]');
      btn = h && [...h.shadowRoot.querySelectorAll('.actions button')].find(b => b.textContent === 'Firma lo stesso');
    }
    const question = btn ? document.querySelector('[data-argo-assistant="toast"]').shadowRoot.querySelector('.t').innerText : null;
    const signedBefore = window.__didup.signClicks.length;
    if (btn) btn.click();
    for (let i = 0; i < 80 && window.__didup.signClicks.length === 0; i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 900));
    const h = document.querySelector('[data-argo-assistant="toast"]');
    return { question, signedBefore, signed: window.__didup.signClicks.length, final: h ? h.shadowRoot.querySelector('.t').innerText : null };`);
  check(pageAsk.question && /Vuoi firmarla lo stesso\?/.test(pageAsk.question) && pageAsk.signedBefore === 0,
    'popup chiuso: la domanda compare nella pagina con i pulsanti «Firma lo stesso» / «Non firmare»', JSON.stringify(pageAsk));
  check(pageAsk.signed === 1 && /Firmata la 2ª ora · 3A/.test(pageAsk.final || ''), '…clic su «Firma lo stesso»: firma e mostra l\'esito nella pagina', JSON.stringify(pageAsk));
  await shot('22-azioni-toast-pagina');

  // ------------------------------------------------------------------
  console.log('\n[Popup]');
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 560, deviceScaleFactor: 2, mobile: false });
  const popupWith = async (script) => {
    await navigate(`${BASE}/ext/popup.html?n=${++navCount}`, 200);
    await evaluate(`localStorage.setItem('__mockStore', JSON.stringify({ schemaVersion: 1, codiceScuola: 'SG18328', docenteNome: 'MADDALUNO DANIELE', keepAliveEnabled: true }));
      localStorage.setItem('__mockTab', JSON.stringify({ id: 7, url: 'https://www.portaleargo.it/voti/?classic' }));`);
    await navigate(`${BASE}/ext/popup.html?n=${++navCount}`, 500);
    await evaluate(script);
  };
  const fakePortScript = (steps, result, { failFirst = false } = {}) => `
    let attempts = 0;
    window.__makePort = () => {
      attempts++;
      const listeners = { msg: [], disc: [] };
      const port = { onMessage: { addListener: fn => listeners.msg.push(fn), removeListener: fn => { listeners.msg = listeners.msg.filter(x => x !== fn); } },
        onDisconnect: { addListener: fn => listeners.disc.push(fn) },
        postMessage(m) {
          if (m.type !== 'run') return;
          const all = ${JSON.stringify(steps)};
          all.forEach((s, i) => setTimeout(() => listeners.msg.forEach(fn => fn({ type: 'step', step: s })), 50 * (i + 1)));
          setTimeout(() => listeners.msg.forEach(fn => fn({ type: 'done', result: ${JSON.stringify(result)} })), 50 * (all.length + 1));
        } };
      if (${failFirst} && attempts === 1) setTimeout(() => listeners.disc.forEach(fn => fn()), 10);
      else setTimeout(() => listeners.msg.forEach(fn => fn({ type: 'ready' })), 10);
      return port;
    };
    window.__attempts = () => attempts;
    document.getElementById('btn-firma').click();
    await new Promise(r => setTimeout(r, 700));`;
  await popupWith(fakePortScript([
    { text: 'Cliccato «Home» nel menu a sinistra', kind: 'ok' },
    { text: 'Lezioni di oggi nella Home: 3A 1ª ✓, 3A 2ª, 4B 3ª', kind: 'ok' },
    { text: 'Ora attuale 10:12 → lezione in corso: 3ª ora · 4B · TPSIT (10:00–11:00)', kind: 'ok' },
    { text: 'Cliccato «3ª ora - TPSIT» della classe 4B nella Home', kind: 'ok' },
    { text: 'Aperto il registro di classe 4B', kind: 'ok' },
    { text: 'Cliccata l\'icona arancione «da firmare» della 3ª ora', kind: 'ok' },
    { text: '3ª ora firmata', kind: 'ok' }
  ], { ok: true, summary: 'Firmata la 3ª ora · 4B · TPSIT (10:00–11:00)' }));
  let ui = await evaluate(`return { visible: !document.getElementById('run').hidden, cls: document.getElementById('run').className, steps: document.querySelectorAll('#run-steps li').length, result: document.getElementById('run-result').textContent }`);
  check(ui.visible && ui.cls.includes('done') && ui.steps === 7 && ui.result.startsWith('Firmata la 3ª ora'), 'popup: elenco dei passi e riepilogo finale', JSON.stringify(ui));
  await shot('23-popup-firma-ok');

  await popupWith(`
    let answer = null;
    window.__makePort = () => {
      const listeners = { msg: [], disc: [] };
      const port = { onMessage: { addListener: fn => listeners.msg.push(fn), removeListener: fn => { listeners.msg = listeners.msg.filter(x => x !== fn); } },
        onDisconnect: { addListener: fn => listeners.disc.push(fn) },
        postMessage(m) {
          const emit = x => listeners.msg.forEach(fn => fn(x));
          if (m.type === 'run') {
            setTimeout(() => emit({ type: 'step', step: { text: 'Cliccato «Home» nel menu a sinistra', kind: 'ok' } }), 40);
            setTimeout(() => emit({ type: 'step', step: { text: 'Ora attuale 11:20 → nessuna lezione in corso: la prossima più vicina: 5ª ora · 5C · SISTEMI E RETI (12:00–13:00)', kind: 'ok' } }), 80);
            setTimeout(() => emit({ type: 'step', step: { text: 'Aperto il registro di classe 5C', kind: 'ok' } }), 120);
            setTimeout(() => emit({ type: 'step', step: { text: 'Chiesto il permesso: la 5ª ora non è in corso', kind: 'ask' } }), 160);
            setTimeout(() => emit({ type: 'ask', id: 'q1', question: 'La 5ª ora (12:00–13:00) · 5C · SISTEMI E RETI non è in corso: adesso sono le 11:20. Vuoi firmarla lo stesso?', confirmLabel: 'Firma lo stesso', cancelLabel: 'Non firmare' }), 200);
          }
          if (m.type === 'answer') { answer = m; setTimeout(() => emit({ type: 'done', result: { ok: true, summary: 'Firmata la 5ª ora · 5C · SISTEMI E RETI (12:00–13:00)' } }), 50); }
        } };
      setTimeout(() => listeners.msg.forEach(fn => fn({ type: 'ready' })), 10);
      return port;
    };
    window.__answer = () => answer;
    document.getElementById('btn-firma').click();
    await new Promise(r => setTimeout(r, 600));`);
  ui = await evaluate(`return { askVisible: !document.getElementById('run-ask').hidden, text: document.getElementById('run-ask-text').textContent, yes: document.getElementById('run-ask-yes').textContent, no: document.getElementById('run-ask-no').textContent, cls: document.getElementById('run').className }`);
  check(ui.askVisible && /Vuoi firmarla lo stesso\?/.test(ui.text) && ui.yes === 'Firma lo stesso' && ui.no === 'Non firmare' && ui.cls.includes('asking'),
    'popup: domanda con «Firma lo stesso» / «Non firmare»', JSON.stringify(ui));
  await shot('25-popup-domanda');
  await evaluate(`document.getElementById('run-ask-yes').click(); await new Promise(r => setTimeout(r, 300));`);
  ui = await evaluate(`return { answer: window.__answer(), askHidden: document.getElementById('run-ask').hidden, result: document.getElementById('run-result').textContent }`);
  check(ui.answer && ui.answer.id === 'q1' && ui.answer.ok === true && ui.askHidden && /Firmata la 5ª ora/.test(ui.result), 'popup: la risposta arriva alla pagina e compare l\'esito', JSON.stringify(ui));

  await popupWith(fakePortScript([
    { text: 'Cliccato «Home» nel menu a sinistra', kind: 'ok' },
    { text: 'Ora attuale 10:12 → lezione in corso: 3ª ora · 4B · TPSIT (10:00–11:00)', kind: 'ok' },
    { text: 'Aperto il registro di classe 4B', kind: 'ok' },
    { text: 'Il pulsante «Appello» è disattivato per la 3ª ora di 4B: DidUP lo attiva quando l\'ora è firmata da te. Firma prima con «Firma ora», poi riprova.', kind: 'error' }
  ], { ok: false, error: 'Il pulsante «Appello» è disattivato…' }, { failFirst: true }));
  ui = await evaluate(`return { cls: document.getElementById('run').className, last: [...document.querySelectorAll('#run-steps li')].pop().className, attempts: window.__attempts(), injected: window.__calls.filter(c => c[0] === 'executeScript').map(c => (c[1].files || []).join('+')) }`);
  check(ui.cls.includes('failed') && ui.last === 'error', 'popup: errore in rosso con cosa è stato cliccato / non trovato', JSON.stringify(ui));
  check(ui.attempts === 2 && ui.injected.join('|') === 'page-bridge.js|settings.js+content-common.js+azioni.js', 'pagina aperta prima dell\'aggiornamento: script iniettati al volo e nuovo tentativo', JSON.stringify(ui));
  await shot('24-popup-errore');
  await send('Emulation.clearDeviceMetricsOverride');

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
