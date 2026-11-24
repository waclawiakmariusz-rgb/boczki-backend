// Sprzątanie po próbie ticketu #32 — kasuje tylko wpisy ze znacznikiem „PROBA-RETENCJA-32". Tylko baza izolowana.
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const db = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
const T = 'demo-test', ZNACZNIK = 'PROBA-RETENCJA-32';
setTimeout(() => { console.error('TIMEOUT sprzątania'); process.exit(1); }, 20000).unref();
(async () => {
  const a = await q('DELETE FROM rejestr_rodo WHERE tenant_id = ? AND pracownik = ?', [T, ZNACZNIK]);
  const b = await q('DELETE FROM Retencja WHERE tenant_id = ? AND pracownik = ?', [T, ZNACZNIK]);
  console.log('posprzątane: ' + JSON.stringify({ zgody: a.affectedRows, notatki: b.affectedRows }));
  db.end(); process.exit(0);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
