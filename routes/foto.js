// routes/foto.js
// Dodatek płatny „Foto przed/po" (feature_key: foto_przed_po, 5 zł/mc, gratis dla Boczki).
// Flow: desktop generuje token+QR (foto_token) → telefon otwiera /foto.html?t=...
//   → wykonawca potwierdza się PIN-em (/foto/potwierdz → token2 z wykonawcą)
//   → upload zdjęć (/foto/upload, Jimp 1600px + miniatura 320px) → galeria na profilu klienta.
// Autoryzacja mobilna: stateless HMAC token (bez sesji — endpointy mobilne nie mają
// tenant_id w query/body, więc globalny middleware sesji je pomija BY DESIGN).

const express = require('express');
const multer = require('multer');
const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');
const { createHmac, createHash, randomBytes, randomUUID } = require('crypto');
const QRCode = require('qrcode');
const { validateTenantAccess, makePublicLimiter } = require('./sessions');
const { makeZapiszLog } = require('./logi');
const { makeHasFeature } = require('./features');

const FEATURE_KEY = 'foto_przed_po';
const TOKEN_TTL_MS = 4 * 60 * 60 * 1000;          // 4 godziny
const POTWIERDZENIE_TTL_MS = 14 * 60 * 60 * 1000; // PIN raz dziennie (14 h pokrywa dzień pracy)
const QUOTA_MAX_B = 2 * 1024 * 1024 * 1024;       // 2 GB na salon
const BOCZKI_TENANT = 'boczki-salon-glowny-001';

const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const TENANT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function isValidTenantId(tid) {
  return typeof tid === 'string' && tid.length > 0 && tid.length < 100 && TENANT_ID_REGEX.test(tid);
}

function fotoDir(tenant_id) {
  if (!isValidTenantId(tenant_id)) throw new Error('Nieprawidłowy tenant_id');
  const dir = path.join(UPLOADS_ROOT, tenant_id, 'foto');
  const resolved = path.resolve(dir);
  const rootResolved = path.resolve(UPLOADS_ROOT);
  if (!resolved.startsWith(rootResolved + path.sep)) throw new Error('Path traversal wykryty');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Stateless HMAC token z payloadem ─────────────────────────
// Format: base64url(JSON payload) + '.' + hmac-sha256(base64url)
function clean(v) { return (v || '').replace(/^['"]|['"]$/g, ''); }
function fotoSecret() {
  return clean(process.env.FOTO_SECRET) || clean(process.env.MAGDA_HASLO) || clean(process.env.DB_PASSWORD) || 'foto-fallback';
}
function makeToken(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', fotoSecret()).update(b64).digest('hex');
  return `${b64}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', fotoSecret()).update(b64).digest('hex');
  if (sig !== expected) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload || !payload.exp || Date.now() > payload.exp) return null;
  if (!isValidTenantId(payload.t)) return null;
  return payload;
}

// ─── Multer — jedno zdjęcie, max 15 MB ────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Dozwolone tylko pliki graficzne (JPEG, PNG, WebP).'), ok);
  },
});

module.exports = (db) => {
  const router = express.Router();
  const zapiszLog = makeZapiszLog(db);
  const hasFeature = makeHasFeature(db);
  const pinLimiter = makePublicLimiter({ windowMs: 15 * 60 * 1000, max: 15, message: 'Za dużo prób PIN. Spróbuj za 15 minut.' });
  const uploadLimiter = makePublicLimiter({ windowMs: 15 * 60 * 1000, max: 150, message: 'Za dużo przesłań. Spróbuj za chwilę.' });

  function q(sql, params) {
    return new Promise((res, rej) => db.query(sql, params, (e, r) => e ? rej(e) : res(r)));
  }

  // ─── Migracje + seed katalogu (przy starcie serwera) ────────
  db.query(`CREATE TABLE IF NOT EXISTS FotoSesje (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      sesja_key VARCHAR(64) NOT NULL,
      id_klienta VARCHAR(64) NOT NULL,
      klient VARCHAR(255) DEFAULT '',
      opis VARCHAR(255) DEFAULT '',
      pracownik VARCHAR(120) DEFAULT '',
      utworzyl VARCHAR(120) DEFAULT '',
      status VARCHAR(20) DEFAULT 'AKTYWNA',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_sesja_key (sesja_key),
      KEY idx_tenant_klient (tenant_id, id_klienta)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[foto] Migracja FotoSesje:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS FotoZdjecia (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      sesja_id INT NOT NULL,
      poza VARCHAR(32) DEFAULT '',
      plik VARCHAR(100) NOT NULL,
      miniatura VARCHAR(100) DEFAULT '',
      rozmiar_b INT DEFAULT 0,
      pracownik VARCHAR(120) DEFAULT '',
      status VARCHAR(20) DEFAULT 'AKTYWNE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_tenant_sesja (tenant_id, sesja_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[foto] Migracja FotoZdjecia:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS FotoUrzadzenia (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      token_hash CHAR(64) NOT NULL,
      nazwa VARCHAR(120) DEFAULT '',
      sparowal VARCHAR(120) DEFAULT '',
      wykonawca VARCHAR(120) DEFAULT '',
      potwierdzono_do DATETIME NULL,
      ostatnio_uzyte DATETIME NULL,
      status VARCHAR(20) DEFAULT 'AKTYWNE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_token_hash (token_hash),
      KEY idx_tenant (tenant_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[foto] Migracja FotoUrzadzenia:', e.message);
  });
  db.query(`INSERT INTO Features_Catalog (feature_key, nazwa, opis, miesieczna_cena_grosze, status, sortowanie)
      VALUES (?, ?, ?, 500, 'AKTYWNY', 10)
      ON DUPLICATE KEY UPDATE feature_key = feature_key`,
    [FEATURE_KEY, '📷 Foto przed/po',
     'Wystandaryzowane zdjęcia sylwetki i twarzy przed/po serii zabiegów. QR na telefon, poziomica, nakładki pozycji, automatyczny backup na serwerze i galeria na profilu klienta.'],
    (e) => { if (e) console.error('[foto] Seed katalogu:', e.message); });
  db.query(`INSERT INTO Tenant_Features (tenant_id, feature_key, enabled, monthly_price_grosze, activated_at, activated_by)
      VALUES (?, ?, 1, 0, NOW(), 'gratis — salon Boczki')
      ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [BOCZKI_TENANT, FEATURE_KEY],
    (e) => { if (e) console.error('[foto] Seed gratis Boczki:', e.message); });

  // ─── Sparowane urządzenia (telefon salonu bez QR) ────────────
  function hashDT(dt) { return createHash('sha256').update(String(dt)).digest('hex'); }

  async function urzadzenieZTokena(dt) {
    if (!dt || typeof dt !== 'string' || dt.length < 32 || dt.length > 128) return null;
    const rows = await q(`SELECT * FROM FotoUrzadzenia WHERE token_hash = ? AND status = 'AKTYWNE' LIMIT 1`, [hashDT(dt)]);
    return rows[0] || null;
  }

  function dzienPotwierdzony(u) {
    return !!(u && u.wykonawca && u.potwierdzono_do && new Date(u.potwierdzono_do).getTime() > Date.now());
  }

  async function weryfikujPin(tenant_id, pracownik, pin) {
    const rows = await q(
      `SELECT imie_login, haslo_pin FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`,
      [tenant_id, pracownik]);
    return rows.length && String(rows[0].haslo_pin).trim() === String(pin).trim();
  }

  async function rodoOkKlienta(tenant_id, idKlienta) {
    const rodo = await q(
      `SELECT COUNT(*) AS n FROM Dokumenty_Dodatkowe_Klienta
        WHERE tenant_id = ? AND id_klienta = ? AND typ_nazwa LIKE '%fotograf%'`,
      [tenant_id, idKlienta]).catch(() => [{ n: 0 }]);
    return Number(rodo[0].n) > 0 ? 1 : 0;
  }

  function wymagajFeature(tenant_id, res, next) {
    hasFeature(tenant_id, FEATURE_KEY, (ok) => {
      if (!ok) return res.json({ status: 'error', message: 'Dodatek „Foto przed/po" nie jest aktywny. Włącz go w Administracja → Dodatki.' });
      next();
    });
  }

  // ==========================================
  // GET /foto — akcje desktopowe (sesja przez globalny middleware)
  // ==========================================
  router.get('/foto', async (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'foto_status') {
      hasFeature(tenant_id, FEATURE_KEY, async (enabled) => {
        try {
          const rows = await q(`SELECT COALESCE(SUM(rozmiar_b),0) AS uzyte FROM FotoZdjecia WHERE tenant_id = ? AND status = 'AKTYWNE'`, [tenant_id]);
          return res.json({ status: 'success', enabled: enabled ? 1 : 0, quota_used_b: Number(rows[0].uzyte) || 0, quota_max_b: QUOTA_MAX_B });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      });

    } else if (action === 'foto_sesje') {
      try {
        const idKlienta = req.query.id_klienta;
        const paramy = idKlienta ? [tenant_id, String(idKlienta)] : [tenant_id];
        const sesje = await q(
          `SELECT id, sesja_key, id_klienta, klient, opis, pracownik, utworzyl, created_at
             FROM FotoSesje WHERE tenant_id = ? ${idKlienta ? 'AND id_klienta = ?' : ''} AND status = 'AKTYWNA'
            ORDER BY created_at DESC, id DESC LIMIT 200`, paramy);
        if (!sesje.length) return res.json({ status: 'success', data: [] });
        const ids = sesje.map(s => s.id);
        const zdjecia = await q(
          `SELECT id, sesja_id, poza, plik, miniatura, rozmiar_b, pracownik, created_at
             FROM FotoZdjecia WHERE tenant_id = ? AND sesja_id IN (?) AND status = 'AKTYWNE'
            ORDER BY id ASC`, [tenant_id, ids]);
        const mapa = new Map(sesje.map(s => [s.id, Object.assign({}, s, { zdjecia: [] })]));
        for (const z of zdjecia) {
          const s = mapa.get(z.sesja_id);
          if (s) s.zdjecia.push({
            id: z.id, poza: z.poza, pracownik: z.pracownik, rozmiar_b: z.rozmiar_b, created_at: z.created_at,
            url: `/api/foto/plik/${tenant_id}/${z.plik}`,
            url_mini: z.miniatura ? `/api/foto/plik/${tenant_id}/${z.miniatura}` : `/api/foto/plik/${tenant_id}/${z.plik}`
          });
        }
        // Pokaż tylko sesje z co najmniej 1 zdjęciem (puste = token wygenerowany, nic nie zrobiono)
        return res.json({ status: 'success', data: [...mapa.values()].filter(s => s.zdjecia.length) });
      } catch (e) { return res.json({ status: 'error', message: e.message }); }

    } else if (action === 'foto_urzadzenia') {
      try {
        const rows = await q(
          `SELECT id, nazwa, sparowal, wykonawca, potwierdzono_do, ostatnio_uzyte, created_at
             FROM FotoUrzadzenia WHERE tenant_id = ? AND status = 'AKTYWNE' ORDER BY created_at DESC`, [tenant_id]);
        return res.json({ status: 'success', data: rows });
      } catch (e) { return res.json({ status: 'error', message: e.message }); }

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET foto: ' + action });
    }
  });

  // ==========================================
  // POST /foto — akcje desktopowe (dispatcher: fotoActions w server.js)
  // ==========================================
  router.post('/foto', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'foto_token') {
      const idKlienta = String(d.id_klienta || '').trim();
      const klient = String(d.klient || '').trim();
      const opis = String(d.opis || '').trim();
      const generator = String(d.user_log || d.pracownik || '').trim();
      if (!idKlienta || !klient) return res.json({ status: 'error', message: 'Brak klienta.' });
      if (!opis) return res.json({ status: 'error', message: 'Podaj opis sesji (np. „przed serią endermologii").' });

      wymagajFeature(tenant_id, res, async () => {
        try {
          // RODO — czy klient ma zgodę na fotografię (dokument dodatkowy)
          const rodo = await q(
            `SELECT COUNT(*) AS n FROM Dokumenty_Dodatkowe_Klienta
              WHERE tenant_id = ? AND id_klienta = ? AND typ_nazwa LIKE '%fotograf%'`,
            [tenant_id, idKlienta]).catch(() => [{ n: 0 }]);

          const payload = {
            t: tenant_id, k: idKlienta, n: klient.slice(0, 120), o: opis.slice(0, 160),
            s: randomUUID(), g: generator.slice(0, 80), exp: Date.now() + TOKEN_TTL_MS
          };
          const token = makeToken(payload);
          const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
          const host = req.get('host');
          const url = `${proto}://${host}/foto.html?t=${encodeURIComponent(token)}`;
          const qr = await QRCode.toDataURL(url, { margin: 1, width: 320 });
          return res.json({
            status: 'success', token, url, qr,
            rodo_ok: Number(rodo[0].n) > 0 ? 1 : 0,
            wygasa: new Date(payload.exp).toISOString()
          });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      });

    } else if (action === 'foto_usun') {
      // Soft-delete: zdjęcie lub cała sesja. Pliki zostają na dysku (backup).
      const typ = String(d.typ || '').trim();
      const id = parseInt(d.id, 10);
      const kto = String(d.user_log || d.pracownik || '').trim();
      if (!id || (typ !== 'zdjecie' && typ !== 'sesja')) return res.json({ status: 'error', message: 'Podaj typ (zdjecie/sesja) i id.' });

      (async () => {
        try {
          if (typ === 'zdjecie') {
            const r = await q(`UPDATE FotoZdjecia SET status = 'USUNIETE' WHERE tenant_id = ? AND id = ?`, [tenant_id, id]);
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono zdjęcia.' });
            zapiszLog(tenant_id, 'FOTO USUNIĘTE', kto, `Zdjęcie #${id}`);
          } else {
            const r = await q(`UPDATE FotoSesje SET status = 'USUNIETA' WHERE tenant_id = ? AND id = ?`, [tenant_id, id]);
            if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono sesji.' });
            await q(`UPDATE FotoZdjecia SET status = 'USUNIETE' WHERE tenant_id = ? AND sesja_id = ?`, [tenant_id, id]);
            zapiszLog(tenant_id, 'FOTO USUNIĘTE', kto, `Sesja foto #${id} (z wszystkimi zdjęciami)`);
          }
          return res.json({ status: 'success' });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      })();

    } else if (action === 'foto_urzadzenie_usun') {
      const id = parseInt(d.id, 10);
      const kto = String(d.user_log || d.pracownik || '').trim();
      if (!id) return res.json({ status: 'error', message: 'Brak id urządzenia.' });
      (async () => {
        try {
          const r = await q(`UPDATE FotoUrzadzenia SET status = 'UNIEWAZNIONE' WHERE tenant_id = ? AND id = ?`, [tenant_id, id]);
          if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono urządzenia.' });
          zapiszLog(tenant_id, 'FOTO URZĄDZENIE', kto, `Unieważniono sparowany telefon #${id}`);
          return res.json({ status: 'success' });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      })();

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja foto POST: ' + action });
    }
  });

  // ==========================================
  // Endpointy MOBILNE — autoryzacja HMAC tokenem (bez sesji, bez tenant_id w query)
  // ==========================================

  // GET /foto/mobile-info?t=... — dane do ekranu startowego telefonu
  router.get('/foto/mobile-info', async (req, res) => {
    const payload = verifyToken(req.query.t);
    if (!payload) return res.json({ status: 'error', message: 'Link wygasł lub jest nieprawidłowy. Wygeneruj nowy kod QR.' });
    try {
      const [prac, lic] = await Promise.all([
        q(`SELECT imie_login FROM Użytkownicy WHERE tenant_id = ? ORDER BY imie_login`, [payload.t]),
        q(`SELECT nazwa_salonu FROM Licencje WHERE id_bazy = ? LIMIT 1`, [payload.t])
      ]);
      return res.json({
        status: 'success',
        klient: payload.n, opis: payload.o,
        salon: (lic[0] && lic[0].nazwa_salonu) || '',
        pracownicy: prac.map(r => String(r.imie_login || '').trim()).filter(Boolean),
        wygasa: new Date(payload.exp).toISOString(),
        wykonawca: payload.w || null
      });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  // POST /foto/potwierdz — { t, pracownik, pin } → token2 z wykonawcą (pole w)
  router.post('/foto/potwierdz', pinLimiter, async (req, res) => {
    const payload = verifyToken(req.body.t);
    if (!payload) return res.json({ status: 'error', message: 'Link wygasł lub jest nieprawidłowy. Wygeneruj nowy kod QR.' });
    const pracownik = String(req.body.pracownik || '').trim();
    const pin = String(req.body.pin || '').trim();
    if (!pracownik || !pin) return res.json({ status: 'error', message: 'Wybierz pracownika i podaj PIN.' });
    try {
      const rows = await q(
        `SELECT imie_login, haslo_pin FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`,
        [payload.t, pracownik]);
      if (!rows.length || String(rows[0].haslo_pin).trim() !== pin) {
        return res.json({ status: 'error', message: 'Błędny PIN!' });
      }
      const token2 = makeToken(Object.assign({}, payload, { w: pracownik.slice(0, 80) }));

      // Opcjonalne parowanie telefonu: „Zapamiętaj ten telefon" — PIN już zweryfikowany
      let device_token = null;
      if (req.body.zapamietaj) {
        device_token = randomBytes(32).toString('hex');
        const nazwa = String(req.body.urzadzenie || '').trim().slice(0, 120) || ('Telefon (' + pracownik + ')');
        await q(
          `INSERT INTO FotoUrzadzenia (tenant_id, token_hash, nazwa, sparowal, wykonawca, potwierdzono_do)
           VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?))`,
          [payload.t, hashDT(device_token), nazwa, pracownik, pracownik, Math.floor((Date.now() + POTWIERDZENIE_TTL_MS) / 1000)]);
        zapiszLog(payload.t, 'FOTO URZĄDZENIE', pracownik, `Sparowano telefon: ${nazwa}`);
      }
      return res.json({ status: 'success', token2, wykonawca: pracownik, device_token });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  // ==========================================
  // Sparowany telefon — flow bez QR (device_token w localStorage telefonu)
  // ==========================================

  // GET /foto/urzadzenie?dt=... — stan urządzenia (routing ekranów na telefonie)
  router.get('/foto/urzadzenie', async (req, res) => {
    try {
      const u = await urzadzenieZTokena(req.query.dt);
      if (!u) return res.json({ status: 'error', message: 'Telefon nie jest sparowany albo dostęp cofnięto. Zeskanuj kod QR z komputera, aby sparować ponownie.' });
      const [prac, lic] = await Promise.all([
        q(`SELECT imie_login FROM Użytkownicy WHERE tenant_id = ? ORDER BY imie_login`, [u.tenant_id]),
        q(`SELECT nazwa_salonu FROM Licencje WHERE id_bazy = ? LIMIT 1`, [u.tenant_id])
      ]);
      return res.json({
        status: 'success',
        salon: (lic[0] && lic[0].nazwa_salonu) || '',
        nazwa: u.nazwa,
        potwierdzony: dzienPotwierdzony(u) ? 1 : 0,
        wykonawca: dzienPotwierdzony(u) ? u.wykonawca : null,
        pracownicy: prac.map(r => String(r.imie_login || '').trim()).filter(Boolean)
      });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  // POST /foto/dzien — { dt, pracownik, pin } → potwierdzenie wykonawcy na dziś
  router.post('/foto/dzien', pinLimiter, async (req, res) => {
    try {
      const u = await urzadzenieZTokena(req.body.dt);
      if (!u) return res.json({ status: 'error', message: 'Telefon nie jest sparowany albo dostęp cofnięto. Zeskanuj kod QR z komputera.' });
      const pracownik = String(req.body.pracownik || '').trim();
      const pin = String(req.body.pin || '').trim();
      if (!pracownik || !pin) return res.json({ status: 'error', message: 'Wybierz pracownika i podaj PIN.' });
      if (!(await weryfikujPin(u.tenant_id, pracownik, pin))) return res.json({ status: 'error', message: 'Błędny PIN!' });
      await q(
        `UPDATE FotoUrzadzenia SET wykonawca = ?, potwierdzono_do = FROM_UNIXTIME(?), ostatnio_uzyte = NOW() WHERE id = ?`,
        [pracownik.slice(0, 120), Math.floor((Date.now() + POTWIERDZENIE_TTL_MS) / 1000), u.id]);
      return res.json({ status: 'success', wykonawca: pracownik });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  // GET /foto/klienci?dt=...&q=... — wyszukiwarka klientek (wymaga potwierdzonego dnia)
  router.get('/foto/klienci', async (req, res) => {
    try {
      const u = await urzadzenieZTokena(req.query.dt);
      if (!u) return res.json({ status: 'error', message: 'Telefon nie jest sparowany albo dostęp cofnięto.' });
      if (!dzienPotwierdzony(u)) return res.json({ status: 'error', message: 'Potwierdź się PIN-em, aby wyszukiwać klientki.', wymaga_pin: 1 });
      const fraza = String(req.query.q || '').trim();
      if (fraza.length < 2) return res.json({ status: 'success', data: [] });
      wymagajFeature(u.tenant_id, res, async () => {
        const like = '%' + fraza.replace(/[%_]/g, '') + '%';
        const rows = await q(
          `SELECT id_klienta, imie_nazwisko, telefon FROM Klienci
            WHERE tenant_id = ? AND data_usuniecia IS NULL AND (imie_nazwisko LIKE ? OR telefon LIKE ?)
            ORDER BY imie_nazwisko LIMIT 10`,
          [u.tenant_id, like, like]);
        await q(`UPDATE FotoUrzadzenia SET ostatnio_uzyte = NOW() WHERE id = ?`, [u.id]).catch(() => {});
        return res.json({
          status: 'success',
          data: rows.map(r => ({
            id: r.id_klienta,
            nazwa: r.imie_nazwisko,
            tel: r.telefon ? String(r.telefon).replace(/\d(?=\d{3})/g, '•') : ''
          }))
        });
      });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  // POST /foto/start — { dt, id_klienta, opis } → token2 sesji foto (bez QR)
  router.post('/foto/start', async (req, res) => {
    try {
      const u = await urzadzenieZTokena(req.body.dt);
      if (!u) return res.json({ status: 'error', message: 'Telefon nie jest sparowany albo dostęp cofnięto.' });
      if (!dzienPotwierdzony(u)) return res.json({ status: 'error', message: 'Potwierdź się PIN-em, aby zacząć sesję.', wymaga_pin: 1 });
      const idKlienta = String(req.body.id_klienta || '').trim();
      const opis = String(req.body.opis || '').trim();
      if (!idKlienta) return res.json({ status: 'error', message: 'Wybierz klientkę.' });
      if (!opis) return res.json({ status: 'error', message: 'Podaj opis sesji (np. „przed serią endermologii").' });
      wymagajFeature(u.tenant_id, res, async () => {
        const kl = await q(
          `SELECT imie_nazwisko FROM Klienci WHERE tenant_id = ? AND id_klienta = ? AND data_usuniecia IS NULL LIMIT 1`,
          [u.tenant_id, idKlienta]);
        if (!kl.length) return res.json({ status: 'error', message: 'Nie znaleziono klientki.' });
        const [lic, rodo_ok] = await Promise.all([
          q(`SELECT nazwa_salonu FROM Licencje WHERE id_bazy = ? LIMIT 1`, [u.tenant_id]),
          rodoOkKlienta(u.tenant_id, idKlienta)
        ]);
        const token2 = makeToken({
          t: u.tenant_id, k: idKlienta, n: String(kl[0].imie_nazwisko || '').slice(0, 120),
          o: opis.slice(0, 160), s: randomUUID(), g: u.wykonawca, w: u.wykonawca,
          exp: Date.now() + TOKEN_TTL_MS
        });
        await q(`UPDATE FotoUrzadzenia SET ostatnio_uzyte = NOW() WHERE id = ?`, [u.id]).catch(() => {});
        return res.json({
          status: 'success', token2, rodo_ok,
          klient: kl[0].imie_nazwisko, opis, wykonawca: u.wykonawca,
          salon: (lic[0] && lic[0].nazwa_salonu) || ''
        });
      });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  // POST /foto/upload — multipart: t (token2 z wykonawcą), poza, plik 'foto'
  router.post('/foto/upload', uploadLimiter, (req, res) => {
    upload.single('foto')(req, res, async (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Plik za duży (max 15 MB).' : (err.message || 'Błąd przesyłania pliku.');
        return res.json({ status: 'error', message: msg });
      }
      const payload = verifyToken(req.body.t);
      if (!payload) return res.json({ status: 'error', message: 'Link wygasł. Wygeneruj nowy kod QR na komputerze.' });
      if (!payload.w) return res.json({ status: 'error', message: 'Najpierw potwierdź wykonawcę PIN-em.' });
      if (!req.file) return res.json({ status: 'error', message: 'Nie przesłano zdjęcia.' });
      const tenant_id = payload.t;

      wymagajFeature(tenant_id, res, async () => {
        try {
          const quota = await q(`SELECT COALESCE(SUM(rozmiar_b),0) AS uzyte FROM FotoZdjecia WHERE tenant_id = ? AND status = 'AKTYWNE'`, [tenant_id]);
          if (Number(quota[0].uzyte) >= QUOTA_MAX_B) {
            return res.json({ status: 'error', message: 'Przekroczono limit miejsca (2 GB). Usuń stare sesje foto.' });
          }

          // Odchudzanie: max 1600 px, JPEG q80 + miniatura 320 px
          const img = await Jimp.read(req.file.buffer);
          if (img.bitmap.width > 1600 || img.bitmap.height > 1600) img.scaleToFit(1600, 1600);
          img.quality(80);
          const glowneBuf = await img.getBufferAsync(Jimp.MIME_JPEG);
          const mini = img.clone();
          mini.scaleToFit(320, 320);
          mini.quality(70);
          const miniBuf = await mini.getBufferAsync(Jimp.MIME_JPEG);

          const dir = fotoDir(tenant_id);
          const uuid = randomUUID();
          const plik = `${uuid}.jpg`;
          const miniatura = `${uuid}_thumb.jpg`;
          fs.writeFileSync(path.join(dir, plik), glowneBuf);
          fs.writeFileSync(path.join(dir, miniatura), miniBuf);

          // Lazy-upsert sesji (sesja_key z tokenu) — powstaje przy pierwszym zdjęciu
          await q(
            `INSERT INTO FotoSesje (tenant_id, sesja_key, id_klienta, klient, opis, pracownik, utworzyl)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE pracownik = VALUES(pracownik)`,
            [tenant_id, payload.s, payload.k, payload.n, payload.o, payload.w, payload.g || '']);
          const sesjaRows = await q(`SELECT id FROM FotoSesje WHERE sesja_key = ? LIMIT 1`, [payload.s]);
          const sesjaId = sesjaRows[0].id;

          const poza = String(req.body.poza || '').slice(0, 32);
          const ins = await q(
            `INSERT INTO FotoZdjecia (tenant_id, sesja_id, poza, plik, miniatura, rozmiar_b, pracownik)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [tenant_id, sesjaId, poza, plik, miniatura, glowneBuf.length + miniBuf.length, payload.w]);

          zapiszLog(tenant_id, 'FOTO DODANE', payload.w, `${payload.n} — ${payload.o}${poza ? ' [' + poza + ']' : ''} (${Math.round(glowneBuf.length / 1024)} KB)`);
          return res.json({ status: 'success', id: ins.insertId, sesja_id: sesjaId, rozmiar_b: glowneBuf.length });
        } catch (e) {
          console.error('[foto upload]', e.message);
          return res.json({ status: 'error', message: 'Błąd przetwarzania zdjęcia: ' + e.message });
        }
      });
    });
  });

  // ==========================================
  // GET /foto/plik/:tenant_id/:filename — serwowanie zdjęć (sesja desktopowa)
  // ==========================================
  router.get('/foto/plik/:tenant_id/:filename', (req, res) => {
    const { tenant_id, filename } = req.params;
    if (!isValidTenantId(tenant_id)) return res.status(400).json({ status: 'error', message: 'Nieprawidłowy tenant_id.' });

    const sessionToken = req.headers['x-session-token'] || req.query.session_token || req.cookies?.session_token;
    if (!sessionToken) return res.status(403).json({ status: 'error', message: 'Brak autoryzacji — zaloguj się.' });
    const v = validateTenantAccess(sessionToken, tenant_id);
    if (!v.valid) {
      return res.status(403).json({
        status: 'error',
        message: v.reason === 'expired' ? 'Sesja wygasła — zaloguj się ponownie.' : 'Brak dostępu do tego pliku.'
      });
    }

    if (!/^[a-f0-9-]+(_thumb)?\.jpg$/i.test(filename)) {
      return res.status(400).json({ status: 'error', message: 'Nieprawidłowa nazwa pliku.' });
    }
    const filepath = path.join(UPLOADS_ROOT, tenant_id, 'foto', filename);
    const resolved = path.resolve(filepath);
    if (!resolved.startsWith(path.resolve(UPLOADS_ROOT) + path.sep)) {
      return res.status(400).json({ status: 'error', message: 'Nieprawidłowa ścieżka.' });
    }
    if (!fs.existsSync(filepath)) return res.status(404).json({ status: 'error', message: 'Plik nie istnieje.' });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(resolved);
  });

  return router;
};
