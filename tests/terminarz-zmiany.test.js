// tests/terminarz-zmiany.test.js — „co zniknęło z grafiku" (19.10.2026, scenariusz Oli).
//
// Scenariusz, który to wywołał: Ola widzi w niedzielę dziesięć wizyt na środę, rozmraża czynniki,
// a we wtorek zostają dwie i nikt nie pamięta, kto skasował resztę. Cztery zmiany do sprawdzenia:
//   1) odwołanie wizyty z nadchodzących dni dostaje priorytet, który dociera do dzwonka (P0/P1),
//   2) seryjne odwoływanie przez jedną osobę tworzy JEDNĄ zbiorczą sprawę E33,
//   3) pasek „co zniknęło" (trm_zmiany_grafiku) — nieprzeczytane zmiany na najbliższe dni,
//   4) panel „Co się zmieniło?" (trm_zmiany_dnia) — kto, kiedy i co zrobił w danym dniu.
//
// RODZAJ PRÓB: kontrakt routera na atrapie bazy (supertest + express) + czysta funkcja priorytetu
// + kontrola źródła dla reguł, których atrapa nie dowiedzie (progi zbiorczej sprawy w transakcji).
// Zachowanie samych zapytań SQL potwierdza próba na izolowanej bazie (narzedzia/srodowisko-testowe).
const request = require('supertest'); const express = require('express');
const fs = require('fs'); const path = require('path');

const T = 'salon-test-001';
const M = require('../routes/terminarz');

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

// Sprawy tak, jak leżą w Term_Sprawy: dane w kolumnie dane_json, czasy jako łańcuchy.
const sprawa = (o) => ({ id: o.id, typ: o.typ, rezerwacja_id: o.rezerwacja_id === undefined ? 100 + o.id : o.rezerwacja_id,
  tytul: o.tytul, opis: o.opis || null, dane_json: JSON.stringify(o.dane || {}), priorytet: o.priorytet || 'P1',
  priorytet_bazowy: o.priorytet || 'P1', stan: o.stan || 'nowa', wlasciciel: o.wlasciciel || null,
  termin_dzialania: null, powiazany_czas: o.czas, wynik: null, rozwiazal: null, rozwiazano: null,
  utworzono: '2026-10-19 09:00:00', zmieniono: '2026-10-19 09:00:00', klucz_dedup: o.klucz || ('X:' + o.id) });

const SPRAWY = [
  sprawa({ id: 1, typ: 'E05', tytul: 'Odwołano wizytę — Marta Kowalska', czas: '2026-10-21 12:00:00', priorytet: 'P0', dane: { kto: 'salon', powod: 'rozmrożenie czynnika', dotyczy: ['Anna'] } }),
  sprawa({ id: 2, typ: 'E05', tytul: 'Odwołano wizytę — Julia Wiśniewska', czas: '2026-10-21 13:00:00', priorytet: 'P0', dane: { kto: 'salon', powod: 'rozmrożenie czynnika', dotyczy: ['Anna'] } }),
  sprawa({ id: 3, typ: 'E02', tytul: 'Zmieniono termin — Ewa Nowak', czas: '2026-10-23 10:00:00', dane: { dotyczy: ['Ola'] } }),
  sprawa({ id: 4, typ: 'E03', tytul: 'Zmieniono wykonawcę — Kinga Lis', czas: '2026-10-24 15:00:00', dane: { dotyczy: ['Anna', 'Ola'] } }),
  sprawa({ id: 5, typ: 'E33', rezerwacja_id: null, tytul: 'Czyszczenie grafiku: Anna, 2026-10-21 — 8 wizyt', czas: '2026-10-21 00:00:00', priorytet: 'P0', dane: { autor: 'Ola', dzien: '2026-10-21', pracownik: 'Anna', dotyczy: ['Anna'] } }),
];

// Term_Historia ⋈ Term_Rezerwacje dla jednego dnia — z jednym wpisem, który NIE jest zmianą grafiku.
const HISTORIA_DNIA = [
  { id: 90, kiedy: '2026-10-19 09:40', kto: 'Ola', akcja: 'anulowano', opis: 'Odwołano całą wizytę: rozmrożenie czynnika',
    rezerwacja_id: 11, klient_nazwa: 'Marta Kowalska', status: 'anulowana', start: '2026-10-21 12:00', pracownicy: 'Anna' },
  { id: 89, kiedy: '2026-10-19 09:38', kto: 'Ola', akcja: 'anulowano_pozycje', opis: 'Odwołano zabiegi: Endermologia',
    rezerwacja_id: 12, klient_nazwa: 'Julia Wiśniewska', status: 'potwierdzona', start: '2026-10-21 13:00', pracownicy: 'Anna, Ola' },
  { id: 88, kiedy: '2026-10-18 17:00', kto: 'Marta', akcja: 'przelozono', opis: '2026-10-21 09:00 → 2026-10-28 09:00',
    rezerwacja_id: 13, klient_nazwa: 'Ewa Nowak', status: 'potwierdzona', start: '2026-10-28 09:00', pracownicy: 'Ola' },
  { id: 87, kiedy: '2026-10-17 11:00', kto: 'Ola', akcja: 'utworzono', opis: 'Zapisano wizytę',
    rezerwacja_id: 14, klient_nazwa: 'Kinga Lis', status: 'potwierdzona', start: '2026-10-21 16:00', pracownicy: 'Anna' },
  { id: 86, kiedy: '2026-10-17 11:05', kto: 'Ola', akcja: 'notatka', opis: 'Woli popołudnia',
    rezerwacja_id: 14, klient_nazwa: 'Kinga Lis', status: 'potwierdzona', start: '2026-10-21 16:00', pracownicy: 'Anna' },
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
  app.use('/api', M(db, { hasFeature: (t, k, cb) => cb(true) }));
  return app;
}
const post = (app, body, pracownik = 'Ola') => request(app).post('/api/terminarz').send({ tenant_id: T, pracownik, ...body });
// Zapytania samej akcji — bez tych, które moduł wykonuje przy starcie (CREATE TABLE, katalog dodatków).
const odKtoregoMiejsca = (db) => db.zap.length;
const zapisyPo = (db, od) => db.zap.slice(od).filter(z => /\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|ALTER)\b/i.test(z.sql) && !/CREATE TABLE IF NOT EXISTS/i.test(z.sql));
const czytaloPo = (db, od, re) => db.zap.slice(od).some(z => re.test(z.sql));

describe('ZM01 — priorytet wizyty, która zniknęła z grafiku', () => {
  const p = M.priorytetZnikaniaWizyty, TERAZ = '2026-10-19 10:00';
  test('do 48 godzin P0 (reagować dziś), do 7 dni P1 (trzeba wiedzieć), dalej P2', () => {
    expect(p(TERAZ, '2026-10-19 13:00')).toBe('P0');   // dziś po południu
    expect(p(TERAZ, '2026-10-21 09:00')).toBe('P0');   // niecałe dwie doby — środa Oli
    expect(p(TERAZ, '2026-10-21 10:00')).toBe('P0');   // dokładnie 48 h → jeszcze P0
    expect(p(TERAZ, '2026-10-21 10:01')).toBe('P1');   // minutę dalej → P1
    expect(p(TERAZ, '2026-10-24 09:00')).toBe('P1');   // w tym tygodniu
    expect(p(TERAZ, '2026-10-26 10:00')).toBe('P1');   // dokładnie 7 dni
    expect(p(TERAZ, '2026-11-08 09:00')).toBe('P2');   // trzy tygodnie dalej
  });
  test('brak powiązanego czasu nie udaje pilnej sprawy', () => {
    expect(p(TERAZ, null)).toBe('P2');
    expect(p(TERAZ, '')).toBe('P2');
  });
  test('wizyta już minęła (odwołanie wpisane po terminie) nadal jest P0, nie znika z dzwonka', () => {
    expect(p(TERAZ, '2026-10-19 08:00')).toBe('P0');
    expect(p(TERAZ, '2026-10-01 08:00')).toBe('P0');
  });
});

describe('ZM02 — trm_zmiany_grafiku: pasek „co zniknęło"', () => {
  const zapytania = (rows, odczyt = []) => [
    [/FROM Term_Sprawy WHERE tenant_id = \? AND typ IN/, rows],
    [/FROM Term_Sprawy_Odczyt WHERE/, odczyt],
  ];

  test('recepcja widzi wszystkie zmiany i rozbicie po rodzajach', async () => {
    const db = baza(zapytania(SPRAWY));
    const { body } = await post(aplikacja(db), { action: 'trm_zmiany_grafiku', dni: 7 });
    expect(body.status).toBe('success');
    expect(body).toMatchObject({ dni: 7, nowych: 5, odwolane: 2, przelozone: 1, zmiana_wykonawcy: 1, serie: 1 });
    expect(body.sprawy).toHaveLength(5);
    expect(body.sprawy[0]).toMatchObject({ typ: 'E05', przeczytane: false });
    expect(body.sprawy[0].dane.powod).toBe('rozmrożenie czynnika');  // powód odwołania jest podany
  });

  test('przeczytane zmiany nie wracają na pasek', async () => {
    const db = baza(zapytania(SPRAWY, [{ sprawa_id: 1 }, { sprawa_id: 2 }, { sprawa_id: 5 }]));
    const { body } = await post(aplikacja(db), { action: 'trm_zmiany_grafiku' });
    expect(body.nowych).toBe(2);
    expect(body.odwolane).toBe(0);
    expect(body.serie).toBe(0);
    expect(body.sprawy.map(s => s.id)).toEqual([3, 4]);
  });

  test('kosmetolog widzi tylko to, co dotyczy jego grafiku', async () => {
    const db = baza(zapytania(SPRAWY), 'kosmetolog');
    const { body } = await post(aplikacja(db), { action: 'trm_zmiany_grafiku' }, 'Anna');
    expect(body.status).toBe('success');
    expect(body.sprawy.map(s => s.id)).toEqual([1, 2, 4, 5]);   // E02 Oli (id 3) nie jest jego sprawą
    expect(body.przelozone).toBe(0);
    expect(body.serie).toBe(1);                                  // zbiorcze czyszczenie JEGO dnia dociera
  });

  test('zakres dni jest ograniczony (1–60) i liczony od teraz', async () => {
    const db = baza(zapytania([]));
    const { body } = await post(aplikacja(db), { action: 'trm_zmiany_grafiku', dni: 999 });
    expect(body.dni).toBe(60);
    expect(body.do).toBe('2026-12-18');
    const zap = db.zap.find(z => /FROM Term_Sprawy WHERE tenant_id = \? AND typ IN/.test(z.sql));
    expect(zap.params[1]).toBe('2026-10-19 10:00:00');           // od teraz, nie od początku historii
    expect(zap.params[2]).toBe('2026-12-18 23:59:59');
    const { body: b2 } = await post(aplikacja(baza(zapytania([]))), { action: 'trm_zmiany_grafiku', dni: 0 });
    expect(b2.dni).toBe(7);                                      // 0/brak → domyślny tydzień
  });

  test('pasek pyta tylko o sprawy o znikaniu wizyt i o nierozwiązane', async () => {
    const db = baza(zapytania([]));
    await post(aplikacja(db), { action: 'trm_zmiany_grafiku' });
    const sql = db.zap.find(z => /FROM Term_Sprawy WHERE tenant_id = \? AND typ IN/.test(z.sql)).sql;
    expect(sql).toMatch(/'E02','E03','E05','E33'/);
    expect(sql).toMatch(/stan NOT IN \('rozwiazana','nieaktualna'\)/);
  });

  test('akcja nie zapisuje niczego do bazy', async () => {
    const db = baza(zapytania(SPRAWY)); const app = aplikacja(db); const od = odKtoregoMiejsca(db);
    await post(app, { action: 'trm_zmiany_grafiku' });
    expect(zapisyPo(db, od)).toEqual([]);
  });

  test('zakładka „Zmiany w wizytach" w dzwonku pokazuje zmiany planu, a nie sprawy o rozliczeniach', async () => {
    const mieszane = [...SPRAWY,
      sprawa({ id: 6, typ: 'E13', tytul: 'Brak wyniku wizyty — Patrycja Adamczyk', czas: '2026-10-13 10:30:00' }),
      sprawa({ id: 7, typ: 'E21', tytul: 'Wizyta bez zakupu — Lena Dąbrowska', czas: '2026-10-22 09:00:00' })];
    const db = baza([
      [/FROM Term_Sprawy WHERE tenant_id = \? ORDER BY CASE priorytet/, mieszane],
      [/FROM Term_Sprawy_Odczyt WHERE/, []],
    ]);
    const { body } = await post(aplikacja(db), { action: 'trm_sprawy_lista', zakladka: 'zmiany' });
    expect(body.status).toBe('success');
    expect(body.sprawy.map(s => s.typ).sort()).toEqual(['E02', 'E03', 'E05', 'E05', 'E33']);
  });
});

describe('ZM03 — trm_zmiany_dnia: kto odwołał wizyty z tego dnia', () => {
  const zapytania = (rows) => [[/FROM Term_Historia h\s+JOIN Term_Rezerwacje r/, rows]];

  test('lista pokazuje tylko zmiany grafiku, z autorem, godziną wpisu i numerem wizyty', async () => {
    const db = baza(zapytania(HISTORIA_DNIA));
    const { body } = await post(aplikacja(db), { action: 'trm_zmiany_dnia', data: '2026-10-21' });
    expect(body.status).toBe('success');
    expect(body.zmiany).toHaveLength(4);                                   // wpis „notatka" odpada
    expect(body.zmiany.map(z => z.akcja)).not.toContain('notatka');
    expect(body.zmiany[0]).toMatchObject({ kto: 'Ola', akcja: 'anulowano', klient: 'Marta Kowalska', numer: 'EST-0011', pracownicy: 'Anna' });
    expect(body.zmiany[0].opis).toMatch(/rozmrożenie czynnika/);
  });

  test('podsumowanie liczy odwołania (całych wizyt i pojedynczych zabiegów), przełożenia i dodane', async () => {
    const db = baza(zapytania(HISTORIA_DNIA));
    const { body } = await post(aplikacja(db), { action: 'trm_zmiany_dnia', data: '2026-10-21' });
    expect(body.podsumowanie).toEqual({ wszystkich: 4, odwolan: 2, przelozen: 1, dodanych: 1 });
    expect(body.data).toBe('2026-10-21');
  });

  test('przełożenia szuka też po opisie, bo wizyta ma już NOWĄ datę', async () => {
    const db = baza(zapytania(HISTORIA_DNIA));
    await post(aplikacja(db), { action: 'trm_zmiany_dnia', data: '2026-10-21' });
    const z = db.zap.find(x => /FROM Term_Historia h\s+JOIN Term_Rezerwacje r/.test(x.sql));
    expect(z.sql).toMatch(/DATE\(r\.start\) = \? OR h\.opis LIKE \?/);
    expect(z.params).toEqual([T, '2026-10-21', '2026-10-21%']);
  });

  test('dzień bez zmian daje pustą listę, nie błąd', async () => {
    const db = baza(zapytania([]));
    const { body } = await post(aplikacja(db), { action: 'trm_zmiany_dnia', data: '2026-10-21' });
    expect(body.status).toBe('success');
    expect(body.zmiany).toEqual([]);
    expect(body.podsumowanie.wszystkich).toBe(0);
  });

  test('kosmetolog nie dostaje dziennika zmian całego salonu', async () => {
    const db = baza(zapytania(HISTORIA_DNIA), 'kosmetolog'); const app = aplikacja(db); const od = odKtoregoMiejsca(db);
    const { body } = await post(app, { action: 'trm_zmiany_dnia', data: '2026-10-21' }, 'Anna');
    expect(body.status).toBe('error');
    expect(czytaloPo(db, od, /FROM Term_Historia h/)).toBe(false);
  });

  test('zła data zatrzymuje żądanie przed zapytaniem do bazy', async () => {
    const db = baza(zapytania(HISTORIA_DNIA)); const app = aplikacja(db); const od = odKtoregoMiejsca(db);
    const { body } = await post(app, { action: 'trm_zmiany_dnia', data: '21.10.2026' });
    expect(body.status).toBe('error');
    expect(czytaloPo(db, od, /FROM Term_Historia h/)).toBe(false);
  });

  test('akcja nie zapisuje niczego do bazy', async () => {
    const db = baza(zapytania(HISTORIA_DNIA)); const app = aplikacja(db); const od = odKtoregoMiejsca(db);
    await post(app, { action: 'trm_zmiany_dnia', data: '2026-10-21' });
    expect(zapisyPo(db, od)).toEqual([]);
  });
});

// Zbiorcza sprawa powstaje wewnątrz transakcji trm_anuluj, której atrapa bazy nie odtwarza
// wiernie (GET_LOCK, blokady, kolejność zapytań). Reguły pilnujemy więc na źródle — zachowanie
// end-to-end potwierdza próba na izolowanej bazie (scenariusz: osiem odwołań z jednego dnia).
describe('ZM04 — zbiorcza sprawa „Czyszczenie grafiku" (kontrola źródła)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'terminarz.js'), 'utf8');
  test('dwa odwołania to jeszcze nie seria — sprawa powstaje od trzeciego', () => {
    expect(src).toMatch(/if \(rows\.length < 3\) continue;/);
  });
  test('okno to pół godziny, ten sam autor, ten sam dzień i ta sama osoba w grafiku', () => {
    expect(src).toMatch(/r\.anulowal = \?\s+AND r\.anulowano >= DATE_SUB\(\?, INTERVAL 30 MINUTE\)/);
    expect(src).toMatch(/klucz: `E33:\$\{dzien\}:\$\{osoba\}:\$\{autor\}`/);
  });
  test('odwołanie i zmiana wykonawcy liczą priorytet nową regułą, nie progiem dwóch godzin', () => {
    const e05 = src.match(/typ: 'E05'[\s\S]{0,900}?\}\);/)[0];
    expect(e05).toMatch(/priorytet: priorytetZnikaniaWizyty\(terazOdw, rez\.start\)/);
    const e03 = src.match(/typ: 'E03'[\s\S]{0,900}?\}\);/)[0];
    expect(e03).toMatch(/priorytet: priorytetZnikaniaWizyty\(cfg\.terazStr, w2\.start\)/);
  });
  test('zakładka „Zmiany w wizytach" pokazuje zmiany planu dnia, w tym zbiorcze czyszczenie', () => {
    expect(src).toMatch(/const TYPY_ZMIAN = new Set\(\['E02', 'E03', 'E05', 'E06', 'E08', 'E33'\]\)/);
    expect(src).toMatch(/zakladka === 'zmiany'\) widoczne = widoczne\.filter\(x => TYPY_ZMIAN\.has\(x\.typ\)\)/);
  });
  test('oba nowe odczyty są zarejestrowane w dyspozytorze akcji', () => {
    expect(M.AKCJE).toContain('trm_zmiany_grafiku');
    expect(M.AKCJE).toContain('trm_zmiany_dnia');
  });
});
