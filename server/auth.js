'use strict';
/**
 * Schlichter Passwortschutz mit Session-Cookie.
 *
 * Nötig, weil der Pi über den Cloudflare Tunnel aus dem Internet erreichbar
 * ist. Ein Passwort für die ganze Imkerei reicht — es gibt nur einen Nutzer.
 */
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { DATA_DIR } = require('./store');

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_TAGE = 90;
const SESSION_MS = SESSION_TAGE * 24 * 60 * 60 * 1000;
const COOKIE = 'stockkarte_session';

let sessions = new Map(); // token -> ablaufZeitpunkt (ms)
let authDaten = null;

// ---------- Passwort-Hashing (scrypt) ----------

function hashen(passwort, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passwort, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
}

function zufallsPasswort() {
  // Ohne leicht verwechselbare Zeichen (0/O, 1/l/I)
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function authLaden() {
  if (authDaten) return authDaten;
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    authDaten = JSON.parse(await fsp.readFile(AUTH_FILE, 'utf8'));
    return authDaten;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // Erster Start: Passwort aus der Umgebung übernehmen oder eines würfeln.
  const ausUmgebung = process.env.STOCKKARTE_PASSWORT;
  const passwort = ausUmgebung || zufallsPasswort();
  await passwortSetzen(passwort);

  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  if (ausUmgebung) {
    console.log('  │  Passwort aus STOCKKARTE_PASSWORT gesetzt.   │');
  } else {
    console.log('  │  Neues Passwort für die Stockkarte:          │');
    console.log('  │                                              │');
    console.log('  │      ' + passwort.padEnd(40) + '│');
    console.log('  │                                              │');
    console.log('  │  Bitte notieren — es wird nur einmal        │');
    console.log('  │  angezeigt. Änderbar in den Einstellungen.  │');
  }
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
  return authDaten;
}

async function passwortSetzen(passwort) {
  if (typeof passwort !== 'string' || passwort.length < 4) {
    throw new Error('Das Passwort muss mindestens 4 Zeichen haben.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashen(passwort, salt);
  authDaten = { salt: salt, hash: hash, gesetztAm: new Date().toISOString() };
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(AUTH_FILE, JSON.stringify(authDaten, null, 2), { mode: 0o600 });
  return authDaten;
}

async function passwortPruefen(passwort) {
  const daten = await authLaden();
  if (typeof passwort !== 'string' || !passwort) return false;
  const hash = await hashen(passwort, daten.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(daten.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Sessions ----------

async function sessionsLaden() {
  try {
    const roh = JSON.parse(await fsp.readFile(SESSION_FILE, 'utf8'));
    const jetzt = Date.now();
    sessions = new Map(Object.entries(roh).filter(([, ablauf]) => ablauf > jetzt));
  } catch {
    sessions = new Map();
  }
}

let speicherTimer = null;
function sessionsSpeichernBald() {
  if (speicherTimer) return;
  speicherTimer = setTimeout(async () => {
    speicherTimer = null;
    try {
      await fsp.writeFile(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
    } catch (err) {
      console.warn('[auth] Sessions konnten nicht gespeichert werden:', err.message);
    }
  }, 1000);
  if (speicherTimer.unref) speicherTimer.unref();
}

function sessionAnlegen() {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_MS);
  sessionsSpeichernBald();
  return token;
}

function sessionGueltig(token) {
  if (!token) return false;
  const ablauf = sessions.get(token);
  if (!ablauf) return false;
  if (ablauf < Date.now()) {
    sessions.delete(token);
    sessionsSpeichernBald();
    return false;
  }
  return true;
}

function sessionLoeschen(token) {
  if (token && sessions.delete(token)) sessionsSpeichernBald();
}

function alleSessionsLoeschen() {
  sessions.clear();
  sessionsSpeichernBald();
}

// ---------- Cookie-Hilfen ----------

function cookieLesen(req) {
  const roh = req.headers.cookie;
  if (!roh) return null;
  for (const teil of roh.split(';')) {
    const i = teil.indexOf('=');
    if (i < 0) continue;
    if (teil.slice(0, i).trim() === COOKIE) return decodeURIComponent(teil.slice(i + 1).trim());
  }
  return null;
}

/** Hinter dem Cloudflare Tunnel kommt die TLS-Info nur als Header an. */
function istHttps(req) {
  if (req.socket && req.socket.encrypted) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim() === 'https';
}

function cookieSetzen(req, res, token) {
  const teile = [
    COOKIE + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + Math.floor(SESSION_MS / 1000),
  ];
  if (istHttps(req)) teile.push('Secure');
  res.setHeader('Set-Cookie', teile.join('; '));
}

function cookieLoeschen(req, res) {
  const teile = [COOKIE + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (istHttps(req)) teile.push('Secure');
  res.setHeader('Set-Cookie', teile.join('; '));
}

function istAngemeldet(req) {
  return sessionGueltig(cookieLesen(req));
}

// ---------- Anmeldeversuche bremsen ----------

const versuche = new Map(); // ip -> { anzahl, bis }
const MAX_VERSUCHE = 8;
const SPERRE_MS = 5 * 60 * 1000;

function gesperrt(ip) {
  const e = versuche.get(ip);
  if (!e) return false;
  if (e.bis && e.bis > Date.now()) return true;
  if (e.bis && e.bis <= Date.now()) versuche.delete(ip);
  return false;
}

function versuchGescheitert(ip) {
  const e = versuche.get(ip) || { anzahl: 0, bis: 0 };
  e.anzahl += 1;
  if (e.anzahl >= MAX_VERSUCHE) {
    e.bis = Date.now() + SPERRE_MS;
    e.anzahl = 0;
  }
  versuche.set(ip, e);
}

function versuchErfolgreich(ip) {
  versuche.delete(ip);
}

module.exports = {
  authLaden, passwortSetzen, passwortPruefen,
  sessionsLaden, sessionAnlegen, sessionLoeschen, alleSessionsLoeschen,
  cookieLesen, cookieSetzen, cookieLoeschen, istAngemeldet, istHttps,
  gesperrt, versuchGescheitert, versuchErfolgreich,
  COOKIE,
};
