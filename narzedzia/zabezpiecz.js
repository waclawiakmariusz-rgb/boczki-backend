// Wlacza zabezpieczenia na TYM komputerze: npm run zabezpiecz
//
// Uruchom RAZ na kazdej maszynie (HP, DELL, kazdy nowy laptop). Ustawienia gita
// siedza w katalogu .git, ktorego nie ma w repozytorium - dlatego nie przenosza sie
// same i trzeba je wlaczyc lokalnie.
//
// Komunikaty bez polskich ogonkow (konsola Windows nie jest domyslnie w UTF-8).

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function git(args, cicho) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (e) {
    if (cicho) return null;
    throw e;
  }
}

console.log('\n>> WLACZAM ZABEZPIECZENIA NA TYM KOMPUTERZE\n');

const korzen = git(['rev-parse', '--show-toplevel'], true);
if (!korzen) {
  console.log('BLAD: to nie jest katalog projektu (brak repozytorium git).');
  process.exit(1);
}

// --- 1. Bezpiecznik przy wysylce -------------------------------------------
git(['config', 'core.hooksPath', 'githooks']);
console.log('[OK] Bezpiecznik przy wysylce (git push) - wlaczony.');
console.log('     Zatrzyma zmiane, ktora masowo kasuje kod zamiast go dodawac.');

// Na Linuksie/Macu hook musi byc wykonywalny. Na Windows nie ma to znaczenia.
if (process.platform !== 'win32') {
  try { fs.chmodSync(path.join(korzen, 'githooks', 'pre-push'), 0o755); } catch (e) { /* nieistotne */ }
}

// --- 2. Zakaz cichego scalania ---------------------------------------------
git(['config', 'pull.ff', 'only']);
console.log('\n[OK] Zakaz cichego scalania historii - wlaczony.');
console.log('     Gdy zmiany rozjada sie miedzy laptopami, git sie ZATRZYMA');
console.log('     i zapyta, zamiast decydowac za Ciebie.');

// --- 3. Znacznik powrotu ----------------------------------------------------
const dobra = git(['rev-parse', '--short', 'ostatnia-dobra'], true);
if (dobra) {
  console.log(`\n[OK] Znacznik powrotu "ostatnia-dobra" istnieje: ${dobra}`);
} else {
  console.log('\n[!]  Brak znacznika "ostatnia-dobra". Utworz go, gdy produkcja dziala:');
  console.log('     git tag -f ostatnia-dobra origin/main && git push -f origin ostatnia-dobra');
}

// --- 4. Pliki, ktorych git nie przenosi -------------------------------------
console.log('\nPliki spoza gita (kazdy komputer musi miec swoje):');
const env = path.join(korzen, '.env');
if (fs.existsSync(env)) {
  console.log(`  [OK] .env  (${fs.statSync(env).size} B)`);
} else {
  console.log('  [!]  .env  - BRAK. Bez niego system nie wstanie (hasla do bazy, klucze Stripe).');
  console.log('       Skopiuj go z drugiego komputera recznie - patrz PRZENOSINY-NA-DELL.md');
}
const design = path.join(korzen, 'design');
console.log(fs.existsSync(design)
  ? '  [OK] design/  (makiety, zrzuty - celowo poza gitem, 26 MB)'
  : '  [ ]  design/  - brak (nie blokuje pracy systemu)');

// --- 5. Sprawdzenie, czy bezpiecznik faktycznie dziala ----------------------
const hooksPath = git(['config', '--get', 'core.hooksPath'], true);
const ok = hooksPath === 'githooks' && git(['config', '--get', 'pull.ff'], true) === 'only';

console.log('');
console.log(ok
  ? 'GOTOWE. Ten komputer jest zabezpieczony.\n\nCodziennie: npm run start-pracy  ->  praca  ->  npm run koniec-pracy\n'
  : 'UWAGA: cos sie nie ustawilo. Zawolaj Claude.\n');
