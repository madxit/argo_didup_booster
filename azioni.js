// =====================================================================
// azioni.js — "Firma ora" e "Appello" (content script sulle pagine del
// registro DidUP). Il popup si collega con una porta "argo-azione" e
// riceve passo per passo cosa è stato cliccato e cosa (non) è stato trovato.
//
// Per entrambe le azioni:
//   1. clic su "Home" nel menu a sinistra (da qualsiasi schermata)
//   2. lettura delle lezioni di oggi dalla Home ("Le mie classi")
//   3. orari delle lezioni letti dalla pagina: dai dati della Home o, se lì
//      non ci sono, dalla tabella del registro di classe ("08:00 - 09:00")
//   4. scelta della lezione in base all'ora attuale:
//        Firma   → in corso, altrimenti la prossima più vicina, altrimenti
//                  l'ultima passata non firmata
//        Appello → in corso, altrimenti quella che inizia entro 15 minuti,
//                  altrimenti quella appena finita, altrimenti la prossima
//   5. Firma: clic sulle icone arancioni "da firmare" (mai su quelle già
//      firmate: in DidUP il clic toglierebbe la firma). Se la fascia oraria
//      di un'ora da firmare non contiene l'ora attuale (o non è nota),
//      prima chiede il permesso: nel popup o, se è chiuso, nella pagina.
//      Appello: clic sul pulsante "Appello" del registro di classe
// =====================================================================

var ArgoAzioni = (() => {
  const WAIT_VIEW_MS = 15000;
  const WAIT_FIRMA_MS = 12000;
  const ASK_TIMEOUT_MS = 2 * 60 * 1000;
  const APPELLO_SOON_MIN = 15;
  const RANGE_RE = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*[-–—]\s*(\d{1,2})[:.](\d{2})/;

  // ------------------------------------------------------------------
  // Utilità
  // ------------------------------------------------------------------

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const txt = el => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const ord = n => `${n}ª`;
  const pad = n => String(n).padStart(2, '0');
  const fmtMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const normClasse = s => String(s || '').replace(/^classe\s*/i, '').replace(/\s+/g, '').toUpperCase();

  function parseRange(text) {
    const m = RANGE_RE.exec(String(text || ''));
    if (!m) return null;
    const inizio = +m[1] * 60 + +m[2];
    const fine = +m[3] * 60 + +m[4];
    if (+m[1] > 23 || +m[3] > 23 || +m[2] > 59 || +m[4] > 59 || fine <= inizio) return null;
    return { inizio, fine };
  }

  function minutesOf(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? +m[1] * 60 + +m[2] : null;
  }

  function isShown(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (rect.right < -1000 || rect.bottom < -1000) return false;      // nascosto "fuori schermo" da Ext
    return getComputedStyle(el).visibility !== 'hidden';
  }

  // Clic "da utente": Ext JS ascolta sia gli eventi pointer/mouse sia il click.
  function clickLikeUser(el) {
    const rect = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, composed: true, view: window, button: 0,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    if (typeof PointerEvent === 'function') el.dispatchEvent(new PointerEvent('pointerdown', pointer));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    if (typeof PointerEvent === 'function') el.dispatchEvent(new PointerEvent('pointerup', pointer));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  async function waitFor(check, timeoutMs, intervalMs = 150) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      let value = null;
      try { value = check(); } catch (e) { value = null; }
      if (value) return value;
      if (Date.now() >= until) return null;
      await sleep(intervalMs);
    }
  }

  const loadingMaskShown = () => [...document.querySelectorAll('.x-mask')].some(isShown);

  // Finestra di messaggio di DidUP (Ext.Msg / ArgoMsg) eventualmente aperta.
  function messageBoxText() {
    const box = [...document.querySelectorAll('.x-message-box, .x-window')].find(w =>
      isShown(w) && (w.classList.contains('x-message-box') || /x-message-box|messagebox/i.test(w.id || '')));
    return box ? txt(box.querySelector('.x-window-text, .x-form-display-field, .x-window-body') || box).slice(0, 200) : '';
  }

  // Domanda nella pagina (popup chiuso): avviso con due pulsanti.
  function askInPage(question, { title = 'Firma ora', confirmLabel = 'Sì', cancelLabel = 'No' } = {}) {
    return new Promise(resolve => {
      if (typeof assistantToast === 'undefined') { resolve(false); return; }
      let done = false;
      const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => { assistantToast.hide(); finish(false); }, ASK_TIMEOUT_MS);
      assistantToast.show(title, question, {
        actions: [{ label: confirmLabel, onClick: () => finish(true) }, { label: cancelLabel, ghost: true, onClick: () => finish(false) }],
        onDismiss: () => finish(false)
      });
    });
  }

  class AzioneError extends Error {}
  const fail = msg => { throw new AzioneError(msg); };

  function bridge(action, payload = {}, timeoutMs = 4000) {
    if (typeof callPageBridge !== 'function') return Promise.resolve({ ok: false, reason: 'no-bridge' });
    return callPageBridge(action, payload, timeoutMs).catch(() => ({ ok: false, reason: 'no-bridge' }));
  }

  // ------------------------------------------------------------------
  // Menu "Home"
  // ------------------------------------------------------------------

  function findHomeMenuItem() {
    const items = [...document.querySelectorAll('.x-treelist-item')].filter(li => {
      const row = li.querySelector('.x-treelist-row');
      if (!row || row.closest('.x-treelist-item') !== li) return false;
      const text = row.querySelector('.x-treelist-item-text');
      const icon = row.querySelector('.x-treelist-item-icon');
      return (text && /^home$/i.test(txt(text))) || (icon && icon.classList.contains('menuicon-menu-home')) ||
        /^dashboard-main-view$/i.test(li.getAttribute('data-recordid') || '');
    });
    const li = items.find(isShown) || items[0];
    if (!li) return null;
    const row = li.querySelector('.x-treelist-row');
    return row.querySelector('.x-treelist-item-text') || row;
  }

  // Schermata di modifica di una lezione aperta (testo non ancora salvato?)
  function editingLesson() {
    return [...document.querySelectorAll('.x-fieldset-header-text, legend')].some(h => {
      const t = txt(h).toLowerCase();
      return t.includes('registro di classe') && t.includes('docenti ed alunni') && isShown(h);
    });
  }

  // ------------------------------------------------------------------
  // Home: lezioni di oggi
  // ------------------------------------------------------------------

  function classCards() {
    return [...document.querySelectorAll('.dashboard-card')].filter(card =>
      isShown(card) && [...card.querySelectorAll('span')].some(s => /^classe\s/i.test(txt(s))));
  }

  function cardClassName(card) {
    const title = [...card.querySelectorAll('span.fontWeight-bold, span.argo-blue-color, span')]
      .map(txt).find(t => /^classe\s/i.test(t));
    return title ? title.replace(/^classe\s*/i, '').trim() : '';
  }

  function readDashboardLessons(cards) {
    const lezioni = [];
    cards.forEach(card => {
      const classe = cardClassName(card);
      const groups = new Map();
      for (const el of card.querySelectorAll('span[id^="ora_"]')) {
        if (!/^ora_\d+_\d+$/.test(el.id)) continue;
        if (!groups.has(el.id)) groups.set(el.id, []);
        groups.get(el.id).push(el);
      }
      for (const [id, els] of groups) {
        const [, numOra, idx] = id.split('_').map(Number);
        const icon = els.find(e => e.classList.contains('icon'));
        const titled = els.find(e => /vai al registro di classe ora/i.test(e.getAttribute('title') || ''));
        const tm = titled && /ora\s+\d+\s*[-–]\s*(.+)$/i.exec(titled.getAttribute('title'));
        const materia = (tm && tm[1].trim()) || txt(els.find(e => txt(e))) || '';
        const stato = !icon ? 'sconosciuto'
          : icon.classList.contains('icon-ora-da-firmare') ? 'da-firmare'
            : icon.classList.contains('icon-ora-firmata') ? 'firmata' : 'altro';
        lezioni.push({ classe, numOra, idx, id, materia, stato, inizio: null, fine: null, origineOrario: '' });
      }
    });
    return lezioni.sort((a, b) => a.numOra - b.numOra || a.classe.localeCompare(b.classe));
  }

  function findLessonElement(lezione) {
    const card = classCards().find(c => normClasse(cardClassName(c)) === normClasse(lezione.classe));
    if (!card) return null;
    const els = [...card.querySelectorAll('span[id^="ora_"]')].filter(e => e.id === lezione.id);
    return els.find(e => txt(e) && isShown(e)) || els.find(e => /vai al registro/i.test(e.title || '')) || els[0] || null;
  }

  const describe = l => `${ord(l.numOra)} ora · ${l.classe}${l.materia ? ' · ' + l.materia : ''}` +
    (l.inizio != null ? ` (${fmtMin(l.inizio)}–${fmtMin(l.fine)})` : '');

  // ------------------------------------------------------------------
  // Registro di classe
  // ------------------------------------------------------------------

  // Icone di firma nelle righe della tabella delle ore del registro di classe
  // (non quella nell'intestazione del registro, né quelle della Home).
  const rowOf = icon => icon.closest('.x-grid-item, .x-grid-row');

  function gridIcons() {
    return [...document.querySelectorAll('.icon[data-iconora]')].filter(i => rowOf(i) && isShown(i));
  }

  function readRegistroRows() {
    return gridIcons().map(icon => {
      const cell = icon.closest('td, .x-grid-cell') || icon.parentElement;
      const row = rowOf(icon);
      const stato = icon.classList.contains('icon-ora-da-firmare') ? 'da-firmare'
        : icon.classList.contains('icon-ora-firmata') ? 'firmata' : 'altro';
      return { numOra: Number(icon.getAttribute('data-iconora')), stato, tempo: parseRange(txt(cell)), icon, row };
    }).filter(r => r.numOra > 0);
  }

  function appelloButton() {
    return [...document.querySelectorAll('.menu-registro-appello')].find(isShown) || null;
  }

  const isDisabled = el => el.classList.contains('x-btn-disabled') || el.classList.contains('x-item-disabled') ||
    el.getAttribute('aria-disabled') === 'true' || el.disabled === true;

  // ------------------------------------------------------------------
  // Scelta della lezione (funzione pura, testabile)
  // ------------------------------------------------------------------

  function scegliLezione(mode, lezioni, now) {
    const pool = mode === 'firma'
      ? lezioni.filter(l => l.stato === 'da-firmare')
      : lezioni.filter(l => l.stato !== 'altro');
    if (pool.length === 0) {
      if (mode !== 'firma' || !lezioni.length) return { lezione: null, motivo: 'nessuna' };
      return { lezione: null, motivo: lezioni.every(l => l.stato === 'firmata') ? 'tutte-firmate' : 'icone-sconosciute' };
    }
    const conOrario = l => l.inizio != null && l.fine != null;
    if (!pool.every(conOrario)) {
      // Nessun orario disponibile: si usa il numero dell'ora.
      const asc = [...pool].sort((a, b) => a.numOra - b.numOra);
      if (mode === 'firma') return { lezione: asc[0], motivo: 'senza-orari' };
      const firmate = asc.filter(l => l.stato === 'firmata');
      return { lezione: firmate.length ? firmate[firmate.length - 1] : asc[0], motivo: 'senza-orari' };
    }
    const inCorso = pool.find(l => l.inizio <= now && now < l.fine);
    if (inCorso) return { lezione: inCorso, motivo: 'in-corso' };
    const prossime = pool.filter(l => l.inizio > now).sort((a, b) => a.inizio - b.inizio);
    const passate = pool.filter(l => l.fine <= now).sort((a, b) => b.fine - a.fine);

    if (mode === 'firma') {
      const firmataInCorso = lezioni.find(l => l.stato === 'firmata' && conOrario(l) && l.inizio <= now && now < l.fine);
      if (firmataInCorso) {
        return { lezione: null, motivo: 'in-corso-gia-firmata', inCorso: firmataInCorso, prossima: prossime[0] || null };
      }
      if (prossime.length) return { lezione: prossime[0], motivo: 'prossima' };
      return { lezione: passate[0], motivo: 'passata' };
    }
    if (prossime.length && prossime[0].inizio - now <= APPELLO_SOON_MIN) return { lezione: prossime[0], motivo: 'prossima' };
    if (passate.length) return { lezione: passate[0], motivo: 'appena-finita' };
    return { lezione: prossime[0], motivo: 'prossima' };
  }

  const MOTIVI = {
    'in-corso': 'lezione in corso',
    'prossima': 'nessuna lezione in corso: la prossima più vicina',
    'passata': 'nessuna lezione in corso o in arrivo: l\'ultima non ancora firmata',
    'appena-finita': 'nessuna lezione in corso: quella appena finita',
    'senza-orari': 'orari non disponibili nella pagina: scelta in base al numero dell\'ora'
  };

  // ------------------------------------------------------------------
  // Esecuzione
  // ------------------------------------------------------------------

  async function esegui(action, onStep = () => {}, { now = new Date(), ask = askInPage } = {}) {
    const nome = action === 'appello' ? 'Appello' : 'Firma ora';
    const steps = [];
    const step = (text, kind = 'ok') => {
      steps.push({ text, kind });
      try { onStep({ text, kind }); } catch (e) { /* popup chiuso */ }
    };
    const nowMin = now.getHours() * 60 + now.getMinutes();

    async function goHome() {
      if (editingLesson()) {
        fail('Stai modificando una lezione: salva o chiudi la modifica e riprova. ' +
          '(Non clicco «Home» per non farti perdere il testo.)');
      }
      const before = new Set(document.querySelectorAll('.dashboard-card'));
      const newHome = () => {
        const c = classCards();
        return c.length && c.every(x => !before.has(x)) && !loadingMaskShown() ? c : null;
      };
      const home = findHomeMenuItem();
      let cards = null;
      if (home) {
        clickLikeUser(home);
        step('Cliccato «Home» nel menu a sinistra');
        cards = await waitFor(newHome, WAIT_VIEW_MS / 2);
      }
      if (!cards) {
        const r = await bridge('goHome');
        if (!r.ok && !home) {
          fail('Non trovo la voce «Home» nel menu a sinistra ' +
            '(ho cercato una voce del menu con il testo «Home» o l\'icona della casa).');
        }
        if (r.ok) {
          step(home ? 'La Home non si è aperta col clic: riaperta con il comando interno di DidUP'
            : 'Voce «Home» non trovata nel menu: Home aperta con il comando interno di DidUP', 'warn');
        }
        cards = await waitFor(newHome, WAIT_VIEW_MS / 2);
      }
      if (!cards) {
        // Il clic può non ricreare la Home se era già aperta: vanno bene le schede presenti.
        const c = classCards();
        if (c.length && !loadingMaskShown()) cards = c;
      }
      if (!cards) {
        fail(`Ho cliccato «Home», ma dopo ${WAIT_VIEW_MS / 1000} secondi non vedo le schede delle classi ` +
          '(sezione «Le mie classi» della Home).');
      }
      // Le lezioni vengono aggiunte alle schede dopo il caricamento dei dati.
      let count = -1;
      await waitFor(() => {
        const n = document.querySelectorAll('.dashboard-card span[id^="ora_"]').length;
        const stable = n === count;
        count = n;
        return stable;
      }, 2500, 300);
      return cards;
    }

    async function leggiLezioni() {
      const cards = await goHome();
      const lezioni = readDashboardLessons(cards);
      if (lezioni.length === 0) {
        fail(`Nella Home non ci sono lezioni per oggi: ho trovato ${cards.length} ` +
          `${cards.length === 1 ? 'classe' : 'classi'} ma nessuna ora (cercavo le voci «vai al registro di classe ora …»).`);
      }
      // Orari dai dati che la Home ha caricato (se il server li fornisce).
      const dati = await bridge('dashboardLessons');
      if (dati.ok && Array.isArray(dati.classi)) {
        for (const l of lezioni) {
          const c = dati.classi.find(x => normClasse(x.classe) === normClasse(l.classe));
          const d = c && c.lezioni.find(x => x.idx === l.idx && x.numOra === l.numOra);
          const ini = d && d.tempo && minutesOf(d.tempo.inizio);
          const fin = d && d.tempo && minutesOf(d.tempo.fine);
          if (ini != null && fin != null && fin > ini) Object.assign(l, { inizio: ini, fine: fin, origineOrario: 'Home' });
        }
      }
      const elenco = lezioni.map(l => `${l.classe} ${ord(l.numOra)}${l.stato === 'firmata' ? ' ✓' : ''}`).join(', ');
      step(`Lezioni di oggi nella Home: ${elenco}` + (lezioni.some(l => l.inizio != null) ? '' : ' (senza orari)'));
      return lezioni;
    }

    // Completa gli orari mancanti con quelli delle stesse ore (stesso numero).
    function completaOrari(lezioni, mappa, fonte) {
      for (const l of lezioni) {
        if (l.inizio != null) continue;
        const t = mappa.get(l.numOra);
        if (t) Object.assign(l, { inizio: t.inizio, fine: t.fine, origineOrario: fonte });
      }
    }

    async function entraNelRegistro(lezione) {
      const el = findLessonElement(lezione);
      if (!el) fail(`Nella Home non trovo più la ${ord(lezione.numOra)} ora della classe ${lezione.classe}.`);
      const before = new Set(document.querySelectorAll('.x-grid-item, .x-grid-row'));
      const t0 = Date.now();
      clickLikeUser(el);
      step(`Cliccato «${ord(lezione.numOra)} ora - ${lezione.materia || '…'}» della classe ${lezione.classe} nella Home`);
      const ok = await waitFor(() => {
        if (loadingMaskShown()) return false;
        const icons = gridIcons();
        if (icons.length && icons.every(i => !before.has(rowOf(i)))) return true;
        // registro aperto ma senza righe con icone di firma
        return Date.now() - t0 > 5000 && !icons.length && Boolean(appelloButton());
      }, WAIT_VIEW_MS);
      if (!ok) {
        const msg = messageBoxText();
        fail(`Ho cliccato la ${ord(lezione.numOra)} ora di ${lezione.classe} nella Home, ma il registro di classe ` +
          `non si è aperto entro ${WAIT_VIEW_MS / 1000} secondi` + (msg ? `. DidUP dice: «${msg}»` : '.'));
      }
      await sleep(300);
      step(`Aperto il registro di classe ${lezione.classe}`);
      return readRegistroRows();
    }

    // Orari dalla tabella del registro (o, in mancanza, dai dati del registro).
    async function orariDalRegistro(righe) {
      const mappa = new Map();
      for (const r of righe) if (r.tempo) mappa.set(r.numOra, r.tempo);
      if (mappa.size === 0) {
        const dati = await bridge('registroLessons');
        if (dati.ok) {
          for (const r of dati.righe || []) {
            const ini = r.tempo && minutesOf(r.tempo.inizio);
            const fin = r.tempo && minutesOf(r.tempo.fine);
            if (ini != null && fin != null && fin > ini) mappa.set(r.numOra, { inizio: ini, fine: fin });
          }
        }
      }
      return mappa;
    }

    async function firma(lezione, righe) {
      const target = righe.find(r => r.numOra === lezione.numOra && (r.stato === 'da-firmare' || r.stato === 'firmata'));
      if (!target) {
        fail(`Nel registro di ${lezione.classe} non trovo la ${ord(lezione.numOra)} ora tra le tue lezioni ` +
          `(cercavo l'icona di firma arancione con il numero ${lezione.numOra} nella tabella delle ore).`);
      }
      if (target.stato === 'firmata') {
        return { ok: true, summary: `La ${describe(lezione)} è già firmata: non ho cliccato nulla.` };
      }
      // Blocco di ore consecutive tue e da firmare nella stessa classe (come prima).
      const mie = new Map(righe.filter(r => r.stato === 'da-firmare').map(r => [r.numOra, r]));
      let da = lezione.numOra, a = lezione.numOra;
      while (mie.has(da - 1)) da--;
      while (mie.has(a + 1)) a++;
      const blocco = [];
      for (let n = da; n <= a; n++) blocco.push(n);

      // Fascia oraria di ogni ora: dalla tabella di questa classe o dalla lezione scelta.
      const fascia = n => {
        const r = righe.find(x => x.numOra === n && x.tempo);
        if (r) return r.tempo;
        return n === lezione.numOra && lezione.inizio != null ? { inizio: lezione.inizio, fine: lezione.fine } : null;
      };
      const inCorso = n => { const f = fascia(n); return Boolean(f && f.inizio <= nowMin && nowMin < f.fine); };
      const fmtOra = n => { const f = fascia(n); return f ? `${ord(n)} ora (${fmtMin(f.inizio)}–${fmtMin(f.fine)})` : `${ord(n)} ora (orario non indicato)`; };
      const elencoOre = list => list.length > 1 ? list.slice(0, -1).map(fmtOra).join(', ') + ' e ' + fmtOra(list[list.length - 1]) : fmtOra(list[0]);
      const subito = blocco.filter(inCorso);
      const fuori = blocco.filter(n => !inCorso(n));
      let daFirmare = blocco;

      if (fuori.length) {
        const ignoto = fuori.some(n => !fascia(n));
        const domanda = subito.length
          ? `La ${elencoOre(subito)} è in corso e la firmo. Nella ${lezione.classe} ci sono anche ` +
            `${fuori.length > 1 ? 'le ore consecutive' : 'l\'ora consecutiva'} ${elencoOre(fuori)}, da firmare ma non in corso ` +
            `(adesso sono le ${fmtMin(nowMin)}). Firmo anche ${fuori.length > 1 ? 'quelle' : 'quella'}?`
          : `${fuori.length > 1 ? 'Le ore' : 'La'} ${elencoOre(fuori)} · ${lezione.classe}${lezione.materia ? ' · ' + lezione.materia : ''} ` +
            (ignoto ? 'non ha un orario indicato nella pagina, quindi non so se è in corso. '
              : `non ${fuori.length > 1 ? 'sono' : 'è'} in corso: adesso sono le ${fmtMin(nowMin)}. `) +
            `Vuoi ${fuori.length > 1 ? 'firmarle' : 'firmarla'} lo stesso?`;
        const confirmLabel = subito.length ? `Firma anche ${fuori.length > 1 ? 'quelle' : 'quella'}` : 'Firma lo stesso';
        const cancelLabel = subito.length ? `Solo la ${subito.map(ord).join(' e la ')} ora` : 'Non firmare';
        step(`Chiesto il permesso: ${fuori.length > 1 ? 'le ore' : 'la'} ${fuori.map(ord).join(', ')} ` +
          `${fuori.length > 1 ? 'non sono' : 'non è'} in corso${ignoto ? ' (orario non indicato)' : ` (adesso sono le ${fmtMin(nowMin)})`}`, 'ask');
        const si = await ask(domanda, { title: 'Firma ora', confirmLabel, cancelLabel });
        step(`Risposta: «${si ? confirmLabel : cancelLabel}»`);
        if (!si) {
          if (!subito.length) {
            return { ok: true, cancelled: true, summary: `Non ho firmato nulla: la ${describe(lezione)} non era in corso e hai scelto di non firmarla.` };
          }
          daFirmare = subito;
        }
      }

      const firmate = [];
      for (const n of daFirmare) {
        const icon = gridIcons().find(i => Number(i.getAttribute('data-iconora')) === n);
        if (!icon) fail(`Non trovo più l'icona di firma della ${ord(n)} ora nel registro di ${lezione.classe}.`);
        if (icon.classList.contains('icon-ora-firmata')) { firmate.push(n); continue; }
        if (!icon.classList.contains('icon-ora-da-firmare')) {
          fail(`L'icona della ${ord(n)} ora non è un'icona «da firmare»: non la clicco.`);
        }
        clickLikeUser(icon);
        step(`Cliccata l'icona arancione «da firmare» della ${ord(n)} ora`);
        const ok = await waitFor(() => {
          const msg = messageBoxText();
          if (msg) return { msg };
          const i = gridIcons().find(x => Number(x.getAttribute('data-iconora')) === n);
          return i && i.classList.contains('icon-ora-firmata') && !loadingMaskShown() ? { ok: true } : null;
        }, WAIT_FIRMA_MS);
        if (!ok || ok.msg) {
          fail(`Ho cliccato l'icona di firma della ${ord(n)} ora, ma ` +
            (ok && ok.msg ? `DidUP ha risposto: «${ok.msg}».` : `dopo ${WAIT_FIRMA_MS / 1000} secondi risulta ancora da firmare.`));
        }
        firmate.push(n);
        step(`${ord(n)} ora firmata`);
      }
      const ore = firmate.map(ord);
      const f1 = firmate.length === 1 ? fascia(firmate[0]) : null;
      const quando = f1 ? ` (${fmtMin(f1.inizio)}–${fmtMin(f1.fine)})` : '';
      return {
        ok: true,
        summary: (ore.length > 1 ? `Firmate la ${ore.slice(0, -1).join(', la ')} e la ${ore[ore.length - 1]} ora`
          : `Firmata la ${ore[0]} ora`) + ` · ${lezione.classe}${lezione.materia ? ' · ' + lezione.materia : ''}${ore.length > 1 ? '' : quando}`
      };
    }

    async function appello(lezione) {
      let btn = await waitFor(appelloButton, 5000);
      if (!btn) {
        fail(`Nel registro di ${lezione.classe} non trovo il pulsante «Appello» ` +
          '(cercavo il pulsante «Appello» nella barra in alto del registro di classe).');
      }
      // DidUP abilita il pulsante dopo aver selezionato la riga dell'ora.
      btn = (await waitFor(() => { const b = appelloButton(); return b && !isDisabled(b) ? b : null; }, 3000)) || appelloButton();
      if (isDisabled(btn)) {
        fail(`Il pulsante «Appello» è disattivato per la ${ord(lezione.numOra)} ora di ${lezione.classe}: ` +
          'DidUP lo attiva quando l\'ora è firmata da te. Firma prima con «Firma ora», poi riprova.');
      }
      clickLikeUser(btn);
      step('Cliccato «Appello» nel registro di classe');
      // La schermata dell'appello è la vista "appello-classe-view" di DidUP.
      const until = Date.now() + WAIT_VIEW_MS;
      let aperto = false, msg = '';
      while (!aperto && Date.now() < until) {
        await sleep(300);
        if (loadingMaskShown()) continue;
        msg = messageBoxText();
        if (msg) break;
        aperto = [...document.querySelectorAll('[id^="appello-classe-view"]')].some(isShown);
        if (!aperto) {
          const vis = await bridge('viewVisible', { xtype: 'appello-classe-view' }, 1500);
          aperto = Boolean(vis.ok && vis.visible);
        }
      }
      if (!aperto) {
        fail(`Ho cliccato «Appello», ma la schermata dell'appello non si è aperta` +
          (msg ? `. DidUP dice: «${msg}»` : ` entro ${WAIT_VIEW_MS / 1000} secondi.`));
      }
      return { ok: true, summary: `Appello aperto · ${describe(lezione)}` };
    }

    try {
      const sess = await bridge('session');
      if (sess.ok && sess.state && sess.state !== 'logged') {
        fail('Il registro non è pronto: accesso non completato o pagina ancora in caricamento.');
      }

      let lezioni = await leggiLezioni();
      let righeAperte = null, classeAperta = null, oraAperta = null;
      const iniziale = scegliLezione(action, lezioni, nowMin);

      // Orari non presenti nella Home: si leggono dal registro di una classe.
      if (iniziale.lezione && !lezioni.some(l => l.inizio != null)) {
        const prova = iniziale.lezione;
        righeAperte = await entraNelRegistro(prova);
        classeAperta = prova.classe;
        oraAperta = prova.numOra;
        const mappa = await orariDalRegistro(righeAperte);
        if (mappa.size) {
          completaOrari(lezioni, mappa, `registro ${prova.classe}`);
          const elenco = [...mappa.entries()].sort((x, y) => x[0] - y[0])
            .map(([n, t]) => `${ord(n)} ${fmtMin(t.inizio)}–${fmtMin(t.fine)}`).join(', ');
          step(`Orari letti dal registro di ${prova.classe}: ${elenco}`);
        } else {
          step('Né la Home né il registro mostrano gli orari delle ore', 'warn');
        }
      }

      const scelta = scegliLezione(action, lezioni, nowMin);
      if (!scelta.lezione) {
        if (scelta.motivo === 'tutte-firmate') {
          return { ok: true, steps, summary: 'Tutte le tue lezioni di oggi risultano già firmate: non ho cliccato nulla.' };
        }
        if (scelta.motivo === 'icone-sconosciute') {
          fail('Nella Home non riconosco lo stato di firma delle lezioni (le icone non sono quelle previste ' +
            '«da firmare» / «firmata»): non clicco nulla, firma a mano.');
        }
        if (scelta.motivo === 'in-corso-gia-firmata') {
          return { ok: true, steps, summary: `La lezione in corso (${describe(scelta.inCorso)}) è già firmata.` +
            (scelta.prossima ? ` La prossima da firmare è la ${describe(scelta.prossima)}.` : ' Non ci sono altre lezioni da firmare dopo.') };
        }
        fail('Nella Home non trovo lezioni tue per oggi.');
      }
      const lezione = scelta.lezione;
      step(`Ora attuale ${fmtMin(nowMin)} → ${MOTIVI[scelta.motivo] || scelta.motivo}: ${describe(lezione)}` +
        (lezione.origineOrario && lezione.origineOrario !== 'Home' ? ` [orario dal ${lezione.origineOrario}]` : ''));

      // Entra nel registro giusto (per l'appello serve entrare dall'ora scelta,
      // così DidUP seleziona quella riga).
      let righe = righeAperte;
      const giaDentro = righeAperte && normClasse(classeAperta) === normClasse(lezione.classe) &&
        (action === 'firma' || oraAperta === lezione.numOra);
      if (!giaDentro) {
        if (righeAperte) await goHome();
        righe = await entraNelRegistro(lezione);
      } else {
        righe = readRegistroRows();
      }
      const t = righe.find(r => r.numOra === lezione.numOra && r.tempo);
      if (t && lezione.inizio == null) Object.assign(lezione, { inizio: t.tempo.inizio, fine: t.tempo.fine });

      const esito = action === 'appello' ? await appello(lezione) : await firma(lezione, righe);
      return { ...esito, steps };
    } catch (err) {
      const msg = err instanceof AzioneError ? err.message : `Errore imprevisto: ${err && err.message ? err.message : err}`;
      step(msg, 'error');
      return { ok: false, steps, error: msg, title: nome };
    }
  }

  return { esegui, askInPage, scegliLezione, parseRange, readDashboardLessons, readRegistroRows, findHomeMenuItem };
})();

// ---------------------------------------------------------------------
// Collegamento con il popup
// ---------------------------------------------------------------------
(() => {
  const instanceId = Math.random().toString(36).slice(2);
  document.documentElement.dataset.argoAssistantAzioni = instanceId;
  const isCurrent = () => document.documentElement.dataset.argoAssistantAzioni === instanceId &&
    typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  let running = false;

  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'argo-azione' || !isCurrent()) return;
    let popupOpen = true;
    const pendingAsks = new Map();         // id → { resolve, question, opts }
    port.onDisconnect.addListener(() => {
      popupOpen = false;
      // Popup chiuso mentre aspettava una risposta: la domanda passa nella pagina.
      for (const [id, p] of pendingAsks) { pendingAsks.delete(id); ArgoAzioni.askInPage(p.question, p.opts).then(p.resolve); }
    });
    const send = msg => { if (popupOpen) { try { port.postMessage(msg); } catch (e) { popupOpen = false; } } };

    const ask = (question, opts = {}) => new Promise(resolve => {
      if (!popupOpen) { ArgoAzioni.askInPage(question, opts).then(resolve); return; }
      const id = Math.random().toString(36).slice(2);
      pendingAsks.set(id, { resolve, question, opts });
      send({ type: 'ask', id, question, confirmLabel: opts.confirmLabel, cancelLabel: opts.cancelLabel });
    });

    port.onMessage.addListener(async msg => {
      if (msg && msg.type === 'answer' && pendingAsks.has(msg.id)) {
        const p = pendingAsks.get(msg.id);
        pendingAsks.delete(msg.id);
        p.resolve(Boolean(msg.ok));
        return;
      }
      if (!msg || msg.type !== 'run') return;
      const nome = msg.action === 'appello' ? 'Appello' : 'Firma ora';
      if (running) {
        send({ type: 'done', result: { ok: false, steps: [], error: 'C\'è già un\'azione in corso in questa pagina: attendi che finisca.' } });
        return;
      }
      running = true;
      let result;
      try {
        result = await ArgoAzioni.esegui(msg.action === 'appello' ? 'appello' : 'firma', s => {
          send({ type: 'step', step: s });
          // (le domande hanno il loro avviso con i pulsanti)
          if (!popupOpen && s.kind !== 'ask' && typeof assistantToast !== 'undefined') {
            assistantToast.show(nome, s.text, { warn: s.kind === 'error' });
          }
        }, { ask });
      } finally {
        running = false;
      }
      send({ type: 'done', result });
      // Popup chiuso nel frattempo: il risultato compare nella pagina.
      if (!popupOpen && typeof assistantToast !== 'undefined') {
        assistantToast.show(nome, result.ok ? result.summary : result.error, { warn: !result.ok, duration: result.ok ? 10000 : 0 });
      }
    });
    send({ type: 'ready' });
  });
})();
