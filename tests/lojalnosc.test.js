// tests/lojalnosc.test.js
// Testy dodatku Klub (lojalnosc): matematyka punktów, hook sprzedażowy
// (naliczanie / zwroty / usunięcia / idempotencja), akcje panelu (RBAC, walidacje).
//
// UWAGA: fabryka routera odpala przy starcie 4 zapytania (2× CREATE TABLE,
// 2× INSERT seed) — w sekwencyjnym mockDb trzeba dać 4 wpisy-wypełniacze.
// Cache feature per tenant jest modułowy — czyścimy go w beforeEach.

const request = require('supertest');
const express = require('express');
const bcrypt = require('bcrypt');
const { mockDb, mockDbAlways } = require('./helpers/mockDb');
const lojalnoscFactory = require('../routes/lojalnosc');
const { makeLojalnosc, obliczPunkty, wyczyscCacheLoj, makeKlubToken, normalizujTelefon, pasujeSegment } = lojalnoscFactory;

function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', lojalnoscFactory(db));
    return app;
}

// 12 wpisów-wypełniaczy na init fabryki (CREATE ×10 + seed ×2; ALTER-y pomija mockDb)
const INIT = Array.from({ length: 12 }, () => ({ rows: [] }));

const FEATURE_ON = { rows: [{ feature_key: 'lojalnosc' }] };
const FEATURE_OFF = { rows: [] };
const ROLA_ADMIN = { rows: [{ rola: 'Admin' }] };       // duża litera — porównanie toLowerCase
const ROLA_RECEPCJA = { rows: [{ rola: 'Recepcja' }] };

beforeEach(() => wyczyscCacheLoj());

// ─── obliczPunkty ─────────────────────────────────────────────
describe('obliczPunkty', () => {
    test('10 zł = 1 pkt przy mnożniku 1', () => expect(obliczPunkty(10, 1)).toBe(1));
    test('95 zł → 9 pkt (floor)', () => expect(obliczPunkty(95, 1)).toBe(9));
    test('9.99 zł → 0 pkt', () => expect(obliczPunkty(9.99, 1)).toBe(0));
    test('float bez błędów zaokrągleń (95.10 zł)', () => expect(obliczPunkty(95.10, 1)).toBe(9));
    test('mnożnik 2: 95 zł → 19 pkt', () => expect(obliczPunkty(95, 2)).toBe(19));
    test('kwota ujemna → 0', () => expect(obliczPunkty(-50, 1)).toBe(0));
    test('mnożnik 0 → 0 (wyłączone naliczanie)', () => expect(obliczPunkty(100, 0)).toBe(0));
    test('kwota jako string "249,99" nie przechodzi (parseFloat gubi przecinek → 249)', () => {
        // parseKwota w sprzedaz.js normalizuje przecinek PRZED hookiem — hook dostaje Number
        expect(obliczPunkty(249.99, 1)).toBe(24);
    });
});

// ─── Hook: naliczZaSprzedaz ───────────────────────────────────
describe('makeLojalnosc — naliczZaSprzedaz', () => {
    test('nalicza punkty przy aktywnym feature (95 zł → +9)', () => {
        const db = mockDb(FEATURE_ON, { rows: [{ pkt_za_10zl: 1 }] }, { rows: { affectedRows: 1 } });
        makeLojalnosc(db).naliczZaSprzedaz('t-loj-a', { saleId: 'S1', id_klienta: '42', kwota: 95, opis: 'Botoks', pracownik: 'Anna' });
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]));
        expect(ins).toBeTruthy();
        expect(ins[1][1]).toBe('42');      // id_klienta
        expect(ins[1][2]).toBe(9);         // zmiana
        expect(ins[1][4]).toBe('SPRZEDAZ');
        expect(ins[1][5]).toBe('S1');      // ref_id = id sprzedaży
    });

    test('feature wyłączony → tylko 1 zapytanie, brak INSERT', () => {
        const db = mockDb(FEATURE_OFF);
        makeLojalnosc(db).naliczZaSprzedaz('t-loj-b', { saleId: 'S1', id_klienta: '42', kwota: 95 });
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]))).toBe(false);
        expect(db._callIndex()).toBe(1);
    });

    test('brak id_klienta → zero zapytań', () => {
        const db = mockDb();
        makeLojalnosc(db).naliczZaSprzedaz('t-loj-c', { saleId: 'S1', id_klienta: '', kwota: 95 });
        expect(db._callIndex()).toBe(0);
    });

    test('kwota 0 lub ujemna → zero zapytań', () => {
        const db = mockDb();
        const hook = makeLojalnosc(db);
        hook.naliczZaSprzedaz('t-loj-d', { saleId: 'S1', id_klienta: '42', kwota: 0 });
        hook.naliczZaSprzedaz('t-loj-d', { saleId: 'S2', id_klienta: '42', kwota: -20 });
        expect(db._callIndex()).toBe(0);
    });

    test('duplikat (ER_DUP_ENTRY) nie wybucha — idempotencja retry', () => {
        const db = mockDb(FEATURE_ON, { rows: [{ pkt_za_10zl: 1 }] }, { err: { code: 'ER_DUP_ENTRY', message: 'dup' } });
        expect(() => makeLojalnosc(db).naliczZaSprzedaz('t-loj-e', { saleId: 'S1', id_klienta: '42', kwota: 95 })).not.toThrow();
    });

    test('dziwne rows z bazy (nie-tablica) nie wybuchają', () => {
        const db = mockDbAlways({ affectedRows: 1 }); // każdy SELECT dostaje obiekt zamiast tablicy
        expect(() => makeLojalnosc(db).naliczZaSprzedaz('t-loj-f', { saleId: 'S1', id_klienta: '42', kwota: 95 })).not.toThrow();
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]))).toBe(false);
    });
});

// ─── Hook: naliczZaZwrot ──────────────────────────────────────
describe('makeLojalnosc — naliczZaZwrot', () => {
    test('pełny zwrot cofa punkty naliczone za oryginał', () => {
        const db = mockDb(
            FEATURE_ON,
            { rows: [{ zrodlo: 'SPRZEDAZ', zmiana: 9, ref_id: 'S1' }] },
            { rows: [{ pkt_za_10zl: 1 }] },
            { rows: { affectedRows: 1 } }
        );
        makeLojalnosc(db).naliczZaZwrot('t-loj-g', { zwrotId: 'Z1', saleId: 'S1', id_klienta: '42', kwotaZwrotu: 95 });
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]));
        expect(ins[1][2]).toBe(-9);
        expect(ins[1][4]).toBe('ZWROT');
        expect(ins[1][5]).toBe('Z1@S1');
    });

    test('zwrot częściowy odejmuje proporcjonalnie (50 zł → -5)', () => {
        const db = mockDb(
            FEATURE_ON,
            { rows: [{ zrodlo: 'SPRZEDAZ', zmiana: 9, ref_id: 'S1' }] },
            { rows: [{ pkt_za_10zl: 1 }] },
            { rows: { affectedRows: 1 } }
        );
        makeLojalnosc(db).naliczZaZwrot('t-loj-h', { zwrotId: 'Z1', saleId: 'S1', id_klienta: '42', kwotaZwrotu: 50 });
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]));
        expect(ins[1][2]).toBe(-5);
    });

    test('sufit: kolejne zwroty nie zabiorą więcej niż naliczono', () => {
        const db = mockDb(
            FEATURE_ON,
            { rows: [
                { zrodlo: 'SPRZEDAZ', zmiana: 9, ref_id: 'S1' },
                { zrodlo: 'ZWROT', zmiana: -5, ref_id: 'Z0@S1' }
            ] },
            { rows: [{ pkt_za_10zl: 1 }] },
            { rows: { affectedRows: 1 } }
        );
        // Drugi zwrot na 95 zł dawałby -9, ale zostało tylko 4 do oddania
        makeLojalnosc(db).naliczZaZwrot('t-loj-i', { zwrotId: 'Z1', saleId: 'S1', id_klienta: '42', kwotaZwrotu: 95 });
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]));
        expect(ins[1][2]).toBe(-4);
    });

    test('sprzedaż sprzed startu Klubu (brak wpisu SPRZEDAZ) → brak kompensacji', () => {
        const db = mockDb(FEATURE_ON, { rows: [] });
        makeLojalnosc(db).naliczZaZwrot('t-loj-j', { zwrotId: 'Z1', saleId: 'S1', id_klienta: '42', kwotaZwrotu: 95 });
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]))).toBe(false);
    });
});

// ─── Hook: kompensujUsuniecie / skorygujEdycje ────────────────
describe('makeLojalnosc — usunięcie i edycja', () => {
    test('usunięcie sprzedaży cofa sumę naliczonych punktów', () => {
        const db = mockDb(
            FEATURE_ON,
            { rows: [{ id_klienta: '42', suma: 9 }] },
            { rows: { affectedRows: 1 } }
        );
        makeLojalnosc(db).kompensujUsuniecie('t-loj-k', 'S1', 'Anna');
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]));
        expect(ins[1][2]).toBe(-9);
        expect(ins[1][4]).toBe('USUNIECIE');
        expect(ins[1][5]).toBe('DEL@S1');
    });

    test('usunięcie bez wcześniejszych punktów → brak wpisu', () => {
        const db = mockDb(FEATURE_ON, { rows: [] });
        makeLojalnosc(db).kompensujUsuniecie('t-loj-l', 'S1', 'Anna');
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]))).toBe(false);
    });

    test('edycja kwoty dociąga punkty do nowej kwoty (200→300: +10)', () => {
        const db = mockDb(
            FEATURE_ON,
            { rows: [{ id_klienta: '42', zrodlo: 'SPRZEDAZ', zmiana: 20 }] },
            { rows: [{ pkt_za_10zl: 1 }] },
            { rows: { affectedRows: 1 } }
        );
        makeLojalnosc(db).skorygujEdycje('t-loj-m', 'S1', 300, 'Anna');
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]));
        expect(ins[1][2]).toBe(10);
        expect(ins[1][4]).toBe('EDYCJA');
    });

    test('edycja bez zmiany punktów → brak wpisu', () => {
        const db = mockDb(
            FEATURE_ON,
            { rows: [{ id_klienta: '42', zrodlo: 'SPRZEDAZ', zmiana: 20 }] },
            { rows: [{ pkt_za_10zl: 1 }] }
        );
        makeLojalnosc(db).skorygujEdycje('t-loj-n', 'S1', 200, 'Anna');
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]))).toBe(false);
    });

    test('edycja sprzedaży nigdy nie punktowanej (sprzed Klubu) → brak wpisu', () => {
        const db = mockDb(FEATURE_ON, { rows: [] });
        makeLojalnosc(db).skorygujEdycje('t-loj-o', 'S1', 300, 'Anna');
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]))).toBe(false);
    });
});

// ─── GET loj_klient ───────────────────────────────────────────
describe('GET /api/lojalnosc — loj_klient', () => {
    test('feature wyłączony → błąd „nie jest aktywny"', async () => {
        const db = mockDb(...INIT, FEATURE_OFF);
        const res = await request(buildApp(db)).get('/api/lojalnosc?action=loj_klient&tenant_id=t-loj-p&id_klienta=42');
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/nie jest aktywny/i);
    });

    test('zwraca saldo, wpisy i ustawienia', async () => {
        const db = mockDb(
            ...INIT,
            FEATURE_ON,
            { rows: [{ saldo: 25 }] },
            { rows: [{ zmiana: 9, powod: 'Botoks', zrodlo: 'SPRZEDAZ', pracownik: 'Anna', created_at: '2026-07-10' }] },
            { rows: [{ pkt_za_10zl: 2, nazwa_klubu: 'Klub Boczki' }] }
        );
        const res = await request(buildApp(db)).get('/api/lojalnosc?action=loj_klient&tenant_id=t-loj-q&id_klienta=42');
        expect(res.body.status).toBe('success');
        expect(res.body.saldo).toBe(25);
        expect(res.body.wpisy).toHaveLength(1);
        expect(res.body.wpisy[0].zmiana).toBe(9);
        expect(res.body.ustawienia.pkt_za_10zl).toBe(2);
        expect(res.body.ustawienia.nazwa_klubu).toBe('Klub Boczki');
    });

    test('brak id_klienta → błąd', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).get('/api/lojalnosc?action=loj_klient&tenant_id=t-loj-r');
        expect(res.body.status).toBe('error');
    });
});

// ─── POST loj_punkty_reczne ───────────────────────────────────
describe('POST /api/lojalnosc — loj_punkty_reczne', () => {
    const valid = {
        action: 'loj_punkty_reczne',
        tenant_id: 't-loj-s',
        id_klienta: '42',
        zmiana: 50,
        powod: 'Opinia Google',
        user_log: 'Anna',
    };

    test('zapisuje ręczne punkty (admin, klient istnieje, feature aktywny)', async () => {
        const db = mockDb(
            ...INIT,
            FEATURE_ON,
            ROLA_ADMIN,                            // RBAC: pilot admin-only
            { rows: [{ id_klienta: '42' }] },      // klient istnieje
            { rows: { affectedRows: 1 } }          // INSERT ledger
        );
        const res = await request(buildApp(db)).post('/api/lojalnosc').send(valid);
        expect(res.body.status).toBe('success');
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]));
        expect(ins[1][2]).toBe(50);
        expect(ins[0]).toMatch(/'RECZNE'/); // zrodlo wpisane w SQL, ref_id = losowy UUID
    });

    test('recepcja NIE może dodać punktów ręcznie (pilot admin-only)', async () => {
        const db = mockDb(...INIT, FEATURE_ON, ROLA_RECEPCJA);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, tenant_id: 't-loj-s2' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/uprawnień/i);
    });

    test('odrzuca zmianę 0', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, zmiana: 0 });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca przekroczenie limitu ±1000', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, zmiana: 1001 });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/limit/i);
    });

    test('odrzuca brak powodu', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, powod: '  ' });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca brak pracownika', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, user_log: '', pracownik: '' });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca nieistniejącego klienta (ochrona przed wpisami na obce id)', async () => {
        const db = mockDb(...INIT, FEATURE_ON, ROLA_ADMIN, { rows: [] });
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, tenant_id: 't-loj-t' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/nie znaleziono klienta/i);
    });

    test('feature wyłączony → błąd', async () => {
        const db = mockDb(...INIT, FEATURE_OFF);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, tenant_id: 't-loj-u' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/nie jest aktywny/i);
    });
});

// ─── POST loj_ustawienia_zapisz ───────────────────────────────
describe('POST /api/lojalnosc — loj_ustawienia_zapisz', () => {
    const valid = {
        action: 'loj_ustawienia_zapisz',
        tenant_id: 't-loj-v',
        pkt_za_10zl: 2,
        nazwa_klubu: 'Klub Boczki',
        user_log: 'Szefowa',
    };

    test('admin może zapisać ustawienia', async () => {
        const db = mockDb(...INIT, ROLA_ADMIN, { rows: { affectedRows: 1 } });
        const res = await request(buildApp(db)).post('/api/lojalnosc').send(valid);
        expect(res.body.status).toBe('success');
    });

    test('manager NIE może zapisać ustawień (pilot admin-only)', async () => {
        const db = mockDb(...INIT, { rows: [{ rola: 'Manager' }] });
        const res = await request(buildApp(db)).post('/api/lojalnosc').send(valid);
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/uprawnień/i);
    });

    test('recepcja NIE może zapisać ustawień (RBAC backendowy)', async () => {
        const db = mockDb(...INIT, ROLA_RECEPCJA);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send(valid);
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/uprawnień/i);
    });

    test('odrzuca mnożnik poza zakresem 0–100', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, pkt_za_10zl: 150 });
        expect(res.body.status).toBe('error');
    });
});

// ═══════════════════ FAZA 2 — apka klienta ═══════════════════

const KLIENT_OK = { rows: [{ imie_nazwisko: 'Anna Kowalska', telefon: '500 123 456', status: '', zmarly: 0 }] };

// ─── normalizujTelefon ────────────────────────────────────────
describe('normalizujTelefon', () => {
    test('spacje i prefiks +48 → 9 cyfr', () => expect(normalizujTelefon('+48 500 123 456')).toBe('500123456'));
    test('myślniki → 9 cyfr', () => expect(normalizujTelefon('500-123-456')).toBe('500123456'));
    test('puste → puste', () => expect(normalizujTelefon('')).toBe(''));
});

// ─── POST loj_aktywacja_token (panel) ─────────────────────────
describe('POST /api/lojalnosc — loj_aktywacja_token', () => {
    const valid = { action: 'loj_aktywacja_token', tenant_id: 't-loj-akt1', id_klienta: '42', user_log: 'Szefowa' };

    test('admin generuje QR + link aktywacyjny', async () => {
        const db = mockDb(
            ...INIT,
            FEATURE_ON,
            ROLA_ADMIN,
            { rows: [{ id_klienta: '42', imie_nazwisko: 'Anna Kowalska', telefon: '500123456', status: '', zmarly: 0 }] },
            { rows: [] }                        // brak istniejącego konta
        );
        const res = await request(buildApp(db)).post('/api/lojalnosc').send(valid);
        expect(res.body.status).toBe('success');
        expect(res.body.url).toMatch(/\/klub\.html\?a=/);
        expect(res.body.qr).toMatch(/^data:image\/png/);
        expect(res.body.ma_konto).toBe(0);
    });

    test('recepcja NIE wygeneruje linku (pilot admin-only)', async () => {
        const db = mockDb(...INIT, FEATURE_ON, ROLA_RECEPCJA);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, tenant_id: 't-loj-akt2' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/uprawnień/i);
    });

    test('klient USUNIETY → odmowa', async () => {
        const db = mockDb(
            ...INIT, FEATURE_ON, ROLA_ADMIN,
            { rows: [{ id_klienta: '42', imie_nazwisko: 'X', telefon: '', status: 'USUNIETY', zmarly: 0 }] }
        );
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, tenant_id: 't-loj-akt3' });
        expect(res.body.status).toBe('error');
    });
});

// ─── POST /klub/aktywuj ───────────────────────────────────────
describe('POST /api/klub/aktywuj', () => {
    const token = () => makeKlubToken({ t: 't-klub-a', k: '42', typ: 'akt', exp: Date.now() + 60000 });

    test('poprawny token + PIN + zgoda → konto i sesja', async () => {
        const db = mockDb(...INIT, KLIENT_OK, { rows: { affectedRows: 1 } });
        const res = await request(buildApp(db)).post('/api/klub/aktywuj')
            .send({ token: token(), pin: '1234', zgoda: true });
        expect(res.body.status).toBe('success');
        expect(res.body.session).toBeTruthy();
        expect(res.body.imie).toBe('Anna');
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Konta/.test(c[0]));
        expect(ins[1][2]).toBe('500123456');            // telefon znormalizowany
        expect(ins[1][3]).toMatch(/^\$2[aby]\$/);       // bcrypt hash, nie plaintext
    });

    test('zły/wygasły token → odmowa', async () => {
        const db = mockDbAlways([]);
        const wygasly = makeKlubToken({ t: 't-klub-a', k: '42', typ: 'akt', exp: Date.now() - 1000 });
        const res = await request(buildApp(db)).post('/api/klub/aktywuj')
            .send({ token: wygasly, pin: '1234', zgoda: true });
        expect(res.body.status).toBe('error');
    });

    test('token sesyjny NIE aktywuje konta (typ musi być akt)', async () => {
        const db = mockDbAlways([]);
        const ses = makeKlubToken({ t: 't-klub-a', k: '42', typ: 'ses', exp: Date.now() + 60000 });
        const res = await request(buildApp(db)).post('/api/klub/aktywuj')
            .send({ token: ses, pin: '1234', zgoda: true });
        expect(res.body.status).toBe('error');
    });

    test('PIN inny niż 4–6 cyfr → odmowa', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/klub/aktywuj')
            .send({ token: token(), pin: 'abcd', zgoda: true });
        expect(res.body.status).toBe('error');
    });

    test('brak zgody na regulamin → odmowa', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/klub/aktywuj')
            .send({ token: token(), pin: '1234', zgoda: false });
        expect(res.body.status).toBe('error');
    });
});

// ─── POST /klub/login ─────────────────────────────────────────
describe('POST /api/klub/login', () => {
    const HASH_1234 = bcrypt.hashSync('1234', 4); // niskie rundy — szybkie testy

    test('poprawny telefon + PIN → sesja', async () => {
        const db = mockDb(
            ...INIT,
            { rows: [{ tenant_id: 't-klub-b', id_klienta: '42', pin_hash: HASH_1234 }] },
            { rows: { affectedRows: 1 } }   // UPDATE ostatnie_logowanie
        );
        const res = await request(buildApp(db)).post('/api/klub/login')
            .send({ telefon: '+48 500 123 456', pin: '1234' });
        expect(res.body.status).toBe('success');
        expect(res.body.session).toBeTruthy();
    });

    test('zły PIN → ten sam ogólny komunikat co nieznany telefon', async () => {
        const dbZlyPin = mockDb(...INIT, { rows: [{ tenant_id: 't-klub-b', id_klienta: '42', pin_hash: HASH_1234 }] });
        const r1 = await request(buildApp(dbZlyPin)).post('/api/klub/login').send({ telefon: '500123456', pin: '9999' });
        const dbBrakTel = mockDb(...INIT, { rows: [] });
        const r2 = await request(buildApp(dbBrakTel)).post('/api/klub/login').send({ telefon: '500123456', pin: '1234' });
        expect(r1.body.status).toBe('error');
        expect(r2.body.status).toBe('error');
        expect(r1.body.message).toBe(r2.body.message); // brak enumeracji numerów
    });

    test('dwa konta z tym samym telefonem i PIN-em → odmowa z prośbą o link', async () => {
        const db = mockDb(...INIT, { rows: [
            { tenant_id: 't-klub-b', id_klienta: '42', pin_hash: HASH_1234 },
            { tenant_id: 't-klub-c', id_klienta: '7', pin_hash: HASH_1234 }
        ] });
        const res = await request(buildApp(db)).post('/api/klub/login').send({ telefon: '500123456', pin: '1234' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/kilku salonach/i);
    });
});

// ─── POST /klub/me ────────────────────────────────────────────
describe('POST /api/klub/me', () => {
    const sesja = () => makeKlubToken({ t: 't-klub-d', k: '42', typ: 'ses', exp: Date.now() + SESJA_DLUGA });
    const SESJA_DLUGA = 80 * 24 * 60 * 60 * 1000;

    test('zwraca saldo, historię i ustawienia tylko klienta z tokenu', async () => {
        const db = mockDb(
            ...INIT,
            { rows: [{ status: 'AKTYWNE' }] },      // konto
            KLIENT_OK,                              // klient
            { rows: [{ saldo: 42 }] },
            { rows: [{ zmiana: 9, powod: 'Botoks', zrodlo: 'SPRZEDAZ', created_at: '2026-07-10' }] },
            { rows: [{ nazwa_klubu: 'Klub', pkt_za_10zl: 1 }] }
        );
        const res = await request(buildApp(db)).post('/api/klub/me').send({ session: sesja() });
        expect(res.body.status).toBe('success');
        expect(res.body.saldo).toBe(42);
        expect(res.body.imie).toBe('Anna');
        expect(res.body.wpisy).toHaveLength(1);
        // Zapytania parametryzowane id_klienta Z TOKENU
        const saldoCall = db.query.mock.calls.find(c => /SUM\(zmiana\)/.test(c[0]));
        expect(saldoCall[1]).toEqual(['t-klub-d', '42']);
    });

    test('zły token → kod SESJA', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/klub/me').send({ session: 'abc.def' });
        expect(res.body.status).toBe('error');
        expect(res.body.code).toBe('SESJA');
    });

    test('konto ZABLOKOWANE → kod SESJA', async () => {
        const db = mockDb(...INIT, { rows: [{ status: 'ZABLOKOWANE' }] });
        const res = await request(buildApp(db)).post('/api/klub/me').send({ session: sesja() });
        expect(res.body.status).toBe('error');
        expect(res.body.code).toBe('SESJA');
    });

    test('klient zanonimizowany (RODO) → konto przestaje działać', async () => {
        const db = mockDb(
            ...INIT,
            { rows: [{ status: 'AKTYWNE' }] },
            { rows: [{ imie_nazwisko: 'XXX', status: 'ZANONIMIZOWANY', zmarly: 0 }] }
        );
        const res = await request(buildApp(db)).post('/api/klub/me').send({ session: sesja() });
        expect(res.body.status).toBe('error');
        expect(res.body.code).toBe('SESJA');
    });
});

// ═══════════════════ FAZY 3-4 — nagrody, promocje, push ═══════════════════

const SESJA = () => makeKlubToken({ t: 't-klub-n', k: '42', typ: 'ses', exp: Date.now() + 60000 });

// ─── POST /klub/nagroda_odbierz ───────────────────────────────
describe('POST /api/klub/nagroda_odbierz', () => {
    const NAGRODA = { rows: [{ id: 1, nazwa: 'Henna gratis', koszt_pkt: 50, ilosc: null, zajete: 0 }] };

    test('rezerwuje nagrodę i zwraca kod odbioru', async () => {
        const db = mockDb(
            ...INIT,
            NAGRODA,
            { rows: [{ n: 0, rez: 0 }] },     // moje oczekujące
            { rows: [{ saldo: 80 }] },
            { rows: { affectedRows: 1 } }      // INSERT odbiór
        );
        const res = await request(buildApp(db)).post('/api/klub/nagroda_odbierz')
            .send({ session: SESJA(), nagroda_id: 1 });
        expect(res.body.status).toBe('success');
        expect(res.body.kod).toMatch(/^[A-Z2-9]{6}$/);
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Odbiory/.test(c[0]));
        expect(ins[1][4]).toBe(50); // koszt_pkt snapshot
    });

    test('za mało dostępnych punktów (rezerwacje liczą się do salda)', async () => {
        const db = mockDb(
            ...INIT,
            NAGRODA,
            { rows: [{ n: 1, rez: 40 }] },    // 40 pkt już zarezerwowane
            { rows: [{ saldo: 80 }] }          // dostępne = 40 < 50
        );
        const res = await request(buildApp(db)).post('/api/klub/nagroda_odbierz')
            .send({ session: SESJA(), nagroda_id: 1 });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/za mało/i);
    });

    test('limit 3 oczekujących odbiorów na klienta', async () => {
        const db = mockDb(...INIT, NAGRODA, { rows: [{ n: 3, rez: 150 }] });
        const res = await request(buildApp(db)).post('/api/klub/nagroda_odbierz')
            .send({ session: SESJA(), nagroda_id: 1 });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/3 nagrody/i);
    });

    test('nagroda z wyczerpanym limitem → odmowa', async () => {
        const db = mockDb(...INIT, { rows: [{ id: 1, nazwa: 'X', koszt_pkt: 50, ilosc: 2, zajete: 2 }] });
        const res = await request(buildApp(db)).post('/api/klub/nagroda_odbierz')
            .send({ session: SESJA(), nagroda_id: 1 });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/wyczerpana/i);
    });

    test('bez sesji → SESJA', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/klub/nagroda_odbierz').send({ session: 'zly', nagroda_id: 1 });
        expect(res.body.code).toBe('SESJA');
    });
});

// ─── POST loj_odbior_rozstrzygnij (panel) ─────────────────────
describe('POST /api/lojalnosc — loj_odbior_rozstrzygnij', () => {
    const ODBIOR = { rows: [{ id: 7, id_klienta: '42', nagroda_nazwa: 'Henna', koszt_pkt: 50, kod: 'ABC234', status: 'OCZEKUJE' }] };
    const valid = { action: 'loj_odbior_rozstrzygnij', tenant_id: 't-loj-odb', id: 7, decyzja: 'WYDANE', user_log: 'Szefowa' };

    test('WYDANE zdejmuje punkty z ledgera (zrodlo NAGRODA, ref ODB@id)', async () => {
        const db = mockDb(...INIT, ROLA_ADMIN, ODBIOR, { rows: { affectedRows: 1 } }, { rows: { affectedRows: 1 } });
        const res = await request(buildApp(db)).post('/api/lojalnosc').send(valid);
        expect(res.body.status).toBe('success');
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]));
        expect(ins).toBeTruthy();
        expect(ins[1][2]).toBe(-50);
        expect(ins[1][4]).toBe('ODB@7');
        expect(ins[0]).toMatch(/'NAGRODA'/);
    });

    test('ODRZUCONE nie dotyka ledgera', async () => {
        const db = mockDb(...INIT, ROLA_ADMIN, ODBIOR, { rows: { affectedRows: 1 } });
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, tenant_id: 't-loj-odb2', decyzja: 'ODRZUCONE' });
        expect(res.body.status).toBe('success');
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]))).toBe(false);
    });

    test('już rozstrzygnięty → odmowa (bez podwójnego zdjęcia punktów)', async () => {
        const db = mockDb(...INIT, ROLA_ADMIN, { rows: [{ id: 7, id_klienta: '42', nagroda_nazwa: 'X', koszt_pkt: 50, kod: 'ABC234', status: 'WYDANE' }] });
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, tenant_id: 't-loj-odb3' });
        expect(res.body.status).toBe('error');
    });

    test('recepcja NIE rozstrzyga (pilot admin-only)', async () => {
        const db = mockDb(...INIT, ROLA_RECEPCJA);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, tenant_id: 't-loj-odb4' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/uprawnień/i);
    });
});

// ─── POST /klub/promocja_biore ────────────────────────────────
describe('POST /api/klub/promocja_biore', () => {
    test('tworzy zgłoszenie dla salonu', async () => {
        const db = mockDb(
            ...INIT,
            { rows: [{ id: 3, tytul: 'Środa -20%' }] },  // promocja aktywna
            { rows: [] },                                  // brak duplikatu
            { rows: { affectedRows: 1 } }
        );
        const res = await request(buildApp(db)).post('/api/klub/promocja_biore')
            .send({ session: SESJA(), promocja_id: 3 });
        expect(res.body.status).toBe('success');
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Zgloszenia/.test(c[0]))).toBe(true);
    });

    test('duplikat zgłoszenia → sukces bez drugiego INSERTa', async () => {
        const db = mockDb(
            ...INIT,
            { rows: [{ id: 3, tytul: 'Środa -20%' }] },
            { rows: [{ id: 99 }] }                         // już jest NOWE
        );
        const res = await request(buildApp(db)).post('/api/klub/promocja_biore')
            .send({ session: SESJA(), promocja_id: 3 });
        expect(res.body.status).toBe('success');
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Zgloszenia/.test(c[0]))).toBe(false);
    });

    test('promocja nieaktywna/po terminie → odmowa', async () => {
        const db = mockDb(...INIT, { rows: [] });
        const res = await request(buildApp(db)).post('/api/klub/promocja_biore')
            .send({ session: SESJA(), promocja_id: 3 });
        expect(res.body.status).toBe('error');
    });
});

// ─── POST /klub/push_zapisz ───────────────────────────────────
describe('POST /api/klub/push_zapisz', () => {
    test('zapisuje poprawną subskrypcję', async () => {
        const db = mockDb(...INIT, { rows: { affectedRows: 0 } }, { rows: { affectedRows: 1 } });
        const res = await request(buildApp(db)).post('/api/klub/push_zapisz').send({
            session: SESJA(),
            subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'k1', auth: 'k2' } }
        });
        expect(res.body.status).toBe('success');
    });

    test('odrzuca endpoint nie-https', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/klub/push_zapisz').send({
            session: SESJA(),
            subscription: { endpoint: 'http://zly.example', keys: { p256dh: 'k1', auth: 'k2' } }
        });
        expect(res.body.status).toBe('error');
    });
});

// ─── POST loj_nagroda_zapisz / loj_push_wyslij (panel) ────────
describe('POST /api/lojalnosc — zarządzanie treścią', () => {
    test('admin dodaje nagrodę', async () => {
        const db = mockDb(...INIT, FEATURE_ON, ROLA_ADMIN, { rows: { affectedRows: 1 } });
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({
            action: 'loj_nagroda_zapisz', tenant_id: 't-loj-ng1',
            nazwa: 'Henna gratis', koszt_pkt: 50, ilosc: '', user_log: 'Szefowa'
        });
        expect(res.body.status).toBe('success');
    });

    test('odrzuca koszt 0 pkt', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({
            action: 'loj_nagroda_zapisz', tenant_id: 't-loj-ng2',
            nazwa: 'X', koszt_pkt: 0, user_log: 'Szefowa'
        });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca zdjęcie nie będące URL-em', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({
            action: 'loj_nagroda_zapisz', tenant_id: 't-loj-ng3',
            nazwa: 'X', koszt_pkt: 10, img_url: 'javascript:alert(1)', user_log: 'Szefowa'
        });
        expect(res.body.status).toBe('error');
    });

    test('admin dodaje promocję z datami i BIORĘ', async () => {
        const db = mockDb(...INIT, FEATURE_ON, ROLA_ADMIN, { rows: { affectedRows: 1 } });
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({
            action: 'loj_promocja_zapisz', tenant_id: 't-loj-pr1',
            tytul: 'Środa -20%', data_od: '2026-07-15', data_do: '2026-07-15', promocja_dnia: 1, user_log: 'Szefowa'
        });
        expect(res.body.status).toBe('success');
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Promocje/.test(c[0]));
        expect(ins[1][7]).toBe(1); // promocja_dnia
    });

    test('push bez kluczy VAPID w env → czytelny błąd', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({
            action: 'loj_push_wyslij', tenant_id: 't-loj-ps1',
            tytul: 'Hej', tresc: 'Promocja!', user_log: 'Szefowa'
        });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/VAPID|skonfigurowane/i);
    });
});

// ═══════════════════ KAMPANIE — segmenty i harmonogram ═══════════════════

// ─── pasujeSegment (ocena po stronie JS dla /klub/me) ─────────
describe('pasujeSegment', () => {
    const TERAZ = new Date('2026-07-10T12:00:00');
    const fakty = (saldo, sprzedaze) => ({ saldo, sprzedaze, teraz: TERAZ });

    test('WSZYSCY pasuje zawsze', () => {
        expect(pasujeSegment({ segment_typ: 'WSZYSCY' }, fakty(0, []))).toBe(true);
    });
    test('PUNKTY_MIN: 120 pkt vs próg 100 → tak; 80 vs 100 → nie', () => {
        const seg = { segment_typ: 'PUNKTY_MIN', segment_wartosc: '100' };
        expect(pasujeSegment(seg, fakty(120, []))).toBe(true);
        expect(pasujeSegment(seg, fakty(80, []))).toBe(false);
    });
    test('ZABIEG: dopasowanie po typ_zabiegu i po nazwie (LIKE), okno dni respektowane', () => {
        const seg = { segment_typ: 'ZABIEG', segment_wartosc: 'endermologia', segment_dni: 90 };
        const swiezy = [{ zabieg: 'Endermologia całe ciało', typ_zabiegu: null, data: '2026-07-01' }];
        const poTypie = [{ zabieg: 'Pakiet X', typ_zabiegu: 'Endermologia', data: '2026-06-20' }];
        const stary = [{ zabieg: 'Endermologia', typ_zabiegu: null, data: '2026-01-01' }];
        expect(pasujeSegment(seg, fakty(0, swiezy))).toBe(true);
        expect(pasujeSegment(seg, fakty(0, poTypie))).toBe(true);
        expect(pasujeSegment(seg, fakty(0, stary))).toBe(false);
    });
    test('BRAK_WIZYTY: ostatnia wizyta starsza niż okno → tak; świeża → nie', () => {
        const seg = { segment_typ: 'BRAK_WIZYTY', segment_dni: 60 };
        expect(pasujeSegment(seg, fakty(0, [{ zabieg: 'X', data: '2026-03-01' }]))).toBe(true);
        expect(pasujeSegment(seg, fakty(0, [{ zabieg: 'X', data: '2026-07-05' }]))).toBe(false);
    });
});

// ─── POST loj_kampania_zapisz / anuluj ────────────────────────
describe('POST /api/lojalnosc — kampanie', () => {
    const valid = {
        action: 'loj_kampania_zapisz', tenant_id: 't-loj-km1',
        tytul: 'Weekend -15%', tresc: 'Tylko sob-nd na masaże!',
        segment_typ: 'WSZYSCY', user_log: 'Szefowa'
    };

    test('wysyłka natychmiastowa: kampania WYSLANA, wiadomość w apce mimo braku VAPID', async () => {
        const db = mockDb(
            ...INIT,
            FEATURE_ON,
            ROLA_ADMIN,
            { rows: { affectedRows: 1, insertId: 5 } }, // INSERT kampania (WYSYLANIE)
            { rows: [] },                                // SELECT subskrypcje push (brak)
            { rows: { affectedRows: 1 } }                // UPDATE → WYSLANA
        );
        const res = await request(buildApp(db)).post('/api/lojalnosc').send(valid);
        expect(res.body.status).toBe('success');
        expect(res.body.dostarczono).toBe(0); // brak VAPID/subów — ale kampania jest WYSLANA (skrzynka w apce)
        const upd = db.query.mock.calls.find(c => /SET status = 'WYSLANA'/.test(c[0]));
        expect(upd).toBeTruthy();
    });

    test('zaplanowana: status PLANOWANA, bez wysyłki', async () => {
        const db = mockDb(...INIT, FEATURE_ON, ROLA_ADMIN, { rows: { affectedRows: 1, insertId: 6 } });
        const res = await request(buildApp(db)).post('/api/lojalnosc')
            .send({ ...valid, tenant_id: 't-loj-km2', wyslij_at: '2026-07-15T10:30' });
        expect(res.body.status).toBe('success');
        expect(res.body.zaplanowana).toBe(1);
        const ins = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Kampanie/.test(c[0]));
        expect(ins[1]).toContain('2026-07-15 10:30:00');
        expect(ins[1]).toContain('PLANOWANA');
        expect(db.query.mock.calls.some(c => /SET status = 'WYSLANA'/.test(c[0]))).toBe(false);
    });

    test('segment PUNKTY_MIN bez progu → walidacja', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc')
            .send({ ...valid, tenant_id: 't-loj-km3', segment_typ: 'PUNKTY_MIN', segment_wartosc: '' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/segment/i);
    });

    test('zły format terminu → walidacja', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc')
            .send({ ...valid, tenant_id: 't-loj-km4', wyslij_at: 'jutro rano' });
        expect(res.body.status).toBe('error');
    });

    test('recepcja NIE tworzy kampanii', async () => {
        const db = mockDb(...INIT, FEATURE_ON, ROLA_RECEPCJA);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({ ...valid, tenant_id: 't-loj-km5' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/uprawnień/i);
    });

    test('anulowanie działa tylko dla PLANOWANEJ', async () => {
        const dbOk = mockDb(...INIT, ROLA_ADMIN, { rows: { affectedRows: 1 } });
        const r1 = await request(buildApp(dbOk)).post('/api/lojalnosc')
            .send({ action: 'loj_kampania_anuluj', tenant_id: 't-loj-km6', id: 5, user_log: 'Szefowa' });
        expect(r1.body.status).toBe('success');
        const dbJuz = mockDb(...INIT, ROLA_ADMIN, { rows: { affectedRows: 0 } });
        const r2 = await request(buildApp(dbJuz)).post('/api/lojalnosc')
            .send({ action: 'loj_kampania_anuluj', tenant_id: 't-loj-km7', id: 5, user_log: 'Szefowa' });
        expect(r2.body.status).toBe('error');
    });
});

// ─── Upload grafik + serwowanie ───────────────────────────────
describe('upload grafik Klubu', () => {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const TMP = path.join(os.tmpdir(), 'klub-test-uploads-' + process.pid);
    const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);

    beforeAll(() => { process.env.UPLOADS_DIR = TMP; });
    afterAll(() => {
        delete process.env.UPLOADS_DIR;
        try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
    });

    test('admin wgrywa JPG → dostaje URL, plik ląduje na dysku', async () => {
        const db = mockDb(...INIT, FEATURE_ON, ROLA_ADMIN, { rows: { affectedRows: 1 } });
        const res = await request(buildApp(db)).post('/api/lojalnosc/upload')
            .field('tenant_id', 't-loj-up1').field('user_log', 'Szefowa')
            .attach('plik', JPG, { filename: 'foto.jpg', contentType: 'image/jpeg' });
        expect(res.body.status).toBe('success');
        expect(res.body.url).toMatch(/^\/api\/klub\/img\/t-loj-up1\/[a-f0-9-]{36}\.jpg$/);
        const nazwa = res.body.url.split('/').pop();
        expect(fs.existsSync(path.join(TMP, 't-loj-up1', 'klub', nazwa))).toBe(true);
    });

    test('plik nie-obraz → odmowa (fileFilter)', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/lojalnosc/upload')
            .field('tenant_id', 't-loj-up2').field('user_log', 'Szefowa')
            .attach('plik', Buffer.from('#!/bin/sh'), { filename: 'zly.sh', contentType: 'application/x-sh' });
        expect(res.body.status).toBe('error');
    });

    test('recepcja NIE wgra pliku (RBAC)', async () => {
        const db = mockDb(...INIT, FEATURE_ON, ROLA_RECEPCJA);
        const res = await request(buildApp(db)).post('/api/lojalnosc/upload')
            .field('tenant_id', 't-loj-up3').field('user_log', 'Recepcja')
            .attach('plik', JPG, { filename: 'foto.jpg', contentType: 'image/jpeg' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/uprawnień/i);
    });

    test('serwowanie: poprawny plik → 200, zła nazwa/traversal → 404', async () => {
        const db = mockDbAlways([]);
        const app = buildApp(db);
        const dir = path.join(TMP, 't-loj-up4', 'klub');
        fs.mkdirSync(dir, { recursive: true });
        const nazwa = '00000000-0000-4000-8000-000000000000.jpg';
        fs.writeFileSync(path.join(dir, nazwa), JPG);
        const ok = await request(app).get('/api/klub/img/t-loj-up4/' + nazwa);
        expect(ok.status).toBe(200);
        const zly = await request(app).get('/api/klub/img/t-loj-up4/..%2F..%2Fsekret.jpg');
        expect(zly.status).toBe(404);
        const zly2 = await request(app).get('/api/klub/img/t-loj-up4/dowolny.jpg');
        expect(zly2.status).toBe(404);
    });

    test('kampania przyjmuje zdjęcie z uploadu, odrzuca javascript:', async () => {
        const dbOk = mockDb(...INIT, FEATURE_ON, ROLA_ADMIN,
            { rows: { affectedRows: 1, insertId: 9 } }, { rows: [] }, { rows: { affectedRows: 1 } });
        const r1 = await request(buildApp(dbOk)).post('/api/lojalnosc').send({
            action: 'loj_kampania_zapisz', tenant_id: 't-loj-up5', tytul: 'X', tresc: 'Y',
            segment_typ: 'WSZYSCY', img_url: '/api/klub/img/t-loj-up5/00000000-0000-4000-8000-000000000000.jpg',
            user_log: 'Szefowa'
        });
        expect(r1.body.status).toBe('success');
        const dbZly = mockDbAlways([]);
        const r2 = await request(buildApp(dbZly)).post('/api/lojalnosc').send({
            action: 'loj_kampania_zapisz', tenant_id: 't-loj-up6', tytul: 'X', tresc: 'Y',
            segment_typ: 'WSZYSCY', img_url: 'javascript:alert(1)', user_log: 'Szefowa'
        });
        expect(r2.body.status).toBe('error');
    });
});

// ─── Rejestracja online (link IG) + reset PIN ─────────────────
describe('POST /api/klub/rejestracja', () => {
    const REJ = () => makeKlubToken({ t: 't-rej-a', k: 'rejestracja', typ: 'rej', exp: Date.now() + 60000 });
    const valid = () => ({ token: REJ(), imie: 'Nowa Osoba', telefon: '511 222 333', pin: '1234', zgoda: true });

    test('nowy numer → kartoteka + konto + bonus + sesja od ręki', async () => {
        const db = mockDb(
            ...INIT,
            { rows: [] },                              // brak konta na ten numer
            { rows: [] },                              // brak klientki w kartotece
            { rows: [{ maxId: 41 }] },                 // MAX id_klienta
            { rows: { affectedRows: 1 } },             // INSERT Klienci
            { rows: { affectedRows: 1 } },             // INSERT Konta
            { rows: [{ bonus_powitalny_pkt: 20 }] },   // ustawienia bonusu
            { rows: { affectedRows: 1 } }              // INSERT bonus do ledgera
        );
        const res = await request(buildApp(db)).post('/api/klub/rejestracja').send(valid());
        expect(res.body.status).toBe('success');
        expect(res.body.kod).toBe('NOWE');
        expect(res.body.session).toBeTruthy();
        expect(res.body.bonus).toBe(20);
        const insK = db.query.mock.calls.find(c => /INSERT INTO Klienci/.test(c[0]));
        expect(insK[1][2]).toBe('42');                 // nowe id = MAX+1
        const insB = db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]));
        expect(insB[1][2]).toBe(20);
        expect(insB[0]).toMatch(/powitalny/i);   // powód w SQL
        expect(insB[1][3]).toBe('REJ@42');       // idempotencja per klient
    });

    test('numer istniejącej klientki → wniosek, konto NIE powstaje', async () => {
        const db = mockDb(
            ...INIT,
            { rows: [] },                                                     // brak konta
            { rows: [{ id_klienta: '7', telefon: '511-222-333', status: '', zmarly: 0 }] }, // jest w kartotece
            { rows: [] },                                                     // brak duplikatu wniosku
            { rows: { affectedRows: 1 } }                                     // INSERT wniosek
        );
        const res = await request(buildApp(db)).post('/api/klub/rejestracja').send(valid());
        expect(res.body.status).toBe('success');
        expect(res.body.kod).toBe('WNIOSEK');
        expect(res.body.session).toBeUndefined();
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Wnioski/.test(c[0]))).toBe(true);
        expect(db.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Konta/.test(c[0]))).toBe(false);
    });

    test('numer z istniejącym kontem → komunikat, bez zmian', async () => {
        const db = mockDb(...INIT, { rows: [{ id: 1 }] });
        const res = await request(buildApp(db)).post('/api/klub/rejestracja').send(valid());
        expect(res.body.kod).toBe('MASZ_KONTO');
    });

    test('token sesyjny NIE działa jako rejestracyjny', async () => {
        const db = mockDbAlways([]);
        const zly = makeKlubToken({ t: 't-rej-a', k: '42', typ: 'ses', exp: Date.now() + 60000 });
        const res = await request(buildApp(db)).post('/api/klub/rejestracja').send({ ...valid(), token: zly });
        expect(res.body.status).toBe('error');
    });
});

describe('POST /api/klub/reset_pin', () => {
    test('konto istnieje → wniosek RESET; brak konta → TA SAMA odpowiedź (bez enumeracji)', async () => {
        const dbJest = mockDb(
            ...INIT,
            { rows: [{ tenant_id: 't-rp-a', id_klienta: '42' }] },
            { rows: [] },                              // brak duplikatu
            { rows: { affectedRows: 1 } }              // INSERT wniosek
        );
        const r1 = await request(buildApp(dbJest)).post('/api/klub/reset_pin').send({ telefon: '500123456' });
        const dbBrak = mockDb(...INIT, { rows: [] });
        const r2 = await request(buildApp(dbBrak)).post('/api/klub/reset_pin').send({ telefon: '500123456' });
        expect(r1.body.status).toBe('success');
        expect(r2.body.status).toBe('success');
        expect(r1.body.message).toBe(r2.body.message);
        expect(dbJest.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Wnioski/.test(c[0]))).toBe(true);
        expect(dbBrak.query.mock.calls.some(c => /INSERT INTO Lojalnosc_Wnioski/.test(c[0]))).toBe(false);
    });
});

describe('POST /api/lojalnosc — loj_wniosek_wyslij', () => {
    test('generuje link aktywacyjny + SMS na numer Z KARTOTEKI', async () => {
        const db = mockDb(
            ...INIT,
            ROLA_ADMIN,
            { rows: [{ id: 3, id_klienta: '42', imie: 'Anna', typ: 'KONTO', status: 'NOWY' }] },
            { rows: [{ id_klienta: '42', imie_nazwisko: 'Anna Kowalska', telefon: '500 123 456', status: '', zmarly: 0 }] },
            { rows: { affectedRows: 1 } }
        );
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({
            action: 'loj_wniosek_wyslij', tenant_id: 't-ww-a', id: 3, user_log: 'Szefowa'
        });
        expect(res.body.status).toBe('success');
        expect(res.body.telefon).toBe('500 123 456');   // numer z kartoteki, nie z wniosku
        expect(res.body.url).toMatch(/\/klub\.html\?a=/);
        expect(res.body.sms_uri).toMatch(/^sms:500123456\?body=/);
        expect(res.body.qr_sms).toMatch(/^data:image\/png/);
    });

    test('recepcja NIE wyśle (RBAC)', async () => {
        const db = mockDb(...INIT, ROLA_RECEPCJA);
        const res = await request(buildApp(db)).post('/api/lojalnosc').send({
            action: 'loj_wniosek_wyslij', tenant_id: 't-ww-b', id: 3, user_log: 'Recepcja'
        });
        expect(res.body.status).toBe('error');
    });
});

// ─── /klub/me — wiadomości i targetowane promocje ─────────────
describe('POST /api/klub/me — kampanie w apce', () => {
    test('wiadomość WSZYSCY widoczna; promocja PUNKTY_MIN ukryta gdy saldo za małe', async () => {
        const sesja = makeKlubToken({ t: 't-klub-w', k: '42', typ: 'ses', exp: Date.now() + 80 * 24 * 60 * 60 * 1000 });
        const db = mockDb(
            ...INIT,
            { rows: [{ status: 'AKTYWNE' }] },
            { rows: [{ imie_nazwisko: 'Anna Kowalska', telefon: '500123456', status: '', zmarly: 0 }] },
            { rows: [{ saldo: 30 }] },                    // saldo klienta: 30
            { rows: [] },                                  // wpisy
            { rows: [] },                                  // ustawienia
            { rows: [{ rez: 0 }] },                        // rezerwacje
            { rows: [] },                                  // nagrody
            { rows: [] },                                  // odbiory
            { rows: [{ id: 1, tytul: 'VIP tylko', opis: '', tresc: '', img_url: '', promocja_dnia: 0, data_od: null, data_do: null, segment_typ: 'PUNKTY_MIN', segment_wartosc: '100', segment_dni: null }] },
            { rows: [] },                                  // fakty sprzedaże
            { rows: [{ id: 9, tytul: 'Hej!', tresc: 'Zapraszamy', segment_typ: 'WSZYSCY', segment_wartosc: '', segment_dni: null, wyslano_at: '2026-07-09' }] }
        );
        const res = await request(buildApp(db)).post('/api/klub/me').send({ session: sesja });
        expect(res.body.status).toBe('success');
        expect(res.body.promocje).toHaveLength(0);        // VIP odfiltrowana (30 < 100 pkt)
        expect(res.body.wiadomosci).toHaveLength(1);      // kampania dla wszystkich widoczna
        expect(res.body.wiadomosci[0].tytul).toBe('Hej!');
    });
});
