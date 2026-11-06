// =====================================================================
// sessione.js — annota quando usi il registro (content script).
// Ogni clic, tasto, rotellina, movimento del mouse o cambio di schermata
// aggiorna l'ora dell'ultimo uso, scritta su <html data-argo-booster-activity>.
// Il service worker (mantenimento della sessione, background.js) la legge
// ogni minuto: ricarica il registro solo dopo alcuni minuti in cui non lo
// usi. Anche il caricamento della pagina (tuo o automatico) fa ripartire il
// conteggio. Nessun dato esce dal browser.
// =====================================================================

(() => {
  const root = document.documentElement;
  const THROTTLE_MS = 3000;
  // Caricamento della pagina: resta quello vero anche se lo script viene reiniettato dopo un aggiornamento.
  if (!root.dataset.argoBoosterLoadedAt) root.dataset.argoBoosterLoadedAt = String(Date.now());
  let last = 0;
  const touch = () => {
    const now = Date.now();
    if (now - last < THROTTLE_MS) return;
    last = now;
    root.dataset.argoBoosterActivity = String(now);
  };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'input']) {
    window.addEventListener(type, e => { if (e.isTrusted) touch(); }, { capture: true, passive: true });
  }
  window.addEventListener('hashchange', touch);
  window.addEventListener('popstate', touch);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touch(); });
})();
