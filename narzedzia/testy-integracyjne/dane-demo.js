// narzedzia/testy-integracyjne/dane-demo.js — FIKCYJNY salon `demo-test` w izolowanej bazie (.env.test) do prób UI/zrzutów ZK-03.
//   Zestawy z decyzji ZK-02 §10 (A–D) + przypadki negatywne: rozbita sprzedaż (portfel + dopłata), zwykłe „1x”, sam portfel, kosmetyk,
//   dwie klientki o tej samej nazwie, 6 przyszłych wizyt bez źródła (zestaw D). Bez danych osobowych. Hasło konta salonu losowe → zapis TYLKO do
//   pliku wskazanego w --haslo-do (poza repo). PIN-y testowe: Ola (manager) 1111, Anna (kosmetolog) 2222 — wyłącznie baza testowa.
//   node narzedzia/testy-integracyjne/dane-demo.js --haslo-do <plik>
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const mysql = require('mysql2/promise'); const bcrypt = require('bcrypt');
const ROOT = path.join(__dirname, '..', '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const T = arg('--tenant') || 'demo-test'; // --tenant <id> = inny fikcyjny salon (W06); --env <plik> = inna izolowana baza (nigdy .env)
const ENV_PLIK = arg('--env') || '.env.test'; if (ENV_PLIK === '.env' || !/^[a-z0-9-]{3,40}$/.test(T)) { console.error('ODMOWA: baza z .env albo nieprawidłowy tenant.'); process.exit(4); }
function envZ(plik) { if (!fs.existsSync(plik)) return null; const out = {}; for (const l of fs.readFileSync(plik, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } return out; }
(async () => {
  const cel = envZ(path.join(ROOT, ENV_PLIK)), prod = envZ(path.join(ROOT, '.env'));
  if (!cel || !cel.DB_NAME) { console.error('Brak .env.test'); process.exit(3); }
  if (prod && String(prod.DB_HOST).trim() === String(cel.DB_HOST).trim() && String(prod.DB_NAME).trim() === String(cel.DB_NAME).trim()) { console.error('ODMOWA: baza wspólna z .env'); process.exit(4); }
  const c = await mysql.createConnection({ host: cel.DB_HOST, port: Number(cel.DB_PORT || 3306), user: cel.DB_USER, password: cel.DB_PASSWORD, database: cel.DB_NAME, charset: 'utf8mb4' });
  const q = async (s, p = []) => (await c.query(s, p))[0];
  for (const t of ['Term_Zakupy_Ruchy2', 'Term_Realizacje', 'Term_Przydzialy', 'Term_Operacje', 'Term_Zakupy_Skladniki', 'Term_Zakupy', 'Term_Zajecia', 'Term_Pozycje', 'Term_Rezerwacje', 'Term_Ewidencja', 'Term_Oferty_Skladniki', 'Term_Oferty_Wersje', 'Term_Oferty', 'Term_Sprawy', 'Term_Uslugi', 'Term_Ustawienia', 'Term_Grafik', 'Term_Pracownicy', 'Sprzedaz', 'Zadatki', 'Uslugi', 'Klienci', 'Użytkownicy', 'Pracownicy', 'Tenant_Features', 'Sesje']) await q(`DELETE FROM ${t} WHERE tenant_id = ?`, [T]).catch(() => {});
  await q(`DELETE FROM Licencje WHERE login = ?`, [T]);
  const haslo = crypto.randomBytes(9).toString('base64url'); const hash = await bcrypt.hash(haslo, 10);
  await q(`INSERT INTO Licencje (login, haslo, rola, id_bazy, status, nazwa_salonu, email, data_waznosci) VALUES (?, ?, 'salon', ?, 'aktywny', 'Salon testowy ZK-03', 'test@example.invalid', DATE_ADD(CURDATE(), INTERVAL 365 DAY))`, [T, hash, T]);
  if (arg('--haslo-do')) fs.writeFileSync(arg('--haslo-do'), haslo);
  await q(`INSERT INTO Użytkownicy (id, tenant_id, imie_login, haslo_pin, rola) VALUES (UUID(), ?, 'Ola', '1111', 'manager'), (UUID(), ?, 'Anna', '2222', 'kosmetolog')`, [T, T]);
  await q(`INSERT INTO Pracownicy (id, tenant_id, imie) VALUES (UUID(), ?, 'Anna'), (UUID(), ?, 'Ola')`, [T, T]);
  await q(`INSERT INTO Tenant_Features (tenant_id, feature_key, enabled, activated_at, activated_by) VALUES (?, 'terminarz', 1, NOW(), 'test')`, [T]);
  const U = { A: 'DEMO-U-A', A5: 'DEMO-U-A5', A10: 'DEMO-U-A10', B: 'DEMO-U-B', AB: 'DEMO-U-AB', K1: 'DEMO-U-K1', KOS: 'DEMO-U-KOS' };
  for (const [id, kat, war, cena] of [[U.A, 'Endermologia', '1x', 200], [U.A5, 'Endermologia', '5x', 900], [U.A10, 'Endermologia', '10x', 1700], [U.B, 'Meltivio', '1x', 300], [U.AB, 'Pakiet łączony', '5 × endermologia + 4 × Meltivio', 2000], [U.K1, 'Konsultacja', '1x z góry', 150]]) await q(`INSERT INTO Uslugi (id, tenant_id, kategoria, wariant, cena, waznosc_dni) VALUES (?, ?, ?, ?, ?, 180)`, [id, T, kat, war, cena]);
  for (const id of [U.A, U.B, U.K1]) await q(`INSERT INTO Term_Uslugi (tenant_id, usluga_id, czas_min) VALUES (?, ?, 30)`, [T, id]);
  await q(`INSERT INTO Term_Ustawienia (tenant_id, godziny_json) VALUES (?, ?)`, [T, JSON.stringify({ 1: [{ od: '08:00', do: '20:00' }], 2: [{ od: '08:00', do: '20:00' }], 3: [{ od: '08:00', do: '20:00' }], 4: [{ od: '08:00', do: '20:00' }], 5: [{ od: '08:00', do: '20:00' }], 6: [{ od: '09:00', do: '14:00' }], 7: [] })]);
  for (let d = 1; d <= 6; d++) await q(`INSERT INTO Term_Grafik (tenant_id, pracownik, dzien_tyg, od, do_) VALUES (?, 'Anna', ?, '08:00', '20:00')`, [T, d]);
  const oferta = async (uid, rodzaj, skl) => { const o = (await q(`INSERT INTO Term_Oferty (tenant_id, usluga_id, stan, zrodlo, zatwierdzil, zatwierdzono, zmieniono) VALUES (?, ?, 'zatwierdzona', 'reczne', 'Ola', NOW(), NOW())`, [T, uid])).insertId; const w = (await q(`INSERT INTO Term_Oferty_Wersje (tenant_id, oferta_id, wersja, rodzaj, stan, obowiazuje_od, autor) VALUES (?, ?, 1, ?, 'zatwierdzona', '2026-01-01 00:00:00', 'Ola')`, [T, o, rodzaj])).insertId; for (const s of skl) await q(`INSERT INTO Term_Oferty_Skladniki (tenant_id, oferta_id, wersja_id, usluga_wyk_id, jednostki) VALUES (?, ?, ?, ?, ?)`, [T, o, w, s[0], s[1]]); };
  const maV2 = (await q("SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Term_Oferty_Wersje'"))[0].n > 0; // baza bez schematu v2 (W06): salon bez ofert/ewidencji, sam kalendarz
  if (maV2) { await oferta(U.A5, 'pakiet', [[U.A, 5]]); await oferta(U.A10, 'pakiet', [[U.A, 10]]); await oferta(U.AB, 'pakiet', [[U.A, 5], [U.B, 4]]); await oferta(U.A, 'nie_ewidencjonuj', []); await oferta(U.K1, 'pojedynczy_z_gory', [[U.K1, 1]]); }
  const klientki = [['1001', 'Zestaw A (zwykły pakiet)'], ['1002', 'Zestaw B (pakiet łączony)'], ['1003', 'Zestaw C (dwa zakupy)'], ['1004', 'Zestaw D (stary pakiet z wizytami)'], ['1005', 'Zestaw E (portfel + dopłata)'], ['1006', 'Anna Nowak'], ['1007', 'Anna Nowak'], ['1008', 'Lena (tylko portfel)']];
  for (const [id, n] of klientki) await q(`INSERT INTO Klienci (id, tenant_id, id_klienta, imie_nazwisko, telefon, data_rejestracji, status) VALUES (UUID(), ?, ?, ?, '600000000', NOW(), 'AKTYWNY')`, [T, id, n]);
  const sp = async (id, idk, zabieg, szczegoly, kwota, extra = {}) => q(`INSERT INTO Sprzedaz (id, tenant_id, data_sprzedazy, klient, zabieg, szczegoly, kwota, status, platnosc, id_klienta, sprzedawca, grupa_id, data_waznosci) VALUES (?, ?, ?, ?, ?, ?, ?, 'AKTYWNY', ?, ?, 'Ola', ?, ?)`, [id, T, extra.data || '2026-10-12 11:00:00', klientki.find(k => k[0] === idk)[1], zabieg, szczegoly, kwota, extra.platnosc || 'Karta', idk, extra.grupa_id || null, extra.data_waznosci || null]);
  await sp('DEMO-A-1', '1001', 'Endermologia', '10x', 1700, { data: '2026-09-01 11:00:00', data_waznosci: '2027-03-01' });
  await sp('DEMO-B-1', '1002', 'Pakiet łączony', '5 × endermologia + 4 × Meltivio', 2000, { data: '2026-10-12 11:00:00', data_waznosci: '2027-04-10' });
  await sp('DEMO-C1-1', '1003', 'Endermologia', '5x', 900, { data: '2026-08-15 11:00:00', data_waznosci: '2026-11-15' }); await sp('DEMO-C2-1', '1003', 'Endermologia', '5x', 900, { data: '2026-10-10 11:00:00', data_waznosci: '2027-04-08' });
  await sp('DEMO-D-1', '1004', 'Endermologia', '10x', 1700, { data: '2026-07-01 11:00:00', data_waznosci: '2027-01-01' });
  await sp('DEMO-E-1', '1005', 'Endermologia', '5x', 200, { platnosc: 'Portfel' }); await sp('DEMO-E-2', '1005', 'Endermologia Dopłata', '', 700, { platnosc: 'Karta' });
  await sp('DEMO-F-1', '1001', 'Endermologia', '1x', 200, { data: '2026-10-14 11:00:00' }); await sp('DEMO-F-2', '1001', 'Kosmetyk: Krem', '1 szt.', 120, { data: '2026-10-14 11:00:00' }); await q(`UPDATE Sprzedaz SET kategoria_produktu = 'Kosmetyk' WHERE tenant_id = ? AND id = 'DEMO-F-2'`, [T]);
  await sp('DEMO-H-1', '1006', 'Endermologia', '5x', 900); await sp('DEMO-H-2', '1007', 'Endermologia', '5x', 900);
  await sp('DEMO-G-1', '1002', 'Pakiet łączony', '5 × endermologia + 4 × Meltivio', 2000, { grupa_id: 'GRP-DEMO', data: '2026-10-13 11:00:00' }); await sp('DEMO-G-2', '1002', 'Pakiet łączony', '5 × endermologia + 4 × Meltivio', 2000, { grupa_id: 'GRP-DEMO', data: '2026-10-13 11:00:00' });
  await sp('DEMO-K-1', '1001', 'Konsultacja', '1x z góry', 150, { data: '2026-10-15 11:00:00' });
  await q(`INSERT INTO Zadatki (id, tenant_id, id_klienta, data_wplaty, klient, typ, kwota, metoda, cel, status, pracownicy) VALUES ('DEP-DEMO-1', ?, '1008', NOW(), 'Lena (tylko portfel)', 'WPŁATA', 1500, 'Przelew', '5 × endermologia', 'AKTYWNY', 'Ola')`, [T]);
  // zestaw D: 6 przyszłych wizyt bez źródła (+1 przeszła nierozstrzygnięta), zestaw A: 2 przyszłe
  const wizyta = async (idk, start, usluga = U.A, kat = 'Endermologia', war = '1x') => { const koniec = start.slice(0, 11) + String(Number(start.slice(11, 13)) + 1).padStart(2, '0') + ':00:00'; const r = (await q(`INSERT INTO Term_Rezerwacje (tenant_id, id_klienta, klient_nazwa, start, koniec, utworzyl) VALUES (?, ?, ?, ?, ?, 'Ola')`, [T, idk, klientki.find(k => k[0] === idk)[1], start, koniec])).insertId; await q(`INSERT INTO Term_Pozycje (tenant_id, rezerwacja_id, usluga_id, kategoria, wariant, cena, czas_min, pracownik, start, koniec) VALUES (?, ?, ?, ?, ?, 200, 30, 'Anna', ?, ?)`, [T, r, usluga, kat, war, start, start.slice(0, 11) + start.slice(11, 13) + ':30:00']); };
  for (const d of ['2026-10-13 10:00:00', '2026-10-21 10:00:00', '2026-10-28 10:00:00', '2026-11-04 10:00:00', '2026-11-18 10:00:00', '2026-12-02 10:00:00', '2026-12-16 10:00:00']) await wizyta('1004', d); // 1 przeszła nierozstrzygnięta + 6 przyszłych w okresie ważności (do 2027-01-01)
  for (const d of ['2026-10-22 12:00:00', '2026-11-05 12:00:00']) await wizyta('1001', d);
  for (let i = 1; i <= 7; i++) await wizyta('1005', `2026-11-${String(i + 9).padStart(2, '0')} 09:00:00`); // zestaw E: 5 praw (rozbita sprzedaż) i 7 wizyt → niedobór 2
  if (maV2) await q(`INSERT INTO Term_Ewidencja (tenant_id, tryb, zmienil, zmieniono) VALUES (?, 'przygotowanie', 'Ola', NOW())`, [T]);
  const n = await q(`SELECT (SELECT COUNT(*) FROM Sprzedaz WHERE tenant_id = ?) s, (SELECT COUNT(*) FROM Klienci WHERE tenant_id = ?) k, (SELECT COUNT(*) FROM Term_Pozycje WHERE tenant_id = ?) p`, [T, T, T]);
  console.log(`salon ${T}: sprzedaży ${n[0].s}, klientek ${n[0].k}, pozycji wizyt ${n[0].p}; login salonu = ${T} (hasło w pliku --haslo-do), PIN Ola/1111 (manager), Anna/2222`);
  await c.end();
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
