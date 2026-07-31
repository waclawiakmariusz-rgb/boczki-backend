// tests/rodo.test.js
// Baza do akcji SMS/e-mail (sms_baza) — prośba recepcji 2026-07-31.
// Najważniejsze: marketing wolno wysyłać WYŁĄCZNIE na podstawie zgody marketingowej
// (newsletter_sms / newsletter_email). kontakt_tel dotyczy organizacji wizyt.

const request = require('supertest');
const express = require('express');

function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/rodo')(db));
    return app;
}

const TENANT = 'test-salon-001';

// Mock zwracający wiersze i zapamiętujący SQL — chcemy sprawdzić SAM warunek zapytania.
function mockDb(rows = []) {
    return {
        query: jest.fn((sql, paramsOrCb, maybeCb) => {
            const cb = typeof paramsOrCb === 'function' ? paramsOrCb : maybeCb;
            if (cb) cb(null, rows);
        })
    };
}

const KLIENCI = [
    { id_klienta: '1001', imie_nazwisko: 'Kowalska Maria', telefon: '500100200', email_adres: '', email_kontaktowy: 'maria@example.com', data_podpisu: '2026-03-01' },
    { id_klienta: '1002', imie_nazwisko: 'Nowak Anna',     telefon: '',          email_adres: 'anna@example.com', email_kontaktowy: '', data_podpisu: '2026-04-15' },
];

function pobierz(db, zgoda) {
    const q = { action: 'sms_baza', tenant_id: TENANT };
    if (zgoda) q.zgoda = zgoda;
    return request(buildApp(db)).get('/api/rodo').query(q);
}

describe('GET /api/rodo — sms_baza', () => {
    test('domyślnie filtruje po zgodzie MARKETINGOWEJ SMS', async () => {
        const db = mockDb(KLIENCI);
        const res = await pobierz(db);
        expect(res.body.status).toBe('ok');
        expect(res.body.zgoda).toBe('newsletter_sms');
        expect(res.body.marketingowa).toBe(true);
        const sql = String(db.query.mock.calls[0][0]);
        expect(sql).toContain('newsletter_sms');
        expect(sql).toContain("= 'TAK'");
    });

    test('e-mail wybiera kolumnę newsletter_email', async () => {
        const db = mockDb(KLIENCI);
        const res = await pobierz(db, 'email');
        expect(res.body.zgoda).toBe('newsletter_email');
        expect(res.body.marketingowa).toBe(true);
        expect(String(db.query.mock.calls[0][0])).toContain('newsletter_email');
    });

    test('kontakt telefoniczny jest oznaczony jako NIE-marketingowy', async () => {
        // Frontend na tej podstawie pokazuje ostrzeżenie — wysyłka reklamy byłaby naruszeniem.
        const db = mockDb(KLIENCI);
        const res = await pobierz(db, 'tel');
        expect(res.body.zgoda).toBe('kontakt_tel');
        expect(res.body.marketingowa).toBe(false);
    });

    test('odrzuca nieznany rodzaj zgody (brak doklejania kolumny z parametru)', async () => {
        const db = mockDb(KLIENCI);
        const res = await pobierz(db, 'wizerunek; DROP TABLE Klienci');
        expect(res.body.status).toBe('error');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('pomija usuniętych, zanonimizowanych i zmarłych', async () => {
        const db = mockDb(KLIENCI);
        await pobierz(db);
        const sql = String(db.query.mock.calls[0][0]);
        expect(sql).toContain('zmarly');
        expect(sql).toContain('data_usuniecia IS NULL');
        expect(sql).toContain('AKTYWNY');
    });

    test('liczy osoby bez kontaktu (nie da się do nich wysłać)', async () => {
        const db = mockDb(KLIENCI);          // Nowak nie ma telefonu
        const res = await pobierz(db, 'sms');
        expect(res.body.razem).toBe(2);
        expect(res.body.bez_kontaktu).toBe(1);
    });

    test('dla SMS kontaktem jest telefon, dla e-maila adres e-mail', async () => {
        const dbSms = mockDb(KLIENCI);
        const resSms = await pobierz(dbSms, 'sms');
        expect(resSms.body.lista[0].kontakt).toBe('500100200');

        const dbMail = mockDb(KLIENCI);
        const resMail = await pobierz(dbMail, 'email');
        expect(resMail.body.lista[0].kontakt).toBe('maria@example.com');   // email_kontaktowy ma pierwszeństwo
        expect(resMail.body.lista[1].kontakt).toBe('anna@example.com');    // fallback na email_adres
    });

    test('błąd bazy zwraca status error, nie pustą listę udającą sukces', async () => {
        const db = { query: jest.fn((sql, p, cb) => { const f = typeof p === 'function' ? p : cb; f(new Error('DB padło')); }) };
        const res = await pobierz(db);
        expect(res.body.status).toBe('error');
    });
});
