// tests/terminarz-audyt-b.test.js — paczka B audytu terminarza (10.11.2026): stany wizyt i sprawy.
// #3 cofnięcie „Nieobecna” przywraca pozycje i zajęcia (z kontrolą kolizji); #4 tick tworzy tylko brakujące sprawy E13/E19
// (zamknięte ręcznie nie wracają); #5 anuluj/usun sprawdzają trafienie UPDATE z wersją (rollback przy wyścigu);
// #15 stan pozycji pilnuje stanu sprzed decyzji, obecność w tej samej transakcji.
// RODZAJ PRÓB: kontrakt routera na atrapie bazy (supertest + express) — wzorzec z tests/terminarz-usuwanie.test.js.
const fs = require('fs');
const path = require('path');
const request = require('supertest'); const express = require('express');

const T = 'salon-test-001';
const M = require('../routes/terminarz');

function atrapaBazy(odpowiedzi) {
  const zap = []; let rollbacki = 0, commity = 0;
  const wykonaj = (sql, params) => {
    zap.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params: params || [] });
    for (const [re, w] of odpowiedzi) if (re.test(sql)) return typeof w === 'function' ? w(sql, params) : w;
    return /^\s*UPDATE /.test(String(sql)) ? { affectedRows: 1 } : [];
  };
  const query = (sql, p, cb) => {
    const c = typeof p === 'function' ? p : cb; const params = typeof p === 'function' ? [] : p;
    let w; try { w = wykonaj(sql, params); } catch (e) { return c && c(e); }
    if (c) c(null, w);
  };
  const conn = { query, beginTransaction: (cb) => cb(null), commit: (cb) => { commity++; cb(null); }, rollback: (cb) => { rollbacki++; cb(null); }, release: () => {} };
  return { query, getConnection: (cb) => cb(null, conn), zap, stan: () => ({ commity, rollbacki }) };
}
const REZ = (nad = {}) => ({ id: 77, tenant_id: T, numer: 'EST-0077', status: 'potwierdzona', wersja: 3, id_klienta: '1002', klient_nazwa: 'Julia Wiśniewska',
  start_s: '2026-10-24 10:00:00', koniec_s: '2026-10-24 11:00:00', obecnosc: 'oczekiwana', kanal: 'recepcja', usunieta: 0, sprzedaz_id: null, ...nad });
const POZ = (stan, nad = {}) => ([{ id: 5, kolejnosc: 0, usluga_id: 'U1', kategoria: 'Endermologia', wariant: '1x', cena: 200, czas_min: 60, pracownik: 'Anna',
  start: '2026-10-24 10:00:00', koniec: '2026-10-24 11:00:00', start_s: '2026-10-24 10:00:00', koniec_s: '2026-10-24 11:00:00', stan, start_fakt: null, koniec_fakt: null, ...nad }]);
function baza(rez, poz, dodatkowe = [], rola = 'manager') {
  return atrapaBazy([
    [/SELECT rola FROM Użytkownicy/, [{ rola }]],
    [/FROM Term_Rezerwacje r WHERE r\.tenant_id/, rez ? [rez] : []],
    [/FROM Term_Pozycje p LEFT JOIN Term_Zasoby/, poz || []],
    [/SELECT DATE_FORMAT\(NOW\(\)/, [{ t: '2026-10-21 16:00:00' }]],
    [/IS_FREE_LOCK/, [{ w: 1 }]], [/GET_LOCK/, [{ l: 1 }]], [/RELEASE_LOCK/, [{ r: 1 }]],
    ...dodatkowe,
  ]);
}
const aplikacja = (db) => { const app = express(); app.use(express.json()); app.use('/api', M(db, { hasFeature: (t, k, cb) => cb(true) })); return app; };
const post = (db, body, pracownik = 'Ola') => request(aplikacja(db)).post('/api/terminarz').send({ tenant_id: T, pracownik, ...body });

describe('#3 cofnięcie „Nieobecna”', () => {
  test('nieobecny → przybył: pozycje niewykonane wracają do planu, zajęcia ożywają, E06 zamknięta, komunikat', async () => {
    const db = baza(REZ({ obecnosc: 'nieobecny' }), POZ('niewykonana'), [[/SELECT z2\.rezerwacja_id FROM Term_Zajecia z1/, []]]);
    const { body } = await post(db, { action: 'trm_obecnosc', id: 77, obecnosc: 'przybyl' });
    expect(body.status).toBe('success');
    expect(body.przywrocone).toBe(1);
    expect(body.message).toMatch(/Cofnięto nieobecność: 1 zabieg wrócił do planu/);
    expect(db.zap.some(z => /UPDATE Term_Pozycje SET stan = 'zaplanowana' WHERE tenant_id = \? AND id = \? AND stan = 'niewykonana'/.test(z.sql))).toBe(true);
    expect(db.zap.some(z => /UPDATE Term_Zajecia SET aktywne = 1 WHERE tenant_id = \? AND pozycja_id = \?/.test(z.sql))).toBe(true);
    expect(db.zap.some(z => /UPDATE Term_Sprawy SET/.test(z.sql) && z.params.some(x => String(x).includes('Cofnięto nieobecność')))).toBe(true);
    expect(db.stan()).toEqual({ commity: 1, rollbacki: 0 });
  });
  test('pozycja już rozpoczęta (start_fakt) nie wraca do „zaplanowana”', async () => {
    const db = baza(REZ({ obecnosc: 'nieobecny' }), POZ('niewykonana', { start_fakt: '2026-10-24 10:05:00' }));
    const { body } = await post(db, { action: 'trm_obecnosc', id: 77, obecnosc: 'spozniony' });
    expect(body.status).toBe('success');
    expect(body.przywrocone).toBe(0);
    expect(db.zap.some(z => /SET stan = 'zaplanowana'/.test(z.sql))).toBe(false);
  });
  test('termin w międzyczasie zajęty → odmowa z numerem wizyty, rollback, obecność bez zmian', async () => {
    const db = baza(REZ({ obecnosc: 'nieobecny' }), POZ('niewykonana'), [[/SELECT z2\.rezerwacja_id FROM Term_Zajecia z1/, [{ rezerwacja_id: 91 }]]]);
    const { body } = await post(db, { action: 'trm_obecnosc', id: 77, obecnosc: 'przybyl' });
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/został już zajęty przez inną wizytę \(nr 91\)/);
    expect(db.stan()).toEqual({ commity: 0, rollbacki: 1 });
  });
  test('oznaczenie „nieobecny” działa jak dotąd (pozycje → niewykonana, zajęcia zwolnione)', async () => {
    const db = baza(REZ(), POZ('zaplanowana'));
    const { body } = await post(db, { action: 'trm_obecnosc', id: 77, obecnosc: 'nieobecny' });
    expect(body.status).toBe('success');
    expect(db.zap.some(z => /UPDATE Term_Pozycje SET stan = 'niewykonana'/.test(z.sql))).toBe(true);
    expect(body.przywrocone).toBe(0);
  });
});

describe('#5 anuluj / usun — wersja musi trafić', () => {
  test('anuluj: UPDATE z wersją nie trafia (ktoś przełożył) → błąd WERSJA, rollback, bez wpisu w Logi', async () => {
    const db = baza(REZ(), POZ('zaplanowana'), [[/UPDATE Term_Rezerwacje SET status = 'anulowana', anulowano = NOW\(\)/, { affectedRows: 0 }]]);
    const { body } = await post(db, { action: 'trm_anuluj', id: 77, wersja: 3, powod: 'klientka odwołała', kto_anulowal: 'klient' });
    expect(body.status).toBe('error');
    expect(body.code).toBe('WERSJA');
    expect(body.message).toMatch(/nic nie zapisano/);
    expect(db.stan()).toEqual({ commity: 0, rollbacki: 1 });
    expect(db.zap.some(z => /INSERT INTO Logi/i.test(z.sql) && /ODWOŁANIE/.test(JSON.stringify(z.params)))).toBe(false);
  });
  test('anuluj: UPDATE trafia → sukces jak dotąd', async () => {
    const db = baza(REZ(), POZ('zaplanowana'));
    const { body } = await post(db, { action: 'trm_anuluj', id: 77, wersja: 3, powod: 'klientka odwołała', kto_anulowal: 'klient' });
    expect(body.status).toBe('success');
    expect(db.stan().commity).toBe(1);
  });
  test('usun: UPDATE z wersją nie trafia → błąd WERSJA i rollback', async () => {
    const db = baza(REZ(), POZ('zaplanowana'), [[/UPDATE Term_Rezerwacje SET status = 'anulowana', usunieta = 1/, { affectedRows: 0 }]]);
    const { body } = await post(db, { action: 'trm_usun', id: 77, wersja: 3, powod: 'pomyłka przy zapisie' });
    expect(body.status).toBe('error');
    expect(body.code).toBe('WERSJA');
    expect(db.stan()).toEqual({ commity: 0, rollbacki: 1 });
  });
});

describe('#15 stan pozycji', () => {
  test('UPDATE pilnuje stanu sprzed decyzji; obecność ustawiana w transakcji (przez conn, nie pulę)', async () => {
    const db = baza(REZ(), POZ('zaplanowana'));
    const { body } = await post(db, { action: 'trm_pozycja_stan', id: 77, pozycja_id: 5, stan: 'wykonana' });
    expect(body.status).toBe('success');
    const up = db.zap.find(z => /UPDATE Term_Pozycje SET stan = \?, koniec_fakt = NOW\(\)/.test(z.sql));
    expect(up.sql).toMatch(/AND stan = \?$/);
    expect(up.params.slice(-1)).toEqual(['zaplanowana']);
    const iObec = db.zap.findIndex(z => /UPDATE Term_Rezerwacje SET obecnosc = 'przybyl'/.test(z.sql));
    const iLock = db.zap.findIndex(z => /GET_LOCK/.test(z.sql));
    expect(iObec).toBeGreaterThan(iLock);
  });
  test('stan zmieniony przez drugie stanowisko → odmowa z czytelnym powodem, rollback', async () => {
    const db = baza(REZ(), POZ('zaplanowana'), [[/UPDATE Term_Pozycje SET stan = \? WHERE tenant_id = \? AND id = \? AND stan = \?/, { affectedRows: 0 }]]);
    const { body } = await post(db, { action: 'trm_pozycja_stan', id: 77, pozycja_id: 5, stan: 'niewykonana' });
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/zmienił się w międzyczasie/);
    expect(db.stan().rollbacki).toBe(1);
  });
});

describe('#4 tick: sprawy E13/E19 tylko brakujące', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'terminarz.js'), 'utf8').replace(/\s+/g, ' ');
  test('zapytania pollera wykluczają pozycje/wizyty z istniejącą sprawą (także zamkniętą) i biorą najnowsze', () => {
    expect(src).toMatch(/p\.koniec <= DATE_SUB\(NOW\(\), INTERVAL 15 MINUTE\) AND NOT EXISTS \(SELECT 1 FROM Term_Sprawy s WHERE s\.tenant_id = p\.tenant_id AND s\.klucz_dedup = CONCAT\('E13:poz:', p\.id\)\) ORDER BY p\.koniec DESC LIMIT 200/);
    expect(src).toMatch(/AND NOT EXISTS \(SELECT 1 FROM Term_Sprawy s WHERE s\.tenant_id = r\.tenant_id AND s\.klucz_dedup = CONCAT\('E19:rez:', r\.id\)\) ORDER BY r\.koniec DESC LIMIT 200/);
  });
});
