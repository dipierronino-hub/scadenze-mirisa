# Riconciliazione movimenti bancari — specifica di progetto

Data: 2026-10-12
Stato: bozza in attesa di revisione. Nessun codice di produzione è ancora scritto.

## 1. Obiettivo

Caricare l'estratto conto e abbinare automaticamente i movimenti in uscita alle voci non pagate
dell'app (scadenze, assegni, paghe). L'utente conferma ogni proposta prima di qualsiasi scrittura.

Successo: la maggior parte dei movimenti chiari si propone da sola; l'utente rivede solo i casi dubbi.

## 2. Vincoli

- Nessun dato esce dal browser. Nessun servizio AI esterno in questa versione.
- L'app è un singolo `index.html` distribuito via GitHub Pages, con Firebase Realtime Database.
- Nessuna scrittura su database diversi da quello dello scadenzario in questa versione.
- Ogni scrittura è preceduta da un backup e annullabile.

## 3. Architettura

- `riconciliazione.js`: modulo separato, caricato da `index.html` con `<script src>`.
  Contiene lettura, normalizzazione, abbinamento e schermata di conferma.
- `index.html`: aggiunge solo il pulsante "Riconcilia movimenti" e il punto di salvataggio.
- `sw.js`: aggiunge `riconciliazione.js` alla cache.
- Librerie da cdnjs con versione fissata e almeno due settimane di età:
  SheetJS per XLSX/CSV, pdf.js per il testo dei PDF.

Unità e responsabilità:

| Unità | Responsabilità | Dipende da |
|---|---|---|
| `lettoreMovimenti` | CSV/XLSX/PDF → movimenti normalizzati | librerie di parsing |
| `mappaturaBanca` | colonne per banca, salvate in locale | `lettoreMovimenti` |
| `motoreAbbinamento` | punteggio e proposte, funzione pura | solo dati in memoria |
| `schermataConferma` | lista proposte, conferma/scarta, "da decidere" | `motoreAbbinamento` |
| `salvataggioPagamenti` | scrive solo le conferme, con backup | Firebase scadenzario |

`motoreAbbinamento` è una funzione pura: riceve movimenti e voci, restituisce proposte. È la parte da testare di più.

## 4. Movimenti

Campi normalizzati: `data` (ISO), `importo` (in euro con segno), `descrizione`, `numeroAssegno` (se presente), `impronta`.

- Si considerano solo le uscite (importo negativo).
- `impronta` = hash di data + importo + descrizione normalizzata. Un movimento con impronta già registrata
  come riconciliato viene saltato.

## 5. Abbinamento

Per ogni movimento in uscita e ogni voce non pagata:

- Importo: deve coincidere al centesimo. Altrimenti la voce non è candidata.
- Data: finestra da 7 giorni prima a 30 giorni dopo la scadenza. Fuori finestra, non è candidata.
- Punteggio (somma pesata, 0–100):
  - numero di assegno citato nella descrizione: 40
  - importo esatto: 30 (già vincolante, quindi sempre presente nelle candidate)
  - data entro 3 giorni dalla scadenza: 20; entro 30 giorni: 10
  - nome del beneficiario o della banca riconosciuto nella descrizione (confronto normalizzato): 10
- Proposta: punteggio ≥ 60.
- "Da decidere": due o più candidate con punteggio ≥ 60, oppure punteggio tra 40 e 59.
- Uno a uno: una voce abbina un solo movimento e un movimento abbina una sola voce.
  In caso di conflitto vince il punteggio più alto; a parità, il movimento va in "da decidere".
- Ogni proposta mostra i motivi del punteggio, così che la scelta sia verificabile.

Le soglie sono costanti in un unico punto, e i test le coprono.

## 6. Schermata di conferma

Tre gruppi:

1. **Proposte**: movimento, voce, punteggio, motivi. Azioni: conferma, scarta, cerca altra voce.
2. **Da decidere**: movimento e candidate ordinate per punteggio. L'utente sceglie o scarta.
3. **Non riconciliati**: movimenti senza candidate. Nessuna azione automatica.

Assegni e paghe compaiono nei gruppi 1 e 2 con l'indicazione "da registrare nell'app assegni / paghe".
In questa versione non si scrivono.

## 7. Salvataggio

- Scrive solo le conferme, in un unico aggiornamento, sul percorso già usato dall'app per le scadenze.
- Per ogni voce scrive: `pagato: true`, `dataPagamento` (data del movimento), `banca` se nota,
  e un riferimento al movimento (`riconciliazione: { impronta, importo, data }`).
- Prima della scrittura crea un backup JSON scaricato sul computer.
- Dopo la scrittura mostra il toast con annullamento, come le altre operazioni dell'app.
- `conMeta` registra autore e data della modifica.

## 8. Formati di import

- CSV/XLSX: la prima volta l'utente mappa le colonne (data, importo, descrizione, eventuale numero assegno).
  La mappatura si salva in `localStorage` con il nome della banca. Se localStorage non è disponibile,
  la mappatura resta solo per la sessione.
- PDF: estrazione del testo con pdf.js. Un modello per banca riconosce le righe. Se il modello non riconosce
  il file, il modulo chiede di indicare le colonne a mano, come per il CSV.
- Un file con righe non interpretabili non si importa in parte: il modulo mostra gli errori e chiede di correggere.

## 9. Errori e casi limite

- Importo con virgola o punto, segno invertito, date in formati diversi: normalizzati prima dell'abbinamento.
- Movimento duplicato nello stesso file: segnalato e contato una volta.
- Salvataggio fallito: il modulo non segna nulla come riconciliato in locale e mostra l'errore.
- Voce già pagata da altra sessione al momento della conferma: la conferma viene saltata e segnalata.
- Nessun dato in cache: il modulo chiede di ricaricare le voci prima di abbinare.

## 10. Test

- Unit test del `motoreAbbinamento` su casi noti: importo esatto con assegno citato, date ai bordi della finestra,
  due candidate con punteggi vicini, movimento duplicato, nessuna candidata.
- Test del `lettoreMovimenti` su un CSV e un XLSX di esempio anonimizzati.
- Test manuale del salvataggio su una copia dei dati (backup prima), con verifica dell'annullamento.

## 11. Fuori scope in questa versione

- Scrittura su assegni e paghe (fase 2, dopo verifica dei permessi e del database di destinazione).
- Qualsiasi servizio AI esterno.
- Riconciliazione dei pagamenti in entrata.

## 12. Domande aperte

- Fase 2: scrittura su assegni, con backup e test sul database assegni.
