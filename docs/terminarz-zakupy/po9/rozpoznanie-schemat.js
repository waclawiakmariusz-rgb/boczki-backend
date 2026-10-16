// ROZPOZNANIE ZK-01: JEDNO połączenie, WYŁĄCZNIE SELECT/SHOW (schemat + liczniki, zero danych osobowych)
require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, charset: 'utf8mb4' });
  const out = {};
  const [[db]] = await c.query('SELECT DATABASE() AS d, @@version AS v'); out.baza = { nazwa: db.d, wersja: db.v, host: process.env.DB_HOST };
  for (const t of ['Sprzedaz', 'Platnosci', 'Zadatki', 'Klienci', 'Uslugi', 'Vouchery', 'Logi', 'Pracownicy', 'Użytkownicy', 'Features', 'Tenant_Features', 'Features_Catalog', 'Licencje', 'Typy_Zabiegow']) {
    try { const [[r]] = await c.query('SHOW CREATE TABLE `' + t + '`'); out['DDL_' + t] = r['Create Table']; } catch (e) { out['DDL_' + t] = 'BRAK: ' + e.message; }
  }
  const [tab] = await c.query("SELECT TABLE_NAME t, TABLE_ROWS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'Term%' OR TABLE_NAME LIKE '%ouch%' OR TABLE_NAME LIKE '%arnet%' OR TABLE_NAME LIKE '%ortfel%' OR TABLE_NAME LIKE '%eature%' OR TABLE_NAME LIKE '%icenc%') ORDER BY TABLE_NAME");
  out.tabele = tab;
  const [zk] = await c.query('SELECT tenant_id, COUNT(*) n FROM Term_Zakupy GROUP BY tenant_id'); out.Term_Zakupy = zk;
  const [zs] = await c.query('SELECT tenant_id, COUNT(*) n FROM Term_Zakupy_Skladniki GROUP BY tenant_id'); out.Term_Zakupy_Skladniki = zs;
  const [zr] = await c.query('SELECT tenant_id, typ, COUNT(*) n FROM Term_Zakupy_Ruchy GROUP BY tenant_id, typ'); out.Term_Zakupy_Ruchy = zr;
  const [of] = await c.query('SELECT tenant_id, stan, COUNT(*) n FROM Term_Oferty GROUP BY tenant_id, stan'); out.Term_Oferty = of;
  const [pz] = await c.query('SELECT tenant_id, COUNT(*) n FROM Term_Pozycje WHERE zakup_skladnik_id IS NOT NULL GROUP BY tenant_id'); out.Term_Pozycje_z_zakupem = pz;
  const [mig] = await c.query('SELECT * FROM Term_Migracje'); out.Term_Migracje = mig;
  const [ust] = await c.query('SELECT tenant_id, kontrola_zakupow FROM Term_Ustawienia'); out.Term_Ustawienia = ust;
  const [rez] = await c.query('SELECT tenant_id, COUNT(*) n FROM Term_Rezerwacje GROUP BY tenant_id'); out.Term_Rezerwacje = rez;
  // Sprzedaż: kształt danych (bez nazwisk) — wzorce id, rozkład statusów, ile ma data_waznosci / karnet_zamkniety / id_klienta
  const [sp1] = await c.query("SELECT status, COUNT(*) n FROM Sprzedaz GROUP BY status"); out.Sprzedaz_statusy = sp1;
  const [sp2] = await c.query("SELECT SUM(id LIKE '%-%') z_sufiksem, SUM(id NOT LIKE '%-%') bez_sufiksu, SUM(data_waznosci IS NOT NULL) z_waznoscia, SUM(karnet_zamkniety_w IS NOT NULL) zamknietych, SUM(id_klienta IS NULL OR id_klienta='') bez_id_klienta, SUM(kategoria_produktu IS NOT NULL) produkty, COUNT(*) razem FROM Sprzedaz"); out.Sprzedaz_ksztalt = sp2;
  const [sp3] = await c.query("SELECT szczegoly, COUNT(*) n FROM Sprzedaz WHERE szczegoly REGEXP '[0-9]+ ?[x×]' GROUP BY szczegoly ORDER BY n DESC LIMIT 15"); out.Sprzedaz_warianty_x = sp3;
  const [sp4] = await c.query("SELECT platnosc, COUNT(*) n FROM Sprzedaz GROUP BY platnosc ORDER BY n DESC LIMIT 15").catch(e => [['BRAK platnosc: ' + e.message]]); out.Sprzedaz_platnosc = sp4;
  const [zd] = await c.query("SELECT status, COUNT(*) n FROM Zadatki GROUP BY status").catch(e => [['BRAK: ' + e.message]]); out.Zadatki_statusy = zd;
  const [pl] = await c.query("SELECT metoda, COUNT(*) n FROM Platnosci GROUP BY metoda ORDER BY n DESC LIMIT 15").catch(e => [['BRAK: ' + e.message]]); out.Platnosci_metody = pl;
  const [us] = await c.query("SELECT COUNT(*) razem, SUM(wariant REGEXP '[0-9]+ ?[x×]') z_liczba_x, COUNT(DISTINCT tenant_id) salony FROM Uslugi"); out.Uslugi_ksztalt = us;
  await c.end();
  require('fs').writeFileSync(require('path').join(__dirname, 'rozpoznanie-schemat.json'), JSON.stringify(out, null, 2));
  console.log('OK → rozpoznanie-schemat.json');
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
