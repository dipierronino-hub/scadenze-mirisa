const test = require('node:test');
const assert = require('node:assert/strict');
const { oggiRoma, euro, NORMALIZZA, selezionaInScadenza, componiMessaggi } = require('./notifica');

const s = (titolo, scadenza, importo, pagato = false, extra = {}) => NORMALIZZA.scadenza({ titolo, scadenza, importo, pagato, ...extra });

test('oggi è calcolato nel fuso italiano', () => {
  assert.equal(oggiRoma(new Date('2026-10-25T22:30:00Z')), '2026-10-25'); // ora solare: 23:30 a Roma
  assert.equal(oggiRoma(new Date('2026-10-25T23:30:00Z')), '2026-10-26');
  assert.equal(oggiRoma(new Date('2026-06-30T22:30:00Z')), '2026-07-01'); // ora legale: 00:30 a Roma
});

test('prende solo le voci non pagate da oggi a 3 giorni', () => {
  const voci = [
    s('Ieri', '2026-10-25', 10), s('Oggi', '2026-10-26', 20), s('Oggi pagata', '2026-10-26', 99, true),
    s('Tra 3', '2026-10-29', 30), s('Tra 4', '2026-10-30', 40), s('Senza data', '', 50),
    NORMALIZZA.assegno({ data: '2026-10-27', importo: 150050, pagato: false, numero: '123', banca: 'BPPB', beneficiario: 'Rossi' })
  ];
  const r = selezionaInScadenza(voci, '2026-10-26', 3);
  assert.deepEqual(r.prossime.map(v => v.descrizione), ['Oggi', '🏦 Assegno Rossi', 'Tra 3']);
  assert.equal(r.prossime[1].importo, 1500.5);
  assert.deepEqual(r.scadute, { n: 1, importo: 10 });
});

test('il passaggio di mese e di anno conta i giorni giusti', () => {
  const r = selezionaInScadenza([s('A', '2027-01-02', 1), s('B', '2027-01-03', 1)], '2026-12-30', 3);
  assert.deepEqual(r.prossime.map(v => v.descrizione), ['A']);
});

test('messaggio formattato con gruppi per giorno, totale e scadute', () => {
  const voci = [
    s('Bolletta <luce> & gas', '2026-10-26', 1234.5, false, { categoria: 'Utenze', ente: 'Enel' }),
    s('Rata cartella', '2026-10-27', 100, false, { pianoId: 'P1', pianoNome: 'Cartella 2024', numeroRata: 3, totaleRatePiano: 12 }),
    s('Vecchia', '2026-10-01', 5)
  ];
  const [m, ...altri] = componiMessaggi(selezionaInScadenza(voci, '2026-10-26', 3), '2026-10-26', 'Prova');
  assert.equal(altri.length, 0);
  assert.equal(m, [
    '🔔 <b>Prova</b>', '<i>lunedì 26 ottobre</i>', '',
    '🔴 <b>Oggi</b>', '• Bolletta &lt;luce&gt; &amp; gas — <b>1.234,50 €</b>\n   <i>Utenze · Enel</i>', '',
    '🟠 <b>Domani</b> · martedì 27 ottobre', '• Rata cartella — <b>100,00 €</b>\n   <i>Cartella 2024 · Rata 3/12</i>', '',
    'Totale: 2 voci · <b>1.334,50 €</b>',
    '⚠️ Inoltre 1 voce già scaduta e non pagata (5,00 €).'
  ].join('\n'));
});

test('nessun messaggio se non c\'è nulla in scadenza', () => {
  assert.deepEqual(componiMessaggi(selezionaInScadenza([s('Lontana', '2026-12-01', 1)], '2026-10-26'), '2026-10-26', 'X'), []);
});

test('elenchi lunghi divisi in più messaggi sotto il limite di Telegram', () => {
  const voci = Array.from({ length: 200 }, (_, i) => s('Voce numero ' + i + ' con descrizione lunga', '2026-10-27', i));
  const msg = componiMessaggi(selezionaInScadenza(voci, '2026-10-26'), '2026-10-26', 'X');
  assert.ok(msg.length > 1);
  msg.forEach(m => assert.ok(m.length <= 4096));
  assert.equal(msg.join('\n').match(/^• /gm).length, 200);
});

test('euro all\'italiana', () => {
  assert.equal(euro(1234567.891), '1.234.567,89 €');
  assert.equal(euro(0), '0,00 €');
});
