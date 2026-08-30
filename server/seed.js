'use strict';
/**
 * Beispieldaten aus dem Entwurf einspielen — dieselben Völker, Kontrollen und
 * Honigmengen, die im Design zu sehen sind. Gedacht zum Ausprobieren.
 *
 *   node server/seed.js          (nur wenn noch keine Völker da sind)
 *   node server/seed.js --force  (überschreibt vorhandene Daten)
 */
const store = require('./store');
const ops = require('./ops');

const JAHR = 2026;

const VOELKER = [
  { id: 'v9', nr: '9', name: 'Weiler 9', stand: 'Weiler', status: 'Volk tot', koeniginJahr: 2024 },
  { id: 'v1', nr: '1', name: 'Weiler 1', stand: 'Weiler', status: 'stark', koeniginJahr: 2025 },
  { id: 'v2', nr: '2', name: 'Weiler 2', stand: 'Weiler', status: 'stark', koeniginJahr: 2025 },
  { id: 'v3', nr: '3', name: 'Weiler 3', stand: 'Weiler', status: 'schwach', koeniginJahr: 2024 },
  { id: 'v4', nr: '4', name: 'Hausgarten 4', stand: 'Hausgarten', status: 'stark', koeniginJahr: 2026 },
  { id: 'v5', nr: '5', name: 'Hausgarten 5', stand: 'Hausgarten', status: 'Ableger', koeniginJahr: 2026 },
  { id: 'v6', nr: '6', name: 'Hausgarten 6', stand: 'Hausgarten', status: 'stark', koeniginJahr: 2025 },
];

// Volk 9 stammt aus dem Entwurf und dort von der echten Papierkarte.
const KONTROLLEN = [
  { volkId: 'v9', datum: '2026-04-18', merkmale: ['stifte', 'made', 'futter'], futterKg: 2.5, notiz: '2 Brutwaben entnommen' },
  { volkId: 'v9', datum: '2026-06-20', merkmale: ['stifte', 'made'], notiz: 'Honigraum teils voll, nicht verdeckelt' },
  { volkId: 'v9', datum: '2026-08-29', merkmale: [], notiz: 'Volk tot' },

  { volkId: 'v1', datum: '2026-08-12', merkmale: ['koenigin', 'stifte', 'made', 'brut', 'pollen'], notiz: '' },
  { volkId: 'v2', datum: '2026-08-20', merkmale: ['koenigin', 'stifte', 'made', 'pollen'], notiz: '' },
  { volkId: 'v3', datum: '2026-08-02', merkmale: ['stifte', 'pollen'], futterKg: 1, notiz: 'schwach, Futter prüfen' },
  { volkId: 'v4', datum: '2026-08-24', merkmale: ['stifte', 'made', 'brut'], notiz: '' },
  { volkId: 'v5', datum: '2026-08-21', merkmale: ['made', 'futter'], futterKg: 2.5, notiz: 'Ableger' },
  { volkId: 'v6', datum: '2026-08-14', merkmale: ['koenigin', 'stifte', 'made', 'pollen'], notiz: 'Winterfutter offen' },
];

// Ertragswerte wie im Bericht des Entwurfs
const HONIG = [
  { volkId: 'v9', datum: '2026-06-04', waben: 9, kg: 9.8 },
  { volkId: 'v9', datum: '2026-07-03', waben: 8, kg: 8.7 },
  { volkId: 'v1', datum: '2026-06-04', waben: 10, kg: 11.5 },
  { volkId: 'v2', datum: '2026-06-04', waben: 12, kg: 14.0 },
  { volkId: 'v3', datum: '2026-07-03', waben: 6, kg: 6.5 },
  { volkId: 'v4', datum: '2026-06-04', waben: 16, kg: 18.5 },
  { volkId: 'v5', datum: '2026-07-03', waben: 4, kg: 4.0 },
];

const HONIGRAUM = [
  { volkId: 'v9', jahr: JAHR, rauf: '2026-04-18', runter: '2026-07-03' },
  { volkId: 'v1', jahr: JAHR, rauf: '2026-04-20', runter: '2026-07-03' },
  { volkId: 'v2', jahr: JAHR, rauf: '2026-04-20', runter: '2026-07-03' },
];

const BEHANDLUNGEN = [
  { volkId: 'v1', art: 'behandlung', datum: '2026-07-20', mittel: 'Ameisensäure 60 %', menge: '180 ml', notiz: 'Nassenheider' },
  { volkId: 'v2', art: 'behandlung', datum: '2026-07-20', mittel: 'Ameisensäure 60 %', menge: '180 ml', notiz: '' },
  { volkId: 'v4', art: 'drohnenrahmen', datum: '2026-05-02', mittel: '', menge: '', notiz: 'ausgeschnitten 16.5.' },
];

let zaehler = 0;
const opId = () => 'seed-' + (++zaehler);
const eintragId = (praefix, i) => praefix + '-' + i;

async function main() {
  const force = process.argv.includes('--force');
  const db = await store.lesen();

  if (db.voelker.length && !force) {
    console.log('Es sind bereits ' + db.voelker.length + ' Völker gespeichert.');
    console.log('Zum Überschreiben: node server/seed.js --force');
    return;
  }

  await store.aendern((db) => {
    if (force) {
      db.voelker = [];
      db.kontrollen = [];
      db.honig = [];
      db.honigraum = [];
      db.behandlungen = [];
      db.staende = [];
      db.appliedOps = [];
    }

    const liste = [];
    liste.push({ id: opId(), type: 'settings.update', data: { imkerei: 'Imkerei Weiler', kuerzel: 'MW' } });

    for (const name of ['Weiler', 'Hausgarten']) {
      liste.push({ id: opId(), type: 'stand.create', data: { id: name.toLowerCase(), name: name } });
    }
    for (const v of VOELKER) {
      liste.push({ id: opId(), type: 'volk.create', data: v });
    }
    KONTROLLEN.forEach((k, i) => {
      liste.push({ id: opId(), type: 'kontrolle.create', data: Object.assign({ id: eintragId('k', i) }, k) });
    });
    HONIG.forEach((h, i) => {
      liste.push({ id: opId(), type: 'honig.create', data: Object.assign({ id: eintragId('h', i) }, h) });
    });
    for (const hr of HONIGRAUM) {
      liste.push({ id: opId(), type: 'honigraum.set', data: hr });
    }
    BEHANDLUNGEN.forEach((b, i) => {
      liste.push({ id: opId(), type: 'behandlung.create', data: Object.assign({ id: eintragId('b', i) }, b) });
    });

    const ergebnisse = ops.anwenden(db, liste);
    const abgelehnt = ergebnisse.filter((e) => e.status === 'abgelehnt');
    if (abgelehnt.length) {
      console.warn('Abgelehnt:', abgelehnt.map((e) => e.fehler).join(' | '));
    }
  });

  const neu = await store.lesen();
  console.log('Eingespielt:');
  console.log('  ' + neu.voelker.length + ' Völker');
  console.log('  ' + neu.kontrollen.length + ' Kontrollen');
  console.log('  ' + neu.honig.length + ' Honig-Entnahmen');
  console.log('  ' + neu.behandlungen.length + ' Behandlungen');
  console.log('Datei: ' + store.DB_FILE);
}

main().catch((err) => {
  console.error('Seed fehlgeschlagen:', err.message);
  process.exit(1);
});
