// tests/powiadomienia-admina.test.js — osobny kanał powiadomień o ticketach (routes/powiadomienia-admina.js, 2026-10-26).
// Sprawdzamy: niezależność od routes/mailer.js, dobór adresata, tematy bez emoji, treść, brak wysyłki bez konfiguracji.
const fs = require('fs');
const path = require('path');

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
const nodemailer = require('nodemailer');
const P = require('../routes/powiadomienia-admina');

const T = { id: 13, tenant_id: 'boczki-salon-glowny-001', nazwa_salonu: 'Boczki', pracownik: 'Gosia', rola: 'Recepcja', kategoria: 'inne', pilnosc: 'normalna', tytul: 'Stan magazynowy kosmetyki', opis: 'Nie jestem pewna <b>filtra</b>.' };

describe('powiadomienia-admina — kanał odrębny od mailera', () => {
    test('moduł nie importuje routes/mailer.js (awaria jednego kanału nie dotyka drugiego)', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'powiadomienia-admina.js'), 'utf8');
        expect(src).not.toMatch(/require\(['"]\.\/mailer['"]\)/);
        const tk = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tickety.js'), 'utf8');
        expect(tk).not.toMatch(/require\(['"]\.\/mailer['"]\)/);
        expect(tk).toMatch(/require\(['"]\.\/powiadomienia-admina['"]\)/);
    });

    test('adresat: TICKETY_EMAIL → ADMIN_EMAIL → SMTP_USER; apostrofy z Hostingera obcinane', () => {
        expect(P.konfiguracja({ SMTP_USER: "'k@x.pl'" }).adresat).toBe('k@x.pl');
        expect(P.konfiguracja({ SMTP_USER: 'k@x.pl', ADMIN_EMAIL: 'a@x.pl' }).adresat).toBe('a@x.pl');
        expect(P.konfiguracja({ SMTP_USER: 'k@x.pl', ADMIN_EMAIL: 'a@x.pl', TICKETY_EMAIL: '"t@x.pl"' }).adresat).toBe('t@x.pl');
        expect(P.konfiguracja({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' }).gotowa).toBe(true);
        expect(P.konfiguracja({ SMTP_USER: 'u', SMTP_PASS: 'p' }).gotowa).toBe(false);
    });

    test('tematy: nowe zgłoszenie / komentarz / ponownie — zaczynają się od [Estelio], bez emoji', () => {
        const env = { SMTP_USER: 'k@x.pl' };
        expect(P.tresc('ticket', T, env).temat).toBe('[Estelio] Nowe zgłoszenie #13 [normalna]: Stan magazynowy kosmetyki — Boczki');
        expect(P.tresc('ponownie', T, env).temat).toBe('[Estelio] Ponownie: zgłoszenie #13 [normalna]: Stan magazynowy kosmetyki — Boczki');
        expect(P.tresc('dopisek', { ...T, opis: 'Dopisek', otwarte_ponownie: true }, env).temat).toBe('[Estelio] Komentarz do zgłoszenia #13: Stan magazynowy kosmetyki — Boczki (otwarte ponownie)');
        for (const r of ['ticket', 'dopisek', 'ponownie']) expect(P.tresc(r, T, env).temat).toMatch(/^\[Estelio\] /);
    });

    test('treść: HTML z escapowaniem, link do panelu z APP_URL, wersja tekstowa; komentarz pokazuje treść komentarza', () => {
        const m = P.tresc('ticket', T, { SMTP_USER: 'k@x.pl', APP_URL: "'https://dev.estelio.com.pl/'" });
        expect(m.html).toContain('&lt;b&gt;filtra&lt;/b&gt;');
        expect(m.html).not.toContain('<b>filtra</b>');
        expect(m.html).toContain('https://dev.estelio.com.pl/admin.html');
        expect(m.html).toContain('Gosia · Recepcja');
        expect(m.text).toContain('Opis: Nie jestem pewna <b>filtra</b>.');
        const d = P.tresc('dopisek', { ...T, opis: 'Proszę o kontakt' }, { SMTP_USER: 'k@x.pl' });
        expect(d.html).toContain('Treść komentarza');
        expect(d.text).toContain('Treść komentarza: Proszę o kontakt');
        expect(d.html).not.toContain('Kategoria');
    });

    test('wyslij: bez SMTP rzuca i NIE tworzy transportu; z konfiguracją wysyła na adresata z nadawcą SMTP_USER', async () => {
        nodemailer.createTransport.mockReset();
        await expect(P.wyslij('ticket', T, { SMTP_USER: 'k@x.pl' })).rejects.toThrow(/Brak konfiguracji SMTP/);
        expect(nodemailer.createTransport).not.toHaveBeenCalled();
        const sendMail = jest.fn().mockResolvedValue({ accepted: ['t@x.pl'], messageId: '<1>' });
        nodemailer.createTransport.mockReturnValue({ sendMail });
        const info = await P.wyslij('dopisek', { ...T, opis: 'Dopisek' }, { SMTP_HOST: 'smtp.h', SMTP_PORT: '465', SMTP_USER: 'k@x.pl', SMTP_PASS: 'tajne', TICKETY_EMAIL: 't@x.pl' });
        expect(info.accepted).toEqual(['t@x.pl']);
        expect(nodemailer.createTransport).toHaveBeenCalledWith({ host: 'smtp.h', port: 465, secure: true, auth: { user: 'k@x.pl', pass: 'tajne' } });
        const msg = sendMail.mock.calls[0][0];
        expect(msg.to).toBe('t@x.pl');
        expect(msg.from).toBe('"Estelio — zgłoszenia" <k@x.pl>');
        expect(msg.subject).toMatch(/^\[Estelio\] Komentarz do zgłoszenia #13/);
        expect(msg.html).toContain('Dopisek');
    });
});
