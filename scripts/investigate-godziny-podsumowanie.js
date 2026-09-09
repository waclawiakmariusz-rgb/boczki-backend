// scripts/investigate-godziny-podsumowanie.js
// Śledztwo (TYLKO ODCZYT): problem z godzinami/kolejnością w Podsumowaniu Dnia
// (moduł Sprzedaż). Odtwarza DOKŁADNIE logikę backendu (routes/analityka.js,
// funkcja pobierzTransakcjeZDnia) na dzisiejszych danych: surowy string z bazy,
// wyciągnięta godzina (slice 11,16 — to co widzi user), timestamp liczony
// przez `new Date(string).getTime()` (to czym system faktycznie SORTUJE listę),
// i finalna kolejność po sortowaniu.
//
//   node scripts/investigate-godziny-podsumowanie.js [YYYY-MM-DD]   (domyślnie: dziś)
require('dotenv').config();
const mysql = require('mysql2');

const TENANT = 'boczki-salon-glowny-001';
const DATA = process.argv[2] || new Date().toISOString().slice(0, 10);

function stripQuotes(v) { return (v || '').replace(/^['"]|['"]$/g, ''); }
const q = (db, sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));

async function main() {
  const db = mysql.createConnection({
    host: stripQuotes(process.env.DB_HOST),
    user: stripQuotes(process.env.DB_USER),
    password: stripQuotes(process.env.DB_PASSWORD),
    database: stripQuotes(process.env.DB_NAME),
    dateStrings: true, // DOKŁADNIE jak w server.js — to jest sedno sprawy
  });
  await new Promise((res, rej) => db.connect(e => e ? rej(e) : res()));

  console.log('=== ŚLEDZTWO: godziny/kolejność w Podsumowaniu Dnia —', DATA, '===');
  console.log('Zegar tego komputera (skryptu):', new Date().toString());
  console.log('Strefa czasowa procesu Node (Intl):', Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('process.env.TZ:', process.env.TZ || '(nieustawione)');
  console.log('');

  const zadatki = await q(db,
    `SELECT id, data_wplaty, klient, metoda, kwota FROM Zadatki WHERE tenant_id = ? AND DATE(data_wplaty) = ? AND COALESCE(status,'') != 'USUNIĘTY'`,
    [TENANT, DATA]);
  const sprzedaz = await q(db,
    `SELECT id, data_sprzedazy, klient, zabieg, kwota, platnosc FROM Sprzedaz WHERE tenant_id = ? AND DATE(data_sprzedazy) = ? AND COALESCE(status,'') != 'USUNIĘTY'`,
    [TENANT, DATA]);

  const wynik = [];
  zadatki.forEach(r => wynik.push({
    typ: 'ZADATEK', id: r.id, klient: r.klient, opis: '+ Wpłata Zadatku (' + r.metoda + ')', kwota: r.kwota,
    surowy: String(r.data_wplaty),
    godzina_slice: String(r.data_wplaty).slice(11, 16),
    timestamp: new Date(r.data_wplaty).getTime(),
  }));
  sprzedaz.forEach(r => {
    if (String(r.platnosc || '').toLowerCase().includes('portfel')) return; // pomijane jak w backendzie
    wynik.push({
      typ: 'SPRZEDAZ', id: r.id, klient: r.klient, opis: r.zabieg, kwota: r.kwota,
      surowy: String(r.data_sprzedazy),
      godzina_slice: String(r.data_sprzedazy).slice(11, 16),
      timestamp: new Date(r.data_sprzedazy).getTime(),
    });
  });

  console.log('--- SUROWE DANE (kolejność wg ID w bazie, nieposortowane) ---');
  wynik.forEach(w => console.log(
    `  [${w.typ}] ${w.id} | surowy="${w.surowy}" | godzina_pokazana="${w.godzina_slice}" | timestamp_do_sortowania=${w.timestamp} (${new Date(w.timestamp).toString()}) | ${w.klient} | ${w.opis} | ${w.kwota} zł`));

  console.log('\n--- PO SORTOWANIU JAK W BACKENDZIE (malejąco po timestamp) ---');
  const posortowane = [...wynik].sort((a, b) => b.timestamp - a.timestamp);
  posortowane.forEach((w, i) => console.log(
    `  ${i + 1}. godzina_pokazana="${w.godzina_slice}" | [${w.typ}] ${w.klient} | ${w.opis} | ${w.kwota} zł  (timestamp=${w.timestamp})`));

  console.log('\n--- PRAWIDŁOWA KOLEJNOŚĆ, GDYBY SORTOWAĆ PO SUROWYM STRINGU (bez new Date()) ---');
  const poprawnie = [...wynik].sort((a, b) => b.surowy.localeCompare(a.surowy));
  poprawnie.forEach((w, i) => console.log(
    `  ${i + 1}. godzina_pokazana="${w.godzina_slice}" | [${w.typ}] ${w.klient} | ${w.opis} | ${w.kwota} zł`));

  console.log('\n=== KONIEC (żaden wiersz nie został zmieniony) ===');
  db.end();
}
main().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
