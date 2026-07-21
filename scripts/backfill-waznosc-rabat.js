// scripts/backfill-waznosc-rabat.js
// Backfill dat ważności dla pozycji, którym sufiks rabatu ("[Rabat: -20%]", "[🎂 Urodziny: -15%]")
// zepsuł dopasowanie do katalogu Uslugi (bug naprawiony w sprzedaz.js — bezSufiksuRabatu).
//
// Co robi:
//   - Znajduje Sprzedaz z data_waznosci IS NULL (pakiety, kwota>0, nie kosmetyki, nie USUNIĘTY),
//     których BAZOWY wariant (szczegoly bez sufiksu " [...]") pasuje do Uslugi z ustawionym waznosc_dni.
//   - Ustawia data_waznosci = DATE(data_sprzedazy) + waznosc_dni  (snapshot jak w chwili sprzedaży).
//   - NIGDY nie nadpisuje istniejącej daty (WHERE data_waznosci IS NULL).
//   - Zapisuje PLIK COFAJĄCY (undo log) z każdą zmianą → rewert = ustawić te id z powrotem na NULL.
//
// Użycie:
//   node scripts/backfill-waznosc-rabat.js              # DRY-RUN (nic nie zapisuje)
//   node scripts/backfill-waznosc-rabat.js --wet-run    # właściwy backfill + undo log
//   node scripts/backfill-waznosc-rabat.js --undo <plik-undo.json>   # cofnięcie (przywraca NULL)
//
// Środowisko: DB_HOST/DB_USER/DB_PASSWORD/DB_NAME z .env; tenant Boczki.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');

const strip = v => (v || '').replace(/^['"]|['"]$/g, '');
const TENANT = 'boczki-salon-glowny-001';
const WET = process.argv.includes('--wet-run');
const UNDO_IDX = process.argv.indexOf('--undo');
const UNDO_FILE = UNDO_IDX >= 0 ? process.argv[UNDO_IDX + 1] : null;

const db = mysql.createConnection({
  host: strip(process.env.DB_HOST), user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD), database: strip(process.env.DB_NAME),
});
const q = (sql, p) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
const dstr = v => v == null ? null : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

async function undo() {
  const zmiany = JSON.parse(fs.readFileSync(UNDO_FILE, 'utf8'));
  console.log(`COFANIE z ${UNDO_FILE} — ${zmiany.length} wierszy → data_waznosci NULL`);
  await new Promise((r, j) => db.connect(e => e ? j(e) : r()));
  let ok = 0;
  for (const z of zmiany) {
    // przywracamy NULL tylko jeśli obecna wartość = ta, którą ustawiliśmy (nie ruszamy ręcznych zmian)
    const r = await q(
      `UPDATE Sprzedaz SET data_waznosci = NULL WHERE tenant_id=? AND id=? AND data_waznosci=?`,
      [TENANT, z.id, z.set]);
    if (r.affectedRows) ok++;
  }
  console.log(`Przywrócono NULL: ${ok}/${zmiany.length}`);
  db.end();
}

async function main() {
  console.log('=== BACKFILL ważności (bug sufiksu rabatu) ===');
  console.log('Tryb:', WET ? 'WET-RUN (zapisuje)' : 'DRY-RUN (bez zmian)');
  await new Promise((r, j) => db.connect(e => e ? j(e) : r()));
  console.log('DB:', strip(process.env.DB_NAME), '@', strip(process.env.DB_HOST), '\n');

  // Kandydaci: pusta ważność, pakiet (nie kosmetyk), kwota>0, bazowy wariant pasuje do Uslugi z waznosc_dni.
  const rows = await q(
    `SELECT S.id, S.data_sprzedazy, S.zabieg, S.szczegoly, U.waznosc_dni,
            DATE_FORMAT(DATE_ADD(DATE(S.data_sprzedazy), INTERVAL U.waznosc_dni DAY), '%Y-%m-%d') AS nowa_data
       FROM Sprzedaz S
       JOIN Uslugi U ON U.tenant_id = S.tenant_id
            AND TRIM(U.kategoria) = TRIM(S.zabieg)
            AND TRIM(U.wariant)   = TRIM(SUBSTRING_INDEX(S.szczegoly, ' [', 1))
      WHERE S.tenant_id = ?
        AND S.data_waznosci IS NULL
        AND S.kategoria_produktu IS NULL
        AND S.kwota > 0
        AND COALESCE(S.status,'') != 'USUNIĘTY'
        AND U.waznosc_dni IS NOT NULL
        AND S.szczegoly LIKE '% [%'`,
    [TENANT]);

  console.log(`Do uzupełnienia: ${rows.length} pozycji\n`);
  rows.slice(0, 15).forEach(r =>
    console.log(`  ${dstr(r.data_sprzedazy)}  ${r.zabieg} — ${r.szczegoly}  → ${r.nowa_data} (${r.waznosc_dni} dni)`));
  if (rows.length > 15) console.log(`  ... (+${rows.length - 15} więcej)`);
  console.log('');

  if (!WET) {
    console.log('DRY-RUN — nic nie zapisano. Wet-run: node scripts/backfill-waznosc-rabat.js --wet-run');
    db.end();
    return;
  }
  if (!rows.length) { console.log('Nic do zrobienia.'); db.end(); return; }

  // Undo log PRZED zapisem
  const undoData = rows.map(r => ({ id: r.id, was: null, set: r.nowa_data }));
  const undoPath = path.join(__dirname, `backfill-waznosc-undo-${Date.now()}.json`);
  fs.writeFileSync(undoPath, JSON.stringify(undoData, null, 2), 'utf8');
  console.log(`Undo log zapisany: ${undoPath}\n`);

  let ok = 0, err = 0;
  for (const r of rows) {
    try {
      const res = await q(
        `UPDATE Sprzedaz SET data_waznosci = ? WHERE tenant_id=? AND id=? AND data_waznosci IS NULL`,
        [r.nowa_data, TENANT, r.id]);
      if (res.affectedRows) ok++;
    } catch (e) { console.error('  BŁĄD id=' + r.id + ':', e.message); err++; }
  }
  console.log(`Zaktualizowano: ${ok} | błędy: ${err}`);
  console.log(`Cofnięcie: node scripts/backfill-waznosc-rabat.js --undo "${undoPath}"`);
  db.end();
}

(UNDO_FILE ? undo() : main()).catch(e => { console.error('BŁĄD KRYTYCZNY:', e.message); process.exit(1); });
