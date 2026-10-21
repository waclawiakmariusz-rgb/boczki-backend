// Skasowanie wizyty wpisanej przez pomyłkę (zgłoszenie właściciela 21.10.2026).
//
// Rzecz do pilnowania: skasowanie NIE jest odwołaniem. Odwołanie opisuje zdarzenie z życia salonu
// i zostaje w statystykach; skasowanie mówi „tej wizyty nie powinno tu być" — ale musi zostawić
// ślad, bo klientka naprawdę była umówiona. Nie wolno nim też zacierać pracy już wykonanej.
//
// RODZAJ PRÓB: kontrakt routera na atrapie bazy (supertest + express) — ten sam wzorzec
// co w tests/terminarz-blokady.test.js.
const request = require('supertest'); const express = require('express');

const T = 'salon-test-001';
const M = require('../routes/terminarz');

function atrapaBazy(odpowiedzi) {
  const zap = [];
  const wykonaj = (sql, params) => {
    zap.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params: params || [] });
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

const REZ = (nad = {}) => ({
  id: 77, tenant_id: T, status: 'potwierdzona', wersja: 3, id_klienta: '1002', klient_nazwa: 'Julia Wiśniewska',
  start_s: '2026-10-24 10:00:00', koniec_s: '2026-10-24 11:00:00', obecnosc: 'oczekiwana', kanal: 'recepcja',
  usunieta: 0, sprzedaz_id: null, ...nad,
});
const POZ = (stan) => ([{ id: 5, kolejnosc: 0, usluga_id: 'U1', kategoria: 'Endermologia', wariant: '1x', cena: 200, czas_min: 60,
  pracownik: 'Anna', start_s: '2026-10-24 10:00:00', koniec_s: '2026-10-24 11:00:00', stan }]);

function baza(rez, poz, rola = 'recepcja') {
  return atrapaBazy([
    [/SELECT rola FROM Użytkownicy/, [{ rola }]],
    [/FROM Term_Rezerwacje r WHERE r\.tenant_id/, rez ? [rez] : []],
    [/FROM Term_Pozycje p LEFT JOIN Term_Zasoby/, poz || []],
    [/SELECT DATE_FORMAT\(NOW\(\)/, [{ t: '2026-10-21 16:00:00' }]],
    // blokada salonu, pod którą idzie kasowanie (ten sam mechanizm co przy zapisie wizyty)
    [/IS_FREE_LOCK/, [{ w: 1 }]],
    [/GET_LOCK/, [{ l: 1 }]],
    [/RELEASE_LOCK/, [{ r: 1 }]],
  ]);
}
const aplikacja = (db) => { const app = express(); app.use(express.json()); app.use('/api', M(db, { hasFeature: (t, k, cb) => cb(true) })); return app; };
const usun = (db, body, pracownik = 'Ola') => request(aplikacja(db)).post('/api/terminarz').send({ tenant_id: T, pracownik, action: 'trm_usun', ...body });
const skasowano = (db) => db.zap.filter(z => /UPDATE Term_Rezerwacje SET status = 'anulowana', usunieta = 1/.test(z.sql));

describe('czego nie wolno skasować', () => {
  test('wizyty rozliczonej w Sprzedaży', async () => {
    const db = baza(REZ({ sprzedaz_id: 'SPRZ-1' }), POZ('zaplanowana'));
    const { body } = await usun(db, { id: 77, wersja: 3, powod: 'pomyłka przy zapisie' });
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/rozliczona/i);
    expect(skasowano(db)).toHaveLength(0);
  });

  test('wizyty wykonanej — od tego jest korekta', async () => {
    const db = baza(REZ(), POZ('wykonana'));
    const { body } = await usun(db, { id: 77, wersja: 3, powod: 'pomyłka przy zapisie' });
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/wykonana|trakcie/i);
    expect(skasowano(db)).toHaveLength(0);
  });

  test('wizyty w trakcie', async () => {
    const db = baza(REZ(), POZ('w_trakcie'));
    const { body } = await usun(db, { id: 77, wersja: 3, powod: 'pomyłka przy zapisie' });
    expect(body.status).toBe('error');
    expect(skasowano(db)).toHaveLength(0);
  });

  test('bez powodu — ślad ma coś znaczyć', async () => {
    for (const powod of [undefined, '', '   ', 'ok']) {
      const db = baza(REZ(), POZ('zaplanowana'));
      const { body } = await usun(db, { id: 77, wersja: 3, powod });
      expect(body.status).toBe('error');
      expect(skasowano(db)).toHaveLength(0);
    }
  });

  test('przy nieaktualnej wersji wizyty', async () => {
    const db = baza(REZ(), POZ('zaplanowana'));
    const { body } = await usun(db, { id: 77, wersja: 1, powod: 'pomyłka przy zapisie' });
    expect(body.status).toBe('error');
    expect(body.code).toBe('WERSJA');
  });

  test('nieznanej wizyty — komunikat, nie wyjątek', async () => {
    const db = baza(null, []);
    const { body } = await usun(db, { id: 999, wersja: 1, powod: 'pomyłka przy zapisie' });
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/Nie znaleziono/i);
  });

  test('specjalistka bez uprawnień operacyjnych nie skasuje', async () => {
    const db = baza(REZ(), POZ('zaplanowana'), 'kosmetolog');
    const { body } = await usun(db, { id: 77, wersja: 3, powod: 'pomyłka przy zapisie' }, 'Anna');
    expect(body.status).toBe('error');
    expect(skasowano(db)).toHaveLength(0);
  });
});

describe('ślad po skasowaniu', () => {
  test('zapisuje kto, kiedy i dlaczego', async () => {
    const db = baza(REZ(), POZ('zaplanowana'));
    const { body } = await usun(db, { id: 77, wersja: 3, powod: 'pomyłka przy zapisie' });
    expect(body.status).toBe('success');
    const u = skasowano(db)[0];
    expect(u).toBeTruthy();
    expect(u.sql).toMatch(/usunieta_kiedy = NOW\(\)/);
    expect(u.params).toEqual(expect.arrayContaining(['Ola', 'pomyłka przy zapisie']));
  });

  test('wpis w historii wizyty ma akcję „usunieto" i powód', async () => {
    const db = baza(REZ(), POZ('zaplanowana'));
    await usun(db, { id: 77, wersja: 3, powod: 'podwójny wpis' });
    const hist = db.zap.find(z => /INSERT INTO Term_Historia/i.test(z.sql));
    expect(hist).toBeTruthy();
    expect(JSON.stringify(hist.params)).toMatch(/usunieto/);
    expect(JSON.stringify(hist.params)).toMatch(/podwójny wpis/);
  });

  test('termin wraca do puli: pozycje anulowane, zajętość wyłączona', async () => {
    const db = baza(REZ(), POZ('zaplanowana'));
    await usun(db, { id: 77, wersja: 3, powod: 'pomyłka przy zapisie' });
    expect(db.zap.some(z => /UPDATE Term_Pozycje SET stan = 'anulowana'/.test(z.sql))).toBe(true);
    expect(db.zap.some(z => /UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = \? AND rezerwacja_id/.test(z.sql))).toBe(true);
  });

  test('powtórne skasowanie nie robi nic drugi raz', async () => {
    const db = baza(REZ({ usunieta: 1 }), POZ('zaplanowana'));
    const { body } = await usun(db, { id: 77, wersja: 3, powod: 'pomyłka przy zapisie' });
    expect(body.status).toBe('success');
    expect(body.powtorzenie).toBe(true);
    expect(skasowano(db)).toHaveLength(0);
  });

  test('odpowiedź mówi wprost, że ślad został zapisany', async () => {
    const db = baza(REZ(), POZ('zaplanowana'));
    const { body } = await usun(db, { id: 77, wersja: 3, powod: 'pomyłka przy zapisie' });
    expect(body.message).toMatch(/Ślad został zapisany/i);
    expect(body.message).toMatch(/Ola/);
  });
});
