// Seria powitalna dla nowych salonów — co MUSI być prawdą, żeby pierwszy klient dostał maila.
//
// Powód powstania (20.10.2026): Ambasada Urody — pierwszy salon z reklamy — nie dostała maila „start",
// bo przebieg automatu wypadał raz na dobę, a salon wchodził w okno wysyłki pół doby po tym przebiegu.
// Przebieg jest teraz co godzinę, więc testy pilnują przede wszystkim tego, że CZĘSTSZE przebiegi
// nie oznaczają powtórzonych maili.
const modul = require('../routes/maile-wprowadzajace');

const SALON = { tenant_id: 'ambasada-urody-163160e1', email: 'k@example.pl', nazwa_salonu: 'Ambasada Urody', login: 'ambasada', data_utworzenia: '2026-10-18 20:31:15' };

// Atrapa bazy: kandydatów zwraca tylko dla wskazanych etapów (reszta = pusto, jak salon spoza okna),
// a INSERT IGNORE do historii wysyłek zachowuje się jak prawdziwy UNIQUE(tenant_id, etap).
function atrapaBazy({ kandydaci = {}, historia = new Set() } = {}) {
  const zap = [];
  return {
    zap, historia,
    query(sql, params, cb) {
      const c = typeof params === 'function' ? params : cb;
      const p = typeof params === 'function' ? [] : params;
      const s = String(sql);
      zap.push({ sql: s, params: p });
      if (/^CREATE TABLE/i.test(s)) return c && c(null, {});
      if (/FROM Licencje/i.test(s)) {
        const etap = p[p.length - 1];
        return c && c(null, (kandydaci[etap] || []).slice());
      }
      if (/INSERT IGNORE INTO Maile_wprowadzajace_wyslane/i.test(s)) {
        const klucz = p[0] + '|' + p[1];
        if (historia.has(klucz)) return c && c(null, { affectedRows: 0 });
        historia.add(klucz);
        return c && c(null, { affectedRows: 1 });
      }
      if (/^DELETE FROM Maile_wprowadzajace_wyslane/i.test(s)) { historia.delete(p[0] + '|' + p[1]); return c && c(null, { affectedRows: 1 }); }
      if (/^SELECT/i.test(s)) return c && c(null, []);
      return c && c(null, { affectedRows: 1 });
    },
  };
}

const cichyLog = { info() {}, error() {}, warn() {} };
const atrapaPoczty = () => {
  const wyslane = [];
  return { wyslane, async wyslijMailWprowadzajacy(x) { wyslane.push(x); return { messageId: '<id-' + wyslane.length + '>', odpowiedz: '250 Ok' }; } };
};
const dziennikWpisy = (db) => db.zap.filter(z => /INSERT INTO Maile_wprowadzajace_log/i.test(z.sql));

describe('maile wprowadzające — wysyłka serii', () => {
  const trybPrzed = process.env.MAILE_WPROWADZAJACE;
  afterEach(() => { if (trybPrzed === undefined) delete process.env.MAILE_WPROWADZAJACE; else process.env.MAILE_WPROWADZAJACE = trybPrzed; });

  test('tryb off: nic nie wychodzi, nawet gdy salon jest w oknie', async () => {
    process.env.MAILE_WPROWADZAJACE = 'off';
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ kandydaci: { start: [SALON] } });
    const wynik = await modul(db, { mailer: poczta, log: cichyLog }).tick();
    expect(wynik).toEqual({ tryb: 'off', wyslane: 0 });
    expect(poczta.wyslane).toHaveLength(0);
  });

  test('tryb proba: log zamiast maila — ani wysyłki, ani wpisu w historii', async () => {
    process.env.MAILE_WPROWADZAJACE = 'proba';
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ kandydaci: { start: [SALON] } });
    const wynik = await modul(db, { mailer: poczta, log: cichyLog }).tick();
    expect(wynik.wyslane).toBe(0);
    expect(poczta.wyslane).toHaveLength(0);
    expect(db.historia.size).toBe(0);
  });

  test('tryb on: salon w oknie dostaje swój mail, z zapisem w dzienniku', async () => {
    process.env.MAILE_WPROWADZAJACE = 'on';
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ kandydaci: { start: [SALON] } });
    const wynik = await modul(db, { mailer: poczta, log: cichyLog }).tick();
    expect(wynik).toEqual({ tryb: 'on', wyslane: 1 });
    expect(poczta.wyslane).toHaveLength(1);
    expect(poczta.wyslane[0].email).toBe(SALON.email);
    expect(poczta.wyslane[0].mail.etap).toBe('start');
    expect(dziennikWpisy(db)).toHaveLength(1);
    expect(dziennikWpisy(db)[0].params).toEqual(expect.arrayContaining([SALON.tenant_id, 'start', 'seria', 'wyslany']));
  });

  test('przebieg co godzinę nie powtarza maila — dwanaście przebiegów, jedna wiadomość', async () => {
    process.env.MAILE_WPROWADZAJACE = 'on';
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ kandydaci: { start: [SALON] } });
    const m = modul(db, { mailer: poczta, log: cichyLog });
    for (let i = 0; i < 12; i++) await m.tick();
    expect(poczta.wyslane).toHaveLength(1);
  });

  test('gdy poczta padnie, rezerwacja znika i następny przebieg próbuje jeszcze raz', async () => {
    process.env.MAILE_WPROWADZAJACE = 'on';
    let pierwsza = true;
    const wyslane = [];
    const poczta = { async wyslijMailWprowadzajacy(x) { if (pierwsza) { pierwsza = false; throw new Error('SMTP timeout'); } wyslane.push(x); return { messageId: '<ok>', odpowiedz: '250 Ok' }; } };
    const db = atrapaBazy({ kandydaci: { start: [SALON] } });
    const m = modul(db, { mailer: poczta, log: cichyLog });

    expect((await m.tick()).wyslane).toBe(0);
    expect(db.historia.size).toBe(0);                       // rezerwacja wycofana
    expect(dziennikWpisy(db)[0].params).toEqual(expect.arrayContaining(['blad']));

    expect((await m.tick()).wyslane).toBe(1);               // godzinę później udaje się
    expect(wyslane).toHaveLength(1);
  });

  test('salony demo są pomijane, choćby łapały się na okno', async () => {
    process.env.MAILE_WPROWADZAJACE = 'on';
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ kandydaci: { start: [{ ...SALON, tenant_id: 'demo-test' }, { ...SALON, tenant_id: 'demo-estelio' }] } });
    expect((await modul(db, { mailer: poczta, log: cichyLog }).tick()).wyslane).toBe(0);
    expect(poczta.wyslane).toHaveLength(0);
  });

  test('wiadomość wyłączona w panelu nie wychodzi, a pozostałe tak', async () => {
    process.env.MAILE_WPROWADZAJACE = 'on';
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ kandydaci: { start: [SALON], sprzedaz: [{ ...SALON, tenant_id: 'inny-salon' }] } });
    // tak wygląda wyłączenie zrobione w panelu: wiersz nadpisujący treść etapu
    const zwykle = db.query.bind(db);
    db.query = (sql, params, cb) => {
      if (/FROM Maile_wprowadzajace_tresc/i.test(String(sql))) {
        const c = typeof params === 'function' ? params : cb;
        return c(null, [{ etap: 'start', dane: JSON.stringify({ wylaczona: true }), zmieniono: null, kto: 'admin' }]);
      }
      return zwykle(sql, params, cb);
    };
    const wynik = await modul(db, { mailer: poczta, log: cichyLog }).tick();
    expect(wynik.wyslane).toBe(1);
    expect(poczta.wyslane.map(x => x.mail.etap)).toEqual(['sprzedaz']);
  });

  test('okno pierwszego maila zaczyna się dobę po założeniu salonu', () => {
    const start = modul.SERIA.find(m => m.etap === 'start');
    expect(start.okno[0]).toBe(1);
    expect(start.okno[1]).toBeGreaterThan(start.okno[0]);
  });

  test('zapytanie o kandydatów pomija salony sprzed uruchomienia serii i te z rezygnacją', async () => {
    process.env.MAILE_WPROWADZAJACE = 'on';
    const db = atrapaBazy({ kandydaci: {} });
    await modul(db, { mailer: atrapaPoczty(), log: cichyLog }).tick();
    const pytanie = db.zap.find(z => /FROM Licencje/i.test(z.sql));
    expect(pytanie.sql).toMatch(/Maile_wprowadzajace_stop/);
    expect(pytanie.sql).toMatch(/Maile_wprowadzajace_wyslane/);
    expect(pytanie.params[0]).toBe('2026-10-18');            // CUTOFF
  });
});
