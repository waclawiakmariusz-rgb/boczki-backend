// Sprzątanie po próbie „zmiana zgód trafia do Dziennika Zdarzeń": przywraca zgody klientki 1001 z pliku zasiewu
// i kasuje wpisy próbne z Logi. Tylko baza izolowana.
const path = require('path');
const fs = require('fs');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const db = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
const T = 'demo-test', ID = '1001';
const PLIK = path.join(KORZEN, 'logi', 'zgody-dziennik-stan-1001.json');
setTimeout(() => { console.error('TIMEOUT sprzątania'); process.exit(1); }, 20000).unref();

(async () => {
  let przywrocone = 0;
  if (fs.existsSync(PLIK)) {
    const w = JSON.parse(fs.readFileSync(PLIK, 'utf8'));
    const r = await q(`UPDATE rejestr_rodo SET kontakt_tel = ?, newsletter_sms = ?, newsletter_email = ?, wizerunek = ?, booksy_sms = ?, data_podpisu = ?, link_pdf = ?, email_adres = ?, email_kontaktowy = ?, pracownik = ? WHERE tenant_id = ? AND id_klienta = ?`,
      [w.kontakt_tel, w.newsletter_sms, w.newsletter_email, w.wizerunek, w.booksy_sms, w.data_podpisu, w.link_pdf, w.email_adres, w.email_kontaktowy, w.pracownik, T, ID]);
    przywrocone = r.affectedRows;
    fs.unlinkSync(PLIK);
  }
  const l = await q(`DELETE FROM Logi WHERE tenant_id = ? AND akcja IN ('ZMIANA ZGÓD RODO', 'ZMIANA OŚWIADCZEŃ')`, [T]);
  console.log('posprzątane: ' + JSON.stringify({ przywrocone_wpisy_zgod: przywrocone, usuniete_wpisy_dziennika: l.affectedRows }));
  db.end(); process.exit(0);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
