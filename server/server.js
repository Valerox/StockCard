'use strict';
/**
 * Stockkarte — HTTP-Server.
 *
 * Bewusst ohne Framework: nur Node-Builtins. Dadurch ist die Installation auf
 * dem Raspberry Pi ein `git clone` und ein `node server/server.js`, ohne
 * npm install, ohne Build-Schritt, ohne Abhängigkeiten, die veralten.
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const store = require('./store');
const ops = require('./ops');
const auth = require('./auth');

const PORT = Number(process.env.PORT || process.env.STOCKKARTE_PORT || 8080);
const HOST = process.env.STOCKKARTE_HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 2 * 1024 * 1024; // 2 MB reichen für jede Sync-Ladung

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const KOMPRIMIERBAR = /^(text\/|application\/(json|manifest\+json|javascript)|image\/svg)/;

// ---------- kleine Helfer ----------

function json(res, status, daten) {
  const body = Buffer.from(JSON.stringify(daten), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function fehler(res, status, nachricht) {
  json(res, status, { fehler: nachricht });
}

function koerperLesen(req) {
  return new Promise((resolve, reject) => {
    const teile = [];
    let laenge = 0;
    req.on('data', (chunk) => {
      laenge += chunk.length;
      if (laenge > MAX_BODY) {
        reject(Object.assign(new Error('Anfrage zu groß.'), { status: 413 }));
        req.destroy();
        return;
      }
      teile.push(chunk);
    });
    req.on('end', () => {
      if (!teile.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(teile).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Ungültiges JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const ff = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
  if (typeof ff === 'string' && ff) return ff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unbekannt';
}

/** Antwort ggf. gzippen — spart auf dem Handy im Funkloch spürbar Zeit. */
function sendeGepuffert(req, res, status, body, contentType, cacheControl) {
  const kopf = { 'Content-Type': contentType, 'Cache-Control': cacheControl || 'no-cache' };
  const akzeptiert = String(req.headers['accept-encoding'] || '').includes('gzip');
  if (akzeptiert && KOMPRIMIERBAR.test(contentType) && body.length > 1024) {
    const gz = zlib.gzipSync(body, { level: 6 });
    kopf['Content-Encoding'] = 'gzip';
    kopf['Vary'] = 'Accept-Encoding';
    kopf['Content-Length'] = gz.length;
    res.writeHead(status, kopf);
    res.end(req.method === 'HEAD' ? undefined : gz);
    return;
  }
  kopf['Content-Length'] = body.length;
  res.writeHead(status, kopf);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------- statische Dateien ----------

async function statischAusliefern(req, res, urlPfad) {
  // Pfad säubern: kein Ausbruch aus public/
  const relativ = path.normalize(decodeURIComponent(urlPfad)).replace(/^([/\\])+/, '');
  const datei = path.join(PUBLIC_DIR, relativ);
  if (!datei.startsWith(PUBLIC_DIR)) {
    fehler(res, 403, 'Verboten.');
    return true;
  }

  let stat;
  try {
    stat = await fsp.stat(datei);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(datei).toLowerCase();
  const typ = MIME[ext] || 'application/octet-stream';
  const etag = '"' + stat.size.toString(16) + '-' + stat.mtimeMs.toString(16) + '"';

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }

  // Der Service Worker cached selbst; darum kurze Browser-Cache-Zeiten und
  // Revalidierung über ETag. Vendor-Libs ändern sich nie und dürfen lange bleiben.
  const cache = relativ.startsWith('vendor/') || relativ.startsWith('icons/')
    ? 'public, max-age=604800'
    : 'no-cache';

  const body = await fsp.readFile(datei);
  res.setHeader('ETag', etag);
  sendeGepuffert(req, res, 200, body, typ, cache);
  return true;
}

async function appShell(req, res) {
  const datei = path.join(PUBLIC_DIR, 'index.html');
  const body = await fsp.readFile(datei);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  sendeGepuffert(req, res, 200, body, MIME['.html'], 'no-cache');
}

// ---------- CSV-Export ----------

function csvFeld(wert) {
  const s = wert === null || wert === undefined ? '' : String(wert);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function kontrollenCsv(db) {
  const volkNach = new Map(db.voelker.map((v) => [v.id, v]));
  const kopf = ['Datum', 'Volk-Nr', 'Volk-Name', 'Stand',
    ...ops.MERKMALE.map((m) => ops.MERKMAL_LABELS[m]), 'Futter kg', 'Bemerkung'];
  const zeilen = [kopf.join(';')];

  const sortiert = db.kontrollen.slice().sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
  for (const k of sortiert) {
    const volk = volkNach.get(k.volkId) || {};
    zeilen.push([
      k.datum,
      volk.nr || '',
      volk.name || '',
      volk.stand || '',
      ...ops.MERKMALE.map((m) => (k.merkmale.includes(m) ? 'x' : '')),
      k.futterKg === null || k.futterKg === undefined ? '' : String(k.futterKg).replace('.', ','),
      k.notiz || '',
    ].map(csvFeld).join(';'));
  }
  // BOM, damit Excel die Umlaute richtig liest
  return '﻿' + zeilen.join('\r\n') + '\r\n';
}

// ---------- API ----------

async function apiBehandeln(req, res, pfad) {
  const ip = clientIp(req);

  // --- öffentlich ---
  if (pfad === '/api/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, version: store.SCHEMA_VERSION, zeit: new Date().toISOString() });
  }

  if (pfad === '/api/session' && req.method === 'GET') {
    return json(res, 200, { angemeldet: auth.istAngemeldet(req), sicher: auth.istHttps(req) });
  }

  if (pfad === '/api/login' && req.method === 'POST') {
    if (auth.gesperrt(ip)) {
      return fehler(res, 429, 'Zu viele Fehlversuche. Bitte in fünf Minuten erneut probieren.');
    }
    const body = await koerperLesen(req);
    if (await auth.passwortPruefen(body.passwort)) {
      auth.versuchErfolgreich(ip);
      auth.cookieSetzen(req, res, auth.sessionAnlegen());
      return json(res, 200, { angemeldet: true });
    }
    auth.versuchGescheitert(ip);
    // Kurz bremsen, damit Durchprobieren unattraktiv wird
    await new Promise((r) => setTimeout(r, 400));
    return fehler(res, 401, 'Passwort stimmt nicht.');
  }

  // --- ab hier nur angemeldet ---
  if (!auth.istAngemeldet(req)) {
    return fehler(res, 401, 'Nicht angemeldet.');
  }

  if (pfad === '/api/logout' && req.method === 'POST') {
    auth.sessionLoeschen(auth.cookieLesen(req));
    auth.cookieLoeschen(req, res);
    return json(res, 200, { angemeldet: false });
  }

  if (pfad === '/api/state' && req.method === 'GET') {
    const db = await store.lesen();
    const { appliedOps, ...oeffentlich } = db;
    return json(res, 200, oeffentlich);
  }

  if (pfad === '/api/ops' && req.method === 'POST') {
    const body = await koerperLesen(req);
    const liste = Array.isArray(body.ops) ? body.ops : [];
    if (liste.length > 500) return fehler(res, 413, 'Zu viele Operationen auf einmal.');

    const ergebnisse = await store.aendern((db) => ops.anwenden(db, liste));
    const db = await store.lesen();
    const { appliedOps, ...oeffentlich } = db;
    return json(res, 200, { ergebnisse: ergebnisse, state: oeffentlich });
  }

  if (pfad === '/api/passwort' && req.method === 'POST') {
    const body = await koerperLesen(req);
    if (!(await auth.passwortPruefen(body.alt))) {
      return fehler(res, 403, 'Das alte Passwort stimmt nicht.');
    }
    if (typeof body.neu !== 'string' || body.neu.length < 6) {
      return fehler(res, 400, 'Das neue Passwort braucht mindestens 6 Zeichen.');
    }
    await auth.passwortSetzen(body.neu);
    auth.alleSessionsLoeschen();
    auth.cookieSetzen(req, res, auth.sessionAnlegen()); // dieses Gerät bleibt angemeldet
    return json(res, 200, { ok: true });
  }

  if (pfad === '/api/export/csv' && req.method === 'GET') {
    const db = await store.lesen();
    const body = Buffer.from(kontrollenCsv(db), 'utf8');
    const name = 'stockkarte-kontrollen-' + new Date().toISOString().slice(0, 10) + '.csv';
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    return sendeGepuffert(req, res, 200, body, 'text/csv; charset=utf-8', 'no-store');
  }

  if (pfad === '/api/export/json' && req.method === 'GET') {
    const db = await store.lesen();
    const { appliedOps, ...oeffentlich } = db;
    const body = Buffer.from(JSON.stringify(oeffentlich, null, 2), 'utf8');
    const name = 'stockkarte-sicherung-' + new Date().toISOString().slice(0, 10) + '.json';
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    return sendeGepuffert(req, res, 200, body, 'application/json; charset=utf-8', 'no-store');
  }

  return fehler(res, 404, 'Unbekannter API-Endpunkt.');
}

// ---------- Server ----------

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  let pfad = '/';
  try {
    pfad = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return fehler(res, 400, 'Ungültige URL.');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  try {
    if (pfad.startsWith('/api/')) {
      await apiBehandeln(req, res, pfad);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      // Deep-Link vom QR-Code: /v/<volkId> öffnet direkt die Stockkarte.
      if (pfad === '/' || pfad.startsWith('/v/') || pfad === '/scan' || pfad === '/druck') {
        await appShell(req, res);
      } else if (!(await statischAusliefern(req, res, pfad))) {
        await appShell(req, res); // unbekannte Pfade an die App geben
      }
    } else {
      fehler(res, 405, 'Methode nicht erlaubt.');
    }
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[server]', req.method, pfad, err);
    if (!res.headersSent) fehler(res, status, err.message || 'Interner Fehler.');
    else res.end();
  }

  const dauer = Date.now() - start;
  if (dauer > 500) console.warn('[server] langsam:', req.method, pfad, dauer + 'ms');
});

async function starten() {
  await store.laden();
  await auth.authLaden();
  await auth.sessionsLaden();

  server.listen(PORT, HOST, () => {
    console.log('Stockkarte läuft auf http://' + HOST + ':' + PORT);
    console.log('Daten: ' + store.DB_FILE);
    console.log('');
    console.log('Hinweis: Die Kamera funktioniert nur über HTTPS (Cloudflare Tunnel)');
    console.log('oder über http://localhost. Über eine nackte LAN-IP sperrt der');
    console.log('Browser den Kamerazugriff.');
  });
}

// Sauber beenden, damit ein laufender Schreibvorgang noch fertig wird.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n' + signal + ' — Server wird beendet.');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

if (require.main === module) {
  starten().catch((err) => {
    console.error('Start fehlgeschlagen:', err.message);
    process.exit(1);
  });
}

module.exports = { server, starten, kontrollenCsv };
