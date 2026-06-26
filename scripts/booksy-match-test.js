// scripts/booksy-match-test.js — test kojarzenia wizyty Booksy z kartoteką Estelio (telefon + nazwa). Sprząta po sobie.
require('dotenv').config();
const mysql = require('mysql2');
const db = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 2
});
const T = 'boczki-salon-glowny-001';
function q(sql, p) { return new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r))); }
(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Wstaw 3 wizyty testowe: po telefonie (Sonia 791 222 005), po nazwie, i spoza bazy.
    const ins = `INSERT INTO WizytyBooksy (tenant_id,slot_key,klient,telefon,email,data_wizyty,godz_od,godz_do,zabieg,pracownik,status,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'zapisana',NOW()) ON DUPLICATE KEY UPDATE updated_at=NOW()`;
    await q(ins, [T, today + ' TEST1', 'Sonia Inna Pisownia', '791 222 005', '', today, '09:00', '09:45', 'Test tel', 'Julia', null]);
    await q(ins, [T, today + ' TEST2', 'Maria Andrzejkowicz', '000000000', '', today, '10:00', '10:30', 'Test nazwa', 'Julia', null]);
    await q(ins, [T, today + ' TEST3', 'Ktoś Zupełnie Nowy', '111111111', '', today, '11:00', '11:30', 'Test obcy', 'Julia', null]);

    const rows = await q(
      `SELECT w.klient, w.telefon,
         (SELECT k.id_klienta FROM Klienci k WHERE k.tenant_id=w.tenant_id AND w.telefon<>''
            AND LENGTH(REGEXP_REPLACE(k.telefon,'[^0-9]',''))>=9
            AND RIGHT(REGEXP_REPLACE(k.telefon,'[^0-9]',''),9)=RIGHT(REGEXP_REPLACE(w.telefon,'[^0-9]',''),9) LIMIT 1) AS id_tel,
         (SELECT k.id_klienta FROM Klienci k WHERE k.tenant_id=w.tenant_id AND w.klient<>''
            AND LOWER(TRIM(k.imie_nazwisko))=LOWER(TRIM(w.klient)) LIMIT 1) AS id_nazwa
       FROM WizytyBooksy w WHERE w.tenant_id=? AND w.data_wizyty=? AND w.slot_key LIKE '% TEST%' ORDER BY w.godz_od`,
      [T, today]
    );
    rows.forEach(r => {
      const id = (r.id_tel != null ? String(r.id_tel) : '') || (r.id_nazwa != null ? String(r.id_nazwa) : '');
      const jak = r.id_tel != null ? 'telefon' : (r.id_nazwa != null ? 'nazwa' : 'BRAK');
      console.log(`${r.klient} (${r.telefon}) -> id=${id || '—'} [${jak}]`);
    });

    await q(`DELETE FROM WizytyBooksy WHERE tenant_id=? AND slot_key LIKE ?`, [T, today + ' TEST%']);
    console.log('Sprzatniete. OK.');
    process.exit(0);
  } catch (e) { console.error('TEST BLAD:', e.message); process.exit(1); }
})();
