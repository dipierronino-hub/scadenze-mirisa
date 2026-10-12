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

  // Divide una riga CSV rispettando i campi tra virgolette.
  function dividiRiga(riga, sep) {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < riga.length; i++) {
      const c = riga[i];
      if (inQ) {
        if (c === '"') {
          if (riga[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === sep) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  // Legge un estratto conto CSV. mappa = { data, importo, descrizione, separatore }
  // (nomi di colonna dell'intestazione). Un solo errore di lettura scarta l'intero file.
  function parseCsv(testo, mappa) {
    if (!mappa) return { movimenti: [], errori: ['mappa mancante'] };
    const sep = mappa.separatore || ';';
    const righe = String(testo == null ? '' : testo).replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
    const nome = v => String(v == null ? '' : v).trim().toLowerCase();
    const cercati = [mappa.data, mappa.importo, mappa.descrizione].map(nome);
    let iHead = -1, idx = null;
    for (let i = 0; i < Math.min(righe.length, 30); i++) {
      const celle = dividiRiga(righe[i], sep).map(nome);
      const pos = cercati.map(c => celle.indexOf(c));
      if (pos.every(p => p !== -1)) { iHead = i; idx = pos; break; }
    }
    if (iHead === -1) {
      return { movimenti: [], errori: ['Intestazione non trovata: controlla la mappatura delle colonne'] };
    }
    const movimenti = [], errori = [];
    for (let i = iHead + 1; i < righe.length; i++) {
      if (righe[i].trim() === '') continue;
      const celle = dividiRiga(righe[i], sep);
      const cellaData = (celle[idx[0]] || '').trim();
      if (cellaData === '') continue; // riga senza data
      if (/^\s*(totale|saldo)/i.test(celle[0] || '')) continue; // riga di totale
      const data = normalizzaData(cellaData);
      if (!data) {
        errori.push('Riga ' + (i + 1) + ': data non valida ("' + cellaData + '")');
        continue;
      }
      const importo = normalizzaImporto(celle[idx[1]]);
      if (Number.isNaN(importo)) {
        errori.push('Riga ' + (i + 1) + ': importo non leggibile ("' + (celle[idx[1]] || '').trim() + '")');
        continue;
      }
      if (importo >= 0) continue;
      const descrizione = (celle[idx[2]] || '').trim();
      const m = /ASS(?:EGNO)?\.?\s*(\d{4,})/i.exec(descrizione);
      const mov = { data, importo, descrizione, numeroAssegno: m ? m[1] : null };
      mov.impronta = impronta(mov);
      movimenti.push(mov);
    }
    if (errori.length) return { movimenti: [], errori };
    return { movimenti, errori };
  }

  // Decodifica byte in testo con la codifica indicata (es. 'windows-1252').
  function decodificaTesto(bytes, codifica) {
    return new TextDecoder(codifica || 'utf-8').decode(bytes);
  }

  // Converte una matrice di celle (es. da XLSX) in movimenti, riusando parseCsv.
  function righeDaMatrice(matrice, mappa) {
    const cella = v => {
      const t = String(v == null ? '' : v).replace(/\r\n|\n|\r/g, ' ');
      return /[;"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const testo = (matrice || []).map(r => (r || []).map(cella).join(';')).join('\n');
    return parseCsv(testo, Object.assign({}, mappa, { separatore: ';' }));
  }

  // Tiene le righe di testo PDF che corrispondono a modello.regexRiga.
  function righePdfDaTesto(righe, modello) {
    if (!modello || !modello.regexRiga) return [];
    const re = new RegExp(modello.regexRiga.source, modello.regexRiga.flags.replace(/[gy]/g, ''));
    return (righe || []).filter(r => re.test(String(r).trim()));
  }

  // Solo browser: legge un XLSX con SheetJS globale e restituisce string[][].
  function leggiXlsx(arrayBuffer) {
    const X = globalThis.XLSX;
    if (!X) throw new Error('libreria non caricata');
    const wb = X.read(arrayBuffer, { type: 'array', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
      .map(r => r.map(c => String(c == null ? '' : c)));
  }

  // Solo browser: estrae il testo di un PDF con pdf.js globale, una stringa per riga.
  async function leggiPdf(file) {
    const lib = globalThis.pdfjsLib;
    if (!lib) throw new Error('libreria non caricata');
    const buf = file && typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : file;
    const pdf = await lib.getDocument({ data: buf }).promise;
    const righe = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const contenuto = await (await pdf.getPage(p)).getTextContent();
      let y = null, cur = [];
      for (const it of contenuto.items) {
        const yy = it.transform ? Math.round(it.transform[5]) : 0;
        if (y !== null && Math.abs(yy - y) > 2) { righe.push(cur.join(' ').replace(/\s+/g, ' ').trim()); cur = []; }
        y = yy;
        cur.push(it.str);
      }
      if (cur.length) righe.push(cur.join(' ').replace(/\s+/g, ' ').trim());
    }
    return righe.filter(r => r);
  }

  const api = { normalizzaImporto, normalizzaData, impronta, parseCsv, decodificaTesto, righeDaMatrice, righePdfDaTesto, leggiXlsx, leggiPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Riconciliazione = api;
})(typeof window !== 'undefined' ? window : this);
