// tests/db-pula-opcje.test.js — najmniejsza zmiana puli: domyślnie nic; SET SESSION wait_timeout na nowym połączeniu;
// sprawdzKonfiguracje wykrywa martwy idleTimeout (maxIdle == connectionLimit) i niespójne czasy; opisKonfiguracji = jednoznaczny
// wpis startowy (AKTYWNA / WYŁĄCZONA) z PID i czasem — podstawa weryfikacji wyłączenia.
const EventEmitter = require('events');
const { podepnij, sprawdzKonfiguracje, opisKonfiguracji } = require('../db-pula-opcje');

const cichy = { log: jest.fn(), error: jest.fn() };

test('bez opcji: nic nie podpięte (zachowanie jak produkcja)', () => {
  const p = new EventEmitter();
  podepnij(p, { log: cichy });
  expect(p.listenerCount('connection')).toBe(0);
});

test('SET SESSION wait_timeout na każdym nowym połączeniu; zakres 20–3600; błąd liczony, nie wywraca', () => {
  const p = new EventEmitter(); const w = podepnij(p, { waitTimeout: 300, log: cichy });
  const c = { query: jest.fn((sql, params, cb) => cb(null)) };
  p.emit('connection', c);
  expect(c.query).toHaveBeenCalledWith('SET SESSION wait_timeout = ?', [300], expect.any(Function));
  expect(w.sesje).toBe(1);
  const c2 = { query: jest.fn((sql, params, cb) => cb(Object.assign(new Error('x'), { code: 'ER_X' }))) };
  p.emit('connection', c2); expect(w.bledySesji).toBe(1); expect(cichy.error).toHaveBeenCalled();
  const p2 = new EventEmitter(); podepnij(p2, { waitTimeout: 5, log: cichy }); expect(p2.listenerCount('connection')).toBe(0);
  const p3 = new EventEmitter(); podepnij(p3, { waitTimeout: 3601, log: cichy }); expect(p3.listenerCount('connection')).toBe(0);
});

test('sprawdzKonfiguracje: idleTimeout przy maxIdle == connectionLimit = ostrzeżenie (pułapka mysql2 3.21.0)', () => {
  expect(sprawdzKonfiguracje({ connectionLimit: 10, idleTimeout: 240000, waitTimeout: 300 })).toEqual([expect.stringContaining('BEZ SKUTKU')]);
  expect(sprawdzKonfiguracje({ connectionLimit: 10, maxIdle: 10, idleTimeout: 240000, waitTimeout: 300 })).toEqual([expect.stringContaining('DB_PULA_MAX_IDLE=9')]);
  expect(sprawdzKonfiguracje({ connectionLimit: 10, maxIdle: 9, idleTimeout: 240000, waitTimeout: 300 })).toEqual([]);
});

test('sprawdzKonfiguracje: czasy niespójne i brak idleTimeout = ostrzeżenia; bez opcji = brak ostrzeżeń', () => {
  expect(sprawdzKonfiguracje({ connectionLimit: 10, maxIdle: 9, idleTimeout: 300000, waitTimeout: 300 })).toEqual([expect.stringContaining('nie jest krótsze')]);
  expect(sprawdzKonfiguracje({ connectionLimit: 10, waitTimeout: 300 })).toEqual([expect.stringContaining('bez DB_PULA_IDLE_MS')]);
  expect(sprawdzKonfiguracje({ connectionLimit: 10, waitTimeout: 10 })).toContainEqual(expect.stringContaining('poza zakresem'));
  expect(sprawdzKonfiguracje({ connectionLimit: 10 })).toEqual([]);
  expect(sprawdzKonfiguracje()).toEqual([]);
});

test('opisKonfiguracji: bez zmiennych = WYŁĄCZONA; wartości wdrożeniowe = AKTYWNA; częściowe/błędne = AKTYWNA tylko to, co działa', () => {
  const info = { pid: 4321, teraz: Date.UTC(2026, 10, 5, 20, 0, 0) };
  const wyl = opisKonfiguracji({ connectionLimit: 10 }, info);
  expect(wyl).toBe('[db-pula] START pid=4321 uruchomienie=2026-11-05T20:00:00.000Z · poprawka puli: WYŁĄCZONA (zachowanie jak produkcja 8f667f4) · sesja wait_timeout: NIEAKTYWNA (serwer: globalne wait_timeout) · connectionLimit 10 · maxIdle 10 · idleTimeout domyślne mysql2 (NIEAKTYWNY: maxIdle == connectionLimit)');
  const akt = opisKonfiguracji({ connectionLimit: 10, maxIdle: 9, idleTimeout: 240000, waitTimeout: 300 }, info);
  expect(akt).toBe('[db-pula] START pid=4321 uruchomienie=2026-11-05T20:00:00.000Z · poprawka puli: AKTYWNA · sesja wait_timeout: 300 s (SET SESSION na każdym nowym połączeniu) · connectionLimit 10 · maxIdle 9 · idleTimeout 240000 ms (AKTYWNY: klient zamyka bezczynne)');
  // idleTimeout ustawiony bez maxIdle: sesja aktywna, sprzątacz nie
  expect(opisKonfiguracji({ connectionLimit: 10, idleTimeout: 240000, waitTimeout: 300 }, info)).toMatch(/AKTYWNA · sesja wait_timeout: 300 s .* idleTimeout 240000 ms \(NIEAKTYWNY: maxIdle == connectionLimit\)/);
  // wait_timeout poza zakresem, nic więcej: WYŁĄCZONA
  expect(opisKonfiguracji({ connectionLimit: 10, waitTimeout: 5 }, info)).toMatch(/poprawka puli: WYŁĄCZONA .* sesja wait_timeout: 5 poza zakresem → NIEAKTYWNA/);
  // bez info: prawdziwy pid i aktualny czas
  expect(opisKonfiguracji({})).toMatch(new RegExp(`^\\[db-pula\\] START pid=${process.pid} uruchomienie=\\d{4}-`));
});
