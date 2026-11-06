// =====================================================================
// argomenti.js — "Argomenti e compiti" dentro il registro DidUP.
// Nella schermata di modifica della lezione (vista Ext JS
// "attivita-dettaglio-view") aggiunge, accanto al titolo
// "Registro di classe · Docenti ed alunni", un pulsante che apre gli
// elenchi della disciplina configurati nelle impostazioni:
//   • Argomenti → un clic li inserisce in "Attività svolta"
//   • Compiti   → un clic li inserisce in "Compiti"
// Le caselle si riconoscono dal campo della lezione a cui DidUP le collega
// (desArgomento / desCompiti…), non dalla posizione: nella sezione ci sono
// anche le schede "Compiti" nascoste.
// Il pulsante sta a destra, sulla riga del titolo della sezione; si può
// togliere dalle impostazioni (Funzioni nel registro). La prima volta una
// guida con lo sfondo scuro spiega a cosa serve.
// =====================================================================

(() => {
  const HOST_ATTR = 'data-argo-assistant-topics';
  // L'ultima istanza iniettata (es. dopo un aggiornamento) sostituisce la precedente.
  const instanceId = Math.random().toString(36).slice(2);
  // (attributo diverso da HOST_ATTR: la pulizia qui sotto non deve toccare <html>)
  document.documentElement.dataset.argoAssistantTopicsInstance = instanceId;
  document.querySelectorAll(`span[${HOST_ATTR}], div[${HOST_ATTR}]`).forEach(el => el.remove());
  const isCurrent = () => document.documentElement.dataset.argoAssistantTopicsInstance === instanceId && extensionAlive();
  const STOPWORDS = new Set(['e', 'ed', 'di', 'del', 'della', 'dei', 'delle', 'degli', 'la', 'il', 'lo', 'le', 'gli', 'i', 'a', 'al', 'alla', 'in', 'per', 'con']);

  let settings = null;
  let picker = null;
  let guideShown = false;
  const KINDS = {
    argomenti: { label: 'Argomenti', one: 'argomento', dest: 'Attività svolta', search: 'Cerca argomento…' },
    compiti: { label: 'Compiti', one: 'compito', dest: 'Compiti', search: 'Cerca compito…' }
  };

  // ------------------------------------------------------------------
  // Individuazione della sezione "Registro di classe · Docenti ed alunni"
  // ------------------------------------------------------------------

  function isClassRegisterTitle(el) {
    const t = foldText(el.textContent || '');
    return t.includes('registro di classe') && t.includes('docenti ed alunni');
  }

  function findTitles() {
    let titles = [...document.querySelectorAll('.x-fieldset-header-text')].filter(isClassRegisterTitle);
    if (titles.length === 0) titles = [...document.querySelectorAll('legend')].filter(isClassRegisterTitle);
    return titles;
  }

  function fieldsetOf(title) {
    return title.closest('fieldset, .x-fieldset');
  }

  // Visibile davvero: Ext nasconde le schede inattive anche spostandole fuori schermo.
  function isShown(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    if (r.right < -1000 || r.bottom < -1000) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }

  let autoId = 0;
  function ensureId(el) {
    if (!el.id) el.id = `argo-assistant-field-${++autoId}`;
    return el.id;
  }

  // Casella "Attività svolta" e casella "Compiti" (quella della scheda aperta).
  async function resolveTargets(fieldset) {
    const out = { argomenti: null, compiti: null };
    if (!fieldset) return out;
    const areas = [...fieldset.querySelectorAll('textarea')];
    areas.forEach(ensureId);
    let fields = [];
    try {
      const r = await callPageBridge('fields', { inputIds: areas.map(a => a.id) }, 3000);
      fields = (r && r.fields) || [];
    } catch (e) { /* ponte non disponibile */ }
    const byPath = re => fields.filter(f => re.test(f.path || ''))
      .map(f => ({ ...f, el: document.getElementById(f.inputId) })).filter(f => f.el);
    if (fields.some(f => f.path)) {
      const arg = byPath(/(^|\.)desArgomento$/);
      const comp = byPath(/(^|\.)desCompiti[23]?$/);
      const pick = list => list.find(f => f.visible === true) || list.find(f => f.visible !== false && isShown(f.el)) || null;
      const a = pick(arg) || arg[0];
      const c = pick(comp) || comp.find(f => /(^|\.)desCompiti$/.test(f.path));
      if (a) out.argomenti = { el: a.el, label: KINDS.argomenti.dest };
      if (c) out.compiti = { el: c.el, label: KINDS.compiti.dest };
      return out;
    }
    // Ripiego senza Ext JS: le caselle visibili nell'ordine della pagina.
    const shown = areas.filter(isShown);
    if (shown[0]) out.argomenti = { el: shown[0], label: KINDS.argomenti.dest };
    if (shown[1]) out.compiti = { el: shown[1], label: KINDS.compiti.dest };
    return out;
  }

  // ------------------------------------------------------------------
  // Abbinamento materia della lezione → disciplina delle impostazioni
  // ------------------------------------------------------------------

  function acronym(text) {
    return foldText(text).split(/[^a-z0-9]+/).filter(w => w && !STOPWORDS.has(w)).map(w => w[0]).join('');
  }

  function matchDisciplina(materia, discipline) {
    const m = foldText(materia).trim();
    if (!m) return -1;
    let idx = discipline.findIndex(d => foldText(d.nome).trim() === m);
    if (idx !== -1) return idx;
    idx = discipline.findIndex(d => {
      const n = foldText(d.nome).trim();
      return n.length >= 3 && (m.includes(n) || n.includes(m));
    });
    if (idx !== -1) return idx;
    const acr = acronym(materia);
    return discipline.findIndex(d => {
      const n = foldText(d.nome).replace(/[^a-z0-9]/g, '');
      return n.length >= 2 && (n === acr || acronym(d.nome) === acr);
    });
  }

  // ------------------------------------------------------------------
  // Pulsante nel titolo della sezione
  // ------------------------------------------------------------------

  // Colore di sfondo dietro il pulsante (copre la linea del bordo del riquadro).
  function backgroundOf(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return '#fff';
  }

  // A destra, centrato sulla riga del titolo (la legenda del riquadro).
  // Il pulsante NON sta dentro il riquadro: in DidUP «.x-fieldset» ha
  // overflow:hidden e la legenda è nella zona del bordo, quindi verrebbe
  // tagliato via. Sta subito dopo il riquadro, nello stesso contenitore, in
  // posizione assoluta: si misura dove finisce a 0,0 e si corregge.
  function positionButton(host) {
    const { title, fieldset } = host.__argo || {};
    if (!fieldset || !fieldset.isConnected) {          // riquadro tolto da Ext: il pulsante non serve più
      if (picker && picker.anchor === host) closePicker();
      host.remove();
      return;
    }
    if (!title || !title.isConnected) return;
    const legend = title.closest('legend, .x-fieldset-header') || title;
    const fr = fieldset.getBoundingClientRect();
    const lr = legend.getBoundingClientRect();
    if (fr.width === 0 && fr.height === 0) { host.style.visibility = 'hidden'; return; }   // scheda nascosta
    host.style.visibility = '';
    host.style.left = '0px';
    host.style.top = '0px';
    const zero = host.getBoundingClientRect();
    const left = fr.right - 14 - zero.width - zero.left;
    const top = lr.top + lr.height / 2 - zero.height / 2 - zero.top;
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(Math.max(0, top))}px`;
    host.style.background = backgroundOf(fieldset);
  }

  function injectButton(title) {
    const fieldset = fieldsetOf(title) || title.parentElement;
    const next = fieldset.nextElementSibling;
    if (next && next.getAttribute(HOST_ATTR) === 'button') {
      next.__argo = { title, fieldset };      // Ext può aver ridisegnato il titolo
      positionButton(next);
      return next;
    }
    const host = document.createElement('span');
    host.setAttribute(HOST_ATTR, 'button');
    host.style.cssText = 'position:absolute;left:0;top:0;z-index:2;display:block;padding:0 6px;line-height:0;margin:0;';
    host.__argo = { title, fieldset };
    const root = host.attachShadow({ mode: 'open' });
    // Stesso stile dei pulsanti «Firma ora» / «Appello» (impostazioni → Pulsanti nel registro).
    root.innerHTML = `
      <style>${boosterPillCss()}</style>
      <style class="theme">:host { ${buttonThemeCss(settings.buttonsTheme)} }</style>
      <button type="button" class="pill" title="Inserisci uno dei tuoi argomenti o compiti (Argo DidUP Booster)" aria-haspopup="dialog" aria-expanded="false">
        ${BOOSTER_ICONS.book}<span>Argomenti e compiti</span>
      </button>`;
    const btn = root.querySelector('button');
    for (const type of ['mousedown', 'pointerdown', 'mouseup', 'keydown']) {
      btn.addEventListener(type, e => e.stopPropagation());
    }
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (picker && picker.anchor === host) closePicker();
      else openPicker(host, btn, fieldsetOf(title));
    });
    // (nessuno stile cambiato sui contenitori di Ext: la posizione si corregge misurando)
    fieldset.after(host);
    positionButton(host);
    return host;
  }

  function removeButtons() {
    closePicker();
    document.querySelectorAll(`span[${HOST_ATTR}="button"]`).forEach(h => h.remove());
  }

  function scan() {
    if (!isCurrent()) { observer.disconnect(); return; }
    if (!settings || !isArgoDashboardUrl(location.href, settings)) return;
    if (!settings.showArgomenti) { removeButtons(); return; }
    for (const title of findTitles()) {
      const host = injectButton(title);
      if (host) maybeShowGuide(host);
    }
    if (picker && !picker.anchor.isConnected) closePicker();
  }

  // ------------------------------------------------------------------
  // Guida della prima volta
  // ------------------------------------------------------------------

  function maybeShowGuide(host) {
    if (guideShown || !settings.guidaArgomenti || assistantGuide.isOpen()) return;
    if (document.visibilityState !== 'visible' || !isShown(host)) return;
    guideShown = true;
    saveSettings({ guidaArgomenti: false }).catch(() => {});
    const button = () => host.shadowRoot && host.shadowRoot.querySelector('button');
    const vuoto = settings.discipline.length === 0;
    // La finestra di modifica può ancora muoversi: si aspetta un attimo.
    setTimeout(() => {
      if (!host.isConnected) { guideShown = false; saveSettings({ guidaArgomenti: true }).catch(() => {}); return; }
      assistantGuide.show([{
        target: button, round: true,
        title: 'Argomenti e compiti',
        text: 'Questo pulsante non è di Argo: l\'ha aggiunto l\'estensione «Argo DidUP Booster».\n' +
          'Apre i tuoi elenchi per la disciplina della lezione: un clic su un argomento lo scrive in «Attività svolta», ' +
          'un clic su un compito lo scrive in «Compiti», come se l\'avessi scritto tu. Poi salvi la lezione come sempre.\n' +
          (vuoto ? 'Non hai ancora preparato nessun elenco: li crei nelle impostazioni dell\'estensione.'
            : 'Gli elenchi si preparano e si modificano nelle impostazioni dell\'estensione.'),
        action: { label: vuoto ? 'Prepara gli elenchi' : 'Apri impostazioni', onClick: openExtensionOptions }
      }]);
    }, 700);
  }

  // ------------------------------------------------------------------
  // Pannello di scelta
  // ------------------------------------------------------------------

  function closePicker() {
    if (!picker) return;
    picker.button.setAttribute('aria-expanded', 'false');
    picker.host.remove();
    window.removeEventListener('resize', picker.reposition);
    window.removeEventListener('scroll', picker.reposition, true);
    document.removeEventListener('pointerdown', picker.onOutside, true);
    picker = null;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  async function openPicker(anchor, button, fieldset) {
    closePicker();
    const host = document.createElement('div');
    host.setAttribute(HOST_ATTR, 'picker');
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .p { width: 380px; max-width: calc(100vw - 16px); display: flex; flex-direction: column;
             background: #fff; color: #1f2937; border: 1px solid #d7dde5; border-radius: 14px;
             box-shadow: 0 18px 50px rgba(15, 23, 42, .22); overflow: hidden;
             font: 13.5px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
        .head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 10px; }
        .head strong { flex: 1; font-size: 14px; }
        .x { border: 0; background: transparent; font-size: 18px; line-height: 1; color: #6b7280; cursor: pointer;
             padding: 2px 6px; border-radius: 6px; }
        .x:hover { background: #f1f5f9; color: #111827; }
        .controls { padding: 0 14px 10px; display: flex; flex-direction: column; gap: 8px; }
        select, input { width: 100%; font: inherit; color: inherit; padding: 7px 10px; border: 1px solid #d1d5db;
                        border-radius: 8px; background: #fff; }
        select:focus, input:focus { outline: none; border-color: #0f6f94; box-shadow: 0 0 0 3px #d7ecf5; }
        .tabs { display: flex; gap: 3px; padding: 3px; border-radius: 10px; background: #eef1f4; }
        .tabs button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
                       font: inherit; font-weight: 600; padding: 6px 8px; border: 0; border-radius: 8px;
                       background: transparent; color: #6b7280; cursor: pointer; }
        .tabs button[aria-selected="true"] { background: #fff; color: #0f6f94; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
        .tabs .n { min-width: 20px; padding: 0 6px; border-radius: 10px; background: #e1e6eb; color: #4b5563;
                   font-size: 11.5px; line-height: 18px; }
        .tabs button[aria-selected="true"] .n { background: #d7ecf5; color: #0f6f94; }
        .dest { font-size: 12px; color: #6b7280; }
        .dest b { color: #374151; }
        ul { list-style: none; margin: 0; padding: 4px 8px 8px; overflow-y: auto; border-top: 1px solid #eef0f3; }
        li button { width: 100%; display: flex; align-items: flex-start; gap: 10px; text-align: left; font: inherit;
                    color: inherit; padding: 8px 8px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
        li button:hover, li button:focus-visible { background: #eef6fa; outline: none; }
        li .t { flex: 1; overflow-wrap: anywhere; }
        li .plus { flex: none; color: #0f6f94; font-weight: 700; }
        li button.done .plus { color: #15803d; }
        .empty { padding: 14px; color: #6b7280; font-style: italic; }
        .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 14px;
                border-top: 1px solid #eef0f3; background: #fafbfc; font-size: 12px; color: #6b7280; min-height: 38px; }
        .status.ok { color: #15803d; font-weight: 600; }
        .status.err { color: #b91c1c; font-weight: 600; }
        .link { border: 0; background: transparent; color: #0f6f94; font: inherit; font-weight: 600; cursor: pointer;
                padding: 0; white-space: nowrap; }
        .link:hover { text-decoration: underline; }
        [hidden] { display: none !important; }
      </style>
      <div class="p" role="dialog" aria-label="Argomenti e compiti">
        <div class="head"><strong>Argomenti e compiti</strong><button class="x" title="Chiudi" aria-label="Chiudi">×</button></div>
        <div class="controls">
          <select class="disc" aria-label="Disciplina"></select>
          <div class="tabs" role="tablist">
            <button type="button" role="tab" data-kind="argomenti">Argomenti <span class="n">0</span></button>
            <button type="button" role="tab" data-kind="compiti">Compiti <span class="n">0</span></button>
          </div>
          <div class="dest"></div>
          <input class="q" type="search" autocomplete="off">
        </div>
        <ul></ul>
        <div class="empty" hidden></div>
        <div class="foot"><span class="status"></span><button class="link manage">Modifica elenchi</button></div>
      </div>`;

    // Dentro la finestra Ext JS, se c'è, così il focus resta nella finestra.
    const container = anchor.closest('.x-window') || document.body;
    container.appendChild(host);

    const $ = sel => root.querySelector(sel);
    const panel = $('.p');
    const select = $('.disc');
    const search = $('.q');
    const list = $('ul');
    const empty = $('.empty');
    const status = $('.status');
    const tabs = [...root.querySelectorAll('.tabs button')];
    const dest = $('.dest');

    // Gli eventi non devono arrivare a Ext JS (es. Esc chiuderebbe la finestra).
    for (const type of ['keydown', 'keyup', 'keypress', 'mousedown', 'pointerdown', 'mouseup', 'click', 'wheel']) {
      panel.addEventListener(type, e => e.stopPropagation());
    }

    const state = { kind: 'argomenti', targets: { argomenti: null, compiti: null } };

    function setStatus(text, kind = '') {
      status.textContent = text;
      status.className = 'status ' + kind;
    }

    const discipline = () => settings.discipline;
    const currentDisc = () => discipline()[Number(select.value)] || null;
    const k = () => KINDS[state.kind];

    function renderTabs() {
      const d = currentDisc();
      tabs.forEach(t => {
        t.setAttribute('aria-selected', String(t.dataset.kind === state.kind));
        t.querySelector('.n').textContent = String(d ? d[t.dataset.kind].length : 0);
      });
      const target = state.targets[state.kind];
      dest.innerHTML = '';
      dest.append(`Clic su ${state.kind === 'argomenti' ? 'un argomento' : 'un compito'}: lo inserisco in `);
      const b = document.createElement('b');
      b.textContent = `«${k().dest}»`;
      dest.append(b, target ? '.' : ' (casella non trovata: verrà copiato negli appunti).');
      search.placeholder = k().search;
      if (!status.classList.contains('ok') && !status.classList.contains('err')) setStatus('');
    }

    function renderList() {
      const d = currentDisc();
      list.textContent = '';
      renderTabs();
      if (!d) {
        list.hidden = true;
        empty.hidden = false;
        empty.textContent = 'Nessuna disciplina configurata: aggiungi discipline, argomenti e compiti nelle impostazioni.';
        return;
      }
      const all = d[state.kind];
      const q = foldText(search.value.trim());
      const items = q ? all.filter(a => foldText(a).includes(q)) : all;
      list.hidden = items.length === 0;
      empty.hidden = items.length > 0;
      empty.textContent = all.length === 0
        ? `Nessun ${k().one} per ${d.nome}: aggiungili nelle impostazioni (Modifica elenchi).`
        : `Nessun ${k().one} trovato.`;
      for (const testo of items) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<span class="t"></span><span class="plus" aria-hidden="true">＋</span>';
        b.querySelector('.t').textContent = testo;
        b.title = `Inserisci in «${k().dest}»`;
        b.addEventListener('click', () => insertTopic(testo, b));
        li.appendChild(b);
        list.appendChild(li);
      }
    }

    // Nel menu solo il nome della disciplina: i conteggi sono nelle schede qui sotto.
    function renderDiscipline(preferred) {
      select.textContent = '';
      discipline().forEach((d, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = d.nome;
        select.appendChild(o);
      });
      select.hidden = discipline().length === 0;
      search.hidden = discipline().length === 0;
      if (preferred !== undefined && preferred !== -1) select.value = String(preferred);
    }

    async function insertTopic(testo, btn) {
      state.targets = await resolveTargets(fieldset);      // la scheda "Compiti" aperta può essere cambiata
      const target = state.targets[state.kind];
      let result = null;
      if (target && target.el.isConnected) {
        try {
          result = await callPageBridge('insert', { inputId: ensureId(target.el), text: testo });
        } catch (e) {
          result = { ok: false, reason: 'bridge' };
        }
      }
      if (result && result.ok) {
        btn.classList.add('done');
        btn.querySelector('.plus').textContent = '✓';
        const count = result.max ? ` · ${result.length}/${result.max} caratteri` : '';
        setStatus(`✓ Inserito in «${target.label}»${count}`, 'ok');
        return;
      }
      const copied = await copyToClipboard(testo);
      const tail = copied ? `${k().one} copiato negli appunti.` : 'copia non riuscita.';
      const reasons = {
        'read-only': `«${k().dest}» non è modificabile adesso: ${tail}`,
        'max-length': `Supereresti il limite di ${result && result.max} caratteri: ${tail}`
      };
      setStatus(reasons[result && result.reason] || `Casella «${k().dest}» non trovata: ${tail}`, 'err');
    }

    picker = {
      host,
      anchor,
      button,
      fieldset,
      refresh: () => { renderDiscipline(Number(select.value)); renderList(); },
      reposition: () => {
        if (!anchor.isConnected) { closePicker(); return; }
        const r = anchor.getBoundingClientRect();
        host.style.left = '0px';
        host.style.top = '0px';
        const origin = host.getBoundingClientRect();     // compensa eventuali contenitori trasformati
        const maxH = Math.min(480, window.innerHeight - 16);
        panel.style.maxHeight = maxH + 'px';
        list.style.maxHeight = Math.max(120, maxH - 190) + 'px';
        const w = panel.offsetWidth;
        const h = panel.offsetHeight;
        // allineato al bordo destro del pulsante (che sta a destra nel riquadro)
        let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
        let top = r.bottom + 6;
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
        host.style.left = (left - origin.left) + 'px';
        host.style.top = (top - origin.top) + 'px';
      },
      onOutside: e => {
        const path = e.composedPath();
        if (!path.includes(host) && !path.includes(anchor)) closePicker();
      }
    };

    $('.x').addEventListener('click', closePicker);
    $('.manage').addEventListener('click', openExtensionOptions);
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); closePicker(); button.focus(); }
    });
    search.addEventListener('input', renderList);
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); list.querySelector('li button')?.click(); }
    });
    select.addEventListener('change', () => {
      const d = currentDisc();
      if (d) chrome.storage.local.set({ ui_lastDisciplina: d.nome }).catch(() => {});
      setStatus('');
      renderList();
    });
    tabs.forEach(t => t.addEventListener('click', () => {
      if (state.kind === t.dataset.kind) return;
      state.kind = t.dataset.kind;
      chrome.storage.local.set({ ui_lastTipo: state.kind }).catch(() => {});
      search.value = '';
      setStatus('');
      renderList();
      search.focus({ preventScroll: true });
    }));

    state.targets = await resolveTargets(fieldset);

    // Disciplina: quella della lezione aperta, altrimenti l'ultima usata.
    let preferred = -1;
    const infoEl = (state.targets.argomenti && state.targets.argomenti.el) || (fieldset && fieldset.querySelector('textarea'));
    if (infoEl) {
      try {
        const info = await callPageBridge('info', { inputId: ensureId(infoEl) }, 3000);
        preferred = matchDisciplina(info.materia || '', discipline());
      } catch (e) { /* ignora */ }
    }
    const { ui_lastDisciplina, ui_lastTipo } = await chrome.storage.local.get(['ui_lastDisciplina', 'ui_lastTipo']);
    if (preferred === -1) preferred = discipline().findIndex(d => d.nome === ui_lastDisciplina);
    if (KINDS[ui_lastTipo]) state.kind = ui_lastTipo;
    if (!picker || picker.host !== host) return;     // chiuso nel frattempo

    renderDiscipline(preferred);
    renderList();
    button.setAttribute('aria-expanded', 'true');
    picker.reposition();
    window.addEventListener('resize', picker.reposition);
    window.addEventListener('scroll', picker.reposition, true);
    document.addEventListener('pointerdown', picker.onOutside, true);
    (search.hidden ? select : search).focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------
  // Avvio
  // ------------------------------------------------------------------

  let scanTimer = null;
  const observer = new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 300);
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !isCurrent()) return;
    if (changes.discipline || changes.argoDashboardPattern || changes.argoLoginUrl || changes.buttonsTheme ||
        changes.showArgomenti || changes.guidaArgomenti) {
      settings = await loadSettings();
      if (changes.guidaArgomenti && changes.guidaArgomenti.newValue === true) guideShown = false;   // riattivata dalle impostazioni
      if (picker) picker.refresh();
      if (changes.buttonsTheme) {
        document.querySelectorAll(`span[${HOST_ATTR}="button"]`).forEach(h => {
          const st = h.shadowRoot && h.shadowRoot.querySelector('style.theme');
          if (st) st.textContent = `:host { ${buttonThemeCss(settings.buttonsTheme)} }`;
        });
      }
      scan();
    }
  });

  loadSettings().then(s => {
    settings = s;
    if (!isArgoPortalUrl(location.href) && !isArgoDashboardUrl(location.href, s)) return;
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Ext ridispone le finestre senza aggiungere nodi (es. ridimensionamento): si riallinea spesso, costa poco.
    const realign = () => document.querySelectorAll(`span[${HOST_ATTR}="button"]`).forEach(positionButton);
    window.addEventListener('resize', realign);
    const realignTimer = setInterval(() => { if (!isCurrent()) clearInterval(realignTimer); else realign(); }, 700);
    scan();
  }).catch(err => console.warn('[Argo DidUP Booster] Argomenti:', err));
})();
