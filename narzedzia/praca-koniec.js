// "Koncze prace" - jedna komenda na wyjsciu: npm run koniec-pracy
//
// Pilnuje, zeby nic nie zostalo TYLKO na tym laptopie. Praca zostawiona na jednej
// maszynie to poczatek historii, ktora 3.08.2026 skonczyla sie cofnieciem trzech
// commitow Klubu na produkcji.
//
// Celowo NIE commituje za Ciebie - opis zmiany musi napisac czlowiek.
// Komunikaty bez polskich ogonkow (konsola Windows nie jest domyslnie w UTF-8).

const { execFileSync } = require('child_process');
const fs = require('fs');

const SZUM = ['.claude/settings.local.json'];

function git(args, cicho) {
  try {
    // stdio 'pipe' takze dla stderr - inaczej surowe "fatal: ..." od gita miesza sie
    // z naszymi komunikatami i wyglada jak awaria, choc to normalny przypadek.
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    if (cicho) return null;
    throw e;
  }
}

// Galaz wyslana przez "git push origin dev" (bez -u) nie ma zapisanego powiazania,
// choc na GitHubie istnieje. Samo @{upstream} dawaloby tu falszywy alarm.
function ustalZdalna(galaz) {
  const upstream = git(['rev-parse', '--abbrev-ref', `${galaz}@{upstream}`], true);
  if (upstream) return upstream;
  return git(['rev-parse', '--verify', '--quiet', `origin/${galaz}`], true) ? `origin/${galaz}` : null;
}

console.log('\n>> KONCZE PRACE\n');

if (git(['rev-parse', '--is-inside-work-tree'], true) !== 'true') {
  console.log('BLAD: to nie jest katalog projektu (brak repozytorium git).');
  process.exit(1);
}

const galaz = git(['rev-parse', '--abbrev-ref', 'HEAD']);
console.log(`Galaz: ${galaz}\n`);

let wszystkoBezpieczne = true;

// --- 1. Niezapisane zmiany --------------------------------------------------
const status = (git(['status', '--porcelain']) || '').split('\n').filter(Boolean);
const istotne = status.filter((l) => !SZUM.some((s) => l.includes(s)));

if (istotne.length) {
  wszystkoBezpieczne = false;
  console.log('!!! MASZ NIEZAPISANE ZMIANY - zostana TYLKO na tym komputerze:\n');
  istotne.slice(0, 20).forEach((l) => console.log('  ' + l));
  if (istotne.length > 20) console.log(`  ...i jeszcze ${istotne.length - 20}`);
  console.log('\nZapisz je tak:');
  console.log('  git add -A');
  console.log('  git commit -m "opis tego, co zrobiles"');
  console.log('  npm run koniec-pracy        (uruchom mnie ponownie)\n');
}

// --- 2. Zmiany zapisane, ale niewyslane -------------------------------------
const zdalna = ustalZdalna(galaz);

if (!zdalna) {
  wszystkoBezpieczne = false;
  console.log(`Galaz ${galaz} nie istnieje jeszcze na GitHubie. Wyslij ja:`);
  console.log(`  git push -u origin ${galaz}\n`);
} else {
  const doWyslania = git(['rev-list', '--count', `${zdalna}..${galaz}`], true) || '0';

  if (Number(doWyslania) > 0) {
    console.log(`Masz ${doWyslania} zapisanych zmian(y) do wyslania:\n`);
    console.log(git(['log', '--format=  %h  %s', `${zdalna}..${galaz}`]));

    if (galaz === 'main') {
      wszystkoBezpieczne = false;
      console.log('\n!!! To galaz main - wysylka oznacza WDROZENIE NA PRODUKCJE.');
      console.log('Nie robie tego automatycznie. Jesli na pewno chcesz:');
      console.log('  git push origin main\n');
    } else {
      process.stdout.write('\nWysylam na GitHub... ');
      try {
        execFileSync('git', ['push', 'origin', galaz, '--quiet'], { stdio: 'pipe' });
        console.log('GOTOWE');
      } catch (e) {
        wszystkoBezpieczne = false;
        console.log('NIE UDALO SIE');
        console.log('Najpierw sciagnij zmiany z drugiego komputera: npm run start-pracy\n');
      }
    }
  } else if (!istotne.length) {
    console.log('Wszystko, co zrobiles, jest juz na GitHubie.');
  }
}

// --- 3. Czego git NIE przenosi ----------------------------------------------
// Przypominamy TYLKO gdy plik faktycznie byl dzis ruszany - inaczej ten komunikat
// pokazywalby sie zawsze i po tygodniu przestalbys go czytac.
const DOBA = 24 * 60 * 60 * 1000;
const zmienioneReczne = [];
for (const plik of ['.env']) {
  try {
    if (Date.now() - fs.statSync(plik).mtimeMs < DOBA) zmienioneReczne.push(plik);
  } catch (e) { /* nie ma pliku - nie nasza sprawa */ }
}

if (zmienioneReczne.length) {
  console.log('\nUWAGA: te pliki zmieniales dzisiaj, a git ich NIE przenosi:');
  zmienioneReczne.forEach((p) => console.log('  ' + p));
  console.log('Drugi komputer ich nie dostanie - przenies recznie.');
  console.log('Szczegoly: PRZENOSINY-NA-DELL.md, czesc A punkt 3.');
}

// --- 4. Podsumowanie --------------------------------------------------------
console.log('');
if (wszystkoBezpieczne) {
  console.log('OK - mozesz zamknac laptopa. Na drugim komputerze zacznij od:');
  console.log('  npm run start-pracy\n');
} else {
  console.log('UWAGA - cos zostalo tylko tutaj (patrz wyzej). Dokoncz, zanim');
  console.log('przesiadziesz sie na drugi komputer.\n');
  process.exit(1);
}
