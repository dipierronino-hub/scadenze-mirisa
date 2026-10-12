// Riepilogo mensile in testo, costruito dai numeri del pannello "Costi del mese".
// Funzione pura: nessun DOM, nessuna rete. Testata in Node.
(function (root) {
  'use strict';

  // dati: {mese, totale, nTotale, pagato, nPagato, daPagare, nDaPagare,
  //        scadute: {n, importo}, prossime: [{data, importo, descrizione}], giorni}
  // euro: funzione di formattazione (es. euroPunto dell'app)
  function testoRiepilogo(dati, euro) {
    const f = euro || (v => String(v));
    const righe = [];
    righe.push(`Riepilogo di ${dati.mese}: ${dati.nTotale} scadenze per ${f(dati.totale)}.`);
    righe.push(`Già pagato: ${f(dati.pagato)} (${dati.nPagato} voci). Da pagare: ${f(dati.daPagare)} (${dati.nDaPagare} voci).`);
    if (dati.scadute && dati.scadute.n > 0) {
      righe.push(`Scadute: ${dati.scadute.n} da regolarizzare per ${f(dati.scadute.importo)}.`);
    } else {
      righe.push('Nessuna scadenza scaduta da regolarizzare.');
    }
    const prossime = dati.prossime || [];
    if (prossime.length) {
      const elenco = prossime.map(p => `${p.data} ${p.descrizione} ${f(p.importo)}`).join('; ');
      righe.push(`Nei prossimi ${dati.giorni} giorni: ${prossime.length} ${prossime.length === 1 ? 'scadenza' : 'scadenze'} (${elenco}).`);
    } else {
      righe.push(`Nessuna scadenza nei prossimi ${dati.giorni} giorni.`);
    }
    return righe.join(' ');
  }

  const api = { testoRiepilogo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Riepilogo = api;
})(typeof window !== 'undefined' ? window : globalThis);
