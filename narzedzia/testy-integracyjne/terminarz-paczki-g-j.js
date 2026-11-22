// narzedzia/testy-integracyjne/terminarz-paczki-g-j.js
// Przejście przez serwer (nie przez atrapę) dla paczek G, I i J planu poprawy terminarza
// — docs/terminarz-audyt/PLAN_POPRAWY_2026-11-16.md.
//
// TYLKO SERWER TESTOWY: http://localhost:3999 (.env.test → izolowana MariaDB 3307, salon demo-test).
// Skrypt zakłada własne ślady i sam je sprząta na końcu. Nigdy nie uruchamiać przeciw produkcji.
//
// Uruchomienie:
//   node narzedzia/testy-integracyjne/terminarz-paczki-g-j.js
'use strict';
const fs = require('fs');

const B = 'http://localhost:3999';
const TENANT = 'demo-test';
const MANAGER = 'Ola';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').split(/\r?\n/)[0].trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wyniki = [];
const W = (id, ok, info) => { wyniki.push({ id, ok: !!ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${info}`); };

let H = {};
const post = (body) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify(body) })
  .then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { status: 'error', http: r.status, message: t.slice(0, 200) }; } });
const api = async (action, body = {}) => { await sleep(620); return post({ action, tenant_id: TENANT, pracownik: MANAGER, ...body }); };   // limit 120 zapytań/min

const dzis = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const plusDni = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d) => { const g = new Date(d + 'T12:00:00').getDay(); return g === 0 ? 7 : g; };

const doUsuniecia = [];       // id rezerwacji
const doSprzatania = [];      // funkcje, w odwrotnej kolejności

(async () => {
  // ─── logowanie: salon + PIN osoby (API terminarza wymaga sesji po PIN-ie) ───
  const login = await post({ action: 'login', login: TENANT, haslo: HASLO });
  if (login.status !== 'success') throw new Error('login: ' + JSON.stringify(login).slice(0, 200));
  H = { 'x-session-token': login.session_token };
  const pin = await post({ action: 'verify_pin', tenant_id: TENANT, imie: MANAGER, pin: '1111' });
  if (pin.status !== 'success') throw new Error('verify_pin: ' + JSON.stringify(pin).slice(0, 200));
  H = { 'x-session-token': pin.session_token };

  const init = await api('trm_init');
  if (init.status !== 'success') throw new Error('trm_init: ' + JSON.stringify(init).slice(0, 300));
  const prac = (init.pracownicy || []).map((p) => (typeof p === 'string' ? p : p.imie));
  const zespol = init.zespol || [];
  const graf = init.grafik || [];
  const wykonuje = (p) => { const z = zespol.find((x) => x.pracownik === p); return !z || Number(z.wykonuje_zabiegi) !== 0; };
  const P = prac.find((p) => wykonuje(p) && graf.some((g) => g.pracownik === p)) || prac.find(wykonuje);
  if (!P) throw new Error('brak pracownika wykonującego zabiegi');
  const uslugi = (init.uslugi || init.katalog || []).map((u) => (u.usluga_id === undefined && u.id !== undefined ? { ...u, usluga_id: u.id } : u));
  const pasuje = (u) => Number(u.czas_min) > 0 && !u.wymaga_gabinet && !(u.urzadzenia && u.urzadzenia.length)
    && (!u.pracownicy || !u.pracownicy.length || u.pracownicy.includes(P)) && u.aktywna !== 0 && u.aktywna !== false;
  const U = uslugi.filter(pasuje).slice(0, 2);
  if (U.length < 2) throw new Error('potrzebne dwie usługi bez gabinetu/urządzenia, jest ' + U.length);
  const poz = U.map((u) => ({ usluga_id: u.usluga_id, pracownik: P }));

  // dzień roboczy z wolnym terminem, z dala od dni zasiewu innych prób (+1, +3); weekend omijamy
  const szukaj = async (d) => { const r = await api('trm_szukaj', { dzien_od: d, dzien_do: d, limit: 20, pozycje: poz }); return r.terminy || []; };
  let DZ = null, start = null;
  for (let i = 8; i < 30 && !DZ; i++) {
    const d = plusDni(dzis, i);
    if (dow(d) > 5) continue;                     // „niskie" z planu: zasiew nie trafia w weekend
    const t = await szukaj(d);
    if (t.length >= 3) { DZ = d; start = t[0].start; }
  }
  if (!DZ) throw new Error('nie znalazłem dnia roboczego z wolnymi terminami');
  console.log(`zasiew: ${DZ} (dzień tygodnia ${dow(DZ)}) od ${start.slice(11, 16)}, osoba ${P}, usługi ${U.map((u) => u.usluga_id).join(' + ')}`);

  // ─── G/R9: nieobecność zdejmuje tylko to, co było zaplanowane; cofnięcie wraca tylko to ───
  const zapisz = await api('trm_zapisz', {
    klucz_idem: 'paczki-gj-' + Date.now(), kanal: 'telefon', bez_kartoteki: true,
    klient: { nazwa: 'Próba Paczki G', telefon: '600555111' },
    pozycje: poz, start, notatka: 'PRÓBA PACZEK G–J — do usunięcia',
  });
  const rezId = zapisz.rezerwacja && zapisz.rezerwacja.id;
  W('G0 zasiew', zapisz.status === 'success' && !!rezId,
    rezId ? `wizyta ${zapisz.rezerwacja.numer} (id ${rezId}), pozycji ${zapisz.rezerwacja.pozycje.length}` : JSON.stringify(zapisz).slice(0, 300));
  if (!rezId) throw new Error('bez wizyty nie ma czego sprawdzać');
  doUsuniecia.push(rezId);

  const pozycje = zapisz.rezerwacja.pozycje;
  const stany = (r) => (r.pozycje || []).map((p) => `${p.id}:${p.stan}`).join(' ');
  // jedna pozycja odpuszczona RĘCZNIE przed nieobecnością — to ta, która NIE ma wrócić
  const recznie = await api('trm_pozycja_stan', { id: rezId, pozycja_id: pozycje[1].id, stan: 'niewykonana' });
  W('G1 ręczne odpuszczenie zabiegu', recznie.status === 'success' && recznie.rezerwacja
    && recznie.rezerwacja.pozycje.find((p) => p.id === pozycje[1].id).stan === 'niewykonana',
    recznie.rezerwacja ? stany(recznie.rezerwacja) : JSON.stringify(recznie.message).slice(0, 150));

  const nieob = await api('trm_obecnosc', { id: rezId, obecnosc: 'nieobecny', powod: 'próba paczki G' });
  W('G2 nieobecność zdejmuje zaplanowane', nieob.status === 'success'
    && nieob.rezerwacja.pozycje.every((p) => p.stan === 'niewykonana'),
    nieob.rezerwacja ? stany(nieob.rezerwacja) : JSON.stringify(nieob.message).slice(0, 150));

  const cofniecie = await api('trm_obecnosc', { id: rezId, obecnosc: 'przybyl' });
  const po = cofniecie.rezerwacja ? cofniecie.rezerwacja.pozycje : [];
  const wrocila = po.find((p) => p.id === pozycje[0].id);
  const zostala = po.find((p) => p.id === pozycje[1].id);
  W('G3 cofnięcie wraca TYLKO po nieobecności', cofniecie.status === 'success' && cofniecie.przywrocone === 1
    && wrocila && wrocila.stan === 'zaplanowana' && zostala && zostala.stan === 'niewykonana',
    `przywrócone=${cofniecie.przywrocone}, ${cofniecie.rezerwacja ? stany(cofniecie.rezerwacja) : JSON.stringify(cofniecie.message).slice(0, 150)}`);
  W('G4 komunikat cofnięcia jest zdaniem dla człowieka', /zabieg wrócił do planu/.test(cofniecie.message || ''), JSON.stringify(cofniecie.message || '(brak)').slice(0, 170));

  // ─── G: nieobecność bez wskazania kogo/czego ───
  const puste = await api('trm_nieobecnosc_zapisz', { od: DZ + ' 09:00', do: DZ + ' 17:00', typ: 'inne', opis: 'próba bez adresata' });
  W('G5 nieobecność bez adresata odrzucona', puste.status !== 'success' && /Wskaż, kogo albo czego dotyczy/.test(puste.message || ''), JSON.stringify(puste.message || puste).slice(0, 170));

  const dzienSalonu = plusDni(DZ, 1);
  const calySalon = await api('trm_nieobecnosc_zapisz', { od: dzienSalonu + ' 09:00', do: dzienSalonu + ' 17:00', typ: 'zamkniete', caly_salon: true, wymus: true, opis: 'próba: cały salon' });
  W('G6 „cały salon" nadal przechodzi', calySalon.status === 'success', JSON.stringify(calySalon.message || calySalon.status).slice(0, 120));
  if (calySalon.status === 'success') {
    const lista = await api('trm_dzien', { data: dzienSalonu });
    const n = (lista.nieobecnosci || []).find((x) => x.opis === 'próba: cały salon');
    if (n) doSprzatania.push(async () => { const u = await api('trm_nieobecnosc_usun', { id: n.id }); console.log('sprzątanie: nieobecność całego salonu →', u.status); });
  }

  // ─── I/R11: nieobecność wpisana z nadmiarową spacją i tak blokuje osobę ───
  const dzienSpacji = plusDni(DZ, 2);
  const zeSpacja = await api('trm_nieobecnosc_zapisz', {
    od: dzienSpacji + ' 09:00', do: dzienSpacji + ' 17:00', typ: 'urlop', wymus: true,
    pracownik_nieob: ' ' + P + ' ', opis: 'próba I: imię ze spacjami',
  });
  W('I1 nieobecność z imieniem w spacjach zapisana', zeSpacja.status === 'success', JSON.stringify(zeSpacja.message || zeSpacja.status).slice(0, 120));
  if (zeSpacja.status === 'success') {
    const lista = await api('trm_dzien', { data: dzienSpacji });
    const n = (lista.nieobecnosci || []).find((x) => x.opis === 'próba I: imię ze spacjami');
    if (n) doSprzatania.push(async () => { const u = await api('trm_nieobecnosc_usun', { id: n.id }); console.log('sprzątanie: nieobecność ze spacjami →', u.status); });
    const sprawdz = await api('trm_sprawdz', { start: dzienSpacji + ' 11:00', pozycje: [poz[0]], mimo_grafiku: true });
    const kody = (sprawdz.problemy || []).map((p) => p.kod).join(',');
    W('I2 ta sama osoba rozpoznana mimo pisowni', /NIEOBECNOSC/.test(kody), `kody problemów: ${kody || '(brak — termin uznany za wolny!)'}`);
  }

  // ─── J: czas trwania usługi musi być liczbą ───
  const zlyCzas = await api('trm_usluga_zapisz', { usluga_id: U[0].usluga_id, czas_min: 'abc' });
  W('J1 śmieci w czasie usługi odrzucone', zlyCzas.status !== 'success' && /musi być liczbą minut/.test(zlyCzas.message || ''), JSON.stringify(zlyCzas.message || zlyCzas).slice(0, 170));
  const przecinek = await api('trm_usluga_zapisz', { usluga_id: U[0].usluga_id, czas_min: '44,5' });
  W('J2 przecinek też odrzucony, a nie zamieniony na 5 minut', przecinek.status !== 'success' && /musi być liczbą minut/.test(przecinek.message || ''), JSON.stringify(przecinek.message || przecinek).slice(0, 120));
  const dobryCzas = await api('trm_usluga_zapisz', { usluga_id: U[0].usluga_id, czas_min: U[0].czas_min });
  W('J3 poprawny czas nadal zapisywany', dobryCzas.status === 'success', `czas ${U[0].czas_min} min → ${dobryCzas.status}`);

  // ─── Sprzątanie ────────────────────────────────────────────────────────────
  for (const f of doSprzatania.reverse()) { try { await f(); } catch (e) { console.log('sprzątanie — błąd:', e.message); } }
  for (const id of doUsuniecia) {
    const akt = await api('trm_rezerwacja', { id });
    const wersja = akt.rezerwacja ? akt.rezerwacja.wersja : null;
    const u = await api('trm_usun', { id, wersja, powod: 'sprzątanie po próbie paczek G–J', potwierdz: true });
    console.log(`sprzątanie: wizyta ${id} →`, u.status, u.message ? '· ' + String(u.message).slice(0, 80) : '');
  }

  const zle = wyniki.filter((w) => !w.ok);
  console.log(`\n=== ${wyniki.length - zle.length}/${wyniki.length} przeszło ===`);
  if (zle.length) { console.log('NIE PRZESZŁY: ' + zle.map((w) => w.id).join(', ')); process.exit(1); }
})().catch((e) => { console.error('BŁĄD PRÓBY:', e.message); process.exit(1); });
