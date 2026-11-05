// Esegue in sequenza tutti i test che non hanno bisogno di Internet.
//   node tests/run-all.mjs            → impostazioni, funzioni, firma/appello, estensione vera
//   node tests/run-all.mjs --reali    → in più, il percorso di accesso sulle pagine vere di Argo e del Ministero
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = ['test-impostazioni.mjs', 'test-funzioni.mjs', 'test-firma-appello.mjs', 'test-estensione-vera.mjs'];
if (process.argv.includes('--reali')) suites.push('test-siti-reali.mjs');

const results = [];
for (const suite of suites) {
  console.log(`\n=============== ${suite} ===============`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(here, suite)], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  const out = r.stdout || '';
  const failed = r.status !== 0 || /✘|FAIL\b|FAILED|ERRORE NEL TEST/.test(out);
  results.push({ suite, ok: !failed, s: Math.round((Date.now() - t0) / 1000) });
}
console.log('\n=============== riepilogo ===============');
for (const r of results) console.log(`${r.ok ? '✔' : '✘'} ${r.suite} (${r.s} s)`);
process.exit(results.every(r => r.ok) ? 0 : 1);
