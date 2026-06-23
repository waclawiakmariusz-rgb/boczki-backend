// tests/karnety.test.js
// Testy funkcji ważności zabiegów/karnetów (waznosc_dni, data_waznosci, extend/close/reopen).

const request = require('supertest');
const express = require('express');
const { mockDbAlways } = require('./helpers/mockDb');

function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/sprzedaz')(db));
    return app;
}

const TENANT = 'test-salon-001';

// Znajduje wywołanie db.query, którego SQL zawiera podany fragment. Zwraca { sql, params }.
function findQuery(db, fragment) {
    const calls = db.query.mock.calls;
    for (const c of calls) {
        const sql = String(c[0] || '');
        if (sql.includes(fragment)) {
            const params = Array.isArray(c[1]) ? c[1] : [];
            return { sql, params };
        }
    }
    return null;
}

// ─── add_sales_def — zapis waznosc_dni do Uslugi ──────────────
describe('add_sales_def — waznosc_dni', () => {
    test('zapisuje liczbę dni do INSERT INTO Uslugi', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sales_def', tenant_id: TENANT, typ: 'zabieg',
            kategoria: 'Twarz', wariant: '10x LPG', cena: '500', waznosc_dni: '90', pracownik: 'Anna',
        });
        const q = findQuery(db, 'INSERT INTO Uslugi');
        expect(q).not.toBeNull();
        expect(q.sql).toContain('waznosc_dni');
        // ostatni parametr to waznosc_dni
        expect(q.params[q.params.length - 1]).toBe(90);
    });

    test('pusta wartość = bezterminowo (NULL)', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sales_def', tenant_id: TENANT, typ: 'zabieg',
            kategoria: 'Twarz', wariant: 'Pojedynczy', cena: '100', waznosc_dni: '', pracownik: 'Anna',
        });
        const q = findQuery(db, 'INSERT INTO Uslugi');
        expect(q.params[q.params.length - 1]).toBeNull();
    });
});

// ─── edit_service — aktualizacja waznosc_dni ──────────────────
describe('edit_service — waznosc_dni', () => {
    test('dokłada kolumnę waznosc_dni do UPDATE gdy podana', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_service', tenant_id: TENANT,
            old_kategoria: 'Twarz', old_wariant: '10x LPG',
            new_kategoria: 'Twarz', new_wariant: '10x LPG', new_cena: '500',
            waznosc_dni: '60', pracownik: 'Anna',
        });
        const q = findQuery(db, 'UPDATE Uslugi SET');
        expect(q).not.toBeNull();
        expect(q.sql).toContain('waznosc_dni = ?');
        expect(q.params).toContain(60);
    });

    test('bez waznosc_dni nie rusza kolumny', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_service', tenant_id: TENANT,
            old_kategoria: 'Twarz', old_wariant: 'X',
            new_kategoria: 'Twarz', new_wariant: 'X', new_cena: '100', pracownik: 'Anna',
        });
        const q = findQuery(db, 'UPDATE Uslugi SET');
        expect(q.sql).not.toContain('waznosc_dni');
    });
});

// ─── add_sale — snapshot data_waznosci ────────────────────────
describe('add_sale — snapshot data_waznosci', () => {
    test('liczy datę wygaśnięcia z waznosc_dni usługi', async () => {
        // lookup typ_zabiegu/waznosc_dni zwróci 30 dni
        const db = mockDbAlways([{ typ_zabiegu: 'twarz', waznosc_dni: 30 }]);
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sale', tenant_id: TENANT, typ_transakcji: 'Zabieg',
            sprzedawca: ['Anna'], klient: 'Kowalska', zabieg_nazwa: 'Botoks',
            kwota: '250', platnosc: 'Karta', pracownik: 'Anna',
        });
        const q = findQuery(db, 'INSERT INTO Sprzedaz');
        expect(q).not.toBeNull();
        expect(q.sql).toContain('data_waznosci');
        const dataWaznosci = q.params[q.params.length - 1];
        expect(dataWaznosci).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

// ─── extend_karnet / close_karnet / reopen_karnet ─────────────
describe('akcje karnetów', () => {
    test('extend_karnet odrzuca złą datę', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'extend_karnet', tenant_id: TENANT, id: 'S1', data_waznosci: '2026/13/40', pracownik: 'Anna',
        });
        expect(res.body.status).toBe('error');
    });

    test('extend_karnet zapisuje poprawną datę', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'extend_karnet', tenant_id: TENANT, id: 'S1', data_waznosci: '2026-12-31', pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
        const q = findQuery(db, 'SET data_waznosci = ?');
        expect(q).not.toBeNull();
        expect(q.params).toContain('2026-12-31');
    });

    test('close_karnet ustawia znacznik zakończenia', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'close_karnet', tenant_id: TENANT, id: 'S1', pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
        expect(findQuery(db, 'karnet_zamkniety_w = NOW()')).not.toBeNull();
    });

    test('reopen_karnet czyści znacznik', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'reopen_karnet', tenant_id: TENANT, id: 'S1', pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
        expect(findQuery(db, 'karnet_zamkniety_w = NULL')).not.toBeNull();
    });

    test('close_karnet zgłasza błąd gdy ID nie istnieje', async () => {
        const db = mockDbAlways({ affectedRows: 0 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'close_karnet', tenant_id: TENANT, id: 'NIEMA', pracownik: 'Anna',
        });
        expect(res.body.status).toBe('error');
    });
});
