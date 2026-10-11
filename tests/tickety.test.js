// tests/tickety.test.js — zgłoszenia salonów do Estelio (routes/tickety.js), 2026-10-11.
// Baza udawana sekwencyjnie (mockDb), mailer i sesje zmockowane. Sprawdzamy: walidację, izolację
// tenantów (każde zapytanie z tenant_id), załączniki (limit, typ, sesja), admin (token, odpowiedź/status).
const request = require('supertest');
const express = require('express');
const { mockDb } = require('./helpers/mockDb');

beforeEach(() => { jest.resetModules(); });

const TENANT = 'salon-test-0001';
const INIT = [{ rows: [] }, { rows: [] }];   // 2× CREATE TABLE przy ładowaniu modułu
const mailer = () => ({ powiadomAdminaOTickecie: jest.fn().mockResolvedValue() });
const sessionsOk = { validateTenantAccess: (tok, tenant) => (tok === 'TOK' && tenant === TENANT ? { valid: true } : { valid: false, reason: 'mismatch' }) };
const cichy = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };

function buildApp(db, extra = {}) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/tickety')(db, { mailer: extra.mailer || mailer(), sessions: sessionsOk, log: cichy }));
    return app;
}
const post = (db, body, extra) => request(buildApp(db, extra)).post('/api/tickety').send({ tenant_id: TENANT, ...body });

describe('tk_add — nowe zgłoszenie', () => {
    test('za krótki tytuł → błąd, bez zapisu i bez maila', async () => {
        const m = mailer();
        const db = mockDb(...INIT);
        const res = await post(db, { action: 'tk_add', tytul: 'ab', opis: 'coś nie działa w sprzedaży' }, { mailer: m });
        expect(res.body.status).toBe('error');
        expect(db._callIndex()).toBe(2);   // tylko CREATE TABLE
        expect(m.powiadomAdminaOTickecie).not.toHaveBeenCalled();
    });

    test('poprawne → INSERT z tenant_id, kategoria/pilność znormalizowane, log + mail do admina, zwraca numer', async () => {
        const m = mailer();
        const db = mockDb(...INIT, { rows: { insertId: 42 } }, { rows: {} } /* log */);
        const res = await post(db, { action: 'tk_add', tytul: 'Nie działa przycisk Zwrot', opis: 'Po kliknięciu nic się nie dzieje, klientka czeka.', kategoria: 'blad', pilnosc: 'wysoka', pracownik: 'Marta', rola: 'Recepcja', nazwa_salonu: 'Salon Test', kontekst: '/index.html#klient-profil' }, { mailer: m });
        expect(res.body.status).toBe('success');
        expect(res.body.id).toBe(42);
        const insert = db.query.mock.calls[2];
        expect(insert[0]).toMatch(/INSERT INTO Zgloszenia_Tickety/);
        expect(insert[1][0]).toBe(TENANT);
        expect(insert[1].slice(4, 7)).toEqual(['blad', 'wysoka', 'Nie działa przycisk Zwrot']);
        expect(m.powiadomAdminaOTickecie).toHaveBeenCalledWith(expect.objectContaining({ id: 42, tenant_id: TENANT, pracownik: 'Marta', pilnosc: 'wysoka' }));
    });

    test('nieznana kategoria/pilność → „inne"/„normalna" (nie błąd)', async () => {
        const db = mockDb(...INIT, { rows: { insertId: 7 } }, { rows: {} });
        const res = await post(db, { action: 'tk_add', tytul: 'Pytanie o raport', opis: 'Gdzie znajdę ranking?', kategoria: 'xxx', pilnosc: 'natychmiast' });
        expect(res.body.status).toBe('success');
        expect(db.query.mock.calls[2][1].slice(4, 6)).toEqual(['inne', 'normalna']);
    });
});

describe('izolacja tenantów', () => {
    test('tk_list filtruje po tenant_id', async () => {
        const db = mockDb(...INIT, { rows: [{ id: 1, tytul: 'x', status: 'nowe' }] });
        const res = await post(db, { action: 'tk_list' });
        expect(res.body.status).toBe('success');
        expect(res.body.data).toHaveLength(1);
        const sel = db.query.mock.calls[2];
        expect(sel[0]).toMatch(/WHERE t\.tenant_id = \?/);
        expect(sel[1]).toEqual([TENANT]);
    });

    test('tk_get cudzego zgłoszenia → „nie ma takiego zgłoszenia w tym salonie"', async () => {
        const db = mockDb(...INIT, { rows: [] });
        const res = await post(db, { action: 'tk_get', id: 999 });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/w tym salonie/);
        expect(db.query.mock.calls[2][1]).toEqual([999, TENANT]);
    });

    test('tk_zalacznik tylko z własnego salonu (SQL ma tenant_id)', async () => {
        const db = mockDb(...INIT, { rows: [{ nazwa: 'a.png', typ: 'image/png', dane: Buffer.from('abc') }] });
        const res = await post(db, { action: 'tk_zalacznik', id: 5 });
        expect(res.body.status).toBe('success');
        expect(res.body.dane).toBe(Buffer.from('abc').toString('base64'));
        expect(db.query.mock.calls[2][1]).toEqual([5, TENANT]);
    });
});

describe('upload załącznika (multipart)', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    test('bez ważnej sesji → 403, nic nie zapisane', async () => {
        const db = mockDb(...INIT);
        const res = await request(buildApp(db)).post('/api/tickety/zalacznik').set('x-session-token', 'ZLY')
            .field('tenant_id', TENANT).field('ticket_id', '1').attach('plik', png, { filename: 'a.png', contentType: 'image/png' });
        expect(res.status).toBe(403);
        expect(db._callIndex()).toBe(2);
    });

    test('zły typ pliku → 400', async () => {
        const db = mockDb(...INIT);
        const res = await request(buildApp(db)).post('/api/tickety/zalacznik').set('x-session-token', 'TOK')
            .field('tenant_id', TENANT).field('ticket_id', '1').attach('plik', Buffer.from('x'), { filename: 'a.exe', contentType: 'application/x-msdownload' });
        expect(res.status).toBe(400);
    });

    test('poprawny obraz → sprawdza ticket w tym salonie, limit, INSERT z buforem', async () => {
        const db = mockDb(...INIT, { rows: [{ id: 1 }] }, { rows: [{ n: 2 }] }, { rows: { insertId: 11 } });
        const res = await request(buildApp(db)).post('/api/tickety/zalacznik').set('x-session-token', 'TOK')
            .field('tenant_id', TENANT).field('ticket_id', '1').attach('plik', png, { filename: 'ekran.png', contentType: 'image/png' });
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(11);
        expect(db.query.mock.calls[2][1]).toEqual([1, TENANT]);
        const ins = db.query.mock.calls[4];
        expect(ins[0]).toMatch(/INSERT INTO Zgloszenia_Zalaczniki/);
        expect(ins[1][1]).toBe(TENANT);
        expect(Buffer.isBuffer(ins[1][5])).toBe(true);
    });

    test('piąty załącznik już jest → 400 (limit 5)', async () => {
        const db = mockDb(...INIT, { rows: [{ id: 1 }] }, { rows: [{ n: 5 }] });
        const res = await request(buildApp(db)).post('/api/tickety/zalacznik').set('x-session-token', 'TOK')
            .field('tenant_id', TENANT).field('ticket_id', '1').attach('plik', png, { filename: 'a.png', contentType: 'image/png' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Maksymalnie 5/);
    });
});

describe('admin', () => {
    const SESJA_OK = { rows: [{ expires: Date.now() + 60000 }] };
    const SESJA_STARA = { rows: [{ expires: Date.now() - 1 }] };

    test('lista bez tokenu → 403; z przeterminowanym → 403', async () => {
        let res = await request(buildApp(mockDb(...INIT))).get('/api/admin/tickety');
        expect(res.status).toBe(403);
        res = await request(buildApp(mockDb(...INIT, SESJA_STARA))).get('/api/admin/tickety').set('X-Admin-Token', 'abc');
        expect(res.status).toBe(403);
    });

    test('lista z filtrem statusu i salonu', async () => {
        const db = mockDb(...INIT, SESJA_OK, { rows: [{ id: 3 }] });
        const res = await request(buildApp(db)).get('/api/admin/tickety?status=nowe&tenant_id=' + TENANT).set('X-Admin-Token', 'abc');
        expect(res.body.status).toBe('success');
        const sel = db.query.mock.calls[3];
        expect(sel[0]).toMatch(/t\.status = \? AND t\.tenant_id = \?/);
        expect(sel[1]).toEqual(['nowe', TENANT]);
    });

    test('odpowiedź + zamknięcie → UPDATE z odpowiedzią, nieprzeczytane=0, data_zamkniecia; log', async () => {
        const db = mockDb(...INIT, SESJA_OK, { rows: [{ id: 3, tenant_id: TENANT, pracownik: 'Marta', tytul: 'x', status: 'nowe', odpowiedz: null }] }, { rows: {} }, { rows: {} });
        const res = await request(buildApp(db)).post('/api/admin/tickety/odpowiedz').set('X-Admin-Token', 'abc').send({ id: 3, odpowiedz: 'Naprawione w wersji z 12.10.', status: 'zamkniete' });
        expect(res.body.status).toBe('success');
        const upd = db.query.mock.calls[4];
        expect(upd[0]).toMatch(/odpowiedz = \?, odpowiedz_data = NOW\(\), odpowiedz_przeczytana = 0, status = \?, data_zamkniecia = NOW\(\)/);
        expect(upd[1]).toEqual(['Naprawione w wersji z 12.10.', 'zamkniete', 3]);
    });

    test('nieznany status i brak odpowiedzi → błąd walidacji', async () => {
        const db = mockDb(...INIT, SESJA_OK);
        const res = await request(buildApp(db)).post('/api/admin/tickety/odpowiedz').set('X-Admin-Token', 'abc').send({ id: 3, status: 'usuniete' });
        expect(res.body.status).toBe('error');
    });
});
