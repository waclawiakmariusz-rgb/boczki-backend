// scripts/backfill-waznosc-wciaz-wazne.js
// Backfill dat ważności dla pozycji sprzed wdrożenia funkcji (2026-06-23) i innych NULL-i BEZ rabatu,
// które dokładnie pasują do katalogu Uslugi — ale TYLKO gdy ważność jeszcze NIE minęła.
// Decyzja usera 2026-07-21: nie oznaczamy wstecz jako wygasłe; dawno przeterminowane zostają bez limitu.
//
//   node scripts/backfill-waznosc-wciaz-wazne.js              # DRY-RUN
//   node scripts/backfill-waznosc-wciaz-wazne.js --wet-run    # zapis + undo log
//   node scripts/backfill-waznosc-wciaz-wazne.js --undo <plik-undo.json>   # cofnięcie (NULL)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const strip = v => (v || '').replace(/^['"]|['"]$/g, '');
const TENANT = 'boczki-salon-glowny-001';
const WET = process.argv.includes('--wet-run');
const UNDO_IDX = process.argv.indexOf('--undo');
const UNDO_FILE = UNDO_IDX >= 0 ? process.argv[UNDO_IDX + 1] : null;

const db = mysql.createConnection({ host: strip(process.env.DB_HOST), user: strip(process.env.DB_USER), password: strip(process.env.DB_PASSWORD), database: strip(process.env.DB_NAME) });
const q = (sql, p) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
const dstr = v => v == null ? null : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// Kandydaci: NULL-ważność, pakiet (nie kosmetyk), kwota>0, BEZ sufiksu rabatu, dokładne dopasowanie
// do katalogu z waznosc_dni, ORAZ policzona ważność >= dziś (jeszcze ważne).
const KANDYDACI = `
  SELECT S.id, S.data_sprzedazy, S.zabieg, S.szczegoly, U.waznosc_dni,
         DATE_FORMAT(DATE_ADD(DATE(S.data_sprzedazy), INTERVAL U.waznosc_dni DAY), '%Y-%m-%d') AS nowa_data
    FROM Sprzedaz S
    JOIN Uslugi U ON U.tenant_id = S.tenant_id
         AND TRIM(U.kategoria) = TRIM(S.zabieg)
         AND TRIM(U.wariant)   = TRIM(S.szczegoly)
   WHERE S.tenant_id = ?
     AND S.data_waznosci IS NULL AND S.kategoria_produktu IS NULL AND S.kwota > 0
     AND COALESCE(S.status,'') != 'USUNIĘTY'
     AND S.szczegoly NOT LIKE '% [%'
     AND U.waznosc_dni IS NOT NULL
     AND DATE_ADD(DATE(S.data_sprzedazy), INTERVAL U.waznosc_dni DAY) >= CURDATE()`;

async function undo() {
  const zmiany = JSON.parse(fs.readFileSync(UNDO_FILE, 'utf8'));
  await new Promise((r, j) => db.connect(e => e ? j(e) : r()));
  let ok = 0;
  for (const z of zmiany) {
    const r = await q(`UPDATE Sprzedaz SET data_waznosci = NULL WHERE tenant_id=? AND id=? AND data_waznosci=?`, [TENANT, z.id, z.set]);
    if (r.affectedRows) ok++;
  }
  console.log(`Przywrócono NULL: ${ok}/${zmiany.length}`);
  db.end();
}

async function main() {
  console.log('=== BACKFILL ważności — tylko WCIĄŻ WAŻNE (sprzed funkcji/naming) ===');
  console.log('Tryb:', WET ? 'WET-RUN (zapisuje)' : 'DRY-RUN (bez zmian)');
  await new Promise((r, j) => db.connect(e => e ? j(e) : r()));
  console.log('DB:', strip(process.env.DB_NAME), '@', strip(process.env.DB_HOST), '\n');

  const rows = await q(KANDYDACI, [TENANT]);
  console.log(`Do uzupełnienia (jeszcze ważne): ${rows.length} pozycji\n`);
  rows.slice(0, 15).forEach(r => console.log(`  ${dstr(r.data_sprzedazy)}  ${r.zabieg} — ${r.szczegoly}  → ${r.nowa_data} (${r.waznosc_dni} dni)`));
  if (rows.length > 15) console.log(`  ... (+${rows.length - 15} więcej)`);
  console.log('');

  if (!WET) { console.log('DRY-RUN — nic nie zapisano. Wet-run: --wet-run'); db.end(); return; }
  if (!rows.length) { console.log('Nic do zrobienia.'); db.end(); return; }

  const undoData = rows.map(r => ({ id: r.id, was: null, set: r.nowa_data }));
  const undoPath = path.join(__dirname, `backfill-waznosc-undo-${Date.now()}.json`);
  fs.writeFileSync(undoPath, JSON.stringify(undoData, null, 2), 'utf8');
  console.log(`Undo log: ${undoPath}\n`);

  let ok = 0, err = 0;
  for (const r of rows) {
    try {
      const res = await q(`UPDATE Sprzedaz SET data_waznosci = ? WHERE tenant_id=? AND id=? AND data_waznosci IS NULL`, [r.nowa_data, TENANT, r.id]);
      if (res.affectedRows) ok++;
    } catch (e) { console.error('  BŁĄD id=' + r.id + ':', e.message); err++; }
  }
  console.log(`Zaktualizowano: ${ok} | błędy: ${err}`);
  console.log(`Cofnięcie: node scripts/backfill-waznosc-wciaz-wazne.js --undo "${undoPath}"`);
  db.end();
}

(UNDO_FILE ? undo() : main()).catch(e => { console.error('BŁĄD KRYTYCZNY:', e.message); process.exit(1); });
