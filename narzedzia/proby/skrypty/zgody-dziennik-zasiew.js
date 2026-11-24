// Zasiew do próby „zmiana zgód trafia do Dziennika Zdarzeń" (salon demo-test, baza IZOLOWANA).
// Zapamiętuje obecne zgody klientki 1001 (Marta Kowalska) w pliku, żeby sprzątanie mogło je przywrócić,
// i usuwa ewentualne wcześniejsze wpisy próbne z Logi. Odmawia pracy poza estelio_test:3307.
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
setTimeout(() => { console.error('TIMEOUT zasiewu'); process.exit(1); }, 20000).unref();

(async () => {
  const [w] = await q(`SELECT id, kontakt_tel, newsletter_sms, newsletter_email, wizerunek, booksy_sms, data_podpisu, link_pdf, email_adres, email_kontaktowy, pracownik FROM rejestr_rodo WHERE tenant_id = ? AND id_klienta = ? ORDER BY utworzono_w ASC, id ASC LIMIT 1`, [T, ID]);
  if (!w) throw new Error('klientka 1001 nie ma wpisu RODO w bazie izolowanej');
  fs.writeFileSync(PLIK, JSON.stringify({ ...w, data_podpisu: w.data_podpisu ? new Date(w.data_podpisu).toISOString().slice(0, 10) : null }), 'utf8');
  const r = await q(`DELETE FROM Logi WHERE tenant_id = ? AND akcja IN ('ZMIANA ZGÓD RODO', 'ZMIANA OŚWIADCZEŃ')`, [T]);
  console.log('zasiane: ' + JSON.stringify({ zapamietane: { tel: w.kontakt_tel, sms: w.newsletter_sms, email: w.newsletter_email }, usuniete_stare_wpisy: r.affectedRows }));
  db.end(); process.exit(0);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
