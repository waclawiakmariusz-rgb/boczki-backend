// Sprzątanie po scenariuszu blogowym „Kosmetyki i liczenie” (salon demo-test, baza IZOLOWANA).
// Usuwa produkt scenariusza „Serum nawilżające 30 ml” ze Słownika i Magazynu, jego sprzedaże i zwroty,
// oraz przywraca stan żelu do endermologii (2 szt.), który scenariusz zmniejsza w inwentaryzacji.
// Wołany jako „przygotuj” i „posprzataj”. Odmawia pracy poza estelio_test:3307.
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const db = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
const T = 'demo-test';
const PRODUKT = 'Serum nawilżające 30 ml';
const ZEL = 'Żel do endermologii 5 l', ZEL_STAN = 2;   // stan wyjściowy w bazie izolowanej (2.11.2026)
setTimeout(() => { console.error('TIMEOUT sprzątania'); process.exit(1); }, 20000).unref();

(async () => {
  const wynik = {};
  wynik.sprzedaze = (await q(`DELETE FROM Sprzedaz WHERE tenant_id = ? AND zabieg LIKE ?`, [T, '%' + PRODUKT + '%'])).affectedRows;
  wynik.magazyn = (await q(`DELETE FROM Magazyn WHERE tenant_id = ? AND nazwa_produktu LIKE ?`, [T, '%' + PRODUKT + '%'])).affectedRows;
  wynik.slownik = (await q(`DELETE FROM Slownik WHERE tenant_id = ? AND model = ?`, [T, PRODUKT])).affectedRows;
  try { wynik.archiwum = (await q(`DELETE FROM Archiwum WHERE tenant_id = ? AND nazwa_produktu LIKE ?`, [T, '%' + PRODUKT + '%'])).affectedRows; } catch (e) { wynik.archiwum = 'brak tabeli'; }
  wynik.zel = (await q(`UPDATE Magazyn SET ilosc = ? WHERE tenant_id = ? AND nazwa_produktu = ?`, [ZEL_STAN, T, ZEL])).affectedRows;
  console.log('posprzątane: ' + JSON.stringify(wynik));
  db.end();
  process.exit(0);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
