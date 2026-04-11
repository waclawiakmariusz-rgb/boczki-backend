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

let wyslijLinkRejestracji, powiadomAdmina;
try {
  const mailer = require('./mailer');
  wyslijLinkRejestracji = mailer.wyslijLinkRejestracji;
  powiadomAdmina = mailer.powiadomAdmina;
} catch (e) {
  wyslijLinkRejestracji = async () => { throw new Error('Mailer nie skonfigurowany.'); };
  powiadomAdmina = async () => {};
}

const APP_URL = () => process.env.APP_URL || 'https://yellow-ibex-409594.hostingersite.com';
const CENA_GROSZE = () => parseInt(process.env.STRIPE_CENA_GROSZE) || 4900; // 49 zł domyślnie
const NAZWA_PRODUKTU = () => process.env.STRIPE_NAZWA || 'Dostęp do systemu Boczki na bok';

module.exports = (db) => {

  // ─── POST /api/stripe/create-checkout ────────────────────────
  // Tworzy sesję płatności Stripe i przekierowuje klienta
  router.post('/stripe/create-checkout', async (req, res) => {
    if (!stripe) return res.json({ status: 'error', message: 'Stripe nie jest skonfigurowany.' });

    const { imie, nazwa_salonu, email, telefon, miasto, wiadomosc, kod_rabatowy } = req.body;
    if (!imie || !nazwa_salonu || !email) {
      return res.json({ status: 'error', message: 'Uzupełnij imię, nazwę salonu i email.' });
    }

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
      `INSERT INTO Zamowienia (id, imie, nazwa_salonu, email, telefon, miasto, wiadomosc, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'nowe')`,
      [zamowienieId, imie.trim(), nazwa_salonu.trim(), email.trim(), telefon || null, miasto || null, wiadomosc || null],
      async (err) => {
        if (err) return res.json({ status: 'error', message: 'Błąd zapisu: ' + err.message });

        // Jeśli voucher był użyty — inkrementuj licznik (nie czekamy na wynik)
        if (voucherInfo) {
          db.query(`UPDATE Kody_rabatowe SET ilosc_uzyc = ilosc_uzyc + 1 WHERE id=? LIMIT 1`, [voucherInfo.id]);
        }

        const czasOpis = voucherInfo
          ? (voucherInfo.czas_trwania === 'zawsze' ? 'na zawsze' : `przez ${voucherInfo.czas_trwania_miesiecy} mies.`)
          : '';

        try {
          const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card', 'blik', 'p24'],
            line_items: [{
              price_data: {
                currency: 'pln',
                product_data: {
                  name: NAZWA_PRODUKTU(),
                  description: voucherInfo
                    ? `Salon: ${nazwa_salonu} | Kod: ${voucherInfo.kod} (${voucherInfo.typ === 'procent' ? `-${voucherInfo.wartosc}%` : `-${voucherInfo.wartosc} zł`} ${czasOpis})`
                    : `Salon: ${nazwa_salonu}`,
                  images: [],
                },
                unit_amount: cenaFinalna,
              },
              quantity: 1,
            }],
            mode: 'payment',
            customer_email: email,
            metadata: {
              zamowienie_id: zamowienieId,
              imie,
              nazwa_salonu,
              email,
              kod_rabatowy: voucherInfo ? voucherInfo.kod : '',
              czas_trwania_rabatu: voucherInfo ? voucherInfo.czas_trwania : '',
              czas_trwania_miesiecy: voucherInfo ? String(voucherInfo.czas_trwania_miesiecy || '') : '',
            },
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

          // Wyślij email z linkiem
          try {
            await wyslijLinkRejestracji({ email, imie, token, nazwa_salonu });
            console.log(`[stripe webhook] Link wysłany do: ${email}`);
          } catch (mailErr) {
            console.error('[stripe webhook] Błąd wysyłki maila:', mailErr.message);
            // Mimo błędu maila — token jest w bazie, admin może wysłać ręcznie
          }
        }
      );
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
