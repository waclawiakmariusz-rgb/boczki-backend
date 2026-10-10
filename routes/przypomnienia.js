// routes/przypomnienia.js — przypomnienia e-mail dla nowych klientów (2026-10-10).
//
// Trzy reguły, raz dziennie, każda wysyłka zapisana w WŁASNEJ tabeli z kluczem unikalnym:
//   link_3   — zakup opłacony, link rejestracyjny nieużyty od 3 dni  → „Twój link czeka"
//   link_10  — j.w., od 10 dni                                       → „link wygaśnie za N dni"
//   salon_3  — salon założony, od 3 dni ani jednego logowania        → „pomożemy wystartować"
//
// ZASADY BEZPIECZEŃSTWA (user 2026-10-10: „nic nie może zakłócić rejestracji ani Estelio"):
//  • moduł TYLKO czyta Zamowienia/Tokeny_rejestracji/Licencje/Sesje i pisze do Przypomnienia_wyslane;
//    nie dotyka żadnej istniejącej tabeli ani ścieżki rejestracji/logowania;
//  • każdy błąd jest łapany i logowany wewnątrz modułu — nic nie wychodzi do serwera;
//  • tryb z env PRZYPOMNIENIA: 'off' (nic), 'proba' (DOMYŚLNIE — tylko log „wysłałbym"),
//    'on' (wysyłka). Po wdrożeniu najpierw dzień-dwa 'proba', dopiero potem 'on';
//  • idempotencja jak w Klubie: INSERT IGNORE do tabeli z UNIQUE(typ, klucz) PRZED wysyłką —
//    dwie instancje na wspólnej bazie (dev + prod) nie wyślą nic dwa razy; gdy SMTP padnie,
//    wpis jest usuwany i próba wraca następnego dnia;
//  • okna czasowe są domknięte z obu stron (np. link_3: 3–9 dni), a punkt odcięcia CUTOFF
//    pomija wszystko sprzed uruchomienia — nie piszemy do ludzi z czerwca;
//  • każde przypomnienie idzie w kopii (BCC) do ADMIN_EMAIL — właściciel widzi, co dostają klienci.
const DZIEN_MS = 24 * 60 * 60 * 1000;
const CUTOFF = '2026-10-10';                  // nie dotykamy zamówień/salonów sprzed tej daty
const OKNA = { link_3: [3, 9], link_10: [10, 20], salon_3: [3, 10] };   // dni [od, do)
const POMIJANE_TENANTY = ['demo-estelio'];

module.exports = function (db, opts = {}) {
  const mailer = opts.mailer || require('./mailer');
  const log = opts.log || console;
  const teraz = opts.teraz || (() => new Date());

  const TRYB = () => {
    const t = String(process.env.PRZYPOMNIENIA || 'proba').trim().toLowerCase();
    return t === 'on' || t === 'off' ? t : 'proba';
  };
  const q = (sql, params = []) => new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

  // Własna tabela — tworzy się sama, jak tabele Klubu. Nic w istniejących tabelach.
  function init() {
    return q(`CREATE TABLE IF NOT EXISTS Przypomnienia_wyslane (
      id INT AUTO_INCREMENT PRIMARY KEY,
      typ VARCHAR(40) NOT NULL,
      klucz VARCHAR(120) NOT NULL,
      email VARCHAR(255) NULL,
      data_wyslania DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_przypomnienie (typ, klucz)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(e => log.error('[przypomnienia] init tabeli:', e.message));
  }

  // ── Reguły: SELECT kandydatów + jak wysłać. Klucz = token / tenant_id (unikalny per typ). ──
  const sqlLink = `
    SELECT z.id AS zamowienie_id, z.email, z.imie, z.nazwa_salonu, t.token,
           t.data_utworzenia, t.data_wygasniecia, DATEDIFF(t.data_wygasniecia, NOW()) AS dni_do_wygasniecia
      FROM Zamowienia z
      JOIN Tokeny_rejestracji t ON t.token = z.token_wyslany
     WHERE z.status = 'wyslano_link' AND t.status = 'nowy' AND t.data_wygasniecia > NOW()
       AND z.email IS NOT NULL AND z.email <> ''
       AND t.data_utworzenia >= ?
       AND t.data_utworzenia <= DATE_SUB(NOW(), INTERVAL ? DAY)
       AND t.data_utworzenia >  DATE_SUB(NOW(), INTERVAL ? DAY)
     LIMIT 50`;

  const sqlSalon = `
    SELECT l.id_bazy, l.email, l.nazwa_salonu, l.login, l.data_utworzenia
      FROM Licencje l
     WHERE l.status = 'aktywny' AND l.email IS NOT NULL AND l.email <> ''
       AND l.data_utworzenia >= ?
       AND l.data_utworzenia <= DATE_SUB(NOW(), INTERVAL ? DAY)
       AND l.data_utworzenia >  DATE_SUB(NOW(), INTERVAL ? DAY)
       AND l.id_bazy NOT IN (${POMIJANE_TENANTY.map(() => '?').join(',')})
       AND NOT EXISTS (SELECT 1 FROM Sesje s WHERE s.tenant_id COLLATE utf8mb4_unicode_ci = l.id_bazy)
     LIMIT 50`;
  // ^ Sesje.tenant_id ma inną kolację (utf8mb4_uca1400_ai_ci — nowy domyślny MariaDB) niż
  //   Licencje.id_bazy (utf8mb4_unicode_ci); bez jawnego COLLATE MariaDB odrzuca porównanie
  //   („Illegal mix of collations") — wyszło w trybie próbnym na prawdziwej bazie 2026-10-10.

  const REGULY = [
    {
      typ: 'link_3',
      kandydaci: () => q(sqlLink, [CUTOFF, OKNA.link_3[0], OKNA.link_3[1]]),
      klucz: (r) => r.token, email: (r) => r.email,
      wyslij: (r) => mailer.wyslijPrzypomnienieLink({ email: r.email, imie: r.imie, nazwa_salonu: r.nazwa_salonu, token: r.token, dniDoWygasniecia: r.dni_do_wygasniecia, etap: 1 }),
    },
    {
      typ: 'link_10',
      kandydaci: () => q(sqlLink, [CUTOFF, OKNA.link_10[0], OKNA.link_10[1]]),
      klucz: (r) => r.token, email: (r) => r.email,
      wyslij: (r) => mailer.wyslijPrzypomnienieLink({ email: r.email, imie: r.imie, nazwa_salonu: r.nazwa_salonu, token: r.token, dniDoWygasniecia: r.dni_do_wygasniecia, etap: 2 }),
    },
    {
      typ: 'salon_3',
      kandydaci: () => q(sqlSalon, [CUTOFF, OKNA.salon_3[0], OKNA.salon_3[1], ...POMIJANE_TENANTY]),
      klucz: (r) => r.id_bazy, email: (r) => r.email,
      wyslij: (r) => mailer.wyslijPrzypomnienieStart({ email: r.email, nazwa_salonu: r.nazwa_salonu, login: r.login }),
    },
  ];

  // Jeden przebieg. Zwraca podsumowanie (do logu i testów). Nigdy nie rzuca.
  async function tick() {
    const tryb = TRYB();
    const wynik = { tryb, kandydaci: 0, wyslano: 0, pominieto: 0, bledy: 0, szczegoly: [] };
    if (tryb === 'off') return wynik;
    for (const reg of REGULY) {
      let rows = [];
      try { rows = await reg.kandydaci(); } catch (e) { wynik.bledy++; log.error(`[przypomnienia] ${reg.typ} SELECT:`, e.message); continue; }
      for (const r of (Array.isArray(rows) ? rows : [])) {
        const klucz = String(reg.klucz(r) || '');
        const email = String(reg.email(r) || '').trim();
        if (!klucz || !email) continue;
        wynik.kandydaci++;
        if (tryb === 'proba') {
          wynik.szczegoly.push({ typ: reg.typ, klucz, email, tryb: 'proba' });
          log.log(`[przypomnienia] PRÓBA — wysłałbym ${reg.typ} do ${email} (klucz ${klucz})`);
          continue;
        }
        // Claim PRZED wysyłką — UNIQUE(typ, klucz) gwarantuje jedną wysyłkę, także przy 2 instancjach.
        let claim = null;
        try { claim = await q(`INSERT IGNORE INTO Przypomnienia_wyslane (typ, klucz, email) VALUES (?, ?, ?)`, [reg.typ, klucz, email]); }
        catch (e) { wynik.bledy++; log.error(`[przypomnienia] ${reg.typ} claim:`, e.message); continue; }
        if (!claim || !claim.affectedRows) { wynik.pominieto++; continue; }
        try {
          await reg.wyslij(r);
          wynik.wyslano++;
          wynik.szczegoly.push({ typ: reg.typ, klucz, email, tryb: 'on' });
          log.log(`[przypomnienia] wysłano ${reg.typ} do ${email}`);
        } catch (e) {
          wynik.bledy++;
          log.error(`[przypomnienia] ${reg.typ} wysyłka do ${email} nieudana (ponowię jutro):`, e.message);
          await q(`DELETE FROM Przypomnienia_wyslane WHERE typ = ? AND klucz = ?`, [reg.typ, klucz])
            .catch(e2 => log.error('[przypomnienia] cofnięcie claimu:', e2.message));
        }
      }
    }
    log.log(`[przypomnienia] przebieg (${tryb}): kandydatów ${wynik.kandydaci}, wysłano ${wynik.wyslano}, pominięto ${wynik.pominieto}, błędów ${wynik.bledy}`);
    return wynik;
  }

  // Harmonogram: co 60 s sprawdzamy, czy minęła godzina startu i czy dziś już był przebieg.
  // Godzina w czasie SERWERA (Hostinger = UTC): 7 → ok. 9 rano w Polsce. W testach nie startuje.
  let ostatniDzien = null;
  function start() {
    if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') return;
    init();
    const godzina = parseInt(process.env.PRZYPOMNIENIA_GODZINA || '7', 10);
    const timer = setInterval(() => {
      try {
        const t = teraz();
        const dzien = t.toISOString().slice(0, 10);
        if (t.getHours() >= godzina && ostatniDzien !== dzien) {
          ostatniDzien = dzien;
          tick().catch(e => log.error('[przypomnienia] tick:', e.message));
        }
      } catch (e) { log.error('[przypomnienia] harmonogram:', e.message); }
    }, 60 * 1000);
    if (timer.unref) timer.unref();
    log.log(`[przypomnienia] start — tryb ${TRYB()}, przebieg po godz. ${godzina} (czas serwera), cutoff ${CUTOFF}`);
  }

  return { tick, start, init, _REGULY: REGULY, _OKNA: OKNA, _CUTOFF: CUTOFF, _TRYB: TRYB };
};
