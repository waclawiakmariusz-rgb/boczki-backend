// tests/reset-hasla.test.js
// Testy flow resetu hasła: wyślij email → weryfikuj token → ustaw hasło

const request = require('supertest');
const express = require('express');
const { mockDb, mockDbAlways } = require('./helpers/mockDb');

// Mockujemy mailer zanim auth.js zostanie załadowany
jest.mock('../routes/mailer', () => ({
    wyslijResetHasla: jest.fn().mockResolvedValue(undefined),
    wyslijLinkRejestracji: jest.fn().mockResolvedValue(undefined),
    powiadomAdmina: jest.fn().mockResolvedValue(undefined),
}));

const { wyslijResetHasla } = require('../routes/mailer');

// auth.js wywołuje CREATE TABLE w fabryce — to jest pierwsze db.query
// mockDb musi mieć ten wynik jako pierwszy wpis (bez callbacka, ignorujemy wynik)
const CREATE_TABLE = { rows: [] };

const FUTURE = new Date(Date.now() + 3_600_000); // 1h w przód
const PAST   = new Date(Date.now() - 3_600_000); // 1h w tył

function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/auth')(db));
    return app;
}

// ─── POST /api/reset-hasla/wyslij ─────────────────────────────────────────────
describe('POST /api/reset-hasla/wyslij', () => {
    beforeEach(() => {
        wyslijResetHasla.mockClear();
    });

    test('zwraca sukces i wysyła email gdy email znaleziony', async () => {
        const db = mockDb(
            CREATE_TABLE,                                               // CREATE TABLE
            { rows: [{ login: 'salon1', email: 'salon@test.pl' }] },  // SELECT licencja
            { rows: [] },                                               // INSERT token
        );
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/wyslij')
            .send({ email: 'salon@test.pl' });

        expect(res.body.status).toBe('success');
        expect(wyslijResetHasla).toHaveBeenCalledTimes(1);
        expect(wyslijResetHasla).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'salon@test.pl', login: 'salon1' })
        );
    });

    test('zwraca sukces gdy email NIE istnieje (nie ujawnia info)', async () => {
        const db = mockDb(
            CREATE_TABLE,    // CREATE TABLE
            { rows: [] },    // SELECT — brak wyników
        );
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/wyslij')
            .send({ email: 'nieznany@test.pl' });

        expect(res.body.status).toBe('success');
        expect(wyslijResetHasla).not.toHaveBeenCalled();
    });

    test('zwraca error gdy brak emaila w body', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/wyslij')
            .send({});

        expect(res.body.status).toBe('error');
        expect(wyslijResetHasla).not.toHaveBeenCalled();
    });

    test('zwraca error gdy email jest pustym stringiem', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/wyslij')
            .send({ email: '   ' });

        expect(res.body.status).toBe('error');
    });

    test('zwraca error gdy INSERT tokenu nie udał się', async () => {
        const db = mockDb(
            CREATE_TABLE,
            { rows: [{ login: 'salon1', email: 'salon@test.pl' }] },
            { err: new Error('DB error'), rows: [] },
        );
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/wyslij')
            .send({ email: 'salon@test.pl' });

        expect(res.body.status).toBe('error');
        expect(wyslijResetHasla).not.toHaveBeenCalled();
    });

    test('zwraca error gdy mailer rzuca wyjątek', async () => {
        wyslijResetHasla.mockRejectedValueOnce(new Error('SMTP down'));
        const db = mockDb(
            CREATE_TABLE,
            { rows: [{ login: 'salon1', email: 'salon@test.pl' }] },
            { rows: [] },
        );
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/wyslij')
            .send({ email: 'salon@test.pl' });

        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/email/i);
    });
});

// ─── GET /api/reset-hasla/weryfikuj ──────────────────────────────────────────
describe('GET /api/reset-hasla/weryfikuj', () => {
    test('zwraca ok dla ważnego tokenu', async () => {
        const db = mockDb(
            CREATE_TABLE,
            { rows: [{ login: 'salon1', expires_at: FUTURE, uzyty: 0 }] },
        );
        const res = await request(buildApp(db))
            .get('/api/reset-hasla/weryfikuj?token=abc-valid-token');

        expect(res.body.status).toBe('ok');
        expect(res.body.login).toBe('salon1');
    });

    test('zwraca error gdy brak parametru token', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db))
            .get('/api/reset-hasla/weryfikuj');

        expect(res.body.status).toBe('error');
    });

    test('zwraca error gdy token nie istnieje w bazie', async () => {
        const db = mockDb(
            CREATE_TABLE,
            { rows: [] },
        );
        const res = await request(buildApp(db))
            .get('/api/reset-hasla/weryfikuj?token=nieznany');

        expect(res.body.status).toBe('error');
    });

    test('zwraca error gdy token wygasł', async () => {
        const db = mockDb(
            CREATE_TABLE,
            { rows: [{ login: 'salon1', expires_at: PAST, uzyty: 0 }] },
        );
        const res = await request(buildApp(db))
            .get('/api/reset-hasla/weryfikuj?token=expired-token');

        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/wygasł/i);
    });

    test('zwraca error gdy token już wykorzystany', async () => {
        const db = mockDb(
            CREATE_TABLE,
            { rows: [{ login: 'salon1', expires_at: FUTURE, uzyty: 1 }] },
        );
        const res = await request(buildApp(db))
            .get('/api/reset-hasla/weryfikuj?token=used-token');

        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/wykorzystan/i);
    });
});

// ─── POST /api/reset-hasla/ustaw ─────────────────────────────────────────────
describe('POST /api/reset-hasla/ustaw', () => {
    test('zmienia hasło dla ważnego tokenu', async () => {
        const db = mockDb(
            CREATE_TABLE,
            { rows: [{ login: 'salon1', expires_at: FUTURE, uzyty: 0 }] }, // SELECT token
            { rows: [] },                                                     // UPDATE licencje
            { rows: [] },                                                     // UPDATE token uzyty=1
        );
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/ustaw')
            .send({ token: 'valid-token', nowe_haslo: 'nowehaslo123' });

        expect(res.body.status).toBe('success');
    });

    test('zwraca error gdy hasło za krótkie (< 4 znaki)', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/ustaw')
            .send({ token: 'valid-token', nowe_haslo: 'abc' });

        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/4 znaki/i);
    });

    test('zwraca error gdy brak tokenu', async () => {
        const db = mockDbAlways([]);
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/ustaw')
            .send({ nowe_haslo: 'nowehaslo123' });

        expect(res.body.status).toBe('error');
    });

    test('zwraca error gdy token wygasł', async () => {
        const db = mockDb(
            CREATE_TABLE,
            { rows: [{ login: 'salon1', expires_at: PAST, uzyty: 0 }] },
        );
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/ustaw')
            .send({ token: 'expired-token', nowe_haslo: 'nowehaslo123' });

        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/wygasł/i);
    });

    test('zwraca error gdy token już wykorzystany', async () => {
        const db = mockDb(
            CREATE_TABLE,
            { rows: [{ login: 'salon1', expires_at: FUTURE, uzyty: 1 }] },
        );
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/ustaw')
            .send({ token: 'used-token', nowe_haslo: 'nowehaslo123' });

        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/wykorzystan/i);
    });

    test('zwraca error gdy token nie istnieje', async () => {
        const db = mockDb(
            CREATE_TABLE,
            { rows: [] },
        );
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/ustaw')
            .send({ token: 'ghost-token', nowe_haslo: 'nowehaslo123' });

        expect(res.body.status).toBe('error');
    });

    test('zwraca error gdy UPDATE licencje się nie udał', async () => {
        const db = mockDb(
            CREATE_TABLE,
            { rows: [{ login: 'salon1', expires_at: FUTURE, uzyty: 0 }] },
            { err: new Error('DB write error'), rows: [] },
        );
        const res = await request(buildApp(db))
            .post('/api/reset-hasla/ustaw')
            .send({ token: 'valid-token', nowe_haslo: 'nowehaslo123' });

        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/hasła/i);
    });
});
