// Test sulle pagine VERE di Argo e del Ministero (serve Internet), con l'estensione
// vera in un Chrome separato e un profilo vuoto. Si ferma alla pagina di accesso
// del provider (Poste ID, InfoCert, CIE) e non inserisce mai credenziali.
// Uso: node tests/test-siti-reali.mjs [stale|click|onlogin]
import { launch, sleep, waitFor, enableDevMode } from './lib/cdp-pipe.mjs';
import { copyExtension, workDir } from './lib/prepare.mjs';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = workDir('shots');
const only = process.argv[2] || '';
const results = [];
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);
function check(name, cond, extra = '') {
  results.push({ name, ok: Boolean(cond) });
  log(cond ? 'PASS' : 'FAIL', name, extra);
}

const freshCopy = copyExtension;

async function session(b, targetId) {
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  const ev = async expr => {
    const r = await b.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { sessionId, ev };
}

async function swSession(b, extId) {
  const sw = await waitFor(async () => {
    const { targetInfos } = await b.send('Target.getTargets');
    return targetInfos.find(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
  }, { label: 'service worker', timeout: 20000 });
  return session(b, sw.targetId);
}


// Follows the tab that reaches Argo; returns the list of hosts seen and the final probe.
async function followLogin(b, { timeout = 45000, stopAtHost = null, shotPrefix = '' } = {}) {
  const page = await waitFor(async () => {
    const { targetInfos } = await b.send('Target.getTargets');
    return targetInfos.find(t => t.type === 'page' && /portaleargo|eid\.istruzione/.test(t.url));
  }, { label: 'argo page', timeout: 20000 });
  const s = await session(b, page.targetId);
  const seen = [], toasts = [];
  // every navigation of this tab, even the very fast ones
  const off = b.on(msg => {
    if (msg.method !== 'Target.targetInfoChanged' || msg.params.targetInfo.targetId !== page.targetId) return;
    try {
      const host = new URL(msg.params.targetInfo.url).hostname;
      if (host && !seen.includes(host)) { seen.push(host); log('  →', host); }
    } catch (e) { /* about:blank */ }
  });
  let last = null, shots = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let p;
    try {
      p = await s.ev(`(() => {
        const toast = document.querySelector('[data-argo-assistant="toast"]');
        const cc = document.getElementById('customer_code');
        const menu = document.querySelector('a.idp-btn');
        return { url: location.href, host: location.hostname, ready: document.readyState,
          code: cc ? cc.value : null,
          menuOpen: menu ? menu.getAttribute('aria-expanded') : null,
          toast: toast && toast.shadowRoot ? toast.shadowRoot.textContent.replace(/\\s+/g, ' ').trim() : null };
      })()`);
    } catch (e) { await sleep(300); continue; }
    if (p.host && !seen.includes(p.host)) { seen.push(p.host); log('  →', p.host); }
    if (p.toast && !toasts.includes(p.toast)) { toasts.push(p.toast); log('  toast:', p.toast); }
    last = p;
    if (p.ready === 'complete' && shotPrefix && shots < seen.length) {
      await sleep(700);
      const { data } = await b.send('Page.captureScreenshot', { format: 'png' }, s.sessionId).catch(() => ({}));
      if (data) writeFileSync(join(SHOTS, `${shotPrefix}-${++shots}-${p.host}.png`), Buffer.from(data, 'base64'));
    }
    if (stopAtHost && p.host && stopAtHost.test(p.host) && p.ready === 'complete') break;
    await sleep(300);
  }
  off();
  return { seen, toasts, last, s, targetId: page.targetId };
}

async function withBrowser(fn) {
  const b = await launch();
  try { await enableDevMode(b); await b.send('Target.setDiscoverTargets', { discover: true }); await fn(b); }
  catch (e) { check('no exception', false, e.stack); }
  finally { await b.close(); await sleep(500); }
}

const SETTINGS = (extra = {}) => ({ codiceScuola: 'SG18328', loginMethod: 'spid', spidProvider: 'posteid', autoLogin: true, ...extra });

// ---------------------------------------------------------------------------
// 1. User's situation: Chrome still runs the old version, new files on disk.
// ---------------------------------------------------------------------------
if (!only || only === 'stale') await withBrowser(async b => {
  log('== 1. stale extension self-heals and then logs in (SPID · Poste ID)');
  const dir = freshCopy();
  const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const oldMan = { ...man, version: '2.1', action: { ...man.action, default_popup: 'popup.html' },
    host_permissions: ['https://*.portaleargo.it/*'], content_scripts: man.content_scripts.slice(1, 2).map(c => ({ ...c, js: ['settings.js', 'keepalive.js'] })) };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(oldMan, null, 2));
  // old service worker: knows nothing about 'go-registro' (like v2.1)
  const newBg = readFileSync(join(dir, 'background.js'), 'utf8');
  writeFileSync(join(dir, 'background.js'), "importScripts('settings.js');\n");
  const { id } = await b.send('Extensions.loadUnpacked', { path: dir });
  await sleep(500);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(man, null, 2));   // "update" on disk
  writeFileSync(join(dir, 'background.js'), newBg);
  let sw = await swSession(b, id);
  const v0 = await sw.ev('chrome.runtime.getManifest().version');
  check('old version running', v0 === '2.1', v0);
  await sw.ev(`chrome.storage.local.set(${JSON.stringify(SETTINGS())})`);
  // The user clicks the icon: the (old) manifest opens popup.html (served from disk = new code).
  const { targetId } = await b.send('Target.createTarget', { url: `chrome-extension://${id}/popup.html` });
  await sleep(300);
  const r = await followLogin(b, { stopAtHost: /poste\.it$/, shotPrefix: 'stale' });
  sw = await swSession(b, id);
  const after = await sw.ev(`(async () => ({ v: chrome.runtime.getManifest().version, origins: (await chrome.permissions.getAll()).origins, selfReload: (await chrome.storage.local.get('selfReload')).selfReload }))()`);
  check('reloaded to the version on disk (' + man.version + ')', after.v === man.version, JSON.stringify(after.v));
  check('eid.istruzione.it permission granted', after.origins.includes('https://eid.istruzione.it/*'));
  check('pending action handled once', after.selfReload && after.selfReload.handled === true);
  check('school code filled on Argo', r.seen.includes('www.portaleargo.it'));
  check('passed through eid gateway', r.seen.includes('eid.istruzione.it'));
  check('reached Poste ID login page', /posteid\.poste\.it$/.test(r.last && r.last.host), r.last && r.last.host);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2..4. Fresh 2.3: icon click outside Argo with SPID provider / CIE / no provider.
// ---------------------------------------------------------------------------
for (const [label, settings, expect] of [
  ['SPID · InfoCert', SETTINGS({ spidProvider: 'infocertid' }), { host: /infocert\.it$/ }],
  ['CIE', SETTINGS({ loginMethod: 'cie' }), { host: /servizicie\.interno\.gov\.it$/ }],
  ['SPID, provider da scegliere', SETTINGS({ spidProvider: '' }), { stayEid: true }]
]) {
  if (only && only !== 'click') continue;
  await withBrowser(async b => {
    log(`== icon click outside Argo · ${label}`);
    const dir = freshCopy();
    const { id } = await b.send('Extensions.loadUnpacked', { path: dir });
    const sw = await swSession(b, id);
    await sw.ev(`chrome.storage.local.set(${JSON.stringify(settings)})`);
    // close the options page opened at install (no code yet at install time)
    const { targetInfos } = await b.send('Target.getTargets');
    for (const t of targetInfos) if (t.url.includes('/options.html')) await b.send('Target.closeTarget', { targetId: t.targetId });
    const res = await sw.ev('goToRegistro({ id: -1, url: undefined })');
    check(`[${label}] new tab created`, res && res.action === 'create', JSON.stringify(res));
    const r = await followLogin(b, { stopAtHost: expect.host || null, timeout: expect.stayEid ? 12000 : 45000, shotPrefix: 'click-' + label.replace(/\W+/g, '_') });
    check(`[${label}] went through Argo login + eid`, r.seen.includes('www.portaleargo.it') && r.seen.includes('eid.istruzione.it'), r.seen.join(' → '));
    if (expect.host) check(`[${label}] reached provider page`, expect.host.test(r.last.host), r.last.host);
    if (expect.stayEid) {
      check(`[${label}] stays on eid with SPID menu open`, r.last.host === 'eid.istruzione.it' && r.last.menuOpen === 'true', JSON.stringify({ host: r.last.host, menu: r.last.menuOpen }));
      check(`[${label}] toast asks to choose`, r.toasts.some(t => /Scegli il provider/.test(t)), r.toasts.join(' | '));
    }
    rmSync(dir, { recursive: true, force: true });
  });
}

// ---------------------------------------------------------------------------
// 5. Icon click while already on the Argo login page (auto-login off).
// ---------------------------------------------------------------------------
if (!only || only === 'onlogin') await withBrowser(async b => {
  log('== icon click on the Argo login page (autoLogin off)');
  const dir = freshCopy();
  const { id } = await b.send('Extensions.loadUnpacked', { path: dir });
  const sw = await swSession(b, id);
  await sw.ev(`chrome.storage.local.set(${JSON.stringify(SETTINGS({ autoLogin: false }))})`);
  const { targetId } = await b.send('Target.createTarget', { url: 'https://www.portaleargo.it/voti/' });
  const s = await session(b, targetId);
  await waitFor(async () => /\/auth\/sso\/login/.test(await s.ev('location.href')) && (await s.ev('document.readyState')) === 'complete', { label: 'login page', timeout: 20000 });
  await sleep(2500);
  check('with autoLogin off nothing happens by itself', (await s.ev('location.hostname')) === 'www.portaleargo.it' && (await s.ev('document.getElementById("customer_code").value')) === '');
  const url = await s.ev('location.href');
  const { targetInfos } = await b.send('Target.getTargets');
  const tabId = await sw.ev(`chrome.tabs.query({ url: 'https://*.portaleargo.it/*' }).then(t => t[0].id)`);
  const res = await sw.ev(`goToRegistro({ id: ${tabId}, url: ${JSON.stringify(url)} })`);
  check('icon click starts the login on the same page', res && res.action === 'login-here', JSON.stringify(res));
  const r = await followLogin(b, { stopAtHost: /poste\.it$/ });
  check('reached Poste ID login page', /posteid\.poste\.it$/.test(r.last.host), r.seen.join(' → '));
  rmSync(dir, { recursive: true, force: true });
});

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
if (failed.length) console.log('FAILED:', failed.map(f => f.name).join(' | '));
