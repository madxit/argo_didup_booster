#!/usr/bin/env node
// Scrive build-info.json con commit e data dell'ultimo commit git.
// La pagina delle impostazioni lo mostra nella sezione "Informazioni"
// (la versione invece si legge sempre da manifest.json).
//   node tools/build-info.mjs
// Lo eseguono da soli gli hook in tools/git-hooks (dopo commit, checkout, merge e rebase)
// se git è configurato con: git config core.hooksPath tools/git-hooks
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let info;
try {
  info = {
    commit: git('rev-parse', 'HEAD'),
    commitDate: git('log', '-1', '--format=%cI'),
    generatedAt: new Date().toISOString()
  };
} catch (e) {
  info = { commit: null, commitDate: null, generatedAt: new Date().toISOString(), note: 'cartella non sotto git' };
}
writeFileSync(path.join(root, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log('build-info.json:', info.commit ? `${info.commit.slice(0, 7)} del ${info.commitDate}` : info.note);
