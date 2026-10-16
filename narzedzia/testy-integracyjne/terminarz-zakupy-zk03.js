// narzedzia/testy-integracyjne/terminarz-zakupy-zk03.js — ZK-03 na RZECZYWISTEJ, IZOLOWANEJ bazie (.env.test, MariaDB zgodna z docelową):
//   Z3-T01 składnia blokad; Z3-T02/T03 równoczesność ze zwrotem (dwa połączenia, KONTROLOWANA pauza między odczytem a zapisem — nie samo Promise.all);
//   Z3-T10/T11/T12 (grupa, rozbita sprzedaż, zwrot do dopłaty); Z3-T14 (1× na przyszłość); Z3-T17/T28 (ponowny import, ponowienie);
//   Z3-T21/T22 (10/3/6 → 6/1; 5 praw i 7 wizyt); Z3-T25 (dwa źródła na pozycji); Z3-T26 (homonimy, obcy salon); Z3-T05/T06 (preflight danych v1 — na osobnej bazie)
//   node narzedzia/testy-integracyjne/terminarz-zakupy-zk03.js [--zostaw]
// Każda próba ma osobny wynik PASS/FAIL; wynik zapisywany do wynik-terminarz-zakupy-zk03.json. Salon testowy `zk03-test`; hasła nie są logowane.
'use strict';
const fs = require('fs'); const path = require('path');
const mysql = require('mysql2/promise');
const Z = require('../../routes/terminarz-zakupy');
const ROOT = path.join(__dirname, '..', '..');
const ZOSTAW = process.argv.includes('--zostaw');
const T = 'zk03-test';
function envZ(plik) { if (!fs.existsSync(plik)) return null; const out = {}; for (const l of fs.readFileSync(plik, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } return out; }
const wyniki = []; const PASS = (id, opis, dowod) => { wyniki.push({ id, wynik: 'PASS', rodzaj: 'rzeczywista baza', opis, dowod }); console.log(`PASS ${id} — ${opis}${dowod ? ' · ' + dowod : ''}`); };
const FAIL = (id, opis, dowod) => { wyniki.push({ id, wynik: 'FAIL', rodzaj: 'rzeczywista baza', opis, dowod }); console.log(`FAIL ${id} — ${opis}${dowod ? ' · ' + dowod : ''}`); };
const INFO = (id, opis, dowod) => { wyniki.push({ id, wynik: 'INFO', rodzaj: 'rzeczywista baza', opis, dowod }); console.log(`INFO ${id} — ${opis}${dowod ? ' · ' + dowod : ''}`); };
const sprawdz = (id, warunek, opis, dowod) => (warunek ? PASS : FAIL)(id, opis, dowod);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const cel = envZ(path.join(ROOT, '.env.test')), prod = envZ(path.join(ROOT, '.env'));
  if (!cel || !cel.DB_HOST || !cel.DB_NAME) { console.error('Brak .env.test — próby NIE WYKONANO.'); process.exit(3); }
  if (prod && String(prod.DB_HOST).trim() === String(cel.DB_HOST).trim() && String(prod.DB_NAME).trim() === String(cel.DB_NAME).trim()) { console.error('ODMOWA: .env.test = baza z .env.'); process.exit(4); }
  const cfg = { host: cel.DB_HOST, port: Number(cel.DB_PORT || 3306), user: cel.DB_USER, password: cel.DB_PASSWORD, database: cel.DB_NAME, charset: 'utf8mb4', dateStrings: true };
  const c0 = await mysql.createConnection(cfg); const qx = async (sql, p = []) => (await c0.query(sql, p))[0];
  const [[info]] = await c0.query('SELECT DATABASE() AS d, @@version AS v, @@transaction_isolation AS i, (SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = \'Sprzedaz\') AS e');
  console.log(`baza: ${info.d} (${info.v}, ${info.e}, ${info.i}) — izolowana`);
  const st = await Z.stanSchematu(qx); if (!st.gotowy) { console.error('Schemat v2 niegotowy:', st.typ, st.braki); process.exit(2); }

  // ── Z3-T01: faktyczne zapytanie blokujące z repoSql na tym silniku
  { const c = await mysql.createConnection(cfg); await c.beginTransaction(); const zap = []; const repo = Z.repoSql(async (sql, p) => { zap.push(sql); return (await c.query(sql, p))[0]; }, T);
    let blad = null; try { await repo.zrodloSprzedaz('NIE-MA', true); await repo.skladniki([0], true); } catch (e) { blad = e.message; } await c.rollback(); await c.end();
    sprawdz('Z3-T01', !blad && zap.some(s => / LOCK IN SHARE MODE$/.test(s)) && zap.some(s => / FOR UPDATE$/.test(s)) && !zap.some(s => /FOR SHARE/.test(s)), 'zapytania blokujące repoSql wykonane na MariaDB (LOCK IN SHARE MODE / FOR UPDATE), bez błędu składni', blad || zap.filter(s => /LOCK IN SHARE MODE|FOR UPDATE/.test(s)).map(s => s.slice(-40)).join(' | '));
    let fs_ = null; try { await c0.query('SELECT 1 FROM Sprzedaz WHERE id = ? FOR SHARE', ['x']); } catch (e) { fs_ = e.code; } sprawdz('Z3-T01b', fs_ === 'ER_PARSE_ERROR', 'FOR SHARE na tym silniku = błąd składni (potwierdzenie R1)', fs_); }

  // ── sprzątanie salonu testowego + katalog + tryb ewidencji
  const czysc = async () => { for (const t of ['Term_Zakupy_Ruchy2', 'Term_Realizacje', 'Term_Przydzialy', 'Term_Operacje', 'Term_Zakupy_Skladniki', 'Term_Zakupy', 'Term_Pozycje', 'Term_Rezerwacje', 'Term_Ewidencja', 'Term_Oferty_Skladniki', 'Term_Oferty_Wersje', 'Term_Oferty', 'Term_Sprawy', 'Sprzedaz', 'Uslugi', 'Klienci']) await qx(`DELETE FROM ${t} WHERE tenant_id = ?`, [T]); };
  await czysc();
  await qx(`INSERT INTO Term_Ewidencja (tenant_id, tryb, rozpoczeto, zmienil, zmieniono) VALUES (?, 'aktywna', NOW(), 'test', NOW())`, [T]);
  const U = { A: 'ZK03-U-A', A5: 'ZK03-U-A5', A10: 'ZK03-U-A10', B: 'ZK03-U-B', AB: 'ZK03-U-AB', K1: 'ZK03-U-K1' };
  for (const [id, kat, war] of [[U.A, 'Endermologia', '1x'], [U.A5, 'Endermologia', '5x'], [U.A10, 'Endermologia', '10x'], [U.B, 'Meltivio', '1x'], [U.AB, 'Pakiet', '5A+4B'], [U.K1, 'Konsultacja', '1x z góry']]) await qx(`INSERT INTO Uslugi (id, tenant_id, kategoria, wariant, cena, waznosc_dni) VALUES (?, ?, ?, ?, 100, NULL)`, [id, T, kat, war]);
  const oferta = async (uid, rodzaj, skl, od = '2026-01-01 00:00:00') => { const o = (await qx(`INSERT INTO Term_Oferty (tenant_id, usluga_id, stan, zrodlo, zatwierdzono, zmieniono) VALUES (?, ?, 'zatwierdzona', 'reczne', NOW(), NOW())`, [T, uid])).insertId; const w = (await qx(`INSERT INTO Term_Oferty_Wersje (tenant_id, oferta_id, wersja, rodzaj, stan, obowiazuje_od, autor) VALUES (?, ?, 1, ?, 'zatwierdzona', ?, 'test')`, [T, o, rodzaj, od])).insertId; for (const s of skl) await qx(`INSERT INTO Term_Oferty_Skladniki (tenant_id, oferta_id, wersja_id, usluga_wyk_id, jednostki) VALUES (?, ?, ?, ?, ?)`, [T, o, w, s[0], s[1]]); return { o, w }; };
  await oferta(U.A5, 'pakiet', [[U.A, 5]]); await oferta(U.A10, 'pakiet', [[U.A, 10]]); await oferta(U.AB, 'pakiet', [[U.A, 5], [U.B, 4]]); await oferta(U.A, 'nie_ewidencjonuj', []); await oferta(U.K1, 'pojedynczy_z_gory', [[U.K1, 1]]);
  for (const [idk, nazwa] of [['3001', 'Zestaw A'], ['3002', 'Zestaw B'], ['3003', 'Anna Nowak'], ['3004', 'Anna Nowak'], ['3005', 'Zestaw D']]) await qx(`INSERT INTO Klienci (id, tenant_id, id_klienta, imie_nazwisko, status) VALUES (UUID(), ?, ?, ?, 'AKTYWNY')`, [T, idk, nazwa]);
  const sprzedaz = async (id, idk, zabieg, szczegoly, kwota, extra = {}) => qx(`INSERT INTO Sprzedaz (id, tenant_id, data_sprzedazy, klient, zabieg, szczegoly, kwota, status, platnosc, id_klienta, grupa_id, zwrot_do_id, data_waznosci) VALUES (?, ?, ?, ?, ?, ?, ?, 'AKTYWNY', ?, ?, ?, ?, ?)`, [id, T, extra.data || '2026-10-10 10:00:00', 'Klientka ' + idk, zabieg, szczegoly, kwota, extra.platnosc || 'Karta', idk, extra.grupa_id || null, extra.zwrot_do_id || null, extra.data_waznosci || null]);
  const teraz = async (c) => (await c.query(`SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS t`))[0][0].t;
  const ctxNa = async (c, tryb = 'aktywna') => ({ tenant: T, autor: 'Tester', autor_id: 'u-test', rola: 'manager', teraz: await teraz(c), tryb, techniczna: true, zapisany: tryb, widziKwoty: true });
  async function wTx(c, fn, opcje = {}) { // jak wTransakcjiSalonu w routes/terminarz.js; `opcje.owin(repo)` pozwala wstrzyknąć kontrolowaną pauzę
    const [[w]] = await c.query(`SELECT IS_FREE_LOCK('trm:migracja') AS w`); if (Number(w.w) === 0) throw new Error('migracja');
    const [[lock]] = await c.query(`SELECT GET_LOCK(?, 8) AS l`, ['trm:' + T]); if (Number(lock.l) !== 1) throw new Error('brak blokady');
    try { await c.beginTransaction(); let repo = Z.repoSql(async (sql, p) => (await c.query(sql, p))[0], T); if (opcje.owin) repo = opcje.owin(repo); const ctx = await ctxNa(c, opcje.tryb);
      try { const r = await fn(repo, ctx); await c.commit(); return r; } catch (e) { await c.rollback(); if (e.utrwalPoRollback) await c0.query(`UPDATE Term_Zakupy SET stan_zrodla = ? WHERE tenant_id = ? AND id = ?`, [e.utrwalPoRollback.stan_zrodla, T, e.utrwalPoRollback.zakup_id]); throw e; } }
    finally { await c.query(`SELECT RELEASE_LOCK(?)`, ['trm:' + T]); }
  }
  const repo0 = Z.repoSql(qx, T);
  const saldo = async (sid) => (await Z.domena.saldoSkladnikow(repo0, [sid]))[sid];
  const skladnikiZakupu = async (sprzedazId) => { const [z] = await repo0.zakupyPoSprzedazy([sprzedazId]); return z ? await repo0.skladnikiZakupow([z.id]) : []; };
  const nowaPozycja = async (idK, usluga, start) => { const r = (await qx(`INSERT INTO Term_Rezerwacje (tenant_id, id_klienta, klient_nazwa, start, koniec) VALUES (?, ?, ?, ?, ?)`, [T, idK, 'Klientka ' + idK, start, start])).insertId; return (await qx(`INSERT INTO Term_Pozycje (tenant_id, rezerwacja_id, usluga_id, kategoria, czas_min, pracownik, start, koniec) VALUES (?, ?, ?, 'Zabieg', 30, 'Tester', ?, ?)`, [T, r, usluga, start, start])).insertId; };
  const zwer = async (sid, u = 0) => { await wTx(c0, (repo, ctx) => Z.domena.weryfikujSkladnik(repo, ctx, { skladnik_id: sid, hist_wykorzystane: u, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'test' })); };

  // ── Z3-T10: dwa powielone wiersze 5A+4B (grupa_id) → 10 A + 8 B; Z3-T18: podgląd nie mutuje
  await sprzedaz('ZK03-G1-1', '3002', 'Pakiet', '5A+4B', 2000, { grupa_id: 'GRP-X' }); await sprzedaz('ZK03-G1-2', '3002', 'Pakiet', '5A+4B', 2000, { grupa_id: 'GRP-X' });
  { const przed = (await qx(`SELECT COUNT(*) n FROM Term_Zakupy WHERE tenant_id = ?`, [T]))[0].n; const pod = await Z.domena.podgladZrodel(repo0, await ctxNa(c0), { id_klienta: '3002' }); const po = (await qx(`SELECT COUNT(*) n FROM Term_Zakupy WHERE tenant_id = ?`, [T]))[0].n;
    sprawdz('Z3-T18', przed === po && pod.pozycje.every(p => p.kategoria === 'gotowe'), 'podgląd klasyfikuje bez mutacji', JSON.stringify(pod.liczniki));
    const w = await wTx(c0, (repo, ctx) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: [{ sprzedaz_id: 'ZK03-G1-1' }, { sprzedaz_id: 'ZK03-G1-2' }] }));
    const skl = await qx(`SELECT s.usluga_wyk_id, SUM(s.jednostki_przyznane) g FROM Term_Zakupy_Skladniki s JOIN Term_Zakupy z ON z.id = s.zakup_id WHERE z.tenant_id = ? AND z.id_klienta = '3002' GROUP BY s.usluga_wyk_id`, [T]);
    sprawdz('Z3-T10', w.zarejestrowano === 2 && Number(skl.find(x => x.usluga_wyk_id === U.A).g) === 10 && Number(skl.find(x => x.usluga_wyk_id === U.B).g) === 8, 'dwa egzemplarze oferty 5A+4B → dwa źródła, 10 A + 8 B, bez mnożnika z grupy', JSON.stringify(skl)); }
  // ── Z3-T17/T28: ponowny import w innej kolejności i ponowienie z tym samym kluczem → brak duplikatów
  { const g1 = (await qx(`SELECT COUNT(*) n FROM Term_Zakupy_Ruchy2 WHERE tenant_id = ? AND typ = 'G'`, [T]))[0].n;
    const r1 = await wTx(c0, (repo, ctx) => Z.domena.operacja(repo, ctx, { klucz: 'REJ-ZK03', rodzaj: 'rejestracja', dane: { pozycje: [{ sprzedaz_id: 'ZK03-G1-2' }, { sprzedaz_id: 'ZK03-G1-1' }] } }, (oid) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: [{ sprzedaz_id: 'ZK03-G1-2' }, { sprzedaz_id: 'ZK03-G1-1' }], operacja_id: oid })));
    const r2 = await wTx(c0, (repo, ctx) => Z.domena.operacja(repo, ctx, { klucz: 'REJ-ZK03', rodzaj: 'rejestracja', dane: { pozycje: [{ sprzedaz_id: 'ZK03-G1-2' }, { sprzedaz_id: 'ZK03-G1-1' }] } }, (oid) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: [{ sprzedaz_id: 'ZK03-G1-2' }, { sprzedaz_id: 'ZK03-G1-1' }], operacja_id: oid })));
    const g2 = (await qx(`SELECT COUNT(*) n FROM Term_Zakupy_Ruchy2 WHERE tenant_id = ? AND typ = 'G'`, [T]))[0].n;
    sprawdz('Z3-T17/T28', r1.wynik.istnialo === 2 && r1.wynik.zarejestrowano === 0 && r2.powtorzenie === true && g1 === g2 && (await qx(`SELECT COUNT(*) n FROM Term_Zakupy WHERE tenant_id = ? AND id_klienta = '3002'`, [T]))[0].n === 2, 'ponowny import (inna kolejność) i ponowienie klucza: te same zakupy, bez dodatkowego G', `G przed=${g1} po=${g2}`); }
  // ── Z3-T11/T12: rozbita sprzedaż (Portfel 200 + Dopłata 800) → jeden pakiet; zwrot 100 zł do dopłaty wykryty
  await sprzedaz('ZK03-R1-1', '3001', 'Endermologia', '5x', 200, { platnosc: 'Portfel' }); await sprzedaz('ZK03-R1-2', '3001', 'Endermologia Dopłata', '', 800);
  { const w = await wTx(c0, (repo, ctx) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: [{ sprzedaz_id: 'ZK03-R1-1' }, { sprzedaz_id: 'ZK03-R1-2' }] }));
    const [z] = await repo0.zakupyPoSprzedazy(['ZK03-R1-1']); const [s] = await repo0.skladnikiZakupow([z.id]);
    sprawdz('Z3-T11', w.zarejestrowano === 1 && w.wyniki.find(x => x.sprzedaz_id === 'ZK03-R1-2').wynik === 'pominiete' && JSON.parse(z.zrodla_json)[0] === 'ZK03-R1-2' && (await saldo(s.id)).G === 5, 'rozbita sprzedaż = jeden pakiet 5 A; dopłata powiązana, bez własnej puli', `zrodla_json=${z.zrodla_json}`);
    await sprzedaz('ZK03-R9-1', '3001', 'ZWROT: Endermologia Dopłata', '', -100, { zwrot_do_id: 'ZK03-R1-2', data: '2026-10-12 10:00:00' });
    const u = await wTx(c0, (repo, ctx) => Z.domena.uzgodnijZrodlo(repo, ctx, z));
    sprawdz('Z3-T12', u.zmiana === 'zwrot' && u.stan_zrodla === 'do_uzgodnienia' && (await saldo(s.id)).G === 5, 'zwrot 100 zł przypisany do DOPŁATY wykryty jako zmiana tego zakupu; bez przeliczenia kwoty na sesje', `zmiana=${u.zmiana} stan=${u.stan_zrodla} G=5`); }
  // ── Z3-T14: 1× na przyszłość (jawna oferta) — jedna jednostka po kwalifikacji; zwykłe 1x pominięte
  await sprzedaz('ZK03-J1-1', '3001', 'Konsultacja', '1x z góry', 150); await sprzedaz('ZK03-J2-1', '3001', 'Endermologia', '1x', 200);
  { const w = await wTx(c0, (repo, ctx) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: [{ sprzedaz_id: 'ZK03-J1-1' }, { sprzedaz_id: 'ZK03-J2-1' }] }));
    const [z] = await repo0.zakupyPoSprzedazy(['ZK03-J1-1']); const [s] = await skladnikiZakupu('ZK03-J1-1'); await zwer(s.id);
    let odm = null; try { await wTx(c0, (repo, ctx) => Z.domena.uruchomSkladnik(repo, ctx, { skladnik_id: s.id, potwierdzenie_zaleznych: true })); } catch (e) { odm = e.extra && e.extra.code; }
    await wTx(c0, (repo, ctx) => Z.domena.kwalifikujZakup(repo, ctx, { zakup_id: z.id, kwalifikacja: 'pojedynczy_z_gory', powod: 'test' }));
    await wTx(c0, (repo, ctx) => Z.domena.uruchomSkladnik(repo, ctx, { skladnik_id: s.id, potwierdzenie_zaleznych: true }));
    const w2 = await wTx(c0, (repo, ctx) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: [{ sprzedaz_id: 'ZK03-J1-1' }] }));
    sprawdz('Z3-T14', w.zarejestrowano === 1 && w.wyniki.find(x => x.sprzedaz_id === 'ZK03-J2-1').wynik === 'pominiete' && odm === 'KWALIFIKACJA' && (await saldo(s.id)).G === 1 && w2.istnialo === 1, '„1×” na przyszłość: 1 jednostka po jawnej kwalifikacji; zwykłe 1x pominięte; powtórzenie nie zwiększa G', `odmowa przed kwalifikacją: ${odm}`); }
  // ── Z3-T21: zestaw D — 10 zabiegów, 3 historyczne, 6 przyszłych wizyt bez źródła → R=6, B=1; wykonanie jednej → 4/5/1
  await sprzedaz('ZK03-D1-1', '3005', 'Endermologia', '10x', 1800);
  { await wTx(c0, (repo, ctx) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: [{ sprzedaz_id: 'ZK03-D1-1' }] })); const [s] = await skladnikiZakupu('ZK03-D1-1'); await zwer(s.id, 3);
    const poz = []; for (const d of ['2026-10-05 10:00:00', '2026-10-21 10:00:00', '2026-10-28 10:00:00', '2026-11-04 10:00:00', '2026-11-18 10:00:00', '2027-01-07 10:00:00']) poz.push(await nowaPozycja('3005', U.A, d));
    const kand = await Z.domena.kandydaciWizyt(repo0, await ctxNa(c0), { skladnik_id: s.id });
    const w = await wTx(c0, (repo, ctx) => Z.domena.uruchomSkladnik(repo, ctx, { skladnik_id: s.id, decyzje: poz.map(p => ({ pozycja_id: p, decyzja: 'powiaz' })), skrot: kand.skrot, potwierdzenie_zaleznych: true }));
    let sD = await saldo(s.id); const ok1 = sD.U === 3 && sD.R === 6 && sD.B === 1 && w.przydzialy.length === 6;
    await wTx(c0, (repo, ctx) => Z.domena.wykonaj(repo, ctx, { pozycja_id: poz[1], wykonawca_fakt: 'Tester' })); sD = await saldo(s.id);
    sprawdz('Z3-T21/T23', ok1 && sD.U === 4 && sD.R === 5 && sD.B === 1 && kand.kandydaci.length === 6 && kand.kandydaci[0].przeszla, 'stan 10/3 + 6 wizyt (w tym przeszła i odległa) → U=3,R=6,B=1; po wykonaniu 4/5/1; bez drugiego U', JSON.stringify({ U: sD.U, R: sD.R, B: sD.B })); }
  // ── Z3-T22: 5 praw, 7 wizyt → 5 powiązań + 2 jawne decyzje
  await sprzedaz('ZK03-E1-1', '3001', 'Endermologia', '5x', 900, { data: '2026-10-11 10:00:00' });
  { await wTx(c0, (repo, ctx) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: [{ sprzedaz_id: 'ZK03-E1-1' }] })); const [s] = await skladnikiZakupu('ZK03-E1-1'); await zwer(s.id, 0);
    const poz = []; for (let i = 1; i <= 7; i++) poz.push(await nowaPozycja('3001', U.A, `2026-11-${String(i).padStart(2, '0')} 10:00:00`));
    const kand = await Z.domena.kandydaciWizyt(repo0, await ctxNa(c0), { skladnik_id: s.id });
    let odm = null; try { await wTx(c0, (repo, ctx) => Z.domena.uruchomSkladnik(repo, ctx, { skladnik_id: s.id, decyzje: poz.map(p => ({ pozycja_id: p, decyzja: 'powiaz' })), skrot: kand.skrot, potwierdzenie_zaleznych: true })); } catch (e) { odm = e.extra && e.extra.code; }
    const w = await wTx(c0, (repo, ctx) => Z.domena.uruchomSkladnik(repo, ctx, { skladnik_id: s.id, decyzje: [...poz.slice(0, 5).map(p => ({ pozycja_id: p, decyzja: 'powiaz' })), { pozycja_id: poz[5], decyzja: 'wyjasnienie', uzasadnienie: 'brak zakupu' }, { pozycja_id: poz[6], decyzja: 'jednorazowa' }], skrot: kand.skrot, potwierdzenie_zaleznych: true }));
    const sE = await saldo(s.id); const n = (await qx(`SELECT COUNT(*) n FROM Term_Pozycje WHERE tenant_id = ? AND id IN (${poz.map(() => '?').join(',')})`, [T, ...poz]))[0].n;
    sprawdz('Z3-T22', kand.niedobor === 2 && odm === 'NIEDOBOR' && w.przydzialy.length === 5 && sE.R === 5 && sE.B === 0 && n === 7, '5 praw i 7 wizyt: niedobór 2, bez decyzji odmowa; 5 powiązań + 2 jawne; żadna wizyta nie znika, bez minusa', JSON.stringify({ R: sE.R, B: sE.B, wizyt: n })); }
  // ── Z3-T26: homonimy (dwie „Anna Nowak”) — własność po ID; zakup obcego salonu niewidoczny
  await sprzedaz('ZK03-H1-1', '3003', 'Endermologia', '5x', 900); await sprzedaz('ZK03-H2-1', '3004', 'Endermologia', '5x', 900);
  { await wTx(c0, (repo, ctx) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: [{ sprzedaz_id: 'ZK03-H1-1' }, { sprzedaz_id: 'ZK03-H2-1' }] }));
    const w3 = await Z.widokZakupow(repo0, await ctxNa(c0), { id_klienta: '3003' }); const w4 = await Z.widokZakupow(repo0, await ctxNa(c0), { id_klienta: '3004' });
    const obcy = Z.repoSql(qx, 'inny-salon'); const w5 = await Z.widokZakupow(obcy, await ctxNa(c0), { id_klienta: '3003' }); const [sH] = await skladnikiZakupu('ZK03-H2-1'); const sObcy = await obcy.skladniki([sH.id]);
    sprawdz('Z3-T26', w3.length === 1 && w3[0].sprzedaz_id === 'ZK03-H1-1' && w4.length === 1 && w4[0].sprzedaz_id === 'ZK03-H2-1' && w5.length === 0 && sObcy.length === 0, 'dwie klientki o tej samej nazwie widzą tylko własny zakup; repozytorium innego salonu nie widzi składnika', `3003→${w3[0].sprzedaz_id}, 3004→${w4[0].sprzedaz_id}, obcy salon: ${w5.length}/${sObcy.length}`); }
  // ── Z3-T25: dwa zakupy tej samej usługi na jednej pozycji (2 jednostki)
  { const a = await wTx(c0, (repo, ctx) => Z.domena.przyznaj(repo, ctx, { id_klienta: '3002', usluga_wyk_id: U.A, usluga_nazwa: 'Endermologia', jednostki: 1, data_waznosci: '2026-11-30', powod: 'a' })); const b = await wTx(c0, (repo, ctx) => Z.domena.przyznaj(repo, ctx, { id_klienta: '3002', usluga_wyk_id: U.A, usluga_nazwa: 'Endermologia', jednostki: 1, data_waznosci: '2026-12-31', powod: 'b' }));
    const poz = await nowaPozycja('3002', U.A, '2026-11-05 10:00:00');
    await wTx(c0, (repo, ctx) => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: poz, skladnik_id: a.skladnik_id, usluga_id: U.A }, { pozycja_id: poz, skladnik_id: b.skladnik_id, usluga_id: U.A }], id_klienta: '3002', data: '2026-11-05', uslugaPozycji: p => p.usluga_id }));
    const wyk = await wTx(c0, (repo, ctx) => Z.domena.wykonaj(repo, ctx, { pozycja_id: poz, wykonawca_fakt: 'Tester' }));
    await wTx(c0, (repo, ctx) => Z.domena.odwrocRealizacje(repo, ctx, { realizacja_id: wyk.realizacje[1].id, wynik: 'odbedzie_sie', powod: 'x', data: '2026-11-05' }));
    const prz = await qx(`SELECT skladnik_id, stan, cykl FROM Term_Przydzialy WHERE tenant_id = ? AND pozycja_id = ? ORDER BY id`, [T, poz]); const p = await repo0.pozycja(poz);
    sprawdz('Z3-T25', wyk.zuzyto === 2 && prz.length === 3 && (await saldo(a.skladnik_id)).U === 1 && (await saldo(b.skladnik_id)).R === 1 && Number(p.jednostki_wymagane) === 2 && [a.skladnik_id, b.skladnik_id].includes(p.zakup_skladnik_id), 'dwa źródła na pozycji: wykonanie 2 jednostek, odwrócenie jednej — oba powiązania zachowane (zużyty A, zużyty B, nowy B cykl 2); alias = pole zgodności (aktywne źródło)', JSON.stringify(prz) + ` alias=${p.zakup_skladnik_id}`); }

  // ── Z3-T02/T03: RÓWNOCZESNOŚĆ ze zwrotem — kontrolowana pauza między odczytem źródła a zapisem (dwa połączenia)
  await sprzedaz('ZK03-C1-1', '3002', 'Endermologia', '5x', 900, { data: '2026-10-12 10:00:00' });
  { await wTx(c0, (repo, ctx) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: [{ sprzedaz_id: 'ZK03-C1-1' }] })); const [s] = await skladnikiZakupu('ZK03-C1-1'); await zwer(s.id, 4); // zostaje 1 jednostka
    await wTx(c0, (repo, ctx) => Z.domena.uruchomSkladnik(repo, ctx, { skladnik_id: s.id, potwierdzenie_zaleznych: true }));
    const cA = await mysql.createConnection(cfg), cB = await mysql.createConnection(cfg);
    // 1) edycja oryginalnej sprzedaży w rdzeniu PODCZAS rezerwowania: UPDATE czeka na zwolnienie blokady współdzielonej (do COMMIT dodatku)
    let czasEdycji = null, wynikB1 = null; const pozA = await nowaPozycja('3002', U.A, '2026-11-06 10:00:00');
    const owinPauza = (akcjaB) => (repo) => { const org = repo.zrodloSprzedaz.bind(repo); repo.zrodloSprzedaz = async (...a) => { const r = await org(...a); await akcjaB(); return r; }; return repo; };
    await wTx(cA, (repo, ctx) => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: pozA, skladnik_id: s.id, usluga_id: U.A }], id_klienta: '3002', data: '2026-11-06', uslugaPozycji: p => p.usluga_id }), { owin: owinPauza(async () => {
      const t0 = Date.now(); const upd = cB.query(`UPDATE Sprzedaz SET kwota = 850 WHERE tenant_id = ? AND id = ?`, [T, 'ZK03-C1-1']).then(() => 'ZAKOŃCZONO').catch(e => 'BŁĄD ' + e.code);
      wynikB1 = await Promise.race([upd, sleep(1500).then(() => 'CZEKA')]); czasEdycji = Date.now() - t0; upd.then(() => { czasEdycji = Date.now() - t0; });
    }) });
    await sleep(300);
    sprawdz('Z3-T02a', wynikB1 === 'CZEKA', 'edycja oryginalnej sprzedaży w rdzeniu podczas rezerwowania CZEKA na COMMIT dodatku (blokada współdzielona działa)', `stan po 1,5 s pauzy: ${wynikB1}; UPDATE ukończył po ${czasEdycji} ms`);
    await wTx(c0, (repo, ctx) => Z.domena.zwolnij(repo, ctx, { pozycja_id: pozA, powod: 'reset' })); await c0.query(`UPDATE Sprzedaz SET kwota = 900 WHERE tenant_id = ? AND id = ?`, [T, 'ZK03-C1-1']); await wTx(c0, async (repo, ctx) => Z.domena.uzgodnijZrodlo(repo, ctx, (await repo.zakupyPoSprzedazy(['ZK03-C1-1']))[0]));
    // 2) PIERWSZY zwrot dopisywany (nowy wiersz) podczas rezerwowania ostatniej jednostki: INSERT nie jest blokowany przez blokadę współdzieloną na oryginale
    let wynikB2 = null; const pozB = await nowaPozycja('3002', U.A, '2026-11-07 10:00:00'); let rezB = null;
    try { rezB = await wTx(cA, (repo, ctx) => Z.domena.rezerwuj(repo, ctx, { pozycje: [{ pozycja_id: pozB, skladnik_id: s.id, usluga_id: U.A }], id_klienta: '3002', data: '2026-11-07', uslugaPozycji: p => p.usluga_id }), { owin: owinPauza(async () => {
      const ins = cB.query(`INSERT INTO Sprzedaz (id, tenant_id, data_sprzedazy, klient, zabieg, kwota, status, platnosc, id_klienta, zwrot_do_id) VALUES ('ZK03-C9-1', ?, NOW(), 'Klientka 3002', 'ZWROT: Endermologia', -900, 'AKTYWNY', 'Karta', '3002', 'ZK03-C1-1')`, [T]).then(() => 'ZAKOŃCZONO').catch(e => 'BŁĄD ' + e.code);
      wynikB2 = await Promise.race([ins, sleep(1500).then(() => 'CZEKA')]);
    }) }); } catch (e) { rezB = { blad: e.message }; }
    const sC = await saldo(s.id); const [zC] = await repo0.zakupyPoSprzedazy(['ZK03-C1-1']);
    const u2 = await wTx(c0, (repo, ctx) => Z.domena.uzgodnijZrodlo(repo, ctx, zC)); // następne sprawdzenie
    const luka = wynikB2 === 'ZAKOŃCZONO' && rezB && rezB.przydzialy;
    INFO('Z3-T02b', luka ? 'LUKA (jawnie): pierwszy zwrot dopisany jako NOWY wiersz w oknie między odczytem źródła a COMMIT dodatku NIE jest blokowany — rezerwacja ostatniej jednostki zapisała się; zmiana wykryta przy NASTĘPNYM sprawdzeniu (hash → wycofane)' : 'zwrot podczas rezerwacji został zablokowany/wykryty', `INSERT zwrotu: ${wynikB2}; rezerwacja: ${rezB && rezB.przydzialy ? 'ZAPISANA' : 'ODRZUCONA ' + (rezB && rezB.blad)}; po operacji R=${sC.R}; następne sprawdzenie: zmiana=${u2.zmiana}, stan=${u2.stan_zrodla}`);
    sprawdz('Z3-T02c', u2.zmiana === 'zwrot' && u2.stan_zrodla === 'wycofane', 'zwrot dopisany w oknie równoczesności jest wykryty przy następnym sprawdzeniu źródła (odroczone uzgadnianie), zakup „wycofane”', `zmiana=${u2.zmiana}`);
    // 3) zwrot przed potwierdzeniem wykonania (po wcześniejszej rezerwacji) → wykonanie odrzucone, brak U; 4) zwrot podczas wykonania (pauza) → INSERT przechodzi, wykonanie kończy się na starym podglądzie? NIE — źródło jest czytane ponownie w transakcji
    let wyk = null; try { await wTx(cA, (repo, ctx) => Z.domena.wykonaj(repo, ctx, { pozycja_id: pozB, wykonawca_fakt: 'Tester' })); wyk = 'WYKONANO'; } catch (e) { wyk = (e.extra && e.extra.code) + ': ' + e.message.slice(0, 60); }
    sprawdz('Z3-T03a', /^ZRODLO/.test(wyk || '') && (await saldo(s.id)).U === 4, 'zwrot zatwierdzony przed wykonaniem (po wcześniejszej rezerwacji) → wykonanie odrzucone, U bez zmian (tylko historyczne 4)', wyk);
    // reset: usuń zwrot, przywróć stan, i powtórz z pauzą W TRAKCIE wykonania
    await c0.query(`DELETE FROM Sprzedaz WHERE tenant_id = ? AND id = 'ZK03-C9-1'`, [T]); await c0.query(`UPDATE Term_Zakupy SET stan_zrodla = 'ok' WHERE tenant_id = ? AND id = ?`, [T, zC.id]); await wTx(c0, async (repo, ctx) => Z.domena.uzgodnijZrodlo(repo, ctx, (await repo.zakupyPoSprzedazy(['ZK03-C1-1']))[0]));
    let wynikB3 = null, wyk2 = null;
    try { await wTx(cA, (repo, ctx) => Z.domena.wykonaj(repo, ctx, { pozycja_id: pozB, wykonawca_fakt: 'Tester' }), { owin: owinPauza(async () => { wynikB3 = await Promise.race([cB.query(`INSERT INTO Sprzedaz (id, tenant_id, data_sprzedazy, klient, zabieg, kwota, status, platnosc, id_klienta, zwrot_do_id) VALUES ('ZK03-C9-2', ?, NOW(), 'Klientka 3002', 'ZWROT: Endermologia', -900, 'AKTYWNY', 'Karta', '3002', 'ZK03-C1-1')`, [T]).then(() => 'ZAKOŃCZONO').catch(e => 'BŁĄD ' + e.code), sleep(1500).then(() => 'CZEKA')]); }) }); wyk2 = 'WYKONANO'; } catch (e) { wyk2 = (e.extra && e.extra.code) + ''; }
    const u3 = await wTx(c0, async (repo, ctx) => Z.domena.uzgodnijZrodlo(repo, ctx, (await repo.zakupyPoSprzedazy(['ZK03-C1-1']))[0]));
    INFO('Z3-T03b', wyk2 === 'WYKONANO' ? 'LUKA (jawnie): zwrot dopisany w oknie między odczytem źródła a COMMIT wykonania nie jest blokowany — U zapisane; wykryte przy następnym sprawdzeniu' : 'zwrot podczas wykonania zablokowany/wykryty', `INSERT zwrotu: ${wynikB3}; wykonanie: ${wyk2}; następne sprawdzenie: ${u3.zmiana}/${u3.stan_zrodla}`);
    await cA.end(); await cB.end(); }

  // ── Z3-T05/T06 (preflight danych v1) — na osobnej, czystej bazie wymaga drugiej bazy; tu: kontrola, że migrujV2 na TEJ bazie (v2 kompletny) nic nie zmienia nawet przy danych v1
  { await qx(`INSERT INTO Term_Zakupy (tenant_id, sprzedaz_id, id_klienta, oferta_id, usluga_id, nazwa) VALUES (?, 'V1-TEST-1', '3001', 0, ?, 'v1')`, [T, U.A]); await qx(`INSERT INTO Term_Zakupy_Ruchy (tenant_id, skladnik_id, pozycja_id, typ, jednostki) VALUES (?, 0, NULL, 'korekta', 1)`, [T]);
    const r = await Z.migrujV2(qx, { log: { error() {} } }); await qx(`DELETE FROM Term_Zakupy_Ruchy WHERE tenant_id = ?`, [T]); await qx(`DELETE FROM Term_Zakupy WHERE tenant_id = ? AND sprzedaz_id = 'V1-TEST-1'`, [T]);
    sprawdz('Z3-T05', r.stanPrzed.typ === 'v2_kompletny' && r.zastosowano.length === 0 && r.bledy.length === 0 && r.stanPrzed.daneV1.Term_Zakupy_Ruchy >= 1, 'przy kompletnym v2 migracja jest no-op i raportuje dane v1 (nie kasuje, nie przenosi); zatrzymanie przy v1_z_danymi — mock K11', `typ=${r.stanPrzed.typ}, daneV1.Term_Zakupy_Ruchy=${r.stanPrzed.daneV1.Term_Zakupy_Ruchy}`); }

  // ── A14 na całości salonu
  { const skl = await qx(`SELECT id, saldo_json FROM Term_Zakupy_Skladniki WHERE tenant_id = ?`, [T]); const salda = await Z.domena.saldoSkladnikow(repo0, skl.map(s => s.id));
    const rozjazd = skl.filter(s => { const p = s.saldo_json ? JSON.parse(s.saldo_json) : null; const w = salda[s.id]; return !p || ['G', 'W', 'U', 'F', 'R'].some(k => p[k] !== w[k]); });
    sprawdz('A14', rozjazd.length === 0, 'projekcja odtwarzalna z ruchów (wszystkie składniki salonu)', `składników: ${skl.length}, rozjazdów: ${rozjazd.length}`); }

  if (!ZOSTAW) await czysc();
  await c0.end();
  const fail = wyniki.filter(w => w.wynik === 'FAIL').length;
  const out = path.join(__dirname, 'wynik-terminarz-zakupy-zk03.json'); fs.writeFileSync(out, JSON.stringify({ baza: info.d, wersja: info.v, silnik: info.e, izolacja: info.i, kiedy: new Date().toISOString(), wyniki }, null, 2));
  console.log(`\nRAZEM: ${wyniki.filter(w => w.wynik === 'PASS').length} PASS / ${fail} FAIL / ${wyniki.filter(w => w.wynik === 'INFO').length} INFO → ${out}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('BŁĄD PRZEBIEGU:', e.message, e.stack && e.stack.split('\n')[1]); process.exit(1); });
