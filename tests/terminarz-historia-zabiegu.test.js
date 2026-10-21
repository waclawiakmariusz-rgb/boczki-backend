// Historia → Zabieg (prośba właściciela 21.10.2026): „pokaż zabieg i to tak, żeby można kilka
// naraz wybrać — takie chipsy. Wtedy pokazuj unikalne osoby (nawet jak Ala chodziła 10 zabiegów,
// chcę ją mieć pojedynczą), najlepiej z numerem telefonu na wierzchu".
//
// Rzecz do pilnowania: to jest lista KLIENTEK, nie lista wizyt. Jeden wiersz = jedna osoba,
// z telefonem gotowym do wybrania. Dlatego próby sprawdzają grupowanie i to, czego lista NIE liczy
// (skasowane pomyłki, anulowane pozycje).
//
// RODZAJ PRÓB: kontrakt routera na atrapie bazy (supertest + express).
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
  return { query, getConnection: (cb) => cb(null, { query, beginTransaction: (x) => x(null), commit: (x) => x(null), rollback: (x) => x(null), release: () => {} }), zap };
}

const WIERSZ = (nad = {}) => ({
  id_klienta: '1002', nazwa: 'Ala Wacławiak', telefon: '601 200 302', email: null,
  wizyt: 10, wykonanych: 9, ostatnia: '2026-10-14', najblizsza: '2026-10-24 10:00', zabiegi: 'Endermologia', ...nad,
});
const baza = (wiersze, rola = 'recepcja') => atrapaBazy([
  [/SELECT rola FROM Użytkownicy/, [{ rola }]],
  [/GROUP BY COALESCE\(r\.id_klienta/, wiersze],
]);
const aplikacja = (db) => { const app = express(); app.use(express.json()); app.use('/api', M(db, { hasFeature: (t, k, cb) => cb(true) })); return app; };
const pytaj = (db, body, pracownik = 'Ola') => request(aplikacja(db)).post('/api/terminarz')
  .send({ tenant_id: T, pracownik, action: 'trm_historia_zabiegu', od: '2026-07-23', do: '2027-01-19', ...body });
const zapytanie = (db) => db.zap.find(z => /FROM Term_Rezerwacje r JOIN Term_Pozycje p/.test(z.sql));

describe('czego lista wymaga', () => {
  test('bez zaznaczonego zabiegu nie zgaduje — prosi o wybór', async () => {
    const db = baza([WIERSZ()]);
    const { body } = await pytaj(db, { kategorie: [] });
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/przynajmniej jeden zabieg/i);
    expect(zapytanie(db)).toBeUndefined();                    // nie pytamy bazy o nic
  });

  test('specjalistka nie przegląda cudzych klientek', async () => {
    const db = baza([WIERSZ()], 'kosmetolog');
    const { body } = await pytaj(db, { kategorie: ['Endermologia'] }, 'Anna');
    expect(body.status).toBe('error');
    expect(zapytanie(db)).toBeUndefined();
  });

  test('zakres dłuższy niż 400 dni odrzucony', async () => {
    const db = baza([WIERSZ()]);
    const { body } = await pytaj(db, { kategorie: ['Endermologia'], od: '2024-01-01', do: '2026-12-31' });
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/400 dni/);
  });

  test('kilka zabiegów naraz — wszystkie trafiają do zapytania, bez duplikatów', async () => {
    const db = baza([WIERSZ()]);
    await pytaj(db, { kategorie: ['Endermologia', 'Meltivio', 'Endermologia'] });
    const z = zapytanie(db);
    expect(z.sql).toMatch(/p\.kategoria IN \(\?, \?\)/);      // dwa znaki zapytania, nie trzy
    expect(z.params).toEqual(expect.arrayContaining(['Endermologia', 'Meltivio']));
  });
});

describe('jeden wiersz = jedna osoba', () => {
  test('grupuje po klientce, nie po wizycie', async () => {
    const db = baza([WIERSZ()]);
    const { body } = await pytaj(db, { kategorie: ['Endermologia'] });
    expect(body.status).toBe('success');
    expect(zapytanie(db).sql).toMatch(/GROUP BY COALESCE\(r\.id_klienta, r\.klient_nazwa\)/);
    expect(body.klientki).toHaveLength(1);
    expect(body.klientki[0]).toMatchObject({ nazwa: 'Ala Wacławiak', telefon: '601 200 302', wizyt: 10 });
  });

  test('telefon jest z kartoteki, a gdy jej nie ma — z rezerwacji', async () => {
    const db = baza([WIERSZ()]);
    await pytaj(db, { kategorie: ['Endermologia'] });
    expect(zapytanie(db).sql).toMatch(/COALESCE\(k\.telefon, r\.klient_telefon\)/);
    expect(zapytanie(db).sql).toMatch(/LEFT JOIN Klienci k/);
  });

  test('nie liczy skasowanych pomyłek ani anulowanych pozycji', async () => {
    const db = baza([WIERSZ()]);
    await pytaj(db, { kategorie: ['Endermologia'] });
    expect(zapytanie(db).sql).toMatch(/r\.usunieta = 0/);
    expect(zapytanie(db).sql).toMatch(/p\.stan <> 'anulowana'/);
  });

  test('podsumowanie mówi, z iloma osobami da się skontaktować', async () => {
    const db = baza([
      WIERSZ(),
      WIERSZ({ id_klienta: '1003', nazwa: 'Bez Telefonu', telefon: null, wizyt: 2, wykonanych: 2, najblizsza: null }),
    ]);
    const { body } = await pytaj(db, { kategorie: ['Endermologia'] });
    expect(body.podsumowanie).toMatchObject({ klientek: 2, wizyt: 12, wykonanych: 11, z_telefonem: 1, umowionych: 1 });
  });

  test('najpierw te, które były ostatnio', async () => {
    const db = baza([WIERSZ()]);
    await pytaj(db, { kategorie: ['Endermologia'] });
    expect(zapytanie(db).sql).toMatch(/ORDER BY \(MAX\(CASE WHEN p\.stan IN \('wykonana', 'przerwana'\) THEN r\.start END\)\) DESC/);
  });
});
