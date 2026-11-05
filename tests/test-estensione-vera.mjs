// Estensione VERA (script dichiarati nel manifest, mondo isolato, porta
// popup↔pagina reale) contro il DidUP finto servito come https://www.portaleargo.it:
// il nome viene dirottato su un server HTTPS locale con un certificato usa e getta.
// Non serve Internet. Richiede openssl.
import { launch, sleep, waitFor } from './lib/cdp-pipe.mjs';
import { copyExtension, workDir, TESTS } from './lib/prepare.mjs';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MOCK = readFileSync(join(TESTS, 'mock', 'didup-mock.html'), 'utf8');
const CERT_DIR = workDir('cert');
if (!existsSync(join(CERT_DIR, 'cert.pem'))) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(CERT_DIR, 'key.pem'), '-out', join(CERT_DIR, 'cert.pem'),
    '-days', '30', '-subj', '/CN=www.portaleargo.it', '-addext', 'subjectAltName=DNS:www.portaleargo.it'], { stdio: 'ignore' });
}
const results = [];
const check = (name, cond, extra = '') => { results.push(cond); console.log(cond ? '  ✔' : '  ✘', name, cond ? '' : '→ ' + extra); };

const server = https.createServer({ key: readFileSync(join(CERT_DIR, 'key.pem')), cert: readFileSync(join(CERT_DIR, 'cert.pem')) }, (req, res) => {
  const url = new URL(req.url, 'https://www.portaleargo.it');
  if (url.pathname === '/voti/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(MOCK); }
  if (url.pathname === '/api/archiviostampe/struttura') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(8443, '127.0.0.1', r));

// timetable around the real current time: the 3rd hour (4B) is in progress
const now = new Date();
const nowMin = now.getHours() * 60 + now.getMinutes();
const fmt = m => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const start3 = nowMin - 10;
const times = {};
for (let n = 1; n <= 5; n++) times[n] = `${fmt(start3 + (n - 3) * 60)} - ${fmt(start3 + (n - 2) * 60)}`;
const crossesMidnight = start3 - 120 < 0 || start3 + 180 > 1439;

const extDir = copyExtension();
const b = await launch({ extraArgs: ['--host-resolver-rules=MAP www.portaleargo.it:443 127.0.0.1:8443', '--ignore-certificate-errors'] });
try {
  await b.send('Security.setIgnoreCertificateErrors', { ignore: true }).catch(() => {});
  const { id } = await b.send('Extensions.loadUnpacked', { path: extDir });
  const sw = await waitFor(async () => (await b.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`)), { label: 'sw' });
  const { sessionId: swS } = await b.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
  const swEval = async expr => {
    const r = await b.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, swS);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await swEval(`chrome.storage.local.set({ codiceScuola: 'SG18328', autoLogin: false, keepAliveEnabled: false })`);
  for (const t of (await b.send('Target.getTargets')).targetInfos) if (t.url.includes('/options.html')) await b.send('Target.closeTarget', { targetId: t.targetId });

  async function scenario(label, cfg, action) {
    const url = `https://www.portaleargo.it/voti/?classic#${encodeURIComponent(JSON.stringify({ times, ...cfg }))}`;
    const { targetId } = await b.send('Target.createTarget', { url });
    const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
    await b.send('Runtime.enable', {}, sessionId);
    const pEval = async expr => (await b.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
    await waitFor(async () => (await pEval('document.readyState')) === 'complete' && (await pEval('document.documentElement.dataset.argoAssistantAzioni || ""')), { label: 'content scripts', timeout: 15000 });
    await sleep(1200);
    // what the popup does: connect to the page and run the action
    const out = await swEval(`(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://www.portaleargo.it/*' });
      const tab = tabs.find(t => t.url.includes(${JSON.stringify(encodeURIComponent(JSON.stringify(cfg)).slice(0, 20))})) || tabs[tabs.length - 1];
      return await new Promise(resolve => {
        const port = chrome.tabs.connect(tab.id, { name: 'argo-azione' });
        const steps = [];
        port.onMessage.addListener(m => {
          if (m.type === 'ready') port.postMessage({ type: 'run', action: ${JSON.stringify(action)} });
          if (m.type === 'step') steps.push(m.step.text);
          if (m.type === 'done') resolve({ steps, result: m.result });
        });
        port.onDisconnect.addListener(() => resolve({ steps, disconnected: (chrome.runtime.lastError || {}).message || 'closed' }));
      });
    })()`);
    const log = await pEval('JSON.parse(JSON.stringify(window.__didup))');
    console.log(`\n[${label}]`);
    for (const s of out.steps) console.log('    ·', s);
    console.log('    =', out.result ? (out.result.ok ? out.result.summary : 'ERRORE: ' + out.result.error) : out.disconnected);
    const { data } = await b.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(workDir('shots'), `wiring-${label.replace(/\W+/g, '_')}.png`), Buffer.from(data, 'base64'));
    await b.send('Target.closeTarget', { targetId });
    return { out, log };
  }

  if (crossesMidnight) console.log('(orario vicino alla mezzanotte: scenario temporale semplificato)');
  let r = await scenario('Firma dal registro di un\'altra classe', { start: 'registro:3A:1' }, 'firma');
  check('mondo isolato: clic su «Home» arrivato alla pagina', r.log.homeClicks === 1, JSON.stringify(r.log));
  check('firma la lezione in corso (4B 3ª) cliccando la sua icona', r.out.result?.ok && r.log.signClicks.join() === '4B#3', JSON.stringify(r.log.signClicks));
  check('nessun clic su ore già firmate', r.log.unsignAttempts === 0);
  check('orari letti dai dati della Home tramite il bridge (mondo MAIN)', r.out.steps.some(s => s.startsWith('Ora attuale') && s.includes(times[3].replace(' - ', '–'))), r.out.steps.join(' | '));

  r = await scenario('Appello', { start: 'registro:5C:5', signed: ['4B#3'] }, 'appello');
  check('appello: Home → 4B 3ª → «Appello» aperto', r.out.result?.ok && r.log.appelloOpened === 1 && r.log.opened.at(-1) === '4B#3', JSON.stringify(r.log));

  r = await scenario('Firma senza orari nella Home', { timesInDashboard: false }, 'firma');
  check('orari letti dalla tabella del registro, poi la classe giusta', r.out.result?.ok && r.log.opened.join() === '3A#1,4B#3' && r.log.signClicks.join() === '4B#3', JSON.stringify(r.log.opened));

  r = await scenario('Appello con ora non firmata', {}, 'appello');
  check('errore esplicito quando «Appello» è disattivato', r.out.result && !r.out.result.ok && /disattivato/.test(r.out.result.error), r.out.result && r.out.result.error);
} catch (e) {
  console.log('FAILED', e.stack || e.message);
  results.push(false);
} finally {
  await b.close();
  server.close();
  rmSync(extDir, { recursive: true, force: true });
}
console.log(`\n${results.filter(Boolean).length}/${results.length} verifiche con l'estensione vera`);
