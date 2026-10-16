// narzedzia/terminarz-zakupy-migracja.js — KONTROLOWANA migracja schematu v2 ewidencji zakupów (ZK-02).
//
//   node narzedzia/terminarz-zakupy-migracja.js                      # cel: baza z .env.test (domyślnie); odmowa, gdy to ta sama baza co w .env
//   node narzedzia/terminarz-zakupy-migracja.js --dry-run            # tylko lista kroków i sprawdzenie danych, zero DDL
//   node narzedzia/terminarz-zakupy-migracja.js --env .env --wspolna-baza --potwierdzam   # jawne uruchomienie na bazie z .env (WYMAGA DECYZJI WŁAŚCICIELA)
//
// Zasady: nigdy przy starcie serwera; pod GET_LOCK('trm:migracja'); ścieżka „pusty model” zatrzymuje się, gdy stary model T02/T03 ma dane
// (raport zamiast automatycznego przenoszenia); tylko CREATE TABLE IF NOT EXISTS / ALTER ADD COLUMN; zero DROP/DELETE/TRUNCATE; powtarzalna.
// Hasła nie są logowane.
'use strict';
const fs = require('fs'); const path = require('path');
const mysql = require('mysql2/promise');
const { migrujV2, SCHEMAT_V2, WERSJA_SCHEMATU_V2 } = require('../routes/terminarz-zakupy');
const ROOT = path.join(__dirname, '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? (process.argv[i + 1] || true) : null; };
const ENV = String(arg('--env') || '.env.test'); const DRY = process.argv.includes('--dry-run');
const WSPOLNA = process.argv.includes('--wspolna-baza'), POTW = process.argv.includes('--potwierdzam');
function envZ(plik) { if (!fs.existsSync(plik)) return null; const out = {}; for (const l of fs.readFileSync(plik, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } return out; }
(async () => {
  const cel = envZ(path.join(ROOT, ENV)); const prod = envZ(path.join(ROOT, '.env'));
  if (!cel || !cel.DB_HOST || !cel.DB_NAME) { console.error(`Brak ${ENV} z DB_HOST/DB_NAME. Dla ${ENV === '.env.test' ? 'izolowanego środowiska: utwórz bazę i użytkownika w panelu Hostingera i wpisz je do .env.test (szablon .env.test.example)' : 'tego pliku: uzupełnij konfigurację'}. Nic nie wykonano.`); process.exit(3); }
  const taSama = prod && String(prod.DB_HOST).trim() === String(cel.DB_HOST).trim() && String(prod.DB_NAME).trim() === String(cel.DB_NAME).trim();
  if (taSama && !(WSPOLNA && POTW)) { console.error('ODMOWA: cel jest tą samą bazą co .env (współdzielona z produkcją). Migracja v2 na niej wymaga jawnej decyzji: --env .env --wspolna-baza --potwierdzam. Nic nie wykonano.'); process.exit(4); }
  const c = await mysql.createConnection({ host: cel.DB_HOST, port: Number(cel.DB_PORT || 3306), user: cel.DB_USER, password: cel.DB_PASSWORD, database: cel.DB_NAME, charset: 'utf8mb4', multipleStatements: false });
  const qx = async (sql, p = []) => (await c.query(sql, p))[0];
  const [[info]] = await c.query('SELECT DATABASE() AS d, @@version AS v');
  console.log(`cel: ${cel.DB_HOST}/${info.d} (${info.v}) · schemat v2 ${WERSJA_SCHEMATU_V2} · ${SCHEMAT_V2.length} kroków${DRY ? ' · DRY-RUN' : ''}${taSama ? ' · UWAGA: BAZA WSPÓLNA Z PRODUKCJĄ (jawnie potwierdzono)' : ''}`);
  const raport = await migrujV2(qx, { dryRun: DRY, log: console });
  console.log(JSON.stringify(raport, null, 2));
  await c.end();
  process.exit(raport.zatrzymano || raport.bledy.length ? 1 : 0);
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
