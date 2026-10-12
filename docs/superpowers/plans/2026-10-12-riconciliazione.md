# Riconciliazione movimenti bancari — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abbinare i movimenti in uscita dell'estratto conto alle scadenze non pagate, con conferma dell'utente prima di ogni scrittura.

**Architecture:** Un modulo `riconciliazione.js` con funzioni pure (normalizzazione, lettura, punteggio, abbinamento, costruzione degli aggiornamenti) testate in Node, più una parte di interfaccia caricata da `index.html`. Le librerie di parsing sono solo un involucro sottile attorno alle funzioni pure.

**Tech Stack:** JavaScript vanilla, Node 22 con `node:test` (nessuna dipendenza), SheetJS e pdf.js da cdnjs, Firebase Realtime Database già in uso.

**Spec:** `docs/superpowers/specs/2026-10-12-riconciliazione-design.md`

## Global Constraints

- Nessun dato esce dal browser; nessun servizio AI esterno.
- Scritture solo sul database dello scadenzario (`PATH` esistente); assegni e paghe non si scrivono.
- Ogni scrittura è preceduta da backup JSON scaricato.
- Soglia di proposta: punteggio ≥ 60. Soglia di dubbio: punteggio tra 40 e 59.
- Finestra di date: movimento da `scadenza − 7` a `scadenza + 30` giorni.
- Librerie da cdnjs con versione fissata e almeno due settimane di età.

## Review Focus

1. Importi in formato italiano (`1.234,56`, `-1.234,56`, `1234.56`): devono essere letti come euro corretti, non come 1234 o 1,23.
2. Date in `GG/MM/AAAA` e `GG-MM-AA`: devono essere interpretate come giorno-mese, mai come mese-giorno.
3. Due voci con lo stesso importo e stessa scadenza: un movimento abbina una sola voce, l'altra resta libera.
4. File con righe vuote, intestazione non alla prima riga o riga di totale finale: devono essere ignorate senza bloccare l'import.
5. CSV bancario con separatore `;` e codifica Windows-1252 (lettere accentate): deve leggersi senza caratteri sbagliati.

## File Structure

- Create: `riconciliazione.js` — tutte le funzioni pure e la parte di interfaccia.
- Create: `tests/riconciliazione.test.js` — test `node:test` del modulo.
- Create: `tests/fixtures/estratto-esempio.csv` — estratto anonimizzato con i casi di Review Focus.
- Modify: `index.html` — pulsante "Riconcilia movimenti", tag `<script src="riconciliazione.js">`, punto di collegamento al salvataggio.
- Modify: `sw.js` — aggiunge `./riconciliazione.js` a `SHELL` e aumenta `CACHE` a `scadenzario-shell-v6`.

## Interfaces condivise

Tutte le funzioni sono esportate in `module.exports` quando disponibile, altrimenti su `window.Riconciliazione`.

- `normalizzaImporto(stringa: string) → number` — euro con segno; `NaN` se non leggibile.
- `normalizzaData(stringa: string) → string | null` — ISO `YYYY-MM-DD`; `null` se non riconosciuta.
- `impronta(mov: {data, importo, descrizione}) → string` — chiave stabile (data + importo + descrizione normalizzata).
- `parseCsv(testo: string, mappa: Mappa) → {movimenti: Movimento[], errori: string[]}`
  con `Mappa = {data: string, importo: string, descrizione: string, numeroAssegno?: string, separatore?: string}` (nomi delle colonne).
- `punteggio(mov: Movimento, voce: Voce) → {totale: number, motivi: string[]}`
- `abbina(movimenti: Movimento[], voci: Voce[], riconciliate: Set<string>) → {proposte, daDecidere, nonRiconciliati}`
- `costruisciAggiornamenti(conferme: Conferma[], voci: Record<string, Voce>) → {updates, saltate}`

Tipi:
- `Movimento = {data: string, importo: number, descrizione: string, numeroAssegno: string | null, impronta: string}` (solo uscite, `importo < 0`).
- `Voce = {id: string, scadenza: string, importo: number, pagato: boolean, tipoVoce: 'scadenza' | 'assegno' | 'paga', banca?: string, beneficiario?: string, numero?: string}`
- `Conferma = {voceId: string, movimento: Movimento}`

---

### Task 1: Normalizzazione di importi, date e impronte

**Files:**
- Create: `riconciliazione.js`
- Test: `tests/riconciliazione.test.js`

**Interfaces:**
- Produces: `normalizzaImporto`, `normalizzaData`, `impronta` (vedi sezione condivisa).

- [ ] **Step 1: Scrivi i test falliti**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../riconciliazione.js');

test('importi in formato italiano', () => {
  assert.equal(R.normalizzaImporto('1.234,56'), 1234.56);
  assert.equal(R.normalizzaImporto('-1.234,56'), -1234.56);
  assert.equal(R.normalizzaImporto('1234.56'), 1234.56);
  assert.ok(Number.isNaN(R.normalizzaImporto('n.d.')));
});

test('date in formato italiano sono giorno-mese', () => {
  assert.equal(R.normalizzaData('05/03/2026'), '2026-03-05');
  assert.equal(R.normalizzaData('05-03-26'), '2026-03-05');
  assert.equal(R.normalizzaData('2026-03-05'), '2026-03-05');
  assert.equal(R.normalizzaData('31/02/2026'), null);
});

test('impronta uguale per stessi dati, diversa per importo diverso', () => {
  const a = { data: '2026-03-05', importo: -10, descrizione: 'BONIFICO X' };
  const b = { data: '2026-03-05', importo: -10, descrizione: 'bonifico  x' };
  const c = { data: '2026-03-05', importo: -11, descrizione: 'BONIFICO X' };
  assert.equal(R.impronta(a), R.impronta(b));
  assert.notEqual(R.impronta(a), R.impronta(c));
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `node --test tests/riconciliazione.test.js`
Expected: FAIL con "Cannot find module '../riconciliazione.js'".

- [ ] **Step 3: Implementa le tre funzioni in `riconciliazione.js`**

Esporta le funzioni con `module.exports`, con fallback su `window.Riconciliazione`. `normalizzaImporto` rimuove i separatori delle migliaia quando la virgola è presente. `normalizzaData` valida il giorno e il mese con il calendario reale, e porta l'anno a due cifre a 2000+. `impronta` normalizza la descrizione con minuscole e spazi compressi.

- [ ] **Step 4: Esegui e verifica il successo**

Run: `node --test tests/riconciliazione.test.js`
Expected: PASS, tre test.

- [ ] **Step 5: Commit**

```bash
git add riconciliazione.js tests/riconciliazione.test.js
git commit -m "feat(riconciliazione): normalizzazione di importi, date e impronte"
```

---

### Task 2: Lettura CSV con mappatura colonne

**Files:**
- Modify: `riconciliazione.js`
- Test: `tests/riconciliazione.test.js`
- Create: `tests/fixtures/estratto-esempio.csv`

**Interfaces:**
- Consumes: `normalizzaImporto`, `normalizzaData`, `impronta` (Task 1).
- Produces: `parseCsv` (vedi sezione condivisa).

- [ ] **Step 1: Crea la fixture anonimizzata**

Il file contiene: una riga di titolo prima dell'intestazione, due righe vuote, separatore `;`, una riga di totale in fondo, un importo `1.234,56` negativo, un assegno con numero nella descrizione, due movimenti con lo stesso importo e stessa data.

- [ ] **Step 2: Scrivi i test falliti**

```javascript
test('parseCsv ignora titolo, righe vuote e totale finale', () => {
  const testo = require('fs').readFileSync('tests/fixtures/estratto-esempio.csv', 'utf8');
  const { movimenti, errori } = R.parseCsv(testo, {
    data: 'Data', importo: 'Importo', descrizione: 'Descrizione', separatore: ';'
  });
  assert.deepEqual(errori, []);
  assert.ok(movimenti.every(m => m.importo < 0));
  assert.equal(movimenti.find(m => m.descrizione.includes('ASSEGNO')).numeroAssegno, '000123');
});

test('parseCsv rifiuta il file intero se una riga importo non è leggibile', () => {
  const testo = 'Data;Importo;Descrizione\n05/03/2026;abc;X';
  const { movimenti, errori } = R.parseCsv(testo, { data: 'Data', importo: 'Importo', descrizione: 'Descrizione', separatore: ';' });
  assert.equal(movimenti.length, 0);
  assert.equal(errori.length, 1);
});
```

- [ ] **Step 3: Esegui e verifica il fallimento**

Run: `node --test tests/riconciliazione.test.js`
Expected: FAIL con "R.parseCsv is not a function".

- [ ] **Step 4: Implementa `parseCsv`**

Il parser cerca l'intestazione tra le prime righe, scarta righe vuote, righe senza data valida e righe di totale. Se una riga con data valida ha un importo non leggibile, il file non produce movimenti e l'errore indica il numero di riga. Estrae il numero di assegno con `/ASS(?:EGNO)?\.?\s*(\d{4,})/i`. Tiene solo le uscite.

- [ ] **Step 5: Esegui e verifica il successo**

Run: `node --test tests/riconciliazione.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add riconciliazione.js tests/riconciliazione.test.js tests/fixtures/estratto-esempio.csv
git commit -m "feat(riconciliazione): lettura CSV con mappatura colonne"
```

---

### Task 3: Lettura XLSX e PDF (involucro sottile)

**Files:**
- Modify: `riconciliazione.js`
- Test: `tests/riconciliazione.test.js`

**Interfaces:**
- Consumes: `parseCsv` (Task 2).
- Produces: `righeDaMatrice(matrice: string[][], mappa) → {movimenti, errori}`, `righePdfDaTesto(righe: string[], modello) → string[]`, `leggiXlsx(arrayBuffer) → string[][]` (usa SheetJS globale), `leggiPdf(file) → string[]` (usa pdf.js globale).

- [ ] **Step 1: Scrivi i test falliti per le funzioni pure**

```javascript
test('righeDaMatrice usa la stessa logica di parseCsv', () => {
  const matrice = [['Data', 'Importo', 'Descrizione'], ['05/03/2026', '-10,00', 'PAGAMENTO']];
  const { movimenti } = R.righeDaMatrice(matrice, { data: 'Data', importo: 'Importo', descrizione: 'Descrizione' });
  assert.equal(movimenti.length, 1);
  assert.equal(movimenti[0].importo, -10);
});

test('righePdfDaTesto estrae le righe che iniziano con una data', () => {
  const righe = ['Estratto conto', '05/03/2026 PAGAMENTO FORNITORE -10,00', 'pagina 1'];
  const out = R.righePdfDaTesto(righe, { regexRiga: /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d.]+,\d{2})$/ });
  assert.equal(out.length, 1);
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `node --test tests/riconciliazione.test.js`
Expected: FAIL con "R.righeDaMatrice is not a function".

- [ ] **Step 3: Implementa le funzioni**

`righeDaMatrice` converte la matrice in testo CSV con separatore `;` e chiama `parseCsv`, così la logica resta in un solo punto. `righePdfDaTesto` applica `modello.regexRiga` a ogni riga e restituisce quelle che corrispondono. `leggiXlsx` e `leggiPdf` sono involucri non testati in Node: usano `XLSX.read` e `pdfjsLib.getDocument`, e vengono verificati a mano nel Task 9.

- [ ] **Step 4: Esegui e verifica il successo**

Run: `node --test tests/riconciliazione.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add riconciliazione.js tests/riconciliazione.test.js
git commit -m "feat(riconciliazione): lettura XLSX e PDF come involucri sottili"
```

---

### Task 4: Punteggio di un movimento rispetto a una voce

**Files:**
- Modify: `riconciliazione.js`
- Test: `tests/riconciliazione.test.js`

**Interfaces:**
- Consumes: `Movimento`, `Voce` (sezione condivisa).
- Produces: `punteggio` (sezione condivisa), costanti `SOGLIA_PROPOSTA = 60`, `SOGLIA_DUBBIO = 40`, `FINESTRA = {prima: 7, dopo: 30}`.

- [ ] **Step 1: Scrivi i test falliti**

```javascript
const voce = { id: 'v1', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'scadenza', beneficiario: 'ARCOM' };

test('importo esatto, data vicina e nome riconosciuto: proposta', () => {
  const mov = { data: '2026-03-11', importo: -100, descrizione: 'BONIFICO A FAVORE ARCOM SRL', numeroAssegno: null };
  const { totale, motivi } = R.punteggio(mov, voce);
  assert.equal(totale, 20 + 30 + 10);
  assert.ok(motivi.length >= 2);
});

test('numero assegno citato pesa 40', () => {
  const v = { ...voce, tipoVoce: 'assegno', numero: '000123', scadenza: '2026-03-10' };
  const mov = { data: '2026-03-10', importo: -100, descrizione: 'ASSEGNO 000123', numeroAssegno: '000123' };
  assert.equal(R.punteggio(mov, v).totale, 40 + 30 + 20);
});

test('importo diverso: nessuna candidata', () => {
  const mov = { data: '2026-03-10', importo: -99.99, descrizione: 'ARCOM', numeroAssegno: null };
  assert.equal(R.punteggio(mov, voce), null);
});

test('data fuori finestra: nessuna candidata', () => {
  const mov = { data: '2026-02-01', importo: -100, descrizione: 'ARCOM', numeroAssegno: null };
  assert.equal(R.punteggio(mov, voce), null);
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `node --test tests/riconciliazione.test.js`
Expected: FAIL con "R.punteggio is not a function".

- [ ] **Step 3: Implementa `punteggio`**

Restituisce `null` se importo o finestra non combaciano. Altrimenti somma: numero assegno nella descrizione (40); importo esatto (30); data entro 3 giorni dalla scadenza (20), oppure entro 30 (10); nome del beneficiario o della banca presente nella descrizione normalizzata (10). Il valore `motivi` elenca le componenti che hanno contribuito. Le costanti sono in un unico blocco in cima al file.

- [ ] **Step 4: Esegui e verifica il successo**

Run: `node --test tests/riconciliazione.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add riconciliazione.js tests/riconciliazione.test.js
git commit -m "feat(riconciliazione): punteggio di un movimento rispetto a una voce"
```

---

### Task 5: Abbinamento uno a uno con proposte e casi da decidere

**Files:**
- Modify: `riconciliazione.js`
- Test: `tests/riconciliazione.test.js`

**Interfaces:**
- Consumes: `punteggio`, `impronta`, soglie (Task 1 e 4).
- Produces: `abbina` (sezione condivisa).

- [ ] **Step 1: Scrivi i test falliti**

```javascript
test('due voci con stesso importo e data: un movimento abbina una sola voce', () => {
  const voci = [
    { id: 'a', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'scadenza', beneficiario: 'ARCOM' },
    { id: 'b', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'scadenza', beneficiario: 'ARCOM' },
  ];
  const movimenti = [{ data: '2026-03-10', importo: -100, descrizione: 'ARCOM', numeroAssegno: null, impronta: 'x1' }];
  const r = R.abbina(movimenti, voci, new Set());
  assert.equal(r.proposte.length + r.daDecidere.length, 1);
  assert.equal(r.daDecidere.length, 1);
});

test('movimento già riconciliato (impronta nota) viene saltato', () => {
  const voci = [{ id: 'a', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'scadenza', beneficiario: 'ARCOM' }];
  const movimenti = [{ data: '2026-03-10', importo: -100, descrizione: 'ARCOM', numeroAssegno: null, impronta: 'x1' }];
  const r = R.abbina(movimenti, voci, new Set(['x1']));
  assert.equal(r.proposte.length, 0);
  assert.equal(r.daDecidere.length, 0);
  assert.equal(r.nonRiconciliati.length, 0);
});

test('voce già pagata non è candidata', () => {
  const voci = [{ id: 'a', scadenza: '2026-03-10', importo: 100, pagato: true, tipoVoce: 'scadenza' }];
  const movimenti = [{ data: '2026-03-10', importo: -100, descrizione: 'X', numeroAssegno: null, impronta: 'x2' }];
  assert.equal(R.abbina(movimenti, voci, new Set()).nonRiconciliati.length, 1);
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `node --test tests/riconciliazione.test.js`
Expected: FAIL con "R.abbina is not a function".

- [ ] **Step 3: Implementa `abbina`**

Filtra i movimenti con impronta già riconciliata e le voci pagate. Calcola i punteggi per ogni coppia. Ordina le coppie per punteggio decrescente, poi assegna in ordine: una coppia viene accettata solo se né il movimento né la voce sono già usati. Una coppia ≥ 60 finisce in `proposte` se non ha rivali ≥ 60 sulla stessa voce o sullo stesso movimento, altrimenti in `daDecidere`. Le coppie tra 40 e 59 vanno in `daDecidere`. I movimenti senza candidate vanno in `nonRiconciliati`.

- [ ] **Step 4: Esegui e verifica il successo**

Run: `node --test tests/riconciliazione.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add riconciliazione.js tests/riconciliazione.test.js
git commit -m "feat(riconciliazione): abbinamento uno a uno con casi da decidere"
```

---

### Task 6: Costruzione degli aggiornamenti per il database

**Files:**
- Modify: `riconciliazione.js`
- Test: `tests/riconciliazione.test.js`

**Interfaces:**
- Consumes: `Conferma`, `Voce` (sezione condivisa).
- Produces: `costruisciAggiornamenti` (sezione condivisa).

- [ ] **Step 1: Scrivi i test falliti**

```javascript
test('costruisce aggiornamenti solo per voci ancora non pagate', () => {
  const voci = {
    a: { id: 'a', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'scadenza', pianoNome: 'X' },
    b: { id: 'b', scadenza: '2026-03-10', importo: 50, pagato: true, tipoVoce: 'scadenza' },
  };
  const conferme = [
    { voceId: 'a', movimento: { data: '2026-03-11', importo: -100, descrizione: 'ARCOM', impronta: 'h1', numeroAssegno: null } },
    { voceId: 'b', movimento: { data: '2026-03-11', importo: -50, descrizione: 'ARCOM', impronta: 'h2', numeroAssegno: null } },
  ];
  const { updates, saltate } = R.costruisciAggiornamenti(conferme, voci);
  assert.equal(updates.a.pagato, true);
  assert.equal(updates.a.dataPagamento, '2026-03-11');
  assert.equal(updates.a.riconciliazione.impronta, 'h1');
  assert.equal(updates.b, undefined);
  assert.equal(saltate.length, 1);
});

test('mai scritture su voci di tipo assegno o paga', () => {
  const voci = { c: { id: 'c', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'assegno' } };
  const conferme = [{ voceId: 'c', movimento: { data: '2026-03-10', importo: -100, descrizione: 'X', impronta: 'h3', numeroAssegno: null } }];
  const { updates, saltate } = R.costruisciAggiornamenti(conferme, voci);
  assert.equal(updates.c, undefined);
  assert.equal(saltate.length, 1);
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `node --test tests/riconciliazione.test.js`
Expected: FAIL con "R.costruisciAggiornamenti is not a function".

- [ ] **Step 3: Implementa `costruisciAggiornamenti`**

Per ogni conferma: se la voce non esiste, è già pagata, o non è di tipo `scadenza`, va in `saltate` con il motivo. Altrimenti crea l'aggiornamento come copia della voce con `pagato: true`, `dataPagamento` (data del movimento) e `riconciliazione: {impronta, importo, data}`. Il chiamante applica `conMeta` e `db.ref(PATH).update(updates)`.

- [ ] **Step 4: Esegui e verifica il successo**

Run: `node --test tests/riconciliazione.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add riconciliazione.js tests/riconciliazione.test.js
git commit -m "feat(riconciliazione): aggiornamenti per il database, solo scadenze"
```

---

### Task 7: Memoria della mappatura colonne per banca

**Files:**
- Modify: `riconciliazione.js`
- Test: `tests/riconciliazione.test.js`

**Interfaces:**
- Produces: `salvaMappatura(banca: string, mappa: Mappa, archivio?: Storage) → boolean`, `leggiMappatura(banca: string, archivio?: Storage) → Mappa | null`.

- [ ] **Step 1: Scrivi i test falliti**

```javascript
test('mappatura salvata e riletta per banca', () => {
  const mem = new Map();
  const archivio = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const mappa = { data: 'Data', importo: 'Importo', descrizione: 'Descrizione', separatore: ';' };
  assert.equal(R.salvaMappatura('BCC', mappa, archivio), true);
  assert.deepEqual(R.leggiMappatura('BCC', archivio), mappa);
});

test('archivio non disponibile: nessun errore', () => {
  const archivioRotto = { getItem() { throw new Error('negato'); }, setItem() { throw new Error('negato'); } };
  assert.equal(R.salvaMappatura('BCC', {}, archivioRotto), false);
  assert.equal(R.leggiMappatura('BCC', archivioRotto), null);
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `node --test tests/riconciliazione.test.js`
Expected: FAIL con "R.salvaMappatura is not a function".

- [ ] **Step 3: Implementa le funzioni**

Chiave `riconciliazione.mappa.<banca>` con JSON. Entrambe le funzioni usano `try/catch`. Il parametro `archivio` ha come default `globalThis.localStorage` quando presente.

- [ ] **Step 4: Esegui e verifica il successo**

Run: `node --test tests/riconciliazione.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add riconciliazione.js tests/riconciliazione.test.js
git commit -m "feat(riconciliazione): memoria della mappatura colonne per banca"
```

---

### Task 8: Schermata di conferma

**Files:**
- Modify: `riconciliazione.js`

**Interfaces:**
- Consumes: risultato di `abbina` (Task 5), `leggiMappatura` (Task 7).
- Produces: `apriConferma(contenitore: HTMLElement, risultato, gestori: {conferma(conferme), chiudi()})`.

Questo task non ha test automatici: la funzione costruisce il DOM. La verifica è manuale nel Task 9.

- [ ] **Step 1: Implementa `apriConferma`**

Crea tre sezioni: "Proposte" (movimento, voce, punteggio, motivi, pulsanti Conferma e Scarta), "Da decidere" (movimento con elenco candidate, scelta o scarto), "Non riconciliati" (solo elenco). Le voci di tipo `assegno` e `paga` mostrano la dicitura "da registrare nell'app assegni / paghe" e non hanno il pulsante Conferma. Il pulsante "Conferma selezionate" chiama `gestori.conferma` con le conferme scelte. Tutti i testi di interfaccia in italiano, con escape HTML su descrizioni e nomi.

- [ ] **Step 2: Controlla la sintassi**

Run: `node --check riconciliazione.js`
Expected: nessun output, codice di uscita 0.

- [ ] **Step 3: Commit**

```bash
git add riconciliazione.js
git commit -m "feat(riconciliazione): schermata di conferma"
```

---

### Task 9: Integrazione in index.html, service worker e verifica

**Files:**
- Modify: `index.html`
- Modify: `sw.js`

**Interfaces:**
- Consumes: tutte le funzioni dei task precedenti; `scrivi`, `conMeta`, `db`, `PATH`, `S.items`, `vociAssegni`, `vociPaghe` già presenti in `index.html`.

- [ ] **Step 1: Aggiungi il tag script e il pulsante**

In `index.html`, carica `riconciliazione.js` dopo le librerie cdnjs e prima dello script principale, con `<script src="riconciliazione.js"></script>`. Aggiungi il pulsante "Riconcilia movimenti" nella barra di azioni vicina alla card `sommaMensile`. Il pulsante apre un `<input type="file" accept=".csv,.xlsx,.pdf">`, legge il file con `leggiXlsx`/`leggiPdf`/`parseCsv`, applica la mappatura salvata o chiede di crearla, poi chiama `abbina` e `apriConferma`.

- [ ] **Step 2: Collega il salvataggio**

Il gestore `conferma` costruisce i movimenti scelti, chiama `costruisciAggiornamenti(conferme, S.items)`, scarica il backup JSON di `S.items` con `scarica`, poi chiama `db.ref(PATH).update(updates)` con `conMeta` applicato a ogni voce. Il risultato usa `scrivi(updates, 'Riconciliate N voci', undo)` per il toast con annullamento.

- [ ] **Step 3: Aggiorna il service worker**

In `sw.js`, aggiungi `'./riconciliazione.js'` all'array `SHELL` e porta `CACHE` a `'scadenzario-shell-v6'`.

- [ ] **Step 4: Esegui tutti i test**

Run: `node --test tests/riconciliazione.test.js`
Expected: tutti i test PASS.

- [ ] **Step 5: Verifica manuale**

Apri l'app con il file di esempio. Controlla: importo esatto con assegno citato proposto; due voci uguali finiscono in "Da decidere"; le voci di assegno non hanno il pulsante Conferma; dopo una conferma le voci compaiono come pagate; il toast annulla l'operazione; il backup JSON viene scaricato prima della scrittura. Registra l'esito nel messaggio di chiusura.

- [ ] **Step 6: Commit**

```bash
git add index.html sw.js
git commit -m "feat(riconciliazione): integrazione nell'app e nel service worker"
```

