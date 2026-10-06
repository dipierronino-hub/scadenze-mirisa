// Service worker dello Scadenzario Generale.
// Serve solo a rendere l'app installabile e ad aprirla anche con rete lenta.
// I dati delle scadenze NON vengono mai salvati qui: arrivano sempre da Firebase dopo il login.
const CACHE = 'scadenzario-shell-v5';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Solo i file dell'app (stessa origine, GET). Rete prima: così ogni aggiornamento
// caricato su GitHub arriva subito; la copia salvata serve solo se la rete non risponde.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
