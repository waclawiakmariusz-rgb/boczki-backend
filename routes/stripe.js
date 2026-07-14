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

let wyslijLinkRejestracji, powiadomAdmina, wyslijOstrzezenieOPlatnosci, powiadomAdminaOFailedPayment, powiadomAdminaOZakupie;
try {
  const mailer = require('./mailer');
  wyslijLinkRejestracji = mailer.wyslijLinkRejestracji;
  powiadomAdmina = mailer.powiadomAdmina;
  wyslijOstrzezenieOPlatnosci = mailer.wyslijOstrzezenieOPlatnosci;
  powiadomAdminaOFailedPayment = mailer.powiadomAdminaOFailedPayment;
  powiadomAdminaOZakupie = mailer.powiadomAdminaOZakupie;
} catch (e) {
  wyslijLinkRejestracji = async () => { throw new Error('Mailer nie skonfigurowany.'); };
  powiadomAdmina = async () => {};
  wyslijOstrzezenieOPlatnosci = async () => {};
  powiadomAdminaOFailedPayment = async () => {};
  powiadomAdminaOZakupie = async () => {};
}

let wystawFakture;
try {
  wystawFakture = require('./fakturownia').wystawFakture;
} catch (e) {
  console.warn('[stripe] Fakturownia niedostępna:', e.message);
  wystawFakture = async () => {};
}

const { makePublicLimiter } = require('./sessions');

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
    `ALTER TABLE Zamowienia ADD COLUMN ulica VARCHAR(255) NULL`,
    `ALTER TABLE Zamowienia ADD COLUMN nazwa_firmy VARCHAR(255) NULL`,
    `ALTER TABLE Licencje ADD COLUMN nazwa_firmy VARCHAR(255) NULL`,
    // Stripe IDs zapamiętane przy checkout.session.completed — przenoszone do Licencje
    // w /rejestracja/zaloz, żeby nie zależeć od wyścigu z invoice.paid.
    `ALTER TABLE Zamowienia ADD COLUMN stripe_customer_id VARCHAR(100) NULL`,
    `ALTER TABLE Zamowienia ADD COLUMN stripe_subscription_id VARCHAR(100) NULL`,
  ];

  // Licencje też dostają ulicę — bo przy generowaniu kolejnych faktur Stripe webhook
  // czyta dane z Licencje a nie z Zamowienia
  db.query(
    `ALTER TABLE Licencje ADD COLUMN ulica VARCHAR(255) NULL`,
    (err) => {
      if (err && !/Duplicate column/i.test(err.message)) {
        console.error('[stripe] ALTER Licencje ulica:', err.message);
      }
    }
  );
  zamowieniaKolumny.forEach(sql => {
    db.query(sql, (err) => {
      if (err && !/Duplicate column/i.test(err.message)) {
        console.error('[stripe] ALTER Zamowienia:', err.message);
      }
    });
  });

  // ─── POST /api/stripe/create-checkout ────────────────────────
  // Tworzy sesję płatności Stripe i przekierowuje klienta
  const limiterCheckout = makePublicLimiter({ max: 10, message: 'Za dużo prób zakupu z tego adresu.' });
  router.post('/stripe/create-checkout', limiterCheckout, async (req, res) => {
    if (!stripe) return res.json({ status: 'error', message: 'Stripe nie jest skonfigurowany.' });

    const { imie, nazwa_salonu, nazwa_firmy, email, telefon, ulica, miasto, nip, wiadomosc, kod_rabatowy, zgoda_regulamin, zgoda_dpa } = req.body;
    if (!imie || !nazwa_salonu || !email) {
      return res.json({ status: 'error', message: 'Uzupełnij imię, nazwę salonu i email.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) {
      return res.json({ status: 'error', message: 'Podaj poprawny adres email — trafi na niego link rejestracyjny i faktura.' });
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
      `INSERT INTO Zamowienia (id, imie, nazwa_salonu, nazwa_firmy, email, telefon, ulica, miasto, wiadomosc, status, zgoda_regulamin, zgoda_dpa, wersja_regulaminu, wersja_polityki, wersja_dpa, ip_akceptacji, user_agent_akceptacji, data_akceptacji) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'nowe', 1, 1, ?, ?, ?, ?, ?, NOW())`,
      [zamowienieId, imie.trim(), nazwa_salonu.trim(), (nazwa_firmy || '').trim() || null, email.trim(), telefon || null, ulica || null, miasto || null, wiadomosc || null, REGULAMIN_VERSION, POLITYKA_VERSION, DPA_VERSION, ipAkceptacji, userAgentAkceptacji],
      async (err) => {
        if (err) return res.json({ status: 'error', message: 'Błąd zapisu: ' + err.message });

        // Licznik użyć vouchera inkrementowany dopiero w webhooku po OPŁACENIU
        // (checkout.session.completed) — porzucony koszyk nie zużywa puli.

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
            firma:   (nazwa_firmy || '').trim(),
            email,
            telefon: telefon || '',
            ulica:   ulica   || '',
            miasto:  miasto  || '',
            nip:     nip     || '',
            voucher: voucherInfo ? (voucherInfo.kod || '') : '',
          };

          // Voucher → dynamiczny Stripe Coupon dolaczany do sesji.
          // Bez tego Stripe pobiera pelne 79 zl mimo waznego vouchera w naszej bazie.
          let discounts;
          if (voucherInfo) {
            const couponOpts = {
              name: `Voucher ${voucherInfo.kod}`.slice(0, 40),
              metadata: { voucher_id: String(voucherInfo.id), voucher_kod: voucherInfo.kod || '' },
            };
            if (voucherInfo.typ === 'procent') {
              couponOpts.percent_off = parseFloat(voucherInfo.wartosc);
            } else {
              couponOpts.amount_off = Math.round(parseFloat(voucherInfo.wartosc) * 100);
              couponOpts.currency = 'pln';
            }
            if (voucherInfo.czas_trwania === 'zawsze') {
              couponOpts.duration = 'forever';
            } else if (voucherInfo.czas_trwania === 'miesiecy' && voucherInfo.czas_trwania_miesiecy) {
              couponOpts.duration = 'repeating';
              couponOpts.duration_in_months = voucherInfo.czas_trwania_miesiecy;
            } else {
              couponOpts.duration = 'once';
            }
            try {
              const stripeCoupon = await stripe.coupons.create(couponOpts);
              discounts = [{ coupon: stripeCoupon.id }];
              console.log(`[stripe] Coupon ${stripeCoupon.id} (${voucherInfo.kod}) utworzony — ${couponOpts.percent_off || couponOpts.amount_off/100} ${couponOpts.percent_off ? '%' : 'zl'} / ${couponOpts.duration}`);
            } catch (couponErr) {
              console.error('[stripe] Blad tworzenia coupon dla vouchera', voucherInfo.kod, ':', couponErr.message);
              // Nie blokujemy zakupu — Stripe pobierze pelna cene, ale plan rabatu w bazie zostal naliczony.
              // Lepiej tu zwrocic blad zeby user wiedzial?
              return res.json({ status: 'error', message: 'Voucher nie mogl byc zastosowany w Stripe. Sprobuj ponownie lub kup bez vouchera.' });
            }
          }

          const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            customer_email: email,
            // metadata na session i subscription — potrzebne w webhookach
            metadata: sessionMeta,
            subscription_data: { metadata: sessionMeta },
            ...(discounts ? { discounts } : {}),
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

      // Voucher zużyty dopiero po realnej płatności (nie przy tworzeniu koszyka)
      const voucherKodUzyty = (session.metadata && session.metadata.voucher || '').trim();
      if (voucherKodUzyty) {
        db.query(
          `UPDATE Kody_rabatowe SET ilosc_uzyc = ilosc_uzyc + 1 WHERE kod = ? LIMIT 1`,
          [voucherKodUzyty],
          (e) => { if (e) console.error('[stripe webhook] inkrementacja vouchera:', e.message); }
        );
      }

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

          // Zaktualizuj status zamówienia + zapamiętaj Stripe IDs z sesji.
          // session.customer/subscription istnieją już tutaj (mode: subscription),
          // a Licencja powstaje dopiero przy rejestracji z linku — stąd przenosimy
          // je przez Zamowienia, zamiast polegać na wyścigu z invoice.paid.
          const stripeCustomerId = session.customer || null;
          const stripeSubscriptionId = session.subscription || null;
          db.query(
            `UPDATE Zamowienia SET status='wyslano_link', token_wyslany=?, stripe_customer_id=?, stripe_subscription_id=? WHERE id=?`,
            [token, stripeCustomerId, stripeSubscriptionId, zamowienie_id]
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
            const { ulica, miasto, telefon, nip, firma } = session.metadata || {};
            // Nabywca: nazwa firmy (z GUS/formularza) jeśli podana, inaczej nazwa salonu
            // amount_total = kwota faktycznie pobrana (po voucherze/coupon Stripe)
            await wystawFakture({ nazwa_salonu: (firma || '').trim() || nazwa_salonu, email, ulica, miasto, telefon, nip, kwota_grosze: session.amount_total });
          } catch (fakErr) {
            console.error('[stripe webhook] Błąd wystawiania faktury:', fakErr.message);
            // Faktura nie krytyczna — token już wysłany, fakturę można wystawić ręcznie
          }

          // Powiadom admina o nowym zakupie (fire-and-forget)
          const { telefon: telAdm, miasto: miastoAdm, voucher } = session.metadata || {};
          powiadomAdminaOZakupie({ imie, nazwa_salonu, email, telefon: telAdm, miasto: miastoAdm, kwota_grosze: session.amount_total, voucher })
            .then(() => console.log('[stripe webhook] Powiadomienie admina o zakupie wysłane'))
            .catch(err => console.error('[stripe webhook] Powiadomienie admina o zakupie error:', err.message));
        }
      );
    }

    // ─── invoice.paid — przedłuż licencję o miesiąc + wyzeruj grace + zapisz customer_id/sub_id + faktura ──
    // ODPORNE na wersję API Stripe: nowsze API nie kładą już `subscription`/`customer_email`
    // na obiekcie faktury (przeniesione do parent/lines/customer). Dlatego czytamy je z fallbackami,
    // a wystawienia faktury NIE blokujemy już brakiem subscriptionId (był to powód braku faktur
    // przy odnowieniach — kasa pobrana, faktura po cichu pomijana).
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      (async () => {
        try {
          const customerId = invoice.customer || null;      // cus_xxxxxxxxx
          // Email: z faktury albo z obiektu klienta (nowsze API nie kładą go na invoice).
          let customerEmail = invoice.customer_email || null;
          if (!customerEmail && customerId) {
            try { const cust = await stripe.customers.retrieve(customerId); customerEmail = (cust && cust.email) || null; }
            catch (e) { console.warn('[stripe webhook] customers.retrieve fail:', e.message); }
          }
          if (!customerEmail) { console.warn('[stripe webhook] invoice.paid bez emaila klienta — pomijam'); return; }

          // Subscription id: Stripe przeniósł pole z invoice.subscription do parent/lines.
          const line0 = invoice.lines && invoice.lines.data && invoice.lines.data[0];
          const subscriptionId = invoice.subscription
            || (invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription)
            || (line0 && line0.subscription)
            || (line0 && line0.parent && line0.parent.subscription_item_details && line0.parent.subscription_item_details.subscription)
            || null;

          // Przedłuż licencję o miesiąc (nie wymaga subscriptionId).
          await new Promise((resolve) => {
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
                resolve();
              }
            );
          });

          // Faktura dla ODNOWIEŃ. Pierwsza faktura (subscription_create) wychodzi osobno
          // w checkout.session.completed — tu ją pomijamy, żeby nie zdublować.
          const billingReason = invoice.billing_reason || '';
          if (!billingReason || billingReason === 'subscription_create') return;

          const salonDane = await new Promise((resolve) => {
            db.query(
              `SELECT nazwa_salonu, nazwa_firmy, ulica, miasto, telefon FROM Licencje WHERE email = ? LIMIT 1`,
              [customerEmail],
              (e, rows) => resolve((rows && rows[0]) || null)
            );
          });
          if (!salonDane || !salonDane.nazwa_salonu) {
            console.warn(`[stripe webhook] invoice.paid recurring: brak salonu w Licencje dla ${customerEmail} — pomijam fakturę`);
            return;
          }
          // NIP i firma zaszyte w metadanych subskrypcji z pierwszego checkoutu (jeśli mamy sub id).
          let nip = '', firmaMeta = '';
          if (subscriptionId) {
            try {
              const sub = await stripe.subscriptions.retrieve(subscriptionId);
              nip = (sub && sub.metadata && sub.metadata.nip) || '';
              firmaMeta = (sub && sub.metadata && sub.metadata.firma) || '';
            } catch (e) {
              console.warn('[stripe webhook] subscriptions.retrieve fail (NIP pominięty):', e.message);
            }
          }
          await wystawFakture({
            nazwa_salonu: firmaMeta || salonDane.nazwa_firmy || salonDane.nazwa_salonu,
            email:        customerEmail,
            ulica:        salonDane.ulica   || '',
            miasto:       salonDane.miasto  || '',
            telefon:      salonDane.telefon || '',
            nip:          nip,
            kwota_grosze: invoice.amount_paid, // realna kwota z faktury Stripe (po voucherze)
          });
          console.log(`[stripe webhook] Faktura recurring (${billingReason}) wystawiona dla ${customerEmail}`);
        } catch (e) {
          console.error('[stripe webhook] Błąd obsługi invoice.paid:', e.message);
        }
      })();
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
