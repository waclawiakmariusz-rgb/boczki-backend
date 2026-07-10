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
const { randomUUID, createHmac } = require('crypto');
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
const { makePublicLimiter } = require('./sessions');
const { makeZapiszLog } = require('./logi');

const FEATURE_KEY = 'lojalnosc';
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
        `SELECT pkt_za_10zl, nazwa_klubu, updated_by, updated_at FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          const u = (Array.isArray(rows) && rows[0]) || {};
          return res.json({
            status: 'success',
            ustawienia: {
              pkt_za_10zl: parseInt(u.pkt_za_10zl, 10) || 1,
              nazwa_klubu: u.nazwa_klubu || 'Klub'
            }
          });
        }
      );

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
      const nazwa = String(d.nazwa_klubu || 'Klub').trim().slice(0, 120) || 'Klub';
      if (!Number.isFinite(pkt) || pkt < 0 || pkt > 100) {
        return res.json({ status: 'error', message: 'Punkty za 10 zł: liczba 0–100.' });
      }
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `INSERT INTO Lojalnosc_Ustawienia (tenant_id, pkt_za_10zl, nazwa_klubu, updated_by)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE pkt_za_10zl = VALUES(pkt_za_10zl), nazwa_klubu = VALUES(nazwa_klubu), updated_by = VALUES(updated_by)`,
          [tenant_id, pkt, nazwa, kto],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'KLUB USTAWIENIA', kto, `pkt_za_10zl=${pkt}, nazwa=${nazwa}`);
            return res.json({ status: 'success', message: 'Zapisano ustawienia Klubu.' });
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
      const odp = {
        status: 'success',
        imie: String(klient.imie_nazwisko || '').split(' ')[0] || '',
        saldo: Number((Array.isArray(sRows) && sRows[0] || {}).saldo) || 0,
        wpisy: (Array.isArray(wRows) ? wRows : []).map(w => ({
          zmiana: Number(w.zmiana) || 0,
          powod: w.powod || '',
          zrodlo: w.zrodlo || '',
          data: w.created_at
        })),
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

  return router;
};

module.exports.makeLojalnosc = makeLojalnosc;
module.exports.obliczPunkty = obliczPunkty;
module.exports.wyczyscCacheLoj = wyczyscCacheLoj;
module.exports.FEATURE_KEY = FEATURE_KEY;
module.exports.makeKlubToken = makeKlubToken;   // testy
module.exports.normalizujTelefon = normalizujTelefon;
