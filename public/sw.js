// Service Worker — macht die App am Bienenstand ohne Netz benutzbar.
//
// Regeln:
//   /api/…        nie zwischenspeichern (Daten laufen über IndexedDB in store.js)
//   Navigationen  bei fehlendem Netz die gespeicherte Hülle ausliefern
//   sonst         zuerst aus dem Cache, im Hintergrund auffrischen
//
// Beim Ändern von Dateien VERSION hochzählen, dann holt sich jedes Gerät
// den neuen Stand.

const VERSION = 'stockkarte-v4';
const HUELLE = '/index.html';

const VORRAT = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/js/app.js',
  '/js/store.js',
  '/js/views.js',
  '/js/format.js',
  '/js/scanner.js',
  '/js/qr.js',
  '/vendor/jsQR.js',
  '/vendor/qrcode-generator.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
];

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil(
    caches.open(VERSION)
      // Einzelne fehlende Datei darf die Installation nicht kippen
      .then((cache) => Promise.allSettled(VORRAT.map((pfad) => cache.add(pfad))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== 'GET') return;

  const url = new URL(anfrage.url);
  if (url.origin !== location.origin) return;

  // Daten und Anmeldung immer frisch vom Pi
  if (url.pathname.startsWith('/api/')) return;

  // Seitenaufrufe: Netz zuerst, sonst die gespeicherte Hülle
  if (anfrage.mode === 'navigate') {
    ereignis.respondWith(
      fetch(anfrage)
        .then((antwort) => {
          const kopie = antwort.clone();
          caches.open(VERSION).then((cache) => cache.put(HUELLE, kopie)).catch(() => {});
          return antwort;
        })
        .catch(() => caches.match(HUELLE).then((treffer) => treffer || caches.match('/')))
    );
    return;
  }

  // Statische Dateien: aus dem Cache, im Hintergrund auffrischen
  ereignis.respondWith(
    caches.match(anfrage).then((treffer) => {
      const ausDemNetz = fetch(anfrage)
        .then((antwort) => {
          if (antwort && antwort.status === 200 && antwort.type === 'basic') {
            const kopie = antwort.clone();
            caches.open(VERSION).then((cache) => cache.put(anfrage, kopie)).catch(() => {});
          }
          return antwort;
        })
        .catch(() => treffer);
      return treffer || ausDemNetz;
    })
  );
});
