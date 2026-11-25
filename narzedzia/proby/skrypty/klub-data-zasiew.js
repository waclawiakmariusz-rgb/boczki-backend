// narzedzia/proby/skrypty/klub-data-zasiew.js — przygotowanie próby „data resetu punktów Klubu” (baza IZOLOWANA, salon demo-test).
// Zapamiętuje najwyższe id w Logi (sprzątanie skasuje tylko wpisy dopisane przez próbę) i zaczyna od resetu wyłączonego.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2', 'promise'));
const T = 'demo-test';
const STAN = path.join(os.tmpdir(), 'estelio-proba-klub-data-resetu.json');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const q = (s, p = []) => c.query(s, p).then(([r]) => r);
  // Logi.id to UUID, więc granicę próby wyznacza czas bazy, nie numer wiersza.
  const [{ od }] = await q(`SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS od`);
  const przed = (await q(`SELECT reset_roczny, nastepny_reset, ostatni_reset_rok, reset_zmienil, reset_zmieniono FROM Lojalnosc_Ustawienia WHERE tenant_id = ?`, [T]))[0] || null;
  fs.writeFileSync(STAN, JSON.stringify({ od, przed }));
  await q(`UPDATE Lojalnosc_Ustawienia SET reset_roczny = 0, nastepny_reset = NULL, reset_zmienil = '', reset_zmieniono = NULL WHERE tenant_id = ?`, [T]);
  console.log(`zasiew: reset demo-test wyłączony; wpisy Dziennika od ${od} będą uznane za wpisy próby; stan zapisany w ${STAN}`);
  await c.end();
})().catch((e) => { console.error('BŁĄD zasiewu:', e.message); process.exit(1); });
