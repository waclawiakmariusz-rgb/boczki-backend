// scripts/booksy-db-test.js — test upsert/odwołania/zapytania na sztucznym tenant_id (sprząta po sobie).
require('dotenv').config();
const mysql = require('mysql2');
const db = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  waitForConnections: true, connectionLimit: 3
});
const T = 'TEST-BOOKSY-ZZZ';
function q(sql, p) { return new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r))); }
(async () => {
  try {
    await q(`CREATE TABLE IF NOT EXISTS WizytyBooksy (
       id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, slot_key VARCHAR(200) NOT NULL,
       klient VARCHAR(200), telefon VARCHAR(40), email VARCHAR(200), data_wizyty DATE,
       godz_od VARCHAR(10), godz_do VARCHAR(10), zabieg VARCHAR(300), pracownik VARCHAR(200),
       status VARCHAR(20) NOT NULL DEFAULT 'zapisana', zrodlo_uid INT, updated_at DATETIME NOT NULL,
       UNIQUE KEY uniq_slot (tenant_id, slot_key), INDEX idx_dzien (tenant_id, data_wizyty, status))`);
    await q(`DELETE FROM WizytyBooksy WHERE tenant_id=?`, [T]);
    const today = new Date().toISOString().slice(0, 10);
    const slot = today + ' 10:00 julia testowa';
    const ins = `INSERT INTO WizytyBooksy (tenant_id,slot_key,klient,telefon,email,data_wizyty,godz_od,godz_do,zabieg,pracownik,status,zrodlo_uid,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'zapisana',?,NOW())
      ON DUPLICATE KEY UPDATE klient=COALESCE(NULLIF(VALUES(klient),''),klient), telefon=COALESCE(NULLIF(VALUES(telefon),''),telefon),
        email=COALESCE(NULLIF(VALUES(email),''),email), godz_do=COALESCE(NULLIF(VALUES(godz_do),''),godz_do),
        zabieg=COALESCE(NULLIF(VALUES(zabieg),''),zabieg), pracownik=COALESCE(NULLIF(VALUES(pracownik),''),pracownik),
        status='zapisana', updated_at=NOW()`;
    await q(ins, [T, slot, 'Anna Testowa', '111 222 333', '', today, '10:00', '10:45', 'Zabieg X', 'Julia Testowa', 1]);
    await q(ins, [T, slot, 'Anna Testowa', '', 'anna@x.pl', today, '10:00', '', '', 'Julia Testowa', 2]);
    let rows = await q(`SELECT klient,telefon,email,zabieg,godz_do,status FROM WizytyBooksy WHERE tenant_id=? AND slot_key=?`, [T, slot]);
    console.log('Po upsert (zachowanie danych):', JSON.stringify(rows[0]));
    await q(`UPDATE WizytyBooksy SET status='odwolana', updated_at=NOW() WHERE tenant_id=? AND slot_key=?`, [T, slot]);
    rows = await q(`SELECT slot_key,status FROM WizytyBooksy WHERE tenant_id=? AND data_wizyty=CURDATE() AND status='zapisana' ORDER BY godz_od`, [T]);
    console.log('booksy_dzis (zapisana) liczba:', rows.length, '(oczekiwane 0 po odwolaniu)');
    await q(`DELETE FROM WizytyBooksy WHERE tenant_id=?`, [T]);
    console.log('Sprzatniete. OK.');
    process.exit(0);
  } catch (e) { console.error('TEST BLAD:', e.message); process.exit(1); }
})();
