// tests/terminarz-blokady.test.js — rezerwacja techniczna w Terminarzu (19.10.2026).
//
// Prośba właścicielki: „Ola chciałaby zrobić rezerwację gabinetu na potrzeby szkolenia albo
// rozmowy kwalifikacyjnej. Obecnie nie ma takiej możliwości". Tabela blokad istniała, ale
// zakładać je mógł wyłącznie manager z Ustawień. Teraz robi to recepcja z poziomu kalendarza.
//
// RODZAJ PRÓB: kontrakt routera na atrapie bazy (supertest + express) — uprawnienia, walidacje,
// ostrzeżenie o wizytach w tym czasie i to, że rezerwacja ich NIE odwołuje.
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

const USTAWIENIA = { tenant_id: T, tryb: 'wewnetrzny', siatka_min: 15, tolerancja_min: 10, horyzont_dni: 90, wyprzedzenie_min: 0,
  godziny_json: JSON.stringify({ 1: [{ od: '08:00', do: '20:00' }], 2: [{ od: '08:00', do: '20:00' }], 3: [{ od: '08:00', do: '20:00' }], 4: [{ od: '08:00', do: '20:00' }], 5: [{ od: '08:00', do: '20:00' }], 6: [], 7: [] }) };
const ZASOBY = [{ id: 1, nazwa: 'Gabinet 1', typ: 'gabinet', archiwalny: 0 }, { id: 2, nazwa: 'Laser', typ: 'urzadzenie', archiwalny: 0 }];
const WIZYTA_W_TYM_CZASIE = [{ id: 10, rezerwacja_id: 5, pracownik: 'Anna', kategoria: 'Endermologia', wariant: '1x', start: '2026-10-22 11:00:00', koniec: '2026-10-22 12:00:00', klient_nazwa: 'Marta Kowalska', status: 'potwierdzona' }];

function baza(rola, extra = []) {
  return atrapaBazy([
    ...extra,
    [/SELECT rola FROM Użytkownicy/, [{ rola }]],
    [/FROM Term_Ustawienia WHERE/, [USTAWIENIA]],
    [/SELECT DATE_FORMAT\(NOW\(\)/, [{ t: '2026-10-19 10:00:00' }]],
    [/SELECT p\.imie FROM Pracownicy/, [{ imie: 'Anna' }, { imie: 'Ola' }]],
    [/FROM Term_Zasoby/, ZASOBY],
    [/FROM Term_Pozycje p\s+JOIN Term_Rezerwacje r/, []],
    [/INSERT INTO Term_Nieobecnosci/, { insertId: 77 }],
    [/SELECT id, typ, opis FROM Term_Nieobecnosci/, [{ id: 77, typ: 'szkolenie', opis: 'Szkolenie Vagheggi' }]],
  ]);
}
function aplikacja(db) { const app = express(); app.use(express.json()); app.use('/api', M(db, { hasFeature: (t, k, cb) => cb(true) })); return app; }
const post = (app, body, pracownik = 'Ola') => request(app).post('/api/terminarz').send({ tenant_id: T, pracownik, ...body });
const DOBRA = { action: 'trm_blokada_zapisz', od: '2026-10-22 11:00', do: '2026-10-22 13:00', typ: 'szkolenie', zasob_id: 1, opis: 'Szkolenie Vagheggi' };
const zapisy = (db) => db.zap.filter(z => /^INSERT INTO Term_Nieobecnosci/.test(z.sql));

describe('B01 — zakładanie rezerwacji technicznej', () => {
  test('recepcja rezerwuje gabinet na szkolenie', async () => {
    const db = baza('recepcja');
    const { body } = await post(aplikacja(db), DOBRA, 'Ola');
    expect(body.status).toBe('success');
    expect(body.id).toBe(77);
    const ins = zapisy(db)[0];
    expect(ins.params).toEqual(expect.arrayContaining([T, null, 1, '2026-10-22 11:00:00', '2026-10-22 13:00:00', 'szkolenie', 'Szkolenie Vagheggi']));
  });

  test('można zarezerwować czas osoby, gabinetu albo obu naraz', async () => {
    const db = baza('recepcja');
    await post(aplikacja(db), { ...DOBRA, osoba: 'Ola', zasob_id: 1 }, 'Ola');
    const ins = zapisy(db)[0];
    expect(ins.params[1]).toBe('Ola');     // osoba
    expect(ins.params[2]).toBe(1);         // zasób
  });

  test('bez osoby i bez gabinetu nie ma czego rezerwować', async () => {
    const db = baza('recepcja');
    const { body } = await post(aplikacja(db), { ...DOBRA, zasob_id: '', osoba: '' }, 'Ola');
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/czyj czas albo który gabinet/);
    expect(zapisy(db)).toEqual([]);
  });

  test('opis jest obowiązkowy — zmiana ma wiedzieć, co to za blokada', async () => {
    const db = baza('recepcja');
    const { body } = await post(aplikacja(db), { ...DOBRA, opis: '   ' }, 'Ola');
    expect(body.status).toBe('error');
    expect(zapisy(db)).toEqual([]);
  });

  test('koniec przed początkiem i rezerwacja dłuższa niż 14 dni są odrzucane', async () => {
    const db = baza('recepcja');
    expect((await post(aplikacja(db), { ...DOBRA, do: '2026-10-22 10:00' }, 'Ola')).body.message).toMatch(/musi być po/);
    const db2 = baza('recepcja');
    expect((await post(aplikacja(db2), { ...DOBRA, do: '2026-11-22 11:00' }, 'Ola')).body.message).toMatch(/14 dni/);
    expect(zapisy(db).concat(zapisy(db2))).toEqual([]);
  });

  test('nieznana osoba i nieznany gabinet nie przechodzą', async () => {
    const db = baza('recepcja');
    expect((await post(aplikacja(db), { ...DOBRA, osoba: 'Ktoś' }, 'Ola')).body.message).toMatch(/Nieznana osoba/);
    const db2 = baza('recepcja');
    expect((await post(aplikacja(db2), { ...DOBRA, zasob_id: 999 }, 'Ola')).body.message).toMatch(/Nieznany gabinet/);
  });

  test('powód spoza listy ląduje jako „inne”, a nie jako urlop czy choroba', async () => {
    const db = baza('recepcja');
    await post(aplikacja(db), { ...DOBRA, typ: 'urlop' }, 'Ola');
    expect(zapisy(db)[0].params[5]).toBe('inne');
  });
});

describe('B02 — wizyty w rezerwowanym czasie', () => {
  const zWizyta = (rola) => baza(rola, [[/FROM Term_Pozycje p\s+JOIN Term_Rezerwacje r/, WIZYTA_W_TYM_CZASIE]]);

  test('najpierw ostrzeżenie z listą wizyt, bez zapisu', async () => {
    const db = zWizyta('recepcja');
    const { body } = await post(aplikacja(db), DOBRA, 'Ola');
    expect(body.status).toBe('success');
    expect(body.wymaga_decyzji).toBe(true);
    expect(body.dotkniete).toHaveLength(1);
    expect(body.message).toMatch(/nie odwołuje/);
    expect(zapisy(db)).toEqual([]);
  });

  test('świadome potwierdzenie zapisuje rezerwację, ale wizyty zostają', async () => {
    const db = zWizyta('recepcja');
    const { body } = await post(aplikacja(db), { ...DOBRA, wymus: true }, 'Ola');
    expect(body.status).toBe('success');
    expect(zapisy(db)).toHaveLength(1);
    expect(db.zap.some(z => /UPDATE Term_Rezerwacje|UPDATE Term_Pozycje/.test(z.sql))).toBe(false);   // żadna wizyta nie jest ruszana
  });

  test('podgląd pokazuje skutki i niczego nie zapisuje', async () => {
    const db = zWizyta('recepcja');
    const { body } = await post(aplikacja(db), { ...DOBRA, podglad: true }, 'Ola');
    expect(body.podglad).toBe(true);
    expect(body.dotkniete).toHaveLength(1);
    expect(zapisy(db)).toEqual([]);
  });
});

describe('B03 — uprawnienia', () => {
  test('kosmetolog nie zakłada rezerwacji', async () => {
    const db = baza('kosmetolog');
    const { body } = await post(aplikacja(db), DOBRA, 'Anna');
    expect(body.status).toBe('error');
    expect(zapisy(db)).toEqual([]);
  });

  test('recepcja zdejmuje rezerwację techniczną', async () => {
    const db = baza('recepcja');
    const { body } = await post(aplikacja(db), { action: 'trm_blokada_usun', id: 77 }, 'Ola');
    expect(body.status).toBe('success');
    expect(db.zap.some(z => /DELETE FROM Term_Nieobecnosci/.test(z.sql))).toBe(true);
  });

  test('urlopu recepcja nie zdejmie — to zostaje u managera', async () => {
    const db = baza('recepcja', [[/SELECT id, typ, opis FROM Term_Nieobecnosci/, [{ id: 80, typ: 'urlop', opis: 'Urlop Anny' }]]]);
    const { body } = await post(aplikacja(db), { action: 'trm_blokada_usun', id: 80 }, 'Ola');
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/manager/);
    expect(db.zap.some(z => /DELETE FROM Term_Nieobecnosci/.test(z.sql))).toBe(false);
  });

  test('manager zdejmuje każdą blokadę', async () => {
    const db = baza('manager', [[/SELECT id, typ, opis FROM Term_Nieobecnosci/, [{ id: 80, typ: 'urlop', opis: 'Urlop Anny' }]]]);
    const { body } = await post(aplikacja(db), { action: 'trm_blokada_usun', id: 80 }, 'Ola');
    expect(body.status).toBe('success');
  });
});

describe('B04 — dodawanie klientki zniknęło z Terminarza', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'terminarz.js'), 'utf8');
  test('kreator wizyty nie zakłada już kartoteki (decyzja właściciela 19.10.2026)', () => {
    expect(src).not.toMatch(/nowaDodajKlienta|nowyKlient/);
    expect(src).not.toMatch(/\+ Dodaj nową klientkę/);
    expect(src).toMatch(/Klientki zakłada się w module <b>Klienci<\/b>/);
  });
  test('obie nowe akcje są zarejestrowane w dyspozytorze', () => {
    expect(M.AKCJE).toContain('trm_blokada_zapisz');
    expect(M.AKCJE).toContain('trm_blokada_usun');
  });
  test('rezerwacja techniczna nie chowa się pod skrótem klawiaturowym', () => {
    expect(src).not.toMatch(/altKey|ctrlKey/);                                   // gest Alt/Ctrl + klik usunięty
    expect(src).toMatch(/⛔ Rezerwacja techniczna<\/button>/);                   // przycisk w nagłówku
    expect(src).toMatch(/To nie wizyta — zarezerwuj czas technicznie/);          // przejście z kreatora wizyty
  });
});
