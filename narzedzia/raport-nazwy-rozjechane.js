// narzedzia/raport-nazwy-rozjechane.js
// Jednorazowe zestawienie dla właściciela (paczka I planu poprawy terminarza, 16.11.2026).
// WYŁĄCZNIE SELECT-y — niczego nie poprawia. Decyzja z 9.11: salony porządkują imiona same,
// my tylko pokazujemy, gdzie pisownia odbiega od reguły z routes/nazwy.js.
//
// Uruchomienie na produkcji (tylko odczyt):
//   node -r dotenv/config narzedzia/raport-nazwy-rozjechane.js dotenv_config_path=.env.produkcja
// Na bazie izolowanej:
//   node -r dotenv/config narzedzia/raport-nazwy-rozjechane.js dotenv_config_path=.env.test
'use strict';
const mysql = require('mysql2');
const { normalizujNazwe } = require('../routes/nazwy');

const db = mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, connectTimeout: 20000,
});
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => (e ? rej(e) : res(r))));
const poka = (s) => '[' + String(s) + ']';
const rozjazd = (s) => s != null && String(s) !== normalizujNazwe(s);

/** Jedno źródło: tabela, kolumna z imieniem i opis dla człowieka. */
const ZRODLA = [
  ['Pracownicy', 'imie', 'lista zespołu'],
  ['Term_Nieobecnosci', 'pracownik', 'urlopy i nieobecności'],
  ['Term_Zajecia', 'klucz', 'zajętość w siatce (tylko typ_zasobu = pracownik)'],
  ['Term_Pozycje', 'pracownik', 'osoba przypisana do zabiegu'],
  ['Term_Pozycje', 'wykonawca_fakt', 'kto faktycznie wykonał'],
  ['Sprzedaz', 'sprzedawca', 'sprzedaż'],
];

(async () => {
  console.log(`\n=== Imiona niezgodne z regułą pisowni — zestawienie (tylko odczyt) ===`);
  console.log(`Baza: ${process.env.DB_NAME}  ·  reguła: spacje na brzegach obcięte, wielokrotne w środku zwinięte do jednej\n`);

  const salony = await q(`SELECT DISTINCT tenant_id FROM Pracownicy ORDER BY tenant_id`);
  let lacznie = 0;

  for (const { tenant_id } of salony) {
    const znaleziska = [];

    for (const [tabela, kolumna, opis] of ZRODLA) {
      const warunek = tabela === 'Term_Zajecia' ? ` AND typ_zasobu = 'pracownik'` : '';
      let rows;
      try {
        rows = await q(
          `SELECT ${kolumna} AS wartosc, COUNT(*) AS ile FROM ${tabela}
            WHERE tenant_id = ? AND ${kolumna} IS NOT NULL AND ${kolumna} <> ''${warunek}
            GROUP BY ${kolumna}`, [tenant_id]);
      } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR') continue;
        throw e;
      }
      for (const r of rows) if (rozjazd(r.wartosc)) znaleziska.push({ gdzie: `${tabela}.${kolumna}`, opis, wartosc: r.wartosc, ile: r.ile });
    }

    // lista wykonawców usługi trzymana jako JSON — sprawdzamy każdy element osobno
    try {
      const uslugi = await q(`SELECT usluga_id, pracownicy_json FROM Term_Uslugi WHERE tenant_id = ? AND pracownicy_json IS NOT NULL`, [tenant_id]);
      for (const u of uslugi) {
        let lista; try { lista = JSON.parse(u.pracownicy_json); } catch (e) {
          znaleziska.push({ gdzie: 'Term_Uslugi.pracownicy_json', opis: 'lista wykonawców usługi', wartosc: '(nieczytelny JSON) ' + u.usluga_id, ile: 1 });
          continue;
        }
        if (!Array.isArray(lista)) continue;
        for (const x of lista) if (rozjazd(x)) znaleziska.push({ gdzie: 'Term_Uslugi.pracownicy_json', opis: `lista wykonawców usługi ${u.usluga_id}`, wartosc: x, ile: 1 });
      }
    } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e; }

    if (!znaleziska.length) { console.log(`${tenant_id}: czysto`); continue; }
    lacznie += znaleziska.length;
    console.log(`\n${tenant_id}: ${znaleziska.length} wpisów do poprawienia`);
    for (const z of znaleziska) {
      console.log(`  ${poka(z.wartosc)} → ${poka(normalizujNazwe(z.wartosc))}   ×${z.ile}   ${z.gdzie}  (${z.opis})`);
    }
  }

  console.log(`\n=== Razem wpisów z rozjechaną pisownią: ${lacznie} ===`);
  console.log(`Nic nie zostało zmienione. Poprawki robi się w panelu przyciskiem „Zmień" przy osobie —`);
  console.log(`serwer przepisze imię we wszystkich powyższych miejscach naraz.\n`);
  db.end();
})().catch(e => { console.error('BŁĄD:', e.message); db.end(); process.exit(1); });
