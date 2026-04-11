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
