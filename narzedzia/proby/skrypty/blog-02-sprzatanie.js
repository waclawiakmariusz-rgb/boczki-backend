// Sprzątanie po scenariuszu blogowym „Sprzedaż od A do Z” (salon demo-test, baza IZOLOWANA).
// Usuwa klientkę „Marta Zielińska” z jej sprzedażami, zwrotami, płatnościami i zadatkami oraz przywraca
// stan magazynowy kremu, który scenariusz sprzedaje (1 szt.). Wołany jako „przygotuj” i „posprzataj”.
// Odmawia pracy poza estelio_test:3307.
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const db = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
const T = 'demo-test';
const KLIENTKA = 'Marta Zielińska';
const PRODUKT = 'Krem regenerujący SPF 30', STAN_PRODUKTU = 6;   // stan wyjściowy w bazie izolowanej (2.11.2026)
setTimeout(() => { console.error('TIMEOUT sprzątania'); process.exit(1); }, 20000).unref();

(async () => {
  const wynik = {};
  const klientki = await q(`SELECT id_klienta FROM Klienci WHERE tenant_id = ? AND TRIM(imie_nazwisko) = ?`, [T, KLIENTKA]);
  const ids = klientki.map(k => String(k.id_klienta));
  wynik.sprzedaze = (await q(`DELETE FROM Sprzedaz WHERE tenant_id = ? AND (TRIM(klient) = ? ${ids.length ? 'OR id_klienta IN (?)' : ''})`, ids.length ? [T, KLIENTKA, ids] : [T, KLIENTKA])).affectedRows;
  wynik.platnosci = (await q(`DELETE FROM Platnosci WHERE tenant_id = ? AND TRIM(klient) = ?`, [T, KLIENTKA])).affectedRows;
  wynik.zadatki = (await q(`DELETE FROM Zadatki WHERE tenant_id = ? AND (TRIM(klient) = ? ${ids.length ? 'OR id_klienta IN (?)' : ''})`, ids.length ? [T, KLIENTKA, ids] : [T, KLIENTKA])).affectedRows;
  if (ids.length) {
    for (const tab of ['Rejestr_RODO', 'Logi_Klient', 'Klienci_Preferencje']) {
      try { await q(`DELETE FROM \`${tab}\` WHERE tenant_id = ? AND id_klienta IN (?)`, [T, ids]); } catch (e) { /* tabela może nie istnieć */ }
    }
    wynik.klientki = (await q(`DELETE FROM Klienci WHERE tenant_id = ? AND id_klienta IN (?)`, [T, ids])).affectedRows;
  } else wynik.klientki = 0;
  wynik.magazyn = (await q(`UPDATE Magazyn SET ilosc = ? WHERE tenant_id = ? AND nazwa_produktu = ?`, [STAN_PRODUKTU, T, PRODUKT])).affectedRows;
  console.log('posprzątane: ' + JSON.stringify(wynik));
  db.end();
  process.exit(0);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
