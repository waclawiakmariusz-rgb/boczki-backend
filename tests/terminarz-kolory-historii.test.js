// Kolory stanów w historii klientki (zgłoszenie właściciela 21.10.2026: „te kolory są takie same,
// zrób jakieś zupełnie odmienne typu niebieski, zielony, czerwony").
//
// Poprzednia wersja miała kwadrat legendy 12×12 w kolorze tła z 3-pikselowym paskiem z boku —
// formalnie pięć różnych reguł, w praktyce pięć białych kwadracików. Dlatego próba nie sprawdza
// „czy jest reguła", tylko czy kolory NAPRAWDĘ dzieli od siebie odcień i czy niosą je wypełnienia.
//
// RODZAJ PRÓB: statyczna analiza arkusza — bez przeglądarki. Wygląd na żywo sprawdzony
// w izolowanym środowisku (docs/terminarz-kolory-historii/).
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'terminarz.css'), 'utf8');
const STANY = ['wyk', 'plan', 'odw', 'nieob', 'skas'];

/** Wartość zmiennej --h-… z podanego bloku (jasny albo ciemny). */
function zmienna(nazwa, ciemny) {
  const blok = ciemny
    ? /body\.dark-mode \.trm \{([^}]*--h-wyk[^}]*)\}/.exec(CSS)
    : /\n\.trm \{([^}]*--h-wyk[^}]*)\}/.exec(CSS);
  expect(blok).toBeTruthy();
  const m = new RegExp('--h-' + nazwa + ':\\s*(#[0-9a-fA-F]{6})').exec(blok[1]);
  expect(m).toBeTruthy();
  return m[1].toLowerCase();
}

/** Odcień (0–360) i nasycenie (0–1) — do sprawdzenia, czy kolory to naprawdę różne barwy. */
function hsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  return { h, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
}
const odlegloscOdcieni = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

describe.each([['jasny', false], ['ciemny', true]])('paleta historii — tryb %s', (_nazwa, ciemny) => {
  test('pięć stanów ma pięć różnych kolorów', () => {
    const kolory = STANY.map(s => zmienna(s, ciemny));
    expect(new Set(kolory).size).toBe(5);
  });

  test('cztery barwne stany dzieli odcień, a nie sam odcień szarości', () => {
    const barwne = ['wyk', 'plan', 'odw', 'nieob'].map(s => ({ s, ...hsl(zmienna(s, ciemny)) }));
    for (const k of barwne) expect(k.s).toBeGreaterThan(0.3);          // to ma być kolor, nie szarość
    for (let i = 0; i < barwne.length; i++) {
      for (let j = i + 1; j < barwne.length; j++) {
        const d = odlegloscOdcieni(barwne[i].h, barwne[j].h);
        // komunikat przy porażce ma od razu mówić, która para się zlewa
        expect(`${barwne[i].s}/${barwne[j].s}: ${Math.round(d)}°`).toBe(
          d >= 30 ? `${barwne[i].s}/${barwne[j].s}: ${Math.round(d)}°` : 'co najmniej 30° różnicy odcienia');
      }
    }
  });

  test('stan skasowany jest wyraźnie szary — kolor zostaje dla stanów z życia salonu', () => {
    expect(hsl(zmienna('skas', ciemny)).s).toBeLessThan(0.25);
  });
});

describe('legenda nad listą', () => {
  // Blok dopisany 21.10.2026 — to on ma rozstrzygać o wyglądzie kwadracików.
  const blok = CSS.slice(CSS.indexOf('--h-wyk'));

  test('kwadracik jest wypełniony kolorem stanu, nie tłem karty', () => {
    for (const [klasa, zm] of [['wykonana', 'wyk'], ['planowana', 'plan'], ['odwolana', 'odw'], ['nieobecna', 'nieob']]) {
      // \n na początku: reguła trybu jasnego, a nie ta spod `body.dark-mode` (ta sama nazwa klasy)
      const re = new RegExp('\\n\\.trm-hist-legenda \\.pr\\.' + klasa + '\\s*\\{[^}]*background:\\s*var\\(--h-' + zm + '\\)');
      expect(blok).toMatch(re);
    }
    expect(blok).toMatch(/\.trm-hist-legenda \.pr\.skasowana\s*\{[^}]*repeating-linear-gradient/);
  });

  test('kwadracik nie jest mikroskopijny', () => {
    const m = /\.trm-hist-legenda \.pr \{[^}]*width:\s*(\d+)px/.exec(blok);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(14);
  });

  test('kolor nie jest jedynym nośnikiem: pomyłka ma też kreskowanie', () => {
    expect(blok).toMatch(/\.trm-hist-wizyta\.skasowana \.trm-pill/);   // plakietka słowna
    expect(CSS).toMatch(/\.trm-hist-wizyta\.skasowana \{[^}]*repeating-linear-gradient/);
  });
});

describe('wiersz wizyty', () => {
  const blok = CSS.slice(CSS.indexOf('--h-wyk'));

  test('pasek z lewej ma kolor stanu i jest widoczny (5 px)', () => {
    for (const [klasa, zm] of [['wykonana', 'wyk'], ['planowana', 'plan'], ['odwolana', 'odw'], ['nieobecna', 'nieob'], ['skasowana', 'skas']]) {
      const re = new RegExp('\\n\\.trm-hist-wizyta\\.' + klasa + '\\s*\\{[^}]*border-left:\\s*5px solid var\\(--h-' + zm + '\\)');
      expect(blok).toMatch(re);
    }
  });

  test('border-color nie kasuje koloru paska (wpadka z pierwszego podejścia)', () => {
    // W skrócie `border-color` zapisanym PO `border-left` ginie kolor lewej krawędzi.
    for (const klasa of ['planowana', 'odwolana', 'nieobecna']) {
      const m = new RegExp('\\.trm-hist-wizyta\\.' + klasa + '\\s*\\{([^}]*)\\}').exec(blok);
      expect(m).toBeTruthy();
      const tresc = m[1];
      const poz = { bc: tresc.indexOf('border-color'), bl: tresc.indexOf('border-left:') };
      if (poz.bc >= 0) expect(poz.bc).toBeLessThan(poz.bl);
    }
  });
});
