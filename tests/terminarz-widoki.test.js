// Widok „Tydzień" zdjęty 21.10.2026 (decyzja właściciela: „nie rozumiem jego zastosowania,
// zostaw tylko dzienny"). Te próby pilnują, żeby nie wrócił połowicznie: pozycja w przełączniku
// bez kodu renderującego (albo odwrotnie) dałaby pusty ekran zamiast kalendarza.
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

  test('ma cztery widoki i nie ma wśród nich tygodnia', () => {
    expect(lista).toBeTruthy();
    expect(lista[1]).not.toMatch(/tydzien/);
    expect(lista[1]).not.toMatch(/Tydzień/);
    for (const w of ['dzien', 'agenda', 'zasoby', 'historia']) expect(lista[1]).toContain(`'${w}'`);
  });

  test('mapa podświetlanych przycisków zgadza się z listą widoków', () => {
    const mapa = /b\.textContent === \(\{([^}]*)\}\)\[w\]/.exec(JS);
    expect(mapa).toBeTruthy();
    expect(mapa[1]).not.toMatch(/tydzien/);
    expect(mapa[1]).toMatch(/dzien:/);
  });
});

describe('po zdjętym widoku nie został martwy kod', () => {
  test('nie ma funkcji renderTydzien', () => {
    expect(JS).not.toMatch(/function renderTydzien/);
    expect(JS).not.toMatch(/renderTydzien\(/);
  });

  test('pobieranie danych i odświeżanie nie rozgałęziają się już na tydzień', () => {
    expect(JS).not.toMatch(/widok === 'tydzien'/);
  });

  test('strzałki ‹ › skaczą o tydzień tylko w Agendzie', () => {
    const idz = /TRM\.idz = \(n\) => \{[^}]*\}/.exec(JS);
    expect(idz).toBeTruthy();
    expect(idz[0]).toMatch(/widok === 'agenda' \? 7 \* n : n/);
  });
});

describe('stare wejścia nie zostawiają pustego ekranu', () => {
  test('widokZmien("tydzien") przestawia na widok dnia', () => {
    const fn = JS.slice(JS.indexOf('TRM.widokZmien = (w) =>'));
    expect(fn.slice(0, 400)).toMatch(/if \(w === 'tydzien'\) w = 'dzien'/);
  });
});

describe('przewodnik nie opisuje nieistniejącego widoku', () => {
  test('w /pomoc-terminarz/ nie ma już rozdziału o widoku Tydzień', () => {
    expect(HTML_POMOC).not.toMatch(/Tydzień/);
    expect(HTML_POMOC).not.toMatch(/widok-tydzien/);
  });

  test('ale Agenda, Zasoby i Dzień są nadal opisane', () => {
    for (const w of ['Agenda', 'Zasoby', 'Dzień']) expect(HTML_POMOC).toContain(w);
  });
});
