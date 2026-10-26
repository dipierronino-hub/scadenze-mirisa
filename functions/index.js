// Riepilogo giornaliero su Telegram: ogni giorno alle 08:00 (ora italiana) invia le voci
// non pagate in scadenza oggi e nei prossimi 3 giorni.
// botTelegram: risponde ai comandi scritti al bot (/scadenze, /scadute, /stato), solo dalla chat di TELEGRAM_CHAT_ID.
// File IDENTICO in scadenze-mirisa e scadenzario-personale: le differenze stanno solo in config.js.
'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { createHash } = require('node:crypto');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const CONFIG = require('./config');
const { oggiRoma, selezionaInScadenza, componiMessaggi, NORMALIZZA, esc, interpretaComando, rispostaComando } = require('./notifica');

const TELEGRAM_TOKEN = defineSecret('TELEGRAM_TOKEN');
const TELEGRAM_CHAT_ID = defineSecret('TELEGRAM_CHAT_ID');
const GIORNI = 3;
const CON_ASSEGNI = CONFIG.fonti.some(f => f.tipo === 'assegno');
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
      database(f.databaseURL).goOnline(); // dopo un goOffline (vedi sotto) l'istanza può essere riusata dal bot
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

async function chiamaTelegram(metodo, dati) {
  const risp = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN.value().trim()}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dati)
  });
  if (!risp.ok) throw new Error(`Telegram ${metodo} ${risp.status}: ${await risp.text()}`);
}

async function inviaTelegram(testo) {
  await chiamaTelegram('sendMessage', { chat_id: TELEGRAM_CHAT_ID.value().trim(), text: testo, parse_mode: 'HTML', disable_web_page_preview: true });
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


// Chiave condivisa con Telegram per riconoscere le sue chiamate al webhook (derivata dal token, nessun secret in più)
function chiaveWebhook() {
  return createHash('sha256').update('webhook:' + TELEGRAM_TOKEN.value().trim()).digest('hex').slice(0, 48);
}

// Aprire l'indirizzo della funzione con ?attiva=1 collega il bot a questa funzione (una volta sola).
// Poi Telegram manda qui ogni messaggio scritto al bot.
exports.botTelegram = onRequest({
  region: 'europe-west1', secrets: [TELEGRAM_TOKEN, TELEGRAM_CHAT_ID], memory: '256MiB', timeoutSeconds: 60, invoker: 'public'
}, async (req, res) => {
  if (req.method === 'GET') {
    if (req.query.attiva === undefined) { res.status(200).send('Bot Telegram: apri questo indirizzo con ?attiva=1 per collegarlo.'); return; }
    try {
      const host = req.get('host');
      const url = `https://${host}/${host.endsWith('cloudfunctions.net') ? 'botTelegram' : ''}`;
      await chiamaTelegram('setWebhook', { url, secret_token: chiaveWebhook(), allowed_updates: ['message'], drop_pending_updates: true });
      await chiamaTelegram('setMyCommands', { commands: [
        { command: 'scadenze', description: 'Da pagare nei prossimi 7 giorni' },
        ...(CON_ASSEGNI ? [{ command: 'assegni', description: 'Solo assegni, prossimi 30 giorni' }] : []),
        { command: 'scadute', description: 'Scadute e non pagate' },
        { command: 'stato', description: 'Totali in breve' }
      ] });
      res.status(200).send(`✅ Bot collegato: ora risponde a /scadenze, ${CON_ASSEGNI ? '/assegni, ' : ''}/scadute e /stato.`);
    } catch (e) {
      logger.error('Collegamento bot non riuscito', e);
      res.status(500).send('❌ Collegamento non riuscito: ' + e.message);
    }
    return;
  }
  if (req.get('X-Telegram-Bot-Api-Secret-Token') !== chiaveWebhook()) { res.status(403).send('no'); return; }
  const msg = req.body && req.body.message;
  // Risponde solo alla chat autorizzata: chiunque altro scriva al bot non riceve nulla
  if (!msg || !msg.text || String(msg.chat && msg.chat.id) !== TELEGRAM_CHAT_ID.value().trim()) { res.status(200).send('ok'); return; }
  try {
    const comando = interpretaComando(msg.text);
    const { voci, avvisi } = comando === 'aiuto' ? { voci: [], avvisi: [] } : await leggiVoci();
    const messaggi = rispostaComando(comando, voci, oggiRoma(), CONFIG.intestazione, CON_ASSEGNI);
    if (avvisi.length) messaggi[messaggi.length - 1] += '\n\n' + avvisi.join('\n');
    for (const m of messaggi) await inviaTelegram(m);
  } catch (e) {
    logger.error('Risposta al comando non riuscita', e);
    await inviaTelegram('❌ Non sono riuscito a leggere le scadenze: ' + esc(e.message)).catch(() => {});
  }
  res.status(200).send('ok'); // sempre 200: altrimenti Telegram ripete lo stesso messaggio
});
