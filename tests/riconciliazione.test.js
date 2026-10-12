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
