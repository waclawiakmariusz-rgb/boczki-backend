// narzedzia/proby/skrypty/eksport-excel-przyklady.js — przykładowe pliki .xlsx wygenerowane tym samym silnikiem, co przycisk „⬇ Excel”
// (public/eksport-excel.js), z danymi takimi, jakie dała próba na salonie demo-test (25.11.2026). Do obejrzenia w Excelu.
// Użycie: node narzedzia/proby/skrypty/eksport-excel-przyklady.js [katalog docelowy]
'use strict';
const path = require('path');
const fs = require('fs');
const E = require(path.join(__dirname, '..', '..', '..', 'public', 'eksport-excel.js'));
const katalog = process.argv[2] || path.join(__dirname, '..', '..', '..', 'proby-wyniki', 'przyklady-eksportu');
fs.mkdirSync(katalog, { recursive: true });
const teraz = new Date(2026, 10, 25, 12, 5);
const stopka = (widok, filtry, n) => 'Eksport z Estelio · salon demo-test · widok „' + widok + '” · 25.11.2026 o 12:05 · filtry: ' + (filtry || 'brak') + ' · wierszy: ' + n + ' · wykonał(a): Ola';

// 1) Magazyn po filtrze „Detal” — komórki przepuszczone przez to samo czytanie tabeli, co w panelu (atrapa tabeli z tekstem komórek
//    takim, jak na ekranie: plakietka, nazwa, podtytuł „Typ | kto | dostawa”): komórka Produkt rozbija się na osobne kolumny.
const td = (t) => ({ tagName: 'TD', innerText: t, textContent: t, colSpan: 1, querySelector: () => null, querySelectorAll: () => [] });
const th = (t) => ({ tagName: 'TH', innerText: t, textContent: t, colSpan: 1, querySelector: () => null, querySelectorAll: () => [] });
const tr = (cells) => ({ cells, offsetParent: {}, querySelector: () => null, querySelectorAll: () => cells });
const magazynEkran = [
  ['DETAL\nWitamina D3+K2\nSuplementy | Ola | dostawa 1.09.2026', '1', '31.12.2026', '79,00 PLN'],
  ['DETAL\nKolagen do picia 30 saszetek\nSuplementy | Ola | dostawa 1.09.2026', '8', '28.02.2027', '249,00 PLN'],
  ['DETAL\nSerum z witaminą C\nPielęgnacja twarzy | Ola | dostawa 1.09.2026', '2', '31.03.2027', '189,00 PLN'],
  ['DETAL\nPeeling enzymatyczny\nPielęgnacja twarzy | Ola | dostawa 1.09.2026', '5', '31.05.2027', '99,00 PLN'],
  ['DETAL\nKrem regenerujący SPF 30\nPielęgnacja twarzy | Ola | dostawa 1.09.2026', '6', '31.08.2027', '139,00 PLN'],
  ['DETAL\nBalsam ujędrniający do ciała\nPielęgnacja ciała | Ola | dostawa 1.09.2026', '4', '30.11.2027', '109,00 PLN'],
  ['DETAL\nBioVital Kolagen do picia 30\n🚛 2 dostawy: 1.09.2026, 1.11.2026\n↓ sprzedaż pobiera automatycznie z najstarszej dostawy, która ma towar', '3', '31.01.2028', '219,00 PLN'],
  ['DETAL\nTonik łagodzący\nPielęgnacja twarzy | Ola | dostawa 1.09.2026', '0', '15.12.2026', '59,00 PLN'],
];
const ths = ['Produkt', 'Il.', 'Ważność', 'Cena'].map(th);
const tabelaMagazyn = { tagName: 'TABLE', offsetParent: {}, tHead: { querySelectorAll: () => ths }, tBodies: [{ rows: magazynEkran.map((w) => tr(w.map(td))) }], querySelector: () => null, querySelectorAll: () => [] };
const zM = E.zbierzTabele(tabelaMagazyn, 'magazyn');
const plikM = path.join(katalog, 'estelio-stan-magazynowy-2026-11-25-kolumny.xlsx');
fs.writeFileSync(plikM, Buffer.from(E.xlsx([{ nazwa: 'Stan Magazynowy', naglowki: zM.naglowki, wiersze: zM.wiersze, stopka: stopka('Stan Magazynowy', 'Detal', zM.wiersze.length) }], teraz)));
console.log('Magazyn — kolumny: ' + zM.naglowki.join(' | '));

// 2) Kosmetyki → Stan magazynowy — eksport dedykowany (kategorie zwinięte na ekranie, dane z widoku po szukajce „Płyn”)
const kosmetyki = [
  ['Inwentaryzacja miesięczna > Płyny i dezynfekcja', 'Płyn micelarny', 3, 'szt.', 1, 'OK', '', ''],
  ['Inwentaryzacja miesięczna > Płyny i dezynfekcja', 'Tonik', 3, 'szt.', 1, 'OK', '', ''],
  ['Inwentaryzacja miesięczna > Płyny i dezynfekcja > Dezynfekcja', 'Spray do rąk', 3, 'szt.', 1, 'OK', '', ''],
];
const plikK = path.join(katalog, 'estelio-stan-magazynowy-kosmetyki-2026-11-25.xlsx');
fs.writeFileSync(plikK, Buffer.from(E.xlsx([{ nazwa: 'Stan magazynowy', naglowki: ['Kategoria', 'Nazwa', 'Ilość', 'Jednostka', 'Minimum', 'Status', 'Data modyfikacji', 'Ważność'], wiersze: kosmetyki, stopka: stopka('Stan Magazynowy', 'Szukaj produktu: płyn', kosmetyki.length) }], teraz)));

// 3) Co zamówić — dwie tabele o różnych kolumnach → dwa arkusze w jednym pliku
const braki = [['Tonik łagodzący', 0, 59], ['Krem pod oczy', 1, 129]];
const terminy = [['Witamina D3+K2', '31.12.2026', 36, 1], ['Tonik łagodzący', '15.12.2026', 20, 0]];
const plikZ = path.join(katalog, 'estelio-raport-co-zamowic-2026-11-25.xlsx');
fs.writeFileSync(plikZ, Buffer.from(E.xlsx([
  { nazwa: 'Braki', naglowki: ['Produkt', 'Stan', 'Cena (Brutto)'], wiersze: braki, stopka: stopka('Raport: Co zamówić?', '', braki.length + terminy.length) },
  { nazwa: 'Kończy się ważność', naglowki: ['Produkt', 'Ważność', 'Dni do końca', 'Obecny Stan'], wiersze: terminy, stopka: stopka('Raport: Co zamówić?', '', braki.length + terminy.length) },
], teraz)));

console.log('zapisano:\n  ' + [plikM, plikK, plikZ].join('\n  '));
