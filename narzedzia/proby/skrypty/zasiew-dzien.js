// Zasiew jednego dnia demonstracyjnego w Terminarzu (salon demo-test, baza IZOLOWANA) — do zrzutów przewodnika i prób.
// Wołany przez proba-ekranu.js jako "przygotuj" (env DZIEN_PRZESUN = ile dni od dziś; scenariusze używają TRM.idz(N) z tym samym N)
// i "posprzataj" (--usun). Odmawia pracy poza estelio_test:3307.
// Wszystkie wiersze mają zrodlo = 'DEMO-DZIEN' → czyszczenie: node zasiew-dzien.js --usun
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test') });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const db = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const T = 'demo-test';
const ZRODLO = 'DEMO-DZIEN';
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));

const d = new Date();
d.setDate(d.getDate() + Number(process.env.DZIEN_PRZESUN || 0));
const DZIS = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const ts = (g) => DZIS + ' ' + g + ':00';

// [godz_od, godz_do, pracownik, usluga_id, id_klienta, stan pozycji, obecnosc, status rezerwacji, notatka]
const DZIEN = [
  ['09:00', '10:00', 'Anna', 'DEMO-U-A', '1001', 'zaplanowana', 'przybyl', 'potwierdzona', null],
  ['09:30', '10:20', 'Ola', 'DEMO-U-OX', '1006', 'wykonana', 'przybyl', 'potwierdzona', null],
  ['10:30', '11:20', 'Anna', 'DEMO-U-MEZ', '1002', 'wykonana', 'przybyl', 'potwierdzona', null],
  ['11:00', '11:45', 'Ola', 'DEMO-U-FAL', '1001', 'anulowana', 'oczekiwana', 'anulowana', null],
  ['12:00', '12:30', 'Anna', 'DEMO-U-DEP', '1003', 'wykonana', 'przybyl', 'potwierdzona', null],
  ['13:00', '14:00', 'Ola', 'DEMO-U-A', '1002', 'wykonana', 'przybyl', 'potwierdzona', null],
  ['14:00', '15:00', 'Anna', 'DEMO-U-MAS', '1005', 'zaplanowana', 'oczekiwana', 'potwierdzona', null],
  ['16:00', '16:45', 'Anna', 'DEMO-U-B', '1008', 'zaplanowana', 'oczekiwana', 'potwierdzona', null],
  ['18:00', '19:00', 'Anna', 'DEMO-U-A', '1004', 'zaplanowana', 'oczekiwana', 'potwierdzona', 'prosi o cieplejszy gabinet, alergia na olejek migdałowy'],
];

(async () => {
  const stare = await q(`SELECT id FROM Term_Rezerwacje WHERE tenant_id = ? AND zrodlo = ?`, [T, ZRODLO]);
  if (stare.length) {
    const ids = stare.map(r => r.id);
    await q(`DELETE FROM Term_Historia WHERE tenant_id = ? AND rezerwacja_id IN (?)`, [T, ids]);   // bez tego po każdym zasiewie zostawały osierocone wpisy historii
    await q(`DELETE FROM Term_Zajecia WHERE tenant_id = ? AND rezerwacja_id IN (?)`, [T, ids]);
    await q(`DELETE FROM Term_Pozycje WHERE tenant_id = ? AND rezerwacja_id IN (?)`, [T, ids]);
    await q(`DELETE FROM Term_Rezerwacje WHERE tenant_id = ? AND id IN (?)`, [T, ids]);
    console.log('usunięto poprzedni zasiew:', ids.length, 'wizyt');
  }
  if (process.argv.includes('--usun')) { db.end(); return; }

  const uslugi = {};
  for (const u of await q(`SELECT u.id, u.kategoria, u.wariant, u.cena, tu.czas_min FROM Uslugi u LEFT JOIN Term_Uslugi tu ON tu.usluga_id = u.id AND tu.tenant_id = u.tenant_id WHERE u.tenant_id = ?`, [T])) uslugi[u.id] = u;
  const klienci = {};
  for (const k of await q(`SELECT id_klienta, imie_nazwisko, telefon FROM Klienci WHERE tenant_id = ?`, [T])) klienci[k.id_klienta] = k;

  let n = 0;
  for (const [od, doG, prac, uid, idk, stan, obecnosc, status, notatka] of DZIEN) {
    const u = uslugi[uid], k = klienci[idk];
    if (!u || !k) { console.log('pominięto (brak usługi/klientki):', uid, idk); continue; }
    const r = await q(
      `INSERT INTO Term_Rezerwacje (tenant_id, id_klienta, klient_nazwa, klient_telefon, status, obecnosc, kanal, zrodlo, start, koniec, notatka, wersja, utworzyl, utworzono)
       VALUES (?, ?, ?, ?, ?, ?, 'recepcja', ?, ?, ?, ?, 1, 'Marta', NOW())`,
      [T, idk, k.imie_nazwisko, k.telefon, status, obecnosc, ZRODLO, ts(od), ts(doG), notatka]);
    const czas = Math.round((new Date(ts(doG)) - new Date(ts(od))) / 60000);
    await q(
      `INSERT INTO Term_Pozycje (tenant_id, rezerwacja_id, kolejnosc, usluga_id, kategoria, wariant, cena, czas_min, pracownik, start, koniec, stan, wykonawca_fakt, start_fakt, koniec_fakt)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [T, r.insertId, uid, u.kategoria, u.wariant, u.cena, czas, prac, ts(od), ts(doG), stan,
       stan === 'wykonana' ? prac : null, stan === 'wykonana' ? ts(od) : null, stan === 'wykonana' ? ts(doG) : null]);
    n++;
  }
  const zal = await q(`SELECT COUNT(*) n FROM Term_Pozycje p JOIN Term_Rezerwacje r ON r.id = p.rezerwacja_id WHERE p.tenant_id = ? AND r.zrodlo = ? AND p.stan = 'zaplanowana' AND p.koniec < NOW()`, [T, ZRODLO]);
  console.log('zasiano wizyt:', n, '| dzień:', DZIS, '| zaległości (koniec minął, brak wyniku):', zal[0].n);
  db.end();
})().catch(e => { console.error('BŁĄD:', e.message); db.end(); process.exit(1); });
