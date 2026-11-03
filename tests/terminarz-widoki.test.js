// Widok „Tydzień" (siatka tygodnia jednej osoby) zdjęty 21.10.2026 i PRZYWRÓCONY 3.11.2026 na prośbę
// właściciela („z taką samą siatką zabiegów jak w 'dziś' … tylko konkretnej osoby"). Te próby pilnują,
// żeby wrócił w całości: pozycja w przełączniku + kod renderujący + pobieranie zakresu + strzałki o tydzień.
//
// RODZAJ PRÓB: statyczna analiza modułu przeglądarkowego — public/terminarz.js nie jest modułem
// node'owym, więc nie da się go tu załadować; sprawdzamy jego treść. Działanie na żywo
// potwierdzone w izolowanym środowisku (docs/terminarz-widoki/).
const fs = require('fs');
const path = require('path');

const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'terminarz.js'), 'utf8');
const HTML_POMOC = fs.readFileSync(path.join(__dirname, '..', 'public', 'estelio_pomoc_terminarz.html'), 'utf8');

describe('przełącznik widoków', () => {
  const lista = /const widoki = (\[[^;]*\]);/.exec(JS);

  test('ma pięć widoków, w tym Tydzień między Dniem a Agendą', () => {
    expect(lista).toBeTruthy();
    expect(lista[1]).toMatch(/\['dzien', 'Dzień'\], \['tydzien', 'Tydzień'\], \['agenda', 'Agenda'\]/);
    for (const w of ['dzien', 'tydzien', 'agenda', 'zasoby', 'historia']) expect(lista[1]).toContain("'" + w + "'");
  });

  test('mapa podświetlanych przycisków zgadza się z listą widoków', () => {
    const mapa = /b\.textContent === \(\{([^}]*)\}\)\[w\]/.exec(JS);
    expect(mapa).toBeTruthy();
    expect(mapa[1]).toMatch(/tydzien: 'Tydzień'/);
    expect(mapa[1]).toMatch(/dzien:/);
  });
});

describe('widok Tydzień wrócił w całości, nie połowicznie', () => {
  test('jest funkcja renderTydzien i jest wołana z pobierania i z odświeżania', () => {
    expect(JS).toMatch(/function renderTydzien\(od\)/);
    expect((JS.match(/renderTydzien\(od\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  test('pobieranie zakresu: tydzień liczy się od poniedziałku i tylko dla jednej osoby', () => {
    expect(JS).toMatch(/const od = TRM\.widok === 'tydzien' \? poniedzialek\(TRM\.data\) : TRM\.data, do_ = dodajDni\(od, 6\)/);
    expect(JS).toMatch(/pracownik_filtr: TRM\.widok === 'tydzien' \? \(TRM\.osoba \|\| TRM\.dane\.pracownicy\[0\] \|\| null\)/);
  });

  test('siatka tygodnia: 7 kolumn dni, ta sama siatka co Dzień (kolumnaHtml), grafik z wyjątkami dnia (R05)', () => {
    const fn = JS.slice(JS.indexOf('function renderTydzien(od)'), JS.indexOf('// ── AGENDA (E03)'));
    expect(fn).toMatch(/repeat\(7, minmax\(150px,1fr\)\)/);
    expect(fn).toMatch(/kolumnaHtml\(rd, dost, \[\], zak/);
    expect(fn).toMatch(/grafikOsobyDnia\(osoba, dz\)/);
    expect(JS).toMatch(/function grafikOsobyDnia\(osoba, dz\) \{\s*const wyj = wyjatkiDnia\(osoba, dz\);/);
  });

  test('strzałki ‹ › skaczą o tydzień w Tygodniu i w Agendzie', () => {
    const idz = /TRM\.idz = \(n\) => \{[^}]*\}/.exec(JS);
    expect(idz).toBeTruthy();
    expect(idz[0]).toMatch(/\(TRM\.widok === 'tydzien' \|\| TRM\.widok === 'agenda'\) \? 7 \* n : n/);
  });

  test('nie ma już przekierowania starych wejść z tygodnia na dzień', () => {
    expect(JS).not.toMatch(/if \(w === 'tydzien'\) w = 'dzien'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Siatka dnia na telefonie (21.10.2026). Do tej pory telefon dostawał listę zamiast siatki —
// właściciel: „chcę widzieć kafelki, a nie zastępczy uproszczony interfejs". Siatka od początku
// umiała przewijać się w poziomie, więc wystarczyło przestać ją podmieniać.
describe('telefon dostaje tę samą siatkę co komputer', () => {
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'terminarz.css'), 'utf8');

  test('widok Dnia nie podmienia się na listę przy wąskim ekranie', () => {
    expect(JS).not.toMatch(/TRM\.widok === 'moj' \|\| waski\(\)/);
    expect(JS).toMatch(/if \(TRM\.widok === 'moj'\) \{ renderAgendaDnia\(\)/);
  });

  test('lista zostaje tam, gdzie ma sens — w „Moim dniu"', () => {
    expect(JS).toMatch(/function renderAgendaDnia\(\)/);
  });

  test('kolumna godzin przykleja się z lewej przy przewijaniu w bok', () => {
    // inline `position:relative` wygrywało z arkuszem i godziny odjeżdżały razem z kolumnami
    expect(JS).not.toMatch(/class="trm-hours"[^`]*position:relative/);
    expect(CSS).toMatch(/\.trm-hours \{[^}]*position:sticky/);
  });

  test('kafelek nie blokuje przesuwania siatki palcem', () => {
    expect(CSS).toMatch(/@media \(max-width: 760px\)[^@]*\.trm-karta \{[^}]*touch-action:pan-x pan-y/s);
  });

  test('po wejściu w widok Dnia telefon przewija do siatki — pod pasek aplikacji', () => {
    expect(JS).toMatch(/function przewinDoSiatki\(\)/);
    expect(JS).toMatch(/wysokoscBelki\(\)/);                       // bez tego siatka wjeżdża pod belkę
    expect(JS).toMatch(/behavior: 'auto'/);                        // kontener ma scroll-behavior:smooth
    expect(JS).toMatch(/if \(w === 'dzien' && waski\(\)\) TRM\._przewinDoSiatki = true;/);
  });

  test('dymek podglądu mieści się w ekranie telefonu', () => {
    expect(JS).toMatch(/Math\.min\(380, window\.innerWidth - 24\)/);
    expect(JS).toMatch(/Math\.max\(12, Math\.min\(left, window\.innerWidth - szer - 12\)\)/);
  });
});

describe('przewodnik: rozdział o Tygodniu celowo NIE wrócił (3.11.2026: „przywróć to, ale nic innego”)', () => {
  test('w /pomoc-terminarz/ nie ma rozdziału o widoku Tydzień', () => {
    expect(HTML_POMOC).not.toMatch(/Tydzień/);
    expect(HTML_POMOC).not.toMatch(/widok-tydzien/);
  });

  test('ale Agenda, Zasoby i Dzień są nadal opisane', () => {
    for (const w of ['Agenda', 'Zasoby', 'Dzień']) expect(HTML_POMOC).toContain(w);
  });
});
