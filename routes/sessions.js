// routes/sessions.js
// Server-side session store + rate limiter dla logowania
//
// Sesje są persistowane w MySQL (tabela `Sesje`) z dodatkowym memory-cache.
// Cache zapewnia synchroniczne API (`getSession` zwraca obiekt, nie Promise),
// więc callsite (auth.js, users.js, dokumenty.js, helpkb.js, server.js) NIE
// wymagają zmian. Persist gwarantuje że restart Node nie wylogowuje
// pracowników i nie unieważnia linków do PDF (RODO/regulamin).
//
// Init wywoływany z server.js po utworzeniu pool DB:
//   const { initSessions } = require('./routes/sessions');
//   initSessions(db);

const { randomUUID } = require('crypto');

// ─── SESSION STORE ────────────────────────────────────────────
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 godzin
const sessions = new Map(); // token -> { tenant_id, login, expires }
let _db = null; // ustawiany przez initSessions() — fire-and-forget INSERT/DELETE

// ─── PERSIST (write-through do tabeli `Sesje`) ────────────────
function persistInsert(token, tenant_id, login, expiresMs) {
  if (!_db) return;
  _db.query(
    'INSERT INTO `Sesje` (`token`, `tenant_id`, `login`, `expires`) VALUES (?, ?, ?, FROM_UNIXTIME(?))',
    [token, tenant_id, login || null, Math.floor(expiresMs / 1000)],
    (err) => { if (err) console.error('[sessions persist INSERT]', err.message); }
  );
}
function persistDelete(token) {
  if (!_db) return;
  _db.query('DELETE FROM `Sesje` WHERE `token` = ?', [token],
    (err) => { if (err) console.error('[sessions persist DELETE]', err.message); }
  );
}

// ─── INIT — tworzy tabelę, czyści wygasłe, preloaduje aktywne do pamięci ──
function initSessions(db) {
  _db = db;
  db.query(`
    CREATE TABLE IF NOT EXISTS \`Sesje\` (
      \`token\`      VARCHAR(40) NOT NULL PRIMARY KEY,
      \`tenant_id\`  VARCHAR(64) NOT NULL,
      \`login\`      VARCHAR(100) DEFAULT NULL,
      \`expires\`    DATETIME NOT NULL,
      \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY \`idx_sesje_tenant\` (\`tenant_id\`),
      KEY \`idx_sesje_expires\` (\`expires\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, (err) => {
    if (err) { console.error('[migration] Sesje:', err.message); return; }
    console.log('[migration] Sesje OK');
    // Wyczyść wygasłe na starcie
    db.query('DELETE FROM `Sesje` WHERE `expires` < NOW()', (e) => {
      if (e) console.error('[sessions cleanup at start]', e.message);
    });
    // Preload aktywnych do pamięci — synchroniczne API getSession() polega na cache
    db.query(
      'SELECT `token`, `tenant_id`, `login`, UNIX_TIMESTAMP(`expires`) AS expires_unix FROM `Sesje` WHERE `expires` > NOW()',
      (err2, rows) => {
        if (err2) { console.error('[sessions preload]', err2.message); return; }
        for (const r of rows || []) {
          sessions.set(r.token, {
            tenant_id: r.tenant_id,
            login: r.login,
            expires: Number(r.expires_unix) * 1000,
          });
        }
        console.log(`[sessions preload] załadowano ${sessions.size} aktywnych sesji z bazy`);
      }
    );
  });
}

// Sprzątanie wygasłych sesji co 30 minut — pamięć + baza
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions.entries()) {
    if (now > s.expires) sessions.delete(token);
  }
  if (_db) {
    _db.query('DELETE FROM `Sesje` WHERE `expires` < NOW()',
      (err) => { if (err) console.error('[sessions cleanup interval]', err.message); });
  }
}, 30 * 60 * 1000);

function createSession(tenant_id, login) {
  const token = randomUUID();
  const expires = Date.now() + SESSION_TTL;
  sessions.set(token, { tenant_id, login, expires });
  persistInsert(token, tenant_id, login, expires);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) {
    sessions.delete(token);
    persistDelete(token);
    return null;
  }
  return s;
}

function deleteSession(token) {
  sessions.delete(token);
  persistDelete(token);
}

// Sprawdź czy token pasuje do żądanego tenant_id
// Zwraca: { valid: true, session } lub { valid: false, reason: 'expired'|'mismatch'|'missing' }
function validateTenantAccess(token, tenant_id) {
  if (!token) return { valid: false, reason: 'missing' };
  const s = getSession(token);
  if (!s) return { valid: false, reason: 'expired' };
  if (s.tenant_id !== tenant_id) return { valid: false, reason: 'mismatch' };
  return { valid: true, session: s };
}

// ─── RATE LIMITER ─────────────────────────────────────────────
const LOGIN_WINDOW_MS  = 15 * 60 * 1000; // 15 minut
const LOGIN_MAX_TRIES  = 10;              // max prób w oknie
const loginAttempts = new Map(); // ip -> { count, resetAt }

// Middleware: dołącz do endpointu logowania
function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();

  let record = loginAttempts.get(ip);
  if (record && now > record.resetAt) {
    loginAttempts.delete(ip);
    record = null;
  }

  if (record && record.count >= LOGIN_MAX_TRIES) {
    const pozostalo = Math.ceil((record.resetAt - now) / 60000);
    return res.status(429).json({
      status: 'error',
      message: `Za dużo prób logowania. Spróbuj za ${pozostalo} min.`,
    });
  }

  next();
}

// Wywołaj po nieudanym logowaniu (zlicza próbę)
function recordFailedLogin(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  record.count++;
  loginAttempts.set(ip, record);
}

// Wywołaj po udanym logowaniu (czyści licznik dla tego IP)
function recordSuccessLogin(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  loginAttempts.delete(ip);
}

// ─── RATE LIMITER PIN ──────────────────────────────────────────
// Osobny licznik dla PIN-ów pracowników (verify_pin).
// PIN to 4-6 cyfr — bez rate limitu można brute force'ować w &lt;100 sekund.
// Klucz to (ip + tenant_id + imie) — żeby nie blokować całego IP gdy
// jeden pracownik wpisze zły PIN, ale blokować konkretny atak.
const PIN_WINDOW_MS = 5 * 60 * 1000; // 5 minut
const PIN_MAX_TRIES = 10;
const pinAttempts = new Map(); // (ip+tenant+imie) -> { count, resetAt }

function pinKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const tenant = String(req.body?.tenant_id || '').trim();
  const imie = String(req.body?.imie || '').trim().toLowerCase();
  return `${ip}|${tenant}|${imie}`;
}

function rateLimitPin(req, res, next) {
  // Tylko gdy faktycznie verify_pin
  if (req.body?.action !== 'verify_pin') return next();
  const key = pinKey(req);
  const now = Date.now();
  let record = pinAttempts.get(key);
  if (record && now > record.resetAt) {
    pinAttempts.delete(key);
    record = null;
  }
  if (record && record.count >= PIN_MAX_TRIES) {
    const pozostalo = Math.ceil((record.resetAt - now) / 60000);
    return res.status(429).json({
      status: 'error',
      message: `Za dużo nieudanych prób PIN. Spróbuj za ${pozostalo} min.`,
    });
  }
  next();
}

function recordFailedPin(req) {
  const key = pinKey(req);
  const now = Date.now();
  const record = pinAttempts.get(key) || { count: 0, resetAt: now + PIN_WINDOW_MS };
  record.count++;
  pinAttempts.set(key, record);
}

function recordSuccessPin(req) {
  const key = pinKey(req);
  pinAttempts.delete(key);
}

// ─── RATE LIMITER PUBLICZNY ───────────────────────────────────
// Dla endpointów publicznych bez logowania (zamówienia, checkout, rejestracja).
// Zlicza KAŻDE żądanie z IP (nie tylko nieudane) — chroni przed spamem
// zapełniającym Zamowienia i nabijającym liczniki voucherów.
function makePublicLimiter({ windowMs = 15 * 60 * 1000, max = 10, message = 'Za dużo żądań z tego adresu. Spróbuj ponownie później.' } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) if (now > rec.resetAt) hits.delete(ip);
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let rec = hits.get(ip);
    if (rec && now > rec.resetAt) { hits.delete(ip); rec = null; }
    if (!rec) { rec = { count: 0, resetAt: now + windowMs }; hits.set(ip, rec); }
    rec.count++;
    if (rec.count > max) {
      const pozostalo = Math.ceil((rec.resetAt - now) / 60000);
      return res.status(429).json({ status: 'error', message: `${message} (ok. ${pozostalo} min)` });
    }
    next();
  };
}

module.exports = {
  initSessions,
  createSession,
  getSession,
  deleteSession,
  validateTenantAccess,
  rateLimitLogin,
  rateLimitPin,
  recordFailedPin,
  recordSuccessPin,
  recordFailedLogin,
  recordSuccessLogin,
  makePublicLimiter,
};
