# CLAUDE.md — Argo DidUP Booster

Note per riprendere il lavoro su questa estensione in una nuova sessione. La guida per gli utenti è in `README.md`.

## Per riprendere subito

1. **Leggere tutto questo file.** La memoria automatica di Claude Code è legata al percorso della cartella: se il progetto è stato spostato, quei vecchi appunti non vengono più caricati. Quello che serve è riportato qui.
2. **Controllare dove sta adesso il progetto.**
   - L'utente voleva spostarlo in un repository git subito dopo la versione 1.0.0.
   - Se il percorso non è più `/Applications/Google Chrome Extensions/ArgoDidUP-Extension`, è avvenuto lo spostamento: seguire la checklist "Spostamento in un repository git" e aggiornare la sezione "Contesto".
   - Dove c'è git: `git log --oneline | head`, `git status`.
3. **Verificare che tutto funzioni:** `node tests/run-all.mjs`; con `--reali` prova anche l'accesso sulle pagine vere.
4. **Codice di DidUP.** È la fonte di tutto ciò che sappiamo del registro. Scaricarlo in una cartella temporanea, non nel progetto:
   - `curl -s https://www.portaleargo.it/voti/classic/app.js -o app.js` (circa 7 MB; si cerca con python o grep);
   - lo script della pagina di login è `https://www.portaleargo.it/assets/auth/js/main.<hash>.js` (l'hash si legge nell'HTML del login).

## Spostamento in un repository git (checklist)

La cartella è stata lasciata **senza git** su richiesta dell'utente, che la sposterà lui in un repository. Fare questi passaggi nell'ordine:

1. **Prima di spostare: esportare le impostazioni** (Impostazioni → *Esporta impostazioni*).
   - I dati in `chrome.storage.local` (codice scuola, discipline, argomenti, compiti) sono legati all'**id dell'estensione**.
   - Per un'estensione non pacchettizzata senza `"key"` nel manifest, l'id si calcola dal percorso della cartella.
   - Spostando la cartella l'id cambia e la nuova installazione parte vuota.
2. **Spostare la cartella.** In `chrome://extensions` rimuovere la vecchia voce, che punta al percorso che non esiste più. Poi *Carica estensione non pacchettizzata* dal nuovo percorso e infine Impostazioni → *Importa* → *Sostituisci tutto*.
3. **Nel repository:**
   - `.gitignore` è già pronto (`.DS_Store`, `desktop.ini`). Gli hook git per commit e data (`tools/`, `build-info.json`) sono stati tolti nella 1.0.1: non servono più.
4. **Facoltativo ma consigliato:** aggiungere `"key"` al manifest. L'id resta così fisso anche cambiando cartella o computer. Va fatto insieme a un export/import, perché anche aggiungere la chiave cambia l'id una volta.
5. **Aggiornare questo file:** percorso, id dell'estensione (si trova in `chrome://extensions` o in `Secure Preferences`) e la riga "Non è un repository git".
6. **Cartella dei file rimossi.** `ArgoDidUP-Extension - file rimossi/` è accanto alla cartella vecchia: non va nel repository, l'utente decide se tenerla.

## Contesto

- **Utente.** Docente italiano, scrive in italiano: **rispondere in italiano**. Vuole sapere cosa fa l'estensione passo per passo, senza scatole nere (vedi "Preferenze dell'utente").
- **Cartella.** `/Applications/Google Chrome Extensions/ArgoDidUP-Extension` (al 5/11/2026). **Non è un repository git**: l'utente ha scelto di non inizializzarlo qui e lo sposterà lui in un repository (vedi checklist). In ogni caso: commit e push solo se li chiede l'utente. Identità git globale: Daniele Maddaluno.
- **Installazione dell'utente.** Chrome la carica come estensione **non pacchettizzata** dalla cartella stessa, profilo `Default`, id `kifiencogghnmdalnckcjppkckjenecd`, modalità sviluppatore attiva.
- **Pubblico.** Docenti italiani di qualunque scuola. Niente dati di una scuola specifica nel codice: l'estensione originale era scritta per l'ITT Buzzi (codice `SG18328`), poi è stata resa generica.
- **Nome: «Argo DidUP Booster»** (fino alla 2.6 si chiamava «ArgoDidUP Assistant» / «Argo Assistant»). La cartella resta `ArgoDidUP-Extension`: cambiarla cambierebbe l'id dell'estensione e l'utente perderebbe le impostazioni.
- **Identificatori interni.** Sono rimasti con il prefisso storico `argo-assistant` (`data-argo-assistant*`, eventi `argo-assistant:request:v3`, `dataset.argoAssistant*`, `__argoAssistant*`). Non si vedono e cambiarli lascerebbe doppioni nelle schede già aperte.
- **Versione attuale: 1.0.1.** La numerazione è ripartita da 1.0.0 con il cambio di nome (prima era 2.6). **Alzare `version` in `manifest.json` a ogni modifica del codice** (`MAJOR.MINOR.PATCH`): la ricarica automatica scatta quando la versione su disco è *diversa* da quella caricata, quindi va bene anche il passaggio 2.6 → 1.0.0.
- **File tolti nella revisione.** Stanno nella cartella sorella `ArgoDidUP-Extension - file rimossi/`:
  - i `desktop.ini` di Google Drive;
  - `images/logo-didup.png`, non usato;
  - `.DS_Store`;
  - `icona-precedente/` (copia dell'icona originale, che è quella in uso);
  - `icona-scartata/` (icona della 2.5, non piaciuta all'utente).

## Struttura dei file

| File | Ruolo |
|---|---|
| `manifest.json` | MV3. Permessi `storage`, `activeTab`, `scripting`, `clipboardWrite`; host `https://*.portaleargo.it/*`, `https://eid.istruzione.it/*`. **Nessun `default_popup`**: il popup viene impostato per scheda. |
| `settings.js` | Modulo condiviso da service worker, popup, impostazioni e content script (variabili `var` di primo livello, così si può reiniettare). Contiene: `DEFAULT_SETTINGS`, `SPID_PROVIDERS` (12 id), validazione ed import/export, riconoscimento degli URL (`isArgoDashboardUrl` = percorso `/voti*`), `loginFlow`, `reloadIfStale()`. |
| `background.js` | Service worker: badge "!" se manca il codice, popup solo nelle schede del registro, `goToRegistro()`, controllo della sessione nelle schede aperte, iniezione degli script dopo un aggiornamento, ripresa dopo la ricarica automatica. |
| `popup.html/js`, `style.css` | Popup (320 px): riquadri Firma/Appello, stato della sessione, pannello dei passi con domanda di conferma; viste di ripiego "login" e "fuori da Argo". |
| `options.html/js/css` | Impostazioni, salvate a ogni modifica: scuola e accesso, sessione, discipline con due elenchi ordinabili (schede "Argomenti" e "Compiti", `currentKind`), export/import JSON (`argo-didup-booster-impostazioni-AAAA-MM-GG.json`), URL avanzati. La **versione** (dal manifest) è nella barra in cima (`#info-version`). |
| `page-bridge.js` | Script nel **mondo MAIN**: unico punto che usa gli oggetti di DidUP (Ext JS). Canale versionato `argo-assistant:request:v3` / `response:v3`. Funzioni: `session`, `ping`, `info`, `fields`, `insert`, `dashboardLessons`, `registroLessons`, `goHome`, `viewVisible`. |
| `content-common.js` | `callPageBridge()`, `waitForElement()`, `assistantToast` (shadow DOM; `actions`, `onDismiss`), `PAGE_BRIDGE_CHANNEL='v3'`. |
| `login.js` | Pagine Argo: compila `#customer_code` e preme `a.button-spid`; sceglie il profilo (`.selectable-identity`); chiude `loginFlow` quando il registro ha le credenziali; anti-ripetizione di 90 s con "Riprova". |
| `eid.js` | `eid.istruzione.it/eid-gateway`: provider `a[href*="/sp/idps/spid/<id>/"]` (l'ordine in pagina cambia ogni volta) oppure CIE `a[href*="/sp/idps/cie/"]`. Agisce solo se `loginFlow.stage==='eid'`. |
| `keepalive.js` | Mantenimento della sessione: ping con le credenziali dell'app (`archiviostampe/struttura`), oppure ricarica della pagina se non è in uso. Scrive `keepAliveStatus`. |
| `argomenti.js` | Pulsante "Argomenti e compiti" accanto all'intestazione "Registro di classe · Docenti ed alunni" della schermata di modifica lezione. Il pannello ha il menu delle discipline (solo i nomi) e le schede Argomenti/Compiti con i conteggi. Argomento → casella `desArgomento` ("Attività svolta"); compito → la casella `desCompiti`/`desCompiti2`/`desCompiti3` visibile (scheda aperta). Le caselle si riconoscono con `fields` dal campo collegato, **non dalla posizione**: la 2.5 le contava per posizione e prendeva anche la scheda "Compiti" nascosta, da cui "Compiti, Compiti" con uno che non funzionava. Inserimento tramite il ponte (`setValue` di Ext, separatore `\n`, massimo 500 caratteri). |
| `azioni.js` | Motore di **Firma ora** e **Appello** (`ArgoAzioni.esegui`) e collegamento con il popup (porta `argo-azione`). |
| `icon/` | `icon16/32/48/128.png` + `icon.svg`: l'icona originale (scuola bianca con bandierina su blu). L'utente preferisce questa: non cambiarla senza chiedere. |
| `docs/img/` | Immagini del README: si rigenerano con `node tests/screenshots.mjs`. |
| `tests/` | Test e strumenti di sviluppo (vedi "Test"). Chrome ignora questa cartella; la si può omettere quando si distribuisce l'estensione. |

## Flussi principali

### Accesso

1. **Clic sull'icona fuori dal registro.** `chrome.action.onClicked` → `reloadIfStale` → `goToRegistro(tab)`:
   - **pagina di login di Argo:** messaggio `argo-login-now` a `login.js`;
   - **registro già aperto:** controllo della sessione con `chrome.scripting.executeScript` nel mondo MAIN (`probeDidupSession`). Se la sessione è valida lo mette in primo piano; se è `expired` o `not-logged` rifà l'accesso in quella scheda;
   - **altra pagina Argo:** la riporta a `/voti/`;
   - **nessuna scheda Argo:** ne apre una nuova su `basePortalUrl`.
2. **Passaggi di `loginFlow`** (in `storage.local`, validità di 3 minuti):
   - `argo`: richiesto dal clic sull'icona;
   - `eid`: impostato da `login.js` subito prima di premere SPID;
   - `idp`: impostato da `eid.js` (vale una volta sola).
3. `/voti/` non ancora autenticato rimanda a `www.portaleargo.it/auth/sso/login/?login_challenge=…` (OIDC, hydra). Anche quell'URL corrisponde allo schema "registro": per questo `login.js` chiude il flusso **solo** quando il ponte risponde `session === 'logged'`.

### Popup

È impostato per scheda (`chrome.action.setPopup`) **solo sugli URL del registro**. Senza il permesso "tabs" gli URL degli altri siti non sono visibili, quindi altrove il clic arriva a `onClicked`.

### Ricarica automatica

- **Il problema.** Per un'estensione non pacchettizzata Chrome rilegge dal disco popup e impostazioni a ogni apertura. Service worker e content script restano invece quelli caricati finché l'estensione non viene ricaricata.
- **Il controllo.** `reloadIfStale(after)` confronta `chrome.runtime.getManifest().version` con il `manifest.json` sul disco. Se sono diversi chiama `chrome.runtime.reload()` (funziona solo con la modalità sviluppatore attiva).
- **Dove gira.** Nel popup, nelle impostazioni e al clic sull'icona.
- **La ripresa.** `selfReload` vale `{from, to, at, after, handled}` e ha una protezione di 60 s contro le ricariche a ripetizione. `resumeAfterSelfReload()`, chiamata in `onInstalled`, esegue `go-registro` oppure `open-options`.
- **Verificare la versione caricata dall'utente.** Guardare `~/Library/Application Support/Google/Chrome/Default/Secure Preferences` → `extensions.settings.<id>.active_permissions`. Leggere solo quella voce.

### Mantenimento della sessione (verificato il 5/11/2026)

- **Come funziona DidUP.** Il token OIDC lo rinnova DidUP da solo (`addAccessTokenExpiring` → `signinSilent`). La sessione applicativa è l'`x-auth-token` (`uid` restituito da POST `login`). Quando nessuno la usa, DidUP **non fa richieste periodiche**.
- **Il ping.** Rifà una richiesta autenticata identica a quelle del registro: tutti gli header di `Ext.Ajax.getDefaultHeaders()`, GET `archiviostampe/struttura`.
- **La prova.** Nella `storage.local` dell'utente (`keepAliveStatus`, chiave `000003.log`) ci sono 37 ping, tutti con risposta 200 e nessuna scadenza. Tra le 01:02 e le 01:50 del 5/11 hanno risposto 200 per 48 minuti senza alcun ricaricamento della pagina.
- **Il limite.** Non si conosce il timeout di inattività del server Argo. Una prova definitiva richiede di lasciare il registro fermo senza mantenimento finché scade.
- **Decisione.** L'utente aveva chiesto di togliere il ping se non funzionava: dato che funziona, entrambi i metodi sono rimasti.

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
   - Clic **solo** sulle icone `.icon-ora-da-firmare` dentro `.x-grid-item`. In DidUP il clic su un'ora firmata apre "Conferma elimina firma", quindi non va mai fatto.
   - Firma il blocco di ore consecutive tue nella stessa classe, una alla volta, aspettando che ognuna diventi `icon-ora-firmata`.
   - **Conferma** (richiesta dall'utente): un'ora la cui fascia **non contiene l'ora attuale**, o con orario non noto, si firma solo dopo un "sì". La domanda va nel popup (`ask`/`answer` sulla porta); se il popup è chiuso, compare in un avviso nella pagina con pulsanti (`askInPage`, 2 minuti di attesa, poi "no"). Se in un blocco solo un'ora è in corso, si può firmare solo quella.
6. **Appello.**
   - Si entra nel registro **dalla lezione scelta**: DidUP seleziona quella riga.
   - Poi clic su `.menu-registro-appello`. Il pulsante è attivo solo se la riga è tua e firmata, oppure se sei coordinatore o docente della classe; altrimenti l'errore lo spiega.
   - La schermata dell'appello è `appello-classe-view`.
7. **Protocollo della porta `argo-azione`:**
   - dalla pagina al popup: `ready`, `step {text, kind: ok|warn|ask|error}`, `ask {id, question, confirmLabel, cancelLabel}`, `done {result}`;
   - dal popup alla pagina: `run {action}`, `answer {id, ok}`;
   - `result` vale `{ok, cancelled?, summary | error, steps}`;
   - se il popup si chiude, passi ed esito compaiono negli avvisi della pagina.

## Struttura di DidUP (dal bundle pubblico)

Il bundle è `https://www.portaleargo.it/voti/classic/app.js`, circa 7 MB, Ext JS 6 classic. Le informazioni sotto vengono da lì; dove serve si scarica con curl e si cerca nel testo.

- **Accesso.** oidc-client; il token sta nel `sessionStorage` della scheda; le API usano gli header `Authorization: Bearer` e `x-auth-token`, letti con `Ext.Ajax.getDefaultHeaders()`. Sessione scaduta = risposta 401, 402 o 406. `getUrlBase()` è globale.
- **Home.** POST `dashboard/loaddati` → `classiDocente`. Il clic su `span[id^=ora_]` chiama `onClickPanel` → `selezionaClasse` → `push('registro-main-view')`.
- **Registro.** `attivita-view`, griglia `grid-attivita`, store `attivita`. `cellclick` sulla colonna FIRMA (indice 1) → `clickFirmaOra` (interruttore: firma o toglie la firma).
- **Modifica lezione.** `attivita-dettaglio-view` / `attivita-dettaglio-tabview`. Nel fieldset "Registro di classe" c'è un tabpanel con "Attività svolta" (`theAttivita.desArgomento`) e un tabpanel `tabCompiti` con le schede "Compiti": `panelCompiti` → `desCompiti`; `panelCompiti2`/`panelCompiti3` sono nascoste finché il docente non ne aggiunge una (+) → `desCompiti2`/`desCompiti3`. Massimo 500 caratteri. Il binding si legge da `cmp.getBind().value.stub.path` o da `cmp.initialConfig.bind.value`.
- **Login Argo.** `#spidForm` (POST `/auth/eid-gateway/sso`), `#customer_code`, `a.button-spid`; scelta del profilo `.selectable-identity[data-username][data-customer_code]` (script `assets/auth/js/main.*.js`).

## Dati salvati (`chrome.storage.local`)

- **Impostazioni** (chiavi di `DEFAULT_SETTINGS`): `codiceScuola`, `loginMethod`, `spidProvider`, `autoLogin`, `docenteNome`, `keepAliveEnabled`, `keepAliveInterval`, `keepAliveMethod`, `discipline[{nome, argomenti[], compiti[]}]` (`TIPI_VOCE` in settings.js; i file senza `compiti` vengono completati con un elenco vuoto), `argoLoginUrl`, `argoDashboardPattern`, `basePortalUrl`, più `schemaVersion`.
- **Stato:** `loginFlow`, `keepAliveStatus`, `selfReload`, `ui_lastDisciplina`, `ui_lastTipo` (ultima scheda del pannello).
- **Migrazione.** Alla prima esecuzione si recuperano alcuni campi da `storage.sync` della versione originale.

## Messaggi `runtime`

- **Al service worker:** `keepalive-state`, `open-options`, `go-registro`.
- **Ai content script:** `argo-login-now`.

## Test

Servono Node 20+ (provato con la 26) e Google Chrome. Tutto in `tests/`: profili, copie dell'estensione e screenshot finiscono in `$TMPDIR/argo-didup-booster-tests`.

| Comando | Cosa prova |
|---|---|
| `node tests/run-all.mjs` | Esegue in sequenza le quattro suite qui sotto. |
| `node tests/test-impostazioni.mjs` | Pagina delle impostazioni (finto `chrome.*`, server locale). |
| `node tests/test-funzioni.mjs` | Accesso su un login Argo ed eid finti, mantenimento della sessione, argomenti nel registro, popup, service worker, ricarica automatica. |
| `node tests/test-firma-appello.mjs` | `azioni.js` su `tests/mock/didup-mock.html` (DidUP finto con menu, Home, registro, Appello), compresa la conferma fuori orario. |
| `node tests/test-estensione-vera.mjs` | Estensione **vera** (mondo isolato, porta reale) contro il DidUP finto servito come `https://www.portaleargo.it` (host dirottato e certificato usa e getta creato con openssl). |
| `node tests/test-siti-reali.mjs [stale\|click\|onlogin]` (oppure `run-all.mjs --reali`) | Percorso di accesso sulle **pagine vere** di Argo ed eid con il codice pubblico `SG18328`. Si ferma alla pagina del provider (Poste ID, InfoCert, CIE) **senza credenziali**. |
| `node tests/screenshots.mjs` | Rigenera `docs/img/*.png` con dati di fantasia. |

**Note tecniche:**
- Google Chrome ignora `--load-extension`: l'estensione vera si carica con `--remote-debugging-pipe --enable-unsafe-extension-debugging` e CDP `Extensions.loadUnpacked` (`tests/lib/cdp-pipe.mjs`).
- Per provare `chrome.runtime.reload()` serve la modalità sviluppatore: `enableDevMode()` da `chrome://extensions`.
- I test con il finto `chrome.*` (`tests/mock/mock-chrome.js`) girano nel mondo della pagina; `prepareMockExtension()` aggiunge il mock a popup e impostazioni.
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
- Ogni azione automatica deve dire **cosa ha cliccato e cosa non ha trovato**: elenco dei passi nel popup, avviso nella pagina se il popup è chiuso. Niente `alert()`.
- Gli argomenti si scelgono dentro la pagina del registro, non dal popup.
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

## Punti aperti (non verificati sul registro vero)

Non sono mai stati provati con un accesso reale, ma solo sui DidUP finti costruiti dal bundle:
- scelta del profilo dopo SPID;
- pulsante "Argomenti e compiti" nella schermata di modifica lezione (e lettura del binding delle caselle);
- efficacia del mantenimento della sessione;
- controllo della sessione nelle schede già aperte;
- Firma e Appello sul DOM reale.

Se l'utente segnala un problema, partire dal passo in rosso del popup. Con il suo permesso, si può leggere la struttura della Home o della tabella delle ore senza cliccare nulla.
