// Zatrzymuje wysylke commita, ktory KASUJE kod zamiast go dodawac.
//
// Powstal po incydencie 3-10.08.2026: commit "Sync z HP" (-54 linie w index.html,
// +10) cofnal trzy commity Klubu i pojechal na produkcje. Ten hook by go zatrzymal.
//
// Git podaje na wejsciu linie: <ref lokalny> <sha lokalny> <ref zdalny> <sha zdalny>
// Komunikaty bez polskich ogonkow (konsola Windows nie jest domyslnie w UTF-8).

const fs = require('fs');
const path = require('path');
const { znajdzPodejrzane, opiszAlerty } = require(path.join(__dirname, '..', 'narzedzia', 'analiza-commitow'));

const ZERA = /^0+$/;

let wejscie = '';
try {
  wejscie = fs.readFileSync(0, 'utf8');
} catch (e) {
  process.exit(0);       // brak danych z gita - nie blokujemy
}

const alerty = [];

for (const linia of wejscie.split('\n').filter(Boolean)) {
  const [, shaLokalny, refZdalny, shaZdalny] = linia.split(' ');

  if (!shaLokalny || ZERA.test(shaLokalny)) continue;         // kasowanie galezi

  // Nowa galaz na GitHubie: nie ma z czym porownac, wiec bierzemy odcinek od main.
  const zakres = (!shaZdalny || ZERA.test(shaZdalny))
    ? `origin/main..${shaLokalny}`
    : `${shaZdalny}..${shaLokalny}`;

  for (const a of znajdzPodejrzane(zakres)) {
    a.dokad = refZdalny || '(nowa galaz)';
    alerty.push(a);
  }
}

if (!alerty.length) process.exit(0);

const naMain = alerty.some((a) => String(a.dokad).includes('main'));

console.error('');
console.error('#############################################################');
console.error('##  STOP - TA WYSYLKA KASUJE DUZO KODU                     ##');
console.error('#############################################################');
console.error('');
console.error(opiszAlerty(alerty));
console.error('');
console.error('Tak wlasnie wygladal blad z 3.08.2026: commit "Sync z HP" usunal');
console.error('54 linie z index.html i cofnal trzy dni pracy nad Klubem. Nikt tego');
console.error('nie zauwazyl przez tydzien, bo git nie zglasza takiej sytuacji jako bledu.');
console.error('');
console.error('SPRAWDZ, CZY NIE COFASZ WLASNEJ PRACY:');
console.error('  git show <hash> -- public/index.html | grep "^-" | head -40');
console.error('');
if (naMain) {
  console.error('To idzie na MAIN, czyli prosto na produkcje. Tym bardziej sprawdz.');
  console.error('');
}
console.error('JESLI TO SWIADOME KASOWANIE (np. usuwasz stara funkcje), wyslij tak:');
console.error('  git push --no-verify');
console.error('');

process.exit(1);
