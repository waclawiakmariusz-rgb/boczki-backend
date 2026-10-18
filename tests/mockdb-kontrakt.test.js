// tests/mockdb-kontrakt.test.js — kontrakt pomocnika atrapy bazy (W02 planu wdrożenia 2026-10-17).
// Wykrywa realne przesunięcie kolejki odpowiedzi: ALTER nigdy nie zużywa odpowiedzi przeznaczonej dla zapytania
// biznesowego; CREATE zużywa ją w trybie domyślnym (mockDb) i nie zużywa w trybie jawnym (mockDbBezDDL).
const { mockDb, mockDbBezDDL } = require('./helpers/mockDb');

const q = (db, sql) => new Promise((res) => db.query(sql, [], (err, rows) => res({ err, rows })));

describe('mockDb — kontrakt domyślny (jak na main)', () => {
    test('ALTER TABLE nie zużywa kolejki; kolejne SELECT/INSERT dostają swoje odpowiedzi w kolejności', async () => {
        const db = mockDb({ rows: [{ id: 1 }] }, { rows: { affectedRows: 1 } });
        expect((await q(db, 'ALTER TABLE X ADD COLUMN y INT')).rows).toEqual({ affectedRows: 0 });
        expect(db._callIndex()).toBe(0);
        expect((await q(db, 'SELECT * FROM X')).rows).toEqual([{ id: 1 }]);
        expect((await q(db, 'INSERT INTO X VALUES (1)')).rows).toEqual({ affectedRows: 1 });
        expect(db._callIndex()).toBe(2);
    });

    test('CREATE TABLE ZUŻYWA odpowiedź z kolejki (zestawy klienci/lojalnosc/tickety przygotowują ją jawnie)', async () => {
        const db = mockDb({ rows: [] }, { rows: [{ id: 7 }] });
        await q(db, 'CREATE TABLE IF NOT EXISTS Cos (id INT)');
        expect(db._callIndex()).toBe(1);
        expect((await q(db, 'SELECT * FROM Cos')).rows).toEqual([{ id: 7 }]);
    });

    test('przesunięcie kolejki jest wykrywalne: brak przygotowanej odpowiedzi daje pustą listę, nie cudzą', async () => {
        const db = mockDb({ rows: [{ id: 1 }] });
        await q(db, 'SELECT 1');
        expect((await q(db, 'SELECT 2')).rows).toEqual([]);
    });

    test('błąd z kolejki trafia do callbacku', async () => {
        const db = mockDb({ err: new Error('ER_TEST'), rows: null });
        expect((await q(db, 'SELECT 1')).err.message).toBe('ER_TEST');
    });
});

describe('mockDbBezDDL — wariant jawny dla modułów z CREATE TABLE przy require (magazyn)', () => {
    test('ALTER i CREATE nie zużywają kolejki; pierwsze zapytanie biznesowe dostaje pierwszą odpowiedź', async () => {
        const db = mockDbBezDDL({ rows: [{ id: 1 }] });
        await q(db, 'CREATE TABLE IF NOT EXISTS Magazyn_Wycofane_Zamowienia (id INT)');
        await q(db, '  alter table X add column y int');
        expect(db._callIndex()).toBe(0);
        expect((await q(db, 'SELECT * FROM X')).rows).toEqual([{ id: 1 }]);
    });

    test('CREATE INDEX / inne DDL poza TABLE nadal zużywają kolejkę (pomijanie jest wąskie, nie „wszystko co CREATE”)', async () => {
        const db = mockDbBezDDL({ rows: [{ ok: 1 }] });
        expect((await q(db, 'CREATE INDEX i ON X (y)')).rows).toEqual([{ ok: 1 }]);
        expect(db._callIndex()).toBe(1);
    });
});
