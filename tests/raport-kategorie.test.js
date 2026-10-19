// tests/raport-kategorie.test.js — zmiana nazwy i przeniesienie kategorii w magazynie (zgłoszenie #8).
//
// Sytuacja z salonu: „może płyny z inwentaryzacji tygodniowej przerzucimy do miesięcznej?
// z tygodnia na tydzień to tam nic nie schodzi” → „ok, to zmienię nazwę kategorii… a no właśnie,
// nie da się”. Kategorię można było tylko dodać albo skasować.
//
// RODZAJ PRÓB: kontrakt routera na atrapie bazy (supertest + express). Pilnujemy przede wszystkim
// tego, co w tym module najłatwiej zepsuć: produkty trzymają PEŁNĄ ŚCIEŻKĘ tekstem, więc każda
// zmiana nazwy musi przepisać i podkategorie, i produkty — inaczej zostają sieroty.
const request = require('supertest'); const express = require('express');

const T = 'salon-test-001';

// Atrapa bazy z obsługą transakcji (getConnection + beginTransaction/commit/rollback).
function atrapaBazy(odpowiedzi) {
  const zap = [];
  const wykonaj = (sql, params, cb) => {
    zap.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params: params || [] });
    for (const [re, w] of odpowiedzi) if (re.test(sql)) return cb(null, typeof w === 'function' ? w(sql, params) : w);
    return cb(null, { affectedRows: 0 });
  };
  const query = (sql, p, cb) => { const c = typeof p === 'function' ? p : cb; const params = typeof p === 'function' ? [] : p; return wykonaj(sql, params, c || (() => {})); };
  const conn = {
    query,
    beginTransaction: (cb) => { zap.push({ sql: 'BEGIN', params: [] }); cb(null); },
    commit: (cb) => { zap.push({ sql: 'COMMIT', params: [] }); cb(null); },
    rollback: (cb) => { zap.push({ sql: 'ROLLBACK', params: [] }); cb(null); },
    release: () => {},
  };
  return { query, getConnection: (cb) => cb(null, conn), zap };
}

const KATEGORIE = [
  { id: 'K-TYG', nazwa: 'Inwentaryzacja Tygodniowa', rodzic_id: '', pelna_sciezka: 'Inwentaryzacja Tygodniowa' },
  { id: 'K-PLY', nazwa: 'Płyny', rodzic_id: '1765353335669', pelna_sciezka: 'Inwentaryzacja Tygodniowa > Płyny' },
  { id: 'K-PLY-A', nazwa: 'Dezynfekcja', rodzic_id: '', pelna_sciezka: 'Inwentaryzacja Tygodniowa > Płyny > Dezynfekcja' },
  { id: 'K-MIE', nazwa: 'Inwentaryzacja miesięczna', rodzic_id: '', pelna_sciezka: 'Inwentaryzacja miesięczna' },
  { id: 'K-MIE-W', nazwa: 'Wosk', rodzic_id: '1766513970060', pelna_sciezka: 'Inwentaryzacja miesięczna > Wosk' },
];

function baza(extra = []) {
  return atrapaBazy([
    ...extra,                                   // dopasowania szczegółowe mają pierwszeństwo nad ogólnymi
    [/SELECT id, nazwa, rodzic_id, pelna_sciezka FROM Raport_Kategorie WHERE tenant_id = \? ORDER BY/, KATEGORIE],
    [/SELECT id, nazwa, pelna_sciezka FROM Raport_Kategorie WHERE tenant_id = \? AND id = \?/, (sql, p) => KATEGORIE.filter(k => k.id === p[1])],
    [/^UPDATE|^DELETE/, { affectedRows: 1 }],
  ]);
}
function aplikacja(db) { const app = express(); app.use(express.json()); app.use('/api', require('../routes/raport')(db)); return app; }
const post = (db, body) => request(aplikacja(db)).post('/api/raport').send({ tenant_id: T, pracownik: 'Ania', ...body });
const sql = (db, re) => db.zap.filter(z => re.test(z.sql));

describe('R01 — zmiana nazwy kategorii', () => {
  test('przepisuje kategorię, jej podkategorie i produkty', async () => {
    const db = baza([[/UPDATE Raport_Magazyn SET kategoria = CONCAT/, { affectedRows: 4 }], [/UPDATE Raport_Magazyn SET kategoria = \? WHERE/, { affectedRows: 7 }]]);
    const { body } = await post(db, { action: 'rap_editCategory', id: 'K-PLY', nazwa: 'Płyny i dezynfekcja' });
    expect(body.status).toBe('success');
    expect(body.sciezka).toBe('Inwentaryzacja Tygodniowa > Płyny i dezynfekcja');
    expect(body.produkty).toBe(11);                                   // 7 w samej kategorii + 4 w podkategoriach
    expect(sql(db, /UPDATE Raport_Kategorie SET nazwa/)).toHaveLength(1);
    expect(sql(db, /UPDATE Raport_Kategorie SET pelna_sciezka = CONCAT/)).toHaveLength(1);
    expect(sql(db, /UPDATE Raport_Magazyn/)).toHaveLength(2);
    expect(db.zap.map(z => z.sql)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));   // wszystko albo nic
  });

  test('podkategorie i produkty dostają tylko nowy początek ścieżki, reszta zostaje', async () => {
    const db = baza();
    await post(db, { action: 'rap_editCategory', id: 'K-PLY', nazwa: 'Płyny i dezynfekcja' });
    const potomkowie = sql(db, /UPDATE Raport_Kategorie SET pelna_sciezka = CONCAT/)[0];
    expect(potomkowie.params[0]).toBe('Inwentaryzacja Tygodniowa > Płyny i dezynfekcja > ');
    expect(potomkowie.params[1]).toBe('Inwentaryzacja Tygodniowa > Płyny > '.length + 1);  // SUBSTRING od końca starego przedrostka
    expect(potomkowie.params[3]).toBe('Inwentaryzacja Tygodniowa > Płyny > %');
  });

  test('pusta nazwa i nazwa ze znakiem „>” są odrzucane przed dotknięciem bazy', async () => {
    for (const nazwa of ['', '   ', 'Płyny > Dezynfekcja']) {
      const db = baza();
      const { body } = await post(db, { action: 'rap_editCategory', id: 'K-PLY', nazwa });
      expect(body.status).toBe('error');
      expect(sql(db, /^UPDATE/)).toEqual([]);
    }
  });

  test('nazwa zajęta przez inną kategorię na tym samym poziomie → błąd, bez zmian', async () => {
    const db = baza();
    const { body } = await post(db, { action: 'rap_editCategory', id: 'K-MIE-W', nazwa: 'Wosk' });
    expect(body.bez_zmian).toBe(true);                                 // ta sama nazwa = nic nie robimy
    const db2 = baza();
    const { body: b2 } = await post(db2, { action: 'rap_editCategory', id: 'K-PLY', parentId: '', nazwa: 'Inwentaryzacja miesięczna' });
    expect(b2.status).toBe('error');
    expect(b2.message).toMatch(/już istnieje/);
    expect(sql(db2, /^UPDATE/)).toEqual([]);
  });
});

describe('R02 — przeniesienie kategorii', () => {
  test('„Płyny” z tygodniowej do miesięcznej — dokładnie sytuacja ze zgłoszenia', async () => {
    const db = baza([[/UPDATE Raport_Magazyn SET kategoria = \? WHERE/, { affectedRows: 7 }]]);
    const { body } = await post(db, { action: 'rap_editCategory', id: 'K-PLY', parentId: 'K-MIE' });
    expect(body.status).toBe('success');
    expect(body.sciezka).toBe('Inwentaryzacja miesięczna > Płyny');
    const wpis = sql(db, /UPDATE Raport_Kategorie SET nazwa/)[0];
    expect(wpis.params[0]).toBe('Płyny');                              // nazwa bez zmian
    expect(wpis.params[1]).toBe('Inwentaryzacja miesięczna > Płyny');
    expect(wpis.params[2]).toBe('K-MIE');                              // przy okazji naprawiamy rodzic_id
  });

  test('na poziom główny: parentId puste', async () => {
    const db = baza();
    const { body } = await post(db, { action: 'rap_editCategory', id: 'K-PLY', parentId: '' });
    expect(body.sciezka).toBe('Płyny');
  });

  test('nie można przenieść kategorii do jej własnej podkategorii ani pod samą siebie', async () => {
    const db = baza();
    const { body } = await post(db, { action: 'rap_editCategory', id: 'K-PLY', parentId: 'K-PLY-A' });
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/własnej podkategorii/);
    const db2 = baza();
    const { body: b2 } = await post(db2, { action: 'rap_editCategory', id: 'K-PLY', parentId: 'K-PLY' });
    expect(b2.status).toBe('error');
    expect(sql(db, /^UPDATE/)).toEqual([]);
    expect(sql(db2, /^UPDATE/)).toEqual([]);
  });

  test('nieznana kategoria albo nieznany rodzic → czytelny błąd', async () => {
    const db = baza();
    expect((await post(db, { action: 'rap_editCategory', id: 'NIE-MA', nazwa: 'X' })).body.message).toMatch(/Nie znaleziono kategorii/);
    expect((await post(db, { action: 'rap_editCategory', id: 'K-PLY', parentId: 'NIE-MA' })).body.message).toMatch(/nadrzędnej/);
  });
});

describe('R03 — kasowanie kategorii nie zostawia sierot', () => {
  const zLiczbami = (dzieci, produkty) => baza([[/SELECT \(SELECT COUNT\(\*\) FROM Raport_Kategorie/, [{ dzieci, produkty }]]]);

  test('kategoria z podkategoriami albo produktami nie znika — wraca wyjaśnienie', async () => {
    const db = zLiczbami(1, 7);
    const { body } = await post(db, { action: 'rap_deleteCategory', id: 'K-PLY' });
    expect(body.status).toBe('error');
    expect(body.code).toBe('NIEPUSTA');
    expect(body.message).toMatch(/1 podkategorię i 7 produktów/);
    expect(sql(db, /^DELETE/)).toEqual([]);
  });

  test('pusta kategoria kasuje się normalnie', async () => {
    const db = zLiczbami(0, 0);
    const { body } = await post(db, { action: 'rap_deleteCategory', id: 'K-PLY' });
    expect(body.status).toBe('success');
    expect(sql(db, /^DELETE FROM Raport_Kategorie/)).toHaveLength(1);
  });

  test('świadome wymuszenie (force) kasuje mimo zawartości', async () => {
    const db = zLiczbami(2, 5);
    const { body } = await post(db, { action: 'rap_deleteCategory', id: 'K-PLY', force: true });
    expect(body.status).toBe('success');
    expect(sql(db, /^DELETE FROM Raport_Kategorie/)).toHaveLength(1);
  });
});
