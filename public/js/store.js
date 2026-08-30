// Zustand der App im Browser: lokaler Spiegel der Daten vom Pi,
// plus eine Warteschlange für alles, was am Bienenstand ohne Netz entsteht.
//
// Ablauf einer Änderung:
//   1. Operation erzeugen und sofort lokal anwenden  -> UI reagiert ohne Warten
//   2. in IndexedDB in die Outbox legen              -> übersteht App-Neustart
//   3. beim nächsten Netz an den Pi schicken         -> Server ist die Wahrheit
//
// Der Server wendet jede Operations-id nur einmal an. Deshalb dürfen wir
// beliebig oft nachliefern, ohne doppelte Einträge zu riskieren.

const DB_NAME = 'stockkarte';
const DB_VERSION = 1;
const SPEICHER_META = 'meta';
const SPEICHER_OUTBOX = 'outbox';

export const MERKMALE = [
  { key: 'koenigin', label: 'Königin', kurz: 'K' },
  { key: 'stifte', label: 'Stifte', kurz: 'St' },
  { key: 'made', label: 'Made', kurz: 'Ma' },
  { key: 'brut', label: 'verd. Brut', kurz: 'vB' },
  { key: 'pollen', label: 'Pollen', kurz: 'Po' },
  { key: 'futter', label: 'Futter', kurz: 'Fu' },
];

export const STATUS_WERTE = ['stark', 'schwach', 'Ableger', 'Volk tot'];

export const STATUS_FARBE = {
  stark: '#5E7B45',
  schwach: '#E3B23C',
  Ableger: '#8C6A1F',
  'Volk tot': '#8C4A2F',
};

// ---------- IndexedDB ----------

let dbPromise = null;

function idb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const anfrage = indexedDB.open(DB_NAME, DB_VERSION);
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result;
      if (!db.objectStoreNames.contains(SPEICHER_META)) db.createObjectStore(SPEICHER_META);
      if (!db.objectStoreNames.contains(SPEICHER_OUTBOX)) db.createObjectStore(SPEICHER_OUTBOX, { keyPath: 'id' });
    };
    anfrage.onsuccess = () => resolve(anfrage.result);
    anfrage.onerror = () => reject(anfrage.error);
  }).catch((err) => {
    // Privates Fenster o. Ä. — dann läuft die App eben nur online weiter.
    console.warn('[store] IndexedDB nicht verfügbar:', err);
    return null;
  });
  return dbPromise;
}

async function idbLesen(speicher, schluessel) {
  const db = await idb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const t = db.transaction(speicher, 'readonly');
    const a = schluessel === undefined ? t.objectStore(speicher).getAll() : t.objectStore(speicher).get(schluessel);
    a.onsuccess = () => resolve(a.result);
    a.onerror = () => resolve(undefined);
  });
}

async function idbSchreiben(speicher, wert, schluessel) {
  const db = await idb();
  if (!db) return;
  return new Promise((resolve) => {
    const t = db.transaction(speicher, 'readwrite');
    if (schluessel === undefined) t.objectStore(speicher).put(wert);
    else t.objectStore(speicher).put(wert, schluessel);
    t.oncomplete = () => resolve();
    t.onerror = () => resolve();
  });
}

async function idbLoeschen(speicher, schluessel) {
  const db = await idb();
  if (!db) return;
  return new Promise((resolve) => {
    const t = db.transaction(speicher, 'readwrite');
    t.objectStore(speicher).delete(schluessel);
    t.oncomplete = () => resolve();
    t.onerror = () => resolve();
  });
}

// ---------- Zustand ----------

const leererZustand = () => ({
  schemaVersion: 1,
  settings: { imkerei: 'Meine Imkerei', kuerzel: 'IM' },
  staende: [],
  voelker: [],
  kontrollen: [],
  honig: [],
  honigraum: [],
  behandlungen: [],
});

export const zustand = {
  daten: leererZustand(),
  outbox: [],
  online: navigator.onLine,
  syncLaeuft: false,
  geladen: false,
  angemeldet: false,
  letzterFehler: null,
};

const horcher = new Set();

/** Auf Zustandsänderungen reagieren (die App zeichnet sich dann neu). */
export function beiAenderung(fn) {
  horcher.add(fn);
  return () => horcher.delete(fn);
}

function melden() {
  for (const fn of horcher) {
    try { fn(); } catch (err) { console.error('[store] Horcher-Fehler:', err); }
  }
}

// ---------- Operationen lokal anwenden ----------
//
// Bewusst schlanker als die Prüfung auf dem Server: hier geht es nur darum,
// dass die Anzeige sofort stimmt. Sobald der Pi antwortet, ersetzt seine
// Antwort den lokalen Stand — dadurch heilt jede Abweichung von selbst.

function ohne(liste, id) {
  return liste.filter((e) => e.id !== id);
}

const LOKAL = {
  'volk.create'(d, s) {
    if (s.voelker.some((v) => v.id === d.id)) return;
    s.voelker.push({
      id: d.id, nr: d.nr, name: d.name || ('Volk ' + d.nr), stand: d.stand || '',
      status: d.status || 'stark', koeniginJahr: d.koeniginJahr ?? null,
      notiz: d.notiz || '', erstelltAm: d.erstelltAm || new Date().toISOString(),
    });
  },
  'volk.update'(d, s) {
    const v = s.voelker.find((x) => x.id === d.id);
    if (v) Object.assign(v, d);
  },
  'volk.delete'(d, s) {
    s.voelker = ohne(s.voelker, d.id);
    for (const key of ['kontrollen', 'honig', 'honigraum', 'behandlungen']) {
      s[key] = s[key].filter((e) => e.volkId !== d.id);
    }
  },
  'kontrolle.create'(d, s) {
    if (s.kontrollen.some((k) => k.id === d.id)) return;
    s.kontrollen.push({
      id: d.id, volkId: d.volkId, datum: d.datum, merkmale: d.merkmale || [],
      futterKg: d.futterKg ?? null, notiz: d.notiz || '',
      erfasstAm: d.erfasstAm || new Date().toISOString(),
    });
  },
  'kontrolle.delete'(d, s) { s.kontrollen = ohne(s.kontrollen, d.id); },
  'honig.create'(d, s) {
    if (s.honig.some((h) => h.id === d.id)) return;
    s.honig.push({
      id: d.id, volkId: d.volkId, datum: d.datum,
      waben: d.waben ?? null, kg: d.kg ?? null,
      erfasstAm: d.erfasstAm || new Date().toISOString(),
    });
  },
  'honig.delete'(d, s) { s.honig = ohne(s.honig, d.id); },
  'honigraum.set'(d, s) {
    let e = s.honigraum.find((h) => h.volkId === d.volkId && h.jahr === d.jahr);
    if (!e) {
      e = { id: d.volkId + '-' + d.jahr, volkId: d.volkId, jahr: d.jahr, rauf: null, runter: null };
      s.honigraum.push(e);
    }
    if (d.rauf !== undefined) e.rauf = d.rauf || null;
    if (d.runter !== undefined) e.runter = d.runter || null;
  },
  'behandlung.create'(d, s) {
    if (s.behandlungen.some((b) => b.id === d.id)) return;
    s.behandlungen.push({
      id: d.id, volkId: d.volkId, art: d.art || 'behandlung', datum: d.datum,
      mittel: d.mittel || '', menge: d.menge || '', notiz: d.notiz || '',
      erfasstAm: d.erfasstAm || new Date().toISOString(),
    });
  },
  'behandlung.delete'(d, s) { s.behandlungen = ohne(s.behandlungen, d.id); },
  'stand.create'(d, s) {
    if (!s.staende.some((x) => x.name === d.name)) s.staende.push({ id: d.id, name: d.name });
  },
  'stand.delete'(d, s) { s.staende = ohne(s.staende, d.id); },
  'settings.update'(d, s) { Object.assign(s.settings, d); },
};

function lokalAnwenden(op) {
  const fn = LOKAL[op.type];
  if (fn) fn(op.data || {}, zustand.daten);
}

// ---------- Netz ----------

export function neueId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

async function anfrage(pfad, optionen = {}) {
  const antwort = await fetch(pfad, {
    credentials: 'same-origin',
    headers: optionen.body ? { 'Content-Type': 'application/json' } : {},
    ...optionen,
  });
  if (antwort.status === 401) {
    zustand.angemeldet = false;
    melden();
    throw Object.assign(new Error('Nicht angemeldet.'), { status: 401 });
  }
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok) {
    throw Object.assign(new Error(daten.fehler || 'Serverfehler.'), { status: antwort.status });
  }
  return daten;
}

// ---------- Öffentliche Schnittstelle ----------

export async function sessionPruefen() {
  try {
    const daten = await anfrage('/api/session');
    zustand.angemeldet = daten.angemeldet;
    return daten;
  } catch {
    zustand.angemeldet = false;
    return { angemeldet: false, sicher: location.protocol === 'https:' };
  }
}

export async function anmelden(passwort) {
  await anfrage('/api/login', { method: 'POST', body: JSON.stringify({ passwort }) });
  zustand.angemeldet = true;
  melden();
  await laden();
}

export async function abmelden() {
  try { await anfrage('/api/logout', { method: 'POST' }); } catch { /* egal */ }
  zustand.angemeldet = false;
  melden();
}

/** Zwischenstand aus IndexedDB holen, damit die App auch offline sofort steht. */
export async function ausCacheLaden() {
  const [gespeichert, outbox] = await Promise.all([
    idbLesen(SPEICHER_META, 'state'),
    idbLesen(SPEICHER_OUTBOX),
  ]);
  if (gespeichert) zustand.daten = gespeichert;
  zustand.outbox = Array.isArray(outbox) ? outbox.sort((a, b) => a.ts - b.ts) : [];
  // Offline entstandene Einträge wieder über den Cache legen
  for (const op of zustand.outbox) lokalAnwenden(op);
  zustand.geladen = true;
  melden();
}

/** Frischen Stand vom Pi holen. */
export async function laden() {
  try {
    const daten = await anfrage('/api/state');
    zustand.daten = daten;
    zustand.online = true;
    zustand.letzterFehler = null;
    await idbSchreiben(SPEICHER_META, daten, 'state');
    // Was noch in der Outbox liegt, ist im Server-Stand noch nicht enthalten
    for (const op of zustand.outbox) lokalAnwenden(op);
    zustand.geladen = true;
    melden();
    return true;
  } catch (err) {
    if (err.status === 401) throw err;
    zustand.online = false;
    zustand.geladen = true;
    melden();
    return false;
  }
}

/**
 * Eine Änderung durchführen: sofort lokal sichtbar, danach zum Pi.
 * Gibt zurück, ob die Übertragung sofort geklappt hat.
 */
export async function mutieren(type, data) {
  const op = { id: neueId(), type, data, ts: Date.now() };
  lokalAnwenden(op);
  zustand.outbox.push(op);
  melden();

  await idbSchreiben(SPEICHER_OUTBOX, op);
  await idbSchreiben(SPEICHER_META, zustand.daten, 'state');

  return synchronisieren();
}

let syncGeplant = null;

/** Alles aus der Outbox zum Pi schicken. */
export async function synchronisieren() {
  if (zustand.syncLaeuft || !zustand.outbox.length) return zustand.outbox.length === 0;
  if (!navigator.onLine) {
    zustand.online = false;
    melden();
    return false;
  }

  zustand.syncLaeuft = true;
  melden();

  const gesendet = zustand.outbox.slice(0, 200);
  try {
    const antwort = await anfrage('/api/ops', {
      method: 'POST',
      body: JSON.stringify({ ops: gesendet.map((o) => ({ id: o.id, type: o.type, data: o.data })) }),
    });

    // Alles Gesendete aus der Outbox nehmen — auch fachlich Abgelehntes,
    // denn das würde auch beim nächsten Versuch abgelehnt.
    const abgelehnt = [];
    for (const e of antwort.ergebnisse || []) {
      if (e.status === 'abgelehnt') abgelehnt.push(e.fehler);
    }
    const gesendeteIds = new Set(gesendet.map((o) => o.id));
    zustand.outbox = zustand.outbox.filter((o) => !gesendeteIds.has(o.id));
    for (const id of gesendeteIds) await idbLoeschen(SPEICHER_OUTBOX, id);

    zustand.daten = antwort.state;
    zustand.online = true;
    zustand.letzterFehler = abgelehnt.length ? abgelehnt[0] : null;

    // Falls währenddessen neue Einträge dazukamen: wieder drüberlegen
    for (const op of zustand.outbox) lokalAnwenden(op);
    await idbSchreiben(SPEICHER_META, antwort.state, 'state');

    zustand.syncLaeuft = false;
    melden();

    if (zustand.outbox.length) return synchronisieren(); // Rest hinterherschicken
    return true;
  } catch (err) {
    zustand.syncLaeuft = false;
    if (err.status === 401) {
      zustand.angemeldet = false;
      melden();
      return false;
    }
    zustand.online = false;
    melden();
    spaeterNochmal();
    return false;
  }
}

let versuch = 0;
function spaeterNochmal() {
  if (syncGeplant) return;
  versuch = Math.min(versuch + 1, 6);
  const wartezeit = Math.min(30000, 2000 * Math.pow(1.8, versuch - 1));
  syncGeplant = setTimeout(() => {
    syncGeplant = null;
    synchronisieren().then((ok) => { if (ok) versuch = 0; });
  }, wartezeit);
}

// Sobald wieder Netz da ist, sofort nachliefern.
addEventListener('online', () => {
  zustand.online = true;
  versuch = 0;
  melden();
  synchronisieren();
});
addEventListener('offline', () => {
  zustand.online = false;
  melden();
});

// Beim Zurückholen der App aus dem Hintergrund frisch synchronisieren.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && zustand.angemeldet) {
    synchronisieren();
    if (navigator.onLine) laden().catch(() => {});
  }
});

// ---------- Abfragen auf dem Zustand ----------

export function volkNachId(id) {
  return zustand.daten.voelker.find((v) => v.id === id) || null;
}

export function volkNachNummer(nr) {
  const gesucht = String(nr).trim().toLowerCase();
  return zustand.daten.voelker.find((v) => String(v.nr).toLowerCase() === gesucht) || null;
}

export function kontrollenVon(volkId) {
  return zustand.daten.kontrollen
    .filter((k) => k.volkId === volkId)
    .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
}

export function honigVon(volkId) {
  return zustand.daten.honig
    .filter((h) => h.volkId === volkId)
    .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
}

export function behandlungenVon(volkId, jahr) {
  return zustand.daten.behandlungen
    .filter((b) => b.volkId === volkId && (!jahr || b.datum.startsWith(String(jahr))))
    .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
}

export function honigraumVon(volkId, jahr) {
  return zustand.daten.honigraum.find((h) => h.volkId === volkId && h.jahr === jahr) || null;
}

export function letzteKontrolle(volkId) {
  const alle = kontrollenVon(volkId);
  return alle.length ? alle[alle.length - 1] : null;
}

export function ertragVon(volkId, jahr) {
  return zustand.daten.honig
    .filter((h) => h.volkId === volkId && (!jahr || h.datum.startsWith(String(jahr))))
    .reduce((summe, h) => summe + (Number(h.kg) || 0), 0);
}

/** Königinnenfarbe nach internationaler Konvention. */
export function koeniginFarbe(jahr) {
  const n = Number(jahr);
  if (!Number.isFinite(n)) return null;
  return ['blau', 'weiß', 'gelb', 'rot', 'grün'][n % 5];
}

export const FARB_WERTE = {
  blau: '#3B6EA5', 'weiß': '#F2EFE6', gelb: '#E3B23C', rot: '#8C4A2F', 'grün': '#5E7B45',
};
