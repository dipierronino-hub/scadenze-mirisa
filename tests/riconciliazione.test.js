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
  // formulazione implementata dei motivi
  assert.deepEqual(motivi, ['importo esatto', 'data entro 3 giorni', 'nome riconosciuto']);
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

test('numero assegno corto non conta come sottostringa', () => {
  for (const numero of ['5', '12']) {
    const v = { ...voce, numero, beneficiario: '' };
    const r = R.punteggio({ data: '2026-03-10', importo: -100, descrizione: 'fatt 125', numeroAssegno: null }, v);
    assert.equal(r.totale, 30 + 20);
  }
});

test('numero assegno come token intero nella descrizione pesa 40', () => {
  const v = { ...voce, numero: '000123' };
  const r = R.punteggio({ data: '2026-03-10', importo: -100, descrizione: 'ASSEGNO 000123 ARCOM', numeroAssegno: null }, v);
  assert.equal(r.totale, 40 + 30 + 20 + 10);
});

test('numero dentro un token piu lungo non conta', () => {
  const v = { ...voce, numero: '000123', beneficiario: '' };
  const r = R.punteggio({ data: '2026-03-10', importo: -100, descrizione: 'RIF 0001234 X', numeroAssegno: null }, v);
  assert.equal(r.totale, 30 + 20);
});

test('fascia data: 3 giorni 20, 4 giorni 10', () => {
  const m = d => ({ data: d, importo: -100, descrizione: 'X', numeroAssegno: null });
  assert.equal(R.punteggio(m('2026-03-13'), voce).totale, 30 + 20);
  assert.equal(R.punteggio(m('2026-03-14'), voce).totale, 30 + 10);
});

test('numeroAssegno nullo ma numero in descrizione conta', () => {
  const v = { ...voce, numero: '000123', beneficiario: '' };
  const r = R.punteggio({ data: '2026-03-10', importo: -100, descrizione: 'ASS. 000123', numeroAssegno: null }, v);
  assert.equal(r.totale, 40 + 30 + 20);
});

test('nome troppo corto non basta', () => {
  const v = { ...voce, beneficiario: 'SRL' };
  const r = R.punteggio({ data: '2026-03-10', importo: -100, descrizione: 'ARCOM SRL', numeroAssegno: null }, v);
  assert.equal(r.totale, 30 + 20);
});

test('due voci con stesso importo e data: un movimento abbina una sola voce', () => {
  const voci = [
    { id: 'a', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'scadenza', beneficiario: 'ARCOM' },
    { id: 'b', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'scadenza', beneficiario: 'ARCOM' },
  ];
  const movimenti = [{ data: '2026-03-10', importo: -100, descrizione: 'ARCOM', numeroAssegno: null, impronta: 'x1' }];
  const r = R.abbina(movimenti, voci, new Set());
  assert.equal(r.proposte.length + r.daDecidere.length, 1);
  assert.equal(r.daDecidere.length, 1);
  assert.equal(r.daDecidere[0].candidate.length, 2);
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

test('abbinamento univoco diventa proposta; punteggio medio va da decidere', () => {
  const voci = [
    { id: 'a', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'scadenza', beneficiario: 'ARCOM' },
    { id: 'b', scadenza: '2026-03-30', importo: 50, pagato: false, tipoVoce: 'assegno' },
  ];
  const movimenti = [
    { data: '2026-03-10', importo: -100, descrizione: 'ARCOM', numeroAssegno: null, impronta: 'm1' },
    { data: '2026-04-10', importo: -50, descrizione: 'ALTRO', numeroAssegno: null, impronta: 'm2' },
    { data: '2026-05-01', importo: -7, descrizione: 'NIENTE', numeroAssegno: null, impronta: 'm3' },
  ];
  const r = R.abbina(movimenti, voci, new Set());
  assert.equal(r.proposte.length, 1);
  assert.equal(r.proposte[0].voce.id, 'a');
  assert.ok(r.proposte[0].totale >= R.SOGLIA_PROPOSTA);
  assert.equal(r.daDecidere.length, 1);
  assert.equal(r.daDecidere[0].movimento.impronta, 'm2');
  assert.equal(r.daDecidere[0].candidate[0].voce.id, 'b');
  assert.equal(r.nonRiconciliati.length, 1);
  assert.equal(r.nonRiconciliati[0].impronta, 'm3');
});

test('voce già proposta ad un altro movimento non è candidata altrove', () => {
  const voci = [{ id: 'v1', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'scadenza', beneficiario: 'ARCOM' }];
  const movimenti = [
    { data: '2026-03-10', importo: -100, descrizione: 'ARCOM', numeroAssegno: null, impronta: 'm0' },
    { data: '2026-04-05', importo: -100, descrizione: 'ALTRO', numeroAssegno: null, impronta: 'm1' },
  ];
  const r = R.abbina(movimenti, voci, new Set());
  assert.equal(r.proposte.length, 1);
  assert.equal(r.proposte[0].movimento.impronta, 'm0');
  assert.equal(r.daDecidere.length, 0);
  assert.equal(r.nonRiconciliati.length, 1);
  assert.equal(r.nonRiconciliati[0].impronta, 'm1');
});

test('movimenti con stessa impronta nello stesso input contano una volta', () => {
  const voci = [{ id: 'a', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'scadenza', beneficiario: 'ARCOM' }];
  const mov = { data: '2026-03-10', importo: -100, descrizione: 'ARCOM', numeroAssegno: null, impronta: 'dup' };
  const r = R.abbina([mov, Object.assign({}, mov)], voci, new Set());
  assert.equal(r.proposte.length, 1);
  assert.equal(r.daDecidere.length + r.nonRiconciliati.length, 0);
});

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
  assert.equal(voci.a.pagato, false);
  assert.equal(updates.a.pianoNome, 'X');
});

test('mai scritture su voci di tipo assegno o paga', () => {
  const voci = { c: { id: 'c', scadenza: '2026-03-10', importo: 100, pagato: false, tipoVoce: 'assegno' } };
  const conferme = [{ voceId: 'c', movimento: { data: '2026-03-10', importo: -100, descrizione: 'X', impronta: 'h3', numeroAssegno: null } }];
  const { updates, saltate } = R.costruisciAggiornamenti(conferme, voci);
  assert.equal(updates.c, undefined);
  assert.equal(saltate.length, 1);
  assert.equal(saltate[0].motivo, 'tipo non scrivibile in questa versione');
});

test('voce mancante va in saltate e banca esistente resta intatta', () => {
  const voci = { d: { id: 'd', importo: 10, pagato: false, tipoVoce: 'scadenza', banca: 'BCC' } };
  const conferme = [
    { voceId: 'zz', movimento: { data: '2026-03-10', importo: -10, impronta: 'h4' } },
    { voceId: 'd', movimento: { data: '2026-03-10', importo: -10, impronta: 'h5' } },
  ];
  const { updates, saltate } = R.costruisciAggiornamenti(conferme, voci);
  assert.equal(saltate.length, 1);
  assert.equal(saltate[0].voceId, 'zz');
  assert.equal(updates.d.banca, 'BCC');
  assert.deepEqual(updates.d.riconciliazione, { impronta: 'h5', importo: -10, data: '2026-03-10' });
});

test('mappatura salvata e riletta per banca', () => {
  const mem = new Map();
  const archivio = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const mappa = { data: 'Data', importo: 'Importo', descrizione: 'Descrizione', separatore: ';' };
  assert.equal(R.salvaMappatura('BCC', mappa, archivio), true);
  assert.deepEqual(R.leggiMappatura('BCC', archivio), mappa);
  assert.ok(mem.has('riconciliazione.mappa.BCC'));
  assert.deepEqual(JSON.parse(mem.get('riconciliazione.mappa.BCC')), mappa);
});

test('archivio non disponibile: nessun errore', () => {
  const archivioRotto = { getItem() { throw new Error('negato'); }, setItem() { throw new Error('negato'); } };
  assert.equal(R.salvaMappatura('BCC', {}, archivioRotto), false);
  assert.equal(R.leggiMappatura('ALTRA', archivioRotto), null);
  R.mappatureSessione.clear();
});

test('parametri non validi: false e null', () => {
  const mem = new Map();
  const archivio = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(R.salvaMappatura(42, {}, archivio), false);
  assert.equal(R.salvaMappatura('BCC', null, archivio), false);
  assert.equal(R.salvaMappatura('BCC', 'x', archivio), false);
  assert.equal(R.leggiMappatura(42, archivio), null);
  assert.equal(R.leggiMappatura('MAI', archivio), null);
  assert.equal(mem.size, 0);
});

test('nessun archivio disponibile: false, ma la mappatura resta per la sessione', () => {
  R.mappatureSessione.clear();
  assert.equal(typeof globalThis.localStorage, 'undefined');
  const mappa = { data: 'D' };
  assert.equal(R.salvaMappatura('BCC', mappa), false);
  const letta = R.leggiMappatura('BCC');
  assert.deepEqual(letta, mappa);
  assert.notEqual(letta, mappa);
  assert.equal(R.leggiMappatura('ALTRA'), null);
  R.mappatureSessione.clear();
});

test('accessor dell archivio che lancia: mappatura di sessione', () => {
  R.mappatureSessione.clear();
  const archivio = { get setItem() { throw new Error('negato'); }, getItem() { throw new Error('negato'); } };
  assert.equal(R.salvaMappatura('BCC', { data: 'D' }, archivio), false);
  assert.deepEqual(R.leggiMappatura('BCC', archivio), { data: 'D' });
  R.mappatureSessione.clear();
});

test('la voce di sessione prevale sul valore salvato e un salvataggio riuscito la elimina', () => {
  R.mappatureSessione.clear();
  const mem = new Map();
  let rifiuta = false;
  const archivio = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => { if (rifiuta) throw new Error('quota'); mem.set(k, v); } };
  const A = { data: 'A' }, B = { data: 'B' }, C = { data: 'C' };
  assert.equal(R.salvaMappatura('BCC', A, archivio), true);
  rifiuta = true;
  assert.equal(R.salvaMappatura('BCC', B, archivio), false);
  assert.deepEqual(R.leggiMappatura('BCC', archivio), B);
  rifiuta = false;
  assert.equal(R.salvaMappatura('BCC', C, archivio), true);
  assert.deepEqual(R.leggiMappatura('BCC', archivio), C);
  assert.equal(R.mappatureSessione.size, 0);
});

test('array rifiutato e copia profonda in lettura', () => {
  const mem = new Map();
  const archivio = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(R.salvaMappatura('BCC', [1], archivio), false);
  R.salvaMappatura('BCC', { a: { b: 1 } }, archivio);
  assert.notEqual(R.leggiMappatura('BCC', archivio), R.leggiMappatura('BCC', archivio));
});

test('archivio che rifiuta setItem: la mappatura resta per la sessione', () => {
  R.mappatureSessione.clear();
  const archivio = { getItem: () => null, setItem() { throw new Error('quota'); } };
  const mappa = { data: 'D', importo: 'I' };
  assert.equal(R.salvaMappatura('BPER', mappa, archivio), false);
  assert.deepEqual(R.leggiMappatura('BPER', archivio), mappa);
  assert.equal(R.leggiMappatura('BCC', archivio), null);
  R.mappatureSessione.clear();
});

test('archivio con JSON corrotto: null', () => {
  const archivio = { getItem: () => '{non json', setItem() {} };
  assert.equal(R.leggiMappatura('BCC', archivio), null);
});

// ---- Fix wave: C1 (XLSX), C2 (forma reale delle voci), I3 (conferme parziali) ----
test('C1: leggiXlsx usa valori grezzi: serial date -> gg/mm/aaaa, numeri con virgola', () => {
  const ws = {
    '!ref': 'A1:C2',
    A1: { t: 's', v: 'Data' }, B1: { t: 's', v: 'Descrizione' }, C1: { t: 's', v: 'Importo' },
    A2: { t: 'n', v: 46086, z: 'm/d/yy' }, B2: { t: 's', v: 'BONIFICO ARCOM SRL' }, C2: { t: 'n', v: -1234.56, z: '#,##0.00' },
  };
  const colonne = ['A', 'B', 'C'];
  globalThis.XLSX = {
    read: () => ({ SheetNames: ['F1'], Sheets: { F1: ws } }),
    utils: {
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 1, c: 2 } }),
      encode_cell: ({ r, c }) => colonne[c] + (r + 1),
      sheet_to_json: () => [['Data', 'Descrizione', 'Importo'], [46086, 'BONIFICO ARCOM SRL', -1234.56]],
    },
    SSF: {
      is_date: z => /[dmy]/.test(z),
      parse_date_code: n => (n === 46086 ? { y: 2026, m: 3, d: 5 } : null),
    },
  };
  try {
    const matrice = R.leggiXlsx(new ArrayBuffer(0));
    assert.deepEqual(matrice[1], ['05/03/2026', 'BONIFICO ARCOM SRL', '-1234,56']);
    const { movimenti, errori } = R.righeDaMatrice(matrice, { data: 'Data', importo: 'Importo', descrizione: 'Descrizione' });
    assert.deepEqual(errori, []);
    assert.equal(movimenti[0].data, '2026-03-05');
    assert.equal(movimenti[0].importo, -1234.56);
  } finally { delete globalThis.XLSX; }
});

test('C2: una voce con la forma reale dell\'app (ente, codiceAvviso) raggiunge SOGLIA_PROPOSTA', () => {
  // Forma di normalizza() in index.html: nessun beneficiario/numero; li mappa ricVociAperte da ente/codiceAvviso.
  const item = { id: 'a1', titolo: 'Bolletta luce', ente: 'Enel Energia', codiceAvviso: '300012345678', importo: 250, scadenza: '2026-03-10', pagato: false };
  const vista = { ...item, tipoVoce: 'scadenza', beneficiario: item.ente, numero: item.codiceAvviso || '' };
  const mov = { data: '2026-03-11', importo: -250, descrizione: 'ADDEBITO ENEL ENERGIA SPA', numeroAssegno: null, impronta: 'x1' };
  const { totale } = R.punteggio(mov, vista);
  assert.ok(totale >= R.SOGLIA_PROPOSTA, 'totale ' + totale);
  assert.equal(R.abbina([mov], [vista], new Set()).proposte.length, 1);
  // senza la mappatura (forma grezza) non ci sarebbe nome riconosciuto: solo 50
  assert.ok(R.punteggio(mov, item).totale < R.SOGLIA_PROPOSTA);
});

function contenitoreFinto() {
  const c = { innerHTML: '', ascolti: [], addEventListener(t, f) { this.ascolti.push(f); }, removeEventListener() {} };
  c.clic = (az, i, j) => {
    const el = { disabled: false, getAttribute: n => ({ 'data-az': az, 'data-i': String(i == null ? '' : i), 'data-j': String(j == null ? '' : j) }[n]) };
    c.ascolti.forEach(f => f({ target: { closest: () => el } }));
  };
  return c;
}

test('I3: solo le voci in `scritte` risultano confermate, le saltate restano confermabili', async () => {
  const mk = (id, imp) => ({ voce: { id, tipoVoce: 'scadenza', beneficiario: 'B' + id, importo: -imp * -1, scadenza: '2026-03-10' }, movimento: { data: '2026-03-10', importo: -imp, descrizione: 'x', impronta: id }, totale: 80, motivi: ['importo esatto'] });
  const c = contenitoreFinto();
  R.apriConferma(c, { proposte: [mk('v1', 10), mk('v2', 20)], daDecidere: [], nonRiconciliati: [] }, {
    conferma: async conf => ({ ok: true, scritte: [conf[0].voceId] }),
  });
  c.clic('conferma-sel');
  await new Promise(r => setTimeout(r, 10));
  assert.equal((c.innerHTML.match(/<em>Confermata<\/em>/g) || []).length, 1);
  assert.match(c.innerHTML, /Non aggiornate/);
  assert.match(c.innerHTML, /data-az="conferma-una" data-i="1"/);
  assert.doesNotMatch(c.innerHTML, /data-az="conferma-una" data-i="0"/);
});
