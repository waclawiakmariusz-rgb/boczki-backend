// tests/przypomnienia.test.js — przypomnienia e-mail dla nowych klientów (routes/przypomnienia.js).
// Baza udawana po wzorcu SQL (bez kolejności wywołań), mailer zmockowany. Sprawdzamy:
// tryby off/proba/on, claim przed wysyłką (brak duplikatów), cofnięcie claimu po błędzie SMTP,
// okna czasowe i cutoff w parametrach SQL, brak jakichkolwiek zapisów poza własną tabelą.

function fakeDb({ link = [], salon = [], claimAffected = 1, claimErr = null } = {}) {
  const calls = [];
  const db = {
    query: jest.fn((sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (/CREATE TABLE IF NOT EXISTS Przypomnienia_wyslane/.test(s)) return cb(null, {});
      if (/FROM Zamowienia z/.test(s)) return cb(null, link);
      if (/FROM Licencje l/.test(s)) return cb(null, salon);
      if (/INSERT IGNORE INTO Przypomnienia_wyslane/.test(s)) return claimErr ? cb(claimErr) : cb(null, { affectedRows: claimAffected });
      if (/DELETE FROM Przypomnienia_wyslane/.test(s)) return cb(null, { affectedRows: 1 });
      return cb(new Error('nieoczekiwane SQL w teście: ' + s.slice(0, 60)));
    }),
  };
  return { db, calls };
}

function fakeMailer(overrides = {}) {
  return {
    wyslijPrzypomnienieLink: jest.fn().mockResolvedValue(),
    wyslijPrzypomnienieStart: jest.fn().mockResolvedValue(),
    ...overrides,
  };
}
const cichyLog = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };

const LINK = { zamowienie_id: 'z1', email: 'anna@salon.pl', imie: 'Anna', nazwa_salonu: 'Salon X', token: 'TOK-1', dni_do_wygasniecia: 27 };
const SALON = { id_bazy: 'salon-x-1234', email: 'anna@salon.pl', nazwa_salonu: 'Salon X', login: 'salon-x' };

afterEach(() => { delete process.env.PRZYPOMNIENIA; });

describe('tryby pracy', () => {
  test('off: nie dotyka bazy i nic nie wysyła', async () => {
    process.env.PRZYPOMNIENIA = 'off';
    const { db, calls } = fakeDb({ link: [LINK] });
    const m = fakeMailer();
    const w = await require('../routes/przypomnienia')(db, { mailer: m, log: cichyLog }).tick();
    expect(w.tryb).toBe('off');
    expect(calls).toHaveLength(0);
    expect(m.wyslijPrzypomnienieLink).not.toHaveBeenCalled();
  });

  test('proba (domyślnie, bez env): loguje kandydatów, nie wysyła i NIE zapisuje claimu', async () => {
    const { db, calls } = fakeDb({ link: [LINK], salon: [SALON] });
    const m = fakeMailer();
    const w = await require('../routes/przypomnienia')(db, { mailer: m, log: cichyLog }).tick();
    expect(w.tryb).toBe('proba');
    expect(w.kandydaci).toBe(3);               // link_3 + link_10 (ten sam SELECT) + salon_3
    expect(w.wyslano).toBe(0);
    expect(m.wyslijPrzypomnienieLink).not.toHaveBeenCalled();
    expect(m.wyslijPrzypomnienieStart).not.toHaveBeenCalled();
    expect(calls.filter(c => /INSERT|UPDATE|DELETE/i.test(c.sql))).toHaveLength(0);
  });

  test('on: claim przed wysyłką, potem mail; podsumowanie się zgadza', async () => {
    process.env.PRZYPOMNIENIA = 'on';
    const { db, calls } = fakeDb({ link: [LINK], salon: [SALON] });
    const m = fakeMailer();
    const w = await require('../routes/przypomnienia')(db, { mailer: m, log: cichyLog }).tick();
    expect(w.wyslano).toBe(3);
    expect(m.wyslijPrzypomnienieLink).toHaveBeenCalledTimes(2);
    expect(m.wyslijPrzypomnienieLink).toHaveBeenCalledWith(expect.objectContaining({ email: 'anna@salon.pl', token: 'TOK-1', etap: 1 }));
    expect(m.wyslijPrzypomnienieLink).toHaveBeenCalledWith(expect.objectContaining({ etap: 2, dniDoWygasniecia: 27 }));
    expect(m.wyslijPrzypomnienieStart).toHaveBeenCalledWith(expect.objectContaining({ email: 'anna@salon.pl', login: 'salon-x' }));
    const claimy = calls.filter(c => /INSERT IGNORE INTO Przypomnienia_wyslane/.test(c.sql));
    expect(claimy.map(c => c.params[0])).toEqual(['link_3', 'link_10', 'salon_3']);
    expect(claimy[0].params[1]).toBe('TOK-1');
    expect(claimy[2].params[1]).toBe('salon-x-1234');
    // claim jest PRZED wysyłką (kolejność wywołań)
    const idxClaim = calls.findIndex(c => /INSERT IGNORE/.test(c.sql));
    expect(idxClaim).toBeGreaterThan(-1);
    expect(m.wyslijPrzypomnienieLink.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });
});

describe('idempotencja i błędy', () => {
  test('claim przegrany (affectedRows 0 — już wysłane / druga instancja) → nic nie wysyła', async () => {
    process.env.PRZYPOMNIENIA = 'on';
    const { db } = fakeDb({ link: [LINK], claimAffected: 0 });
    const m = fakeMailer();
    const w = await require('../routes/przypomnienia')(db, { mailer: m, log: cichyLog }).tick();
    expect(w.wyslano).toBe(0);
    expect(w.pominieto).toBe(2);
    expect(m.wyslijPrzypomnienieLink).not.toHaveBeenCalled();
  });

  test('SMTP pada → claim cofnięty (DELETE), błąd policzony, tick nie rzuca', async () => {
    process.env.PRZYPOMNIENIA = 'on';
    const { db, calls } = fakeDb({ link: [LINK] });
    const m = fakeMailer({ wyslijPrzypomnienieLink: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    const w = await require('../routes/przypomnienia')(db, { mailer: m, log: cichyLog }).tick();
    expect(w.bledy).toBe(2);
    expect(w.wyslano).toBe(0);
    const usuniecia = calls.filter(c => /DELETE FROM Przypomnienia_wyslane/.test(c.sql));
    expect(usuniecia).toHaveLength(2);
    expect(usuniecia[0].params).toEqual(['link_3', 'TOK-1']);
  });

  test('błąd SELECT-a jednej reguły nie zatrzymuje pozostałych', async () => {
    process.env.PRZYPOMNIENIA = 'on';
    const { db } = fakeDb({ salon: [SALON] });
    db.query.mockImplementation((sql, params, cb) => {
      if (typeof params === 'function') { cb = params; }
      const s = String(sql);
      if (/FROM Zamowienia z/.test(s)) return cb(new Error('tabela zajęta'));
      if (/FROM Licencje l/.test(s)) return cb(null, [SALON]);
      if (/INSERT IGNORE/.test(s)) return cb(null, { affectedRows: 1 });
      return cb(null, {});
    });
    const m = fakeMailer();
    const w = await require('../routes/przypomnienia')(db, { mailer: m, log: cichyLog }).tick();
    expect(w.bledy).toBe(2);
    expect(w.wyslano).toBe(1);
    expect(m.wyslijPrzypomnienieStart).toHaveBeenCalledTimes(1);
  });

  test('kandydat bez e-maila jest pomijany bez claimu', async () => {
    process.env.PRZYPOMNIENIA = 'on';
    const { db, calls } = fakeDb({ link: [{ ...LINK, email: '' }] });
    const m = fakeMailer();
    const w = await require('../routes/przypomnienia')(db, { mailer: m, log: cichyLog }).tick();
    expect(w.kandydaci).toBe(0);
    expect(calls.filter(c => /INSERT IGNORE/.test(c.sql))).toHaveLength(0);
    expect(m.wyslijPrzypomnienieLink).not.toHaveBeenCalled();
  });
});

describe('okna czasowe, cutoff i izolacja', () => {
  test('SELECT-y dostają cutoff 2026-10-10 i domknięte okna dni; salon pomija demo i sprawdza brak sesji', async () => {
    const { db, calls } = fakeDb();
    const mod = require('../routes/przypomnienia')(db, { mailer: fakeMailer(), log: cichyLog });
    await mod.tick();
    const sel = calls.filter(c => /SELECT/.test(c.sql));
    expect(sel).toHaveLength(3);
    expect(sel[0].params).toEqual(['2026-10-10', 3, 9]);
    expect(sel[1].params).toEqual(['2026-10-10', 10, 20]);
    expect(sel[2].params.slice(0, 3)).toEqual(['2026-10-10', 3, 10]);
    expect(sel[2].params).toContain('demo-estelio');
    expect(sel[2].sql).toMatch(/NOT EXISTS \(SELECT 1 FROM Sesje/);
    expect(sel[0].sql).toMatch(/t\.status = 'nowy'/);
    expect(sel[0].sql).toMatch(/z\.status = 'wyslano_link'/);
  });

  test('moduł pisze WYŁĄCZNIE do Przypomnienia_wyslane (żadnych UPDATE/INSERT w innych tabelach)', async () => {
    process.env.PRZYPOMNIENIA = 'on';
    const { db, calls } = fakeDb({ link: [LINK], salon: [SALON] });
    const mod = require('../routes/przypomnienia')(db, { mailer: fakeMailer(), log: cichyLog });
    await mod.init();
    await mod.tick();
    const zapisy = calls.filter(c => /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)/i.test(c.sql));
    for (const z of zapisy) expect(z.sql).toMatch(/Przypomnienia_wyslane/);
  });

  test('start() w testach nie uruchamia harmonogramu', () => {
    const { db, calls } = fakeDb();
    const mod = require('../routes/przypomnienia')(db, { mailer: fakeMailer(), log: cichyLog });
    mod.start();
    expect(calls).toHaveLength(0);
  });
});
