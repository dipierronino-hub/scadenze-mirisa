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
