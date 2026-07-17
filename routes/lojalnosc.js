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
const KOD_AKT_DL = 4;                               // długość kodu aktywacyjnego od recepcji
const KOD_AKT_TTL_MS = 6 * 60 * 60 * 1000;          // kod aktywacyjny ważny 6 h
const KOD_AKT_MAX_PROBY = 5;                        // po tylu błędnych próbach kod się spala
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

  // Jedno zapytanie: bazowy przelicznik (pkt/10 zł) + ewentualny aktywny mnożnik czasowy
  // (np. „weekend punktów ×2"). Trzyma liczbę zapytań naliczania bez zmian.
  function pobierzNaliczanie(tenant_id, cb) {
    db.query(
      `SELECT
         (SELECT pkt_za_10zl FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1) AS pkt_za_10zl,
         (SELECT mnoznik FROM Lojalnosc_Mnozniki WHERE tenant_id = ? AND aktywny = 1
            AND NOW() BETWEEN data_od AND data_do ORDER BY mnoznik DESC LIMIT 1) AS czasowy`,
      [tenant_id, tenant_id],
      (err, rows) => {
        if (err || !Array.isArray(rows) || !rows.length) return cb(1, 1);
        const base = parseInt(rows[0].pkt_za_10zl, 10);
        const cz = parseFloat(rows[0].czasowy);
        cb(Number.isFinite(base) ? base : 1, Number.isFinite(cz) && cz > 1 ? cz : 1);
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

  // Czy klient DOŁĄCZYŁ do programu (aktywne konto w apce) — decyzja usera
  // 2026-07-10: punkty naliczają się wyłącznie członkom, nie całej kartotece.
  function maKontoKlubu(tenant_id, id_klienta, cb) {
    db.query(
      `SELECT id FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ? AND status = 'AKTYWNE' LIMIT 1`,
      [tenant_id, String(id_klienta)],
      (err, rows) => cb(!err && Array.isArray(rows) && rows.length > 0)
    );
  }

  // Domknięcie polecenia „poleć koleżankę": przy PIERWSZYM realnym zakupie poleconej
  // obie strony dostają punkty (polecenie_pkt z ustawień). Atomowy claim statusu → raz.
  // Wołane z hooka sprzedaży, więc recepcja nic dodatkowo nie klika.
  function sprawdzPolecenie(tenant_id, poleconaId, pracownik) {
    db.query(
      `SELECT P.id, P.polecajaca_id, U.polecenie_pkt
         FROM Lojalnosc_Polecenia P
         JOIN Lojalnosc_Ustawienia U ON U.tenant_id = P.tenant_id
        WHERE P.tenant_id = ? AND P.polecona_id = ? AND P.status = 'OCZEKUJE' LIMIT 1`,
      [tenant_id, String(poleconaId)],
      (err, rows) => {
        if (err || !Array.isArray(rows) || !rows.length) return;
        const r = rows[0];
        const pkt = parseInt(r.polecenie_pkt, 10) || 0;
        if (pkt <= 0) return;   // salon nie włączył nagrody za polecenia
        db.query(
          `UPDATE Lojalnosc_Polecenia SET status = 'ZREALIZOWANE', zrealizowano_at = NOW() WHERE id = ? AND status = 'OCZEKUJE'`,
          [r.id],
          (e2, u) => {
            if (e2 || !u || !u.affectedRows) return;   // inna instancja już domknęła
            wpis(tenant_id, r.polecajaca_id, pkt, 'Polecenie koleżanki 💗', 'POLECENIE', 'PIN@' + r.id, 'System');
            wpis(tenant_id, poleconaId, pkt, 'Bonus za dołączenie z polecenia 💗', 'POLECENIE', 'POUT@' + r.id, 'System');
          }
        );
      }
    );
  }

  // Sprzedaż z id_klienta → +punkty, ale TYLKO gdy klient jest członkiem Klubu.
  function naliczZaSprzedaz(tenant_id, dane) {
    try {
      const idK = String((dane && dane.id_klienta) || '').trim();
      const saleId = String((dane && dane.saleId) || '').trim();
      if (!tenant_id || !idK || !saleId) return;
      if (!((parseFloat(dane.kwota) || 0) > 0)) return;
      // Płatność zadatkiem/portfelem → punkty naliczono już przy WPŁACIE zadatku,
      // więc realizacji NIE punktujemy ponownie (bez podwójnego liczenia).
      const metoda = String((dane && dane.platnosc) || '').trim();
      if (metoda === 'Zadatek' || metoda === 'Portfel') return;
      maFeature(tenant_id, (on) => {
        if (!on) return;
        maKontoKlubu(tenant_id, idK, (czlonek) => {
          if (!czlonek) return;
          pobierzNaliczanie(tenant_id, (mnoznik, czasowy) => {
            const pkt = obliczPunkty(dane.kwota, mnoznik);
            if (pkt <= 0) return;
            wpis(tenant_id, idK, pkt, dane.opis || 'Sprzedaż', 'SPRZEDAZ', saleId, dane.pracownik);
            // Mnożnik czasowy → osobna linia bonusowa (baza korekt/zwrotów zostaje czysta).
            if (czasowy > 1) {
              const bonus = Math.floor(pkt * czasowy) - pkt;
              if (bonus > 0) {
                const etyk = Number.isInteger(czasowy) ? '×' + czasowy : '×' + czasowy.toFixed(1);
                wpis(tenant_id, idK, bonus, 'Bonus ' + etyk + ' — ' + (dane.opis || 'Sprzedaż'), 'MNOZNIK', saleId, dane.pracownik);
              }
            }
            sprawdzPolecenie(tenant_id, idK, dane.pracownik);   // domknij ew. polecenie
          });
        });
      });
    } catch (e) { console.error('[lojalnosc] naliczZaSprzedaz:', e.message); }
  }

  // Wpłata zadatku = przekazanie środków → +punkty od razu (tylko członkom Klubu).
  // Idempotentne po ref_id = id zadatku. Bazowy przelicznik, bez mnożnika czasowego.
  function naliczZaZadatek(tenant_id, dane) {
    try {
      const idK = String((dane && dane.id_klienta) || '').trim();
      const zadatekId = String((dane && dane.zadatekId) || '').trim();
      if (!tenant_id || !idK || !zadatekId) return;
      if (!((parseFloat(dane.kwota) || 0) > 0)) return;
      maFeature(tenant_id, (on) => {
        if (!on) return;
        maKontoKlubu(tenant_id, idK, (czlonek) => {
          if (!czlonek) return;
          pobierzMnoznik(tenant_id, (mnoznik) => {
            const pkt = obliczPunkty(dane.kwota, mnoznik);
            if (pkt <= 0) return;
            wpis(tenant_id, idK, pkt, dane.opis || 'Zadatek', 'ZADATEK', zadatekId, dane.pracownik);
          });
        });
      });
    } catch (e) { console.error('[lojalnosc] naliczZaZadatek:', e.message); }
  }

  // Reconcyliacja punktów zadatku po każdej zmianie (edycja kwoty, zwrot, przepadnięcie,
  // usunięcie, scalanie). Punkty należą się dopóki zadatek jest AKTYWNY lub WYKORZYSTANY;
  // ZWRÓCONY / PRZEPADŁ / USUNIĘTY / SCALONY → zerujemy. Dotyka tylko zadatków, które
  // realnie punktowały przy wpłacie (mają wpis ZADATEK) — nie tworzy punktów wstecz.
  function resyncZadatek(tenant_id, zadatekId) {
    try {
      const zid = String(zadatekId || '').trim();
      if (!tenant_id || !zid) return;
      maFeature(tenant_id, (on) => {
        if (!on) return;
        db.query(
          `SELECT status, kwota, id_klienta FROM Zadatki WHERE tenant_id = ? AND id = ? LIMIT 1`,
          [tenant_id, zid],
          (e1, zr) => {
            if (e1 || !Array.isArray(zr) || !zr.length) return;
            const z = zr[0];
            const idK = String(z.id_klienta || '').trim();
            if (!idK) return;
            const punktowalny = ['AKTYWNY', 'WYKORZYSTANY'].includes(String(z.status || '').toUpperCase());
            db.query(
              `SELECT COALESCE(SUM(zmiana), 0) AS suma, COUNT(*) AS n FROM Lojalnosc_Punkty
                WHERE tenant_id = ? AND zrodlo IN ('ZADATEK','ZADATEK_KOR')
                  AND (ref_id = ? OR ref_id LIKE CONCAT('ZK@', ?, '@%'))`,
              [tenant_id, zid, zid],
              (e2, sr) => {
                if (e2 || !Array.isArray(sr) || !sr.length) return;
                if (Number(sr[0].n) === 0) return;   // zadatek spoza programu — nie ruszamy
                const obecnie = Number(sr[0].suma) || 0;
                pobierzMnoznik(tenant_id, (mnoznik) => {
                  const cel = punktowalny ? obliczPunkty(z.kwota, mnoznik) : 0;
                  const delta = cel - obecnie;
                  if (!delta) return;
                  wpis(tenant_id, idK, delta,
                    punktowalny ? 'Korekta zadatku' : 'Zadatek anulowany/przepadł',
                    'ZADATEK_KOR', 'ZK@' + zid + '@' + Date.now(), 'System');
                });
              }
            );
          }
        );
      });
    } catch (e) { console.error('[lojalnosc] resyncZadatek:', e.message); }
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
                   OR (zrodlo = 'MNOZNIK' AND ref_id = ?)
                   OR (zrodlo = 'EDYCJA' AND ref_id LIKE CONCAT('E@', ?, '@%'))
                   OR (zrodlo = 'ZWROT'  AND ref_id LIKE CONCAT(?, '@%')))
            GROUP BY id_klienta`,
          [tenant_id, sid, sid, sid, sid],
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

  return { naliczZaSprzedaz, naliczZaZadatek, resyncZadatek, naliczZaZwrot, kompensujUsuniecie, skorygujEdycje, maKontoKlubu };
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Punkty:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Ustawienia (
      tenant_id VARCHAR(64) NOT NULL PRIMARY KEY,
      pkt_za_10zl INT NOT NULL DEFAULT 1,
      nazwa_klubu VARCHAR(120) DEFAULT 'Klub',
      updated_by VARCHAR(120) DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Kampanie:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Kampanie_Odczyty (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      kampania_id INT NOT NULL,
      id_klienta VARCHAR(64) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_odczyt (tenant_id, kampania_id, id_klienta)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Kampanie_Odczyty:', e.message);
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Wnioski:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Kody (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      id_klienta VARCHAR(64) NOT NULL,
      kod VARCHAR(8) NOT NULL,
      telefon VARCHAR(20) DEFAULT '',
      status VARCHAR(20) DEFAULT 'NOWY',
      proby INT DEFAULT 0,
      expires_at DATETIME NULL,
      utworzyl VARCHAR(120) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_kod (tenant_id, kod, status),
      KEY idx_tel (telefon, status),
      KEY idx_klient (tenant_id, id_klienta)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Kody:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Mnozniki (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      mnoznik DECIMAL(4,2) NOT NULL DEFAULT 2.00,
      opis VARCHAR(120) DEFAULT '',
      data_od DATETIME NOT NULL,
      data_do DATETIME NOT NULL,
      aktywny TINYINT DEFAULT 1,
      utworzyl VARCHAR(120) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_okno (tenant_id, aktywny, data_od, data_do)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Mnozniki:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Automaty (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      typ VARCHAR(20) NOT NULL,
      aktywny TINYINT DEFAULT 0,
      tytul VARCHAR(100) NOT NULL,
      tresc VARCHAR(300) NOT NULL,
      img_url VARCHAR(500) DEFAULT '',
      bonus_pkt INT DEFAULT 0,
      param_dni INT DEFAULT 60,
      ostatni_bieg DATE NULL,
      utworzyl VARCHAR(120) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_typ (tenant_id, typ),
      KEY idx_bieg (aktywny, ostatni_bieg)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Automaty:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Automaty_Log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      automat_id INT NOT NULL,
      id_klienta VARCHAR(64) NOT NULL,
      ref VARCHAR(60) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_wyslano (tenant_id, automat_id, id_klienta, ref)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Automaty_Log:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Poziomy (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      nazwa VARCHAR(60) NOT NULL,
      prog_zl_rocznie INT NOT NULL DEFAULT 0,
      kolor VARCHAR(20) DEFAULT '#c54f7f',
      perk VARCHAR(200) DEFAULT '',
      sortowanie INT DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_tenant (tenant_id, prog_zl_rocznie)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Poziomy:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS Lojalnosc_Polecenia (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      polecajaca_id VARCHAR(64) NOT NULL,
      polecona_id VARCHAR(64) NOT NULL,
      kod VARCHAR(12) DEFAULT '',
      status VARCHAR(20) DEFAULT 'OCZEKUJE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      zrealizowano_at DATETIME NULL,
      UNIQUE KEY uk_polecona (tenant_id, polecona_id),
      KEY idx_polecajaca (tenant_id, polecajaca_id),
      KEY idx_status (tenant_id, status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e) => {
    if (e) console.error('[lojalnosc] Migracja Lojalnosc_Polecenia:', e.message);
  });
  // Collation MUSI zgadzać się z rdzeniem Estelio (Klienci = utf8mb4_unicode_ci),
  // inaczej JOIN-y padają na "Illegal mix of collations". Konwertujemy istniejące
  // tabele tylko gdy trzeba (jeden SELECT do information_schema przy starcie).
  const LOJ_TABELE = ['Lojalnosc_Punkty', 'Lojalnosc_Ustawienia', 'Lojalnosc_Konta', 'Lojalnosc_Nagrody',
    'Lojalnosc_Odbiory', 'Lojalnosc_Promocje', 'Lojalnosc_Zgloszenia', 'Lojalnosc_Push', 'Lojalnosc_Kampanie', 'Lojalnosc_Wnioski', 'Lojalnosc_Kody', 'Lojalnosc_Mnozniki', 'Lojalnosc_Automaty', 'Lojalnosc_Automaty_Log', 'Lojalnosc_Poziomy', 'Lojalnosc_Polecenia'];
  db.query(
    `SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${LOJ_TABELE.map(() => '?').join(',')})`,
    LOJ_TABELE,
    (e, rows) => {
      if (e || !Array.isArray(rows)) return;
      rows.filter(r => String(r.TABLE_COLLATION) !== 'utf8mb4_unicode_ci').forEach(r => {
        db.query(`ALTER TABLE \`${r.TABLE_NAME}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (e2) => {
          if (e2) console.error(`[lojalnosc] CONVERT ${r.TABLE_NAME}:`, e2.message);
          else console.log(`[lojalnosc] Skonwertowano ${r.TABLE_NAME} do utf8mb4_unicode_ci`);
        });
      });
    }
  );
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
    `ALTER TABLE Lojalnosc_Kampanie ADD COLUMN widoczna_dni INT DEFAULT 30`,
    `ALTER TABLE Lojalnosc_Ustawienia ADD COLUMN reset_roczny TINYINT DEFAULT 0`,
    `ALTER TABLE Lojalnosc_Ustawienia ADD COLUMN ostatni_reset_rok INT DEFAULT 0`,
    `ALTER TABLE Lojalnosc_Nagrody ADD COLUMN polecana TINYINT DEFAULT 0`,
    `ALTER TABLE Lojalnosc_Konta ADD COLUMN kod_polec VARCHAR(12) DEFAULT ''`,
    `ALTER TABLE Lojalnosc_Ustawienia ADD COLUMN polecenie_pkt INT DEFAULT 0`,
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
    const payload = JSON.stringify({ title: tytul, body: tresc, url: '/klub/', image: img || '' });
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

  // ─── Kampanie-automaty (wyzwalane zdarzeniem) ───────────────
  // Raz dziennie: dla każdego aktywnego automatu znajdź pasujących członków,
  // daj prezent punktowy (jeśli ustawiony) + push. Log deduplikuje (raz na okazję).
  const MIESIACE_PL = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
  const AUTOMAT_TYPY = ['URODZINY', 'WINBACK', 'ROCZNICA', 'PROG_NAGRODY', 'AWANS'];
  function dzienUrodzin(s) {
    const str = String(s || '').trim();
    const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return { d: parseInt(iso[3], 10), m: parseInt(iso[2], 10) };
    const ddmm = str.match(/^(\d{1,2})[.\-/](\d{1,2})/);
    if (ddmm) return { d: parseInt(ddmm[1], 10), m: parseInt(ddmm[2], 10) };
    return null;
  }

  // Kogo automat powiadamia DZIŚ (bez deduplikacji Logiem) → [{id_klienta, ref}]
  async function kandydaciAutomatu(a) {
    const t = a.tenant_id;
    const teraz = new Date();
    const rok = teraz.getFullYear();
    if (a.typ === 'WINBACK') {
      const n = Math.max(7, parseInt(a.param_dni, 10) || 60);
      const rows = await q(
        `SELECT K.id_klienta, DATE_FORMAT(MAX(S.data_sprzedazy), '%Y-%m-%d') AS ost
           FROM Lojalnosc_Konta K
           JOIN Sprzedaz S ON S.tenant_id = K.tenant_id AND S.id_klienta = K.id_klienta
                AND COALESCE(S.status,'') != 'USUNIĘTY' AND S.kwota > 0
          WHERE K.tenant_id = ? AND K.status = 'AKTYWNE'
          GROUP BY K.id_klienta
         HAVING MAX(S.data_sprzedazy) <= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            AND MAX(S.data_sprzedazy) >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)`,
        [t, n]
      ).catch(() => []);
      return (Array.isArray(rows) ? rows : []).map(r => ({ id_klienta: String(r.id_klienta), ref: 'W@' + r.ost }));
    }
    if (a.typ === 'ROCZNICA') {
      const rows = await q(
        `SELECT K.id_klienta
           FROM Lojalnosc_Konta K
           JOIN Sprzedaz S ON S.tenant_id = K.tenant_id AND S.id_klienta = K.id_klienta
                AND COALESCE(S.status,'') != 'USUNIĘTY' AND S.kwota > 0
          WHERE K.tenant_id = ? AND K.status = 'AKTYWNE'
          GROUP BY K.id_klienta
         HAVING DATE_FORMAT(MIN(S.data_sprzedazy), '%m-%d') = DATE_FORMAT(CURDATE(), '%m-%d')
            AND YEAR(MIN(S.data_sprzedazy)) < ?`,
        [t, rok]
      ).catch(() => []);
      return (Array.isArray(rows) ? rows : []).map(r => ({ id_klienta: String(r.id_klienta), ref: 'R@' + rok }));
    }
    if (a.typ === 'PROG_NAGRODY') {
      const prog = Math.max(1, parseInt(a.param_dni, 10) || 30);
      const nagrody = await q(
        `SELECT id, koszt_pkt FROM Lojalnosc_Nagrody WHERE tenant_id = ? AND status = 'AKTYWNA' AND koszt_pkt > 0 ORDER BY koszt_pkt ASC`,
        [t]
      ).catch(() => []);
      const listaN = Array.isArray(nagrody) ? nagrody : [];
      if (!listaN.length) return [];
      const salda = await q(
        `SELECT P.id_klienta, SUM(P.zmiana) AS saldo
           FROM Lojalnosc_Punkty P
           JOIN Lojalnosc_Konta K ON K.tenant_id = P.tenant_id AND K.id_klienta = P.id_klienta AND K.status = 'AKTYWNE'
          WHERE P.tenant_id = ?
          GROUP BY P.id_klienta`,
        [t]
      ).catch(() => []);
      const out = [];
      for (const s of (Array.isArray(salda) ? salda : [])) {
        const saldo = Number(s.saldo) || 0;
        const cel = listaN.find(n => Number(n.koszt_pkt) > saldo && (Number(n.koszt_pkt) - saldo) <= prog);
        if (cel) out.push({ id_klienta: String(s.id_klienta), ref: 'P@' + cel.id });
      }
      return out;
    }
    if (a.typ === 'URODZINY') {
      const tabela = MIESIACE_PL[teraz.getMonth()];
      const czlonkowie = await q(
        `SELECT id_klienta, telefon FROM Lojalnosc_Konta WHERE tenant_id = ? AND status = 'AKTYWNE' AND COALESCE(telefon,'') <> ''`,
        [t]
      ).catch(() => []);
      if (!Array.isArray(czlonkowie) || !czlonkowie.length) return [];
      // Urodziny trzymane w miesięcznych tabelach (klucz: nazwisko/telefon, brak id_klienta) → match po telefonie
      const urodz = await q(`SELECT nr_telefonu, telefon, data_urodzin FROM \`${tabela}\` WHERE tenant_id = ?`, [t]).catch(() => []);
      const dzis = teraz.getDate(), mies = teraz.getMonth() + 1;
      const telDzis = new Set();
      for (const u of (Array.isArray(urodz) ? urodz : [])) {
        const d = dzienUrodzin(u.data_urodzin);
        if (!d || d.d !== dzis || d.m !== mies) continue;
        const a1 = normalizujTelefon(u.nr_telefonu), a2 = normalizujTelefon(u.telefon);
        if (a1) telDzis.add(a1);
        if (a2) telDzis.add(a2);
      }
      if (!telDzis.size) return [];
      return czlonkowie
        .filter(c => telDzis.has(normalizujTelefon(c.telefon)))
        .map(c => ({ id_klienta: String(c.id_klienta), ref: 'U@' + rok }));
    }
    if (a.typ === 'AWANS') {
      // Awans poziomu: klientka przekroczyła próg wydatków w tym roku → gratulacje (raz na poziom/rok)
      const poziomy = await q(
        `SELECT id, prog_zl_rocznie FROM Lojalnosc_Poziomy WHERE tenant_id = ? AND prog_zl_rocznie > 0 ORDER BY prog_zl_rocznie ASC`,
        [t]
      ).catch(() => []);
      const lp = Array.isArray(poziomy) ? poziomy : [];
      if (!lp.length) return [];
      const wyd = await q(
        `SELECT S.id_klienta, SUM(S.kwota) AS wydane
           FROM Sprzedaz S
           JOIN Lojalnosc_Konta K ON K.tenant_id = S.tenant_id AND K.id_klienta = S.id_klienta AND K.status = 'AKTYWNE'
          WHERE S.tenant_id = ? AND COALESCE(S.status,'') != 'USUNIĘTY' AND S.kwota > 0 AND YEAR(S.data_sprzedazy) = ?
          GROUP BY S.id_klienta`,
        [t, rok]
      ).catch(() => []);
      const out = [];
      for (const w of (Array.isArray(wyd) ? wyd : [])) {
        const wydane = Number(w.wydane) || 0;
        let top = null;
        for (const p of lp) if (wydane >= Number(p.prog_zl_rocznie)) top = p;
        if (top) out.push({ id_klienta: String(w.id_klienta), ref: 'AV@' + top.id + '@' + rok });
      }
      return out;
    }
    return [];
  }

  async function wykonajAutomat(a) {
    try {
      const kand = await kandydaciAutomatu(a);
      if (!kand.length) return 0;
      const nowi = [];
      for (const k of kand) {
        const ins = await q(
          `INSERT IGNORE INTO Lojalnosc_Automaty_Log (tenant_id, automat_id, id_klienta, ref) VALUES (?, ?, ?, ?)`,
          [a.tenant_id, a.id, k.id_klienta, k.ref]
        ).catch(() => null);
        if (ins && ins.affectedRows) nowi.push(k);   // tylko realnie nowi (nie powiadomieni)
      }
      if (!nowi.length) return 0;
      const bonus = parseInt(a.bonus_pkt, 10) || 0;
      if (bonus > 0) {
        for (const k of nowi) {
          await q(
            `INSERT INTO Lojalnosc_Punkty (tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik)
             VALUES (?, ?, ?, ?, 'AUTOMAT', ?, 'System')`,
            [a.tenant_id, k.id_klienta, bonus, String(a.tytul || 'Prezent').slice(0, 250), 'A' + a.id + '@' + k.id_klienta + '@' + k.ref]
          ).catch(() => {});
        }
      }
      const wynik = await wyslijPushDoKlientow(a.tenant_id, nowi.map(k => k.id_klienta), a.tytul, a.tresc, a.img_url || '');
      zapiszLog(a.tenant_id, 'KLUB AUTOMAT', 'System',
        `${a.typ} „${a.tytul}" — ${nowi.length} klientów${bonus > 0 ? (' · +' + bonus + ' pkt każdemu') : ''} · push ${wynik.dostarczono}/${wynik.subskrypcji}`);
      return nowi.length;
    } catch (e) { console.error('[lojalnosc] wykonajAutomat:', e.message); return 0; }
  }

  // Raz dziennie na automat (atomowy claim ostatni_bieg — wspólna baza dev+prod)
  async function tickAutomaty() {
    const due = await q(
      `SELECT * FROM Lojalnosc_Automaty WHERE aktywny = 1 AND (ostatni_bieg IS NULL OR ostatni_bieg < CURDATE()) LIMIT 50`, []
    ).catch(() => []);
    for (const a of (Array.isArray(due) ? due : [])) {
      const claim = await q(
        `UPDATE Lojalnosc_Automaty SET ostatni_bieg = CURDATE()
          WHERE id = ? AND aktywny = 1 AND (ostatni_bieg IS NULL OR ostatni_bieg < CURDATE())`, [a.id]
      ).catch(() => null);
      if (claim && claim.affectedRows) await wykonajAutomat(a);
    }
  }

  // Reset roczny: 1 stycznia punkty z poprzednich lat wygasają (dopisujemy WYGASNIECIE
  // = −saldo, żeby saldo spadło do zera). Idempotentne: ostatni_reset_rok (claim per salon)
  // + UNIQUE(tenant, zrodlo, ref_id) na wpisie. Wspólna baza dev+prod → atomowy claim.
  async function tickResetRoczny() {
    const rok = new Date().getFullYear();
    const salony = await q(
      `SELECT tenant_id FROM Lojalnosc_Ustawienia WHERE reset_roczny = 1 AND COALESCE(ostatni_reset_rok, 0) < ? LIMIT 50`, [rok]
    ).catch(() => []);
    for (const s of (Array.isArray(salony) ? salony : [])) {
      const claim = await q(
        `UPDATE Lojalnosc_Ustawienia SET ostatni_reset_rok = ? WHERE tenant_id = ? AND reset_roczny = 1 AND COALESCE(ostatni_reset_rok, 0) < ?`,
        [rok, s.tenant_id, rok]
      ).catch(() => null);
      if (!claim || !claim.affectedRows) continue;   // inna instancja już przejęła
      const start = `${rok}-01-01 00:00:00`;
      const konta = await q(
        `SELECT id_klienta, SUM(zmiana) AS saldo FROM Lojalnosc_Punkty
          WHERE tenant_id = ? AND created_at < ? GROUP BY id_klienta HAVING saldo > 0`, [s.tenant_id, start]
      ).catch(() => []);
      let ile = 0;
      for (const k of (Array.isArray(konta) ? konta : [])) {
        const saldo = Number(k.saldo) || 0;
        if (saldo <= 0) continue;
        const ins = await q(
          `INSERT INTO Lojalnosc_Punkty (tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik)
           VALUES (?, ?, ?, 'Punkty wygasły (koniec roku)', 'WYGASNIECIE', ?, 'System')`,
          [s.tenant_id, String(k.id_klienta), -saldo, `WYGAS@${rok}@${k.id_klienta}`]
        ).catch(() => null);
        if (ins) ile++;
      }
      zapiszLog(s.tenant_id, 'KLUB RESET ROCZNY', 'System', `Punkty z ${rok - 1} wygasły — ${ile} kont`);
    }
  }

  // ─── Scheduler (co 60 s): zaplanowane kampanie + auto-push promocji w dniu startu.
  // Baza jest WSPÓLNA dla dev i prod (dwie instancje Node!) — dlatego każdą robotę
  // najpierw atomowo claimujemy UPDATE-em; wygrywa jedna instancja.
  async function tickHarmonogramu() {
    try {
      await tickResetRoczny();
      await tickAutomaty();
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
                    hook.maKontoKlubu(tenant_id, idK, (czlonek) => {
                      return res.json({
                        status: 'success',
                        saldo: Number((sRows[0] || {}).saldo) || 0,
                        ma_konto: czlonek ? 1 : 0,
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
        `SELECT pkt_za_10zl, nazwa_klubu, bonus_powitalny_pkt, reset_roczny, polecenie_pkt, updated_by, updated_at FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          const u = (Array.isArray(rows) && rows[0]) || {};
          return res.json({
            status: 'success',
            ustawienia: {
              pkt_za_10zl: parseInt(u.pkt_za_10zl, 10) || 1,
              nazwa_klubu: u.nazwa_klubu || 'Klub',
              bonus_powitalny_pkt: parseInt(u.bonus_powitalny_pkt, 10) || 0,
              reset_roczny: Number(u.reset_roczny) ? 1 : 0,
              polecenie_pkt: parseInt(u.polecenie_pkt, 10) || 0
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
          `SELECT N.id, N.nazwa, N.opis, N.koszt_pkt, N.ilosc, N.img_url, N.status, N.sortowanie, N.polecana,
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

    } else if (action === 'loj_czlonkowie') {
      // Kto dołączył do Klubu: saldo, ostatnia wizyta, push — ocena pilota jednym rzutem oka
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT A.id_klienta, A.created_at AS dolaczyl, A.ostatnie_logowanie,
                  K.imie_nazwisko AS klient, K.telefon,
                  (SELECT COALESCE(SUM(P.zmiana), 0) FROM Lojalnosc_Punkty P WHERE P.tenant_id = A.tenant_id AND P.id_klienta = A.id_klienta) AS saldo,
                  (SELECT MAX(S.data_sprzedazy) FROM Sprzedaz S WHERE S.tenant_id = A.tenant_id AND S.id_klienta = A.id_klienta AND COALESCE(S.status,'') != 'USUNIĘTY') AS ostatnia_wizyta,
                  EXISTS(SELECT 1 FROM Lojalnosc_Push PU WHERE PU.tenant_id = A.tenant_id AND PU.id_klienta = A.id_klienta) AS ma_push
             FROM Lojalnosc_Konta A
             LEFT JOIN Klienci K ON K.tenant_id = A.tenant_id AND K.id_klienta = A.id_klienta
            WHERE A.tenant_id = ? AND A.status = 'AKTYWNE'
            ORDER BY A.created_at DESC LIMIT 500`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', czlonkowie: Array.isArray(rows) ? rows : [] });
          }
        );
      });

    } else if (action === 'loj_kampanie') {
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT K.id, K.tytul, K.tresc, K.img_url, K.segment_typ, K.segment_wartosc, K.segment_dni, K.widoczna_dni,
                  K.wyslij_at, K.status, K.wyslano_at, K.odbiorcow, K.dostarczono, K.utworzyl, K.created_at,
                  (SELECT COUNT(*) FROM Lojalnosc_Kampanie_Odczyty O WHERE O.tenant_id = K.tenant_id AND O.kampania_id = K.id) AS odczytania
             FROM Lojalnosc_Kampanie K WHERE K.tenant_id = ?
            ORDER BY (K.status = 'PLANOWANA') DESC, COALESCE(K.wyslano_at, K.wyslij_at) DESC LIMIT 50`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', kampanie: Array.isArray(rows) ? rows : [], push_skonfigurowany: webpush ? 1 : 0 });
          }
        );
      });

    } else if (action === 'loj_mnozniki') {
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT id, mnoznik, opis, data_od, data_do, aktywny,
                  (aktywny = 1 AND NOW() BETWEEN data_od AND data_do) AS trwa,
                  (data_od > NOW()) AS przyszly
             FROM Lojalnosc_Mnozniki WHERE tenant_id = ?
            ORDER BY data_od DESC LIMIT 50`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', mnozniki: Array.isArray(rows) ? rows : [] });
          }
        );
      });

    } else if (action === 'loj_automaty') {
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT A.id, A.typ, A.aktywny, A.tytul, A.tresc, A.img_url, A.bonus_pkt, A.param_dni, A.ostatni_bieg,
                  (SELECT COUNT(*) FROM Lojalnosc_Automaty_Log L WHERE L.tenant_id = A.tenant_id AND L.automat_id = A.id) AS wyslano_razem
             FROM Lojalnosc_Automaty A WHERE A.tenant_id = ? ORDER BY A.typ`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', automaty: Array.isArray(rows) ? rows : [], push_skonfigurowany: webpush ? 1 : 0 });
          }
        );
      });

    } else if (action === 'loj_poziomy') {
      const kto = String(req.query.user_log || '').trim();
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `SELECT id, nazwa, prog_zl_rocznie, kolor, perk FROM Lojalnosc_Poziomy WHERE tenant_id = ? ORDER BY prog_zl_rocznie ASC LIMIT 20`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', poziomy: Array.isArray(rows) ? rows : [] });
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
            hook.maKontoKlubu(tenant_id, idK, (czlonek) => {
              if (!czlonek) return res.json({ status: 'error', message: 'Ten klient nie dołączył jeszcze do Klubu — najpierw aktywuj mu konto (przycisk „📲 Aplikacja"), potem przyznawaj punkty.' });
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
            });
          }
        );
      }));

    } else if (action === 'loj_ustawienia_zapisz') {
      // RBAC: tylko admin — pilot Klubu w całości admin-only
      const kto = String(d.user_log || d.pracownik || '').trim();
      const pkt = parseInt(d.pkt_za_10zl, 10);
      const bonus = parseInt(d.bonus_powitalny_pkt, 10) || 0;
      const nazwa = String(d.nazwa_klubu || 'Klub').trim().slice(0, 120) || 'Klub';
      const resetRoczny = (d.reset_roczny === 1 || d.reset_roczny === '1' || d.reset_roczny === true) ? 1 : 0;
      const poleceniePkt = Math.max(0, Math.min(100000, parseInt(d.polecenie_pkt, 10) || 0));
      if (!Number.isFinite(pkt) || pkt < 0 || pkt > 100) {
        return res.json({ status: 'error', message: 'Punkty za 10 zł: liczba 0–100.' });
      }
      if (bonus < 0 || bonus > 1000) return res.json({ status: 'error', message: 'Bonus powitalny: 0–1000 pkt.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `INSERT INTO Lojalnosc_Ustawienia (tenant_id, pkt_za_10zl, nazwa_klubu, bonus_powitalny_pkt, reset_roczny, polecenie_pkt, ostatni_reset_rok, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE pkt_za_10zl = VALUES(pkt_za_10zl), nazwa_klubu = VALUES(nazwa_klubu),
             bonus_powitalny_pkt = VALUES(bonus_powitalny_pkt), reset_roczny = VALUES(reset_roczny),
             polecenie_pkt = VALUES(polecenie_pkt), updated_by = VALUES(updated_by),
             ostatni_reset_rok = IF(COALESCE(ostatni_reset_rok, 0) = 0 AND VALUES(reset_roczny) = 1, VALUES(ostatni_reset_rok), ostatni_reset_rok)`,
          // Przy PIERWSZYM włączeniu resetu ustawiamy ostatni_reset_rok = bieżący rok, żeby NIE
          // wygasić od razu tegorocznych punktów — pierwsze wygaśnięcie dopiero 1 stycznia.
          [tenant_id, pkt, nazwa, bonus, resetRoczny, poleceniePkt, new Date().getFullYear(), kto],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'KLUB USTAWIENIA', kto, `pkt_za_10zl=${pkt}, nazwa=${nazwa}, bonus_powitalny=${bonus}, reset_roczny=${resetRoczny}, polecenie=${poleceniePkt}`);
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
          const url = `${proto}://${host}/klub/?r=${encodeURIComponent(token)}`;
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
          const url = `${proto}://${host}/klub/?a=${encodeURIComponent(token)}`;
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
              const url = `${proto}://${host}/klub/?a=${encodeURIComponent(token)}`;
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

    } else if (action === 'loj_kod_aktywacyjny') {
      // Krótki kod (4 znaki) do wpisania w apce — recepcja na komputerze odczytuje go
      // klientce, ta wpisuje NUMER + KOD u siebie i ustawia PIN. Kod wiąże się z numerem
      // z kartoteki, jest jednorazowy, krótko ważny i spala się po kilku błędach —
      // dlatego mimo 4 znaków jest praktycznie nie do zgadnięcia (jak PIN karty).
      const idK = String(d.id_klienta || '').trim();
      const kto = String(d.user_log || d.pracownik || '').trim();
      if (!idK) return res.json({ status: 'error', message: 'Brak id_klienta' });
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, async () => {
        try {
          const rows = await q(`SELECT id_klienta, imie_nazwisko, telefon, status, zmarly FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [tenant_id, idK]);
          const klient = Array.isArray(rows) ? rows[0] : null;
          if (!klient) return res.json({ status: 'error', message: 'Nie znaleziono klienta w kartotece.' });
          if (!klientAktywny(klient)) return res.json({ status: 'error', message: 'Konto Klubu niedostępne dla tego klienta (status kartoteki).' });
          const tel = normalizujTelefon(klient.telefon);
          if (tel.length < 9) return res.json({ status: 'error', message: 'Klientka nie ma poprawnego numeru w kartotece — uzupełnij numer, żeby wydać kod.' });
          await q(`UPDATE Lojalnosc_Kody SET status = 'ANULOWANY' WHERE tenant_id = ? AND id_klienta = ? AND status = 'NOWY'`, [tenant_id, idK]).catch(() => {});
          let kod = null;
          for (let i = 0; i < 12; i++) {
            let k = '';
            for (let j = 0; j < KOD_AKT_DL; j++) k += KOD_ZNAKI[Math.floor(Math.random() * KOD_ZNAKI.length)];
            const kol = await q(`SELECT id FROM Lojalnosc_Kody WHERE tenant_id = ? AND kod = ? AND status = 'NOWY' AND expires_at > NOW() LIMIT 1`, [tenant_id, k]).catch(() => []);
            if (!(Array.isArray(kol) && kol.length)) { kod = k; break; }
          }
          if (!kod) return res.json({ status: 'error', message: 'Nie udało się wygenerować kodu — spróbuj ponownie.' });
          await q(
            `INSERT INTO Lojalnosc_Kody (tenant_id, id_klienta, kod, telefon, status, proby, expires_at, utworzyl)
             VALUES (?, ?, ?, ?, 'NOWY', 0, FROM_UNIXTIME(?), ?)`,
            [tenant_id, idK, kod, tel, Math.floor((Date.now() + KOD_AKT_TTL_MS) / 1000), kto.slice(0, 120)]
          );
          const kontoRows = await q(`SELECT id FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [tenant_id, idK]).catch(() => []);
          zapiszLog(tenant_id, 'KLUB KOD AKTYWACYJNY', kto, `Klient ${idK} (${klient.imie_nazwisko || ''})`);
          return res.json({
            status: 'success', kod,
            klient: klient.imie_nazwisko || '',
            telefon_masked: tel.replace(/\d(?=\d{3})/g, '•'),
            wazny_godz: Math.round(KOD_AKT_TTL_MS / 3600000),
            ma_konto: (Array.isArray(kontoRows) && kontoRows.length) ? 1 : 0
          });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      }));

    } else if (action === 'loj_app_qr') {
      // Stały QR/plakat do apki (bez tokenu) — do wydruku i powieszenia na ladzie.
      const kto = String(d.user_log || d.pracownik || '').trim();
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, async () => {
        try {
          const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
          const host = req.get('host');
          const url = `${proto}://${host}/klub/`;
          const qr = await QRCode.toDataURL(url, { margin: 1, width: 360 });
          return res.json({ status: 'success', url, qr });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
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

    } else if (action === 'loj_nagroda_polecana') {
      // Admin oznacza/odznacza nagrodę jako „polecana" (max 3 pokazywane w apce na Start).
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      const polecana = (d.polecana === 1 || d.polecana === '1' || d.polecana === true) ? 1 : 0;
      if (!id) return res.json({ status: 'error', message: 'Brak nagrody.' });
      wymagajAdmina(tenant_id, kto, res, async () => {
        try {
          if (polecana) {
            const cnt = await q(`SELECT COUNT(*) AS n FROM Lojalnosc_Nagrody WHERE tenant_id = ? AND polecana = 1 AND id <> ?`, [tenant_id, id]);
            if (Number((cnt[0] || {}).n) >= 3) {
              return res.json({ status: 'error', message: 'Możesz polecić maksymalnie 3 nagrody. Odznacz najpierw jedną z polecanych.' });
            }
          }
          const r = await q(`UPDATE Lojalnosc_Nagrody SET polecana = ? WHERE tenant_id = ? AND id = ?`, [polecana, tenant_id, id]);
          if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono nagrody.' });
          zapiszLog(tenant_id, 'KLUB NAGRODA', kto, `Polecana #${id} → ${polecana ? 'TAK' : 'nie'}`);
          return res.json({ status: 'success', polecana });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
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
            const payload = JSON.stringify({ title: tytul, body: tresc, url: '/klub/' });
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
      const widocznaDniRaw = parseInt(d.widoczna_dni, 10);
      const widocznaDni = Number.isFinite(widocznaDniRaw) && widocznaDniRaw >= 1 && widocznaDniRaw <= 90 ? widocznaDniRaw : 30;
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
          // Edycja ZAPLANOWANEJ (jeszcze niewysłanej) kampanii — d.id + nowy termin wymagany
          const editId = parseInt(d.id, 10);
          if (editId) {
            if (!wyslijAt) return res.json({ status: 'error', message: 'Przy edycji zaplanowanej kampanii podaj termin wysyłki.' });
            const r = await q(
              `UPDATE Lojalnosc_Kampanie SET tytul = ?, tresc = ?, img_url = ?, segment_typ = ?, segment_wartosc = ?,
                      segment_dni = ?, widoczna_dni = ?, wyslij_at = ?
                WHERE tenant_id = ? AND id = ? AND status = 'PLANOWANA'`,
              [tytul, tresc, img, seg.typ, seg.wartosc, seg.dni, widocznaDni, wyslijAt, tenant_id, editId]
            );
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Tę kampanię można edytować tylko przed wysyłką.' });
            zapiszLog(tenant_id, 'KLUB KAMPANIA EDYCJA', kto, `#${editId} „${tytul}" na ${wyslijAt}`);
            return res.json({ status: 'success', zaplanowana: 1, wyslij_at: wyslijAt });
          }
          const teraz = !wyslijAt;
          const wynik = await q(
            `INSERT INTO Lojalnosc_Kampanie (tenant_id, tytul, tresc, img_url, segment_typ, segment_wartosc, segment_dni, widoczna_dni, wyslij_at, status, utworzyl)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${teraz ? 'NOW()' : '?'}, ?, ?)`,
            teraz
              ? [tenant_id, tytul, tresc, img, seg.typ, seg.wartosc, seg.dni, widocznaDni, 'WYSYLANIE', kto.slice(0, 120)]
              : [tenant_id, tytul, tresc, img, seg.typ, seg.wartosc, seg.dni, widocznaDni, wyslijAt, 'PLANOWANA', kto.slice(0, 120)]
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

    } else if (action === 'loj_kampania_wycofaj') {
      // Wycofanie WYSŁANEJ kampanii — znika ze skrzynek w apce natychmiast.
      // Pushów, które już dotarły na telefony, cofnąć się nie da.
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      if (!id) return res.json({ status: 'error', message: 'Brak kampanii.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `UPDATE Lojalnosc_Kampanie SET status = 'WYCOFANA' WHERE tenant_id = ? AND id = ? AND status = 'WYSLANA'`,
          [tenant_id, id],
          (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Można wycofać tylko wysłaną kampanię.' });
            zapiszLog(tenant_id, 'KLUB KAMPANIA WYCOFANA', kto, `#${id} — usunięta ze skrzynek w apce`);
            return res.json({ status: 'success' });
          }
        );
      });

    } else if (action === 'loj_kampania_edytuj') {
      // Poprawka treści już WYSŁANEJ kampanii — zmiana widoczna od razu w skrzynkach w apce
      // (apka czyta wiersz na żywo). Segmentu i terminu nie ruszamy — kampania już poszła.
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      const tytul = String(d.tytul || '').trim().slice(0, 100);
      const tresc = String(d.tresc || '').trim().slice(0, 300);
      const img = String(d.img_url || '').trim().slice(0, 500);
      const widocznaDniRaw = parseInt(d.widoczna_dni, 10);
      const widocznaDni = Number.isFinite(widocznaDniRaw) && widocznaDniRaw >= 1 && widocznaDniRaw <= 90 ? widocznaDniRaw : 30;
      if (!id) return res.json({ status: 'error', message: 'Brak kampanii.' });
      if (!tytul || !tresc) return res.json({ status: 'error', message: 'Podaj tytuł i treść.' });
      if (!imgUrlOk(img)) return res.json({ status: 'error', message: 'Zdjęcie: wgraj plik albo podaj pełny adres URL.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `UPDATE Lojalnosc_Kampanie SET tytul = ?, tresc = ?, img_url = ?, widoczna_dni = ?
            WHERE tenant_id = ? AND id = ? AND status = 'WYSLANA'`,
          [tytul, tresc, img, widocznaDni, tenant_id, id],
          (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Edytować treść można tylko w wysłanej kampanii.' });
            zapiszLog(tenant_id, 'KLUB KAMPANIA EDYCJA TREŚCI', kto, `#${id} „${tytul}"`);
            return res.json({ status: 'success', edytowana: 1 });
          }
        );
      });

    } else if (action === 'loj_kampania_kasuj') {
      // Trwałe skasowanie — znika z listy w panelu, a jeśli była wysłana, także ze skrzynek w apce.
      // Pushów, które już dotarły na telefony, cofnąć się nie da.
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      if (!id) return res.json({ status: 'error', message: 'Brak kampanii.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(`DELETE FROM Lojalnosc_Kampanie_Odczyty WHERE tenant_id = ? AND kampania_id = ?`, [tenant_id, id], (e1) => {
          if (e1) return res.json({ status: 'error', message: e1.message });
          db.query(`DELETE FROM Lojalnosc_Kampanie WHERE tenant_id = ? AND id = ?`, [tenant_id, id], (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono kampanii.' });
            zapiszLog(tenant_id, 'KLUB KAMPANIA SKASOWANA', kto, `#${id}`);
            return res.json({ status: 'success' });
          });
        });
      });

    } else if (action === 'loj_mnoznik_zapisz') {
      // Okno mnożnika punktów (np. „weekend ×2"). Zderza się przy naliczaniu sprzedaży.
      const kto = String(d.user_log || d.pracownik || '').trim();
      const editId = parseInt(d.id, 10) || 0;
      const mnoznik = Math.round((parseFloat(String(d.mnoznik).replace(',', '.')) || 0) * 100) / 100;
      const opis = String(d.opis || '').trim().slice(0, 120);
      const aktywny = Number(d.aktywny) === 0 ? 0 : 1;
      const norm = (v) => {
        const m = String(v || '').trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
        return m ? `${m[1]} ${m[2]}:00` : null;
      };
      const od = norm(d.data_od), doo = norm(d.data_do);
      if (!(mnoznik >= 1.1 && mnoznik <= 10)) return res.json({ status: 'error', message: 'Mnożnik z zakresu 1,1–10 (np. 2 = punkty ×2).' });
      if (!od || !doo) return res.json({ status: 'error', message: 'Podaj początek i koniec okna (data + godzina).' });
      if (doo <= od) return res.json({ status: 'error', message: 'Koniec musi być po początku.' });
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, () => {
        if (editId) {
          db.query(
            `UPDATE Lojalnosc_Mnozniki SET mnoznik = ?, opis = ?, data_od = ?, data_do = ?, aktywny = ?
              WHERE tenant_id = ? AND id = ?`,
            [mnoznik, opis, od, doo, aktywny, tenant_id, editId],
            (err, r) => {
              if (err) return res.json({ status: 'error', message: err.message });
              if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono mnożnika.' });
              zapiszLog(tenant_id, 'KLUB MNOZNIK EDYCJA', kto, `#${editId} ×${mnoznik} ${od}→${doo}`);
              return res.json({ status: 'success' });
            }
          );
        } else {
          db.query(
            `INSERT INTO Lojalnosc_Mnozniki (tenant_id, mnoznik, opis, data_od, data_do, aktywny, utworzyl)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [tenant_id, mnoznik, opis, od, doo, aktywny, kto.slice(0, 120)],
            (err) => {
              if (err) return res.json({ status: 'error', message: err.message });
              zapiszLog(tenant_id, 'KLUB MNOZNIK', kto, `×${mnoznik} ${od}→${doo} ${opis}`);
              return res.json({ status: 'success' });
            }
          );
        }
      }));

    } else if (action === 'loj_mnoznik_usun') {
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      if (!id) return res.json({ status: 'error', message: 'Brak mnożnika.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `DELETE FROM Lojalnosc_Mnozniki WHERE tenant_id = ? AND id = ?`,
          [tenant_id, id],
          (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono mnożnika.' });
            zapiszLog(tenant_id, 'KLUB MNOZNIK USUNIETY', kto, `#${id}`);
            return res.json({ status: 'success' });
          }
        );
      });

    } else if (action === 'loj_automat_zapisz') {
      // Automat wyzwalany zdarzeniem (urodziny / brak wizyty / rocznica / próg nagrody).
      const kto = String(d.user_log || d.pracownik || '').trim();
      const typ = String(d.typ || '').toUpperCase().trim();
      const tytul = String(d.tytul || '').trim().slice(0, 100);
      const tresc = String(d.tresc || '').trim().slice(0, 300);
      const img = String(d.img_url || '').trim().slice(0, 500);
      const bonus = Math.max(0, Math.min(100000, parseInt(d.bonus_pkt, 10) || 0));
      const aktywny = Number(d.aktywny) ? 1 : 0;
      const paramDni = Math.max(1, Math.min(3650, parseInt(d.param_dni, 10) || (typ === 'PROG_NAGRODY' ? 30 : 60)));
      if (!AUTOMAT_TYPY.includes(typ)) return res.json({ status: 'error', message: 'Nieznany typ automatu.' });
      if (!tytul || !tresc) return res.json({ status: 'error', message: 'Podaj tytuł i treść.' });
      if (!imgUrlOk(img)) return res.json({ status: 'error', message: 'Zdjęcie: wgraj plik albo podaj pełny adres URL.' });
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `INSERT INTO Lojalnosc_Automaty (tenant_id, typ, aktywny, tytul, tresc, img_url, bonus_pkt, param_dni, utworzyl)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE aktywny = VALUES(aktywny), tytul = VALUES(tytul), tresc = VALUES(tresc),
             img_url = VALUES(img_url), bonus_pkt = VALUES(bonus_pkt), param_dni = VALUES(param_dni)`,
          [tenant_id, typ, aktywny, tytul, tresc, img, bonus, paramDni, kto.slice(0, 120)],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'KLUB AUTOMAT ZAPIS', kto, `${typ} „${tytul}" ${aktywny ? 'WŁ' : 'wył'}${bonus ? ' +' + bonus + 'pkt' : ''}`);
            return res.json({ status: 'success' });
          }
        );
      }));

    } else if (action === 'loj_automat_status') {
      const kto = String(d.user_log || d.pracownik || '').trim();
      const typ = String(d.typ || '').toUpperCase().trim();
      const aktywny = Number(d.aktywny) ? 1 : 0;
      if (!AUTOMAT_TYPY.includes(typ)) return res.json({ status: 'error', message: 'Nieznany typ automatu.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `UPDATE Lojalnosc_Automaty SET aktywny = ? WHERE tenant_id = ? AND typ = ?`,
          [aktywny, tenant_id, typ],
          (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Najpierw zapisz treść automatu.' });
            zapiszLog(tenant_id, 'KLUB AUTOMAT ' + (aktywny ? 'WŁĄCZONY' : 'WYŁĄCZONY'), kto, typ);
            return res.json({ status: 'success' });
          }
        );
      });

    } else if (action === 'loj_poziom_zapisz') {
      // Poziom klubu (Srebro/Złoto/Diament…) — próg wg rocznych wydatków klientki.
      const kto = String(d.user_log || d.pracownik || '').trim();
      const editId = parseInt(d.id, 10) || 0;
      const nazwa = String(d.nazwa || '').trim().slice(0, 60);
      const prog = Math.max(0, Math.min(10000000, parseInt(d.prog_zl_rocznie, 10) || 0));
      const kolor = /^#[0-9a-fA-F]{3,8}$/.test(String(d.kolor || '').trim()) ? String(d.kolor).trim() : '#c54f7f';
      const perk = String(d.perk || '').trim().slice(0, 200);
      if (!nazwa) return res.json({ status: 'error', message: 'Podaj nazwę poziomu.' });
      maFeatureLubBlad(tenant_id, res, () => wymagajAdmina(tenant_id, kto, res, () => {
        if (editId) {
          db.query(
            `UPDATE Lojalnosc_Poziomy SET nazwa = ?, prog_zl_rocznie = ?, kolor = ?, perk = ? WHERE tenant_id = ? AND id = ?`,
            [nazwa, prog, kolor, perk, tenant_id, editId],
            (err, r) => {
              if (err) return res.json({ status: 'error', message: err.message });
              if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono poziomu.' });
              zapiszLog(tenant_id, 'KLUB POZIOM EDYCJA', kto, `#${editId} ${nazwa} (${prog} zł)`);
              return res.json({ status: 'success' });
            }
          );
        } else {
          db.query(
            `INSERT INTO Lojalnosc_Poziomy (tenant_id, nazwa, prog_zl_rocznie, kolor, perk, sortowanie) VALUES (?, ?, ?, ?, ?, ?)`,
            [tenant_id, nazwa, prog, kolor, perk, prog],
            (err) => {
              if (err) return res.json({ status: 'error', message: err.message });
              zapiszLog(tenant_id, 'KLUB POZIOM', kto, `${nazwa} (${prog} zł)`);
              return res.json({ status: 'success' });
            }
          );
        }
      }));

    } else if (action === 'loj_poziom_usun') {
      const kto = String(d.user_log || d.pracownik || '').trim();
      const id = parseInt(d.id, 10);
      if (!id) return res.json({ status: 'error', message: 'Brak poziomu.' });
      wymagajAdmina(tenant_id, kto, res, () => {
        db.query(
          `DELETE FROM Lojalnosc_Poziomy WHERE tenant_id = ? AND id = ?`,
          [tenant_id, id],
          (err, r) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono poziomu.' });
            zapiszLog(tenant_id, 'KLUB POZIOM USUNIETY', kto, `#${id}`);
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
      const kRows = await q(`SELECT imie_nazwisko, telefon, status, zmarly FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [p.t, p.k]);
      const klient = Array.isArray(kRows) ? kRows[0] : null;
      if (!klientAktywny(klient)) return res.json({ status: 'error', message: 'Link nieaktualny. Poproś salon o nowy.' });
      const uRows = await q(`SELECT nazwa_klubu, pkt_za_10zl FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const rRows = await q(`SELECT url, tresc FROM TenantRegulaminy WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const ust = (Array.isArray(uRows) && uRows[0]) || {};
      const reg = (Array.isArray(rRows) && rRows[0]) || {};
      // Czy numer ma już PIN w apce (inny salon) i nie ma jeszcze konta w TYM salonie?
      // Wtedy aktywacja dziedziczy istniejący PIN — klient nie ustawia nowego.
      const dziedziczy = await pinDoOdziedziczenia(normalizujTelefon(klient.telefon), p.t, p.k);
      return res.json({
        status: 'success',
        imie: String(klient.imie_nazwisko || '').split(' ')[0] || '',
        nazwa_klubu: ust.nazwa_klubu || 'Klub',
        pkt_za_10zl: parseInt(ust.pkt_za_10zl, 10) || 1,
        regulamin_url: String(reg.url || '').trim(),
        dziedziczy_pin: dziedziczy ? 1 : 0
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
    if (!d.zgoda) return res.json({ status: 'error', message: 'Wymagana akceptacja regulaminu programu.' });
    try {
      const kRows = await q(`SELECT imie_nazwisko, telefon, status, zmarly FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [p.t, p.k]);
      const klient = Array.isArray(kRows) ? kRows[0] : null;
      if (!klientAktywny(klient)) return res.json({ status: 'error', message: 'Link nieaktualny. Poproś salon o nowy.' });
      const tel = normalizujTelefon(klient.telefon);
      // Numer ma już PIN w apce (inny salon)? Nowe konto dziedziczy go — jeden PIN na numer.
      const odziedziczony = await pinDoOdziedziczenia(tel, p.t, p.k);
      let hash = odziedziczony;
      if (!hash) {
        if (!/^\d{4,6}$/.test(pin)) return res.json({ status: 'error', message: 'PIN musi mieć 4–6 cyfr.' });
        hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
      }
      await q(
        `INSERT INTO Lojalnosc_Konta (tenant_id, id_klienta, telefon, pin_hash, status, zgoda_regulamin_at)
         VALUES (?, ?, ?, ?, 'AKTYWNE', NOW())
         ON DUPLICATE KEY UPDATE telefon = VALUES(telefon), pin_hash = VALUES(pin_hash), status = 'AKTYWNE', zgoda_regulamin_at = NOW()`,
        [p.t, p.k, tel, hash]
      );
      zapiszLog(p.t, 'KLUB AKTYWACJA KONTA', 'Klient (apka)', `Klient ${p.k} (${klient.imie_nazwisko || ''}) aktywował konto Klubu${odziedziczony ? ' (PIN z aplikacji)' : ''}`);
      const session = makeKlubToken({ t: p.t, k: p.k, typ: 'ses', exp: Date.now() + SESJA_TTL_MS });
      return res.json({ status: 'success', session, imie: String(klient.imie_nazwisko || '').split(' ')[0] || '', pin_dziedziczony: odziedziczony ? 1 : 0 });
    } catch (e) {
      console.error('[lojalnosc] aktywuj:', e.message);
      return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' });
    }
  });

  // Aktywacja krótkim kodem od recepcji: NUMER + KOD + PIN. Kod musi pasować do numeru
  // (wiązanie z kartoteką), być NOWY i nieprzeterminowany. Po kilku błędach kod się spala.
  // loginLimiter chroni przed enumeracją; dzięki temu 4-znakowy kod jest bezpieczny.
  router.post('/klub/aktywuj_kod', loginLimiter, async (req, res) => {
    const d = req.body || {};
    const tel = normalizujTelefon(d.telefon);
    const kod = String(d.kod || '').trim().toUpperCase().replace(/\s/g, '');
    const pin = String(d.pin || '').trim();
    if (tel.length < 9) return res.json({ status: 'error', message: 'Podaj poprawny numer telefonu.' });
    if (kod.length < 3) return res.json({ status: 'error', message: 'Podaj kod od recepcji.' });
    if (!d.zgoda) return res.json({ status: 'error', message: 'Wymagana akceptacja regulaminu programu.' });
    const zle = () => res.json({ status: 'error', message: 'Zły numer lub kod, albo kod wygasł. Poproś recepcję o nowy.' });
    try {
      const kody = await q(
        `SELECT id, tenant_id, id_klienta, kod, proby FROM Lojalnosc_Kody
          WHERE telefon = ? AND status = 'NOWY' AND expires_at > NOW() LIMIT 10`,
        [tel]
      ).catch(() => []);
      const lista = Array.isArray(kody) ? kody : [];
      const trafiony = lista.find(k => String(k.kod).toUpperCase() === kod);
      if (!trafiony) {
        // bezpiecznik: po zbyt wielu błędach spal aktywne kody tego numeru
        for (const k of lista) {
          const proby = (Number(k.proby) || 0) + 1;
          if (proby >= KOD_AKT_MAX_PROBY) await q(`UPDATE Lojalnosc_Kody SET status = 'ANULOWANY' WHERE id = ?`, [k.id]).catch(() => {});
          else await q(`UPDATE Lojalnosc_Kody SET proby = ? WHERE id = ?`, [proby, k.id]).catch(() => {});
        }
        return zle();
      }
      const kRows = await q(`SELECT imie_nazwisko, telefon, status, zmarly FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [trafiony.tenant_id, String(trafiony.id_klienta)]);
      const klient = Array.isArray(kRows) ? kRows[0] : null;
      if (!klientAktywny(klient)) { await q(`UPDATE Lojalnosc_Kody SET status = 'ANULOWANY' WHERE id = ?`, [trafiony.id]).catch(() => {}); return zle(); }
      // PIN dziedziczony, jeśli numer ma już konto w innym salonie (jeden PIN na numer)
      const odziedziczony = await pinDoOdziedziczenia(tel, trafiony.tenant_id, String(trafiony.id_klienta));
      let hash = odziedziczony;
      if (!hash) {
        if (!/^\d{4,6}$/.test(pin)) return res.json({ status: 'error', message: 'Ustaw PIN: 4–6 cyfr.' });
        hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
      }
      await q(
        `INSERT INTO Lojalnosc_Konta (tenant_id, id_klienta, telefon, pin_hash, status, zgoda_regulamin_at)
         VALUES (?, ?, ?, ?, 'AKTYWNE', NOW())
         ON DUPLICATE KEY UPDATE telefon = VALUES(telefon), pin_hash = VALUES(pin_hash), status = 'AKTYWNE', zgoda_regulamin_at = NOW()`,
        [trafiony.tenant_id, String(trafiony.id_klienta), tel, hash]
      );
      await q(`UPDATE Lojalnosc_Kody SET status = 'UZYTY' WHERE id = ?`, [trafiony.id]).catch(() => {});
      zapiszLog(trafiony.tenant_id, 'KLUB AKTYWACJA KODEM', 'Klient (apka)', `Klient ${trafiony.id_klienta}${odziedziczony ? ' (PIN z aplikacji)' : ''}`);
      const session = makeKlubToken({ t: trafiony.tenant_id, k: String(trafiony.id_klienta), typ: 'ses', exp: Date.now() + SESJA_TTL_MS });
      return res.json({ status: 'success', session, imie: String(klient.imie_nazwisko || '').split(' ')[0] || '', pin_dziedziczony: odziedziczony ? 1 : 0 });
    } catch (e) {
      console.error('[lojalnosc] aktywuj_kod:', e.message);
      return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' });
    }
  });

  // Wspólna tożsamość klienta = numer telefonu. Jeden numer może mieć konto
  // w kilku salonach (osobne saldo/nagrody per salon, wspólne logowanie).
  // Zwraca dla każdego AKTYWNEGO konta numeru: tenant, nazwa salonu, saldo, pin_hash.
  async function salonyKlienta(tel) {
    const konta = await q(
      `SELECT tenant_id, id_klienta, pin_hash FROM Lojalnosc_Konta WHERE telefon = ? AND status = 'AKTYWNE' LIMIT 20`,
      [tel]
    ).catch(() => []);
    const out = [];
    for (const k of (Array.isArray(konta) ? konta : [])) {
      const lic = await q(`SELECT nazwa_salonu FROM Licencje WHERE id_bazy = ? LIMIT 1`, [k.tenant_id]).catch(() => []);
      const sal = await q(`SELECT COALESCE(SUM(zmiana), 0) AS saldo FROM Lojalnosc_Punkty WHERE tenant_id = ? AND id_klienta = ?`, [k.tenant_id, k.id_klienta]).catch(() => []);
      out.push({
        tenant: k.tenant_id,
        id_klienta: String(k.id_klienta),
        nazwa: (Array.isArray(lic) && lic[0] && lic[0].nazwa_salonu) || 'Salon',
        saldo: Number((Array.isArray(sal) && sal[0] || {}).saldo) || 0,
        pin_hash: k.pin_hash
      });
    }
    return out;
  }

  // PIN do odziedziczenia: gdy numer ma już PIN w apce (inny salon), a w TYM salonie
  // klient nie ma jeszcze konta — nowe konto przejmuje ten sam PIN (jeden PIN na numer).
  // Świadomie działa TYLKO w jedną stronę: tworzone nowe konto = istniejący PIN.
  // Nigdy nie nadpisuje kont w innych salonach (brak zapisu cross-tenant = bezpieczeństwo).
  async function pinDoOdziedziczenia(tel, tenant, idKlienta) {
    if (!tel || tel.length < 9) return null;
    const juzTu = await q(`SELECT id FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [tenant, idKlienta]).catch(() => []);
    if (Array.isArray(juzTu) && juzTu.length) return null;   // ponowna aktywacja = reset PIN w tym salonie, nie dziedziczymy
    const inne = await q(
      `SELECT pin_hash FROM Lojalnosc_Konta WHERE telefon = ? AND status = 'AKTYWNE' AND tenant_id <> ? AND pin_hash <> '' LIMIT 1`,
      [tel, tenant]
    ).catch(() => []);
    return (Array.isArray(inne) && inne[0] && inne[0].pin_hash) ? inne[0].pin_hash : null;
  }

  // Logowanie: telefon + PIN. Komunikat błędu celowo jednakowy dla złego
  // telefonu i złego PIN-u (nie zdradzamy, czy numer istnieje w bazie).
  // Zwraca PACZKĘ salonów tego numeru dopasowanych PIN-em — front sam wybiera/przełącza.
  router.post('/klub/login', loginLimiter, async (req, res) => {
    const d = req.body || {};
    const tel = normalizujTelefon(d.telefon);
    const pin = String(d.pin || '').trim();
    const blednedane = () => res.json({ status: 'error', message: 'Błędny numer telefonu lub PIN.' });
    if (tel.length < 9 || !/^\d{4,6}$/.test(pin)) return blednedane();
    try {
      const wszystkie = await salonyKlienta(tel);
      if (!wszystkie.length) return blednedane();
      const pasujace = [];
      let innePinem = 0;
      for (const s of wszystkie) {
        const ok = await bcrypt.compare(pin, String(s.pin_hash || '')).catch(() => false);
        if (ok) pasujace.push(s); else innePinem++;
      }
      if (!pasujace.length) return blednedane();
      for (const s of pasujace) {
        db.query(`UPDATE Lojalnosc_Konta SET ostatnie_logowanie = NOW() WHERE tenant_id = ? AND id_klienta = ?`, [s.tenant, s.id_klienta], () => {});
      }
      const salony = pasujace.map(s => ({
        tenant: s.tenant, nazwa: s.nazwa, saldo: s.saldo,
        session: makeKlubToken({ t: s.tenant, k: s.id_klienta, typ: 'ses', exp: Date.now() + SESJA_TTL_MS })
      }));
      return res.json({
        status: 'success',
        salony,
        domyslny: salony[0].tenant,
        inne_pinem: innePinem,          // konta tego numeru z INNYM PIN-em (do dołączenia osobnym logowaniem)
        session: salony[0].session      // wsteczna zgodność ze starszym frontem
      });
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
      // Historia dla klientki: NIE pokazujemy wpisu wygaśnięcia (rodziłby złość — „−180 wygasło").
      // Przy resecie rocznym (filtr niżej) zostają tylko wpisy z bieżącego roku → wygląda jak
      // świeży start, a nie kara. Saldo i tak spójne (suma księgi = punkty bieżącego sezonu).
      const wRows = await q(
        `SELECT zmiana, powod, zrodlo, created_at FROM Lojalnosc_Punkty
          WHERE tenant_id = ? AND id_klienta = ? AND zrodlo <> 'WYGASNIECIE' ORDER BY id DESC LIMIT 20`,
        [p.t, p.k]
      );
      const uRows = await q(`SELECT nazwa_klubu, pkt_za_10zl, reset_roczny, polecenie_pkt FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const ust = (Array.isArray(uRows) && uRows[0]) || {};
      const rokStartMs = new Date(new Date().getFullYear(), 0, 1).getTime();
      // Faza 3: nagrody + moje oczekujące odbiory (saldo dostępne = saldo − rezerwacje)
      const rezRows = await q(
        `SELECT COALESCE(SUM(koszt_pkt), 0) AS rez FROM Lojalnosc_Odbiory WHERE tenant_id = ? AND id_klienta = ? AND status = 'OCZEKUJE'`,
        [p.t, p.k]
      ).catch(() => [{ rez: 0 }]);
      const nagrodyRows = await q(
        `SELECT id, nazwa, opis, koszt_pkt, ilosc, img_url, polecana,
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
          WHERE tenant_id = ? AND status = 'WYSLANA'
            AND wyslano_at >= DATE_SUB(NOW(), INTERVAL COALESCE(widoczna_dni, 30) DAY)
          ORDER BY wyslano_at DESC LIMIT 10`,
        [p.t]
      ).catch(() => []);
      // Mnożnik punktów aktywny teraz (np. „weekend ×2") → baner w apce
      const mnoznikRows = await q(
        `SELECT mnoznik, opis, data_do FROM Lojalnosc_Mnozniki
          WHERE tenant_id = ? AND aktywny = 1 AND NOW() BETWEEN data_od AND data_do
          ORDER BY mnoznik DESC LIMIT 1`,
        [p.t]
      ).catch(() => []);
      const mn = (Array.isArray(mnoznikRows) && mnoznikRows[0]) || null;
      // Poziom klubu: liczony z wydatków klientki w bieżącym roku (nie z punktów — poziom
      // nie znika przy resecie punktów). Widoczny tylko gdy salon zdefiniował poziomy.
      const wydRows = await q(
        `SELECT COALESCE(SUM(kwota), 0) AS wydane FROM Sprzedaz
          WHERE tenant_id = ? AND id_klienta = ? AND COALESCE(status,'') != 'USUNIĘTY' AND kwota > 0
            AND YEAR(data_sprzedazy) = YEAR(CURDATE())`,
        [p.t, p.k]
      ).catch(() => [{ wydane: 0 }]);
      const poziomyRows = await q(
        `SELECT nazwa, prog_zl_rocznie, kolor, perk FROM Lojalnosc_Poziomy WHERE tenant_id = ? ORDER BY prog_zl_rocznie ASC`,
        [p.t]
      ).catch(() => []);
      const wydane = Math.round(Number((Array.isArray(wydRows) && wydRows[0] || {}).wydane) || 0);
      const listaPoz = Array.isArray(poziomyRows) ? poziomyRows : [];
      let poziom = null;
      if (listaPoz.length) {
        let obecny = null, nastepny = null;
        for (const pz of listaPoz) { if (wydane >= Number(pz.prog_zl_rocznie)) obecny = pz; }
        for (const pz of listaPoz) { if (Number(pz.prog_zl_rocznie) > wydane) { nastepny = pz; break; } }
        poziom = {
          nazwa: obecny ? obecny.nazwa : null,
          kolor: obecny ? (obecny.kolor || '#c54f7f') : '#9ca3af',
          perk: obecny ? (obecny.perk || '') : '',
          wydane,
          nastepny: nastepny ? { nazwa: nastepny.nazwa, prog: Number(nastepny.prog_zl_rocznie), brakuje: Math.max(0, Number(nastepny.prog_zl_rocznie) - wydane) } : null
        };
      }
      const odp = {
        status: 'success',
        imie: String(klient.imie_nazwisko || '').split(' ')[0] || '',
        saldo,
        saldo_dostepne: saldo - zarezerwowane,
        wpisy: (Array.isArray(wRows) ? wRows : [])
          .filter(w => !Number(ust.reset_roczny) || new Date(String(w.created_at || '').replace(' ', 'T')).getTime() >= rokStartMs)
          .map(w => ({
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
          polecana: Number(n.polecana) ? 1 : 0,
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
        pkt_za_10zl: parseInt(ust.pkt_za_10zl, 10) || 1,
        // Reset roczny: punkty ważne do 31.12 bieżącego roku (motywacja: wykorzystaj przed końcem roku)
        punkty_do: Number(ust.reset_roczny) ? (new Date().getFullYear() + '-12-31') : null,
        // Mnożnik czasowy — apka pokazuje baner „Punkty ×2 do …"
        mnoznik_aktywny: (mn && Number(mn.mnoznik) > 1)
          ? { mnoznik: Number(mn.mnoznik), opis: mn.opis || '', data_do: mn.data_do }
          : null,
        poziom,
        // „Poleć koleżankę" widoczne w apce tylko gdy salon ustawił nagrodę
        polecenia_on: (parseInt(ust.polecenie_pkt, 10) || 0) > 0 ? 1 : 0
      };
      // Przełącznik salonów: wszystkie salony tego numeru (nazwy + saldo, BEZ tokenów).
      // Tokeny do przełączania klient dostaje wyłącznie przy logowaniu (PIN) — stąd
      // przejęcie jednej sesji nie daje dostępu do pozostałych salonów.
      const telRows = await q(`SELECT telefon FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [p.t, p.k]).catch(() => []);
      const telNorm = normalizujTelefon((Array.isArray(telRows) && telRows[0] || {}).telefon);
      if (telNorm) {
        const moje = await salonyKlienta(telNorm);
        odp.moje_salony = moje.map(s => ({ tenant: s.tenant, nazwa: s.nazwa, saldo: s.saldo, aktywny: s.tenant === p.t ? 1 : 0 }));
      } else {
        odp.moje_salony = [];
      }
      odp.tenant = p.t;
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

  // Historia zakupów produktów (kosmetyki + suplementy) klientki + przypomnienia
  // o ponownym zakupie — te same dane co profil w panelu (Sprzedaz), scope po TOKENIE
  // (id_klienta z p.k, nigdy z żądania). BEZ kwot — tylko nazwa, data, liczba zakupów.
  // Przypomnienie 80–200 dni od ostatniego zakupu (jak "Zapytaj o zużycie" w profilu).
  router.post('/klub/kosmetyki', klubLimiter, async (req, res) => {
    const p = verifyKlubToken((req.body || {}).session, 'ses');
    if (!p) return res.json({ status: 'error', code: 'SESJA', message: 'Sesja wygasła. Zaloguj się ponownie.' });
    try {
      // konto musi być aktywne (spójnie z /me — dezaktywowany członek zostaje wylogowany)
      const aRows = await q(`SELECT status FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [p.t, p.k]);
      const konto = Array.isArray(aRows) ? aRows[0] : null;
      if (!konto || String(konto.status).toUpperCase() !== 'AKTYWNE') {
        return res.json({ status: 'error', code: 'SESJA', message: 'Konto nieaktywne. Skontaktuj się z salonem.' });
      }
      const rows = await q(
        `SELECT zabieg, szczegoly, kategoria_produktu, data_sprzedazy FROM Sprzedaz
          WHERE tenant_id = ? AND id_klienta = ? AND COALESCE(status,'') NOT IN ('USUNIĘTY','SCALONY')
            AND ( LOWER(zabieg) LIKE '%kosmetyk%' OR LOWER(zabieg) LIKE '%suplement%'
                  OR LOWER(COALESCE(kategoria_produktu,'')) IN ('kosmetyk','suplement')
                  OR LOWER(COALESCE(szczegoly,'')) LIKE '%szt%' )
          ORDER BY data_sprzedazy ASC`,
        [p.t, p.k]
      ).catch(() => []);

      const mapa = new Map();   // nazwa → { nazwa, typ, ostatni(ms), ile }
      (Array.isArray(rows) ? rows : []).forEach(r => {
        const zL = String(r.zabieg || '').toLowerCase();
        const isSup = zL.includes('suplement') || String(r.kategoria_produktu || '').toLowerCase() === 'suplement';
        const nazwa = String(r.zabieg || '').replace(/^(kosmetyk|suplement)\s*[:-]?\s*/i, '').trim() || String(r.zabieg || '').trim();
        if (!nazwa) return;
        const t = new Date(String(r.data_sprzedazy || '').replace(' ', 'T')).getTime();
        const czas = isNaN(t) ? 0 : t;
        const klucz = (isSup ? 'S|' : 'K|') + nazwa.toLowerCase();
        const w = mapa.get(klucz);
        if (!w) mapa.set(klucz, { nazwa, typ: isSup ? 'suplement' : 'kosmetyk', ostatni: czas, ile: 1 });
        else { w.ile++; if (czas > w.ostatni) w.ostatni = czas; }
      });

      const teraz = Date.now();
      const produkty = [...mapa.values()].map(w => {
        const dni = w.ostatni ? Math.floor((teraz - w.ostatni) / 86400000) : null;
        return {
          nazwa: w.nazwa, typ: w.typ, ile_razy: w.ile,
          ostatni_zakup: w.ostatni ? new Date(w.ostatni).toISOString().slice(0, 10) : null,
          dni_temu: dni,
          przypomnienie: dni != null && dni >= 80 && dni <= 200
        };
      }).sort((a, b) => (b.ostatni_zakup || '').localeCompare(a.ostatni_zakup || ''));

      return res.json({ status: 'success', produkty });
    } catch (e) {
      console.error('[lojalnosc] kosmetyki:', e.message);
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

  // Odczyt wiadomości (klientka otworzyła pełną treść) — statystyka dla panelu.
  // Idempotentnie po (kampania, klient); fire-and-forget, nie blokuje apki.
  router.post('/klub/wiadomosc_odczyt', klubLimiter, async (req, res) => {
    const p = verifyKlubToken((req.body || {}).session, 'ses');
    if (!p) return res.json({ status: 'error', code: 'SESJA' });
    const kampaniaId = parseInt((req.body || {}).kampania_id, 10);
    if (!kampaniaId) return res.json({ status: 'error', message: 'Brak kampanii.' });
    try {
      await q(
        `INSERT INTO Lojalnosc_Kampanie_Odczyty (tenant_id, kampania_id, id_klienta) VALUES (?, ?, ?)`,
        [p.t, kampaniaId, p.k]
      ).catch((e) => { if (e && e.code !== 'ER_DUP_ENTRY') throw e; });
      return res.json({ status: 'success' });
    } catch (e) { return res.json({ status: 'success' }); }
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
      // Numer ma już PIN w apce (inny salon)? Nowe konto dziedziczy go — jeden PIN na numer.
      const inneKonto = await q(
        `SELECT pin_hash FROM Lojalnosc_Konta WHERE telefon = ? AND status = 'AKTYWNE' AND pin_hash <> '' LIMIT 1`,
        [tel]
      ).catch(() => []);
      const odziedziczony = (Array.isArray(inneKonto) && inneKonto[0] && inneKonto[0].pin_hash) || null;
      const hash = odziedziczony || await bcrypt.hash(pin, BCRYPT_ROUNDS);
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
      // Kod polecający (opcjonalny) — łączy nową klientkę z polecającą; nagroda po 1. zakupie.
      const kodPol = String(d.kod_polecajacy || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      if (kodPol) {
        const wl = await q(`SELECT id_klienta FROM Lojalnosc_Konta WHERE tenant_id = ? AND kod_polec = ? AND status = 'AKTYWNE' LIMIT 1`, [p.t, kodPol]).catch(() => []);
        const owner = (Array.isArray(wl) && wl[0]) ? String(wl[0].id_klienta) : null;
        if (owner && owner !== noweId) {
          await q(`INSERT IGNORE INTO Lojalnosc_Polecenia (tenant_id, polecajaca_id, polecona_id, kod, status) VALUES (?, ?, ?, ?, 'OCZEKUJE')`,
            [p.t, owner, noweId, kodPol]).catch(() => {});
          zapiszLog(p.t, 'KLUB POLECENIE', 'Klient (apka)', `${imie} dołączyła z kodu ${kodPol} (polecająca ${owner})`);
        }
      }
      const uRows = await q(`SELECT bonus_powitalny_pkt FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const bonus = parseInt(((Array.isArray(uRows) && uRows[0]) || {}).bonus_powitalny_pkt, 10) || 0;
      if (bonus > 0) {
        await q(
          `INSERT INTO Lojalnosc_Punkty (tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik)
           VALUES (?, ?, ?, 'Bonus powitalny 🎉', 'BONUS', ?, 'System')`,
          [p.t, noweId, bonus, 'REJ@' + noweId]
        ).catch(() => {});
      }
      zapiszLog(p.t, 'KLUB REJESTRACJA ONLINE', 'Klient (apka)', `${imie} — nowa kartoteka ${noweId}${bonus ? `, bonus ${bonus} pkt` : ''}${odziedziczony ? ', PIN z aplikacji' : ''}`);
      const session = makeKlubToken({ t: p.t, k: noweId, typ: 'ses', exp: Date.now() + SESJA_TTL_MS });
      return res.json({ status: 'success', kod: 'NOWE', session, imie: imie.split(' ')[0], bonus, pin_dziedziczony: odziedziczony ? 1 : 0 });
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

  // Zmiana PIN-u przez zalogowanego klienta: obecny PIN + nowy (bez linku,
  // bez recepcji). loginLimiter — obecny PIN można bruteforce'ować jak login.
  router.post('/klub/zmien_pin', loginLimiter, async (req, res) => {
    const d = req.body || {};
    const p = verifyKlubToken(d.session, 'ses');
    if (!p) return res.json({ status: 'error', code: 'SESJA', message: 'Sesja wygasła. Zaloguj się ponownie.' });
    const stary = String(d.stary_pin || '').trim();
    const nowy = String(d.nowy_pin || '').trim();
    if (!/^\d{4,6}$/.test(nowy)) return res.json({ status: 'error', message: 'Nowy PIN musi mieć 4–6 cyfr.' });
    if (stary === nowy) return res.json({ status: 'error', message: 'Nowy PIN musi różnić się od obecnego.' });
    try {
      const rows = await q(
        `SELECT pin_hash FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ? AND status = 'AKTYWNE' LIMIT 1`,
        [p.t, p.k]
      );
      const konto = Array.isArray(rows) ? rows[0] : null;
      if (!konto) return res.json({ status: 'error', code: 'SESJA', message: 'Konto nieaktywne. Skontaktuj się z salonem.' });
      const ok = await bcrypt.compare(stary, String(konto.pin_hash || '')).catch(() => false);
      if (!ok) return res.json({ status: 'error', message: 'Obecny PIN jest błędny.' });
      const hash = await bcrypt.hash(nowy, BCRYPT_ROUNDS);
      await q(`UPDATE Lojalnosc_Konta SET pin_hash = ? WHERE tenant_id = ? AND id_klienta = ?`, [hash, p.t, p.k]);
      zapiszLog(p.t, 'KLUB ZMIANA PIN', 'Klient (apka)', `Klient ${p.k}`);
      return res.json({ status: 'success', message: 'PIN zmieniony. Od teraz loguj się nowym PIN-em.' });
    } catch (e) {
      console.error('[lojalnosc] zmien_pin:', e.message);
      return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' });
    }
  });

  // „Poleć koleżankę": zwraca kod polecający klientki (generuje przy pierwszym wejściu)
  // + nagrodę za polecenie i licznik już poleconych. Kod = 5 znaków bez mylących.
  function generujKodPolec() {
    let s = '';
    for (let i = 0; i < 5; i++) s += KOD_ZNAKI[Math.floor(Math.random() * KOD_ZNAKI.length)];
    return s;
  }
  router.post('/klub/polecenia', klubLimiter, async (req, res) => {
    const p = verifyKlubToken((req.body || {}).session, 'ses');
    if (!p) return res.json({ status: 'error', code: 'SESJA', message: 'Sesja wygasła. Zaloguj się ponownie.' });
    try {
      const aRows = await q(`SELECT status, kod_polec FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [p.t, p.k]);
      const konto = Array.isArray(aRows) ? aRows[0] : null;
      if (!konto || String(konto.status).toUpperCase() !== 'AKTYWNE') {
        return res.json({ status: 'error', code: 'SESJA', message: 'Konto nieaktywne. Skontaktuj się z salonem.' });
      }
      const uRows = await q(`SELECT polecenie_pkt, nazwa_klubu FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`, [p.t]).catch(() => []);
      const ust = (Array.isArray(uRows) && uRows[0]) || {};
      const pkt = parseInt(ust.polecenie_pkt, 10) || 0;
      let kod = String(konto.kod_polec || '').trim();
      if (!kod) {
        for (let i = 0; i < 8 && !kod; i++) {
          const kand = generujKodPolec();
          const ex = await q(`SELECT id FROM Lojalnosc_Konta WHERE tenant_id = ? AND kod_polec = ? LIMIT 1`, [p.t, kand]).catch(() => []);
          if (Array.isArray(ex) && ex.length) continue;   // kolizja — losuj ponownie
          await q(`UPDATE Lojalnosc_Konta SET kod_polec = ? WHERE tenant_id = ? AND id_klienta = ?`, [kand, p.t, p.k]).catch(() => {});
          kod = kand;
        }
      }
      const stat = await q(
        `SELECT status, COUNT(*) AS n FROM Lojalnosc_Polecenia WHERE tenant_id = ? AND polecajaca_id = ? GROUP BY status`,
        [p.t, p.k]
      ).catch(() => []);
      let zrealizowane = 0, oczekujace = 0;
      for (const s of (Array.isArray(stat) ? stat : [])) {
        if (String(s.status) === 'ZREALIZOWANE') zrealizowane = Number(s.n) || 0;
        else if (String(s.status) === 'OCZEKUJE') oczekujace = Number(s.n) || 0;
      }
      return res.json({ status: 'success', kod, polecenie_pkt: pkt, zrealizowane, oczekujace, nazwa_klubu: ust.nazwa_klubu || 'Klub' });
    } catch (e) {
      console.error('[lojalnosc] polecenia:', e.message);
      return res.json({ status: 'error', message: 'Błąd serwera. Spróbuj ponownie.' });
    }
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

  router._tickResetRoczny = tickResetRoczny;   // hook do testów resetu rocznego
  router._tickAutomaty = tickAutomaty;         // hooki automatów (testy)
  router._wykonajAutomat = wykonajAutomat;
  router._kandydaciAutomatu = kandydaciAutomatu;
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
