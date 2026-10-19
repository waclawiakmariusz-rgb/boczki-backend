// tests/preferencje.test.js — preferencje klientki („lubi kawę, woli ciepło”), 19.10.2026.
//
// RODZAJ PRÓB: kontrakt routera na atrapie bazy (supertest + express) — uprawnienia, zakres
// widoczności dla kosmetologa, walidacja wartości i zakładanie listy startowej. Zachowanie
// samych zapytań na MariaDB potwierdza próba na izolowanym środowisku.
const request = require('supertest'); const express = require('express');

const T = 'salon-test-001';
const M = require('../routes/preferencje');

function atrapaBazy(odpowiedzi) {
  const zap = [];
  const query = (sql, p, cb) => {
    const c = typeof p === 'function' ? p : cb; const params = typeof p === 'function' ? [] : p;
    zap.push({ sql: String(sql), params: params || [] });
    for (const [re, w] of odpowiedzi) if (re.test(sql)) { let v; try { v = typeof w === 'function' ? w(sql, params) : w; } catch (e) { return c && c(e); } return c && c(null, v); }
    return c && c(null, []);
  };
  return { query, zap };
}

// Słownik tak, jak leży w bazie (opcje jako JSON w kolumnie).
const wierszSlownika = (klucz, nazwa, opcje, dla_zabiegu, extra = {}) => ({
  klucz, nazwa, ikona: '☕', typ: opcje ? 'wybor' : 'tekst', opcje_json: opcje ? JSON.stringify(opcje) : null,
  dla_zabiegu: dla_zabiegu ? 1 : 0, aktywna: extra.aktywna === 0 ? 0 : 1, kolejnosc: extra.kolejnosc || 10,
});
const SLOWNIK = [
  wierszSlownika('napoj', 'Napój', ['Kawa z mlekiem', 'Herbata zielona'], 0, { kolejnosc: 10 }),
  wierszSlownika('temperatura', 'Temperatura', ['Woli ciepło', 'Woli chłód'], 1, { kolejnosc: 20 }),
  wierszSlownika('uwagi', 'Inne', null, 1, { kolejnosc: 30 }),
  wierszSlownika('stare', 'Nieużywane', ['x'], 0, { kolejnosc: 40, aktywna: 0 }),
];
const WARTOSCI = [
  { id_klienta: '1001', klucz: 'napoj', wartosc: 'Kawa z mlekiem' },
  { id_klienta: '1001', klucz: 'temperatura', wartosc: 'Woli ciepło' },
  { id_klienta: '1001', klucz: 'stare', wartosc: 'cokolwiek' },      // pozycja wyłączona ze słownika
  { id_klienta: '1002', klucz: 'uwagi', wartosc: 'Parkuje od podwórza' },
];

function baza(rola, extra = []) {
  return atrapaBazy([
    [/SELECT rola FROM Użytkownicy/, rola ? [{ rola }] : []],
    [/SELECT .*FROM Preferencje_Slownik WHERE tenant_id = \? ORDER BY/, SLOWNIK],
    [/FROM Klienci_Preferencje WHERE tenant_id = \? AND id_klienta IN/, WARTOSCI],
    [/SELECT imie_nazwisko FROM Klienci/, [{ imie_nazwisko: 'Marta Kowalska' }]],
    ...extra,
  ]);
}
function aplikacja(db) {
  const app = express(); app.use(express.json());
  app.use('/api', M(db, { log: { warn() {}, error() {} }, getSession: () => null }));
  return app;
}
const post = (app, body, pracownik = 'Ola') => request(app).post('/api/preferencje').send({ tenant_id: T, pracownik, ...body });
const zapisy = (db) => db.zap.filter(z => /^\s*(INSERT|UPDATE|DELETE)/i.test(z.sql) && !/CREATE TABLE/i.test(z.sql));

describe('P01 — słownik salonu', () => {
  test('pierwsze wejście zakłada listę startową, drugie już nie dokłada', async () => {
    let wywolan = 0;
    const db = atrapaBazy([
      [/SELECT rola FROM Użytkownicy/, [{ rola: 'manager' }]],
      [/SELECT .*FROM Preferencje_Slownik WHERE tenant_id = \? ORDER BY/, () => (++wywolan === 1 ? [] : SLOWNIK)],
    ]);
    const app = aplikacja(db);
    const { body } = await post(app, { action: 'pref_slownik' });
    expect(body.status).toBe('success');
    const wstawione = db.zap.filter(z => /INSERT IGNORE INTO Preferencje_Slownik/.test(z.sql));
    expect(wstawione).toHaveLength(M.DOMYSLNE.length);
    expect(wstawione.some(z => z.params.includes('napoj'))).toBe(true);

    const przed = db.zap.length;
    await post(app, { action: 'pref_slownik' });
    expect(db.zap.slice(przed).filter(z => /INSERT/i.test(z.sql))).toEqual([]);
  });

  test('lista startowa ma to, co recepcja wpisuje najczęściej, i oznaczone pozycje „przy zabiegu”', () => {
    const klucze = M.DOMYSLNE.map(d => d.klucz);
    expect(klucze).toEqual(expect.arrayContaining(['napoj', 'temperatura', 'rozmowa', 'muzyka', 'kontakt']));
    expect(M.DOMYSLNE.find(d => d.klucz === 'temperatura').dla_zabiegu).toBe(1);
    expect(M.DOMYSLNE.find(d => d.klucz === 'napoj').dla_zabiegu).toBe(0);
    expect(M.DOMYSLNE.find(d => d.klucz === 'osoba').typ).toBe('tekst');
  });

  test('pozycja wyłączona jest niewidoczna dla recepcji, widoczna dla managera', async () => {
    const r = await post(aplikacja(baza('recepcja')), { action: 'pref_slownik' });
    expect(r.body.slownik.map(s => s.klucz)).not.toContain('stare');
    const m = await post(aplikacja(baza('manager')), { action: 'pref_slownik' });
    expect(m.body.slownik.map(s => s.klucz)).toContain('stare');
  });
});

describe('P02 — preferencje klientki', () => {
  test('recepcja dostaje chipsy w kolejności ze słownika, bez pozycji wyłączonych', async () => {
    const { body } = await post(aplikacja(baza('recepcja')), { action: 'pref_klientki', id_klienta: '1001' });
    expect(body.status).toBe('success');
    expect(body.preferencje.map(p => p.klucz)).toEqual(['napoj', 'temperatura']);   // „stare” wypada
    expect(body.preferencje[0]).toMatchObject({ nazwa: 'Napój', wartosc: 'Kawa z mlekiem' });
    expect(body.mozna_edytowac).toBe(true);
  });

  test('kosmetolog widzi tylko to, co dotyczy zabiegu, i nie może edytować', async () => {
    const { body } = await post(aplikacja(baza('kosmetolog')), { action: 'pref_klientki', id_klienta: '1001' }, 'Anna');
    expect(body.preferencje.map(p => p.klucz)).toEqual(['temperatura']);            // napój to nie jego sprawa
    expect(body.mozna_edytowac).toBe(false);
  });

  test('jedno pytanie o wiele klientek (cały dzień w kalendarzu)', async () => {
    const db = baza('recepcja');
    const { body } = await post(aplikacja(db), { action: 'pref_wielu', id_klientow: ['1001', '1002', '1001'] });
    expect(Object.keys(body.preferencje).sort()).toEqual(['1001', '1002']);
    expect(body.preferencje['1002'][0].wartosc).toBe('Parkuje od podwórza');
    expect(db.zap.filter(z => /FROM Klienci_Preferencje WHERE/.test(z.sql))).toHaveLength(1);  // nie pytamy po jednej
  });
});

describe('P03 — zapis wartości', () => {
  test('recepcja zapisuje wybór z listy', async () => {
    const db = baza('recepcja');
    const { body } = await post(aplikacja(db), { action: 'pref_zapisz', id_klienta: '1001', klucz: 'napoj', wartosc: 'Herbata zielona' });
    expect(body.status).toBe('success');
    expect(zapisy(db).some(z => /INSERT INTO Klienci_Preferencje/.test(z.sql) && z.params.includes('Herbata zielona'))).toBe(true);
    expect(zapisy(db).some(z => /ON DUPLICATE KEY UPDATE wartosc/.test(z.sql))).toBe(true);     // jedna wartość na rodzaj
  });

  test('wartość spoza listy jest odrzucana, ale pole tekstowe przyjmuje swobodny wpis', async () => {
    const zly = await post(aplikacja(baza('recepcja')), { action: 'pref_zapisz', id_klienta: '1001', klucz: 'napoj', wartosc: 'Sok z buraka' });
    expect(zly.body.status).toBe('error');
    expect(zly.body.message).toMatch(/nie jest jedną z opcji/);
    const db = baza('recepcja');
    const ok = await post(aplikacja(db), { action: 'pref_zapisz', id_klienta: '1001', klucz: 'uwagi', wartosc: 'Parkuje od podwórza' });
    expect(ok.body.status).toBe('success');
  });

  test('pusta wartość kasuje preferencję, a nie zapisuje pustki', async () => {
    const db = baza('recepcja');
    await post(aplikacja(db), { action: 'pref_zapisz', id_klienta: '1001', klucz: 'napoj', wartosc: '' });
    expect(zapisy(db).some(z => /DELETE FROM Klienci_Preferencje/.test(z.sql))).toBe(true);
    expect(zapisy(db).some(z => /INSERT INTO Klienci_Preferencje/.test(z.sql))).toBe(false);
  });

  test('kosmetolog niczego nie zapisze', async () => {
    const db = baza('kosmetolog');
    const { body } = await post(aplikacja(db), { action: 'pref_zapisz', id_klienta: '1001', klucz: 'napoj', wartosc: 'Kawa z mlekiem' }, 'Anna');
    expect(body.status).toBe('error');
    expect(zapisy(db)).toEqual([]);
  });

  test('klientka spoza kartoteki nie dostaje preferencji', async () => {
    const db = atrapaBazy([
      [/SELECT rola FROM Użytkownicy/, [{ rola: 'recepcja' }]],
      [/SELECT .*FROM Preferencje_Slownik WHERE tenant_id = \? ORDER BY/, SLOWNIK],
      [/SELECT imie_nazwisko FROM Klienci/, []],
    ]);
    const { body } = await post(aplikacja(db), { action: 'pref_zapisz', id_klienta: '9999', klucz: 'napoj', wartosc: 'Kawa z mlekiem' });
    expect(body.status).toBe('error');
    expect(zapisy(db)).toEqual([]);
  });
});

describe('P04 — własne pozycje słownika', () => {
  test('manager dodaje własną preferencję z opcjami', async () => {
    const db = baza('manager', [[/SELECT COALESCE\(MAX\(kolejnosc\)/, [{ k: 50 }]]]);
    const { body } = await post(aplikacja(db), { action: 'pref_slownik_zapisz', klucz: 'szampan', nazwa: 'Szampan przy zabiegu', ikona: '🥂', opcje: ['Tak', 'Nie'], dla_zabiegu: true });
    expect(body.status).toBe('success');
    const ins = zapisy(db).find(z => /INSERT INTO Preferencje_Slownik/.test(z.sql));
    expect(ins.params).toEqual(expect.arrayContaining([T, 'szampan', 'Szampan przy zabiegu', '🥂', 'wybor']));
  });

  test('recepcja nie układa listy, a lista wyboru bez opcji jest odrzucana', async () => {
    const db = baza('recepcja');
    const r = await post(aplikacja(db), { action: 'pref_slownik_zapisz', klucz: 'cos', nazwa: 'Coś', opcje: ['a'] });
    expect(r.body.status).toBe('error');
    expect(zapisy(db)).toEqual([]);
    const m = await post(aplikacja(baza('manager')), { action: 'pref_slownik_zapisz', klucz: 'cos', nazwa: 'Coś', opcje: [] });
    expect(m.body.status).toBe('error');
    expect(m.body.message).toMatch(/przynajmniej jednej opcji/);
  });

  test('klucz jest oczyszczany ze znaków, które psułyby zapytania', async () => {
    const db = baza('manager', [[/SELECT COALESCE\(MAX\(kolejnosc\)/, [{ k: 50 }]]]);
    await post(aplikacja(db), { action: 'pref_slownik_zapisz', klucz: "Na p√ój'; DROP TABLE x;--", nazwa: 'Napój', typ: 'tekst' });
    const ins = zapisy(db).find(z => /INSERT INTO Preferencje_Slownik/.test(z.sql));
    expect(ins.params[1]).toMatch(/^[a-z0-9_]*$/);
  });
});
