// Riepilogo giornaliero su Telegram: ogni giorno alle 08:00 (ora italiana) invia le voci
// non pagate in scadenza oggi e nei prossimi 3 giorni.
// File IDENTICO in scadenze-mirisa e scadenzario-personale: le differenze stanno solo in config.js.
'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const CONFIG = require('./config');
const { oggiRoma, selezionaInScadenza, componiMessaggi, NORMALIZZA, esc } = require('./notifica');

const TELEGRAM_TOKEN = defineSecret('TELEGRAM_TOKEN');
const TELEGRAM_CHAT_ID = defineSecret('TELEGRAM_CHAT_ID');
const GIORNI = 3;
const ATTESA_MAX_MS = 20000; // senza permessi il database non risponde mai: meglio arrendersi e inviare il resto

const app = {};
function database(url) {
  if (!app[url]) app[url] = initializeApp({ databaseURL: url }, url);
  return getDatabase(app[url]);
}

function conTimeout(promessa, ms, nome) {
  let timer;
  const scaduto = new Promise((_, rifiuta) => { timer = setTimeout(() => rifiuta(new Error(`${nome}: nessuna risposta in ${ms / 1000} s (permessi mancanti?)`)), ms); });
  return Promise.race([promessa, scaduto]).finally(() => clearTimeout(timer));
}

async function leggiVoci() {
  const voci = [], avvisi = [];
  for (const f of CONFIG.fonti) {
    try {
      const dati = (await conTimeout(database(f.databaseURL).ref(f.percorso).get(), ATTESA_MAX_MS, f.percorso)).val() || {};
      // perUtente: dati divisi per utente (personale/{uid}/{id}), si uniscono tutti
      const record = f.perUtente ? Object.values(dati).flatMap(u => Object.values(u || {})) : Object.values(dati);
      record.filter(r => r && typeof r === 'object').forEach(r => voci.push(NORMALIZZA[f.tipo](r)));
    } catch (e) {
      database(f.databaseURL).goOffline(); // ferma i tentativi di riconnessione in background
      if (!f.facoltativa) throw e;
      logger.warn(`Fonte ${f.tipo} non letta`, e);
      avvisi.push(`ℹ️ <i>${esc(f.tipo === 'assegno' ? 'Assegni' : f.tipo)} non letti: ${esc(e.message)}</i>`);
    }
  }
  return { voci, avvisi };
}

async function inviaTelegram(testo) {
  const risp = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN.value().trim()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID.value().trim(), text: testo, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  if (!risp.ok) throw new Error(`Telegram ${risp.status}: ${await risp.text()}`);
}

async function eseguiRiepilogo() {
  const oggi = oggiRoma();
  const { voci, avvisi } = await leggiVoci();
  const messaggi = componiMessaggi(selezionaInScadenza(voci, oggi, GIORNI), oggi, CONFIG.intestazione);
  if (messaggi.length && avvisi.length) messaggi[messaggi.length - 1] += '\n\n' + avvisi.join('\n');
  for (const m of messaggi) await inviaTelegram(m);
  logger.info(`Riepilogo ${oggi}: ${voci.length} voci lette, ${messaggi.length} messaggi inviati`);
}

exports.riepilogoTelegram = onSchedule({
  schedule: '0 8 * * *', timeZone: 'Europe/Rome', region: 'europe-west1',
  secrets: [TELEGRAM_TOKEN, TELEGRAM_CHAT_ID], memory: '256MiB', timeoutSeconds: 120, retryCount: 1
}, eseguiRiepilogo);

