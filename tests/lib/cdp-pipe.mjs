// Client CDP minimo su --remote-debugging-pipe: serve per caricare l'estensione
// vera con Extensions.loadUnpacked (Google Chrome ignora --load-extension).
// Profilo sempre nuovo in una cartella temporanea: il Chrome dell'utente non viene toccato.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME, workDir } from './prepare.mjs';

export async function launch({ headless = true, extraArgs = [] } = {}) {
  const profile = mkdtempSync(join(workDir('profiles'), 'p-'));
  const args = [
    ...(headless ? ['--headless=new'] : []),
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen',
    '--window-size=1280,900',
    ...extraArgs,
    'about:blank'
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  process.on('exit', () => { try { proc.kill('SIGKILL'); } catch (e) { /* già chiuso */ } });
  proc.stderr.on('data', () => {});
  const out = proc.stdio[3], inp = proc.stdio[4];
  let buf = Buffer.alloc(0), nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  inp.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    let i;
    while ((i = buf.indexOf(0)) !== -1) {
      const msg = JSON.parse(buf.subarray(0, i).toString('utf8'));
      buf = buf.subarray(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, method } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(method + ': ' + msg.error.message));
        else resolve(msg.result);
      } else {
        for (const l of listeners) l(msg);
      }
    }
  });
  function send(method, params = {}, sessionId) {
    const id = nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    out.write(JSON.stringify(msg) + '\0');
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
  }
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  async function close() {
    try { await send('Browser.close'); } catch (e) {}
    setTimeout(() => proc.kill('SIGKILL'), 2000).unref();
  }
  return { send, on, close, proc, profile };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 15000, interval = 200, label = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(interval);
  }
  throw new Error('Timeout waiting for ' + label + (last instanceof Error ? ' (' + last.message + ')' : ''));
}

// chrome://extensions: modalità sviluppatore (serve a chrome.runtime.reload per le estensioni decompresse).
export async function enableDevMode(b) {
  const { targetId } = await b.send('Target.createTarget', { url: 'chrome://extensions/' });
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  const ev = async expr => (await b.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
  await waitFor(() => ev('!!(window.chrome && chrome.developerPrivate)'), { label: 'pagina estensioni' });
  await ev('chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })');
}
