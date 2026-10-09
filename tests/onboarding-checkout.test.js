// tests/onboarding-checkout.test.js
// Obsługa zakupu (Stripe checkout.session.completed) — routes/onboarding-checkout.js (2026-10-09).

const { mockDb } = require('./helpers/mockDb');
const { obsluzCheckoutCompleted, dniWaznosciTokenu } = require('../routes/onboarding-checkout');

const DZIEN = 24 * 60 * 60 * 1000;
const cichyLog = { log: () => {}, warn: () => {}, error: () => {} };

function sesja(over = {}) {
    return {
        customer: 'cus_1', subscription: 'sub_1', amount_total: 7900,
        metadata: { zamowienie_id: 'zam-1', imie: 'Anna', nazwa_salonu: 'Salon Test', email: 'anna@test.pl', voucher: '', telefon: '600', miasto: 'Poznań', ...over.metadata },
        ...over,
    };
}
function deps(over = {}) {
    return {
        mailer: { wyslijLinkRejestracji: jest.fn().mockResolvedValue() },
        wystawFakture: jest.fn().mockResolvedValue(),
        powiadomAdminaOZakupie: jest.fn().mockResolvedValue(),
        log: cichyLog,
        trialDni: 14,
        ...over,
    };
}
const sql = (db, fragment) => db.query.mock.calls.find(c => String(c[0]).includes(fragment));

describe('dniWaznosciTokenu', () => {
    test('trial 14 → 30 dni (minimum), trial 30 → 37, brak trialu → 30', () => {
        expect(dniWaznosciTokenu(14)).toBe(30);
        expect(dniWaznosciTokenu(30)).toBe(37);
        expect(dniWaznosciTokenu(undefined)).toBe(30);
        expect(dniWaznosciTokenu(0)).toBe(30);
    });
});

describe('obsluzCheckoutCompleted', () => {
    test('pełna ścieżka: przejęcie zamówienia, token 30 dni, mail, status wyslano_link, faktura, admin', async () => {
        const db = mockDb(
            { rows: { affectedRows: 1 } },   // UPDATE Zamowienia nowe→oplacone
            { rows: { affectedRows: 1 } },   // INSERT token
            { rows: { affectedRows: 1 } },   // UPDATE token_wyslany
            { rows: { affectedRows: 1 } },   // UPDATE status wyslano_link
        );
        const d = deps();
        const przed = Date.now();
        const w = await obsluzCheckoutCompleted({ db, session: sesja(), ...d });
        expect(w.wynik).toBe('ok');
        expect(w.dni).toBe(30);
        expect(w.mailOk).toBe(true);
        expect(w.faktura).toBe('wystawiona');

        const claim = sql(db, "SET status='oplacone'");
        expect(claim[0]).toMatch(/WHERE id=\? AND status='nowe'/);
        expect(claim[1]).toEqual(['cus_1', 'sub_1', 'zam-1']);

        const tok = sql(db, 'INSERT INTO Tokeny_rejestracji');
        expect(tok[1][0]).toBe(w.token);
        const wygasa = tok[1][1].getTime();
        expect(wygasa).toBeGreaterThanOrEqual(przed + 30 * DZIEN - 1000);
        expect(wygasa).toBeLessThanOrEqual(Date.now() + 30 * DZIEN + 1000);

        expect(d.mailer.wyslijLinkRejestracji).toHaveBeenCalledWith(expect.objectContaining({ email: 'anna@test.pl', token: w.token, dniWaznosci: 30 }));
        const st = sql(db, 'SET status=? WHERE id=?');
        expect(st[1]).toEqual(['wyslano_link', 'zam-1']);
        expect(d.wystawFakture).toHaveBeenCalledWith(expect.objectContaining({ kwota_grosze: 7900, nazwa_salonu: 'Salon Test' }));
        await new Promise(r => setImmediate(r));
        expect(d.powiadomAdminaOZakupie).toHaveBeenCalledWith(expect.objectContaining({ mail_ok: true, kwota_grosze: 7900 }));
        // bez vouchera — brak inkrementacji
        expect(sql(db, 'Kody_rabatowe')).toBeUndefined();
    });

    test('powtórzone zdarzenie (zamówienie już nie jest „nowe") → nic: bez tokenu, maila, faktury', async () => {
        const db = mockDb({ rows: { affectedRows: 0 } });
        const d = deps();
        const w = await obsluzCheckoutCompleted({ db, session: sesja(), ...d });
        expect(w.wynik).toBe('duplikat');
        expect(sql(db, 'INSERT INTO Tokeny_rejestracji')).toBeUndefined();
        expect(d.mailer.wyslijLinkRejestracji).not.toHaveBeenCalled();
        expect(d.wystawFakture).not.toHaveBeenCalled();
    });

    test('SMTP pada → token zostaje, status blad_maila, faktura nadal, admin dostaje mail_ok=false', async () => {
        const db = mockDb(
            { rows: { affectedRows: 1 } }, { rows: { affectedRows: 1 } }, { rows: { affectedRows: 1 } }, { rows: { affectedRows: 1 } },
        );
        const d = deps({ mailer: { wyslijLinkRejestracji: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) } });
        const w = await obsluzCheckoutCompleted({ db, session: sesja(), ...d });
        expect(w.wynik).toBe('ok');
        expect(w.mailOk).toBe(false);
        expect(sql(db, 'INSERT INTO Tokeny_rejestracji')).toBeDefined();
        expect(sql(db, 'SET status=? WHERE id=?')[1]).toEqual(['blad_maila', 'zam-1']);
        expect(d.wystawFakture).toHaveBeenCalled();
        await new Promise(r => setImmediate(r));
        expect(d.powiadomAdminaOZakupie).toHaveBeenCalledWith(expect.objectContaining({ mail_ok: false }));
    });

    test('okres próbny (amount_total = 0) → BEZ faktury; voucher zliczony raz', async () => {
        const db = mockDb(
            { rows: { affectedRows: 1 } },   // claim
            { rows: { affectedRows: 1 } },   // voucher +1
            { rows: { affectedRows: 1 } },   // INSERT token
            { rows: { affectedRows: 1 } },   // token_wyslany
            { rows: { affectedRows: 1 } },   // status
        );
        const d = deps();
        const w = await obsluzCheckoutCompleted({ db, session: sesja({ amount_total: 0, metadata: { voucher: 'START5' } }), ...d });
        expect(w.faktura).toBe('pominieta');
        expect(d.wystawFakture).not.toHaveBeenCalled();
        const v = sql(db, 'Kody_rabatowe');
        expect(v[1]).toEqual(['START5']);
        expect(db.query.mock.calls.filter(c => String(c[0]).includes('Kody_rabatowe')).length).toBe(1);
    });

    test('błąd Fakturowni nie blokuje: token i mail są, faktura=blad', async () => {
        const db = mockDb(
            { rows: { affectedRows: 1 } }, { rows: { affectedRows: 1 } }, { rows: { affectedRows: 1 } }, { rows: { affectedRows: 1 } },
        );
        const d = deps({ wystawFakture: jest.fn().mockRejectedValue(new Error('API 500')) });
        const w = await obsluzCheckoutCompleted({ db, session: sesja(), ...d });
        expect(w.wynik).toBe('ok');
        expect(w.mailOk).toBe(true);
        expect(w.faktura).toBe('blad');
    });

    test('trial 30 dni → link ważny 37 dni i tyle samo w mailu', async () => {
        const db = mockDb(
            { rows: { affectedRows: 1 } }, { rows: { affectedRows: 1 } }, { rows: { affectedRows: 1 } }, { rows: { affectedRows: 1 } },
        );
        const d = deps({ trialDni: 30 });
        const w = await obsluzCheckoutCompleted({ db, session: sesja(), ...d });
        expect(w.dni).toBe(37);
        expect(d.mailer.wyslijLinkRejestracji).toHaveBeenCalledWith(expect.objectContaining({ dniWaznosci: 37 }));
    });
});
