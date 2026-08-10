// "Zaczynam prace" - jedna komenda na wejsciu: npm run start-pracy
//
// Sciaga najnowsza wersje z GitHuba i mowi po ludzku, na czym stoisz. Istnieje po to,
// zebys NIGDY nie musial kopiowac plikow miedzy laptopami - od tego jest git.
// Komunikaty bez polskich ogonkow (konsola Windows nie jest domyslnie w UTF-8).

const { execFileSync } = require('child_process');
const { znajdzPodejrzane, opiszAlerty } = require('./analiza-commitow');

// Pliki, ktore zmieniaja sie same (ustawienia narzedzi) - nie strasz nimi uzytkownika.
const SZUM = ['.claude/settings.local.json'];

function git(args, cicho) {
  try {
    // stdio 'pipe' takze dla stderr - inaczej git wypisuje surowe "fatal: ..."
    // obok naszych komunikatow i wyglada to jak awaria, choc to normalny przypadek.
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

// Odpowiednik galezi na GitHubie. Samo @{upstream} nie wystarcza: galaz wyslana
// przez "git push origin dev" (bez -u) dziala normalnie, ale nie ma zapisanego
// powiazania - a wtedy falszywie raportowalismy "nie ma jej na GitHubie".
function ustalZdalna(galaz) {
  const upstream = git(['rev-parse', '--abbrev-ref', `${galaz}@{upstream}`], true);
  if (upstream) return upstream;
  return git(['rev-parse', '--verify', '--quiet', `origin/${galaz}`], true) ? `origin/${galaz}` : null;
}

function naglowek(t) { console.log('\n' + t + '\n' + '='.repeat(t.length)); }

console.log('\n>> ZACZYNAM PRACE\n');

// --- 1. Czy w ogole jestesmy w repozytorium ---------------------------------
if (git(['rev-parse', '--is-inside-work-tree'], true) !== 'true') {
  console.log('BLAD: to nie jest katalog projektu (brak repozytorium git).');
  process.exit(1);
}

const galaz = git(['rev-parse', '--abbrev-ref', 'HEAD']);
console.log(`Galaz: ${galaz}`);

// --- 2. Sciagniecie stanu z GitHuba ----------------------------------------
process.stdout.write('Sprawdzam GitHub... ');
try {
  execFileSync('git', ['fetch', 'origin', '--tags', '--prune', '--quiet'], { stdio: 'pipe' });
  console.log('OK');
} catch (e) {
  console.log('NIE UDALO SIE (brak internetu?)');
  console.log('Pracuj ostroznie - nie wiesz, co zrobiles na drugim komputerze.');
}

// --- 3. Niezapisane zmiany na TYM komputerze -------------------------------
const status = (git(['status', '--porcelain']) || '').split('\n').filter(Boolean);
const istotne = status.filter((l) => !SZUM.some((s) => l.includes(s)));

if (istotne.length) {
  naglowek('MASZ TU NIEZAPISANE ZMIANY');
  istotne.slice(0, 15).forEach((l) => console.log('  ' + l));
  if (istotne.length > 15) console.log(`  ...i jeszcze ${istotne.length - 15}`);
  console.log('\nTo zmiany zrobione na TYM komputerze i nigdzie nie wyslane.');
  console.log('Dokoncz je i zapisz (git add + commit), zanim zaczniesz cos nowego.');
}

// --- 4. Czy drugi komputer cos wyslal --------------------------------------
const zdalna = ustalZdalna(galaz);
let zaIloma = 0;

if (!zdalna) {
  console.log(`\nUwaga: galaz ${galaz} nie ma odpowiednika na GitHubie.`);
} else {
  const [przed, za] = (git(['rev-list', '--left-right', '--count', `${galaz}...${zdalna}`]) || '0\t0').split('\t').map(Number);
  zaIloma = za;

  if (za > 0) {
    naglowek(`NA GITHUBIE JEST ${za} NOWYCH ZMIAN (drugi komputer)`);
    console.log(git(['log', '--format=  %h  %s  (%an, %ad)', '--date=format:%Y-%m-%d %H:%M', `${galaz}..${zdalna}`]));

    // Zanim cokolwiek sciagniemy - sprawdz, czy ktoras z tych zmian nie kasuje pracy.
    const alerty = znajdzPodejrzane(`${galaz}..${zdalna}`);
    if (alerty.length) {
      naglowek('!!! UWAGA - PODEJRZANE ZMIANY !!!');
      console.log('Te commity KASUJA duzo kodu. Tak wygladal blad z 3.08.2026:\n');
      console.log(opiszAlerty(alerty));
      console.log('\nZanim sciagniesz - sprawdz, czy nie cofaja Twojej pracy:');
      console.log(`  git diff ${galaz} ${zdalna} -- public/index.html | grep "^-" | head -40`);
      console.log('\nNIC NIE SCIAGNALEM. Decyzja nalezy do Ciebie.');
      process.exit(2);
    }
  }

  if (przed > 0) {
    console.log(`\nMasz ${przed} zmian(y) gotowych, ale jeszcze nie wyslanych na GitHub.`);
  }
}

// --- 5. Sciagniecie zmian ---------------------------------------------------
if (zaIloma > 0) {
  if (istotne.length) {
    console.log('\nNIE SCIAGAM - najpierw zapisz swoje zmiany (patrz wyzej),');
    console.log('inaczej moglyby sie pomieszac z tym, co przyszlo z drugiego komputera.');
  } else {
    process.stdout.write('\nSciagam najnowsza wersje... ');
    try {
      // Jawnie origin + nazwa galezi - dziala takze bez zapisanego powiazania.
      execFileSync('git', ['pull', '--ff-only', '--quiet', 'origin', galaz], { stdio: 'pipe' });
      console.log('GOTOWE');
    } catch (e) {
      console.log('NIE UDALO SIE');
      console.log('Historia sie rozjechala (zmiany tu i tam jednoczesnie).');
      console.log('Nie scalaj tego na sile - zawolaj Claude.');
      process.exit(2);
    }
  }
}

// --- 6. Co stoi na produkcji ------------------------------------------------
naglowek('PRODUKCJA');
const main = git(['rev-parse', '--short', 'origin/main'], true);
const dobra = git(['rev-parse', '--short', 'ostatnia-dobra'], true);

console.log(`  origin/main:     ${main || '?'}   <- to wdraza Hostinger`);
console.log(`  ostatnia-dobra:  ${dobra || '(brak znacznika)'}   <- ostatnia wersja sprawdzona oczami`);

if (main && dobra && main !== dobra) {
  const ile = git(['rev-list', '--count', 'ostatnia-dobra..origin/main'], true);
  console.log(`\n  Na main jest ${ile} zmian(y) po ostatniej potwierdzonej wersji.`);
  console.log('  Jesli produkcja dziala dobrze, potwierdz to znacznikiem:');
  console.log('    git tag -f ostatnia-dobra origin/main && git push -f origin ostatnia-dobra');
}

console.log(`\nJestes na: ${git(['log', '--format=%h  %s', '-1'])}`);
console.log('\nMozesz pracowac. Na koniec: npm run koniec-pracy\n');
