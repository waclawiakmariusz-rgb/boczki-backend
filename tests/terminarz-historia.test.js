// tests/terminarz-historia.test.js — widok „Historia" w Terminarzu (19.10.2026).
//
// RODZAJ PRÓB: kontrakt routera na atrapie bazy (supertest + express). Sprawdzamy to, co można
// sprawdzić bez MariaDB: uprawnienia, walidację zakresu dat, kształt odpowiedzi, liczenie
// podsumowań, składanie spłaszczonych wierszy w wizyty i maskowanie cen dla specjalisty.
// NIE dowodzą zachowania samych zapytań SQL na prawdziwej bazie — to robi próba na izolowanym
// środowisku (narzedzia/srodowisko-testowe) i zrzuty ekranu dołączone do zgłoszenia.
const request = require('supertest'); const express = require('express');

const T = 'salon-test-001';

// Atrapa bazy: lista [wzorzec SQL, odpowiedź]. Pierwszy pasujący wzorzec wygrywa.
function atrapaBazy(odpowiedzi) {
  const zap = [];
  const wykonaj = (sql, params) => {
    zap.push({ sql: String(sql), params: params || [] });
    for (const [re, w] of odpowiedzi) if (re.test(sql)) return typeof w === 'function' ? w(sql, params) : w;
    return [];
  };
  const query = (sql, p, cb) => {
    const c = typeof p === 'function' ? p : cb; const params = typeof p === 'function' ? [] : p;
    let w; try { w = wykonaj(sql, params); } catch (e) { return c && c(e); }
    if (c) c(null, w);
  };
  const conn = { query, beginTransaction: (cb) => cb(null), commit: (cb) => cb(null), rollback: (cb) => cb(null), release: () => {} };
  return { query, getConnection: (cb) => cb(null, conn), zap };
}

const USTAWIENIA = { tenant_id: T, tryb: 'wewnetrzny', siatka_min: 15, tolerancja_min: 10, horyzont_dni: 90, wyprzedzenie_min: 0,
  godziny_json: JSON.stringify({ 1: [{ od: '08:00', do: '20:00' }], 2: [{ od: '08:00', do: '20:00' }], 3: [{ od: '08:00', do: '20:00' }], 4: [{ od: '08:00', do: '20:00' }], 5: [{ od: '08:00', do: '20:00' }], 6: [], 7: [] }) };

// Dwie wizyty klientki, spłaszczone jak zwraca JOIN: pierwsza ma dwie pozycje, druga jest odwołana.
const WIERSZE_KLIENTKI = [
  { id: 11, numer: 'EST-0011', klient_nazwa: 'Marta Kowalska', id_klienta: '1001', status: 'potwierdzona', obecnosc: 'przybyl', kanal: 'recepcja',
    notatka: 'Woli popołudnia', powod_anulacji: null, kto_anulowal: null, sprzedaz_id: 'S-1',
    start: '2026-10-15 12:00', koniec: '2026-10-15 13:30',
    kategoria: 'Endermologia', wariant: '1x', pracownik: 'Anna', wykonawca_fakt: 'Anna', stan: 'wykonana', cena: 200, czas_min: 60, zakup_skladnik_id: null, start_fakt: '12:02', koniec_fakt: '13:00' },
  { id: 11, numer: 'EST-0011', klient_nazwa: 'Marta Kowalska', id_klienta: '1001', status: 'potwierdzona', obecnosc: 'przybyl', kanal: 'recepcja',
    notatka: 'Woli popołudnia', powod_anulacji: null, kto_anulowal: null, sprzedaz_id: 'S-1',
    start: '2026-10-15 12:00', koniec: '2026-10-15 13:30',
    kategoria: 'Masaż', wariant: null, pracownik: 'Anna', wykonawca_fakt: 'Ola', stan: 'wykonana', cena: 150, czas_min: 30, zakup_skladnik_id: 7, start_fakt: '13:00', koniec_fakt: '13:30' },
  { id: 9, numer: 'EST-0009', klient_nazwa: 'Marta Kowalska', id_klienta: '1001', status: 'anulowana', obecnosc: 'oczekiwana', kanal: 'telefon',
    notatka: null, powod_anulacji: 'Klientka przełożyła', kto_anulowal: 'klient', sprzedaz_id: null,
    start: '2026-10-10 09:00', koniec: '2026-10-10 10:00',
    kategoria: 'Endermologia', wariant: '1x', pracownik: 'Anna', wykonawca_fakt: null, stan: 'anulowana', cena: 200, czas_min: 60, zakup_skladnik_id: null, start_fakt: null, koniec_fakt: null },
];

// Pozycje jednej osoby z zespołu w dwóch różnych dniach.
const WIERSZE_PRACOWNIKA = [
  { id: 11, numer: 'EST-0011', klient_nazwa: 'Marta Kowalska', id_klienta: '1001', status: 'potwierdzona', obecnosc: 'przybyl',
    dzien: '2026-10-15', godzina: '12:00', kategoria: 'Endermologia', wariant: '1x', pracownik: 'Anna', wykonawca_fakt: 'Anna', stan: 'wykonana', cena: 200, czas_min: 60, zakup_skladnik_id: null },
  { id: 12, numer: 'EST-0012', klient_nazwa: 'Julia Wiśniewska', id_klienta: '1002', status: 'potwierdzona', obecnosc: 'nieobecny',
    dzien: '2026-10-15', godzina: '15:00', kategoria: 'Meltivio', wariant: '1x', pracownik: 'Anna', wykonawca_fakt: null, stan: 'niewykonana', cena: 300, czas_min: 45, zakup_skladnik_id: null },
  { id: 13, numer: 'EST-0013', klient_nazwa: 'Marta Kowalska', id_klienta: '1001', status: 'potwierdzona', obecnosc: 'przybyl',
    dzien: '2026-10-12', godzina: '10:00', kategoria: 'Endermologia', wariant: '1x', pracownik: 'Ola', wykonawca_fakt: 'Anna', stan: 'wykonana', cena: 200, czas_min: 60, zakup_skladnik_id: 5 },
];

function baza(extra = [], rola = 'manager') {
  return atrapaBazy([
    [/SELECT rola FROM Użytkownicy/, [{ rola }]],
    [/FROM Term_Ustawienia WHERE/, [USTAWIENIA]],
    [/SELECT DATE_FORMAT\(NOW\(\)/, [{ t: '2026-10-19 10:00:00' }]],
    [/SELECT p\.imie FROM Pracownicy/, [{ imie: 'Anna' }, { imie: 'Ola' }]],
    ...extra,
  ]);
}
function aplikacja(db) {
  const app = express(); app.use(express.json());
  const m = require('../routes/terminarz');
  app.use('/api', m(db, { hasFeature: (t, k, cb) => cb(true) }));
  return app;
}
const post = (app, body, pracownik = 'Ola') => request(app).post('/api/terminarz').send({ tenant_id: T, pracownik, ...body });

describe('H01 — historia klientki: kształt odpowiedzi i podsumowanie', () => {
  test('spłaszczone wiersze z JOIN składają się z powrotem w wizyty z pozycjami', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, WIERSZE_KLIENTKI]]));
    const { body } = await post(app, { action: 'trm_historia_klientki', id_klienta: '1001', od: '2026-10-01', do: '2026-10-19' });
    expect(body.status).toBe('success');
    expect(body.wizyty).toHaveLength(2);                 // trzy wiersze = dwie wizyty
    expect(body.wizyty[0].pozycje).toHaveLength(2);      // pierwsza wizyta ma dwa zabiegi
    expect(body.wizyty[0].rozliczona).toBe(true);        // sprzedaz_id → rozliczona
    expect(body.klient).toBe('Marta Kowalska');
  });

  test('wykonawca faktyczny wygrywa nad planowanym (zastępstwo widać w historii)', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, WIERSZE_KLIENTKI]]));
    const { body } = await post(app, { action: 'trm_historia_klientki', id_klienta: '1001', od: '2026-10-01', do: '2026-10-19' });
    const masaz = body.wizyty[0].pozycje.find(p => p.kategoria === 'Masaż');
    expect(masaz.pracownik).toBe('Anna');
    expect(masaz.wykonawca).toBe('Ola');
    expect(masaz.z_pakietu).toBe(true);
  });

  test('podsumowanie liczy tylko wykonane: wartość, najczęstszy zabieg i osoba', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, WIERSZE_KLIENTKI]]));
    const { body } = await post(app, { action: 'trm_historia_klientki', id_klienta: '1001', od: '2026-10-01', do: '2026-10-19' });
    const p = body.podsumowanie;
    expect(p).toMatchObject({ wizyt: 2, wykonane: 1, odwolane: 1, nieobecnosci: 0 });
    expect(p.wartosc).toBe(350);                          // 200 + 150; odwołana (200) NIE wchodzi
    expect(p.zabiegi.map(x => x.nazwa)).toEqual(expect.arrayContaining(['Endermologia · 1x', 'Masaż']));
    expect(p.osoby.find(o => o.nazwa === 'Ola').ile).toBe(1);
  });

  test('brak wizyt → pusta lista i wyzerowane podsumowanie, bez błędu', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, []]]));
    const { body } = await post(app, { action: 'trm_historia_klientki', id_klienta: '9999', od: '2026-10-01', do: '2026-10-19' });
    expect(body.status).toBe('success');
    expect(body.wizyty).toEqual([]);
    expect(body.podsumowanie).toMatchObject({ wizyt: 0, wykonane: 0, wartosc: 0 });
  });
});

describe('H02 — historia pracownika: grupowanie po dniach i podsumowanie', () => {
  test('pozycje grupują się po dniach, najnowszy dzień pierwszy', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, WIERSZE_PRACOWNIKA]]));
    const { body } = await post(app, { action: 'trm_historia_pracownika', osoba: 'Anna', od: '2026-10-01', do: '2026-10-19' });
    expect(body.status).toBe('success');
    expect(body.dni.map(d => d.dzien)).toEqual(['2026-10-15', '2026-10-12']);
    expect(body.dni[0].wizyty).toHaveLength(2);
  });

  test('nieobecność nie liczy się jako wykonana; czas i wartość tylko z wykonanych', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, WIERSZE_PRACOWNIKA]]));
    const { body } = await post(app, { action: 'trm_historia_pracownika', osoba: 'Anna', od: '2026-10-01', do: '2026-10-19' });
    const p = body.podsumowanie;
    expect(p).toMatchObject({ pozycji: 3, wykonane: 2, nieobecnosci: 1, odwolane: 0, klientek: 2 });
    expect(p.minuty).toBe(120);     // 60 + 60; nieobecna (45) nie wchodzi
    expect(p.wartosc).toBe(400);    // 200 + 200
  });

  test('zastępstwo jest oznaczone: wykonała Anna, choć zaplanowana była Ola', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, WIERSZE_PRACOWNIKA]]));
    const { body } = await post(app, { action: 'trm_historia_pracownika', osoba: 'Anna', od: '2026-10-01', do: '2026-10-19' });
    const dzien12 = body.dni.find(d => d.dzien === '2026-10-12');
    expect(dzien12.wizyty[0].zastepstwo).toBe(true);
    expect(dzien12.wizyty[0].z_pakietu).toBe(true);
  });
});

describe('H03 — uprawnienia i granice zakresu', () => {
  test('specjalista nie dostaje historii cudzej klientki', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, WIERSZE_KLIENTKI]], 'kosmetolog'));
    const { body } = await post(app, { action: 'trm_historia_klientki', id_klienta: '1001', od: '2026-10-01', do: '2026-10-19' }, 'Anna');
    expect(body.status).toBe('error');
  });

  test('specjalista widzi własną historię, ale bez cen', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, WIERSZE_PRACOWNIKA]], 'kosmetolog'));
    const { body } = await post(app, { action: 'trm_historia_pracownika', osoba: 'Ola', od: '2026-10-01', do: '2026-10-19' }, 'Anna');
    expect(body.status).toBe('success');
    expect(body.pracownik).toBe('Anna');                  // podany „Ola" zignorowany — zawsze własna historia
    expect(body.podsumowanie.wartosc).toBeNull();
    expect(body.dni[0].wizyty.every(w => w.cena === null)).toBe(true);
  });

  test('zakres dłuższy niż 400 dni jest odrzucany', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, []]]));
    const { body } = await post(app, { action: 'trm_historia_klientki', id_klienta: '1001', od: '2024-01-01', do: '2026-10-19' });
    expect(body.status).toBe('error');
    expect(String(body.message)).toMatch(/400 dni/);
  });

  test('brak wskazanej klientki → czytelny błąd zamiast pustej listy', async () => {
    const app = aplikacja(baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, []]]));
    const { body } = await post(app, { action: 'trm_historia_klientki', od: '2026-10-01', do: '2026-10-19' });
    expect(body.status).toBe('error');
    expect(String(body.message)).toMatch(/klientk/i);
  });

  test('zła data → błąd walidacji, zapytanie do bazy nie leci', async () => {
    const db = baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, []]]);
    const app = aplikacja(db);
    const { body } = await post(app, { action: 'trm_historia_klientki', id_klienta: '1001', od: 'wczoraj', do: '2026-10-19' });
    expect(body.status).toBe('error');
    expect(db.zap.some(z => /JOIN Term_Pozycje/.test(z.sql))).toBe(false);
  });
});

describe('H04 — historia niczego nie zapisuje', () => {
  test('obie akcje wykonują wyłącznie SELECT-y', async () => {
    const db = baza([[/FROM Term_Rezerwacje r\s+JOIN Term_Pozycje p/, WIERSZE_KLIENTKI]]);
    const app = aplikacja(db);
    const odKtoregoMiejsca = db.zap.length;   // pomijamy zapytania wykonane przy starcie modułu
    await post(app, { action: 'trm_historia_klientki', id_klienta: '1001', od: '2026-10-01', do: '2026-10-19' });
    await post(app, { action: 'trm_historia_pracownika', osoba: 'Anna', od: '2026-10-01', do: '2026-10-19' });
    const pisze = db.zap.slice(odKtoregoMiejsca).filter(z => /\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|ALTER)\b/i.test(z.sql) && !/CREATE TABLE IF NOT EXISTS/i.test(z.sql));
    expect(pisze).toEqual([]);
  });
});
