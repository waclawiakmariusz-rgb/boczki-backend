// routes/billing.js
// Panel rozliczeniowy właściciela salonu — billing.html

const express = require('express');
const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const BCRYPT_ROUNDS = 10;

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
  // Bcrypt + auto-migracja plain → hash (kompatybilność z auth.js).
  router.post('/billing/login', (req, res) => {
    const { login, haslo } = req.body || {};
    if (!login || !haslo) return res.json({ status: 'error', message: 'Podaj login i hasło.' });

    db.query(
      `SELECT id_bazy, nazwa_salonu, email, status, data_waznosci, haslo, login
       FROM Licencje WHERE LOWER(TRIM(login)) = LOWER(TRIM(?)) AND rola != 'pracownik' LIMIT 1`,
      [login.trim()],
      async (err, rows) => {
        if (err) return res.json({ status: 'error', message: 'Błąd bazy danych.' });
        if (!rows || !rows.length) {
          return res.json({ status: 'error', message: 'Błędny login lub hasło.' });
        }
        const salon = rows[0];

        // Sprawdź hasło — bcrypt jeśli zaczyna od $2b$/$2a$, inaczej plaintext + auto-migracja
        const isHashed = salon.haslo && (salon.haslo.startsWith('$2b$') || salon.haslo.startsWith('$2a$'));
        let passwordOk = false;
        if (isHashed) {
          try { passwordOk = await bcrypt.compare(haslo.trim(), salon.haslo); }
          catch (e) { passwordOk = false; }
        } else {
          passwordOk = String(salon.haslo || '').trim() === String(haslo).trim();
          // Auto-migracja: po pierwszym sukcesie zahashuj
          if (passwordOk) {
            try {
              const hash = await bcrypt.hash(haslo.trim(), BCRYPT_ROUNDS);
              db.query('UPDATE Licencje SET haslo = ? WHERE LOWER(TRIM(login)) = LOWER(TRIM(?))', [hash, salon.login]);
            } catch (e) { /* nie blokuj logowania jeśli hash się nie udał */ }
          }
        }

        if (!passwordOk) {
          return res.json({ status: 'error', message: 'Błędny login lub hasło.' });
        }

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
      `SELECT nazwa_salonu, email, telefon, miasto, status, data_waznosci, data_grace_until, data_utworzenia
       FROM Licencje WHERE id_bazy = ? LIMIT 1`,
      [req.billing_tenant_id],
      (err, rows) => {
        if (err || !rows || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono salonu.' });
        const s = rows[0];
        const teraz = new Date();
        const wazna = s.data_waznosci ? new Date(s.data_waznosci) : null;
        const aktywna = ['aktywna', 'aktywny'].includes(s.status) && wazna && wazna > teraz;

        return res.json({
          status: 'success',
          salon: {
            nazwa:           s.nazwa_salonu,
            email:           s.email,
            telefon:         s.telefon || '',
            miasto:          s.miasto  || '',
            status:          s.status,
            aktywna,
            data_waznosci:   s.data_waznosci   || null,
            data_grace_until: s.data_grace_until || null,
            data_utworzenia: s.data_utworzenia || null,
          }
        });
      }
    );
  });

  // ─── POST /api/billing/portal-session ─────────────────────────
  // Tworzy Stripe Customer Portal session dla zalogowanego salonu.
  // Zwraca URL — frontend redirectuje (lub otwiera w nowej karcie).
  // Tam klient zarządza kartą, anuluje subskrypcję, pobiera faktury Stripe.
  router.post('/billing/portal-session', requireBilling, async (req, res) => {
    let stripe;
    try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); }
    catch (e) { return res.json({ status: 'error', message: 'Stripe nie jest skonfigurowany.' }); }

    db.query(
      `SELECT email, stripe_customer_id FROM Licencje WHERE id_bazy = ? LIMIT 1`,
      [req.billing_tenant_id],
      async (err, rows) => {
        if (err || !rows || !rows.length) return res.json({ status: 'error', message: 'Salon nie znaleziony.' });
        let { email, stripe_customer_id } = rows[0];

        try {
          // Fallback: jeśli brak customer_id w bazie (stara rejestracja), znajdź po email w Stripe
          if (!stripe_customer_id && email) {
            const search = await stripe.customers.list({ email, limit: 1 });
            if (search.data.length > 0) {
              stripe_customer_id = search.data[0].id;
              db.query('UPDATE Licencje SET stripe_customer_id = ? WHERE id_bazy = ?', [stripe_customer_id, req.billing_tenant_id]);
            }
          }
          if (!stripe_customer_id) {
            return res.json({ status: 'error', message: 'Nie znaleziono konta w Stripe. Skontaktuj się: kontakt@estelio.com.pl' });
          }
          const APP_URL = (process.env.APP_URL || 'https://estelio.com.pl').replace(/\/$/, '').replace(/^['"]|['"]$/g, '');
          const portal = await stripe.billingPortal.sessions.create({
            customer: stripe_customer_id,
            return_url: `${APP_URL}/billing.html`,
          });
          return res.json({ status: 'success', url: portal.url });
        } catch (e) {
          console.error('[billing/portal-session]', e.message);
          return res.json({ status: 'error', message: 'Stripe error: ' + e.message });
        }
      }
    );
  });

  // ─── GET /api/billing/invoices ────────────────────────────────
  // Lista faktur VAT klienta z Fakturownia.pl
  router.get('/billing/invoices', requireBilling, async (req, res) => {
    let pobierzFaktury;
    try { pobierzFaktury = require('./fakturownia').pobierzFaktury; }
    catch (e) { return res.json({ status: 'error', message: 'Fakturownia niedostępna.' }); }

    db.query(
      `SELECT email FROM Licencje WHERE id_bazy = ? LIMIT 1`,
      [req.billing_tenant_id],
      async (err, rows) => {
        if (err || !rows || !rows.length) return res.json({ status: 'error', message: 'Salon nie znaleziony.' });
        const email = rows[0].email;
        try {
          const faktury = await pobierzFaktury(email);
          return res.json({ status: 'success', faktury });
        } catch (e) {
          console.error('[billing/invoices]', e.message);
          return res.json({ status: 'error', message: 'Błąd pobierania faktur: ' + e.message });
        }
      }
    );
  });

  return router;
};
