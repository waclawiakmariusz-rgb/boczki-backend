// scripts/waznosc-15x-90dni.js
// Masowa zmiana Uslugi.waznosc_dni -> 90 dla zabiegow z wariantem zawierajacym '15x'.
//   node scripts/waznosc-15x-90dni.js                 # DRY-RUN (tylko podglad)
//   node scripts/waznosc-15x-90dni.js --wet-run       # wlasciwy UPDATE
//   node scripts/waznosc-15x-90dni.js --tenant=ID     # ogranicz do jednego salonu
require('dotenv').config();
const mysql = require('mysql2');

const WET_RUN = process.argv.includes('--wet-run');
const tenantArg = (process.argv.find(a => a.startsWith('--tenant=')) || '').split('=')[1] || null;
const NOWA_WAZNOSC = 90;

function stripQuotes(v) { return (v || '').replace(/^['"]|['"]$/g, ''); }

async function main() {
  const db = mysql.createConnection({
    host:     stripQuotes(process.env.DB_HOST),
    user:     stripQuotes(process.env.DB_USER),
    password: stripQuotes(process.env.DB_PASSWORD),
    database: stripQuotes(process.env.DB_NAME),
  });
  await new Promise((res, rej) => db.connect(e => e ? rej(e) : res()));
  console.log('Tryb:   ', WET_RUN ? 'WET-RUN (zapis)' : 'DRY-RUN (podglad)');
  console.log('Baza:   ', stripQuotes(process.env.DB_NAME), '@', stripQuotes(process.env.DB_HOST));
  console.log('Filtr:  ', "LOWER(wariant) LIKE '%15x%'" + (tenantArg ? ` AND tenant_id = '${tenantArg}'` : ' (WSZYSTKIE salony)'));
  console.log('');

  const where = "LOWER(wariant) LIKE '%15x%'" + (tenantArg ? ' AND tenant_id = ?' : '');
  const params = tenantArg ? [tenantArg] : [];

  const rows = await new Promise((res, rej) =>
    db.query(`SELECT id, tenant_id, kategoria, wariant, waznosc_dni FROM Uslugi WHERE ${where} ORDER BY tenant_id, kategoria, wariant`,
      params, (e, r) => e ? rej(e) : res(r)));

  if (!rows.length) { console.log('Brak pasujacych zabiegow.'); db.end(); return; }

  const perTenant = {};
  for (const r of rows) {
    (perTenant[r.tenant_id] = perTenant[r.tenant_id] || []).push(r);
  }
  for (const t of Object.keys(perTenant)) {
    console.log(`=== ${t} (${perTenant[t].length}) ===`);
    for (const r of perTenant[t]) {
      console.log(`   ${r.kategoria} | ${r.wariant} | obecnie: ${r.waznosc_dni === null ? 'bezterminowo' : r.waznosc_dni + ' dni'} -> ${NOWA_WAZNOSC} dni`);
    }
  }
  console.log('');
  console.log(`RAZEM: ${rows.length} zabieg(ow) w ${Object.keys(perTenant).length} salonie(ach).`);

  if (WET_RUN) {
    const upd = await new Promise((res, rej) =>
      db.query(`UPDATE Uslugi SET waznosc_dni = ? WHERE ${where}`,
        [NOWA_WAZNOSC, ...params], (e, r) => e ? rej(e) : res(r)));
    console.log('');
    console.log(`>>> ZAKTUALIZOWANO: ${upd.affectedRows} wierszy (zmieniono: ${upd.changedRows}).`);
  } else {
    console.log('To byl DRY-RUN. Aby zapisac uruchom z flaga --wet-run.');
  }
  db.end();
}

main().catch(e => { console.error('BLAD:', e.message); process.exit(1); });
