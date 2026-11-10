// tests/terminarz-audyt-e.test.js — paczka E audytu terminarza (10.11.2026): hold, trzy instancje, start serwera.
// #14 odwołanie trzymanego terminu unieważnia link do zadatku i zamyka sprawę E41; #16 wygasanie holdu pisze ślad
// tylko w instancji, która naprawdę go zamknęła; #17 blokada migracji zakupów nie wstrzymuje rdzenia; #13b ALTER
// przy starcie tylko dla brakującej kolumny.
const fs = require('fs');
const path = require('path');
const request = require('supertest'); const express = require('express');

const T = 'salon-test-001';
const M = require('../routes/terminarz');
const bezCR = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const S = bezCR(path.join(__dirname, '..', 'routes', 'terminarz.js'));

function atrapaBazy(odpowiedzi) {
  const zap = []; let commity = 0, rollbacki = 0;
  const wykonaj = (sql, params) => {
    zap.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params: params || [] });
    for (const [re, w] of odpowiedzi) if (re.test(String(sql))) return typeof w === 'function' ? w(sql, params) : w;
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
const REZ = (nad = {}) => ({ id: 77, tenant_id: T, numer: 'EST-0077', status: 'potwierdzona', wersja: 3, id_klienta: null, klient_nazwa: 'Julia Wiśniewska', klient_telefon: '500100200',
  start_s: '2026-11-20 10:00:00', koniec_s: '2026-11-20 11:00:00', obecnosc: 'oczekiwana', kanal: 'telefon', usunieta: 0, sprzedaz_id: null, hold_do: '2026-11-18 12:00:00', ...nad });
const POZ = (stan) => ([{ id: 5, kolejnosc: 0, usluga_id: 'U1', kategoria: 'Endermologia', wariant: '1x', cena: 200, czas_min: 60, pracownik: 'Anna',
  start: '2026-11-20 10:00:00', koniec: '2026-11-20 11:00:00', start_s: '2026-11-20 10:00:00', koniec_s: '2026-11-20 11:00:00', stan, start_fakt: null, koniec_fakt: null }]);
function baza(rez, poz, dodatkowe = []) {
  return atrapaBazy([
    [/SELECT rola FROM Użytkownicy/, [{ rola: 'manager' }]],
    [/FROM Term_Rezerwacje r WHERE r\.tenant_id/, rez ? [rez] : []],
    [/FROM Term_Pozycje p LEFT JOIN Term_Zasoby/, poz || []],
    [/SELECT DATE_FORMAT\(NOW\(\)/, [{ t: '2026-11-10 16:00:00' }]],
    [/IS_FREE_LOCK/, [{ w: 1 }]], [/GET_LOCK/, [{ l: 1 }]], [/RELEASE_LOCK/, [{ r: 1 }]],
    ...dodatkowe,
  ]);
}
const aplikacja = (db) => { const a = express(); a.use(express.json()); a.use('/api', M(db, { hasFeature: (t, k, cb) => cb(true) })); return a; };
const post = (db, body) => request(aplikacja(db)).post('/api/terminarz').send({ tenant_id: T, pracownik: 'Ola', ...body });

describe('#14 odwołanie trzymanego terminu (hold)', () => {
  test('idzie drogą zakończenia holdu: link do zadatku unieważniony, sprawa E41 zamknięta, komunikat dla recepcji', async () => {
    const db = baza(REZ({ status: 'do_wplaty' }), POZ('zaplanowana'));
    const { body } = await post(db, { action: 'trm_anuluj', id: 77, wersja: 3, powod: 'klientka nie wpłaciła', kto_anulowal: 'salon' });
    expect(body.status).toBe('success');
    expect(body.message).toMatch(/Link do zadatku przestał działać/);
    expect(db.zap.some(z => /UPDATE ZgodyPlatnosci SET status = 'ANULOWANA'/.test(z.sql))).toBe(true);
    expect(db.zap.some(z => /UPDATE Term_Sprawy SET/.test(z.sql) && z.params.some(x => /Termin zwolniony ręcznie/.test(String(x))))).toBe(true);
    expect(db.zap.some(z => /INSERT INTO Logi/i.test(z.sql) && /ODWOŁANIE/.test(JSON.stringify(z.params)))).toBe(true);
  });
  test('zwykła wizyta (nie hold) nie dotyka ZgodyPlatnosci', async () => {
    const db = baza(REZ(), POZ('zaplanowana'));
    const { body } = await post(db, { action: 'trm_anuluj', id: 77, wersja: 3, powod: 'klientka odwołała', kto_anulowal: 'klient' });
    expect(body.status).toBe('success');
    expect(db.zap.some(z => /UPDATE ZgodyPlatnosci/.test(z.sql))).toBe(false);
  });
  test('hold już zamknięty przez inną instancję (UPDATE nie trafia) → brak śladu w ZgodyPlatnosci i historii', async () => {
    const db = baza(REZ({ status: 'do_wplaty' }), POZ('zaplanowana'), [[/UPDATE Term_Rezerwacje SET status = \?, anulowano = NOW\(\)/, { affectedRows: 0 }]]);
    const { body } = await post(db, { action: 'trm_anuluj', id: 77, wersja: 3, powod: 'zwolnienie', kto_anulowal: 'salon' });
    expect(body.status).toBe('success');
    expect(db.zap.some(z => /UPDATE ZgodyPlatnosci/.test(z.sql))).toBe(false);
    expect(db.zap.some(z => /INSERT INTO Term_Historia/.test(z.sql))).toBe(false);
  });
});

describe('#16/#17/#13b — kod', () => {
  test('#16 zakończenie holdu zwraca, czy to ta instancja zamknęła; poller pomija pozostałe', () => {
    expect(S).toContain("if (!up || !up.affectedRows) return false;   // inna instancja albo recepcja już zamknęła ten hold");
    expect(S).toContain('if (!zamkniete) return false;');
    expect(S).toContain("if (!await zakonczHold(h.tenant_id, rez, 'wygasla', 'System', 'brak wpłaty zadatku w terminie')) continue;");
  });
  test('#17 blokada migracji ewidencji dotyczy tylko salonów z integracją zakupów', () => {
    expect(S).toContain("if (wolna[0] && Number(wolna[0].w) === 0 && await integracjaZakupow(tenant)) throw new BladUzytkownika('Trwa migracja schematu ewidencji zakupów");
  });
  test('#13b migracja kolumn pyta schemat przed ALTER-em', () => {
    expect(S).toContain('SELECT 1 AS jest FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1');
    expect(S).toContain('if (!eS && rows && rows.length) return;   // kolumna już jest — nic nie robimy');
  });
  test('#13 ogólny błąd terminarza nadal loguje kod, SQL i stos (paczka A), a odpowiedź mówi, co zrobić', () => {
    expect(S).toContain('e.sqlMessage');
    expect(S).toContain('Błąd terminarza po stronie serwera (akcja ${action})');
  });
});
