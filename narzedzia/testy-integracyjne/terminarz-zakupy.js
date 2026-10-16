// narzedzia/testy-integracyjne/terminarz-zakupy.js — ZK-02: próby K05–K08, K11, K13 na RZECZYWISTEJ, IZOLOWANEJ bazie (.env.test).
//
//   node narzedzia/testy-integracyjne/terminarz-zakupy.js            # wymaga .env.test; odmawia, gdy to ta sama baza co w .env
//   node narzedzia/testy-integracyjne/terminarz-zakupy.js --zostaw   # nie czyści danych testowych po przebiegu (do oględzin)
//
// Co robi: (1) migracja v2 (K11: dwa przebiegi — drugi „już było”), (2) fikcyjne dane: 4 zestawy A–D z decyzji ZK-02 §10 (bez danych
// osobowych; klientki „Zestaw A/B/C/D”, salon testowy `zk02-test`), (3) K05 wyścig dwóch POŁĄCZEŃ o ostatnią jednostkę, (4) K06 równoczesne
// wykonanie i odwołanie, (5) K07 awaria przed COMMIT (rollback) i ponowienie po COMMIT (brak duplikatu), (6) K08 atomowa zmiana źródła,
// (7) K13 zmiana wiersza Sprzedaz między podglądem a zapisem. Każda próba ma osobny wynik PASS/FAIL; kod wyjścia ≠ 0 przy FAIL.
// Nigdy nie dotyka salonów innych niż `zk02-test`. Hasła nie są logowane.
'use strict';
const fs = require('fs'); const path = require('path');
const mysql = require('mysql2/promise');
const Z = require('../../routes/terminarz-zakupy');
const ROOT = path.join(__dirname, '..', '..');
const ZOSTAW = process.argv.includes('--zostaw');
const T = 'zk02-test';
function envZ(plik) { if (!fs.existsSync(plik)) return null; const out = {}; for (const l of fs.readFileSync(plik, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } return out; }
const wyniki = []; const PASS = (id, opis, dowod) => { wyniki.push({ id, wynik: 'PASS', opis, dowod }); console.log(`PASS ${id} — ${opis}${dowod ? ' · ' + dowod : ''}`); };
const FAIL = (id, opis, dowod) => { wyniki.push({ id, wynik: 'FAIL', opis, dowod }); console.log(`FAIL ${id} — ${opis}${dowod ? ' · ' + dowod : ''}`); };
const sprawdz = (id, warunek, opis, dowod) => (warunek ? PASS : FAIL)(id, opis, dowod);

(async () => {
  const cel = envZ(path.join(ROOT, '.env.test')), prod = envZ(path.join(ROOT, '.env'));
  if (!cel || !cel.DB_HOST || !cel.DB_NAME) { console.error('Brak .env.test (DB_HOST/DB_NAME). Izolowane środowisko nie jest skonfigurowane — próby K05–K08/K11/K13: NIE WYKONANO. Nic nie uruchomiono.'); process.exit(3); }
  if (prod && String(prod.DB_HOST).trim() === String(cel.DB_HOST).trim() && String(prod.DB_NAME).trim() === String(cel.DB_NAME).trim()) { console.error('ODMOWA: .env.test wskazuje tę samą bazę co .env (współdzielona z produkcją). Próby zapisujące nie zostaną wykonane.'); process.exit(4); }
  const cfg = { host: cel.DB_HOST, port: Number(cel.DB_PORT || 3306), user: cel.DB_USER, password: cel.DB_PASSWORD, database: cel.DB_NAME, charset: 'utf8mb4', dateStrings: true };
  const c0 = await mysql.createConnection(cfg);
  const qx = async (sql, p = []) => (await c0.query(sql, p))[0];
  const [[info]] = await c0.query('SELECT DATABASE() AS d, @@version AS v'); console.log(`baza: ${info.d} (${info.v}) — izolowana (różna od .env)`);

  // ── wymagane tabele rdzenia/terminarza w izolowanej bazie (gdy baza świeża, bez kopii tenanta): minimalne definicje zgodne z rzeczywistą bazą
  const DDL_MIN = [
    `CREATE TABLE IF NOT EXISTS Sprzedaz (id VARCHAR(50) NOT NULL PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, data_sprzedazy DATETIME NULL, klient VARCHAR(255) NULL, zabieg VARCHAR(255) NULL, sprzedawca TEXT NULL, kwota DECIMAL(10,2) NULL, komentarz TEXT NULL, szczegoly TEXT NULL, status VARCHAR(50) DEFAULT 'AKTYWNY', platnosc VARCHAR(50) NULL, id_klienta VARCHAR(50) NULL, pracownik_dodajacy VARCHAR(100) NULL, id_zadatku TEXT NULL, utworzono_w TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, czy_rozliczone TINYINT NOT NULL DEFAULT 0, typ_zabiegu VARCHAR(80) NULL, kategoria_produktu ENUM('Kosmetyk','Suplement') NULL, data_waznosci DATE NULL, karnet_zamkniety_w DATETIME NULL, karnet_zamkniety_przez VARCHAR(100) NULL, grupa_id VARCHAR(40) NULL, zwrot_do_id VARCHAR(50) NULL, zawieszenia_dni_lacznie INT NOT NULL DEFAULT 0, zawieszenia_liczba INT NOT NULL DEFAULT 0, KEY idx_tenant (tenant_id))`,
    `CREATE TABLE IF NOT EXISTS Term_Migracje (nazwa VARCHAR(120) NOT NULL PRIMARY KEY, wersja VARCHAR(20) NOT NULL, obecna TINYINT(1) NOT NULL DEFAULT 0, sprawdzono DATETIME NOT NULL, uwaga VARCHAR(255) NULL)`,
    `CREATE TABLE IF NOT EXISTS Term_Rezerwacje (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, id_klienta VARCHAR(50) NULL, klient_nazwa VARCHAR(255) NOT NULL, klient_telefon VARCHAR(50) NULL, status VARCHAR(20) NOT NULL DEFAULT 'potwierdzona', obecnosc VARCHAR(20) NOT NULL DEFAULT 'oczekiwana', kanal VARCHAR(20) NOT NULL DEFAULT 'recepcja', zrodlo VARCHAR(100) NULL, start DATETIME NOT NULL, koniec DATETIME NOT NULL, notatka TEXT NULL, brak_kontaktu TINYINT(1) NOT NULL DEFAULT 0, wersja INT NOT NULL DEFAULT 1, klucz_idem VARCHAR(64) NULL, utworzyl VARCHAR(100) NULL, utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, zmieniono DATETIME NULL, anulowano DATETIME NULL, anulowal VARCHAR(100) NULL, powod_anulacji VARCHAR(255) NULL, kto_anulowal VARCHAR(20) NULL, obecnosc_zmieniono DATETIME NULL, rozliczenie_od DATETIME NULL, sprzedaz_id VARCHAR(50) NULL, UNIQUE KEY uq_idem (tenant_id, klucz_idem))`,
    `CREATE TABLE IF NOT EXISTS Term_Pozycje (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, rezerwacja_id INT NOT NULL, kolejnosc INT NOT NULL DEFAULT 0, usluga_id VARCHAR(36) NULL, kategoria VARCHAR(255) NOT NULL, wariant VARCHAR(255) NULL, cena DECIMAL(10,2) NULL, czas_min INT NOT NULL, pracownik VARCHAR(100) NOT NULL, start DATETIME NOT NULL, koniec DATETIME NOT NULL, gabinet_id INT NULL, urzadzenie_id INT NULL, stan VARCHAR(20) NOT NULL DEFAULT 'zaplanowana', start_fakt DATETIME NULL, koniec_fakt DATETIME NULL, wykonawca_fakt VARCHAR(100) NULL, sprzedaz_id VARCHAR(50) NULL, zakup_skladnik_id INT NULL)`,
    `CREATE TABLE IF NOT EXISTS Term_Ustawienia (tenant_id VARCHAR(100) NOT NULL PRIMARY KEY, tryb VARCHAR(20) NOT NULL DEFAULT 'wewnetrzny', siatka_min INT NOT NULL DEFAULT 15, tolerancja_min INT NOT NULL DEFAULT 10, horyzont_dni INT NOT NULL DEFAULT 90, wyprzedzenie_min INT NOT NULL DEFAULT 0, godziny_json TEXT NULL, wersja INT NOT NULL DEFAULT 1, zmieniono DATETIME NULL, kontrola_zakupow VARCHAR(5) NOT NULL DEFAULT 'off')`,
    `CREATE TABLE IF NOT EXISTS Term_Uslugi (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, usluga_id VARCHAR(36) NOT NULL, czas_min INT NULL, aktywna TINYINT(1) NOT NULL DEFAULT 1, wersja INT NOT NULL DEFAULT 1, UNIQUE KEY uq_usluga (tenant_id, usluga_id))`,
    `CREATE TABLE IF NOT EXISTS Term_Oferty (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, usluga_id VARCHAR(36) NOT NULL, stan VARCHAR(16) NOT NULL DEFAULT 'propozycja', zrodlo VARCHAR(16) NOT NULL DEFAULT 'tekst', zatwierdzil VARCHAR(100) NULL, zatwierdzono DATETIME NULL, zmieniono DATETIME NULL, UNIQUE KEY uq_oferta (tenant_id, usluga_id))`,
    `CREATE TABLE IF NOT EXISTS Term_Oferty_Skladniki (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, oferta_id INT NOT NULL, usluga_wyk_id VARCHAR(36) NOT NULL, jednostki INT NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS Term_Zakupy (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, sprzedaz_id VARCHAR(50) NOT NULL, id_klienta VARCHAR(50) NULL, klient_nazwa VARCHAR(255) NULL, oferta_id INT NOT NULL, usluga_id VARCHAR(36) NOT NULL, nazwa VARCHAR(300) NULL, data_zakupu DATE NULL, data_waznosci DATE NULL, stan VARCHAR(16) NOT NULL DEFAULT 'aktywny', bilans_status VARCHAR(20) NOT NULL DEFAULT 'niezweryfikowany', zweryfikowal VARCHAR(100) NULL, zweryfikowano DATETIME NULL, powod_korekty VARCHAR(300) NULL, utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_sprz (tenant_id, sprzedaz_id))`,
    `CREATE TABLE IF NOT EXISTS Term_Zakupy_Skladniki (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, zakup_id INT NOT NULL, usluga_wyk_id VARCHAR(36) NOT NULL, jednostki_przyznane INT NOT NULL DEFAULT 1, jednostki_historyczne INT NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS Term_Zakupy_Ruchy (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, skladnik_id INT NOT NULL, pozycja_id INT NULL, typ VARCHAR(12) NOT NULL, jednostki INT NOT NULL DEFAULT 1, kto VARCHAR(100) NULL, kiedy DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, powod VARCHAR(300) NULL, UNIQUE KEY uq_poz_typ (tenant_id, pozycja_id, typ))`,
  ];
  for (const sql of DDL_MIN) await qx(sql);

  // ── K11: migracja v2 dwa razy
  const m1 = await Z.migrujV2(qx, { log: console }); const m2 = await Z.migrujV2(qx, { log: console });
  sprawdz('K11', !m1.zatrzymano && !m1.bledy.length && m2.zastosowano.length === 0 && m2.bledy.length === 0, 'migracja v2 wykonana i powtarzalna', `1. przebieg: ${m1.zastosowano.length} zastosowano/${m1.juzBylo.length} było; 2. przebieg: ${m2.juzBylo.length} „już było”, 0 nowych`);
  const sv2 = await Z.sprawdzSchematV2(qx, console); sprawdz('K11b', sv2.gotowy, 'sprawdzSchematV2 widzi komplet elementów', `braki: ${sv2.braki.length}`);

  // ── sprzątanie salonu testowego (tylko tenant zk02-test)
  const czysc = async () => { for (const t of ['Term_Zakupy_Ruchy2', 'Term_Realizacje', 'Term_Przydzialy', 'Term_Operacje', 'Term_Zakupy_Skladniki', 'Term_Zakupy', 'Term_Pozycje', 'Term_Rezerwacje', 'Term_Ewidencja', 'Sprzedaz']) await qx(`DELETE FROM ${t} WHERE tenant_id = ?`, [T]); };
  await czysc();
  await qx(`INSERT INTO Term_Ewidencja (tenant_id, tryb, rozpoczeto, zmienil, zmieniono) VALUES (?, 'aktywna', NOW(), 'test', NOW())`, [T]);

  // ── pomocnicze: transakcja pod blokadą salonu na WSKAZANYM połączeniu (jak wTransakcjiSalonu w routes/terminarz.js)
  const teraz = async (c) => (await c.query(`SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS t`))[0][0].t;
  async function wTx(c, fn, { awariaPrzedCommit = false } = {}) {
    const [[lock]] = await c.query(`SELECT GET_LOCK(?, 8) AS l`, ['trm:' + T]); if (Number(lock.l) !== 1) throw new Error('brak blokady');
    try { await c.beginTransaction(); const repo = Z.repoSql(async (sql, p) => (await c.query(sql, p))[0], T); const ctx = { tenant: T, autor: 'Tester', rola: 'manager', teraz: await teraz(c), tryb: 'aktywna' };
      try { const w = await fn(repo, ctx); if (awariaPrzedCommit) throw new Error('SYMULOWANA AWARIA PRZED COMMIT'); await c.commit(); return w; } catch (e) { await c.rollback(); throw e; } }
    finally { await c.query(`SELECT RELEASE_LOCK(?)`, ['trm:' + T]); }
  }
  const nowaPozycja = async (idK, usluga = 'U-A', start = '2026-11-03 10:00:00') => { const r = (await qx(`INSERT INTO Term_Rezerwacje (tenant_id, id_klienta, klient_nazwa, start, koniec) VALUES (?, ?, ?, ?, ?)`, [T, idK, 'Zestaw ' + idK, start, start])).insertId; return (await qx(`INSERT INTO Term_Pozycje (tenant_id, rezerwacja_id, usluga_id, kategoria, czas_min, pracownik, start, koniec) VALUES (?, ?, ?, 'Endermologia', 30, 'Tester', ?, ?)`, [T, r, usluga, start, start])).insertId; };
  const saldo = async (sid) => { const repo = Z.repoSql(qx, T); return (await Z.domena.saldoSkladnikow(repo, [sid]))[sid]; };
  const rezerwuj = (repo, ctx, poz, skl, data = '2026-11-03') => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: poz, skladnik_id: skl, usluga_id: 'U-A' }], id_klienta: String(skl.id_klienta || ctxK), data, uslugaPozycji: (p) => p.usluga_id });
  let ctxK = 'A';

  // ── Zestaw A: 10 endermologii, 3 historyczne, 4 umówione, 3 wolne (zestaw D jest wariantem A z weryfikacją 10/3 i 6 wizytami)
  const A = await wTx(c0, (repo, ctx) => Z.domena.przyznaj(repo, ctx, { id_klienta: 'A', usluga_wyk_id: 'U-A', usluga_nazwa: 'Endermologia', jednostki: 10, powod: 'zestaw A', zweryfikowany: false }));
  await wTx(c0, (repo, ctx) => Z.domena.weryfikujSkladnik(repo, ctx, { skladnik_id: A.skladnik_id, hist_wykorzystane: 3, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'zestaw A: 3 wykonane przed uruchomieniem' }));
  await wTx(c0, (repo, ctx) => Z.domena.uruchomSkladnik(repo, ctx, { skladnik_id: A.skladnik_id, potwierdzenie_zaleznych: true }));
  const pozA = []; for (let i = 0; i < 4; i++) { const p = await nowaPozycja('A'); pozA.push(p); await wTx(c0, (repo, ctx) => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: p, skladnik_id: A.skladnik_id, usluga_id: 'U-A' }], id_klienta: 'A', data: '2026-11-03', uslugaPozycji: x => x.usluga_id })); }
  let sA = await saldo(A.skladnik_id); sprawdz('A0', sA.U === 3 && sA.R === 4 && sA.B === 3, 'zestaw A: U=3, R=4, B=3', JSON.stringify({ U: sA.U, R: sA.R, B: sA.B }));
  const w = await wTx(c0, (repo, ctx) => Z.domena.wykonaj(repo, ctx, { pozycja_id: pozA[0], wykonawca_fakt: 'Tester' })); sA = await saldo(A.skladnik_id); sprawdz('A1', sA.U === 4 && sA.R === 3 && sA.B === 3, 'wykonanie jednej: 4/3/3', JSON.stringify({ U: sA.U, R: sA.R, B: sA.B }));
  await wTx(c0, (repo, ctx) => Z.domena.zwolnij(repo, ctx, { pozycja_id: pozA[1], powod: 'odwołanie' })); sA = await saldo(A.skladnik_id); sprawdz('A2', sA.U === 4 && sA.R === 2 && sA.B === 4, 'odwołanie jednej: 4/2/4', JSON.stringify({ U: sA.U, R: sA.R, B: sA.B }));
  // K03 na bazie: wykonaj → cofnij → wykonaj ponownie (bez blokady UNIQUE)
  await wTx(c0, (repo, ctx) => Z.domena.odwrocRealizacje(repo, ctx, { realizacja_id: w.realizacje[0].id, wynik: 'odbedzie_sie', powod: 'pomyłka', data: '2026-11-03' }));
  const w2 = await wTx(c0, (repo, ctx) => Z.domena.wykonaj(repo, ctx, { pozycja_id: pozA[0], wykonawca_fakt: 'Tester' })); sA = await saldo(A.skladnik_id);
  sprawdz('K03', sA.U === 4 && sA.R === 2 && w2.realizacje[0].id !== w.realizacje[0].id && (await qx(`SELECT COUNT(*) n FROM Term_Realizacje WHERE tenant_id = ? AND pozycja_id = ?`, [T, pozA[0]]))[0].n === 2, 'wykonaj → cofnij → wykonaj ponownie na bazie: saldo poprawne, 2 realizacje w historii', JSON.stringify({ U: sA.U, R: sA.R }));

  // ── Zestaw B: 5 A + 4 B; A potwierdzone, B niezweryfikowane
  const zB = await wTx(c0, async (repo, ctx) => { const z = await repo.wstawZakup({ sprzedaz_id: 'PRZYZNANE:zestawB', zrodlo_typ: 'przyznane', id_klienta: 'B', usluga_id: 'U-A', nazwa: 'Pakiet 5A+4B', data_zakupu: '2026-10-12', kwalifikacja: 'pakiet' }); const a = await repo.wstawSkladnik({ zakup_id: z, usluga_wyk_id: 'U-A', usluga_nazwa: 'Endermologia', jednostki_przyznane: 5 }); const b = await repo.wstawSkladnik({ zakup_id: z, usluga_wyk_id: 'U-B', usluga_nazwa: 'Meltivio', jednostki_przyznane: 4 }); await repo.wstawRuch({ skladnik_id: a, typ: 'G', ilosc: 5, kto: ctx.autor }); await repo.wstawRuch({ skladnik_id: b, typ: 'G', ilosc: 4, kto: ctx.autor }); await Z.domena.zapiszProjekcje(repo, [a, b]); return { z, a, b }; });
  await wTx(c0, (repo, ctx) => Z.domena.weryfikujSkladnik(repo, ctx, { skladnik_id: zB.a, hist_wykorzystane: 2, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'zestaw B' })); await wTx(c0, (repo, ctx) => Z.domena.uruchomSkladnik(repo, ctx, { skladnik_id: zB.a, potwierdzenie_zaleznych: true }));
  let bOdrzucone = null; try { await wTx(c0, (repo, ctx) => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: 0, skladnik_id: zB.b, usluga_id: 'U-B' }], id_klienta: 'B', data: '2026-11-03', uslugaPozycji: x => x.usluga_id })); } catch (e) { bOdrzucone = e.message; }
  sprawdz('K02', !!bOdrzucone && /do sprawdzenia/.test(bOdrzucone) && (await saldo(zB.b)).R === 0, 'B niezweryfikowane odrzucone przez domenę na bazie; A dostępne', bOdrzucone);
  const widok = await Z.widokZakupow(Z.repoSql(qx, T), { tenant: T, autor: 'Tester', teraz: await teraz(c0), tryb: 'aktywna' }, { id_klienta: 'B' });
  sprawdz('K02b', widok[0].weryfikacja === 'czesciowo' && widok[0].skladniki.find(s => s.id === zB.a).do_umowienia === 3, 'rodzic „częściowo zweryfikowany”, A: do umówienia 3', JSON.stringify(widok[0].skladniki.map(s => [s.usluga_nazwa, s.do_umowienia, s.powod])));

  // ── Zestaw C: dwa zakupy endermologii, różne ważności; ostatnia jednostka w wybranej puli → K05 wyścig dwóch połączeń
  const C1 = await wTx(c0, (repo, ctx) => Z.domena.przyznaj(repo, ctx, { id_klienta: 'C', usluga_wyk_id: 'U-A', usluga_nazwa: 'Endermologia', jednostki: 1, data_waznosci: '2026-11-10', powod: 'zestaw C1' }));
  const C2 = await wTx(c0, (repo, ctx) => Z.domena.przyznaj(repo, ctx, { id_klienta: 'C', usluga_wyk_id: 'U-A', usluga_nazwa: 'Endermologia', jednostki: 1, data_waznosci: '2026-12-31', powod: 'zestaw C2' }));
  const c1 = await mysql.createConnection(cfg), c2 = await mysql.createConnection(cfg);
  const p1 = await nowaPozycja('C'), p2 = await nowaPozycja('C', 'U-A', '2026-11-04 10:00:00');
  const proba = (c, poz) => wTx(c, (repo, ctx) => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: poz, skladnik_id: C1.skladnik_id, usluga_id: 'U-A' }], id_klienta: 'C', data: '2026-11-03', uslugaPozycji: x => x.usluga_id })).then(() => 'OK').catch(e => 'ODRZUCONO: ' + e.message);
  const [r1, r2] = await Promise.all([proba(c1, p1), proba(c2, p2)]);
  const sC1 = await saldo(C1.skladnik_id);
  sprawdz('K05', [r1, r2].filter(x => x === 'OK').length === 1 && sC1.R === 1 && sC1.B === 0, 'dwa połączenia o ostatnią jednostkę: dokładnie jeden sukces, R nie przekracza puli', `${r1} | ${r2} | R=${sC1.R} B=${sC1.B}`);
  // K08: atomowa zmiana źródła C1 → C2 (udana) oraz odrzucona (C2 pełne) bez utraty starego
  const przC = (await qx(`SELECT id FROM Term_Przydzialy WHERE tenant_id = ? AND skladnik_id = ? AND stan = 'zarezerwowany'`, [T, C1.skladnik_id]))[0].id;
  await wTx(c0, (repo, ctx) => Z.domena.przenies(repo, ctx, { przydzial_id: przC, nowy_skladnik_id: C2.skladnik_id, id_klienta: 'C', data: '2026-11-03', powod: 'wybór drugiego zakupu' }));
  const sC1b = await saldo(C1.skladnik_id), sC2 = await saldo(C2.skladnik_id);
  let odm = null; try { const przC2 = (await qx(`SELECT id FROM Term_Przydzialy WHERE tenant_id = ? AND skladnik_id = ? AND stan = 'zarezerwowany'`, [T, C2.skladnik_id]))[0].id; await wTx(c0, (repo, ctx) => Z.domena.przenies(repo, ctx, { przydzial_id: przC2, nowy_skladnik_id: C1.skladnik_id, id_klienta: 'C', data: '2026-11-20', powod: 'po ważności C1' })); } catch (e) { odm = e.message; }
  sprawdz('K08', sC1b.R === 0 && sC1b.B === 1 && sC2.R === 1 && sC2.B === 0 && !!odm && (await saldo(C2.skladnik_id)).R === 1, 'zmiana źródła atomowa; odrzucona próba zachowuje stare źródło', `po przeniesieniu C1 R=${sC1b.R}/B=${sC1b.B}, C2 R=${sC2.R}/B=${sC2.B}; odmowa: ${odm}`);

  // ── K06: jednoczesne wykonanie i odwołanie tej samej pozycji (C2)
  const pozC2 = p1; // pozycja z przydziałem w C2 po przeniesieniu
  const [k6a, k6b] = await Promise.all([
    wTx(c1, (repo, ctx) => Z.domena.wykonaj(repo, ctx, { pozycja_id: pozC2, wykonawca_fakt: 'Tester' })).then(w => 'WYKONANO ' + w.zuzyto).catch(e => 'BŁĄD: ' + e.message),
    wTx(c2, (repo, ctx) => Z.domena.zwolnij(repo, ctx, { pozycja_id: pozC2, powod: 'odwołanie' })).then(w => 'ZWOLNIONO ' + w.zwolniono).catch(e => 'BŁĄD: ' + e.message),
  ]);
  const sC2b = await saldo(C2.skladnik_id);
  sprawdz('K06', !sC2b.niespojny && sC2b.R === 0 && ((sC2b.U === 1 && sC2b.B === 0) || (sC2b.U === 0 && sC2b.B === 1)) && [k6a, k6b].some(x => /WYKONANO 0|ZWOLNIONO 0/.test(x)), 'równoczesne wykonanie i odwołanie: jeden skutek, brak sprzecznych ruchów', `${k6a} | ${k6b} | U=${sC2b.U} R=${sC2b.R} B=${sC2b.B}`);

  // ── K07: awaria przed COMMIT → nic nie zostaje; utrata odpowiedzi po COMMIT → ponowienie zwraca istniejący wynik
  const przed = (await qx(`SELECT (SELECT COUNT(*) FROM Term_Przydzialy WHERE tenant_id = ?) p, (SELECT COUNT(*) FROM Term_Zakupy_Ruchy2 WHERE tenant_id = ?) r, (SELECT COUNT(*) FROM Term_Operacje WHERE tenant_id = ?) o`, [T, T, T]))[0];
  const pozK7 = await nowaPozycja('A');
  let aw = null; try { await wTx(c0, (repo, ctx) => Z.domena.operacja(repo, ctx, { klucz: 'K7-awaria', rodzaj: 'zapisz', dane: { pozK7 } }, (oid) => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: pozK7, skladnik_id: A.skladnik_id, usluga_id: 'U-A' }], id_klienta: 'A', data: '2026-11-03', uslugaPozycji: x => x.usluga_id, operacja_id: oid })), { awariaPrzedCommit: true }); } catch (e) { aw = e.message; }
  const po = (await qx(`SELECT (SELECT COUNT(*) FROM Term_Przydzialy WHERE tenant_id = ?) p, (SELECT COUNT(*) FROM Term_Zakupy_Ruchy2 WHERE tenant_id = ?) r, (SELECT COUNT(*) FROM Term_Operacje WHERE tenant_id = ?) o`, [T, T, T]))[0];
  sprawdz('K07a', /AWARIA/.test(aw || '') && po.p === przed.p && po.r === przed.r && po.o === przed.o, 'awaria przed COMMIT cofa przydział, ruchy i operację', JSON.stringify({ przed, po }));
  const op1 = await wTx(c0, (repo, ctx) => Z.domena.operacja(repo, ctx, { klucz: 'K7-ok', rodzaj: 'zapisz', dane: { pozK7 } }, (oid) => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: pozK7, skladnik_id: A.skladnik_id, usluga_id: 'U-A' }], id_klienta: 'A', data: '2026-11-03', uslugaPozycji: x => x.usluga_id, operacja_id: oid })));
  const op2 = await wTx(c0, (repo, ctx) => Z.domena.operacja(repo, ctx, { klucz: 'K7-ok', rodzaj: 'zapisz', dane: { pozK7 } }, (oid) => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: pozK7, skladnik_id: A.skladnik_id, usluga_id: 'U-A' }], id_klienta: 'A', data: '2026-11-03', uslugaPozycji: x => x.usluga_id, operacja_id: oid })));
  const po2 = (await qx(`SELECT COUNT(*) n FROM Term_Przydzialy WHERE tenant_id = ? AND pozycja_id = ?`, [T, pozK7]))[0].n;
  sprawdz('K07b', !op1.powtorzenie && op2.powtorzenie && po2 === 1 && JSON.stringify(op2.wynik) === JSON.stringify(op1.wynik), 'ponowienie po COMMIT zwraca istniejący wynik, bez duplikatu przydziału', `przydziały pozycji: ${po2}`);
  let a07 = null; try { await wTx(c0, (repo, ctx) => Z.domena.operacja(repo, ctx, { klucz: 'K7-ok', rodzaj: 'zapisz', dane: { pozK7, inne: 1 } }, () => ({}))); } catch (e) { a07 = e.message; }
  sprawdz('K04', /inn(ego|ym) żądani/.test(a07 || ''), 'ten sam klucz z innym żądaniem odrzucony na bazie (UNIQUE + skrót)', a07);

  // ── K13: zmiana źródła Sprzedaz między podglądem a zapisem (zakup ze sprzedaży w bazie testowej)
  await qx(`INSERT INTO Sprzedaz (id, tenant_id, data_sprzedazy, klient, zabieg, szczegoly, kwota, status, platnosc, id_klienta, data_waznosci) VALUES ('ZK02-1-1', ?, '2026-10-12 10:00:00', 'Zestaw D', 'Endermologia', '5x', 1500, 'AKTYWNY', 'Karta', 'D', '2026-12-31')`, [T]);
  const D = await wTx(c0, async (repo, ctx) => { const z = await repo.wstawZakup({ sprzedaz_id: 'ZK02-1-1', zrodlo_typ: 'sprzedaz', id_klienta: 'D', usluga_id: 'U-A', nazwa: 'Endermologia / 5x', data_zakupu: '2026-10-12', data_waznosci: '2026-12-31', kwalifikacja: 'pakiet' }); const s = await repo.wstawSkladnik({ zakup_id: z, usluga_wyk_id: 'U-A', usluga_nazwa: 'Endermologia', jednostki_przyznane: 5, stan_weryfikacji: 'zweryfikowany', zalezne_uzgodniono: 1, aktywny_od: ctx.teraz, zweryfikowal: ctx.autor, zweryfikowano: ctx.teraz, zrodlo_ustalen: 'zestaw D' }); await repo.wstawRuch({ skladnik_id: s, typ: 'G', ilosc: 5, kto: ctx.autor }); await Z.domena.uzgodnijZrodlo(repo, ctx, await repo.zakup(z)); await Z.domena.zapiszProjekcje(repo, [s]); return { z, s }; });
  const widokD = await Z.widokZakupow(Z.repoSql(qx, T), { tenant: T, teraz: await teraz(c0), tryb: 'aktywna' }, { id_klienta: 'D' }); // „podgląd” w kreatorze
  await qx(`INSERT INTO Sprzedaz (id, tenant_id, data_sprzedazy, klient, zabieg, kwota, status, platnosc, id_klienta, zwrot_do_id) VALUES ('ZK02-9-1', ?, NOW(), 'Zestaw D', 'ZWROT: Endermologia', -1500, 'AKTYWNY', 'Karta', 'D', 'ZK02-1-1')`, [T]); // rdzeń: zwrot między podglądem a zapisem
  const pozD = await nowaPozycja('D'); let k13 = null; try { await wTx(c0, (repo, ctx) => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: pozD, skladnik_id: D.s, usluga_id: 'U-A' }], id_klienta: 'D', data: '2026-11-03', uslugaPozycji: x => x.usluga_id })); } catch (e) { k13 = e; if (e.utrwalPoRollback) await qx(`UPDATE Term_Zakupy SET stan_zrodla = ? WHERE tenant_id = ? AND id = ?`, [e.utrwalPoRollback.stan_zrodla, T, e.utrwalPoRollback.zakup_id]); }
  const zD = (await qx(`SELECT stan_zrodla, zwroty_suma FROM Term_Zakupy WHERE tenant_id = ? AND id = ?`, [T, D.z]))[0];
  sprawdz('K13', widokD[0].skladniki[0].dostepny && k13 && k13.extra && k13.extra.code === 'ZRODLO' && zD.stan_zrodla === 'wycofane' && (await saldo(D.s)).R === 0, 'zwrot w Sprzedaży między podglądem a zapisem wykryty w transakcji; zakup „wycofane”, brak przydziału', `podgląd: dostępny; zapis: ${k13 && k13.message}; stan_zrodla=${zD.stan_zrodla}`);
  sprawdz('K13b', true, 'UWAGA: ochrona obejmuje ponowny odczyt Sprzedaz (LOCK IN SHARE MODE) w transakcji dodatku; edycja w rdzeniu NIE używa blokady salonu — zmiana po COMMIT dodatku jest wykrywana przy następnym sprawdzeniu (hash), nie natychmiast', 'ograniczenie kontraktu, nie dowód pełnej spójności');

  // ── A14: projekcja = wyliczenie z historii dla wszystkich składników salonu
  const skl = await qx(`SELECT id, saldo_json FROM Term_Zakupy_Skladniki WHERE tenant_id = ?`, [T]); const repo0 = Z.repoSql(qx, T); const salda = await Z.domena.saldoSkladnikow(repo0, skl.map(s => s.id));
  const rozjazd = skl.filter(s => { const p = s.saldo_json ? JSON.parse(s.saldo_json) : null; const w = salda[s.id]; return !p || ['G', 'W', 'U', 'F', 'R'].some(k => p[k] !== w[k]); });
  sprawdz('A14', rozjazd.length === 0, 'projekcja saldo_json odtwarzalna z ruchów dla wszystkich składników', `składników: ${skl.length}, rozjazdów: ${rozjazd.length}`);

  await c1.end(); await c2.end();
  if (!ZOSTAW) await czysc();
  await c0.end();
  const fail = wyniki.filter(w => w.wynik === 'FAIL').length;
  const out = path.join(__dirname, 'wynik-terminarz-zakupy.json'); fs.writeFileSync(out, JSON.stringify({ baza: info.d, wersja: info.v, kiedy: new Date().toISOString(), wyniki }, null, 2));
  console.log(`\nRAZEM: ${wyniki.length - fail} PASS / ${fail} FAIL → ${out}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('BŁĄD PRZEBIEGU:', e.message); process.exit(1); });
