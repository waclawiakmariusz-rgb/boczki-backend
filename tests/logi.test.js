// tests/logi.test.js
// Rejestr błędów — makeZapiszBlad. Powstał 2026-07-29, bo recepcja zgłaszała
// „wyskoczył jakiś błąd" bez treści komunikatu i diagnoza była zgadywanką.

const { makeZapiszBlad } = require('../routes/logi');

function mockDb() {
    return { query: jest.fn((sql, params, cb) => { if (cb) cb(null, { affectedRows: 1 }); }) };
}

const TENANT = 'test-salon-001';

describe('makeZapiszBlad — zapis błędu do Dziennika Zdarzeń', () => {
    test('zapisuje błąd z akcją, osobą i treścią', () => {
        const db = mockDb();
        makeZapiszBlad(db)(TENANT, 'manage_deposit', 'Marta', "Unknown column 'bon'", 'POST /klienci');

        expect(db.query).toHaveBeenCalledTimes(1);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('INSERT INTO Logi');
        expect(params).toContain(TENANT);
        expect(params).toContain('Marta');
        // akcja oznaczona prefiksem, żeby dało się filtrować błędy w wyszukiwarce logów
        expect(params.some(p => String(p).startsWith('BŁĄD: manage_deposit'))).toBe(true);
        // treść błędu razem z kontekstem (metoda + ścieżka)
        expect(params.some(p => String(p).includes("Unknown column 'bon'"))).toBe(true);
        expect(params.some(p => String(p).includes('POST /klienci'))).toBe(true);
    });

    test('bez tenant_id nie zapisuje nic (nie zaśmiecamy logów obcych salonów)', () => {
        const db = mockDb();
        makeZapiszBlad(db)('', 'login', 'X', 'Błąd');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('pusty komunikat nie tworzy wpisu', () => {
        const db = mockDb();
        makeZapiszBlad(db)(TENANT, 'akcja', 'X', '');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('powtórka tego samego błędu jest tłumiona (jeden zepsuty endpoint nie zaleje dziennika)', () => {
        const db = mockDb();
        const zapisz = makeZapiszBlad(db);
        for (let i = 0; i < 20; i++) zapisz(TENANT, 'add_sale', 'Ania', 'Ten sam błąd');
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('różne błędy tej samej akcji zapisują się osobno', () => {
        const db = mockDb();
        const zapisz = makeZapiszBlad(db);
        zapisz(TENANT, 'add_sale', 'Ania', 'Błąd pierwszy');
        zapisz(TENANT, 'add_sale', 'Ania', 'Błąd drugi');
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('ten sam błąd w innym salonie zapisuje się osobno', () => {
        const db = mockDb();
        const zapisz = makeZapiszBlad(db);
        zapisz(TENANT, 'add_sale', 'Ania', 'Ten sam błąd');
        zapisz('inny-salon', 'add_sale', 'Ania', 'Ten sam błąd');
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('długi komunikat jest przycinany (nie wywraca INSERT-a)', () => {
        const db = mockDb();
        makeZapiszBlad(db)(TENANT, 'akcja', 'X', 'x'.repeat(5000));
        const [, params] = db.query.mock.calls[0];
        params.forEach(p => expect(String(p).length).toBeLessThanOrEqual(500));
    });

    test('błąd zapisu logu nie rzuca wyjątkiem (nie może wywrócić operacji)', () => {
        const db = { query: jest.fn((sql, params, cb) => { if (cb) cb(new Error('DB padło')); }) };
        expect(() => makeZapiszBlad(db)(TENANT, 'akcja', 'X', 'Błąd')).not.toThrow();
    });
});
