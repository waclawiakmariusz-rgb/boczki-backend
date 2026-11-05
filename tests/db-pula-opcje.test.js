// tests/db-pula-opcje.test.js — opcje puli: domyślnie nic; wariant A ustawia sesję na nowym połączeniu; wariant B pinguje tylko wolne,
// nie więcej niż maxPing naraz, jeden przebieg naraz, przerwa po błędzie, stop() zatrzymuje.
const EventEmitter = require('events');
const { podepnij } = require('../db-pula-opcje');

function pulaAtrapa(wolnych) {
  const p = new EventEmitter();
  p._freeConnections = { length: wolnych };
  p.zapytania = [];
  p.getConnection = jest.fn((cb) => setImmediate(() => cb(null, { query: (sql, cb2) => { p.zapytania.push(sql); setImmediate(() => cb2(null, [{ 1: 1 }])); }, release: jest.fn() })));
  return p;
}
const cichy = { log: jest.fn(), error: jest.fn() };

test('bez opcji: nic nie podpięte (zachowanie jak produkcja)', () => {
  const p = pulaAtrapa(5);
  podepnij(p, { log: cichy });
  expect(p.listenerCount('connection')).toBe(0);
  p.emit('connection', { query: jest.fn() });
  expect(p.getConnection).not.toHaveBeenCalled();
});

test('wariant A: SET SESSION wait_timeout na każdym nowym połączeniu; zakres 20–3600; błąd liczony, nie wywraca', () => {
  const p = pulaAtrapa(0); const w = podepnij(p, { waitTimeout: 600, log: cichy });
  const c = { query: jest.fn((sql, params, cb) => cb(null)) };
  p.emit('connection', c);
  expect(c.query).toHaveBeenCalledWith('SET SESSION wait_timeout = ?', [600], expect.any(Function));
  expect(w.sesje).toBe(1);
  const c2 = { query: jest.fn((sql, params, cb) => cb(Object.assign(new Error('x'), { code: 'ER_X' }))) };
  p.emit('connection', c2); expect(w.bledySesji).toBe(1); expect(cichy.error).toHaveBeenCalled();
  const p2 = pulaAtrapa(0); podepnij(p2, { waitTimeout: 5, log: cichy }); expect(p2.listenerCount('connection')).toBe(0); // poza zakresem = wyłączone
});

test('wariant B: ping tylko wolnych, najwyżej maxPing naraz, bez tworzenia nowych gdy brak wolnych; stop() zatrzymuje', async () => {
  jest.useFakeTimers();
  try {
    const p = pulaAtrapa(5); const w = podepnij(p, { pingMs: 3000, maxPing: 3, log: cichy });
    await jest.advanceTimersByTimeAsync(3000);
    expect(p.getConnection).toHaveBeenCalledTimes(3); expect(p.zapytania).toEqual(['SELECT 1', 'SELECT 1', 'SELECT 1']); expect(w.pingi).toBe(3);
    p._freeConnections.length = 0;
    await jest.advanceTimersByTimeAsync(3000);
    expect(p.getConnection).toHaveBeenCalledTimes(3); // brak wolnych = nic (nie tworzy nowych połączeń)
    w.stop();
    p._freeConnections.length = 5;
    await jest.advanceTimersByTimeAsync(9000);
    expect(p.getConnection).toHaveBeenCalledTimes(3);
  } finally { jest.useRealTimers(); }
});

test('wariant B: po błędzie pingu 3 ticki przerwy', async () => {
  jest.useFakeTimers();
  try {
    const p = pulaAtrapa(2);
    p.getConnection = jest.fn((cb) => setImmediate(() => cb(Object.assign(new Error('brak'), { code: 'ER_USER_LIMIT_REACHED' }))));
    const w = podepnij(p, { pingMs: 3000, maxPing: 3, log: cichy });
    await jest.advanceTimersByTimeAsync(3000); expect(p.getConnection).toHaveBeenCalledTimes(2); expect(w.bledyPingow).toBe(2);
    await jest.advanceTimersByTimeAsync(9000); expect(p.getConnection).toHaveBeenCalledTimes(2); // 3 ticki przerwy
    await jest.advanceTimersByTimeAsync(3000); expect(p.getConnection).toHaveBeenCalledTimes(4);
    w.stop();
  } finally { jest.useRealTimers(); }
});
