// Centrum powiadomień — „Przejmij" zdjęte 21.10.2026.
//
// Założenie, z którym ten przycisk powstał (kilka osób patrzy w ten sam dzwonek i trzeba się
// umówić, kto dzwoni), nie zgadza się z rzeczywistością: „nie ma tak, że wiele osób siedzi przed
// systemem. Zajmuje się nim recepcja, nie ma po co przejmować" (właściciel). Przycisk kazał zrobić
// krok, który niczego nie odblokowywał — zamknięcie sprawy NIGDY nie wymagało bycia właścicielem.
//
// RODZAJ PRÓB: statyczna analiza modułu i przewodnika (public/terminarz.js nie jest modułem
// node'owym). Wygląd panelu potwierdzony w izolowanym środowisku: docs/terminarz-przejmij/.
const fs = require('fs');
const path = require('path');

const KORZEN = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(KORZEN, 'public', 'terminarz.js'), 'utf8');
const POMOC = fs.readFileSync(path.join(KORZEN, 'public', 'estelio_pomoc_terminarz.html'), 'utf8');
const SERWER = fs.readFileSync(path.join(KORZEN, 'routes', 'terminarz.js'), 'utf8');

describe('„Przejmij" nie ma już w interfejsie', () => {
  test('nie ma przycisku ani jego obsługi', () => {
    expect(JS).not.toMatch(/>Przejmij<\/button>/);
    expect(JS).not.toMatch(/TRM\.sprawaPrzejmij\s*=/);
    expect(JS).not.toMatch(/onclick="TRM\.sprawaPrzejmij/);
  });

  test('nie ma napisu „Nikt jeszcze nie przejął"', () => {
    expect(JS).not.toMatch(/Nikt jeszcze nie przejął<\/span>/);
  });

  test('„Prowadzi: …" zostaje — pokazuje się po przekazaniu sprawy', () => {
    expect(JS).toMatch(/Prowadzi: <b>/);
  });
});

describe('to, co naprawdę zamyka sprawę, zostaje', () => {
  test('Zapisz kontakt, Rozwiąż i Przekaż są dalej w panelu', () => {
    for (const akcja of ['kontakt', 'rozwiaz', 'przekaz']) {
      expect(JS).toContain(`TRM.sprawaFormaPokaz('${akcja}')`);
    }
  });

  test('serwer nadal nie wymaga właściciela do zamknięcia sprawy', () => {
    const rozwiaz = SERWER.slice(SERWER.indexOf("case 'trm_sprawa_rozwiaz'"), SERWER.indexOf("case 'trm_sprawa_wznow'"));
    expect(rozwiaz.length).toBeGreaterThan(100);
    expect(rozwiaz).not.toMatch(/wlasciciel !== imie/);
  });

  test('akcja trm_sprawa_przejmij zostaje po stronie serwera (używa jej „Przekaż")', () => {
    expect(SERWER).toContain("case 'trm_sprawa_przejmij'");
    expect(SERWER).toContain("case 'trm_sprawa_przekaz'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reguła pilności (21.10.2026). U właściciela 13 z 14 spraw miało plakietkę „Pilne teraz",
// wszystkie z powodem „bo wizyta już się odbyła" — czyli czerwony kolor przestał cokolwiek
// wyróżniać. „Pilne" ma znaczyć: trzeba zdążyć przed czymś, co się jeszcze nie wydarzyło.
describe('co robi sprawę pilną', () => {
  const tick = SERWER.slice(SERWER.indexOf('async function tickSprawy()'), SERWER.indexOf('// ZK-03 (Z3-07)'));

  test('eskalacja działa tylko na termin z PRZYSZŁOŚCI', () => {
    expect(tick).toMatch(/powiazany_czas >= NOW\(\) AND powiazany_czas <= DATE_ADD\(NOW\(\), INTERVAL 120 MINUTE\)/);
  });

  test('zaległość (E13/E19) upomina się po dobie ciszy, ale tylko przez tydzień', () => {
    const z = tick.slice(tick.indexOf("typ IN ('E13', 'E19')"));
    expect(z).toMatch(/stan = 'nowa'/);                                  // „bez reakcji" = nikt nie dotknął
    expect(z).toMatch(/utworzono <= DATE_SUB\(NOW\(\), INTERVAL \$\{ZALEGLOSC_H\} HOUR\)/);
    expect(z).toMatch(/utworzono >= DATE_SUB\(NOW\(\), INTERVAL \$\{ZALEGLOSC_DNI\} DAY\)/);
    // same wartości progów — doba i tydzień, nie „kiedyś"
    expect(SERWER).toMatch(/const ZALEGLOSC_H = 24;/);
    expect(SERWER).toMatch(/const ZALEGLOSC_DNI = 7;/);
  });

  test('sprawa, której moment minął ponad dobę temu, przestaje krzyczeć — ale zostaje w dzwonku', () => {
    const w = tick.slice(tick.indexOf('przeterminowane'));
    expect(w).toMatch(/priorytet = 'P0'/);                               // tylko te, które krzyczą
    expect(w).toMatch(/SET priorytet = 'P1'/);                           // schodzą do P1, nie znikają
    expect(w).not.toMatch(/stan = 'rozwiazana'/);                        // nic nie zamyka się samo
    // liczy się moment, którego sprawa dotyczy — nie data jej wpisania (na tym poległa 1. wersja)
    expect(w).toMatch(/powiazany_czas <= DATE_SUB\(NOW\(\), INTERVAL \$\{ZALEGLOSC_H\} HOUR\)/);
  });

  test('reguły (2) i (3) nie przerzucają tej samej sprawy w kółko', () => {
    const z = tick.slice(tick.indexOf("typ IN ('E13', 'E19')"));
    expect(z).toMatch(/eskalowano_o IS NULL/);                           // podniesienie tylko raz
    const w = tick.slice(tick.indexOf('przeterminowane'));
    expect(w).toMatch(/typ NOT IN \('E13', 'E19'\) OR utworzono <= DATE_SUB/); // okno doby–tygodnia zostaje nietknięte
  });

  test('każda zmiana priorytetu zostawia wpis w dzienniku sprawy', () => {
    const wpisy = tick.match(/INSERT INTO Term_Sprawy_Dziennik/g) || [];
    expect(wpisy.length).toBeGreaterThanOrEqual(3);
    expect(tick).toMatch(/doba bez reakcji/);
    expect(tick).toMatch(/wygaszenie/);
  });

  test('panel nie mówi już „pilne, bo wizyta już się odbyła"', () => {
    expect(JS).not.toMatch(/wizyta już się odbyła/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Masowe domykanie zaległości (21.10.2026). Zamykanie hurtem jest z natury ryzykowne,
// więc działa jak migracja adresów: najpierw PODGLĄD bez zapisu, dopiero potem `wykonaj: true`.
// Sprawy z nieobsłużonymi wizytami nie dają się zamknąć zbiorczo — tam zamknięcie znaczyłoby
// „udawajmy, że kolizji nie ma".
describe('domykanie zaległości hurtem', () => {
  const request = require('supertest'); const express = require('express');
  const M = require('../routes/terminarz');
  const T = 'salon-test-001';

  function atrapa(odpowiedzi) {
    const zap = [];
    const query = (sql, p, cb) => {
      const c = typeof p === 'function' ? p : cb; const params = typeof p === 'function' ? [] : p;
      zap.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params: params || [] });
      let w = [];
      for (const [re, v] of odpowiedzi) if (re.test(sql)) { w = v; break; }
      if (c) c(null, w);
    };
    return { query, getConnection: (cb) => cb(null, { query, beginTransaction: (x) => x(null), commit: (x) => x(null), rollback: (x) => x(null), release: () => {} }), zap };
  }
  const SPRAWA = (nad = {}) => ({ id: 11, typ: 'E05', tytul: 'Odwołano wizytę — Ala', dane_json: null, kiedy: '2026-09-26', ...nad });
  const baza = (kandydaci, rola = 'recepcja') => atrapa([
    [/SELECT rola FROM Użytkownicy/, [{ rola }]],
    [/priorytet = 'P1' AND stan IN/, kandydaci],
    [/UPDATE Term_Sprawy SET stan = 'rozwiazana'/, { affectedRows: 1 }],
  ]);
  const app = (db) => { const a = express(); a.use(express.json()); a.use('/api', M(db, { hasFeature: (t, k, cb) => cb(true) })); return a; };
  const domknij = (db, body, pracownik = 'Ola') => request(app(db)).post('/api/terminarz')
    .send({ tenant_id: T, pracownik, action: 'trm_sprawy_domknij', ...body });
  const zamkniecia = (db) => db.zap.filter(z => /UPDATE Term_Sprawy SET stan = 'rozwiazana'/.test(z.sql));

  test('bez `wykonaj` to sam podgląd — nic się nie zapisuje', async () => {
    const db = baza([SPRAWA(), SPRAWA({ id: 12, typ: 'E13' })]);
    const { body } = await domknij(db, { dni: 7 });
    expect(body.status).toBe('success');
    expect(body.podglad).toBe(true);
    expect(body.do_zamkniecia).toBe(2);
    expect(body.wg_typu).toEqual({ E05: 1, E13: 1 });
    expect(zamkniecia(db)).toHaveLength(0);
  });

  test('z `wykonaj` zamyka i zostawia ślad w dzienniku każdej sprawy', async () => {
    const db = baza([SPRAWA(), SPRAWA({ id: 12 })]);
    const { body } = await domknij(db, { dni: 7, wykonaj: true });
    expect(body.zamkniete).toBe(2);
    expect(zamkniecia(db)).toHaveLength(2);
    const wpisy = db.zap.filter(z => /INSERT INTO Term_Sprawy_Dziennik/.test(z.sql) && /'rozwiazano'/.test(z.sql) && /Domkniecie zbiorcze|Domknięcie zbiorcze/.test(JSON.stringify(z.params)));
    expect(wpisy).toHaveLength(2);
    expect(db.zap.some(z => /INSERT INTO Logi/i.test(z.sql) && /ZBIORCZE DOMKNIĘCIE/.test(JSON.stringify(z.params)))).toBe(true);
  });

  test('sprawa z nieobsłużonymi wizytami zostaje — i wiadomo dlaczego', async () => {
    const zDotknietymi = SPRAWA({ id: 13, typ: 'E02', dane_json: JSON.stringify({ dotkniete: [{ rezerwacja_id: 5, rozwiazana: false }, { rezerwacja_id: 6, rozwiazana: true }] }) });
    const db = baza([SPRAWA(), zDotknietymi]);
    const { body } = await domknij(db, { dni: 7, wykonaj: true });
    expect(body.zamkniete).toBe(1);
    expect(body.pominietych).toBe(1);
    expect(body.pominiete[0]).toMatchObject({ id: 13 });
    expect(body.pominiete[0].powod).toMatch(/rozstrzygnięcia/);
    expect(zamkniecia(db)).toHaveLength(1);
  });

  test('bierze tylko P1 ze starym terminem — pilne zostają nietknięte', async () => {
    const db = baza([SPRAWA()]);
    await domknij(db, { dni: 30 });
    const wybor = db.zap.find(z => /priorytet = 'P1' AND stan IN/.test(z.sql));
    expect(wybor.sql).toMatch(/COALESCE\(powiazany_czas, utworzono\) <= DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/);
    expect(wybor.params).toEqual(expect.arrayContaining([T, 30]));
  });

  test('liczba dni trzymana w ryzach (1–365)', async () => {
    for (const [podane, oczekiwane] of [[0, 7], [-5, 1], [9999, 365], [14, 14]]) {
      const db = baza([SPRAWA()]);
      const { body } = await domknij(db, { dni: podane });
      expect(body.dni).toBe(oczekiwane);
    }
  });

  test('specjalistka nie domyka cudzych spraw hurtem', async () => {
    const db = baza([SPRAWA()], 'kosmetolog');
    const { body } = await domknij(db, { dni: 7, wykonaj: true }, 'Anna');
    expect(body.status).toBe('error');
    expect(zamkniecia(db)).toHaveLength(0);
  });
});

describe('przewodnik nie uczy nieistniejącego przycisku', () => {
  test('w /pomoc-terminarz/ nie ma już „Przejmij"', () => {
    expect(POMOC).not.toMatch(/Przejmij/);
  });

  test('cykl życia sprawy opisany jest bez niego', () => {
    for (const krok of ['Zapisz kontakt', 'Rozwiąż', 'Przekaż']) expect(POMOC).toContain(krok);
  });
});
