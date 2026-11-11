// Zasiew do próby ticketu #24 (salon demo-test, baza IZOLOWANA).
// Odwzorowuje przypadek ze zgłoszenia Oli: produkt z czterema dostawami, z których dwie najstarsze
// są już wyprzedane — to one psuły datę w nagłówku. Dokłada produkt wyprzedany w całości
// (ma pokazać „brak na stanie”) i produkt z towarem po terminie (ma trafić na nowy chip).
// Wszystkie nazwy mają prefiks „T24 ”, żeby sprzątanie było jednoznaczne. Odmawia pracy poza estelio_test:3307.
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const db = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
const T = 'demo-test';
const dzien = 86400000;
const data = (przesuniecieDni) => new Date(Date.now() + przesuniecieDni * dzien).toISOString().slice(0, 10);
setTimeout(() => { console.error('TIMEOUT zasiewu'); process.exit(1); }, 20000).unref();

// [id, nazwa, ilosc, data ważności, data dostawy]
const PARTIE = [
  // przypadek z ticketu: 11 szt. z czterech dostaw, dwie najstarsze wyprzedane
  ['T24-A1', 'T24 Apis Dermasoft', 0, data(-281), data(-282)],   // wyprzedana, po terminie — to ona kłamała w nagłówku
  ['T24-A2', 'T24 Apis Dermasoft', 0, data(199), data(-316)],    // wyprzedana
  ['T24-A3', 'T24 Apis Dermasoft', 1, data(199), data(-288)],
  ['T24-A4', 'T24 Apis Dermasoft', 10, data(435), data(-204)],
  // produkt wyprzedany w całości — kolumna ma pokazać „brak na stanie”, wiersz ma zostać widoczny
  ['T24-B1', 'T24 Krem wyprzedany', 0, data(-520), data(-700)],
  ['T24-B2', 'T24 Krem wyprzedany', 0, data(120), data(-400)],
  // towar po terminie leżący na półce — nowy chip „Po terminie”
  ['T24-C1', 'T24 Serum po terminie', 3, data(-12), data(-200)],
];

(async () => {
  await q('DELETE FROM Magazyn WHERE tenant_id = ? AND nazwa_produktu LIKE ?', [T, 'T24 %']);
  for (const [id, nazwa, ilosc, waznosc, dostawa] of PARTIE) {
    await q(
      `INSERT INTO Magazyn (id, tenant_id, nazwa_produktu, typ, ilosc, min, jednostka, data_waznosci,
                            cena_netto, cena_brutto, kategoria, kto_dodal, data_dodania)
       VALUES (?, ?, ?, 'Kremy', ?, 2, 'szt.', ?, 80.00, 160.00, 'Detal', 'Marta', ?)`,
      [id, T, nazwa, ilosc, waznosc, dostawa]
    );
  }
  console.log('zasiane: ' + JSON.stringify({ partie: PARTIE.length, produkty: 3 }));
  db.end();
  process.exit(0);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
