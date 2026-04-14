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

module.exports = {
  createSession,
  getSession,
  deleteSession,
  validateTenantAccess,
  rateLimitLogin,
  recordFailedLogin,
  recordSuccessLogin,
};
