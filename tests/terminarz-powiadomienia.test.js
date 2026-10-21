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

describe('przewodnik nie uczy nieistniejącego przycisku', () => {
  test('w /pomoc-terminarz/ nie ma już „Przejmij"', () => {
    expect(POMOC).not.toMatch(/Przejmij/);
  });

  test('cykl życia sprawy opisany jest bez niego', () => {
    for (const krok of ['Zapisz kontakt', 'Rozwiąż', 'Przekaż']) expect(POMOC).toContain(krok);
  });
});
