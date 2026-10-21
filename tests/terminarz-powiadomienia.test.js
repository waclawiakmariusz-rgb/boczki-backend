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

describe('przewodnik nie uczy nieistniejącego przycisku', () => {
  test('w /pomoc-terminarz/ nie ma już „Przejmij"', () => {
    expect(POMOC).not.toMatch(/Przejmij/);
  });

  test('cykl życia sprawy opisany jest bez niego', () => {
    for (const krok of ['Zapisz kontakt', 'Rozwiąż', 'Przekaż']) expect(POMOC).toContain(krok);
  });
});
