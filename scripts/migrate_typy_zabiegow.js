// scripts/migrate_typy_zabiegow.js — CLI wrapper
// Uruchomienie:
//   node scripts/migrate_typy_zabiegow.js                              # dry-run wszystkie tenanty
//   node scripts/migrate_typy_zabiegow.js --tenant=demo-estelio        # dry-run jeden
//   node scripts/migrate_typy_zabiegow.js --apply --tenant=demo-estelio # zapis
//
// Logika klasyfikacji w scripts/migrate_typy_lib.js (używana też przez admin endpoint).

require('dotenv').config();
const mysql = require('mysql2');
const { migracjaTenanta, listaTenantow } = require('./migrate_typy_lib');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const tenantArg = args.find(a => a.startsWith('--tenant='));
const TENANT_FILTER = tenantArg ? tenantArg.split('=')[1] : null;

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 5
});

function formatRaport(r) {
  const lines = [];
  lines.push(`\n═══ TENANT: ${r.tenant_id} ═══`);
  lines.push(`\n📋 Uslugi (cennik): ${r.uslugi.total} rekordów do zaktualizowania`);
  Object.entries(r.uslugi.perTyp)
    .sort((a, b) => b[1] - a[1])
    .forEach(([typ, n]) => lines.push(`   • ${typ.padEnd(25)} ${n}`));
  lines.push(`\n💰 Sprzedaz (historia): ${r.sprzedaz.total} rekordów do zaktualizowania`);
  Object.entries(r.sprzedaz.perTyp)
    .sort((a, b) => b[1] - a[1])
    .forEach(([typ, n]) => lines.push(`   • ${typ.padEnd(25)} ${n}`));
  return lines.join('\n');
}

(async () => {
  try {
    console.log(`\n${APPLY ? '⚙️  TRYB: APPLY (zapis do bazy)' : '🔍 TRYB: DRY-RUN (tylko raport)'}`);
    if (TENANT_FILTER) console.log(`🎯 Filtr tenant: ${TENANT_FILTER}`);

    const tenanty = TENANT_FILTER
      ? [TENANT_FILTER]
      : await listaTenantow(db);

    if (!tenanty.length) {
      console.log('\nBrak tenantów do migracji.');
      db.end();
      return;
    }

    console.log(`\n${tenanty.length} tenant(ów) do przetworzenia...\n`);

    const wszystkieRaporty = [];
    for (const tenant_id of tenanty) {
      try {
        const r = await migracjaTenanta(db, tenant_id, { apply: APPLY });
        wszystkieRaporty.push(r);
        console.log(formatRaport(r));
      } catch (e) {
        console.error(`\n✗ Błąd dla tenant=${tenant_id}:`, e.message);
      }
    }

    // ── PODSUMOWANIE ──
    console.log('\n\n═══════ PODSUMOWANIE ═══════');
    const sum = (key) => wszystkieRaporty.reduce((acc, r) => {
      Object.entries(r[key].perTyp).forEach(([typ, n]) => {
        acc[typ] = (acc[typ] || 0) + n;
      });
      return acc;
    }, {});
    const sumU = sum('uslugi');
    const sumS = sum('sprzedaz');
    const totU = Object.values(sumU).reduce((a, b) => a + b, 0);
    const totS = Object.values(sumS).reduce((a, b) => a + b, 0);
    console.log(`\nUslugi razem: ${totU}`);
    Object.entries(sumU).sort((a, b) => b[1] - a[1])
      .forEach(([typ, n]) => console.log(`  • ${typ.padEnd(25)} ${n}  (${totU > 0 ? (n / totU * 100).toFixed(1) : 0}%)`));
    console.log(`\nSprzedaz razem: ${totS}`);
    Object.entries(sumS).sort((a, b) => b[1] - a[1])
      .forEach(([typ, n]) => console.log(`  • ${typ.padEnd(25)} ${n}  (${totS > 0 ? (n / totS * 100).toFixed(1) : 0}%)`));

    if (!APPLY) {
      console.log('\n\n⚠️  To był DRY-RUN — żadne zmiany nie zostały zapisane.');
      console.log('Aby zastosować zmiany, uruchom z flagą --apply (po backupie SQL).');
    } else {
      console.log('\n\n✅ Zmiany zapisane w bazie.');
    }
  } catch (e) {
    console.error('\n✗ Błąd główny:', e.message);
    process.exit(1);
  } finally {
    db.end();
  }
})();
