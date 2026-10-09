// routes/rejestracja-zaloz.js
// Atomowe założenie salonu z kreatora rejestracji (2026-10-09, etap 1 audytu ścieżki sprzedażowej).
//
// Wcześniej (routes/admin.js): token blokowany osobnym UPDATE, potem INSERT Licencje, a wstawki
// Użytkownicy/Pracownicy/Uslugi miały tylko console.error + resolve() i odpowiedź ZAWSZE „sukces".
// Skutek przy padniętym INSERT Użytkownicy: token zużyty, licencja jest, na ekranie PIN nie ma
// nikogo — „pół-salon", do którego klient nie wejdzie i nie ponowi rejestracji.
//
// Teraz: JEDNA transakcja na jednym połączeniu z puli. Token, licencja, użytkownicy, pracownicy
// i usługi albo wchodzą wszystkie, albo żadne (token wraca do 'nowy' automatycznie przez rollback).
// tenant_id = slug + losowy sufiks 8 hex (było: ostatnie 4 cyfry ms — powtarzalne co 10 s) i UNIQUE
// na Licencje.id_bazy (ALTER w admin.js); przy nieprawdopodobnej kolizji jedna ponowna próba.
const { randomUUID } = require('crypto');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l').replace(/ą/g, 'a').replace(/ę/g, 'e')
    .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z')
    .replace(/ż/g, 'z').replace(/ć/g, 'c').replace(/ń/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nowyTenantId(nazwaSalonu) {
  const slug = slugify(nazwaSalonu).slice(0, 48) || 'salon';
  return `${slug}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

const polacz = (db) => new Promise((resolve, reject) => db.getConnection((err, conn) => (err ? reject(err) : resolve(conn))));
const qc = (conn, sql, params) => new Promise((resolve, reject) => conn.query(sql, params, (err, r) => (err ? reject(err) : resolve(r))));
const begin = (conn) => new Promise((resolve, reject) => conn.beginTransaction((err) => (err ? reject(err) : resolve())));
const commit = (conn) => new Promise((resolve, reject) => conn.commit((err) => (err ? reject(err) : resolve())));
const rollback = (conn) => new Promise((resolve) => conn.rollback(() => resolve()));

const czyDuplikatIdBazy = (err) => err && err.code === 'ER_DUP_ENTRY' && /id_bazy/i.test(String(err.message || ''));

/**
 * @param {object} p
 * @param {object} p.db            pula mysql2 (getConnection)
 * @param {object} p.dane          { token, nazwa_salonu, ulica, miasto, telefon, loginNorm, hasloHash,
 *                                   nazwaFirmy, emailLicencji, stripeCustomerId, stripeSubscriptionId,
 *                                   pracownicy: [{imie, pin, rola}], uslugi: [{kategoria, wariant, cena, zrodlo}] }
 * @returns {Promise<{wynik:'ok',tenant_id}|{wynik:'token'|'login_zajety'|'blad',message?}>}
 */
async function zalozSalon({ db, dane, log = console }) {
  const d = dane;
  let conn;
  try {
    conn = await polacz(db);
  } catch (e) {
    log.error('[rejestracja/zaloz] brak połączenia z bazą:', e.message);
    return { wynik: 'blad', message: 'Chwilowy problem z bazą danych. Spróbuj ponownie za chwilę — Twój link pozostaje ważny.' };
  }

  try {
    await begin(conn);

    // 1. Token — blokada w transakcji (rollback = token wraca do 'nowy' sam z siebie)
    const tok = await qc(conn,
      `UPDATE Tokeny_rejestracji SET status='wykorzystany', data_wykorzystania=NOW()
       WHERE token = ? AND status = 'nowy' AND data_wygasniecia > NOW()`, [d.token]);
    if (!tok || !tok.affectedRows) {
      await rollback(conn);
      return { wynik: 'token' };
    }

    // 2. Licencja — id_bazy losowe; przy kolizji (UNIQUE) jedna ponowna próba
    let tenant_id = null;
    for (let proba = 0; proba < 2; proba++) {
      const kandydat = nowyTenantId(d.nazwa_salonu);
      try {
        await qc(conn,
          `INSERT INTO Licencje (id, login, haslo, rola, id_bazy, status, nazwa_salonu, nazwa_firmy, ulica, miasto, telefon, email, stripe_customer_id, stripe_subscription_id, data_waznosci, data_utworzenia)
           VALUES (?, ?, ?, 'salon', ?, 'aktywny', ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 MONTH), NOW())`,
          [randomUUID(), d.loginNorm, d.hasloHash, kandydat, d.nazwa_salonu, d.nazwaFirmy, d.ulica || '', d.miasto || '', d.telefon || '', d.emailLicencji, d.stripeCustomerId, d.stripeSubscriptionId]);
        tenant_id = kandydat;
        break;
      } catch (err) {
        if (czyDuplikatIdBazy(err) && proba === 0) { log.warn('[rejestracja/zaloz] kolizja id_bazy — ponawiam z nowym sufiksem'); continue; }
        if (err.code === 'ER_DUP_ENTRY') { await rollback(conn); return { wynik: 'login_zajety' }; }
        throw err;
      }
    }
    if (!tenant_id) throw new Error('Nie udało się nadać identyfikatora salonu.');

    await qc(conn, `UPDATE Tokeny_rejestracji SET tenant_id_utworzony=? WHERE token=?`, [tenant_id, d.token]);

    // 3. Użytkownicy (login PIN) + Pracownicy — każdy błąd = rollback całości
    for (const p of d.pracownicy) {
      await qc(conn, `INSERT INTO Użytkownicy (id, tenant_id, imie_login, haslo_pin, rola) VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), tenant_id, p.imie, p.pin, p.rola || 'pracownik']);
      await qc(conn, `INSERT INTO Pracownicy (id, tenant_id, imie) VALUES (?, ?, ?)`,
        [randomUUID(), tenant_id, p.imie]);
    }

    // 4. Usługi
    for (const u of d.uslugi) {
      await qc(conn, `INSERT INTO Uslugi (id, tenant_id, kategoria, wariant, cena, zrodlo) VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), tenant_id, u.kategoria, u.wariant, u.cena, u.zrodlo || 'reczne']);
    }

    await commit(conn);
    log.log(`[rejestracja/zaloz] OK tenant=${tenant_id} | ${d.pracownicy.length} prac., ${d.uslugi.length} usług`);
    return { wynik: 'ok', tenant_id };
  } catch (err) {
    log.error('[rejestracja/zaloz] rollback:', err.code || '', err.message);
    await rollback(conn);
    return { wynik: 'blad', message: 'Nie udało się założyć salonu (błąd zapisu). Nic nie zostało zapisane — Twój link pozostaje ważny, spróbuj ponownie. Jeśli problem się powtórzy, napisz do nas.' };
  } finally {
    try { conn.release(); } catch (e) { /* już zwolnione */ }
  }
}

module.exports = { zalozSalon, nowyTenantId, slugify };
