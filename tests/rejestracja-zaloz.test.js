// tests/rejestracja-zaloz.test.js
// Atomowe założenie salonu — routes/rejestracja-zaloz.js (2026-10-09, etap 1 audytu).

const { zalozSalon, nowyTenantId, slugify } = require('../routes/rejestracja-zaloz');

const cichyLog = { log: () => {}, warn: () => {}, error: () => {} };

// Fałszywe połączenie z puli: odpowiedzi po kolei (jak mockDb), plus liczniki transakcji.
function fakePool(odpowiedzi, opcje = {}) {
    let i = 0;
    const conn = {
        calls: [],
        n: { begin: 0, commit: 0, rollback: 0, release: 0 },
        query: jest.fn((sql, params, cb) => {
            conn.calls.push([sql, params]);
            const r = odpowiedzi[i++] || { rows: { affectedRows: 1 } };
            if (r.err) return cb(r.err);
            cb(null, r.rows);
        }),
        beginTransaction: jest.fn(cb => { conn.n.begin++; cb(null); }),
        commit: jest.fn(cb => { conn.n.commit++; cb(null); }),
        rollback: jest.fn(cb => { conn.n.rollback++; cb(); }),
        release: jest.fn(() => { conn.n.release++; }),
    };
    const pool = { getConnection: jest.fn(cb => (opcje.brakPolaczenia ? cb(new Error('pool exhausted')) : cb(null, conn))), conn };
    return pool;
}
const dupErr = (msg) => Object.assign(new Error(msg), { code: 'ER_DUP_ENTRY' });
const sqlZ = (conn, fragment) => conn.calls.filter(c => String(c[0]).includes(fragment));

const dane = () => ({
    token: 'tok-1', nazwa_salonu: 'Studio Urody Łódź', ulica: 'Piotrkowska 1', miasto: 'Łódź', telefon: '600',
    loginNorm: 'studio-lodz', hasloHash: '$2b$10$hash', nazwaFirmy: null, emailLicencji: 'a@b.pl',
    stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
    pracownicy: [{ imie: 'Anna', pin: '1234', rola: 'manager' }, { imie: 'Ola', pin: '5678', rola: 'pracownik' }],
    uslugi: [{ kategoria: 'Twarz', wariant: 'Oczyszczanie', cena: 150, zrodlo: 'predef' }],
});

describe('nowyTenantId / slugify', () => {
    test('slug bez polskich znaków + 8 znaków hex, za każdym razem inny', () => {
        const a = nowyTenantId('Studio Urody Łódź'), b = nowyTenantId('Studio Urody Łódź');
        expect(a).toMatch(/^studio-urody-lodz-[0-9a-f]{8}$/);
        expect(a).not.toBe(b);
        expect(slugify('  Ąę Śź!! ')).toBe('ae-sz');
        expect(nowyTenantId('!!!')).toMatch(/^salon-[0-9a-f]{8}$/);
    });
});

describe('zalozSalon — transakcja', () => {
    test('pełna ścieżka: token, licencja, 2 pracowników (×2 tabele), 1 usługa → commit', async () => {
        const pool = fakePool([{ rows: { affectedRows: 1 } }]);   // token; reszta domyślnie OK
        const w = await zalozSalon({ db: pool, dane: dane(), log: cichyLog });
        expect(w.wynik).toBe('ok');
        expect(w.tenant_id).toMatch(/^studio-urody-lodz-[0-9a-f]{8}$/);
        const c = pool.conn;
        expect(c.n.begin).toBe(1); expect(c.n.commit).toBe(1); expect(c.n.rollback).toBe(0); expect(c.n.release).toBe(1);
        expect(sqlZ(c, "SET status='wykorzystany'")).toHaveLength(1);
        expect(sqlZ(c, 'INSERT INTO Licencje')).toHaveLength(1);
        expect(sqlZ(c, 'INSERT INTO Licencje')[0][1]).toEqual(expect.arrayContaining(['studio-lodz', '$2b$10$hash', w.tenant_id, 'a@b.pl', 'cus_1', 'sub_1']));
        expect(sqlZ(c, 'tenant_id_utworzony=?')[0][1]).toEqual([w.tenant_id, 'tok-1']);
        expect(sqlZ(c, 'INSERT INTO Użytkownicy')).toHaveLength(2);
        expect(sqlZ(c, 'INSERT INTO Użytkownicy')[0][1].slice(1)).toEqual([w.tenant_id, 'Anna', '1234', 'manager']);
        expect(sqlZ(c, 'INSERT INTO Pracownicy')).toHaveLength(2);
        expect(sqlZ(c, 'INSERT INTO Uslugi')).toHaveLength(1);
        expect(sqlZ(c, 'INSERT INTO Uslugi')[0][1].slice(1)).toEqual([w.tenant_id, 'Twarz', 'Oczyszczanie', 150, 'predef']);
    });

    test('token już użyty / wygasły → rollback, bez licencji', async () => {
        const pool = fakePool([{ rows: { affectedRows: 0 } }]);
        const w = await zalozSalon({ db: pool, dane: dane(), log: cichyLog });
        expect(w.wynik).toBe('token');
        expect(pool.conn.n.rollback).toBe(1); expect(pool.conn.n.commit).toBe(0); expect(pool.conn.n.release).toBe(1);
        expect(sqlZ(pool.conn, 'INSERT INTO Licencje')).toHaveLength(0);
    });

    test('login zajęty → rollback (token wraca do „nowy" przez rollback, bez osobnego UPDATE)', async () => {
        const pool = fakePool([{ rows: { affectedRows: 1 } }, { err: dupErr("Duplicate entry 'studio-lodz' for key 'PRIMARY'") }]);
        const w = await zalozSalon({ db: pool, dane: dane(), log: cichyLog });
        expect(w.wynik).toBe('login_zajety');
        expect(pool.conn.n.rollback).toBe(1); expect(pool.conn.n.commit).toBe(0);
        expect(sqlZ(pool.conn, "SET status='nowy'")).toHaveLength(0);
        expect(sqlZ(pool.conn, 'INSERT INTO Użytkownicy')).toHaveLength(0);
    });

    test('kolizja id_bazy → jedna ponowna próba z innym sufiksem → commit', async () => {
        const pool = fakePool([{ rows: { affectedRows: 1 } }, { err: dupErr("Duplicate entry 'x' for key 'uq_licencje_id_bazy'") }]);
        const w = await zalozSalon({ db: pool, dane: dane(), log: cichyLog });
        expect(w.wynik).toBe('ok');
        const lic = sqlZ(pool.conn, 'INSERT INTO Licencje');
        expect(lic).toHaveLength(2);
        expect(lic[0][1][3]).not.toBe(lic[1][1][3]);
        expect(lic[1][1][3]).toBe(w.tenant_id);
        expect(pool.conn.n.commit).toBe(1);
    });

    test('INSERT Użytkownicy pada → rollback CAŁOŚCI (żadnego pół-salonu), komunikat dla klienta', async () => {
        const pool = fakePool([
            { rows: { affectedRows: 1 } },     // token
            { rows: { affectedRows: 1 } },     // Licencje
            { rows: { affectedRows: 1 } },     // tenant_id_utworzony
            { err: Object.assign(new Error('Data too long'), { code: 'ER_DATA_TOO_LONG' }) },  // Użytkownicy
        ]);
        const w = await zalozSalon({ db: pool, dane: dane(), log: cichyLog });
        expect(w.wynik).toBe('blad');
        expect(w.message).toMatch(/link pozostaje ważny/i);
        expect(pool.conn.n.rollback).toBe(1); expect(pool.conn.n.commit).toBe(0); expect(pool.conn.n.release).toBe(1);
        expect(sqlZ(pool.conn, 'INSERT INTO Uslugi')).toHaveLength(0);
    });

    test('brak połączenia z puli → błąd bez dotykania bazy', async () => {
        const pool = fakePool([], { brakPolaczenia: true });
        const w = await zalozSalon({ db: pool, dane: dane(), log: cichyLog });
        expect(w.wynik).toBe('blad');
        expect(pool.conn.query).not.toHaveBeenCalled();
    });
});
