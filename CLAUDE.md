# CLAUDE.md — Argo DidUP Booster

Note per riprendere il lavoro su questa estensione in una nuova sessione. La guida per gli utenti è in `README.md`.

## Per riprendere subito

1. **Leggere tutto questo file.** La memoria automatica di Claude Code è legata al percorso della cartella: se il progetto è stato spostato, quei vecchi appunti non vengono più caricati. Quello che serve è riportato qui.
2. **Controllare lo stato del repository:** `git log --oneline | head`, `git status` (rami `main` e `develop`, rilasci con git flow `Release-X.Y.Z`).
3. **Verificare che tutto funzioni:** `node tests/run-all.mjs`; con `--reali` prova anche l'accesso sulle pagine vere.
4. **Codice di DidUP.** È la fonte di tutto ciò che sappiamo del registro. Scaricarlo in una cartella temporanea, non nel progetto:
   - `curl -s https://www.portaleargo.it/voti/classic/app.js -o app.js` (circa 7 MB; si cerca con python o grep);
   - lo script della pagina di login è `https://www.portaleargo.it/assets/auth/js/main.<hash>.js` (l'hash si legge nell'HTML del login).

## Spostamento in un repository git (fatto)

Il 5/11/2026 la cartella è stata spostata da `ArgoDidUP-Extension` a `argo_didup_booster` ed è diventata un repository git. L'id dell'estensione è cambiato (vedi "Contesto"). Resta facoltativo aggiungere `"key"` al manifest per fissare l'id: va fatto insieme a un export/import delle impostazioni, perché aggiungere la chiave cambia l'id una volta.

## Contesto

- **Utente.** Docente italiano, scrive in italiano: **rispondere in italiano**. Vuole sapere cosa fa l'estensione passo per passo, senza scatole nere (vedi "Preferenze dell'utente").
- **Cartella.** `/Applications/Google Chrome Extensions/argo_didup_booster` (dal 5/11/2026), **repository git** (rami `main`/`develop`, git flow). Remoto su GitHub: `madxit/argo_didup_booster` (le release si scaricano da lì). Commit e push solo se li chiede l'utente. Identità git globale: Daniele Maddaluno.
- **Installazione dell'utente.** Chrome la carica come estensione **non pacchettizzata** dalla cartella stessa, profilo `Default`, id `mngjmlnclgjlaoihjnnalehdglhlifio`, modalità sviluppatore attiva. (Con la vecchia cartella l'id era `kifiencogghnmdalnckcjppkckjenecd`.)
- **Pubblico.** Docenti italiani di qualunque scuola. Niente dati di una scuola specifica nel codice: l'estensione originale era scritta per l'ITT Buzzi (codice `SG18328`), poi è stata resa generica.
- **Nome: «Argo DidUP Booster»** (fino alla 2.6 si chiamava «ArgoDidUP Assistant» / «Argo Assistant»). Non rinominare la cartella: cambierebbe l'id dell'estensione e l'utente perderebbe le impostazioni.
- **Identificatori interni.** Sono rimasti con il prefisso storico `argo-assistant` (`data-argo-assistant*`, eventi `argo-assistant:request:v4`, `dataset.argoAssistant*`, `__argoAssistant*`). Non si vedono e cambiarli lascerebbe doppioni nelle schede già aperte.
- **Versione attuale: 1.1.0.** La numerazione è ripartita da 1.0.0 con il cambio di nome (prima era 2.6). **Alzare `version` in `manifest.json` a ogni modifica del codice** (`MAJOR.MINOR.PATCH`): la ricarica automatica scatta quando la versione su disco è *diversa* da quella caricata, quindi va bene anche il passaggio 2.6 → 1.0.0.
- **File tolti.** Stanno nella cartella sorella `argo_didup_booster - file rimossi/` (nella 1.1.0: `1.1.0/` con popup, `style.css`, `keepalive.js` e le immagini del popup). Nella revisione 2.5/2.6:
  - i `desktop.ini` di Google Drive;
  - `images/logo-didup.png`, non usato;
  - `.DS_Store`;
  - `icona-precedente/` (copia dell'icona originale, che è quella in uso);
  - `icona-scartata/` (icona della 2.5, non piaciuta all'utente).

## Struttura dei file

| File | Ruolo |
|---|---|
| `manifest.json` | MV3. Permessi `storage`, `alarms`, `activeTab`, `scripting`, `clipboardWrite`; host `https://*.portaleargo.it/*`, `https://eid.istruzione.it/*`. **Nessun popup** (dalla 1.1.0): il clic sull'icona arriva sempre a `onClicked`. |
| `settings.js` | Modulo condiviso da service worker, impostazioni e content script (variabili `var` di primo livello, così si può reiniettare). Contiene: `DEFAULT_SETTINGS`, `SPID_PROVIDERS` (12 id), validazione ed import/export, riconoscimento degli URL (`isArgoDashboardUrl` = percorso `/voti*`), `loginFlow`, `reloadIfStale()`, costanti del mantenimento (`KEEPALIVE_PING_EVERY_SEC=240`, `KEEPALIVE_RENEW_BEFORE_SEC=600`), aspetto dei pulsanti (`BUTTON_POSITIONS`, `BUTTON_THEMES` con variabili CSS `--b-*`, `buttonThemeCss()`, `BOOSTER_ICONS`, `BOOSTER_ACTIONS`, `boosterButtonsCss()`, `boosterPillCss()`, `boosterButtonHtml()`: gli stessi nel registro e nell'anteprima delle impostazioni). |
| `background.js` | Service worker: badge "!" se manca il codice, clic sull'icona (`handleIconClick`), `goToRegistro()`, controllo della sessione nelle schede aperte, **mantenimento della sessione** (`chrome.alarms` ogni minuto → `keepAliveTick` → `keepAliveInPage` nel mondo MAIN), iniezione degli script dopo un aggiornamento, `clearPopups()` (toglie i popup per scheda delle versioni ≤ 1.0), ripresa dopo la ricarica automatica. |
| `toolbar.js` | Pulsanti rotondi **Firma ora** / **Appello** nella barra in alto di DidUP (elemento `position:fixed` sopra la barra, non dentro il layout Ext; z-index 10000, sotto le finestre Ext). Posizione ricalcolata ogni 600 ms: a destra prima del gruppo aiuto/profilo, al centro, a sinistra dopo il testo di `#intestazioneId`; se la barra è nascosta, in basso a destra. Pannello dei passi (`[data-argo-assistant="run"]`) con domanda Sì/No (chiusura o 2 minuti = no). Avviso «Sessione scaduta» con «Accedi di nuovo» (`relogin-tab`). |
| `options.html/js/css` | Impostazioni, salvate a ogni modifica: scuola e accesso, sessione (solo on/off + stato dettagliato), **pulsanti nel registro** (posizione, 6 stili, anteprima con i pulsanti veri in shadow DOM), discipline con due elenchi ordinabili (schede "Argomenti" e "Compiti", `currentKind`), export/import JSON (`argo-didup-booster-impostazioni-AAAA-MM-GG.json`), URL avanzati. La **versione** (dal manifest) è nella barra in cima (`#info-version`). |
| `page-bridge.js` | Script nel **mondo MAIN**: unico punto che usa gli oggetti di DidUP (Ext JS). Canale versionato `argo-assistant:request:v4` / `response:v4`. Funzioni: `session`, `ping`, `info`, `fields`, `insert`, `dashboardLessons`, `registroLessons` (righe con `index`, `docente`, `mia`, più `utente`), `utente`, `goHome`, `viewVisible`. |
| `content-common.js` | `callPageBridge()`, `waitForElement()`, `assistantToast` (shadow DOM; `actions`, `onDismiss`), `PAGE_BRIDGE_CHANNEL='v4'`. |
| `login.js` | Pagine Argo: compila `#customer_code` e preme `a.button-spid`; sceglie il profilo (`.selectable-identity`); chiude `loginFlow` quando il registro ha le credenziali; anti-ripetizione di 90 s con "Riprova". |
| `eid.js` | `eid.istruzione.it/eid-gateway`: provider `a[href*="/sp/idps/spid/<id>/"]` (l'ordine in pagina cambia ogni volta) oppure CIE `a[href*="/sp/idps/cie/"]`. Agisce solo se `loginFlow.stage==='eid'`. |
| `argomenti.js` | Pulsante "Argomenti e compiti" accanto all'intestazione "Registro di classe · Docenti ed alunni" della schermata di modifica lezione. Il pannello ha il menu delle discipline (solo i nomi) e le schede Argomenti/Compiti con i conteggi. Argomento → casella `desArgomento` ("Attività svolta"); compito → la casella `desCompiti`/`desCompiti2`/`desCompiti3` visibile (scheda aperta). Le caselle si riconoscono con `fields` dal campo collegato, **non dalla posizione**: la 2.5 le contava per posizione e prendeva anche la scheda "Compiti" nascosta, da cui "Compiti, Compiti" con uno che non funzionava. Inserimento tramite il ponte (`setValue` di Ext, separatore `\n`, massimo 500 caratteri). |
| `azioni.js` | Motore di **Firma ora** e **Appello** (`ArgoAzioni.esegui(action, onStep, { ask, docenteNome, now })`), avviato da `toolbar.js`. Riconosce la riga del docente (`assegnaRighe`, `sameName`). |
| `icon/` | `icon16/32/48/128.png` + `icon.svg`: l'icona originale (scuola bianca con bandierina su blu). L'utente preferisce questa: non cambiarla senza chiedere. |
| `docs/img/` | Immagini del README: si rigenerano con `node tests/screenshots.mjs` (usa il DidUP finto con un fuso orario emulato in cui sono le 10). |
| `tests/` | Test e strumenti di sviluppo (vedi "Test"). Chrome ignora questa cartella; la si può omettere quando si distribuisce l'estensione. |

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

### Pulsanti nel registro (dalla 1.1.0, al posto del popup)

Richiesta dell'utente: l'icona dell'estensione serve solo ad arrivare ad Argo o alle impostazioni; Firma e Appello sono pulsanti rotondi con icona nella barra di DidUP, con la scritta al passaggio del mouse. Posizione (`buttonsPosition`: `right` predefinita, `center`, `left`) e stile (`buttonsTheme`: `vivid` predefinito, `contrast`, `sepia`, `light`, `dark`, `argo`) si scelgono nelle impostazioni con anteprima. Lo stesso stile vale per il pulsante «Argomenti e compiti». Il puntino colorato (`--b-mark`) indica che il pulsante è dell'estensione (trasparente in «Simil Argo»).

### Ricarica automatica

- **Il problema.** Per un'estensione non pacchettizzata Chrome rilegge dal disco la pagina delle impostazioni a ogni apertura. Service worker e content script restano invece quelli caricati finché l'estensione non viene ricaricata.
- **Il controllo.** `reloadIfStale(after)` confronta `chrome.runtime.getManifest().version` con il `manifest.json` sul disco. Se sono diversi chiama `chrome.runtime.reload()` (funziona solo con la modalità sviluppatore attiva).
- **Dove gira.** Nelle impostazioni e al clic sull'icona.
- **La ripresa.** `selfReload` vale `{from, to, at, after, handled}` e ha una protezione di 60 s contro le ricariche a ripetizione. `resumeAfterSelfReload()`, chiamata in `onInstalled`, esegue `icon-click` (ripete il clic sulla scheda `tabId`), `go-registro` oppure `open-options`.
- **Verificare la versione caricata dall'utente.** Guardare `~/Library/Application Support/Google/Chrome/Default/Secure Preferences` → `extensions.settings.<id>.active_permissions`. Leggere solo quella voce.

### Mantenimento della sessione (rifatto nella 1.1.0)

- **Come funziona DidUP.** Due credenziali:
  - il token OIDC (`Authorization: Bearer`, oidc-client 1.x, utente in `sessionStorage`, durata ~60 min, nessun refresh token nella versione web). DidUP lo rinnova da solo con `addAccessTokenExpiring` → `signinSilent()` (iframe su `redirect_uri` = `/voti/oidc-callback.html?classic`, `prompt=none`) → `WSX.util.handleAuthSessionRenewed(user)`; se fallisce mostra `box-sessione-scaduta-view`;
  - la sessione applicativa (`x-auth-token`, `uid` di POST `login`), che il server chiude senza richieste. Quando nessuno la usa, DidUP **non fa richieste periodiche**.
- **Perché la 1.0 non bastava** (log `keepAliveStatus` dell'utente, 5-6/11/2026): con il ping tutte risposte 200 per ~60 minuti, poi 401 (60,5 e 64,8 minuti dopo l'avvio). La ricarica della pagina non rinnova nulla: al caricamento DidUP rilegge lo stesso utente OIDC da `sessionStorage`. Il ping tiene viva solo la sessione applicativa; il limite era il token.
- **Unico meccanismo (nessuna scelta per l'utente).** `chrome.alarms` `argo-keepalive` ogni minuto (gira anche con la scheda in secondo piano, il service worker si risveglia). Per ogni scheda del registro non scartata, `keepAliveInPage(pingEveryMs, renewBeforeSec)` nel mondo MAIN:
  1. `WSX.util.userManager.getUser()`; se `expires_in ≤ 600 s` → `signinSilent()` (al massimo un tentativo ogni 50 s) e `handleAuthSessionRenewed`;
  2. ogni 4 minuti (o subito dopo un rinnovo) GET `archiviostampe/struttura` con gli header di `Ext.Ajax.getDefaultHeaders()`; 401/402/406 = scaduta.
  Lo stato tra un giro e l'altro sta in `window.__argoBoosterKa` della pagina. Alla prima scadenza il service worker manda `argo-session-expired` alla scheda (avviso con «Accedi di nuovo»). `autoDiscardable:false` sulle schede del registro finché il mantenimento è attivo.
- **Impostazioni rimaste:** solo `keepAliveEnabled`. `keepAliveInterval` e `keepAliveMethod` sono stati tolti (nell'import vengono ignorati).
- **Da verificare sul registro vero:** se `signinSilent` riesce davvero (dipende dalla sessione di accesso su `auth.portaleargo.it`: se Argo non la ricorda, risponde `login_required` e serve un nuovo accesso SPID). Lo stato in Impostazioni → Sessione mostra l'esito (`renewError`, `lastRenewAt`, `tokenExpiresAt`).

### Canale del ponte

Dopo un aggiornamento, nelle schede già aperte resta anche il ponte vecchio. Per questo il canale CustomEvent ha una versione: così ponte vecchio e nuovo non rispondono entrambi (un "insert" verrebbe fatto due volte). **Se il ponte cambia, aumentare `CHANNEL`** in `page-bridge.js` e `PAGE_BRIDGE_CHANNEL` in `content-common.js`.

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
   - **Conferma** (richiesta dall'utente): un'ora la cui fascia **non contiene l'ora attuale**, o con orario non noto, si firma solo dopo un "sì". La domanda compare nel pannello dei passi di `toolbar.js` (chiusura del pannello o 2 minuti senza risposta = "no"). Se in un blocco solo un'ora è in corso, si può firmare solo quella.
6. **Appello.**
   - Si entra nel registro **dalla lezione scelta**: DidUP seleziona quella riga.
   - Poi clic su `.menu-registro-appello`. Il pulsante è attivo solo se la riga è tua e firmata, oppure se sei coordinatore o docente della classe; altrimenti l'errore lo spiega.
   - La schermata dell'appello è `appello-classe-view`.
7. **Esito:** `esegui` restituisce `{ok, cancelled?, summary | error, steps}`; i passi (`{text, kind: ok|warn|ask|error}`) arrivano a `onStep` e vanno nel pannello.

## Struttura di DidUP (dal bundle pubblico)

Il bundle è `https://www.portaleargo.it/voti/classic/app.js`, circa 7 MB, Ext JS 6 classic. Le informazioni sotto vengono da lì; dove serve si scarica con curl e si cerca nel testo.

- **Accesso.** oidc-client; il token sta nel `sessionStorage` della scheda; le API usano gli header `Authorization: Bearer` e `x-auth-token`, letti con `Ext.Ajax.getDefaultHeaders()`. Sessione scaduta = risposta 401, 402 o 406. `getUrlBase()` è globale.
- **Home.** POST `dashboard/loaddati` → `classiDocente`. Il clic su `span[id^=ora_]` chiama `onClickPanel` → `selezionaClasse` → `push('registro-main-view')`.
- **Registro.** `attivita-view`, griglia `grid-attivita`, store `attivita` (modello `AttivitaModel`: `numOra`, `flgPresente`, `anagrafePK`, `nominativoDocente`, `materia`, `libera`, `oraInizioFine`…). Colonne: ORA (nascosta), FIRMA (`renderIconaFirma`), **Docente** (`nominativoDocente`, più « (SUPPLENZA)» e il sostituito), Materia, Attività svolta, Compiti. `cellclick` sulla colonna FIRMA (indice 1) → `clickFirmaOra` (interruttore: firma o toglie la firma). `renderIconaFirma`: arancione `icon-ora-da-firmare` solo se `anagrafePK == getAnagrafePK()`; righe altrui firmate = `icon-ora-firmata` con aria-label «N° ora firmata da un altro docente…».
- **Utente collegato.** `WSX.app.getMainView().getViewModel().getStore('userdata').getAt(0)`: campi `user`, `uid`, `descutente` (si presume «COGNOME NOME»: non verificato), `anagrafePK`, `ruoli`…
- **Barra in alto.** `WSX.view.main.HeaderPanel` (`headerpnl`): pannello `.header` alto 58 px con `.logo_programma` e `#intestazioneId` a sinistra; a destra «Aggiorna APP» (di solito nascosto), aiuto (`btnNews`, `img` `…/help2.png`) e profilo (`.btn-profile`). Nascosta con `maximized` o accesso tramite token.
- **Modifica lezione.** `attivita-dettaglio-view` / `attivita-dettaglio-tabview`. Nel fieldset "Registro di classe" c'è un tabpanel con "Attività svolta" (`theAttivita.desArgomento`) e un tabpanel `tabCompiti` con le schede "Compiti": `panelCompiti` → `desCompiti`; `panelCompiti2`/`panelCompiti3` sono nascoste finché il docente non ne aggiunge una (+) → `desCompiti2`/`desCompiti3`. Massimo 500 caratteri. Il binding si legge da `cmp.getBind().value.stub.path` o da `cmp.initialConfig.bind.value`.
- **Login Argo.** `#spidForm` (POST `/auth/eid-gateway/sso`), `#customer_code`, `a.button-spid`; scelta del profilo `.selectable-identity[data-username][data-customer_code]` (script `assets/auth/js/main.*.js`).

## Dati salvati (`chrome.storage.local`)

- **Impostazioni** (chiavi di `DEFAULT_SETTINGS`): `codiceScuola`, `loginMethod`, `spidProvider`, `autoLogin`, `docenteNome`, `keepAliveEnabled`, `buttonsPosition`, `buttonsTheme`, `discipline[{nome, argomenti[], compiti[]}]` (`TIPI_VOCE` in settings.js; i file senza `compiti` vengono completati con un elenco vuoto), `argoLoginUrl`, `argoDashboardPattern`, `basePortalUrl`, più `schemaVersion`.
- **Stato:** `loginFlow`, `keepAliveStatus` (`{time, tabId, ok, expired, action: ping|renew|check, httpStatus, tokenExpiresAt, lastRenewAt, renewError, error, noOidc}`), `selfReload`, `ui_lastDisciplina`, `ui_lastTipo` (ultima scheda del pannello).
- **Migrazione.** Alla prima esecuzione si recuperano alcuni campi da `storage.sync` della versione originale.

## Messaggi `runtime`

- **Al service worker:** `open-options`, `go-registro`, `relogin-tab` (dall'avviso di sessione scaduta: rifà l'accesso nella scheda mittente).
- **Ai content script:** `argo-login-now`, `argo-session-expired` (`{text}`, mostrato da `toolbar.js`).

## Test

Servono Node 20+ (provato con la 26) e Google Chrome. Tutto in `tests/`: profili, copie dell'estensione e screenshot finiscono in `$TMPDIR/argo-didup-booster-tests`.

| Comando | Cosa prova |
|---|---|
| `node tests/run-all.mjs` | Esegue in sequenza le quattro suite qui sotto. |
| `node tests/test-impostazioni.mjs` | Pagina delle impostazioni (finto `chrome.*`, server locale). |
| `node tests/test-funzioni.mjs` | Accesso su un login Argo ed eid finti, mantenimento della sessione (`keepAliveInPage` con un finto `userManager`, `keepAliveTick` con gli allarmi), argomenti nel registro, service worker (clic sull'icona), ricarica automatica. |
| `node tests/test-firma-appello.mjs` | `azioni.js` e `toolbar.js` su `tests/mock/didup-mock.html` (DidUP finto con barra in alto, menu, Home, registro, Appello; opzioni `articolata`, `homeFirmataDaAltri`, `utente`, `docenteRiga`, `pk`), compresa la conferma fuori orario, le classi articolate, posizione e stile dei pulsanti. |
| `node tests/test-estensione-vera.mjs` | Estensione **vera** (mondo isolato, pulsanti nella pagina, service worker reale, fuso orario emulato) contro il DidUP finto servito come `https://www.portaleargo.it` (host dirottato e certificato usa e getta creato con openssl). |
| `node tests/test-siti-reali.mjs [stale\|click\|onlogin]` (oppure `run-all.mjs --reali`) | Percorso di accesso sulle **pagine vere** di Argo ed eid con il codice pubblico `SG18328`. Si ferma alla pagina del provider (Poste ID, InfoCert, CIE) **senza credenziali**. |
| `node tests/screenshots.mjs` | Rigenera `docs/img/*.png` con dati di fantasia. |

**Note tecniche:**
- Google Chrome ignora `--load-extension`: l'estensione vera si carica con `--remote-debugging-pipe --enable-unsafe-extension-debugging` e CDP `Extensions.loadUnpacked` (`tests/lib/cdp-pipe.mjs`).
- Per provare `chrome.runtime.reload()` serve la modalità sviluppatore: `enableDevMode()` da `chrome://extensions`.
- I test con il finto `chrome.*` (`tests/mock/mock-chrome.js`) girano nel mondo della pagina; `prepareMockExtension()` aggiunge il mock alle impostazioni.
- Porte CDP fisse: 9337, 9338, 9341, 9343. In caso di crash `killOnExit` chiude Chrome.
- **Prima e dopo i test** controllare che non restino processi `Google Chrome` con `--user-data-dir` sotto `argo-didup-booster-tests`, e chiudere solo quelli, **mai il Chrome dell'utente**.

## Regole di lavoro

- **Mai** inserire credenziali o fare l'accesso al posto dell'utente.
- **Mai** usare il browser o le schede dell'utente senza un permesso esplicito; per le prove usare un Chrome headless separato con profilo temporaneo.
- La schermata dell'appello contiene dati di minori: non leggerla nemmeno con il permesso; al massimo la Home o la tabella delle ore.
- Prima di eliminare file, spostarli in `ArgoDidUP-Extension - file rimossi/`, mai cancellarli definitivamente.

## Preferenze dell'utente

- L'icona deve restare quella **originale** (scuola bianca con bandierina su blu). Una nuova icona nella 2.5 non è piaciuta ed è stata tolta: non cambiare l'aspetto senza chiedere.
- Vuole decidere lui le scelte "di progetto" (es. git): chiedere prima di creare repository o fare commit.
- Niente orari fissi di una singola scuola: i dati vanno letti dalla pagina.
- Ogni azione automatica deve dire **cosa ha cliccato e cosa non ha trovato**: elenco dei passi nel pannello sotto i pulsanti. Niente `alert()`.
- L'icona dell'estensione serve solo ad arrivare ad Argo (accesso o registro già aperto) o alle impostazioni. Firma e Appello sono pulsanti nella pagina del registro; gli argomenti si scelgono dentro la pagina del registro.
- Un solo meccanismo di mantenimento della sessione, senza scelte per l'utente, che funzioni anche con il registro in un'altra scheda.
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
| 1.1.0 | **Firma**: nelle classi articolate e in compresenza firma la propria riga (docente collegato, nome e cognome, icona) e verifica nel registro le ore che la Home dà per firmate. **Sessione**: un solo meccanismo dal service worker (`chrome.alarms` ogni minuto, anche con la scheda in secondo piano) che rinnova il token OIDC prima della scadenza e fa il ping; tolti intervallo e "Ricarica la pagina". **Popup tolto**: l'icona porta ad Argo o alle impostazioni; Firma e Appello sono pulsanti rotondi nella barra di DidUP con scritta al passaggio del mouse, pannello dei passi, posizione e 6 stili con anteprima nelle impostazioni (stesso stile per «Argomenti e compiti»). Canale del ponte `v4`. Permesso `alarms`. |
| 1.0.1 | Versione in cima alle impostazioni; tolti commit e data (sezione Informazioni, `build-info.json`, `tools/` con gli hook git: spostati in `argo_didup_booster - file rimossi/`). Testo del codice scuola: «prima dell'accesso con SPID o CIE». README: installazione dallo zip dell'ultima release. |

## Punti aperti (non verificati sul registro vero)

Non sono mai stati provati con un accesso reale, ma solo sui DidUP finti costruiti dal bundle:
- scelta del profilo dopo SPID;
- pulsante "Argomenti e compiti" nella schermata di modifica lezione (e lettura del binding delle caselle);
- efficacia del mantenimento della sessione;
- controllo della sessione nelle schede già aperte;
- Firma e Appello sul DOM reale;
- rinnovo del token con `signinSilent` dal mantenimento della sessione (dipende da Argo: guardare `renewError` nello stato);
- `userdata.descutente` come nome del docente, la classe `x-grid-cell-<id>` della colonna «Docente», l'aria-label delle icone delle righe altrui;
- posizione dei pulsanti nella barra vera (`.header`, `img[src*=help]`, `#intestazioneId`).

Se l'utente segnala un problema, partire dal passo in rosso del pannello. Con il suo permesso, si può leggere la struttura della Home o della tabella delle ore senza cliccare nulla.
