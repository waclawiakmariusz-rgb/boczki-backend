// Usuwanie definicji rabatu (24.10.2026, prośba właściciela): backend delete_discount_def + front usunDefinicjeRabatu().
const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { mockDbAlways } = require('./helpers/mockDb');

function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/sprzedaz')(db));
    return app;
}
const TENANT = 'test-salon-001';

describe('delete_discount_def — backend', () => {
    test('wyłącza rabat (aktywny = NIE) po id w obrębie salonu', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({ action: 'delete_discount_def', tenant_id: TENANT, id: 'abc-123', pracownik: 'Anna' });
        expect(res.body.status).toBe('success');
        const zapytanie = db.query.mock.calls.find(c => /UPDATE Rabaty SET aktywny = 'NIE'/.test(c[0]));
        expect(zapytanie).toBeTruthy();
        expect(zapytanie[0]).toMatch(/WHERE tenant_id = \? AND id = \?/);
        expect(zapytanie[1]).toEqual([TENANT, 'abc-123']);
        expect(db.query.mock.calls.some(c => /DELETE FROM Rabaty/.test(c[0]))).toBe(false); // nie kasujemy wiersza
    });
    test('bez id — odmowa', async () => {
        const res = await request(buildApp(mockDbAlways({ affectedRows: 1 }))).post('/api/sprzedaz').send({ action: 'delete_discount_def', tenant_id: TENANT });
        expect(res.body.status).toBe('error');
    });
    test('nieznany / już nieaktywny rabat — odmowa, bez fałszywego sukcesu', async () => {
        const res = await request(buildApp(mockDbAlways({ affectedRows: 0 }))).post('/api/sprzedaz').send({ action: 'delete_discount_def', tenant_id: TENANT, id: 'nie-ma' });
        expect(res.body.status).toBe('error');
    });
    test('get_discounts zwraca id obok dotychczasowych pól', async () => {
        const db = mockDbAlways([{ id: 'r1', nazwa: 'Urodziny', typ: 'PROCENT', wartosc: '15.00' }]);
        const res = await request(buildApp(db)).get('/api/sprzedaz?action=get_discounts&tenant_id=' + TENANT);
        expect(res.body).toEqual([{ id: 'r1', nazwa: 'Urodziny', typ: 'PROCENT', wartosc: 15 }]);
    });
    test('akcja zarejestrowana w server.js', () => {
        const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        expect(server).toMatch(/sprzedazActions = \[[^\]]*'delete_discount_def'/);
    });
});

describe('usunDefinicjeRabatu — front', () => {
    const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    test('kosz przy wierszu rabatu woła usunDefinicjeRabatu(id, nazwa); funkcja pyta i wysyła delete_discount_def', () => {
        const z = INDEX.slice(INDEX.indexOf('function zaladujRabaty()'), INDEX.indexOf('function zapiszDefinicjeRabatu()'));
        expect(z).toContain('class="rb-usun" onclick="usunDefinicjeRabatu(');
        expect(z).toContain('function usunDefinicjeRabatu(id, nazwa)');
        expect(z).toMatch(/if \(!confirm\("Usunąć rabat „"/);
        expect(z).toContain("action: 'delete_discount_def', id: id, pracownik: currentUser");
        expect(z).toContain("if (d.status === 'success') zaladujRabaty();");
    });
});
