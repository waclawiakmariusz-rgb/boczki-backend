// tests/zgody-dziennik-zdarzen.test.js
// Polecenie właściciela (24.11.2026): „chcę, aby każdorazowo zmiany zgód zapisywały się w rejestrze, nie może być tak,
// że ktoś coś zmieni i żadna historia tego nie rejestruje”. Tło: recepcja wycofała zgody klientki (pani U.) i nikt nie
// umiał ustalić kiedy — Rejestr_RODO nie ma daty zmiany, a Dziennik Zdarzeń nie dostawał wpisu.
// Każdy zapis formularza RODO (save_rodo) i oświadczeń (update_consents) ma zostawić w Logi pełne zdanie:
// kogo dotyczy, kto zapisał, kiedy, co się zmieniło (stara → nowa wartość) i co zostało bez zmian.
const request = require('supertest');
const express = require('express');

const TENANT = 'salon-test';

function atrapaBazy(odpowiedzi = {}, opcje = {}) {
    const db = {
        logi: [],
        query: jest.fn((sql, paramsOrCb, maybeCb) => {
            const cb = typeof paramsOrCb === 'function' ? paramsOrCb : maybeCb;
            const params = typeof paramsOrCb === 'function' ? [] : paramsOrCb;
            const s = String(sql);
            if (s.startsWith('INSERT INTO Logi')) {
                db.logi.push({ sql: s, params });
                if (cb) cb(opcje.logPada ? new Error('Logi niedostępne') : null, { affectedRows: 1 });
                return;
            }
            const klucz = Object.keys(odpowiedzi).find((k) => s.includes(k));
            if (cb) cb(null, klucz ? odpowiedzi[klucz] : (/^(UPDATE|INSERT)/.test(s) ? { affectedRows: 1 } : []));
        }),
    };
    return db;
}
function app(db) { const a = express(); a.use(express.json()); a.use('/api', require('../routes/rodo')(db)); return a; }
const wpis = (db) => db.logi.map((l) => ({ akcja: l.params[3], kto: l.params[2], opis: l.params[4] }));

const STARE = { id: 'pierwszy', klient: 'Anna Urban Rajniak', data_podpisu: '2026-04-01', wizerunek: 'TAK', newsletter_sms: 'TAK', kontakt_tel: 'TAK', newsletter_email: 'TAK', booksy_sms: 'Nie dotyczy', email_adres: '', link_pdf: '', email_kontaktowy: '' };
const KLUCZ_RODO = 'SELECT id, klient, data_podpisu, wizerunek';
const KLUCZ_OSW = 'SELECT id, klient, data_podpisu, zapoznanie_z_regulaminem';

async function zapiszRodo(db, dane) {
    return request(app(db)).post('/api/rodo').send({
        action: 'save_rodo', tenant_id: TENANT, id_klienta: '1143', klient_nazwa: 'Anna Urban Rajniak', pracownik: 'Ania',
        data_podpisu: '2026-04-01', wizerunek: 'TAK', news_sms: 'TAK', kontakt_tel: 'TAK', news_email: 'TAK', booksy_sms: 'Nie dotyczy',
        ...dane,
    });
}

describe('zapis zgód RODO (save_rodo) zostawia wpis w Dzienniku Zdarzeń', () => {
    test('BŁĄD, KTÓRY NAPRAWIAMY: wycofanie zgód na telefon i SMS → pełne zdanie: komu, kto, kiedy, co z czego na co', async () => {
        const db = atrapaBazy({ [KLUCZ_RODO]: [STARE] });
        const res = await zapiszRodo(db, { kontakt_tel: 'NIE', news_sms: 'NIE' });
        expect(res.body.status).toBe('success');
        expect(wpis(db)).toHaveLength(1);
        const w = wpis(db)[0];
        expect(w.akcja).toBe('ZMIANA ZGÓD RODO');
        expect(w.kto).toBe('Ania');
        expect(w.opis).toContain('Zgody RODO: Anna Urban Rajniak (nr 1143)');
        expect(w.opis).toMatch(/Zmienione \d{2}\.\d{2}\.\d{4} o \d{2}:\d{2} \(zapis: Ania\)/);
        expect(w.opis).toContain('kontakt telefoniczny TAK → NIE');
        expect(w.opis).toContain('SMS marketingowy TAK → NIE');
        expect(w.opis).toContain('Bez zmian: e-mail marketingowy TAK, wizerunek TAK, Booksy SMS Nie dotyczy');
        expect(w.opis).not.toContain('e-mail marketingowy TAK → ');
    });

    test('zapis bez zmiany zgód, ale z nową datą podpisu i linkiem — wpis mówi, że zgody zostały, a co innego się zmieniło', async () => {
        const db = atrapaBazy({ [KLUCZ_RODO]: [STARE] });
        await zapiszRodo(db, { data_podpisu: '2026-11-20', link_pdf: 'https://pliki/rodo-1143.pdf' });
        const w = wpis(db)[0];
        expect(w.akcja).toBe('ZMIANA ZGÓD RODO');
        expect(w.opis).toContain('bez zmiany zgód');
        expect(w.opis).toContain('data podpisu 2026-04-01 → 2026-11-20');
        expect(w.opis).toContain('link do dokumentu');
        expect(w.opis).toContain('(kontakt telefoniczny TAK, SMS marketingowy TAK, e-mail marketingowy TAK, wizerunek TAK, Booksy SMS Nie dotyczy)');
    });

    test('puste pola z importu równają się domyślnym (Booksy SMS „” = „Nie dotyczy”, e-mail „nie dotyczy” = pusty) — nie są zgłaszane jako zmiana', async () => {
        const zImportu = { ...STARE, booksy_sms: '', newsletter_email: null, email_adres: 'nie dotyczy', email_kontaktowy: '' };
        const db = atrapaBazy({ [KLUCZ_RODO]: [zImportu] });
        await zapiszRodo(db, { news_email: 'NIE', booksy_sms: 'Nie dotyczy', email_adres: '', email_kontaktowy: '' });
        const w = wpis(db)[0];
        expect(w.opis).toContain('bez żadnych zmian');
        expect(w.opis).not.toContain('Booksy SMS brak');
        expect(w.opis).not.toContain('adres e-mail');
    });

    test('zapis identyczny z tym, co było — wpis „bez żadnych zmian” (ślad, że ktoś otworzył i zapisał)', async () => {
        const db = atrapaBazy({ [KLUCZ_RODO]: [STARE] });
        await zapiszRodo(db, {});
        expect(wpis(db)[0].opis).toContain('bez żadnych zmian');
    });

    test('pierwszy zapis zgód (brak wcześniejszego wpisu) — zdanie „zapisane po raz pierwszy” z pełną listą', async () => {
        const db = atrapaBazy({ [KLUCZ_RODO]: [] });
        const res = await zapiszRodo(db, { kontakt_tel: 'NIE', wizerunek: 'NIE' });
        expect(res.body.status).toBe('success');
        const w = wpis(db)[0];
        expect(w.akcja).toBe('ZMIANA ZGÓD RODO');
        expect(w.opis).toContain('Zapisane po raz pierwszy');
        expect(w.opis).toContain('kontakt telefoniczny NIE, SMS marketingowy TAK, e-mail marketingowy TAK, wizerunek NIE, Booksy SMS Nie dotyczy');
    });

    test('nazwa z bazy, gdy front jej nie przysłał; brak nazwiska pracownika → „nieznana osoba”', async () => {
        const db = atrapaBazy({ [KLUCZ_RODO]: [STARE] });
        await request(app(db)).post('/api/rodo').send({ action: 'save_rodo', tenant_id: TENANT, id_klienta: '1143', kontakt_tel: 'NIE' });
        const w = wpis(db)[0];
        expect(w.opis).toContain('Anna Urban Rajniak (nr 1143)');
        expect(w.opis).toContain('(zapis: nieznana osoba)');
        expect(w.kto).toBe('nieznana osoba');
    });

    test('wpis w Dzienniku powstaje po udanym zapisie, także gdy ujednolicenie kopii i sam wpis zawiodą — zapis zgód nie pada', async () => {
        const db = atrapaBazy({ [KLUCZ_RODO]: [STARE] }, { logPada: true });
        const res = await zapiszRodo(db, { kontakt_tel: 'NIE' });
        expect(res.body.status).toBe('success');
        expect(db.logi).toHaveLength(1);
        const kolejnosc = db.query.mock.calls.map((c) => String(c[0]).split(' ').slice(0, 3).join(' '));
        expect(kolejnosc.findIndex((s) => s.startsWith('INSERT INTO Logi'))).toBeGreaterThan(kolejnosc.findIndex((s) => s.startsWith('UPDATE Rejestr_RODO')));
    });

    test('nieudany zapis do bazy → brak wpisu w Dzienniku (nie zapisujemy zmiany, która się nie wydarzyła)', async () => {
        const db = atrapaBazy({ [KLUCZ_RODO]: [STARE] });
        const orig = db.query;
        db.query = jest.fn((sql, p, cb) => (String(sql).startsWith('UPDATE Rejestr_RODO') ? cb(new Error('baza padła')) : orig(sql, p, cb)));
        const res = await zapiszRodo(db, { kontakt_tel: 'NIE' });
        expect(res.body.status).toBe('error');
        expect(db.logi).toHaveLength(0);
    });
});

describe('zapis oświadczeń (update_consents) zostawia wpis w Dzienniku Zdarzeń', () => {
    const STARE_OSW = { id: 'osw1', klient: 'Anna Urban Rajniak', data_podpisu: '2026-04-01', zapoznanie_z_regulaminem: 'NIE', przekazano_wyciag: 'NIE', link_pdf: '' };
    async function zapiszOsw(db, dane) {
        return request(app(db)).post('/api/rodo').send({
            action: 'update_consents', tenant_id: TENANT, id_klienta: '1143', klient_nazwa: 'Anna Urban Rajniak', pracownik: 'Marta',
            data_podpisu: '2026-04-01', zapoznal: 'NIE', wyciag: 'NIE', ...dane,
        });
    }
    test('zmiana oświadczeń → zdanie ze starą i nową wartością', async () => {
        const db = atrapaBazy({ [KLUCZ_OSW]: [STARE_OSW] });
        const res = await zapiszOsw(db, { zapoznal: 'TAK', wyciag: 'TAK' });
        expect(res.body.status).toBe('success');
        const w = wpis(db)[0];
        expect(w.akcja).toBe('ZMIANA OŚWIADCZEŃ');
        expect(w.kto).toBe('Marta');
        expect(w.opis).toContain('Oświadczenia: Anna Urban Rajniak (nr 1143)');
        expect(w.opis).toMatch(/Zmienione \d{2}\.\d{2}\.\d{4} o \d{2}:\d{2} \(zapis: Marta\)/);
        expect(w.opis).toContain('zapoznanie z regulaminem NIE → TAK');
        expect(w.opis).toContain('przekazanie wyciągu NIE → TAK');
    });
    test('pierwsze oświadczenia → „zapisane po raz pierwszy”; zapis bez zmian → „bez żadnych zmian”', async () => {
        const db1 = atrapaBazy({ [KLUCZ_OSW]: [] });
        await zapiszOsw(db1, { zapoznal: 'TAK' });
        expect(wpis(db1)[0].opis).toContain('Zapisane po raz pierwszy');
        expect(wpis(db1)[0].opis).toContain('zapoznanie z regulaminem TAK, przekazanie wyciągu NIE');
        const db2 = atrapaBazy({ [KLUCZ_OSW]: [STARE_OSW] });
        await zapiszOsw(db2, {});
        expect(wpis(db2)[0].opis).toContain('bez żadnych zmian');
    });
});
