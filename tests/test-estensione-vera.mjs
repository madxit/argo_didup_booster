// Estensione VERA (script dichiarati nel manifest, mondo isolato, pulsanti
// nella pagina, service worker reale) contro il DidUP finto servito come https://www.portaleargo.it:
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

// Orario delle lezioni attorno all'ora attuale, in un fuso orario emulato dove sono
// circa le 10:00 (così il test non dipende dall'ora in cui gira): la 3ª ora (4B) è in corso.
const now = new Date();
let tzOffset = (10 - now.getUTCHours() + 24) % 24;
if (tzOffset > 14) tzOffset -= 24;
const TIMEZONE = tzOffset === 0 ? 'Etc/GMT' : `Etc/GMT${tzOffset > 0 ? '-' : '+'}${Math.abs(tzOffset)}`;
const nowMin = (now.getUTCHours() + tzOffset + 24) % 24 * 60 + now.getUTCMinutes();
const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const start3 = nowMin - 10;
const times = {};
for (let n = 1; n <= 5; n++) times[n] = `${fmt(start3 + (n - 3) * 60)} - ${fmt(start3 + (n - 2) * 60)}`;

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

  async function scenario(label, cfg, action, keepOpen = false) {
    const url = `https://www.portaleargo.it/voti/?classic#${encodeURIComponent(JSON.stringify({ times, ...cfg }))}`;
    const { targetId } = await b.send('Target.createTarget', { url });
    const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
    await b.send('Runtime.enable', {}, sessionId);
    await b.send('Emulation.setTimezoneOverride', { timezoneId: TIMEZONE }, sessionId);
    const pEval = async expr => (await b.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
    await waitFor(async () => (await pEval('document.readyState')) === 'complete' && (await pEval(`(() => { const h = document.querySelector('[data-argo-assistant="toolbar"]'); return !!(h && h.style.display !== 'none'); })()`)), { label: 'pulsanti nella pagina', timeout: 15000 });
    await sleep(1200);
    // come l'utente: clic sul pulsante nella barra di DidUP, poi si legge il pannello dei passi
    await pEval(`document.querySelector('[data-argo-assistant="toolbar"]').shadowRoot.querySelector('[data-action="${action}"]').click()`);
    // (vicino alla mezzanotte gli orari finti escono dalla fascia: alla domanda si risponde «sì»)
    await waitFor(async () => pEval(`(() => { const r = document.querySelector('[data-argo-assistant="run"]'); if (!r) return false;
      const ask = r.shadowRoot.querySelector('.askbox'); if (ask && !ask.hidden) r.shadowRoot.querySelector('.yes').click();
      const x = r.shadowRoot.querySelector('.result'); return !!(x && !x.hidden); })()`), { label: 'esito', timeout: 40000 });
    const out = await pEval(`(() => { const p = document.querySelector('[data-argo-assistant="run"]').shadowRoot;
      const ok = p.querySelector('.p').classList.contains('done') || p.querySelector('.p').classList.contains('cancelled');
      const steps = [...p.querySelectorAll('li')].map(l => l.textContent);
      return { steps, result: { ok, summary: p.querySelector('.result').textContent, error: ok ? '' : steps[steps.length - 1] } };
    })()`);
    const log = await pEval('JSON.parse(JSON.stringify(window.__didup))');
    console.log(`\n[${label}]`);
    for (const s of out.steps) console.log('    ·', s);
    console.log('    =', out.result ? (out.result.ok ? out.result.summary : 'ERRORE: ' + out.result.error) : out.disconnected);
    const { data } = await b.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(workDir('shots'), `wiring-${label.replace(/\W+/g, '_')}.png`), Buffer.from(data, 'base64'));
    if (!keepOpen) await b.send('Target.closeTarget', { targetId });
    return { out, log, targetId, pEval };
  }

  console.log(`(fuso orario emulato ${TIMEZONE}: sono le ${fmt(nowMin)})`);
  let r = await scenario('Firma dal registro di un\'altra classe', { start: 'registro:3A:1' }, 'firma');
  check('mondo isolato: clic su «Home» arrivato alla pagina', r.log.homeClicks === 1, JSON.stringify(r.log));
  check('firma la lezione in corso (4B 3ª) cliccando la sua icona', r.out.result?.ok && r.log.signClicks.join() === '4B#3', JSON.stringify(r.log.signClicks));
  check('nessun clic su ore già firmate', r.log.unsignAttempts === 0);
  check('orari letti dai dati della Home tramite il bridge (mondo MAIN)', r.out.steps.some(s => s.startsWith('Ora attuale') && s.includes(times[3].replace(' - ', '–'))), r.out.steps.join(' | '));

  r = await scenario('Appello', { start: 'registro:5C:5', signed: ['4B#3'] }, 'appello');
  check('appello: Home → 4B 3ª → «Appello» aperto', r.out.result?.ok && r.log.appelloOpened === 1 && r.log.opened.at(-1) === '4B#3', JSON.stringify(r.log));

  r = await scenario('Firma senza orari nella Home', { timesInDashboard: false }, 'firma');
  check('orari letti dalla tabella del registro, poi la classe giusta', r.out.result?.ok && r.log.opened.join() === '3A#1,4B#3' && r.log.signClicks.join() === '4B#3', JSON.stringify(r.log.opened));

  r = await scenario('Firma in classe articolata', { articolata: { '4B': { 3: { docente: 'BIANCHI ANNA', firmata: true } } }, homeFirmataDaAltri: true }, 'firma');
  check('classe articolata: firma la tua riga anche se il collega ha già firmato', r.out.result?.ok && r.log.signClicks.join() === '4B#3' && r.log.otherClicks === 0, r.out.steps.join(' | '));

  r = await scenario('Appello con ora non firmata', {}, 'appello', true);
  check('errore esplicito quando «Appello» è disattivato', r.out.result && !r.out.result.ok && /disattivato/.test(r.out.result.error), r.out.result && r.out.result.error);

  // Mantenimento della sessione: il service worker vero esegue il controllo nella scheda (mondo MAIN)
  await swEval(`chrome.storage.local.set({ keepAliveEnabled: true })`);
  await sleep(300);
  await swEval(`keepAliveTick()`);
  const ka = await swEval(`chrome.storage.local.get('keepAliveStatus').then(x => x.keepAliveStatus)`);
  check('mantenimento: richiesta autenticata dalla scheda del registro, stato salvato', ka && ka.ok && ka.action === 'ping' && ka.httpStatus === 200 && ka.noOidc === true, JSON.stringify(ka));
  const alarm = await swEval(`chrome.alarms.get('argo-keepalive')`);
  check('allarme del mantenimento attivo ogni minuto', alarm && alarm.periodInMinutes === 1, JSON.stringify(alarm));
  // clic sull'icona dentro il registro con la sessione valida → impostazioni
  await swEval(`chrome.tabs.query({ url: 'https://www.portaleargo.it/*' }).then(t => handleIconClick(t[0]))`);
  await sleep(800);
  const opts = (await b.send('Target.getTargets')).targetInfos.some(t => t.url.includes('/options.html'));
  check('clic sull\'icona nel registro con la sessione valida: si aprono le impostazioni', opts);
  await b.send('Target.closeTarget', { targetId: r.targetId });
} catch (e) {
  console.log('FAILED', e.stack || e.message);
  results.push(false);
} finally {
  await b.close();
  server.close();
  rmSync(extDir, { recursive: true, force: true });
}
console.log(`\n${results.filter(Boolean).length}/${results.length} verifiche con l'estensione vera`);
