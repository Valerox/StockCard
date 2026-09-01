// Alle Bildschirme als reine Funktionen: Zustand rein, HTML raus.
// Bedienung läuft über data-aktion-Attribute und einen zentralen Klick-Fänger
// in app.js — dadurch braucht keine Ansicht eigene Ereignis-Verdrahtung.

import {
  zustand, MERKMALE, STATUS_WERTE, STATUS_FARBE, FARB_WERTE,
  kontrollenVon, honigVon, behandlungenVon, honigraumVon,
  letzteKontrolle, ertragVon, koeniginFarbe, volkNachId,
} from './store.js';

import {
  esc, kurzDatum, langDatum, wochentagZeile, erfassungsZeile,
  heuteIso, jahrVon, tageSeit, zahl, kg, pluralWort,
} from './format.js';

const FAELLIG_AB_TAGEN = 14;

// ---------- gemeinsame Bausteine ----------

function grussformel(stunde = new Date().getHours()) {
  if (stunde < 11) return 'Guten Morgen';
  if (stunde < 18) return 'Guten Tag';
  return 'Guten Abend';
}

function statusPunkt(status) {
  return '<span class="punkt" style="background:' + (STATUS_FARBE[status] || STATUS_FARBE.stark) + '"></span>';
}

export function syncBanner() {
  const offen = zustand.outbox.length;
  const punktKlasse = !zustand.online ? 'sync-punkt sync-punkt--offline'
    : offen ? 'sync-punkt' : 'sync-punkt sync-punkt--ruhig';

  const titel = !zustand.online
    ? (offen ? 'Offline gespeichert' : 'Keine Verbindung zum Pi')
    : offen ? 'Wird übertragen …' : 'Alles gesichert';

  const meta = offen
    ? offen + ' ' + pluralWort(offen, 'Eintrag wartet', 'Einträge warten') + ' · synchronisiert bei Netz'
    : zustand.online ? 'Stand vom Pi' : 'Neue Einträge bleiben auf dem Gerät';

  const knopf = offen && zustand.online && !zustand.syncLaeuft
    ? '<button class="link" data-aktion="sync" style="flex:none">Jetzt</button>'
    : '';

  return '<div class="sync-banner">' +
    '<span class="' + punktKlasse + '"></span>' +
    '<div class="sync-text">' +
      '<div class="sync-titel">' + esc(titel) + '</div>' +
      '<div class="sync-meta">' + esc(meta) + '</div>' +
    '</div>' + knopf +
  '</div>';
}

/** Völker, die eine Kontrolle brauchen — tote Völker bleiben außen vor. */
export function faelligeVoelker(heute = heuteIso()) {
  const jahr = jahrVon(heute);
  return zustand.daten.voelker
    .filter((v) => v.status !== 'Volk tot')
    .map((v) => {
      const letzte = letzteKontrolle(v.id);
      const tage = letzte ? tageSeit(letzte.datum, heute) : null;
      let hinweis;
      if (v.status === 'schwach') hinweis = 'schwach · Futter prüfen';
      else if (!behandlungenVon(v.id, jahr).some((b) => b.art === 'behandlung')) hinweis = 'Behandlung ' + jahr + ' fehlt';
      else if (tage === null) hinweis = 'noch nie kontrolliert';
      else hinweis = 'letzte Kontrolle vor ' + tage + ' Tagen';
      return { volk: v, tage: tage, hinweis: hinweis };
    })
    .filter((e) => e.tage === null || e.tage >= FAELLIG_AB_TAGEN)
    .sort((a, b) => (b.tage ?? 9999) - (a.tage ?? 9999));
}

// ---------- Übersicht ----------

export function uebersicht() {
  const heute = heuteIso();
  const jahr = jahrVon(heute);
  const daten = zustand.daten;

  const staende = new Set(daten.voelker.map((v) => v.stand).filter(Boolean));
  const lebendig = daten.voelker.filter((v) => v.status !== 'Volk tot');
  const tote = daten.voelker.length - lebendig.length;
  const honigJahr = daten.honig
    .filter((h) => h.datum.startsWith(String(jahr)))
    .reduce((s, h) => s + (Number(h.kg) || 0), 0);
  const faellig = faelligeVoelker(heute);

  const letzte = daten.kontrollen
    .slice()
    .sort((a, b) => (b.erfasstAm || b.datum).localeCompare(a.erfasstAm || a.datum))
    .slice(0, 4);

  return '' +
  '<div class="spalte">' +
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">' +
      '<div>' +
        '<div class="label" style="margin-bottom:9px">' + esc(wochentagZeile(heute)) + '</div>' +
        '<h1 class="serif" style="font-size:34px;line-height:1.05;margin:0">' +
          esc(grussformel()) + ',<br>' + esc(daten.settings.imkerei) + '.' +
        '</h1>' +
      '</div>' +
      '<button data-aktion="gehe" data-ziel="/einstellungen" title="Einstellungen" ' +
        'style="width:38px;height:38px;border-radius:99px;background:var(--tinte);color:var(--hell);' +
        'display:flex;align-items:center;justify-content:center;font:500 13px/1 var(--mono);flex:none;margin-top:14px">' +
        esc(daten.settings.kuerzel) +
      '</button>' +
    '</div>' +
  '</div>' +

  '<div class="spalte" style="margin-top:24px">' + syncBanner() + '</div>' +

  '<div class="spalte" style="margin-top:14px">' +
    '<div class="kacheln">' +
      kachel(String(lebendig.length), 'Völker auf ' + staende.size + ' ' + pluralWort(staende.size, 'Stand', 'Ständen')) +
      kachel(zahl(honigJahr, 1) + '<span class="einheit"> kg</span>', 'Honig ' + jahr) +
      kachel(String(faellig.length), 'Kontrollen fällig', true) +
      kachel(String(tote), 'Volk tot gemeldet', false, tote > 0 ? 'var(--rot)' : null) +
    '</div>' +
  '</div>' +

  '<div class="spalte" style="margin-top:10px">' +
    '<button class="knopf knopf--gold" data-aktion="scanner-oeffnen" ' +
      'style="justify-content:flex-start;gap:13px;padding:17px 18px;text-align:left">' +
      qrSymbol() +
      '<span style="flex:1">' +
        '<span style="display:block;font:600 15px/1.2 var(--sans)">Stock scannen</span>' +
        '<span style="display:block;font:400 11.5px/1.3 var(--sans);color:rgba(66,62,55,.6);margin-top:3px">QR am Deckel → Karte öffnet sich</span>' +
      '</span>' +
      '<span style="font:400 20px/1 var(--sans);color:rgba(66,62,55,.45)">›</span>' +
    '</button>' +
  '</div>' +

  '<div class="spalte" style="margin-top:34px;display:flex;align-items:baseline;justify-content:space-between">' +
    '<div class="label">Fällig diese Woche</div>' +
    '<button class="link" data-aktion="gehe" data-ziel="/voelker" style="font-size:11.5px">alle Völker</button>' +
  '</div>' +
  '<div class="spalte" style="margin-top:12px">' +
    (faellig.length
      ? '<div class="karte">' + faellig.slice(0, 5).map((e) =>
          '<button class="zeile" data-aktion="volk-oeffnen" data-id="' + esc(e.volk.id) + '">' +
            '<span class="zeile-nr">' + esc(e.volk.nr) + '</span>' +
            '<span class="zeile-mitte">' +
              '<span class="zeile-titel" style="display:block">' + esc(e.volk.name) + '</span>' +
              '<span class="zeile-meta" style="display:block">' + esc(e.hinweis) + '</span>' +
            '</span>' +
            '<span class="zeile-rechts">' + (e.tage === null ? '—' : e.tage + ' T') + '</span>' +
          '</button>').join('') + '</div>'
      : '<div class="leer"><div class="leer-titel">Nichts fällig — alle Völker sind aktuell kontrolliert.</div></div>') +
  '</div>' +

  '<div class="spalte label" style="margin-top:30px;margin-bottom:12px">Zuletzt erfasst</div>' +
  '<div class="spalte" style="display:flex;flex-direction:column;gap:9px">' +
    (letzte.length
      ? letzte.map((k) => {
          const volk = volkNachId(k.volkId);
          const merkmale = k.merkmale.map((m) => (MERKMALE.find((x) => x.key === m) || {}).label).filter(Boolean);
          const text = 'Volk ' + (volk ? volk.nr : '?') + ' — ' + (k.notiz || merkmale.join(', ') || 'Kontrolle');
          return '<div style="display:flex;gap:12px;align-items:baseline">' +
            '<span class="mono" style="font-size:11.5px;line-height:1.5;color:var(--tinte-45);width:42px;flex:none">' + esc(kurzDatum(k.datum)) + '</span>' +
            '<span style="font:400 13px/1.5 var(--sans);color:var(--tinte-70)">' + esc(text) + '</span>' +
          '</div>';
        }).join('')
      : '<div class="leer"><div class="leer-titel">Noch keine Kontrolle erfasst.</div></div>') +
  '</div>';
}

function kachel(zahlHtml, text, dunkel = false, farbe = null) {
  return '<div class="kachel' + (dunkel ? ' kachel--dunkel' : '') + '">' +
    '<div class="kachel-zahl"' + (farbe ? ' style="color:' + farbe + '"' : '') + '>' + zahlHtml + '</div>' +
    '<div class="kachel-text">' + esc(text) + '</div>' +
  '</div>';
}

function qrSymbol() {
  return '<span style="width:34px;height:34px;border-radius:9px;border:2px solid var(--tinte);' +
    'display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px;padding:4px;flex:none">' +
    '<span style="background:var(--tinte);border-radius:1px"></span>' +
    '<span style="background:rgba(66,62,55,.25);border-radius:1px"></span>' +
    '<span style="background:rgba(66,62,55,.25);border-radius:1px"></span>' +
    '<span style="background:var(--tinte);border-radius:1px"></span>' +
  '</span>';
}

// ---------- Völker ----------

export function voelker(ui) {
  const daten = zustand.daten;
  const suche = (ui.suche || '').trim().toLowerCase();

  const staende = [...new Set(daten.voelker.map((v) => v.stand).filter(Boolean))];
  let liste = daten.voelker.slice().sort((a, b) => {
    const na = Number(a.nr), nb = Number(b.nr);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a.nr).localeCompare(String(b.nr), 'de');
  });

  if (ui.standFilter) liste = liste.filter((v) => v.stand === ui.standFilter);
  if (suche) {
    liste = liste.filter((v) =>
      String(v.nr).toLowerCase().includes(suche) ||
      v.name.toLowerCase().includes(suche) ||
      (v.stand || '').toLowerCase().includes(suche));
  }

  return '' +
  '<div class="spalte">' +
    '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:16px">' +
      '<h1 class="serif" style="font-size:34px;line-height:1.05;margin:0">Völker</h1>' +
      '<button class="link" data-aktion="volk-neu">+ Neues Volk</button>' +
    '</div>' +
    '<input class="eingabe" type="search" inputmode="search" placeholder="Nummer, Name oder Stand" ' +
      'data-aktion-eingabe="suche" data-behalten="suche" value="' + esc(ui.suche || '') + '" ' +
      'aria-label="Völker durchsuchen">' +
    (staende.length > 1
      ? '<div class="filter" style="margin-top:12px">' +
          '<button class="filter-knopf" data-aktion="stand-filter" data-wert="" aria-pressed="' + (!ui.standFilter) + '">' +
            'Alle · ' + daten.voelker.length + '</button>' +
          staende.map((s) => {
            const anzahl = daten.voelker.filter((v) => v.stand === s).length;
            return '<button class="filter-knopf" data-aktion="stand-filter" data-wert="' + esc(s) + '" ' +
              'aria-pressed="' + (ui.standFilter === s) + '">' + esc(s) + ' · ' + anzahl + '</button>';
          }).join('') +
        '</div>'
      : '') +
  '</div>' +

  '<div class="spalte" style="margin-top:18px">' +
    (liste.length
      ? '<div class="karte">' + liste.map((v) => {
          const letzte = letzteKontrolle(v.id);
          const meta = (v.stand ? v.stand + ' · ' : '') +
            (letzte ? 'letzte Kontrolle ' + kurzDatum(letzte.datum) : 'noch keine Kontrolle');
          return '<button class="zeile" data-aktion="volk-oeffnen" data-id="' + esc(v.id) + '">' +
            '<span class="zeile-nr">' + esc(v.nr) + '</span>' +
            '<span class="zeile-mitte">' +
              '<span style="display:flex;align-items:center;gap:7px">' +
                '<span class="zeile-titel">' + esc(v.name) + '</span>' + statusPunkt(v.status) +
              '</span>' +
              '<span class="zeile-meta" style="display:block">' + esc(meta) + '</span>' +
            '</span>' +
            '<span class="zeile-pfeil">›</span>' +
          '</button>';
        }).join('') + '</div>'
      : '<div class="leer">' +
          '<div class="leer-titel">' + (suche || ui.standFilter ? 'Kein Volk passt zur Suche.' : 'Noch kein Volk angelegt.') + '</div>' +
          (suche || ui.standFilter ? '' : '<div class="leer-meta">Oben rechts anlegen</div>') +
        '</div>') +
  '</div>';
}

// ---------- Stockkarte ----------

export function karte(ui) {
  const volk = volkNachId(ui.volkId);
  if (!volk) {
    return '<div class="spalte"><div class="leer">' +
      '<div class="leer-titel">Dieses Volk gibt es nicht (mehr).</div>' +
      '<div class="leer-meta">Zurück zur Liste</div></div>' +
      '<button class="knopf knopf--leise" data-aktion="gehe" data-ziel="/voelker" style="margin-top:14px">Zu den Völkern</button>' +
    '</div>';
  }

  const jahr = ui.jahr || new Date().getFullYear();
  const farbe = koeniginFarbe(volk.koeniginJahr);
  const tab = ui.tab || 'kontrollen';

  const kopf = '' +
  '<div class="spalte">' +
    '<button class="link" data-aktion="gehe" data-ziel="/voelker">‹ Völker</button>' +
    '<div class="karten-kopf" style="margin-top:6px">' +
      '<div class="karten-kopf-titel">' +
        '<div>' +
          '<h1>Stockkarte</h1>' +
          '<div class="mono" style="font-size:12px;color:var(--tinte-55);margin-top:9px">JAHR ' + jahr + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex:none">' +
          '<button class="qr-knopf" data-aktion="qr-zeigen" data-id="' + esc(volk.id) + '" title="QR-Etikett zeigen" aria-label="QR-Etikett zeigen">' +
            '<span></span><span></span><span></span><span></span>' +
          '</button>' +
          '<button class="qr-knopf" data-aktion="volk-bearbeiten" data-id="' + esc(volk.id) + '" title="Volk bearbeiten" aria-label="Volk bearbeiten" ' +
            'style="display:flex;align-items:center;justify-content:center;font:400 18px/1 var(--sans);color:var(--tinte-55)">⋯</button>' +
        '</div>' +
      '</div>' +
      '<div class="karten-raster">' +
        kartenFeld('Volk Nr. / Name', esc(volk.nr) + ' · ' + esc(volk.name)) +
        kartenFeld('Stand', esc(volk.stand || '—')) +
        kartenFeld('Königin', volk.koeniginJahr
          ? '<span style="display:flex;align-items:center;gap:7px">' +
              '<span style="width:11px;height:11px;border-radius:99px;background:' + (FARB_WERTE[farbe] || '#ccc') +
              ';border:1px solid rgba(66,62,55,.25);flex:none"></span>' +
              '<span>' + volk.koeniginJahr + ' · ' + esc(farbe || '') + '</span></span>'
          : '—', true) +
        kartenFeld('Status', '<span style="color:' + (STATUS_FARBE[volk.status] || 'inherit') + '">' + esc(volk.status) + '</span>', true) +
      '</div>' +
    '</div>' +

    '<div class="reiter" style="margin-top:18px" role="tablist">' +
      reiterKnopf('kontrollen', 'Kontrollen', tab) +
      reiterKnopf('honig', 'Honig', tab) +
      reiterKnopf('behandlung', 'Behandlung', tab) +
    '</div>' +
  '</div>';

  const inhalt = tab === 'honig' ? honigTab(volk, jahr)
    : tab === 'behandlung' ? behandlungTab(volk, jahr)
    : kontrollenTab(volk);

  return kopf + '<div class="spalte" style="margin-top:18px">' + inhalt + '</div>';
}

function kartenFeld(label, wertHtml, klein = false) {
  return '<div class="karten-feld">' +
    '<div class="karten-feld-label">' + esc(label) + '</div>' +
    '<div class="karten-feld-wert' + (klein ? ' karten-feld-wert--klein' : '') + '">' + wertHtml + '</div>' +
  '</div>';
}

function reiterKnopf(wert, label, aktiv) {
  return '<button class="reiter-knopf" role="tab" data-aktion="tab" data-wert="' + wert + '" ' +
    'aria-selected="' + (aktiv === wert) + '">' + label + '</button>';
}

function kontrollenTab(volk) {
  const eintraege = kontrollenVon(volk.id);

  const kopf = '<div class="raster-kopf">' +
    '<span class="raster-datum-spalte">DATUM</span>' +
    '<span class="raster-zellen">' +
      MERKMALE.map((m) => '<span class="raster-kopf-zelle" title="' + esc(m.label) + '">' + m.kurz + '</span>').join('') +
    '</span>' +
    // Platzhalter in Breite des Löschen-Knopfs, sonst fluchten die Spalten nicht
    '<span class="raster-loeschen" aria-hidden="true"></span>' +
  '</div>';

  const zeilen = eintraege.length
    ? eintraege.map((k) =>
        '<div class="raster-zeile">' +
          '<div class="raster-zeile-oben">' +
            '<span class="raster-datum raster-datum-spalte">' + esc(kurzDatum(k.datum)) + '</span>' +
            '<span class="raster-zellen">' +
              MERKMALE.map((m) => {
                const an = k.merkmale.includes(m.key);
                return '<span class="raster-zelle' + (an ? ' raster-zelle--an' : '') + '" ' +
                  'title="' + esc(m.label) + (an ? '' : ' — nicht gesehen') + '">' + (an ? m.kurz : '·') + '</span>';
              }).join('') +
            '</span>' +
            '<button class="link raster-loeschen" data-aktion="kontrolle-loeschen" data-id="' + esc(k.id) + '" ' +
              'title="Kontrolle löschen" aria-label="Kontrolle vom ' + esc(langDatum(k.datum)) + ' löschen">×</button>' +
          '</div>' +
          (k.notiz || k.futterKg
            ? '<div class="raster-notiz">' +
                (k.futterKg ? '<b style="font-weight:600">' + esc(zahl(k.futterKg)) + ' kg Futter</b>' + (k.notiz ? ' · ' : '') : '') +
                esc(k.notiz || '') +
              '</div>'
            : '') +
        '</div>').join('')
    : '<div class="leer" style="margin-top:16px"><div class="leer-titel">Für dieses Volk ist noch keine Kontrolle erfasst.</div></div>';

  return kopf + zeilen +
    '<button class="knopf knopf--dunkel" data-aktion="kontrolle-neu" data-id="' + esc(volk.id) + '" style="margin-top:16px">' +
      '+ Kontrolle erfassen</button>';
}

function honigTab(volk, jahr) {
  const raum = honigraumVon(volk.id, jahr);
  const entnahmen = honigVon(volk.id).filter((h) => h.datum.startsWith(String(jahr)));
  const summe = entnahmen.reduce((s, h) => s + (Number(h.kg) || 0), 0);

  return '' +
  '<div class="label" style="margin-bottom:11px">Honigraum am rauf / runter</div>' +
  '<div style="display:flex;gap:10px;margin-bottom:26px">' +
    honigraumFeld('Rauf', raum && raum.rauf, volk.id, jahr, 'rauf') +
    honigraumFeld('Runter', raum && raum.runter, volk.id, jahr, 'runter') +
  '</div>' +

  '<div class="label" style="margin-bottom:11px">Honigwaben entnommen</div>' +
  (entnahmen.length
    ? '<div class="karte">' +
        entnahmen.map((h) =>
          '<div style="display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(66,62,55,.09)">' +
            '<span class="mono" style="flex:1;font-weight:500;font-size:15px">' + esc(kurzDatum(h.datum)) + '</span>' +
            (h.waben ? '<span class="mono" style="font-weight:500;font-size:15px">' + esc(String(h.waben)) + '</span>' +
              '<span style="font:400 12px/1 var(--sans);color:var(--tinte-55);margin-left:5px">Waben</span>' : '') +
            '<span class="mono" style="font-weight:500;font-size:15px;margin-left:14px">' + esc(kg(h.kg)) + '</span>' +
            '<button class="link" data-aktion="honig-loeschen" data-id="' + esc(h.id) + '" ' +
              'style="margin-left:8px;padding:8px 4px;color:var(--tinte-38)" aria-label="Entnahme löschen">×</button>' +
          '</div>').join('') +
        '<div style="display:flex;align-items:center;padding:14px 16px;background:var(--panel)">' +
          '<span style="flex:1;font:500 12px/1 var(--sans)">Summe geschleudert</span>' +
          '<span class="mono" style="font-weight:500;font-size:15px">' + esc(kg(summe)) + '</span>' +
        '</div>' +
      '</div>'
    : '<div class="leer"><div class="leer-titel">' + jahr + ' noch keine Entnahme eingetragen.</div></div>') +

  '<button class="knopf knopf--strich" data-aktion="honig-neu" data-id="' + esc(volk.id) + '" style="margin-top:14px">' +
    '+ Entnahme eintragen</button>';
}

function honigraumFeld(label, wert, volkId, jahr, feld) {
  return '<button style="flex:1;padding:14px 15px;border-radius:12px;background:var(--karte);' +
    'border:1px solid var(--tinte-14);text-align:left;min-height:var(--tap)" ' +
    'data-aktion="honigraum" data-id="' + esc(volkId) + '" data-feld="' + feld + '" data-jahr="' + jahr + '">' +
    '<span class="mono" style="display:block;font-size:10px;color:var(--tinte-45);margin-bottom:7px;letter-spacing:.06em">' +
      label.toUpperCase() + '</span>' +
    '<span class="mono" style="display:block;font-weight:500;font-size:19px' + (wert ? '' : ';color:var(--tinte-38)') + '">' +
      esc(wert ? kurzDatum(wert) : '—') + '</span>' +
  '</button>';
}

function behandlungTab(volk, jahr) {
  const alle = behandlungenVon(volk.id, jahr);
  const behandlungen = alle.filter((b) => b.art === 'behandlung');
  const drohnen = alle.filter((b) => b.art === 'drohnenrahmen');

  return '' +
  '<div class="label" style="margin-bottom:11px">Behandelt am</div>' +
  (behandlungen.length
    ? '<div class="karte">' + behandlungen.map((b) =>
        '<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(66,62,55,.09)">' +
          '<span class="mono" style="font-weight:500;font-size:15px;flex:none">' + esc(kurzDatum(b.datum)) + '</span>' +
          '<span style="flex:1;min-width:0">' +
            '<span style="display:block;font:500 13.5px/1.25 var(--sans)">' + esc(b.mittel || 'Behandlung') + '</span>' +
            (b.menge || b.notiz
              ? '<span style="display:block;font:400 11.5px/1.3 var(--sans);color:var(--tinte-55);margin-top:2px">' +
                  esc([b.menge, b.notiz].filter(Boolean).join(' · ')) + '</span>'
              : '') +
          '</span>' +
          '<button class="link" data-aktion="behandlung-loeschen" data-id="' + esc(b.id) + '" ' +
            'style="padding:8px 4px;color:var(--tinte-38)" aria-label="Behandlung löschen">×</button>' +
        '</div>').join('') + '</div>'
    : '<div class="leer">' +
        '<div class="leer-titel">Für ' + jahr + ' ist noch keine Behandlung erfasst.</div>' +
        '<div class="leer-meta">Pflichtangabe für die Bestandsmeldung</div>' +
      '</div>') +

  '<button class="knopf knopf--gold" data-aktion="behandlung-neu" data-id="' + esc(volk.id) + '" style="margin-top:14px">' +
    '+ Behandlung eintragen</button>' +

  '<div class="label" style="margin-top:22px;margin-bottom:11px">Drohnenrahmen</div>' +
  (drohnen.length
    ? '<div class="karte">' + drohnen.map((b) =>
        '<div style="display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(66,62,55,.09)">' +
          '<span style="flex:1;font:400 13.5px/1.3 var(--sans);color:var(--tinte-70)">' +
            'Eingesetzt am' + (b.notiz ? ' · ' + esc(b.notiz) : '') + '</span>' +
          '<span class="mono" style="font-weight:500;font-size:15px">' + esc(kurzDatum(b.datum)) + '</span>' +
          '<button class="link" data-aktion="behandlung-loeschen" data-id="' + esc(b.id) + '" ' +
            'style="margin-left:8px;padding:8px 4px;color:var(--tinte-38)" aria-label="Eintrag löschen">×</button>' +
        '</div>').join('') + '</div>'
    : '<button style="display:flex;align-items:center;width:100%;padding:14px 16px;border:1px solid var(--tinte-14);' +
        'border-radius:12px;background:var(--karte);min-height:var(--tap)" ' +
        'data-aktion="drohnenrahmen-neu" data-id="' + esc(volk.id) + '">' +
        '<span style="flex:1;font:400 13.5px/1 var(--sans);color:var(--tinte-55)">Eingesetzt am</span>' +
        '<span class="mono" style="font-weight:500;font-size:15px;color:rgba(66,62,55,.35)">—</span>' +
      '</button>');
}

// ---------- Bericht ----------

export function bericht(ui) {
  const jahr = ui.jahr || new Date().getFullYear();
  const daten = zustand.daten;
  const kontrollenImJahr = daten.kontrollen.filter((k) => k.datum.startsWith(String(jahr)));
  const mitErtrag = daten.voelker
    .map((v) => ({ volk: v, ertrag: ertragVon(v.id, jahr) }))
    .filter((e) => e.ertrag > 0)
    .sort((a, b) => b.ertrag - a.ertrag);
  const maxErtrag = mitErtrag.reduce((m, e) => Math.max(m, e.ertrag), 0) || 1;
  const gesamt = mitErtrag.reduce((s, e) => s + e.ertrag, 0);

  const jahre = [...new Set(daten.kontrollen.map((k) => jahrVon(k.datum))
    .concat(daten.honig.map((h) => jahrVon(h.datum)))
    .concat([new Date().getFullYear()]))].sort((a, b) => b - a);

  return '' +
  '<div class="spalte">' +
    '<h1 class="serif" style="font-size:34px;line-height:1.05;margin:0 0 6px">Bericht ' + jahr + '</h1>' +
    '<div style="font:400 12.5px/1.5 var(--sans);color:var(--tinte-55);margin-bottom:18px">' +
      'Aus ' + kontrollenImJahr.length + ' ' + pluralWort(kontrollenImJahr.length, 'Kontrolle', 'Kontrollen') +
      ' auf ' + daten.voelker.length + ' ' + pluralWort(daten.voelker.length, 'Volk', 'Völkern') + '.' +
    '</div>' +

    (jahre.length > 1
      ? '<div class="filter" style="margin-bottom:24px">' + jahre.map((j) =>
          '<button class="filter-knopf" data-aktion="jahr" data-wert="' + j + '" aria-pressed="' + (j === jahr) + '">' + j + '</button>'
        ).join('') + '</div>'
      : '') +

    '<div class="label" style="margin-bottom:13px">Ertrag je Volk</div>' +
    (mitErtrag.length
      ? '<div style="display:flex;flex-direction:column;gap:11px;margin-bottom:14px">' +
          mitErtrag.map((e) =>
            '<div class="balken-zeile">' +
              '<span class="balken-nr">' + esc(e.volk.nr) + '</span>' +
              '<span class="balken-bahn"><span class="balken-fuellung" style="width:' +
                Math.round((e.ertrag / maxErtrag) * 100) + '%"></span></span>' +
              '<span class="balken-wert">' + esc(kg(e.ertrag)) + '</span>' +
            '</div>').join('') +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;padding:12px 0 0;border-top:1px solid var(--tinte-14);margin-bottom:30px">' +
          '<span style="font:500 12.5px/1 var(--sans)">Gesamt ' + jahr + '</span>' +
          '<span class="mono" style="font-weight:500;font-size:13px">' + esc(kg(gesamt)) + '</span>' +
        '</div>'
      : '<div class="leer" style="margin-bottom:30px"><div class="leer-titel">' + jahr + ' noch kein Honig eingetragen.</div></div>') +

    '<div class="label" style="margin-bottom:11px">Export</div>' +
    '<div class="karte">' +
      exportZeile('PDF', 'Stockkarten als PDF', 'Ein Blatt je Volk, Papierlayout', 'druck-karten') +
      exportZeile('CSV', 'Alle Kontrollen als CSV', 'Für Tabellenkalkulation', 'export-csv') +
      exportZeile('TSK', 'Bestandsmeldung', 'Völkerzahl + Behandlungen, Stichtag', 'druck-bestand', true) +
      exportZeile('QR', 'QR-Etiketten drucken', 'Ein Aufkleber je Volk für den Deckel', 'druck-qr') +
    '</div>' +
  '</div>';
}

function exportZeile(marke, titel, meta, aktion, gold = false) {
  return '<button class="export-zeile" data-aktion="' + aktion + '">' +
    '<span class="export-marke' + (gold ? ' export-marke--gold' : '') + '">' + marke + '</span>' +
    '<span style="flex:1;min-width:0">' +
      '<span style="display:block;font:500 13.5px/1.2 var(--sans)">' + esc(titel) + '</span>' +
      '<span style="display:block;font:400 11.5px/1.3 var(--sans);color:var(--tinte-55);margin-top:2px">' + esc(meta) + '</span>' +
    '</span>' +
    '<span class="zeile-pfeil">›</span>' +
  '</button>';
}

// ---------- Einstellungen ----------

export function einstellungen() {
  const s = zustand.daten.settings;
  const offen = zustand.outbox.length;

  return '' +
  '<div class="spalte">' +
    '<h1 class="serif" style="font-size:34px;line-height:1.05;margin:0 0 22px">Einstellungen</h1>' +

    '<div class="label" style="margin-bottom:11px">Imkerei</div>' +
    '<div class="feld">' +
      '<label class="feld-label" for="e-imkerei">Name</label>' +
      '<input class="eingabe" id="e-imkerei" data-behalten="e-imkerei" value="' + esc(s.imkerei) + '" maxlength="120">' +
    '</div>' +
    '<div class="feld">' +
      '<label class="feld-label" for="e-kuerzel">Kürzel (zwei Buchstaben)</label>' +
      '<input class="eingabe mono" id="e-kuerzel" data-behalten="e-kuerzel" value="' + esc(s.kuerzel) + '" maxlength="4" style="max-width:120px">' +
    '</div>' +
    '<button class="knopf knopf--dunkel" data-aktion="einstellungen-speichern">Speichern</button>' +

    '<div class="label" style="margin:30px 0 11px">Daten</div>' +
    '<div class="karte">' +
      '<button class="export-zeile" data-aktion="export-json">' +
        '<span class="export-marke">JSON</span>' +
        '<span style="flex:1"><span style="display:block;font:500 13.5px/1.2 var(--sans)">Sicherung herunterladen</span>' +
        '<span style="display:block;font:400 11.5px/1.3 var(--sans);color:var(--tinte-55);margin-top:2px">Alle Daten in einer Datei</span></span>' +
        '<span class="zeile-pfeil">›</span>' +
      '</button>' +
      '<button class="export-zeile" data-aktion="druck-qr">' +
        '<span class="export-marke">QR</span>' +
        '<span style="flex:1"><span style="display:block;font:500 13.5px/1.2 var(--sans)">QR-Etiketten drucken</span>' +
        '<span style="display:block;font:400 11.5px/1.3 var(--sans);color:var(--tinte-55);margin-top:2px">Ein Aufkleber je Volk</span></span>' +
        '<span class="zeile-pfeil">›</span>' +
      '</button>' +
    '</div>' +
    '<div style="font:400 11.5px/1.5 var(--sans);color:var(--tinte-55);margin-top:10px">' +
      (offen
        ? offen + ' ' + pluralWort(offen, 'Eintrag wartet', 'Einträge warten') + ' noch auf die Übertragung zum Pi.'
        : 'Alle Einträge sind auf dem Pi gesichert.') +
    '</div>' +

    '<div class="label" style="margin:30px 0 11px">Passwort ändern</div>' +
    '<div class="feld">' +
      '<label class="feld-label" for="e-alt">Bisheriges Passwort</label>' +
      '<input class="eingabe" id="e-alt" type="password" autocomplete="current-password" data-behalten="e-alt">' +
    '</div>' +
    '<div class="feld">' +
      '<label class="feld-label" for="e-neu">Neues Passwort (mindestens 6 Zeichen)</label>' +
      '<input class="eingabe" id="e-neu" type="password" autocomplete="new-password" data-behalten="e-neu">' +
    '</div>' +
    '<button class="knopf knopf--leise" data-aktion="passwort-aendern">Passwort ändern</button>' +

    '<div style="margin-top:34px;padding-top:22px;border-top:1px solid var(--tinte-14)">' +
      '<button class="knopf knopf--leise" data-aktion="abmelden">Abmelden</button>' +
    '</div>' +

    '<div style="font:400 11px/1.6 var(--mono);color:var(--tinte-38);margin-top:22px;text-align:center">' +
      'Stockkarte · Daten liegen auf deinem Raspberry Pi' +
    '</div>' +
  '</div>';
}

// ---------- Anmeldung ----------

export function login(fehler) {
  return '<div class="login"><div class="login-karte">' +
    '<h1 class="serif">Stockkarte</h1>' +
    '<p>Bitte das Passwort der Imkerei eingeben.</p>' +
    (fehler ? '<div class="hinweis-fehler">' + esc(fehler) + '</div>' : '') +
    '<form data-aktion-formular="login">' +
      '<div class="feld">' +
        '<label class="feld-label" for="passwort">Passwort</label>' +
        '<input class="eingabe" id="passwort" name="passwort" type="password" ' +
          'autocomplete="current-password" required autofocus>' +
      '</div>' +
      '<button class="knopf knopf--dunkel" type="submit">Anmelden</button>' +
    '</form>' +
  '</div></div>';
}

// ---------- Navigation ----------

export function navigation(aktiv) {
  const eintrag = (ziel, klasse, label, istAktiv) =>
    '<button class="nav-knopf" data-aktion="gehe" data-ziel="' + ziel + '" ' +
      (istAktiv ? 'aria-current="page"' : '') + '>' +
      '<span class="nav-icon nav-icon--' + klasse + '"></span>' +
      '<span>' + label + '</span>' +
    '</button>';

  return '<nav class="nav">' +
    eintrag('/', 'uebersicht', 'Übersicht', aktiv === 'uebersicht') +
    eintrag('/voelker', 'voelker', 'Völker', aktiv === 'voelker' || aktiv === 'karte') +
    '<button class="nav-knopf nav-scan" data-aktion="scanner-oeffnen">' +
      '<span class="scan-flaeche"><span></span></span>' +
      '<span>Scan</span>' +
    '</button>' +
    eintrag('/bericht', 'bericht', 'Bericht', aktiv === 'bericht') +
  '</nav>';
}

// ---------- Scanner-Oberfläche ----------

export function scannerAnsicht() {
  return '<div class="scanner">' +
    '<div class="scanner-kopf">' +
      '<div class="scanner-titel">Stock scannen</div>' +
      '<button class="scanner-abbrechen" data-aktion="scanner-schliessen">Abbrechen</button>' +
    '</div>' +
    '<div class="scanner-hinweis">QR-Code am Deckel ins Bild halten — die Karte öffnet sich sofort.</div>' +

    '<div class="scanner-buehne" id="scanner-buehne">' +
      '<video id="scanner-video" playsinline muted></video>' +
      '<div class="scanner-rahmen">' +
        '<span class="scanner-ecke scanner-ecke--lo"></span>' +
        '<span class="scanner-ecke scanner-ecke--ro"></span>' +
        '<span class="scanner-ecke scanner-ecke--lu"></span>' +
        '<span class="scanner-ecke scanner-ecke--ru"></span>' +
        '<div class="scanner-linie"></div>' +
      '</div>' +
      '<div class="scanner-status" id="scanner-status">Kamera wird geöffnet …</div>' +
    '</div>' +

    '<div class="scanner-fehler" id="scanner-fehler" hidden></div>' +

    '<div class="scanner-fuss">' +
      '<button class="knopf knopf--gold" id="scanner-licht" data-aktion="scanner-licht" hidden>Licht an / aus</button>' +
      '<button class="scanner-manuell" data-aktion="scanner-manuell">' +
        'Kein QR am Stock? <span>Volk manuell wählen</span></button>' +
    '</div>' +
  '</div>';
}

// ---------- Formulare im Sheet ----------

export function sheetInhalt(ui) {
  const s = ui.sheet;
  if (!s) return '';
  if (s.art === 'kontrolle') return sheetKontrolle(ui);
  if (s.art === 'honig') return sheetHonig(ui);
  if (s.art === 'behandlung') return sheetBehandlung(ui);
  if (s.art === 'volk') return sheetVolk(ui);
  if (s.art === 'qr') return sheetQr(ui);
  if (s.art === 'datum') return sheetDatum(ui);
  return '';
}

function sheetRahmen(titel, meta, inhalt, speichernLabel = 'Offline speichern', hinweis = '') {
  return '<div class="sheet-griff"></div>' +
    '<div class="sheet-kopf">' +
      '<div><div class="sheet-titel">' + esc(titel) + '</div>' +
      (meta ? '<div class="sheet-meta">' + esc(meta) + '</div>' : '') + '</div>' +
      '<button class="link" data-aktion="sheet-schliessen" style="color:var(--tinte-55)">Abbrechen</button>' +
    '</div>' + inhalt +
    (speichernLabel
      ? '<button class="knopf knopf--dunkel" data-aktion="sheet-speichern" style="margin-top:20px">' + esc(speichernLabel) + '</button>'
      : '') +
    (hinweis
      ? '<div style="text-align:center;font:400 11.5px/1.4 var(--sans);color:var(--tinte-45);margin-top:11px">' + esc(hinweis) + '</div>'
      : '');
}

const FUTTER_STUFEN = [null, 1, 2.5, 5];

function sheetKontrolle(ui) {
  const volk = volkNachId(ui.sheet.volkId);
  const form = ui.form;

  const merkmale = '<div class="merkmale" style="margin-bottom:18px">' +
    MERKMALE.map((m) => {
      const an = Boolean(form.merkmale[m.key]);
      return '<button class="merkmal" data-aktion="merkmal" data-wert="' + m.key + '" aria-pressed="' + an + '">' +
        '<span class="merkmal-box">' + (an ? '✓' : '') + '</span>' +
        '<span class="merkmal-text">' + esc(m.label) + '</span>' +
      '</button>';
    }).join('') + '</div>';

  const futter = '<div class="feld-label">Futter gegeben</div>' +
    '<div class="optionen" style="margin-bottom:18px">' +
      FUTTER_STUFEN.map((wert) => {
        const an = form.futterKg === wert;
        const label = wert === null ? '—' : zahl(wert) + ' kg';
        return '<button class="option" data-aktion="futter" data-wert="' + (wert === null ? '' : wert) + '" ' +
          'aria-pressed="' + an + '">' + esc(label) + '</button>';
      }).join('') +
    '</div>';

  const chips = ['Brutwaben entnommen', 'Weiselzellen', 'Sanft', 'Erweitert', 'Erweitert um Zarge', 'Schwarmstimmung'];

  const bemerkung = '<div class="feld-label">Bemerkung</div>' +
    '<div class="chips" style="margin-bottom:10px">' +
      chips.map((c) => '<button class="chip" data-aktion="notiz-chip" data-wert="' + esc(c) + '">' + esc(c) + '</button>').join('') +
    '</div>' +
    '<textarea class="eingabe" data-behalten="notiz" data-feld="notiz" rows="3" ' +
      'placeholder="Kurz notieren …">' + esc(form.notiz || '') + '</textarea>';

  const datum = '<div class="feld" style="margin-top:18px">' +
    '<label class="feld-label" for="k-datum">Datum</label>' +
    '<input class="eingabe mono" id="k-datum" type="date" data-behalten="k-datum" data-feld="datum" ' +
      'value="' + esc(form.datum) + '" style="max-width:200px">' +
  '</div>';

  return sheetRahmen(
    'Kontrolle · Volk ' + (volk ? volk.nr : ''),
    erfassungsZeile(form.datum),
    merkmale + futter + bemerkung + datum,
    'Offline speichern',
    'Landet sofort auf der Karte · Sync später'
  );
}

function sheetHonig(ui) {
  const volk = volkNachId(ui.sheet.volkId);
  const form = ui.form;
  return sheetRahmen(
    'Entnahme · Volk ' + (volk ? volk.nr : ''),
    null,
    '<div class="feld">' +
      '<label class="feld-label" for="h-datum">Datum</label>' +
      '<input class="eingabe mono" id="h-datum" type="date" data-behalten="h-datum" data-feld="datum" value="' + esc(form.datum) + '">' +
    '</div>' +
    '<div class="feld">' +
      '<label class="feld-label" for="h-waben">Waben entnommen</label>' +
      '<input class="eingabe mono" id="h-waben" type="number" inputmode="numeric" min="0" max="99" ' +
        'data-behalten="h-waben" data-feld="waben" value="' + esc(form.waben ?? '') + '" placeholder="9">' +
    '</div>' +
    '<div class="feld">' +
      '<label class="feld-label" for="h-kg">Geschleudert (kg)</label>' +
      '<input class="eingabe mono" id="h-kg" type="text" inputmode="decimal" ' +
        'data-behalten="h-kg" data-feld="kg" value="' + esc(form.kg ?? '') + '" placeholder="9,8">' +
    '</div>'
  );
}

function sheetBehandlung(ui) {
  const volk = volkNachId(ui.sheet.volkId);
  const form = ui.form;
  const drohnen = ui.sheet.drohnenrahmen;
  const mittel = ['Ameisensäure 60 %', 'Oxalsäure träufeln', 'Oxalsäure sublimieren', 'Milchsäure', 'Thymol'];

  return sheetRahmen(
    (drohnen ? 'Drohnenrahmen' : 'Behandlung') + ' · Volk ' + (volk ? volk.nr : ''),
    null,
    '<div class="feld">' +
      '<label class="feld-label" for="b-datum">Datum</label>' +
      '<input class="eingabe mono" id="b-datum" type="date" data-behalten="b-datum" data-feld="datum" value="' + esc(form.datum) + '">' +
    '</div>' +
    (drohnen ? '' :
      '<div class="feld">' +
        '<div class="feld-label">Mittel</div>' +
        '<div class="chips" style="margin-bottom:10px">' +
          mittel.map((m) => '<button class="chip" data-aktion="mittel-chip" data-wert="' + esc(m) + '" ' +
            'aria-pressed="' + (form.mittel === m) + '">' + esc(m) + '</button>').join('') +
        '</div>' +
        '<input class="eingabe" data-behalten="b-mittel" data-feld="mittel" value="' + esc(form.mittel || '') + '" ' +
          'placeholder="Mittel eintragen" maxlength="120">' +
      '</div>' +
      '<div class="feld">' +
        '<label class="feld-label" for="b-menge">Menge</label>' +
        '<input class="eingabe" id="b-menge" data-behalten="b-menge" data-feld="menge" ' +
          'value="' + esc(form.menge || '') + '" placeholder="z. B. 180 ml" maxlength="60">' +
      '</div>') +
    '<div class="feld">' +
      '<label class="feld-label" for="b-notiz">Bemerkung</label>' +
      '<input class="eingabe" id="b-notiz" data-behalten="b-notiz" data-feld="notiz" ' +
        'value="' + esc(form.notiz || '') + '" maxlength="200">' +
    '</div>'
  );
}

function sheetVolk(ui) {
  const form = ui.form;
  const neu = !ui.sheet.volkId;
  const staende = [...new Set(zustand.daten.voelker.map((v) => v.stand).filter(Boolean))];
  const jahrJetzt = new Date().getFullYear();

  return sheetRahmen(
    neu ? 'Neues Volk' : 'Volk bearbeiten',
    null,
    '<div class="feld">' +
      '<label class="feld-label" for="v-nr">Nummer</label>' +
      '<input class="eingabe mono" id="v-nr" data-behalten="v-nr" data-feld="nr" value="' + esc(form.nr || '') + '" ' +
        'placeholder="9" maxlength="20" style="max-width:140px" required>' +
    '</div>' +
    '<div class="feld">' +
      '<label class="feld-label" for="v-name">Name</label>' +
      '<input class="eingabe" id="v-name" data-behalten="v-name" data-feld="name" value="' + esc(form.name || '') + '" ' +
        'placeholder="Weiher 9" maxlength="80">' +
    '</div>' +
    '<div class="feld">' +
      '<label class="feld-label" for="v-stand">Stand</label>' +
      '<input class="eingabe" id="v-stand" data-behalten="v-stand" data-feld="stand" value="' + esc(form.stand || '') + '" ' +
        'placeholder="Weiher" maxlength="80" list="stand-liste">' +
      '<datalist id="stand-liste">' + staende.map((s) => '<option value="' + esc(s) + '">').join('') + '</datalist>' +
    '</div>' +
    '<div class="feld">' +
      '<div class="feld-label">Status</div>' +
      '<div class="chips">' + STATUS_WERTE.map((s) =>
        '<button class="chip" data-aktion="status" data-wert="' + esc(s) + '" aria-pressed="' + (form.status === s) + '">' +
          esc(s) + '</button>').join('') + '</div>' +
    '</div>' +
    '<div class="feld">' +
      '<label class="feld-label" for="v-koenigin">Königin — Jahrgang</label>' +
      '<input class="eingabe mono" id="v-koenigin" type="number" inputmode="numeric" min="2000" max="' + (jahrJetzt + 1) + '" ' +
        'data-behalten="v-koenigin" data-feld="koeniginJahr" value="' + esc(form.koeniginJahr ?? '') + '" ' +
        'placeholder="' + jahrJetzt + '" style="max-width:160px">' +
      '<div style="font:400 11.5px/1.4 var(--sans);color:var(--tinte-55);margin-top:7px">' +
        (form.koeniginJahr ? 'Farbe ' + esc(koeniginFarbe(form.koeniginJahr) || '—') : 'Die Farbe ergibt sich aus dem Jahrgang.') +
      '</div>' +
    '</div>' +
    (neu ? '' :
      '<button class="knopf knopf--leise" data-aktion="volk-loeschen" data-id="' + esc(ui.sheet.volkId) + '" ' +
        'style="margin-top:8px;color:var(--rot)">Volk löschen</button>'),
    neu ? 'Volk anlegen' : 'Speichern'
  );
}

function sheetQr(ui) {
  const volk = volkNachId(ui.sheet.volkId);
  return '<div class="sheet-griff"></div>' +
    '<div class="sheet-kopf">' +
      '<div><div class="sheet-titel">Etikett · Volk ' + esc(volk ? volk.nr : '') + '</div>' +
      '<div class="sheet-meta">Auf den Deckel kleben</div></div>' +
      '<button class="link" data-aktion="sheet-schliessen" style="color:var(--tinte-55)">Schließen</button>' +
    '</div>' +
    '<div style="max-width:260px;margin:0 auto;padding:16px;background:#fff;border-radius:12px;border:1px solid var(--tinte-14)" ' +
      'id="qr-ziel">' +
      (ui.qrSvg || '<div class="laden">QR-Code wird erzeugt …</div>') +
      '<div style="text-align:center;font:600 22px/1 var(--mono);margin-top:10px;color:#000">' + esc(volk ? volk.nr : '') + '</div>' +
      '<div style="text-align:center;font:400 11px/1.3 var(--sans);color:#555;margin-top:4px">' + esc(volk ? volk.name : '') + '</div>' +
    '</div>' +
    '<button class="knopf knopf--leise" data-aktion="druck-qr" style="margin-top:20px">Alle Etiketten drucken</button>';
}

function sheetDatum(ui) {
  return sheetRahmen(
    ui.sheet.titel || 'Datum wählen',
    null,
    '<div class="feld">' +
      '<input class="eingabe mono" type="date" data-behalten="d-datum" data-feld="datum" value="' + esc(ui.form.datum || '') + '">' +
    '</div>' +
    '<button class="knopf knopf--leise" data-aktion="datum-leeren" style="margin-top:4px">Eintrag entfernen</button>',
    'Übernehmen'
  );
}

// ---------- Druckansichten ----------

export function druckQr(ui) {
  const voelker = zustand.daten.voelker;
  return '<div class="spalte nur-bildschirm" style="margin-bottom:20px">' +
    '<button class="link" data-aktion="gehe" data-ziel="/bericht">‹ Zurück</button>' +
    '<h1 class="serif" style="font-size:28px;margin:6px 0 8px">QR-Etiketten</h1>' +
    '<p style="font:400 13px/1.55 var(--sans);color:var(--tinte-55);margin:0 0 16px">' +
      'Ausdrucken, ausschneiden und auf den Deckel kleben. Beim Scannen öffnet sich die Karte des Volkes sofort — ' +
      'auch mit der normalen Kamera-App.</p>' +
    '<button class="knopf knopf--dunkel" data-aktion="drucken" style="max-width:220px">Drucken</button>' +
  '</div>' +
  '<div class="spalte"><div class="druck-bogen">' +
    (ui.qrBogen || voelker.map(() => '<div class="druck-etikett"><div class="laden">…</div></div>').join('')) +
  '</div></div>';
}

export function druckKarten() {
  const daten = zustand.daten;
  const jahr = new Date().getFullYear();

  return '<div class="spalte nur-bildschirm" style="margin-bottom:20px">' +
    '<button class="link" data-aktion="gehe" data-ziel="/bericht">‹ Zurück</button>' +
    '<h1 class="serif" style="font-size:28px;margin:6px 0 8px">Stockkarten drucken</h1>' +
    '<p style="font:400 13px/1.55 var(--sans);color:var(--tinte-55);margin:0 0 16px">Ein Blatt je Volk.</p>' +
    '<button class="knopf knopf--dunkel" data-aktion="drucken" style="max-width:220px">Drucken</button>' +
  '</div>' +
  daten.voelker.map((volk) => {
    const eintraege = kontrollenVon(volk.id);
    const farbe = koeniginFarbe(volk.koeniginJahr);
    return '<div class="spalte druck-seite" style="margin-bottom:34px">' +
      '<div class="karten-kopf">' +
        '<div class="karten-kopf-titel"><div><h1>Stockkarte</h1>' +
          '<div class="mono" style="font-size:12px;color:var(--tinte-55);margin-top:9px">JAHR ' + jahr + '</div></div></div>' +
        '<div class="karten-raster">' +
          kartenFeld('Volk Nr. / Name', esc(volk.nr) + ' · ' + esc(volk.name)) +
          kartenFeld('Stand', esc(volk.stand || '—')) +
          kartenFeld('Königin', volk.koeniginJahr ? volk.koeniginJahr + ' · ' + esc(farbe || '') : '—', true) +
          kartenFeld('Status', esc(volk.status), true) +
        '</div>' +
      '</div>' +
      '<div style="margin-top:14px">' +
        '<div class="raster-kopf">' +
          '<span class="raster-datum-spalte">DATUM</span>' +
          '<span class="raster-zellen">' + MERKMALE.map((m) => '<span class="raster-kopf-zelle">' + m.kurz + '</span>').join('') + '</span>' +
        '</div>' +
        (eintraege.length ? eintraege.map((k) =>
          '<div class="raster-zeile"><div class="raster-zeile-oben">' +
            '<span class="raster-datum raster-datum-spalte">' + esc(kurzDatum(k.datum)) + '</span>' +
            '<span class="raster-zellen">' + MERKMALE.map((m) => {
              const an = k.merkmale.includes(m.key);
              return '<span class="raster-zelle' + (an ? ' raster-zelle--an' : '') + '">' + (an ? m.kurz : '·') + '</span>';
            }).join('') + '</span>' +
          '</div>' +
          (k.notiz || k.futterKg ? '<div class="raster-notiz">' +
            (k.futterKg ? esc(zahl(k.futterKg)) + ' kg Futter' + (k.notiz ? ' · ' : '') : '') + esc(k.notiz || '') + '</div>' : '') +
          '</div>').join('')
          : '<div class="leer" style="margin-top:12px"><div class="leer-titel">Keine Kontrollen erfasst.</div></div>') +
      '</div>' +
    '</div>';
  }).join('');
}

export function druckBestand() {
  const daten = zustand.daten;
  const jahr = new Date().getFullYear();
  const heute = heuteIso();
  const lebendig = daten.voelker.filter((v) => v.status !== 'Volk tot');
  const proStand = {};
  for (const v of lebendig) proStand[v.stand || 'ohne Stand'] = (proStand[v.stand || 'ohne Stand'] || 0) + 1;

  const behandlungen = daten.behandlungen
    .filter((b) => b.art === 'behandlung' && b.datum.startsWith(String(jahr)))
    .sort((a, b) => a.datum.localeCompare(b.datum));

  return '<div class="spalte nur-bildschirm" style="margin-bottom:20px">' +
    '<button class="link" data-aktion="gehe" data-ziel="/bericht">‹ Zurück</button>' +
    '<button class="knopf knopf--dunkel" data-aktion="drucken" style="max-width:220px;margin-top:8px">Drucken</button>' +
  '</div>' +
  '<div class="spalte">' +
    '<h1 class="serif" style="font-size:28px;margin:0 0 4px">Bestandsmeldung ' + jahr + '</h1>' +
    '<div class="mono" style="font-size:11.5px;color:var(--tinte-55);margin-bottom:24px">' +
      'STICHTAG ' + esc(langDatum(heute)) + ' · ' + esc(daten.settings.imkerei) + '</div>' +

    '<div class="label" style="margin-bottom:11px">Völker je Stand</div>' +
    '<div class="karte" style="margin-bottom:26px">' +
      Object.entries(proStand).map(([stand, anzahl]) =>
        '<div style="display:flex;padding:13px 16px;border-bottom:1px solid rgba(66,62,55,.09)">' +
          '<span style="flex:1;font:500 13.5px/1 var(--sans)">' + esc(stand) + '</span>' +
          '<span class="mono" style="font-weight:500">' + anzahl + '</span>' +
        '</div>').join('') +
      '<div style="display:flex;padding:13px 16px;background:var(--panel)">' +
        '<span style="flex:1;font:600 13.5px/1 var(--sans)">Gesamt</span>' +
        '<span class="mono" style="font-weight:600">' + lebendig.length + '</span>' +
      '</div>' +
    '</div>' +

    '<div class="label" style="margin-bottom:11px">Behandlungen ' + jahr + '</div>' +
    (behandlungen.length
      ? '<div class="karte">' + behandlungen.map((b) => {
          const volk = volkNachId(b.volkId);
          return '<div style="display:flex;gap:12px;padding:13px 16px;border-bottom:1px solid rgba(66,62,55,.09)">' +
            '<span class="mono" style="width:64px;flex:none">' + esc(langDatum(b.datum)) + '</span>' +
            '<span class="mono" style="width:32px;flex:none">' + esc(volk ? volk.nr : '?') + '</span>' +
            '<span style="flex:1;font:400 13px/1.3 var(--sans)">' + esc(b.mittel || '—') +
              (b.menge ? ' · ' + esc(b.menge) : '') + '</span>' +
          '</div>';
        }).join('') + '</div>'
      : '<div class="leer"><div class="leer-titel">Für ' + jahr + ' ist keine Behandlung erfasst.</div>' +
        '<div class="leer-meta">Pflichtangabe für die Meldung</div></div>') +
  '</div>';
}
