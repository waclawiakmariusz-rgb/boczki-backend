// tests/klienci.test.js
// Testy routera klienci.js — manage_deposit

const request = require('supertest');
const express = require('express');
const { mockDb, mockDbAlways } = require('./helpers/mockDb');

function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/klienci')(db));
    return app;
}

const TENANT = 'test-salon-001';

// ─── manage_deposit: WPŁATA ───────────────────────────────────
describe('POST /api/klienci — manage_deposit WPŁATA', () => {
    const validDeposit = {
        action: 'manage_deposit',
        tenant_id: TENANT,
        typ: 'WPŁATA',
        klient: 'Kowalska Maria',
        id_klienta: '1001',
        kwota: '500',
        metoda: 'Gotówka',
        cel: 'Zabieg laserowy',
        pracownik: 'Anna',
    };

    test('przyjmuje zadatek z poprawnymi danymi', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/klienci').send(validDeposit);
        expect(res.body.status).toBe('success');
    });

    test('akceptuje kwotę z przecinkiem (499,99)', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/klienci').send({ ...validDeposit, kwota: '499,99' });
        expect(res.body.status).toBe('success');
    });

    test('odrzuca ujemną kwotę zadatku', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/klienci').send({ ...validDeposit, kwota: '-100' });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca kwotę jako datę', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/klienci').send({ ...validDeposit, kwota: '1900-01-01' });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca kwotę jako tekst', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/klienci').send({ ...validDeposit, kwota: 'pięćset' });
        expect(res.body.status).toBe('error');
    });
});

// ─── manage_deposit: EDIT_AMOUNT ──────────────────────────────
describe('POST /api/klienci — manage_deposit EDIT_AMOUNT', () => {
    test('zmienia kwotę zadatku', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/klienci').send({
            action: 'manage_deposit',
            tenant_id: TENANT,
            typ: 'EDIT_AMOUNT',
            id_zadatku: 'DEP-001',
            nowa_kwota: '600',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
    });

    test('odrzuca ujemną nową kwotę', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/klienci').send({
            action: 'manage_deposit',
            tenant_id: TENANT,
            typ: 'EDIT_AMOUNT',
            id_zadatku: 'DEP-001',
            nowa_kwota: '-50',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca kwotę jako datę', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/klienci').send({
            action: 'manage_deposit',
            tenant_id: TENANT,
            typ: 'EDIT_AMOUNT',
            id_zadatku: 'DEP-001',
            nowa_kwota: '2024-01-01',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('error');
    });
});

// ─── get_clients ──────────────────────────────────────────────
describe('GET /api/klienci — get_clients', () => {
    test('zwraca listę klientów', async () => {
        const db = mockDb(
            { rows: [{ id: '1001', imie: 'Maria', nazwisko: 'Kowalska' }] },
            { rows: [] }
        );
        const res = await request(buildApp(db))
            .get('/api/klienci')
            .query({ action: 'get_clients', tenant_id: TENANT });
        expect(res.status).toBe(200);
    });

    test('odrzuca brak tenant_id', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db))
            .get('/api/klienci')
            .query({ action: 'get_clients' });
        expect(res.body.status).toBe('error');
    });
});

// ─── manage_deposit: PRZEPISZ (bon kupiony na siebie, wręczony komuś innemu) ──
// Kluczowa właściwość: zmienia WYŁĄCZNIE właściciela. Kwota/data/metoda zostają,
// więc raport utargu z dnia wpłaty się nie zmienia (obejście „usuń u jednego,
// dodaj u drugiego" zabierało wpis z raportu — raporty pomijają USUNIĘTY).

// Mock reagujący na treść SQL — handler robi SELECT, potem UPDATE.
function mockDbSql(pary) {
    return {
        query: jest.fn((sql, paramsOrCb, maybeCb) => {
            const cb = typeof paramsOrCb === 'function' ? paramsOrCb : maybeCb;
            const s = String(sql || '');
            for (const [fragment, wynik] of pary) {
                if (s.includes(fragment)) { if (cb) cb(wynik.err || null, wynik.rows); return; }
            }
            if (cb) cb(null, []);
        })
    };
}

// Bon podarunkowy (bon: 1) — tylko taki wolno przepisać na inną osobę.
const AKTYWNY_ZADATEK = [{ id_klienta: '1001', klient: 'Maziuk Wojciech', kwota: 1000, status: 'AKTYWNY', bon: 1 }];

function przepiszBody(extra = {}) {
    return {
        action: 'manage_deposit', tenant_id: TENANT, typ: 'PRZEPISZ',
        id_zadatku: 'DEP-1', nowy_id_klienta: '2002', nowy_klient: 'Tatol Anna',
        powod: 'Bon wręczony, zgoda Ola', pracownik: 'Marta', ...extra,
    };
}

describe('POST /api/klienci — manage_deposit PRZEPISZ', () => {
    test('przepisuje aktywny zadatek na nowego klienta', async () => {
        const db = mockDbSql([
            ['SELECT id_klienta, klient, kwota, status',{ rows: AKTYWNY_ZADATEK }],
            ['UPDATE Zadatki SET id_klienta', { rows: { affectedRows: 1 } }],
        ]);
        const res = await request(buildApp(db)).post('/api/klienci').send(przepiszBody());
        expect(res.body.status).toBe('success');
        expect(res.body.message).toContain('Tatol Anna');
    });

    test('aktualizuje OBA pola właściciela (id_klienta + klient)', async () => {
        // Rozliczanie zadatków dopasowuje klienta raz po ID, raz po nazwisku —
        // sama zmiana ID zostawiłaby wpis w niespójnym stanie.
        const db = mockDbSql([
            ['SELECT id_klienta, klient, kwota, status',{ rows: AKTYWNY_ZADATEK }],
            ['UPDATE Zadatki SET id_klienta', { rows: { affectedRows: 1 } }],
        ]);
        await request(buildApp(db)).post('/api/klienci').send(przepiszBody());
        const upd = db.query.mock.calls.find(c => String(c[0]).includes('UPDATE Zadatki SET id_klienta'));
        expect(upd).toBeDefined();
        expect(String(upd[0])).toContain('klient = ?');
        expect(upd[1]).toContain('2002');
        expect(upd[1]).toContain('Tatol Anna');
        // kwota/data/metoda NIE mogą być ruszane — inaczej zmieni się raport utargu
        expect(String(upd[0])).not.toContain('kwota');
        expect(String(upd[0])).not.toContain('data_wplaty');
        expect(String(upd[0])).not.toContain('metoda');
    });

    test('odrzuca brak powodu (ślad audytowy wymagany)', async () => {
        const db = mockDbSql([['SELECT id_klienta, klient, kwota, status',{ rows: AKTYWNY_ZADATEK }]]);
        const res = await request(buildApp(db)).post('/api/klienci').send(przepiszBody({ powod: '' }));
        expect(res.body.status).toBe('error');
    });

    test('odrzuca brak wskazanego klienta', async () => {
        const db = mockDbSql([['SELECT id_klienta, klient, kwota, status',{ rows: AKTYWNY_ZADATEK }]]);
        const res = await request(buildApp(db)).post('/api/klienci').send(przepiszBody({ nowy_id_klienta: '', nowy_klient: '' }));
        expect(res.body.status).toBe('error');
    });

    test('odrzuca zadatek już rozliczony (tylko AKTYWNY wolno przepisać)', async () => {
        const db = mockDbSql([
            ['SELECT id_klienta, klient, kwota, status',{ rows: [{ ...AKTYWNY_ZADATEK[0], status: 'WYKORZYSTANY' }] }],
        ]);
        const res = await request(buildApp(db)).post('/api/klienci').send(przepiszBody());
        expect(res.body.status).toBe('error');
        expect(res.body.message).toContain('WYKORZYSTANY');
    });

    test('odrzuca nieistniejący zadatek', async () => {
        const db = mockDbSql([['SELECT id_klienta, klient, kwota, status',{ rows: [] }]]);
        const res = await request(buildApp(db)).post('/api/klienci').send(przepiszBody());
        expect(res.body.status).toBe('error');
    });

    test('odrzuca przepisanie na tego samego klienta', async () => {
        const db = mockDbSql([['SELECT id_klienta, klient, kwota, status',{ rows: AKTYWNY_ZADATEK }]]);
        const res = await request(buildApp(db)).post('/api/klienci').send(przepiszBody({ nowy_id_klienta: '1001' }));
        expect(res.body.status).toBe('error');
    });

    test('zgłasza błąd gdy zadatek zmienił status w międzyczasie (affectedRows 0)', async () => {
        const db = mockDbSql([
            ['SELECT id_klienta, klient, kwota, status',{ rows: AKTYWNY_ZADATEK }],
            ['UPDATE Zadatki SET id_klienta', { rows: { affectedRows: 0 } }],
        ]);
        const res = await request(buildApp(db)).post('/api/klienci').send(przepiszBody());
        expect(res.body.status).toBe('error');
    });
});

// ─── Znacznik bonu: PRZEPISZ działa TYLKO dla bonów podarunkowych ────────────
// W salonie bon jest zapisywany jako zadatek — kolumna `bon` to jedyne, co odróżnia
// go od zwykłej zaliczki. Zwykłej zaliczki nie wolno przenosić między kontami.
describe('manage_deposit — bon podarunkowy', () => {
    test('PRZEPISZ odrzuca zwykły zadatek (bon = 0)', async () => {
        const db = mockDbSql([
            ['SELECT id_klienta, klient, kwota, status, bon FROM Zadatki', { rows: [{ ...AKTYWNY_ZADATEK[0], bon: 0 }] }],
            ['UPDATE Zadatki SET id_klienta', { rows: { affectedRows: 1 } }],
        ]);
        const res = await request(buildApp(db)).post('/api/klienci').send(przepiszBody());
        expect(res.body.status).toBe('error');
        expect(res.body.message).toContain('bon podarunkowy');
        // nie wolno dotknąć rekordu
        expect(db.query.mock.calls.some(c => String(c[0]).includes('UPDATE Zadatki SET id_klienta'))).toBe(false);
    });

    test('WPŁATA zapisuje znacznik bonu gdy zaznaczony', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/klienci').send({
            action: 'manage_deposit', tenant_id: TENANT, typ: 'WPŁATA',
            klient: 'Maziuk Wojciech', id_klienta: '1001', kwota: '1000',
            metoda: 'Gotówka', cel: 'Bon podarunkowy', bon: true, pracownik: 'Marta',
        });
        const ins = db.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO Zadatki'));
        expect(String(ins[0])).toContain('bon');
        expect(ins[1][ins[1].length - 1]).toBe(1);
    });

    test('WPŁATA bez zaznaczenia zapisuje 0 (zwykła zaliczka)', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/klienci').send({
            action: 'manage_deposit', tenant_id: TENANT, typ: 'WPŁATA',
            klient: 'Kowalska Maria', id_klienta: '1002', kwota: '300',
            metoda: 'Karta', cel: 'Zaliczka na zabieg', pracownik: 'Ania',
        });
        const ins = db.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO Zadatki'));
        expect(ins[1][ins[1].length - 1]).toBe(0);
    });

    test('OZNACZ_BON ustawia znacznik na istniejącym zadatku', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/klienci').send({
            action: 'manage_deposit', tenant_id: TENANT, typ: 'OZNACZ_BON',
            id_zadatku: 'DEP-1', bon: true, pracownik: 'Marta',
        });
        expect(res.body.status).toBe('success');
        const upd = db.query.mock.calls.find(c => String(c[0]).includes('UPDATE Zadatki SET bon'));
        expect(upd).toBeDefined();
        expect(upd[1][0]).toBe(1);
    });

    test('OZNACZ_BON zgłasza błąd gdy zadatku nie ma', async () => {
        const db = mockDbAlways({ affectedRows: 0 });
        const res = await request(buildApp(db)).post('/api/klienci').send({
            action: 'manage_deposit', tenant_id: TENANT, typ: 'OZNACZ_BON',
            id_zadatku: 'NIEMA', bon: true, pracownik: 'Marta',
        });
        expect(res.body.status).toBe('error');
    });
});
