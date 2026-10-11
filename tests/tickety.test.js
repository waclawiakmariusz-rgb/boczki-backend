// tests/tickety.test.js — zgłoszenia salonów do Estelio (routes/tickety.js), 2026-10-11.
// Baza udawana sekwencyjnie (mockDb), mailer i sesje zmockowane. Sprawdzamy: walidację, izolację
// tenantów (każde zapytanie z tenant_id), załączniki (limit, typ, sesja), admin (token, odpowiedź/status).
const request = require('supertest');
const express = require('express');
const { mockDb } = require('./helpers/mockDb');

beforeEach(() => { jest.resetModules(); });

const TENANT = 'salon-test-0001';
const INIT = [{ rows: [] }, { rows: [] }, { rows: [] }];   // 3× CREATE TABLE zużywa wyniki; w mock.calls są też 2 ALTER-y → pierwsze zapytanie handlera = calls[5]
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
        expect(db._callIndex()).toBe(3);   // tylko CREATE TABLE
        expect(m.powiadomAdminaOTickecie).not.toHaveBeenCalled();
    });

    test('poprawne → INSERT z tenant_id, kategoria/pilność znormalizowane, log + mail do admina, zwraca numer', async () => {
        const m = mailer();
        const db = mockDb(...INIT, { rows: { insertId: 42 } }, { rows: {} } /* log */);
        const res = await post(db, { action: 'tk_add', tytul: 'Nie działa przycisk Zwrot', opis: 'Po kliknięciu nic się nie dzieje, klientka czeka.', kategoria: 'blad', pilnosc: 'wysoka', pracownik: 'Marta', rola: 'Recepcja', nazwa_salonu: 'Salon Test', kontekst: '/index.html#klient-profil' }, { mailer: m });
        expect(res.body.status).toBe('success');
        expect(res.body.id).toBe(42);
        const insert = db.query.mock.calls[5];
        expect(insert[0]).toMatch(/INSERT INTO Zgloszenia_Tickety/);
        expect(insert[1][0]).toBe(TENANT);
        expect(insert[1].slice(4, 7)).toEqual(['blad', 'wysoka', 'Nie działa przycisk Zwrot']);
        expect(m.powiadomAdminaOTickecie).toHaveBeenCalledWith(expect.objectContaining({ id: 42, tenant_id: TENANT, pracownik: 'Marta', pilnosc: 'wysoka' }));
    });

    test('nieznana kategoria/pilność → „inne"/„normalna" (nie błąd)', async () => {
        const db = mockDb(...INIT, { rows: { insertId: 7 } }, { rows: {} });
        const res = await post(db, { action: 'tk_add', tytul: 'Pytanie o raport', opis: 'Gdzie znajdę ranking?', kategoria: 'xxx', pilnosc: 'natychmiast' });
        expect(res.body.status).toBe('success');
        expect(db.query.mock.calls[5][1].slice(4, 6)).toEqual(['inne', 'normalna']);
    });
});

describe('izolacja tenantów', () => {
    test('tk_list filtruje po tenant_id', async () => {
        const db = mockDb(...INIT, { rows: [{ id: 1, tytul: 'x', status: 'nowe' }] });
        const res = await post(db, { action: 'tk_list' });
        expect(res.body.status).toBe('success');
        expect(res.body.data).toHaveLength(1);
        const sel = db.query.mock.calls[5];
        expect(sel[0]).toMatch(/WHERE t\.tenant_id = \?/);
        expect(sel[1]).toEqual([TENANT]);
    });

    test('tk_get cudzego zgłoszenia → „nie ma takiego zgłoszenia w tym salonie"', async () => {
        const db = mockDb(...INIT, { rows: [] });
        const res = await post(db, { action: 'tk_get', id: 999 });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/w tym salonie/);
        expect(db.query.mock.calls[5][1]).toEqual([999, TENANT]);
    });

    test('tk_zalacznik tylko z własnego salonu (SQL ma tenant_id)', async () => {
        const db = mockDb(...INIT, { rows: [{ nazwa: 'a.png', typ: 'image/png', dane: Buffer.from('abc') }] });
        const res = await post(db, { action: 'tk_zalacznik', id: 5 });
        expect(res.body.status).toBe('success');
        expect(res.body.dane).toBe(Buffer.from('abc').toString('base64'));
        expect(db.query.mock.calls[5][1]).toEqual([5, TENANT]);
    });
});

describe('tk_komentarz — rozmowa pod ticketem', () => {
    test('dopisek do zamkniętego → komentarz „salon", status wraca do w_toku, czeka_na_estelio=1, mail do admina', async () => {
        const m = mailer();
        const db = mockDb(...INIT, { rows: [{ id: 3, status: 'zamkniete', tytul: 'Funkcja A' }] }, { rows: { insertId: 1 } }, { rows: {} }, { rows: {} });
        const res = await post(db, { action: 'tk_komentarz', id: 3, tresc: 'Myślałam, żeby to działało inaczej, tak: xx', pracownik: 'Ania' }, { mailer: m });
        expect(res.body.status).toBe('success');
        expect(res.body.otwarte_ponownie).toBe(true);
        const kom = db.query.mock.calls[6];
        expect(kom[0]).toMatch(/INSERT INTO Zgloszenia_Komentarze .* 'salon'/);
        expect(kom[1]).toEqual([3, TENANT, 'Ania', 'Myślałam, żeby to działało inaczej, tak: xx']);
        const upd = db.query.mock.calls[7];
        expect(upd[0]).toMatch(/ostatni_ruch = 'salon', czeka_na_estelio = 1, status = 'w_toku', data_zamkniecia = NULL WHERE id = \? AND tenant_id = \?/);
        expect(upd[1]).toEqual([3, TENANT]);
        expect(m.powiadomAdminaOTickecie).toHaveBeenCalledWith(expect.objectContaining({ id: 3, kategoria: 'dopisek', pilnosc: 'otwarte ponownie' }));
    });

    test('dopisek do otwartego → status bez zmian; pusta treść → błąd', async () => {
        let db = mockDb(...INIT, { rows: [{ id: 3, status: 'w_toku', tytul: 'x' }] }, { rows: { insertId: 1 } }, { rows: {} }, { rows: {} });
        let res = await post(db, { action: 'tk_komentarz', id: 3, tresc: 'Dziękuję, działa.' });
        expect(res.body.otwarte_ponownie).toBe(false);
        expect(db.query.mock.calls[7][0]).not.toMatch(/status = 'w_toku'/);
        db = mockDb(...INIT);
        res = await post(db, { action: 'tk_komentarz', id: 3, tresc: ' ' });
        expect(res.body.status).toBe('error');
        expect(db._callIndex()).toBe(3);
    });

    test('tk_get zwraca rozmowę (komentarze_lista) tylko z tego salonu', async () => {
        const db = mockDb(...INIT, { rows: [{ id: 3, tytul: 'x' }] }, { rows: [] }, { rows: [{ id: 1, autor_typ: 'salon', autor: 'Ania', tresc: 'a' }, { id: 2, autor_typ: 'estelio', autor: 'Estelio', tresc: 'b' }] });
        const res = await post(db, { action: 'tk_get', id: 3 });
        expect(res.body.data.komentarze_lista.map(k => k.autor_typ)).toEqual(['salon', 'estelio']);
        expect(db.query.mock.calls[7][1]).toEqual([3, TENANT]);
    });
});

describe('upload załącznika (multipart)', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    test('bez ważnej sesji → 403, nic nie zapisane', async () => {
        const db = mockDb(...INIT);
        const res = await request(buildApp(db)).post('/api/tickety/zalacznik').set('x-session-token', 'ZLY')
            .field('tenant_id', TENANT).field('ticket_id', '1').attach('plik', png, { filename: 'a.png', contentType: 'image/png' });
        expect(res.status).toBe(403);
        expect(db._callIndex()).toBe(3);
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
        expect(db.query.mock.calls[5][1]).toEqual([1, TENANT]);
        const ins = db.query.mock.calls[7];
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
        const sel = db.query.mock.calls[6];
        expect(sel[0]).toMatch(/t\.status = \? AND t\.tenant_id = \?/);
        expect(sel[1]).toEqual(['nowe', TENANT]);
    });

    test('odpowiedź + zamknięcie → komentarz „estelio" w rozmowie, UPDATE z odpowiedzią, czeka_na_estelio=0, data_zamkniecia; log', async () => {
        const db = mockDb(...INIT, SESJA_OK, { rows: [{ id: 3, tenant_id: TENANT, pracownik: 'Marta', tytul: 'x', status: 'nowe', odpowiedz: null }] }, { rows: { insertId: 9 } }, { rows: {} }, { rows: {} });
        const res = await request(buildApp(db)).post('/api/admin/tickety/odpowiedz').set('X-Admin-Token', 'abc').send({ id: 3, odpowiedz: 'Naprawione w wersji z 12.10.', status: 'zamkniete' });
        expect(res.body.status).toBe('success');
        const kom = db.query.mock.calls[7];
        expect(kom[0]).toMatch(/INSERT INTO Zgloszenia_Komentarze/);
        expect(kom[1]).toEqual([3, TENANT, 'Naprawione w wersji z 12.10.']);
        const upd = db.query.mock.calls[8];
        expect(upd[0]).toMatch(/odpowiedz = \?, odpowiedz_data = NOW\(\), odpowiedz_przeczytana = 0, ostatni_ruch = 'estelio', czeka_na_estelio = 0, status = \?, data_zamkniecia = NOW\(\)/);
        expect(upd[1]).toEqual(['Naprawione w wersji z 12.10.', 'zamkniete', 3]);
    });

    test('sama zmiana statusu (pusta odpowiedź) → bez komentarza, czeka_na_estelio=0', async () => {
        const db = mockDb(...INIT, SESJA_OK, { rows: [{ id: 3, tenant_id: TENANT, status: 'nowe', odpowiedz: null }] }, { rows: {} }, { rows: {} });
        const res = await request(buildApp(db)).post('/api/admin/tickety/odpowiedz').set('X-Admin-Token', 'abc').send({ id: 3, odpowiedz: '', status: 'w_toku' });
        expect(res.body.status).toBe('success');
        const upd = db.query.mock.calls[7];
        expect(upd[0]).toMatch(/^UPDATE Zgloszenia_Tickety SET status = \?, data_zamkniecia = NULL, czeka_na_estelio = 0 WHERE id = \?$/);
        expect(db.query.mock.calls.some(c => /INSERT INTO Zgloszenia_Komentarze/.test(c[0]))).toBe(false);
    });

    test('nieznany status i brak odpowiedzi → błąd walidacji', async () => {
        const db = mockDb(...INIT, SESJA_OK);
        const res = await request(buildApp(db)).post('/api/admin/tickety/odpowiedz').set('X-Admin-Token', 'abc').send({ id: 3, status: 'usuniete' });
        expect(res.body.status).toBe('error');
    });
});
