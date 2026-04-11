// tests/helpers/mockDb.js
// Fabryka mockowanej bazy danych dla testów

/**
 * Tworzy mock db.query który zwraca podane wyniki po kolei.
 * Każdy element tablicy to { err, rows } dla kolejnego wywołania query.
 *
 * Przykład:
 *   const db = mockDb(
 *     { rows: [{ id: 1 }] },     // 1. wywołanie
 *     { rows: [] },              // 2. wywołanie
 *   );
 */
function mockDb(...resultSets) {
    let callIndex = 0;

    const queryMock = jest.fn((sql, paramsOrCallback, maybeCallback) => {
        const result = resultSets[callIndex] || { err: null, rows: [] };
        callIndex++;

        const callback = typeof paramsOrCallback === 'function' ? paramsOrCallback : maybeCallback;
        if (callback) {
            callback(result.err || null, result.rows !== undefined ? result.rows : result);
        }
    });

    return { query: queryMock, _callIndex: () => callIndex };
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

module.exports = { mockDb, mockDbAlways };
