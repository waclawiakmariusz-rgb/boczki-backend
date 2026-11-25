// narzedzia/proby/skrypty/klub-data-apka-zasiew.js — przygotowanie próby „data resetu w aplikacji klientki” (baza IZOLOWANA, demo-test).
// Salon ma reset 1.01.2028 (ustawiony przez Olę), klientka 1001 (Marta Kowalska, 601 200 301) dostaje konto Klubu z PIN 2468 i 200 pkt.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2', 'promise'));
let bcrypt;
try { bcrypt = require(path.join(KORZEN, 'node_modules', 'bcrypt')); } catch (e) { bcrypt = require(path.join(KORZEN, 'node_modules', 'bcryptjs')); }
const T = 'demo-test', K = '1001', TEL = '601200301', PIN = '2468', KTO = 'PROBA-RESET';
const STAN = path.join(os.tmpdir(), 'estelio-proba-klub-data-apka.json');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true });
  const q = (s, p = []) => c.query(s, p).then(([r]) => r);
  const istniejace = await q(`SELECT id FROM Lojalnosc_Konta WHERE tenant_id = ? AND id_klienta = ?`, [T, K]);
  if (istniejace.length) throw new Error('Klientka 1001 ma już konto Klubu w demo-test — próba odmawia, żeby niczego nie nadpisać');
  const przed = (await q(`SELECT reset_roczny, nastepny_reset, ostatni_reset_rok, reset_zmienil, reset_zmieniono FROM Lojalnosc_Ustawienia WHERE tenant_id = ?`, [T]))[0] || null;
  fs.writeFileSync(STAN, JSON.stringify({ przed }));
  await q(`UPDATE Lojalnosc_Ustawienia SET reset_roczny = 1, nastepny_reset = '2028-01-01', reset_zmienil = 'Ola', reset_zmieniono = NOW() WHERE tenant_id = ?`, [T]);
  const hash = await bcrypt.hash(PIN, 10);
  await q(`INSERT INTO Lojalnosc_Konta (tenant_id, id_klienta, telefon, pin_hash, status, zgoda_regulamin_at) VALUES (?, ?, ?, ?, 'AKTYWNE', NOW())`, [T, K, TEL, hash]);
  await q(`DELETE FROM Lojalnosc_Punkty WHERE tenant_id = ? AND pracownik = ?`, [T, KTO]);
  const wpisy = [[120, '2026-09-10 12:00:00', 'A', 'Zakup w salonie'], [80, '2026-11-20 12:00:00', 'B', 'Zakup w salonie']];
  for (const [zm, kiedy, ref, powod] of wpisy) await q(`INSERT INTO Lojalnosc_Punkty (tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik, created_at) VALUES (?, ?, ?, ?, 'RECZNE', ?, ?, ?)`, [T, K, zm, powod, 'PROBA-APKA-' + ref, KTO, kiedy]);
  console.log(`zasiew: demo-test reset 2028-01-01 (Ola); konto Klubu 1001 (tel ${TEL}, PIN ${PIN}), punkty 120 + 80 = 200; stan sprzed w ${STAN}`);
  await c.end();
})().catch((e) => { console.error('BŁĄD zasiewu:', e.message); process.exit(1); });
