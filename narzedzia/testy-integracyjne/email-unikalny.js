// narzedzia/testy-integracyjne/email-unikalny.js
// Sprawdzenie na żywym serwerze, że jeden adres e-mail = jedna licencja (paczka B+C planu
// docs/PLAN_UNIKALNY_EMAIL_2026-11-16.md). Działa WYŁĄCZNIE na bazie izolowanej (estelio_test, port 3307):
// skrypt odmawia startu, jeśli DB_NAME nie jest bazą testową.
//
// Uruchomienie (serwer musi już działać na PORT z .env.test):
//   node -r dotenv/config narzedzia/testy-integracyjne/email-unikalny.js dotenv_config_path=.env.test
'use strict';

const mysql = require('mysql2');

const BAZA = process.env.DB_NAME || '';
const PORT = process.env.PORT || '3999';
const ADRES = `http://127.0.0.1:${PORT}`;
const TOKEN_ADMINA = process.env.ADMIN_TOKEN || '';

if (!/test/i.test(BAZA) || String(process.env.DB_PORT) !== '3307') {
  console.error(`STOP: ten skrypt pisze do bazy, więc wolno go uruchomić tylko na izolowanej. DB_NAME=${BAZA}, DB_PORT=${process.env.DB_PORT}`);
  process.exit(1);
}

const db = mysql.createConnection({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: BAZA, multipleStatements: false,
});
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => (e ? rej(e) : res(r))));

const ZAJETY = 'test@example.invalid';          // e-mail licencji demo-test
const ZAJETY_INNY = 'zk02@example.invalid';     // e-mail licencji zk02-test
const WOLNY = 'wolny-adres-proby@example.invalid';
const TOKEN_PROBY = 'proba-email-unikalny-tok';
const ZAMOWIENIE_PROBY = 'proba-email-unikalny-zam';

let zaliczone = 0, oblane = 0;
function sprawdz(nazwa, warunek, szczegol = '') {
  if (warunek) { zaliczone++; console.log(`  OK   ${nazwa}`); }
  else { oblane++; console.log(`  BŁĄD ${nazwa}${szczegol ? ' → ' + szczegol : ''}`); }
}
const get = async (sciezka, naglowki = {}) => {
  const r = await fetch(ADRES + sciezka, { headers: naglowki });
  return { kod: r.status, d: await r.json().catch(() => ({})) };
};
const post = async (sciezka, body, naglowki = {}) => {
  const r = await fetch(ADRES + sciezka, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...naglowki }, body: JSON.stringify(body),
  });
  return { kod: r.status, d: await r.json().catch(() => ({})) };
};

async function sprzatnij() {
  await q(`DELETE FROM Zamowienia WHERE id = ? OR email = ?`, [ZAMOWIENIE_PROBY, WOLNY]);
  await q(`DELETE FROM Tokeny_rejestracji WHERE token = ?`, [TOKEN_PROBY]);
  await q(`DELETE FROM Licencje WHERE login LIKE 'proba-email-%'`);
  await q(`UPDATE Licencje SET email = ? WHERE login = 'demo-test'`, [ZAJETY]);
}

(async () => {
  console.log(`\n=== Jeden e-mail = jedna licencja — próba na ${ADRES}, baza ${BAZA} ===\n`);
  await sprzatnij();

  // ── 1. Migracja startowa (paczka C) ──────────────────────────────────────────
  console.log('1. Migracja startowa — indeks UNIQUE na Licencje.email');
  const idx = await q(`SHOW INDEX FROM Licencje WHERE Key_name = 'uq_licencje_email'`);
  sprawdz('indeks uq_licencje_email istnieje (baza bez duplikatów)', idx.length === 1, `znaleziono ${idx.length}`);
  const puste = await q(`SELECT COUNT(*) AS n FROM Licencje WHERE email = ''`);
  sprawdz("żadna licencja nie ma e-maila '' (puste zamienione na NULL)", puste[0].n === 0, `jest ${puste[0].n}`);

  // ── 2. Baza broni się sama, nawet gdy kod ominie kontrolę ────────────────────
  console.log('\n2. Indeks w bazie jako druga linia obrony');
  let bladBazy = null;
  try {
    await q(`INSERT INTO Licencje (id, login, haslo, rola, id_bazy, status, nazwa_salonu, email, data_utworzenia)
             VALUES (UUID(), 'proba-email-dubel', 'x', 'salon', 'proba-email-dubel-1', 'aktywny', 'Próba', ?, NOW())`, [ZAJETY]);
  } catch (e) { bladBazy = e; }
  sprawdz('INSERT drugiej licencji z tym samym adresem odrzucony', bladBazy && bladBazy.code === 'ER_DUP_ENTRY', bladBazy ? bladBazy.code : 'przeszedł!');
  sprawdz('błąd wskazuje indeks uq_licencje_email, nie login', bladBazy && /uq_licencje_email/i.test(bladBazy.message), bladBazy ? bladBazy.message : '');
  let bladWielkoscLiter = null;
  try {
    await q(`INSERT INTO Licencje (id, login, haslo, rola, id_bazy, status, nazwa_salonu, email, data_utworzenia)
             VALUES (UUID(), 'proba-email-dubel2', 'x', 'salon', 'proba-email-dubel-2', 'aktywny', 'Próba', ?, NOW())`, [ZAJETY.toUpperCase()]);
  } catch (e) { bladWielkoscLiter = e; }
  sprawdz('ten sam adres WIELKIMI literami też odrzucony (kolacja bez rozróżniania)', bladWielkoscLiter && bladWielkoscLiter.code === 'ER_DUP_ENTRY', bladWielkoscLiter ? bladWielkoscLiter.code : 'przeszedł!');
  await q(`DELETE FROM Licencje WHERE login LIKE 'proba-email-%'`);

  // ── 3. Podgląd na żywo w formularzach ───────────────────────────────────────
  console.log('\n3. GET /api/rejestracja/check-email (publiczne, bez nazwy salonu w odpowiedzi)');
  const a1 = await get(`/api/rejestracja/check-email?email=${encodeURIComponent(ZAJETY)}`);
  sprawdz('adres licencji → EMAIL_ZAJETY', a1.d.code === 'EMAIL_ZAJETY' && a1.d.dostepny === false, JSON.stringify(a1.d));
  sprawdz('komunikat nie zdradza, który salon ma adres', !/demo-test|id_bazy/i.test(String(a1.d.message)), String(a1.d.message));
  const a2 = await get(`/api/rejestracja/check-email?email=${encodeURIComponent('  ' + ZAJETY.toUpperCase() + '  ')}`);
  sprawdz('ten sam adres ze spacjami i wielkimi literami → EMAIL_ZAJETY', a2.d.code === 'EMAIL_ZAJETY', JSON.stringify(a2.d));
  const a3 = await get(`/api/rejestracja/check-email?email=${encodeURIComponent(WOLNY)}`);
  sprawdz('adres nieużywany → WOLNY', a3.d.code === 'WOLNY' && a3.d.dostepny === true, JSON.stringify(a3.d));
  const a4 = await get(`/api/rejestracja/check-email?email=bzdura`);
  sprawdz('zły format → FORMAT (front nie blokuje wtedy wysyłki komunikatem o zajętości)', a4.d.code === 'FORMAT', JSON.stringify(a4.d));

  // ── 4. Zakup przez Stripe ───────────────────────────────────────────────────
  console.log('\n4. POST /api/stripe/create-checkout — odmowa przed zapisem zamówienia i przed Stripe');
  const przedZam = (await q(`SELECT COUNT(*) AS n FROM Zamowienia`))[0].n;
  const zakup = await post('/api/stripe/create-checkout', {
    imie: 'Próba', nazwa_salonu: 'Salon Próbny', email: ZAJETY, zgoda_regulamin: true, zgoda_dpa: true,
  });
  sprawdz('zajęty adres → błąd EMAIL_ZAJETY', zakup.d.status === 'error' && zakup.d.code === 'EMAIL_ZAJETY', JSON.stringify(zakup.d));
  const poZam = (await q(`SELECT COUNT(*) AS n FROM Zamowienia`))[0].n;
  sprawdz('żadne zamówienie nie zostało zapisane', poZam === przedZam, `${przedZam} → ${poZam}`);

  // ── 5. Stary formularz zamówienia ───────────────────────────────────────────
  console.log('\n5. POST /api/zamowienie (formularz awaryjny bez Stripe)');
  const z1 = await post('/api/zamowienie', { imie: 'Próba', nazwa_salonu: 'Salon Próbny', email: ZAJETY });
  sprawdz('zajęty adres → błąd EMAIL_ZAJETY', z1.d.status === 'error' && z1.d.code === 'EMAIL_ZAJETY', JSON.stringify(z1.d));
  const z2 = await post('/api/zamowienie', { imie: 'Próba', nazwa_salonu: 'Salon Próbny', email: WOLNY });
  sprawdz('wolny adres → zamówienie przyjęte', z2.d.status === 'success', JSON.stringify(z2.d));
  const zapisany = await q(`SELECT email FROM Zamowienia WHERE email = ?`, [WOLNY]);
  sprawdz('adres zapisany małymi literami, bez spacji', zapisany.length === 1 && zapisany[0].email === WOLNY, JSON.stringify(zapisany));

  // ── 6. Zakładanie salonu z linku aktywacyjnego ──────────────────────────────
  console.log('\n6. POST /api/rejestracja/zaloz — token zostaje ważny, gdy adres jest zajęty');
  await q(`INSERT INTO Tokeny_rejestracji (token, status, data_wygasniecia, data_utworzenia, notatka)
           VALUES (?, 'nowy', DATE_ADD(NOW(), INTERVAL 7 DAY), NOW(), 'próba blokady e-maila')`, [TOKEN_PROBY]);
  await q(`INSERT INTO Zamowienia (id, imie, nazwa_salonu, email, status, token_wyslany, data_zgloszenia, zgoda_regulamin, zgoda_dpa)
           VALUES (?, 'Próba', 'Salon z linku', ?, 'wyslano_link', ?, NOW(), 1, 1)`, [ZAMOWIENIE_PROBY, ZAJETY, TOKEN_PROBY]);
  const przedLic = (await q(`SELECT COUNT(*) AS n FROM Licencje`))[0].n;
  const r1 = await post('/api/rejestracja/zaloz', {
    token: TOKEN_PROBY, nazwa_salonu: 'Salon z linku', login: 'proba-email-zaloz', haslo: 'tajne123',
    pracownicy: [{ imie: 'Ala', pin: '1234', rola: 'manager' }], uslugi: [],
  });
  sprawdz('zajęty adres z zamówienia → błąd EMAIL_ZAJETY', r1.d.status === 'error' && r1.d.code === 'EMAIL_ZAJETY', JSON.stringify(r1.d));
  sprawdz('komunikat mówi klientowi, że link pozostaje ważny', /link pozostaje ważny/i.test(String(r1.d.message)), String(r1.d.message));
  const tokPo = await q(`SELECT status, tenant_id_utworzony FROM Tokeny_rejestracji WHERE token = ?`, [TOKEN_PROBY]);
  sprawdz("token wrócił do stanu 'nowy' (rollback transakcji)", tokPo[0] && tokPo[0].status === 'nowy', JSON.stringify(tokPo[0]));
  const poLic = (await q(`SELECT COUNT(*) AS n FROM Licencje`))[0].n;
  sprawdz('żadna licencja ani „pół-salon" nie powstały', poLic === przedLic, `${przedLic} → ${poLic}`);

  // ── 7. Panel admina ─────────────────────────────────────────────────────────
  console.log('\n7. Panel admina — tworzenie i edycja salonu');
  // Panel admina pracuje na sesji z /api/admin/login (hasło = ADMIN_TOKEN), nie na samym ADMIN_TOKEN
  const logowanie = await post('/api/admin/login', { haslo: TOKEN_ADMINA });
  sprawdz('logowanie admina do panelu', logowanie.d.status === 'success' && !!logowanie.d.token, JSON.stringify(logowanie.d));
  const naglowkiAdmina = { 'X-Admin-Token': logowanie.d.token || '' };
  const c1 = await post('/api/admin/create_tenant', { nazwa_salonu: 'Salon Admina', login: 'proba-email-admin', haslo: 'tajne123', email: ZAJETY }, naglowkiAdmina);
  sprawdz('create_tenant z zajętym adresem → odmowa', c1.d.status === 'error' && c1.d.code === 'EMAIL_ZAJETY', JSON.stringify(c1.d));
  const u1 = await post('/api/admin/update_tenant', { id_bazy: 'demo-test', nazwa_salonu: 'Demo Test', email: ZAJETY_INNY }, naglowkiAdmina);
  sprawdz('update_tenant na adres innego salonu → odmowa', u1.d.status === 'error' && u1.d.code === 'EMAIL_ZAJETY', JSON.stringify(u1.d));
  const u2 = await post('/api/admin/update_tenant', { id_bazy: 'demo-test', nazwa_salonu: 'Demo Test', email: ZAJETY }, naglowkiAdmina);
  sprawdz('update_tenant z WŁASNYM adresem salonu → przechodzi', u2.d.status === 'success', JSON.stringify(u2.d));
  const u3 = await post('/api/admin/update_tenant', { id_bazy: 'demo-test', nazwa_salonu: 'Demo Test', email: '' }, naglowkiAdmina);
  const poPustym = await q(`SELECT email FROM Licencje WHERE id_bazy = 'demo-test'`);
  sprawdz('pusty adres zapisuje się jako NULL, nie jako ""', u3.d.status === 'success' && poPustym[0].email === null, JSON.stringify(poPustym[0]));
  const e1 = await get(`/api/admin/check-email?email=${encodeURIComponent(ZAJETY_INNY)}&pomin=zk02-test`, naglowkiAdmina);
  sprawdz('check-email z pomin = własny salon → WOLNY', e1.d.code === 'WOLNY', JSON.stringify(e1.d));
  const e2 = await get(`/api/admin/check-email?email=${encodeURIComponent(ZAJETY_INNY)}`, naglowkiAdmina);
  sprawdz('check-email bez pomin → EMAIL_ZAJETY', e2.d.code === 'EMAIL_ZAJETY', JSON.stringify(e2.d));
  const e3 = await get(`/api/admin/check-email?email=${encodeURIComponent(ZAJETY_INNY)}&pomin=zk02-test`);
  sprawdz('check-email admina bez tokenu → odrzucone (wariant z pomin nie jest publiczny)', e3.kod !== 200 || e3.d.status === 'error', `kod ${e3.kod} ${JSON.stringify(e3.d)}`);

  await sprzatnij();
  const koncowy = await q(`SELECT login, email FROM Licencje ORDER BY login`);
  console.log('\nStan licencji po sprzątaniu:');
  koncowy.forEach(x => console.log(`  ${x.login} | ${JSON.stringify(x.email)}`));

  console.log(`\n=== WYNIK: ${zaliczone} zaliczonych, ${oblane} obłanych ===\n`);
  db.end();
  process.exit(oblane === 0 ? 0 : 1);
})().catch(e => { console.error('WYJĄTEK:', e); db.end(); process.exit(1); });
