// =====================================================================
// eid.js — pagina di autenticazione del Ministero
// (https://eid.istruzione.it/eid-gateway/).
// Se l'accesso è partito da Argo, sceglie da solo il provider SPID
// impostato oppure "Entra con CIE".
// I provider sono link .../sp/idps/spid/<id>/authenticate/ e la pagina li
// mostra in ordine casuale: si cercano per id, non per posizione.
// =====================================================================

(() => {
  if (window.__argoAssistantEid) return;
  window.__argoAssistantEid = true;

  function findSpidLink(id) {
    return document.querySelector(`a[href*="/sp/idps/spid/${CSS.escape(id)}/"]`);
  }

  function findCieLink() {
    return document.querySelector('a[href*="/sp/idps/cie/"]') ||
      [...document.querySelectorAll('a, button')].find(el => /Entra con CIE/i.test(el.textContent || ''));
  }

  function openSpidMenu() {
    const btn = document.querySelector('a.idp-btn, [data-toggle="dropdown"]');
    if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
  }

  async function run() {
    const flow = await getLoginFlow();
    if (!isFlowStage(flow, 'eid')) return;            // accesso non partito da Argo
    const settings = await loadSettings();
    // I pulsanti possono comparire dopo il caricamento della pagina.
    if (!await waitForElement(() => document.querySelector('a[href*="/sp/idps/"]'), 10000)) return;

    // Il passaggio vale una volta sola: se si torna indietro non riparte.
    await setLoginFlow({ ...flow, stage: 'idp', startedAt: Date.now() });

    if (settings.loginMethod === 'cie') {
      const cie = findCieLink();
      if (cie) {
        assistantToast.show('Accesso automatico', 'Entro con CIE…');
        cie.click();
        return;
      }
      assistantToast.show('Pulsante CIE non trovato', 'Scegli tu il metodo di accesso.', { warn: true, duration: 8000 });
      return;
    }

    if (!settings.spidProvider) {
      openSpidMenu();
      assistantToast.show('Scegli il provider SPID',
        'Per entrare in automatico la prossima volta, imposta il tuo provider nelle impostazioni.',
        { duration: 10000, actions: [{ label: 'Impostazioni', ghost: true, onClick: openExtensionOptions }] });
      return;
    }

    const link = findSpidLink(settings.spidProvider);
    if (link) {
      assistantToast.show('Accesso automatico', `Entro con SPID · ${spidProviderName(settings.spidProvider)}…`);
      link.click();
    } else {
      openSpidMenu();
      assistantToast.show('Provider non trovato',
        `${spidProviderName(settings.spidProvider)} non è nell'elenco della pagina: sceglilo tu.`,
        { warn: true, duration: 10000 });
    }
  }

  run().catch(err => console.warn('[Argo DidUP Booster] eid-gateway:', err));
})();
