// Datums- und Zahlenformate, wie sie im Entwurf stehen.

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Heute als JJJJ-MM-TT in lokaler Zeit (nicht UTC — sonst springt das Datum abends). */
export function heuteIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function jahrVon(iso) {
  return iso ? Number(iso.slice(0, 4)) : new Date().getFullYear();
}

function teile(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const [j, m, t] = iso.split('-').map(Number);
  if (!j || !m || !t) return null;
  return { j, m, t };
}

/** "18.4." — die Kurzform aus dem Kontrollraster. */
export function kurzDatum(iso) {
  const p = teile(iso);
  return p ? p.t + '.' + p.m + '.' : '—';
}

/** "18.4.2026" */
export function langDatum(iso) {
  const p = teile(iso);
  return p ? p.t + '.' + p.m + '.' + p.j : '—';
}

/** "SONNTAG, 30. AUGUST" für den Kopf der Übersicht. */
export function wochentagZeile(iso) {
  const p = teile(iso);
  if (!p) return '';
  const d = new Date(p.j, p.m - 1, p.t);
  return (WOCHENTAGE[d.getDay()] + ', ' + p.t + '. ' + MONATE[p.m - 1]).toUpperCase();
}

/** "SO 30.8.2026 · 09:14" für den Kopf des Erfassen-Formulars. */
export function erfassungsZeile(iso, jetzt = new Date()) {
  const p = teile(iso);
  if (!p) return '';
  const d = new Date(p.j, p.m - 1, p.t);
  const kurz = WOCHENTAGE[d.getDay()].slice(0, 2).toUpperCase();
  const uhr = String(jetzt.getHours()).padStart(2, '0') + ':' + String(jetzt.getMinutes()).padStart(2, '0');
  return kurz + ' ' + p.t + '.' + p.m + '.' + p.j + ' · ' + uhr;
}

/** Ganze Tage zwischen einem Datum und heute. */
export function tageSeit(iso, heute = heuteIso()) {
  const a = teile(iso);
  const b = teile(heute);
  if (!a || !b) return null;
  const ms = Date.UTC(b.j, b.m - 1, b.t) - Date.UTC(a.j, a.m - 1, a.t);
  return Math.round(ms / 86400000);
}

/** Deutsche Zahl: Komma statt Punkt, höchstens eine Nachkommastelle. */
export function zahl(n, nachkomma = 1) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const gerundet = Number(Number(n).toFixed(nachkomma));
  return String(gerundet).replace('.', ',');
}

export function kg(n) {
  return n === null || n === undefined ? '—' : zahl(n) + ' kg';
}

/** Deutsche Eingabe ("2,5") in eine Zahl verwandeln. */
export function zahlLesen(text) {
  if (text === null || text === undefined || text === '') return null;
  const n = Number(String(text).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

/** Einfache Mehrzahl: pluralWort(1,'Eintrag','Einträge') */
export function pluralWort(n, eins, viele) {
  return n === 1 ? eins : viele;
}

/** HTML-Sonderzeichen entschärfen — alle Nutzertexte laufen hier durch. */
export function esc(wert) {
  if (wert === null || wert === undefined) return '';
  return String(wert)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
