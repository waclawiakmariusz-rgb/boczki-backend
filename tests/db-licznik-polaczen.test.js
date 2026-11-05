// tests/db-licznik-polaczen.test.js — minimalna diagnostyka puli: zdarzenia, linia logu, i (v2 po recenzji) liczenie błędów
// DOKŁADNIE RAZ na wszystkich ścieżkach używanych przez aplikację: pool.query, pool.execute, getConnection, connection.query/
// execute/beginTransaction/commit/rollback. Atrapa puli odwzorowuje mysql2: pool.query/execute wołają this.getConnection, a przy
// odmowie przekazują TEN SAM obiekt błędu do callbacka zapytania.
const EventEmitter = require('events');
const { podepnij } = require('../db-licznik-polaczen');

const blad = (kod) => Object.assign(new Error(kod), { code: kod });
const flush = () => new Promise((r) => setImmediate(() => setImmediate(r)));

// atrapa połączenia: metody z callbackiem; SQL zawierający BLAD → błąd ER_X
function polaczenieAtrapa() {
  const c = { release: jest.fn(), mocki: {} }; // mocki = oryginalne atrapy metod (licznik owija c[m], więc asercje liczą na c.mocki[m])
  // jak mysql2: query/execute przyjmują (sql, …, cb) albo gotowy obiekt zapytania {sql, onResult} (tak woła je pool.query)
  for (const m of ['query', 'execute']) c[m] = c.mocki[m] = jest.fn((sql, ...r) => { const cb = typeof sql === 'object' ? sql.onResult : r[r.length - 1]; const tekst = typeof sql === 'object' ? sql.sql : sql; setImmediate(() => cb(/BLAD/.test(tekst) ? blad('ER_X') : null, [{ ok: 1 }])); });
  for (const m of ['beginTransaction', 'commit', 'rollback']) c[m] = jest.fn((cb) => setImmediate(() => cb(c.transakcjeZawodza ? blad('ER_LOCK_WAIT_TIMEOUT') : null)));
  return c;
}

// atrapa puli jak mysql2: getConnection tworzy połączenie (emit 'connection') albo odmawia; query/execute idą przez getConnection
function pulaAtrapa({ odmowa } = {}) {
  const p = new EventEmitter();
  p.config = { connectionLimit: 10 };
  p._freeConnections = { length: 3 };
  p.polaczenia = [];
  p.getConnection = function (cb) {
    if (odmowa) return setImmediate(() => cb(blad(odmowa)));
    const c = polaczenieAtrapa(); p.polaczenia.push(c); p.emit('connection', c); setImmediate(() => cb(null, c));
  };
  // jak mysql2 base/pool.js: pool.query tworzy obiekt zapytania z onResult = cb i przekazuje go do conn.query(obiekt) — BEZ callbacka
  p.query = function (sql, ...r) { const cb = r[r.length - 1]; this.getConnection((err, c) => { if (err) return cb(err); c.query({ sql, onResult: (e, w) => { c.release(); cb(e, w); } }); }); };
  p.execute = function (sql, ...r) { const cb = r[r.length - 1]; this.getConnection((err, c) => { if (err) return cb(err); c.execute(sql, (e, w) => { c.release(); cb(e, w); }); }); };
  return p;
}
const log = () => ({ log: jest.fn(), error: jest.fn() });

test('zdarzenia puli: connection = nowe fizyczne, acquire/release/enqueue osobno; linia logu z tempem na godzinę i wolnymi', () => {
  jest.useFakeTimers();
  try {
    const p = pulaAtrapa(); const lg = log();
    const d = podepnij(p, { coMs: 60000, log: lg });
    p.emit('connection'); p.emit('connection'); p.emit('acquire'); p.emit('acquire'); p.emit('release'); p.emit('enqueue');
    expect(d.stan()).toMatchObject({ nowe: 2, pobrania: 2, zwroty: 1, kolejka: 1, bledy: 0 });
    jest.advanceTimersByTime(60000);
    expect(lg.log).toHaveBeenCalledTimes(1);
    const linia = lg.log.mock.calls[0][0];
    expect(linia).toMatch(/^\[db-pula\] \d{4}-\d{2}-\d{2}T.*nowe połączenia \+2 \(łącznie 2, tempo 120\/h\) · pobrania \+2 · zwroty \+1 · czekało w kolejce \+1 · błędy \+0 · wolne 3\/10$/);
    jest.advanceTimersByTime(60000);
    expect(lg.log.mock.calls[1][0]).toMatch(/nowe połączenia \+0 \(łącznie 2, tempo 0\/h\)/); // okno wyzerowane, „łącznie” narasta
    d.stop();
  } finally { jest.useRealTimers(); }
});

test('błąd SQL przez pool.query liczony raz z kodem; udane zapytania nie liczone', async () => {
  const p = pulaAtrapa(); const lg = log(); const d = podepnij(p, { coMs: 60000, log: lg });
  const w = []; p.query('SELECT 1', (e) => w.push(e)); p.query('SELECT BLAD', (e) => w.push(e)); await flush();
  expect(w.map((e) => e && e.code)).toEqual([null, 'ER_X']); // obsługa błędów aplikacji bez zmian: callback dostaje ten sam błąd
  expect(d.stan()).toMatchObject({ bledy: 1, kody: { ER_X: 1 } });
  expect(lg.error).toHaveBeenCalledWith('[db-pula] błąd ER_X (query) ×1 od startu');
  d.stop();
});

test('odmowa getConnection w trakcie pool.query i pool.execute liczona DOKŁADNIE RAZ (nie drugi raz jako błąd zapytania)', async () => {
  const p = pulaAtrapa({ odmowa: 'ER_USER_LIMIT_REACHED' }); const lg = log(); const d = podepnij(p, { coMs: 60000, log: lg });
  const w = []; p.query('SELECT 1', (e) => w.push(e.code)); p.execute('SELECT 2', [], (e) => w.push(e.code)); p.getConnection((e) => w.push(e.code)); await flush();
  expect(w).toEqual(['ER_USER_LIMIT_REACHED', 'ER_USER_LIMIT_REACHED', 'ER_USER_LIMIT_REACHED']);
  expect(d.stan()).toMatchObject({ bledy: 3, kody: { ER_USER_LIMIT_REACHED: 3 } }); // 3 wywołania = 3 błędy, nie 5
  expect(lg.error).toHaveBeenCalledTimes(1); // ten sam kod najwyżej raz na 10 s
  expect(lg.error.mock.calls[0][0]).toMatch(/ER_USER_LIMIT_REACHED \(getConnection\)/);
  d.stop();
});

test('błąd SQL przez pool.execute liczony raz', async () => {
  const p = pulaAtrapa(); const lg = log(); const d = podepnij(p, { coMs: 60000, log: lg });
  const w = []; p.execute('UPDATE BLAD', [1], (e) => w.push(e && e.code)); p.execute('UPDATE ok', [1], (e) => w.push(e && e.code)); await flush();
  expect(w).toEqual(['ER_X', null]);
  expect(d.stan()).toMatchObject({ bledy: 1, kody: { ER_X: 1 } });
  d.stop();
});

test('zapytania na połączeniu z getConnection (query, execute, beginTransaction/commit/rollback) — błędy liczone raz, sukcesy nie', async () => {
  const p = pulaAtrapa(); const lg = log(); const d = podepnij(p, { coMs: 60000, log: lg });
  const w = [];
  p.getConnection((err, c) => {
    c.beginTransaction((e1) => { w.push(e1); c.query('INSERT BLAD', [1], (e2) => { w.push(e2 && e2.code); c.execute('SELECT BLAD', (e3) => { w.push(e3 && e3.code); c.commit((e4) => { w.push(e4); c.rollback((e5) => { w.push(e5); c.release(); }); }); }); }); });
  });
  await flush(); await flush(); await flush();
  expect(w).toEqual([null, 'ER_X', 'ER_X', null, null]);
  expect(d.stan()).toMatchObject({ bledy: 2, kody: { ER_X: 2 } });
  expect(lg.error.mock.calls[0][0]).toMatch(/ER_X \(połączenie\.query\)/);
  // to samo fizyczne połączenie użyte ponownie (pula wydaje je drugi raz bez zdarzenia 'connection'): nadal liczone, i nadal raz
  const c = p.polaczenia[0]; c.transakcjeZawodza = true;
  c.beginTransaction((e) => w.push(e.code)); await flush();
  expect(w[5]).toBe('ER_LOCK_WAIT_TIMEOUT');
  expect(d.stan()).toMatchObject({ bledy: 3, kody: { ER_X: 2, ER_LOCK_WAIT_TIMEOUT: 1 } });
  expect(c.mocki.query).toHaveBeenCalledTimes(1); // owinięcie nie zmienia liczby realnych wywołań
  d.stop();
});

test('ten sam obiekt błędu przez kilka warstw = jeden wpis; wewnętrzne conn.query(obiektZapytania) bez callbacka przepuszczone bez zmian', async () => {
  const p = pulaAtrapa(); const lg = log(); const d = podepnij(p, { coMs: 60000, log: lg });
  const e = blad('ECONNRESET');
  p.emit('error', e); p.emit('error', e); // pula zgłasza ten sam błąd dwa razy
  expect(d.stan()).toMatchObject({ bledy: 1, kody: { ECONNRESET: 1 } });
  p.getConnection((err, c) => { c.query({ sql: 'SELECT 1', onResult: () => {} }); }); await flush();
  expect(p.polaczenia[0].mocki.query).toHaveBeenCalledWith({ sql: 'SELECT 1', onResult: expect.any(Function) });
  expect(d.stan().bledy).toBe(1);
  d.stop();
});
