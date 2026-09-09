// tests/sprzedaz.test.js
// Testy routera sprzedaz.js

const request = require('supertest');
const express = require('express');
const { mockDb, mockDbAlways } = require('./helpers/mockDb');

function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/sprzedaz')(db));
    return app;
}

const TENANT = 'test-salon-001';

// ─── ACTION: add_sale ─────────────────────────────────────────
describe('POST /api/sprzedaz — add_sale (Zabieg)', () => {
    const validPayload = {
        action: 'add_sale',
        tenant_id: TENANT,
        typ_transakcji: 'Zabieg',
        sprzedawca: ['Anna'],
        klient: 'Kowalska Maria',
        zabieg_nazwa: 'Botoks',
        kwota: '250',
        platnosc: 'Karta',
        pracownik: 'Anna',
    };

    test('rejestruje sprzedaż z poprawnymi danymi', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send(validPayload);
        expect(res.body.status).toBe('success');
    });

    // Regresja 2026-09-09: data_sprzedazy szła jako obiekt Date z Node (parametr `?`) —
    // mysql2 serializuje go wg strefy PROCESU Node (na serwerze: UTC), z pominięciem
    // `SET time_zone` ustawionego na połączeniu przez db-strefa.js. Sprzedaż wchodziła
    // z godziną ~2h za wcześnie, mimo że Zadatki (przez SQL NOW()) miały już dobrą godzinę.
    test('data_sprzedazy zapisywana przez SQL NOW(), nie jako obiekt Date z Node', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/sprzedaz').send(validPayload);
        const ins = db.query.mock.calls.find(c => /INSERT INTO Sprzedaz/.test(c[0]));
        expect(ins[0]).toMatch(/NOW\(\)/);
        expect(ins[1].some(p => p instanceof Date)).toBe(false);
    });

    test('akceptuje kwotę z przecinkiem (249,99)', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({ ...validPayload, kwota: '249,99' });
        expect(res.body.status).toBe('success');
    });

    test('odrzuca kwotę jako datę', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({ ...validPayload, kwota: '1900-01-01' });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca ujemną kwotę', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({ ...validPayload, kwota: '-100' });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca brak tenant_id', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({ ...validPayload, tenant_id: '' });
        expect(res.body.status).toBe('error');
    });
});

// ─── ACTION: edit_sale ────────────────────────────────────────
describe('POST /api/sprzedaz — edit_sale', () => {
    const existingSale = { id: 'S1', klient: 'Kowalska', zabieg: 'Botoks', sprzedawca: 'Anna', kwota: '200', szczegoly: '', platnosc: 'Karta', id_klienta: '' };

    test('edytuje sprzedaż z poprawnymi danymi', async () => {
        const db = mockDb(
            { rows: [existingSale] },
            { rows: { affectedRows: 1 } }
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_sale',
            tenant_id: TENANT,
            id: 'S1',
            klient: 'Kowalska',
            zabieg_nazwa: 'Botoks Premium',
            sprzedawca: ['Anna'],
            kwota: '300,00',
            platnosc: 'Karta',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
    });

    test('odrzuca kwotę jako tekst', async () => {
        const db = mockDb({ rows: [existingSale] });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_sale',
            tenant_id: TENANT,
            id: 'S1',
            klient: 'Kowalska',
            zabieg_nazwa: 'Botoks',
            sprzedawca: ['Anna'],
            kwota: 'trzysta',
            platnosc: 'Karta',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('error');
    });
});

// ─── ACTION: add_sales_def (usługa) ───────────────────────────
describe('POST /api/sprzedaz — add_sales_def (usługa)', () => {
    test('dodaje usługę z poprawnymi danymi', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sales_def',
            tenant_id: TENANT,
            typ: 'zabieg',
            kategoria: 'Twarz',
            wariant: 'Botoks basic',
            cena: '199,00',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
    });

    test('akceptuje cenę z przecinkiem', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sales_def',
            tenant_id: TENANT,
            typ: 'zabieg',
            kategoria: 'Twarz',
            wariant: 'Mezoterapia',
            cena: '1,5',
            pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
    });
});
