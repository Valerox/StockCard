'use strict';
/**
 * Alle Datenänderungen laufen als "Operationen" durch diese Datei.
 *
 * Das Handy erzeugt eine Operation mit eigener id, wendet sie sofort lokal an
 * und schickt sie irgendwann zum Pi. Weil der Server jede id nur einmal
 * ausführt, darf das Handy beliebig oft nachliefern — doppelte Einträge kann
 * es dadurch nicht geben.
 */

const MERKMALE = ['koenigin', 'stifte', 'made', 'brut', 'pollen', 'futter'];
// Beschriftungen für Export und Ausdruck
const MERKMAL_LABELS = {
  koenigin: 'Königin', stifte: 'Stifte', made: 'Made',
  brut: 'verd. Brut', pollen: 'Pollen', futter: 'Futter',
};
const STATUS_WERTE = ['stark', 'schwach', 'Ableger', 'Volk tot'];
const OPS_HISTORIE = 5000;

class OpFehler extends Error {
  constructor(nachricht) { super(nachricht); this.name = 'OpFehler'; }
}

// ---------- Hilfen ----------

const istText = (v) => typeof v === 'string';
const text = (v, max = 500) => (istText(v) ? v.trim().slice(0, max) : '');

function pflichtText(v, feld, max = 500) {
  const s = text(v, max);
  if (!s) throw new OpFehler('Feld "' + feld + '" fehlt.');
  return s;
}

/** ISO-Datum JJJJ-MM-TT erzwingen. */
function datum(v, feld = 'datum') {
  const s = text(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new OpFehler('"' + feld + '" muss ein Datum als JJJJ-MM-TT sein.');
  return s;
}

function zahlOderNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function merkmale(v) {
  if (!Array.isArray(v)) return [];
  return MERKMALE.filter((m) => v.includes(m)); // feste Reihenfolge, nur bekannte Schlüssel
}

function findeVolk(db, volkId) {
  const volk = db.voelker.find((v) => v.id === volkId);
  if (!volk) throw new OpFehler('Volk "' + volkId + '" gibt es nicht.');
  return volk;
}

function entfernen(liste, id) {
  const i = liste.findIndex((e) => e.id === id);
  if (i >= 0) liste.splice(i, 1);
}

/** Königinnenfarbe nach internationaler Konvention aus dem Jahr ableiten. */
function koeniginFarbe(jahr) {
  const n = Number(jahr);
  if (!Number.isFinite(n)) return null;
  return ['blau', 'weiß', 'gelb', 'rot', 'grün'][n % 5];
}

// ---------- Operationen ----------

const HANDLER = {
  'volk.create': function (db, d) {
    const id = pflichtText(d.id, 'id', 60);
    if (db.voelker.some((v) => v.id === id)) return; // schon da (Retry)
    const nr = pflichtText(d.nr, 'nr', 20);
    if (db.voelker.some((v) => v.nr === nr)) throw new OpFehler('Volk-Nummer "' + nr + '" ist schon vergeben.');
    db.voelker.push({
      id: id,
      nr: nr,
      name: text(d.name, 80) || ('Volk ' + nr),
      stand: text(d.stand, 80),
      status: STATUS_WERTE.includes(d.status) ? d.status : 'stark',
      koeniginJahr: zahlOderNull(d.koeniginJahr),
      notiz: text(d.notiz, 2000),
      erstelltAm: d.erstelltAm || new Date().toISOString(),
    });
  },

  'volk.update': function (db, d) {
    const volk = findeVolk(db, pflichtText(d.id, 'id', 60));
    if (d.nr !== undefined) {
      const nr = pflichtText(d.nr, 'nr', 20);
      if (db.voelker.some((v) => v.nr === nr && v.id !== volk.id)) {
        throw new OpFehler('Volk-Nummer "' + nr + '" ist schon vergeben.');
      }
      volk.nr = nr;
    }
    if (d.name !== undefined) volk.name = text(d.name, 80);
    if (d.stand !== undefined) volk.stand = text(d.stand, 80);
    if (d.status !== undefined && STATUS_WERTE.includes(d.status)) volk.status = d.status;
    if (d.koeniginJahr !== undefined) volk.koeniginJahr = zahlOderNull(d.koeniginJahr);
    if (d.notiz !== undefined) volk.notiz = text(d.notiz, 2000);
  },

  'volk.delete': function (db, d) {
    const id = pflichtText(d.id, 'id', 60);
    entfernen(db.voelker, id);
    // Alles, was an dem Volk hängt, mit entfernen
    for (const key of ['kontrollen', 'honig', 'honigraum', 'behandlungen']) {
      db[key] = db[key].filter((e) => e.volkId !== id);
    }
  },

  'kontrolle.create': function (db, d) {
    const id = pflichtText(d.id, 'id', 60);
    if (db.kontrollen.some((k) => k.id === id)) return;
    findeVolk(db, pflichtText(d.volkId, 'volkId', 60));
    db.kontrollen.push({
      id: id,
      volkId: d.volkId,
      datum: datum(d.datum),
      merkmale: merkmale(d.merkmale),
      futterKg: zahlOderNull(d.futterKg),
      notiz: text(d.notiz, 2000),
      erfasstAm: d.erfasstAm || new Date().toISOString(),
    });
  },

  'kontrolle.delete': function (db, d) { entfernen(db.kontrollen, pflichtText(d.id, 'id', 60)); },

  'honig.create': function (db, d) {
    const id = pflichtText(d.id, 'id', 60);
    if (db.honig.some((h) => h.id === id)) return;
    findeVolk(db, pflichtText(d.volkId, 'volkId', 60));
    db.honig.push({
      id: id,
      volkId: d.volkId,
      datum: datum(d.datum),
      waben: zahlOderNull(d.waben),
      kg: zahlOderNull(d.kg),
      erfasstAm: d.erfasstAm || new Date().toISOString(),
    });
  },

  'honig.delete': function (db, d) { entfernen(db.honig, pflichtText(d.id, 'id', 60)); },

  /** Honigraum rauf/runter — pro Volk und Jahr genau ein Eintrag. */
  'honigraum.set': function (db, d) {
    const volkId = pflichtText(d.volkId, 'volkId', 60);
    findeVolk(db, volkId);
    const jahr = Number(d.jahr) || new Date().getFullYear();
    let eintrag = db.honigraum.find((h) => h.volkId === volkId && h.jahr === jahr);
    if (!eintrag) {
      eintrag = { id: volkId + '-' + jahr, volkId: volkId, jahr: jahr, rauf: null, runter: null };
      db.honigraum.push(eintrag);
    }
    if (d.rauf !== undefined) eintrag.rauf = d.rauf ? datum(d.rauf, 'rauf') : null;
    if (d.runter !== undefined) eintrag.runter = d.runter ? datum(d.runter, 'runter') : null;
  },

  'behandlung.create': function (db, d) {
    const id = pflichtText(d.id, 'id', 60);
    if (db.behandlungen.some((b) => b.id === id)) return;
    findeVolk(db, pflichtText(d.volkId, 'volkId', 60));
    db.behandlungen.push({
      id: id,
      volkId: d.volkId,
      art: d.art === 'drohnenrahmen' ? 'drohnenrahmen' : 'behandlung',
      datum: datum(d.datum),
      mittel: text(d.mittel, 120),
      menge: text(d.menge, 60),
      notiz: text(d.notiz, 1000),
      erfasstAm: d.erfasstAm || new Date().toISOString(),
    });
  },

  'behandlung.delete': function (db, d) { entfernen(db.behandlungen, pflichtText(d.id, 'id', 60)); },

  'stand.create': function (db, d) {
    const name = pflichtText(d.name, 'name', 80);
    if (db.staende.some((s) => s.name === name)) return;
    db.staende.push({ id: pflichtText(d.id, 'id', 60), name: name });
  },

  'stand.delete': function (db, d) { entfernen(db.staende, pflichtText(d.id, 'id', 60)); },

  'settings.update': function (db, d) {
    if (d.imkerei !== undefined) db.settings.imkerei = text(d.imkerei, 120) || 'Meine Imkerei';
    if (d.kuerzel !== undefined) db.settings.kuerzel = text(d.kuerzel, 4).toUpperCase() || 'IM';
  },
};

/**
 * Eine Liste von Operationen anwenden. Bereits bekannte ids werden übersprungen.
 * Gibt pro Operation zurück, ob sie lief, übersprungen wurde oder scheiterte.
 */
function anwenden(db, operationen) {
  const bekannt = new Set(db.appliedOps);
  const ergebnisse = [];

  for (const op of operationen) {
    const opId = op && typeof op.id === 'string' ? op.id : null;
    if (!opId) {
      ergebnisse.push({ id: null, status: 'fehler', fehler: 'Operation ohne id.' });
      continue;
    }
    if (bekannt.has(opId)) {
      ergebnisse.push({ id: opId, status: 'doppelt' });
      continue;
    }
    const handler = HANDLER[op.type];
    if (!handler) {
      ergebnisse.push({ id: opId, status: 'fehler', fehler: 'Unbekannte Operation "' + op.type + '".' });
      continue;
    }
    try {
      handler(db, op.data || {});
      bekannt.add(opId);
      db.appliedOps.push(opId);
      ergebnisse.push({ id: opId, status: 'ok' });
    } catch (err) {
      // Fachliche Fehler quittieren wir als "erledigt", damit das Handy nicht
      // ewig weiter versucht, eine Operation zu senden, die nie klappen kann.
      const fachlich = err instanceof OpFehler;
      if (fachlich) {
        bekannt.add(opId);
        db.appliedOps.push(opId);
        ergebnisse.push({ id: opId, status: 'abgelehnt', fehler: err.message });
      } else {
        ergebnisse.push({ id: opId, status: 'fehler', fehler: err.message });
        throw err;
      }
    }
  }

  if (db.appliedOps.length > OPS_HISTORIE) {
    db.appliedOps = db.appliedOps.slice(-OPS_HISTORIE);
  }
  return ergebnisse;
}

module.exports = { anwenden, MERKMALE, MERKMAL_LABELS, STATUS_WERTE, koeniginFarbe, OpFehler };
