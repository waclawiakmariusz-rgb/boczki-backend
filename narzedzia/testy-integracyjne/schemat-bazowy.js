// narzedzia/testy-integracyjne/schemat-bazowy.js — przygotowanie PUSTEJ, izolowanej bazy testowej (.env.test) do testów dodatku:
//   1) schema.sql z repozytorium (tabele rdzenia: Sprzedaz, Zadatki, Klienci, Uslugi, Użytkownicy, Pracownicy, Platnosci, Logi, …),
//   2) tabele spoza schema.sql odtworzone z rzeczywistego DDL produkcji (docs/terminarz-zakupy/po9/rozpoznanie-schemat.json):
//      Licencje, Tenant_Features, Features_Catalog, Typy_Zabiegow,
//   3) kolumny dokładane przez moduły przy starcie serwera (ALTER … ADD COLUMN w routes/sprzedaz.js, klienci.js, typy_zabiegow.js, admin.js)
//      — tu zastosowane wprost, żeby testy nie wymagały uruchomienia całego serwera.
//   Bez danych osobowych. Nie uruchamia migracji v2 (to osobne narzędzie). Odmawia pracy, gdy .env.test wskazuje bazę z .env.
//
//   node narzedzia/testy-integracyjne/schemat-bazowy.js
'use strict';
const fs = require('fs'); const path = require('path');
const mysql = require('mysql2/promise');
const ROOT = path.join(__dirname, '..', '..');
function envZ(plik) { if (!fs.existsSync(plik)) return null; const out = {}; for (const l of fs.readFileSync(plik, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } return out; }
const DODATKOWE = [ // kolumny dokładane idempotentnie przez moduły przy starcie (nazwy i typy jak w rzeczywistej bazie — po9)
  ['Sprzedaz', 'kategoria_produktu', "ENUM('Kosmetyk','Suplement') NULL"], ['Sprzedaz', 'data_waznosci', 'DATE NULL'], ['Sprzedaz', 'karnet_zamkniety_w', 'DATETIME NULL'], ['Sprzedaz', 'karnet_zamkniety_przez', 'VARCHAR(100) NULL'],
  ['Sprzedaz', 'grupa_id', 'VARCHAR(40) NULL'], ['Sprzedaz', 'zawieszenia_liczba', 'INT NOT NULL DEFAULT 0'], ['Sprzedaz', 'zawieszenia_dni_lacznie', 'INT NOT NULL DEFAULT 0'], ['Sprzedaz', 'zwrot_do_id', 'VARCHAR(50) NULL'], ['Sprzedaz', 'typ_zabiegu', 'VARCHAR(80) NULL'], ['Sprzedaz', 'czy_rozliczone', 'TINYINT NOT NULL DEFAULT 0'],
  ['Uslugi', 'typ_zabiegu', 'VARCHAR(80) NULL'], ['Uslugi', 'zrodlo', "VARCHAR(10) NOT NULL DEFAULT 'reczne'"],
  ['Zadatki', 'bon', 'TINYINT(1) NOT NULL DEFAULT 0'], ['Zadatki', 'czy_rozliczone', 'TINYINT NOT NULL DEFAULT 0'], ['Zadatki', 'uwagi', 'TEXT NULL'],
  ['Klienci', 'status', "ENUM('AKTYWNY','USUNIETY','ZANONIMIZOWANY') DEFAULT 'AKTYWNY'"], ['Klienci', 'data_usuniecia', 'DATETIME NULL'], ['Klienci', 'kto_usunal', 'VARCHAR(100) NULL'], ['Klienci', 'powod_usuniecia', 'VARCHAR(255) NULL'], ['Klienci', 'zmarly', 'TINYINT(1) DEFAULT 0'], ['Klienci', 'data_zgonu', 'DATE NULL'], ['Klienci', 'ostrzezenie', 'VARCHAR(500) NULL'], ['Klienci', 'odwolanie_ulga', 'TINYINT(1) NOT NULL DEFAULT 0'], ['Klienci', 'odwolanie_ulga_data', 'DATE NULL'],
];
(async () => {
  const cel = envZ(path.join(ROOT, '.env.test')), prod = envZ(path.join(ROOT, '.env'));
  if (!cel || !cel.DB_HOST || !cel.DB_NAME) { console.error('Brak .env.test — nic nie wykonano.'); process.exit(3); }
  if (prod && String(prod.DB_HOST).trim() === String(cel.DB_HOST).trim() && String(prod.DB_NAME).trim() === String(cel.DB_NAME).trim()) { console.error('ODMOWA: .env.test = baza z .env.'); process.exit(4); }
  const c = await mysql.createConnection({ host: cel.DB_HOST, port: Number(cel.DB_PORT || 3306), user: cel.DB_USER, password: cel.DB_PASSWORD, database: cel.DB_NAME, charset: 'utf8mb4', multipleStatements: true });
  const [[info]] = await c.query('SELECT DATABASE() d, VERSION() v, @@default_storage_engine e, @@transaction_isolation i');
  console.log(`baza: ${info.d} · ${info.v} · silnik ${info.e} · izolacja ${info.i}`);
  // 1) schema.sql — każdy CREATE TABLE osobno, z IF NOT EXISTS, bez DROP
  const sql = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
  const stmts = sql.split(/;\s*\n/).map(s => s.replace(/^\s*(--[^\n]*\n\s*)+/g, '').trim()).filter(s => /^CREATE TABLE/i.test(s)); // komentarze „--” przed CREATE są pomijane
  let utworzone = 0, bylo = 0;
  for (const s of stmts) { const st = s.replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?/i, 'CREATE TABLE IF NOT EXISTS '); const nazwa = (st.match(/`([^`]+)`/) || [])[1]; try { const [r] = await c.query(st); if (r.warningStatus) bylo++; else utworzone++; } catch (e) { console.error('schema.sql:', nazwa, e.message); } }
  // 2) tabele spoza schema.sql — DDL z rozpoznania produkcji
  const po9 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'terminarz-zakupy', 'po9', 'rozpoznanie-schemat.json'), 'utf8'));
  for (const t of ['Licencje', 'Tenant_Features', 'Features_Catalog', 'Typy_Zabiegow']) { const ddl = String(po9['DDL_' + t] || '').replace(/^CREATE TABLE/i, 'CREATE TABLE IF NOT EXISTS').replace(/AUTO_INCREMENT=\d+\s*/i, ''); if (!/^CREATE/.test(ddl)) { console.error('brak DDL w po9 dla', t); continue; } const [r] = await c.query(ddl); if (r.warningStatus) bylo++; else utworzone++; }
  // 3) kolumny modułów
  let kolumny = 0;
  for (const [t, k, def] of DODATKOWE) { try { await c.query(`ALTER TABLE \`${t}\` ADD COLUMN \`${k}\` ${def}`); kolumny++; } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') console.error('ALTER', t, k, e.message); } }
  // 4) tabele własne terminarza (model v1: Term_*) — DOKŁADNIE z definicji modułu routes/terminarz.js (CREATE TABLE IF NOT EXISTS przy ładowaniu), bez duplikowania DDL
  await c.end();
  const pool = require('mysql2').createPool({ host: cel.DB_HOST, port: Number(cel.DB_PORT || 3306), user: cel.DB_USER, password: cel.DB_PASSWORD, database: cel.DB_NAME, charset: 'utf8mb4', connectionLimit: 3 });
  process.env.NODE_ENV = 'test'; // bez timerów spraw i bez sprawdzania schematu przy ładowaniu
  require('../../routes/terminarz')(pool, { hasFeature: (t, k, cb) => cb(false), log: { error: (...a) => console.error(...a), warn() {}, info() {} } });
  await new Promise(r => setTimeout(r, 4000)); // mk() jest fire-and-forget
  await new Promise((res, rej) => pool.end(e => (e ? rej(e) : res())));
  const c2 = await mysql.createConnection({ host: cel.DB_HOST, port: Number(cel.DB_PORT || 3306), user: cel.DB_USER, password: cel.DB_PASSWORD, database: cel.DB_NAME });
  const [tab] = await c2.query(`SELECT COUNT(*) n, SUM(TABLE_NAME LIKE 'Term%') term FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
  console.log(`schemat bazowy: utworzono ${utworzone} tabel, istniało ${bylo}, dodano ${kolumny} kolumn; tabel w bazie: ${tab[0].n} (w tym Term_*: ${tab[0].term})`);
  await c2.end();
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
