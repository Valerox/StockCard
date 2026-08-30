# Stockkarte

Die Stockkarte der Imkerei als Webapp: Kontrollen, Honig und Behandlungen am
Bienenstand erfassen — mit dem Handy, notfalls ohne Netz, und mit einem QR-Code
am Deckel, der die richtige Karte sofort öffnet.

Läuft auf einem Raspberry Pi. Die Daten liegen als eine lesbare JSON-Datei auf
der SD-Karte, ohne Datenbank.

---

## Was die App kann

| | |
|---|---|
| **Übersicht** | Begrüßung, Kennzahlen, was diese Woche fällig ist, zuletzt Erfasstes |
| **Völker** | Suche nach Nummer, Name oder Stand; Filter je Stand; Völker anlegen und bearbeiten |
| **Stockkarte** | Kontrollraster aus sechs Merkmalen, Reiter für Honig und Behandlung |
| **Scanner** | QR am Deckel scannen → die Karte des Volkes öffnet sich direkt |
| **Bericht** | Ertrag je Volk, Export als PDF, CSV und Bestandsmeldung, QR-Etiketten drucken |

Das Kontrollraster bildet die Papierkarte ab: **K**önigin, **St**ifte, **Ma**de,
**v**erd. **B**rut, **Po**llen, **Fu**tter — eine Kontrolle ist eine Zeile.

### Offline zuerst

Am Bienenstand ist selten Netz. Darum:

- Die App ist eine PWA und lässt sich auf dem Homescreen installieren.
- Jede Eingabe landet sofort auf der Karte und in einer Warteschlange im Gerät.
- Sobald der Pi wieder erreichbar ist, wird still nachgeliefert.
- Der Zähler im Kopf zeigt, was noch wartet.

Weil jede Änderung eine eigene Kennung trägt und der Server jede Kennung nur
einmal ausführt, kann Nachliefern nichts doppelt anlegen — auch nach einem
Neustart des Handys nicht.

---

## Installation auf dem Raspberry Pi

Vorausgesetzt ist Raspberry Pi OS und Node.js 18 oder neuer:

```bash
node --version          # muss >= v18 sein
# falls zu alt oder nicht vorhanden:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Projekt holen und starten:

```bash
cd ~
git clone <dein-repo> stockkarte
cd stockkarte

# Beispieldaten einspielen (optional, zum Ausprobieren)
node server/seed.js

# Start
STOCKKARTE_PASSWORT="dein-passwort" node server/server.js
```

**`npm install` ist nicht nötig.** Der Server benutzt ausschließlich Node-
Bordmittel; die beiden Browser-Bibliotheken für QR liegen fertig in
`public/vendor/`.

Beim ersten Start ohne `STOCKKARTE_PASSWORT` würfelt die App ein Passwort und
zeigt es einmalig im Terminal an.

### Als Dienst einrichten

```bash
sudo cp deploy/stockkarte.service /etc/systemd/system/
sudo nano /etc/systemd/system/stockkarte.service   # Benutzer und Pfad prüfen
sudo systemctl daemon-reload
sudo systemctl enable --now stockkarte

systemctl status stockkarte
journalctl -u stockkarte -f
```

---

## Cloudflare Tunnel

Der Tunnel macht den Pi von außen erreichbar und liefert dabei HTTPS —
das ist **Voraussetzung für die Kamera**, siehe unten.

```bash
# cloudflared installieren (arm64)
curl -L -o cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb

cloudflared tunnel login
cloudflared tunnel create stockkarte
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: stockkarte
credentials-file: /home/pi/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: stockkarte.deine-domain.de
    service: http://127.0.0.1:8080
  - service: http_status:404
```

```bash
cloudflared tunnel route dns stockkarte stockkarte.deine-domain.de
sudo cloudflared service install
```

Der Dienst lauscht standardmäßig auf `127.0.0.1`, ist also nur über den Tunnel
erreichbar. Soll die App zusätzlich direkt im Heimnetz laufen, in der
`stockkarte.service` `STOCKKARTE_HOST=0.0.0.0` setzen.

### Zugriffsschutz

Da der Tunnel im öffentlichen Netz endet, ist ein Passwort-Login eingebaut:

- Passwort als scrypt-Hash in `data/auth.json`, Sitzung per HttpOnly-Cookie
- `Secure`-Flag automatisch, sobald über HTTPS zugegriffen wird
- nach acht Fehlversuchen fünf Minuten Sperre je IP
- Passwort änderbar unter *Einstellungen*

Wer es strenger mag, legt in Cloudflare Zero Trust zusätzlich eine
**Access**-Regel vor den Tunnel.

---

## Die Kamera braucht HTTPS

Browser geben `getUserMedia` nur in einem *sicheren Kontext* frei. Praktisch heißt das:

| Adresse | Scanner |
|---|---|
| `https://stockkarte.deine-domain.de` (Tunnel) | funktioniert |
| `http://localhost:8080` (direkt auf dem Pi) | funktioniert |
| `http://192.168.1.50:8080` (LAN-IP) | **blockiert** |
| `http://raspberrypi.local:8080` | **blockiert** |

Am Bienenstand also immer die Tunnel-Adresse verwenden. Die App erklärt das
auch selbst, wenn sie die Kamera nicht öffnen darf — statt nur zu scheitern.

Zum Scannen nutzt sie `BarcodeDetector`, wo der Browser das mitbringt
(Chrome auf Android), sonst jsQR als Rückfalllösung — damit klappt es auch in
Safari auf dem iPhone.

---

## QR-Etiketten

*Bericht → QR-Etiketten drucken* erzeugt einen Bogen mit einem Aufkleber je Volk.
Ausdrucken, ausschneiden, auf den Deckel kleben.

Ein Etikett enthält die volle Adresse des Volkes:

```
https://stockkarte.deine-domain.de/v/v9
```

Das hat einen angenehmen Nebeneffekt: Auch wer die App gerade nicht offen hat und
mit der normalen Kamera-App scannt, landet direkt auf der richtigen Karte.

Der Scanner erkennt außerdem selbst geklebte Codes, die nur die Volksnummer
enthalten, sowie `stockkarte:v9` und `?volk=v9`.

---

## Wo die Daten liegen

Alles in **einer** Datei:

```
data/stockkarte.json      alle Daten, eingerückt und mit jedem Editor lesbar
data/backups/             eine Kopie je Tag, die letzten 30
data/auth.json            Passwort-Hash
data/sessions.json        angemeldete Geräte
```

Geschrieben wird atomar — erst in eine temporäre Datei, dann `fsync`, dann
umbenennen. Ein Stromausfall mitten im Speichern kann die Datei damit nicht
zerreißen. Gleichzeitige Schreibvorgänge laufen nacheinander.

Sicherung: einfach `data/` kopieren, oder in der App unter
*Einstellungen → Sicherung herunterladen*.

Sollte `stockkarte.json` je unlesbar werden, legt der Server sie beiseite
(`.kaputt-<zeit>`) statt sie zu überschreiben, und meldet das beim Start.

---

## Aufbau

```
server/
  server.js     HTTP, API, statische Dateien, Gzip     (nur Node-Bordmittel)
  store.js      Laden und atomares Speichern der JSON-Datei
  ops.js        alle Datenänderungen, mit Prüfung und Dopplungsschutz
  auth.js       Passwort (scrypt) und Sitzungen
  seed.js       Beispieldaten einspielen

public/
  index.html    App-Hülle
  styles.css    Farben und Bausteine aus dem Entwurf
  sw.js         Service Worker für den Offline-Betrieb
  js/
    app.js      Router, Zeichnen, Bedienung
    store.js    lokaler Datenstand, IndexedDB-Warteschlange, Abgleich
    views.js    alle Bildschirme
    scanner.js  Kamera und QR-Erkennung
    qr.js       QR-Erzeugung für die Etiketten
    format.js   Datums- und Zahlenformate
  vendor/       jsQR und qrcode-generator (beide MIT)

deploy/
  stockkarte.service   systemd-Dienst
```

Kein Build-Schritt, kein Bundler. Was im Editor steht, läuft im Browser.

### API

Alles außer `/api/health`, `/api/session` und `/api/login` verlangt eine Anmeldung.

| Endpunkt | Zweck |
|---|---|
| `GET /api/state` | kompletter Datenstand |
| `POST /api/ops` | Änderungen anwenden, gibt den neuen Stand zurück |
| `POST /api/login` / `logout` | Anmeldung |
| `POST /api/passwort` | Passwort ändern |
| `GET /api/export/csv` | alle Kontrollen als CSV (mit BOM für Excel) |
| `GET /api/export/json` | vollständige Sicherung |

---

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `8080` | Port |
| `STOCKKARTE_HOST` | `0.0.0.0` | Adresse; im Dienst auf `127.0.0.1` gesetzt |
| `STOCKKARTE_DATA` | `./data` | Datenverzeichnis |
| `STOCKKARTE_PASSWORT` | — | Passwort beim ersten Start |

---

## Entwicklung

```bash
node server/seed.js --force     # Beispieldaten neu setzen
npm start                       # entspricht: node server/server.js
```

Über `http://localhost:8080` funktioniert auch der Scanner, weil `localhost`
als sicherer Kontext gilt.

Nach Änderungen an Dateien unter `public/` die Zeile `const VERSION` in
`public/sw.js` hochzählen, damit die Geräte den neuen Stand holen.
