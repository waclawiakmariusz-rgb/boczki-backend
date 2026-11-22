// tests/email-unikalny.test.js
// Jeden adres e-mail = jedna licencja (2026-11-17, docs/PLAN_UNIKALNY_EMAIL_2026-11-16.md, paczka B) — routes/email-unikalny.js.
const { KOMUNIKAT_ZAJETY, normalizujEmail, poprawnyFormatEmail, emailZajety, czyDuplikatEmail } = require('../routes/email-unikalny');

const fakeDb = (odpowiedz) => {
    const calls = [];
    return {
        calls,
        query: jest.fn((sql, params, cb) => { calls.push([sql, params]); if (odpowiedz instanceof Error) return cb(odpowiedz); cb(null, odpowiedz); }),
    };
};

describe('normalizujEmail / poprawnyFormatEmail', () => {
    test('trim + małe litery; pusty tekst, spacje, null, undefined → null', () => {
        expect(normalizujEmail('  Jan.Kowalski@Firma.PL ')).toBe('jan.kowalski@firma.pl');
        expect(normalizujEmail('')).toBeNull();
        expect(normalizujEmail('   ')).toBeNull();
        expect(normalizujEmail(null)).toBeNull();
        expect(normalizujEmail(undefined)).toBeNull();
        expect(normalizujEmail(123)).toBe('123');
    });
    test('format: poprawne i niepoprawne adresy, limit 255 znaków', () => {
        expect(poprawnyFormatEmail('a@b.pl')).toBe(true);
        expect(poprawnyFormatEmail('  A@B.PL ')).toBe(true);
        expect(poprawnyFormatEmail('waclawiak.mariusz+papillon@gmail.com')).toBe(true);
        expect(poprawnyFormatEmail('bez-malpy.pl')).toBe(false);
        expect(poprawnyFormatEmail('a@b')).toBe(false);
        expect(poprawnyFormatEmail('a b@c.pl')).toBe(false);
        expect(poprawnyFormatEmail('')).toBe(false);
        expect(poprawnyFormatEmail(null)).toBe(false);
        expect(poprawnyFormatEmail('a'.repeat(250) + '@b.pl')).toBe(true);   // 255 znakow = granica kolumny varchar(255)
        expect(poprawnyFormatEmail('a'.repeat(251) + '@b.pl')).toBe(false);  // 256 znakow nie zmiesci sie w kolumnie
    });
});

describe('emailZajety', () => {
    test('adres wolny → false; zapytanie po LOWER(TRIM(email)) z adresem znormalizowanym', async () => {
        const db = fakeDb([]);
        expect(await emailZajety(db, ' Nowy@Salon.PL ')).toBe(false);
        expect(db.calls).toHaveLength(1);
        expect(db.calls[0][0]).toMatch(/LOWER\(TRIM\(email\)\) = \?/);
        expect(db.calls[0][0]).not.toMatch(/id_bazy <>/);
        expect(db.calls[0][1]).toEqual(['nowy@salon.pl']);
    });
    test('adres zajęty przez inny salon → true', async () => {
        const db = fakeDb([{ id_bazy: 'boczki-salon-glowny-001' }]);
        expect(await emailZajety(db, 'waclawiak.mariusz@gmail.com')).toBe(true);
    });
    test('pusty adres → false bez zapytania do bazy (brak adresu = NULL, wiele NULL jest dozwolonych)', async () => {
        const db = fakeDb([{ id_bazy: 'x' }]);
        expect(await emailZajety(db, '')).toBe(false);
        expect(await emailZajety(db, null)).toBe(false);
        expect(db.query).not.toHaveBeenCalled();
    });
    test('edycja salonu: własny id_bazy wykluczony z porównania (id_bazy <> ?)', async () => {
        const db = fakeDb([]);
        expect(await emailZajety(db, 'a@b.pl', 'moj-salon-1234')).toBe(false);
        expect(db.calls[0][0]).toMatch(/id_bazy <> \?/);
        expect(db.calls[0][1]).toEqual(['a@b.pl', 'moj-salon-1234']);
    });
    test('odpowiedź bazy, która nie jest tablicą (np. atrapa {affectedRows}) → nie zajęty', async () => {
        const db = fakeDb({ affectedRows: 1 });
        expect(await emailZajety(db, 'a@b.pl')).toBe(false);
    });
    test('błąd bazy → reject (wywołujący ma odmówić zapisu, nie przepuścić go bez kontroli)', async () => {
        const db = fakeDb(new Error('ECONNRESET'));
        await expect(emailZajety(db, 'a@b.pl')).rejects.toThrow('ECONNRESET');
    });
    test('działa na połączeniu z transakcji (obiekt z własnym query), nie tylko na puli', async () => {
        const conn = { query: jest.fn((sql, p, cb) => cb(null, [{ id_bazy: 'y' }])) };
        expect(await emailZajety(conn, 'a@b.pl')).toBe(true);
    });
});

describe('czyDuplikatEmail', () => {
    const dup = (msg) => Object.assign(new Error(msg), { code: 'ER_DUP_ENTRY' });
    test('ER_DUP_ENTRY z indeksu uq_licencje_email → true; login (PRIMARY) i id_bazy → false', () => {
        expect(czyDuplikatEmail(dup("Duplicate entry 'a@b.pl' for key 'uq_licencje_email'"))).toBe(true);
        expect(czyDuplikatEmail(dup("Duplicate entry 'a@b.pl' for key 'Licencje.uq_licencje_email'"))).toBe(true);
        expect(czyDuplikatEmail(dup("Duplicate entry 'studio' for key 'PRIMARY'"))).toBe(false);
        expect(czyDuplikatEmail(dup("Duplicate entry 'x' for key 'uq_licencje_id_bazy'"))).toBe(false);
        expect(czyDuplikatEmail(Object.assign(new Error('uq_licencje_email'), { code: 'ER_DATA_TOO_LONG' }))).toBe(false);
        expect(czyDuplikatEmail(null)).toBe(false);
    });
});

describe('komunikat', () => {
    test('jeden komunikat dla klienta: mówi o zajętym adresie, nie zdradza salonu, podaje kontakt', () => {
        expect(KOMUNIKAT_ZAJETY).toMatch(/zarejestrowany salon/);
        expect(KOMUNIKAT_ZAJETY).toMatch(/kontakt@estelio\.com\.pl/);
        expect(KOMUNIKAT_ZAJETY).not.toMatch(/id_bazy|tenant/i);
    });
});
