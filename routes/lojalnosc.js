// routes/lojalnosc.js
// Dodatek „Klub" — system lojalnościowy (feature_key: lojalnosc). Pilot: Boczki.
// Faza 0+1: ledger punktów naliczanych automatycznie z paragonów (hook wołany
// z routes/sprzedaz.js przez makeLojalnosc), kafel w profilu klienta w panelu,
// ręczne akcje punktowe, ustawienia per salon. Pełny plan: design/klub-lojalnosc-plan.md.
//
// Zasady ledgera (wzorzec Zwrotów): wpisy są append-only — żadnych UPDATE/DELETE,
// każda korekta to nowy wpis kompensujący. Saldo = SUM(zmiana).
// Idempotencja: UNIQUE(tenant_id, zrodlo, ref_id) — retry nie zdubluje punktów.
// Tabele Faz 2+ (Konta, Nagrody, Odbiory, Promocje, Zgloszenia, Push) powstaną
// razem z tymi fazami — nie zakładamy schematu na zapas.

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { randomUUID, createHmac } = require('crypto');
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
const { makePublicLimiter } = require('./sessions');
const { makeZapiszLog } = require('./logi');

const FEATURE_KEY = 'lojalnosc';

// ─── Upload grafik (nagrody/promocje/kampanie) ────────────────
// Pliki poza repo (UPLOADS_DIR jak w foto.js), publiczne serwowanie przez
// GET /api/klub/img/... — treść marketingowa salonu, bez danych osobowych.
function uploadsRootLoj() { return process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'); }
const IMG_PLIK_REGEX = /^[a-f0-9-]{36}\.(jpg|png|webp)$/;

function klubImgDir(tenant_id) {
  if (!isValidTenantId(tenant_id)) throw new Error('Nieprawidłowy tenant_id');
  const dir = path.join(uploadsRootLoj(), tenant_id, 'klub');
  const resolved = path.resolve(dir);
  const rootResolved = path.resolve(uploadsRootLoj());
  if (!resolved.startsWith(rootResolved + path.sep)) throw new Error('Path traversal wykryty');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const uploadImg = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Dozwolone tylko obrazy JPEG, PNG lub WebP (max 5 MB).'), ok);
  },
});
const BOCZKI_TENANT = 'boczki-salon-glowny-001';
const MAX_RECZNE = 1000;           // limit pojedynczej ręcznej korekty punktów
const FEATURE_CACHE_TTL_MS = 60 * 1000;
const AKTYWACJA_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // link aktywacyjny: 7 dni
const SESJA_TTL_MS = 90 * 24 * 60 * 60 * 1000;      // sesja klienta w apce: 90 dni
const SESJA_ODSWIEZ_MS = 30 * 24 * 60 * 60 * 1000;  // odśwież token, gdy zostało < 30 dni
const BCRYPT_ROUNDS = 10;
const TENANT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function isValidTenantId(tid) {
  return typeof tid === 'string' && tid.length > 0 && tid.length < 100 && TENANT_ID_REGEX.test(tid);
}

// ─── Stateless HMAC token (wzorzec foto.js/zgody.js) ─────────
// payload.typ: 'akt' (link aktywacyjny z panelu) | 'ses' (sesja klienta w apce)
function clean(v) { return (v || '').replace(/^['"]|['"]$/g, ''); }
function klubSecret() {
  return clean(process.env.LOJALNOSC_SECRET) || clean(process.env.FOTO_SECRET) || clean(process.env.MAGDA_HASLO) || clean(process.env.DB_PASSWORD) || 'klub-fallback';
}
function makeKlubToken(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', klubSecret()).update(b64).digest('hex');
  return `${b64}.${sig}`;
}
function verifyKlubToken(token, typ) {
  if (!token || typeof token !== 'string' || token.length > 2000) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', klubSecret()).update(b64).digest('hex');
  if (sig !== expected) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload || !payload.exp || Date.now() > payload.exp) return null;
  if (!isValidTenantId(payload.t) || !payload.k || payload.typ !== typ) return null;
  return payload;
}

// Telefon do logowania: same cyfry, ostatnie 9 (polski numer bez prefiksu)
function normalizujTelefon(t) {
  return String(t || '').replace(/\D/g, '').slice(-9);
}

// Kod odbioru nagrody: 6 znaków bez mylących (0/O, 1/I/L, Q)
const KOD_ZNAKI = 'ABCDEFGHJKMNPRSTUWXYZ23456789';
function generujKod() {
  let s = '';
  for (let i = 0; i < 6; i++) s += KOD_ZNAKI[Math.floor(Math.random() * KOD_ZNAKI.length)];
  return s;
}

// ─── Web Push (VAPID) — opcjonalny. Brak kluczy w env → push wyłączony,
// reszta Klubu działa normalnie (wzorzec Stripe w features.js).
let webpush = null;
try {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush = require('web-push');
    webpush.setVapidDetails(
      'mailto:' + (clean(process.env.VAPID_CONTACT) || 'kontakt@estelio.com.pl'),
      clean(process.env.VAPID_PUBLIC_KEY),
      clean(process.env.VAPID_PRIVATE_KEY)
    );
  }
} catch (e) {
  console.warn('[lojalnosc] web-push niedostępny:', e.message);
  webpush = null;
}
function vapidPublic() { return webpush ? clean(process.env.VAPID_PUBLIC_KEY) : ''; }

// ─── Segmenty kampanii/promocji ───────────────────────────────
// WSZYSCY | PUNKTY_MIN (saldo >= wartość) | ZABIEG (zabieg/typ w ostatnich N dniach)
// | BRAK_WIZYTY (żadnej sprzedaży od N dni — odzyskiwanie klientek)
const SEGMENT_TYPY = new Set(['WSZYSCY', 'PUNKTY_MIN', 'ZABIEG', 'BRAK_WIZYTY']);

function normalizujSegment(d) {
  const typ = String(d.segment_typ || 'WSZYSCY').toUpperCase().trim();
  if (!SEGMENT_TYPY.has(typ)) return null;
  const wartosc = String(d.segment_wartosc || '').trim().slice(0, 160);
  const dni = parseInt(d.segment_dni, 10);
  if (typ === 'PUNKTY_MIN' && !(parseInt(wartosc, 10) >= 1)) return null;
  if (typ === 'ZABIEG' && !wartosc) return null;
  const dniOk = Number.isFinite(dni) && dni >= 1 && dni <= 730 ? dni : 90;
  return { typ, wartosc, dni: (typ === 'ZABIEG' || typ === 'BRAK_WIZYTY') ? dniOk : null };
}

// Ocena segmentu po stronie JS — dla /klub/me (fakty klienta pobrane raz).
// fakty: { saldo, sprzedaze: [{zabieg, typ_zabiegu, data}], teraz: Date }
function pasujeSegment(seg, fakty) {
  const typ = String((seg && seg.segment_typ) || 'WSZYSCY').toUpperCase();
  if (typ === 'WSZYSCY') return true;
  const teraz = (fakty && fakty.teraz) || new Date();
  if (typ === 'PUNKTY_MIN') {
    return (Number(fakty && fakty.saldo) || 0) >= (parseInt(seg.segment_wartosc, 10) || 0);
  }
  const dni = parseInt(seg.segment_dni, 10) || 90;
  const cutoff = teraz.getTime() - dni * 24 * 60 * 60 * 1000;
  const sprzedaze = (fakty && fakty.sprzedaze) || [];
  if (typ === 'ZABIEG') {
    const szukane = String(seg.segment_wartosc || '').toLowerCase().trim();
    if (!szukane) return false;
    return sprzedaze.some(s => {
      const kiedy = new Date(s.data).getTime();
      if (!(kiedy >= cutoff)) return false;
      return String(s.typ_zabiegu || '').toLowerCase().trim() === szukane
        || String(s.zabieg || '').toLowerCase().includes(szukane);
    });
  }
  if (typ === 'BRAK_WIZYTY') {
    return !sprzedaze.some(s => new Date(s.data).getTime() >= cutoff);
  }
  return false;
}

// Zdjęcie: pełny URL albo ścieżka z naszego uploadu
function imgUrlOk(u) {
  return !u || /^https?:\/\//.test(u) || /^\/api\/klub\/img\//.test(u);
}

function opisSegmentu(seg) {
  const typ = String((seg && seg.segment_typ) || 'WSZYSCY').toUpperCase();
  if (typ === 'PUNKTY_MIN') return `saldo >= ${seg.segment_wartosc} pkt`;
  if (typ === 'ZABIEG') return `po zabiegu "${seg.segment_wartosc}" (${seg.segment_dni || 90} dni)`;
  if (typ === 'BRAK_WIZYTY') return `bez wizyty od ${seg.segment_dni || 90} dni`;
  return 'wszyscy klienci';
}

// Cache flagi feature per tenant — hook odpala się przy KAŻDEJ sprzedaży,
// nie chcemy dodatkowego SELECT-a na każdy paragon salonu bez Klubu.
const featureCache = new Map(); // tenant_id → { t, on }
function wyczyscCacheLoj() { featureCache.clear(); }

// Punkty za kwotę: floor(kwota_w_groszach * pkt_za_10zl / 1000) → 10 zł = pkt_za_10zl pkt.
// Liczone w groszach, żeby uniknąć błędów float (95.10 zł itp.).
function obliczPunkty(kwota, pktZa10) {
  const grosze = Math.round((parseFloat(kwota) || 0) * 100);
  const mnoznik = parseInt(pktZa10, 10) || 0;
  if (grosze <= 0 || mnoznik <= 0) return 0;
  return Math.floor((grosze * mnoznik) / 1000);
}

// ─────────────────────────────────────────────────────────────
// makeLojalnosc(db) — hook dla routes/sprzedaz.js.
// KONTRAKT: żadna z tych funkcji NIGDY nie rzuca i niczego nie zwraca —
// błąd naliczenia punktów nie może zablokować ani opóźnić sprzedaży.
// Wołać przez setImmediate(...) PO wysłaniu odpowiedzi.
// ─────────────────────────────────────────────────────────────
function makeLojalnosc(db) {
  const zapiszLog = makeZapiszLog(db);

  function maFeature(tenant_id, cb) {
    const c = featureCache.get(tenant_id);
    if (c && Date.now() - c.t < FEATURE_CACHE_TTL_MS) return cb(c.on);
    db.query(
      `SELECT feature_key FROM Tenant_Features WHERE tenant_id = ? AND feature_key = ? AND enabled = 1 LIMIT 1`,
      [tenant_id, FEATURE_KEY],
      (err, rows) => {
        const on = !err && Array.isArray(rows) && rows.length > 0;
        featureCache.set(tenant_id, { t: Date.now(), on });
        cb(on);
      }
    );
  }

  function pobierzMnoznik(tenant_id, cb) {
    db.query(
      `SELECT pkt_za_10zl FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`,
      [tenant_id],
      (err, rows) => {
        if (err || !Array.isArray(rows) || !rows.length) return cb(1); // default: 10 zł = 1 pkt
        cb(parseInt(rows[0].pkt_za_10zl, 10) || 0);
      }
    );
  }

  function wpis(tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik) {
    const z = Math.trunc(Number(zmiana) || 0);
    if (!z) return;
    db.query(
      `INSERT INTO Lojalnosc_Punkty (tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tenant_id, String(id_klienta), z, String(powod || '').slice(0, 250), zrodlo, String(ref_id).slice(0, 80), String(pracownik || '').slice(0, 120)],
      (err) => {
        // ER_DUP_ENTRY = idempotencja zadziałała (retry) — to nie jest błąd
        if (err && err.code !== 'ER_DUP_ENTRY') console.error('[lojalnosc] wpis ledger:', err.message);
      }
    );
  }

  // Sprzedaż z id_klienta → +punkty. ref_id = id wiersza Sprzedaz.
  function naliczZaSprzedaz(tenant_id, dane) {
    try {
      const idK = String((dane && dane.id_klienta) || '').trim();
      const saleId = String((dane && dane.saleId) || '').trim();
      if (!tenant_id || !idK || !saleId) return;
      if (!((parseFloat(dane.kwota) || 0) > 0)) return;
      maFeature(tenant_id, (on) => {
        if (!on) return;
        pobierzMnoznik(tenant_id, (mnoznik) => {
          const pkt = obliczPunkty(dane.kwota, mnoznik);
          if (pkt <= 0) return;
          wpis(tenant_id, idK, pkt, dane.opis || 'Sprzedaż', 'SPRZEDAZ', saleId, dane.pracownik);
        });
      });
    } catch (e) { console.error('[lojalnosc] naliczZaSprzedaz:', e.message); }
  }

  // Zwrot → -punkty, proporcjonalnie do kwoty zwrotu, z sufitem: nigdy nie
  // zabieramy więcej niż naliczono za oryginał (minus wcześniejsze zwroty).
  // Sprzedaż sprzed startu Klubu (brak wpisu SPRZEDAZ) → brak kompensacji.
  function naliczZaZwrot(tenant_id, dane) {
    try {
      const saleId = String((dane && dane.saleId) || '').trim();
      const zwrotId = String((dane && dane.zwrotId) || '').trim();
      const idK = String((dane && dane.id_klienta) || '').trim();
      if (!tenant_id || !saleId || !zwrotId || !idK) return;
      maFeature(tenant_id, (on) => {
        if (!on) return;
        db.query(
          `SELECT zrodlo, zmiana, ref_id FROM Lojalnosc_Punkty
            WHERE tenant_id = ? AND ((zrodlo = 'SPRZEDAZ' AND ref_id = ?)
                                     OR (zrodlo = 'ZWROT' AND ref_id LIKE CONCAT('%@', ?)))`,
          [tenant_id, saleId, saleId],
          (err, rows) => {
            if (err || !Array.isArray(rows)) return;
            const zaSprzedaz = rows.filter(r => r.zrodlo === 'SPRZEDAZ').reduce((s, r) => s + (Number(r.zmiana) || 0), 0);
            if (zaSprzedaz <= 0) return; // oryginał bez punktów → zwrot też bez
            // Wcześniejsze zwroty do TEJ sprzedaży: ref_id = '<zwrotId>@<saleId>'
            const juzOddane = rows
              .filter(r => r.zrodlo === 'ZWROT' && String(r.ref_id).endsWith('@' + saleId))
              .reduce((s, r) => s + Math.abs(Number(r.zmiana) || 0), 0);
            pobierzMnoznik(tenant_id, (mnoznik) => {
              const zKwoty = obliczPunkty(dane.kwotaZwrotu, mnoznik);
              const doOdjecia = Math.min(zKwoty, Math.max(0, zaSprzedaz - juzOddane));
              if (doOdjecia <= 0) return;
              wpis(tenant_id, idK, -doOdjecia, dane.opis || 'Zwrot', 'ZWROT', zwrotId + '@' + saleId, dane.pracownik);
            });
          }
        );
      });
    } catch (e) { console.error('[lojalnosc] naliczZaZwrot:', e.message); }
  }

  // Soft-delete sprzedaży → cofnij WSZYSTKO co naliczono dla tego wiersza
  // (dodatnie za sprzedaż + ewentualne wcześniejsze korekty edycji), a przy
  // usunięciu wiersza-zwrotu — oddaj punkty zabrane tym zwrotem.
  function kompensujUsuniecie(tenant_id, saleId, pracownik) {
    try {
      const sid = String(saleId || '').trim();
      if (!tenant_id || !sid) return;
      maFeature(tenant_id, (on) => {
        if (!on) return;
        db.query(
          `SELECT id_klienta, SUM(zmiana) AS suma FROM Lojalnosc_Punkty
            WHERE tenant_id = ?
              AND ((zrodlo = 'SPRZEDAZ' AND ref_id = ?)
                   OR (zrodlo = 'EDYCJA' AND ref_id LIKE CONCAT('E@', ?, '@%'))
                   OR (zrodlo = 'ZWROT'  AND ref_id LIKE CONCAT(?, '@%')))
            GROUP BY id_klienta`,
          [tenant_id, sid, sid, sid],
          (err, rows) => {
            if (err || !Array.isArray(rows) || !rows.length) return;
            rows.forEach(r => {
              const suma = Number(r.suma) || 0;
              if (!suma) return;
              wpis(tenant_id, r.id_klienta, -suma, 'Usunięcie transakcji ' + sid, 'USUNIECIE', 'DEL@' + sid, pracownik);
            });
          }
        );
      });
    } catch (e) { console.error('[lojalnosc] kompensujUsuniecie:', e.message); }
  }

  // Edycja kwoty sprzedaży → dociągnij punkty do stanu zgodnego z nową kwotą.
  // Tylko gdy oryginał w ogóle był punktowany (sprzedaż po starcie Klubu).
  function skorygujEdycje(tenant_id, saleId, nowaKwota, pracownik) {
    try {
      const sid = String(saleId || '').trim();
      if (!tenant_id || !sid) return;
      maFeature(tenant_id, (on) => {
        if (!on) return;
        db.query(
          `SELECT id_klienta, zrodlo, zmiana FROM Lojalnosc_Punkty
            WHERE tenant_id = ?
              AND ((zrodlo = 'SPRZEDAZ' AND ref_id = ?)
                   OR (zrodlo = 'EDYCJA' AND ref_id LIKE CONCAT('E@', ?, '@%')))`,
          [tenant_id, sid, sid],
          (err, rows) => {
            if (err || !Array.isArray(rows) || !rows.length) return;
            if (!rows.some(r => r.zrodlo === 'SPRZEDAZ')) return;
            const idK = rows[0].id_klienta;
            const obecnie = rows.reduce((s, r) => s + (Number(r.zmiana) || 0), 0);
            pobierzMnoznik(tenant_id, (mnoznik) => {
              const cel = obliczPunkty(nowaKwota, mnoznik);
              const delta = cel - obecnie;
              if (!delta) return;
              wpis(tenant_id, idK, delta, 'Korekta po edycji transakcji ' + sid, 'EDYCJA', 'E@' + sid + '@' + Date.now(), pracownik);
            });
          }
        );
      });
    } catch (e) { console.error('[lojalnosc] skorygujEdycje:', e.message); }
  }

  return { naliczZaSprzedaz, naliczZaZwrot, kompensujUsuniecie, skorygujEdycje };
}

// ─────────────────────────────────────────────────────────────
// Router panelu (akcje loj_* — dispatcher w server.js)
// ─────────────────────────────────────────────────────────────
module.exports = (db) => {
  const router = express.Router();
  const zapiszLog = makeZapiszLog(db);
  const hook = makeLojalnosc(db);
  // Limity na publiczne endpointy apki klienta (bez sesji panelu — HMAC only)
  const loginLimiter = makePublicLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: 'Za dużo prób logowania. Spróbuj za 15 minut.' });
  const klubLimiter = makePublicLimiter({ windowMs: 15 * 60 * 1000, max: 120, message: 'Za dużo żądań. Spróbuj za chwilę.' });

  function q(sql, params) {
    return new Promise((res, rej) => db.query(sql, params, (e, r) => e ? rej(e) : res(r)));
  }

  // Klient nadaje się do Klubu: nie usunięty, nie zanonimizowany, nie zmarły
  function klientAktywny(k) {
    const st = String((k && k.status) || '').toUpperCase().trim();
    return !!k && st !== 'USUNIETY' && st !== 'ZANONIMIZOWANY' && !Number(k.zmarly);
  }

  // ─── Migracje + seedy (idempotentne, przy starcie) ───
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Punkty (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      id_klienta VARCHAR(64) NOT NULL,
      zmiana INT NOT NULL,
      powod VARCHAR(255) DEFAULT '',
      zrodlo VARCHAR(20) NOT NULL,
      ref_id VARCHAR(80) NOT NULL,
      pracownik VARCHAR(120) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_ref (tenant_id, zrodlo, ref_id),
      KEY idx_klient (tenant_id, id_klienta)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Punkty:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Ustawienia (
      tenant_id VARCHAR(64) NOT NULL PRIMARY KEY,
      pkt_za_10zl INT NOT NULL DEFAULT 1,
      nazwa_klubu VARCHAR(120) DEFAULT 'Klub',
      updated_by VARCHAR(120) DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Ustawienia:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Konta (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      id_klienta VARCHAR(64) NOT NULL,
      telefon VARCHAR(20) DEFAULT '',
      pin_hash VARCHAR(100) NOT NULL,
      status VARCHAR(20) DEFAULT 'AKTYWNE',
      zgoda_regulamin_at DATETIME NULL,
      ostatnie_logowanie DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_konto (tenant_id, id_klienta),
      KEY idx_telefon (telefon)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Konta:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Nagrody (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      nazwa VARCHAR(160) NOT NULL,
      opis VARCHAR(500) DEFAULT '',
      koszt_pkt INT NOT NULL,
      ilosc INT NULL,
      img_url VARCHAR(500) DEFAULT '',
      status VARCHAR(20) DEFAULT 'AKTYWNA',
      sortowanie INT DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_tenant (tenant_id, status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Nagrody:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Odbiory (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      id_klienta VARCHAR(64) NOT NULL,
      nagroda_id INT NOT NULL,
      nagroda_nazwa VARCHAR(160) DEFAULT '',
      koszt_pkt INT NOT NULL,
      kod CHAR(6) NOT NULL,
      status VARCHAR(20) DEFAULT 'OCZEKUJE',
      wydal VARCHAR(120) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      rozstrzygnieto_at DATETIME NULL,
      KEY idx_tenant_status (tenant_id, status),
      KEY idx_klient (tenant_id, id_klienta),
      KEY idx_kod (tenant_id, kod)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Odbiory:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Promocje (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      tytul VARCHAR(200) NOT NULL,
      opis VARCHAR(300) DEFAULT '',
      tresc TEXT,
      img_url VARCHAR(500) DEFAULT '',
      data_od DATE NULL,
      data_do DATE NULL,
      promocja_dnia TINYINT DEFAULT 0,
      status VARCHAR(20) DEFAULT 'AKTYWNA',
      sortowanie INT DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_tenant (tenant_id, status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Promocje:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Zgloszenia (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      id_klienta VARCHAR(64) NOT NULL,
      promocja_id INT NOT NULL,
      promocja_tytul VARCHAR(200) DEFAULT '',
      status VARCHAR(20) DEFAULT 'NOWE',
      obsluzyl VARCHAR(120) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      obsluzono_at DATETIME NULL,
      KEY idx_tenant_status (tenant_id, status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Zgloszenia:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Push (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      id_klienta VARCHAR(64) NOT NULL,
      endpoint VARCHAR(500) NOT NULL,
      p256dh VARCHAR(255) NOT NULL,
      auth VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_tenant (tenant_id),
      KEY idx_klient (tenant_id, id_klienta)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Push:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Kampanie (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      tytul VARCHAR(100) NOT NULL,
      tresc VARCHAR(300) NOT NULL,
      segment_typ VARCHAR(20) DEFAULT 'WSZYSCY',
      segment_wartosc VARCHAR(160) DEFAULT '',
      segment_dni INT NULL,
      wyslij_at DATETIME NOT NULL,
      status VARCHAR(20) DEFAULT 'PLANOWANA',
      wyslano_at DATETIME NULL,
      odbiorcow INT DEFAULT 0,
      dostarczono INT DEFAULT 0,
      utworzyl VARCHAR(120) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_tenant_status (tenant_id, status),
      KEY idx_due (status, wyslij_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Kampanie:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Wnioski (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      telefon VARCHAR(20) NOT NULL,
      imie VARCHAR(120) DEFAULT '',
      id_klienta VARCHAR(64) DEFAULT '',
      status VARCHAR(20) DEFAULT 'NOWY',
      obsluzyl VARCHAR(120) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      obsluzono_at DATETIME NULL,
      KEY idx_tenant_status (tenant_id, status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Wnioski:', e.message);
  });
  // Targetowanie promocji + auto-push + zdjęcie kampanii + bonus powitalny (ALTER-y idempotentne)
  [
    `ALTER TABLE Lojalnosc_Promocje ADD COLUMN segment_typ VARCHAR(20) DEFAULT 'WSZYSCY'`,
    `ALTER TABLE Lojalnosc_Promocje ADD COLUMN segment_wartosc VARCHAR(160) DEFAULT ''`,
    `ALTER TABLE Lojalnosc_Promocje ADD COLUMN segment_dni INT NULL`,
    `ALTER TABLE Lojalnosc_Promocje ADD COLUMN push_przy_starcie TINYINT DEFAULT 0`,
    `ALTER TABLE Lojalnosc_Promocje ADD COLUMN push_wyslany TINYINT DEFAULT 0`,
    `ALTER TABLE Lojalnosc_Kampanie ADD COLUMN img_url VARCHAR(500) DEFAULT ''`,
    `ALTER TABLE Lojalnosc_Ustawienia ADD COLUMN bonus_powitalny_pkt INT DEFAULT 0`,
    `ALTER TABLE Lojalnosc_Wnioski ADD COLUMN typ VARCHAR(20) DEFAULT 'KONTO'`,
  ].forEach(sql => db.query(sql, (e) => {
    if (e && e.code !== 'ER_DUP_FIELDNAME') console.error('[lojalnosc] ALTER:', e.message);
  }));
  // status UKRYTY — inne salony nie widzą dodatku (pilot u Boczków), jak platnosc_link
  db.query(`INSERT INTO Features_Catalog (feature_key, nazwa, opis, miesieczna_cena_grosze, status, sortowanie)
      VALUES (?, ?, ?, 0, 'UKRYTY', 12)
      ON DUPLICATE KEY UPDATE feature_key = feature_key`,
    [FEATURE_KEY, '💎 Klub — program lojalnościowy',
     'Punkty naliczają się automatycznie z paragonów. Klient zbiera punkty za wydane złotówki, salon nagradza stałych klientów. W kolejnych etapach: aplikacja klienta z katalogiem nagród i promocjami.'],
    (e) => { if (e) console.error('[lojalnosc] Seed katalogu:', e.message); });
  db.query(`INSERT INTO Tenant_Features (tenant_id, feature_key, enabled, monthly_price_grosze, activated_at, activated_by)
      VALUES (?, ?, 1, 0, NOW(), 'pilot — salon Boczki')
      ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [BOCZKI_TENANT, FEATURE_KEY],
    (e) => { if (e) console.error('[lojalnosc] Seed pilot Boczki:', e.message); });

  function maFeatureLubBlad(tenant_id, res, next) {
    const c = featureCache.get(tenant_id);
    if (c && Date.now() - c.t < FEATURE_CACHE_TTL_MS) {
      if (!c.on) return res.json({ status: 'error', message: 'Dodatek „Klub" nie jest aktywny.' });
      return next();
    }
    db.query(
      `SELECT feature_key FROM Tenant_Features WHERE tenant_id = ? AND feature_key = ? AND enabled = 1 LIMIT 1`,
      [tenant_id, FEATURE_KEY],
      (err, rows) => {
        const on = !err && Array.isArray(rows) && rows.length > 0;
        featureCache.set(tenant_id, { t: Date.now(), on });
        if (!on) return res.json({ status: 'error', message: 'Dodatek „Klub" nie jest aktywny.' });
        next();
      }
    );
  }

  // RBAC: rola pracownika po imieniu (wzorzec features.js)
  function pobierzRole(tenant_id, imie, callback) {
    if (!imie) return callback(null);
    db.query(
      `SELECT rola FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`,
      [tenant_id, imie],
      (err, rows) => {
        if (err || !Array.isArray(rows) || !rows.length) return callback(null);
        callback(String(rows[0].rola || '').toLowerCase().trim());
      }
    );
  }
  // Pilot: cały Klub w panelu widoczny/obsługiwany TYLKO przez admina (decyzja usera 2026-07-10)
  const ROLE_ADMIN = new Set(['admin', 'megaadmin']);
  function wymagajAdmina(tenant_id, kto, res, next) {
    pobierzRole(tenant_id, kto, (rola) => {
      if (!rola || !ROLE_ADMIN.has(rola)) {
        return res.json({ status: 'error', message: 'Brak uprawnień. Klub w pilocie obsługuje tylko admin.' });
      }
      next();
    });
  }

  // ─── Kampanie: segmenty po stronie SQL (do wysyłki) ─────────
  // Zwraca listę id_klienta pasujących do segmentu, albo null = wszyscy.
  async function segmentIds(tenant_id, seg) {
    const typ = String((seg && seg.segment_typ) || 'WSZYSCY').toUpperCase();
    if (typ === 'WSZYSCY') return null;
    if (typ === 'PUNKTY_MIN') {
      const prog = parseInt(seg.segment_wartosc, 10) || 0;
      const rows = await q(
        `SELECT id_klienta FROM Lojalnosc_Punkty WHERE tenant_id = ? GROUP BY id_klienta HAVING SUM(zmiana) >= ?`,
        [tenant_id, prog]
      );
      return (Array.isArray(rows) ? rows : []).map(r => String(r.id_klienta));
    }
    const dni = parseInt(seg.segment_dni, 10) || 90;
    if (typ === 'ZABIEG') {
      const w = String(seg.segment_wartosc || '').trim();
      const rows = await q(
        `SELECT DISTINCT id_klienta FROM Sprzedaz
          WHERE tenant_id = ? AND COALESCE(status,'') != 'USUNIĘTY' AND kwota > 0 AND COALESCE(id_klienta,'') != ''
            AND data_sprzedazy >= DATE_SUB(NOW(), INTERVAL ? DAY)
            AND (LOWER(COALESCE(typ_zabiegu,'')) = LOWER(?) OR zabieg LIKE CONCAT('%', ?, '%'))`,
        [tenant_id, dni, w, w]
      );
      return (Array.isArray(rows) ? rows : []).map(r => String(r.id_klienta));
    }
    if (typ === 'BRAK_WIZYTY') {
      // Tylko klienci z kontem Klubu (do nich w ogóle możemy dotrzeć)
      const rows = await q(
        `SELECT K.id_klienta FROM Lojalnosc_Konta K
          WHERE K.tenant_id = ? AND K.status = 'AKTYWNE'
            AND NOT EXISTS (
              SELECT 1 FROM Sprzedaz S
               WHERE S.tenant_id = K.tenant_id AND S.id_klienta = K.id_klienta
                 AND COALESCE(S.status,'') != 'USUNIĘTY' AND S.kwota > 0
                 AND S.data_sprzedazy >= DATE_SUB(NOW(), INTERVAL ? DAY))`,
        [tenant_id, dni]
      );
      return (Array.isArray(rows) ? rows : []).map(r => String(r.id_klienta));
    }
    return [];
  }

  // Wysyłka push do klientów (idKlienci=null → wszyscy subskrybenci salonu).
  // Bez kluczy VAPID zwraca 0/0 — kampania i tak dociera skrzynką w apce.
  async function wyslijPushDoKlientow(tenant_id, idKlienci, tytul, tresc, img) {
    const subs = await q(
      `SELECT id, id_klienta, endpoint, p256dh, auth FROM Lojalnosc_Push WHERE tenant_id = ?`,
      [tenant_id]
    ).catch(() => []);
    const cel = (Array.isArray(subs) ? subs : []).filter(s =>
      idKlienci === null || idKlienci.includes(String(s.id_klienta)));
    if (!webpush || !cel.length) return { dostarczono: 0, subskrypcji: cel.length };
    const payload = JSON.stringify({ title: tytul, body: tresc, url: '/klub.html', image: img || '' });
    let ok = 0;
    await Promise.all(cel.map(s =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        .then(() => { ok++; })
        .catch(e2 => {
          if (e2 && (e2.statusCode === 404 || e2.statusCode === 410)) {
            db.query(`DELETE FROM Lojalnosc_Push WHERE id = ?`, [s.id], () => {});
          }
        })
    ));
    return { dostarczono: ok, subskrypcji: cel.length };
  }

  // Wykonanie kampanii (już ZACLAIMOWANEJ — status WYSYLANIE).
  async function wykonajKampanie(k) {
    try {
      const ids = await segmentIds(k.tenant_id, k);
      const odbiorcow = ids === null ? -1 : ids.length; // -1 = wszyscy (liczbę pokaże liczba subskrypcji)
      const wynik = await wyslijPushDoKlientow(k.tenant_id, ids, k.tytul, k.tresc, k.img_url || '');
      await q(
        `UPDATE Lojalnosc_Kampanie SET status = 'WYSLANA', wyslano_at = NOW(), odbiorcow = ?, dostarczono = ? WHERE id = ?`,
        [odbiorcow === -1 ? wynik.subskrypcji : odbiorcow, wynik.dostarczono, k.id]
      );
      zapiszLog(k.tenant_id, 'KLUB KAMPANIA', k.utworzyl || 'System',
        `„${k.tytul}" [${opisSegmentu({ segment_typ: k.segment_typ, segment_wartosc: k.segment_wartosc, segment_dni: k.segment_dni })}] — push ${wynik.dostarczono}/${wynik.subskrypcji}, widoczna w apce 30 dni`);
      return wynik;
    } catch (e) {
      console.error('[lojalnosc] wykonajKampanie:', e.message);
      await q(`UPDATE Lojalnosc_Kampanie SET status = 'BLAD' WHERE id = ?`, [k.id]).catch(() => {});
      return { dostarczono: 0, subskrypcji: 0 };
    }
  }

  // ─── Scheduler (co 60 s): zaplanowane kampanie + auto-push promocji w dniu startu.
  // Baza jest WSPÓLNA dla dev i prod (dwie instancje Node!) — dlatego każdą robotę
  // najpierw atomowo claimujemy UPDATE-em; wygrywa jedna instancja.
  async function tickHarmonogramu() {
    try {
      const due = await q(
        `SELECT * FROM Lojalnosc_Kampanie WHERE status = 'PLANOWANA' AND wyslij_at <= NOW() LIMIT 20`, []
      ).catch(() => []);
      for (const k of (Array.isArray(due) ? due : [])) {
        const r = await q(
          `UPDATE Lojalnosc_Kampanie SET status = 'WYSYLANIE' WHERE id = ? AND status = 'PLANOWANA'`, [k.id]
        ).catch(() => null);
        if (r && r.affectedRows) await wykonajKampanie(k);
      }
      const promocje = await q(
        `SELECT id, tenant_id, tytul, opis, segment_typ, segment_wartosc, segment_dni FROM Lojalnosc_Promocje
          WHERE push_przy_starcie = 1 AND push_wyslany = 0 AND status = 'AKTYWNA'
            AND (data_od IS NULL OR data_od <= CURDATE()) LIMIT 20`, []
      ).catch(() => []);
      for (const p of (Array.isArray(promocje) ? promocje : [])) {
        const r = await q(
          `UPDATE Lojalnosc_Promocje SET push_wyslany = 1 WHERE id = ? AND push_wyslany = 0`, [p.id]
        ).catch(() => null);
        if (!r || !r.affectedRows) continue;
        const ids = await segmentIds(p.tenant_id, p).catch(() => []);
        const wynik = await wyslijPushDoKlientow(p.tenant_id, ids, '🔥 ' + p.tytul, p.opis || 'Sprawdź szczegóły w aplikacji!');
        zapiszLog(p.tenant_id, 'KLUB PUSH PROMOCJI', 'System', `Auto-push startu „${p.tytul}" — ${wynik.dostarczono}/${wynik.subskrypcji}`);
      }
    } catch (e) { console.error('[lojalnosc] tickHarmonogramu:', e.message); }
  }
  // W testach (jest) NIE startujemy pętli — trzymałaby proces przy życiu.
  if (!process.env.JEST_WORKER_ID && process.env.NODE_ENV !== 'test') {
    const timer = setInterval(tickHarmonogramu, 60 * 1000);
    if (timer.unref) timer.unref();
    const pierwszy = setTimeout(tickHarmonogramu, 5000); // pierwszy przebieg ~5 s po starcie
    if (pierwszy.unref) pierwszy.unref();
  }

  // ─── GET /lojalnosc ───
  router.get('/lojalnosc', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'loj_klient') {
      // Saldo + ostatnie wpisy dla kafla w profilu klienta
      const idK = String(req.query.id_klienta || '').trim();
      if (!idK) return res.json({ status: 'error', message: 'Brak id_klienta' });
      maFeatureLubBlad(tenant_id, res, () => {
        db.query(
          `SELECT COALESCE(SUM(zmiana), 0) AS saldo FROM Lojalnosc_Punkty WHERE tenant_id = ? AND id_klienta = ?`,
          [tenant_id, idK],
          (err, sRows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            db.query(
              `SELECT zmiana, powod, zrodlo, pracownik, created_at FROM Lojalnosc_Punkty
                WHERE tenant_id = ? AND id_klienta = ? ORDER BY id DESC LIMIT 20`,
              [tenant_id, idK],
              (err2, wRows) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                db.query(
                  `SELECT pkt_za_10zl, nazwa_klubu FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`,
                  [tenant_id],
                  (err3, uRows) => {
                    const ust = (!err3 && Array.isArray(uRows) && uRows[0]) ? uRows[0] : {};
                    return res.json({
                      status: 'success',
                      saldo: Number((sRows[0] || {}).saldo) || 0,
                      wpisy: (Array.isArray(wRows) ? wRows : []).map(w => ({
                        zmiana: Number(w.zmiana) || 0,
                        powod: w.powod || '',
                        zrodlo: w.zrodlo || '',
                        pracownik: w.pracownik || '',
                        data: w.created_at
                      })),
                      ustawienia: {
                        pkt_za_10zl: parseInt(ust.pkt_za_10zl, 10) || 1,
                        nazwa_klubu: ust.nazwa_klubu || 'Klub'
                      }
                    });
                  }
                );
              }
            );
          }
        );
      });

    } else if (action === 'loj_ustawienia') {
      db.query(
        `SELECT pkt_za_10zl, nazwa_klubu, bonus_powitalny_pkt, updated_by, updated_at FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          const u = (Array.isArray(rows) && rows[0]) || {};
          return res.json({
            status: 'success',
            ustawienia: {
              pkt_za_10zl: parseInt(u.pkt_za_10zl, 10) || 1,
              nazwa_klubu: u.nazwa_klubu || 'Klub',
              bonus_powitalny_pkt: parseInt(u.bonus_powitalny_pkt, 10) || 0
            }
          });
        }
      );

    } else if (action === 'loj_wnioski') {
      // Wnioski o konto z rejestracji online (istniejące klientki)
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT W.id, W.telefon, W.imie, W.id_klienta, W.typ, W.status, W.created_at, W.obsluzyl, W.obsluzono_at,
                  K.imie_nazwisko AS klient_kartoteka, K.telefon AS telefon_kartoteka
             FROM Lojalnosc_Wnioski W
             LEFT JOIN Klienci K ON K.tenant_id = W.tenant_id AND K.id_klienta = W.id_klienta
            WHERE W.tenant_id = ?
            ORDER BY (W.status = 'NOWY') DESC, W.id DESC LIMIT 100`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', wnioski: Array.isArray(rows) ? rows : [] });
          }
        );
      });

    } else if (action === 'loj_nagrody_admin') {
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT N.id, N.nazwa, N.opis, N.koszt_pkt, N.ilosc, N.img_url, N.status, N.sortowanie,
                  (SELECT COUNT(*) FROM Lojalnosc_Odbiory O WHERE O.tenant_id = N.tenant_id AND O.nagroda_id = N.id AND O.status = 'WYDANE') AS wydane,
                  (SELECT COUNT(*) FROM Lojalnosc_Odbiory O WHERE O.tenant_id = N.tenant_id AND O.nagroda_id = N.id AND O.status = 'OCZEKUJE') AS oczekuje
             FROM Lojalnosc_Nagrody N WHERE tenant_id = ? AND status != 'ARCHIWUM'
            ORDER BY sortowanie ASC, id DESC`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', nagrody: Array.isArray(rows) ? rows : [] });
          }
        );
      });

    } else if (action === 'loj_promocje_admin') {
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT id, tytul, opis, tresc, img_url, data_od, data_do, promocja_dnia, status, sortowanie
             FROM Lojalnosc_Promocje WHERE tenant_id = ? AND status != 'ARCHIWUM'
            ORDER BY sortowanie ASC, id DESC`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', promocje: Array.isArray(rows) ? rows : [] });
          }
        );
      });

    } else if (action === 'loj_odbiory') {
      // Oczekujące odbiory + ostatnio rozstrzygnięte, z nazwiskiem klienta
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT O.id, O.id_klienta, O.nagroda_nazwa, O.koszt_pkt, O.kod, O.status, O.created_at, O.rozstrzygnieto_at, O.wydal,
                  K.imie_nazwisko AS klient
             FROM Lojalnosc_Odbiory O
             LEFT JOIN Klienci K ON K.tenant_id = O.tenant_id AND K.id_klienta = O.id_klienta
            WHERE O.tenant_id = ?
            ORDER BY (O.status = 'OCZEKUJE') DESC, O.id DESC LIMIT 100`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', odbiory: Array.isArray(rows) ? rows : [] });
          }
        );
      });

    } else if (action === 'loj_zgloszenia') {
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT Z.id, Z.id_klienta, Z.promocja_tytul, Z.status, Z.created_at, Z.obsluzono_at, Z.obsluzyl,
                  K.imie_nazwisko AS klient, K.telefon
             FROM Lojalnosc_Zgloszenia Z
             LEFT JOIN Klienci K ON K.tenant_id = Z.tenant_id AND K.id_klienta = Z.id_klienta
            WHERE Z.tenant_id = ?
            ORDER BY (Z.status = 'NOWE') DESC, Z.id DESC LIMIT 100`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', zgloszenia: Array.isArray(rows) ? rows : [] });
          }
        );
      });

    } else if (action === 'loj_statystyki') {
      // Statystyki miesiąca: punkty przyznane/odjęte, konta, top klienci, wydane nagrody
      const kto = String(req.query.user_log || '').trim();
      const rok = parseInt(req.query.rok, 10) || new Date().getFullYear();
      const miesiac = parseInt(req.query.miesiac, 10) || (new Date().getMonth() + 1);
      wymagajAdmina(tenant_id, kto, res, async () => {
        try {
          const mies = await q(
            `SELECT COALESCE(SUM(CASE WHEN zmiana > 0 THEN zmiana ELSE 0 END), 0) AS przyznane,
                    COALESCE(SUM(CASE WHEN zmiana < 0 THEN -zmiana ELSE 0 END), 0) AS odjete,
                    COUNT(DISTINCT id_klienta) AS klienci
               FROM Lojalnosc_Punkty WHERE tenant_id = ? AND YEAR(created_at) = ? AND MONTH(created_at) = ?`,
            [tenant_id, rok, miesiac]
          );
          const konta = await q(
            `SELECT COUNT(*) AS n FROM Lojalnosc_Konta WHERE tenant_id = ? AND status = 'AKTYWNE'`, [tenant_id]
          ).catch(() => [{ n: 0 }]);
          const push = await q(
            `SELECT COUNT(DISTINCT id_klienta) AS n FROM Lojalnosc_Push WHERE tenant_id = ?`, [tenant_id]
          ).catch(() => [{ n: 0 }]);
          const top = await q(
            `SELECT P.id_klienta, K.imie_nazwisko AS klient, SUM(P.zmiana) AS saldo
               FROM Lojalnosc_Punkty P
               LEFT JOIN Klienci K ON K.tenant_id = P.tenant_id AND K.id_klienta = P.id_klienta
              WHERE P.tenant_id = ? GROUP BY P.id_klienta, K.imie_nazwisko
              ORDER BY saldo DESC LIMIT 5`,
            [tenant_id]
          ).catch(() => []);
          const nagrodyM = await q(
            `SELECT nagroda_nazwa, COUNT(*) AS n FROM Lojalnosc_Odbiory
              WHERE tenant_id = ? AND status = 'WYDANE' AND YEAR(rozstrzygnieto_at) = ? AND MONTH(rozstrzygnieto_at) = ?
              GROUP BY nagroda_nazwa ORDER BY n DESC LIMIT 10`,
            [tenant_id, rok, miesiac]
          ).catch(() => []);
          return res.json({
            status: 'success', rok, miesiac,
            przyznane: Number((mies[0] || {}).przyznane) || 0,
            odjete: Number((mies[0] || {}).odjete) || 0,
            klienci_aktywni_mc: Number((mies[0] || {}).klienci) || 0,
            konta_aktywne: Number((konta[0] || {}).n) || 0,
            push_subskrypcje: Number((push[0] || {}).n) || 0,
            top_klienci: Array.isArray(top) ? top : [],
            nagrody_wydane_mc: Array.isArray(nagrodyM) ? nagrodyM : []
          });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      });

    } else if (action === 'loj_kampanie') {
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT id, tytul, tresc, img_url, segment_typ, segment_wartosc, segment_dni, wyslij_at, status,
                  wyslano_at, odbiorcow, dostarczono, utworzyl, created_at
             FROM Lojalnosc_Kampanie WHERE tenant_id = ?
            ORDER BY (status = 'PLANOWANA') DESC, COALESCE(wyslano_at, wyslij_at) DESC LIMIT 50`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', kampanie: Array.isArray(rows) ? rows : [], push_skonfigurowany: webpush ? 1 : 0 });
          }
        );
      });

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET lojalnosc: ' + action });
    }
  });

  // ─── POST /lojalnosc ───
  router.post('/lojalnosc', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'loj_punkty_reczne') {
      // Ręczna korekta punktów (np. opinia Google, polecenie, reklamacja).
      // Dostępna dla każdego zalogowanego pracownika — z limitem i pełnym logiem.
      const idK = String(d.id_klienta || '').trim();
      const zmiana = Math.trunc(Number(d.zmiana));
      const powod = String(d.powod || '').trim();
      const kto = String(d.user_log || d.pracownik || '').trim();
      if (!idK) return res.json({ status: 'error', message: 'Brak id_klienta' });
      if (!Number.isFinite(zmiana) || zmiana === 0) return res.json({ status: 'error', message: 'Podaj liczbę punktów różną od zera.' });
      if (Math.abs(zmiana) > MAX_RECZNE) return res.json({ status: 'error', message: `Limit pojedynczej korekty to ±${MAX_RECZNE} pkt.` });
      if (!powod) return res.json({ status: 'error', message: 'Podaj powód (będzie widoczny w historii punktów).' });
      if (!kto) return res.json({ status: 'error', message: 'Brak identyfikacji pracownika.' });

      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, () => {
        // Klient musi istnieć w TYM salonie — blokada wpisów na obce/losowe id
        db.query(
          `SELECT id_klienta FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`,
          [tenant_id, idK],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!Array.isArray(rows) || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono klienta w kartotece.' });
            db.query(
              `INSERT INTO Lojalnosc_Punkty (tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik)
               VALUES (?, ?, ?, ?, 'RECZNE', ?, ?)`,
              [tenant_id, idK, zmiana, powod.slice(0, 250), randomUUID(), kto.slice(0, 120)],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                zapiszLog(tenant_id, 'KLUB PUNKTY RĘCZNE', kto, `Klient ${idK}: ${zmiana > 0 ? '+' : ''}${zmiana} pkt | ${powod}`);
                return res.json({ status: 'success', message: 'Punkty zapisane.' });
              }
            );
          }
        );
      }));

    } else if (action === 'loj_ustawienia_zapisz') {
      // RBAC: tylko admin — pilot Klubu w całości admin-only
      const kto = String(d.user_log || d.pracownik || '').trim();
      const pkt = parseInt(d.pkt_za_10zl, 10);
      const bonus = parseInt(d.bonus_powitalny_pkt, 10) || 0;
      const nazwa = String(d.nazwa_klubu || 'Klub').trim().slice(0, 120) || 'Klub';
      if (!Number.isFinite(pkt) || pkt < 0 || pkt > 100) {
        return res.json({ status: 'error', message: 'Punkty za 10 zł: liczba 0–100.' });
      }
      if (bonus < 0 || bonus > 1000) return res.json({ status: 'error', message: 'Bonus powitalny: 0–1000 pkt.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `INSERT INTO Lojalnosc_Ustawienia (tenant_id, pkt_za_10zl, nazwa_klubu, bonus_powitalny_pkt, updated_by)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE pkt_za_10zl = VALUES(pkt_za_10zl), nazwa_klubu = VALUES(nazwa_klubu),
             bonus_powitalny_pkt = VALUES(bonus_powitalny_pkt), updated_by = VALUES(updated_by)`,
          [tenant_id, pkt, nazwa, bonus, kto],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'KLUB USTAWIENIA', kto, `pkt_za_10zl=${pkt}, nazwa=${nazwa}, bonus_powitalny=${bonus}`);
            return res.json({ status: 'success', message: 'Zapisano ustawienia Klubu.' });
          }
        );
      });

    } else if (action === 'loj_rejestracja_link') {
      // Stały link/QR do rejestracji online (IG bio, relacje, ulotki). Token
      // identyfikuje tylko salon — może wisieć publicznie latami.
      const kto = String(d.user_log || d.pracownik || '').trim();
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, async () => {
        try {
          const token = makeKlubToken({ t: tenant_id, k: 'rejestracja', typ: 'rej', exp: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000 });
          const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
          const host = req.get('host');
          const url = `${proto}://${host}/klub.html?r=${encodeURIComponent(token)}`;
          const qr = await QRCode.toDataURL(url, { margin: 1, width: 320 });
          return res.json({ status: 'success', url, qr });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      }));

    } else if (action === 'loj_wniosek_wyslij') {
      // Recepcja/admin wysyła link aktywacyjny NA NUMER Z KARTOTEKI (SMS ręczny, bez kosztów)
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      if (!id) return res.json({ status: 'error', message: 'Brak wniosku.' });
      wymagajAdmina(tenant_id, kto, res, async () => {
        try {
          const wRows = await q(`SELECT id, id_klienta, imie, typ, status FROM Lojalnosc_Wnioski WHERE tenant_id = ? AND id = ? LIMIT 1`, [tenant_id, id]);
          const wniosek = Array.isArray(wRows) ? wRows[0] : null;
          if (!wniosek) return res.json({ status: 'error', message: 'Nie znaleziono wniosku.' });
          if (wniosek.status !== 'NOWY') return res.json({ status: 'error', message: 'Wniosek już obsłużony.' });
          const kRows = await q(`SELECT id_klienta, imie_nazwisko, telefon, status, zmarly FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [tenant_id, String(wniosek.id_klienta)]);
          const klient = Array.isArray(kRows) ? kRows[0] : null;
          if (!klientAktywny(klient)) return res.json({ status: 'error', message: 'Kartoteka klientki niedostępna.' });
          const payload = { t: tenant_id, k: String(wniosek.id_klienta), typ: 'akt', exp: Date.now() + AKTYWACJA_TTL_MS };
          const token = makeKlubToken(payload);
          const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
          const host = req.get('host');
          const url = `${proto}://${host}/klub.html?a=${encodeURIComponent(token)}`;
          const telKartoteka = String(klient.telefon || '').trim();
          const trescSms = String(wniosek.typ) === 'RESET'
            ? `Twoj link do ustawienia nowego PIN-u w programie lojalnosciowym: ${url} (wazny 7 dni)`
            : `Twoj link do aktywacji konta w programie lojalnosciowym: ${url} (wazny 7 dni)`;
          await q(`UPDATE Lojalnosc_Wnioski SET status = 'WYSLANY', obsluzyl = ?, obsluzono_at = NOW() WHERE tenant_id = ? AND id = ? AND status = 'NOWY'`, [kto.slice(0, 120), tenant_id, id]);
          zapiszLog(tenant_id, 'KLUB WNIOSEK WYSLANY', kto, `Klient ${wniosek.id_klienta} (${klient.imie_nazwisko || ''}) — link aktywacyjny na numer z kartoteki`);
          const smsUri = 'sms:' + telKartoteka.replace(/[^+\d]/g, '') + '?body=' + encodeURIComponent(trescSms);
          // QR z sms: — recepcja na komputerze skanuje telefonem salonu i SMS pisze się sam
          const qrSms = await QRCode.toDataURL(smsUri, { margin: 1, width: 280 }).catch(() => '');
          return res.json({
            status: 'success', url,
            telefon: telKartoteka,
            klient: klient.imie_nazwisko || '',
            sms_uri: smsUri,
            qr_sms: qrSms,
            tresc_sms: trescSms
          });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      });

    } else if (action === 'loj_wniosek_odrzuc') {
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      if (!id) return res.json({ status: 'error', message: 'Brak wniosku.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `UPDATE Lojalnosc_Wnioski SET status = 'ODRZUCONY', obsluzyl = ?, obsluzono_at = NOW() WHERE tenant_id = ? AND id = ? AND status = 'NOWY'`,
          [kto.slice(0, 120), tenant_id, id],
          (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Wniosek już obsłużony.' });
            return res.json({ status: 'success' });
          }
        );
      });

    } else if (action === 'loj_aktywacja_token') {
      // Jednorazowy link/QR do aktywacji konta w apce klienta — generowany z profilu
      // klienta w panelu (jedyna ścieżka zakładania kont — decyzja z planu, sekcja 11).
      const idK = String(d.id_klienta || '').trim();
      const kto = String(d.user_log || d.pracownik || '').trim();
      if (!idK) return res.json({ status: 'error', message: 'Brak id_klienta' });
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT id_klienta, imie_nazwisko, telefon, status, zmarly FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`,
          [tenant_id, idK],
          async (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            const klient = Array.isArray(rows) ? rows[0] : null;
            if (!klient) return res.json({ status: 'error', message: 'Nie znaleziono klienta w kartotece.' });
            if (!klientAktywny(klient)) return res.json({ status: 'error', message: 'Konto Klubu niedostępne dla tego klienta (status kartoteki).' });
            try {
              const konto = await q(`SELECT id, status FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [tenant_id, idK]).catch(() => []);
              const payload = { t: tenant_id, k: idK, typ: 'akt', exp: Date.now() + AKTYWACJA_TTL_MS };
              const token = makeKlubToken(payload);
              const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
              const host = req.get('host');
              const url = `${proto}://${host}/klub.html?a=${encodeURIComponent(token)}`;
              const qr = await QRCode.toDataURL(url, { margin: 1, width: 320 });
              zapiszLog(tenant_id, 'KLUB LINK AKTYWACYJNY', kto, `Klient ${idK} (${klient.imie_nazwisko || ''})${(Array.isArray(konto) && konto.length) ? ' — reset PIN (konto istniało)' : ''}`);
              return res.json({
                status: 'success', url, qr,
                wygasa: new Date(payload.exp).toISOString(),
                ma_konto: (Array.isArray(konto) && konto.length) ? 1 : 0,
                klient: klient.imie_nazwisko || ''
              });
            } catch (e) { return res.json({ status: 'error', message: e.message }); }
          }
        );
      }));

    } else if (action === 'loj_nagroda_zapisz') {
      // Insert (bez id) lub update (z id). Zdjęcie: URL (upload plików = później).
      const kto = String(d.user_log || d.pracownik || '').trim();
      const nazwa = String(d.nazwa || '').trim().slice(0, 160);
      const opis = String(d.opis || '').trim().slice(0, 500);
      const koszt = parseInt(d.koszt_pkt, 10);
      const ilosc = (d.ilosc === '' || d.ilosc == null) ? null : parseInt(d.ilosc, 10);
      const img = String(d.img_url || '').trim().slice(0, 500);
      const sort = parseInt(d.sortowanie, 10) || 100;
      if (!nazwa) return res.json({ status: 'error', message: 'Podaj nazwę nagrody.' });
      if (!Number.isFinite(koszt) || koszt < 1 || koszt > 1000000) return res.json({ status: 'error', message: 'Koszt w punktach: liczba od 1.' });
      if (ilosc !== null && (!Number.isFinite(ilosc) || ilosc < 0)) return res.json({ status: 'error', message: 'Ilość: puste (bez limitu) lub liczba ≥ 0.' });
      if (!imgUrlOk(img)) return res.json({ status: 'error', message: 'Zdjęcie: wgraj plik albo podaj pełny adres URL.' });
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, () => {
        const id = parseInt(d.id, 10);
        if (id) {
          db.query(
            `UPDATE Lojalnosc_Nagrody SET nazwa = ?, opis = ?, koszt_pkt = ?, ilosc = ?, img_url = ?, sortowanie = ? WHERE tenant_id = ? AND id = ?`,
            [nazwa, opis, koszt, ilosc, img, sort, tenant_id, id],
            (err, r) => {
              if (err) return res.json({ status: 'error', message: err.message });
              if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono nagrody.' });
              zapiszLog(tenant_id, 'KLUB NAGRODA', kto, `Edycja: ${nazwa} (${koszt} pkt)`);
              return res.json({ status: 'success' });
            }
          );
        } else {
          db.query(
            `INSERT INTO Lojalnosc_Nagrody (tenant_id, nazwa, opis, koszt_pkt, ilosc, img_url, sortowanie, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'AKTYWNA')`,
            [tenant_id, nazwa, opis, koszt, ilosc, img, sort],
            (err) => {
              if (err) return res.json({ status: 'error', message: err.message });
              zapiszLog(tenant_id, 'KLUB NAGRODA', kto, `Dodano: ${nazwa} (${koszt} pkt)`);
              return res.json({ status: 'success' });
            }
          );
        }
      }));

    } else if (action === 'loj_nagroda_status') {
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      const status = String(d.status || '').toUpperCase();
      if (!id || !['AKTYWNA', 'UKRYTA', 'ARCHIWUM'].includes(status)) return res.json({ status: 'error', message: 'Nieprawidłowe dane.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `UPDATE Lojalnosc_Nagrody SET status = ? WHERE tenant_id = ? AND id = ?`,
          [status, tenant_id, id],
          (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono nagrody.' });
            zapiszLog(tenant_id, 'KLUB NAGRODA', kto, `Status #${id} → ${status}`);
            return res.json({ status: 'success' });
          }
        );
      });

    } else if (action === 'loj_promocja_zapisz') {
      const kto = String(d.user_log || d.pracownik || '').trim();
      const tytul = String(d.tytul || '').trim().slice(0, 200);
      const opis = String(d.opis || '').trim().slice(0, 300);
      const tresc = String(d.tresc || '').trim().slice(0, 20000);
      const img = String(d.img_url || '').trim().slice(0, 500);
      const dataOd = String(d.data_od || '').trim() || null;
      const dataDo = String(d.data_do || '').trim() || null;
      const dnia = d.promocja_dnia ? 1 : 0;
      const sort = parseInt(d.sortowanie, 10) || 100;
      const pushStart = d.push_przy_starcie ? 1 : 0;
      const seg = normalizujSegment(d);
      const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
      if (!tytul) return res.json({ status: 'error', message: 'Podaj tytuł promocji.' });
      if (!seg) return res.json({ status: 'error', message: 'Uzupełnij dane segmentu (np. próg punktów lub nazwę zabiegu).' });
      if ((dataOd && !DATA_RE.test(dataOd)) || (dataDo && !DATA_RE.test(dataDo))) return res.json({ status: 'error', message: 'Daty w formacie RRRR-MM-DD.' });
      if (!imgUrlOk(img)) return res.json({ status: 'error', message: 'Zdjęcie: wgraj plik albo podaj pełny adres URL.' });
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, () => {
        const id = parseInt(d.id, 10);
        if (id) {
          db.query(
            `UPDATE Lojalnosc_Promocje SET tytul = ?, opis = ?, tresc = ?, img_url = ?, data_od = ?, data_do = ?, promocja_dnia = ?, sortowanie = ?,
                    segment_typ = ?, segment_wartosc = ?, segment_dni = ?, push_przy_starcie = ? WHERE tenant_id = ? AND id = ?`,
            [tytul, opis, tresc, img, dataOd, dataDo, dnia, sort, seg.typ, seg.wartosc, seg.dni, pushStart, tenant_id, id],
            (err, r) => {
              if (err) return res.json({ status: 'error', message: err.message });
              if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono promocji.' });
              zapiszLog(tenant_id, 'KLUB PROMOCJA', kto, `Edycja: ${tytul} [${opisSegmentu({ segment_typ: seg.typ, segment_wartosc: seg.wartosc, segment_dni: seg.dni })}]`);
              return res.json({ status: 'success' });
            }
          );
        } else {
          db.query(
            `INSERT INTO Lojalnosc_Promocje (tenant_id, tytul, opis, tresc, img_url, data_od, data_do, promocja_dnia, sortowanie, status,
                    segment_typ, segment_wartosc, segment_dni, push_przy_starcie)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTYWNA', ?, ?, ?, ?)`,
            [tenant_id, tytul, opis, tresc, img, dataOd, dataDo, dnia, sort, seg.typ, seg.wartosc, seg.dni, pushStart],
            (err) => {
              if (err) return res.json({ status: 'error', message: err.message });
              zapiszLog(tenant_id, 'KLUB PROMOCJA', kto, `Dodano: ${tytul}${dnia ? ' [promocja dnia]' : ''}${pushStart ? ' [auto-push przy starcie]' : ''} [${opisSegmentu({ segment_typ: seg.typ, segment_wartosc: seg.wartosc, segment_dni: seg.dni })}]`);
              return res.json({ status: 'success' });
            }
          );
        }
      }));

    } else if (action === 'loj_promocja_status') {
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      const status = String(d.status || '').toUpperCase();
      if (!id || !['AKTYWNA', 'UKRYTA', 'ARCHIWUM'].includes(status)) return res.json({ status: 'error', message: 'Nieprawidłowe dane.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `UPDATE Lojalnosc_Promocje SET status = ? WHERE tenant_id = ? AND id = ?`,
          [status, tenant_id, id],
          (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono promocji.' });
            zapiszLog(tenant_id, 'KLUB PROMOCJA', kto, `Status #${id} → ${status}`);
            return res.json({ status: 'success' });
          }
        );
      });

    } else if (action === 'loj_odbior_rozstrzygnij') {
      // WYDANE → dopiero teraz punkty schodzą z ledgera (idempotentnie po ref ODB@id).
      // ODRZUCONE → rezerwacja znika, punkty wracają do dyspozycji klienta.
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      const decyzja = String(d.decyzja || '').toUpperCase();
      if (!id || !['WYDANE', 'ODRZUCONE'].includes(decyzja)) return res.json({ status: 'error', message: 'Nieprawidłowe dane.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT id, id_klienta, nagroda_nazwa, koszt_pkt, kod, status FROM Lojalnosc_Odbiory WHERE tenant_id = ? AND id = ? LIMIT 1`,
          [tenant_id, id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            const odbior = Array.isArray(rows) ? rows[0] : null;
            if (!odbior) return res.json({ status: 'error', message: 'Nie znaleziono odbioru.' });
            if (odbior.status !== 'OCZEKUJE') return res.json({ status: 'error', message: 'Ten odbiór jest już rozstrzygnięty (' + odbior.status + ').' });
            db.query(
              `UPDATE Lojalnosc_Odbiory SET status = ?, wydal = ?, rozstrzygnieto_at = NOW() WHERE tenant_id = ? AND id = ? AND status = 'OCZEKUJE'`,
              [decyzja, kto.slice(0, 120), tenant_id, id],
              (err2, r2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                if (!r2.affectedRows) return res.json({ status: 'error', message: 'Odbiór został właśnie rozstrzygnięty przez kogoś innego.' });
                if (decyzja === 'WYDANE') {
                  db.query(
                    `INSERT INTO Lojalnosc_Punkty (tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik)
                     VALUES (?, ?, ?, ?, 'NAGRODA', ?, ?)`,
                    [tenant_id, odbior.id_klienta, -Math.abs(Number(odbior.koszt_pkt) || 0), ('Nagroda: ' + odbior.nagroda_nazwa).slice(0, 250), 'ODB@' + id, kto.slice(0, 120)],
                    (err3) => {
                      if (err3 && err3.code !== 'ER_DUP_ENTRY') console.error('[lojalnosc] ledger nagroda:', err3.message);
                    }
                  );
                }
                zapiszLog(tenant_id, 'KLUB ODBIÓR ' + decyzja, kto, `Klient ${odbior.id_klienta}: ${odbior.nagroda_nazwa} (${odbior.koszt_pkt} pkt), kod ${odbior.kod}`);
                return res.json({ status: 'success' });
              }
            );
          }
        );
      });

    } else if (action === 'loj_zgloszenie_obsluz') {
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      if (!id) return res.json({ status: 'error', message: 'Brak zgłoszenia.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `UPDATE Lojalnosc_Zgloszenia SET status = 'OBSLUZONE', obsluzyl = ?, obsluzono_at = NOW() WHERE tenant_id = ? AND id = ? AND status = 'NOWE'`,
          [kto.slice(0, 120), tenant_id, id],
          (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Zgłoszenie już obsłużone.' });
            return res.json({ status: 'success' });
          }
        );
      });

    } else if (action === 'loj_push_wyslij') {
      // Wysyłka powiadomienia do wszystkich subskrybentów salonu.
      // Martwe subskrypcje (410/404) są sprzątane automatycznie.
      const kto = String(d.user_log || d.pracownik || '').trim();
      const tytul = String(d.tytul || '').trim().slice(0, 100);
      const tresc = String(d.tresc || '').trim().slice(0, 300);
      if (!tytul || !tresc) return res.json({ status: 'error', message: 'Podaj tytuł i treść powiadomienia.' });
      if (!webpush) return res.json({ status: 'error', message: 'Powiadomienia push nie są skonfigurowane na serwerze (brak kluczy VAPID w env).' });
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT id, endpoint, p256dh, auth FROM Lojalnosc_Push WHERE tenant_id = ?`,
          [tenant_id],
          async (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            const subs = Array.isArray(rows) ? rows : [];
            if (!subs.length) return res.json({ status: 'error', message: 'Żaden klient nie włączył jeszcze powiadomień w apce.' });
            const payload = JSON.stringify({ title: tytul, body: tresc, url: '/klub.html' });
            let ok = 0, martwe = 0;
            await Promise.all(subs.map(s =>
              webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                payload
              ).then(() => { ok++; }).catch(e2 => {
                if (e2 && (e2.statusCode === 404 || e2.statusCode === 410)) {
                  martwe++;
                  db.query(`DELETE FROM Lojalnosc_Push WHERE id = ?`, [s.id], () => {});
                }
              })
            ));
            zapiszLog(tenant_id, 'KLUB PUSH', kto, `„${tytul}" — dostarczono ${ok}/${subs.length}${martwe ? `, wyczyszczono ${martwe} martwych` : ''}`);
            return res.json({ status: 'success', dostarczono: ok, wszystkich: subs.length });
          }
        );
      }));

    } else if (action === 'loj_kampania_zapisz') {
      // Kampania = push (jeśli skonfigurowany) + wiadomość w apce przez 30 dni.
      // Bez wyslij_at → wykonanie od razu; z terminem → PLANOWANA (scheduler co 60 s).
      const kto = String(d.user_log || d.pracownik || '').trim();
      const tytul = String(d.tytul || '').trim().slice(0, 100);
      const tresc = String(d.tresc || '').trim().slice(0, 300);
      const img = String(d.img_url || '').trim().slice(0, 500);
      const seg = normalizujSegment(d);
      let wyslijAt = String(d.wyslij_at || '').trim();
      if (!tytul || !tresc) return res.json({ status: 'error', message: 'Podaj tytuł i treść.' });
      if (!seg) return res.json({ status: 'error', message: 'Uzupełnij dane segmentu (np. próg punktów lub nazwę zabiegu).' });
      if (!imgUrlOk(img)) return res.json({ status: 'error', message: 'Zdjęcie: wgraj plik albo podaj pełny adres URL.' });
      if (wyslijAt) {
        const m = wyslijAt.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
        if (!m) return res.json({ status: 'error', message: 'Termin wysyłki w formacie data + godzina.' });
        wyslijAt = `${m[1]} ${m[2]}:00`;
      }
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, async () => {
        try {
          const teraz = !wyslijAt;
          const wynik = await q(
            `INSERT INTO Lojalnosc_Kampanie (tenant_id, tytul, tresc, img_url, segment_typ, segment_wartosc, segment_dni, wyslij_at, status, utworzyl)
             VALUES (?, ?, ?, ?, ?, ?, ?, ${teraz ? 'NOW()' : '?'}, ?, ?)`,
            teraz
              ? [tenant_id, tytul, tresc, img, seg.typ, seg.wartosc, seg.dni, 'WYSYLANIE', kto.slice(0, 120)]
              : [tenant_id, tytul, tresc, img, seg.typ, seg.wartosc, seg.dni, wyslijAt, 'PLANOWANA', kto.slice(0, 120)]
          );
          if (!teraz) {
            zapiszLog(tenant_id, 'KLUB KAMPANIA ZAPLANOWANA', kto, `„${tytul}" na ${wyslijAt} [${opisSegmentu({ segment_typ: seg.typ, segment_wartosc: seg.wartosc, segment_dni: seg.dni })}]`);
            return res.json({ status: 'success', zaplanowana: 1, wyslij_at: wyslijAt });
          }
          const rezultat = await wykonajKampanie({
            id: wynik.insertId, tenant_id, tytul, tresc, img_url: img,
            segment_typ: seg.typ, segment_wartosc: seg.wartosc, segment_dni: seg.dni, utworzyl: kto
          });
          return res.json({ status: 'success', dostarczono: rezultat.dostarczono, subskrypcji: rezultat.subskrypcji });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      }));

    } else if (action === 'loj_kampania_anuluj') {
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      if (!id) return res.json({ status: 'error', message: 'Brak kampanii.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `UPDATE Lojalnosc_Kampanie SET status = 'ANULOWANA' WHERE tenant_id = ? AND id = ? AND status = 'PLANOWANA'`,
          [tenant_id, id],
          (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Tej kampanii nie da się już anulować.' });
            zapiszLog(tenant_id, 'KLUB KAMPANIA ANULOWANA', kto, `#${id}`);
            return res.json({ status: 'success' });
          }
        );
      });

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja POST lojalnosc: ' + action });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // PUBLICZNE API APKI KLIENTA (/api/klub/*)
  // Bez tenant_id w body — globalny middleware sesji panelu pomija je BY DESIGN
  // (jak foto.js/zgody.js). Autoryzacja: stateless HMAC (typ 'akt' lub 'ses').
  // Żaden endpoint nie zwraca danych innych klientów niż ten z tokenu.
  // ─────────────────────────────────────────────────────────────

  // Dane do ekranu aktywacji (zanim klient ustawi PIN): imię, nazwa klubu, regulamin
  router.post('/klub/info', klubLimiter, async (req, res) => {
    const p = verifyKlubToken((req.body || {}).token, 'akt');
    if (!p) return res.json({ status: 'error', message: 'Link aktywacyjny jest nieprawidłowy lub wygasł. Poproś salon o nowy.' });
    try {
      const kRows = await q(`SELECT imie_nazwisko, status, zmarly FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [p.t, p.k]);
      const klient = Array.isArray(kRows) ? kRows[0] : null;
      if (!klientAktywny(klient)) return res.json({ status: 'error', message: 'Link nieaktualny. Poproś salon o nowy.' });
      const uRows = await q(`SELECT nazwa_klubu, pkt_za_10zl FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const rRows = await q(`SELECT url, tresc FROM TenantRegulaminy WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const ust = (Array.isArray(uRows) && uRows[0]) || {};
      const reg = (Array.isArray(rRows) && rRows[0]) || {};
      return res.json({
        status: 'success',
        imie: String(klient.imie_nazwisko || '').split(' ')[0] || '',
        nazwa_klubu: ust.nazwa_klubu || 'Klub',
        pkt_za_10zl: parseInt(ust.pkt_za_10zl, 10) || 1,
        regulamin_url: String(reg.url || '').trim()
      });
    } catch (e) { return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' }); }
  });

  // Aktywacja konta: token z panelu + PIN klienta + zgoda na regulamin.
  // Ponowna aktywacja (nowy link od recepcji) = reset PIN — celowo.
  router.post('/klub/aktywuj', loginLimiter, async (req, res) => {
    const d = req.body || {};
    const p = verifyKlubToken(d.token, 'akt');
    if (!p) return res.json({ status: 'error', message: 'Link aktywacyjny jest nieprawidłowy lub wygasł. Poproś salon o nowy.' });
    const pin = String(d.pin || '').trim();
    if (!/^\d{4,6}$/.test(pin)) return res.json({ status: 'error', message: 'PIN musi mieć 4–6 cyfr.' });
    if (!d.zgoda) return res.json({ status: 'error', message: 'Wymagana akceptacja regulaminu programu.' });
    try {
      const kRows = await q(`SELECT imie_nazwisko, telefon, status, zmarly FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [p.t, p.k]);
      const klient = Array.isArray(kRows) ? kRows[0] : null;
      if (!klientAktywny(klient)) return res.json({ status: 'error', message: 'Link nieaktualny. Poproś salon o nowy.' });
      const hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
      await q(
        `INSERT INTO Lojalnosc_Konta (tenant_id, id_klienta, telefon, pin_hash, status, zgoda_regulamin_at)
         VALUES (?, ?, ?, ?, 'AKTYWNE', NOW())
         ON DUPLICATE KEY UPDATE telefon = VALUES(telefon), pin_hash = VALUES(pin_hash), status = 'AKTYWNE', zgoda_regulamin_at = NOW()`,
        [p.t, p.k, normalizujTelefon(klient.telefon), hash]
      );
      zapiszLog(p.t, 'KLUB AKTYWACJA KONTA', 'Klient (apka)', `Klient ${p.k} (${klient.imie_nazwisko || ''}) aktywował konto Klubu`);
      const session = makeKlubToken({ t: p.t, k: p.k, typ: 'ses', exp: Date.now() + SESJA_TTL_MS });
      return res.json({ status: 'success', session, imie: String(klient.imie_nazwisko || '').split(' ')[0] || '' });
    } catch (e) {
      console.error('[lojalnosc] aktywuj:', e.message);
      return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' });
    }
  });

  // Logowanie: telefon + PIN. Komunikat błędu celowo jednakowy dla złego
  // telefonu i złego PIN-u (nie zdradzamy, czy numer istnieje w bazie).
  router.post('/klub/login', loginLimiter, async (req, res) => {
    const d = req.body || {};
    const tel = normalizujTelefon(d.telefon);
    const pin = String(d.pin || '').trim();
    const blednedane = () => res.json({ status: 'error', message: 'Błędny numer telefonu lub PIN.' });
    if (tel.length < 9 || !/^\d{4,6}$/.test(pin)) return blednedane();
    try {
      const konta = await q(
        `SELECT tenant_id, id_klienta, pin_hash FROM Lojalnosc_Konta WHERE telefon = ? AND status = 'AKTYWNE' LIMIT 10`,
        [tel]
      );
      const pasujace = [];
      for (const konto of (Array.isArray(konta) ? konta : [])) {
        const ok = await bcrypt.compare(pin, String(konto.pin_hash || '')).catch(() => false);
        if (ok) pasujace.push(konto);
      }
      if (pasujace.length === 0) return blednedane();
      if (pasujace.length > 1) return res.json({ status: 'error', message: 'Ten numer ma konta w kilku salonach. Poproś swój salon o nowy link aktywacyjny.' });
      const konto = pasujace[0];
      db.query(`UPDATE Lojalnosc_Konta SET ostatnie_logowanie = NOW() WHERE tenant_id = ? AND id_klienta = ?`, [konto.tenant_id, konto.id_klienta], () => {});
      const session = makeKlubToken({ t: konto.tenant_id, k: konto.id_klienta, typ: 'ses', exp: Date.now() + SESJA_TTL_MS });
      return res.json({ status: 'success', session });
    } catch (e) {
      console.error('[lojalnosc] login:', e.message);
      return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' });
    }
  });

  // Dane konta: saldo, historia, ustawienia. Tylko dane klienta z tokenu.
  router.post('/klub/me', klubLimiter, async (req, res) => {
    const p = verifyKlubToken((req.body || {}).session, 'ses');
    if (!p) return res.json({ status: 'error', code: 'SESJA', message: 'Sesja wygasła. Zaloguj się ponownie.' });
    try {
      const aRows = await q(`SELECT status FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [p.t, p.k]);
      const konto = Array.isArray(aRows) ? aRows[0] : null;
      if (!konto || String(konto.status).toUpperCase() !== 'AKTYWNE') {
        return res.json({ status: 'error', code: 'SESJA', message: 'Konto nieaktywne. Skontaktuj się z salonem.' });
      }
      const kRows = await q(`SELECT imie_nazwisko, status, zmarly FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [p.t, p.k]);
      const klient = Array.isArray(kRows) ? kRows[0] : null;
      if (!klientAktywny(klient)) return res.json({ status: 'error', code: 'SESJA', message: 'Konto nieaktywne. Skontaktuj się z salonem.' });
      const sRows = await q(`SELECT COALESCE(SUM(zmiana), 0) AS saldo FROM Lojalnosc_Punkty WHERE tenant_id = ? AND id_klienta = ?`, [p.t, p.k]);
      const wRows = await q(
        `SELECT zmiana, powod, zrodlo, created_at FROM Lojalnosc_Punkty WHERE tenant_id = ? AND id_klienta = ? ORDER BY id DESC LIMIT 20`,
        [p.t, p.k]
      );
      const uRows = await q(`SELECT nazwa_klubu, pkt_za_10zl FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const ust = (Array.isArray(uRows) && uRows[0]) || {};
      // Faza 3: nagrody + moje oczekujące odbiory (saldo dostępne = saldo − rezerwacje)
      const rezRows = await q(
        `SELECT COALESCE(SUM(koszt_pkt), 0) AS rez FROM Lojalnosc_Odbiory WHERE tenant_id = ? AND id_klienta = ? AND status = 'OCZEKUJE'`,
        [p.t, p.k]
      ).catch(() => [{ rez: 0 }]);
      const nagrodyRows = await q(
        `SELECT id, nazwa, opis, koszt_pkt, ilosc, img_url,
                (SELECT COUNT(*) FROM Lojalnosc_Odbiory O WHERE O.tenant_id = N.tenant_id AND O.nagroda_id = N.id AND O.status IN ('OCZEKUJE','WYDANE')) AS zajete
           FROM Lojalnosc_Nagrody N
          WHERE tenant_id = ? AND status = 'AKTYWNA'
          ORDER BY sortowanie ASC, koszt_pkt ASC`,
        [p.t]
      ).catch(() => []);
      const odbioryRows = await q(
        `SELECT id, nagroda_nazwa, koszt_pkt, kod, status, created_at, rozstrzygnieto_at
           FROM Lojalnosc_Odbiory WHERE tenant_id = ? AND id_klienta = ?
          ORDER BY id DESC LIMIT 10`,
        [p.t, p.k]
      ).catch(() => []);
      // Faza 4: aktywne promocje w oknie dat (z targetowaniem — filtr niżej)
      const promocjeRows = await q(
        `SELECT id, tytul, opis, tresc, img_url, promocja_dnia, data_od, data_do,
                segment_typ, segment_wartosc, segment_dni
           FROM Lojalnosc_Promocje
          WHERE tenant_id = ? AND status = 'AKTYWNA'
            AND (data_od IS NULL OR data_od <= CURDATE())
            AND (data_do IS NULL OR data_do >= CURDATE())
          ORDER BY promocja_dnia DESC, sortowanie ASC, id DESC LIMIT 20`,
        [p.t]
      ).catch(() => []);
      const saldo = Number((Array.isArray(sRows) && sRows[0] || {}).saldo) || 0;
      const zarezerwowane = Number((Array.isArray(rezRows) && rezRows[0] || {}).rez) || 0;
      // Kampanie: fakty klienta pobrane RAZ (sprzedaże 365 dni) → ocena segmentów w JS.
      // Ten sam filtr działa dla targetowanych promocji i skrzynki wiadomości.
      const faktySprzedaze = await q(
        `SELECT zabieg, typ_zabiegu, data_sprzedazy AS data FROM Sprzedaz
          WHERE tenant_id = ? AND id_klienta = ? AND COALESCE(status,'') != 'USUNIĘTY' AND kwota > 0
            AND data_sprzedazy >= DATE_SUB(NOW(), INTERVAL 365 DAY)
          ORDER BY data_sprzedazy DESC LIMIT 300`,
        [p.t, p.k]
      ).catch(() => []);
      const fakty = { saldo, sprzedaze: Array.isArray(faktySprzedaze) ? faktySprzedaze : [], teraz: new Date() };
      const kampanieRows = await q(
        `SELECT id, tytul, tresc, img_url, segment_typ, segment_wartosc, segment_dni, wyslano_at
           FROM Lojalnosc_Kampanie
          WHERE tenant_id = ? AND status = 'WYSLANA' AND wyslano_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          ORDER BY wyslano_at DESC LIMIT 10`,
        [p.t]
      ).catch(() => []);
      const odp = {
        status: 'success',
        imie: String(klient.imie_nazwisko || '').split(' ')[0] || '',
        saldo,
        saldo_dostepne: saldo - zarezerwowane,
        wpisy: (Array.isArray(wRows) ? wRows : []).map(w => ({
          zmiana: Number(w.zmiana) || 0,
          powod: w.powod || '',
          zrodlo: w.zrodlo || '',
          data: w.created_at
        })),
        nagrody: (Array.isArray(nagrodyRows) ? nagrodyRows : []).map(n => ({
          id: n.id,
          nazwa: n.nazwa,
          opis: n.opis || '',
          koszt_pkt: Number(n.koszt_pkt) || 0,
          img_url: n.img_url || '',
          dostepna: (n.ilosc == null || Number(n.zajete) < Number(n.ilosc)) ? 1 : 0
        })),
        odbiory: (Array.isArray(odbioryRows) ? odbioryRows : []).map(o => ({
          id: o.id, nagroda: o.nagroda_nazwa, koszt_pkt: Number(o.koszt_pkt) || 0,
          kod: o.kod, status: o.status, data: o.created_at
        })),
        promocje: (Array.isArray(promocjeRows) ? promocjeRows : [])
          .filter(pr => pasujeSegment(pr, fakty))
          .map(pr => ({
            id: pr.id, tytul: pr.tytul, opis: pr.opis || '', tresc: pr.tresc || '',
            img_url: pr.img_url || '', promocja_dnia: Number(pr.promocja_dnia) ? 1 : 0,
            data_do: pr.data_do
          })),
        wiadomosci: (Array.isArray(kampanieRows) ? kampanieRows : [])
          .filter(k => pasujeSegment(k, fakty))
          .map(k => ({ id: k.id, tytul: k.tytul, tresc: k.tresc, img_url: k.img_url || '', data: k.wyslano_at })),
        push_vapid: vapidPublic(),
        nazwa_klubu: ust.nazwa_klubu || 'Klub',
        pkt_za_10zl: parseInt(ust.pkt_za_10zl, 10) || 1
      };
      // Przedłużenie sesji, gdy zbliża się wygaśnięcie — klient nie wylatuje z apki
      if (p.exp - Date.now() < SESJA_ODSWIEZ_MS) {
        odp.session_nowy = makeKlubToken({ t: p.t, k: p.k, typ: 'ses', exp: Date.now() + SESJA_TTL_MS });
      }
      return res.json(odp);
    } catch (e) {
      console.error('[lojalnosc] me:', e.message);
      return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' });
    }
  });

  // Odbiór nagrody: rezerwuje punkty (saldo dostępne maleje), generuje kod.
  // Punkty schodzą z ledgera dopiero gdy recepcja/admin oznaczy WYDANE.
  router.post('/klub/nagroda_odbierz', klubLimiter, async (req, res) => {
    const p = verifyKlubToken((req.body || {}).session, 'ses');
    if (!p) return res.json({ status: 'error', code: 'SESJA', message: 'Sesja wygasła. Zaloguj się ponownie.' });
    const nagrodaId = parseInt((req.body || {}).nagroda_id, 10);
    if (!nagrodaId) return res.json({ status: 'error', message: 'Brak nagrody.' });
    try {
      const nRows = await q(
        `SELECT id, nazwa, koszt_pkt, ilosc,
                (SELECT COUNT(*) FROM Lojalnosc_Odbiory O WHERE O.tenant_id = N.tenant_id AND O.nagroda_id = N.id AND O.status IN ('OCZEKUJE','WYDANE')) AS zajete
           FROM Lojalnosc_Nagrody N WHERE tenant_id = ? AND id = ? AND status = 'AKTYWNA' LIMIT 1`,
        [p.t, nagrodaId]
      );
      const nagroda = Array.isArray(nRows) ? nRows[0] : null;
      if (!nagroda) return res.json({ status: 'error', message: 'Ta nagroda nie jest już dostępna.' });
      if (nagroda.ilosc != null && Number(nagroda.zajete) >= Number(nagroda.ilosc)) {
        return res.json({ status: 'error', message: 'Nagroda chwilowo wyczerpana.' });
      }
      const mojeRows = await q(
        `SELECT COUNT(*) AS n, COALESCE(SUM(koszt_pkt), 0) AS rez FROM Lojalnosc_Odbiory
          WHERE tenant_id = ? AND id_klienta = ? AND status = 'OCZEKUJE'`,
        [p.t, p.k]
      );
      const moje = (Array.isArray(mojeRows) && mojeRows[0]) || { n: 0, rez: 0 };
      if (Number(moje.n) >= 3) return res.json({ status: 'error', message: 'Masz już 3 nagrody czekające na odbiór — odbierz je w salonie lub anuluj.' });
      const sRows = await q(`SELECT COALESCE(SUM(zmiana), 0) AS saldo FROM Lojalnosc_Punkty WHERE tenant_id = ? AND id_klienta = ?`, [p.t, p.k]);
      const dostepne = (Number((sRows[0] || {}).saldo) || 0) - (Number(moje.rez) || 0);
      const koszt = Number(nagroda.koszt_pkt) || 0;
      if (dostepne < koszt) return res.json({ status: 'error', message: `Za mało punktów (masz ${dostepne} dostępnych, potrzeba ${koszt}).` });
      const kod = generujKod();
      await q(
        `INSERT INTO Lojalnosc_Odbiory (tenant_id, id_klienta, nagroda_id, nagroda_nazwa, koszt_pkt, kod, status)
         VALUES (?, ?, ?, ?, ?, ?, 'OCZEKUJE')`,
        [p.t, p.k, nagrodaId, nagroda.nazwa, koszt, kod]
      );
      zapiszLog(p.t, 'KLUB ODBIÓR ZGŁOSZONY', 'Klient (apka)', `Klient ${p.k}: ${nagroda.nazwa} (${koszt} pkt), kod ${kod}`);
      return res.json({ status: 'success', kod, message: 'Pokaż ten kod w salonie, aby odebrać nagrodę.' });
    } catch (e) {
      console.error('[lojalnosc] nagroda_odbierz:', e.message);
      return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' });
    }
  });

  // Anulowanie własnego oczekującego odbioru — zwalnia rezerwację punktów
  router.post('/klub/odbior_anuluj', klubLimiter, async (req, res) => {
    const p = verifyKlubToken((req.body || {}).session, 'ses');
    if (!p) return res.json({ status: 'error', code: 'SESJA', message: 'Sesja wygasła. Zaloguj się ponownie.' });
    const id = parseInt((req.body || {}).odbior_id, 10);
    if (!id) return res.json({ status: 'error', message: 'Brak odbioru.' });
    try {
      const r = await q(
        `UPDATE Lojalnosc_Odbiory SET status = 'ANULOWANY', rozstrzygnieto_at = NOW()
          WHERE tenant_id = ? AND id = ? AND id_klienta = ? AND status = 'OCZEKUJE'`,
        [p.t, id, p.k]
      );
      if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie można anulować tego odbioru.' });
      return res.json({ status: 'success' });
    } catch (e) { return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' }); }
  });

  // „BIORĘ" przy promocji dnia → zgłoszenie dla salonu (jedno aktywne per klient+promocja)
  router.post('/klub/promocja_biore', klubLimiter, async (req, res) => {
    const p = verifyKlubToken((req.body || {}).session, 'ses');
    if (!p) return res.json({ status: 'error', code: 'SESJA', message: 'Sesja wygasła. Zaloguj się ponownie.' });
    const promocjaId = parseInt((req.body || {}).promocja_id, 10);
    if (!promocjaId) return res.json({ status: 'error', message: 'Brak promocji.' });
    try {
      const prRows = await q(
        `SELECT id, tytul FROM Lojalnosc_Promocje
          WHERE tenant_id = ? AND id = ? AND status = 'AKTYWNA'
            AND (data_od IS NULL OR data_od <= CURDATE())
            AND (data_do IS NULL OR data_do >= CURDATE()) LIMIT 1`,
        [p.t, promocjaId]
      );
      const promocja = Array.isArray(prRows) ? prRows[0] : null;
      if (!promocja) return res.json({ status: 'error', message: 'Ta promocja już nie obowiązuje.' });
      const dupRows = await q(
        `SELECT id FROM Lojalnosc_Zgloszenia WHERE tenant_id = ? AND id_klienta = ? AND promocja_id = ? AND status = 'NOWE' LIMIT 1`,
        [p.t, p.k, promocjaId]
      );
      if (Array.isArray(dupRows) && dupRows.length) {
        return res.json({ status: 'success', message: 'Twoje zgłoszenie już czeka — salon się odezwie.' });
      }
      await q(
        `INSERT INTO Lojalnosc_Zgloszenia (tenant_id, id_klienta, promocja_id, promocja_tytul, status) VALUES (?, ?, ?, ?, 'NOWE')`,
        [p.t, p.k, promocjaId, promocja.tytul]
      );
      zapiszLog(p.t, 'KLUB BIORĘ', 'Klient (apka)', `Klient ${p.k}: „${promocja.tytul}"`);
      return res.json({ status: 'success', message: 'Zgłoszenie wysłane! Salon skontaktuje się z Tobą.' });
    } catch (e) { return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' }); }
  });

  // Zapis subskrypcji Web Push (zgoda marketingowa = moment włączenia powiadomień)
  router.post('/klub/push_zapisz', klubLimiter, async (req, res) => {
    const p = verifyKlubToken((req.body || {}).session, 'ses');
    if (!p) return res.json({ status: 'error', code: 'SESJA', message: 'Sesja wygasła. Zaloguj się ponownie.' });
    const sub = (req.body || {}).subscription || {};
    const endpoint = String(sub.endpoint || '').slice(0, 500);
    const p256dh = String((sub.keys || {}).p256dh || '').slice(0, 255);
    const auth = String((sub.keys || {}).auth || '').slice(0, 255);
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return res.json({ status: 'error', message: 'Nieprawidłowa subskrypcja.' });
    try {
      await q(`DELETE FROM Lojalnosc_Push WHERE tenant_id = ? AND endpoint = ?`, [p.t, endpoint]);
      await q(
        `INSERT INTO Lojalnosc_Push (tenant_id, id_klienta, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)`,
        [p.t, p.k, endpoint, p256dh, auth]
      );
      return res.json({ status: 'success' });
    } catch (e) { return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' }); }
  });

  // ─── Rejestracja z publicznego linku (IG/QR — token typ 'rej' identyfikuje salon) ───
  // Zasada bezpieczeństwa: NOWY numer → konto od ręki (nie ma czego wykraść);
  // numer ISTNIEJĄCEJ klientki → wniosek, a link aktywacyjny recepcja wysyła
  // SMS-em NA NUMER Z KARTOTEKI (nie wpisany przez wnioskodawcę).

  // Dane do ekranu rejestracji (nazwa klubu, regulamin, bonus)
  router.post('/klub/rej_info', klubLimiter, async (req, res) => {
    const p = verifyKlubToken((req.body || {}).token, 'rej');
    if (!p) return res.json({ status: 'error', message: 'Link rejestracyjny jest nieprawidłowy. Poproś salon o aktualny.' });
    try {
      const uRows = await q(`SELECT nazwa_klubu, pkt_za_10zl, bonus_powitalny_pkt FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const rRows = await q(`SELECT url FROM TenantRegulaminy WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const ust = (Array.isArray(uRows) && uRows[0]) || {};
      return res.json({
        status: 'success',
        nazwa_klubu: ust.nazwa_klubu || 'Klub',
        pkt_za_10zl: parseInt(ust.pkt_za_10zl, 10) || 1,
        bonus_powitalny: parseInt(ust.bonus_powitalny_pkt, 10) || 0,
        regulamin_url: String(((Array.isArray(rRows) && rRows[0]) || {}).url || '').trim()
      });
    } catch (e) { return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' }); }
  });

  router.post('/klub/rejestracja', loginLimiter, async (req, res) => {
    const d = req.body || {};
    const p = verifyKlubToken(d.token, 'rej');
    if (!p) return res.json({ status: 'error', message: 'Link rejestracyjny jest nieprawidłowy. Poproś salon o aktualny.' });
    const imie = String(d.imie || '').trim().slice(0, 120);
    const tel = normalizujTelefon(d.telefon);
    const pin = String(d.pin || '').trim();
    if (imie.length < 3) return res.json({ status: 'error', message: 'Podaj imię i nazwisko.' });
    if (tel.length < 9) return res.json({ status: 'error', message: 'Podaj poprawny numer telefonu.' });
    if (!/^\d{4,6}$/.test(pin)) return res.json({ status: 'error', message: 'PIN musi mieć 4–6 cyfr.' });
    if (!d.zgoda) return res.json({ status: 'error', message: 'Wymagana akceptacja regulaminu programu.' });
    try {
      // Konto na ten numer już istnieje → do logowania (właściciel telefonu i tak zna swój stan)
      const kontaRows = await q(
        `SELECT id FROM Lojalnosc_Konta WHERE tenant_id = ? AND telefon = ? AND status = 'AKTYWNE' LIMIT 1`,
        [p.t, tel]
      );
      if (Array.isArray(kontaRows) && kontaRows.length) {
        return res.json({ status: 'success', kod: 'MASZ_KONTO', message: 'Ten numer ma już konto — zaloguj się swoim PIN-em. Jeśli go nie pamiętasz, poproś salon o nowy link.' });
      }
      // Czy numer należy do istniejącej klientki? (porównanie po znormalizowanych cyfrach)
      const klienciRows = await q(
        `SELECT id_klienta, telefon, status, zmarly FROM Klienci
          WHERE tenant_id = ? AND COALESCE(telefon, '') != ''`,
        [p.t]
      ).catch(() => []);
      const istniejaca = (Array.isArray(klienciRows) ? klienciRows : [])
        .find(k => klientAktywny(k) && normalizujTelefon(k.telefon) === tel);
      if (istniejaca) {
        // Wniosek (bez duplikatu NOWY dla tego numeru)
        const dup = await q(
          `SELECT id FROM Lojalnosc_Wnioski WHERE tenant_id = ? AND telefon = ? AND status = 'NOWY' LIMIT 1`,
          [p.t, tel]
        ).catch(() => []);
        if (!(Array.isArray(dup) && dup.length)) {
          await q(
            `INSERT INTO Lojalnosc_Wnioski (tenant_id, telefon, imie, id_klienta, status) VALUES (?, ?, ?, ?, 'NOWY')`,
            [p.t, tel, imie, String(istniejaca.id_klienta)]
          );
          zapiszLog(p.t, 'KLUB WNIOSEK O KONTO', 'Klient (rejestracja)', `${imie}, tel. ${tel.slice(0, 3)}***${tel.slice(-2)} — dopasowano do kartoteki ${istniejaca.id_klienta}`);
        }
        return res.json({ status: 'success', kod: 'WNIOSEK', message: 'Znamy się już! Dla bezpieczeństwa salon wyśle Ci SMS z linkiem aktywacyjnym — zwykle w ciągu dnia.' });
      }
      // Nowa osoba → kartoteka + konto od ręki (+ ewentualny bonus powitalny)
      const maxRows = await q(
        `SELECT MAX(CAST(id_klienta AS UNSIGNED)) AS maxId FROM Klienci WHERE tenant_id = ?`, [p.t]
      );
      const noweId = String((Number((maxRows[0] || {}).maxId) || 0) + 1);
      const hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
      await q(
        `INSERT INTO Klienci (id, tenant_id, id_klienta, imie_nazwisko, telefon, data_rejestracji, zgody_rodo_reg, notatki)
         VALUES (?, ?, ?, ?, ?, NOW(), 'BRAK', 'Rejestracja online (Klub)')`,
        [randomUUID(), p.t, noweId, imie, tel]
      );
      await q(
        `INSERT INTO Lojalnosc_Konta (tenant_id, id_klienta, telefon, pin_hash, status, zgoda_regulamin_at)
         VALUES (?, ?, ?, ?, 'AKTYWNE', NOW())`,
        [p.t, noweId, tel, hash]
      );
      const uRows = await q(`SELECT bonus_powitalny_pkt FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const bonus = parseInt(((Array.isArray(uRows) && uRows[0]) || {}).bonus_powitalny_pkt, 10) || 0;
      if (bonus > 0) {
        await q(
          `INSERT INTO Lojalnosc_Punkty (tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik)
           VALUES (?, ?, ?, 'Bonus powitalny 🎉', 'BONUS', ?, 'System')`,
          [p.t, noweId, bonus, 'REJ@' + noweId]
        ).catch(() => {});
      }
      zapiszLog(p.t, 'KLUB REJESTRACJA ONLINE', 'Klient (apka)', `${imie} — nowa kartoteka ${noweId}${bonus ? `, bonus ${bonus} pkt` : ''}`);
      const session = makeKlubToken({ t: p.t, k: noweId, typ: 'ses', exp: Date.now() + SESJA_TTL_MS });
      return res.json({ status: 'success', kod: 'NOWE', session, imie: imie.split(' ')[0], bonus });
    } catch (e) {
      console.error('[lojalnosc] rejestracja:', e.message);
      return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' });
    }
  });

  // „Zapomniałam PIN-u" — bez tokenu i bez tenant: szukamy kont po numerze we
  // wszystkich salonach, tworzymy wniosek RESET. Odpowiedź ZAWSZE identyczna
  // (nie zdradzamy, czy numer ma konto). Link i tak pójdzie na numer z kartoteki.
  router.post('/klub/reset_pin', loginLimiter, async (req, res) => {
    const tel = normalizujTelefon((req.body || {}).telefon);
    const ODP = { status: 'success', message: 'Jeśli ten numer ma u nas konto, salon wyśle SMS z linkiem do ustawienia nowego PIN-u — zwykle w ciągu dnia.' };
    if (tel.length < 9) return res.json({ status: 'error', message: 'Podaj poprawny numer telefonu.' });
    try {
      const konta = await q(
        `SELECT tenant_id, id_klienta FROM Lojalnosc_Konta WHERE telefon = ? AND status = 'AKTYWNE' LIMIT 5`,
        [tel]
      ).catch(() => []);
      for (const konto of (Array.isArray(konta) ? konta : [])) {
        const dup = await q(
          `SELECT id FROM Lojalnosc_Wnioski WHERE tenant_id = ? AND telefon = ? AND typ = 'RESET' AND status = 'NOWY' LIMIT 1`,
          [konto.tenant_id, tel]
        ).catch(() => []);
        if (Array.isArray(dup) && dup.length) continue;
        await q(
          `INSERT INTO Lojalnosc_Wnioski (tenant_id, telefon, imie, id_klienta, typ, status) VALUES (?, ?, '', ?, 'RESET', 'NOWY')`,
          [konto.tenant_id, tel, String(konto.id_klienta)]
        ).catch(() => {});
        zapiszLog(konto.tenant_id, 'KLUB WNIOSEK RESET PIN', 'Klient (apka)', `Klient ${konto.id_klienta}, tel. ${tel.slice(0, 3)}***${tel.slice(-2)}`);
      }
      return res.json(ODP);
    } catch (e) { return res.json(ODP); }
  });

  // ─── Upload grafiki z panelu (multipart — poza dispatcherem JSON) ───
  // Front POST-uje bezpośrednio na /api/lojalnosc/upload z polami tenant_id,
  // user_log i plikiem "plik". RBAC admin + feature sprawdzane PO multerze.
  router.post('/lojalnosc/upload', (req, res) => {
    uploadImg.single('plik')(req, res, (errM) => {
      if (errM) return res.json({ status: 'error', message: errM.message || 'Błąd przesyłania pliku.' });
      const tenant_id = String((req.body || {}).tenant_id || '').trim();
      const kto = String((req.body || {}).user_log || '').trim();
      if (!isValidTenantId(tenant_id)) return res.json({ status: 'error', message: 'Brak tenant_id' });
      if (!req.file || !req.file.buffer) return res.json({ status: 'error', message: 'Nie wybrano pliku.' });
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, () => {
        try {
          const ext = /png$/i.test(req.file.mimetype) ? 'png' : (/webp$/i.test(req.file.mimetype) ? 'webp' : 'jpg');
          const nazwa = randomUUID() + '.' + ext;
          fs.writeFileSync(path.join(klubImgDir(tenant_id), nazwa), req.file.buffer);
          const url = `/api/klub/img/${tenant_id}/${nazwa}`;
          zapiszLog(tenant_id, 'KLUB GRAFIKA', kto, `Wgrano ${nazwa} (${Math.round(req.file.size / 1024)} KB)`);
          return res.json({ status: 'success', url });
        } catch (e) {
          console.error('[lojalnosc] upload:', e.message);
          return res.json({ status: 'error', message: 'Nie udało się zapisać pliku na serwerze.' });
        }
      }));
    });
  });

  // Publiczne serwowanie grafik Klubu (treść marketingowa salonu — widzą ją
  // klienci w apce i w powiadomieniach; nazwy plików to losowe UUID-y).
  router.get('/klub/img/:tenant/:plik', (req, res) => {
    const tenant = String(req.params.tenant || '');
    const plik = String(req.params.plik || '');
    if (!isValidTenantId(tenant) || !IMG_PLIK_REGEX.test(plik)) return res.status(404).end();
    try {
      const pelna = path.join(klubImgDir(tenant), plik);
      if (!fs.existsSync(pelna)) return res.status(404).end();
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.resolve(pelna));
    } catch (e) { return res.status(404).end(); }
  });

  return router;
};

module.exports.makeLojalnosc = makeLojalnosc;
module.exports.obliczPunkty = obliczPunkty;
module.exports.wyczyscCacheLoj = wyczyscCacheLoj;
module.exports.FEATURE_KEY = FEATURE_KEY;
module.exports.makeKlubToken = makeKlubToken;   // testy
module.exports.normalizujTelefon = normalizujTelefon;
module.exports.pasujeSegment = pasujeSegment;       // testy
module.exports.normalizujSegment = normalizujSegment;
