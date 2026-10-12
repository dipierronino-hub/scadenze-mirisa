(function (root) {
  'use strict';

  // Soglie e finestra dell'abbinamento (spec sezione 5): un unico punto da modificare.
  const SOGLIA_PROPOSTA = 60;
  const SOGLIA_DUBBIO = 40;
  const FINESTRA = { prima: 7, dopo: 30 }; // giorni rispetto alla scadenza

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
    // Valori grezzi: niente testo formattato (che puo scambiare giorno e mese). Le celle data
    // (formato data + numero seriale) diventano gg/mm/aaaa; i numeri restano numeri con virgola decimale.
    const righe = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const inizio = ws['!ref'] && X.utils.decode_range ? X.utils.decode_range(ws['!ref']).s : { r: 0, c: 0 };
    return righe.map((r, ri) => r.map((v, ci) => {
      if (v == null) return '';
      const cella = ws[X.utils.encode_cell({ r: inizio.r + ri, c: inizio.c + ci })];
      if (typeof v === 'number') {
        if (cella && cella.z && X.SSF && X.SSF.is_date(cella.z)) {
          const d = X.SSF.parse_date_code(cella.v);
          if (d) return String(d.d).padStart(2, '0') + '/' + String(d.m).padStart(2, '0') + '/' + String(d.y).padStart(4, '0');
        }
        return String(v).replace('.', ',');
      }
      if (v instanceof Date) {
        return String(v.getUTCDate()).padStart(2, '0') + '/' + String(v.getUTCMonth() + 1).padStart(2, '0') + '/' + v.getUTCFullYear();
      }
      return String(v);
    }));
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

  function giorni(isoData) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoData));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
  }

  function normTesto(v) {
    return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  const LUNGHEZZA_MINIMA = 4; // numeri e nomi piu corti non bastano per riconoscere una voce

  function escapeRegex(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Numero citato come token intero nella descrizione, oppure uguale al numero assegno del movimento.
  function numeroCitato(num, mov) {
    if (num.length < LUNGHEZZA_MINIMA) return false;
    if (normTesto(mov.numeroAssegno) === num) return true;
    const testo = ' ' + String(mov.descrizione == null ? '' : mov.descrizione).toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    return new RegExp('(^|[^0-9a-z])' + escapeRegex(num) + '($|[^0-9a-z])').test(testo);
  }

  // Punteggio di un movimento rispetto a una voce. null se importo o finestra non combaciano.
  function punteggio(mov, voce) {
    if (Math.round(Math.abs(mov.importo) * 100) !== Math.round(Math.abs(voce.importo) * 100)) return null;
    const diff = giorni(mov.data) - giorni(voce.scadenza);
    if (!(diff >= -FINESTRA.prima && diff <= FINESTRA.dopo)) return null;
    let totale = 30;
    const motivi = ['importo esatto'];
    const desc = normTesto(mov.descrizione);
    const num = normTesto(voce.numero);
    if (numeroCitato(num, mov)) {
      totale += 40; motivi.push('numero citato');
    }
    if (Math.abs(diff) <= 3) { totale += 20; motivi.push('data entro 3 giorni'); }
    else { totale += 10; motivi.push('data entro 30 giorni'); }
    const nomi = [voce.beneficiario, voce.banca].map(normTesto).filter(n => n.length >= LUNGHEZZA_MINIMA);
    if (nomi.some(n => desc.indexOf(n) !== -1)) { totale += 10; motivi.push('nome riconosciuto'); }
    return { totale, motivi };
  }

  // Abbinamento uno a uno. riconciliate: Set di impronte gia' riconciliate (saltate).
  function abbina(movimenti, voci, riconciliate) {
    const note = riconciliate || new Set();
    const movs = [];
    const viste = new Set();
    movimenti.forEach(m => {
      if (note.has(m.impronta)) return;
      if (m.impronta != null) { if (viste.has(m.impronta)) return; viste.add(m.impronta); }
      movs.push(m);
    });
    const aperte = [];
    voci.forEach(v => { if (v.pagato !== true) aperte.push(v); });
    const coppie = [];
    movs.forEach((m, mi) => aperte.forEach((v, vi) => {
      const p = punteggio(m, v);
      if (p) coppie.push({ mi, vi, totale: p.totale, motivi: p.motivi });
    }));
    coppie.sort((a, b) => b.totale - a.totale || a.mi - b.mi || a.vi - b.vi);
    const usatiM = new Set(), usatiV = new Set(), proposte = [];
    coppie.forEach(c => {
      if (c.totale < SOGLIA_PROPOSTA) return;
      const rivale = coppie.some(o => o !== c && o.totale >= SOGLIA_PROPOSTA &&
        (o.mi === c.mi || o.vi === c.vi) && !usatiM.has(o.mi) && !usatiV.has(o.vi));
      if (rivale) return;
      usatiM.add(c.mi); usatiV.add(c.vi);
      proposte.push({ movimento: movs[c.mi], voce: aperte[c.vi], totale: c.totale, motivi: c.motivi });
    });
    const daDecidere = [], nonRiconciliati = [];
    movs.forEach((m, mi) => {
      if (usatiM.has(mi)) return;
      const candidate = coppie.filter(c => c.mi === mi && c.totale >= SOGLIA_DUBBIO && !usatiV.has(c.vi))
        .map(c => ({ voce: aperte[c.vi], totale: c.totale, motivi: c.motivi }));
      if (candidate.length) daDecidere.push({ movimento: m, candidate });
      else nonRiconciliati.push(m);
    });
    return { proposte, daDecidere, nonRiconciliati };
  }

  // Costruisce gli aggiornamenti per il database dalle conferme (funzione pura).
  // Solo voci tipoVoce 'scadenza' (assegno e paga: fase 2). Voce mancante o gia pagata: saltata.
  // banca: il Movimento non ha un campo banca in questa versione, quindi non viene
  // impostata; la copia della voce conserva l'eventuale banca esistente.
  // Il chiamante applica conMeta e db.ref(PATH).update(updates).
  function costruisciAggiornamenti(conferme, voci) {
    const updates = {}, saltate = [];
    (conferme || []).forEach(c => {
      const v = voci && voci[c.voceId];
      if (!v) { saltate.push({ voceId: c.voceId, motivo: 'voce non trovata' }); return; }
      if (v.pagato === true || updates[c.voceId]) { saltate.push({ voceId: c.voceId, motivo: 'voce gia pagata' }); return; }
      if (v.tipoVoce !== 'scadenza') { saltate.push({ voceId: c.voceId, motivo: 'tipo non scrivibile in questa versione' }); return; }
      const m = c.movimento;
      updates[c.voceId] = Object.assign({}, v, {
        pagato: true,
        dataPagamento: m.data,
        riconciliazione: { impronta: m.impronta, importo: m.importo, data: m.data },
      });
    });
    return { updates, saltate };
  }

  // Memoria della mappatura colonne per banca. Chiave 'riconciliazione.mappa.<banca>', valore JSON.
  // Se l'archivio rifiuta la scrittura, la mappatura resta solo per la sessione (mappatureSessione).
  const mappatureSessione = new Map();
  const PREFISSO_MAPPA = 'riconciliazione.mappa.';
  function archivioDi(archivio) {
    if (archivio) return archivio;
    try { return (typeof globalThis !== 'undefined' && globalThis.localStorage) || null; } catch (e) { return null; }
  }

  function copia(o) { return JSON.parse(JSON.stringify(o)); }

  function salvaMappatura(banca, mappa, archivio) {
    if (typeof banca !== 'string' || !mappa || typeof mappa !== 'object' || Array.isArray(mappa)) return false;
    const chiave = PREFISSO_MAPPA + banca;
    let copiaMappa;
    try { copiaMappa = copia(mappa); } catch (e) { return false; }
    try {
      const arch = archivioDi(archivio);
      if (arch) {
        arch.setItem(chiave, JSON.stringify(copiaMappa));
        mappatureSessione.delete(chiave);
        return true;
      }
    } catch (e) { /* archivio non utilizzabile: resta per la sessione */ }
    mappatureSessione.set(chiave, copiaMappa);
    return false;
  }

  // Una voce di sessione nasce solo da un salvataggio fallito o senza archivio: e piu recente di ogni valore salvato.
  function leggiMappatura(banca, archivio) {
    if (typeof banca !== 'string') return null;
    const chiave = PREFISSO_MAPPA + banca;
    if (mappatureSessione.has(chiave)) return copia(mappatureSessione.get(chiave));
    try {
      const arch = archivioDi(archivio);
      const raw = arch && arch.getItem(chiave);
      if (raw) {
        const m = JSON.parse(raw);
        if (m && typeof m === 'object' && !Array.isArray(m)) return m;
      }
    } catch (e) { /* illeggibile */ }
    return null;
  }

  // ---- Schermata di conferma (solo DOM, nessuna scrittura: il chiamante salva) ----
  function escapeHtml(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function euro(n) { if (n == null || n === '' || isNaN(Number(n))) return '–'; return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function htmlMovimento(m) {
    return '<div class="ric-mov"><strong>' + escapeHtml(m.data) + '</strong> &middot; ' + escapeHtml(euro(m.importo)) +
      ' &euro; &middot; ' + escapeHtml(m.descrizione) + '</div>';
  }

  function htmlVoce(v) {
    const nome = v.beneficiario || v.descrizione || v.numero || v.id;
    let t = '<span class="ric-voce">' + escapeHtml(nome) + ' &middot; scad. ' + escapeHtml(v.scadenza) + ' &middot; ' + escapeHtml(euro(v.importo)) + ' &euro;';
    if (v.banca) t += ' &middot; ' + escapeHtml(v.banca);
    if (v.numero && v.tipoVoce === 'assegno') t += ' &middot; n. ' + escapeHtml(v.numero);
    t += '</span>';
    if (v.tipoVoce === 'assegno') t += ' <em class="ric-nota">da registrare nell&#39;app assegni</em>';
    else if (v.tipoVoce === 'paga') t += ' <em class="ric-nota">da registrare nell&#39;app paghe</em>';
    return t;
  }

  // Un solo ascoltatore per contenitore: riaprire la schermata sostituisce il precedente senza toccare altri gestori.
  const ascoltatori = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  // risultato = esito di abbina; gestori = { conferma(conferme: Conferma[]), chiudi() }.
  // conferma puo ritornare una Promise; un rifiuto, un'eccezione o `false` lasciano le righe confermabili.
  function apriConferma(contenitore, risultato, gestori) {
    const r = risultato || {};
    const g = gestori || {};
    // Stato locale: proposte {scartata, spuntata, confermata}; daDecidere {scartato, scelta (indice candidata), confermato}.
    const proposte = (r.proposte || []).map(p => ({ p, scartata: false, spuntata: true, confermata: false }));
    const dubbi = (r.daDecidere || []).map(d => ({ d, candidate: d.candidate || [], scartato: false, scelta: null, confermato: false }));
    const non = r.nonRiconciliati || [];
    let messaggio = '';
    let inCorso = false; // conferma in volo: ignora altri click finche non termina

    // voceId -> indice della riga daDecidere che l'ha scelta (per bloccarla nelle altre righe).
    function vociScelte() {
      const m = new Map();
      dubbi.forEach((x, i) => {
        if (!x.scartato && !x.confermato && x.scelta != null && x.candidate[x.scelta]) m.set(x.candidate[x.scelta].voce.id, i);
      });
      return m;
    }

    function disegna() {
      const scelte = vociScelte();
      let h = '<div class="ric-conferma">';
      h += '<h3>Proposte (' + proposte.filter(x => !x.scartata).length + ')</h3>';
      if (!proposte.length) h += '<p class="ric-vuoto">Nessuna proposta.</p>';
      proposte.forEach((x, i) => {
        const v = x.p.voce, scrivibile = v.tipoVoce === 'scadenza';
        h += '<div class="ric-riga' + (x.scartata ? ' ric-scartata' : '') + '">';
        if (scrivibile && !x.scartata && !x.confermata) h += '<input type="checkbox" data-az="spunta" data-i="' + i + '"' + (x.spuntata ? ' checked' : '') + '> ';
        h += htmlMovimento(x.p.movimento) + '<div>' + htmlVoce(v) + '</div>' +
          '<div class="ric-motivi">Punteggio ' + escapeHtml(x.p.totale) + ': ' + escapeHtml((x.p.motivi || []).join(', ')) + '</div>';
        if (x.confermata) h += '<em>Confermata</em>';
        else if (x.scartata) h += '<em>Scartata</em>';
        else {
          if (scrivibile) h += '<button type="button" data-az="conferma-una" data-i="' + i + '"' + (inCorso ? ' disabled' : '') + '>Conferma</button> ';
          h += '<button type="button" data-az="scarta-p" data-i="' + i + '">Scarta</button>';
        }
        h += '</div>';
      });
      h += '<h3>Da decidere (' + dubbi.filter(x => !x.scartato && !x.confermato).length + ')</h3>';
      if (!dubbi.length) h += '<p class="ric-vuoto">Nessun movimento da decidere.</p>';
      dubbi.forEach((x, i) => {
        h += '<div class="ric-riga' + (x.scartato ? ' ric-scartata' : '') + '">' + htmlMovimento(x.d.movimento);
        if (x.confermato) h += '<em>Confermato</em>';
        else if (x.scartato) h += '<em>Scartato</em>';
        else {
          x.candidate.forEach((c, j) => {
            const scrivibile = c.voce.tipoVoce === 'scadenza';
            const altrove = scelte.has(c.voce.id) && scelte.get(c.voce.id) !== i;
            h += '<div class="ric-cand' + (x.scelta === j ? ' ric-scelta' : '') + '">' + htmlVoce(c.voce) +
              ' <span class="ric-motivi">(' + escapeHtml(c.totale) + ': ' + escapeHtml((c.motivi || []).join(', ')) + ')</span> ';
            if (scrivibile) {
              h += '<button type="button" data-az="scegli" data-i="' + i + '" data-j="' + j + '"' + (altrove ? ' disabled' : '') + '>' + (x.scelta === j ? 'Scelta' : 'Scegli') + '</button>';
              if (altrove) h += ' <em class="ric-nota">voce già scelta per un altro movimento</em>';
            }
            h += '</div>';
          });
          h += '<button type="button" data-az="scarta-d" data-i="' + i + '">Scarta</button>';
        }
        h += '</div>';
      });
      h += '<h3>Non riconciliati (' + non.length + ')</h3>';
      if (!non.length) h += '<p class="ric-vuoto">Nessuno.</p>';
      non.forEach(m => { h += '<div class="ric-riga">' + htmlMovimento(m) + '</div>'; });
      if (messaggio) h += '<p class="ric-msg" role="status">' + escapeHtml(messaggio) + '</p>';
      h += '<div class="ric-azioni"><button type="button" data-az="conferma-sel"' + (inCorso ? ' disabled' : '') + '>Conferma selezionate</button> ' +
        '<button type="button" data-az="chiudi">Chiudi</button></div></div>';
      contenitore.innerHTML = h;
    }

    // Conferme scelte: proposte spuntate, non scartate e non ancora confermate, piu le scelte da decidere.
    // Solo 'scadenza'. Una voce scelta due volte non viene inviata: il problema e riportato in `errore`.
    // Ogni elemento porta con se la riga di origine (`righe`) per marcarla confermata dopo il successo.
    function raccogli(soloProposta) {
      const conferme = [], righe = [], viste = new Set();
      let errore = '';
      function aggiungi(voce, movimento, riga) {
        if (!voce || voce.tipoVoce !== 'scadenza') return;
        if (viste.has(voce.id)) { errore = 'La voce ' + (voce.beneficiario || voce.id) + ' è scelta per più di un movimento.'; return; }
        viste.add(voce.id);
        conferme.push({ voceId: voce.id, movimento });
        righe.push(riga);
      }
      if (soloProposta != null) {
        const x = proposte[soloProposta];
        if (x && !x.scartata && !x.confermata) aggiungi(x.p.voce, x.p.movimento, x);
      } else {
        proposte.forEach(x => { if (!x.scartata && !x.confermata && x.spuntata) aggiungi(x.p.voce, x.p.movimento, x); });
        dubbi.forEach(x => {
          if (!x.scartato && !x.confermato && x.scelta != null && x.candidate[x.scelta]) aggiungi(x.candidate[x.scelta].voce, x.d.movimento, x);
        });
      }
      return { conferme, righe, errore };
    }

    function invia(soloProposta) {
      if (inCorso) return;
      const s = raccogli(soloProposta);
      if (s.errore) { messaggio = s.errore + ' Correggi la scelta.'; disegna(); return; }
      if (!s.conferme.length) { messaggio = 'Nessuna voce selezionata da confermare.'; disegna(); return; }
      if (!g.conferma) return;
      messaggio = '';
      function riuscita(esitoOk) {
        inCorso = false;
        // Se il chiamante indica gli id scritti, solo quelle righe risultano confermate; le altre restano confermabili.
        const scritte = esitoOk && Array.isArray(esitoOk.scritte) ? new Set(esitoOk.scritte) : null;
        const saltate = [];
        s.righe.forEach((x, k) => {
          if (scritte && !scritte.has(s.conferme[k].voceId)) { saltate.push(s.conferme[k].voceId); return; }
          if ('confermata' in x) x.confermata = true; else x.confermato = true;
        });
        if (saltate.length) messaggio = 'Non aggiornate (già pagate o non scrivibili): ' + saltate.join(', ') + '.';
        disegna();
      }
      function fallita(e) { inCorso = false; messaggio = 'Conferma non riuscita' + (e && e.message ? ': ' + e.message : '.'); disegna(); }
      inCorso = true;
      let esito;
      try { esito = g.conferma(s.conferme); } catch (e) { fallita(e); return; }
      if (esito && typeof esito.then === 'function') esito.then(v => { if (v === false) fallita(); else riuscita(v); }, fallita);
      else if (esito === false) fallita();
      else riuscita(esito);
      if (inCorso) disegna(); // Promise in attesa: mostra i pulsanti disabilitati
    }

    function suClick(ev) {
      const el = ev.target && ev.target.closest ? ev.target.closest('[data-az]') : null;
      if (!el || el.disabled) return;
      const az = el.getAttribute('data-az');
      const i = Number(el.getAttribute('data-i')), j = Number(el.getAttribute('data-j'));
      if (az === 'spunta') { proposte[i].spuntata = !!el.checked; return; }
      if (az === 'scarta-p') proposte[i].scartata = true;
      else if (az === 'scarta-d') dubbi[i].scartato = true;
      else if (az === 'scegli') {
        const id = dubbi[i].candidate[j].voce.id, altrove = vociScelte().get(id);
        if (altrove !== undefined && altrove !== i) return;
        dubbi[i].scelta = dubbi[i].scelta === j ? null : j;
      }
      else if (az === 'conferma-una') { invia(i); return; }
      else if (az === 'conferma-sel') { invia(); return; }
      else if (az === 'chiudi') { if (g.chiudi) g.chiudi(); return; }
      messaggio = '';
      disegna();
    }

    if (ascoltatori) {
      const prec = ascoltatori.get(contenitore);
      if (prec) contenitore.removeEventListener('click', prec);
      ascoltatori.set(contenitore, suClick);
    }
    contenitore.addEventListener('click', suClick);
    disegna();
  }

  const api = { normalizzaImporto, normalizzaData, impronta, parseCsv, decodificaTesto, righeDaMatrice, righePdfDaTesto, leggiXlsx, leggiPdf, punteggio, abbina, costruisciAggiornamenti, salvaMappatura, leggiMappatura, apriConferma, mappatureSessione, SOGLIA_PROPOSTA, SOGLIA_DUBBIO, FINESTRA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Riconciliazione = api;
})(typeof window !== 'undefined' ? window : this);
