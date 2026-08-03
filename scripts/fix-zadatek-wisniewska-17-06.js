// scripts/fix-zadatek-wisniewska-17-06.js
// Korekta jednorazowa: zadatek DEP-1778660391959 (Wiśniewska Agnieszka, wpłata 13.05,
// 340 zł) został realnie WYKORZYSTANY przy sprzedaży z 17.06 (202606171418380-1,
// Portfel 340 zł + Dopłata 140 zł), ale pozostał AKTYWNY, bo miał PUSTE id_klienta
// i nie wpadł do automatu rozliczania po id_klienta.
//
// Skrypt: ustawia status -> WYKORZYSTANY oraz uzupełnia id_klienta -> 1047.
//   node scripts/fix-zadatek-wisniewska-17-06.js              # DRY-RUN (tylko podgląd)
//   node scripts/fix-zadatek-wisniewska-17-06.js --wet-run    # właściwy UPDATE
require('dotenv').config();
const mysql = require('mysql2');

const WET_RUN = process.argv.includes('--wet-run');
const TENANT = 'boczki-salon-glowny-001';
const DEP_ID = 'DEP-1778660391959';
const ID_KLIENTA = '1047';

function stripQuotes(v) { return (v || '').replace(/^['"]|['"]$/g, ''); }
const q = (db, sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));

async function main() {
  const db = mysql.createConnection({
    host: stripQuotes(process.env.DB_HOST),
    user: stripQuotes(process.env.DB_USER),
    password: stripQuotes(process.env.DB_PASSWORD),
    database: stripQuotes(process.env.DB_NAME),
  });
  await new Promise((res, rej) => db.connect(e => e ? rej(e) : res()));
  console.log('Tryb: ', WET_RUN ? 'WET-RUN (zapis)' : 'DRY-RUN (podgląd)');
  console.log('Baza: ', stripQuotes(process.env.DB_NAME), '@', stripQuotes(process.env.DB_HOST), '\n');

  // 1. Stan zadatku PRZED
  const zad = await q(db,
    `SELECT id, tenant_id, id_klienta, klient, typ, kwota, status, cel FROM Zadatki WHERE tenant_id = ? AND id = ?`,
    [TENANT, DEP_ID]);
  if (!zad.length) { console.log('BŁĄD: nie znaleziono zadatku', DEP_ID); db.end(); return; }
  const z = zad[0];
  console.log('Zadatek PRZED:');
  console.log(`  ${z.id} | klient=${z.klient} | id_klienta="${z.id_klienta}" | ${z.kwota} zł | STATUS=${z.status} | cel="${z.cel}"`);

  // 2. Sprawdź powiązaną sprzedaż (musi istnieć, żeby korekta była uzasadniona)
  const spr = await q(db,
    `SELECT id, klient, zabieg, kwota, platnosc, id_zadatku FROM Sprzedaz WHERE tenant_id = ? AND id_zadatku LIKE ?`,
    [TENANT, '%' + DEP_ID + '%']);
  console.log('\nSprzedaż powiązana (id_zadatku zawiera ' + DEP_ID + '):');
  if (!spr.length) console.log('  (brak — UWAGA: korekta byłaby nieuzasadniona!)');
  spr.forEach(s => console.log(`  ${s.id} | "${s.zabieg}" | ${s.kwota} zł | ${s.platnosc} | id_zad=${s.id_zadatku}`));

  // 3. Walidacje bezpieczeństwa
  const problemy = [];
  if (z.typ !== 'WPŁATA') problemy.push(`typ != WPŁATA (jest ${z.typ})`);
  if (z.status !== 'AKTYWNY' && z.status !== null) problemy.push(`status już = ${z.status} (oczekiwano AKTYWNY)`);
  if (!spr.length) problemy.push('brak sprzedaży odwołującej się do tego zadatku');
  if (problemy.length) {
    console.log('\n>>> WSTRZYMANO — warunki nie spełnione:');
    problemy.forEach(p => console.log('    - ' + p));
    db.end();
    return;
  }

  console.log('\nPlanowana zmiana: status -> WYKORZYSTANY, id_klienta -> ' + ID_KLIENTA);

  if (WET_RUN) {
    const upd = await q(db,
      `UPDATE Zadatki SET status = 'WYKORZYSTANY', id_klienta = ? WHERE tenant_id = ? AND id = ? AND (status = 'AKTYWNY' OR status IS NULL)`,
      [ID_KLIENTA, TENANT, DEP_ID]);
    console.log(`\n>>> ZAKTUALIZOWANO: ${upd.affectedRows} wiersz(y).`);
    const po = await q(db, `SELECT id, id_klienta, status FROM Zadatki WHERE tenant_id = ? AND id = ?`, [TENANT, DEP_ID]);
    if (po.length) console.log(`Zadatek PO: ${po[0].id} | id_klienta="${po[0].id_klienta}" | STATUS=${po[0].status}`);
  } else {
    console.log('\nTo był DRY-RUN. Aby zapisać uruchom z flagą --wet-run.');
  }
  db.end();
}
main().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
