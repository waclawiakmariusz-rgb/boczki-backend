// narzedzia/testy-integracyjne/kandydat-zakupy-uspione.js — W06 planu wdrożenia (2026-10-17): dowód, że NIEAKTYWNA ewidencja zakupów
// nie wpływa na rdzeń ani zwykły kalendarz, w trzech konfiguracjach serwera kandydata (wszystkie na izolowanych bazach, localhost):
//   A  brak schematu v2 + pusta lista salonów        (--a  http://localhost:3998, baza .env.bezv2.local)
//   B  schemat v2 jest, pusta lista salonów          (--b  http://localhost:3999, baza .env.test)       ← konfiguracja produkcji po wdrożeniu
//   C  salon na liście, ewidencja nie uruchomiona    (--c  http://localhost:3996, baza .env.test, TERMINARZ_ZAKUPY_TENANTS=zk02-test)
//   D  bez dodatku Terminarz: salon zk02-test w bazie A (nigdy nie miał wpisu w Tenant_Features)
// node narzedzia/testy-integracyjne/kandydat-zakupy-uspione.js --haslo <plik> --haslo-a <plik> [--wynik plik.json]
const fs = require('fs'); const path = require('path');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const U = { A: arg('--a') || 'http://localhost:3998', B: arg('--b') || 'http://localhost:3999', C: arg('--c') || 'http://localhost:3996' };
for (const u of Object.values(U)) if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u)) { console.error('ODMOWA: tylko localhost: ' + u); process.exit(2); }
const H = { B: fs.readFileSync(arg('--haslo'), 'utf8').trim(), A: fs.readFileSync(arg('--haslo-a'), 'utf8').trim() }; H.C = H.B; // zk02-test ma skopiowany hash hasła demo-test (tylko baza izolowana)
const wyniki = []; let fail = 0;
const zapisz = (id, wynik, opis, dowod) => { wyniki.push({ id, wynik, opis, dowod: dowod ? String(dowod).slice(0, 300) : undefined }); if (wynik === 'FAIL') fail++; console.log(`${wynik.padEnd(4)} ${id} — ${opis}${dowod ? ' · ' + String(dowod).slice(0, 150) : ''}`); };
const sprawdz = (id, ok, opis, dowod) => zapisz(id, ok ? 'PASS' : 'FAIL', opis, dowod);
const post = async (base, body, tok) => { const r = await fetch(base + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { 'x-session-token': tok } : {}) }, body: JSON.stringify(body) }); const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { status: 'http', http: r.status, body: t.slice(0, 160) }; } };
const envZ = (plik) => Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '..', plik), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const dbq = async (plik, sql, p = []) => { const e = envZ(plik); const m = require('mysql2/promise'); const c = await m.createConnection({ host: e.DB_HOST, port: Number(e.DB_PORT), user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME }); try { const [r] = await c.query(sql, p); return r; } finally { await c.end(); } };
const V2 = ['Term_Przydzialy', 'Term_Realizacje', 'Term_Zakupy_Ruchy2', 'Term_Operacje', 'Term_Ewidencja', 'Term_Oferty_Wersje'];
const tabeleV2 = async (plik) => (await dbq(plik, `SELECT TABLE_NAME n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${V2.map(() => '?').join(',')})`, V2)).map(x => x.n);
const licznikiV2 = async (plik, tenant) => { const out = {}; for (const t of [...V2, 'Term_Zakupy', 'Term_Zakupy_Skladniki']) { try { out[t] = (await dbq(plik, `SELECT COUNT(*) n FROM ${t} WHERE tenant_id = ?`, [tenant]))[0].n; } catch (e) { out[t] = 'brak tabeli'; } } return out; };

async function sesja(base, tenant, haslo) {
  const l = await post(base, { action: 'login', login: tenant, haslo }); if (l.status !== 'success') throw new Error(`login ${tenant}@${base}: ` + JSON.stringify(l));
  const v = await post(base, { action: 'verify_pin', tenant_id: tenant, imie: 'Ola', pin: '1111' }, l.session_token); if (!v.session_token) throw new Error('verify_pin: ' + JSON.stringify(v));
  return (action, d = {}) => post(base, { action, tenant_id: tenant, pracownik: 'Ola', ...d }, v.session_token);
}
async function zwyklyKalendarz(id, api, tenant, dzien, uslugaId, idKlienta = '1001', prac = 'Anna') {
  const z = await api('trm_zapisz', { klucz_idem: id + '-' + Date.now(), start: dzien + ' 10:00', klient: { id_klienta: idKlienta, nazwa: 'Klientka próbna W06' }, pozycje: [{ usluga_id: uslugaId, pracownik: prac }] });
  const rez = z.rezerwacja || {};
  const zm = rez.id ? await api('trm_zmien', { id: rez.id, wersja: rez.wersja, start: dzien + ' 11:00', potwierdz: true }) : { status: 'pominięto' };
  const w2 = (zm.rezerwacja && zm.rezerwacja.wersja) || rez.wersja;
  const an = rez.id ? await api('trm_anuluj', { id: rez.id, wersja: w2, powod: 'W06', kto_anulowal: 'salon' }) : { status: 'pominięto' };
  const dz = await api('trm_dzien', { data: dzien });
  return { ok: z.status === 'success' && zm.status === 'success' && an.status === 'success' && dz.status === 'success', szczegoly: `zapisz=${z.status}${z.message ? '(' + z.message + ')' : ''} zmien=${zm.status} anuluj=${an.status} dzien=${dz.status}` };
}

(async () => {
  // ── A: brak schematu v2, lista pusta ──────────────────────────────────────────────────────────────────────
  const tA = await tabeleV2('.env.bezv2.local');
  sprawdz('W06-A1', tA.length === 0, 'A: po starcie serwera w bazie bez v2 NADAL nie ma żadnej tabeli v2 (start nie wykonuje DDL v2)', `tabele v2: ${tA.join(',') || 'brak'}`);
  const apiA = await sesja(U.A, 'demo-test', H.A);
  const initA = await apiA('trm_init');
  sprawdz('W06-A2', initA.status === 'success' && initA.ustawienia.zakupy_integracja === 'off' && initA.schemat_v2 && initA.schemat_v2.gotowy === false, 'A: trm_init działa; integracja off; schemat v2 zgłoszony jako niegotowy (bez błędu)', `integracja=${initA.ustawienia && initA.ustawienia.zakupy_integracja}, v2.gotowy=${initA.schemat_v2 && initA.schemat_v2.gotowy}, typ=${initA.schemat_v2 && initA.schemat_v2.typ}`);
  const kA = await zwyklyKalendarz('W06A', apiA, 'demo-test', '2026-11-24', 'DEMO-U-A');
  sprawdz('W06-A3', kA.ok, 'A: zwykła wizyta (zapis → przesunięcie → odwołanie → odczyt dnia) bez tabel v2', kA.szczegoly);
  const zkA = await apiA('trm_zakupy_klientki', { id_klienta: '1001' }); const pdA = await apiA('trm_zakupy_podglad', {}); const zapA = await apiA('trm_zapisz', { klucz_idem: 'W06A-zak-' + Date.now(), start: '2026-11-24 12:00', klient: { id_klienta: '1001', nazwa: 'Zestaw A' }, pozycje: [{ usluga_id: 'DEMO-U-A', pracownik: 'Anna', zakup_skladnik_id: 1 }] });
  sprawdz('W06-A4', zkA.status === 'success' && zkA.integracja === 'off' && (zkA.zakupy || []).length === 0 && pdA.status === 'error' && zapA.status === 'error', 'A: odczyt zakupów = pusto/off bez importu; podgląd i rezerwacja z zakupu odrzucone', `zakupy=${JSON.stringify(zkA).slice(0, 60)} | podgląd=${pdA.code || pdA.message} | zapis z zakupem=${zapA.message}`);
  const tA2 = await tabeleV2('.env.bezv2.local');
  sprawdz('W06-A5', tA2.length === 0, 'A: po operacjach nadal brak tabel v2 (żadna ścieżka nie tworzy ich „przy okazji”)');

  // ── B: schemat v2 jest, lista pusta (= produkcja po wdrożeniu) ────────────────────────────────────────────
  const przedB = await licznikiV2('.env.test', 'demo-test');
  const apiB = await sesja(U.B, 'demo-test', H.B);
  const initB = await apiB('trm_init');
  sprawdz('W06-B1', initB.status === 'success' && initB.ustawienia.zakupy_integracja === 'off' && initB.ustawienia.ewidencja === 'niedostepna' && initB.ustawienia.ewidencja_zapisana === 'aktywna', 'B: integracja off mimo schematu v2 i zapisanego trybu „aktywna” (stan zapisany nie jest maskowany, ale nic nie działa)', `integracja=${initB.ustawienia.zakupy_integracja}, ewidencja=${initB.ustawienia.ewidencja}, zapisana=${initB.ustawienia.ewidencja_zapisana}`);
  const kB = await zwyklyKalendarz('W06B', apiB, 'demo-test', '2026-11-25', 'DEMO-U-A');
  sprawdz('W06-B2', kB.ok, 'B: zwykła wizyta działa przy wyłączonej integracji', kB.szczegoly);
  const zkB = await apiB('trm_zakupy_klientki', { id_klienta: '1002' }); const pdB = await apiB('trm_zakupy_podglad', {}); const uzB = await apiB('trm_zakupy_uzgodnij', {}); const stB = await apiB('trm_ewidencja_stan', {});
  sprawdz('W06-B3', zkB.integracja === 'off' && (zkB.zakupy || []).length === 0 && [pdB, uzB, stB].every(r => r.status === 'error'), 'B: zakupy istniejące w v2 NIE są serwowane ani uzgadniane; akcje ewidencji odrzucone', `klientki=${zkB.integracja}/${(zkB.zakupy || []).length} | podgląd=${pdB.code} | uzgodnij=${uzB.code} | stan=${stB.code}`);
  const poB = await licznikiV2('.env.test', 'demo-test');
  sprawdz('W06-B4', JSON.stringify(przedB) === JSON.stringify(poB), 'B: liczniki tabel v2 salonu bez zmian po operacjach kalendarza (zero zapisów do v2)', JSON.stringify(poB));

  // ── C: salon na liście, ewidencja nie uruchomiona ─────────────────────────────────────────────────────────
  const apiC = await sesja(U.C, 'zk02-test', H.C);
  const initC = await apiC('trm_init');
  sprawdz('W06-C1', initC.status === 'success' && initC.ustawienia.zakupy_integracja === 'on' && initC.ustawienia.ewidencja === 'nie_uruchomiono', 'C: integracja on (lista), ale ewidencja „nie uruchomiono” → kolejna bramka', `integracja=${initC.ustawienia.zakupy_integracja}, ewidencja=${initC.ustawienia.ewidencja}`);
  const przedC = await licznikiV2('.env.test', 'zk02-test');
  const uslC = (await dbq('.env.test', 'SELECT usluga_id FROM Term_Uslugi WHERE tenant_id = ? LIMIT 1', ['zk02-test']))[0];
  let kC = { ok: null, szczegoly: 'brak usług w Term_Uslugi salonu zk02-test' };
  if (uslC) kC = await zwyklyKalendarz('W06C', apiC, 'zk02-test', '2026-11-26', uslC.usluga_id, '3001', 'Ola');
  zapisz('W06-C2', kC.ok === null ? 'INFO' : (kC.ok ? 'PASS' : 'FAIL'), 'C: zwykła wizyta bez zakupu działa mimo integracji on i nieuruchomionej ewidencji', kC.szczegoly);
  const zapC = await apiC('trm_zapisz', { klucz_idem: 'W06C-zak-' + Date.now(), start: '2026-11-26 13:00', klient: { id_klienta: '3001', nazwa: 'Klientka W06' }, pozycje: [{ usluga_id: uslC ? uslC.usluga_id : 'X', pracownik: 'Ola', zakup_skladnik_id: 1 }] });
  const urC = await apiC('trm_skladnik_uruchom', { skladnik_id: 1, decyzje: {} });
  sprawdz('W06-C3', zapC.status === 'error' && urC.status === 'error', 'C: rezerwacja z zakupu i uruchomienie składnika odrzucone (ewidencja nie uruchomiona)', `zapis=${zapC.code || zapC.message} | uruchom=${urC.code || urC.message}`);
  const poC = await licznikiV2('.env.test', 'zk02-test');
  sprawdz('W06-C4', JSON.stringify(przedC) === JSON.stringify(poC), 'C: zero zapisów do v2 dla tego salonu', JSON.stringify(poC));

  // ── D: bez dodatku Terminarz — salon zk02-test w bazie A (nigdy nie miał wpisu w Tenant_Features; bufor dodatków w procesie nie pozwala na przełączanie w locie) ──
  const apiD = await sesja(U.A, 'zk02-test', H.A);
  const initD = await apiD('trm_init'); const pdD = await apiD('trm_zakupy_podglad', {}); const rjD = await apiD('trm_zakupy_rejestruj', { pozycje: [] }); const zpD = await apiD('trm_zapisz', { klucz_idem: 'W06D-' + Date.now(), start: '2026-11-26 10:00', klient: { nazwa: 'X' }, pozycje: [] });
  const bezDodatku = (r) => r && r.status !== 'success' && (r.code === 'DODATEK' || r.feature_on === false || /dodat/i.test(r.message || ''));
  sprawdz('W06-D1', (initD.feature_on === false || bezDodatku(initD)) && [pdD, rjD, zpD].every(bezDodatku), 'D: bez dodatku Terminarz: trm_init = feature_on:false, a zakupy i zapis wizyty odrzucone (DODATEK) także bezpośrednim żądaniem', `init=${JSON.stringify(initD).slice(0, 60)} | podgląd=${pdD.code || pdD.message} | rejestruj=${rjD.code || rjD.message} | zapisz=${zpD.code || zpD.message}`);
  const klD = await post(U.A, { action: 'get_pin_users', tenant_id: 'zk02-test' }, null);
  sprawdz('W06-D2', klD.status !== 'http', 'D: rdzeń (ekran PIN) odpowiada normalnie bez dodatku', JSON.stringify(klD).slice(0, 80));

  const out = { kiedy: new Date().toISOString(), konfiguracje: U, wyniki };
  if (arg('--wynik')) fs.writeFileSync(arg('--wynik'), JSON.stringify(out, null, 2));
  console.log(`\nRAZEM: ${wyniki.filter(w => w.wynik === 'PASS').length} PASS / ${fail} FAIL / ${wyniki.filter(w => w.wynik === 'INFO').length} INFO`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
