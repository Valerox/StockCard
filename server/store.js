'use strict';
/**
 * Speicherung: eine einzige, lesbare JSON-Datei auf dem Pi.
 *
 * Bewusst kein SQLite — die Daten sollen sich mit jedem Texteditor öffnen und
 * per USB-Stick sichern lassen. Geschrieben wird atomar (tmp + fsync + rename),
 * damit ein Stromausfall mitten im Schreiben die Datei nicht zerlegt.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DATA_DIR = process.env.STOCKKARTE_DATA || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'stockkarte.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUPS_BEHALTEN = 30;

const SCHEMA_VERSION = 1;

function leereDatenbank() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { imkerei: 'Meine Imkerei', kuerzel: 'IM' },
    staende: [],
    voelker: [],
    kontrollen: [],
    honig: [],
    honigraum: [],
    behandlungen: [],
    appliedOps: [],
    updatedAt: null,
  };
}

/** Fehlende Sammlungen ergänzen, damit ein von Hand editiertes File nicht crasht. */
function normalisieren(db) {
  const leer = leereDatenbank();
  for (const key of Object.keys(leer)) {
    if (db[key] === undefined) db[key] = leer[key];
    else if (Array.isArray(leer[key]) && !Array.isArray(db[key])) db[key] = leer[key];
  }
  if (!db.settings || typeof db.settings !== 'object') db.settings = leer.settings;
  db.schemaVersion = SCHEMA_VERSION;
  return db;
}

let cache = null;
/** Schreibvorgänge werden über diese Promise-Kette serialisiert. */
let schreibKette = Promise.resolve();
let letzterBackupTag = null;

async function laden() {
  if (cache) return cache;
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    const roh = await fsp.readFile(DB_FILE, 'utf8');
    cache = normalisieren(JSON.parse(roh));
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache = leereDatenbank();
      await schreibenJetzt(cache);
    } else if (err instanceof SyntaxError) {
      // Kaputtes JSON niemals überschreiben — beiseitelegen und melden.
      const rettung = DB_FILE + '.kaputt-' + Date.now();
      await fsp.rename(DB_FILE, rettung).catch(() => {});
      throw new Error(
        'stockkarte.json ist kein gültiges JSON und wurde nach ' + path.basename(rettung) +
        ' verschoben. Bitte die Datei prüfen oder ein Backup aus data/backups/ zurückspielen.'
      );
    } else {
      throw err;
    }
  }
  return cache;
}

async function schreibenJetzt(db) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  const inhalt = JSON.stringify(db, null, 2);
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(inhalt, 'utf8');
    await fh.sync(); // erst wenn die Bytes wirklich auf der SD-Karte sind
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, DB_FILE);
}

/** Einmal pro Tag eine Kopie wegschreiben, die letzten 30 behalten. */
async function backupFallsNoetig() {
  const tag = new Date().toISOString().slice(0, 10);
  if (letzterBackupTag === tag) return;
  letzterBackupTag = tag;
  try {
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    const ziel = path.join(BACKUP_DIR, `stockkarte-${tag}.json`);
    try {
      await fsp.access(ziel);
      return; // Backup für heute existiert schon
    } catch { /* noch keins */ }
    await fsp.copyFile(DB_FILE, ziel);
    const dateien = (await fsp.readdir(BACKUP_DIR))
      .filter((f) => f.startsWith('stockkarte-') && f.endsWith('.json'))
      .sort();
    for (const alt of dateien.slice(0, Math.max(0, dateien.length - BACKUPS_BEHALTEN))) {
      await fsp.unlink(path.join(BACKUP_DIR, alt)).catch(() => {});
    }
  } catch (err) {
    console.warn('[store] Backup fehlgeschlagen:', err.message);
  }
}

/**
 * Datenbank verändern. `fn` bekommt die DB und darf sie direkt mutieren.
 * Alle Aufrufe laufen nacheinander, nie parallel.
 */
function aendern(fn) {
  const lauf = schreibKette.then(async () => {
    const db = await laden();
    const ergebnis = await fn(db);
    db.updatedAt = new Date().toISOString();
    await backupFallsNoetig();
    await schreibenJetzt(db);
    return ergebnis;
  });
  // Kette am Leben halten, auch wenn dieser Lauf scheitert
  schreibKette = lauf.then(() => {}, () => {});
  return lauf;
}

async function lesen() {
  return laden();
}

module.exports = { lesen, aendern, laden, leereDatenbank, DATA_DIR, DB_FILE, SCHEMA_VERSION };
