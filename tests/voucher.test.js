// tests/voucher.test.js
// Testy voucherów: walidacja kodu, panel admina, zastosowanie w Stripe

const request = require('supertest');
const express = require('express');
const { mockDb, mockDbAlways } = require('./helpers/mockDb');

const ADMIN_TOKEN = 'test-token-123';
process.env.ADMIN_TOKEN = ADMIN_TOKEN;
process.env.STRIPE_CENA_GROSZE = '4900';

function buildAdminApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/admin')(db));
    return app;
}

// ─── GET /api/voucher/weryfikuj ───────────────────────────────
describe('GET /api/voucher/weryfikuj', () => {
    test('zwraca błąd dla nieistniejącego kodu', async () => {
        const db = mockDbAlways([]); // brak wyników
        const res = await request(buildAdminApp(db))
            .get('/api/voucher/weryfikuj')
            .query({ kod: 'NIEISTNIEJE' });
        expect(res.body.status).toBe('error');
    });

    test('zwraca błąd dla wygasłego vouchera', async () => {
        const db = mockDbAlways([{
            id: 1, kod: 'STARY20', typ: 'procent', wartosc: 20,
            czas_trwania: 'zawsze', czas_trwania_miesiecy: null,
            max_uzyc: null, ilosc_uzyc: 0, aktywny: 1,
            data_wygasniecia: '2020-01-01', // przeszłość
        }]);
        const res = await request(buildAdminApp(db))
            .get('/api/voucher/weryfikuj')
            .query({ kod: 'STARY20' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/wygasł/i);
    });

    test('zwraca błąd gdy limit użyć wyczerpany', async () => {
        const db = mockDbAlways([{
            id: 1, kod: 'LIMIT5', typ: 'procent', wartosc: 10,
            czas_trwania: 'zawsze', czas_trwania_miesiecy: null,
            max_uzyc: 5, ilosc_uzyc: 5, aktywny: 1,
            data_wygasniecia: null,
        }]);
        const res = await request(buildAdminApp(db))
            .get('/api/voucher/weryfikuj')
            .query({ kod: 'LIMIT5' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/wykorzystany/i);
    });

    test('oblicza rabat procentowy poprawnie', async () => {
        // 20% zniżki od 4900 groszy = 3920 groszy (49 zł → 39.20 zł)
        const db = mockDbAlways([{
            id: 1, kod: 'BOCZKI20', typ: 'procent', wartosc: 20,
            czas_trwania: 'zawsze', czas_trwania_miesiecy: null,
            max_uzyc: null, ilosc_uzyc: 0, aktywny: 1,
            data_wygasniecia: null,
        }]);
        const res = await request(buildAdminApp(db))
            .get('/api/voucher/weryfikuj')
            .query({ kod: 'BOCZKI20' });
        expect(res.body.status).toBe('ok');
        expect(res.body.cena_po_rabacie_grosze).toBe(3920);
        expect(res.body.cena_po_rabacie_display).toBe('39 zł');
        expect(res.body.opis_rabatu).toContain('-20%');
        expect(res.body.opis_rabatu).toContain('na zawsze');
    });

    test('oblicza rabat kwotowy poprawnie', async () => {
        // -10 zł od 49 zł = 39 zł
        const db = mockDbAlways([{
            id: 1, kod: 'MINUS10', typ: 'zlotowki', wartosc: 10,
            czas_trwania: 'miesiecy', czas_trwania_miesiecy: 6,
            max_uzyc: null, ilosc_uzyc: 0, aktywny: 1,
            data_wygasniecia: null,
        }]);
        const res = await request(buildAdminApp(db))
            .get('/api/voucher/weryfikuj')
            .query({ kod: 'MINUS10' });
        expect(res.body.status).toBe('ok');
        expect(res.body.cena_po_rabacie_grosze).toBe(3900);
        expect(res.body.opis_rabatu).toContain('przez 6 mies.');
    });

    test('nie schodzi poniżej 0 przy za dużym rabacie kwotowym', async () => {
        // -100 zł od 49 zł = max 0
        const db = mockDbAlways([{
            id: 1, kod: 'GRATIS', typ: 'zlotowki', wartosc: 100,
            czas_trwania: 'zawsze', czas_trwania_miesiecy: null,
            max_uzyc: null, ilosc_uzyc: 0, aktywny: 1,
            data_wygasniecia: null,
        }]);
        const res = await request(buildAdminApp(db))
            .get('/api/voucher/weryfikuj')
            .query({ kod: 'GRATIS' });
        expect(res.body.status).toBe('ok');
        expect(res.body.cena_po_rabacie_grosze).toBe(0);
    });

    test('zwraca błąd gdy brak kodu w zapytaniu', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildAdminApp(db)).get('/api/voucher/weryfikuj');
        expect(res.body.status).toBe('error');
    });
});

// ─── POST /api/admin/voucher — tworzenie ──────────────────────
describe('POST /api/admin/voucher', () => {
    test('tworzy voucher procentowy', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildAdminApp(db))
            .post('/api/admin/voucher')
            .set('x-admin-token', ADMIN_TOKEN)
            .send({
                kod: 'BOCZKI20',
                typ: 'procent',
                wartosc: 20,
                czas_trwania: 'zawsze',
            });
        expect(res.body.status).toBe('success');
    });

    test('tworzy voucher kwotowy na X miesięcy', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildAdminApp(db))
            .post('/api/admin/voucher')
            .set('x-admin-token', ADMIN_TOKEN)
            .send({
                kod: 'MINUS10',
                typ: 'zlotowki',
                wartosc: 10,
                czas_trwania: 'miesiecy',
                czas_trwania_miesiecy: 6,
                max_uzyc: 50,
            });
        expect(res.body.status).toBe('success');
    });

    test('odrzuca brak wymaganych pól', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildAdminApp(db))
            .post('/api/admin/voucher')
            .set('x-admin-token', ADMIN_TOKEN)
            .send({ kod: 'TEST' }); // brak typ i wartosc
        expect(res.body.status).toBe('error');
    });

    test('odrzuca nieprawidłowy typ', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildAdminApp(db))
            .post('/api/admin/voucher')
            .set('x-admin-token', ADMIN_TOKEN)
            .send({ kod: 'TEST', typ: 'nieznany', wartosc: 10 });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca bez tokenu admina', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildAdminApp(db))
            .post('/api/admin/voucher')
            .send({ kod: 'TEST', typ: 'procent', wartosc: 10 });
        expect(res.status).toBe(403);
    });
});

// ─── POST /api/admin/login ────────────────────────────────────
describe('POST /api/admin/login', () => {
    test('loguje z poprawnym hasłem', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildAdminApp(db))
            .post('/api/admin/login')
            .send({ haslo: ADMIN_TOKEN });
        expect(res.body.status).toBe('success');
        expect(res.body.token).toBe(ADMIN_TOKEN);
    });

    test('odrzuca złe hasło', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildAdminApp(db))
            .post('/api/admin/login')
            .send({ haslo: 'zle-haslo' });
        expect(res.body.status).toBe('error');
    });

    test('odrzuca puste hasło', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildAdminApp(db))
            .post('/api/admin/login')
            .send({ haslo: '' });
        expect(res.body.status).toBe('error');
    });
});
