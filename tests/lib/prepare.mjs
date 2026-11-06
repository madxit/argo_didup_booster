// Utilità comuni ai test: cartelle temporanee, copia dell'estensione con il
// finto oggetto chrome.* (per le pagine servite da un server locale) e
// chiusura garantita del Chrome di prova.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TESTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT = path.resolve(TESTS, '..');
export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// File e cartelle che non fanno parte dell'estensione.
const NOT_EXTENSION = new Set(['tests', 'tools', 'docs', 'README.md', 'CLAUDE.md', '.git', '.gitignore', '.DS_Store', 'desktop.ini']);

export function workDir(name) {
  const dir = path.join(os.tmpdir(), 'argo-didup-booster-tests', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Copia dell'estensione così com'è (per caricarla in Chrome).
export function copyExtension() {
  const dir = fs.mkdtempSync(path.join(workDir('ext'), 'ext-'));
  for (const entry of fs.readdirSync(PROJECT)) {
    if (NOT_EXTENSION.has(entry)) continue;
    fs.cpSync(path.join(PROJECT, entry), path.join(dir, entry), { recursive: true });
  }
  return dir;
}

// Copia per i test su server locale: le impostazioni caricano prima mock-chrome.js.
export function prepareMockExtension() {
  const dir = copyExtension();
  fs.copyFileSync(path.join(TESTS, 'mock', 'mock-chrome.js'), path.join(dir, 'mock-chrome.js'));
  for (const page of ['options.html']) {
    const file = path.join(dir, page);
    const html = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, html.replace('<script src="settings.js"></script>',
      '<script src="mock-chrome.js"></script>\n  <script src="settings.js"></script>'));
  }
  return dir;
}

// Il Chrome di prova va chiuso anche se il test si interrompe con un errore.
export function killOnExit(proc) {
  const kill = () => { try { proc.kill('SIGKILL'); } catch (e) { /* già chiuso */ } };
  process.on('exit', kill);
  for (const ev of ['uncaughtException', 'unhandledRejection']) {
    process.on(ev, err => { console.error('ERRORE NEL TEST:', err && err.stack ? err.stack : err); kill(); process.exit(1); });
  }
  process.on('SIGINT', () => { kill(); process.exit(130); });
}
