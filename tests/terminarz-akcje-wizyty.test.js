// „Więcej działań" w szczegółach wizyty (zgłoszenie właściciela 21.10.2026 ze zrzutem ekranu:
// „te chipsy z opcjami źle się prezentują").
//
// Przyciski stały w `.trm-row` — jednym rzędzie bez zawijania. Przy pięciu akcjach napisy ucinały
// się w połowie słowa („Przełóż całą w", „Nieobecna (po"). To nie jest drobiazg kosmetyczny:
// obcięty napis przy przycisku, który ODWOŁUJE albo KASUJE wizytę, to proszenie się o pomyłkę.
//
// RODZAJ PRÓB: statyczna analiza modułu i arkusza. Pomiar na żywo (szerokość treści kontra
// szerokość przycisku, szeroki ekran i iPhone): docs/terminarz-akcje/.
const fs = require('fs');
const path = require('path');

const KORZEN = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(KORZEN, 'public', 'terminarz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(KORZEN, 'public', 'terminarz.css'), 'utf8');

describe('rząd działań przy wizycie', () => {
  test('ma własny kontener, nie ogólny trm-row', () => {
    const blok = JS.slice(JS.indexOf('<summary>Więcej działań</summary>'), JS.indexOf('<summary>Więcej działań</summary>') + 2000);
    expect(blok).toMatch(/<div class="trm-akcje">/);
    expect(blok).not.toMatch(/<div class="trm-row">\s*\$\{r\.wykonanie === 'zaplanowana'/);
  });

  test('rząd się zawija, a przyciski nie zwężają poniżej swojej treści', () => {
    const regula = /\.trm-akcje \{([^}]*)\}/.exec(CSS);
    expect(regula).toBeTruthy();
    expect(regula[1]).toMatch(/flex-wrap:\s*wrap/);
    const przyciski = /\.trm-akcje > \.trm-btn \{([^}]*)\}/.exec(CSS);
    expect(przyciski).toBeTruthy();
    expect(przyciski[1]).toMatch(/flex:\s*0 0 auto/);        // bez tego tekst się ucina
    expect(przyciski[1]).toMatch(/white-space:\s*nowrap/);
  });

  test('na wąskim ekranie każda akcja dostaje własny rząd', () => {
    expect(CSS).toMatch(/@media \(max-width: 560px\) \{\s*\.trm-akcje \{[^}]*flex-direction:\s*column/);
  });

  test('wszystkie pięć działań nadal jest w panelu', () => {
    for (const akcja of ['Przełóż całą wizytę', 'Spóźniona', 'Nieobecna (potwierdzona)', 'Odwołaj wizytę', 'Skasuj wizytę']) {
      expect(JS).toContain(`>${akcja}</button>`);
    }
  });

  test('zniknął akapit tłumaczący różnicę odwołanie/skasowanie', () => {
    // Wyjaśnienie zostaje tam, gdzie zapada decyzja — w formularzu kasowania.
    expect(JS).not.toMatch(/Nieobecność potwierdza człowiek/);
    expect(JS).toMatch(/Jeśli klientka naprawdę odwołała wizytę/);
  });
});
