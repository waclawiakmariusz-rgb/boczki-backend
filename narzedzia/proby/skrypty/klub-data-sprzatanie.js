// narzedzia/proby/skrypty/klub-data-sprzatanie.js — sprzątanie po próbie „data resetu punktów Klubu” (baza IZOLOWANA, salon demo-test).
// Przywraca ustawienia resetu sprzed próby i kasuje tylko wpisy Dziennika dopisane przez próbę (id > zapamiętanego).
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
  const stan = fs.existsSync(STAN) ? JSON.parse(fs.readFileSync(STAN, 'utf8')) : { od: null, przed: null };
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const q = (s, p = []) => c.query(s, p).then(([r]) => r);
  let skasowane = 0;
  if (stan.od) {
    const r = await q(`DELETE FROM Logi WHERE tenant_id = ? AND data_zdarzenia >= ? AND akcja IN ('KLUB DATA RESETU', 'KLUB USTAWIENIA')`, [T, stan.od]);
    skasowane = r.affectedRows;
  }
  const p = stan.przed || { reset_roczny: 0, nastepny_reset: null, ostatni_reset_rok: 0, reset_zmienil: '', reset_zmieniono: null };
  await q(`UPDATE Lojalnosc_Ustawienia SET reset_roczny = ?, nastepny_reset = ?, ostatni_reset_rok = ?, reset_zmienil = ?, reset_zmieniono = ? WHERE tenant_id = ?`,
    [Number(p.reset_roczny) || 0, p.nastepny_reset ? String(p.nastepny_reset).slice(0, 10) : null, Number(p.ostatni_reset_rok) || 0, p.reset_zmienil || '', p.reset_zmieniono ? new Date(p.reset_zmieniono) : null, T]);
  const po = (await q(`SELECT reset_roczny, nastepny_reset, reset_zmienil FROM Lojalnosc_Ustawienia WHERE tenant_id = ?`, [T]))[0];
  console.log(`sprzątanie: wpisy Dziennika z próby skasowane: ${skasowane}; ustawienia resetu przywrócone: ${JSON.stringify(po)}`);
  if (fs.existsSync(STAN)) fs.unlinkSync(STAN);
  await c.end();
})().catch((e) => { console.error('BŁĄD sprzątania:', e.message); process.exit(1); });
