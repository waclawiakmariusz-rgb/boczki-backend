// narzedzia/proby/skrypty/eksport-excel-sprzatanie.js — sprzątanie po próbie „eksport do Excela” (baza IZOLOWANA, demo-test).
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2', 'promise'));
const STAN = path.join(os.tmpdir(), 'estelio-proba-eksport-excel.json');
(async () => {
  const stan = fs.existsSync(STAN) ? JSON.parse(fs.readFileSync(STAN, 'utf8')) : { od: null };
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true });
  let skasowane = 0;
  if (stan.od) {
    const [wpisy] = await c.query(`SELECT pracownik, opis FROM Logi WHERE tenant_id = 'demo-test' AND akcja = 'EKSPORT DANYCH' AND data_zdarzenia >= ? ORDER BY data_zdarzenia`, [stan.od]);
    for (const w of wpisy) console.log('  wpis próby:', w.pracownik, '—', String(w.opis).slice(0, 220));
    const [r] = await c.query(`DELETE FROM Logi WHERE tenant_id = 'demo-test' AND akcja = 'EKSPORT DANYCH' AND data_zdarzenia >= ?`, [stan.od]);
    skasowane = r.affectedRows;
  }
  console.log(`sprzątanie: wpisy Dziennika z próby skasowane: ${skasowane}`);
  if (fs.existsSync(STAN)) fs.unlinkSync(STAN);
  await c.end();
})().catch((e) => { console.error('BŁĄD sprzątania:', e.message); process.exit(1); });
