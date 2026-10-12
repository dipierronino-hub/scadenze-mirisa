(function (root) {
  'use strict';

  // Importo in formato italiano ('1.234,56') o semplice ('1234.56'). NaN se illeggibile.
  function normalizzaImporto(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    let s = String(v).replace(/[\s€]/g, '');
    if (s === '') return NaN;
    if (s.indexOf(',') !== -1) {
      if (s.indexOf('.', s.indexOf(',')) !== -1) return NaN; // ordine non italiano ('1,234.56')
      s = s.replace(/\./g, '').replace(',', '.');
    }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return Number(s);
  }

  function dataValida(a, m, g) {
    const d = new Date(Date.UTC(a, m - 1, g));
    return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === g;
  }

  function iso(a, m, g) {
    if (!dataValida(a, m, g)) return null;
    const p = (n, l) => String(n).padStart(l, '0');
    return p(a, 4) + '-' + p(m, 2) + '-' + p(g, 2);
  }

  // Data in ISO (aaaa-mm-gg) o italiana giorno-mese-anno. null se non valida.
  function normalizzaData(v) {
    if (v == null) return null;
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s);
    if (m) {
      let a = +m[3];
      if (m[3].length === 2) a += 2000;
      return iso(a, +m[2], +m[1]);
    }
    return null;
  }

  // Digest cyrb53 (sincrono, deterministico), restituito come hex di 14 caratteri.
  function cyrb53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  }

  // Chiave stabile da data + importo + descrizione normalizzata.
  function impronta(mov) {
    const desc = String(mov.descrizione == null ? '' : mov.descrizione)
      .toLowerCase().replace(/\s+/g, ' ').trim();
    const imp = Number(mov.importo);
    const impStr = Number.isFinite(imp) ? imp.toFixed(2) : String(mov.importo);
    return cyrb53([mov.data, impStr, desc].join('|'));
  }

  const api = { normalizzaImporto, normalizzaData, impronta };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Riconciliazione = api;
})(typeof window !== 'undefined' ? window : this);
