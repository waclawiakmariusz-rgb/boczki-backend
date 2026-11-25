// tests/klub-data-resetu.test.js
// Data resetu punktów Klubu ustawiana przez salon (polecenie właściciela 25.11.2026):
//  - każdy salon ma własny dzień resetu (`Lojalnosc_Ustawienia.nastepny_reset`), zapisywany w Ustawieniach Klubu;
//  - 29 lutego przechodzi na dzień później (1 marca);
//  - KAŻDA zmiana daty zostawia w Dzienniku Zdarzeń zdanie „Użytkownik X zmienił datę resetu punktów Klubu na …”
//    i jest widoczna w panelu (kto, kiedy) — „żeby nie było wątpliwości kto napsuł”;
//  - w dniu resetu punkty sprzed tego dnia wygasają, a data przesuwa się sama o rok;
//  - apka klientki mówi „ważne do” dnia przed resetem i nie ucina historii 1 stycznia.
// Charakterystyka starego kodu (sztywny 1 stycznia, pułapka licznika roku) jest w docs/PLAN_PUNKTY_RESET_2028_2026-11-25.md.
const request = require('supertest');
const express = require('express');
const { mockDb } = require('./helpers/mockDb');
const lojalnoscFactory = require('../routes/lojalnosc');
const { wyczyscCacheLoj, makeKlubToken } = lojalnoscFactory;

const INIT = Array.from({ length: 21 }, () => ({ rows: [] }));
const ROLA_ADMIN = { rows: [{ rola: 'Admin' }] };
const ROLA_INNA = { rows: [{ rola: 'Praktykantka' }] };
const OK = { rows: { affectedRows: 1 } };
const buildApp = (db) => { const app = express(); app.use(express.json()); app.use('/api', lojalnoscFactory(db)); return app; };
const USTAWIENIA = { action: 'loj_ustawienia_zapisz', tenant_id: 'boczki', user_log: 'Gosia', nazwa_klubu: 'Klub', pkt_za_10zl: 1, bonus_powitalny_pkt: 20, polecenie_pkt: 0 };

beforeEach(() => wyczyscCacheLoj());
afterEach(() => jest.useRealTimers());

function oUdawanejDacie(iso) { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] }); jest.setSystemTime(new Date(iso)); }
const wpisyDziennika = (db, akcja) => db.query.mock.calls.filter((c) => /INSERT INTO Logi/.test(c[0]) && (c[1] || []).includes(akcja));
const insertUstawien = (db) => db.query.mock.calls.find((c) => /INSERT INTO Lojalnosc_Ustawienia/.test(c[0]));

describe('Pomocnicy dat resetu', () => {
    const daty = () => lojalnoscFactory(mockDb(...INIT))._datyResetu;

    test('29 lutego przechodzi na 1 marca — także w roku nieprzestępnym (reguła właściciela: „niech przechodzi na dzień później”)', () => {
        expect(daty().normalizujDateResetu('2028-02-29')).toBe('2028-03-01');
        expect(daty().normalizujDateResetu('2027-02-29')).toBe('2027-03-01');
        expect(daty().normalizujDateResetu('2028-01-01')).toBe('2028-01-01');
        expect(daty().normalizujDateResetu('2028-1-5')).toBe('2028-01-05');
    });

    test('odrzuca śmieci i dni, których nie ma', () => {
        expect(daty().normalizujDateResetu('31.12.2027')).toBeNull();
        expect(daty().normalizujDateResetu('2027-13-01')).toBeNull();
        expect(daty().normalizujDateResetu('2027-04-31')).toBeNull();
        expect(daty().normalizujDateResetu('')).toBeNull();
        expect(daty().normalizujDateResetu('1999-01-01')).toBeNull();
    });

    test('po resecie data przesuwa się o rok, dzień „ważne do” to dzień przed resetem, tekst po polsku', () => {
        expect(daty().nastepnaDataResetu('2028-01-01')).toBe('2029-01-01');
        expect(daty().nastepnaDataResetu('2027-03-01')).toBe('2028-03-01');
        expect(daty().dzienPrzed('2028-01-01')).toBe('2027-12-31');
        expect(daty().dzienPrzed('2028-03-01')).toBe('2028-02-29');
        expect(daty().dataResetuTekst('2028-01-01')).toBe('1 stycznia 2028');
        expect(daty().dataResetuTekst('2027-03-01')).toBe('1 marca 2027');
    });

    test('salon sprzed zmiany (sam przełącznik, bez daty) ma datę = 1 stycznia po licznikowym roku, nigdy w przeszłości', () => {
        oUdawanejDacie('2026-11-25T10:00:00');
        expect(daty().dataResetuZUstawien({ reset_roczny: 1, ostatni_reset_rok: 2026, nastepny_reset: null })).toBe('2027-01-01');
        expect(daty().dataResetuZUstawien({ reset_roczny: 1, ostatni_reset_rok: 0, nastepny_reset: null })).toBe('2027-01-01');
        jest.setSystemTime(new Date('2027-01-02T10:00:00'));
        expect(daty().dataResetuZUstawien({ reset_roczny: 1, ostatni_reset_rok: 2026, nastepny_reset: null })).toBe('2028-01-01');   // nie 2027-01-01 wstecz
        expect(daty().dataResetuZUstawien({ reset_roczny: 1, nastepny_reset: new Date(2028, 0, 1) })).toBe('2028-01-01');
        expect(daty().dataResetuZUstawien({ reset_roczny: 1, nastepny_reset: '2028-01-01' })).toBe('2028-01-01');
        expect(daty().dataResetuZUstawien({ reset_roczny: 0, nastepny_reset: null })).toBe('');
    });
});

describe('Zapis daty resetu w Ustawieniach Klubu (loj_ustawienia_zapisz)', () => {
    test('admin ustawia 1.01.2028: data w bazie, „kto i kiedy” zapisane, Dziennik ma zdanie „Użytkownik Gosia zmienił datę resetu punktów Klubu na 1 stycznia 2028”', async () => {
        oUdawanejDacie('2026-11-25T14:05:00');
        const db = mockDb(...INIT, ROLA_ADMIN,
            { rows: [{ nastepny_reset: null, reset_roczny: 1, ostatni_reset_rok: 2026 }] },   // stan przed (Boczki dziś)
            OK, OK, OK);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...USTAWIENIA, nastepny_reset: '2028-01-01', reset_roczny: 1 });
        expect(res.body.status).toBe('success');
        expect(res.body.message).toBe('Zapisano. Reset punktów: 1 stycznia 2028.');
        expect(res.body.nastepny_reset).toBe('2028-01-01');
        const ins = insertUstawien(db);
        expect(ins[0]).toMatch(/nastepny_reset = VALUES\(nastepny_reset\), reset_zmienil = VALUES\(reset_zmienil\), reset_zmieniono = NOW\(\)/);
        expect(ins[1]).toEqual(['boczki', 1, 'Klub', 20, 1, 0, '2028-01-01', 'Gosia', 'Gosia']);
        const dziennik = wpisyDziennika(db, 'KLUB DATA RESETU');
        expect(dziennik).toHaveLength(1);
        const opis = dziennik[0][1].find((p) => typeof p === 'string' && /^Użytkownik/.test(p));
        expect(opis).toMatch(/^Użytkownik Gosia zmienił datę resetu punktów Klubu na 1 stycznia 2028 \(25\.11\.2026 o \d{2}:\d{2}; poprzednio: 1 stycznia 2027\)\. W tym dniu wszystkie wcześniejsze punkty wygasną i zaczną naliczać się od nowa\.$/);
        expect(dziennik[0][1]).toContain('Gosia');   // kto — w kolumnie pracownika, nie tylko w opisie
    });

    test('29 lutego 2028 zapisuje się jako 1 marca 2028 i tak brzmi komunikat oraz Dziennik', async () => {
        oUdawanejDacie('2026-11-25T14:05:00');
        const db = mockDb(...INIT, ROLA_ADMIN, { rows: [] }, OK, OK, OK);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...USTAWIENIA, user_log: 'Ania', nastepny_reset: '2028-02-29' });
        expect(res.body.status).toBe('success');
        expect(res.body.message).toBe('Zapisano. Reset punktów: 1 marca 2028.');
        expect(insertUstawien(db)[1][6]).toBe('2028-03-01');
        const opis = wpisyDziennika(db, 'KLUB DATA RESETU')[0][1].find((p) => typeof p === 'string' && /^Użytkownik/.test(p));
        expect(opis).toMatch(/^Użytkownik Ania zmienił datę resetu punktów Klubu na 1 marca 2028 \(.*; poprzednio: reset wyłączony\)\./);
    });

    test('data dzisiejsza lub wcześniejsza jest odrzucona — nic nie zapisane (koniec pułapki „włączyłem i wyzerowało od ręki”)', async () => {
        oUdawanejDacie('2026-11-25T14:05:00');
        for (const zla of ['2026-11-25', '2026-01-01', '2025-12-31']) {
            wyczyscCacheLoj();
            const db = mockDb(...INIT, ROLA_ADMIN, { rows: [] }, OK, OK, OK);
            const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...USTAWIENIA, nastepny_reset: zla });
            expect(res.body.status).toBe('error');
            expect(res.body.message).toMatch(/musi być w przyszłości/);
            expect(insertUstawien(db)).toBeUndefined();
        }
    });

    test('jutro już wolno', async () => {
        oUdawanejDacie('2026-11-25T23:30:00');
        const db = mockDb(...INIT, ROLA_ADMIN, { rows: [] }, OK, OK, OK);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...USTAWIENIA, nastepny_reset: '2026-11-26' });
        expect(res.body.status).toBe('success');
        expect(insertUstawien(db)[1][6]).toBe('2026-11-26');
    });

    test('śmieci w polu daty → czytelny błąd, nic nie zapisane', async () => {
        const db = mockDb(...INIT, ROLA_ADMIN, { rows: [] }, OK, OK, OK);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...USTAWIENIA, nastepny_reset: '31.12.2027' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/RRRR-MM-DD/);
        expect(insertUstawien(db)).toBeUndefined();
    });

    test('zapis bez zmiany daty (ta sama co w bazie) NIE pisze do Dziennika i nie podmienia „kto zmienił”', async () => {
        oUdawanejDacie('2026-11-25T14:05:00');
        const db = mockDb(...INIT, ROLA_ADMIN,
            { rows: [{ nastepny_reset: new Date(2028, 0, 1), reset_roczny: 1, ostatni_reset_rok: 2026 }] },
            OK, OK);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...USTAWIENIA, user_log: 'Ktoś inny', nastepny_reset: '2028-01-01' });
        expect(res.body.status).toBe('success');
        expect(res.body.message).toBe('Zapisano ustawienia Klubu.');
        const ins = insertUstawien(db);
        expect(ins[0]).not.toMatch(/reset_zmieniono = NOW\(\)/);
        expect(ins[1][7]).toBe('');                       // reset_zmienil pusty w VALUES (przy INSERT nowego wiersza)
        expect(wpisyDziennika(db, 'KLUB DATA RESETU')).toHaveLength(0);
        expect(wpisyDziennika(db, 'KLUB USTAWIENIA')).toHaveLength(1);   // zwykły wpis ustawień zostaje
    });

    test('wyczyszczenie pola wyłącza reset i zostawia w Dzienniku, kto to zrobił', async () => {
        oUdawanejDacie('2026-11-25T14:05:00');
        const db = mockDb(...INIT, ROLA_ADMIN,
            { rows: [{ nastepny_reset: '2028-01-01', reset_roczny: 1, ostatni_reset_rok: 2026 }] },
            OK, OK, OK);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...USTAWIENIA, user_log: 'Mariusz', nastepny_reset: '', reset_roczny: 0 });
        expect(res.body.status).toBe('success');
        expect(res.body.message).toBe('Zapisano. Reset punktów wyłączony.');
        const ins = insertUstawien(db);
        expect(ins[1][4]).toBe(0);          // reset_roczny = 0
        expect(ins[1][6]).toBeNull();       // nastepny_reset = NULL
        const opis = wpisyDziennika(db, 'KLUB DATA RESETU')[0][1].find((p) => typeof p === 'string' && /^Użytkownik/.test(p));
        expect(opis).toMatch(/^Użytkownik Mariusz wyłączył reset punktów Klubu \(.*; poprzednio: 1 stycznia 2028\)\. Punkty nie będą już wygasać\.$/);
    });

    test('praktykantka nie może zmienić daty resetu (RBAC backendowy)', async () => {
        const db = mockDb(...INIT, ROLA_INNA);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...USTAWIENIA, user_log: 'Stażystka', nastepny_reset: '2028-01-01' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/uprawnień/i);
        expect(insertUstawien(db)).toBeUndefined();
        expect(wpisyDziennika(db, 'KLUB DATA RESETU')).toHaveLength(0);
    });
});

describe('Odczyt ustawień (loj_ustawienia) — panel widzi datę i kto ją zmienił', () => {
    test('zwraca datę, jej polski zapis oraz autora i czas ostatniej zmiany', async () => {
        const db = mockDb(...INIT, { rows: [{ pkt_za_10zl: 1, nazwa_klubu: 'Klub Boczki', bonus_powitalny_pkt: 20, reset_roczny: 1, ostatni_reset_rok: 2026,
            nastepny_reset: new Date(2028, 0, 1), reset_zmienil: 'Gosia', reset_zmieniono: new Date(2026, 10, 25, 14, 5), polecenie_pkt: 0 }] });
        const res = await request(buildApp(db)).get('/api/lojalnosc').query({ action: 'loj_ustawienia',tenant_id: 'boczki', user_log: 'Gosia' });
        expect(res.body.status).toBe('success');
        expect(res.body.ustawienia).toMatchObject({ reset_roczny: 1, nastepny_reset: '2028-01-01', nastepny_reset_tekst: '1 stycznia 2028', reset_zmienil: 'Gosia', reset_zmieniono: '25.11.2026 14:05' });
    });

    test('salon sprzed zmiany (przełącznik bez daty) widzi 1 stycznia przyszłego roku i pustego autora', async () => {
        oUdawanejDacie('2026-11-25T10:00:00');
        const db = mockDb(...INIT, { rows: [{ pkt_za_10zl: 1, nazwa_klubu: 'Klub', bonus_powitalny_pkt: 0, reset_roczny: 1, ostatni_reset_rok: 2026, nastepny_reset: null, reset_zmienil: null, reset_zmieniono: null, polecenie_pkt: 0 }] });
        const res = await request(buildApp(db)).get('/api/lojalnosc').query({ action: 'loj_ustawienia',tenant_id: 'boczki', user_log: 'Gosia' });
        expect(res.body.ustawienia).toMatchObject({ nastepny_reset: '2027-01-01', nastepny_reset_tekst: '1 stycznia 2027', reset_zmienil: '', reset_zmieniono: '' });
    });

    test('reset wyłączony → pusta data', async () => {
        const db = mockDb(...INIT, { rows: [{ pkt_za_10zl: 1, nazwa_klubu: 'Klub', bonus_powitalny_pkt: 0, reset_roczny: 0, nastepny_reset: null, polecenie_pkt: 0 }] });
        const res = await request(buildApp(db)).get('/api/lojalnosc').query({ action: 'loj_ustawienia',tenant_id: 'ambasada', user_log: 'Kasia' });
        expect(res.body.ustawienia).toMatchObject({ reset_roczny: 0, nastepny_reset: '', nastepny_reset_tekst: '' });
    });
});

describe('Przebieg resetu (tick co 60 s) — po dacie salonu, zegarem bazy', () => {
    test('rok procesu nie ma już znaczenia: szukanie salonów idzie po `nastepny_reset <= CURDATE()` bez parametru roku, a salony bez daty dostają ją najpierw', async () => {
        oUdawanejDacie('2027-01-01T00:01:00');
        const db = mockDb(...INIT, { rows: { affectedRows: 1 } }, { rows: [] });
        await lojalnoscFactory(db)._tickResetRoczny();
        const dopisanie = db.query.mock.calls.find((c) => /UPDATE Lojalnosc_Ustawienia/.test(c[0]) && /nastepny_reset IS NULL/.test(c[0]));
        const szukanie = db.query.mock.calls.find((c) => /SELECT tenant_id, nastepny_reset FROM Lojalnosc_Ustawienia/.test(c[0]));
        expect(db.query.mock.calls.indexOf(dopisanie)).toBeLessThan(db.query.mock.calls.indexOf(szukanie));   // najpierw dopisanie dat, potem szukanie
        expect(dopisanie[0]).toMatch(/SET nastepny_reset = DATE\(CONCAT\(GREATEST\(COALESCE\(ostatni_reset_rok, 0\), YEAR\(CURDATE\(\)\)\) \+ 1, '-01-01'\)\)/);
        expect(dopisanie[0]).toMatch(/WHERE reset_roczny = 1 AND nastepny_reset IS NULL/);
        expect(szukanie[0]).toMatch(/nastepny_reset <= CURDATE\(\)/);
        expect(szukanie[1]).toEqual([]);
        expect(db.query.mock.calls.some((c) => /WYGASNIECIE/.test(c[0]))).toBe(false);
    });

    test('w dniu resetu 1.01.2028: całe saldo sprzed północy schodzi do zera jednym wpisem na osobę, data przesuwa się na 1.01.2029, Dziennik dostaje zdanie', async () => {
        const db = mockDb(...INIT,
            { rows: { affectedRows: 0 } },
            { rows: [{ tenant_id: 'boczki', nastepny_reset: new Date(2028, 0, 1) }] },
            OK,                                                                       // claim
            { rows: [{ id_klienta: '1143', saldo: 1013 }, { id_klienta: '1001', saldo: 104 }] },
            OK, OK,                                                                   // dwa WYGASNIECIA
            OK);                                                                      // zapiszLog
        await lojalnoscFactory(db)._tickResetRoczny();
        const claim = db.query.mock.calls.find((c) => /UPDATE Lojalnosc_Ustawienia SET nastepny_reset = \?, ostatni_reset_rok = \? WHERE tenant_id = \? AND nastepny_reset = \?/.test(c[0]));
        expect(claim[1]).toEqual(['2029-01-01', 2028, 'boczki', '2028-01-01']);
        const salda = db.query.mock.calls.find((c) => /HAVING saldo > 0/.test(c[0]));
        expect(salda[1]).toEqual(['boczki', '2028-01-01 00:00:00']);                 // punkty naliczone 1.01.2028 i później zostają
        const wygasniecia = db.query.mock.calls.filter((c) => /INSERT INTO Lojalnosc_Punkty/.test(c[0]) && /WYGASNIECIE/.test(c[0]));
        expect(wygasniecia.map((c) => c[1][2])).toEqual([-1013, -104]);
        expect(wygasniecia.map((c) => c[1][3])).toEqual(['WYGAS@2028-01-01@1143', 'WYGAS@2028-01-01@1001']);
        expect(wygasniecia[0][0]).toMatch(/Punkty wygasły \(reset punktów\)/);
        const log = wpisyDziennika(db, 'KLUB RESET PUNKTÓW');
        expect(log).toHaveLength(1);
        expect(log[0][1]).toContain('Punkty sprzed 1 stycznia 2028 wygasły — 2 kont. Następny reset: 1 stycznia 2029.');
    });

    test('data z bazy jako tekst (dateStrings) i reset w marcu: 2027-03-01 → następny 2028-03-01', async () => {
        const db = mockDb(...INIT, { rows: { affectedRows: 0 } },
            { rows: [{ tenant_id: 'ambasada', nastepny_reset: '2027-03-01' }] }, OK, { rows: [] }, OK);
        await lojalnoscFactory(db)._tickResetRoczny();
        const claim = db.query.mock.calls.find((c) => /SET nastepny_reset = \?, ostatni_reset_rok = \?/.test(c[0]));
        expect(claim[1]).toEqual(['2028-03-01', 2027, 'ambasada', '2027-03-01']);
        expect(wpisyDziennika(db, 'KLUB RESET PUNKTÓW')[0][1]).toContain('Punkty sprzed 1 marca 2027 wygasły — 0 kont. Następny reset: 1 marca 2028.');
    });

    test('przegrany claim (inna z trzech instancji już przesunęła datę) → ani wygaśnięć, ani wpisu w Dzienniku', async () => {
        const db = mockDb(...INIT, { rows: { affectedRows: 0 } },
            { rows: [{ tenant_id: 'boczki', nastepny_reset: '2028-01-01' }] },
            { rows: { affectedRows: 0 } });
        await lojalnoscFactory(db)._tickResetRoczny();
        expect(db.query.mock.calls.some((c) => /WYGASNIECIE/.test(c[0]))).toBe(false);
        expect(wpisyDziennika(db, 'KLUB RESET PUNKTÓW')).toHaveLength(0);
    });
});

describe('Apka klientki (/klub/me) — „ważne do” i historia liczone od daty salonu', () => {
    const sesja = () => makeKlubToken({ t: 'boczki', k: '42', typ: 'ses', exp: Date.now() + 80 * 24 * 60 * 60 * 1000 });
    const PODSTAWA = [{ rows: [{ status: 'AKTYWNE' }] }, { rows: [{ imie_nazwisko: 'Anna Nowak', telefon: '500100200' }] }, { rows: [{ saldo: 104 }] }];

    test('reset 1.01.2028 → dziś (25.11.2026) „ważne do 2027-12-31”, nie „do 2026-12-31”; apka dostaje też dzień resetu', async () => {
        oUdawanejDacie('2026-11-25T10:00:00');
        const db = mockDb(...INIT, ...PODSTAWA, { rows: [] },
            { rows: [{ nazwa_klubu: 'Klub', pkt_za_10zl: 1, reset_roczny: 1, nastepny_reset: new Date(2028, 0, 1), ostatni_reset_rok: 2026 }] });
        const res = await request(buildApp(db)).post('/api/klub/me').send({ session: sesja() });
        expect(res.body.status).toBe('success');
        expect(res.body.punkty_do).toBe('2027-12-31');
        expect(res.body.reset_od).toBe('2028-01-01');
    });

    test('historia nie ucina się 1 stycznia: bez wpisu wygaśnięcia widać wszystko, także punkty z 2026 oglądane w 2027', async () => {
        oUdawanejDacie('2027-01-15T10:00:00');
        const db = mockDb(...INIT, ...PODSTAWA,
            { rows: [{ zmiana: 40, powod: 'Zakup', zrodlo: 'SPRZEDAZ', created_at: '2027-01-10 12:00:00' }, { zmiana: 350, powod: 'Zakup', zrodlo: 'SPRZEDAZ', created_at: '2026-09-10 12:00:00' }] },
            { rows: [{ nazwa_klubu: 'Klub', pkt_za_10zl: 1, reset_roczny: 1, nastepny_reset: '2028-01-01', ostatni_reset_rok: 2026 }] });
        const res = await request(buildApp(db)).post('/api/klub/me').send({ session: sesja() });
        expect(res.body.wpisy.map((w) => w.zmiana)).toEqual([40, 350]);
        expect(res.body.punkty_do).toBe('2027-12-31');
    });

    test('po resecie historia zaczyna się od wygaśnięcia: wpis WYGASNIECIE nie trafia do apki, starsze wpisy znikają, nowsze zostają', async () => {
        oUdawanejDacie('2028-01-03T10:00:00');
        const db = mockDb(...INIT, ...PODSTAWA,
            { rows: [
                { zmiana: 25, powod: 'Zakup', zrodlo: 'SPRZEDAZ', created_at: '2028-01-02 12:00:00' },
                { zmiana: -390, powod: 'Punkty wygasły (reset punktów)', zrodlo: 'WYGASNIECIE', created_at: '2028-01-01 00:00:07' },
                { zmiana: 40, powod: 'Zakup', zrodlo: 'SPRZEDAZ', created_at: '2027-01-10 12:00:00' },
                { zmiana: 350, powod: 'Zakup', zrodlo: 'SPRZEDAZ', created_at: '2026-09-10 12:00:00' },
            ] },
            { rows: [{ nazwa_klubu: 'Klub', pkt_za_10zl: 1, reset_roczny: 1, nastepny_reset: '2029-01-01', ostatni_reset_rok: 2028 }] });
        const res = await request(buildApp(db)).post('/api/klub/me').send({ session: sesja() });
        expect(res.body.wpisy.map((w) => w.zmiana)).toEqual([25]);
        expect(res.body.wpisy.some((w) => w.zrodlo === 'WYGASNIECIE')).toBe(false);
        expect(res.body.punkty_do).toBe('2028-12-31');
    });

    test('salon bez resetu: punkty bezterminowe (punkty_do = null), reset_od = null', async () => {
        const db = mockDb(...INIT, ...PODSTAWA, { rows: [] }, { rows: [{ nazwa_klubu: 'Klub', pkt_za_10zl: 1, reset_roczny: 0, nastepny_reset: null }] });
        const res = await request(buildApp(db)).post('/api/klub/me').send({ session: sesja() });
        expect(res.body.punkty_do).toBeNull();
        expect(res.body.reset_od).toBeNull();
    });

    test('salon sprzed zmiany (przełącznik bez daty) oglądany 25.11.2026 → „ważne do 2026-12-31” jak dotąd — do czasu wpisania daty w panelu', async () => {
        oUdawanejDacie('2026-11-25T10:00:00');
        const db = mockDb(...INIT, ...PODSTAWA, { rows: [] }, { rows: [{ nazwa_klubu: 'Klub', pkt_za_10zl: 1, reset_roczny: 1, nastepny_reset: null, ostatni_reset_rok: 2026 }] });
        const res = await request(buildApp(db)).post('/api/klub/me').send({ session: sesja() });
        expect(res.body.punkty_do).toBe('2026-12-31');
        expect(res.body.reset_od).toBe('2027-01-01');
    });
});
