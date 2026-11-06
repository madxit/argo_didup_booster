// =====================================================================
// page-bridge.js — eseguito nel contesto della pagina (world: MAIN).
// È l'unico modo per usare gli oggetti dell'app DidUP (Ext JS):
//   • session   → l'app ha già le credenziali? (nessuna chiamata di rete)
//   • ping      → chiamata API leggera e di sola lettura con le stesse
//                 intestazioni di autenticazione del registro (keep-alive)
//   • info      → materia della lezione aperta
//   • fields    → per ogni casella: a quale campo della lezione è collegata
//                 (desArgomento, desCompiti, desCompiti2…) e se è visibile
//   • insert    → aggiunge testo a una casella del registro passando da
//                 Ext JS, così il valore viene salvato come se l'avessi
//                 scritto tu (stesso separatore "a capo" del pulsante
//                 "Argomenti" di Argo)
//   • dashboardLessons / registroLessons → lezioni di oggi con gli orari,
//                 dai dati già caricati dalla Home / dal registro di classe;
//                 per ogni riga del registro anche il docente e se è tua
//                 (classi articolate e compresenze: più righe per la stessa ora)
//   • goHome    → apre la Home (ripiego se la voce del menu non si trova)
//   • viewVisible → una schermata di DidUP (xtype) è visibile?
// Comunica con i content script tramite CustomEvent con dettaglio JSON.
// =====================================================================

(() => {
  // Canale versionato: dopo un aggiornamento dell'estensione il ponte nuovo
  // si aggiunge a quello vecchio (rimasto nella pagina) senza che entrambi
  // rispondano alle stesse richieste (es. un argomento inserito due volte).
  const CHANNEL = 'v4';
  const FLAG = '__argoAssistantBridge_' + CHANNEL;
  if (window[FLAG]) return;
  window[FLAG] = true;

  const REQ = 'argo-assistant:request:' + CHANNEL;
  const RES = 'argo-assistant:response:' + CHANNEL;
  const KEEPALIVE_ENDPOINT = 'archiviostampe/struttura';   // GET senza parametri, sola lettura

  const ext = () => (window.Ext && window.Ext.getCmp ? window.Ext : null);

  function componentFor(inputId) {
    const E = ext();
    if (!E || !inputId) return null;
    const cmp = E.getCmp(String(inputId).replace(/-inputEl$/, ''));
    return cmp && typeof cmp.setValue === 'function' ? cmp : null;
  }

  // ---- orari: "08:00 - 09:00", "08:00:00", Date ----
  const pad = n => String(n).padStart(2, '0');
  const RANGE_RE = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*[-–—]\s*(\d{1,2})[:.](\d{2})/;

  function hhmm(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : `${pad(v.getHours())}:${pad(v.getMinutes())}`;
    const m = /(?:^|[^\d])(\d{1,2})[:.](\d{2})(?::\d{2})?(?!\d)/.exec(String(v));
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return `${pad(+m[1])}:${m[2]}`;
  }

  // Cerca un orario di inizio/fine in un oggetto lezione (nomi dei campi non noti a priori).
  function extractTime(o, depth = 0) {
    if (!o || typeof o !== 'object') return null;
    // Prima i campi che parlano di orari, mai i testi liberi (argomenti, compiti, note).
    const entries = Object.entries(o).filter(([k, v]) => typeof v === 'string' && !/^des|argoment|compit|note/i.test(k));
    entries.sort(([a], [b]) => Number(!/ora|orari|time/i.test(a)) - Number(!/ora|orari|time/i.test(b)));
    for (const [k, v] of entries) {
      const m = RANGE_RE.exec(v);
      if (m) return { inizio: `${pad(+m[1])}:${m[2]}`, fine: `${pad(+m[3])}:${m[4]}`, campo: k };
    }
    const keys = Object.keys(o);
    const kIni = keys.find(k => /inizio|^ora_?da$|^dalle$|start/i.test(k) && hhmm(o[k]));
    const kFin = keys.find(k => /fine|^ora_?a$|^alle$|end/i.test(k) && hhmm(o[k]));
    if (kIni && kFin) return { inizio: hhmm(o[kIni]), fine: hhmm(o[kFin]), campo: `${kIni}/${kFin}` };
    if (depth < 1) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'materia' || !v || typeof v !== 'object' || v instanceof Date) continue;
        const t = extractTime(v, depth + 1);
        if (t) return { ...t, campo: `${k}.${t.campo}` };
      }
    }
    return null;
  }

  function visibleCmp(xtype) {
    const E = ext();
    if (!E || !E.ComponentQuery) return null;
    const list = E.ComponentQuery.query(xtype).filter(c => !c.destroyed && (!c.isVisible || c.isVisible(true)));
    return list[list.length - 1] || null;
  }

  // "COGNOME NOME" dell'utente collegato (store "userdata" della vista principale).
  function userName() {
    try {
      const W = window.WSX;
      const vm = W.app.getMainView().getViewModel();
      const rec = vm.getStore('userdata').getAt(0);
      return rec ? String(rec.get('descutente') || '') : '';
    } catch (e) {
      return '';
    }
  }

  function appendText(current, text) {
    current = current || '';
    if (!current) return text;
    return current + (current.endsWith('\n') ? '' : '\n') + text;
  }

  const handlers = {
    // Stato dell'app senza chiamate di rete: 'logged' se il registro ha già
    // le intestazioni di autenticazione.
    session() {
      const E = ext();
      if (!E || !E.Ajax || typeof window.getUrlBase !== 'function') return { ok: true, state: 'not-ready' };
      const headers = (E.Ajax.getDefaultHeaders && E.Ajax.getDefaultHeaders()) || {};
      return { ok: true, state: headers.Authorization ? 'logged' : 'not-logged' };
    },

    // Lezioni di oggi come le ha caricate la Home (store "classiDocente").
    dashboardLessons() {
      const view = visibleCmp('dashboard-main-view');
      const vm = view && view.getViewModel && view.getViewModel();
      const store = vm && vm.getStore && vm.getStore('classiDocente');
      if (!store || !store.getRange) return { ok: false, reason: 'no-store' };
      const classi = store.getRange().map(rec => ({
        classe: `${rec.get('desDenominazione') || ''}${rec.get('desSezione') || ''}`,
        lezioni: (rec.get('lezioni') || []).map((l, idx) => ({
          idx,
          numOra: Number(l && l.numOra),
          materia: (l && l.materia && l.materia.desDescrizione) || '',
          firmata: Boolean(l && l.firmata),
          tempo: extractTime(l)
        }))
      }));
      return { ok: true, classi };
    },

    // Righe del registro di classe aperto (store "attivita"), nell'ordine
    // della tabella (= attributo data-recordindex delle righe).
    // `mia`: la riga è del docente collegato (stesso anagrafePK, come fa DidUP
    // per colorare l'icona); null se DidUP non lo dice.
    registroLessons() {
      const view = visibleCmp('attivita-view');
      const vm = view && view.lookupViewModel && view.lookupViewModel();
      const store = vm && vm.getStore && vm.getStore('attivita');
      if (!store || !store.getRange) return { ok: false, reason: 'no-store' };
      const W = window.WSX;
      let myPk = null;
      try { myPk = W && W.util && W.util.getAnagrafePK ? W.util.getAnagrafePK() : null; } catch (e) { myPk = null; }
      return {
        ok: true,
        utente: userName(),
        righe: store.getRange().map((r, index) => ({
          index,
          numOra: Number(r.get('numOra')),
          tempo: extractTime({ oraInizioFine: r.get('oraInizioFine') }) || extractTime(r.getData ? r.getData() : r.data),
          docente: String(r.get('nominativoDocente') || ''),
          libera: Boolean(r.get('libera')),
          mia: myPk == null || r.get('anagrafePK') == null ? null : r.get('anagrafePK') == myPk,
          firmata: r.get('flgPresente') === 'S'
        }))
      };
    },

    // Nome del docente collegato, come lo conosce DidUP.
    utente() {
      return { ok: true, nome: userName() };
    },

    goHome() {
      const W = window.WSX;
      const main = W && W.app && W.app.getMainView && W.app.getMainView();
      const ctrl = main && main.getController && main.getController();
      if (!ctrl || typeof ctrl.clickMenuItem !== 'function' || !W.util || !W.util.IDXMENUDASH) {
        return { ok: false, reason: 'not-available' };
      }
      ctrl.clickMenuItem(W.util.IDXMENUDASH);
      return { ok: true };
    },

    viewVisible({ xtype } = {}) {
      return { ok: true, visible: Boolean(xtype && visibleCmp(String(xtype))) };
    },

    async ping() {
      const E = ext();
      if (!E || !E.Ajax || typeof window.getUrlBase !== 'function') {
        return { ok: false, reason: 'app-not-ready' };
      }
      const headers = Object.assign({}, E.Ajax.getDefaultHeaders && E.Ajax.getDefaultHeaders());
      if (!headers.Authorization) return { ok: false, reason: 'not-logged' };
      headers['Content-Type'] = 'application/json';
      const res = await fetch(window.getUrlBase() + KEEPALIVE_ENDPOINT, {
        method: 'GET',
        headers,
        credentials: 'include',
        cache: 'no-store'
      });
      try { await res.body?.cancel(); } catch (e) { /* ignora */ }
      const expired = [401, 402, 406].includes(res.status);
      return { ok: res.ok, expired, httpStatus: res.status };
    },

    // Le caselle si riconoscono dal campo a cui DidUP le collega, non dalla
    // posizione: nella sezione ci sono anche le schede "Compiti" nascoste.
    fields({ inputIds = [] } = {}) {
      return {
        ok: true,
        fields: inputIds.map(inputId => {
          const cmp = componentFor(inputId);
          if (!cmp) return { inputId, path: '', visible: null };
          let path = '';
          try {
            const b = cmp.getBind && cmp.getBind();
            const v = b && b.value;
            path = (v && v.stub && v.stub.path) || '';
          } catch (e) { /* ignora */ }
          if (!path) {
            const bind = cmp.initialConfig && cmp.initialConfig.bind;
            const raw = bind && (typeof bind === 'string' ? bind : bind.value);
            path = raw ? String(raw).replace(/[{}\s]/g, '') : '';
          }
          return {
            inputId,
            path,
            visible: typeof cmp.isVisible === 'function' ? cmp.isVisible(true) : null,
            readOnly: Boolean(cmp.readOnly || cmp.disabled)
          };
        })
      };
    },

    info({ inputId } = {}) {
      const cmp = componentFor(inputId);
      let materia = '';
      try {
        const vm = cmp && cmp.lookupViewModel && cmp.lookupViewModel();
        const att = vm && vm.get('theAttivita');
        materia = (att && att.get && att.get('materia')) || '';
      } catch (e) { /* ignora */ }
      return {
        ok: true,
        materia,
        readOnly: cmp ? Boolean(cmp.readOnly || cmp.disabled) : null,
        maxLength: cmp && cmp.enforceMaxLength && Number.isFinite(cmp.maxLength) ? cmp.maxLength : null
      };
    },

    insert({ inputId, text } = {}) {
      const el = document.getElementById(inputId);
      if (!el || !text) return { ok: false, reason: 'not-found' };
      const cmp = componentFor(inputId);

      if (cmp) {
        if (cmp.readOnly || cmp.disabled) return { ok: false, reason: 'read-only' };
        const next = appendText(cmp.getValue(), text);
        const max = cmp.enforceMaxLength && Number.isFinite(cmp.maxLength) ? cmp.maxLength : null;
        if (max && next.length > max) return { ok: false, reason: 'max-length', max, length: next.length };
        cmp.setValue(next);
        try {
          el.focus();
          el.setSelectionRange(next.length, next.length);
          el.scrollTop = el.scrollHeight;
        } catch (e) { /* ignora */ }
        return { ok: true, via: 'ext', length: next.length, max };
      }

      // Ripiego senza Ext JS: valore nativo + eventi.
      if (el.readOnly || el.disabled) return { ok: false, reason: 'read-only' };
      const next = appendText(el.value, text);
      const max = el.maxLength > 0 ? el.maxLength : null;
      if (max && next.length > max) return { ok: false, reason: 'max-length', max, length: next.length };
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
      setter.call(el, next);
      for (const type of ['input', 'change', 'keyup']) el.dispatchEvent(new Event(type, { bubbles: true }));
      el.focus();
      return { ok: true, via: 'dom', length: next.length, max };
    }
  };

  document.addEventListener(REQ, async e => {
    let req;
    try { req = JSON.parse(e.detail); } catch (err) { return; }
    if (!req || !req.id || !handlers[req.action]) return;
    let result;
    try {
      result = await handlers[req.action](req.payload || {});
    } catch (err) {
      result = { ok: false, reason: 'error', error: String((err && err.message) || err) };
    }
    document.dispatchEvent(new CustomEvent(RES, { detail: JSON.stringify({ id: req.id, result }) }));
  });
})();
