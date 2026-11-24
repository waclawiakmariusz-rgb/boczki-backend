// Zasiew do próby ticketu #32 „Retencja: zgoda na telefon LUB SMS" (salon demo-test, baza IZOLOWANA).
// Dosiewa zgody RODO klientkom z historią wizyt tak, żeby na liście były trzy przypadki:
// tylko telefon, tylko SMS, obie zgody. Wszystkie wpisy mają pracownika „PROBA-RETENCJA-32",
// więc sprzątanie jest jednoznaczne. Odmawia pracy poza estelio_test:3307.
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const { randomUUID } = require('crypto');
const db = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
const T = 'demo-test';
const ZNACZNIK = 'PROBA-RETENCJA-32';
setTimeout(() => { console.error('TIMEOUT zasiewu'); process.exit(1); }, 20000).unref();

(async () => {
  await q('DELETE FROM rejestr_rodo WHERE tenant_id = ? AND pracownik = ?', [T, ZNACZNIK]);
  await q('DELETE FROM Retencja WHERE tenant_id = ? AND pracownik = ?', [T, ZNACZNIK]);

  // klientki z co najmniej dwiema wizytami (nie kosmetyk), bez wpisu zgody; „po terminie” zapewnia dataSymulowana w próbie
  const kandydaci = await q(
    `SELECT K.id_klienta, K.imie_nazwisko, COUNT(S.id) AS wizyt, MAX(S.data_sprzedazy) AS ostatnia
       FROM Klienci K
       JOIN Sprzedaz S ON S.tenant_id = K.tenant_id AND S.id_klienta = K.id_klienta
      WHERE K.tenant_id = ? AND (K.status IS NULL OR K.status = 'AKTYWNY')
        AND LOWER(S.zabieg) NOT LIKE '%kosmetyk%'
        AND NOT EXISTS (SELECT 1 FROM rejestr_rodo R WHERE R.tenant_id = K.tenant_id AND R.id_klienta = K.id_klienta)
      GROUP BY K.id_klienta, K.imie_nazwisko
      HAVING wizyt >= 2
      ORDER BY ostatnia DESC
      LIMIT 6`,
    [T]
  );

  const WZOR = [['TAK', 'NIE', 'tylko telefon'], ['NIE', 'TAK', 'tylko SMS'], ['TAK', 'TAK', 'telefon i SMS']];
  const zasiane = [];
  for (let i = 0; i < kandydaci.length; i++) {
    const k = kandydaci[i]; const [tel, sms, opis] = WZOR[i % 3];
    await q(
      `INSERT INTO rejestr_rodo (id, tenant_id, klient, data_podpisu, wizerunek, newsletter_sms, kontakt_tel,
                                 newsletter_email, booksy_sms, id_klienta, pracownik)
       VALUES (?, ?, ?, CURDATE(), 'NIE', ?, ?, 'NIE', 'NIE', ?, ?)`,
      [randomUUID(), T, k.imie_nazwisko, sms, tel, k.id_klienta, ZNACZNIK]
    );
    zasiane.push({ id: k.id_klienta, kto: k.imie_nazwisko, zgoda: opis, ostatnia: String(k.ostatnia).slice(0, 10) });
  }
  console.log('zasiane: ' + JSON.stringify(zasiane));
  db.end();
  process.exit(0);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
