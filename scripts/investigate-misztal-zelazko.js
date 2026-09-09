// scripts/investigate-misztal-zelazko.js
// Śledztwo (TYLKO ODCZYT — zero UPDATE/INSERT/DELETE): sprawa zadatku "żelazko 96 zł"
// klientki Misztal. Zgłoszenie: wpłacono nowy zadatek 96 zł mimo istniejącego zadatku
// 96 zł za żelazko, system rozliczył to jako dopłatę do starego, a faktycznie miał
// miejsce dzień bez rozliczenia — teraz nowa wpłata nie jest widoczna w systemie.
//
// Wypisuje: dane klientki, WSZYSTKIE zadatki (każdy status), WSZYSTKĄ sprzedaż
// zawierającą "żelazk" w opisie/zabiegu, powiązania id_zadatku<->Zadatki.id,
// oraz wpisy z Dziennika Zdarzeń (Logi) dotyczące klientki.
//
//   node scripts/investigate-misztal-zelazko.js
require('dotenv').config();
const mysql = require('mysql2');

const TENANT = 'boczki-salon-glowny-001';

function stripQuotes(v) { return (v || '').replace(/^['"]|['"]$/g, ''); }
const q = (db, sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));

async function main() {
  const db = mysql.createConnection({
    host: stripQuotes(process.env.DB_HOST),
    user: stripQuotes(process.env.DB_USER),
    password: stripQuotes(process.env.DB_PASSWORD),
    database: stripQuotes(process.env.DB_NAME),
  });
  await new Promise((res, rej) => db.connect(e => e ? rej(e) : res()));
  console.log('=== ŚLEDZTWO: zadatek "żelazko" — Misztal (TYLKO ODCZYT) ===\n');

  // 1. Kartoteka klientki
  const klienci = await q(db,
    `SELECT id_klienta, imie_nazwisko, telefon FROM Klienci WHERE tenant_id = ? AND imie_nazwisko LIKE ?`,
    [TENANT, '%Misztal%']);
  console.log('--- KARTOTEKA ---');
  if (!klienci.length) { console.log('  Nie znaleziono klientki "Misztal".'); db.end(); return; }
  klienci.forEach(k => console.log(`  id_klienta=${k.id_klienta} | ${k.imie_nazwisko} | tel=${k.telefon}`));
  const ids = klienci.map(k => String(k.id_klienta));
  console.log('');

  // 2. WSZYSTKIE zadatki tej klientki (dowolny status), po dacie
  const zadatki = await q(db,
    `SELECT id, id_klienta, klient, typ, kwota, metoda, cel, status, data_wplaty
       FROM Zadatki WHERE tenant_id = ? AND id_klienta IN (${ids.map(() => '?').join(',')})
      ORDER BY data_wplaty ASC`,
    [TENANT, ...ids]);
  console.log('--- ZADATKI (wszystkie statusy, chronologicznie) ---');
  if (!zadatki.length) console.log('  Brak zadatków przypisanych do tej kartoteki (id_klienta).');
  zadatki.forEach(z => console.log(
    `  ${z.id} | ${z.data_wplaty} | ${z.typ} | ${z.kwota} zł | ${z.metoda} | STATUS=${z.status} | cel="${z.cel}"`));
  console.log('');

  // 2b. Zadatki BEZ id_klienta, ale z nazwiskiem pasującym (częsty ślad błędu — zapisane na "gołe" nazwisko)
  const zadatkiBezId = await q(db,
    `SELECT id, id_klienta, klient, typ, kwota, metoda, cel, status, data_wplaty
       FROM Zadatki WHERE tenant_id = ? AND klient LIKE ? AND (id_klienta IS NULL OR id_klienta = '')
      ORDER BY data_wplaty ASC`,
    [TENANT, '%Misztal%']);
  console.log('--- ZADATKI BEZ id_klienta, ale z nazwiskiem "Misztal" (możliwy ślad rozjazdu) ---');
  if (!zadatkiBezId.length) console.log('  Brak.');
  zadatkiBezId.forEach(z => console.log(
    `  ${z.id} | ${z.data_wplaty} | ${z.typ} | ${z.kwota} zł | ${z.metoda} | STATUS=${z.status} | cel="${z.cel}"`));
  console.log('');

  // 3. Sprzedaż zawierająca "żelazk" dla tej klientki (po id_klienta LUB po nazwisku — na wypadek braku id)
  const sprzedaz = await q(db,
    `SELECT id, id_klienta, klient, zabieg, szczegoly, kwota, platnosc, id_zadatku, data_sprzedazy, status
       FROM Sprzedaz
      WHERE tenant_id = ?
        AND (klient LIKE ? OR id_klienta IN (${ids.map(() => '?').join(',') || "''"}))
        AND (zabieg LIKE '%elazk%' OR szczegoly LIKE '%elazk%')
      ORDER BY data_sprzedazy ASC`,
    [TENANT, '%Misztal%', ...ids]);
  console.log('--- SPRZEDAŻ zawierająca "żelazko" (klient Misztal) ---');
  if (!sprzedaz.length) console.log('  Brak transakcji sprzedaży ze słowem "żelazko" dla tej klientki.');
  sprzedaz.forEach(s => console.log(
    `  ${s.id} | ${s.data_sprzedazy} | "${s.zabieg}" ${s.szczegoly ? '(' + s.szczegoly + ')' : ''} | ${s.kwota} zł | ${s.platnosc} | id_zadatku="${s.id_zadatku}" | STATUS=${s.status}`));
  console.log('');

  // 4. Krzyżowa weryfikacja: czy id_zadatku w sprzedaży wskazuje na istniejący/y zadatek(i) z listy wyżej
  console.log('--- POWIĄZANIA id_zadatku (Sprzedaż) -> Zadatki.id ---');
  for (const s of sprzedaz) {
    if (!s.id_zadatku) { console.log(`  Sprzedaż ${s.id}: BRAK id_zadatku (płatność nie przez zadatek/portfel)`); continue; }
    const wskazywane = String(s.id_zadatku).split(',').map(x => x.trim()).filter(Boolean);
    for (const wid of wskazywane) {
      const z = zadatki.find(zz => String(zz.id) === wid) || zadatkiBezId.find(zz => String(zz.id) === wid);
      if (z) console.log(`  Sprzedaż ${s.id} -> Zadatek ${wid}: ZNALEZIONY (status=${z.status}, kwota=${z.kwota} zł, data=${z.data_wplaty})`);
      else {
        const gdzieindziej = await q(db, `SELECT id, tenant_id, id_klienta, klient, kwota, status, data_wplaty FROM Zadatki WHERE id = ? LIMIT 1`, [wid]);
        if (gdzieindziej.length) console.log(`  Sprzedaż ${s.id} -> Zadatek ${wid}: ISTNIEJE, ale NALEŻY DO INNEGO KLIENTA (${gdzieindziej[0].klient}, id_klienta=${gdzieindziej[0].id_klienta}, status=${gdzieindziej[0].status})`);
        else console.log(`  Sprzedaż ${s.id} -> Zadatek ${wid}: NIE ISTNIEJE w tabeli Zadatki (osierocone odwołanie!)`);
      }
    }
  }
  console.log('');

  // 5. Dziennik Zdarzeń — wszystko dotyczące tej klientki (po imieniu i nazwisku w opisie)
  const logi = await q(db,
    `SELECT data_zdarzenia, pracownik, akcja, opis FROM Logi WHERE tenant_id = ? AND opis LIKE ? ORDER BY data_zdarzenia ASC`,
    [TENANT, '%Misztal%']);
  console.log('--- DZIENNIK ZDARZEŃ (wpisy wspominające "Misztal") ---');
  if (!logi.length) console.log('  Brak wpisów.');
  logi.forEach(l => console.log(`  ${l.data_zdarzenia} | ${l.pracownik} | ${l.akcja} | ${l.opis}`));
  console.log('');

  console.log('=== KONIEC (żaden wiersz nie został zmieniony) ===');
  db.end();
}
main().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
