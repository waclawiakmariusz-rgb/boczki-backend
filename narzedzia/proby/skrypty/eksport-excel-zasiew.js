// narzedzia/proby/skrypty/eksport-excel-zasiew.js — przygotowanie próby „eksport do Excela” (baza IZOLOWANA, demo-test).
// Próba nic nie zasiewa (czyta gotowe widoki); zapamiętuje tylko czas bazy, żeby sprzątanie skasowało wpisy Dziennika z próby.
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
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const [[{ od }]] = await c.query(`SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS od`);
  fs.writeFileSync(STAN, JSON.stringify({ od }));
  console.log(`zasiew: wpisy Dziennika „EKSPORT DANYCH” od ${od} będą uznane za wpisy próby`);
  await c.end();
})().catch((e) => { console.error('BŁĄD zasiewu:', e.message); process.exit(1); });
