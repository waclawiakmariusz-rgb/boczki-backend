// „W historii skasuj »559,00 zł — wartość wykonanych«; takich informacji nie pokazuj przy kliencie
// i przy pracowniku w Historia" (właściciel, 21.10.2026).
//
// Historia ma odpowiadać na pytanie CO się działo — kto przyszedł, co zrobiliśmy, co przepadło.
// Podsumowanie wartości zamieniało ją w raport przychodu o konkretnej klientce (albo o pracowniku,
// co czyta się jak ocena wyników). Od pieniędzy jest Sprzedaż i profil klientki.
//
// RODZAJ PRÓB: statyczna analiza modułu przeglądarkowego (public/terminarz.js nie jest modułem
// node'owym). Wygląd potwierdzony w izolowanym środowisku: docs/terminarz-historia-bez-kwot/.
const fs = require('fs');
const path = require('path');

const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'terminarz.js'), 'utf8');
const wytnij = (nazwa) => {
  const od = JS.indexOf(`function ${nazwa}(`);
  expect(od).toBeGreaterThan(-1);
  return JS.slice(od, JS.indexOf('\n  }', od));
};

describe('podsumowanie historii', () => {
  test('historia klientki nie podsumowuje wartości wizyt', () => {
    expect(wytnij('histKlientkaHtml')).not.toContain("histKafel('wartość wykonanych'");
  });

  test('historia pracownika też nie', () => {
    expect(wytnij('histPracownikHtml')).not.toContain("histKafel('wartość wykonanych'");
  });

  test('nigdzie w module nie został taki kafelek', () => {
    expect(JS).not.toMatch(/histKafel\('wartość wykonanych'/);
  });
});

describe('reszta podsumowania zostaje', () => {
  test('klientka: wizyty, wykonane, odwołane, nieobecności, skasowane', () => {
    const f = wytnij('histKlientkaHtml');
    for (const e of ['wizyt', 'wykonanych', 'odwołanych', 'nieobecności', 'skasowanych (pomyłki)']) {
      expect(f).toContain(`histKafel('${e}'`);
    }
  });

  test('pracownik: zabiegi, klientki, czas przy pracy, odwołane, nieobecności', () => {
    const f = wytnij('histPracownikHtml');
    for (const e of ['wykonanych zabiegów', 'klientek', 'czas przy pracy', 'odwołanych', 'nieobecności']) {
      expect(f).toContain(`histKafel('${e}'`);
    }
  });
});
