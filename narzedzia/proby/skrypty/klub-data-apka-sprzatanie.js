// narzedzia/proby/skrypty/klub-data-apka-sprzatanie.js — sprzątanie po próbie „data resetu w aplikacji klientki” (baza IZOLOWANA, demo-test).
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2', 'promise'));
const T = 'demo-test', K = '1001', KTO = 'PROBA-RESET';
const STAN = path.join(os.tmpdir(), 'estelio-proba-klub-data-apka.json');
(async () => {
  const stan = fs.existsSync(STAN) ? JSON.parse(fs.readFileSync(STAN, 'utf8')) : { przed: null };
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const q = (s, p = []) => c.query(s, p).then(([r]) => r);
  const konta = (await q(`DELETE FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ?`, [T, K])).affectedRows;
  const punkty = (await q(`DELETE FROM Lojalnosc_Punkty WHERE tenant_id = ? AND pracownik = ?`, [T, KTO])).affectedRows;
  const p = stan.przed || { reset_roczny: 0, nastepny_reset: null, ostatni_reset_rok: 0, reset_zmienil: '', reset_zmieniono: null };
  await q(`UPDATE Lojalnosc_Ustawienia SET reset_roczny = ?, nastepny_reset = ?, ostatni_reset_rok = ?, reset_zmienil = ?, reset_zmieniono = ? WHERE tenant_id = ?`,
    [Number(p.reset_roczny) || 0, p.nastepny_reset ? String(p.nastepny_reset).slice(0, 10) : null, Number(p.ostatni_reset_rok) || 0, p.reset_zmienil || '', p.reset_zmieniono ? new Date(p.reset_zmieniono) : null, T]);
  const po = (await q(`SELECT reset_roczny, nastepny_reset, reset_zmienil FROM Lojalnosc_Ustawienia WHERE tenant_id = ?`, [T]))[0];
  console.log(`sprzątanie: konto 1001 usunięte (${konta}), punkty próby usunięte (${punkty}); ustawienia resetu przywrócone: ${JSON.stringify(po)}`);
  if (fs.existsSync(STAN)) fs.unlinkSync(STAN);
  await c.end();
})().catch((e) => { console.error('BŁĄD sprzątania:', e.message); process.exit(1); });
