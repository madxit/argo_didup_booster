// =====================================================================
// options.js — pagina delle impostazioni
// Ogni modifica viene salvata automaticamente in chrome.storage.local.
// =====================================================================

let state = null;        // impostazioni correnti
let selectedIndex = -1;  // indice della disciplina selezionata

const $ = id => document.getElementById(id);

// =================== SALVATAGGIO ===================

let savedTimer;
function flashSaved() {
  const el = $('save-indicator');
  el.classList.add('visible');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('visible'), 1500);
}

async function save(partial) {
  Object.assign(state, partial);
  try {
    await saveSettings(partial);
    flashSaved();
  } catch (err) {
    showToast('Errore durante il salvataggio: ' + err.message);
  }
}

// Salvataggio ritardato per i campi di testo (evita una scrittura per tasto).
const pending = {};
function saveDebounced(key, value, delay = 400) {
  state[key] = value;
  clearTimeout(pending[key]);
  pending[key] = setTimeout(() => {
    delete pending[key];
    save({ [key]: state[key] });
  }, delay);
}

function flushPending() {
  const keys = Object.keys(pending);
  if (keys.length === 0) return;
  const partial = {};
  for (const key of keys) {
    clearTimeout(pending[key]);
    delete pending[key];
    partial[key] = state[key];
  }
  save(partial);
}

function cancelPending() {
  for (const key of Object.keys(pending)) {
    clearTimeout(pending[key]);
    delete pending[key];
  }
}

window.addEventListener('pagehide', flushPending);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPending();
});

// =================== TOAST E DIALOG ===================

let toastTimer;
function hideToast() {
  $('toast').classList.remove('visible');
}

function showToast(msg, { actionLabel, onAction } = {}) {
  $('toast-msg').textContent = msg;
  const btn = $('toast-action');
  if (actionLabel) {
    btn.hidden = false;
    btn.textContent = actionLabel;
    btn.onclick = () => { hideToast(); onAction(); };
  } else {
    btn.hidden = true;
    btn.onclick = null;
  }
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 7000 : 3500);
}

// Mostra un dialog con più scelte; restituisce il `value` scelto o null.
function askChoice(message, choices) {
  return new Promise(resolve => {
    const dlg = $('choice-dialog');
    $('choice-msg').textContent = message;
    const box = $('choice-buttons');
    box.textContent = '';
    for (const c of choices) {
      const b = document.createElement('button');
      b.value = c.value;
      b.textContent = c.label;
      b.className = 'btn ' + (c.cls || '');
      box.appendChild(b);
    }
    dlg.returnValue = '';
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue;
      resolve(v && v !== 'cancel' ? v : null);
    }, { once: true });
    dlg.showModal();
    box.firstElementChild?.focus();
  });
}

// =================== SCUOLA E DOCENTE ===================

function updateMissingCode() {
  const missing = !state.codiceScuola;
  $('missing-code-banner').hidden = !missing;
  $('sec-scuola').classList.toggle('needs-attention', missing);
}

function setCodeError(msg) {
  const err = $('codiceScuola-error');
  $('codiceScuola').classList.toggle('invalid', Boolean(msg));
  err.hidden = !msg;
  err.textContent = msg || '';
}

function bindScuola() {
  const code = $('codiceScuola');
  code.addEventListener('input', () => {
    const v = normalizeCodiceScuola(code.value);
    if (v && !isValidCodiceScuola(v)) return; // l'errore viene mostrato all'uscita dal campo
    setCodeError('');
    saveDebounced('codiceScuola', v);
    updateMissingCode();
  });
  code.addEventListener('change', () => {
    const v = normalizeCodiceScuola(code.value);
    code.value = v;
    if (v && !isValidCodiceScuola(v)) {
      setCodeError('Il codice può contenere solo lettere e numeri (da 3 a 16 caratteri).');
    }
  });

  const nome = $('docenteNome');
  nome.addEventListener('input', () => saveDebounced('docenteNome', cleanText(nome.value)));
  nome.addEventListener('change', () => { nome.value = cleanText(nome.value); });
}

// =================== METODO DI ACCESSO ===================

function updateProviderField() {
  const spid = state.loginMethod === 'spid';
  $('spidProvider').disabled = !spid;
  $('spid-provider-field').style.opacity = spid ? '' : '.5';
}

function bindAccesso() {
  const select = $('spidProvider');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— Scelgo ogni volta —';
  select.appendChild(none);
  for (const p of SPID_PROVIDERS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.nome;
    select.appendChild(o);
  }
  select.addEventListener('change', () => save({ spidProvider: select.value }));

  document.querySelectorAll('input[name="loginMethod"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      save({ loginMethod: radio.value });
      updateProviderField();
    });
  });

  $('autoLogin').addEventListener('change', e => save({ autoLogin: e.target.checked }));
}

// =================== SESSIONE ===================

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} s`;
  return s ? `${m} min ${s} s` : `${m} min`;
}

function updateIntervalLabel() {
  const raw = Number($('keepAliveInterval').value);
  $('interval-human').textContent = Number.isFinite(raw) && raw > 0 ? `= ${formatDuration(clampInterval(raw))}` : '';
}

function updateKeepAliveDisabled() {
  $('keepalive-options').classList.toggle('disabled', !state.keepAliveEnabled);
}

function bindSessione() {
  $('keepAliveEnabled').addEventListener('change', e => {
    save({ keepAliveEnabled: e.target.checked });
    updateKeepAliveDisabled();
  });

  const interval = $('keepAliveInterval');
  interval.addEventListener('input', updateIntervalLabel);
  interval.addEventListener('change', () => {
    const v = clampInterval(interval.value);
    interval.value = v;
    updateIntervalLabel();
    save({ keepAliveInterval: v });
  });

  document.querySelectorAll('input[name="keepAliveMethod"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) save({ keepAliveMethod: radio.value });
    });
  });
}

function renderKeepAliveStatus(st) {
  const el = $('keepalive-status');
  el.className = 'status-line';
  if (!st || !st.time) {
    el.textContent = 'Nessun refresh ancora eseguito: si attiva quando sei dentro il registro.';
    return;
  }
  const when = new Date(st.time).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  if (st.expired) {
    el.classList.add('err');
    el.textContent = `⚠️ Sessione scaduta (rilevato il ${when}). Effettua di nuovo l'accesso.`;
  } else if (st.ok) {
    el.classList.add('ok');
    const labels = {
      start: '✓ Mantenimento della sessione avviato',
      reload: '✓ Ultimo refresh (ricarica pagina)',
      ping: '✓ Ultimo rinnovo della sessione'
    };
    el.textContent = `${labels[st.action] || labels.ping}: ${when}`;
  } else {
    el.classList.add('err');
    el.textContent = `Ultimo refresh non riuscito (${when})` + (st.error ? `: ${st.error}` : '');
  }
}

// =================== LISTE ORDINABILI ===================

function moveItem(arr, from, to) {
  if (to < 0 || to >= arr.length || from === to) return false;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  return true;
}

function iconButton(act, label, symbol, disabled = false, extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn ' + extraClass;
  b.dataset.act = act;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.textContent = symbol;
  b.disabled = disabled;
  return b;
}

function makeItem({ index, total, text, sub, selectable, selected, numbered }) {
  const li = document.createElement('li');
  li.dataset.index = String(index);
  if (selectable) li.classList.add('selectable');
  if (selected) li.classList.add('selected');

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.title = 'Trascina per spostare';
  handle.textContent = '⠿';
  li.appendChild(handle);

  if (numbered) {
    const n = document.createElement('span');
    n.className = 'item-index';
    n.textContent = `${index + 1}.`;
    li.appendChild(n);
  }

  // Nome (modificabile in linea) e, sotto, il riepilogo es. "4 argomenti · 2 compiti".
  const main = document.createElement('span');
  main.className = 'item-main';
  const span = document.createElement('span');
  span.className = 'item-text';
  span.textContent = text;
  main.appendChild(span);
  if (sub) {
    const small = document.createElement('small');
    small.className = 'item-sub';
    small.textContent = sub;
    main.appendChild(small);
  }
  li.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.append(
    iconButton('up', 'Sposta su', '▲', index === 0),
    iconButton('down', 'Sposta giù', '▼', index === total - 1),
    iconButton('edit', 'Modifica', '✎'),
    iconButton('del', 'Elimina', '🗑', false, 'del')
  );
  li.appendChild(actions);
  return li;
}

// Drag & drop nativo; si trascina solo dalla maniglia.
function makeSortable(listEl, onMove) {
  let dragFrom = null;

  const clearMarks = () => {
    listEl.querySelectorAll('.drop-before, .drop-after').forEach(el => {
      el.classList.remove('drop-before', 'drop-after');
    });
  };

  listEl.addEventListener('mousedown', e => {
    const handle = e.target.closest('.drag-handle');
    if (handle) handle.closest('li').draggable = true;
  });
  listEl.addEventListener('mouseup', e => {
    const li = e.target.closest('li');
    if (li && dragFrom === null) li.draggable = false;
  });

  listEl.addEventListener('dragstart', e => {
    const li = e.target.closest('li');
    if (!li || !li.draggable) { e.preventDefault(); return; }
    dragFrom = Number(li.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.querySelector('.item-text')?.textContent || '');
    requestAnimationFrame(() => li.classList.add('dragging'));
  });

  listEl.addEventListener('dragover', e => {
    if (dragFrom === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearMarks();
    const li = e.target.closest('li');
    if (!li) return;
    const rect = li.getBoundingClientRect();
    li.classList.add(e.clientY > rect.top + rect.height / 2 ? 'drop-after' : 'drop-before');
  });

  listEl.addEventListener('dragleave', e => {
    if (!listEl.contains(e.relatedTarget)) clearMarks();
  });

  listEl.addEventListener('drop', e => {
    if (dragFrom === null) return;
    e.preventDefault();
    const li = e.target.closest('li');
    const total = listEl.children.length;
    let to;
    if (!li) {
      to = total - 1;
    } else {
      const rect = li.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      to = Number(li.dataset.index) + (after ? 1 : 0);
      if (dragFrom < to) to--;
    }
    const from = dragFrom;
    dragFrom = null;
    clearMarks();
    if (to !== from) onMove(from, to);
  });

  listEl.addEventListener('dragend', e => {
    const li = e.target.closest('li');
    if (li) { li.draggable = false; li.classList.remove('dragging'); }
    dragFrom = null;
    clearMarks();
  });
}

function startInlineEdit(li, currentText, onCommit) {
  const span = li.querySelector('.item-text');
  if (!span) return;
  const input = document.createElement('input');
  input.className = 'inline-edit';
  input.value = currentText;
  span.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = commit => {
    if (done) return;
    done = true;
    const v = cleanText(input.value);
    if (commit && v && v !== currentText) onCommit(v);
    else renderTopicsSection();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

// =================== DISCIPLINE ===================

function commitDiscipline() {
  save({ discipline: state.discipline });
  renderTopicsSection();
}

function findDisciplina(nome, exceptIndex = -1) {
  const key = nome.toLowerCase();
  return state.discipline.findIndex((d, i) => i !== exceptIndex && d.nome.toLowerCase() === key);
}

function selectedDisciplina() {
  return state.discipline[selectedIndex] || null;
}

function moveDisciplina(from, to) {
  const sel = selectedDisciplina();
  if (!moveItem(state.discipline, from, to)) return;
  selectedIndex = state.discipline.indexOf(sel);
  commitDiscipline();
}

function renameDisciplina(i, nome) {
  if (findDisciplina(nome, i) !== -1) {
    showToast(`Esiste già una disciplina "${nome}".`);
    renderTopicsSection();
    return;
  }
  state.discipline[i].nome = nome;
  commitDiscipline();
}

async function deleteDisciplina(i) {
  const d = state.discipline[i];
  if (d.argomenti.length + d.compiti.length > 0) {
    const choice = await askChoice(
      `Eliminare la disciplina "${d.nome}" con ${describeVoci(d)}?`,
      [{ value: 'cancel', label: 'Annulla' }, { value: 'ok', label: 'Elimina', cls: 'danger' }]
    );
    if (choice !== 'ok') return;
  }
  const idx = state.discipline.indexOf(d);
  if (idx === -1) return;
  state.discipline.splice(idx, 1);
  if (selectedIndex === idx) selectedIndex = Math.min(idx, state.discipline.length - 1);
  else if (selectedIndex > idx) selectedIndex--;
  commitDiscipline();

  showToast(`Disciplina "${d.nome}" eliminata.`, {
    actionLabel: 'Annulla',
    onAction: () => {
      if (findDisciplina(d.nome) !== -1) return;
      const at = Math.min(idx, state.discipline.length);
      state.discipline.splice(at, 0, d);
      selectedIndex = at;
      commitDiscipline();
    }
  });
}

function renderDiscipline() {
  const list = $('discipline-list');
  list.textContent = '';
  const total = state.discipline.length;
  state.discipline.forEach((d, i) => {
    list.appendChild(makeItem({
      index: i, total, text: d.nome, sub: describeVoci(d),
      selectable: true, selected: i === selectedIndex
    }));
  });
  $('discipline-empty').hidden = total > 0;
}

function bindDiscipline() {
  const list = $('discipline-list');

  $('add-disciplina-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('new-disciplina');
    const nome = cleanText(input.value);
    if (!nome) return;
    const existing = findDisciplina(nome);
    if (existing !== -1) {
      selectedIndex = existing;
      input.value = '';
      renderTopicsSection();
      showToast(`La disciplina "${nome}" esiste già.`);
      return;
    }
    state.discipline.push({ nome, argomenti: [], compiti: [] });
    selectedIndex = state.discipline.length - 1;
    input.value = '';
    commitDiscipline();
  });

  list.addEventListener('click', e => {
    const li = e.target.closest('li');
    if (!li || li.querySelector('.inline-edit')) return;
    const i = Number(li.dataset.index);
    const btn = e.target.closest('button[data-act]');
    if (!btn) {
      if (selectedIndex !== i) { selectedIndex = i; renderTopicsSection(); }
      return;
    }
    switch (btn.dataset.act) {
      case 'up': moveDisciplina(i, i - 1); break;
      case 'down': moveDisciplina(i, i + 1); break;
      case 'edit': startInlineEdit(li, state.discipline[i].nome, v => renameDisciplina(i, v)); break;
      case 'del': deleteDisciplina(i); break;
    }
  });

  list.addEventListener('dblclick', e => {
    if (!e.target.closest('.item-text')) return;
    const li = e.target.closest('li');
    const i = Number(li.dataset.index);
    startInlineEdit(li, state.discipline[i].nome, v => renameDisciplina(i, v));
  });

  makeSortable(list, moveDisciplina);
}

// =================== ARGOMENTI E COMPITI ===================

// Elenco mostrato a destra: 'argomenti' (→ "Attività svolta") o 'compiti' (→ "Compiti").
let currentKind = 'argomenti';
const KINDS = {
  argomenti: {
    one: 'argomento', many: 'argomenti', Title: 'Argomenti', dest: 'Attività svolta',
    placeholder: 'Scrivi un argomento… (puoi incollarne più di uno, uno per riga)',
    added1: 'Argomento aggiunto.', deleted: 'Argomento eliminato.', dup: 'Questo argomento è già presente.'
  },
  compiti: {
    one: 'compito', many: 'compiti', Title: 'Compiti', dest: 'Compiti',
    placeholder: 'Scrivi un compito… (es. "Esercizi 1-5 pag. 32"; puoi incollarne più di uno, uno per riga)',
    added1: 'Compito aggiunto.', deleted: 'Compito eliminato.', dup: 'Questo compito è già presente.'
  }
};
const kindInfo = () => KINDS[currentKind];
const vociOf = d => d[currentKind];

function findVoce(d, testo, exceptIndex = -1) {
  const key = testo.toLowerCase();
  return vociOf(d).findIndex((a, i) => i !== exceptIndex && a.toLowerCase() === key);
}

function editVoce(d, j, testo) {
  if (findVoce(d, testo, j) !== -1) {
    showToast(kindInfo().dup);
    renderTopicsSection();
    return;
  }
  vociOf(d)[j] = testo;
  commitDiscipline();
}

function deleteVoce(d, j) {
  const kind = currentKind;
  const [removed] = d[kind].splice(j, 1);
  commitDiscipline();
  showToast(KINDS[kind].deleted, {
    actionLabel: 'Annulla',
    onAction: () => {
      if (!state.discipline.includes(d) || d[kind].some(a => a.toLowerCase() === removed.toLowerCase())) return;
      d[kind].splice(Math.min(j, d[kind].length), 0, removed);
      commitDiscipline();
    }
  });
}

// Una riga = una voce; rimuove eventuali puntini elenco incollati.
function parseArgomentiLines(text) {
  return text
    .split(/\r?\n/)
    .map(line => cleanText(line.replace(/^\s*[-–—•·▪*]\s+/, '')))
    .filter(Boolean);
}

function renderArgomenti() {
  const d = selectedDisciplina();
  const k = kindInfo();
  $('argomenti-body').hidden = !d;
  $('argomenti-nodisc').hidden = Boolean(d);
  $('sort-az').hidden = !d || vociOf(d).length < 2;
  $('argomenti-title').textContent = d ? d.nome : 'Disciplina';
  document.querySelectorAll('.kind-tab').forEach(tab => {
    tab.setAttribute('aria-selected', String(tab.dataset.kind === currentKind));
  });
  $('count-argomenti').textContent = d ? String(d.argomenti.length) : '0';
  $('count-compiti').textContent = d ? String(d.compiti.length) : '0';
  $('kind-hint').textContent = `Nel registro, un clic su ${currentKind === 'argomenti' ? 'un argomento' : 'un compito'} ` +
    `lo inserisce nella casella «${k.dest}».`;
  $('new-argomenti').placeholder = k.placeholder;
  const list = $('argomenti-list');
  list.textContent = '';
  if (!d) return;
  const voci = vociOf(d);
  voci.forEach((a, j) => {
    list.appendChild(makeItem({ index: j, total: voci.length, text: a, numbered: true }));
  });
  $('argomenti-empty').textContent = `Nessun ${k.one} per questa disciplina.`;
  $('argomenti-empty').hidden = voci.length > 0;
}

function bindArgomenti() {
  const list = $('argomenti-list');
  const textarea = $('new-argomenti');

  document.querySelectorAll('.kind-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (currentKind === tab.dataset.kind) return;
      currentKind = tab.dataset.kind;
      renderArgomenti();
      textarea.focus();
    });
  });

  $('add-argomenti-form').addEventListener('submit', e => {
    e.preventDefault();
    const d = selectedDisciplina();
    if (!d) return;
    const k = kindInfo();
    const lines = parseArgomentiLines(textarea.value);
    if (lines.length === 0) return;
    const added = mergeArgomenti(vociOf(d), lines);
    const skipped = lines.length - added;
    textarea.value = '';
    commitDiscipline();
    list.lastElementChild?.scrollIntoView({ block: 'nearest' });
    let msg = added === 1 ? k.added1 : `${added} ${k.many} aggiunti.`;
    if (added === 0) msg = `Nessun ${k.one} aggiunto.`;
    if (skipped > 0) msg += ` ${skipped} già present${skipped === 1 ? 'e' : 'i'}.`;
    showToast(msg);
  });

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('add-argomenti-form').requestSubmit();
    }
  });

  list.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    const d = selectedDisciplina();
    if (!btn || !d) return;
    const li = btn.closest('li');
    const j = Number(li.dataset.index);
    switch (btn.dataset.act) {
      case 'up':
      case 'down':
        if (moveItem(vociOf(d), j, btn.dataset.act === 'up' ? j - 1 : j + 1)) commitDiscipline();
        break;
      case 'edit': startInlineEdit(li, vociOf(d)[j], v => editVoce(d, j, v)); break;
      case 'del': deleteVoce(d, j); break;
    }
  });

  list.addEventListener('dblclick', e => {
    const d = selectedDisciplina();
    if (!d || !e.target.closest('.item-text')) return;
    const li = e.target.closest('li');
    const j = Number(li.dataset.index);
    startInlineEdit(li, vociOf(d)[j], v => editVoce(d, j, v));
  });

  makeSortable(list, (from, to) => {
    const d = selectedDisciplina();
    if (d && moveItem(vociOf(d), from, to)) commitDiscipline();
  });

  $('sort-az').addEventListener('click', () => {
    const d = selectedDisciplina();
    if (!d) return;
    const kind = currentKind;
    const before = d[kind].slice();
    d[kind].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base', numeric: true }));
    commitDiscipline();
    showToast(`${KINDS[kind].Title} ordinati alfabeticamente.`, {
      actionLabel: 'Annulla',
      onAction: () => {
        d[kind].splice(0, d[kind].length, ...before);
        commitDiscipline();
      }
    });
  });
}

function renderTopicsSection() {
  if (selectedIndex >= state.discipline.length) selectedIndex = state.discipline.length - 1;
  if (selectedIndex < 0 && state.discipline.length) selectedIndex = 0;
  renderDiscipline();
  renderArgomenti();
}

// =================== EXPORT / IMPORT ===================

function showBackupMsg(text, kind, details = []) {
  const el = $('backup-msg');
  el.className = 'status-line ' + (kind || '');
  el.textContent = text;
  if (details.length) {
    const ul = document.createElement('ul');
    for (const d of details) {
      const li = document.createElement('li');
      li.textContent = d;
      ul.appendChild(li);
    }
    el.appendChild(ul);
  }
}

// "1 disciplina", "3 discipline", ...
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
const nDiscipline = n => plural(n, 'disciplina', 'discipline');
const nArgomenti = n => plural(n, 'argomento', 'argomenti');
const nCompiti = n => plural(n, 'compito', 'compiti');

// "4 argomenti · 2 compiti"
function describeVoci(d) {
  return `${nArgomenti(d.argomenti.length)} · ${nCompiti(d.compiti.length)}`;
}

function localDateStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function exportSettings() {
  flushPending();
  const data = buildExport(state);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `argo-didup-booster-impostazioni-${localDateStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showBackupMsg(
    `✓ Esportati: ${nDiscipline(state.discipline.length)}, ${nArgomenti(contaVoci(state.discipline, 'argomenti'))}, ` +
    `${nCompiti(contaVoci(state.discipline, 'compiti'))}.`, 'ok'
  );
}

async function importSettings(file) {
  let result;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('il file è troppo grande.');
    result = parseImport(await file.text());
  } catch (err) {
    const reason = err instanceof SyntaxError ? 'non è un file JSON valido.' : err.message;
    showBackupMsg(`Impossibile importare "${file.name}": ${reason}`, 'err');
    return;
  }

  const { settings: imported, warnings, presentKeys } = result;
  const nDisc = imported.discipline.length;
  const nArg = contaVoci(imported.discipline, 'argomenti');
  const nCom = contaVoci(imported.discipline, 'compiti');
  const lines = [`File: ${file.name}`, '', 'Contenuto:'];
  if (presentKeys.includes('codiceScuola')) lines.push(`• codice scuola: ${imported.codiceScuola || '(vuoto)'}`);
  lines.push(`• ${nDiscipline(nDisc)}, ${nArgomenti(nArg)}, ${nCompiti(nCom)}`);
  lines.push('',
    '"Sostituisci tutto" rimpiazza le impostazioni attuali con quelle del file.',
    '"Aggiungi argomenti e compiti" unisce solo discipline, argomenti e compiti a quelli che hai già.');

  const choice = await askChoice(lines.join('\n'), [
    { value: 'cancel', label: 'Annulla' },
    { value: 'merge', label: 'Aggiungi argomenti e compiti' },
    { value: 'replace', label: 'Sostituisci tutto', cls: 'primary' }
  ]);
  if (!choice) return;

  if (choice === 'replace') {
    cancelPending();
    const next = { ...state };
    for (const key of presentKeys) next[key] = imported[key];
    await replaceSettings(next);
    state = await loadSettings();
    selectedIndex = state.discipline.length ? 0 : -1;
    fillForm();
    showBackupMsg(`✓ Impostazioni importate da "${file.name}".`, 'ok', warnings);
  } else {
    let addedDisc = 0;
    const added = { argomenti: 0, compiti: 0 };
    for (const d of imported.discipline) {
      const i = findDisciplina(d.nome);
      if (i === -1) {
        state.discipline.push({ nome: d.nome, argomenti: d.argomenti.slice(), compiti: d.compiti.slice() });
        addedDisc++;
        for (const tipo of TIPI_VOCE) added[tipo] += d[tipo].length;
      } else {
        for (const tipo of TIPI_VOCE) added[tipo] += mergeArgomenti(state.discipline[i][tipo], d[tipo]);
      }
    }
    commitDiscipline();
    showBackupMsg(`✓ Aggiunti: ${plural(addedDisc, 'nuova disciplina', 'nuove discipline')}, ` +
      `${nArgomenti(added.argomenti)}, ${nCompiti(added.compiti)}.`, 'ok', warnings);
  }
}

function bindBackup() {
  $('export-btn').addEventListener('click', exportSettings);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importSettings(file);
  });
}

// =================== AVANZATE ===================

const URL_KEYS = ['argoLoginUrl', 'argoDashboardPattern', 'basePortalUrl'];

function bindAvanzate() {
  for (const key of URL_KEYS) {
    const input = $(key);
    input.addEventListener('change', () => {
      const v = input.value.trim();
      if (!isHttpUrl(v)) {
        input.classList.add('invalid');
        $('url-error').hidden = false;
        $('url-error').textContent = 'Indirizzo non valido: deve iniziare con https://';
        return;
      }
      input.classList.remove('invalid');
      if (!document.querySelector('#sec-avanzate input.invalid')) $('url-error').hidden = true;
      input.value = v;
      save({ [key]: v });
    });
  }
  $('reset-urls').addEventListener('click', () => {
    const partial = {};
    for (const key of URL_KEYS) {
      partial[key] = DEFAULT_SETTINGS[key];
      $(key).value = DEFAULT_SETTINGS[key];
      $(key).classList.remove('invalid');
    }
    $('url-error').hidden = true;
    save(partial);
  });
}

// =================== AVVIO ===================

function fillForm() {
  $('codiceScuola').value = state.codiceScuola;
  setCodeError('');
  $('docenteNome').value = state.docenteNome;
  document.querySelectorAll('input[name="loginMethod"]').forEach(r => {
    r.checked = r.value === state.loginMethod;
  });
  $('spidProvider').value = state.spidProvider;
  updateProviderField();
  $('autoLogin').checked = state.autoLogin;
  $('keepAliveEnabled').checked = state.keepAliveEnabled;
  $('keepAliveInterval').value = state.keepAliveInterval;
  updateIntervalLabel();
  document.querySelectorAll('input[name="keepAliveMethod"]').forEach(r => {
    r.checked = r.value === state.keepAliveMethod;
  });
  updateKeepAliveDisabled();
  for (const key of URL_KEYS) $(key).value = state[key];
  updateMissingCode();
  renderTopicsSection();
}

// =================== INFORMAZIONI ===================
// Versione dal manifest; commit e data da build-info.json (tools/build-info.mjs).

async function renderInfo() {
  const m = chrome.runtime.getManifest();
  $('info-name').textContent = m.name || '—';
  $('info-version').textContent = m.version || '—';
  let info = null;
  try {
    const res = await fetch(chrome.runtime.getURL('build-info.json'), { cache: 'no-store' });
    if (res.ok) info = await res.json();
  } catch (e) { /* file assente */ }
  const commit = $('info-commit');
  const date = $('info-commit-date');
  const hint = $('info-hint');
  commit.classList.toggle('mono', Boolean(info && info.commit));
  if (info && info.commit) {
    commit.textContent = info.commit.slice(0, 7);
    commit.title = info.commit;
    const d = new Date(info.commitDate);
    date.textContent = isNaN(d) ? (info.commitDate || '—')
      : d.toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    hint.hidden = true;
  } else {
    commit.textContent = 'non disponibile';
    date.textContent = 'non disponibile';
    hint.hidden = false;
    hint.textContent = info && info.note
      ? 'La cartella dell\'estensione non è sotto git: commit e data compaiono dopo il primo commit.'
      : 'Manca il file build-info.json: lo crea "node tools/build-info.mjs" (in automatico dopo ogni commit).';
  }
}

(async function init() {
  // File aggiornati sul disco: l'estensione si ricarica e riapre questa pagina.
  if (await reloadIfStale({ action: 'open-options' })) return;
  state = await loadSettings();
  selectedIndex = state.discipline.length ? 0 : -1;

  bindScuola();
  bindAccesso();
  bindSessione();
  bindDiscipline();
  bindArgomenti();
  bindBackup();
  bindAvanzate();
  fillForm();
  renderInfo();

  if (!state.codiceScuola) $('codiceScuola').focus();

  const { keepAliveStatus } = await chrome.storage.local.get('keepAliveStatus');
  renderKeepAliveStatus(keepAliveStatus);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.keepAliveStatus) {
      renderKeepAliveStatus(changes.keepAliveStatus.newValue);
    }
  });
})();
