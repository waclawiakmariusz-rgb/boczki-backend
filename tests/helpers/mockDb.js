// tests/helpers/mockDb.js
// Fabryka mockowanej bazy danych dla testów

/**
 * Wspólna implementacja. `pomijaj` = wyrażenie dla zapytań DDL, które NIE zużywają kolejki wyników
 * (odpowiadają od razu `{ affectedRows: 0 }`), bo są migracją uruchamianą przy ładowaniu modułu, nie logiką handlera.
 */
function fabryka(pomijaj, resultSets) {
    let callIndex = 0;

    const queryMock = jest.fn((sql, paramsOrCallback, maybeCallback) => {
        const callback = typeof paramsOrCallback === 'function' ? paramsOrCallback : maybeCallback;

        if (pomijaj.test(String(sql || ''))) {
            if (callback) callback(null, { affectedRows: 0 });
            return;
        }

        const result = resultSets[callIndex] || { err: null, rows: [] };
        callIndex++;

        if (callback) {
            callback(result.err || null, result.rows !== undefined ? result.rows : result);
        }
    });

    return { query: queryMock, _callIndex: () => callIndex };
}

/**
 * Tworzy mock db.query który zwraca podane wyniki po kolei.
 * Każdy element tablicy to { err, rows } dla kolejnego wywołania query.
 *
 * KONTRAKT DOMYŚLNY (jak od początku projektu): tylko idempotentne migracje `ALTER TABLE` uruchamiane przy ładowaniu
 * modułu (fire-and-forget) są pomijane i nie „zjadają” kolejnych wyników. `CREATE TABLE` ZUŻYWA kolejkę — zestawy
 * klienci/konsultacje/lojalnosc/reset-hasla/tickety (łącznie ~270 wywołań) przygotowują dla nich odpowiedzi jawnie.
 * Nie zmieniaj tego globalnie: rozszerzenie na CREATE w commicie a72fc9d przesunęło kolejki i dało 111 fałszywych porażek.
 *
 * Przykład:
 *   const db = mockDb(
 *     { rows: [{ id: 1 }] },     // 1. wywołanie
 *     { rows: [] },              // 2. wywołanie
 *   );
 */
function mockDb(...resultSets) {
    return fabryka(/^\s*ALTER\s+TABLE/i, resultSets);
}

/**
 * Wariant JAWNY dla modułów, które przy `require` wykonują `CREATE TABLE IF NOT EXISTS` i których testy nie przygotowują
 * na to odpowiedzi (np. routes/magazyn.js → Magazyn_Wycofane_Zamowienia). Pomija ALTER i CREATE; reszta jak mockDb.
 */
function mockDbBezDDL(...resultSets) {
    return fabryka(/^\s*(ALTER|CREATE)\s+TABLE/i, resultSets);
}

/**
 * Tworzy mock db który zawsze zwraca ten sam wynik.
 */
function mockDbAlways(rows = [], err = null) {
    return {
        query: jest.fn((sql, paramsOrCallback, maybeCallback) => {
            const callback = typeof paramsOrCallback === 'function' ? paramsOrCallback : maybeCallback;
            if (callback) callback(err, rows);
        })
    };
}

module.exports = { mockDb, mockDbBezDDL, mockDbAlways };
