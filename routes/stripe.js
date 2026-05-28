// routes/stripe.js
// Integracja Stripe — płatności za dostęp do systemu

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');

let stripe;
try {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} catch (e) {
  console.warn('[stripe] Stripe SDK niedostępny:', e.message);
}

let wyslijLinkRejestracji, powiadomAdmina, wyslijOstrzezenieOPlatnosci, powiadomAdminaOFailedPayment;
try {
  const mailer = require('./mailer');
  wyslijLinkRejestracji = mailer.wyslijLinkRejestracji;
  powiadomAdmina = mailer.powiadomAdmina;
  wyslijOstrzezenieOPlatnosci = mailer.wyslijOstrzezenieOPlatnosci;
  powiadomAdminaOFailedPayment = mailer.powiadomAdminaOFailedPayment;
} catch (e) {
  wyslijLinkRejestracji = async () => { throw new Error('Mailer nie skonfigurowany.'); };
  powiadomAdmina = async () => {};
  wyslijOstrzezenieOPlatnosci = async () => {};
  powiadomAdminaOFailedPayment = async () => {};
}

let wystawFakture;
try {
  wystawFakture = require('./fakturownia').wystawFakture;
} catch (e) {
  console.warn('[stripe] Fakturownia niedostępna:', e.message);
  wystawFakture = async () => {};
}

function stripQuotes(val) { return (val || '').replace(/^['"]|['"]$/g, ''); }
const APP_URL        = () => stripQuotes(process.env.APP_URL || 'https://estelio.com.pl').replace(/\/$/, '');
const CENA_GROSZE    = () => parseInt(process.env.STRIPE_CENA_GROSZE) || 7900;
const NAZWA_PRODUKTU = () => process.env.STRIPE_NAZWA || 'Dostęp do systemu Estelio';
const PRICE_ID       = () => stripQuotes(process.env.STRIPE_PRICE_ID || '');

// Wersje dokumentów prawnych — inkrementować przy każdej zmianie treści
// Wersja jest zapisywana w bazie przy każdym zamówieniu jako dowód co klient zaakceptował
const REGULAMIN_VERSION = '1.0-2026-05-28';
const POLITYKA_VERSION  = '1.0-2026-05-28';
const DPA_VERSION       = '1.0-2026-05-28';

module.exports = (db) => {

  // Idempotentne migracje:
  // • data_grace_until — koniec okresu łaski po nieudanej płatności
  // • stripe_customer_id — id klienta Stripe (cus_xxx), potrzebne dla Customer Portal
  db.query(
    `ALTER TABLE Licencje ADD COLUMN data_grace_until DATETIME NULL`,
    (err) => {
      if (err && !/Duplicate column/i.test(err.message)) {
        console.error('[stripe] ALTER Licencje data_grace_until:', err.message);
      }
    }
  );
  db.query(
    `ALTER TABLE Licencje ADD COLUMN stripe_customer_id VARCHAR(100) NULL`,
    (err) => {
      if (err && !/Duplicate column/i.test(err.message)) {
        console.error('[stripe] ALTER Licencje stripe_customer_id:', err.message);
      }
    }
  );
  // • stripe_subscription_id — id subskrypcji (sub_xxx), potrzebne by aktywować/usuwać Items (dodatki)
  db.query(
    `ALTER TABLE Licencje ADD COLUMN stripe_subscription_id VARCHAR(100) NULL`,
    (err) => {
      if (err && !/Duplicate column/i.test(err.message)) {
        console.error('[stripe] ALTER Licencje stripe_subscription_id:', err.message);
      }
    }
  );

  // Idempotentne migracje na Zamowienia — zgody RODO przy zakupie subskrypcji
  // Bez tych pól nie da się prawnie udowodnić, że klient zaakceptował regulamin i DPA
  const zamowieniaKolumny = [
    `ALTER TABLE Zamowienia ADD COLUMN zgoda_regulamin TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE Zamowienia ADD COLUMN zgoda_dpa TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE Zamowienia ADD COLUMN wersja_regulaminu VARCHAR(20) NULL`,
    `ALTER TABLE Zamowienia ADD COLUMN wersja_polityki VARCHAR(20) NULL`,
    `ALTER TABLE Zamowienia ADD COLUMN wersja_dpa VARCHAR(20) NULL`,
    `ALTER TABLE Zamowienia ADD COLUMN ip_akceptacji VARCHAR(45) NULL`,
    `ALTER TABLE Zamowienia ADD COLUMN user_agent_akceptacji VARCHAR(500) NULL`,
    `ALTER TABLE Zamowienia ADD COLUMN data_akceptacji DATETIME NULL`,
  ];
  zamowieniaKolumny.forEach(sql => {
    db.query(sql, (err) => {
      if (err && !/Duplicate column/i.test(err.message)) {
        console.error('[stripe] ALTER Zamowienia:', err.message);
      }
    });
  });

  // ─── POST /api/stripe/create-checkout ────────────────────────
  // Tworzy sesję płatności Stripe i przekierowuje klienta
  router.post('/stripe/create-checkout', async (req, res) => {
    if (!stripe) return res.json({ status: 'error', message: 'Stripe nie jest skonfigurowany.' });

    const { imie, nazwa_salonu, email, telefon, miasto, nip, wiadomosc, kod_rabatowy, zgoda_regulamin, zgoda_dpa } = req.body;
    if (!imie || !nazwa_salonu || !email) {
      return res.json({ status: 'error', message: 'Uzupełnij imię, nazwę salonu i email.' });
    }
    // Wymagane zgody — bez nich nie zawieramy umowy (RODO art. 7 + UŚUDE + RODO art. 28)
    if (zgoda_regulamin !== true || zgoda_dpa !== true) {
      return res.json({ status: 'error', message: 'Wymagana akceptacja Regulaminu, Polityki prywatności i Umowy powierzenia danych.' });
    }
    // Metadane akceptacji — IP + user-agent zapisujemy jako dowód autentyczności (UODO)
    const ipAkceptacji = (req.ip || '').slice(0, 45);
    const userAgentAkceptacji = String(req.headers['user-agent'] || '').slice(0, 500);

    // Walidacja i obliczenie rabatu
    const cenaBazowa = CENA_GROSZE();
    let cenaFinalna = cenaBazowa;
    let voucherInfo = null;

    const voucherKod = (kod_rabatowy || '').trim().toUpperCase();
    if (voucherKod) {
      const rows = await new Promise((resolve) => {
        db.query(
          `SELECT * FROM Kody_rabatowe WHERE kod=? AND aktywny=1 LIMIT 1`,
          [voucherKod],
          (err, r) => resolve(err ? [] : r)
        );
      });

      if (rows.length) {
        const v = rows[0];
        const wygasly = v.data_wygasniecia && new Date(v.data_wygasniecia) < new Date();
        const wyczerpany = v.max_uzyc !== null && v.ilosc_uzyc >= v.max_uzyc;

        if (!wygasly && !wyczerpany) {
          if (v.typ === 'procent') {
            cenaFinalna = Math.round(cenaBazowa * (1 - v.wartosc / 100));
          } else {
            cenaFinalna = Math.max(0, cenaBazowa - Math.round(v.wartosc * 100));
          }
          voucherInfo = v;
        }
      }
    }

    // Zapisz zgłoszenie w bazie (status: nowe — czeka na płatność)
    const zamowienieId = randomUUID();
    db.query(
      `INSERT INTO Zamowienia (id, imie, nazwa_salonu, email, telefon, miasto, wiadomosc, status, zgoda_regulamin, zgoda_dpa, wersja_regulaminu, wersja_polityki, wersja_dpa, ip_akceptacji, user_agent_akceptacji, data_akceptacji) VALUES (?, ?, ?, ?, ?, ?, ?, 'nowe', 1, 1, ?, ?, ?, ?, ?, NOW())`,
      [zamowienieId, imie.trim(), nazwa_salonu.trim(), email.trim(), telefon || null, miasto || null, wiadomosc || null, REGULAMIN_VERSION, POLITYKA_VERSION, DPA_VERSION, ipAkceptacji, userAgentAkceptacji],
      async (err) => {
        if (err) return res.json({ status: 'error', message: 'Błąd zapisu: ' + err.message });

        // Jeśli voucher był użyty — inkrementuj licznik (nie czekamy na wynik)
        if (voucherInfo) {
          db.query(`UPDATE Kody_rabatowe SET ilosc_uzyc = ilosc_uzyc + 1 WHERE id=? LIMIT 1`, [voucherInfo.id]);
        }

        const czasOpis = voucherInfo
          ? (voucherInfo.czas_trwania === 'zawsze' ? 'na zawsze' : `przez ${voucherInfo.czas_trwania_miesiecy} mies.`)
          : '';

        const priceId = PRICE_ID();
        if (!priceId) {
          return res.json({ status: 'error', message: 'Brak konfiguracji cennika (STRIPE_PRICE_ID).' });
        }

        try {
          const sessionMeta = {
            zamowienie_id: zamowienieId,
            imie,
            nazwa_salonu,
            email,
            telefon: telefon || '',
            miasto:  miasto  || '',
            nip:     nip     || '',
          };

          const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            customer_email: email,
            // metadata na session i subscription — potrzebne w webhookach
            metadata: sessionMeta,
            subscription_data: { metadata: sessionMeta },
            success_url: `${APP_URL()}/platnosc-sukces.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url:  `${APP_URL()}/zamow.html?anulowano=1`,
            locale: 'pl',
          });

          return res.json({ status: 'success', checkout_url: session.url });
        } catch (stripeErr) {
          console.error('[stripe] Błąd tworzenia sesji:', stripeErr.message);
          return res.json({ status: 'error', message: 'Błąd Stripe: ' + stripeErr.message });
        }
      }
    );
  });

  // ─── POST /api/stripe/webhook ─────────────────────────────────
  // Stripe wysyła tu potwierdzenie płatności
  // UWAGA: musi dostawać raw body — rejestracja w server.js przed express.json()
  router.post('/stripe/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[stripe webhook] Błąd weryfikacji:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { zamowienie_id, imie, nazwa_salonu, email } = session.metadata;

      // Generuj token rejestracyjny
      const token = randomUUID();
      const wygasa = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dni

      db.query(
        `INSERT INTO Tokeny_rejestracji (token, status, data_wygasniecia, notatka) VALUES (?, 'nowy', ?, ?)`,
        [token, wygasa, `Auto: ${imie} / ${nazwa_salonu}`],
        async (err) => {
          if (err) {
            console.error('[stripe webhook] Błąd zapisu tokenu:', err.message);
            return res.json({ received: true });
          }

          // Zaktualizuj status zamówienia
          db.query(
            `UPDATE Zamowienia SET status='wyslano_link', token_wyslany=? WHERE id=?`,
            [token, zamowienie_id]
          );

          // Wyślij email z linkiem rejestracyjnym
          try {
            await wyslijLinkRejestracji({ email, imie, token, nazwa_salonu });
            console.log(`[stripe webhook] Link wysłany do: ${email}`);
          } catch (mailErr) {
            console.error('[stripe webhook] Błąd wysyłki maila:', mailErr.message);
            // Mimo błędu maila — token jest w bazie, admin może wysłać ręcznie
          }

          // Wystaw fakturę VAT przez Fakturownia.pl (wysyła PDF mailem do klienta)
          try {
            const { miasto, telefon, nip } = session.metadata || {};
            await wystawFakture({ nazwa_salonu, email, miasto, telefon, nip });
          } catch (fakErr) {
            console.error('[stripe webhook] Błąd wystawiania faktury:', fakErr.message);
            // Faktura nie krytyczna — token już wysłany, fakturę można wystawić ręcznie
          }
        }
      );
    }

    // ─── invoice.paid — przedłuż licencję o miesiąc + wyzeruj grace + zapisz customer_id/sub_id ──
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      const customerEmail = invoice.customer_email;
      const customerId = invoice.customer || null;          // cus_xxxxxxxxx
      const subscriptionId = invoice.subscription || null;  // sub_xxxxxxxxx (potrzebne dla dodatków)
      if (customerEmail) {
        db.query(
          `UPDATE Licencje
           SET data_waznosci = DATE_ADD(GREATEST(IFNULL(data_waznosci, NOW()), NOW()), INTERVAL 1 MONTH),
               status = 'aktywny',
               data_grace_until = NULL,
               stripe_customer_id = COALESCE(stripe_customer_id, ?),
               stripe_subscription_id = COALESCE(stripe_subscription_id, ?)
           WHERE email = ? LIMIT 1`,
          [customerId, subscriptionId, customerEmail],
          (err, result) => {
            if (err) console.error('[stripe webhook] Błąd przedłużenia licencji:', err.message);
            else console.log(`[stripe webhook] Licencja przedłużona dla: ${customerEmail} (${result.affectedRows} rekord)`);
          }
        );
      }
    }

    // ─── invoice.payment_failed — zaznacz opóźnienie + 7 dni grace + emaile ──
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const customerEmail = invoice.customer_email;
      const customerId = invoice.customer || null;
      const subscriptionId = invoice.subscription || null;
      const kwota = invoice.amount_due
        ? (invoice.amount_due / 100).toFixed(2) + ' ' + (invoice.currency || 'pln').toUpperCase()
        : null;
      if (customerEmail) {
        db.query(
          `UPDATE Licencje
           SET status = 'opóźniony',
               data_grace_until = DATE_ADD(NOW(), INTERVAL 7 DAY),
               stripe_customer_id = COALESCE(stripe_customer_id, ?),
               stripe_subscription_id = COALESCE(stripe_subscription_id, ?)
           WHERE email = ? LIMIT 1`,
          [customerId, subscriptionId, customerEmail],
          (err, result) => {
            if (err) {
              console.error('[stripe webhook] Błąd ustawienia opóźnienia:', err.message);
              return;
            }
            console.log(`[stripe webhook] Status 'opóźniony' + 7 dni grace dla: ${customerEmail} (${result.affectedRows} rekord)`);
            // Pobierz nazwę salonu i wyślij email do klienta + admina
            db.query(
              `SELECT nazwa_salonu, data_grace_until FROM Licencje WHERE email = ? LIMIT 1`,
              [customerEmail],
              (e, rows) => {
                const nazwa_salonu = (rows && rows[0] && rows[0].nazwa_salonu) || '';
                const data_grace_until = (rows && rows[0] && rows[0].data_grace_until) || null;
                wyslijOstrzezenieOPlatnosci({ email: customerEmail, nazwa_salonu, data_grace_until })
                  .catch(err => console.error('[stripe webhook] Email do klienta error:', err.message));
                powiadomAdminaOFailedPayment({ email: customerEmail, nazwa_salonu, kwota })
                  .catch(err => console.error('[stripe webhook] Email do admina error:', err.message));
              }
            );
          }
        );
      }
    }

    // ─── customer.subscription.deleted — dezaktywuj salon ────────
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const email = subscription.metadata?.email;
      if (email) {
        db.query(
          `UPDATE Licencje SET status = 'nieaktywny' WHERE email = ? LIMIT 1`,
          [email],
          (err) => {
            if (err) console.error('[stripe webhook] Błąd dezaktywacji salonu:', err.message);
            else console.log(`[stripe webhook] Salon dezaktywowany: ${email}`);
          }
        );
      }
    }

    res.json({ received: true });
  });

  // ─── GET /api/stripe/config ───────────────────────────────────
  // Zwraca publiczne dane (cena, nazwa) dla frontendu
  router.get('/stripe/config', (req, res) => {
    res.json({
      cena_grosze: CENA_GROSZE(),
      cena_display: (CENA_GROSZE() / 100).toFixed(0) + ' zł',
      nazwa: NAZWA_PRODUKTU(),
      aktywny: !!process.env.STRIPE_SECRET_KEY,
    });
  });

  return router;
};
