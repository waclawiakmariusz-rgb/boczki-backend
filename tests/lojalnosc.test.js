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
const { makeLojalnosc, obliczPunkty, wyczyscCacheLoj, makeKlubToken, normalizujTelefon } = lojalnoscFactory;

function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', lojalnoscFactory(db));
    return app;
}

// 5 wpisów-wypełniaczy na init fabryki (CREATE ×3 + seed ×2)
const INIT = [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];

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
