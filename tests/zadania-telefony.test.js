// tests/zadania-telefony.test.js — Zadania: rodzaj TELEFON, kontakt, wynik rozmowy, „oddzwonić później” (26.10.2026).
// Baza udawana wg treści SQL (moduł robi CREATE/ALTER przy ładowaniu); sesje z pamięci modułu sessions (bez bazy).
const request = require('supertest');
const express = require('express');
const { createSession } = require('../routes/sessions');

const SALON_A = 'audyt-zad-a-0001', SALON_B = 'audyt-zad-b-0002';
const TOKEN_OLA = createSession(SALON_A, 'Ola');

function dbWg(odpowiedzi) {
    const query = jest.fn((sql, params, cb) => {
        const callback = typeof params === 'function' ? params : cb;
        const p = typeof params === 'function' ? [] : params;
        const traf = odpowiedzi.find(o => o.re.test(String(sql)));
        const wynik = traf ? (typeof traf.rows === 'function' ? traf.rows(p, String(sql)) : traf.rows) : { affectedRows: 1 };
        if (callback) callback(null, wynik);
    });
    return { query, _sql: (re) => query.mock.calls.filter(c => re.test(String(c[0]))) };
}
function app(db) { const a = express(); a.use(express.json()); a.use('/api', require('../routes/zadania')(db)); return a; }
const post = (db, body, token = TOKEN_OLA) => request(app(db)).post('/api/zadania').set('x-session-token', token).send({ tenant_id: SALON_A, ...body });
const ROLA_RECEPCJA = { re: /SELECT rola FROM Użytkownicy/, rows: [{ rola: 'recepcja' }] };

describe('add/edit — rodzaj, numer i adresat rozmowy', () => {
    test('TELEFON z klientką: numer walidowany, nazwa adresata z bazy TEGO salonu (nie z żądania), kolumny w INSERT', async () => {
        const db = dbWg([ROLA_RECEPCJA, { re: /SELECT imie_nazwisko AS nazwa FROM Klienci WHERE tenant_id = \? AND id_klienta = \?/, rows: (p) => p[0] === SALON_A && p[1] === 'K-1' ? [{ nazwa: 'Anna Testowa' }] : [] }]);
        const res = await post(db, { action: 'add', tytul: 'Potwierdzić termin', przypisani: ['Ola'], utworzone_przez: 'Ola', rodzaj: 'TELEFON', telefon: '512 000 889', kontakt_typ: 'KLIENT', kontakt_id: 'K-1', kontakt_nazwa: 'PODSTAWIONA' });
        expect(res.body.status).toBe('success');
        const ins = db._sql(/INSERT INTO Zadania \(/)[0];
        expect(ins[0]).toMatch(/rodzaj, telefon, kontakt_typ, kontakt_id, kontakt_nazwa/);
        expect(ins[1].slice(-5)).toEqual(['TELEFON', '512 000 889', 'KLIENT', 'K-1', 'Anna Testowa']);
    });
    test('klientka z INNEGO salonu → błąd, bez INSERT', async () => {
        const db = dbWg([ROLA_RECEPCJA, { re: /FROM Klienci WHERE tenant_id = \? AND id_klienta = \?/, rows: [] }]);
        const res = await post(db, { action: 'add', tytul: 'x', przypisani: ['Ola'], utworzone_przez: 'Ola', rodzaj: 'TELEFON', kontakt_typ: 'KLIENT', kontakt_id: 'K-obcy' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/Nie znaleziono klientki/);
        expect(db._sql(/INSERT INTO Zadania \(/).length).toBe(0);
    });
    test('zły numer → błąd; rodzaj spoza listy → DO_ZROBIENIA bez numeru i kontaktu', async () => {
        let res = await post(dbWg([ROLA_RECEPCJA]), { action: 'add', tytul: 'x', przypisani: ['Ola'], utworzone_przez: 'Ola', rodzaj: 'TELEFON', telefon: 'abc<script>' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/Numer telefonu/);
        const db = dbWg([ROLA_RECEPCJA]);
        res = await post(db, { action: 'add', tytul: 'x', przypisani: ['Ola'], utworzone_przez: 'Ola', rodzaj: 'HACK', telefon: '123', kontakt_typ: 'LEAD', kontakt_id: 'L-1' });
        expect(res.body.status).toBe('success');
        expect(db._sql(/INSERT INTO Zadania \(/)[0][1].slice(-5)).toEqual(['DO_ZROBIENIA', null, null, null, null]);
    });
    test('edit zapisuje nowe kolumny i weryfikuje lead w tym salonie', async () => {
        const db = dbWg([ROLA_RECEPCJA, { re: /FROM Leady WHERE tenant_id = \? AND id = \? LIMIT 1/, rows: (p) => p[0] === SALON_A ? [{ nazwa: 'Lead Jesień', kampania: 'Jesień' }] : [] }]);
        const res = await post(db, { action: 'edit', id: 'Z-1', tytul: 'Lead 104', przypisani: ['Ola'], kto_edytuje: 'Ola', rodzaj: 'TELEFON', telefon: '+48 600 000 000', kontakt_typ: 'LEAD', kontakt_id: 'L-1' });
        expect(res.body.status).toBe('success');
        const upd = db._sql(/UPDATE Zadania SET tytul/)[0];
        expect(upd[0]).toMatch(/rodzaj = \?, telefon = \?, kontakt_typ = \?, kontakt_id = \?, kontakt_nazwa = \?/);
        expect(upd[1].slice(-7)).toEqual(['TELEFON', '+48 600 000 000', 'LEAD', 'L-1', 'Lead Jesień', SALON_A, 'Z-1']);
    });
});

describe('wynik_rozmowy — skutki dla zadania i leada, autor z sesji', () => {
    const zadanie = (over) => ({ re: /SELECT id, status, rodzaj, kontakt_typ, kontakt_id FROM Zadania/, rows: [Object.assign({ id: 'Z-1', status: 'AKTYWNE', rodzaj: 'TELEFON', kontakt_typ: 'LEAD', kontakt_id: 'L-1' }, over)] });
    test('UMOWIONA: zadanie WYKONANE, lead nowy → umowiony (tylko w tym salonie), historia z autorem z sesji', async () => {
        const db = dbWg([zadanie(), { re: /SELECT status FROM Leady/, rows: [{ status: 'nowy' }] }]);
        const res = await post(db, { action: 'wynik_rozmowy', id: 'Z-1', wynik: 'UMOWIONA', notatka: 'Pytała o cenę', kto: 'Ktoś inny' });
        expect(res.body).toMatchObject({ status: 'success', zadanie_zakonczone: true, lead_status_przed: 'nowy', lead_status_po: 'umowiony' });
        const zak = db._sql(/UPDATE Zadania SET status = 'WYKONANE'/)[0];
        expect(zak[1]).toEqual(['Ola', SALON_A, 'Z-1']);
        const lead = db._sql(/UPDATE Leady SET status = \?/)[0];
        expect(lead[1]).toEqual(['umowiony', SALON_A, 'L-1', 'nowy']);
        const hist = db._sql(/INSERT INTO Zadania_Historia/)[0];
        expect(hist[1].slice(3)).toEqual(['UMOWIONA', 'Pytała o cenę', null, 'nowy', 'umowiony', 'Ola']);   // autor „Ola” z sesji, nie „Ktoś inny”
    });
    test('NIE_ODEBRALA: zadanie aktywne, termin przełożony, lead bez zmiany statusu (tylko licznik prób)', async () => {
        const db = dbWg([zadanie(), { re: /SELECT status FROM Leady/, rows: [{ status: 'kontakt' }] }]);
        const res = await post(db, { action: 'wynik_rozmowy', id: 'Z-1', wynik: 'NIE_ODEBRALA', kolejny_termin: '2026-10-27T10:00' });
        expect(res.body).toMatchObject({ status: 'success', zadanie_zakonczone: false, kolejny_termin: '2026-10-27 10:00:00', lead_status_po: 'kontakt' });
        expect(db._sql(/UPDATE Zadania SET status = 'WYKONANE'/).length).toBe(0);
        expect(db._sql(/UPDATE Zadania SET deadline = \?/)[0][1]).toEqual(['2026-10-27 10:00:00', SALON_A, 'Z-1']);
        expect(db._sql(/UPDATE Leady SET status = \?/).length).toBe(0);
        expect(db._sql(/UPDATE Leady SET liczba_polaczen/)[0][1]).toEqual([SALON_A, 'L-1']);
    });
    test('NIE_ZAINTERESOWANA przy leadzie „klient” → zadanie zakończone, status leada NIE zmieniony', async () => {
        const db = dbWg([zadanie(), { re: /SELECT status FROM Leady/, rows: [{ status: 'klient' }] }]);
        const res = await post(db, { action: 'wynik_rozmowy', id: 'Z-1', wynik: 'NIE_ZAINTERESOWANA' });
        expect(res.body).toMatchObject({ status: 'success', zadanie_zakonczone: true, lead_status_przed: 'klient', lead_status_po: 'klient' });
        expect(db._sql(/UPDATE Leady SET status = \?/).length).toBe(0);
    });
    test('powtórny zapis na zakończonym zadaniu → błąd bez duplikatu; zadanie DO_ZROBIENIA → błąd; zły wynik → błąd', async () => {
        let db = dbWg([zadanie({ status: 'WYKONANE' })]);
        let res = await post(db, { action: 'wynik_rozmowy', id: 'Z-1', wynik: 'UMOWIONA' });
        expect(res.body.status).toBe('error'); expect(res.body.message).toMatch(/już zapisany/);
        expect(db._sql(/INSERT INTO Zadania_Historia/).length).toBe(0);
        db = dbWg([zadanie({ rodzaj: 'DO_ZROBIENIA' })]);
        res = await post(db, { action: 'wynik_rozmowy', id: 'Z-1', wynik: 'UMOWIONA' });
        expect(res.body.message).toMatch(/tylko dla zadania typu Telefon/);
        res = await post(dbWg([zadanie()]), { action: 'wynik_rozmowy', id: 'Z-1', wynik: 'COKOLWIEK' });
        expect(res.body.message).toMatch(/Wybierz wynik/);
    });
    test('zadanie zakończone, ale UPDATE leada nie trafił (cudzy/usunięty lead) → status error z informacją, bez fałszywego sukcesu', async () => {
        const db = dbWg([zadanie(), { re: /SELECT status FROM Leady/, rows: [] }]);
        const res = await post(db, { action: 'wynik_rozmowy', id: 'Z-1', wynik: 'UMOWIONA' });
        expect(res.body.status).toBe('error');
        expect(res.body.zadanie_zakonczone).toBe(true);
        expect(res.body.message).toMatch(/nie udało się zmienić statusu leada/);
    });
});

describe('przeloz / historia / kontakt_szukaj', () => {
    test('przeloz: poprawny termin → UPDATE tylko aktywnego, nie-szablonu + wpis TERMIN z autorem z sesji; zły termin → błąd', async () => {
        const db = dbWg([]);
        let res = await post(db, { action: 'przeloz', id: 'Z-1', deadline: '2026-10-26T14:00' });
        expect(res.body).toMatchObject({ status: 'success', deadline: '2026-10-26 14:00:00' });
        expect(db._sql(/UPDATE Zadania SET deadline = \? WHERE tenant_id = \? AND id = \? AND status = 'AKTYWNE' AND is_szablon = 0/)[0][1]).toEqual(['2026-10-26 14:00:00', SALON_A, 'Z-1']);
        expect(db._sql(/INSERT INTO Zadania_Historia/)[0][0]).toMatch(/'TERMIN'/); expect(db._sql(/INSERT INTO Zadania_Historia/)[0][1].slice(3)).toEqual(['2026-10-26 14:00:00', 'Ola']);
        res = await post(dbWg([]), { action: 'przeloz', id: 'Z-1', deadline: "1; DROP TABLE Zadania" });
        expect(res.body.status).toBe('error');
    });
    test('historia i kontakt_szukaj zawsze z tenant_id; wyszukiwanie min. 2 znaki', async () => {
        let db = dbWg([{ re: /FROM Zadania_Historia/, rows: [{ typ: 'WYNIK', wynik: 'NIE_ODEBRALA', autor: 'Ola' }] }]);
        let res = await post(db, { action: 'historia', id: 'Z-1' });
        expect(res.body.data).toHaveLength(1);
        expect(db._sql(/FROM Zadania_Historia/)[0][1]).toEqual([SALON_A, 'Z-1']);
        db = dbWg([{ re: /FROM Klienci WHERE tenant_id = \? AND \(imie_nazwisko LIKE/, rows: [{ id: 'K-1', nazwa: 'Anna', telefon: '512' }] }, { re: /FROM Leady\s+WHERE tenant_id = \?/, rows: [{ id: 'L-1', nazwa: 'Lead 104', telefon: '600', kampania: 'Jesień', status: 'nowy' }] }]);
        res = await post(db, { action: 'kontakt_szukaj', q: 'an' });
        expect(res.body.klienci).toHaveLength(1); expect(res.body.leady).toHaveLength(1);
        expect(db._sql(/FROM Klienci WHERE tenant_id/)[0][1][0]).toBe(SALON_A);
        res = await post(dbWg([]), { action: 'kontakt_szukaj', q: 'a' });
        expect(res.body).toEqual({ status: 'success', klienci: [], leady: [] });
    });
});
