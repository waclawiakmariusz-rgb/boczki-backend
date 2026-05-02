// scripts/clone_to_demo.js — CLI wrapper
// Uruchomienie: node scripts/clone_to_demo.js [--force]
//
// Logika klonowania w scripts/clone_to_demo_lib.js (używana też przez admin endpoint).

require('dotenv').config();
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
const { cloneBoczkiToDemo } = require('./clone_to_demo_lib');

const FORCE = process.argv.includes('--force');

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

(async () => {
  try {
    const result = await cloneBoczkiToDemo(db, { force: FORCE });

    if (result.status === 'success') {
      console.log('\n═══ RAPORT ═══');
      console.log('Tenant:', result.credentials.tenant_id);
      console.log('Salon:', result.credentials.salon);
      console.log(`\nLogin admin: ${result.credentials.admin_login}`);
      console.log(`Hasło admin: ${result.credentials.admin_haslo}`);
      console.log('\nPracownicy (PIN-y):');
      result.credentials.pracownicy.forEach(p => {
        console.log(`  ${p.imie.padEnd(12)} (${p.rola.padEnd(13)}) → PIN: ${p.pin}`);
      });
      console.log('\nSkopiowano:', JSON.stringify(result.stats, null, 2));

      fs.writeFileSync(path.join(__dirname, 'demo_clone_log.txt'), result.log.join('\n'), 'utf8');
      console.log('\nRaport: scripts/demo_clone_log.txt');
    } else {
      console.error('\n✗ BŁĄD:', result.message);
      process.exit(1);
    }
  } catch (err) {
    console.error('\n✗ EXCEPTION:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    db.end();
  }
})();
