// Przygotowanie / sprzątanie próby „Tpay partia 1” (salon demo-test, baza IZOLOWANA estelio_test:3307).
//   • czyści konfigurację Tpay salonu demo-test (Tenant_Tpay), jego transakcje testowe (Tpay_Transakcje), logi webhooka
//     i linki płatności utworzone przez próbę (ZgodyPlatnosci z opisem „próba tpay” — nawiasy kwadratowe z formularza serwer usuwa);
//   • argument `podnies`: na czas próby nadaje Oli rolę megaadmin (ekran konfiguracji jest tylko dla admin/megaadmin),
//     argument `przywroc`: wraca do roli zapisanej w pliku tymczasowym (domyślnie „manager”).
// Przed sprzątaniem wypisuje DOWÓD: stan linku z próby (tryb, akceptacja, platnosc_start_at) i jego transakcję.
const path = require('path');
const fs = require('fs');
const os = require('os');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const db = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
const T = 'demo-test';
const ETAP = process.argv[2] || 'podnies';
const PLIK_ROLI = path.join(os.tmpdir(), 'estelio-proba-tpay-rola-oli.txt');
const PLIK_REG = path.join(os.tmpdir(), 'estelio-proba-tpay-regulamin.txt'); // istnieje = regulamin dodała próba, więc próba go usuwa
const REG_URL = 'https://www.estelio.com.pl/regulamin-proba-tpay/';
setTimeout(() => { console.error('TIMEOUT sprzątania'); process.exit(1); }, 20000).unref();

(async () => {
  const wynik = {};
  // dowód z próby (tylko przy sprzątaniu, zanim skasujemy)
  if (ETAP === 'przywroc') {
    const z = await q(`SELECT id, status, tryb, kwota, opis, imie_nazwisko, zaakceptowano_at, otwarto_at, platnosc_start_at FROM ZgodyPlatnosci WHERE tenant_id = ? AND opis LIKE '%próba tpay%' ORDER BY id DESC LIMIT 1`, [T]);
    wynik.dowod_link = z[0] || 'brak';
    if (z[0]) wynik.dowod_transakcja = (await q(`SELECT id, tpay_title, crc, kwota_grosze, status, test_mode, LEFT(payment_url, 60) AS url FROM Tpay_Transakcje WHERE tenant_id = ? AND zgoda_id = ?`, [T, z[0].id]))[0] || 'brak';
    wynik.dowod_konfig = (await q(`SELECT client_id, merchant_id, sandbox, key_version, LENGTH(client_secret_enc) AS secret_len, updated_by FROM Tenant_Tpay WHERE tenant_id = ?`, [T]))[0] || 'brak';
  }
  try { wynik.transakcje = (await q(`DELETE FROM Tpay_Transakcje WHERE tenant_id = ?`, [T])).affectedRows; } catch (e) { wynik.transakcje = 'brak tabeli'; }
  try { wynik.webhook_log = (await q(`DELETE FROM Tpay_Webhook_Log WHERE tenant_id = ? OR tenant_id IS NULL`, [T])).affectedRows; } catch (e) { wynik.webhook_log = 'brak tabeli'; }
  try { wynik.konfig = (await q(`DELETE FROM Tenant_Tpay WHERE tenant_id = ?`, [T])).affectedRows; } catch (e) { wynik.konfig = 'brak tabeli'; }
  wynik.linki = (await q(`DELETE FROM ZgodyPlatnosci WHERE tenant_id = ? AND opis LIKE '%próba tpay%'`, [T])).affectedRows;
  // klientka utworzona przez „osobę spoza bazy” na stronie płatności
  wynik.klientki = (await q(`DELETE FROM Klienci WHERE tenant_id = ? AND imie_nazwisko = 'Próba Tpay'`, [T])).affectedRows;

  if (ETAP === 'podnies') {
    // link wymaga regulaminu salonu — demo-test go nie ma; dodajemy na czas próby (tylko gdy brak)
    const reg = await q(`SELECT id, tresc, url FROM TenantRegulaminy WHERE tenant_id = ? LIMIT 1`, [T]);
    if (!reg[0] || !(String(reg[0].tresc || '').trim() || String(reg[0].url || '').trim())) {
      await q(`INSERT INTO TenantRegulaminy (tenant_id, tresc, url, updated_by) VALUES (?, '', ?, 'próba tpay') ON DUPLICATE KEY UPDATE url = VALUES(url), updated_by = VALUES(updated_by)`, [T, REG_URL]);
      fs.writeFileSync(PLIK_REG, '1'); wynik.regulamin = 'dodany na czas próby';
    } else wynik.regulamin = 'był';
    const r = await q(`SELECT rola FROM Użytkownicy WHERE tenant_id = ? AND imie_login = 'Ola' LIMIT 1`, [T]);
    const rola = r[0] ? r[0].rola : 'manager';
    fs.writeFileSync(PLIK_ROLI, rola);
    wynik.ola_byla = rola;
    wynik.ola = (await q(`UPDATE Użytkownicy SET rola = 'megaadmin' WHERE tenant_id = ? AND imie_login = 'Ola'`, [T])).affectedRows;
  } else {
    const rola = fs.existsSync(PLIK_ROLI) ? fs.readFileSync(PLIK_ROLI, 'utf8').trim() || 'manager' : 'manager';
    wynik.ola_przywrocona = rola;
    wynik.ola = (await q(`UPDATE Użytkownicy SET rola = ? WHERE tenant_id = ? AND imie_login = 'Ola'`, [rola, T])).affectedRows;
    try { fs.unlinkSync(PLIK_ROLI); } catch (e) { /* brak pliku */ }
    if (fs.existsSync(PLIK_REG)) { wynik.regulamin = (await q(`DELETE FROM TenantRegulaminy WHERE tenant_id = ? AND url = ?`, [T, REG_URL])).affectedRows; try { fs.unlinkSync(PLIK_REG); } catch (e) { /* */ } }
  }
  console.log((ETAP === 'podnies' ? 'przygotowane: ' : 'posprzątane: ') + JSON.stringify(wynik));
  db.end();
  process.exit(0);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
