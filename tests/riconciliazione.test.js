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

test('impronta è un digest esadecimale', () => {
  const h = R.impronta({ data: '2026-03-05', importo: -10, descrizione: 'BONIFICO X' });
  assert.match(h, /^[0-9a-f]{8,16}$/);
});

test('importo in ordine non italiano è illeggibile', () => {
  assert.ok(Number.isNaN(R.normalizzaImporto('1,234.56')));
});

test('anno bisestile', () => {
  assert.equal(R.normalizzaData('29/02/2024'), '2024-02-29');
  assert.equal(R.normalizzaData('29/02/2026'), null);
});

test('parseCsv ignora titolo, righe vuote e totale finale', () => {
  const testo = require('fs').readFileSync('tests/fixtures/estratto-esempio.csv', 'utf8');
  const { movimenti, errori } = R.parseCsv(testo, {
    data: 'Data', importo: 'Importo', descrizione: 'Descrizione', separatore: ';'
  });
  assert.deepEqual(errori, []);
  assert.ok(movimenti.every(m => m.importo < 0));
  assert.equal(movimenti.find(m => m.descrizione.includes('ASSEGNO')).numeroAssegno, '000123');
  assert.equal(movimenti.length, 4);
  assert.equal(movimenti[0].importo, -1234.56);
  assert.equal(movimenti[0].data, '2026-03-05');
  assert.equal(movimenti[1].impronta, movimenti[2].impronta);
});

test('parseCsv rifiuta il file intero se una riga importo non è leggibile', () => {
  const testo = 'Data;Importo;Descrizione\n05/03/2026;abc;X';
  const { movimenti, errori } = R.parseCsv(testo, { data: 'Data', importo: 'Importo', descrizione: 'Descrizione', separatore: ';' });
  assert.equal(movimenti.length, 0);
  assert.equal(errori.length, 1);
  assert.match(errori[0], /Riga 2/);
});

test('parseCsv usa ; se il separatore manca', () => {
  const { movimenti } = R.parseCsv('Data;Importo;Descrizione\n05/03/2026;-10,00;X', { data: 'Data', importo: 'Importo', descrizione: 'Descrizione' });
  assert.equal(movimenti.length, 1);
});

test('decodificaTesto decodifica windows-1252', () => {
  const bytes = Uint8Array.from([0x70,0x65,0x72,0x63,0x68,0xE9,0x20,0x63,0x69,0x74,0x74,0xE0]);
  assert.equal(R.decodificaTesto(bytes, 'windows-1252'), 'perché città');
  assert.equal(R.decodificaTesto(new TextEncoder().encode('perché')), 'perché');
});

test('parseCsv rifiuta il file se una data non è valida', () => {
  const testo = 'Data;Importo;Descrizione\n04/03/2026;-5,00;OK\n31/02/2026;-10,00;X';
  const { movimenti, errori } = R.parseCsv(testo, { data: 'Data', importo: 'Importo', descrizione: 'Descrizione', separatore: ';' });
  assert.equal(movimenti.length, 0);
  assert.equal(errori.length, 1);
  assert.match(errori[0], /Riga 3/);
  assert.match(errori[0], /31\/02\/2026/);
});

test('parseCsv con intestazione non trovata restituisce un errore', () => {
  const { movimenti, errori } = R.parseCsv('A;B;C\n1;2;3', { data: 'Data', importo: 'Importo', descrizione: 'Descrizione', separatore: ';' });
  assert.deepEqual(movimenti, []);
  assert.equal(errori.length, 1);
});

test('parseCsv senza mappa non lancia', () => {
  assert.deepEqual(R.parseCsv('x', undefined), { movimenti: [], errori: ['mappa mancante'] });
});

test('righeDaMatrice usa la stessa logica di parseCsv', () => {
  const matrice = [['Data', 'Importo', 'Descrizione'], ['05/03/2026', '-10,00', 'PAGAMENTO']];
  const { movimenti } = R.righeDaMatrice(matrice, { data: 'Data', importo: 'Importo', descrizione: 'Descrizione' });
  assert.equal(movimenti.length, 1);
  assert.equal(movimenti[0].importo, -10);
});

test('righeDaMatrice gestisce celle con punto e virgola, virgolette e numeri', () => {
  const matrice = [['Data', 'Importo', 'Descrizione'], ['05/03/2026', -10.5, 'A;B "x"']];
  const { movimenti } = R.righeDaMatrice(matrice, { data: 'Data', importo: 'Importo', descrizione: 'Descrizione' });
  assert.equal(movimenti.length, 1);
  assert.equal(movimenti[0].descrizione, 'A;B "x"');
});

test('righePdfDaTesto estrae le righe che iniziano con una data', () => {
  const righe = ['Estratto conto', '05/03/2026 PAGAMENTO FORNITORE -10,00', 'pagina 1'];
  const out = R.righePdfDaTesto(righe, { regexRiga: /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d.]+,\d{2})$/ });
  assert.equal(out.length, 1);
});

test('righePdfDaTesto senza modello restituisce vuoto', () => {
  assert.deepEqual(R.righePdfDaTesto(['x'], undefined), []);
});

test('leggiXlsx e leggiPdf senza librerie lanciano errore chiaro', async () => {
  assert.throws(() => R.leggiXlsx(new ArrayBuffer(0)), /libreria non caricata/);
  await assert.rejects(() => R.leggiPdf({}), /libreria non caricata/);
});

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

test('finestra: da scadenza-7 a scadenza+30, estremi inclusi', () => {
  const m = d => ({ data: d, importo: -100, descrizione: 'X', numeroAssegno: null });
  assert.equal(R.punteggio(m('2026-03-03'), voce).totale, 30 + 10);
  assert.equal(R.punteggio(m('2026-03-02'), voce), null);
  assert.equal(R.punteggio(m('2026-04-09'), voce).totale, 30 + 10);
  assert.equal(R.punteggio(m('2026-04-10'), voce), null);
});

test('senza beneficiario ne banca il nome non conta e non e nei motivi', () => {
  const v = { ...voce, beneficiario: '' };
  const r = R.punteggio({ data: '2026-03-10', importo: -100, descrizione: 'ARCOM', numeroAssegno: null }, v);
  assert.equal(r.totale, 30 + 20);
  assert.equal(r.motivi.length, 2);
});

test('nome confrontato in forma normalizzata; segno ignorato', () => {
  const v = { ...voce, beneficiario: 'Arcom S.r.l.' };
  const r = R.punteggio({ data: '2026-03-10', importo: -100, descrizione: 'Pagamento ARCOM SRL fatt.1', numeroAssegno: null }, v);
  assert.equal(r.totale, 30 + 20 + 10);
});
