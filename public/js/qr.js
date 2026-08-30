// QR-Codes für die Etiketten am Stockdeckel erzeugen.
//
// Der Code enthält die volle Adresse des Volkes, z. B.
//   https://stockkarte.example.org/v/v9
// Das hat einen angenehmen Nebeneffekt: Auch wer die App nicht offen hat,
// landet beim Scannen mit der normalen Kamera-App direkt auf der Karte.

let generatorGeladen = null;

function generatorLaden() {
  if (generatorGeladen) return generatorGeladen;
  generatorGeladen = new Promise((resolve, reject) => {
    if (window.qrcode) return resolve(window.qrcode);
    const s = document.createElement('script');
    s.src = '/vendor/qrcode-generator.js';
    s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('QR-Generator nicht geladen.')));
    s.onerror = () => reject(new Error('QR-Generator konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
  return generatorGeladen;
}

/** Vollständige, scannbare Adresse eines Volkes. */
export function volkUrl(volkId) {
  return location.origin + '/v/' + encodeURIComponent(volkId);
}

/**
 * QR-Code als SVG-Zeichenkette.
 * Fehlerkorrektur "M" ist ein guter Kompromiss: verträgt Wachsflecken und
 * Kratzer am Etikett, bleibt aber kompakt genug zum Ausdrucken.
 */
export async function qrSvg(text, optionen = {}) {
  const qrcode = await generatorLaden();
  const rand = optionen.rand ?? 2; // in Modulen ("quiet zone")

  // Version 0 heißt: kleinste passende Größe automatisch wählen
  const qr = qrcode(0, optionen.korrektur || 'M');
  qr.addData(text);
  qr.make();

  const anzahl = qr.getModuleCount();
  const gesamt = anzahl + rand * 2;

  // Ein Pfad aus allen dunklen Modulen — kleiner und schärfer als viele <rect>
  let pfad = '';
  for (let zeile = 0; zeile < anzahl; zeile++) {
    for (let spalte = 0; spalte < anzahl; spalte++) {
      if (qr.isDark(zeile, spalte)) {
        pfad += 'M' + (spalte + rand) + ' ' + (zeile + rand) + 'h1v1h-1z';
      }
    }
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + gesamt + ' ' + gesamt + '" ' +
    'shape-rendering="crispEdges" role="img" aria-label="QR-Code">' +
    '<rect width="' + gesamt + '" height="' + gesamt + '" fill="#ffffff"/>' +
    '<path d="' + pfad + '" fill="#000000"/>' +
    '</svg>';
}
