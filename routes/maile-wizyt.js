// routes/maile-wizyt.js — powiadomienia e-mail dla KLIENTEK salonu (21.10.2026).
//
// Dwie wiadomości, o które prosił właściciel:
//   • „potwierdzenie" — zaraz po umówieniu wizyty,
//   • „przypomnienie" — dzień wcześniej, o godzinie ustawionej przez salon (domyślnie 18:00).
//
// To pierwsza poczta, jaką Estelio wysyła do KLIENTEK salonu, a nie do właścicieli — stąd
// zasady ostrzejsze niż w serii wprowadzającej (polecenie: „pilnuj, żebyś wysyłał tylko do
// właściwych osób"):
//
//  1. Adres bierzemy WYŁĄCZNIE z karty klientki przypisanej do tej rezerwacji (Klienci.email).
//     Nigdy z Rejestru RODO, nigdy z importu Booksy, nigdy „po nazwisku" — dopasowanie po
//     nazwisku potrafi trafić w inną osobę o tym samym imieniu.
//  2. Adres musi wyglądać na adres (w danych bywa „nie dotyczy", „brak").
//  3. Klientka z zaznaczonym „nie chcę wiadomości o wizytach" (Klienci.bez_maili) nie dostaje nic.
//  4. Klientka usunięta, zanonimizowana albo zmarła nie dostaje nic.
//  5. Rezerwacja odwołana/odrzucona/wygasła nie generuje przypomnienia.
//  6. Rezerwacja techniczna (bez klientki) nie generuje niczego.
//  7. Rezerwacja musi należeć do tego samego salonu co ustawienia i adres — wszystkie zapytania
//     mają tenant_id w WHERE.
//  8. Idempotencja: UNIQUE(tenant_id, rezerwacja_id, typ) rezerwowany PRZED wysyłką, więc nawet
//     dwie instancje na wspólnej bazie nie wyślą tego samego dwa razy.
//  9. Wyłącznik globalny (env MAILE_WIZYT: off|proba|on, domyślnie off) ORAZ przełącznik per salon
//     (domyślnie wyłączony). Oba muszą być włączone, żeby cokolwiek wyszło.
// 10. Każda próba — udana czy nie — ląduje w dzienniku z adresem i odpowiedzią serwera pocztowego.
'use strict';

const DOMYSLNA_GODZINA = 18;        // przypomnienie wieczorem dnia poprzedniego
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const STATUSY_ODPADAJACE = ['anulowana', 'odrzucona', 'wygasla'];

module.exports = function (db, opts = {}) {
  const mailer = opts.mailer || require('./mailer');
  const log = opts.log || console;
  const teraz = opts.teraz || (() => new Date());

  const TRYB = () => {
    const t = String(process.env.MAILE_WIZYT || 'off').trim().toLowerCase();
    return t === 'on' || t === 'proba' ? t : 'off';
  };
  const q = (sql, params = []) => new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

  const czystyEmail = (v) => {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return RE_EMAIL.test(s) ? s : null;
  };

  async function init() {
    try {
      await q(`CREATE TABLE IF NOT EXISTS Maile_wizyt_ustawienia (
        tenant_id VARCHAR(100) NOT NULL PRIMARY KEY,
        wlaczone TINYINT(1) NOT NULL DEFAULT 0,
        potwierdzenia TINYINT(1) NOT NULL DEFAULT 1,
        przypomnienia TINYINT(1) NOT NULL DEFAULT 1,
        godzina_przypomnienia TINYINT NOT NULL DEFAULT ${DOMYSLNA_GODZINA},
        zmieniono DATETIME DEFAULT CURRENT_TIMESTAMP,
        kto VARCHAR(100) NULL
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await q(`CREATE TABLE IF NOT EXISTS Maile_wizyt_wyslane (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        rezerwacja_id INT NOT NULL,
        typ VARCHAR(20) NOT NULL,
        email VARCHAR(255) NULL,
        kiedy DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wizyta (tenant_id, rezerwacja_id, typ)
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await q(`CREATE TABLE IF NOT EXISTS Maile_wizyt_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        kiedy DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        tenant_id VARCHAR(100) NULL,
        rezerwacja_id INT NULL,
        id_klienta VARCHAR(50) NULL,
        klient VARCHAR(255) NULL,
        email VARCHAR(255) NOT NULL,
        typ VARCHAR(20) NOT NULL,
        status VARCHAR(12) NOT NULL,
        smtp_id VARCHAR(255) NULL,
        smtp_odpowiedz VARCHAR(255) NULL,
        blad VARCHAR(500) NULL,
        kto VARCHAR(100) NULL,
        INDEX idx_tenant (tenant_id, kiedy),
        INDEX idx_rez (tenant_id, rezerwacja_id)
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) { log.error('[maile-wizyt] init tabel:', e.message); }
  }

  async function zapiszLog(w) {
    try {
      await q(`INSERT INTO Maile_wizyt_log (tenant_id, rezerwacja_id, id_klienta, klient, email, typ, status, smtp_id, smtp_odpowiedz, blad, kto)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [w.tenant_id || null, w.rezerwacja_id || null, w.id_klienta || null, (w.klient || '').slice(0, 255), w.email, w.typ, w.status,
         w.smtp_id || null, String(w.smtp_odpowiedz || '').slice(0, 255) || null, String(w.blad || '').slice(0, 500) || null, w.kto || 'system']);
    } catch (e) { log.error('[maile-wizyt] zapis dziennika:', e.message); }
  }

  /** Ustawienia salonu; brak wiersza = wyłączone (świadomie: nowy salon niczego nie wysyła). */
  async function ustawienia(tenant) {
    try {
      const r = await q(`SELECT wlaczone, potwierdzenia, przypomnienia, godzina_przypomnienia FROM Maile_wizyt_ustawienia WHERE tenant_id = ?`, [tenant]);
      if (!r.length) return { wlaczone: false, potwierdzenia: true, przypomnienia: true, godzina: DOMYSLNA_GODZINA };
      return {
        wlaczone: !!r[0].wlaczone,
        potwierdzenia: !!r[0].potwierdzenia,
        przypomnienia: !!r[0].przypomnienia,
        godzina: Number(r[0].godzina_przypomnienia) || DOMYSLNA_GODZINA,
      };
    } catch (e) { return { wlaczone: false, potwierdzenia: true, przypomnienia: true, godzina: DOMYSLNA_GODZINA }; }
  }

  async function zapiszUstawienia(tenant, dane, kto) {
    const godz = Math.max(0, Math.min(23, parseInt(dane.godzina, 10) || DOMYSLNA_GODZINA));
    await q(`INSERT INTO Maile_wizyt_ustawienia (tenant_id, wlaczone, potwierdzenia, przypomnienia, godzina_przypomnienia, kto)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE wlaczone = VALUES(wlaczone), potwierdzenia = VALUES(potwierdzenia),
               przypomnienia = VALUES(przypomnienia), godzina_przypomnienia = VALUES(godzina_przypomnienia),
               zmieniono = NOW(), kto = VALUES(kto)`,
      [tenant, dane.wlaczone ? 1 : 0, dane.potwierdzenia === false ? 0 : 1, dane.przypomnienia === false ? 0 : 1, godz, kto || null]);
    return ustawienia(tenant);
  }

  /** Dane salonu do nagłówka i stopki maila (nadawca = salon, nie Estelio). */
  async function salon(tenant) {
    try {
      const r = await q(`SELECT nazwa_salonu, nazwa_firmy, miasto, ulica, telefon, email FROM Licencje WHERE id_bazy = ? LIMIT 1`, [tenant]);
      const s = r[0] || {};
      return {
        nazwa: String(s.nazwa_salonu || s.nazwa_firmy || 'Salon').trim(),
        adres: [s.ulica, s.miasto].filter(Boolean).join(', '),
        telefon: s.telefon || null,
        email: czystyEmail(s.email),
      };
    } catch (e) { return { nazwa: 'Salon', adres: '', telefon: null, email: null }; }
  }

  /**
   * Wizyta z kompletem danych potrzebnych do decyzji „wolno wysłać?" — razem z adresem
   * i flagami klientki. Jedno zapytanie, zawsze z tenant_id w WHERE.
   */
  async function wizyta(tenant, rezerwacjaId) {
    const r = await q(
      `SELECT r.id, r.tenant_id, r.status, r.id_klienta, r.klient_nazwa,
              DATE_FORMAT(r.start, '%Y-%m-%d') AS dzien,
              DATE_FORMAT(r.start, '%H:%i') AS godzina,
              DATE_FORMAT(r.koniec, '%H:%i') AS koniec,
              k.email AS email, k.bez_maili, k.status AS status_klientki, k.zmarly
         FROM Term_Rezerwacje r
         LEFT JOIN Klienci k ON k.tenant_id = r.tenant_id AND k.id_klienta = r.id_klienta
        WHERE r.tenant_id = ? AND r.id = ? LIMIT 1`, [tenant, Number(rezerwacjaId)]);
    if (!r.length) return null;
    const w = r[0];
    const poz = await q(
      `SELECT kategoria, wariant, pracownik, DATE_FORMAT(start, '%H:%i') AS od, DATE_FORMAT(koniec, '%H:%i') AS do_
         FROM Term_Pozycje WHERE tenant_id = ? AND rezerwacja_id = ? ORDER BY kolejnosc, start`, [tenant, Number(rezerwacjaId)]);
    return { ...w, pozycje: poz || [] };
  }

  /**
   * Jedyne miejsce, które decyduje, czy wiadomość wolno wysłać. Zwraca { ok, powod, email }.
   * Powód wraca nawet przy odmowie — trafia do logu, żeby dało się odpowiedzieć na pytanie
   * „dlaczego klientka nic nie dostała" bez zgadywania.
   */
  function wolnoWyslac(w, typ) {
    if (!w) return { ok: false, powod: 'nie ma takiej wizyty' };
    if (!w.id_klienta) return { ok: false, powod: 'rezerwacja techniczna — brak klientki' };
    if (STATUSY_ODPADAJACE.includes(String(w.status || '').toLowerCase())) return { ok: false, powod: `wizyta ${w.status}` };
    if (Number(w.bez_maili || 0)) return { ok: false, powod: 'klientka nie chce wiadomości o wizytach' };
    if (Number(w.zmarly || 0)) return { ok: false, powod: 'karta oznaczona jako zmarła' };
    const st = String(w.status_klientki || 'AKTYWNY').toUpperCase();
    if (st !== 'AKTYWNY') return { ok: false, powod: `karta klientki: ${st}` };
    const email = czystyEmail(w.email);
    if (!email) return { ok: false, powod: 'brak adresu e-mail w kartotece' };
    return { ok: true, email };
  }

  /** Wysyłka jednej wiadomości o wizycie. Nie rzuca — wynik wraca jako obiekt i ląduje w logu. */
  async function wyslij(tenant, rezerwacjaId, typ, kto) {
    const tryb = TRYB();
    if (tryb === 'off') return { wyslano: false, powod: 'wysyłka wyłączona globalnie (MAILE_WIZYT)' };
    const ust = await ustawienia(tenant);
    if (!ust.wlaczone) return { wyslano: false, powod: 'salon ma wyłączone wiadomości o wizytach' };
    if (typ === 'potwierdzenie' && !ust.potwierdzenia) return { wyslano: false, powod: 'salon wyłączył potwierdzenia' };
    if (typ === 'przypomnienie' && !ust.przypomnienia) return { wyslano: false, powod: 'salon wyłączył przypomnienia' };

    const w = await wizyta(tenant, rezerwacjaId);
    const zgoda = wolnoWyslac(w, typ);
    if (!zgoda.ok) {
      log.info(`[maile-wizyt] pomijam ${typ} dla wizyty ${rezerwacjaId}: ${zgoda.powod}`);
      return { wyslano: false, powod: zgoda.powod };
    }
    if (tryb === 'proba') {
      log.info(`[maile-wizyt] PRÓBA — wysłałbym „${typ}" do ${zgoda.email} (wizyta ${rezerwacjaId}, ${w.dzien} ${w.godzina})`);
      return { wyslano: false, powod: 'tryb próbny — nic nie wyszło' };
    }

    // rezerwacja PRZED wysyłką: dwie instancje na wspólnej bazie nie wyślą tego samego dwa razy
    try {
      const r = await q(`INSERT IGNORE INTO Maile_wizyt_wyslane (tenant_id, rezerwacja_id, typ, email) VALUES (?, ?, ?, ?)`,
        [tenant, Number(rezerwacjaId), typ, zgoda.email]);
      if (!r || !r.affectedRows) return { wyslano: false, powod: 'już wysłane wcześniej' };
    } catch (e) { return { wyslano: false, powod: 'rezerwacja w historii nie powiodła się: ' + e.message }; }

    const dane = { salon: await salon(tenant), wizyta: w, typ };
    try {
      const wynik = await mailer.wyslijMailWizyty({ email: zgoda.email, ...dane });
      await zapiszLog({ tenant_id: tenant, rezerwacja_id: w.id, id_klienta: w.id_klienta, klient: w.klient_nazwa, email: zgoda.email,
        typ, status: 'wyslany', smtp_id: wynik.messageId, smtp_odpowiedz: wynik.odpowiedz, kto });
      log.info(`[maile-wizyt] wysłano „${typ}" do ${zgoda.email} (wizyta ${w.id})`);
      return { wyslano: true, email: zgoda.email };
    } catch (e) {
      await q(`DELETE FROM Maile_wizyt_wyslane WHERE tenant_id = ? AND rezerwacja_id = ? AND typ = ?`, [tenant, Number(rezerwacjaId), typ]).catch(() => {});
      await zapiszLog({ tenant_id: tenant, rezerwacja_id: w.id, id_klienta: w.id_klienta, klient: w.klient_nazwa, email: zgoda.email,
        typ, status: 'blad', blad: e.message, kto });
      log.error(`[maile-wizyt] SMTP (${typ}, wizyta ${rezerwacjaId}):`, e.message);
      return { wyslano: false, powod: 'błąd wysyłki: ' + e.message };
    }
  }

  /** Hook z Terminarza: potwierdzenie zaraz po umówieniu. Nigdy nie blokuje zapisu wizyty. */
  function potwierdzenieWTle(tenant, rezerwacjaId, kto) {
    setImmediate(() => {
      wyslij(tenant, rezerwacjaId, 'potwierdzenie', kto)
        .catch(e => log.error('[maile-wizyt] potwierdzenie:', e.message));
    });
  }

  /**
   * Przebieg co godzinę: salony, które mają włączone przypomnienia i właśnie wybiła ich godzina,
   * dostają wysyłkę na wizyty JUTRZEJSZE. Bez salonów — brak zapytań do wizyt.
   */
  async function tick() {
    const tryb = TRYB();
    if (tryb === 'off') return { tryb, wyslane: 0 };
    const godzinaTeraz = teraz().getHours();
    let salony = [];
    try {
      salony = await q(`SELECT tenant_id, godzina_przypomnienia FROM Maile_wizyt_ustawienia WHERE wlaczone = 1 AND przypomnienia = 1`);
    } catch (e) { log.error('[maile-wizyt] odczyt ustawień:', e.message); return { tryb, wyslane: 0 }; }
    const doRoboty = (salony || []).filter(s => (Number(s.godzina_przypomnienia) || DOMYSLNA_GODZINA) === godzinaTeraz);
    if (!doRoboty.length) return { tryb, wyslane: 0 };

    const jutro = new Date(teraz().getTime() + 24 * 60 * 60 * 1000);
    const dzien = `${jutro.getFullYear()}-${String(jutro.getMonth() + 1).padStart(2, '0')}-${String(jutro.getDate()).padStart(2, '0')}`;
    let wyslane = 0;
    for (const s of doRoboty) {
      let wizyty = [];
      try {
        wizyty = await q(
          `SELECT r.id FROM Term_Rezerwacje r
            WHERE r.tenant_id = ? AND DATE(r.start) = ? AND r.id_klienta IS NOT NULL
              AND r.status NOT IN ('anulowana', 'odrzucona', 'wygasla')
              AND NOT EXISTS (SELECT 1 FROM Maile_wizyt_wyslane m WHERE m.tenant_id = r.tenant_id AND m.rezerwacja_id = r.id AND m.typ = 'przypomnienie')
            LIMIT 200`, [s.tenant_id, dzien]);
      } catch (e) { log.error(`[maile-wizyt] ${s.tenant_id}: odczyt wizyt:`, e.message); continue; }
      for (const w of (wizyty || [])) {
        const r = await wyslij(s.tenant_id, w.id, 'przypomnienie', 'automat').catch(() => ({ wyslano: false }));
        if (r.wyslano) wyslane++;
      }
    }
    return { tryb, wyslane };
  }

  /** Wysyłka próbna pod wskazany adres — omija przełączniki, ale nigdy nie dotyka historii wysyłek. */
  async function probka(tenant, email, typ, kto) {
    const adres = czystyEmail(email);
    if (!adres) throw new Error('Podaj poprawny adres e-mail.');
    const s = await salon(tenant);
    const przyklad = {
      id: 0, klient_nazwa: 'Anna Przykładowa', dzien: new Date(teraz().getTime() + 86400000).toISOString().slice(0, 10),
      godzina: '14:00', koniec: '15:00',
      pozycje: [{ kategoria: 'Endermologia', wariant: '1x', pracownik: 'Anna', od: '14:00', do_: '15:00' }],
    };
    const wynik = await mailer.wyslijMailWizyty({ email: adres, salon: s, wizyta: przyklad, typ: typ === 'przypomnienie' ? 'przypomnienie' : 'potwierdzenie' });
    await zapiszLog({ tenant_id: tenant, email: adres, typ: 'proba', status: 'wyslany', smtp_id: wynik.messageId, smtp_odpowiedz: wynik.odpowiedz, kto });
    return { email: adres, smtp_id: wynik.messageId };
  }

  async function dziennik({ tenant, szukaj, limit } = {}) {
    const warunki = [], parametry = [];
    if (tenant) { warunki.push('tenant_id = ?'); parametry.push(tenant); }
    if (szukaj) { warunki.push('(klient LIKE ? OR email LIKE ?)'); const s = `%${szukaj}%`; parametry.push(s, s); }
    const ile = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    try {
      return await q(`SELECT * FROM Maile_wizyt_log ${warunki.length ? 'WHERE ' + warunki.join(' AND ') : ''} ORDER BY kiedy DESC, id DESC LIMIT ${ile}`, parametry);
    } catch (e) { return []; }
  }

  function start() {
    init().then(() => {
      const uruchom = () => tick().catch(e => log.error('[maile-wizyt] tick:', e.message));
      setTimeout(uruchom, 3 * 60 * 1000);           // pierwszy przebieg 3 minuty po starcie
      setInterval(uruchom, 60 * 60 * 1000);         // potem co godzinę (sprawdza, czy wybiła godzina salonu)
      log.info(`[maile-wizyt] powiadomienia o wizytach gotowe (tryb: ${TRYB()})`);
    });
  }

  return { init, start, tick, wyslij, potwierdzenieWTle, probka, dziennik, ustawienia, zapiszUstawienia, salon, wizyta, wolnoWyslac, _TRYB: TRYB };
};
