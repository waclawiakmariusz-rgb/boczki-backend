// Szybka rezerwacja (hold) — przygotowanie i sprzątanie bazy IZOLOWANEJ (estelio_test, salon demo-test).
// Wołany przez proba-ekranu.js jako "przygotuj"/"posprzataj" scenariuszy terminarz-szybka-rezerwacja-{a,b}.json.
//   node hold-zasiew.js          → sprząta ślady poprzedniej próby i ustawia regulamin demo-test (link do zadatku go wymaga)
//   node hold-zasiew.js --usun   → tylko sprząta (holdy, linki, zadatki, profile próbne, sprawy E40–E42, regulamin)
// Odmawia pracy na każdej bazie innej niż estelio_test.
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test') });
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2/promise'));
const T = 'demo-test';
const OSOBY = ['Jan Testowy', 'Anna Testowa'];
(async () => {
  if (process.env.DB_NAME !== 'estelio_test') throw new Error('To nie jest baza izolowana: ' + process.env.DB_NAME + ' — odmowa');
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const [rez] = await c.query(`SELECT id FROM Term_Rezerwacje WHERE tenant_id = ? AND klient_nazwa IN (?)`, [T, OSOBY]);
  const ids = rez.map(r => r.id);
  if (ids.length) {
    for (const tab of ['Term_Zajecia', 'Term_Pozycje', 'Term_Historia']) await c.query(`DELETE FROM ${tab} WHERE tenant_id = ? AND rezerwacja_id IN (?)`, [T, ids]);
    const [spr] = await c.query(`SELECT id FROM Term_Sprawy WHERE tenant_id = ? AND (rezerwacja_id IN (?) OR klucz_dedup REGEXP '^E4[0-2]:')`, [T, ids]);
    if (spr.length) {
      await c.query(`DELETE FROM Term_Sprawy_Dziennik WHERE sprawa_id IN (?)`, [spr.map(s => s.id)]);
      await c.query(`DELETE FROM Term_Sprawy_Odczyt WHERE sprawa_id IN (?)`, [spr.map(s => s.id)]).catch(() => {});
      await c.query(`DELETE FROM Term_Sprawy WHERE id IN (?)`, [spr.map(s => s.id)]);
    }
    await c.query(`DELETE FROM ZgodyPlatnosci WHERE tenant_id = ? AND rezerwacja_id IN (?)`, [T, ids]);
    await c.query(`DELETE FROM Term_Rezerwacje WHERE tenant_id = ? AND id IN (?)`, [T, ids]);
  }
  const [kl] = await c.query(`SELECT id_klienta FROM Klienci WHERE tenant_id = ? AND imie_nazwisko IN (?)`, [T, OSOBY]);
  const kid = kl.map(k => k.id_klienta);
  if (kid.length) {
    for (const tab of ['`Rejestr_Oświadczeń`', 'Rejestr_RODO', 'Zadatki']) await c.query(`DELETE FROM ${tab} WHERE tenant_id = ? AND id_klienta IN (?)`, [T, kid]).catch(() => {});
    await c.query(`DELETE FROM Klienci WHERE tenant_id = ? AND id_klienta IN (?)`, [T, kid]);
  }
  await c.query(`DELETE FROM Zadatki WHERE tenant_id = ? AND klient IN (?)`, [T, OSOBY]);
  if (process.argv.includes('--usun')) {
    await c.query(`DELETE FROM TenantRegulaminy WHERE tenant_id = ?`, [T]);
    console.log(`posprzątano: rezerwacje ${ids.length}, profile ${kid.length}, regulamin demo-test usunięty`);
  } else {
    await c.query(`INSERT INTO TenantRegulaminy (tenant_id, tresc, url, updated_by) VALUES (?, '', 'https://www.estelio.com.pl/regulamin-salonu-demo', 'próba') ON DUPLICATE KEY UPDATE url = VALUES(url)`, [T]);
    console.log(`posprzątano ślady poprzedniej próby (rezerwacje ${ids.length}, profile ${kid.length}); regulamin demo-test ustawiony`);
  }
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
