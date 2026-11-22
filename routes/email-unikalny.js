// routes/email-unikalny.js
// Jeden adres e-mail = jedna licencja salonu (2026-11-17, plan: docs/PLAN_UNIKALNY_EMAIL_2026-11-16.md, paczka B).
//
// Dlaczego: webhooki Stripe (invoice.paid, payment_failed, subscription.deleted), reset hasła i panel
// rozliczeniowy szukają salonu po adresie e-mail z LIMIT 1. Dwa salony na jednym adresie = odnowienie,
// blokada albo reset trafiają w pierwszy z brzegu salon (5.11.2026: opłata Papillon przedłużyła Boczki).
// Ten moduł jest jedynym miejscem z normalizacją, komunikatem i zapytaniem o zajętość — używają go
// zakup (stripe.js), stary formularz zamówienia, zakładanie salonu z tokenu, panel admina i check-email.
'use strict';

const KOMUNIKAT_ZAJETY = 'Na ten adres e-mail jest już zarejestrowany salon w Estelio. Zaloguj się na istniejące konto albo użyj innego adresu. Jeśli to pomyłka, napisz: kontakt@estelio.com.pl';
const FORMAT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** trim + małe litery; pusty tekst → null (w bazie brak adresu = NULL, nigdy ''). */
function normalizujEmail(wartosc) {
  const s = String(wartosc == null ? '' : wartosc).trim().toLowerCase();
  return s ? s : null;
}

function poprawnyFormatEmail(wartosc) {
  const e = normalizujEmail(wartosc);
  return !!e && e.length <= 255 && FORMAT_EMAIL.test(e);
}

/**
 * Czy adres należy już do innej licencji. `db` = pula (db.query) albo połączenie w transakcji (conn.query).
 * `pomijanyIdBazy` — przy edycji salonu jego własny adres nie jest kolizją.
 * Błąd bazy przechodzi dalej (reject): wywołujący ma odmówić zapisu, a nie przepuścić go bez kontroli.
 */
function emailZajety(db, email, pomijanyIdBazy = null) {
  return new Promise((resolve, reject) => {
    const e = normalizujEmail(email);
    if (!e) return resolve(false);
    const sql = pomijanyIdBazy
      ? `SELECT id_bazy FROM Licencje WHERE LOWER(TRIM(email)) = ? AND id_bazy <> ? LIMIT 1`
      : `SELECT id_bazy FROM Licencje WHERE LOWER(TRIM(email)) = ? LIMIT 1`;
    const params = pomijanyIdBazy ? [e, String(pomijanyIdBazy)] : [e];
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(Array.isArray(rows) && rows.length > 0)));
  });
}

/** ER_DUP_ENTRY z indeksu uq_licencje_email (paczka C) — odróżniany od zajętego loginu (PRIMARY) i id_bazy. */
const czyDuplikatEmail = (err) => !!err && err.code === 'ER_DUP_ENTRY' && /uq_licencje_email/i.test(String(err.message || ''));

module.exports = { KOMUNIKAT_ZAJETY, FORMAT_EMAIL, normalizujEmail, poprawnyFormatEmail, emailZajety, czyDuplikatEmail };
