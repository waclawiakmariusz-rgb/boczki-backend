// Wykrywa commity, ktore KASUJA kod zamiast go dodawac.
//
// Powod (incydent 3-10.08.2026): commit "Sync z HP" nadpisal 4 pliki starszymi
// wersjami z drugiego laptopa i cofnal trzy dni pracy nad Klubem. Git nie zglosil
// konfliktu - dla niego to byla zwykla nowa wersja pliku - wiec regres pojechal
// na produkcje i zostal zauwazony dopiero po tygodniu.
//
// Uwaga: komunikaty celowo BEZ polskich ogonkow. Konsola Windows (PowerShell 5.1)
// domyslnie nie jest w UTF-8 i zamienialaby je na krzaki.

const { execFileSync } = require('child_process');

// Pliki, w ktorych masowe kasowanie jest podejrzane. Reszta (testy, dokumentacja,
// skrypty jednorazowe) bywa kasowana w dobrej wierze, wiec ich nie pilnujemy.
const PLIKI_WRAZLIWE = [
  /^public\/.*\.html$/,
  /^routes\/.*\.js$/,
  /^server\.js$/,
];

// Progi dobrane tak, zeby zlapac przypadek z 3.08 (index.html: -54/+10),
// a nie krzyczec przy zwyklym porzadkowaniu kodu.
const MIN_USUNIETYCH = 20;        // ponizej tego nie zawracamy glowy
const KROTNOSC = 2;               // usuniec musi byc 2x wiecej niz dodan
const SLOWA_RYZYKOWNE = /\b(sync|synchron|kopia|skopiowane|z laptopa|z hp|z dell|przenies)/i;
const MIN_USUNIETYCH_PRZY_SLOWIE = 5;   // przy opisie "sync" czepiamy sie wczesniej

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function wrazliwy(sciezka) {
  return PLIKI_WRAZLIWE.some((re) => re.test(sciezka));
}

/**
 * @param {string} zakres np. "origin/main..HEAD" albo pojedynczy hash
 * @returns {Array} lista alertow: { hash, opis, autor, data, pliki: [{sciezka, dodane, usuniete}] }
 */
function znajdzPodejrzane(zakres) {
  let hashe;
  try {
    hashe = git(['log', '--format=%H', zakres]).split('\n').filter(Boolean);
  } catch (e) {
    return [];   // nieznany zakres (np. swiezo utworzona galaz) - nie blokujemy
  }

  const alerty = [];

  for (const hash of hashe) {
    // Merge commity pomijamy - numstat liczy je wzgledem pierwszego rodzica i myli.
    const rodzice = git(['rev-list', '--parents', '-n', '1', hash]).trim().split(/\s+/);
    if (rodzice.length > 2) continue;

    const opis = git(['log', '-1', '--format=%s%n%b', hash]).trim();
    const autor = git(['log', '-1', '--format=%an', hash]).trim();
    const data = git(['log', '-1', '--format=%ad', '--date=format:%Y-%m-%d %H:%M', hash]).trim();

    let numstat;
    try {
      numstat = git(['show', '--numstat', '--format=', hash]);
    } catch (e) {
      continue;
    }

    const podejrzanePliki = [];
    for (const linia of numstat.split('\n')) {
      const czesci = linia.split('\t');
      if (czesci.length < 3) continue;
      const dodane = parseInt(czesci[0], 10);
      const usuniete = parseInt(czesci[1], 10);
      const sciezka = czesci[2];
      if (Number.isNaN(dodane) || Number.isNaN(usuniete)) continue;   // plik binarny
      if (!wrazliwy(sciezka)) continue;

      const masoweKasowanie = usuniete >= MIN_USUNIETYCH && usuniete > dodane * KROTNOSC;
      const podejrzanyOpis = SLOWA_RYZYKOWNE.test(opis) && usuniete >= MIN_USUNIETYCH_PRZY_SLOWIE && usuniete > dodane;

      if (masoweKasowanie || podejrzanyOpis) {
        podejrzanePliki.push({ sciezka, dodane, usuniete, powodOpis: podejrzanyOpis && !masoweKasowanie });
      }
    }

    if (podejrzanePliki.length) {
      alerty.push({
        hash: hash.slice(0, 7),
        opis: opis.split('\n')[0],
        autor,
        data,
        pliki: podejrzanePliki,
      });
    }
  }

  return alerty;
}

function opiszAlerty(alerty) {
  const linie = [];
  for (const a of alerty) {
    linie.push(`  ${a.hash}  ${a.opis}`);
    linie.push(`          ${a.autor}, ${a.data}`);
    for (const p of a.pliki) {
      linie.push(`          ${p.sciezka}: USUWA ${p.usuniete} linii, dodaje ${p.dodane}`);
    }
  }
  return linie.join('\n');
}

module.exports = { znajdzPodejrzane, opiszAlerty };
