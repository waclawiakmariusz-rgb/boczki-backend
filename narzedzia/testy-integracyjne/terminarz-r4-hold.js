// narzedzia/testy-integracyjne/terminarz-r4-hold.js
// R4 z paczki F: „Skasuj wizytę" na TRZYMANYM terminie musi zgasić link do zadatku.
// Przed poprawką link zostawał aktywny i klientka mogła zapłacić za skasowaną wizytę.
// Działa WYŁĄCZNIE na bazie izolowanej (estelio_test, port 3307) — inaczej odmawia startu.
'use strict';
const mysql = require('mysql2');
const fs = require('fs');

const BAZA = process.env.DB_NAME || '';
const ADRES = `http://127.0.0.1:${process.env.PORT || '3999'}`;
const T = 'demo-test';
if (!/test/i.test(BAZA) || String(process.env.DB_PORT) !== '3307') {
  console.error(`STOP: skrypt pisze do bazy, więc tylko izolowana. DB_NAME=${BAZA}, DB_PORT=${process.env.DB_PORT}`);
  process.exit(1);
}
const db = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: BAZA, dateStrings: true });
const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => (e ? rej(e) : res(r))));

let ok = 0, zle = 0;
const sprawdz = (nazwa, warunek, szcz = '') => {
  if (warunek) { ok++; console.log('  OK   ' + nazwa); }
  else { zle++; console.log('  BŁĄD ' + nazwa + (szcz ? ' → ' + szcz : '')); }
};

(async () => {
  console.log(`\n=== R4: kasowanie trzymanego terminu gasi link do zadatku (${BAZA}) ===\n`);

  // Trzymany termin zakładamy wprost w bazie — ścieżka przez interfejs wymaga zadatków i kreatora,
  // a sprawdzamy zachowanie SERWERA przy kasowaniu, nie sposób założenia holdu.
  await q(`DELETE FROM Term_Rezerwacje WHERE tenant_id = ? AND klient_nazwa = 'Klientka Proba R4'`, [T]);
  const start = '2027-03-10 10:00:00', koniec = '2027-03-10 11:00:00';
  const ins = await q(
    `INSERT INTO Term_Rezerwacje (tenant_id, status, obecnosc, klient_nazwa, id_klienta, start, koniec, kanal, brak_kontaktu, wersja, usunieta, utworzono, zmieniono, hold_do)
     VALUES (?, 'do_wplaty', 'oczekiwana', 'Klientka Proba R4', '1', ?, ?, 'online', 0, 1, 0, NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 2 HOUR))`,
    [T, start, koniec]
  );
  const rezId = ins.insertId;
  await q(`INSERT INTO Term_Pozycje (tenant_id, rezerwacja_id, kolejnosc, kategoria, wariant, cena, czas_min, pracownik, start, koniec, stan, jednostki_wymagane)
           VALUES (?, ?, 0, 'Endermologia', '1x', 200, 60, 'Ola', ?, ?, 'zaplanowana', 0)`, [T, rezId, start, koniec]);

  const przed = await q(`SELECT status, usunieta FROM Term_Rezerwacje WHERE id = ?`, [rezId]);
  sprawdz('przygotowano trzymany termin w stanie do_wplaty', przed[0] && przed[0].status === 'do_wplaty', JSON.stringify(przed[0]));

  // API wymaga sesji salonu (ENFORCE_SESSION). Logujemy się tak samo jak narzędzie prób:
  // hasło z pliku poza repozytorium, potem PIN pracownika.
  const SEKRETY = 'C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt';
  const haslo = fs.readFileSync(SEKRETY, "utf8").split(String.fromCharCode(10)).map(function(x){ return x.replace(String.fromCharCode(13), "").trim(); }).filter(Boolean)[0];
  const postApi = (b, h = {}) => fetch(ADRES + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());
  const logowanie = await postApi({ action: 'login', login: T, haslo });
  const sesja = await postApi({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': logowanie.session_token });
  sprawdz('zalogowano do salonu izolowanego', !!(sesja && sesja.session_token), JSON.stringify(logowanie).slice(0, 90));

  const woApi = async (body) => {
    const r = await fetch(ADRES + '/api/terminarz', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': sesja.session_token },
      body: JSON.stringify({ tenant_id: T, pracownik: 'Ola', ...body }),
    });
    return r.json().catch(() => ({}));
  };

  const przedLink = await woApi({ action: 'trm_hold_link', id: rezId });
  // W izolowanym salonie nie ma wypełnionego regulaminu płatności, więc link odmawia już teraz —
  // ale z INNEGO powodu niż po skasowaniu. Pilnujemy właśnie tej różnicy, nie samego słowa „odmowa”.
  const powodPrzed = String(przedLink.message || '');
  sprawdz('przed skasowaniem odmowa dotyczy konfiguracji, nie stanu wizyty', /regulamin/i.test(powodPrzed), powodPrzed);

  const wersja = (await q(`SELECT wersja FROM Term_Rezerwacje WHERE id = ?`, [rezId]))[0].wersja;
  const usun = await woApi({ action: 'trm_usun', id: rezId, wersja, powod: 'pomyłka przy zapisie — próba R4' });
  sprawdz('kasowanie przyjęte', usun.status === 'success', JSON.stringify(usun).slice(0, 160));
  sprawdz('komunikat mówi wprost o zgaszeniu linku', /Link do zadatku przestał działać/.test(String(usun.message || '')), String(usun.message || ''));

  const po = await q(`SELECT status, usunieta, powod_anulacji FROM Term_Rezerwacje WHERE id = ?`, [rezId]);
  sprawdz('status zmieniony na anulowana', po[0] && po[0].status === 'anulowana', JSON.stringify(po[0]));
  sprawdz('wizyta oznaczona jako usunięta, nie tylko odwołana', po[0] && Number(po[0].usunieta) === 1, JSON.stringify(po[0]));

  const poz = await q(`SELECT stan FROM Term_Pozycje WHERE tenant_id = ? AND rezerwacja_id = ?`, [T, rezId]);
  sprawdz('pozycje anulowane, godzina wraca do puli', poz.every(p => p.stan === 'anulowana'), JSON.stringify(poz));

  const poLink = await woApi({ action: 'trm_hold_link', id: rezId });
  const powodPo = String(poLink.message || '');
  sprawdz('PO skasowaniu link do zadatku ODMAWIA', poLink.status !== 'success', JSON.stringify(poLink).slice(0, 160));
  sprawdz('po skasowaniu odmowa dotyczy już stanu wizyty, nie regulaminu', !/regulamin/i.test(powodPo), powodPo);

  const hist = await q(`SELECT akcja, opis FROM Term_Historia WHERE tenant_id = ? AND rezerwacja_id = ? ORDER BY id`, [T, rezId]).catch(() => []);
  sprawdz('w historii został ślad skasowania z powodem', hist.some(h => h.akcja === 'usunieto' && /próba R4/.test(String(h.opis || ''))), JSON.stringify(hist));

  await q(`DELETE FROM Term_Historia WHERE tenant_id = ? AND rezerwacja_id = ?`, [T, rezId]).catch(() => {});
  await q(`DELETE FROM Term_Pozycje WHERE tenant_id = ? AND rezerwacja_id = ?`, [T, rezId]);
  await q(`DELETE FROM Term_Zajecia WHERE tenant_id = ? AND rezerwacja_id = ?`, [T, rezId]).catch(() => {});
  await q(`DELETE FROM Term_Rezerwacje WHERE id = ?`, [rezId]);
  const zostalo = await q(`SELECT COUNT(*) n FROM Term_Rezerwacje WHERE tenant_id = ? AND klient_nazwa = 'Klientka Proba R4'`, [T]);
  console.log('\n  posprzątano, pozostałych wierszy próby: ' + zostalo[0].n);

  console.log(`\n=== WYNIK: ${ok} zaliczonych, ${zle} obłanych ===\n`);
  db.end();
  process.exit(zle === 0 ? 0 : 1);
})().catch(e => { console.error('WYJĄTEK:', e.message); db.end(); process.exit(1); });
