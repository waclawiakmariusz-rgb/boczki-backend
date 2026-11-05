// tests/db-licznik-polaczen.test.js — minimalna diagnostyka puli: liczy zdarzenia, obserwuje kody błędów, nie zmienia kontraktu.
const EventEmitter = require('events');
const { podepnij } = require('../db-licznik-polaczen');

function pulaAtrapa() {
  const p = new EventEmitter();
  p.config = { connectionLimit: 10 };
  p._freeConnections = { length: 3 };
  p.query = jest.fn(function (...args) { const cb = args[args.length - 1]; const sql = typeof args[0] === 'string' ? args[0] : args[0].sql; if (typeof cb === 'function') setImmediate(() => cb(/BLAD/.test(sql) ? Object.assign(new Error('x'), { code: 'ER_USER_LIMIT_REACHED' }) : null, [{ ok: 1 }])); return { sql }; });
  p.getConnection = jest.fn(function (cb) { setImmediate(() => cb(Object.assign(new Error('y'), { code: 'ECONNRESET' }))); });
  return p;
}
const log = () => ({ log: jest.fn(), error: jest.fn() });

test('zdarzenia puli: connection = nowe fizyczne, acquire/release/enqueue osobno; linia logu z tempem na godzinę i wolnymi', () => {
  jest.useFakeTimers();
  try {
    const p = pulaAtrapa(); const lg = log();
    const d = podepnij(p, { coMs: 60000, log: lg });
    p.emit('connection'); p.emit('connection'); p.emit('acquire'); p.emit('acquire'); p.emit('release'); p.emit('enqueue');
    jest.advanceTimersByTime(60000);
    expect(lg.log).toHaveBeenCalledTimes(1);
    const linia = lg.log.mock.calls[0][0];
    expect(linia).toMatch(/\[db-pula\] .* nowe połączenia \+2 \(łącznie 2, tempo 120\/h\) · pobrania \+2 · zwroty \+1 · czekało w kolejce \+1 · błędy \+0 · wolne 3\/10/);
    jest.advanceTimersByTime(60000);
    expect(lg.log.mock.calls[1][0]).toMatch(/nowe połączenia \+0 \(łącznie 2/);
    expect(d.stan()).toMatchObject({ nowe: 2, pobrania: 2, zwroty: 1, kolejka: 1, bledy: 0 });
    d.stop();
  } finally { jest.useRealTimers(); }
});

test('kody błędów zapytań i pobrań liczone po kodzie, log ograniczony do jednego wpisu na kod na 10 s, bez treści SQL; kontrakt query zachowany', async () => {
  const p = pulaAtrapa(); const lg = log();
  const d = podepnij(p, { coMs: 60000, log: lg });
  const wynik = (f) => new Promise((res) => f((e, r) => res(e ? e.code : r)));
  expect(await wynik((cb) => p.query('SELECT 1', cb))).toEqual([{ ok: 1 }]);                       // (sql, cb)
  expect(await wynik((cb) => p.query('SELECT BLAD tajne-dane', [1], cb))).toBe('ER_USER_LIMIT_REACHED'); // (sql, params, cb)
  expect(await wynik((cb) => p.query({ sql: 'SELECT BLAD' }, cb))).toBe('ER_USER_LIMIT_REACHED');       // (opcje, cb)
  expect(p.query('SELECT BLAD bez callbacka').sql).toBe('SELECT BLAD bez callbacka');                    // bez cb — wartość zwracana zachowana
  expect(await wynik((cb) => p.getConnection(cb))).toBe('ECONNRESET');
  p.emit('error', Object.assign(new Error('z'), { code: 'PROTOCOL_CONNECTION_LOST' }));
  const s = d.stan();
  expect(s.kody).toEqual({ ER_USER_LIMIT_REACHED: 2, ECONNRESET: 1, PROTOCOL_CONNECTION_LOST: 1 });
  expect(lg.error).toHaveBeenCalledTimes(3); // drugi ER_USER_LIMIT_REACHED w tej samej sekundzie nie dubluje wpisu
  expect(lg.error.mock.calls.map(c => c[0]).join('\n')).toMatch(/błąd ER_USER_LIMIT_REACHED \(query\)/);
  expect(lg.error.mock.calls.map(c => c[0]).join('\n')).not.toMatch(/tajne-dane|SELECT/);
  d.stop();
});
