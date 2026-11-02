// routes/tpay.js
// Tpay przez API dla dodatku „Link do płatności” (platnosc_link) — PARTIA 1 (2.11.2026):
//   • dane dostępowe Tpay KAŻDEGO SALONU w jego wierszu tabeli Tenant_Tpay, zaszyfrowane AES-256-GCM
//     kluczem pochodnym salonu (HKDF z jednego klucza głównego TPAY_CONFIG_KEY w env + tenant_id);
//     w env NIE MA żadnych danych salonów — to warunek właściciela (dodatek dla wielu salonów);
//   • klient API: token OAuth (cache per salon), utworzenie transakcji, odczyt transakcji, „Sprawdź połączenie”;
//   • ekran konfiguracji w Administracji → Płatności online (tylko role admin/megaadmin, rola z bazy po loginie z sesji);
//   • rozpoczęcie płatności po akceptacji regulaminu (rozpocznijPlatnosc — woła routes/zgody.js z /zgoda/zaplac);
//   • webhook: na razie TYLKO zapis surowego ładunku do Tpay_Webhook_Log i odpowiedź 200 TRUE (przetwarzanie = partia 2).
// Salon BEZ wiersza w Tenant_Tpay działa dokładnie jak dotąd (ręczne wklejanie linku z panelu Tpay — „tryb ekspert”).
// Wyłączniki: TPAY_API=off (zero wywołań Tpay, zostaje tryb ręczny), TPAY_API=atrapa (środowisko testowe: udawane odpowiedzi).
// Zero sekretów w logach i odpowiedziach API (maskowanie ••••1234).

const express = require('express');
const crypto = require('crypto');
const { getSession } = require('./sessions');
const { makeHasFeature } = require('./features');
const { makeZapiszLog } = require('./logi');

const FEATURE_KEY = 'platnosc_link';
const API_PRODUKCJA = 'https://api.tpay.com';
const ROLE_KONFIGURACJI = new Set(['admin', 'megaadmin', 'właściciel', 'wlasciciel']);
const TOKEN_ZAPAS_MS = 5 * 60 * 1000;

const clean = (v) => String(v || '').replace(/^['"]|['"]$/g, '').trim();
function trybApi() {
  const t = clean(process.env.TPAY_API).toLowerCase();
  return t === 'off' ? 'off' : t === 'atrapa' ? 'atrapa' : 'on';
}
function bazaUrl() { return clean(process.env.APP_URL || 'https://estelio.com.pl').replace(/\/$/, ''); }

// ─── Szyfrowanie: klucz główny → klucz pochodny salonu → AES-256-GCM ───────────────────────────
function kluczGlowny() {
  const k = clean(process.env.TPAY_CONFIG_KEY);
  if (!k) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(k) ? Buffer.from(k, 'hex') : Buffer.from(k, 'base64');
  return buf.length === 32 ? buf : null;
}
function kluczDostepny() { return !!kluczGlowny(); }
function kluczSalonu(tenant, wersja = 1) {
  const m = kluczGlowny();
  if (!m) { const e = new Error('Brak klucza szyfrującego (TPAY_CONFIG_KEY).'); e.kod = 'BRAK_KLUCZA'; throw e; }
  return Buffer.from(crypto.hkdfSync('sha256', m, Buffer.from('estelio-tpay-v' + wersja), Buffer.from(String(tenant)), 32));
}
function zaszyfruj(tenant, tekst, wersja = 1) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kluczSalonu(tenant, wersja), iv);
  const ct = Buffer.concat([c.update(String(tekst), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function odszyfruj(tenant, blob, wersja = 1) {
  const b = Buffer.from(String(blob || ''), 'base64');
  if (b.length < 29) throw new Error('Uszkodzony szyfrogram.');
  const d = crypto.createDecipheriv('aes-256-gcm', kluczSalonu(tenant, wersja), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
function maskuj(s) { s = String(s || ''); return s ? '••••' + s.slice(-4) : ''; }
function noweCrc() { return 'est_' + crypto.randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase(); }

// ─── Żądanie HTTP do Tpay: 10 s, jedno ponowienie przy 5xx/sieci ──────────────────────────────
async function zadanie(url, opts, ponow = true) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* nie-JSON */ }
    if (res.status >= 500 && ponow) { clearTimeout(timer); return zadanie(url, opts, false); }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    if (ponow) { clearTimeout(timer); return zadanie(url, opts, false); }
    throw new Error('Tpay: brak połączenia (' + (e.name === 'AbortError' ? 'przekroczony czas' : e.message) + ')');
  } finally { clearTimeout(timer); }
}
function opisBledu(r) {
  if (!r) return 'brak odpowiedzi';
  const j = r.json || {};
  const z = j.message || j.error_description || j.error || (j.errors ? JSON.stringify(j.errors) : '') || (r.text || '').slice(0, 160);
  return `HTTP ${r.status}${z ? ': ' + String(z).slice(0, 200) : ''}`;
}

module.exports = (db) => {
  const router = express.Router();
  const hasFeature = makeHasFeature(db);
  const zapiszLog = makeZapiszLog(db);
  const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
  const tokeny = new Map(); // tenant → { token, exp } — per proces Node (Hostinger ma ich kilka; to tylko pamięć podręczna)

  // ─── Migracje (idempotentne; tylko NOWE tabele i dopisane kolumny NULL) ────────────────────────
  const mk = (sql, nazwa) => db.query(sql, (e) => { if (e) console.error('[tpay] migracja ' + nazwa + ':', e.message); });
  mk(`CREATE TABLE IF NOT EXISTS Tenant_Tpay (
      tenant_id VARCHAR(64) NOT NULL PRIMARY KEY,
      client_id VARCHAR(120) NOT NULL DEFAULT '',
      client_secret_enc TEXT NULL,
      security_code_enc TEXT NULL,
      merchant_id VARCHAR(40) NOT NULL DEFAULT '',
      sandbox TINYINT(1) NOT NULL DEFAULT 0,
      api_base VARCHAR(200) NOT NULL DEFAULT '${API_PRODUKCJA}',
      webhook_token CHAR(32) NOT NULL,
      key_version INT NOT NULL DEFAULT 1,
      updated_by VARCHAR(120) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_webhook (webhook_token)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, 'Tenant_Tpay');
  mk(`CREATE TABLE IF NOT EXISTS Tpay_Transakcje (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      zgoda_id INT NOT NULL,
      tpay_transaction_id VARCHAR(64) DEFAULT NULL,
      tpay_title VARCHAR(64) DEFAULT NULL,
      crc VARCHAR(32) NOT NULL,
      kwota_grosze INT NOT NULL,
      payment_url TEXT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      test_mode TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME NULL,
      last_checked_at DATETIME NULL,
      UNIQUE KEY uq_crc (tenant_id, crc),
      KEY idx_zgoda (tenant_id, zgoda_id),
      KEY idx_status (tenant_id, status, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, 'Tpay_Transakcje');
  mk(`CREATE TABLE IF NOT EXISTS Tpay_Webhook_Log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(64) NULL,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      remote_ip VARCHAR(64) DEFAULT '',
      raw_body MEDIUMTEXT NULL,
      jws_ok TINYINT(1) NULL,
      md5_ok TINYINT(1) NULL,
      tr_id VARCHAR(64) DEFAULT NULL,
      tr_crc VARCHAR(64) DEFAULT NULL,
      tr_status VARCHAR(32) DEFAULT NULL,
      result VARCHAR(24) NOT NULL DEFAULT 'zapisano',
      note VARCHAR(255) DEFAULT '',
      KEY idx_tenant (tenant_id, received_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_polish_ci`, 'Tpay_Webhook_Log');
  // ZgodyPlatnosci: oś czasu linku — dopisane kolumny NULL (istniejące wiersze = tryb ręczny, bez zmian)
  for (const kol of ['tryb VARCHAR(8) NULL', 'otwarto_at DATETIME NULL', 'platnosc_start_at DATETIME NULL', 'oplacono_at DATETIME NULL',
    'zwrot_at DATETIME NULL', 'kwota_wplacona DECIMAL(10,2) NULL', 'zadatek_id VARCHAR(64) NULL']) {
    db.query(`ALTER TABLE ZgodyPlatnosci ADD COLUMN ${kol}`, (e) => { if (e && e.code !== 'ER_DUP_FIELDNAME' && e.code !== 'ER_NO_SUCH_TABLE') console.error('[tpay] ALTER ZgodyPlatnosci:', e.message); });
  }

  // ─── Konfiguracja salonu ───────────────────────────────────────────────────────────────────────
  async function wierszKonfig(tenant) {
    const r = await q(`SELECT * FROM Tenant_Tpay WHERE tenant_id = ? LIMIT 1`, [tenant]);
    return r[0] || null;
  }
  /** Odszyfrowana konfiguracja albo null (brak wiersza). Rzuca kod BRAK_KLUCZA, gdy serwer nie ma klucza. */
  async function pobierzKonfig(tenant) {
    const w = await wierszKonfig(tenant);
    if (!w) return null;
    return {
      client_id: w.client_id,
      client_secret: w.client_secret_enc ? odszyfruj(tenant, w.client_secret_enc, w.key_version) : '',
      security_code: w.security_code_enc ? odszyfruj(tenant, w.security_code_enc, w.key_version) : '',
      merchant_id: w.merchant_id, sandbox: !!w.sandbox, api_base: w.api_base || API_PRODUKCJA,
      webhook_token: w.webhook_token, key_version: w.key_version,
    };
  }
  /** Czy salon ma działającą ścieżkę API (wiersz + klucz + wyłącznik nie „off”). Nigdy nie rzuca. */
  async function maKonfig(tenant) {
    try {
      if (trybApi() === 'off' || !kluczDostepny()) return false;
      const w = await wierszKonfig(tenant);
      return !!(w && w.client_id && w.client_secret_enc);
    } catch (e) { return false; }
  }
  const webhookUrl = (token) => `${bazaUrl()}/api/webhooks/tpay/${token}`;

  // ─── Klient API Tpay ───────────────────────────────────────────────────────────────────────────
  async function tokenSalonu(tenant, cfg) {
    if (trybApi() === 'atrapa') return 'atrapa-token';
    const c = tokeny.get(tenant);
    if (c && c.exp - Date.now() > TOKEN_ZAPAS_MS) return c.token;
    const r = await zadanie(cfg.api_base + '/oauth/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret }).toString(),
    });
    if (!r.ok || !r.json || !r.json.access_token) throw new Error('Tpay: autoryzacja nieudana (' + opisBledu(r) + ')');
    tokeny.set(tenant, { token: r.json.access_token, exp: Date.now() + ((Number(r.json.expires_in) || 7200) * 1000) });
    return r.json.access_token;
  }
  async function utworzTransakcje(tenant, cfg, dane) {
    const { kwotaGrosze, opis, crc, payer, notificationUrl, successUrl, errorUrl } = dane;
    if (trybApi() === 'atrapa') {
      return { transactionId: 'atrapa-' + crc, title: 'TR-ATR-' + crc.slice(-6).toUpperCase(), transactionPaymentUrl: successUrl + '&atrapa=1' };
    }
    const token = await tokenSalonu(tenant, cfg);
    const body = {
      amount: Math.round(kwotaGrosze) / 100,
      description: String(opis || 'Płatność').slice(0, 128),
      hiddenDescription: crc,
      callbacks: { notification: { url: notificationUrl }, payerUrls: { success: successUrl, error: errorUrl } },
    };
    if (payer && (payer.email || payer.name)) body.payer = { ...(payer.email ? { email: payer.email } : {}), ...(payer.name ? { name: payer.name } : {}) };
    const r = await zadanie(cfg.api_base + '/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body),
    });
    if (!r.ok || !r.json || !r.json.transactionPaymentUrl) throw new Error('Tpay: nie udało się utworzyć transakcji (' + opisBledu(r) + ')');
    return { transactionId: r.json.transactionId, title: r.json.title, transactionPaymentUrl: r.json.transactionPaymentUrl };
  }
  async function pobierzTransakcje(tenant, cfg, transactionId) {
    if (trybApi() === 'atrapa') return { transactionId, status: 'pending', atrapa: true };
    const token = await tokenSalonu(tenant, cfg);
    const r = await zadanie(cfg.api_base + '/transactions/' + encodeURIComponent(transactionId), { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok || !r.json) throw new Error('Tpay: nie udało się pobrać transakcji (' + opisBledu(r) + ')');
    return r.json;
  }
  /** „Sprawdź połączenie”: token + odczyt listy transakcji. Prawo do ZAPISU zweryfikuje dopiero pierwszy link (Tpay nie zwraca zakresu klucza). */
  async function sprawdzPolaczenie(tenant, cfg) {
    if (trybApi() === 'atrapa') return { ok: true, info: 'Środowisko testowe: połączenie udawane (TPAY_API=atrapa).' };
    tokeny.delete(tenant);
    const token = await tokenSalonu(tenant, cfg);
    const r = await zadanie(cfg.api_base + '/transactions?limit=1', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Tpay: token przyjęty, ale odczyt transakcji odrzucony (' + opisBledu(r) + ')');
    return { ok: true, info: 'Autoryzacja i odczyt działają. Uprawnienie do tworzenia transakcji potwierdzi pierwszy utworzony link.' };
  }

  // ─── Rozpoczęcie płatności (woła routes/zgody.js z /zgoda/zaplac, po akceptacji regulaminu) ────
  // Ponowne wejście w link przy transakcji „pending” z ostatnich 24 h → ten sam adres bramki (bez duplikatu).
  // Podwójne kliknięcie → blokada GET_LOCK na linku. Zwraca { url, transakcja_id } albo rzuca z czytelnym komunikatem.
  async function rozpocznijPlatnosc(tenant, z, tokenLinku) {
    if (trybApi() === 'off') throw new Error('Płatności online są chwilowo wyłączone. Poproś salon o link z panelu Tpay.');
    const cfg = await pobierzKonfig(tenant);
    if (!cfg) throw new Error('Salon nie ma skonfigurowanego konta Tpay.');
    const kwotaGr = Math.round(Number(z.kwota) * 100);
    if (!(kwotaGr > 0)) throw new Error('Link nie ma kwoty — poproś salon o nowy link.');
    const klucz = 'tpay:zaplac:' + tenant + ':' + z.id;
    const lock = await q(`SELECT GET_LOCK(?, 8) AS l`, [klucz]);
    if (!lock[0] || lock[0].l !== 1) throw new Error('Płatność jest właśnie przygotowywana — odśwież stronę za chwilę.');
    try {
      const istn = await q(`SELECT id, payment_url FROM Tpay_Transakcje WHERE tenant_id = ? AND zgoda_id = ? AND status = 'pending'
                              AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY id DESC LIMIT 1`, [tenant, z.id]);
      if (istn.length && istn[0].payment_url) return { url: istn[0].payment_url, transakcja_id: istn[0].id, ponownie: true };
      const crc = noweCrc();
      const baza = bazaUrl();
      const t = encodeURIComponent(tokenLinku);
      const tr = await utworzTransakcje(tenant, cfg, {
        kwotaGrosze: kwotaGr,
        opis: (z.opis ? z.opis + ' — ' : '') + 'Estelio',
        crc,
        payer: z.imie_nazwisko ? { name: String(z.imie_nazwisko).slice(0, 100) } : null,
        notificationUrl: webhookUrl(cfg.webhook_token),
        successUrl: `${baza}/platnosc.html?t=${t}&wynik=ok`,
        errorUrl: `${baza}/platnosc.html?t=${t}&wynik=blad`,
      });
      const ins = await q(`INSERT INTO Tpay_Transakcje (tenant_id, zgoda_id, tpay_transaction_id, tpay_title, crc, kwota_grosze, payment_url, status, test_mode)
                           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [tenant, z.id, tr.transactionId || null, tr.title || null, crc, kwotaGr, tr.transactionPaymentUrl, cfg.sandbox || trybApi() === 'atrapa' ? 1 : 0]);
      await q(`UPDATE ZgodyPlatnosci SET platnosc_start_at = COALESCE(platnosc_start_at, NOW()) WHERE tenant_id = ? AND id = ?`, [tenant, z.id]);
      zapiszLog(tenant, 'PŁATNOŚĆ LINK', z.imie_nazwisko || 'klient', `Link #${z.id}: utworzono transakcję Tpay ${tr.title || ''} na ${(kwotaGr / 100).toFixed(2)} zł`);
      return { url: tr.transactionPaymentUrl, transakcja_id: ins.insertId, ponownie: false };
    } finally {
      await q(`SELECT RELEASE_LOCK(?) AS r`, [klucz]).catch(() => {});
    }
  }

  // ─── RBAC: konfiguracja tylko dla admin/megaadmin, rola z BAZY po loginie z sesji ─────────────
  function wymagajAdmina(req, tenant, cb) {
    const s = getSession(req.headers['x-session-token']);
    if (!s || String(s.tenant_id) !== String(tenant) || !s.login) return cb(null);
    db.query(`SELECT rola FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`, [tenant, String(s.login).trim()], (err, rows) => {
      if (err || !rows || !rows.length) return cb(null);
      const rola = String(rows[0].rola || '').toLowerCase().trim();
      cb(ROLE_KONFIGURACJI.has(rola) ? { imie: String(s.login).trim(), rola } : null);
    });
  }
  const ODMOWA = { status: 'error', code: 'UPRAWNIENIA', message: 'Konfigurację Tpay zmienia właściciel salonu (rola Admin lub Megaadmin).' };

  // GET /api/tpay/konfiguracja?tenant_id=… — stan konfiguracji (sekrety zamaskowane)
  router.get('/tpay/konfiguracja', (req, res) => {
    const tenant = req.query.tenant_id;
    if (!tenant) return res.json({ status: 'error', message: 'Brak tenant_id' });
    hasFeature(tenant, FEATURE_KEY, (ok) => {
      if (!ok) return res.json({ status: 'error', message: 'Dodatek „Link do płatności” nie jest aktywny.' });
      wymagajAdmina(req, tenant, async (kto) => {
        if (!kto) return res.json(ODMOWA);
        try {
          const w = await wierszKonfig(tenant);
          return res.json({
            status: 'success', tryb: trybApi(), klucz_ok: kluczDostepny() ? 1 : 0, skonfigurowano: w ? 1 : 0,
            client_id: w ? w.client_id : '', client_secret_mask: w && w.client_secret_enc ? '••••••••' : '',
            security_code_mask: w && w.security_code_enc ? '••••••••' : '', merchant_id: w ? w.merchant_id : '',
            sandbox: w ? Number(w.sandbox) : 0, api_base: w ? w.api_base : API_PRODUKCJA,
            webhook_url: w ? webhookUrl(w.webhook_token) : '', updated_at: w ? w.updated_at : null, updated_by: w ? w.updated_by : '',
          });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      });
    });
  });

  // POST /api/tpay/konfiguracja — zapis (sekrety puste przy edycji = bez zmiany)
  router.post('/tpay/konfiguracja', (req, res) => {
    const d = req.body || {};
    const tenant = d.tenant_id;
    if (!tenant) return res.json({ status: 'error', message: 'Brak tenant_id' });
    hasFeature(tenant, FEATURE_KEY, (ok) => {
      if (!ok) return res.json({ status: 'error', message: 'Dodatek „Link do płatności” nie jest aktywny.' });
      wymagajAdmina(req, tenant, async (kto) => {
        if (!kto) return res.json(ODMOWA);
        try {
          if (d.usun) {
            await q(`DELETE FROM Tenant_Tpay WHERE tenant_id = ?`, [tenant]);
            tokeny.delete(tenant);
            zapiszLog(tenant, 'TPAY KONFIGURACJA', kto.imie, 'Usunięto konfigurację Tpay — powrót do ręcznego wklejania linków');
            return res.json({ status: 'success', skonfigurowano: 0 });
          }
          if (!kluczDostepny()) return res.json({ status: 'error', code: 'BRAK_KLUCZA', message: 'Serwer nie ma klucza szyfrującego (TPAY_CONFIG_KEY). Skontaktuj się z Estelio.' });
          const clientId = String(d.client_id || '').trim().slice(0, 120);
          const merchantId = String(d.merchant_id || '').trim().slice(0, 40);
          const secret = String(d.client_secret || '').trim();
          const code = String(d.security_code || '').trim();
          const sandbox = d.sandbox ? 1 : 0;
          const apiBase = String(d.api_base || '').trim().replace(/\/$/, '') || API_PRODUKCJA;
          if (!/^https:\/\/[a-z0-9.-]+\.tpay\.com$/i.test(apiBase)) return res.json({ status: 'error', message: 'Adres API musi być adresem https w domenie tpay.com.' });
          if (!clientId) return res.json({ status: 'error', message: 'Podaj Client ID z panelu Tpay (Integracja → API).' });
          if (!/^\d+$/.test(merchantId)) return res.json({ status: 'error', message: 'ID sprzedawcy (Merchant ID) to liczba z panelu Tpay.' });
          const istn = await wierszKonfig(tenant);
          if (!istn && (!secret || !code)) return res.json({ status: 'error', message: 'Przy pierwszym zapisie podaj Client Secret i kod zabezpieczający.' });
          const wersja = 1;
          if (istn) {
            await q(`UPDATE Tenant_Tpay SET client_id = ?, merchant_id = ?, sandbox = ?, api_base = ?, updated_by = ?
                      ${secret ? ', client_secret_enc = ?, key_version = ?' : ''} ${code ? ', security_code_enc = ?' : ''} WHERE tenant_id = ?`,
              [clientId, merchantId, sandbox, apiBase, kto.imie.slice(0, 120), ...(secret ? [zaszyfruj(tenant, secret, wersja), wersja] : []), ...(code ? [zaszyfruj(tenant, code, wersja)] : []), tenant]);
          } else {
            await q(`INSERT INTO Tenant_Tpay (tenant_id, client_id, client_secret_enc, security_code_enc, merchant_id, sandbox, api_base, webhook_token, key_version, updated_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [tenant, clientId, zaszyfruj(tenant, secret, wersja), zaszyfruj(tenant, code, wersja), merchantId, sandbox, apiBase, crypto.randomBytes(16).toString('hex'), wersja, kto.imie.slice(0, 120)]);
          }
          tokeny.delete(tenant);
          zapiszLog(tenant, 'TPAY KONFIGURACJA', kto.imie, `${istn ? 'Zmieniono' : 'Zapisano'} konfigurację Tpay (client ${maskuj(clientId)}, merchant ${merchantId}${sandbox ? ', sandbox' : ''}${secret ? ', nowy secret' : ''}${code ? ', nowy kod' : ''})`);
          const w = await wierszKonfig(tenant);
          return res.json({ status: 'success', skonfigurowano: 1, webhook_url: webhookUrl(w.webhook_token) });
        } catch (e) { return res.json({ status: 'error', message: e.message }); }
      });
    });
  });

  // POST /api/tpay/sprawdz — „Sprawdź połączenie”
  router.post('/tpay/sprawdz', (req, res) => {
    const tenant = (req.body || {}).tenant_id;
    if (!tenant) return res.json({ status: 'error', message: 'Brak tenant_id' });
    wymagajAdmina(req, tenant, async (kto) => {
      if (!kto) return res.json(ODMOWA);
      try {
        if (trybApi() === 'off') return res.json({ status: 'error', message: 'Płatności przez API są wyłączone na serwerze (TPAY_API=off).' });
        const cfg = await pobierzKonfig(tenant);
        if (!cfg) return res.json({ status: 'error', message: 'Najpierw zapisz konfigurację.' });
        const w = await sprawdzPolaczenie(tenant, cfg);
        zapiszLog(tenant, 'TPAY KONFIGURACJA', kto.imie, 'Sprawdzenie połączenia z Tpay: OK');
        return res.json({ status: 'success', info: w.info });
      } catch (e) {
        zapiszLog(tenant, 'TPAY KONFIGURACJA', kto.imie, 'Sprawdzenie połączenia z Tpay: BŁĄD — ' + String(e.message).slice(0, 180));
        return res.json({ status: 'error', code: e.kod || '', message: e.message });
      }
    });
  });

  // POST /api/webhooks/tpay/:token — PARTIA 1: tylko zapis surowego ładunku + 200 TRUE (przetwarzanie w partii 2).
  // server.js montuje dla tej ścieżki express.raw PRZED express.json, więc req.body to Buffer.
  router.post('/webhooks/tpay/:token', async (req, res) => {
    const token = String(req.params.token || '');
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 64);
    let tenant = null;
    try {
      if (/^[0-9a-f]{32}$/.test(token)) { const w = await q(`SELECT tenant_id FROM Tenant_Tpay WHERE webhook_token = ? LIMIT 1`, [token]); tenant = w[0] ? w[0].tenant_id : null; }
      const p = new URLSearchParams(raw);
      // bez danych kart w logu
      for (const k of [...p.keys()]) if (/^card_|^tokenPaymentData/i.test(k)) p.delete(k);
      await q(`INSERT INTO Tpay_Webhook_Log (tenant_id, remote_ip, raw_body, tr_id, tr_crc, tr_status, result, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tenant, ip, p.toString().slice(0, 60000), (p.get('tr_id') || '').slice(0, 64), (p.get('tr_crc') || '').slice(0, 64), (p.get('tr_status') || '').slice(0, 32),
          tenant ? 'zapisano' : 'nieznany_token', tenant ? 'partia 1: zapis bez przetwarzania' : 'brak salonu dla tokenu']);
    } catch (e) { console.error('[tpay] webhook log:', e.message); }
    if (!tenant) return res.status(404).type('text/plain').send('FALSE');
    return res.status(200).type('text/plain').send('TRUE');
  });

  const narzedzia = { trybApi, kluczDostepny, maKonfig, pobierzKonfig, rozpocznijPlatnosc, utworzTransakcje, pobierzTransakcje, sprawdzPolaczenie, webhookUrl, FEATURE_KEY };
  return { router, narzedzia };
};

// czyste funkcje do testów
module.exports.szyfr = { kluczGlowny, kluczDostepny, kluczSalonu, zaszyfruj, odszyfruj, maskuj, noweCrc, trybApi, bazaUrl };
