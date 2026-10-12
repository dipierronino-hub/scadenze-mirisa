const test = require('node:test');
const assert = require('node:assert/strict');
const { testoRiepilogo } = require('../riepilogo.js');

const euro = v => Number(v).toFixed(2).replace('.', ',') + ' €';

test('riepilogo completo con scadute e prossime scadenze', () => {
  const t = testoRiepilogo({
    mese: 'ottobre 2026', totale: 1000, nTotale: 4, pagato: 300, nPagato: 1, daPagare: 700, nDaPagare: 3,
    scadute: { n: 2, importo: 450 },
    prossime: [{ data: '15/10/2026', descrizione: 'ARCOM', importo: 200 }],
    giorni: 7,
  }, euro);
  assert.equal(t,
    'Riepilogo di ottobre 2026: 4 scadenze per 1000,00 €. ' +
    'Già pagato: 300,00 € (1 voci). Da pagare: 700,00 € (3 voci). ' +
    'Scadute: 2 da regolarizzare per 450,00 €. ' +
    'Nei prossimi 7 giorni: 1 scadenza (15/10/2026 ARCOM 200,00 €).');
});

test('nessuna scaduta e nessuna prossima scadenza', () => {
  const t = testoRiepilogo({
    mese: 'novembre 2026', totale: 0, nTotale: 0, pagato: 0, nPagato: 0, daPagare: 0, nDaPagare: 0,
    scadute: { n: 0, importo: 0 }, prossime: [], giorni: 7,
  }, euro);
  assert.ok(t.includes('Nessuna scadenza scaduta da regolarizzare.'));
  assert.ok(t.endsWith('Nessuna scadenza nei prossimi 7 giorni.'));
});

test('plurale corretto con più prossime scadenze e senza formatter', () => {
  const t = testoRiepilogo({
    mese: 'x', totale: 2, nTotale: 2, pagato: 0, nPagato: 0, daPagare: 2, nDaPagare: 2,
    scadute: { n: 0, importo: 0 },
    prossime: [{ data: '01/10/2026', descrizione: 'A', importo: 1 }, { data: '02/10/2026', descrizione: 'B', importo: 1 }],
    giorni: 7,
  });
  assert.ok(t.includes('2 scadenze'));
  assert.ok(t.includes('per 2'));
});
