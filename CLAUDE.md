# CLAUDE.md — Argo DidUP Booster

Note per riprendere il lavoro su questa estensione in una nuova sessione. La guida per gli utenti è in `README.md`.

## Per riprendere subito

1. **Leggere tutto questo file.** La memoria automatica di Claude Code è legata al percorso della cartella: se il progetto è stato spostato, quei vecchi appunti non vengono più caricati. Quello che serve è riportato qui.
2. **Controllare lo stato del repository:** `git log --oneline | head`, `git status` (rami `main` e `develop`, rilasci con git flow `Release-X.Y.Z`).
3. **Verificare che tutto funzioni:** `node tests/run-all.mjs`; con `--reali` prova anche l'accesso sulle pagine vere.
4. **Codice di DidUP.** È la fonte di tutto ciò che sappiamo del registro. Scaricarlo in una cartella temporanea (la cartella scratchpad della sessione), non nel progetto:
   - `curl -s https://www.portaleargo.it/voti/classic/app.js -o app.js` (circa 7 MB; si cerca con python o grep);
   - i testi di DidUP (es. `sessionExpiredMsg` = «Sessione scaduta») sono in `https://www.portaleargo.it/voti/resources/js/lng_it.js`;
   - lo script della pagina di login è `https://www.portaleargo.it/assets/auth/js/main.<hash>.js` (l'hash si legge nell'HTML del login; nel 11/2026 era `main.e8dba542.js`, quasi vuoto: la logica di «Ricordami» sta negli `onclick` dell'HTML);
   - l'HTML vero della pagina di login si ottiene solo con un `login_challenge` valido: aprire `https://www.portaleargo.it/voti/?classic` in un Chrome headless separato (con `tests/lib/cdp-pipe.mjs`) e leggere `document.documentElement.outerHTML` quando compare `#customer_code`. **Senza inserire credenziali.** `curl` di `/auth/sso/login/` senza challenge restituisce solo una pagina di errore.

## Spostamento in un repository git (fatto)

Il 5/11/2026 la cartella è stata spostata da `ArgoDidUP-Extension` a `argo_didup_booster` ed è diventata un repository git. L'id dell'estensione è cambiato (vedi "Contesto"). Resta facoltativo aggiungere `"key"` al manifest per fissare l'id: va fatto insieme a un export/import delle impostazioni, perché aggiungere la chiave cambia l'id una volta.

## Contesto

- **Utente.** Docente italiano, scrive in italiano: **rispondere in italiano**. Vuole sapere cosa fa l'estensione passo per passo, senza scatole nere (vedi "Preferenze dell'utente").
- **Cartella.** `/Applications/Google Chrome Extensions/argo_didup_booster` (dal 5/11/2026), **repository git** (rami `main`/`develop`, git flow, tag `Release-X.Y.Z`). Remoto su GitHub: `madxit/argo_didup_booster` (`https://github.com/madxit/argo_didup_booster`, costante `REPO_URL` in `settings.js`; le release si scaricano da lì). Commit e push solo se li chiede l'utente. Identità git globale: Daniele Maddaluno.
- **Installazione dell'utente.** Chrome la carica come estensione **non pacchettizzata** dalla cartella stessa, profilo `Default`, id `mngjmlnclgjlaoihjnnalehdglhlifio`, modalità sviluppatore attiva. (Con la vecchia cartella l'id era `kifiencogghnmdalnckcjppkckjenecd`.)
- **Pubblico.** Docenti italiani di qualunque scuola. Niente dati di una scuola specifica nel codice: l'estensione originale era scritta per l'ITT Buzzi (codice `SG18328`), poi è stata resa generica. Il codice `SG18328` (pubblico) si usa solo nei test.
- **Nome: «Argo DidUP Booster»** (fino alla 2.6 si chiamava «ArgoDidUP Assistant» / «Argo Assistant»). Non rinominare la cartella: cambierebbe l'id dell'estensione e l'utente perderebbe le impostazioni.
- **Identificatori interni.** Sono rimasti con il prefisso storico `argo-assistant` (`data-argo-assistant*`, eventi `argo-assistant:request:v4`, `dataset.argoAssistant*`, `__argoAssistant*`). Non si vedono e cambiarli lascerebbe doppioni nelle schede già aperte. Gli attributi nuovi della 1.2.0 usano `data-argo-booster-*` (`dataset.argoBooster*`).
- **Versione attuale: 1.2.0.** La numerazione è ripartita da 1.0.0 con il cambio di nome (prima era 2.6). **Alzare `version` in `manifest.json` a ogni modifica del codice** (`MAJOR.MINOR.PATCH`): la ricarica automatica scatta quando la versione su disco è *diversa* da quella caricata, quindi va bene anche il passaggio 2.6 → 1.0.0. Il workflow di rilascio controlla che il tag corrisponda a questa versione.
- **File tolti.** Stanno nella cartella sorella `/Applications/Google Chrome Extensions/argo_didup_booster - file rimossi/`:
  - `1.1.0/`: popup (`popup.html`, `popup.js`), `style.css`, `keepalive.js` e le immagini del popup;
  - `build-info.json` e `tools/` (hook git della sezione Informazioni, tolti nella 1.0.1);
  - nella revisione 2.5/2.6 (cartella vecchia): i `desktop.ini` di Google Drive, `images/logo-didup.png` (non usato), `.DS_Store`, `icona-precedente/` (copia dell'icona originale, che è quella in uso), `icona-scartata/` (icona della 2.5, non piaciuta all'utente).
  - Nella cartella del progetto è rimasta una cartella `tools/` **vuota** (non tracciata da git, ignorata dai test e dal pacchetto).
  - Nella 1.2.0 non è stato tolto nessun file.

## Struttura dei file

| File | Ruolo |
|---|---|
| `manifest.json` | MV3, versione 1.2.0. Permessi `storage`, `alarms`, `activeTab`, `scripting`, `clipboardWrite`; host `https://*.portaleargo.it/*`, `https://eid.istruzione.it/*`. **Nessun popup** (dalla 1.1.0): il clic sull'icona arriva sempre a `onClicked`. Content script su portaleargo: `page-bridge.js` (MAIN) e poi `settings.js`, `content-common.js`, `login.js`, `sessione.js`, `argomenti.js`, `azioni.js`, `toolbar.js`. |
| `settings.js` | Modulo condiviso da service worker, impostazioni e content script (variabili `var` di primo livello, così si può reiniettare). Contiene: `REPO_URL`, `DEFAULT_SETTINGS`, `SPID_PROVIDERS` (12 id), validazione ed import/export (`sanitizeSettings`: le chiavi booleane `autoLogin`, `ricordami`, `keepAliveEnabled`, `showFirma`, `showAppello`, `showArgomenti`, `guidaPulsanti`, `guidaArgomenti`), riconoscimento degli URL (`isArgoDashboardUrl` = percorso `/voti*`), `loginFlow`, `reloadIfStale()`, costanti del mantenimento (`KEEPALIVE_IDLE_MIN=10`, `KEEPALIVE_IDLE_MIN_FLOOR=3`, `KEEPALIVE_EXPIRED_IDLE_SEC=60`, `KEEPALIVE_EXPIRED_RETRY_MIN=5`), aspetto dei pulsanti (`BUTTON_POSITIONS`, `BUTTON_THEMES` con variabili CSS `--b-*` — il primo, `argo`, è il predefinito —, `buttonThemeCss()`, `BOOSTER_ICONS`, `BOOSTER_ACTIONS` con la chiave `setting` di ognuno, `enabledActions(settings)`, `BOOSTER_BUTTON_SIZE=34`, `boosterButtonsCss()`, `boosterPillCss()`, `boosterButtonHtml()`: gli stessi nel registro e nell'anteprima delle impostazioni). |
| `background.js` | Service worker: badge "!" se manca il codice, clic sull'icona (`handleIconClick`), `goToRegistro()`, controllo della sessione nelle schede aperte (`probeDidupSession`), **mantenimento della sessione** (`chrome.alarms` ogni minuto → `keepAliveTick` → `sessionInPage` nel mondo MAIN → eventuale `chrome.tabs.reload`), iniezione degli script dopo un aggiornamento, `clearPopups()` (toglie i popup per scheda delle versioni ≤ 1.0), ripresa dopo la ricarica automatica. |
| `sessione.js` | Content script (dalla 1.2.0): annota l'ora di caricamento della pagina (`<html data-argo-booster-loaded-at>`, non sovrascritta se lo script viene reiniettato) e dell'ultimo uso (`data-argo-booster-activity`: `pointerdown`, `keydown`, `wheel`, `touchstart`, `mousemove`, `input` solo se `isTrusted`, `hashchange`, `popstate`, scheda tornata visibile; al massimo una scrittura ogni 3 s). Gli attributi del DOM si leggono anche dal mondo MAIN, dove gira `sessionInPage`. Nessun dato su cosa si clicca o si scrive. |
| `toolbar.js` | Pulsanti rotondi **Firma ora** / **Appello** nella barra in alto di DidUP (elemento `position:fixed` sopra la barra, non dentro il layout Ext; z-index 10000, sotto le finestre Ext). Solo quelli attivi (`enabledActions`); se nessuno è attivo la barra non si mostra; la barra si ricrea quando cambiano `showFirma`/`showAppello`. Posizione ricalcolata ogni 600 ms: a destra prima del gruppo aiuto/profilo (bordo sinistro dell'**immagine** dell'aiuto, distanza 12 px), al centro, a sinistra dopo il testo di `#intestazioneId`; in verticale **centrati sull'immagine dell'aiuto** (`img[src*=help]`), non sulla barra; se la barra è nascosta, in basso a destra. Pannello dei passi (`[data-argo-assistant="run"]`) con domanda Sì/No (chiusura, clic fuori o 2 minuti = no); **si chiude con un clic fuori** (solo eventi `isTrusted`; i clic sui pulsanti della barra e sulla guida non contano); se è stato chiuso mentre lavorava, a fine azione si riapre solo in caso di errore. Durante un'azione imposta `<html data-argo-booster-busy>` (il mantenimento non ricarica). **Guida della prima volta** (`guidaPulsanti`): quando la barra è visibile e ferma da ~2,4 s, la scheda è visibile e non ci sono maschere o finestre Ext; passi: barra, Firma ora, Appello (solo quelli attivi), impostazioni. Avviso «Sessione scaduta» con «Ricarica ora» (`location.reload()`) e «Più tardi». |
| `options.html/js/css` | Impostazioni, salvate a ogni modifica: link **GitHub** in cima (e in fondo alla pagina), scuola e accesso (con l'interruttore «Ricordami»), sessione (solo on/off + stato dettagliato e scadenze osservate), **funzioni nel registro** (`#sec-funzioni`: interruttori `showFirma`, `showAppello`, `showArgomenti` con l'icona del pulsante vero; caselle `guidaPulsanti`, `guidaArgomenti`, aggiornate anche quando le spegne la pagina del registro), **aspetto dei pulsanti** (`#sec-pulsanti`: posizione, 6 stili, anteprima con i pulsanti veri in shadow DOM che mostra solo le funzioni attive), discipline con due elenchi ordinabili (schede "Argomenti" e "Compiti", `currentKind`), export/import JSON (`argo-didup-booster-impostazioni-AAAA-MM-GG.json`), URL avanzati. La **versione** (dal manifest) è nella barra in cima (`#info-version`). |
| `page-bridge.js` | Script nel **mondo MAIN**: unico punto (oltre alle funzioni che il service worker esegue con `executeScript`) che usa gli oggetti di DidUP (Ext JS). Canale versionato `argo-assistant:request:v4` / `response:v4`. Funzioni: `session`, `ping`, `info`, `fields`, `insert`, `dashboardLessons`, `registroLessons` (righe con `index`, `docente`, `mia`, più `utente`), `utente`, `goHome`, `viewVisible`. Non cambiato nella 1.2.0. |
| `content-common.js` | `callPageBridge()`, `waitForElement()`, `assistantToast` (shadow DOM; `actions`, `onDismiss`), `PAGE_BRIDGE_CHANNEL='v4'`, **`assistantGuide`** (dalla 1.2.0: `show(steps)` con `steps = [{ target: () => Element, title, text, round, action: { label, onClick } }]`; host `[data-argo-assistant="guide"]` a tutto schermo, z-index 2147483600; riquadro illuminato con `box-shadow: 0 0 0 200vmax rgba(15,23,42,.68)`; Avanti/Indietro/«Ho capito», «Salta la guida», Esc, frecce; blocca clic e tasti verso DidUP; `isOpen()`, `close()`). |
| `login.js` | Pagine Argo: compila `#customer_code`, **spunta «Ricordami»** (`applyRicordami`: `#shared_remember_me.checked = true` senza cliccare, così non si apre la finestra informativa `#ssoModal`; mette anche `#spid_remember_me = "true"`) e preme `a.button-spid`; lo spunta anche quando l'utente preme SPID a mano (listener in cattura sul pulsante, prima dell'`onclick` di Argo); sceglie il profilo (`.selectable-identity`); chiude `loginFlow` quando il registro ha le credenziali; anti-ripetizione di 90 s con "Riprova". |
| `eid.js` | `eid.istruzione.it/eid-gateway`: provider `a[href*="/sp/idps/spid/<id>/"]` (l'ordine in pagina cambia ogni volta) oppure CIE `a[href*="/sp/idps/cie/"]`. Agisce solo se `loginFlow.stage==='eid'`. |
| `argomenti.js` | Pulsante "Argomenti e compiti" nella sezione "Registro di classe · Docenti ed alunni" della schermata di modifica lezione. Dalla 1.2.0 è **allineato a destra sulla riga del titolo**: l'host sta dentro il `fieldset` (`position:absolute; right:14px`, il fieldset diventa `position:relative` se era `static`), centrato sulla `legend` misurando e correggendo la posizione (l'origine di un elemento assoluto dentro un `fieldset` dipende dalla legenda), con lo sfondo del riquadro dietro (copre la linea del bordo). Il pannello si apre allineato al bordo destro del pulsante. Si toglie con `showArgomenti`. **Guida della prima volta** (`guidaArgomenti`) sul pulsante, 700 ms dopo che compare. Il pannello ha il menu delle discipline (solo i nomi) e le schede Argomenti/Compiti con i conteggi. Argomento → casella `desArgomento` ("Attività svolta"); compito → la casella `desCompiti`/`desCompiti2`/`desCompiti3` visibile (scheda aperta). Le caselle si riconoscono con `fields` dal campo collegato, **non dalla posizione**: la 2.5 le contava per posizione e prendeva anche la scheda "Compiti" nascosta, da cui "Compiti, Compiti" con uno che non funzionava. Inserimento tramite il ponte (`setValue` di Ext, separatore `\n`, massimo 500 caratteri). |
| `azioni.js` | Motore di **Firma ora** e **Appello** (`ArgoAzioni.esegui(action, onStep, { ask, docenteNome, now })`), avviato da `toolbar.js`. Riconosce la riga del docente (`assegnaRighe`, `sameName`). Non cambiato nella 1.2.0. |
| `icon/` | `icon16/32/48/128.png` + `icon.svg`: l'icona originale (scuola bianca con bandierina su blu). L'utente preferisce questa: non cambiarla senza chiedere. |
| `docs/img/` | Immagini del README: si rigenerano con `node tests/screenshots.mjs` (usa il DidUP finto con un fuso orario emulato in cui sono le 10). Dalla 1.2.0 anche `guida-pulsanti.png`, `guida-argomenti.png`, `impostazioni-funzioni.png`. |
| `.github/workflows/release.yml` | Rilascio automatico (vedi "Rilascio"). |
| `tests/` | Test e strumenti di sviluppo (vedi "Test"). Chrome ignora questa cartella; il pacchetto di rilascio la toglie. |

## Flussi principali

### Accesso

1. **Clic sull'icona.** `chrome.action.onClicked` → `reloadIfStale({action:'icon-click', tabId})` → `handleIconClick(tab)`:
   - **senza codice scuola:** impostazioni;
   - **scheda del registro con sessione valida** (`probeTabSession` = `ok`): impostazioni;
   - altrimenti `goToRegistro(tab)`:
   - **pagina di login di Argo:** messaggio `argo-login-now` a `login.js`;
   - **registro già aperto:** controllo della sessione con `chrome.scripting.executeScript` nel mondo MAIN (`probeDidupSession`). Se la sessione è valida lo mette in primo piano; se è `expired` o `not-logged` rifà l'accesso in quella scheda;
   - **altra pagina Argo:** la riporta a `/voti/`;
   - **nessuna scheda Argo:** ne apre una nuova su `basePortalUrl`.
2. **Passaggi di `loginFlow`** (in `storage.local`, validità di 3 minuti):
   - `argo`: richiesto dal clic sull'icona;
   - `eid`: impostato da `login.js` subito prima di premere SPID;
   - `idp`: impostato da `eid.js` (vale una volta sola).
3. `/voti/` non ancora autenticato rimanda a `www.portaleargo.it/auth/sso/login/?login_challenge=…` (OIDC, hydra). Anche quell'URL corrisponde allo schema "registro": per questo `login.js` chiude il flusso **solo** quando il ponte risponde `session === 'logged'`.
4. **«Ricordami»** (impostazione `ricordami`, predefinita **attiva**; da spegnere sui computer condivisi): vedi "Pagina di accesso di Argo" e "Mantenimento della sessione".

### Pulsanti nel registro (dalla 1.1.0, al posto del popup)

Richiesta dell'utente: l'icona dell'estensione serve solo ad arrivare ad Argo o alle impostazioni; Firma e Appello sono pulsanti rotondi con icona nella barra di DidUP, con la scritta al passaggio del mouse. Posizione (`buttonsPosition`: `right` predefinita, `center`, `left`) e stile (`buttonsTheme`) si scelgono nelle impostazioni con anteprima. Lo stesso stile vale per il pulsante «Argomenti e compiti».

- **Stili** (in quest'ordine nelle impostazioni): `argo` «Simil Argo» (**predefinito dalla 1.2.0**: bianco, bordo e icona arancioni `#ff9625` come l'immagine dell'aiuto di DidUP), `vivid` «Evidenziato» (viola, era il predefinito nella 1.1.0), `contrast`, `sepia`, `light`, `dark`. Gli utenti che non avevano mai scelto uno stile passano a «Simil Argo».
- **Puntino** (`--b-mark`): indica che il pulsante è dell'estensione; trasparente in «Simil Argo». Il suo contorno (`--b-mark-ring`) è trasparente quando manca il puntino, altrimenti taglierebbe il bordo.
- **Dimensione:** 34 px, come l'immagine dell'aiuto (alta 34 px); bordo 2 px.
- **Funzioni attivabili** (1.2.0): `showFirma`, `showAppello`, `showArgomenti` (predefinite attive). Si vedono/tolgono subito anche nel registro aperto.
- **Guide della prima volta** (1.2.0): `guidaPulsanti`, `guidaArgomenti` (predefinite `true`). Il content script le mette a `false` **quando mostra** la guida (non alla chiusura), così non si ripresentano neanche se la pagina si ricarica. Rimettendole a `true` dalle impostazioni, la guida ricompare subito se il registro (o la modifica lezione) è aperto, altrimenti alla prossima occasione.

### Ricarica automatica

- **Il problema.** Per un'estensione non pacchettizzata Chrome rilegge dal disco la pagina delle impostazioni a ogni apertura. Service worker e content script restano invece quelli caricati finché l'estensione non viene ricaricata.
- **Il controllo.** `reloadIfStale(after)` confronta `chrome.runtime.getManifest().version` con il `manifest.json` sul disco. Se sono diversi chiama `chrome.runtime.reload()` (funziona solo con la modalità sviluppatore attiva).
- **Dove gira.** Nelle impostazioni e al clic sull'icona.
- **La ripresa.** `selfReload` vale `{from, to, at, after, handled}` e ha una protezione di 60 s contro le ricariche a ripetizione. `resumeAfterSelfReload()`, chiamata in `onInstalled`, esegue `icon-click` (ripete il clic sulla scheda `tabId`), `go-registro` oppure `open-options`.
- **Verificare la versione caricata dall'utente.** Guardare `~/Library/Application Support/Google/Chrome/Default/Secure Preferences` → `extensions.settings.<id>.active_permissions`. Leggere solo quella voce.

### Mantenimento della sessione (rifatto nella 1.2.0)

- **Come funziona DidUP.** Due credenziali:
  - il token OIDC (`Authorization: Bearer`, oidc-client 1.x, utente in `sessionStorage`, durata ~60 min, nessun refresh token nella versione web, `clockSkew: 600`). DidUP lo rinnova da solo con `addAccessTokenExpiring` → `signinSilent()` (iframe su `redirect_uri` = `/voti/oidc-callback.html?classic`, `prompt=none`) → `WSX.util.handleAuthSessionRenewed(user)` (cambia solo l'header `Authorization`); se fallisce, `handleAuthSessionExpired` mostra `box-sessione-scaduta-view` («Sessione scaduta · È necessario effettuare il login. Se preferisci mantenere l'accesso, al prossimo login seleziona la casella "Ricordami"», pulsanti *Logout* e *Riautenticati* → `signinPopup`);
  - la sessione applicativa (`x-auth-token`, `uid` di POST `login`), che il server chiude senza richieste. Quando nessuno la usa, DidUP **non fa richieste periodiche**. Una risposta 401/402/406 in classic mostra `Ext.Msg.alert('Attenzione', 'Sessione scaduta')` (o il `msg` del server, es. «Accesso non consentito» → logout).
- **Al caricamento della pagina** (`signinFromController`): `mgr.getUser()`; se il token è valido e c'è l'utente in `userdata` (store con proxy `sessionstorage`, `id: 'user-store'`) → `onEnter` (riusa `uid` e dati salvati); se il token è valido ma manca `userdata` → `createSession` (POST `login`); se il token è **scaduto** → `signinRedirect()`, cioè passa dalla pagina di accesso di Argo (hydra). Con «Ricordami» hydra ricorda l'accesso e torna subito al registro senza SPID; senza, compare la pagina di login (e `login.js` riparte da solo se `autoLogin`).
- **Storia.**
  - 1.0: ping o ricarica periodica dal content script: dopo ~60 minuti 401 (log `keepAliveStatus` dell'utente, 5-6/11/2026, 60,5 e 64,8 minuti dopo l'avvio).
  - 1.1.0: dal service worker, `signinSilent` 10 minuti prima della scadenza + ping ogni 4 minuti. Sul registro vero l'utente ha ricevuto «Argo non permette di rinnovare l'accesso senza di te» = `login_required`: hydra non aveva una sessione da ricordare perché all'accesso **non era spuntato «Ricordami»** (la casella è deselezionata di default e l'estensione non la toccava). Lo conferma il testo di `box-sessione-scaduta-view`.
  - 1.2.0 (richiesta dell'utente: «un modo più stupido», ricaricare la pagina con un debounce che riparte a ogni uso umano): **«Ricordami» spuntato da `login.js`** + **ricarica dopo inattività**. Tolti `keepAliveInPage`, il ping, `signinSilent` dell'estensione, `describeRenewError` e il messaggio `relogin-tab`.
- **Unico meccanismo (nessuna scelta per l'utente).** `chrome.alarms` `argo-keepalive` ogni minuto (gira anche con la scheda in secondo piano, il service worker si risveglia). Per ogni scheda del registro non scartata, `sessionInPage()` nel mondo MAIN restituisce:
  - `state`: `ok` | `expired` | `not-ready` | `not-logged`; `why` della scadenza: `box` (`box-sessione-scaduta-view` visibile), `msg` (finestra visibile con /sessione\s+scaduta|accesso non consentito|eseguire il login/i), `token` (`user.expired`);
  - `tokenExpiresAt` (`user.expires_at`), `loadedAt` e `lastActivity` (da `sessione.js`);
  - `busy`: Firma/Appello al lavoro (`data-argo-booster-busy`), guida aperta, **finestra Ext visibile** (`.x-window` che non sia `.x-message-box` né il messaggio di sessione scaduta: es. modifica lezione), `textarea` attiva con testo.
  Poi `keepAliveTick` decide, con `lastUse = max(lastActivity, loadedAt)` (oppure `tab.lastAccessed`):
  - sessione valida e inattiva da `idleMin` (10, o meno se adattato) → `chrome.tabs.reload` (motivo `inattività`), salvo `busy`;
  - sessione scaduta → la prima volta per quella pagina annota la scadenza in `sessionLog` e manda `argo-session-expired` alla scheda; ricarica (motivo `scaduta`) quando l'utente è inattivo da 60 s e non `busy`, al massimo una volta ogni 5 minuti per scheda (`wait-retry`);
  - scheda ricaricata da meno di 5 minuti che ora è su una pagina di Argo diversa dal registro → stato `action: 'login'` (Argo ha chiesto di nuovo SPID/CIE).
  - **Adattamento:** se la causa è `msg` (server), non `busy`, e i minuti di inattività sono ≤ `idleMin + 2`, `keepAliveIdleMin = max(3, floor(minuti × 0,6))` se più corto.
  - Stato per scheda in `chrome.storage.session` → `kaTabs` (`{reloadAt, reason, loginNoted, expiredLoadedAt, expiredReloadAt}`; in memoria se `storage.session` manca, come nel finto `chrome.*`). `autoDiscardable:false` sulle schede del registro finché il mantenimento è attivo.
- **Impostazioni rimaste:** solo `keepAliveEnabled` (testo: «Mantieni attiva la sessione dopo l'accesso»). `keepAliveInterval` e `keepAliveMethod` (1.0) sono stati tolti (nell'import vengono ignorati).
- **Da verificare sul registro vero:** che con «Ricordami» `signinSilent` di DidUP riesca e che la ricarica con il token scaduto rientri senza SPID; che il messaggio di sessione scaduta venga riconosciuto; che nessuna `.x-window` resti visibile nella Home (bloccherebbe le ricariche). Lo stato in Impostazioni → Sessione (e `sessionLog`) mostra cosa è successo.

### Canale del ponte

Dopo un aggiornamento, nelle schede già aperte resta anche il ponte vecchio. Per questo il canale CustomEvent ha una versione: così ponte vecchio e nuovo non rispondono entrambi (un "insert" verrebbe fatto due volte). **Se il ponte cambia, aumentare `CHANNEL`** in `page-bridge.js` e `PAGE_BRIDGE_CHANNEL` in `content-common.js`. Nella 1.2.0 il ponte non è cambiato (resta `v4`).

### Firma ora / Appello (`azioni.js`)

1. **Home.** Clic su **Home** nel menu treelist:
   - selettore `.x-treelist-item > .x-treelist-row .x-treelist-item-text` con testo "Home", oppure icona `menuicon-menu-home`, oppure `data-recordid="dashboard-main-view"`;
   - se il clic non ha effetto, ripiego `WSX.app.getMainView().getController().clickMenuItem(WSX.util.IDXMENUDASH)`;
   - **non lo fa** se è aperta la modifica di una lezione, per non perdere il testo.
2. **Lezioni di oggi.** Dalla Home: le schede `.dashboard-card` con il titolo "Classe 3A"; ogni lezione ha `span[id="ora_<N>_<idx>"]` e un'icona `icon-ora-da-firmare` o `icon-ora-firmata`. Nel DOM della Home **gli orari non ci sono**.
3. **Orari.**
   - Prima dai dati della Home: store `classiDocente` del componente `dashboard-main-view`, tramite il ponte. La funzione `extractTime` cerca "HH:MM - HH:MM" e coppie inizio/fine.
   - In mancanza, dalla tabella del registro di classe: cella FIRMA → `<div>08:00 - 09:00</div>`, campo `oraInizioFine`. Le ore della prima classe aperta vengono usate per tutte, indicato con "[orario dal registro 3A]".
4. **Scelta della lezione** (`scegliLezione`, funzione pura):
   - **Firma:** in corso → prossima più vicina → ultima passata non firmata. Se la lezione in corso è già firmata, non clicca nulla e indica la prossima.
   - **Appello:** in corso → che inizia entro 15 minuti → appena finita → prossima.
   - **Senza orari:** si sceglie per numero dell'ora.
5. **Firma.**
   - **Riga del docente** (problema segnalato il 5/11/2026: classe articolata, la riga del collega già firmata veniva prima e l'estensione diceva «già firmata»). Ogni ora può avere più righe. `assegnaRighe` decide se una riga è tua: (1) `registroLessons` del ponte, cioè `anagrafePK` della riga = `WSX.util.getAnagrafePK()`, abbinata alla riga del DOM con `data-recordindex`; (2) `sameName` tra `nominativoDocente` (o la cella «Docente», classe `x-grid-cell-<id colonna>`) e il nome dell'utente (`userdata.descutente`) o `docenteNome` delle impostazioni; (3) l'icona: `icon-ora-da-firmare` solo sulle proprie, aria-label «… un altro docente» sulle altrui, «Clicca per eliminare la firma» sulle proprie firmate.
   - Se la Home segna «firmata» l'ora in corso (`in-corso-gia-firmata`, oppure `tutte-firmate` con un'ora in corso) si entra comunque nel registro a controllare la propria riga.
   - Clic **solo** sulle icone `.icon-ora-da-firmare` della propria riga. In DidUP il clic su un'ora firmata apre "Conferma elimina firma", quindi non va mai fatto.
   - Firma il blocco di ore consecutive tue nella stessa classe, una alla volta, aspettando che la stessa riga (`data-recordindex`) diventi `icon-ora-firmata`.
   - **Conferma** (richiesta dall'utente): un'ora la cui fascia **non contiene l'ora attuale**, o con orario non noto, si firma solo dopo un "sì". La domanda compare nel pannello dei passi di `toolbar.js` (chiusura del pannello, clic fuori o 2 minuti senza risposta = "no"). Se in un blocco solo un'ora è in corso, si può firmare solo quella.
6. **Appello.**
   - Si entra nel registro **dalla lezione scelta**: DidUP seleziona quella riga.
   - Poi clic su `.menu-registro-appello`. Il pulsante è attivo solo se la riga è tua e firmata, oppure se sei coordinatore o docente della classe; altrimenti l'errore lo spiega.
   - La schermata dell'appello è `appello-classe-view`.
7. **Esito:** `esegui` restituisce `{ok, cancelled?, summary | error, steps}`; i passi (`{text, kind: ok|warn|ask|error}`) arrivano a `onStep` e vanno nel pannello.

## Struttura di DidUP (dal bundle pubblico)

Il bundle è `https://www.portaleargo.it/voti/classic/app.js`, circa 7 MB, Ext JS 6 classic (versione vista l'11/2026: `VERSIONE '4.54.2'`, build 20251209). Le informazioni sotto vengono da lì; dove serve si scarica con curl e si cerca nel testo.

- **Accesso.** oidc-client; il token sta nel `sessionStorage` della scheda; le API usano gli header `Authorization: Bearer` e `x-auth-token`, letti con `Ext.Ajax.getDefaultHeaders()`. Sessione scaduta = risposta 401, 402 o 406. `getUrlBase()` è globale. Dettagli del rinnovo e del caricamento in "Mantenimento della sessione".
- **Home.** POST `dashboard/loaddati` → `classiDocente`. Il clic su `span[id^=ora_]` chiama `onClickPanel` → `selezionaClasse` → `push('registro-main-view')`.
- **Registro.** `attivita-view`, griglia `grid-attivita`, store `attivita` (modello `AttivitaModel`: `numOra`, `flgPresente`, `anagrafePK`, `nominativoDocente`, `materia`, `libera`, `oraInizioFine`…). Colonne: ORA (nascosta), FIRMA (`renderIconaFirma`), **Docente** (`nominativoDocente`, più « (SUPPLENZA)» e il sostituito), Materia, Attività svolta, Compiti. `cellclick` sulla colonna FIRMA (indice 1) → `clickFirmaOra` (interruttore: firma o toglie la firma). `renderIconaFirma`: arancione `icon-ora-da-firmare` solo se `anagrafePK == getAnagrafePK()`; righe altrui firmate = `icon-ora-firmata` con aria-label «N° ora firmata da un altro docente…».
- **Utente collegato.** `WSX.app.getMainView().getViewModel().getStore('userdata').getAt(0)` (modello `WSX.model.UserData`, proxy `sessionstorage`): campi `user`, `uid`, `codcli`, `scuola`, `descutente` (si presume «COGNOME NOME»: non verificato), `anagrafePK`, `ruoli`, `licenze`…
- **Barra in alto.** `WSX.view.main.HeaderPanel` (`headerpnl`, nascosta con `accessoTramiteToken || maximized`): pannello `.header` alto 58 px con layout `hbox` **senza `align`** (gli elementi stanno in alto, non centrati). A sinistra `.logo_programma` (clic → «Vuoi ricaricare l'applicazione?») e `#intestazioneId`; a destra, in un pannello `hbox pack:end`: «Aggiorna APP» (di solito nascosto), aiuto (`btnNews`, pulsante Ext largo 45 px con dentro `<img height="34" src="https://cdn.portaleargo.it/wsx/voti/resources/images/help2.png">`, tooltip «Apri la pagina di supporto») e profilo (`.btn-profile`). `help2.png` è 42×40: sfondo bianco opaco e cerchio arancione `#ff9625` con «?» (da qui lo stile «Simil Argo»).
- **Modifica lezione.** `attivita-dettaglio-view` / `attivita-dettaglio-tabview`. Nel fieldset "Registro di classe" (`legend.x-fieldset-header` > `.x-fieldset-header-text`) c'è un tabpanel con "Attività svolta" (`theAttivita.desArgomento`) e un tabpanel `tabCompiti` con le schede "Compiti": `panelCompiti` → `desCompiti`; `panelCompiti2`/`panelCompiti3` sono nascoste finché il docente non ne aggiunge una (+) → `desCompiti2`/`desCompiti3`. Massimo 500 caratteri. Il binding si legge da `cmp.getBind().value.stub.path` o da `cmp.initialConfig.bind.value`.
- **Sessione scaduta.** `WSX.view.main.BoxSessioneScaduta` (`box-sessione-scaduta-view`, finestra modale 400×260); testi in `lng_it.js` (`sessionExpiredMsg`: «Sessione scaduta», `warnTitle`: «Attenzione»).

## Pagina di accesso di Argo

Vista l'11/2026 aprendo `/voti/?classic` in un Chrome headless (titolo «Accedi con Argo Software»):

- `#loginForm` (POST `/auth/sso/login`) con `challenge`, `client_id`, `prefill`, `#argo_remember_me` (nascosto), `#username`, `#password`, `#accediBtn` (copia «Ricordami» in `#argo_remember_me` nel suo `onclick`).
- `#spidForm` (POST `/auth/eid-gateway/sso`) con `challenge`, `client_id`, **`#spid_remember_me`** (`name="remember_me"`, nascosto, `false` di default), `#customer_code` e `a.button-spid` («SPID - CIE - EIDAS»), il cui `onclick` copia `#shared_remember_me.checked` in `#spid_remember_me` e invia il modulo.
- **`#shared_remember_me`**: casella «Ricordami» (non spuntata di default). Testo accanto: «Cliccando su "Ricordami" non dovrai più autenticarti su questo dispositivo per accedere alle applicazioni». Il suo `onclick` apre `#ssoModal` se `shouldShowModal(username || customer_code)`: per questo l'estensione imposta `checked` senza cliccare.
- Scelta del profilo dopo SPID: `.selectable-identity[data-username][data-customer_code]`.

## Dati salvati (`chrome.storage.local`)

- **Impostazioni** (chiavi di `DEFAULT_SETTINGS`): `codiceScuola`, `loginMethod`, `spidProvider`, `autoLogin`, `ricordami` (1.2.0, `true`), `docenteNome`, `keepAliveEnabled`, `showFirma`, `showAppello`, `showArgomenti` (1.2.0, `true`), `guidaPulsanti`, `guidaArgomenti` (1.2.0, `true` finché la guida non è stata mostrata), `buttonsPosition`, `buttonsTheme` (`argo` dalla 1.2.0), `discipline[{nome, argomenti[], compiti[]}]` (`TIPI_VOCE` in settings.js; i file senza `compiti` vengono completati con un elenco vuoto), `argoLoginUrl`, `argoDashboardPattern`, `basePortalUrl`, più `schemaVersion`. Tutte finiscono nell'export.
- **Stato:**
  - `loginFlow`;
  - `keepAliveStatus` (1.2.0): `{time, tabId, ok, expired, why, action: check|reload|wait-busy|wait-idle|wait-retry|login|error, reason: inattività|scaduta, idleMin, idleSec, lastUse, nextReloadAt, tokenExpiresAt, busy, lastReloadAt, lastReloadReason, loginRequired, error}`;
  - `sessionLog` (1.2.0): ultime 10 scadenze osservate `{at, why, sinceLoadMin, idleMin}` (le prime 5 nelle impostazioni);
  - `keepAliveIdleMin` (1.2.0): soglia di inattività adattata (3–10; assente = 10);
  - `selfReload`, `ui_lastDisciplina`, `ui_lastTipo` (ultima scheda del pannello).
- **`chrome.storage.session`:** `kaTabs` (stato per scheda del mantenimento, vedi sopra).
- **Migrazione.** Alla prima esecuzione si recuperano alcuni campi da `storage.sync` della versione originale.

## Messaggi `runtime`

- **Al service worker:** `open-options`, `go-registro`. (`relogin-tab` è stato tolto nella 1.2.0.)
- **Ai content script:** `argo-login-now`, `argo-session-expired` (`{text}`, mostrato da `toolbar.js` con «Ricarica ora» / «Più tardi»).

## Rilascio

- **Workflow:** `.github/workflows/release.yml` («Rilascio»). Parte con il push di un tag `Release-*` (git flow), `v[0-9]*` o `X.Y.Z`, oppure a mano (*Actions → Rilascio → Run workflow*, input `tag` facoltativo, predefinito `Release-<versione>`).
- **Passi:** legge `version` da `manifest.json` (deve essere `X.Y.Z`) e, se parte da un tag, controlla che il tag (senza `Release-`/`v`) sia uguale; copia il repository in `dist/argo_didup_booster/` con `rsync` togliendo `.git/`, `.github/`, `dist/`, `tests/`, `tools/`, `docs/img/`, tutti i `*.md` (README, CLAUDE), `.gitignore`, `.gitattributes`, `.DS_Store`, `desktop.ini`, poi le cartelle vuote (es. `docs/`); crea `argo_didup_booster-X.Y.Z.zip` (con dentro la cartella `argo_didup_booster`), controlla che contenga `argo_didup_booster/manifest.json` e nessun file da togliere; lo allega alla release del tag con `gh release upload --clobber`, oppure crea la release (`gh release create --target $GITHUB_SHA`, titolo «Argo DidUP Booster X.Y.Z»); lo salva anche tra gli artefatti. Permesso `contents: write`. `LICENSE` resta nel pacchetto.
- **Provato in locale** (11/2026) con gli stessi comandi `rsync`/`find`/`zip` su una copia dei file tracciati: lo zip conteneva solo i file dell'estensione. Il workflow in sé non è ancora stato eseguito su GitHub.
- **Procedura tipica:** alzare `version`, `git flow release start X.Y.Z`, `git flow release finish X.Y.Z` (crea il tag `Release-X.Y.Z`), `git push origin main develop --tags`. Solo se lo chiede l'utente.
- Il README (Installazione e Aggiornare) dice di scaricare **`argo_didup_booster-X.Y.Z.zip`** dagli *Assets* della release, non *Source code*.

## Test

Servono Node 20+ (provato con la 26) e Google Chrome. Tutto in `tests/`: profili, copie dell'estensione e screenshot finiscono in `$TMPDIR/argo-didup-booster-tests` (su questo Mac `/var/folders/kc/gm66k0_s37s4470lv1lrc7880000gn/T/argo-didup-booster-tests/shots/`).

| Comando | Cosa prova |
|---|---|
| `node tests/run-all.mjs` | Esegue in sequenza le quattro suite qui sotto. |
| `node tests/test-impostazioni.mjs` | Pagina delle impostazioni (finto `chrome.*`, server locale): sessione (testo dell'interruttore, stati: attiva/ricaricata/scaduta con finestra aperta/accesso richiesto, scadenze osservate, soglia adattata), «Ricordami», link GitHub, funzioni e guide, anteprima, stili («Simil Argo» primo e predefinito), discipline, export/import. |
| `node tests/test-funzioni.mjs` | Accesso su un login Argo ed eid finti (anche `remember_me=true` inviato ad Argo, e `false` con «Ricordami» spento), `sessionInPage` (finestra aperta, movimento del mouse, Firma al lavoro, token scaduto, messaggio «Sessione scaduta»), argomenti nel registro (allineamento a destra sulla legenda, funzione tolta/rimessa, guida), service worker (clic sull'icona, `keepAliveTick` con gli allarmi: nessuna ricarica se usato da poco, niente ricarica con finestra aperta, ricarica dopo 11 minuti, scadenza → avviso, ricarica dopo 1 minuto, niente ripetizioni, pagina di accesso dopo la ricarica, soglia adattata), ricarica automatica. |
| `node tests/test-firma-appello.mjs` | `azioni.js` e `toolbar.js` su `tests/mock/didup-mock.html` (DidUP finto con barra in alto — gruppo di destra in alto come nel vero, immagine dell'aiuto simile a `help2.png` —, menu, Home, registro, Appello; opzioni `articolata`, `homeFirmataDaAltri`, `utente`, `docenteRiga`, `pk`), compresa la conferma fuori orario, le classi articolate, posizione (centrati sull'immagine dell'aiuto), stile, funzioni tolte, clic fuori dal pannello (con eventi mouse veri via CDP), avviso con «Ricarica ora» e guida della prima volta. |
| `node tests/test-estensione-vera.mjs` | Estensione **vera** (mondo isolato, pulsanti nella pagina, service worker reale, fuso orario emulato) contro il DidUP finto servito come `https://www.portaleargo.it` (host dirottato e certificato usa e getta creato con openssl): Firma, Appello, `sessione.js`, ricarica vera della scheda dopo 11 minuti simulati, guida della prima volta. |
| `node tests/test-siti-reali.mjs [stale\|click\|onlogin]` (oppure `run-all.mjs --reali`) | Percorso di accesso sulle **pagine vere** di Argo ed eid con il codice pubblico `SG18328`. Si ferma alla pagina del provider (Poste ID, InfoCert, CIE) **senza credenziali**. Lo scenario `onlogin` legge (CDP `Network`) il modulo inviato ad Argo e controlla `remember_me=true` (verificato l'11/2026: 21/21). Ogni chiamata alla pagina ha un limite di 8 s: la pagina CIE una volta ha bloccato `Runtime.evaluate` all'infinito. |
| `node tests/screenshots.mjs` | Rigenera `docs/img/*.png` con dati di fantasia. |

**Note tecniche:**
- Google Chrome ignora `--load-extension`: l'estensione vera si carica con `--remote-debugging-pipe --enable-unsafe-extension-debugging` e CDP `Extensions.loadUnpacked` (`tests/lib/cdp-pipe.mjs`).
- Per provare `chrome.runtime.reload()` serve la modalità sviluppatore: `enableDevMode()` da `chrome://extensions`.
- I test con il finto `chrome.*` (`tests/mock/mock-chrome.js`, con `tabs.reload` registrato tra le chiamate; niente `storage.session`) girano nel mondo della pagina; `prepareMockExtension()` aggiunge il mock alle impostazioni. Il finto `executeScript` restituisce sempre `__executeScriptReply`.
- Nei test le guide della prima volta sono spente (`guidaPulsanti/guidaArgomenti: false`) tranne dove si provano: la guida blocca i clic veri sulla pagina.
- Porte CDP fisse: 9337, 9338, 9341, 9343. In caso di crash `killOnExit` chiude Chrome.
- `copyExtension()` esclude `tests`, `tools`, `docs`, `dist`, `.github`, i `.md` e i file di sistema.
- **Prima e dopo i test** controllare che non restino processi `Google Chrome` con `--user-data-dir` sotto `argo-didup-booster-tests`, e chiudere solo quelli, **mai il Chrome dell'utente**.

## Regole di lavoro

- **Mai** inserire credenziali o fare l'accesso al posto dell'utente.
- **Mai** usare il browser o le schede dell'utente senza un permesso esplicito; per le prove usare un Chrome headless separato con profilo temporaneo.
- La schermata dell'appello contiene dati di minori: non leggerla nemmeno con il permesso; al massimo la Home o la tabella delle ore.
- Prima di eliminare file, spostarli in `/Applications/Google Chrome Extensions/argo_didup_booster - file rimossi/<versione>/`, mai cancellarli definitivamente.
- Commit, push, tag e release solo se li chiede l'utente.

## Preferenze dell'utente

- L'icona deve restare quella **originale** (scuola bianca con bandierina su blu). Una nuova icona nella 2.5 non è piaciuta ed è stata tolta: non cambiare l'aspetto senza chiedere.
- Vuole decidere lui le scelte "di progetto" (es. git): chiedere prima di creare repository o fare commit.
- Niente orari fissi di una singola scuola: i dati vanno letti dalla pagina.
- Ogni azione automatica deve dire **cosa ha cliccato e cosa non ha trovato**: elenco dei passi nel pannello sotto i pulsanti. Niente `alert()`.
- L'icona dell'estensione serve solo ad arrivare ad Argo (accesso o registro già aperto) o alle impostazioni. Firma e Appello sono pulsanti nella pagina del registro; gli argomenti si scelgono dentro la pagina del registro.
- I pulsanti nella barra devono essere **allineati visivamente all'icona di aiuto** di DidUP; «Argomenti e compiti» **a destra sulla riga del titolo** del riquadro.
- Stile predefinito **«Simil Argo»**, primo nell'elenco degli stili.
- Ogni funzione aggiunta (Firma ora, Appello, Argomenti e compiti) si deve poter **togliere** dalle impostazioni.
- **Guida della prima volta** con sfondo scuro che dice che la funzione è dell'estensione «Argo DidUP Booster» e come funziona; poi mai più, salvo la casella nelle impostazioni (una per i pulsanti, una per Argomenti e compiti), che si spegne da sola dopo la visualizzazione.
- I pannelli che si aprono dai pulsanti si chiudono con un **clic fuori**.
- Un solo meccanismo di mantenimento della sessione, senza scelte per l'utente, che funzioni anche con il registro in un'altra scheda; **semplice**: ricaricare la pagina quando l'utente non la usa da qualche minuto, mai mentre lavora.
- Link al repository GitHub nelle impostazioni.
- Firma: non basta l'ora giusta, la riga deve essere **del docente** (nome e cognome), per le classi articolate.
- L'accesso deve essere completamente automatico (codice scuola, SPID/provider o CIE).

## Cronologia

| Versione | Cosa cambia |
|---|---|
| 2.1 | Pagina delle impostazioni (codice scuola, sessione, discipline e argomenti, export/import), icona generica. |
| 2.2 | Accesso automatico SPID/CIE fino alla pagina del provider; argomenti nella pagina del registro; nuovo popup; mantenimento della sessione con il ping autenticato (quello della 2.1 non funzionava). |
| 2.3 | Ricarica automatica (l'utente aveva ancora caricata la 2.1); clic sull'icona ovunque tranne nel registro; registro aperto con sessione scaduta → nuovo accesso; attesa delle pagine lente. |
| 2.4 | Firma e Appello partono da "Home", leggono gli orari dalla pagina (tolte le fasce orarie fisse) e mostrano i passi nel popup; canale del ponte versionato. |
| 2.5 | Conferma prima di firmare un'ora fuori dalla sua fascia oraria; README con immagini; CLAUDE.md; nuova icona; test spostati in `tests/`; ricarica automatica anche al clic sull'icona; pulizia dei file. |
| 2.6 | Tornata l'icona originale. Per ogni disciplina anche un elenco **Compiti**, oltre agli Argomenti, nelle impostazioni e nel pannello del registro. Nel menu delle discipline solo il nome. Le caselle si riconoscono dal campo DidUP collegato (correzione del doppio "Compiti"). Canale del ponte `v3`. |
| 1.0.0 | Nuovo nome «Argo DidUP Booster» e numerazione ripartita da 1.0.0 (dopo la 2.6). Sezione **Informazioni** nelle impostazioni (versione, commit, data del commit) con `tools/build-info.mjs`. Verificato il mantenimento della sessione con il ping: funziona, entrambi i metodi restano. |
| 1.0.1 | Versione in cima alle impostazioni; tolti commit e data (sezione Informazioni, `build-info.json`, `tools/` con gli hook git: spostati in `argo_didup_booster - file rimossi/`). Testo del codice scuola: «prima dell'accesso con SPID o CIE». README: installazione dallo zip dell'ultima release. |
| 1.1.0 | **Firma**: nelle classi articolate e in compresenza firma la propria riga (docente collegato, nome e cognome, icona) e verifica nel registro le ore che la Home dà per firmate. **Sessione**: un solo meccanismo dal service worker (`chrome.alarms` ogni minuto, anche con la scheda in secondo piano) che rinnova il token OIDC prima della scadenza e fa il ping; tolti intervallo e "Ricarica la pagina". **Popup tolto**: l'icona porta ad Argo o alle impostazioni; Firma e Appello sono pulsanti rotondi nella barra di DidUP con scritta al passaggio del mouse, pannello dei passi, posizione e 6 stili con anteprima nelle impostazioni (stesso stile per «Argomenti e compiti»). Canale del ponte `v4`. Permesso `alarms`. |
| 1.2.0 | **Sessione**: `login.js` spunta «Ricordami» (nuova impostazione `ricordami`, attiva) perché senza Argo rifiuta il rinnovo (`login_required`); il mantenimento ora **ricarica la pagina** dopo 10 minuti senza uso (conteggio di `sessione.js`, mai con una finestra di DidUP aperta), ricarica dopo 1 minuto se la sessione è scaduta, annota le scadenze e accorcia la soglia se il server chiude prima; tolti `signinSilent` dell'estensione, il ping e `relogin-tab`; testo «Mantieni attiva la sessione dopo l'accesso». **Pulsanti**: centrati sull'icona di aiuto (34 px), stile predefinito «Simil Argo» (bianco e arancione come l'aiuto) e primo nell'elenco, «Argomenti e compiti» a destra sulla riga del titolo, pannello dei passi che si chiude con un clic fuori. **Funzioni nel registro**: Firma ora, Appello e Argomenti e compiti si possono togliere. **Guide della prima volta** (sfondo scuro) per i pulsanti e per Argomenti e compiti, riattivabili dalle impostazioni. Link GitHub nelle impostazioni. **Rilascio automatico** con `.github/workflows/release.yml` (`argo_didup_booster-X.Y.Z.zip`). README e immagini aggiornati. |

## Punti aperti (non verificati sul registro vero)

Non sono mai stati provati con un accesso reale, ma solo sui DidUP finti costruiti dal bundle:
- scelta del profilo dopo SPID;
- pulsante "Argomenti e compiti" nella schermata di modifica lezione (e lettura del binding delle caselle), e il suo allineamento sulla legenda vera di Ext;
- controllo della sessione nelle schede già aperte;
- Firma e Appello sul DOM reale;
- **mantenimento 1.2.0:** effetto di «Ricordami» (rinnovo silenzioso di DidUP e ricarica con token scaduto senza SPID), riconoscimento del messaggio di sessione scaduta, che nella Home non resti visibile nessuna `.x-window` (bloccherebbe le ricariche), durata reale della sessione sul server (la vedrà l'utente in `sessionLog`);
- `userdata.descutente` come nome del docente, la classe `x-grid-cell-<id>` della colonna «Docente», l'aria-label delle icone delle righe altrui;
- posizione dei pulsanti nella barra vera (`.header`, `img[src*=help]`, `#intestazioneId`) e allineamento verticale con l'immagine dell'aiuto;
- guida della prima volta sul registro vero (aspetta che non ci siano `.x-mask`/`.x-window` visibili);
- il workflow di rilascio su GitHub (provato solo in locale).

Se l'utente segnala un problema, partire dal passo in rosso del pannello o dallo stato in Impostazioni → Sessione. Con il suo permesso, si può leggere la struttura della Home o della tabella delle ore senza cliccare nulla.
