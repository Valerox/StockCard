// QR-Scanner für die Handykamera.
//
// Zwei Wege, je nachdem was der Browser kann:
//   1. BarcodeDetector — nativ in Chrome/Android, schnell und stromsparend
//   2. jsQR auf Canvas-Bildern — Rückfalllösung, u. a. für Safari auf dem iPhone
//
// Wichtig: getUserMedia gibt es nur in einem "sicheren Kontext", also über
// HTTPS oder localhost. Über eine nackte LAN-IP (http://192.168.x.x) sperrt
// der Browser die Kamera — dafür gibt es unten eine verständliche Meldung.

let jsQRGeladen = null;

function jsQRLaden() {
  if (jsQRGeladen) return jsQRGeladen;
  jsQRGeladen = new Promise((resolve, reject) => {
    if (window.jsQR) return resolve(window.jsQR);
    const s = document.createElement('script');
    s.src = '/vendor/jsQR.js';
    s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('jsQR nicht geladen.')));
    s.onerror = () => reject(new Error('jsQR konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
  return jsQRGeladen;
}

export function kameraMoeglich() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function sichererKontext() {
  return window.isSecureContext === true;
}

/**
 * Inhalt eines QR-Codes auf eine Volk-Kennung abbilden.
 * Erkennt unsere eigenen Codes (URL oder stockkarte:-Präfix) und zusätzlich
 * schlichte Nummern, falls jemand eigene Etiketten geklebt hat.
 */
export function codeDeuten(roh) {
  const text = String(roh || '').trim();
  if (!text) return null;

  // .../v/<id> — so drucken wir die Etiketten
  const alsUrl = text.match(/^https?:\/\/[^/]+\/v\/([A-Za-z0-9_-]{1,60})/i);
  if (alsUrl) return { art: 'id', wert: decodeURIComponent(alsUrl[1]) };

  // ?volk=<id> als Alternative
  try {
    if (/^https?:\/\//i.test(text)) {
      const url = new URL(text);
      const ausQuery = url.searchParams.get('volk') || url.searchParams.get('v');
      if (ausQuery) return { art: 'id', wert: ausQuery };
    }
  } catch { /* keine gültige URL */ }

  const mitPraefix = text.match(/^stockkarte:(?:\/\/)?([A-Za-z0-9_-]{1,60})$/i);
  if (mitPraefix) return { art: 'id', wert: mitPraefix[1] };

  // Nackte Nummer, z. B. "9"
  if (/^\d{1,6}$/.test(text)) return { art: 'nr', wert: text };

  // Kennung wie "v9"
  if (/^[A-Za-z0-9_-]{1,60}$/.test(text)) return { art: 'id', wert: text };

  return null;
}

/**
 * Scanner starten.
 *
 * @param {HTMLVideoElement} video   Element, in dem das Kamerabild läuft
 * @param {(text:string)=>void} beiTreffer  Rückruf mit dem gelesenen Text
 * @param {(status:string)=>void} beiStatus Statusmeldungen für die Anzeige
 * @returns {Promise<{stoppen:Function, lichtUmschalten:Function|null}>}
 */
export async function scannerStarten(video, beiTreffer, beiStatus = () => {}) {
  if (!sichererKontext()) {
    const fehler = new Error(
      'Der Browser gibt die Kamera nur über eine gesicherte Verbindung frei. ' +
      'Öffne die App über deine HTTPS-Adresse (Cloudflare Tunnel) statt über die lokale IP.'
    );
    fehler.code = 'unsicher';
    throw fehler;
  }
  if (!kameraMoeglich()) {
    const fehler = new Error('Dieser Browser kann nicht auf die Kamera zugreifen.');
    fehler.code = 'nicht-unterstuetzt';
    throw fehler;
  }

  beiStatus('Kamera wird geöffnet …');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }, // Rückkamera
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch (err) {
    const fehler = new Error(
      err.name === 'NotAllowedError'
        ? 'Der Zugriff auf die Kamera wurde abgelehnt. Du kannst ihn in den Browser-Einstellungen für diese Seite wieder erlauben.'
        : err.name === 'NotFoundError'
          ? 'Es wurde keine Kamera gefunden.'
          : 'Die Kamera ließ sich nicht öffnen: ' + err.message
    );
    fehler.code = err.name === 'NotAllowedError' ? 'verweigert' : 'fehler';
    throw fehler;
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', ''); // iOS: nicht in den Vollbildplayer springen
  video.muted = true;
  await video.play().catch(() => {});

  const spur = stream.getVideoTracks()[0];
  const faehigkeiten = spur && spur.getCapabilities ? spur.getCapabilities() : {};
  const kannLicht = Boolean(faehigkeiten && faehigkeiten.torch);
  let lichtAn = false;

  let laeuft = true;
  let timer = null;
  let detector = null;

  // Nativ, wenn vorhanden
  if ('BarcodeDetector' in window) {
    try {
      const formate = await window.BarcodeDetector.getSupportedFormats();
      if (formate.includes('qr_code')) {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      }
    } catch { detector = null; }
  }

  let jsQR = null;
  let canvas = null;
  let ctx = null;
  if (!detector) {
    beiStatus('Lesemodul wird geladen …');
    try {
      jsQR = await jsQRLaden();
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    } catch (err) {
      stoppen();
      throw new Error('Der QR-Leser konnte nicht geladen werden. Bist du offline und war die App noch nie online?');
    }
  }

  beiStatus('Halte den QR-Code am Deckel ins Bild');

  let letzterTreffer = '';
  let letzteTrefferZeit = 0;

  function treffer(text) {
    const jetzt = Date.now();
    // Denselben Code nicht mehrfach hintereinander melden
    if (text === letzterTreffer && jetzt - letzteTrefferZeit < 2500) return;
    letzterTreffer = text;
    letzteTrefferZeit = jetzt;
    if (navigator.vibrate) navigator.vibrate(60);
    beiTreffer(text);
  }

  async function bildPruefen() {
    if (!laeuft) return;
    if (video.readyState < 2 || !video.videoWidth) {
      timer = setTimeout(bildPruefen, 120);
      return;
    }

    try {
      if (detector) {
        const funde = await detector.detect(video);
        if (funde && funde.length) treffer(funde[0].rawValue);
      } else {
        // Für die Erkennung reicht ein kleineres Bild — spart spürbar Akku
        const breite = Math.min(640, video.videoWidth);
        const hoehe = Math.round((video.videoHeight / video.videoWidth) * breite);
        if (canvas.width !== breite) { canvas.width = breite; canvas.height = hoehe; }
        ctx.drawImage(video, 0, 0, breite, hoehe);
        const bild = ctx.getImageData(0, 0, breite, hoehe);
        const fund = jsQR(bild.data, breite, hoehe, { inversionAttempts: 'dontInvert' });
        if (fund && fund.data) treffer(fund.data);
      }
    } catch (err) {
      // Einzelne Bildfehler ignorieren, der nächste Durchlauf klappt meist
      console.debug('[scanner] Bild übersprungen:', err.message);
    }

    if (laeuft) timer = setTimeout(bildPruefen, detector ? 140 : 180);
  }

  bildPruefen();

  function stoppen() {
    laeuft = false;
    clearTimeout(timer);
    if (lichtAn && spur && spur.applyConstraints) {
      spur.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
    }
    for (const s of stream.getTracks()) s.stop();
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }

  async function lichtUmschalten() {
    if (!kannLicht || !spur.applyConstraints) return false;
    lichtAn = !lichtAn;
    try {
      await spur.applyConstraints({ advanced: [{ torch: lichtAn }] });
      return lichtAn;
    } catch {
      lichtAn = false;
      return false;
    }
  }

  return { stoppen, lichtUmschalten: kannLicht ? lichtUmschalten : null };
}
