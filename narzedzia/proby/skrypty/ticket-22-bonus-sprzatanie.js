// Przygotowanie / sprzątanie próby ticketu #22 (bonus powitalny przy aktywacji kodem) — salon demo-test, baza IZOLOWANA.
// `przygotuj`: usuwa konto Klubu, punkty i kody klientki 1001 (Marta Kowalska, 601 200 301) i wstawia kod aktywacyjny PRB1 (6 h).
// `posprzataj`: wypisuje DOWÓD (konto, wpis BONUS z ref KOD@1001) i usuwa wszystko po próbie.
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const db = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, charset: 'utf8mb4' });
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
const T = 'demo-test', K = '1001', TEL = '601200301', KOD = 'PRB1';
const ETAP = process.argv[2] || 'przygotuj';
setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 20000).unref();

(async () => {
  const wynik = {};
  if (ETAP === 'posprzataj') {
    wynik.dowod_konto = (await q(`SELECT id_klienta, status, telefon, created_at FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ?`, [T, K]))[0] || 'brak';
    wynik.dowod_punkty = await q(`SELECT zmiana, powod, zrodlo, ref_id, pracownik FROM Lojalnosc_Punkty WHERE tenant_id = ? AND id_klienta = ? ORDER BY id`, [T, K]);
    wynik.dowod_log = (await q(`SELECT akcja, opis FROM Logi WHERE tenant_id = ? AND akcja = 'KLUB AKTYWACJA KODEM' ORDER BY data_zdarzenia DESC LIMIT 1`, [T]))[0] || 'brak';
  }
  wynik.konta = (await q(`DELETE FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ?`, [T, K])).affectedRows;
  wynik.punkty = (await q(`DELETE FROM Lojalnosc_Punkty WHERE tenant_id = ? AND id_klienta = ?`, [T, K])).affectedRows;
  wynik.kody = (await q(`DELETE FROM Lojalnosc_Kody WHERE tenant_id = ? AND id_klienta = ?`, [T, K])).affectedRows;
  wynik.wnioski = (await q(`DELETE FROM Lojalnosc_Wnioski WHERE tenant_id = ? AND id_klienta = ?`, [T, K])).affectedRows;
  if (ETAP === 'przygotuj') {
    await q(`INSERT INTO Lojalnosc_Kody (tenant_id, id_klienta, kod, telefon, status, proby, expires_at, utworzyl) VALUES (?, ?, ?, ?, 'NOWY', 0, DATE_ADD(NOW(), INTERVAL 6 HOUR), 'próba')`, [T, K, KOD, TEL]);
    wynik.kod = KOD;
    wynik.bonus_ustawienia = ((await q(`SELECT bonus_powitalny_pkt FROM Lojalnosc_Ustawienia WHERE tenant_id = ?`, [T]))[0] || {}).bonus_powitalny_pkt;
  }
  console.log((ETAP === 'przygotuj' ? 'przygotowane: ' : 'posprzątane: ') + JSON.stringify(wynik));
  db.end();
  process.exit(0);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
