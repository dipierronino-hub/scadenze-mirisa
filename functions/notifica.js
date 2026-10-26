// Logica del riepilogo Telegram: nessuna dipendenza da Firebase, così si prova con `node --test`.
// File IDENTICO in scadenze-mirisa e scadenzario-personale: le differenze stanno solo in config.js.
'use strict';

const FUSO = 'Europe/Rome';
const ISO_RE = /^20[0-9][0-9]-[01][0-9]-[0-3][0-9]$/;
const MAX_TELEGRAM = 4000; // il limite di Telegram è 4096 caratteri per messaggio

// Data di oggi (YYYY-MM-DD) nel fuso italiano, qualunque sia il fuso del server
function oggiRoma(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function giorniTra(daIso, aIso) {
  return Math.round((Date.parse(aIso + 'T00:00:00Z') - Date.parse(daIso + 'T00:00:00Z')) / 86400000);
}
function num2(v) { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function euro(v) {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  const [intera, dec] = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '-' : '') + intera.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec + ' €';
}
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function giornoEsteso(iso) {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso + 'T12:00:00Z'));
}

// Porta scadenze e assegni nello stesso formato: { data, importo, pagato, descrizione, dettaglio }
function voceDaScadenza(r) {
  const rata = r.numeroRata ? `Rata ${r.numeroRata}${r.totaleRatePiano ? '/' + r.totaleRatePiano : ''}` : '';
  const piano = r.pianoId && r.pianoId !== 'SPESE_SINGOLE' ? (r.pianoNome || '') : '';
  const dettaglio = [r.categoria && r.categoria !== 'Altro' ? r.categoria : '', piano, rata, r.ente || '', r.riferimento || '']
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
  return {
    tipo: 'scadenza', data: String(r.scadenza || '').slice(0, 10), importo: num2(r.importo),
    pagato: r.pagato === true || r.pagato === 'true', descrizione: String(r.titolo || 'Senza descrizione'), dettaglio
  };
}
function voceDaAssegno(c) {
  return {
    tipo: 'assegno', data: String(c.data || '').slice(0, 10), importo: (Number(c.importo) || 0) / 100, // centesimi
    pagato: !!c.pagato, descrizione: '🏦 Assegno ' + (c.beneficiario || ''),
    dettaglio: [c.numero ? 'n. ' + c.numero : '', c.banca || ''].filter(Boolean).join(' · ')
  };
}
const NORMALIZZA = { scadenza: voceDaScadenza, assegno: voceDaAssegno };

// Voci non pagate da oggi a oggi+giorni, più il conteggio delle già scadute non pagate
function selezionaInScadenza(voci, oggi, giorni = 3) {
  const aperte = voci.filter(v => !v.pagato && ISO_RE.test(v.data));
  const prossime = aperte.filter(v => { const g = giorniTra(oggi, v.data); return g >= 0 && g <= giorni; })
    .sort((a, b) => a.data.localeCompare(b.data) || b.importo - a.importo);
  const scadute = aperte.filter(v => giorniTra(oggi, v.data) < 0);
  return { prossime, scadute: { n: scadute.length, importo: scadute.reduce((s, v) => s + v.importo, 0) } };
}

function titoloGiorno(g, iso) {
  if (g === 0) return '🔴 <b>Oggi</b>';
  if (g === 1) return `🟠 <b>Domani</b> · ${giornoEsteso(iso)}`;
  return `🟡 <b>Tra ${g} giorni</b> · ${giornoEsteso(iso)}`;
}

// Restituisce l'elenco dei messaggi da inviare (vuoto se non c'è nulla in scadenza)
function componiMessaggi({ prossime, scadute }, oggi, intestazione) {
  if (!prossime.length) return [];
  const righe = [`🔔 <b>${esc(intestazione)}</b>`, `<i>${giornoEsteso(oggi)}</i>`];
  let giornoCorrente = null;
  prossime.forEach(v => {
    if (v.data !== giornoCorrente) { giornoCorrente = v.data; righe.push('', titoloGiorno(giorniTra(oggi, v.data), v.data)); }
    righe.push(`• ${esc(v.descrizione)} — <b>${euro(v.importo)}</b>` + (v.dettaglio ? `\n   <i>${esc(v.dettaglio)}</i>` : ''));
  });
  const totale = prossime.reduce((s, v) => s + v.importo, 0);
  righe.push('', `Totale: ${prossime.length} ${prossime.length === 1 ? 'voce' : 'voci'} · <b>${euro(totale)}</b>`);
  if (scadute.n) righe.push(`⚠️ Inoltre ${scadute.n} ${scadute.n === 1 ? 'voce già scaduta' : 'voci già scadute'} e non ${scadute.n === 1 ? 'pagata' : 'pagate'} (${euro(scadute.importo)}).`);
  return spezza(righe);
}

// Spezza in più messaggi se si supera il limite di Telegram, senza tagliare una voce a metà
function spezza(righe) {
  const messaggi = [];
  let corrente = '';
  righe.forEach(r => {
    if (corrente && corrente.length + r.length + 1 > MAX_TELEGRAM) { messaggi.push(corrente); corrente = ''; }
    corrente += (corrente ? '\n' : '') + r;
  });
  if (corrente) messaggi.push(corrente);
  return messaggi;
}

// ---------- Comandi del bot (si scrivono con o senza "/", maiuscole o minuscole) ----------
const COMANDI = {
  scadenze: ['scadenze', 'prossime'], scadute: ['scadute', 'arretrati'], stato: ['stato', 'riepilogo'],
  aiuto: ['start', 'help', 'aiuto', 'comandi']
};
const GIORNI_COMANDO = 7;

function interpretaComando(testo) {
  const parola = String(testo || '').trim().toLowerCase().replace(/^\//, '').split(/[\s@]/)[0];
  return Object.keys(COMANDI).find(c => COMANDI[c].includes(parola)) || 'aiuto';
}

function rigaVoce(v, conData) {
  const dett = [conData ? giornoEsteso(v.data) : '', v.dettaglio].filter(Boolean).join(' · ');
  return `• ${esc(v.descrizione)} — <b>${euro(v.importo)}</b>` + (dett ? `\n   <i>${esc(dett)}</i>` : '');
}
function conteggio(voci) {
  const tot = voci.reduce((s, v) => s + v.importo, 0);
  return `${voci.length} ${voci.length === 1 ? 'voce' : 'voci'} · <b>${euro(tot)}</b>`;
}

// Risposta a un comando: elenco di messaggi HTML (sempre almeno uno)
function rispostaComando(comando, voci, oggi, intestazione) {
  const titolo = `🔔 <b>${esc(intestazione)}</b>`;
  const aperte = voci.filter(v => !v.pagato && ISO_RE.test(v.data));
  const entro = g => aperte.filter(v => { const d = giorniTra(oggi, v.data); return d >= 0 && d <= g; });
  const scadute = aperte.filter(v => giorniTra(oggi, v.data) < 0).sort((a, b) => a.data.localeCompare(b.data));
  if (comando === 'scadenze') {
    const m = componiMessaggi(selezionaInScadenza(voci, oggi, GIORNI_COMANDO), oggi, intestazione);
    return m.length ? m : [`${titolo}\n\n✅ Nessuna voce da pagare nei prossimi ${GIORNI_COMANDO} giorni.` +
      (scadute.length ? `\n⚠️ Già scadute e non pagate: ${conteggio(scadute)}. Scrivi /scadute per l'elenco.` : '')];
  }
  if (comando === 'scadute') {
    if (!scadute.length) return [`${titolo}\n\n✅ Nessuna voce scaduta da pagare.`];
    return spezza([titolo, '<i>Scadute e non pagate</i>', '', ...scadute.map(v => rigaVoce(v, true)), '', `Totale: ${conteggio(scadute)}`]);
  }
  if (comando === 'stato') {
    return [[titolo, `<i>${giornoEsteso(oggi)}</i>`, '',
      `⚠️ Scadute non pagate: ${conteggio(scadute)}`,
      `🔴 Oggi: ${conteggio(entro(0))}`,
      `📅 Prossimi 7 giorni: ${conteggio(entro(7))}`,
      `🗓 Prossimi 30 giorni: ${conteggio(entro(30))}`].join('\n')];
  }
  return [[titolo, '', 'Comandi:',
    `/scadenze · da pagare nei prossimi ${GIORNI_COMANDO} giorni`,
    '/scadute · scadute e non pagate',
    '/stato · totali in breve',
    '', 'Per aprire lo scadenzario usa il pulsante in basso a sinistra.'].join('\n')];
}

module.exports = { oggiRoma, giorniTra, euro, esc, NORMALIZZA, selezionaInScadenza, componiMessaggi, interpretaComando, rispostaComando };
