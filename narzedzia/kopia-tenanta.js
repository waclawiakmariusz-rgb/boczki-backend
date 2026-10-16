// narzedzia/kopia-tenanta.js — zasilenie IZOLOWANEJ bazy testowej danymi jednego salonu (np. demo-estelio).
//
//   Źródło: baza z `.env`        (TYLKO ODCZYT — skrypt nie wykonuje tam żadnego INSERT/UPDATE/DELETE/DDL)
//   Cel:    baza z `.env.test`   (CREATE TABLE IF NOT EXISTS wg SHOW CREATE TABLE ze źródła + INSERT wierszy salonu)
//
//   node narzedzia/kopia-tenanta.js --tenant demo-estelio --dry-run    # policz tabele/wiersze, nic nie zapisuj
//   node narzedzia/kopia-tenanta.js --tenant demo-estelio              # skopiuj (w celu najpierw DELETE wierszy tego salonu)
//   node narzedzia/kopia-tenanta.js --tenant demo-estelio --globalne   # dodatkowo tabele bez tenant_id (np. Features_Catalog)
//
// Bezpieczniki: odmowa, gdy host+baza źródła i celu są identyczne; odmowa, gdy brak .env.test; tenant tylko [A-Za-z0-9_-];
// w celu kasowane są wyłącznie wiersze `WHERE tenant_id = ?` tego salonu. Hasła nie są logowane.
const fs = require('fs'); const path = require('path');
const mysql = require('mysql2/promise');
const ROOT = path.join(__dirname, '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? (process.argv[i + 1] || true) : null; };
const TENANT = String(arg('--tenant') || 'demo-estelio'); const DRY = process.argv.includes('--dry-run'); const GLOBALNE = process.argv.includes('--globalne');
if (!/^[A-Za-z0-9_-]{1,64}$/.test(TENANT)) { console.error('Nieprawidłowy tenant'); process.exit(2); }
function envZ(plik) { if (!fs.existsSync(plik)) return null; const out = {}; for (const l of fs.readFileSync(plik, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } return out; }
(async () => {
  const src = envZ(path.join(ROOT, '.env')), dst = envZ(path.join(ROOT, '.env.test'));
  if (!src) { console.error('Brak .env (źródło)'); process.exit(2); }
  if (!dst || !dst.DB_NAME || !dst.DB_HOST) { console.error('Brak .env.test z DB_HOST/DB_NAME — to jest JEDYNA brakująca czynność: utwórz bazę testową w panelu Hostingera i wpisz ją do .env.test (szablon: .env.test.example)'); process.exit(3); }
  const same = String(src.DB_HOST).trim() === String(dst.DB_HOST).trim() && String(src.DB_NAME).trim() === String(dst.DB_NAME).trim();
  if (same) { console.error('ODMOWA: źródło i cel to ta sama baza (host+nazwa). Izolacja nie jest spełniona.'); process.exit(4); }
  const cfg = (e) => ({ host: e.DB_HOST, port: Number(e.DB_PORT || 3306), user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true });
  const s = await mysql.createConnection(cfg(src)); const d = DRY ? null : await mysql.createConnection(cfg(dst));
  console.log(`źródło: ${src.DB_HOST}/${src.DB_NAME} (odczyt) → cel: ${dst.DB_HOST}/${dst.DB_NAME} ${DRY ? '(DRY-RUN, bez zapisu)' : ''} | salon: ${TENANT}`);
  const [kol] = await s.query(`SELECT TABLE_NAME t, COLUMN_NAME c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id'`);
  const [wszystkie] = await s.query(`SELECT TABLE_NAME t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`);
  const zTenantem = [...new Set(kol.map(x => x.t))].sort(); const bez = wszystkie.map(x => x.t).filter(t => !zTenantem.includes(t)).sort();
  const POMIJANE = new Set(['Sesje', 'admin_sessions']); // sesje nie mają sensu w kopii
  let tabel = 0, wierszy = 0;
  const kopiuj = async (t, gdzie, params) => {
    const [[{ n }]] = await s.query(`SELECT COUNT(*) n FROM \`${t}\` ${gdzie}`, params);
    console.log(`  ${t}: ${n} wierszy`); tabel++; wierszy += n; if (DRY) return;
    const [[ct]] = await s.query(`SHOW CREATE TABLE \`${t}\``); const ddl = (ct['Create Table'] || '').replace(/^CREATE TABLE/i, 'CREATE TABLE IF NOT EXISTS').replace(/AUTO_INCREMENT=\d+\s*/i, '');
    await d.query(ddl);
    if (params.length) await d.query(`DELETE FROM \`${t}\` WHERE tenant_id = ?`, params);
    for (let off = 0; off < n; off += 500) {
      const [rows] = await s.query(`SELECT * FROM \`${t}\` ${gdzie} LIMIT 500 OFFSET ${off}`, params); if (!rows.length) break;
      const cols = Object.keys(rows[0]); const vals = rows.map(r => cols.map(c => r[c]));
      await d.query(`INSERT IGNORE INTO \`${t}\` (${cols.map(c => '`' + c + '`').join(',')}) VALUES ?`, [vals]);
    }
  };
  console.log(`tabele z tenant_id: ${zTenantem.length}`); for (const t of zTenantem) { if (POMIJANE.has(t)) continue; await kopiuj(t, 'WHERE tenant_id = ?', [TENANT]); }
  if (GLOBALNE) { console.log(`tabele globalne (bez tenant_id): ${bez.length}`); for (const t of bez) { if (POMIJANE.has(t)) continue; await kopiuj(t, '', []); } } else console.log(`pominięte tabele bez tenant_id (użyj --globalne): ${bez.join(', ')}`);
  console.log(`${DRY ? 'policzono' : 'skopiowano'}: ${tabel} tabel, ${wierszy} wierszy`);
  await s.end(); if (d) await d.end();
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
