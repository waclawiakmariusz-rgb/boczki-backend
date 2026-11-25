// tests/eksport-log.test.js
// Akcja `eksport_log` (routes/logi.js): każdy eksport do Excela zostawia wpis w Dzienniku Zdarzeń — pełne zdanie: kto, jaki widok,
// kiedy, ile wierszy, jakie kolumny i filtry, jaki plik. Polecenie właściciela 25.11.2026: manager, megaadmin, recepcja (i admin);
// bez potwierdzonego wpisu panel nie tworzy pliku.
const request = require('supertest');
const express = require('express');
const { mockDb } = require('./helpers/mockDb');
const logiFactory = require('../routes/logi');

const buildApp = (db) => { const app = express(); app.use(express.json()); app.use('/api', logiFactory(db)); return app; };
const ZADANIE = {
    action: 'eksport_log', tenant_id: 'demo-test', user_log: 'Ola', widok: 'Stan Magazynowy', sekcja: 'magazyn', wierszy: 42, arkusze: 1,
    kolumny: 'Produkt, Suma, Status', filtry: 'Szukaj produktu: krem; Twarz', plik: 'estelio-stan-magazynowy-2026-11-25.xlsx',
};
const insertLogu = (db) => db.query.mock.calls.find((c) => /INSERT INTO Logi/.test(c[0]));

describe('eksport_log — wpis w Dzienniku o eksporcie do Excela', () => {
    test.each(['Recepcja', 'manager', 'MEGAADMIN', 'Admin'])('rola %s: wpis EKSPORT DANYCH z pełnym zdaniem, odpowiedź success', async (rola) => {
        const db = mockDb({ rows: [{ rola }] }, { rows: { affectedRows: 1 } });
        const res = await request(buildApp(db)).post('/api/logi').send(ZADANIE);
        expect(res.body.status).toBe('success');
        const ins = insertLogu(db);
        expect(ins[0]).toMatch(/'EKSPORT DANYCH'/);
        expect(ins[1][1]).toBe('demo-test');
        expect(ins[1][2]).toBe('Ola');
        expect(ins[1][3]).toMatch(/^Użytkownik Ola wyeksportował do Excela widok „Stan Magazynowy” \(\d{2}\.\d{2}\.\d{4} o \d{2}:\d{2}\): 42 wierszy; kolumny: Produkt, Suma, Status; filtry: Szukaj produktu: krem; Twarz; plik: estelio-stan-magazynowy-2026-11-25\.xlsx\.$/);
        expect(res.body.opis).toBe(ins[1][3]);
    });

    test('kilka arkuszy w pliku jest wymienione w zdaniu', async () => {
        const db = mockDb({ rows: [{ rola: 'manager' }] }, { rows: { affectedRows: 1 } });
        await request(buildApp(db)).post('/api/logi').send({ ...ZADANIE, arkusze: 2, wierszy: 10 });
        expect(insertLogu(db)[1][3]).toMatch(/: 10 wierszy w 2 arkuszach; /);
    });

    test('praktykantka i nieznany pracownik: odmowa, bez wpisu', async () => {
        for (const rows of [[{ rola: 'Praktykantka' }], []]) {
            const db = mockDb({ rows });
            const res = await request(buildApp(db)).post('/api/logi').send(ZADANIE);
            expect(res.body.status).toBe('error');
            expect(res.body.message).toMatch(/dostępny dla recepcji, managera i administratora/);
            expect(insertLogu(db)).toBeUndefined();
        }
    });

    test('brak pracownika lub tenant_id: błąd, nic nie zapisane', async () => {
        const db = mockDb();
        expect((await request(buildApp(db)).post('/api/logi').send({ ...ZADANIE, user_log: '' })).body.status).toBe('error');
        expect((await request(buildApp(db)).post('/api/logi').send({ ...ZADANIE, tenant_id: '' })).body.status).toBe('error');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('błąd zapisu w bazie → status error (panel wtedy nie tworzy pliku)', async () => {
        const db = mockDb({ rows: [{ rola: 'admin' }] }, { err: new Error('Table Logi is read only') });
        const res = await request(buildApp(db)).post('/api/logi').send(ZADANIE);
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/Nie udało się zapisać wpisu w Dzienniku/);
    });

    test('długie pola są przycinane, a brakujące opisane jako „brak”', async () => {
        const db = mockDb({ rows: [{ rola: 'recepcja' }] }, { rows: { affectedRows: 1 } });
        await request(buildApp(db)).post('/api/logi').send({ ...ZADANIE, widok: 'X'.repeat(200), kolumny: '', filtry: '', plik: '' });
        const opis = insertLogu(db)[1][3];
        expect(opis).toMatch(/widok „X{80}”/);
        expect(opis).toMatch(/kolumny: brak; filtry: brak; plik: bez nazwy\.$/);
        expect(opis.length).toBeLessThanOrEqual(500);
    });

    test('inna akcja na /logi jest odrzucana', async () => {
        const db = mockDb();
        const res = await request(buildApp(db)).post('/api/logi').send({ action: 'cokolwiek', tenant_id: 'demo-test', user_log: 'Ola' });
        expect(res.body.status).toBe('error');
        expect(db.query).not.toHaveBeenCalled();
    });
});
