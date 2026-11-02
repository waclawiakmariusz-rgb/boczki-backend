#!/usr/bin/env node
// Zrzuty PNG z prób → JPEG do bloga (public/img/blog/<slug>/), zmniejszone i skompresowane.
//
//   node narzedzia/blog/obrazki.js <katalog-wejsciowy> <slug> --mapa '{"wzorzec":"nazwa-docelowa", ...}' [--szerokosc 1600] [--jakosc 82]
//
// „wzorzec” to fragment nazwy pliku wejściowego (np. "zabieg-wypelniony"), „nazwa-docelowa” bez rozszerzenia.
// Pliki, których nie ma w mapie, są pomijane. Repo nie puchnie: 1440 px szerokości i jakość 82 daje ok. 80–150 KB na zrzut.
'use strict';
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const KORZEN = path.join(__dirname, '..', '..');
const argv = process.argv.slice(2);
const opcja = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const [WE, SLUG] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
if (!WE || !SLUG) { console.error('Użycie: node narzedzia/blog/obrazki.js <katalog-wejsciowy> <slug> --mapa \'{"wzorzec":"nazwa"}\' [--szerokosc 1600] [--jakosc 82]'); process.exit(2); }
const MAPA = JSON.parse(opcja('mapa', '{}'));
const SZER = Number(opcja('szerokosc', '1440')) || 1440;
const JAKOSC = Number(opcja('jakosc', '82')) || 82;
const WY = path.join(KORZEN, 'public', 'img', 'blog', SLUG);
fs.mkdirSync(WY, { recursive: true });

(async () => {
  const pliki = fs.readdirSync(WE).filter(f => /\.png$/i.test(f));
  let n = 0;
  for (const [wzorzec, cel] of Object.entries(MAPA)) {
    const zrodlo = pliki.find(f => f.includes(wzorzec));
    if (!zrodlo) { console.error('  brak pliku pasującego do: ' + wzorzec); continue; }
    const img = await Jimp.read(path.join(WE, zrodlo));
    if (img.bitmap.width > SZER) img.resize(SZER, Jimp.AUTO);
    const out = path.join(WY, cel + '.jpg');
    await img.quality(JAKOSC).writeAsync(out);
    console.log(`  ${zrodlo} → ${path.relative(KORZEN, out)} (${Math.round(fs.statSync(out).size / 1024)} KB, ${img.bitmap.width}x${img.bitmap.height})`);
    n++;
  }
  console.log(`gotowe: ${n} plików w ${path.relative(KORZEN, WY)}`);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
