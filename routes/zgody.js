// routes/zgody.js
// Link do płatności z akceptacją regulaminu (feature_key: platnosc_link, na razie tylko Boczki).
// Flow: pracownik wkleja link tpay (zgoda_utworz) → Estelio generuje /platnosc.html?t=...
//   → klient widzi/wpisuje dane, akceptuje regulamin (/zgoda/akceptuj) → redirect do tpay.
// Dowód akceptacji: wpis w ZgodyPlatnosci (kto, kiedy, IP, user-agent, hash treści regulaminu).
// Autoryzacja klienta: stateless HMAC token (bez sesji — endpointy /zgoda/* nie mają
// tenant_id w query/body, więc globalny middleware sesji je pomija BY DESIGN, jak w foto.js).

const express = require('express');
const { createHmac, createHash } = require('crypto');
const { randomUUID } = require('crypto');
const { makePublicLimiter } = require('./sessions');
const { makeZapiszLog } = require('./logi');
const { makeHasFeature } = require('./features');

const FEATURE_KEY = 'platnosc_link';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dni — klient może kliknąć po paru dniach
const BOCZKI_TENANT = 'boczki-salon-glowny-001';
const TENANT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function isValidTenantId(tid) {
  return typeof tid === 'string' && tid.length > 0 && tid.length < 100 && TENANT_ID_REGEX.test(tid);
}

// ─── Stateless HMAC token (wzorzec z foto.js) ─────────────────
function clean(v) { return (v || '').replace(/^['"]|['"]$/g, ''); }
function zgodaSecret() {
  return clean(process.env.ZGODA_SECRET) || clean(process.env.FOTO_SECRET) || clean(process.env.MAGDA_HASLO) || clean(process.env.DB_PASSWORD) || 'zgoda-fallback';
}
function makeToken(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', zgodaSecret()).update(b64).digest('hex');
  return `${b64}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', zgodaSecret()).update(b64).digest('hex');
  if (sig !== expected) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload || !payload.exp || Date.now() > payload.exp) return null;
  if (!payload.id || !isValidTenantId(payload.t)) return null;
  return payload;
}

// Naprawa linku skopiowanego z paska adresu panelu tpay zamiast przyciskiem "Kopiuj":
// SPA tpay przepisuje adres na ?h<hash> (bez "=") i dokleja #pagepanel-... — taka forma
// działa tylko w zalogowanej przeglądarce pracownika, u klienta daje "Puste parametry".
function normalizujTpayLink(link) {
  const s = String(link || '').trim();
  let u;
  try { u = new URL(s); } catch (e) { return s; }
  u.hash = '';
  const m = u.search.match(/^\?h([0-9a-fA-F]{40})$/);
  if (m) u.search = '?h=' + m[1];
  return u.toString();
}

// Tylko prawdziwe linki tpay — inaczej strona byłaby otwartym przekierowaniem
function tpayLinkOk(link) {
  let u;
  try { u = new URL(String(link || '').trim()); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return h === 'tpay.com' || h.endsWith('.tpay.com');
}

function maskujTelefon(tel) {
  const cyfry = String(tel || '').replace(/\D/g, '');
  if (cyfry.length < 5) return cyfry ? '***' : '';
  return cyfry.slice(0, 3) + '***' + cyfry.slice(-2);
}

module.exports = (db) => {
  const router = express.Router();
  const zapiszLog = makeZapiszLog(db);
  const hasFeature = makeHasFeature(db);
  const akceptLimiter = makePublicLimiter({ windowMs: 15 * 60 * 1000, max: 30, message: 'Za dużo prób. Spróbuj za 15 minut.' });

  function q(sql, params) {
    return new Promise((res, rej) => db.query(sql, params, (e, r) => e ? rej(e) : res(r)));
  }

  // ─── Migracje + seedy (przy starcie serwera, idempotentne) ───
  db.query(`CREATE TABLE IF NOT EXISTS ZgodyPlatnosci (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      id_klienta VARCHAR(64) DEFAULT NULL,
      imie_nazwisko VARCHAR(255) DEFAULT '',
      telefon VARCHAR(40) DEFAULT '',
      kwota DECIMAL(10,2) DEFAULT NULL,
      opis VARCHAR(255) DEFAULT '',
      tpay_link VARCHAR(500) NOT NULL,
      status VARCHAR(20) DEFAULT 'OCZEKUJACA',
      regulamin_hash CHAR(64) DEFAULT '',
      zaakceptowano_at DATETIME NULL,
      ip VARCHAR(64) DEFAULT '',
      user_agent VARCHAR(255) DEFAULT '',
      utworzyl VARCHAR(120) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_tenant (tenant_id, status),
      KEY idx_tenant_klient (tenant_id, id_klienta)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) console.error('[zgody] Migracja ZgodyPlatnosci:', e.message);
  });
  db.query(`CREATE TABLE IF NOT EXISTS TenantRegulaminy (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      tresc MEDIUMTEXT,
      url VARCHAR(500) DEFAULT '',
      updated_by VARCHAR(120) DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_tenant (tenant_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, (e) => {
    if (e) return console.error('[zgody] Migracja TenantRegulaminy:', e.message);
    // istniejące instalacje: dołóż kolumnę url (regulamin jako link do strony WWW salonu)
    db.query(`ALTER TABLE TenantRegulaminy ADD COLUMN url VARCHAR(500) DEFAULT ''`, (e2) => {
      if (e2 && e2.code !== 'ER_DUP_FIELDNAME') console.error('[zgody] ALTER TenantRegulaminy.url:', e2.message);
    });
  });
  // status UKRYTY — inne salony nie widzą dodatku w Administracja→Dodatki (pilot u Boczków);
  // rozszerzenie na wszystkich = zmiana statusu na AKTYWNY
  db.query(`INSERT INTO Features_Catalog (feature_key, nazwa, opis, miesieczna_cena_grosze, status, sortowanie)
      VALUES (?, ?, ?, 0, 'UKRYTY', 11)
      ON DUPLICATE KEY UPDATE feature_key = feature_key`,
    [FEATURE_KEY, '🔗 Link do płatności z regulaminem',
     'Klient przed płatnością online (tpay) potwierdza zapoznanie się z regulaminem salonu. Zapis akceptacji (kto, kiedy, IP) chroni salon przy zadatkach osób, które nie podpisały regulaminu w lokalu.'],
    (e) => { if (e) console.error('[zgody] Seed katalogu:', e.message); });
  db.query(`INSERT INTO Tenant_Features (tenant_id, feature_key, enabled, monthly_price_grosze, activated_at, activated_by)
      VALUES (?, ?, 1, 0, NOW(), 'pilot — salon Boczki')
      ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [BOCZKI_TENANT, FEATURE_KEY],
    (e) => { if (e) console.error('[zgody] Seed pilot Boczki:', e.message); });

  function wymagajFeature(tenant_id, res, next) {
    hasFeature(tenant_id, FEATURE_KEY, (ok) => {
      if (!ok) return res.json({ status: 'error', message: 'Dodatek „Link do płatności z regulaminem" nie jest aktywny.' });
      next();
    });
  }

  // Regulamin: link do strony WWW salonu (url, preferowany) lub wklejona treść (tresc)
  async function pobierzRegulamin(tenant_id) {
    const rows = await q(`SELECT tresc, url FROM TenantRegulaminy WHERE tenant_id = ? LIMIT 1`, [tenant_id]);
    const tresc = (rows[0] && String(rows[0].tresc || '').trim()) || '';
    const url = (rows[0] && String(rows[0].url || '').trim()) || '';
    return { tresc, url, ok: !!(tresc || url) };
  }

  // Klient z bazy, który podpisał już regulamin w salonie (Rejestr_Oświadczeń) —
  // nie pokazujemy mu ponownie kroku akceptacji na stronie płatności
  async function regulaminPodpisany(tenant_id, id_klienta) {
    if (!id_klienta) return false;
    const rows = await q(
      `SELECT id FROM \`Rejestr_Oświadczeń\` WHERE tenant_id = ? AND id_klienta = ? AND zapoznanie_z_regulaminem = 'TAK' LIMIT 1`,
      [tenant_id, String(id_klienta)]);
    return rows.length > 0;
  }

  // ==========================================
  // GET /zgody — akcje desktopowe (sesja przez globalny middleware)
  // ==========================================
  router.get('/zgody', async (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'zgody_status') {
      hasFeature(tenant_id, FEATURE_KEY, async (enabled) => {
        try {
          const reg = await pobierzRegulamin(tenant_id);
          return res.json({ status: 'success', enabled: enabled ? 1 : 0, regulamin_ok: reg.ok ? 1 : 0 });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      });

    } else if (action === 'zgody_regulamin_get') {
      try {
        const reg = await pobierzRegulamin(tenant_id);
        return res.json({ status: 'success', tresc: reg.tresc, url: reg.url });
      } catch (e) { return res.json({ status: 'error', message: e.message }); }

    } else if (action === 'zgody_lista') {
      try {
        const idKlienta = req.query.id_klienta;
        const paramy = idKlienta ? [tenant_id, String(idKlienta)] : [tenant_id];
        const rows = await q(
          `SELECT id, id_klienta, imie_nazwisko, telefon, kwota, opis, tpay_link, status,
                  zaakceptowano_at, utworzyl, created_at
             FROM ZgodyPlatnosci
            WHERE tenant_id = ? ${idKlienta ? 'AND id_klienta = ?' : ''}
            ORDER BY created_at DESC, id DESC LIMIT 200`, paramy);
        // Dla oczekujących odtwarzamy link (exp liczony od created_at — kopiowanie z listy nie przedłuża ważności)
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.get('host');
        for (const z of rows) {
          if (z.status !== 'OCZEKUJACA') continue;
          const exp = new Date(z.created_at).getTime() + TOKEN_TTL_MS;
          if (exp <= Date.now()) { z.wygasly = 1; continue; }
          z.url = `${proto}://${host}/platnosc.html?t=${encodeURIComponent(makeToken({ t: tenant_id, id: z.id, exp }))}`;
        }
        return res.json({ status: 'success', data: rows });
      } catch (e) { return res.json({ status: 'error', message: e.message }); }

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET zgody: ' + action });
    }
  });

  // ==========================================
  // POST /zgody — akcje desktopowe (dispatcher: zgodyActions w server.js)
  // ==========================================
  router.post('/zgody', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'zgoda_utworz') {
      const tpayLink = normalizujTpayLink(d.tpay_link);
      const idKlienta = String(d.id_klienta || '').trim();
      const kwota = d.kwota !== undefined && d.kwota !== null && String(d.kwota).trim() !== ''
        ? Number(String(d.kwota).replace(',', '.')) : null;
      const opis = String(d.opis || '').trim().slice(0, 255);
      const generator = String(d.user_log || d.pracownik || '').trim();
      if (!tpayLinkOk(tpayLink)) return res.json({ status: 'error', message: 'To nie wygląda na link tpay. Wklej link zaczynający się od https://secure.tpay.com/...' });
      if (kwota !== null && (!isFinite(kwota) || kwota <= 0)) return res.json({ status: 'error', message: 'Nieprawidłowa kwota.' });

      wymagajFeature(tenant_id, res, async () => {
        try {
          const reg = await pobierzRegulamin(tenant_id);
          if (!reg.ok) return res.json({ status: 'error', message: 'Najpierw uzupełnij regulamin w Administracja → Regulamin płatności.' });

          let imie = '', telefon = '';
          if (idKlienta) {
            const kl = await q(`SELECT imie_nazwisko, telefon FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [tenant_id, idKlienta]);
            if (!kl.length) return res.json({ status: 'error', message: 'Nie znaleziono klienta o ID: ' + idKlienta });
            imie = String(kl[0].imie_nazwisko || '').trim();
            telefon = String(kl[0].telefon || '').trim();
          }

          const r = await q(
            `INSERT INTO ZgodyPlatnosci (tenant_id, id_klienta, imie_nazwisko, telefon, kwota, opis, tpay_link, utworzyl)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [tenant_id, idKlienta || null, imie, telefon, kwota, opis, tpayLink, generator.slice(0, 120)]);

          const token = makeToken({ t: tenant_id, id: r.insertId, exp: Date.now() + TOKEN_TTL_MS });
          const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
          const host = req.get('host');
          const url = `${proto}://${host}/platnosc.html?t=${encodeURIComponent(token)}`;

          zapiszLog(tenant_id, 'PŁATNOŚĆ LINK', generator,
            `Link #${r.insertId}: ${imie || 'osoba spoza bazy'}${kwota !== null ? `, ${kwota.toFixed(2)} zł` : ''}${opis ? ` (${opis})` : ''}`);
          return res.json({ status: 'success', id: r.insertId, url, wygasa: new Date(Date.now() + TOKEN_TTL_MS).toISOString() });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      });

    } else if (action === 'zgoda_anuluj') {
      const id = parseInt(d.id, 10);
      const kto = String(d.user_log || d.pracownik || '').trim();
      if (!id) return res.json({ status: 'error', message: 'Brak id.' });
      (async () => {
        try {
          const r = await q(`UPDATE ZgodyPlatnosci SET status = 'ANULOWANA' WHERE tenant_id = ? AND id = ? AND status = 'OCZEKUJACA'`, [tenant_id, id]);
          if (!r.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono oczekującego linku (być może już zaakceptowany).' });
          zapiszLog(tenant_id, 'PŁATNOŚĆ LINK', kto, `Anulowano link #${id}`);
          return res.json({ status: 'success' });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      })();

    } else if (action === 'zgody_regulamin_zapisz') {
      const tresc = String(d.tresc || '').trim();
      const url = String(d.url || '').trim().slice(0, 500);
      const kto = String(d.user_log || d.pracownik || '').trim();
      if (!tresc && !url) return res.json({ status: 'error', message: 'Podaj link do regulaminu na stronie WWW lub wklej jego treść.' });
      if (tresc.length > 200000) return res.json({ status: 'error', message: 'Regulamin jest za długi.' });
      if (url) {
        let u; try { u = new URL(url); } catch (e) { u = null; }
        if (!u || u.protocol !== 'https:') return res.json({ status: 'error', message: 'Link do regulaminu musi być prawidłowym adresem https://...' });
      }
      wymagajFeature(tenant_id, res, async () => {
        try {
          await q(
            `INSERT INTO TenantRegulaminy (tenant_id, tresc, url, updated_by) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE tresc = VALUES(tresc), url = VALUES(url), updated_by = VALUES(updated_by)`,
            [tenant_id, tresc, url, kto.slice(0, 120)]);
          zapiszLog(tenant_id, 'PŁATNOŚĆ LINK', kto, 'Zaktualizowano regulamin płatności');
          return res.json({ status: 'success' });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      });

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja zgody POST: ' + action });
    }
  });

  // ==========================================
  // Endpointy PUBLICZNE — autoryzacja HMAC tokenem (bez sesji, bez tenant_id w query)
  // ==========================================

  // GET /zgoda/info?t=... — dane do strony akceptacji
  router.get('/zgoda/info', async (req, res) => {
    const payload = verifyToken(req.query.t);
    if (!payload) return res.json({ status: 'error', message: 'Link wygasł lub jest nieprawidłowy. Poproś salon o nowy link.' });
    try {
      const rows = await q(`SELECT * FROM ZgodyPlatnosci WHERE tenant_id = ? AND id = ? LIMIT 1`, [payload.t, payload.id]);
      if (!rows.length) return res.json({ status: 'error', message: 'Nie znaleziono płatności. Poproś salon o nowy link.' });
      const z = rows[0];
      if (z.status === 'ANULOWANA') return res.json({ status: 'error', message: 'Ten link został anulowany przez salon. Poproś o nowy link.' });

      const [lic, reg, podpisany] = await Promise.all([
        q(`SELECT nazwa_salonu FROM Licencje WHERE id_bazy = ? LIMIT 1`, [payload.t]),
        pobierzRegulamin(payload.t),
        regulaminPodpisany(payload.t, z.id_klienta)
      ]);
      const zaakceptowana = z.status === 'ZAAKCEPTOWANA';
      return res.json({
        status: 'success',
        salon: (lic[0] && lic[0].nazwa_salonu) || '',
        tryb: z.id_klienta ? 'podglad' : 'formularz',
        imie_nazwisko: z.id_klienta || zaakceptowana ? (z.imie_nazwisko || '') : '',
        telefon_mask: z.id_klienta || zaakceptowana ? maskujTelefon(z.telefon) : '',
        kwota: z.kwota !== null ? Number(z.kwota) : null,
        opis: z.opis || '',
        regulamin: reg.tresc,
        regulamin_url: reg.url,
        // klient podpisał już regulamin w salonie → strona nie pokazuje kroku akceptacji
        regulamin_podpisany: podpisany ? 1 : 0,
        zaakceptowana: zaakceptowana ? 1 : 0,
        zaakceptowano_at: z.zaakceptowano_at,
        // link tpay ujawniamy dopiero PO akceptacji regulaminu
        tpay_link: zaakceptowana ? z.tpay_link : null
      });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  // POST /zgoda/akceptuj — { t, imie_nazwisko?, telefon? } → zapis akceptacji + link tpay
  router.post('/zgoda/akceptuj', akceptLimiter, async (req, res) => {
    const payload = verifyToken(req.body.t);
    if (!payload) return res.json({ status: 'error', message: 'Link wygasł lub jest nieprawidłowy. Poproś salon o nowy link.' });
    try {
      const rows = await q(`SELECT * FROM ZgodyPlatnosci WHERE tenant_id = ? AND id = ? LIMIT 1`, [payload.t, payload.id]);
      if (!rows.length) return res.json({ status: 'error', message: 'Nie znaleziono płatności. Poproś salon o nowy link.' });
      const z = rows[0];
      if (z.status === 'ANULOWANA') return res.json({ status: 'error', message: 'Ten link został anulowany przez salon. Poproś o nowy link.' });
      if (z.status === 'ZAAKCEPTOWANA') {
        // Ponowne wejście (np. płatność nie doszła do skutku) — nie duplikujemy zapisu
        return res.json({ status: 'success', tpay_link: z.tpay_link, juz_zaakceptowana: 1 });
      }

      const reg = await pobierzRegulamin(payload.t);
      if (!reg.ok) return res.json({ status: 'error', message: 'Salon nie udostępnił regulaminu. Skontaktuj się z salonem.' });

      let idKlienta = z.id_klienta;
      let imie = z.imie_nazwisko;
      let telefon = z.telefon;

      if (!idKlienta) {
        // Wariant 2: osoba spoza bazy — walidacja danych + auto-utworzenie profilu klienta
        imie = String(req.body.imie_nazwisko || '').trim().replace(/\s+/g, ' ').slice(0, 255);
        telefon = String(req.body.telefon || '').trim().slice(0, 40);
        const cyfry = telefon.replace(/\D/g, '');
        if (imie.length < 3 || !imie.includes(' ')) return res.json({ status: 'error', message: 'Podaj imię i nazwisko.' });
        if (cyfry.length < 9) return res.json({ status: 'error', message: 'Podaj prawidłowy numer telefonu (min. 9 cyfr).' });

        const maxR = await q(`SELECT MAX(CAST(id_klienta AS UNSIGNED)) AS maxId FROM Klienci WHERE tenant_id = ?`, [payload.t]);
        idKlienta = String(((maxR[0] && parseInt(maxR[0].maxId)) || 1000) + 1);
        await q(
          `INSERT INTO Klienci (id, tenant_id, id_klienta, imie_nazwisko, telefon, data_rejestracji, zgody_rodo_reg, notatki)
           VALUES (?, ?, ?, ?, ?, NOW(), 'Regulamin (online przy płatności)', ?)`,
          [randomUUID(), payload.t, idKlienta, imie, telefon, 'Profil utworzony przy płatności online (link tpay)']);
        await q(
          `INSERT INTO \`Rejestr_Oświadczeń\` (id, tenant_id, id_klienta, data_podpisu, klient, zapoznanie_z_regulaminem, przekazano_wyciag, pracownik)
           VALUES (?, ?, ?, NOW(), ?, 'TAK', 'NIE', 'online (płatność tpay)')`,
          [randomUUID(), payload.t, idKlienta, imie]).catch(e => console.error('[zgody] Rejestr_Oświadczeń INSERT:', e.message));
        await q(
          `INSERT INTO Rejestr_RODO (id, tenant_id, klient, data_podpisu, wizerunek, newsletter_sms, kontakt_tel, newsletter_email, booksy_sms, email_adres, id_klienta, pracownik)
           VALUES (?, ?, ?, NOW(), 'NIE', 'NIE', 'NIE', 'NIE', 'Nie dotyczy', 'nie dotyczy', ?, 'online (płatność tpay)')`,
          [randomUUID(), payload.t, imie, idKlienta]).catch(e => console.error('[zgody] Rejestr_RODO INSERT:', e.message));
      }

      const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 64);
      const ua = String(req.headers['user-agent'] || '').slice(0, 255);
      // dowód wersji: hash wklejonej treści, a przy regulaminie-linku — hash adresu URL
      const hash = createHash('sha256').update(reg.tresc || reg.url).digest('hex');

      const r = await q(
        `UPDATE ZgodyPlatnosci
            SET status = 'ZAAKCEPTOWANA', zaakceptowano_at = NOW(), ip = ?, user_agent = ?,
                regulamin_hash = ?, id_klienta = ?, imie_nazwisko = ?, telefon = ?
          WHERE tenant_id = ? AND id = ? AND status = 'OCZEKUJACA'`,
        [ip, ua, hash, idKlienta, imie, telefon, payload.t, payload.id]);
      if (!r.affectedRows) {
        const znow = await q(`SELECT tpay_link FROM ZgodyPlatnosci WHERE tenant_id = ? AND id = ? LIMIT 1`, [payload.t, payload.id]);
        return res.json({ status: 'success', tpay_link: znow[0] ? znow[0].tpay_link : z.tpay_link, juz_zaakceptowana: 1 });
      }

      zapiszLog(payload.t, 'PŁATNOŚĆ LINK', imie,
        `Akceptacja regulaminu online: ${imie} (ID klienta: ${idKlienta})${z.kwota !== null ? `, kwota ${Number(z.kwota).toFixed(2)} zł` : ''} [IP: ${ip}]`);
      return res.json({ status: 'success', tpay_link: z.tpay_link });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  return router;
};
