// narzedzia/testy-integracyjne/klub-reset-odegranie.js
// Odegranie resetu punktów Klubu na bazie IZOLOWANEJ (estelio_test:3307, salon demo-test) z udawanym zegarem serwera.
// Powstało 25.11.2026 do analizy „reset 1 stycznia 2028” (docs/PLAN_PUNKTY_RESET_2028_2026-11-25.md); od tego dnia
// reset idzie po dacie ustawionej przez salon (`Lojalnosc_Ustawienia.nastepny_reset`), a nie po liczniku roku.
//
// Użycie (trzy kroki, serwer testowy między nimi):
//   node narzedzia/testy-integracyjne/klub-reset-odegranie.js zasiew <nastepny_reset RRRR-MM-DD>
//   CZAS_UDAWANY=2028-01-01T10:00:00 node -r ./narzedzia/proby/skrypty/czas-udawany-preload.js -r dotenv/config server.js dotenv_config_path=.env.test
//   (odczekać ~20 s na pierwszy przebieg tickHarmonogramu, zatrzymać serwer)
//   node narzedzia/testy-integracyjne/klub-reset-odegranie.js sprawdz
//   node narzedzia/testy-integracyjne/klub-reset-odegranie.js sprzataj
//
// zasiew: ustawia datę resetu demo-test i wstawia punkty próbne (pracownik PROBA-RESET):
//   1001 = 350 pkt z 2026 + 40 pkt z 2027 · 1002 = 80 (2026) · 1003 = 0 (300 − 300 w 2026) · 1004 = 500 (czerwiec 2027)
//   + 25 pkt naliczone 1.01.2028 00:30 dla 1001 (ma zostać po resecie 1.01.2028)
// sprawdz: wypisuje wpisy WYGASNIECIE, salda, dziennik i datę resetu po przebiegu serwera.
// sprzataj: usuwa wszystko, co próba dodała, i wyłącza reset dla demo-test. Odmawia pracy poza estelio_test:3307.
'use strict';
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test'), quiet: true });
if (process.env.DB_NAME !== 'estelio_test' || String(process.env.DB_PORT) !== '3307') throw new Error('To nie jest baza izolowana — odmowa');
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2', 'promise'));
const T = 'demo-test', KTO = 'PROBA-RESET';
const AKCJE = ['KLUB RESET ROCZNY', 'KLUB RESET PUNKTÓW', 'KLUB DATA RESETU'];
const [tryb, arg] = process.argv.slice(2);
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true });
  const q = (s, p = []) => c.query(s, p).then(([r]) => r);
  const kolumny = (await q(`SHOW COLUMNS FROM Lojalnosc_Ustawienia`)).map((r) => r.Field);
  if (!kolumny.includes('nastepny_reset')) throw new Error('Brak kolumny nastepny_reset — uruchom najpierw serwer testowy (migracja ALTER przy starcie).');
  if (tryb === 'zasiew') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(arg || '')) throw new Error('podaj datę resetu RRRR-MM-DD');
    await q(`DELETE FROM Lojalnosc_Punkty WHERE tenant_id = ? AND (pracownik = ? OR zrodlo = 'WYGASNIECIE')`, [T, KTO]);
    await q(`DELETE FROM Logi WHERE tenant_id = ? AND akcja IN (?)`, [T, AKCJE]);
    const r = await q(`UPDATE Lojalnosc_Ustawienia SET reset_roczny = 1, nastepny_reset = ?, ostatni_reset_rok = 0 WHERE tenant_id = ?`, [arg, T]);
    if (!r.affectedRows) throw new Error('demo-test nie ma wiersza Lojalnosc_Ustawienia — zapisz ustawienia Klubu w panelu i spróbuj ponownie');
    const wpisy = [
      ['1001', 200, '2026-09-10 12:00:00', 'A'], ['1001', 150, '2026-11-20 12:00:00', 'B'], ['1001', 40, '2027-01-01 00:30:00', 'C'],
      ['1002', 80, '2026-10-05 12:00:00', 'D'],
      ['1003', 300, '2026-08-01 12:00:00', 'E'], ['1003', -300, '2026-10-01 12:00:00', 'F'],
      ['1004', 500, '2027-06-15 12:00:00', 'G'],
      ['1001', 25, '2028-01-01 00:30:00', 'H'],
    ];
    for (const [id, zm, kiedy, ref] of wpisy) await q(`INSERT INTO Lojalnosc_Punkty (tenant_id, id_klienta, zmiana, powod, zrodlo, ref_id, pracownik, created_at) VALUES (?, ?, ?, 'próba resetu', 'RECZNE', ?, ?, ?)`, [T, id, zm, 'PROBA-RESET-' + ref, KTO, kiedy]);
    console.log(`zasiane: reset_roczny=1, nastepny_reset=${arg}; punkty: 1001 = 350 (2026) + 40 (1.01.2027 00:30) + 25 (1.01.2028 00:30), 1002 = 80 (2026), 1003 = 0 (2026), 1004 = 500 (czerwiec 2027)`);
  } else if (tryb === 'sprawdz') {
    const u = await q(`SELECT reset_roczny, nastepny_reset, ostatni_reset_rok, reset_zmienil, reset_zmieniono FROM Lojalnosc_Ustawienia WHERE tenant_id = ?`, [T]);
    const w = await q(`SELECT id_klienta, zmiana, ref_id, created_at FROM Lojalnosc_Punkty WHERE tenant_id = ? AND zrodlo = 'WYGASNIECIE' ORDER BY id_klienta`, [T]);
    const s = await q(`SELECT id_klienta, SUM(zmiana) saldo FROM Lojalnosc_Punkty WHERE tenant_id = ? AND (pracownik = ? OR zrodlo = 'WYGASNIECIE') GROUP BY id_klienta ORDER BY id_klienta`, [T, KTO]);
    const l = await q(`SELECT data_zdarzenia, akcja, pracownik, opis FROM Logi WHERE tenant_id = ? AND akcja IN (?) ORDER BY data_zdarzenia`, [T, AKCJE]);
    console.log('ustawienia po:', JSON.stringify(u[0]));
    console.log('WYGASNIECIE:', w.length ? w.map((x) => `${x.id_klienta}: ${x.zmiana} (${x.ref_id}, ${x.created_at})`).join(' | ') : 'brak');
    console.log('salda po:', s.map((x) => `${x.id_klienta}=${x.saldo}`).join(', '));
    console.log('dziennik:', l.length ? l.map((x) => `${x.data_zdarzenia} [${x.akcja}] ${x.pracownik}: ${x.opis}`).join('\n          ') : 'brak');
  } else if (tryb === 'sprzataj') {
    const a = await q(`DELETE FROM Lojalnosc_Punkty WHERE tenant_id = ? AND (pracownik = ? OR zrodlo = 'WYGASNIECIE')`, [T, KTO]);
    const b = await q(`DELETE FROM Logi WHERE tenant_id = ? AND akcja IN (?)`, [T, AKCJE]);
    await q(`UPDATE Lojalnosc_Ustawienia SET reset_roczny = 0, nastepny_reset = NULL, ostatni_reset_rok = 0, reset_zmienil = '', reset_zmieniono = NULL WHERE tenant_id = ?`, [T]);
    const r = await q(`SELECT COUNT(*) n FROM Lojalnosc_Punkty WHERE tenant_id = ?`, [T]);
    console.log(`posprzątane: punkty ${a.affectedRows}, dziennik ${b.affectedRows}; reset wyłączony; zostało wpisów punktów demo-test: ${r[0].n}`);
  } else throw new Error('tryb: zasiew <RRRR-MM-DD> | sprawdz | sprzataj');
  await c.end();
})().catch((e) => { console.error('BŁĄD:', e.message); process.exit(1); });
