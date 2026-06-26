// scripts/test-booksy-parser.js — szybki test parsera na próbkach maili.
//   node scripts/test-booksy-parser.js
const { parseBooksyEmail } = require('../routes/booksyParser');

const probki = [
  {
    nazwa: 'NOWA rezerwacja',
    subject: 'Wioleta Fiuk: nowa rezerwacja wtorek, 30 czerwca 2026 15:40',
    fromName: 'Booksy.com',
    text: `Booksy
Wioleta Fiuk: nowa rezerwacja

Wioleta Fiuk
506 999 585
wtorek, 30 czerwca 2026, 15:40 - 17:35

Konsultacja - dobór zabiegu: Konsultacja zabiegowa - CIAŁO
300,00 zł+, 15:40 - 17:35
pracownik: Julia Papierzyńska`
  },
  {
    nazwa: 'ZMIANA rezerwacji',
    subject: 'Zmiany w rezerwacji czwartek, 9 lipca 2026 o 12:00',
    fromName: 'Sonia Sadzińska',
    text: `Booksy
Tablet  zmienił dane rezerwacji z dnia czwartek, 9 lipca 2026 o 12:00 do 12:45 .

Sonia Sadzińska
791 222 005
sonia.sadzinska@gmail.com
czwartek, 9 lipca 2026, 09:00 - 09:45

Endermologia LPG Alliance KOLEJNA WIZYTA
09:00 - 09:45
pracownik: Aleksandra Burczyk-Wacławiak`
  },
  {
    nazwa: 'ODWOŁANIE (klient)',
    subject: 'miroslawa Żygowska: odwołał wizytę z dnia środa, 17 czerwca 2026 11:45',
    fromName: 'miroslawa Żygowska',
    text: `Booksy
Klient miroslawa Żygowska odwołał swoją usługę Żelazko antycellulitowe - KOLEJNA WIZYTA w dniu środa, 17 czerwca 2026 o godzinie 11:45 .

miroslawa Żygowska
518 521 689
miroslawazygowska31@gmail.com
środa, 17 czerwca 2026, 11:45 - 12:45

Zabiegi na ciało i Hi-Tech: Żelazko antycellulitowe - KOLEJNA WIZYTA
219,00 zł, 11:45 - 12:45
pracownik: Julia Papierzyńska`
  },
  {
    nazwa: 'ODWOŁANIE (Tablet — bez klienta)',
    subject: 'Odwołanie wizyty z dnia poniedziałek, 29 czerwca 2026 15:00',
    fromName: 'Booksy.com',
    text: `Booksy
Tablet  odwołał twoją usługę w dniu poniedziałek, 29 czerwca 2026 o godzinie 15:00 .

poniedziałek, 29 czerwca 2026, 15:00 - 16:00

None
15:00 - 16:00
pracownik: Aleksandra Burczyk-Wacławiak`
  }
];

probki.forEach(p => {
  const w = parseBooksyEmail(p);
  console.log('\n=== ' + p.nazwa + ' ===');
  console.log(JSON.stringify(w, null, 2));
});
