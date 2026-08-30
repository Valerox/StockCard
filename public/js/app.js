// Anwendungskern: Router, Zeichnen, Bedienung.
//
// Kein Framework — die App zeichnet bei jeder Änderung neu und fängt alle
// Klicks an einer Stelle ab (data-aktion). Eingaben stehen in ui.form und
// lösen bewusst KEIN Neuzeichnen aus, damit beim Tippen nie der Fokus springt.

import {
  zustand, beiAenderung, ausCacheLaden, laden, mutieren, synchronisieren,
  sessionPruefen, anmelden, abmelden, neueId, volkNachId, volkNachNummer,
  MERKMALE, honigraumVon,
} from './store.js';

import { heuteIso, zahlLesen, esc } from './format.js';
import { scannerStarten, codeDeuten, sichererKontext, kameraMoeglich } from './scanner.js';
import { qrSvg, volkUrl } from './qr.js';
import * as V from './views.js';

const wurzel = document.getElementById('app');

// ---------- Oberflächenzustand ----------

const ui = {
  screen: 'uebersicht',
  volkId: null,
  tab: 'kontrollen',
  jahr: new Date().getFullYear(),
  suche: '',
  standFilter: null,
  sheet: null,
  form: {},
  toast: null,
  toastArt: 'ok',
  loginFehler: null,
  scannerOffen: false,
  scannerStatus: '',
  scannerFehler: null,
  scannerLicht: false,
  qrSvg: null,
  qrBogen: null,
};

let scannerGriff = null;
let toastTimer = null;

// ---------- Router ----------

function pfadLesen() {
  const pfad = location.pathname;
  if (pfad === '/' || pfad === '') return { screen: 'uebersicht' };
  if (pfad === '/voelker') return { screen: 'voelker' };
  if (pfad === '/bericht') return { screen: 'bericht' };
  if (pfad === '/einstellungen') return { screen: 'einstellungen' };
  if (pfad === '/scan') return { screen: 'uebersicht', scanner: true };
  if (pfad.startsWith('/druck')) {
    const art = new URLSearchParams(location.search).get('art') || 'qr';
    return { screen: 'druck', druckArt: art };
  }
  const volk = pfad.match(/^\/v\/([^/]+)$/);
  if (volk) return { screen: 'karte', volkId: decodeURIComponent(volk[1]) };
  return { screen: 'uebersicht' };
}

function routeAnwenden(ersterAufruf = false) {
  const r = pfadLesen();
  ui.screen = r.screen;
  ui.druckArt = r.druckArt || null;
  if (r.volkId) {
    ui.volkId = r.volkId;
    if (ersterAufruf) ui.tab = 'kontrollen';
  }
  if (r.scanner && !ui.scannerOffen) scannerOeffnen();
  if (ui.screen === 'druck') druckVorbereiten();
  zeichnen();
}

function gehe(ziel, ersetzen = false) {
  if (location.pathname + location.search !== ziel) {
    history[ersetzen ? 'replaceState' : 'pushState']({}, '', ziel);
  }
  routeAnwenden();
  if (!ziel.startsWith('/druck')) scrollTo({ top: 0, behavior: 'instant' });
}

addEventListener('popstate', () => routeAnwenden());

// ---------- Zeichnen ----------

/** Fokus und Cursorposition über das Neuzeichnen retten. */
function fokusMerken() {
  const el = document.activeElement;
  if (!el || !el.dataset || !el.dataset.behalten) return null;
  return {
    schluessel: el.dataset.behalten,
    start: el.selectionStart,
    ende: el.selectionEnd,
  };
}

function fokusWiederherstellen(merker) {
  if (!merker) return;
  const el = wurzel.querySelector('[data-behalten="' + merker.schluessel + '"]');
  if (!el) return;
  el.focus({ preventScroll: true });
  if (merker.start !== null && merker.start !== undefined && el.setSelectionRange) {
    try { el.setSelectionRange(merker.start, merker.ende); } catch { /* type=date u. Ä. */ }
  }
}

function zeichnen() {
  const merker = fokusMerken();

  if (!zustand.angemeldet) {
    wurzel.innerHTML = V.login(ui.loginFehler);
    fokusWiederherstellen(merker);
    return;
  }

  if (!zustand.geladen) {
    wurzel.innerHTML = '<div class="laden">Stockkarte wird geladen …</div>';
    return;
  }

  let inhalt;
  if (ui.screen === 'voelker') inhalt = V.voelker(ui);
  else if (ui.screen === 'karte') inhalt = V.karte(ui);
  else if (ui.screen === 'bericht') inhalt = V.bericht(ui);
  else if (ui.screen === 'einstellungen') inhalt = V.einstellungen();
  else if (ui.screen === 'druck') {
    inhalt = ui.druckArt === 'karten' ? V.druckKarten()
      : ui.druckArt === 'bestand' ? V.druckBestand()
      : V.druckQr(ui);
  } else inhalt = V.uebersicht();

  const navAktiv = ui.screen === 'karte' ? 'karte' : ui.screen;

  wurzel.innerHTML =
    '<div class="layout">' +
      (ui.screen === 'druck' ? '' : V.navigation(navAktiv)) +
      '<main class="inhalt">' + inhalt + '</main>' +
    '</div>' +
    (ui.sheet ? '<div class="sheet-grund" data-aktion="sheet-schliessen"></div>' +
      '<div class="sheet" role="dialog" aria-modal="true">' + V.sheetInhalt(ui) + '</div>' : '') +
    (ui.scannerOffen ? V.scannerAnsicht(ui) : '') +
    (ui.toast ? '<div class="toast' + (ui.toastArt === 'fehler' ? ' toast--fehler' : '') + '" role="status">' +
      '<span class="punkt"></span><span>' + esc(ui.toast) + '</span></div>' : '');

  fokusWiederherstellen(merker);

  // Das Videoelement wird beim Neuzeichnen ersetzt — Kamera neu anhängen.
  if (ui.scannerOffen && scannerGriff && scannerGriff.stream) {
    const video = document.getElementById('scanner-video');
    if (video && !video.srcObject) {
      video.srcObject = scannerGriff.stream;
      video.play().catch(() => {});
    }
  }
}

beiAenderung(zeichnen);

// ---------- Rückmeldungen ----------

function melden(text, art = 'ok') {
  ui.toast = text;
  ui.toastArt = art;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = null; zeichnen(); }, 2800);
  zeichnen();
}

// ---------- Scanner ----------

async function scannerOeffnen() {
  ui.scannerOffen = true;
  ui.scannerFehler = null;
  ui.scannerStatus = 'Kamera wird geöffnet …';
  ui.scannerLicht = false;
  zeichnen();

  const video = document.getElementById('scanner-video');
  if (!video) return;

  try {
    const griff = await scannerStarten(video, codeErkannt, (status) => {
      ui.scannerStatus = status;
      const el = document.getElementById('scanner-status');
      if (el) el.textContent = status; // ohne Neuzeichnen, sonst stockt das Bild
    });
    scannerGriff = griff;
    scannerGriff.stream = video.srcObject;
    ui.scannerLicht = Boolean(griff.lichtUmschalten);
    zeichnen();
  } catch (err) {
    ui.scannerFehler = err.message;
    ui.scannerStatus = 'Kein Bild';
    zeichnen();
  }
}

function scannerSchliessen() {
  if (scannerGriff) {
    scannerGriff.stoppen();
    scannerGriff = null;
  }
  ui.scannerOffen = false;
  ui.scannerFehler = null;
  if (location.pathname === '/scan') {
    history.replaceState({}, '', '/');
  }
  zeichnen();
}

/** Ein gelesener Code — Volk suchen und direkt öffnen. */
function codeErkannt(text) {
  const gedeutet = codeDeuten(text);
  if (!gedeutet) {
    ui.scannerStatus = 'Code nicht lesbar — nochmal versuchen';
    const el = document.getElementById('scanner-status');
    if (el) el.textContent = ui.scannerStatus;
    return;
  }

  const volk = gedeutet.art === 'nr'
    ? volkNachNummer(gedeutet.wert)
    : (volkNachId(gedeutet.wert) || volkNachNummer(gedeutet.wert));

  if (!volk) {
    ui.scannerStatus = 'Kein Volk zu diesem Code — Etikett schon vergeben?';
    const el = document.getElementById('scanner-status');
    if (el) el.textContent = ui.scannerStatus;
    return;
  }

  scannerSchliessen();
  ui.tab = 'kontrollen';
  gehe('/v/' + encodeURIComponent(volk.id));
  melden('Volk ' + volk.nr + ' · ' + (volk.stand || volk.name) + ' erkannt');
}

// ---------- Formulare vorbereiten ----------

function formularKontrolle(volkId) {
  const merkmale = {};
  for (const m of MERKMALE) merkmale[m.key] = false;
  ui.sheet = { art: 'kontrolle', volkId };
  ui.form = { merkmale, futterKg: null, notiz: '', datum: heuteIso() };
}

function formularVolk(volkId) {
  const volk = volkId ? volkNachId(volkId) : null;
  ui.sheet = { art: 'volk', volkId };
  ui.form = volk
    ? { nr: volk.nr, name: volk.name, stand: volk.stand, status: volk.status, koeniginJahr: volk.koeniginJahr ?? '' }
    : { nr: '', name: '', stand: '', status: 'stark', koeniginJahr: new Date().getFullYear() };
}

// ---------- Speichern ----------

async function sheetSpeichern() {
  const s = ui.sheet;
  if (!s) return;
  const f = ui.form;

  try {
    if (s.art === 'kontrolle') {
      const merkmale = MERKMALE.filter((m) => f.merkmale[m.key]).map((m) => m.key);
      await mutieren('kontrolle.create', {
        id: neueId(), volkId: s.volkId, datum: f.datum || heuteIso(),
        merkmale, futterKg: f.futterKg, notiz: (f.notiz || '').trim(),
      });
      ui.sheet = null;
      melden('Kontrolle ' + f.datum.slice(8) + '.' + Number(f.datum.slice(5, 7)) + '. gespeichert');
      return;
    }

    if (s.art === 'honig') {
      const kgWert = zahlLesen(f.kg);
      const waben = zahlLesen(f.waben);
      if (kgWert === null && waben === null) { melden('Bitte Waben oder Kilogramm eintragen.', 'fehler'); return; }
      await mutieren('honig.create', {
        id: neueId(), volkId: s.volkId, datum: f.datum || heuteIso(), waben, kg: kgWert,
      });
      ui.sheet = null;
      melden('Entnahme gespeichert');
      return;
    }

    if (s.art === 'behandlung') {
      if (!s.drohnenrahmen && !(f.mittel || '').trim()) { melden('Bitte ein Mittel eintragen.', 'fehler'); return; }
      await mutieren('behandlung.create', {
        id: neueId(), volkId: s.volkId, art: s.drohnenrahmen ? 'drohnenrahmen' : 'behandlung',
        datum: f.datum || heuteIso(), mittel: (f.mittel || '').trim(),
        menge: (f.menge || '').trim(), notiz: (f.notiz || '').trim(),
      });
      ui.sheet = null;
      melden(s.drohnenrahmen ? 'Drohnenrahmen eingetragen' : 'Behandlung gespeichert');
      return;
    }

    if (s.art === 'volk') {
      const nr = String(f.nr || '').trim();
      if (!nr) { melden('Die Nummer fehlt.', 'fehler'); return; }
      const jahr = zahlLesen(f.koeniginJahr);
      if (s.volkId) {
        await mutieren('volk.update', {
          id: s.volkId, nr, name: (f.name || '').trim() || ('Volk ' + nr),
          stand: (f.stand || '').trim(), status: f.status, koeniginJahr: jahr,
        });
        ui.sheet = null;
        melden('Volk gespeichert');
      } else {
        const id = 'v' + nr.toLowerCase().replace(/[^a-z0-9_-]/g, '') + '-' + neueId().slice(0, 6);
        await mutieren('volk.create', {
          id, nr, name: (f.name || '').trim() || ('Volk ' + nr),
          stand: (f.stand || '').trim(), status: f.status, koeniginJahr: jahr,
        });
        ui.sheet = null;
        gehe('/v/' + encodeURIComponent(id));
        melden('Volk ' + nr + ' angelegt');
      }
      return;
    }

    if (s.art === 'datum') {
      await mutieren('honigraum.set', {
        volkId: s.volkId, jahr: s.jahr, [s.feld]: f.datum || null,
      });
      ui.sheet = null;
      melden('Gespeichert');
      return;
    }
  } catch (err) {
    melden(err.message || 'Speichern fehlgeschlagen.', 'fehler');
    return;
  }

  zeichnen();
}

// ---------- Druckansichten vorbereiten ----------

async function druckVorbereiten() {
  if (ui.druckArt !== 'qr') return;
  if (ui.qrBogen) return;
  try {
    const teile = [];
    for (const volk of zustand.daten.voelker) {
      const svg = await qrSvg(volkUrl(volk.id));
      teile.push('<div class="druck-etikett">' + svg +
        '<div class="druck-etikett-nr">' + esc(volk.nr) + '</div>' +
        '<div class="druck-etikett-name">' + esc(volk.name) + '</div>' +
      '</div>');
    }
    ui.qrBogen = teile.join('');
    zeichnen();
  } catch (err) {
    melden('QR-Codes konnten nicht erzeugt werden.', 'fehler');
  }
}

async function qrAnzeigen(volkId) {
  ui.sheet = { art: 'qr', volkId };
  ui.qrSvg = null;
  zeichnen();
  try {
    ui.qrSvg = await qrSvg(volkUrl(volkId));
  } catch {
    ui.qrSvg = '<div class="leer"><div class="leer-titel">QR-Code konnte nicht erzeugt werden.</div></div>';
  }
  zeichnen();
}

// ---------- Bedienung ----------

wurzel.addEventListener('click', async (ereignis) => {
  const ziel = ereignis.target.closest('[data-aktion]');
  if (!ziel) return;
  const aktion = ziel.dataset.aktion;
  const wert = ziel.dataset.wert;
  const id = ziel.dataset.id;

  switch (aktion) {
    case 'gehe':
      gehe(ziel.dataset.ziel);
      break;

    case 'volk-oeffnen':
      ui.tab = 'kontrollen';
      gehe('/v/' + encodeURIComponent(id));
      break;

    case 'tab':
      ui.tab = wert;
      zeichnen();
      break;

    case 'jahr':
      ui.jahr = Number(wert);
      zeichnen();
      break;

    case 'stand-filter':
      ui.standFilter = wert || null;
      zeichnen();
      break;

    case 'sync':
      melden('Wird übertragen …');
      if (await synchronisieren()) melden('Alles synchronisiert');
      else melden('Der Pi ist gerade nicht erreichbar.', 'fehler');
      break;

    case 'scanner-oeffnen':
      scannerOeffnen();
      break;

    case 'scanner-schliessen':
      scannerSchliessen();
      break;

    case 'scanner-manuell':
      scannerSchliessen();
      gehe('/voelker');
      break;

    case 'scanner-licht':
      if (scannerGriff && scannerGriff.lichtUmschalten) await scannerGriff.lichtUmschalten();
      break;

    // --- Formulare öffnen ---
    case 'kontrolle-neu':
      formularKontrolle(id);
      zeichnen();
      break;

    case 'honig-neu':
      ui.sheet = { art: 'honig', volkId: id };
      ui.form = { datum: heuteIso(), waben: '', kg: '' };
      zeichnen();
      break;

    case 'behandlung-neu':
      ui.sheet = { art: 'behandlung', volkId: id };
      ui.form = { datum: heuteIso(), mittel: '', menge: '', notiz: '' };
      zeichnen();
      break;

    case 'drohnenrahmen-neu':
      ui.sheet = { art: 'behandlung', volkId: id, drohnenrahmen: true };
      ui.form = { datum: heuteIso(), mittel: '', menge: '', notiz: '' };
      zeichnen();
      break;

    case 'volk-neu':
      formularVolk(null);
      zeichnen();
      break;

    case 'volk-bearbeiten':
      formularVolk(id);
      zeichnen();
      break;

    case 'honigraum': {
      const jahr = Number(ziel.dataset.jahr);
      const vorhanden = honigraumVon(id, jahr);
      const feld = ziel.dataset.feld;
      ui.sheet = { art: 'datum', volkId: id, jahr, feld, titel: 'Honigraum ' + (feld === 'rauf' ? 'rauf' : 'runter') };
      ui.form = { datum: (vorhanden && vorhanden[feld]) || heuteIso() };
      zeichnen();
      break;
    }

    case 'qr-zeigen':
      qrAnzeigen(id);
      break;

    // --- im Formular ---
    case 'merkmal':
      ui.form.merkmale[wert] = !ui.form.merkmale[wert];
      zeichnen();
      break;

    case 'futter':
      ui.form.futterKg = wert === '' ? null : Number(wert);
      if (ui.form.merkmale) ui.form.merkmale.futter = wert !== '';
      zeichnen();
      break;

    case 'notiz-chip':
      ui.form.notiz = ui.form.notiz ? ui.form.notiz + ', ' + wert : wert;
      zeichnen();
      break;

    case 'mittel-chip':
      ui.form.mittel = wert;
      zeichnen();
      break;

    case 'status':
      ui.form.status = wert;
      zeichnen();
      break;

    case 'datum-leeren':
      ui.form.datum = '';
      sheetSpeichern();
      break;

    case 'sheet-schliessen':
      ui.sheet = null;
      zeichnen();
      break;

    case 'sheet-speichern':
      sheetSpeichern();
      break;

    // --- Löschen ---
    case 'kontrolle-loeschen':
      if (confirm('Diese Kontrolle löschen?')) {
        await mutieren('kontrolle.delete', { id });
        melden('Kontrolle gelöscht');
      }
      break;

    case 'honig-loeschen':
      if (confirm('Diesen Eintrag löschen?')) {
        await mutieren('honig.delete', { id });
        melden('Eintrag gelöscht');
      }
      break;

    case 'behandlung-loeschen':
      if (confirm('Diesen Eintrag löschen?')) {
        await mutieren('behandlung.delete', { id });
        melden('Eintrag gelöscht');
      }
      break;

    case 'volk-loeschen':
      if (confirm('Das Volk und alle zugehörigen Einträge löschen? Das lässt sich nicht rückgängig machen.')) {
        await mutieren('volk.delete', { id });
        ui.sheet = null;
        gehe('/voelker');
        melden('Volk gelöscht');
      }
      break;

    // --- Einstellungen ---
    case 'einstellungen-speichern': {
      const imkerei = wurzel.querySelector('[data-behalten="e-imkerei"]').value;
      const kuerzel = wurzel.querySelector('[data-behalten="e-kuerzel"]').value;
      await mutieren('settings.update', { imkerei, kuerzel });
      melden('Gespeichert');
      break;
    }

    case 'passwort-aendern': {
      const alt = wurzel.querySelector('[data-behalten="e-alt"]').value;
      const neu = wurzel.querySelector('[data-behalten="e-neu"]').value;
      try {
        const antwort = await fetch('/api/passwort', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alt, neu }),
        });
        const daten = await antwort.json();
        if (!antwort.ok) throw new Error(daten.fehler);
        melden('Passwort geändert');
        zeichnen();
      } catch (err) {
        melden(err.message || 'Änderung fehlgeschlagen.', 'fehler');
      }
      break;
    }

    case 'abmelden':
      await abmelden();
      break;

    case 'export-csv':
      location.href = '/api/export/csv';
      break;

    case 'export-json':
      location.href = '/api/export/json';
      break;

    case 'druck-qr':
      ui.sheet = null;
      ui.qrBogen = null;
      gehe('/druck?art=qr');
      break;

    case 'druck-karten':
      gehe('/druck?art=karten');
      break;

    case 'druck-bestand':
      gehe('/druck?art=bestand');
      break;

    case 'drucken':
      print();
      break;
  }
});

// Eingaben: still in ui.form schreiben, nur die Suche zeichnet neu.
wurzel.addEventListener('input', (ereignis) => {
  const el = ereignis.target;
  if (el.dataset.feld) {
    const feld = el.dataset.feld;
    ui.form[feld] = el.value;
    // Königinnenfarbe unter dem Feld soll mitlaufen
    if (feld === 'koeniginJahr') zeichnen();
    return;
  }
  if (el.dataset.aktionEingabe === 'suche') {
    ui.suche = el.value;
    zeichnen();
  }
});

// Anmeldung
wurzel.addEventListener('submit', async (ereignis) => {
  const formular = ereignis.target.closest('[data-aktion-formular="login"]');
  if (!formular) return;
  ereignis.preventDefault();
  const passwort = formular.querySelector('[name="passwort"]').value;
  ui.loginFehler = null;
  try {
    await anmelden(passwort);
    routeAnwenden(true);
  } catch (err) {
    ui.loginFehler = err.message || 'Anmeldung fehlgeschlagen.';
    zeichnen();
  }
});

// Escape schließt Sheet und Scanner
addEventListener('keydown', (ereignis) => {
  if (ereignis.key !== 'Escape') return;
  if (ui.scannerOffen) scannerSchliessen();
  else if (ui.sheet) { ui.sheet = null; zeichnen(); }
});

// Kamera freigeben, wenn die App in den Hintergrund geht
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && ui.scannerOffen) scannerSchliessen();
});

// ---------- Start ----------

async function starten() {
  const sitzung = await sessionPruefen();

  if (!sitzung.angemeldet) {
    zeichnen();
    return;
  }

  await ausCacheLaden();
  routeAnwenden(true);
  laden().then(() => synchronisieren()).catch(() => {});
}

starten();

// Service Worker für den Offline-Betrieb
if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[app] Service Worker nicht registriert:', err.message);
    });
  });
}
