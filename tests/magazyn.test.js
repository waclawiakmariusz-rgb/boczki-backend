// tests/magazyn.test.js
// Testy routera magazyn.js z mockowaną bazą danych

const request = require('supertest');
const express = require('express');
const { mockDb, mockDbAlways } = require('./helpers/mockDb');

function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/magazyn')(db));
    return app;
}

const TENANT = 'test-salon-001';

// ─── ACTION: add ──────────────────────────────────────────────
describe('POST /api/magazyn — add', () => {
    const validPayload = {
        action: 'add',
        tenant_id: TENANT,
        nazwa: 'Krem do twarzy',
        ilosc: '5',
        netto: '20.00',
        brutto: '24.60',
        waznosc: '2026-12-31',
        pracownik: 'Anna',
    };

    test('dodaje produkt z poprawnymi danymi', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/magazyn').send(validPayload);
        expect(res.body.status).toBe('success');
    });

    test('akceptuje ilość z przecinkiem (1,5 szt.)', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/magazyn').send({ ...validPayload, ilosc: '1,5' });
        expect(res.body.status).toBe('success');
    });

    test('odrzuca ilość jako datę (problem Excel)', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/magazyn').send({ ...validPayload, ilosc: '1900-01-01 00:00:00' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/nieprawidłowa/i);
    });

    test('odrzuca ujemną ilość', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/magazyn').send({ ...validPayload, ilosc: '-3' });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca brak nazwy produktu', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/magazyn').send({ ...validPayload, nazwa: '' });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca brak tenant_id', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db)).post('/api/magazyn').send({ ...validPayload, tenant_id: '' });
        expect(res.body.status).toBe('error');
    });
});

// ─── ACTION: update ───────────────────────────────────────────
describe('POST /api/magazyn — update', () => {
    test('aktualizuje stan z poprawnymi danymi', async () => {
        const db = mockDb(
            { rows: [{ id: '123', nazwa_produktu: 'Krem', ilosc: '10' }] },
            { rows: { affectedRows: 1 } }
        );
        const res = await request(buildApp(db)).post('/api/magazyn').send({
            action: 'update',
            tenant_id: TENANT,
            id: '123',
            ilosc: '3',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
    });

    test('akceptuje przyrost z przecinkiem (2,5 szt.)', async () => {
        const db = mockDb(
            { rows: [{ id: '123', nazwa_produktu: 'Krem', ilosc: '10' }] },
            { rows: { affectedRows: 1 } }
        );
        const res = await request(buildApp(db)).post('/api/magazyn').send({
            action: 'update',
            tenant_id: TENANT,
            id: '123',
            ilosc: '2,5',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
    });

    test('odrzuca przyrost jako datę', async () => {
        const db = mockDb({ rows: [{ id: '123', nazwa_produktu: 'Krem', ilosc: '10' }] });
        const res = await request(buildApp(db)).post('/api/magazyn').send({
            action: 'update',
            tenant_id: TENANT,
            id: '123',
            ilosc: '2024-01-03',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('error');
    });
});

// ─── ACTION: edit_product ─────────────────────────────────────
describe('POST /api/magazyn — edit_product', () => {
    const existingProduct = { id: '1', nazwa_produktu: 'Krem', ilosc: '10', data_waznosci: '2026-01-01', cena_netto: '20.00', cena_brutto: '24.60' };

    test('edytuje produkt z poprawnymi danymi', async () => {
        const db = mockDb(
            { rows: [existingProduct] },
            { rows: { affectedRows: 1 } }
        );
        const res = await request(buildApp(db)).post('/api/magazyn').send({
            action: 'edit_product',
            tenant_id: TENANT,
            id: '1',
            nazwa: 'Krem XL',
            ilosc: '15',
            netto: '22,50',
            brutto: '27,67',
            waznosc: '2027-01-01',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
    });

    test('odrzuca ujemną cenę netto', async () => {
        const db = mockDb({ rows: [existingProduct] });
        const res = await request(buildApp(db)).post('/api/magazyn').send({
            action: 'edit_product',
            tenant_id: TENANT,
            id: '1',
            nazwa: 'Krem',
            ilosc: '10',
            netto: '-5',
            brutto: '24.60',
            waznosc: '2027-01-01',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('error');
    });
});
