// tests/terminarz-zakupy-zk03.test.js — ZK-03: klasyfikacja źródeł, rozbita sprzedaż, wersje, rejestracja, stan początkowy, istniejące wizyty,
// uruchomienie, stan ewidencji (R4). RODZAJ PRÓB: jednostkowe na repozytorium w pamięci + kontrakt handlerów na atrapie bazy.
// Próby na rzeczywistej bazie: narzedzia/testy-integracyjne/terminarz-zakupy.js.
const request = require('supertest'); const express = require('express');
const Z = require('../routes/terminarz-zakupy');
const { repoPamiec } = require('./helpers/repoPamiec');
const { logika, domena } = Z;

const T = 'salon-test-003';
const ctx = (tryb = 'aktywna', autor = 'Ola') => ({ tenant: T, autor, autor_id: 'u-ola', rola: 'manager', teraz: '2026-10-17 10:00:00', tryb, techniczna: tryb !== 'niedostepna', zapisany: tryb === 'niedostepna' ? 'aktywna' : tryb, widziKwoty: true });
const DZIS = '2026-10-17';
const saldo = async (repo, id) => (await domena.saldoSkladnikow(repo, [id]))[id];
const sprzedaz = (repo, r) => { repo._T.sprzedaz.push({ status: 'AKTYWNY', kategoria_produktu: null, data_waznosci: null, karnet_zamkniety_w: null, grupa_id: null, zwrot_do_id: null, szczegoly: '', platnosc: 'Karta', ...r }); return r.id; };
/** Cennik + oferta „Endermologia / 5x” = pakiet 5 × U-A (od 2026-01-01), „Pakiet 5A+4B” = 5 × U-A + 4 × U-B, „Endermologia / 1x” = nie_ewidencjonuj, „Meltivio / 1x” → brak mapowania. */
function katalog(repo) {
  repo.dodajUsluge({ id: 'U-A', kategoria: 'Endermologia', wariant: '1x' }); repo.dodajUsluge({ id: 'U-A5', kategoria: 'Endermologia', wariant: '5x' });
  repo.dodajUsluge({ id: 'U-B', kategoria: 'Meltivio', wariant: '1x' }); repo.dodajUsluge({ id: 'U-AB', kategoria: 'Pakiet', wariant: '5A+4B' });
  repo.dodajUsluge({ id: 'U-1Z', kategoria: 'Konsultacja', wariant: '1x z góry' });
  repo.dodajOferte('U-A5', [{ wersja: 1, rodzaj: 'pakiet', od: '2026-01-01 00:00:00', skladniki: [{ usluga_wyk_id: 'U-A', jednostki: 5 }] }]);
  repo.dodajOferte('U-AB', [{ wersja: 1, rodzaj: 'pakiet', od: '2026-01-01 00:00:00', skladniki: [{ usluga_wyk_id: 'U-A', jednostki: 5 }, { usluga_wyk_id: 'U-B', jednostki: 4 }] }]);
  repo.dodajOferte('U-A', [{ wersja: 1, rodzaj: 'nie_ewidencjonuj', od: '2026-01-01 00:00:00', skladniki: [] }]);
  repo.dodajOferte('U-1Z', [{ wersja: 1, rodzaj: 'pojedynczy_z_gory', od: '2026-01-01 00:00:00', skladniki: [{ usluga_wyk_id: 'U-1Z', jednostki: 1 }] }]);
}
const pozycja = (repo, { id_klienta = '1001', usluga_id = 'U-A', start = `${DZIS} 12:00:00`, stan = 'zaplanowana' } = {}) => { const rez = repo.dodajRezerwacje({ id_klienta, klient_nazwa: 'K ' + id_klienta }); return repo.dodajPozycje({ rezerwacja_id: rez, usluga_id, start, kategoria: 'Endermologia', stan }); };

describe('Z3-01 — klasyfikacja źródeł (Z3-T10, T11, T12, T13, T14, T15, T16)', () => {
  test('T13: produkt, zwrot, dopłata, sam portfel (brak wiersza), bez ID klientki, „1x” nie_ewidencjonuj → zero jednostek z jasnym powodem', async () => {
    const repo = repoPamiec(T); katalog(repo); const c = ctx();
    sprzedaz(repo, { id: 'P1-1', id_klienta: '1001', zabieg: 'Kosmetyk: Krem', szczegoly: '1 szt.', kategoria_produktu: 'Kosmetyk', kwota: 100, data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'P2-1', id_klienta: '1001', zabieg: 'ZWROT: Endermologia', szczegoly: '', kwota: -200, zwrot_do_id: 'X-1', data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'P3-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '1x', kwota: 200, data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'P4-1', id_klienta: null, zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'P5-1', id_klienta: '1001', zabieg: 'Meltivio', szczegoly: '1x', kwota: 300, data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'P6-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '2 przyłożenia', kwota: 300, data_sprzedazy: '2026-10-10 10:00:00' });
    const w = await domena.podgladZrodel(repo, c, { id_klienta: null });
    const k = Object.fromEntries(w.pozycje.map(p => [p.sprzedaz_id, p]));
    expect(k['P1-1']).toMatchObject({ kategoria: 'pominiete', powod: 'produkt' });
    expect(k['P2-1']).toMatchObject({ kategoria: 'pominiete', powod: 'wiersz zwrotu' });
    expect(k['P3-1']).toMatchObject({ kategoria: 'pominiete', rodzaj: 'nie_ewidencjonuj' });
    expect(k['P4-1']).toMatchObject({ kategoria: 'wymaga_rozstrzygniecia' }); expect(k['P4-1'].powod).toMatch(/ID klientki/);
    expect(k['P5-1']).toMatchObject({ kategoria: 'wymaga_mapowania' }); // brak zatwierdzonego mapowania
    expect(k['P6-1']).toMatchObject({ kategoria: 'wymaga_mapowania' }); // „2 przyłożenia” nie ma pozycji w cenniku → nie zgadujemy
    expect(w.pozycje.every(p => p.kategoria !== 'gotowe')).toBe(true);
    expect(repo._T.zakupy).toHaveLength(0); expect(repo._T.ruchy).toHaveLength(0); // podgląd nie mutuje (Z3-T18)
  });
  test('T10: dwa powielone wiersze oferty 5A+4B (grupa_id) → dwa źródła, 10 A i 8 B, bez mnożnika z grupy', async () => {
    const repo = repoPamiec(T); katalog(repo); const c = ctx();
    sprzedaz(repo, { id: 'G1-1', id_klienta: '1001', zabieg: 'Pakiet', szczegoly: '5A+4B', kwota: 2000, grupa_id: 'GRP-1', data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'G1-2', id_klienta: '1001', zabieg: 'Pakiet', szczegoly: '5A+4B', kwota: 2000, grupa_id: 'GRP-1', data_sprzedazy: '2026-10-10 10:00:00' });
    const w = await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'G1-1' }, { sprzedaz_id: 'G1-2' }] });
    expect(w.zarejestrowano).toBe(2); expect(repo._T.zakupy).toHaveLength(2);
    const sumy = {}; for (const s of repo._T.skladniki) sumy[s.usluga_wyk_id] = (sumy[s.usluga_wyk_id] || 0) + (await saldo(repo, s.id)).G;
    expect(sumy).toEqual({ 'U-A': 10, 'U-B': 8 });
    expect(repo._T.skladniki.every(s => s.stan_weryfikacji === 'niezweryfikowany')).toBe(true); // rejestracja nie zakłada zera (§6.3)
  });
  test('T11/T12: rozbita sprzedaż (200 zł z portfela + 800 zł dopłaty) → jeden pakiet; zwrot 100 zł przypisany do dopłaty wykrywany jako zmiana tego zakupu', async () => {
    const repo = repoPamiec(T); katalog(repo); const c = ctx();
    sprzedaz(repo, { id: 'R1-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 200, platnosc: 'Portfel', data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'R1-2', id_klienta: '1001', zabieg: 'Endermologia Dopłata', szczegoly: '', kwota: 800, platnosc: 'Karta', data_sprzedazy: '2026-10-10 10:00:00' });
    const pod = await domena.podgladZrodel(repo, c, {});
    expect(pod.pozycje.find(p => p.sprzedaz_id === 'R1-1')).toMatchObject({ kategoria: 'gotowe', powiazane: ['R1-2'] });
    expect(pod.pozycje.find(p => p.sprzedaz_id === 'R1-2')).toMatchObject({ kategoria: 'pominiete' }); expect(pod.pozycje.find(p => p.sprzedaz_id === 'R1-2').powod).toMatch(/dopłaty/);
    const w = await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'R1-1' }, { sprzedaz_id: 'R1-2' }] });
    expect(w.zarejestrowano).toBe(1); expect(repo._T.zakupy).toHaveLength(1); expect(JSON.parse(repo._T.zakupy[0].zrodla_json)).toEqual(['R1-2']);
    expect((await saldo(repo, repo._T.skladniki[0].id)).G).toBe(5);
    const z = await repo.zakup(repo._T.zakupy[0].id); expect((await domena.uzgodnijZrodlo(repo, c, z)).zmiana).toBe('brak');
    sprzedaz(repo, { id: 'R9-1', id_klienta: '1001', zabieg: 'ZWROT: Endermologia Dopłata', kwota: -100, zwrot_do_id: 'R1-2', data_sprzedazy: '2026-10-12 10:00:00' }); // zwrot do DOPŁATY (kanoniczne ID wskazuje inny wiersz)
    const u = await domena.uzgodnijZrodlo(repo, c, await repo.zakup(z.id));
    expect(u.zmiana).toBe('zwrot'); expect(u.stan_zrodla).toBe('do_uzgodnienia'); // częściowy zwrot pieniężny = zakres do ustalenia, nie 5→4
    expect((await saldo(repo, repo._T.skladniki[0].id)).G).toBe(5); // brak przeliczenia kwoty na sesje
  });
  test('rozbita sprzedaż z dwiema pozycjami tej samej oferty bez grupy → dopłata niejednoznaczna → do rozstrzygnięcia; jawne wskazanie powiązania rejestruje', async () => {
    const repo = repoPamiec(T); katalog(repo); const c = ctx();
    sprzedaz(repo, { id: 'N1-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 500, data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'N1-2', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'N1-3', id_klienta: '1001', zabieg: 'Endermologia Dopłata', szczegoly: '', kwota: 400, data_sprzedazy: '2026-10-10 10:00:00' });
    const pod = await domena.podgladZrodel(repo, c, {});
    expect(pod.pozycje.find(p => p.sprzedaz_id === 'N1-1').kategoria).toBe('wymaga_rozstrzygniecia');
    const w = await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'N1-1', powiazane: ['N1-3'] }, { sprzedaz_id: 'N1-2', powiazane: [] }] });
    expect(w.zarejestrowano).toBe(2); expect(JSON.parse(repo._T.zakupy[0].zrodla_json)).toEqual(['N1-3']); expect(JSON.parse(repo._T.zakupy[1].zrodla_json)).toEqual([]);
  });
  test('T14: jawna oferta „1× na przyszłość” → jedna jednostka, kwalifikacja do potwierdzenia per zakup; powtórzenie nie zwiększa G; inna sprzedaż „1x” tej samej usługi nie otwiera się', async () => {
    const repo = repoPamiec(T); katalog(repo); const c = ctx();
    sprzedaz(repo, { id: 'J1-1', id_klienta: '1001', zabieg: 'Konsultacja', szczegoly: '1x z góry', kwota: 150, data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'J2-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '1x', kwota: 200, data_sprzedazy: '2026-10-10 10:00:00' });
    const w1 = await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'J1-1' }, { sprzedaz_id: 'J2-1' }] });
    expect(w1.zarejestrowano).toBe(1); expect(w1.wyniki.find(x => x.sprzedaz_id === 'J2-1').wynik).toBe('pominiete');
    const z = repo._T.zakupy[0]; expect(z.kwalifikacja).toBe('do_sprawdzenia'); const s = repo._T.skladniki[0]; expect((await saldo(repo, s.id)).G).toBe(1);
    await domena.weryfikujSkladnik(repo, c, { skladnik_id: s.id, hist_wykorzystane: 0, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' });
    await expect(domena.uruchomSkladnik(repo, c, { skladnik_id: s.id, potwierdzenie_zaleznych: true })).rejects.toMatchObject({ extra: { code: 'KWALIFIKACJA' } });
    await domena.kwalifikujZakup(repo, c, { zakup_id: z.id, kwalifikacja: 'pojedynczy_z_gory', powod: 'klientka zapłaciła z góry, zabieg nie odbył się' });
    await domena.uruchomSkladnik(repo, c, { skladnik_id: s.id, potwierdzenie_zaleznych: true });
    const w2 = await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'J1-1' }] }); expect(w2.istnialo).toBe(1); expect((await saldo(repo, s.id)).G).toBe(1);
  });
  test('T15/T16/T17: wersja wg daty sprzedaży; sprzedaż sprzed mapowania i dwie wersje tego samego dnia → rozstrzygnięcie; ponowny import nie dubluje', async () => {
    const repo = repoPamiec(T); const c = ctx();
    repo.dodajUsluge({ id: 'U-A', kategoria: 'Endermologia', wariant: '1x' }); repo.dodajUsluge({ id: 'U-A5', kategoria: 'Endermologia', wariant: '5x' }); repo.dodajUsluge({ id: 'U-B', kategoria: 'Meltivio', wariant: '1x' });
    repo.dodajOferte('U-A5', [{ wersja: 1, rodzaj: 'pakiet', od: '2026-06-01 09:00:00', do: '2026-10-15 09:00:00', skladniki: [{ usluga_wyk_id: 'U-A', jednostki: 5 }] }, { wersja: 2, rodzaj: 'pakiet', od: '2026-10-15 09:00:00', skladniki: [{ usluga_wyk_id: 'U-A', jednostki: 4 }, { usluga_wyk_id: 'U-B', jednostki: 1 }] }]);
    sprzedaz(repo, { id: 'W1-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-09-01 10:00:00' }); // stara wersja (5 A)
    sprzedaz(repo, { id: 'W2-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-10-16 10:00:00' }); // nowa wersja (4 A + 1 B)
    sprzedaz(repo, { id: 'W3-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-05-01 10:00:00' }); // sprzed mapowania
    sprzedaz(repo, { id: 'W4-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-10-15 18:00:00' }); // dzień zmiany wersji
    const pod = await domena.podgladZrodel(repo, c, {}); const k = Object.fromEntries(pod.pozycje.map(p => [p.sprzedaz_id, p]));
    expect(k['W1-1']).toMatchObject({ kategoria: 'gotowe', wersja: 1 }); expect(k['W2-1']).toMatchObject({ kategoria: 'gotowe', wersja: 2 });
    expect(k['W3-1'].kategoria).toBe('wymaga_rozstrzygniecia'); expect(k['W3-1'].powod).toMatch(/sprzed pierwszej wersji/);
    expect(k['W4-1'].kategoria).toBe('wymaga_rozstrzygniecia'); expect(k['W4-1'].powod).toMatch(/dwie wersje/);
    const w = await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'W1-1' }, { sprzedaz_id: 'W2-1' }, { sprzedaz_id: 'W3-1' }, { sprzedaz_id: 'W4-1' }] });
    expect(w.zarejestrowano).toBe(2); expect(w.wyniki.filter(x => x.wynik === 'wymaga_rozstrzygniecia')).toHaveLength(2);
    const z1 = repo._T.zakupy.find(z => z.sprzedaz_id === 'W1-1'), z2 = repo._T.zakupy.find(z => z.sprzedaz_id === 'W2-1');
    expect(repo._T.skladniki.filter(s => s.zakup_id === z1.id).map(s => s.jednostki_przyznane)).toEqual([5]); expect(repo._T.skladniki.filter(s => s.zakup_id === z2.id).map(s => s.jednostki_przyznane)).toEqual([4, 1]);
    const w3 = await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'W3-1', wersja_id: repo._T.wersje[0].id }] }); expect(w3.zarejestrowano).toBe(1); // jawne wskazanie wersji
    const przed = repo._T.ruchy.length; const w4 = await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'W2-1' }, { sprzedaz_id: 'W1-1' }, { sprzedaz_id: 'W3-1' }] });
    expect(w4.istnialo).toBe(3); expect(w4.zarejestrowano).toBe(0); expect(repo._T.ruchy.length).toBe(przed); expect(repo._T.zakupy).toHaveLength(3); // T17: inna kolejność, bez duplikatów
  });
  test('T26: dwie klientki o tej samej nazwie — własność po ID; zakup obcej klientki niewidoczny i odrzucany', async () => {
    const repo = repoPamiec(T); katalog(repo); const c = ctx();
    sprzedaz(repo, { id: 'S1-1', id_klienta: '1001', klient: 'Anna Nowak', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-10-10 10:00:00' });
    sprzedaz(repo, { id: 'S2-1', id_klienta: '1002', klient: 'Anna Nowak', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-10-10 10:00:00' });
    await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'S1-1' }, { sprzedaz_id: 'S2-1' }] });
    expect((await Z.widokZakupow(repo, c, { id_klienta: '1001' })).map(z => z.sprzedaz_id)).toEqual(['S1-1']);
    const s2 = repo._T.skladniki.find(s => s.zakup_id === repo._T.zakupy[1].id);
    await domena.weryfikujSkladnik(repo, c, { skladnik_id: s2.id, hist_wykorzystane: 0, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' }); await domena.uruchomSkladnik(repo, c, { skladnik_id: s2.id, potwierdzenie_zaleznych: true });
    await expect(domena.rezerwuj(repo, c, { pozycje: [{ pozycja_id: pozycja(repo, { id_klienta: '1001' }), skladnik_id: s2.id, usluga_id: 'U-A' }], id_klienta: '1001', data: DZIS, uslugaPozycji: p => p.usluga_id })).rejects.toMatchObject({ extra: { code: 'WLASCICIEL' } });
  });
});

describe('Z3-04/05/06 — stan początkowy, istniejące wizyty, uruchomienie (T19, T20, T21, T22, T23, T24, T25, T28)', () => {
  async function pakiet10(repo, c, idK = '1001') { const r = await domena.przyznaj(repo, ctx('aktywna'), { id_klienta: idK, usluga_wyk_id: 'U-A', usluga_nazwa: 'Endermologia', jednostki: 10, powod: 'zestaw D', zweryfikowany: false }); return r.skladnik_id; }
  test('T20: puste pole ≠ zero; nieprawidłowy bilans odrzucony; ponowny zapis tego samego stanu nie dodaje ruchów', async () => {
    const repo = repoPamiec(T); const c = ctx(); const s = await pakiet10(repo, c);
    await expect(domena.weryfikujSkladnik(repo, c, { skladnik_id: s, hist_wykorzystane: 3, hist_wycofane: '', hist_potracone: 0, zrodlo_ustalen: 'x' })).rejects.toMatchObject({ extra: { code: 'PUSTE_POLE', pole: 'W' } });
    await expect(domena.weryfikujSkladnik(repo, c, { skladnik_id: s, hist_wykorzystane: 11, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' })).rejects.toMatchObject({ extra: { code: 'BILANS_NIEMOZLIWY' } });
    await domena.weryfikujSkladnik(repo, c, { skladnik_id: s, hist_wykorzystane: 3, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'karta klientki' });
    const n = repo._T.ruchy.length; const w = await domena.weryfikujSkladnik(repo, c, { skladnik_id: s, hist_wykorzystane: 3, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'karta klientki' });
    expect(w.powtorzenie).toBe(true); expect(repo._T.ruchy.length).toBe(n); expect(await saldo(repo, s)).toMatchObject({ G: 10, U: 3, U_hist: 3, B: 7 });
  });
  test('T21/T23: G=10, U_hist=3, 6 istniejących wizyt (w tym przeszła nierozstrzygnięta i odległa) → po uruchomieniu R=6, B=1; bez drugiego U', async () => {
    const repo = repoPamiec(T); const c = ctx(); const s = await pakiet10(repo, c);
    await domena.weryfikujSkladnik(repo, c, { skladnik_id: s, hist_wykorzystane: 3, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' });
    const poz = [pozycja(repo, { start: '2026-10-10 10:00:00', stan: 'w_trakcie' }), pozycja(repo, { start: '2026-10-20 10:00:00' }), pozycja(repo, { start: '2026-10-27 10:00:00' }), pozycja(repo, { start: '2026-11-03 10:00:00' }), pozycja(repo, { start: '2026-11-10 10:00:00' }), pozycja(repo, { start: '2027-01-05 10:00:00' })];
    pozycja(repo, { id_klienta: '1002' }); pozycja(repo, { usluga_id: 'U-B' }); // inna klientka / inna usługa — nie są kandydatami
    const kand = await domena.kandydaciWizyt(repo, c, { skladnik_id: s });
    expect(kand.kandydaci).toHaveLength(6); expect(kand.kandydaci[0].przeszla).toBe(true); expect(kand.niedobor).toBe(0); expect(kand.saldo.B).toBe(7);
    const w = await domena.uruchomSkladnik(repo, c, { skladnik_id: s, decyzje: poz.map(p => ({ pozycja_id: p, decyzja: 'powiaz' })), skrot: kand.skrot, potwierdzenie_zaleznych: true });
    expect(w.plan).toBe(false); expect(w.przydzialy).toHaveLength(6); expect(await saldo(repo, s)).toMatchObject({ G: 10, U: 3, R: 6, B: 1 });
    const w2 = await domena.wykonaj(repo, c, { pozycja_id: poz[1] }); expect(w2.zuzyto).toBe(1); expect(await saldo(repo, s)).toMatchObject({ U: 4, R: 5, B: 1 });
    expect((await domena.kandydaciWizyt(repo, c, { skladnik_id: s })).kandydaci.filter(k => !k.juz_powiazana)).toHaveLength(0); // ponowne powiązanie niemożliwe
  });
  test('T22: 5 praw i 7 wizyt → bez decyzji dla 2 wizyt odmowa; 5 powiązań + 2 jawne decyzje; nic nie znika, brak minusa', async () => {
    const repo = repoPamiec(T); const c = ctx(); const s = await pakiet10(repo, c);
    await domena.weryfikujSkladnik(repo, c, { skladnik_id: s, hist_wykorzystane: 5, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' });
    const poz = Array.from({ length: 7 }, (_, i) => pozycja(repo, { start: `2026-11-${String(i + 3).padStart(2, '0')} 10:00:00` }));
    const kand = await domena.kandydaciWizyt(repo, c, { skladnik_id: s }); expect(kand.niedobor).toBe(2);
    await expect(domena.uruchomSkladnik(repo, c, { skladnik_id: s, decyzje: poz.map(p => ({ pozycja_id: p, decyzja: 'powiaz' })), skrot: kand.skrot, potwierdzenie_zaleznych: true })).rejects.toMatchObject({ extra: { code: 'NIEDOBOR', dostepne: 5, potrzeba: 7 } });
    await expect(domena.uruchomSkladnik(repo, c, { skladnik_id: s, decyzje: poz.slice(0, 5).map(p => ({ pozycja_id: p, decyzja: 'powiaz' })), skrot: kand.skrot, potwierdzenie_zaleznych: true })).rejects.toMatchObject({ extra: { code: 'BRAK_DECYZJI' } });
    await expect(domena.uruchomSkladnik(repo, c, { skladnik_id: s, decyzje: [...poz.slice(0, 5).map(p => ({ pozycja_id: p, decyzja: 'powiaz' })), { pozycja_id: poz[5], decyzja: 'wyjasnienie' }, { pozycja_id: poz[6], decyzja: 'jednorazowa' }], skrot: kand.skrot, potwierdzenie_zaleznych: true })).rejects.toMatchObject({ extra: { code: 'BRAK_UZASADNIENIA' } });
    const w = await domena.uruchomSkladnik(repo, c, { skladnik_id: s, decyzje: [...poz.slice(0, 5).map(p => ({ pozycja_id: p, decyzja: 'powiaz' })), { pozycja_id: poz[5], decyzja: 'wyjasnienie', uzasadnienie: 'brak zakupu na 6. zabieg' }, { pozycja_id: poz[6], decyzja: 'jednorazowa' }], skrot: kand.skrot, potwierdzenie_zaleznych: true });
    expect(w.przydzialy).toHaveLength(5); expect(w.do_wyjasnienia).toEqual([poz[5]]); expect(await saldo(repo, s)).toMatchObject({ U: 5, R: 5, B: 0 });
    expect(repo._T.pozycje.filter(p => poz.includes(p.id))).toHaveLength(7); expect((await repo.pozycja(poz[6])).rozliczenie).toBe('pojedynczy');
  });
  test('T24: nowa zgodna wizyta między podglądem a uruchomieniem → stary podgląd odrzucony, brak częściowego uruchomienia', async () => {
    const repo = repoPamiec(T); const c = ctx(); const s = await pakiet10(repo, c);
    await domena.weryfikujSkladnik(repo, c, { skladnik_id: s, hist_wykorzystane: 0, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' });
    const p1 = pozycja(repo); const kand = await domena.kandydaciWizyt(repo, c, { skladnik_id: s });
    const p2 = pozycja(repo, { start: '2026-11-20 10:00:00' }); // nowa wizyta po podglądzie
    await expect(domena.uruchomSkladnik(repo, c, { skladnik_id: s, decyzje: [{ pozycja_id: p1, decyzja: 'powiaz' }], skrot: kand.skrot, potwierdzenie_zaleznych: true })).rejects.toMatchObject({ extra: { code: 'PODGLAD_NIEAKTUALNY' } });
    expect(repo._T.przydzialy).toHaveLength(0); expect((await repo.skladniki([s]))[0].aktywny_od).toBeNull();
    const kand2 = await domena.kandydaciWizyt(repo, c, { skladnik_id: s });
    const w = await domena.uruchomSkladnik(repo, c, { skladnik_id: s, decyzje: [{ pozycja_id: p1, decyzja: 'powiaz' }, { pozycja_id: p2, decyzja: 'powiaz' }], skrot: kand2.skrot, potwierdzenie_zaleznych: true }); expect(w.przydzialy).toHaveLength(2);
  });
  test('plan w trybie przygotowania nie tworzy R; uruchomienie z planu po aktywacji weryfikuje aktualność i tworzy R', async () => {
    const repo = repoPamiec(T); const s = await pakiet10(repo, ctx());
    const cp = ctx('przygotowanie'); await domena.weryfikujSkladnik(repo, cp, { skladnik_id: s, hist_wykorzystane: 0, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' });
    const p1 = pozycja(repo); const kand = await domena.kandydaciWizyt(repo, cp, { skladnik_id: s });
    const plan = await domena.uruchomSkladnik(repo, cp, { skladnik_id: s, decyzje: [{ pozycja_id: p1, decyzja: 'powiaz' }], skrot: kand.skrot, potwierdzenie_zaleznych: true });
    expect(plan.plan).toBe(true); expect(repo._T.przydzialy).toHaveLength(0); expect((await saldo(repo, s)).R).toBe(0);
    const w = await domena.uruchomSkladnik(repo, ctx('aktywna'), { skladnik_id: s, z_planu: true }); expect(w.przydzialy).toHaveLength(1); expect((await saldo(repo, s)).R).toBe(1);
  });
  test('T25: ta sama usługa z dwóch zakupów na jednej pozycji (2 jednostki) — oba powiązania zachowane po wykonaniu i odwróceniu; alias = pole zgodności', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const a = await domena.przyznaj(repo, c, { id_klienta: '1001', usluga_wyk_id: 'U-A', jednostki: 1, data_waznosci: '2026-11-30', powod: 'a' }); const b = await domena.przyznaj(repo, c, { id_klienta: '1001', usluga_wyk_id: 'U-A', jednostki: 1, data_waznosci: '2026-12-31', powod: 'b' });
    const poz = pozycja(repo);
    const w = await domena.rezerwuj(repo, c, { pozycje: [{ pozycja_id: poz, skladnik_id: a.skladnik_id, usluga_id: 'U-A' }, { pozycja_id: poz, skladnik_id: b.skladnik_id, usluga_id: 'U-A' }], id_klienta: '1001', data: DZIS, uslugaPozycji: p => p.usluga_id });
    expect(w.przydzialy).toHaveLength(2); expect((await repo.pozycja(poz))).toMatchObject({ zakup_skladnik_id: a.skladnik_id, jednostki_wymagane: 2 });
    const wyk = await domena.wykonaj(repo, c, { pozycja_id: poz }); expect(wyk.zuzyto).toBe(2); expect(wyk.realizacje.map(r => r.skladnik_id).sort()).toEqual([a.skladnik_id, b.skladnik_id].sort());
    expect(await saldo(repo, a.skladnik_id)).toMatchObject({ U: 1, R: 0 }); expect(await saldo(repo, b.skladnik_id)).toMatchObject({ U: 1, R: 0 });
    const k = await domena.odwrocRealizacje(repo, c, { realizacja_id: wyk.realizacje[1].id, wynik: 'odbedzie_sie', powod: 'x', data: DZIS });
    expect(await saldo(repo, b.skladnik_id)).toMatchObject({ U: 0, R: 1 }); expect(await saldo(repo, a.skladnik_id)).toMatchObject({ U: 1, R: 0 }); expect(k.nowy_przydzial_id).toBeTruthy();
    const prz = await repo.przydzialyPozycji([poz]); // pochodzenie obu jednostek odtwarzalne: zużyty A, zużyty B (historia) + nowy zarezerwowany B (cykl 2)
    expect(prz.map(p => [p.skladnik_id, p.stan, p.cykl]).sort()).toEqual([[a.skladnik_id, 'zuzyty', 1], [b.skladnik_id, 'zuzyty', 1], [b.skladnik_id, 'zarezerwowany', 2]].sort());
  });
  test('T28: ponowienie operacji rejestracji/uruchomienia z tym samym kluczem zwraca ten sam wynik bez drugiego G/R', async () => {
    const repo = repoPamiec(T); katalog(repo); const c = ctx();
    sprzedaz(repo, { id: 'X1-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-10-10 10:00:00' });
    const dane = { pozycje: [{ sprzedaz_id: 'X1-1' }] };
    const r1 = await domena.operacja(repo, c, { klucz: 'REJ-1', rodzaj: 'rejestracja', dane }, (oid) => domena.zarejestrujZakupy(repo, c, { ...dane, operacja_id: oid }));
    const r2 = await domena.operacja(repo, c, { klucz: 'REJ-1', rodzaj: 'rejestracja', dane }, (oid) => domena.zarejestrujZakupy(repo, c, { ...dane, operacja_id: oid }));
    expect(r1.powtorzenie).toBe(false); expect(r2.powtorzenie).toBe(true); expect(r2.wynik).toEqual(r1.wynik); expect(repo._T.zakupy).toHaveLength(1); expect(repo._T.ruchy.filter(r => r.typ === 'G')).toHaveLength(1);
  });
});

describe('R2/R4 — kontrola źródła przy wykonaniu i stan ewidencji przy braku dostępności technicznej', () => {
  async function zakupZeSprzedazy(repo, c) {
    katalog(repo); sprzedaz(repo, { id: 'Q1-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-10-10 10:00:00' });
    await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'Q1-1' }] }); const s = repo._T.skladniki[0].id;
    await domena.weryfikujSkladnik(repo, c, { skladnik_id: s, hist_wykorzystane: 0, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' }); await domena.uruchomSkladnik(repo, c, { skladnik_id: s, potwierdzenie_zaleznych: true });
    return s;
  }
  test('Z3-T03: zwrot zatwierdzony przed wykonaniem (po wcześniejszej rezerwacji) → wykonanie odrzucone, bez U; zwolnienie po odwołaniu nadal spójne', async () => {
    const repo = repoPamiec(T); const c = ctx(); const s = await zakupZeSprzedazy(repo, c);
    const poz = pozycja(repo); await domena.rezerwuj(repo, c, { pozycje: [{ pozycja_id: poz, skladnik_id: s, usluga_id: 'U-A' }], id_klienta: '1001', data: DZIS, uslugaPozycji: p => p.usluga_id });
    sprzedaz(repo, { id: 'Q9-1', id_klienta: '1001', zabieg: 'ZWROT: Endermologia', kwota: -900, zwrot_do_id: 'Q1-1', data_sprzedazy: '2026-10-16 10:00:00' });
    await expect(domena.wykonaj(repo, c, { pozycja_id: poz })).rejects.toMatchObject({ extra: { code: 'ZRODLO', zmiana: 'zwrot' } });
    expect(await saldo(repo, s)).toMatchObject({ U: 0, R: 1 }); expect(repo._T.realizacje).toHaveLength(0);
    const z = await domena.zwolnij(repo, c, { pozycja_id: poz, powod: 'odwołanie' }); expect(z.zwolniono).toBe(1); // zwolnienie spójne mimo wycofanego źródła
    const wid = (await Z.widokZakupow(repo, c, { id_klienta: '1001' }))[0]; // B matematyczne (5, bo W ustala manager w uzgodnieniu) ≠ dostępność (źródło wycofane)
    expect(wid.skladniki[0]).toMatchObject({ dostepny: false, do_umowienia: 5, umowione: 0 }); expect(wid.skladniki[0].powod).toMatch(/wycofany/); expect(wid.stan_zrodla).toBe('wycofane');
  });
  test('kontrola źródła także przy zmianie źródła, potrąceniu i korekcie; zmiana opisowa nie blokuje', async () => {
    const repo = repoPamiec(T); const c = ctx(); const s = await zakupZeSprzedazy(repo, c);
    const poz = pozycja(repo); const w = await domena.rezerwuj(repo, c, { pozycje: [{ pozycja_id: poz, skladnik_id: s, usluga_id: 'U-A' }], id_klienta: '1001', data: DZIS, uslugaPozycji: p => p.usluga_id });
    repo._T.sprzedaz[0].kwota = 850; // opisowa
    expect((await domena.wykonaj(repo, c, { pozycja_id: poz })).zuzyto).toBe(1);
    repo._T.sprzedaz[0].id_klienta = '1002'; // zmiana właściciela w rdzeniu
    await expect(domena.odwrocRealizacje(repo, c, { realizacja_id: repo._T.realizacje[0].id, wynik: 'odbedzie_sie', powod: 'x', data: DZIS })).rejects.toMatchObject({ extra: { code: 'ZRODLO', zmiana: 'istotna' } });
    expect(await saldo(repo, s)).toMatchObject({ U: 1, R: 0 }); // odrzucenie nie zmieniło salda (brak wolnej jednostki bez prawa)
  });
  test('R4 (Z3-T07/T08): bez dostępności technicznej mutacje z przydziałem odrzucone (stan zapisany nie maskowany); zwykłe zwolnienie bez przydziałów działa; przerwa wymaga uzgodnienia', async () => {
    const repo = repoPamiec(T); const c = ctx();
    await domena.ustawEwidencje(repo, c, { tryb: 'przygotowanie' }); await domena.ustawEwidencje(repo, c, { tryb: 'aktywna' });
    const s = (await domena.przyznaj(repo, c, { id_klienta: '1001', usluga_wyk_id: 'U-A', jednostki: 2, powod: 'x' })).skladnik_id;
    const poz = pozycja(repo); await domena.rezerwuj(repo, c, { pozycje: [{ pozycja_id: poz, skladnik_id: s, usluga_id: 'U-A' }], id_klienta: '1001', data: DZIS, uslugaPozycji: p => p.usluga_id });
    const cn = ctx('niedostepna');
    await expect(domena.zwolnij(repo, cn, { pozycja_id: poz, powod: 'odwołanie' })).rejects.toMatchObject({ extra: { code: 'EWIDENCJA_NIEDOSTEPNA', tryb: 'aktywna' } });
    await expect(domena.wykonaj(repo, cn, { pozycja_id: poz })).rejects.toMatchObject({ extra: { code: 'EWIDENCJA_NIEDOSTEPNA' } });
    expect((await domena.zwolnij(repo, cn, { pozycja_id: pozycja(repo), powod: 'x' })).zwolniono).toBe(0); // pozycja bez przydziału: nic do zrobienia, bez błędu
    expect(await saldo(repo, s)).toMatchObject({ G: 2, R: 1 }); expect(repo._T.przydzialy).toHaveLength(1); expect((await repo.ewidencja()).tryb).toBe('aktywna');
    expect(logika.powodNiedostepnosci({ stan: 'aktywny', stan_weryfikacji: 'zweryfikowany', zalezne_uzgodniono: 1, aktywny_od: 'x' }, { stan: 'aktywny' }, logika.saldo([{ typ: 'G', ilosc: 2 }]), DZIS, 'uzgadnianie')).toMatch(/uzgodnienia/);
    await repo.zapiszEwidencje({ przerwa_od: '2026-10-17 11:00:00' }); // znacznik przerwy (zapisuje router po odmowie)
    const w = await domena.ustawEwidencje(repo, ctx('uzgadnianie'), { tryb: 'aktywna' }); expect(w).toMatchObject({ poprzedni: 'uzgadnianie', przerwa_zamknieta: true }); expect((await repo.ewidencja()).przerwa_od).toBeNull();
    expect(repo._T.ruchy.filter(r => r.typ === 'G')).toHaveLength(1); // ponowne dopuszczenie nie przyznaje G drugi raz
  });
});

// ═════════ kontrakt handlerów (R4 Z3-T07, R6 Z3-T04) na atrapie bazy ═════════
function schematRows(zV2) { const rows = Z.TABELE_V1.map(t => ({ t, c: 'id', ct: 'int(11)' })); if (zV2) for (const [k, ct] of Object.entries(Z.oczekiwaneKolumny())) rows.push({ t: k.split('.')[0], c: k.split('.')[1], ct }); return rows; }
function atrapaBazy(odpowiedzi) {
  const zap = []; let insertId = 100;
  const wykonaj = (sql, params) => { zap.push({ sql: String(sql), params: params || [] }); for (const [re, w] of odpowiedzi) if (re.test(sql)) return typeof w === 'function' ? w(sql, params) : w; if (/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE)/i.test(sql)) return { insertId: ++insertId, affectedRows: 1 }; return []; };
  const query = (sql, p, cb) => { const c = typeof p === 'function' ? p : cb; const params = typeof p === 'function' ? [] : p; let w; try { w = wykonaj(sql, params); } catch (e) { return c && c(e); } if (c) c(null, w); };
  const conn = { query, beginTransaction: (cb) => { zap.push({ sql: 'BEGIN' }); cb(null); }, commit: (cb) => { zap.push({ sql: 'COMMIT' }); cb(null); }, rollback: (cb) => { zap.push({ sql: 'ROLLBACK' }); cb(); }, release: () => {} };
  return { query, getConnection: (cb) => cb(null, conn), zap };
}
const USTAWIENIA = { tenant_id: T, tryb: 'wewnetrzny', siatka_min: 15, tolerancja_min: 10, horyzont_dni: 90, wyprzedzenie_min: 0, godziny_json: JSON.stringify({ 1: [{ od: '08:00', do: '20:00' }], 2: [{ od: '08:00', do: '20:00' }], 3: [{ od: '08:00', do: '20:00' }], 4: [{ od: '08:00', do: '20:00' }], 5: [{ od: '08:00', do: '20:00' }], 6: [{ od: '08:00', do: '20:00' }], 7: [] }), wersja: 1, kontrola_zakupow: 'off' };
const BAZOWE = [[/SELECT rola FROM Użytkownicy/, [{ rola: 'manager' }]], [/SELECT id FROM Użytkownicy/, [{ id: 'u-ola' }]], [/IS_FREE_LOCK/, [{ w: 1 }]], [/GET_LOCK/, [{ l: 1 }]], [/FROM Term_Grafik WHERE/, [1, 2, 3, 4, 5, 6, 7].map(dz => ({ id: dz, pracownik: 'Anna', dzien_tyg: dz, od: '08:00', do: '20:00', od_daty: null, do_daty: null }))], [/FROM Term_Ustawienia WHERE/, [USTAWIENIA]], [/SELECT DATE_FORMAT\(NOW\(\)/, [{ t: '2026-10-19 10:00:00' }]], [/FROM Uslugi u LEFT JOIN Term_Uslugi/, [{ id: 'U-A', kategoria: 'Endermologia', wariant: '1x', cena: 200, czas_min: 30, bufor_przed_min: 0, bufor_po_min: 0, bufor_dotyczy: 'oba', wymaga_gabinet: 0, urzadzenia_json: '[]', aktywna: 1, konfig_wersja: 1 }]], [/SELECT p\.imie FROM Pracownicy/, [{ imie: 'Anna' }]], [/FROM Klienci WHERE tenant_id = \? AND id_klienta = \?/, [{ id_klienta: '1001', imie_nazwisko: 'Testowa', telefon: '600000000', status: 'AKTYWNY' }]], [/INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME IN \('Term_Oferty'/, () => [{ t: 'Term_Oferty', c: 'id' }, { t: 'Term_Oferty_Skladniki', c: 'id' }, { t: 'Term_Zakupy', c: 'id' }, { t: 'Term_Zakupy_Skladniki', c: 'id' }, { t: 'Term_Zakupy_Ruchy', c: 'id' }, { t: 'Term_Pozycje', c: 'zakup_skladnik_id' }, { t: 'Term_Ustawienia', c: 'kontrola_zakupow' }]], [/INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME IN \(\?/, () => schematRows(true)]];
const rez7 = (stanPoz) => [[/FROM Term_Rezerwacje r WHERE r\.tenant_id = \? AND r\.id = \?/, [{ id: 7, tenant_id: T, id_klienta: '1001', klient_nazwa: 'Testowa', status: 'potwierdzona', obecnosc: 'oczekiwana', kanal: 'recepcja', start_s: '2026-10-19 09:00:00', koniec_s: '2026-10-19 09:30:00', wersja: 1 }]], [/FROM Term_Pozycje p LEFT JOIN Term_Zasoby/, [{ id: 42, rezerwacja_id: 7, kolejnosc: 0, usluga_id: 'U-A', kategoria: 'Endermologia', wariant: '1x', cena: 200, czas_min: 30, pracownik: 'Anna', start_s: '2026-10-19 09:00:00', koniec_s: '2026-10-19 09:30:00', stan: stanPoz, zakup_skladnik_id: 5, jednostki_wymagane: 1 }]], [/FROM Term_Przydzialy a JOIN/, [{ id: 9, pozycja_id: 42, skladnik_id: 5, ilosc: 1, ilosc_zuzyta: 0, cykl: 1, stan: 'zarezerwowany', usluga_nazwa: 'Endermologia', zakup_nazwa: 'P', zakup_id: 3 }]], [/FROM Term_Przydzialy WHERE tenant_id = \? AND pozycja_id IN/, [{ id: 9, pozycja_id: 42, skladnik_id: 5, ilosc: 1, ilosc_zuzyta: 0, cykl: 1, stan: 'zarezerwowany' }]], [/FROM Term_Przydzialy WHERE tenant_id = \? AND pozycja_id = \? AND stan/, [{ id: 9, cykl: 1 }]], [/FROM Term_Przydzialy WHERE tenant_id = \? AND id = \?/, [{ id: 9, pozycja_id: 42, skladnik_id: 5, ilosc: 1, ilosc_zuzyta: 0, cykl: 1, stan: 'zarezerwowany' }]], [/FROM Term_Zakupy_Ruchy2 WHERE/, [{ skladnik_id: 5, typ: 'G', kierunek: 1, ilosc: 3 }, { skladnik_id: 5, typ: 'R', kierunek: 1, ilosc: 1 }]]];
function aplikacja(db, feature = true) { const app = express(); app.use(express.json()); const m = require('../routes/terminarz'); const ma = (k) => (feature && typeof feature === 'object') ? !!feature[k] : !!feature; const router = m(db, { hasFeature: (t, k, cb) => cb(ma(k)), log: { error() {}, warn() {}, info() {} } }); app.use('/api', router); return { app, router }; }
const post = (app, body) => request(app).post('/api/terminarz').send({ tenant_id: T, pracownik: 'Ola', ...body });

describe('Handlery: R4 (Z3-T07) i R6 (Z3-T04) na atrapie bazy', () => {
  const envPrzed = process.env.TERMINARZ_ZAKUPY_TENANTS;
  afterEach(() => { if (envPrzed === undefined) delete process.env.TERMINARZ_ZAKUPY_TENANTS; else process.env.TERMINARZ_ZAKUPY_TENANTS = envPrzed; });
  test('Z3-T07: salon stracił dodatek „Rozliczanie pakietów”, zapisany stan „aktywna”, wizyta z przydziałem → anulacja i wykonanie odrzucone bez ROLLBACK-u w połowie; stan zapisany widoczny; przerwa oznaczona', async () => {
    delete process.env.TERMINARZ_ZAKUPY_TENANTS;
    const db = atrapaBazy([...rez7('zaplanowana'), [/FROM Term_Ewidencja WHERE/, [{ tryb: 'aktywna', rozpoczeto: '2026-10-01 10:00:00', przerwa_od: null }]], ...BAZOWE]);
    const { app, router } = aplikacja(db, { terminarz: true, rozliczanie_pakietow: false }); await router.sprawdzSchemat(); await router.sprawdzSchematV2();
    const a = await post(app, { action: 'trm_anuluj', id: 7, wersja: 1, powod: 'test', kto_anulowal: 'klient' });
    expect(a.body).toMatchObject({ status: 'error', code: 'EWIDENCJA_NIEDOSTEPNA' });
    expect(db.zap.some(z => z.sql === 'ROLLBACK')).toBe(true); expect(db.zap.some(z => z.sql === 'COMMIT')).toBe(false);
    expect(db.zap.some(z => /UPDATE Term_Rezerwacje SET status = 'anulowana'/.test(z.sql))).toBe(false);
    expect(db.zap.some(z => /UPDATE Term_Ewidencja SET przerwa_od = COALESCE/.test(z.sql))).toBe(true);
    const w = await post(app, { action: 'trm_pozycja_stan', id: 7, pozycja_id: 42, stan: 'wykonana' }); expect(w.body).toMatchObject({ status: 'error', code: 'EWIDENCJA_NIEDOSTEPNA' });
    expect(db.zap.some(z => /INSERT INTO Term_Zakupy_Ruchy2|INSERT INTO Term_Realizacje/.test(z.sql))).toBe(false);
    const init = (await post(app, { action: 'trm_init' })).body; expect(init.ustawienia.ewidencja).toBe('niedostepna'); expect(init.ustawienia.ewidencja_zapisana).toBe('aktywna'); // stan zapisany nie jest maskowany
  });
  test('Z3-T07b: ta sama sytuacja, ale wizyta BEZ przydziału → anulacja działa (kalendarz niezależny od ewidencji)', async () => {
    delete process.env.TERMINARZ_ZAKUPY_TENANTS;
    const db = atrapaBazy([[/FROM Term_Przydzialy WHERE tenant_id = \? AND pozycja_id IN/, []], [/FROM Term_Przydzialy a JOIN/, []], ...rez7('zaplanowana'), [/FROM Term_Ewidencja WHERE/, [{ tryb: 'aktywna', przerwa_od: null }]], ...BAZOWE]);
    const { app, router } = aplikacja(db); await router.sprawdzSchemat(); await router.sprawdzSchematV2();
    const a = await post(app, { action: 'trm_anuluj', id: 7, wersja: 1, powod: 'test', kto_anulowal: 'klient' });
    expect(a.body.status).toBe('success'); expect(db.zap.some(z => z.sql === 'COMMIT')).toBe(true); expect(db.zap.some(z => /INSERT INTO Term_Zakupy_Ruchy2/.test(z.sql))).toBe(false);
  });
  test('Z3-T04: odmowa z powodu źródła → ROLLBACK wizyty, a stan „do wyjaśnienia” i sprawa E20 utrwalone poza transakcją', async () => {
    process.env.TERMINARZ_ZAKUPY_TENANTS = T;
    const migawka = JSON.stringify(logika.migawkaZrodla({ id: 'S-1-1', status: 'AKTYWNY', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-10-10', data_waznosci: null }, 0, []));
    const db = atrapaBazy([[/FROM Term_Ewidencja WHERE/, [{ tryb: 'aktywna', przerwa_od: null }]], [/FROM Term_Rezerwacje WHERE tenant_id = \? AND klucz_idem/, []],
      [/Term_Zakupy_Skladniki s JOIN Term_Zakupy z .*s\.id IN/, [{ id: 5, zakup_id: 3, usluga_wyk_id: 'U-A', id_klienta: '1001', stan: 'aktywny', stan_weryfikacji: 'zweryfikowany', zalezne_uzgodniono: 1, aktywny_od: '2026-10-01', zakup_stan: 'aktywny', stan_zrodla: 'ok', zrodlo_typ: 'sprzedaz', sprzedaz_id: 'S-1-1', zrodlo_migawka_json: migawka, zakup_nazwa: 'Endermologia / 5x' }]],
      [/FROM Sprzedaz WHERE tenant_id = \? AND id = \? LOCK IN SHARE MODE/, [{ id: 'S-1-1', status: 'AKTYWNY', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, data_sprzedazy: '2026-10-10', data_waznosci: null }]],
      [/FROM Sprzedaz WHERE tenant_id = \? AND \(id = \? OR id LIKE \?\)/, [{ id: 'S-1-1', status: 'AKTYWNY', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900 }]],
      [/zwrot_do_id IN/, [{ id: 'S-1-1', s: 900 }]], // zwrot całości zatwierdzony w rdzeniu
      [/FROM Term_Sprawy WHERE tenant_id = \? AND klucz_dedup = \?/, []], ...BAZOWE]);
    const { app, router } = aplikacja(db); await router.sprawdzSchemat(); await router.sprawdzSchematV2();
    const r = await post(app, { action: 'trm_zapisz', klucz_idem: 'KL-9', start: '2026-10-20 10:00', klient: { id_klienta: '1001', nazwa: 'Testowa' }, pozycje: [{ usluga_id: 'U-A', pracownik: 'Anna', zakup_skladnik_id: 5 }] });
    expect(r.body).toMatchObject({ status: 'error', code: 'ZRODLO', zmiana: 'zwrot' });
    const kol = db.zap.map(z => z.sql);
    expect(kol.some(s => /^ROLLBACK$/.test(s))).toBe(true); expect(kol.some(s => /^COMMIT$/.test(s))).toBe(false);
    const iRollback = kol.findIndex(s => s === 'ROLLBACK');
    expect(kol.findIndex(s => /UPDATE Term_Zakupy SET stan_zrodla = \?/.test(s))).toBeGreaterThan(iRollback); // utrwalenie PO rollbacku
    expect(db.zap.find(z => /UPDATE Term_Zakupy SET stan_zrodla = \?/.test(z.sql)).params[0]).toBe('wycofane');
    expect(kol.findIndex(s => /INSERT INTO Term_Sprawy \(/.test(s))).toBeGreaterThan(iRollback); // sprawa E20 po rollbacku
    expect(db.zap.find(z => /INSERT INTO Term_Sprawy \(/.test(z.sql)).params).toContain('E20');
  });
  test('zwykłe handlery bez zakupu działają jak dotąd: nieobecność i wykonanie pozycji bez przydziału (bez ruchów v2)', async () => {
    process.env.TERMINARZ_ZAKUPY_TENANTS = T;
    const db = atrapaBazy([[/FROM Term_Przydzialy WHERE tenant_id = \? AND pozycja_id = \? AND stan/, []], [/FROM Term_Przydzialy WHERE tenant_id = \? AND pozycja_id IN/, []], [/FROM Term_Przydzialy a JOIN/, []], ...rez7('zaplanowana'), [/FROM Term_Ewidencja WHERE/, [{ tryb: 'aktywna', przerwa_od: null }]], ...BAZOWE]);
    const { app, router } = aplikacja(db); await router.sprawdzSchemat(); await router.sprawdzSchematV2();
    expect((await post(app, { action: 'trm_obecnosc', id: 7, obecnosc: 'nieobecny' })).body.status).toBe('success');
    expect((await post(app, { action: 'trm_pozycja_stan', id: 7, pozycja_id: 42, stan: 'wykonana' })).body.status).toBe('success');
    expect(db.zap.some(z => /INSERT INTO Term_Zakupy_Ruchy2|INSERT INTO Term_Realizacje|INSERT INTO Term_Operacje/.test(z.sql))).toBe(false);
    expect(db.zap.filter(z => z.sql === 'COMMIT')).toHaveLength(2);
  });
});
