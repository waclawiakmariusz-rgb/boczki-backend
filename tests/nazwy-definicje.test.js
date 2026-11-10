// tests/nazwy-definicje.test.js — paczka A audytu terminarza (10.11.2026): jedna reguła pisowni nazw-kluczy.
// Sprawdzamy: normalizację (spacja między imieniem a nazwiskiem zostaje, końce obcinane), odmowę pustych
// definicji (pracownik, usługa bez nazwy/ceny), wykrywanie dubli, zmianę imienia z przepisaniem we wszystkich
// tabelach w transakcji, normalizację listy zespołu w terminarzu, czytelne komunikaty, value= w opcjach frontu.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { mockDbAlways } = require('./helpers/mockDb');
const { normalizujNazwe, taSamaNazwa, nazwaNaLiscie } = require('../routes/nazwy');

const TENANT = 'test-salon-001';
function appSprzedaz(db) { const app = express(); app.use(express.json()); app.use('/api', require('../routes/sprzedaz')(db)); return app; }

describe('nazwy — normalizacja', () => {
  test('spacja między imieniem a nazwiskiem zostaje; końce obcinane; wielokrotne spacje zwijane', () => {
    expect(normalizujNazwe('Aleksandra Cabaj ')).toBe('Aleksandra Cabaj');
    expect(normalizujNazwe('  Anna   Kowalska  ')).toBe('Anna Kowalska');
    expect(normalizujNazwe('Omega ')).toBe('Omega');
    expect(normalizujNazwe(null)).toBe('');
    expect(normalizujNazwe('\tOla\n')).toBe('Ola');
  });
  test('taSamaNazwa i nazwaNaLiscie ignorują spacje końcowe i wielkość liter', () => {
    expect(taSamaNazwa('Omega ', 'omega')).toBe(true);
    expect(taSamaNazwa('Omega', 'Omega Twarz')).toBe(false);
    expect(nazwaNaLiscie('Aleksandra Cabaj', ['Anna', 'Aleksandra Cabaj '])).toBe(true);
    expect(nazwaNaLiscie('Nikt', ['Anna'])).toBe(false);
  });
});

describe('add_sales_def — pracownik', () => {
  const zapytania = (db) => db.query.mock.calls.map(c => String(c[0]));
  test('pusty wpis → błąd z czytelnym komunikatem, bez INSERT', async () => {
    const db = mockDbAlways([]);
    const r = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ action: 'add_sales_def', tenant_id: TENANT, typ: 'Pracownik', wartosc: '   ', pracownik: 'Anna' });
    expect(r.body.status).toBe('error');
    expect(r.body.message).toMatch(/pole jest puste/);
    expect(zapytania(db).some(s => /INSERT INTO Pracownicy/.test(s))).toBe(false);
  });
  test('„Aleksandra Cabaj ” zapisuje się jako „Aleksandra Cabaj”', async () => {
    const db = mockDbAlways([]);
    const r = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ action: 'add_sales_def', tenant_id: TENANT, typ: 'Pracownik', wartosc: 'Aleksandra Cabaj ', pracownik: 'Anna' });
    expect(r.body.status).toBe('success');
    const ins = db.query.mock.calls.find(c => /INSERT INTO Pracownicy/.test(String(c[0])));
    expect(ins[1][2]).toBe('Aleksandra Cabaj');
  });
  test('dubel (różni się tylko spacją/wielkością liter) → odmowa', async () => {
    const db = mockDbAlways([{ imie: 'Anna Kowalska ' }]);
    const r = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ action: 'add_sales_def', tenant_id: TENANT, typ: 'Pracownik', wartosc: 'anna kowalska', pracownik: 'Anna' });
    expect(r.body.status).toBe('error');
    expect(r.body.message).toMatch(/już jest na liście/);
  });
});

describe('add_sales_def / edit_service — usługa', () => {
  test('pusta nazwa → odmowa; brak ceny → odmowa; ujemna → odmowa', async () => {
    const db = mockDbAlways([]);
    const baza = { action: 'add_sales_def', tenant_id: TENANT, typ: 'zabieg', pracownik: 'Anna' };
    let r = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ ...baza, kategoria: ' ', wariant: '', cena: '100' });
    expect(r.body.status).toBe('error'); expect(r.body.message).toMatch(/nazwę usługi/);
    r = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ ...baza, kategoria: 'Omega', wariant: 'Twarz', cena: '' });
    expect(r.body.status).toBe('error'); expect(r.body.message).toMatch(/cenę usługi/);
    r = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ ...baza, kategoria: 'Omega', wariant: 'Twarz', cena: '-5' });
    expect(r.body.status).toBe('error'); expect(r.body.message).toMatch(/ujemna/);
    expect(db.query.mock.calls.some(c => /INSERT INTO Uslugi/.test(String(c[0])))).toBe(false);
  });
  test('„Omega ” / „Twarz, szyja ” zapisuje się bez spacji końcowych, cena 0 dozwolona', async () => {
    const db = mockDbAlways([]);
    const r = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ action: 'add_sales_def', tenant_id: TENANT, typ: 'zabieg', kategoria: 'Omega ', wariant: 'Twarz, szyja ', cena: '0', pracownik: 'Anna' });
    expect(r.body.status).toBe('success');
    const ins = db.query.mock.calls.find(c => /INSERT INTO Uslugi/.test(String(c[0])));
    expect(ins[1].slice(2, 5)).toEqual(['Omega', 'Twarz, szyja', 0]);
  });
  test('dubel usługi → odmowa z podpowiedzią edycji', async () => {
    const db = mockDbAlways([{ kategoria: 'Omega', wariant: 'Twarz' }]);
    const r = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ action: 'add_sales_def', tenant_id: TENANT, typ: 'zabieg', kategoria: 'omega', wariant: 'twarz ', cena: '300', pracownik: 'Anna' });
    expect(r.body.status).toBe('error');
    expect(r.body.message).toMatch(/już jest w cenniku/);
  });
  test('edit_service normalizuje nową i starą nazwę, wymaga ceny', async () => {
    const db = mockDbAlways({ affectedRows: 1 });
    const r = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ action: 'edit_service', tenant_id: TENANT, old_kategoria: 'Omega ', old_wariant: 'Twarz ', new_kategoria: ' Omega', new_wariant: 'Twarz i szyja ', new_cena: '320', pracownik: 'Anna' });
    expect(r.body.status).toBe('success');
    const up = db.query.mock.calls.find(c => /UPDATE Uslugi SET/.test(String(c[0])));
    expect(up[1].slice(0, 3)).toEqual(['Omega', 'Twarz i szyja', 320]);
    expect(up[1].slice(-2)).toEqual(['Omega', 'Twarz']);
    const r2 = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ action: 'edit_service', tenant_id: TENANT, old_kategoria: 'Omega', old_wariant: '', new_kategoria: 'Omega', new_wariant: '', new_cena: '', pracownik: 'Anna' });
    expect(r2.body.status).toBe('error');
  });
});

describe('edit_employee — zmiana imienia z przepisaniem wszędzie', () => {
  /** Atrapa puli z getConnection: zlicza UPDATE-y i odpowiada wg reguł; transakcja = begin/commit/rollback. */
  function atrapaPuli(reguly) {
    const wykonane = [];
    let commit = 0, rollback = 0;
    const conn = {
      query: jest.fn((sql, params, cb) => {
        if (typeof params === 'function') { cb = params; params = []; }
        wykonane.push({ sql: String(sql), params });
        for (const [re, wynik] of reguly) if (re.test(String(sql))) return typeof wynik === 'function' ? wynik(cb, params) : cb(null, wynik);
        return cb(null, { affectedRows: 0 });
      }),
      beginTransaction: (cb) => cb(null), commit: (cb) => { commit++; cb(null); }, rollback: (cb) => { rollback++; cb(); }, release: jest.fn(),
    };
    const db = { query: jest.fn((sql, p, cb) => (typeof p === 'function' ? p : cb)(null, [])), getConnection: (cb) => cb(null, conn) };
    return { db, conn, wykonane, stan: () => ({ commit, rollback }) };
  }
  test('przepisuje imię w tabelach-kluczach w jednej transakcji, raportuje liczbę miejsc, loguje', async () => {
    const { db, conn, wykonane, stan } = atrapaPuli([
      [/SELECT imie FROM Pracownicy WHERE tenant_id = \? AND TRIM\(imie\) = \?/, [{ imie: 'Aleksandra Cabaj ' }]],
      [/SELECT imie FROM Pracownicy WHERE tenant_id = \? AND LOWER/, []],
      [/UPDATE Pracownicy SET imie/, { affectedRows: 1 }],
      [/UPDATE Term_Pozycje SET pracownik/, { affectedRows: 3 }],
      [/UPDATE Term_Zajecia/, { affectedRows: 3 }],
      [/UPDATE Term_Uslugi/, { affectedRows: 1 }],
      [/UPDATE Sprzedaz SET sprzedawca/, { affectedRows: 12 }],
      [/UPDATE FotoSesje/, (cb) => cb(Object.assign(new Error('nie ma'), { code: 'ER_NO_SUCH_TABLE' }))],
    ]);
    const r = await request(appSprzedaz(db)).post('/api/sprzedaz').send({ action: 'edit_employee', tenant_id: TENANT, stare_imie: 'Aleksandra Cabaj ', nowe_imie: ' Aleksandra  Cabaj-Nowak ', pracownik: 'Anna' });
    expect(r.body.status).toBe('success');
    expect(r.body.zmieniono).toEqual({ 'Pracownicy.imie': 1, 'Term_Pozycje.pracownik': 3, 'Term_Zajecia.klucz': 3, 'Term_Uslugi.pracownicy_json': 1, 'Sprzedaz.sprzedawca': 12 });
    expect(r.body.message).toMatch(/Aleksandra Cabaj-Nowak/);
    expect(stan()).toEqual({ commit: 1, rollback: 0 });
    expect(conn.release).toHaveBeenCalledTimes(1);
    const upd = wykonane.filter(w => /^UPDATE /.test(w.sql));
    expect(upd.length).toBeGreaterThanOrEqual(20);
    for (const u of upd) { if (!/Term_Uslugi/.test(u.sql)) expect(u.params[0]).toBe('Aleksandra Cabaj-Nowak'); expect(u.params).toContain(TENANT); }
    const zaj = wykonane.find(w => /UPDATE Term_Zajecia/.test(w.sql));
    expect(zaj.sql).toMatch(/typ_zasobu = 'pracownik'/);
    const js = wykonane.find(w => /UPDATE Term_Uslugi/.test(w.sql));
    expect(js.params[0]).toBe('"Aleksandra Cabaj "'); expect(js.params[1]).toBe('"Aleksandra Cabaj-Nowak"');
  });
  test('nowe imię zajęte przez inną osobę → odmowa; nieznane stare → odmowa; puste nowe → odmowa', async () => {
    const z = atrapaPuli([[/TRIM\(imie\) = \?/, [{ imie: 'Anna' }]], [/LOWER\(TRIM\(imie\)\) = LOWER\(\?\) AND TRIM\(imie\) <> \?/, [{ imie: 'Ola' }]]]);
    let r = await request(appSprzedaz(z.db)).post('/api/sprzedaz').send({ action: 'edit_employee', tenant_id: TENANT, stare_imie: 'Anna', nowe_imie: 'Ola', pracownik: 'Anna' });
    expect(r.body.status).toBe('error'); expect(r.body.message).toMatch(/już jest na liście/); expect(z.stan().commit).toBe(0);
    const n = atrapaPuli([[/TRIM\(imie\) = \?/, []]]);
    r = await request(appSprzedaz(n.db)).post('/api/sprzedaz').send({ action: 'edit_employee', tenant_id: TENANT, stare_imie: 'Nikt', nowe_imie: 'Ktoś', pracownik: 'Anna' });
    expect(r.body.status).toBe('error'); expect(r.body.message).toMatch(/Nie ma pracownika/);
    r = await request(appSprzedaz(n.db)).post('/api/sprzedaz').send({ action: 'edit_employee', tenant_id: TENANT, stare_imie: 'Anna', nowe_imie: '  ', pracownik: 'Anna' });
    expect(r.body.status).toBe('error'); expect(r.body.message).toMatch(/puste/);
  });
  test('błąd SQL w środku → rollback, bez commitu, połączenie zwolnione', async () => {
    const z = atrapaPuli([[/TRIM\(imie\) = \?/, [{ imie: 'Anna' }]], [/LOWER\(TRIM\(imie\)\)/, []], [/UPDATE Term_Grafik/, (cb) => cb(Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }))]]);
    const r = await request(appSprzedaz(z.db)).post('/api/sprzedaz').send({ action: 'edit_employee', tenant_id: TENANT, stare_imie: 'Anna', nowe_imie: 'Anna Nowak', pracownik: 'Anna' });
    expect(r.body.status).toBe('error');
    expect(z.stan()).toEqual({ commit: 0, rollback: 1 });
    expect(z.conn.release).toHaveBeenCalledTimes(1);
  });
});

describe('terminarz — lista zespołu i komunikaty', () => {
  const T = fs.readFileSync(path.join(__dirname, '..', 'routes', 'terminarz.js'), 'utf8');
  const F = fs.readFileSync(path.join(__dirname, '..', 'public', 'terminarz.js'), 'utf8');
  const I = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  test('lista pracowników, zespół i grafik idą przez normalizujNazwe; nie ma już gołego „Nieznany pracownik.”', () => {
    expect(T).toMatch(/r\.map\(x => normalizujNazwe\(x\.imie\)\)/);
    expect(T).toMatch(/imie: normalizujNazwe\(x\.imie\)/);
    expect(T).toMatch(/pracownik: normalizujNazwe\(x\.pracownik\)/);
    expect(T).not.toContain("'Nieznany pracownik.'");
    expect(T).not.toContain("String(d.pracownik_grafik || '').trim()");
    expect(T).toContain('bladNieznanyPracownik(kto)');
    expect(T).toContain('jest oznaczona jako „tylko recepcja”');
    expect(T).toContain('zbudujPozycje(d.pozycje, cfg.katalog, cfg.pracownicy, cfg.zespol)');
  });
  test('ogólny błąd terminarza loguje kod, komunikat SQL i stos; komunikat dla recepcji mówi, co zrobić', () => {
    expect(T).toMatch(/log\.error\('\[terminarz\]', action, `tenant=\$\{tenant\}`/);
    expect(T).toContain('e.sqlMessage');
    expect(T).toContain('Błąd terminarza po stronie serwera (akcja ${action})');
  });
  test('front: każda opcja wyboru osoby ma value= (przeglądarka nie zwija białych znaków)', () => {
    expect(F).not.toMatch(/<option (\$\{[^}]*\})>\$\{esc\([a-zA-Z.]+\)\}<\/option>/);
    expect(F).toContain('<option value="${esc(pp)}" ${pp === kto() ? \'disabled\' : \'\'}>${esc(pp)}</option>');
  });
  test('silnik: brak grafiku tego dnia ma własny opis z instrukcją dla managera', () => {
    const S = require('../routes/terminarz-silnik');
    const w = S.sprawdzKomplet({
      start: '2026-11-12 10:00', pozycje: [{ klucz: 'u1', usluga_id: 'u1', nazwa: 'Omega', czas_min: 60, bufor_przed_min: 0, bufor_po_min: 0, bufor_dotyczy: 'oba', pracownik: 'Iza Izdebska', pracownicyDozwoleni: ['Iza Izdebska'], wymagaGabinetu: false, urzadzeniaDozwolone: [] }],
      dostepnoscPracownikow: { 'Iza Izdebska': [] }, dostepnoscZasobow: {}, zajete: [], klientZajety: [], gabinety: [], urzadzenia: [],
    });
    expect(w.ok).toBe(false);
    const pow = w.problemy[0] || {};
    expect(pow.kod).toBe('GRAFIK');
    expect(pow.mozna_mimo_grafiku).toBe(false);
    expect(pow.brak_grafiku).toBe(true);
    expect(pow.opis).toMatch(/nie ma grafiku na 2026-11-12/);
    expect(pow.opis).toMatch(/Grafik zespołu/);
  });
  test('index.html: formularz definicji obcina spacje i zatrzymuje puste pola; lista ma przycisk „Zmień”; błędy widoczne 15 s', () => {
    expect(I).toContain("p.wartosc = czysc(document.getElementById('def_prac').value);");
    expect(I).toContain('Usługa bez nazwy nie zostanie zapisana');
    expect(I).toContain('Usługa bez ceny nie zostanie zapisana');
    expect(I).toContain('function edytujPracownika(imie)');
    expect(I).toContain("action: 'edit_employee', stare_imie: imie, nowe_imie: czyste");
    expect(I).toContain("czas = czas || (typ === 'error' ? 15000 : typ === 'warning' ? 9000 : 4500);");
  });
  test('server.js rejestruje edit_employee w akcjach sprzedaży', () => {
    const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(S).toMatch(/sprzedazActions = \[[^\]]*'edit_employee'/);
  });
});
