// routes/billing.js
// Panel rozliczeniowy właściciela salonu — billing.html

const express = require('express');
const { randomUUID } = require('crypto');

function stripQuotes(val) {
  return (val || '').replace(/^['"]|['"]$/g, '');
}

const BILLING_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dni, sliding

module.exports = (db) => {
  const router = express.Router();

  // Utwórz tabelę sesji billing jeśli nie istnieje
  db.query(`
    CREATE TABLE IF NOT EXISTS billing_sessions (
      token VARCHAR(36) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      expires BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, err => { if (err) console.error('[billing_sessions] Błąd CREATE TABLE:', err.message); });

  // Czyść stare sesje co 6 godzin
  setInterval(() => {
    db.query('DELETE FROM billing_sessions WHERE expires < ?', [Date.now()]);
  }, 6 * 60 * 60 * 1000);

  // Middleware weryfikacji sesji billing
  function requireBilling(req, res, next) {
    const token = req.headers['x-billing-token'];
    if (!token) return res.status(403).json({ status: 'error', message: 'Brak dostępu.' });
    db.query(
      'SELECT tenant_id, expires FROM billing_sessions WHERE token = ?',
      [token],
      (err, rows) => {
        if (err || !rows || !rows.length || Date.now() > rows[0].expires) {
          return res.status(403).json({ status: 'error', message: 'Sesja wygasła — zaloguj się ponownie.' });
        }
        // Sliding expiry
        db.query('UPDATE billing_sessions SET expires = ? WHERE token = ?', [Date.now() + BILLING_SESSION_TTL_MS, token]);
        req.billing_tenant_id = rows[0].tenant_id;
        next();
      }
    );
  }

  // ─── POST /api/billing/login ──────────────────────────────────
  router.post('/billing/login', (req, res) => {
    const { login, haslo } = req.body || {};
    if (!login || !haslo) return res.json({ status: 'error', message: 'Podaj login i hasło.' });

    db.query(
      `SELECT id_bazy, nazwa_salonu, email, status, data_waznosci
       FROM Licencje WHERE login = ? AND haslo = ? AND rola != 'pracownik' LIMIT 1`,
      [login.trim(), haslo],
      (err, rows) => {
        if (err) return res.json({ status: 'error', message: 'Błąd bazy danych.' });
        if (!rows || !rows.length) {
          return res.json({ status: 'error', message: 'Błędny login lub hasło.' });
        }
        const salon = rows[0];
        const token = randomUUID();
        const expires = Date.now() + BILLING_SESSION_TTL_MS;
        db.query(
          'INSERT INTO billing_sessions (token, tenant_id, expires) VALUES (?, ?, ?)',
          [token, salon.id_bazy, expires],
          (err2) => {
            if (err2) return res.json({ status: 'error', message: 'Błąd zapisu sesji.' });
            return res.json({
              status: 'success',
              token,
              salon: {
                nazwa:        salon.nazwa_salonu,
                email:        salon.email,
                status:       salon.status,
                data_waznosci: salon.data_waznosci,
              }
            });
          }
        );
      }
    );
  });

  // ─── GET /api/billing/info ────────────────────────────────────
  router.get('/billing/info', requireBilling, (req, res) => {
    db.query(
      `SELECT nazwa_salonu, email, telefon, miasto, status, data_waznosci, data_utworzenia
       FROM Licencje WHERE id_bazy = ? LIMIT 1`,
      [req.billing_tenant_id],
      (err, rows) => {
        if (err || !rows || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono salonu.' });
        const s = rows[0];
        const teraz = new Date();
        const wazna = s.data_waznosci ? new Date(s.data_waznosci) : null;
        const aktywna = s.status === 'aktywna' && wazna && wazna > teraz;

        return res.json({
          status: 'success',
          salon: {
            nazwa:          s.nazwa_salonu,
            email:          s.email,
            telefon:        s.telefon || '',
            miasto:         s.miasto  || '',
            status:         s.status,
            aktywna,
            data_waznosci:  s.data_waznosci  || null,
            data_utworzenia: s.data_utworzenia || null,
          }
        });
      }
    );
  });

  return router;
};
