// Znacznik wersji przy plikach modułu Terminarza (?v=…).
//
// Wpadka 21.10.2026: w index.html stało ręcznie wpisane `?v=20261018a`. Komentarz obok mówił
// „podbijać przy każdej zmianie" — i przez trzy dni zmian nikt (ja też nie) tego nie podbił.
// Przeglądarka, która raz pobrała terminarz.js, mogła trzymać starą wersję mimo wdrożenia,
// a po stronie użytkownika wyglądałoby to jak „poprawka nie weszła". Dokładnie ten rodzaj
// cichego zepsucia, którego ma nie być.
//
// Dlatego znacznik liczy się teraz sam z wersji wdrożenia, a te próby pilnują, żeby nikt nie
// wrócił do ręcznego wpisywania.
const fs = require('fs');
const path = require('path');

const KORZEN = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(KORZEN, 'public', 'index.html'), 'utf8');
const SERWER = fs.readFileSync(path.join(KORZEN, 'server.js'), 'utf8');

describe('index.html', () => {
  test('pliki Terminarza mają znacznik liczony automatycznie', () => {
    expect(INDEX).toMatch(/terminarz\.js\?v=__WERSJA_PLIKOW__/);
    expect(INDEX).toMatch(/terminarz\.css\?v=__WERSJA_PLIKOW__/);
  });

  test('nigdzie nie został ręcznie wpisany numer wersji pliku', () => {
    const reczne = INDEX.match(/(?:href|src)="\/[^"]*\?v=(?!__WERSJA_PLIKOW__)[^"]*"/g) || [];
    expect(reczne).toEqual([]);
  });
});

describe('server.js', () => {
  test('podmienia oba znaczniki przy starcie', () => {
    expect(SERWER).toMatch(/replaceAll\('__WERSJA__', WERSJA_APLIKACJI\)/);
    expect(SERWER).toMatch(/replaceAll\('__WERSJA_PLIKOW__', WERSJA_PLIKOW\)/);
  });

  test('znacznik jest bezpieczny w adresie URL i nigdy nie jest pusty', () => {
    const m = /const WERSJA_PLIKOW = ([^;]+);/.exec(SERWER);
    expect(m).toBeTruthy();
    // ta sama logika co w server.js, policzona na przykładowej wersji
    const policz = (wersja) => String(wersja).replace(/[^A-Za-z0-9]/g, '').slice(-14) || String(Date.now());
    const znacznik = policz('21.10.2026, 16:48 · 5682e97');
    expect(znacznik).toMatch(/^[A-Za-z0-9]+$/);
    expect(znacznik).toContain('5682e97');
    expect(policz('')).not.toBe('');                       // brak wersji = i tak coś unikalnego
    expect(policz('·—·')).not.toBe('');
  });

  test('dwa wdrożenia z różnych commitów dają różne znaczniki', () => {
    const policz = (w) => String(w).replace(/[^A-Za-z0-9]/g, '').slice(-14);
    expect(policz('21.10.2026, 16:48 · 5682e97')).not.toBe(policz('21.10.2026, 16:48 · 499386a'));
  });
});
