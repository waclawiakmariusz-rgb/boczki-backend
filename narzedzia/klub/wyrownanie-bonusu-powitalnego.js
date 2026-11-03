// Jednorazowe WYRÓWNANIE bonusu powitalnego Klubu (ticket #22, 3.11.2026).
// Do 3.11.2026 bonus powitalny dostawały tylko osoby rejestrujące NOWY numer przez link (u Boczków 2 z 61 kont),
// choć ekran rejestracji obiecywał go wszystkim. Decyzja właściciela: każde konto bez bonusu dostaje go teraz
// z dopiskiem „wyrównanie”, a od tej wersji bonus przysługuje przy każdym założeniu konta.
//
//   node narzedzia/klub/wyrownanie-bonusu-powitalnego.js --salon=<tenant_id>                  → tylko lista (baza izolowana .env.test)
//   node narzedzia/klub/wyrownanie-bonusu-powitalnego.js --salon=<tenant_id> --produkcja-tak  → lista z PRODUKCJI (.env), bez zapisu
//   … --produkcja-tak --zapis-tak [--pomin=1300,1344]                                          → ZAPIS na produkcji
//
// Zapis: jeden wpis Lojalnosc_Punkty na konto (zrodlo BONUS, ref WYR@<id>, powód „Bonus powitalny — wyrównanie 🎉”),
// chroniony NOT EXISTS (konto, które już ma BONUS, nie dostanie drugiego — skrypt można uruchomić ponownie),
// plus wpis w Logi (KLUB PUNKTY BONUS). Kwota = aktualne Ustawienia.bonus_powitalny_pkt salonu.
const path = require('path');
const { randomUUID } = require('crypto');
const KORZEN = path.join(__dirname, '..', '..');
const arg = (n) => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const flaga = (n) => process.argv.includes('--' + n);
const PROD = flaga('produkcja-tak');
const ZAPIS = flaga('zapis-tak');
const SALON = arg('salon');
const POMIN = new Set(String(arg('pomin') || '').split(',').map(x => x.trim()).filter(Boolean));
if (!SALON) { console.error('Podaj --salon=<tenant_id>'); process.exit(1); }

require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, PROD ? '.env' : '.env.test'), quiet: true });
if (!PROD && (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307')) throw new Error('Bez --produkcja-tak działa tylko baza izolowana estelio_test:3307 — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const db = mysql.createConnection({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, charset: 'utf8mb4', ssl: process.env.DB_SSL === 'off' || !PROD ? undefined : { rejectUnauthorized: false },
});
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 120000).unref();

(async () => {
  const u = await q(`SELECT bonus_powitalny_pkt, nazwa_klubu FROM Lojalnosc_Ustawienia WHERE tenant_id = ? LIMIT 1`, [SALON]);
  const bonus = parseInt(((u && u[0]) || {}).bonus_powitalny_pkt, 10) || 0;
  console.log(`${PROD ? 'PRODUKCJA' : 'baza izolowana'} · salon ${SALON} · ${(u[0] || {}).nazwa_klubu || '?'} · bonus powitalny = ${bonus} pkt · tryb: ${ZAPIS ? 'ZAPIS' : 'tylko lista'}`);
  if (bonus <= 0) { console.log('Bonus = 0 — nie ma czego wyrównywać.'); db.end(); return; }
  const konta = await q(
    `SELECT k.id_klienta, kl.imie_nazwisko, DATE_FORMAT(k.created_at, '%Y-%m-%d') AS od
       FROM Lojalnosc_Konta k
       LEFT JOIN Klienci kl ON kl.tenant_id = k.tenant_id AND kl.id_klienta = k.id_klienta
      WHERE k.tenant_id = ? AND k.status = 'AKTYWNE'
        AND NOT EXISTS (SELECT 1 FROM Lojalnosc_Punkty p WHERE p.tenant_id = k.tenant_id AND p.id_klienta = k.id_klienta AND p.zrodlo = 'BONUS')
      ORDER BY k.created_at`, [SALON]);
  const doZrobienia = konta.filter(k => !POMIN.has(String(k.id_klienta)));
  const pominiete = konta.filter(k => POMIN.has(String(k.id_klienta)));
  console.log(`Kont bez bonusu: ${konta.length}, do wyrównania: ${doZrobienia.length}, pominięte: ${pominiete.map(k => k.id_klienta + ' ' + (k.imie_nazwisko || '')).join(', ') || '—'}`);
  for (const k of doZrobienia) console.log(`  ${k.id_klienta} | ${k.imie_nazwisko || '(brak kartoteki)'} | konto od ${k.od}`);
  if (!ZAPIS) { console.log('Bez --zapis-tak nic nie zapisano.'); db.end(); return; }

  let dodane = 0;
  for (const k of doZrobienia) {
    const id = String(k.id_klienta);
    const r = await q(
      `INSERT INTO Lojalnosc_Punkty (tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik)
       SELECT ?, ?, ?, 'Bonus powitalny — wyrównanie 🎉', 'BONUS', ?, 'System' FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM Lojalnosc_Punkty WHERE tenant_id = ? AND id_klienta = ? AND zrodlo = 'BONUS')`,
      [SALON, id, bonus, 'WYR@' + id, SALON, id]);
    if (Number(r.affectedRows) > 0) {
      dodane++;
      await q(`INSERT INTO Logi (id, tenant_id, data_zdarzenia, pracownik, akcja, modul, opis) VALUES (?, ?, NOW(), 'System', 'KLUB PUNKTY BONUS', 'SYSTEM', ?)`,
        [randomUUID(), SALON, `Klient ${id} (${k.imie_nazwisko || ''}): +${bonus} pkt | Bonus powitalny — wyrównanie (ticket #22, konto bez bonusu od ${k.od})`]);
    }
  }
  const kontrola = await q(`SELECT COUNT(*) AS n FROM Lojalnosc_Punkty WHERE tenant_id = ? AND zrodlo = 'BONUS' AND ref_id LIKE 'WYR@%'`, [SALON]);
  console.log(`ZAPISANO: ${dodane} wpisów po ${bonus} pkt (= ${dodane * bonus} pkt). Wpisów WYR@ w bazie łącznie: ${kontrola[0].n}.`);
  db.end();
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
