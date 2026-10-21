// „1. wizyta" — zgłoszenie #12b (Gosia, recepcja): system ma sam wiedzieć, czy klientka miała już
// dany zabieg, i sam przesunąć oznaczenie, gdy nie przyjdzie na pierwszy termin.
//
// Sedno rozwiązania: NIC nie zapisujemy. Liczymy przy każdym wyświetleniu z dwóch źródeł —
// wizyt WYKONANYCH w Terminarzu i sprzedaży tego zabiegu. Dlatego nieobecność (wizyta nie jest
// „wykonana") automatycznie zostawia oznaczenie na kolejnym terminie.
const terminarz = require('../routes/terminarz');

// Atrapa bazy: oddaje wiersze dobrane po treści zapytania, zapisuje każde SQL do podglądu.
function atrapaBazy({ wykonane = [], sprzedaz = [] } = {}) {
  const zap = [];
  return {
    zap,
    query(sql, params, cb) {
      const c = typeof params === 'function' ? params : cb;
      const p = typeof params === 'function' ? [] : params;
      const s = String(sql);
      zap.push({ sql: s, params: p });
      if (/FROM Term_Pozycje p JOIN Term_Rezerwacje/i.test(s)) return c(null, wykonane);
      if (/FROM Sprzedaz/i.test(s)) return c(null, sprzedaz);
      if (/^SELECT/i.test(s)) return c(null, []);
      return c(null, { affectedRows: 0 });
    },
  };
}

const modul = (db) => terminarz(db, { log: { info() {}, warn() {}, error() {} } });
// Moduł przy starcie sprawdza schematy (CREATE TABLE), więc w zapytaniach szukamy tylko SELECT-ów.
const czySelect = (z) => /^\s*SELECT/i.test(z.sql);
const selekt = (db, re) => db.zap.filter(czySelect).find(z => re.test(z.sql));
const historia = (db) => modul(db)._historiaZabiegow || null;

describe('historia zabiegu (źródła prawdy)', () => {
  test('zapytanie pyta OBA źródła: wizyty wykonane i sprzedaż', async () => {
    const db = atrapaBazy({});
    const m = modul(db);
    await m._historiaZabiegow('salon', 'K1', ['Endermologia']);
    const sql = db.zap.filter(czySelect).map(z => z.sql).join(' ');
    expect(sql).toMatch(/Term_Pozycje/);
    expect(sql).toMatch(/Sprzedaz/);
  });

  test('liczy tylko wizyty WYKONANE — umówiona czy odwołana się nie liczy', async () => {
    const db = atrapaBazy({});
    await modul(db)._historiaZabiegow('salon', 'K1', ['Endermologia']);
    const zapTerm = selekt(db, /Term_Pozycje/);
    expect(zapTerm.sql).toMatch(/p\.stan = 'wykonana'/);
  });

  test('ze sprzedaży pomija zwroty', async () => {
    const db = atrapaBazy({});
    await modul(db)._historiaZabiegow('salon', 'K1', ['Endermologia']);
    const zapSprz = selekt(db, /FROM Sprzedaz/);
    expect(zapSprz.sql).toMatch(/zwrot_do_id IS NULL/);
  });

  test('zero wizyt i zero sprzedaży = pierwsza wizyta', async () => {
    const h = await modul(atrapaBazy({}))._historiaZabiegow('salon', 'K1', ['Masaż']);
    expect(h['Masaż']).toEqual({ ile: 0, ostatnia: null, zrodlo: null });
  });

  test('sama sprzedaż sprzed Terminarza wystarczy, żeby NIE była to pierwsza wizyta', async () => {
    const db = atrapaBazy({ sprzedaz: [{ kat: 'Endermologia', ile: 3, ostatnia: '2026-09-04' }] });
    const h = await modul(db)._historiaZabiegow('salon', 'K1', ['Endermologia']);
    expect(h['Endermologia'].ile).toBe(3);
    expect(h['Endermologia'].zrodlo).toBe('sprzedaz');
  });

  test('oba źródła sumują się, data bierze się z nowszego', async () => {
    const db = atrapaBazy({
      wykonane: [{ kat: 'Endermologia', ile: 2, ostatnia: '2026-10-10' }],
      sprzedaz: [{ kat: 'Endermologia', ile: 3, ostatnia: '2026-09-04' }],
    });
    const h = await modul(db)._historiaZabiegow('salon', 'K1', ['Endermologia']);
    expect(h['Endermologia'].ile).toBe(5);
    expect(h['Endermologia'].ostatnia).toBe('2026-10-10');
    expect(h['Endermologia'].zrodlo).toBe('terminarz');
  });

  test('pyta tylko o wskazane kategorie i tylko o tę klientkę', async () => {
    const db = atrapaBazy({});
    await modul(db)._historiaZabiegow('salon', 'K7', ['Endermologia', 'Masaż']);
    const z = selekt(db, /Term_Pozycje/);
    expect(z.params).toEqual(expect.arrayContaining(['salon', 'K7', 'Endermologia', 'Masaż']));
  });

  test('bez klientki albo bez kategorii nie rusza bazy', async () => {
    const db = atrapaBazy({});
    const m = modul(db);
    expect(await m._historiaZabiegow('salon', '', ['Endermologia'])).toEqual({ Endermologia: { ile: 0, ostatnia: null, zrodlo: null } });
    expect(await m._historiaZabiegow('salon', 'K1', [])).toEqual({});
    expect(db.zap.filter(z => czySelect(z) && /(Term_Pozycje|FROM Sprzedaz)/.test(z.sql)).length).toBe(0);
  });
});

describe('oznaczanie dnia', () => {
  const dzien = (pozycje) => ([{ id: 1, id_klienta: 'K1', pozycje }]);

  test('wizyta bez historii dostaje flagę pierwsza', async () => {
    const rez = dzien([{ kategoria: 'Masaż' }]);
    await modul(atrapaBazy({}))._oznaczPierwszeWizyty('salon', rez, '2026-10-22');
    expect(rez[0].pozycje[0].pierwsza).toBe(true);
  });

  test('wizyta po wcześniejszym zabiegu NIE jest pierwsza', async () => {
    const rez = dzien([{ kategoria: 'Endermologia' }]);
    await modul(atrapaBazy({ wykonane: [{ k: 'K1', kat: 'Endermologia' }] }))._oznaczPierwszeWizyty('salon', rez, '2026-10-22');
    expect(rez[0].pozycje[0].pierwsza).toBe(false);
  });

  test('liczy się stan PRZED tym dniem — nieobecność na wcześniejszym terminie nie kasuje oznaczenia', async () => {
    const db = atrapaBazy({});
    const rez = dzien([{ kategoria: 'Endermologia' }]);
    await modul(db)._oznaczPierwszeWizyty('salon', rez, '2026-10-22');
    const z = selekt(db, /Term_Pozycje/);
    expect(z.sql).toMatch(/r\.start < \?/);
    expect(z.params).toContain('2026-10-22 00:00:00');
    expect(rez[0].pozycje[0].pierwsza).toBe(true);     // poprzedni termin nie był wykonany → nadal pierwsza
  });

  test('awaria zapytania nie psuje widoku dnia — po prostu brak oznaczeń', async () => {
    const db = { query(sql, params, cb) { (typeof params === 'function' ? params : cb)(new Error('baza padła')); } };
    const rez = dzien([{ kategoria: 'Endermologia' }]);
    await expect(modul(db)._oznaczPierwszeWizyty('salon', rez, '2026-10-22')).resolves.toBeUndefined();
    expect(rez[0].pozycje[0].pierwsza).toBeUndefined();
  });

  test('wizyta bez klientki (rezerwacja techniczna) jest pomijana', async () => {
    const rez = [{ id: 2, id_klienta: null, pozycje: [{ kategoria: 'Endermologia' }] }];
    await modul(atrapaBazy({}))._oznaczPierwszeWizyty('salon', rez, '2026-10-22');
    expect(rez[0].pozycje[0].pierwsza).toBeUndefined();
  });
});
