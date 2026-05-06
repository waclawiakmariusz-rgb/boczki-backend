// routes/sessions.js
// Server-side session store + rate limiter dla logowania
// Nie wymaga żadnych nowych paczek — crypto jest wbudowane w Node.js

const { randomUUID } = require('crypto');

// ─── SESSION STORE ────────────────────────────────────────────
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 godzin
const sessions = new Map(); // token -> { tenant_id, login, expires }

// Sprzątanie wygasłych sesji co 30 minut
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions.entries()) {
    if (now > s.expires) sessions.delete(token);
  }
}, 30 * 60 * 1000);

function createSession(tenant_id, login) {
  const token = randomUUID();
  sessions.set(token, { tenant_id, login, expires: Date.now() + SESSION_TTL });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) { sessions.delete(token); return null; }
  return s;
}

function deleteSession(token) {
  sessions.delete(token);
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

module.exports = {
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
};
