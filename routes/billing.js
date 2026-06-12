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
      `SELECT nazwa_salonu, email, telefon, ulica, miasto, status, data_waznosci, data_grace_until, data_utworzenia, stripe_subscription_id
       FROM Licencje WHERE id_bazy = ? LIMIT 1`,
      [req.billing_tenant_id],
      async (err, rows) => {
        if (err || !rows || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono salonu.' });
        const s = rows[0];
        const teraz = new Date();
        const wazna = s.data_waznosci ? new Date(s.data_waznosci) : null;
        const aktywna = ['aktywna', 'aktywny'].includes(s.status) && wazna && wazna > teraz;

        // Realna kwota abonamentu ze Stripe (uwzględnia voucher/coupon),
        // zamiast sztywnego cennika. Brak danych → frontend pokaże cenę z env.
        let abonament = null;
        try {
          if (process.env.STRIPE_SECRET_KEY) {
            const stripe = require('stripe')(stripQuotes(process.env.STRIPE_SECRET_KEY));

            // Fallback: zakup odbywa się PRZED rejestracją, więc webhook invoice.paid
            // nie miał jeszcze rekordu Licencje i nie zapisał id-ków — szukamy po emailu.
            let subId = s.stripe_subscription_id;
            if (!subId && s.email) {
              const customers = await stripe.customers.list({ email: s.email, limit: 1 });
              if (customers.data[0]) {
                const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, limit: 1 });
                if (subs.data[0]) {
                  subId = subs.data[0].id;
                  db.query(
                    `UPDATE Licencje SET stripe_customer_id = COALESCE(stripe_customer_id, ?),
                            stripe_subscription_id = COALESCE(stripe_subscription_id, ?)
                     WHERE id_bazy = ?`,
                    [customers.data[0].id, subId, req.billing_tenant_id]
                  );
                }
              }
            }

            if (subId) {
              const sub = await stripe.subscriptions.retrieve(subId, { expand: ['discounts'] });
              const bazowa = (sub.items && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.unit_amount) || null;
              if (bazowa !== null) {
                // discount: nowe API → discounts[] (obiekty po expand), stare → pole discount
                const disc = (Array.isArray(sub.discounts) && typeof sub.discounts[0] === 'object' && sub.discounts[0])
                  || sub.discount || null;
                let kwota = bazowa;
                if (disc && disc.coupon) {
                  if (disc.coupon.percent_off)     kwota = Math.round(bazowa * (100 - disc.coupon.percent_off) / 100);
                  else if (disc.coupon.amount_off) kwota = Math.max(0, bazowa - disc.coupon.amount_off);
                }
                abonament = {
                  kwota_grosze:  kwota,
                  bazowa_grosze: bazowa,
                  rabat_do:      (disc && disc.end) ? new Date(disc.end * 1000).toISOString().slice(0, 10) : null,
                  voucher:       (disc && disc.coupon && disc.coupon.name) || null,
                };
              }
            }
          }
        } catch (e) {
          console.error('[billing/info] Stripe subscription fetch:', e.message);
        }
        if (!abonament) {
          const grosze = parseInt(process.env.STRIPE_CENA_GROSZE || '7900');
          abonament = { kwota_grosze: grosze, bazowa_grosze: grosze, rabat_do: null, voucher: null };
        }

        return res.json({
          status: 'success',
          salon: {
            nazwa:           s.nazwa_salonu,
            email:           s.email,
            telefon:         s.telefon || '',
            ulica:           s.ulica   || '',
            miasto:          s.miasto  || '',
            status:          s.status,
            aktywna,
            data_waznosci:   s.data_waznosci   || null,
            data_grace_until: s.data_grace_until || null,
            data_utworzenia: s.data_utworzenia || null,
            abonament,
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
      `SELECT l.email, l.nazwa_salonu, l.nazwa_firmy,
              (SELECT z.nazwa_salonu FROM Tokeny_rejestracji t
               JOIN Zamowienia z ON z.token_wyslany = t.token
               WHERE t.tenant_id_utworzony = l.id_bazy LIMIT 1) AS nazwa_z_zakupu,
              (SELECT z.nazwa_firmy FROM Tokeny_rejestracji t
               JOIN Zamowienia z ON z.token_wyslany = t.token
               WHERE t.tenant_id_utworzony = l.id_bazy LIMIT 1) AS firma_z_zakupu
       FROM Licencje l WHERE l.id_bazy = ? LIMIT 1`,
      [req.billing_tenant_id],
      async (err, rows) => {
        if (err || !rows || !rows.length) return res.json({ status: 'error', message: 'Salon nie znaleziony.' });
        const { email, nazwa_salonu, nazwa_firmy, nazwa_z_zakupu, firma_z_zakupu } = rows[0];

        // Fail-secure: bez nazwa_salonu nie da się odróżnić faktur naszego salonu
        // od faktur innych salonów z tym samym emailem. Zwracamy pustą listę zamiast
        // ryzykować leak cross-tenant.
        if (!nazwa_salonu || !String(nazwa_salonu).trim()) {
          console.warn(`[billing/invoices] tenant ${req.billing_tenant_id} ma pusty nazwa_salonu w Licencje — pomijam fetch faktur dla bezpieczeństwa`);
          return res.json({ status: 'success', faktury: [] });
        }

        try {
          // Filtr po nazwach salonu/firmy — chroni przed leakiem cross-tenant gdy dwa
          // salony mają ten sam email. Cztery warianty, bo buyer_name na fakturze to:
          // nazwa firmy (GUS, gdy podano NIP) albo nazwa salonu — z zakupu lub z Licencje.
          const faktury = await pobierzFaktury(email, [nazwa_salonu, nazwa_z_zakupu, nazwa_firmy, firma_z_zakupu]);
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
