// routes/onboarding-checkout.js
// Obsługa Stripe `checkout.session.completed` (zakup Estelio) — wydzielona z routes/stripe.js
// 2026-10-09, żeby dało się ją przetestować bez SDK Stripe i podpisu webhooka.
//
// ZASADY (audyt ścieżki sprzedażowej 2026-10-09):
//  • idempotencja: zamówienie przechodzi 'nowe' → 'oplacone' ATOMOWO (UPDATE ... WHERE status='nowe');
//    powtórne doręczenie zdarzenia = 0 wierszy = nic nie robimy (bez 2. tokenu, maila, faktury);
//  • status 'wyslano_link' DOPIERO po udanej wysyłce; gdy SMTP padnie → 'blad_maila' (panel admina
//    pokazuje to czerwono i ma „Wyślij ponownie" na TEN SAM token);
//  • link ważny tyle, żeby przeżył okres próbny (trial + 7 dni, minimum 30 dni) — wcześniej 7 dni
//    przy 14-dniowym trialu, czyli klient rejestrujący się w 2. tygodniu trafiał na „link wygasł";
//  • faktura tylko gdy amount_total > 0 (trial = 0 zł → bez faktury 0 zł do Fakturowni/KSeF).
const { randomUUID } = require('crypto');

const DZIEN_MS = 24 * 60 * 60 * 1000;

function dniWaznosciTokenu(trialDni) {
  const t = parseInt(trialDni, 10);
  return Math.max(30, (Number.isFinite(t) ? t : 0) + 7);
}

function q(db, sql, params) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, r) => (err ? reject(err) : resolve(r))));
}

async function obsluzCheckoutCompleted({ db, session, trialDni, cenaGrosze, mailer, wystawFakture, powiadomAdminaOZakupie, log = console }) {
  const meta = (session && session.metadata) || {};
  const { zamowienie_id, imie, nazwa_salonu, email } = meta;
  // Kwota faktycznie pobrana dziś (0 przy trialu / kodzie 100%) — używana w mailu z linkiem i przy fakturze
  const kwota = parseInt(session.amount_total, 10) || 0;
  const stripeCustomerId = session.customer || null;
  const stripeSubscriptionId = session.subscription || null;

  // 1. Atomowe przejęcie zamówienia — druga linia obrony przed powtórką (pierwsza: rejestr event.id)
  if (zamowienie_id) {
    const r = await q(db,
      `UPDATE Zamowienia SET status='oplacone', stripe_customer_id=?, stripe_subscription_id=? WHERE id=? AND status='nowe'`,
      [stripeCustomerId, stripeSubscriptionId, zamowienie_id]);
    if (!r || !r.affectedRows) {
      log.warn(`[onboarding] checkout.session.completed powtórzone albo zamówienie ${zamowienie_id} już obsłużone — pomijam`);
      return { wynik: 'duplikat' };
    }
  } else {
    log.warn('[onboarding] checkout bez zamowienie_id w metadata — kontynuuję bez blokady duplikatu');
  }

  // 2. Voucher zużyty dopiero po realnej płatności (porzucony koszyk nie zużywa puli)
  const voucher = String(meta.voucher || '').trim();
  if (voucher) {
    await q(db, `UPDATE Kody_rabatowe SET ilosc_uzyc = ilosc_uzyc + 1 WHERE kod = ? LIMIT 1`, [voucher])
      .catch(e => log.error('[onboarding] inkrementacja vouchera:', e.message));
  }

  // 3. Token rejestracyjny
  const token = randomUUID();
  const dni = dniWaznosciTokenu(trialDni);
  const wygasa = new Date(Date.now() + dni * DZIEN_MS);
  await q(db,
    `INSERT INTO Tokeny_rejestracji (token, status, data_wygasniecia, notatka) VALUES (?, 'nowy', ?, ?)`,
    [token, wygasa, `Auto: ${imie || ''} / ${nazwa_salonu || ''}`]);
  if (zamowienie_id) {
    await q(db, `UPDATE Zamowienia SET token_wyslany=? WHERE id=?`, [token, zamowienie_id])
      .catch(e => log.error('[onboarding] zapis token_wyslany:', e.message));
  }

  // 4. Mail z linkiem — status zamówienia DOPIERO po wyniku wysyłki
  let mailOk = false;
  try {
    await mailer.wyslijLinkRejestracji({
      email, imie, token, nazwa_salonu, dniWaznosci: dni,
      // Warunki zakupu w mailu (jedyne potwierdzenie przy trialu — faktury za 0 zł nie ma)
      warunki: { kwota_grosze: kwota, cena_grosze: cenaGrosze, trial_dni: trialDni, voucher },
    });
    mailOk = true;
    log.log(`[onboarding] Link rejestracyjny wysłany do: ${email} (ważny ${dni} dni)`);
  } catch (mailErr) {
    log.error('[onboarding] Błąd wysyłki maila z linkiem (token w bazie, admin wyśle ponownie):', mailErr.message);
  }
  if (zamowienie_id) {
    await q(db, `UPDATE Zamowienia SET status=? WHERE id=?`, [mailOk ? 'wyslano_link' : 'blad_maila', zamowienie_id])
      .catch(e => log.error('[onboarding] status zamówienia po mailu:', e.message));
  }

  // 5. Faktura — tylko gdy faktycznie pobrano pieniądze
  let faktura = 'pominieta';
  if (kwota > 0) {
    try {
      const { ulica, miasto, telefon, nip, firma } = meta;
      await wystawFakture({ nazwa_salonu: (firma || '').trim() || nazwa_salonu, email, ulica, miasto, telefon, nip, kwota_grosze: kwota });
      faktura = 'wystawiona';
    } catch (fakErr) {
      faktura = 'blad';
      log.error('[onboarding] Błąd wystawiania faktury (nie blokuje tokenu/maila):', fakErr.message);
    }
  } else {
    log.log('[onboarding] amount_total = 0 (okres próbny / voucher 100%) — faktura pominięta');
  }

  // 6. Powiadomienie admina — fire-and-forget (mail_ok pozwala mu zobaczyć, że klient NIE dostał linku)
  Promise.resolve()
    .then(() => powiadomAdminaOZakupie({ imie, nazwa_salonu, email, telefon: meta.telefon, miasto: meta.miasto, kwota_grosze: kwota, voucher, mail_ok: mailOk }))
    .catch(err => log.error('[onboarding] Powiadomienie admina o zakupie:', err.message));

  return { wynik: 'ok', token, dni, mailOk, faktura };
}

module.exports = { obsluzCheckoutCompleted, dniWaznosciTokenu };
