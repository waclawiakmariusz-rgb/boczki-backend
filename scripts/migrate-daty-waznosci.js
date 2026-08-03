// scripts/migrate-daty-waznosci.js
// Migracja dat ważności z multiplik.xlsx (arkusz Raport_Magazyn, kolumny C i L)
// do tabeli Raport_Magazyn w bazie MySQL.
//
// Reguły:
//   - Dopasowanie po nazwie (case-insensitive, trim)
//   - UPDATE tylko gdy data_waznosci jest NULL / pusta — nie nadpisuje istniejących
//   - Jeśli w bazie są DUBLETY tej samej nazwy → pomijamy (oba)
//   - Importujemy WSZYSTKIE daty, też przeszłe (przeterminowane = do utylizacji)
//
// Użycie:
//   node scripts/migrate-daty-waznosci.js                 # DRY-RUN (domyślnie)
//   node scripts/migrate-daty-waznosci.js --wet-run       # właściwa migracja
//
// Środowisko:
//   - Czyta DB_HOST, DB_USER, DB_PASSWORD, DB_NAME z .env
//   - Plik xlsx: ./multiplik.xlsx, arkusz Raport_Magazyn
//   - Tenant docelowy: hardcoded boczki-salon-glowny-001

require('dotenv').config();
const XLSX = require('xlsx');
const mysql = require('mysql2');

const XLSX_FILE  = 'multiplik.xlsx';
const SHEET_NAME = 'Raport_Magazyn';
const TENANT_ID  = 'boczki-salon-glowny-001';
const WET_RUN    = process.argv.includes('--wet-run');

function stripQuotes(v) { return (v || '').replace(/^['"]|['"]$/g, ''); }

function normName(s) {
  return String(s || '').trim().toLowerCase();
}

function toMySQLDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function main() {
  console.log('==========================================');
  console.log('Migracja dat ważności — Raport_Magazyn');
  console.log('==========================================');
  console.log('Tryb:        ', WET_RUN ? '[31mWET-RUN (zapisuje do bazy)[0m' : '[32mDRY-RUN (bez zmian)[0m');
  console.log('Plik xlsx:   ', XLSX_FILE);
  console.log('Arkusz:      ', SHEET_NAME);
  console.log('Tenant:      ', TENANT_ID);
  console.log('');

  // ── 1. Wczytaj xlsx ─────────────────────────────────────────
  const wb = XLSX.readFile(XLSX_FILE, { cellDates: true });
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) {
    console.error('BŁĄD: arkusz "' + SHEET_NAME + '" nie istnieje. Dostępne:', wb.SheetNames.join(', '));
    process.exit(1);
  }
  const range = XLSX.utils.decode_range(sheet['!ref']);

  // Zbierz pary (nazwa, data) z wszystkich wierszy gdzie L niepuste
  const excelRows = [];
  for (let r = 1; r <= range.e.r; r++) {
    const cellC = sheet['C' + (r + 1)];
    const cellL = sheet['L' + (r + 1)];
    if (!cellL || cellL.v === '' || cellL.v == null) continue;
    if (!cellC || cellC.v === '' || cellC.v == null) continue;
    const nazwa = String(cellC.v).trim();
    const data  = toMySQLDate(cellL.v);
    if (!nazwa || !data) continue;
    excelRows.push({ wiersz: r + 1, nazwa, data });
  }
  console.log('Wierszy z datą w xlsx:', excelRows.length, '(z', range.e.r, 'wszystkich)');
  console.log('');

  // ── 2. Połącz z bazą ────────────────────────────────────────
  const db = mysql.createConnection({
    host:     stripQuotes(process.env.DB_HOST),
    user:     stripQuotes(process.env.DB_USER),
    password: stripQuotes(process.env.DB_PASSWORD),
    database: stripQuotes(process.env.DB_NAME),
  });

  await new Promise((resolve, reject) => db.connect(err => err ? reject(err) : resolve()));
  console.log('Połączono z bazą:', stripQuotes(process.env.DB_NAME), '@', stripQuotes(process.env.DB_HOST));
  console.log('');

  // ── 3. Pobierz produkty z bazy dla tego tenanta ──────────────
  const rows = await new Promise((resolve, reject) =>
    db.query(
      'SELECT id, nazwa, data_waznosci FROM Raport_Magazyn WHERE tenant_id = ?',
      [TENANT_ID],
      (err, res) => err ? reject(err) : resolve(res)
    )
  );
  console.log('Produktów w bazie dla', TENANT_ID + ':', rows.length);
  console.log('');

  // Indeksuj po znormalizowanej nazwie — buduj mapę: name → [rows...]
  const byName = new Map();
  rows.forEach(r => {
    const k = normName(r.nazwa);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(r);
  });

  // ── 4. Iteruj po wierszach excel i klasyfikuj ───────────────
  const akcje = {
    update:        [],  // [{id, nazwa, dataNowa}]
    juzMaDate:     [],  // [{nazwa, dataObecna, dataXlsx}]
    dublet:        [],  // [{nazwa, ileWBazie}]
    brakWBazie:    [],  // [{nazwa, dataXlsx}]
  };

  excelRows.forEach(({ nazwa, data }) => {
    const k = normName(nazwa);
    const matches = byName.get(k) || [];

    if (matches.length === 0) {
      akcje.brakWBazie.push({ nazwa, data });
      return;
    }
    if (matches.length > 1) {
      akcje.dublet.push({ nazwa, ileWBazie: matches.length });
      return;
    }
    const baza = matches[0];
    const obecna = baza.data_waznosci;
    if (obecna && String(obecna).trim() !== '' && String(obecna).trim() !== '0000-00-00') {
      const obecnaStr = obecna instanceof Date ? obecna.toISOString().slice(0, 10) : String(obecna).slice(0, 10);
      akcje.juzMaDate.push({ nazwa, dataObecna: obecnaStr, dataXlsx: data });
      return;
    }
    akcje.update.push({ id: baza.id, nazwa, dataNowa: data });
  });

  // ── 5. Raport ─────────────────────────────────────────────────
  console.log('=== RAPORT KLASYFIKACJI ===');
  console.log('  Do UPDATE (brak daty w bazie):', akcje.update.length);
  console.log('  POMINIĘTE (już ma datę):     ', akcje.juzMaDate.length);
  console.log('  POMINIĘTE (dublet w bazie):  ', akcje.dublet.length);
  console.log('  BRAK W BAZIE (nazwa nie pasuje):', akcje.brakWBazie.length);
  console.log('');

  if (akcje.update.length) {
    console.log('--- DO UPDATE (' + akcje.update.length + ') ---');
    akcje.update.slice(0, 10).forEach(a =>
      console.log('  ' + a.nazwa.padEnd(45) + ' → ' + a.dataNowa)
    );
    if (akcje.update.length > 10) console.log('  ... (+' + (akcje.update.length - 10) + ' więcej)');
    console.log('');
  }
  if (akcje.juzMaDate.length) {
    console.log('--- JUŻ MA DATĘ (' + akcje.juzMaDate.length + ', NIE nadpisuję) ---');
    akcje.juzMaDate.slice(0, 5).forEach(a =>
      console.log('  ' + a.nazwa.padEnd(45) + ' baza:' + a.dataObecna + ' xlsx:' + a.dataXlsx)
    );
    if (akcje.juzMaDate.length > 5) console.log('  ... (+' + (akcje.juzMaDate.length - 5) + ' więcej)');
    console.log('');
  }
  if (akcje.dublet.length) {
    console.log('--- DUBLETY W BAZIE (' + akcje.dublet.length + ', POMIJAM) ---');
    akcje.dublet.forEach(a =>
      console.log('  ' + a.nazwa.padEnd(45) + ' (' + a.ileWBazie + 'x w bazie)')
    );
    console.log('');
  }
  if (akcje.brakWBazie.length) {
    console.log('--- BRAK W BAZIE (' + akcje.brakWBazie.length + ', NIE wstawiam) ---');
    akcje.brakWBazie.slice(0, 20).forEach(a =>
      console.log('  ' + a.nazwa.padEnd(45) + ' (xlsx data: ' + a.data + ')')
    );
    if (akcje.brakWBazie.length > 20) console.log('  ... (+' + (akcje.brakWBazie.length - 20) + ' więcej)');
    console.log('');
  }

  // ── 6. WET-RUN: właściwy UPDATE ────────────────────────────
  if (!WET_RUN) {
    console.log('[33mDRY-RUN — żadne zmiany NIE zostały zapisane.[0m');
    console.log('Aby wykonać migrację: node scripts/migrate-daty-waznosci.js --wet-run');
    db.end();
    return;
  }

  if (akcje.update.length === 0) {
    console.log('Nic do zaktualizowania. Koniec.');
    db.end();
    return;
  }

  console.log('[31mWET-RUN — wykonuję ' + akcje.update.length + ' UPDATE-ów...[0m');
  let ok = 0, err = 0;
  for (const a of akcje.update) {
    try {
      await new Promise((resolve, reject) =>
        db.query(
          'UPDATE Raport_Magazyn SET data_waznosci = ? WHERE id = ? AND tenant_id = ? AND (data_waznosci IS NULL OR data_waznosci = \'\' OR data_waznosci = \'0000-00-00\')',
          [a.dataNowa, a.id, TENANT_ID],
          (e, res) => e ? reject(e) : resolve(res)
        )
      );
      ok++;
    } catch (e) {
      console.error('  BŁĄD UPDATE id=' + a.id + ' (' + a.nazwa + '):', e.message);
      err++;
    }
  }
  console.log('');
  console.log('[32mZakończono.[0m');
  console.log('  Udane UPDATE: ' + ok);
  console.log('  Błędne UPDATE:' + err);
  db.end();
}

main().catch(e => {
  console.error('[31mBŁĄD KRYTYCZNY:[0m', e.message);
  console.error(e.stack);
  process.exit(1);
});
