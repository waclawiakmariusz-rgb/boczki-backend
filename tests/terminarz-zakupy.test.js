// tests/terminarz-zakupy.test.js — ZK-02: ewidencja jednostek zakupionych zabiegów (model v2).
// RODZAJ PRÓB: jednostkowe na repozytorium W PAMIĘCI (tests/helpers/repoPamiec.js) + testy kontraktu routera na atrapie bazy.
// NIE dowodzą zachowania transakcji/blokad MariaDB (K05–K08, K11, K13 — narzedzia/testy-integracyjne/terminarz-zakupy.js na izolowanej bazie).
const fs = require('fs'); const path = require('path');
const request = require('supertest'); const express = require('express');
const Z = require('../routes/terminarz-zakupy');
const { repoPamiec } = require('./helpers/repoPamiec');
const { logika, domena } = Z;

const T = 'salon-test-001';
const ctx = (tryb = 'aktywna', autor = 'Ola') => ({ tenant: T, autor, rola: 'manager', teraz: '2026-10-17 10:00:00', tryb });
const DZIS = '2026-10-17';
const saldo = async (repo, id) => (await domena.saldoSkladnikow(repo, [id]))[id];
async function przyznaj(repo, c, o = {}) { return domena.przyznaj(repo, c, { id_klienta: '1001', usluga_wyk_id: 'U-A', usluga_nazwa: 'Endermologia', jednostki: 10, powod: 'dane testowe', ...o }); }
async function pozycja(repo, { id_klienta = '1001', usluga_id = 'U-A', start = `${DZIS} 12:00:00` } = {}) { const rez = repo.dodajRezerwacje({ id_klienta, klient_nazwa: 'Klientka ' + id_klienta }); return repo.dodajPozycje({ rezerwacja_id: rez, usluga_id, start, kategoria: 'Endermologia' }); }
const rezerwujPoz = (repo, c, poz, skl, o = {}) => domena.rezerwuj(repo, c, { pozycje: [{ pozycja_id: poz, skladnik_id: skl, usluga_id: o.usluga_id || 'U-A' }], id_klienta: o.id_klienta || '1001', data: o.data || DZIS, uslugaPozycji: (p) => p.usluga_id });

// ═════════ K01: saldo bez przycinania ═════════
describe('K01 — G/W/U/F/R/L/B bez przycinania do zera', () => {
  test('przykład spec: 10 przyznanych, 3 historyczne, 4 umówione → L=7, B=3', () => {
    const s = logika.saldo([{ typ: 'G', kierunek: 1, ilosc: 10 }, { typ: 'U', kierunek: 1, ilosc: 3, historyczny: 1 }, { typ: 'R', kierunek: 1, ilosc: 4 }]);
    expect(s).toMatchObject({ G: 10, U: 3, R: 4, W: 0, F: 0, L: 7, B: 3, U_hist: 3, U_term: 0, niespojny: false });
  });
  test('ujemne B nie jest maskowane: G=2, R=3 → B=-1 i flaga niespójności', () => {
    const s = logika.saldo([{ typ: 'G', kierunek: 1, ilosc: 2 }, { typ: 'R', kierunek: 1, ilosc: 3 }]);
    expect(s.B).toBe(-1); expect(s.niespojny).toBe(true);
  });
  test('ruchy odwracające (kierunek −1) i W/F wchodzą do równania', () => {
    const s = logika.saldo([{ typ: 'G', kierunek: 1, ilosc: 5 }, { typ: 'U', kierunek: 1, ilosc: 2 }, { typ: 'U', kierunek: -1, ilosc: 1 }, { typ: 'W', kierunek: 1, ilosc: 1 }, { typ: 'F', kierunek: 1, ilosc: 1 }]);
    expect(s).toMatchObject({ G: 5, U: 1, W: 1, F: 1, L: 2, B: 2 });
  });
  test('projekcja składnika = wyliczenie z ruchów (A14) i oznacza stan niespójny', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 1 });
    await repo.wstawRuch({ skladnik_id, typ: 'R', kierunek: 1, ilosc: 2 }); // uszkodzony stan: więcej R niż G
    const s = await domena.zapiszProjekcje(repo, [skladnik_id]);
    expect(s[skladnik_id].B).toBe(-1);
    expect(JSON.parse((await repo.skladniki([skladnik_id]))[0].saldo_json).B).toBe(-1);
    expect((await repo.skladniki([skladnik_id]))[0].stan).toBe('niespojny');
    await expect(rezerwujPoz(repo, c, await pozycja(repo), skladnik_id)).rejects.toMatchObject({ extra: { code: 'NIEDOSTEPNY' } });
  });
});

// ═════════ K02: pakiet mieszany — osobne liczniki i stany weryfikacji ═════════
describe('K02 — 5 × A + 4 × B: niezależne składniki i weryfikacja per składnik', () => {
  async function mieszany(repo, c) {
    repo._T.sprzedaz.push({ id: 'S-100-1', status: 'AKTYWNY', id_klienta: '1001', zabieg: 'Pakiet', szczegoly: '5A+4B', kategoria_produktu: null, kwota: 2000, data_sprzedazy: '2026-10-12', data_waznosci: null, karnet_zamkniety_w: null, grupa_id: null, zwrot_do_id: null });
    const zakup = await repo.wstawZakup({ sprzedaz_id: 'S-100-1', id_klienta: '1001', nazwa: 'Pakiet 5A+4B', data_zakupu: '2026-10-12', kwalifikacja: 'pakiet' });
    const A = await repo.wstawSkladnik({ zakup_id: zakup, usluga_wyk_id: 'U-A', usluga_nazwa: 'Endermologia', jednostki_przyznane: 5 });
    const B = await repo.wstawSkladnik({ zakup_id: zakup, usluga_wyk_id: 'U-B', usluga_nazwa: 'Meltivio', jednostki_przyznane: 4 });
    await repo.wstawRuch({ skladnik_id: A, typ: 'G', ilosc: 5 }); await repo.wstawRuch({ skladnik_id: B, typ: 'G', ilosc: 4 });
    return { zakup, A, B };
  }
  test('weryfikacja A (U=2) nie otwiera B; B odrzucane przez domenę; rodzic = częściowo zweryfikowany', async () => {
    const repo = repoPamiec(T); const c = ctx('przygotowanie'); const { zakup, A, B } = await mieszany(repo, c);
    await domena.weryfikujSkladnik(repo, c, { skladnik_id: A, hist_wykorzystane: 2, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'Booksy do 10.2026' });
    await domena.uruchomSkladnik(repo, c, { skladnik_id: A, potwierdzenie_zaleznych: true });
    const ca = ctx('aktywna');
    const widok = await Z.widokZakupow(repo, ca, { id_klienta: '1001' });
    expect(widok[0].weryfikacja).toBe('czesciowo');
    expect(widok[0].skladniki.find(s => s.id === A)).toMatchObject({ do_umowienia: 3, wykorzystane: 2, umowione: 0, dostepny: true });
    expect(widok[0].skladniki.find(s => s.id === B)).toMatchObject({ do_umowienia: null, dostepny: false, powod: expect.stringContaining('do sprawdzenia') });
    await expect(rezerwujPoz(repo, ca, await pozycja(repo, { usluga_id: 'U-B' }), B, { usluga_id: 'U-B' })).rejects.toMatchObject({ extra: { code: 'NIEDOSTEPNY' } });
    expect((await saldo(repo, B)).R).toBe(0);
  });
  test('brak danych ≠ zero: weryfikacja wymaga jawnych liczb (także 0); po jawnym B=0 składnik działa', async () => {
    const repo = repoPamiec(T); const c = ctx(); const { B } = await mieszany(repo, c);
    await expect(domena.weryfikujSkladnik(repo, c, { skladnik_id: B, hist_wykorzystane: 0, zrodlo_ustalen: 'x' })).rejects.toThrow(/Podaj jawnie liczbę/);
    await domena.weryfikujSkladnik(repo, c, { skladnik_id: B, hist_wykorzystane: 0, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'potwierdzone zero' });
    await expect(domena.uruchomSkladnik(repo, c, { skladnik_id: B, potwierdzenie_zaleznych: false })).rejects.toThrow(/istniejące wizyty/);
    await domena.uruchomSkladnik(repo, c, { skladnik_id: B, potwierdzenie_zaleznych: true });
    const w = await rezerwujPoz(repo, c, await pozycja(repo, { usluga_id: 'U-B' }), B, { usluga_id: 'U-B' });
    expect(w.przydzialy).toHaveLength(1); expect(await saldo(repo, B)).toMatchObject({ R: 1, B: 3 });
  });
  test('wykonanie A nie zmienia B; odwołanie B nie zmienia A (P05, R03)', async () => {
    const repo = repoPamiec(T); const c = ctx(); const { A, B } = await mieszany(repo, c);
    for (const [s, u] of [[A, 2], [B, 0]]) { await domena.weryfikujSkladnik(repo, c, { skladnik_id: s, hist_wykorzystane: u, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' }); await domena.uruchomSkladnik(repo, c, { skladnik_id: s, potwierdzenie_zaleznych: true }); }
    const pa = await pozycja(repo), pb = await pozycja(repo, { usluga_id: 'U-B' });
    await rezerwujPoz(repo, c, pa, A);
    await rezerwujPoz(repo, c, pb, B, { usluga_id: 'U-B' });
    expect(await saldo(repo, A)).toMatchObject({ U: 2, R: 1, B: 2 }); expect(await saldo(repo, B)).toMatchObject({ U: 0, R: 1, B: 3 });
    await domena.wykonaj(repo, c, { pozycja_id: pa, wykonawca_fakt: 'Anna' });
    expect(await saldo(repo, A)).toMatchObject({ U: 3, R: 0, B: 2 }); expect(await saldo(repo, B)).toMatchObject({ U: 0, R: 1, B: 3 });
    await domena.zwolnij(repo, c, { pozycja_id: pb, powod: 'odwołanie' });
    expect(await saldo(repo, B)).toMatchObject({ U: 0, R: 0, B: 4 }); expect(await saldo(repo, A)).toMatchObject({ U: 3, R: 0, B: 2 });
    expect((await Z.widokZakupow(repo, c, { id_klienta: '1001' }))[0].wykorzystanie).toBe('czesciowo_wykorzystany'); // nie „w całości”
  });
  test('weryfikacja niemożliwego salda (historyczne > zakupione) jest odrzucana; poniżej już przydzielonych — wymaga uzgodnienia', async () => {
    const repo = repoPamiec(T); const c = ctx(); const { A } = await mieszany(repo, c);
    await expect(domena.weryfikujSkladnik(repo, c, { skladnik_id: A, hist_wykorzystane: 6, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' })).rejects.toMatchObject({ extra: { code: 'BILANS_NIEMOZLIWY' } });
    await domena.weryfikujSkladnik(repo, c, { skladnik_id: A, hist_wykorzystane: 0, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'x' }); await domena.uruchomSkladnik(repo, c, { skladnik_id: A, potwierdzenie_zaleznych: true });
    await rezerwujPoz(repo, c, await pozycja(repo), A); await rezerwujPoz(repo, c, await pozycja(repo), A);
    await expect(domena.weryfikujSkladnik(repo, c, { skladnik_id: A, hist_wykorzystane: 4, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'korekta' })).rejects.toMatchObject({ extra: { code: 'ZALEZNE_WIZYTY' } });
    expect(await saldo(repo, A)).toMatchObject({ U: 0, R: 2 }); // odrzucenie niczego nie zmieniło
  });
});

// ═════════ K03: wykonaj → cofnij → wykonaj ponownie ═════════
describe('K03 — cykl realizacji z pełną historią', () => {
  test('U wraca do 0 i R odtwarza się atomowo; ponowne wykonanie daje nowy cykl; historia 7 ruchów', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 1 });
    const poz = await pozycja(repo);
    await rezerwujPoz(repo, c, poz, skladnik_id);
    const w1 = await domena.wykonaj(repo, c, { pozycja_id: poz, wykonawca_fakt: 'Anna', data_fakt: `${DZIS} 09:30:00` });
    expect(await saldo(repo, skladnik_id)).toMatchObject({ U: 1, R: 0, B: 0 });
    const k = await domena.odwrocRealizacje(repo, c, { realizacja_id: w1.realizacje[0].id, wynik: 'odbedzie_sie', powod: 'pomyłka', data: DZIS });
    expect(await saldo(repo, skladnik_id)).toMatchObject({ U: 0, R: 1, B: 0 }); // jednostka nie jest „wolna” w międzyczasie
    expect((await repo.przydzial(k.nowy_przydzial_id)).cykl).toBe(2);
    expect((await repo.realizacja(w1.realizacje[0].id)).stan).toBe('odwrocona');
    await expect(domena.odwrocRealizacje(repo, c, { realizacja_id: w1.realizacje[0].id, wynik: 'odbedzie_sie', powod: 'x' })).rejects.toMatchObject({ extra: { code: 'JUZ_ODWROCONA' } });
    const w2 = await domena.wykonaj(repo, c, { pozycja_id: poz, wykonawca_fakt: 'Anna' });
    expect(w2.realizacje[0].id).not.toBe(w1.realizacje[0].id);
    expect(await saldo(repo, skladnik_id)).toMatchObject({ U: 1, R: 0, B: 0 });
    const ruchy = (await repo.ruchy([skladnik_id])).map(r => r.typ + (r.kierunek > 0 ? '+' : '-'));
    expect(ruchy).toEqual(['G+', 'R+', 'R-', 'U+', 'U-', 'R+', 'R-', 'U+']);
    expect((await repo.ruchy([skladnik_id])).filter(r => r.odwraca_id)).toHaveLength(1);
    expect(repo._T.realizacje).toHaveLength(2); // nic nie usunięto
  });
  test('korekta „nie odbędzie się” zamyka pozycję bez nowego przydziału; jednostka wraca do B', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 1 }); const poz = await pozycja(repo);
    await rezerwujPoz(repo, c, poz, skladnik_id); const w = await domena.wykonaj(repo, c, { pozycja_id: poz });
    await domena.odwrocRealizacje(repo, c, { realizacja_id: w.realizacje[0].id, wynik: 'nie_odbedzie_sie', powod: 'błąd zapisu' });
    expect(await saldo(repo, skladnik_id)).toMatchObject({ U: 0, R: 0, B: 1 }); expect((await repo.pozycja(poz)).stan).toBe('niewykonana');
  });
  test('R22: po pełnym wycofaniu puli korekta błędnego wykonania przenosi U → W, nie tworzy wolnej jednostki', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 5 }); const poz = await pozycja(repo);
    await rezerwujPoz(repo, c, poz, skladnik_id); const w = await domena.wykonaj(repo, c, { pozycja_id: poz });
    await domena.wycofaj(repo, c, { skladnik_id, zakres: 'wolne', powod: 'zwrot niewykorzystanej części' }); // W=4
    expect(await saldo(repo, skladnik_id)).toMatchObject({ G: 5, U: 1, W: 4, B: 0 });
    const k = await domena.odwrocRealizacje(repo, c, { realizacja_id: w.realizacje[0].id, wynik: 'odbedzie_sie', powod: 'to nie było wykonane' });
    expect(k.do_wycofanych).toBe(true); expect(await saldo(repo, skladnik_id)).toMatchObject({ U: 0, W: 5, R: 0, B: 0 });
  });
});

// ═════════ K04: idempotencja i stan domeny ═════════
describe('K04 — powtórzenie operacji i podwójne wykonanie nie zużywają drugi raz', () => {
  test('ten sam klucz + to samo żądanie → zapisany wynik bez nowych ruchów; ten sam klucz + inne żądanie → odrzucenie (A07)', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 3 }); const poz = await pozycja(repo);
    const dane = { pozycja_id: poz, skladnik_id };
    const r1 = await domena.operacja(repo, c, { klucz: 'K-1', rodzaj: 'zapisz', dane }, () => rezerwujPoz(repo, c, poz, skladnik_id));
    const ileRuchow = repo._T.ruchy.length;
    const r2 = await domena.operacja(repo, c, { klucz: 'K-1', rodzaj: 'zapisz', dane }, () => rezerwujPoz(repo, c, poz, skladnik_id));
    expect(r1.powtorzenie).toBe(false); expect(r2.powtorzenie).toBe(true); expect(r2.wynik).toEqual(r1.wynik); expect(repo._T.ruchy.length).toBe(ileRuchow);
    await expect(domena.operacja(repo, c, { klucz: 'K-1', rodzaj: 'zapisz', dane: { ...dane, skladnik_id: 999 } }, () => rezerwujPoz(repo, c, poz, skladnik_id))).rejects.toMatchObject({ extra: { code: 'KLUCZ_OPERACJI' } });
    expect(await saldo(repo, skladnik_id)).toMatchObject({ R: 1, B: 2 });
  });
  test('inny klucz dla już zużytego przydziału → stan domeny blokuje (A08, R05): U pozostaje 1', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 3 }); const poz = await pozycja(repo);
    await rezerwujPoz(repo, c, poz, skladnik_id);
    const a = await domena.operacja(repo, c, { klucz: 'W-1', rodzaj: 'wykonanie', dane: { poz } }, () => domena.wykonaj(repo, c, { pozycja_id: poz }));
    const b = await domena.operacja(repo, c, { klucz: 'W-2', rodzaj: 'wykonanie', dane: { poz, inne: true } }, () => domena.wykonaj(repo, c, { pozycja_id: poz }));
    expect(a.wynik.zuzyto).toBe(1); expect(b.wynik.zuzyto).toBe(0); expect(b.wynik.bez_przydzialu).toBe(true);
    expect(await saldo(repo, skladnik_id)).toMatchObject({ U: 1, R: 0, B: 2 });
  });
  test('operacja „w toku” powstaje przed wykonaniem i ruchy dostają jej ID; błąd w fn nie zostawia wyniku „zapisano”', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 1 }); const poz = await pozycja(repo);
    const r = await domena.operacja(repo, c, { klucz: 'OP-1', rodzaj: 'zapisz', dane: {} }, (operacja_id) => domena.rezerwuj(repo, c, { pozycje: [{ pozycja_id: poz, skladnik_id, usluga_id: 'U-A' }], id_klienta: '1001', data: DZIS, uslugaPozycji: p => p.usluga_id, operacja_id }));
    expect(repo._T.ruchy.filter(x => x.typ === 'R')[0].operacja_id).toBe(r.operacja_id);
    expect((await repo.operacja('OP-1')).stan).toBe('zapisano');
    await expect(domena.operacja(repo, c, { klucz: 'OP-2', rodzaj: 'zapisz', dane: {} }, () => { throw new Error('awaria przed commit'); })).rejects.toThrow('awaria');
    expect((await repo.operacja('OP-2')).stan).toBe('w_toku'); // w SQL rollback usuwa ten wiersz razem z ruchami (A06) — dowód w teście integracyjnym K07
  });
  test('ostatnia jednostka: druga rezerwacja odrzucona z komunikatem (sekwencyjnie; wyścig dwóch połączeń = K05 na bazie)', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 1 });
    await rezerwujPoz(repo, c, await pozycja(repo), skladnik_id);
    await expect(rezerwujPoz(repo, c, await pozycja(repo), skladnik_id)).rejects.toMatchObject({ extra: { code: 'NIEDOSTEPNY', powod: 'wszystkie pozostałe zabiegi są już umówione' } });
    expect(await saldo(repo, skladnik_id)).toMatchObject({ R: 1, B: 0 });
  });
  test('U03: dwie pozycje jednego formularza wskazują ostatnią jednostkę → cała lista odrzucona, bez częściowego zapisu', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 1 }); const p1 = await pozycja(repo), p2 = await pozycja(repo);
    await expect(domena.rezerwuj(repo, c, { pozycje: [{ pozycja_id: p1, skladnik_id, usluga_id: 'U-A' }, { pozycja_id: p2, skladnik_id, usluga_id: 'U-A' }], id_klienta: '1001', data: DZIS, uslugaPozycji: p => p.usluga_id })).rejects.toMatchObject({ extra: { code: 'BRAK_JEDNOSTEK' } });
    expect(repo._T.przydzialy).toHaveLength(0); expect(await saldo(repo, skladnik_id)).toMatchObject({ R: 0, B: 1 });
  });
});

// ═════════ K08 (domena): atomowa zmiana źródła ═════════
describe('K08 — zmiana źródła: całość albo nic', () => {
  test('przeniesienie do zakupu bez wolnych jednostek jest odrzucone, stary przydział bez zmian; udane przeniesienie = R−1/R+1', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const a = await przyznaj(repo, c, { jednostki: 2, data_waznosci: '2026-10-20' }); const b = await przyznaj(repo, c, { jednostki: 1, data_waznosci: '2026-12-31' });
    const poz = await pozycja(repo); const w = await rezerwujPoz(repo, c, poz, a.skladnik_id);
    await rezerwujPoz(repo, c, await pozycja(repo), b.skladnik_id); // B pełne
    await expect(domena.przenies(repo, c, { przydzial_id: w.przydzialy[0].id, nowy_skladnik_id: b.skladnik_id, id_klienta: '1001', data: DZIS })).rejects.toThrow(/Nie zmieniono zakupu/);
    expect((await repo.przydzial(w.przydzialy[0].id)).stan).toBe('zarezerwowany'); expect(await saldo(repo, a.skladnik_id)).toMatchObject({ R: 1 });
    await domena.zwolnij(repo, c, { pozycja_id: repo._T.przydzialy[1].pozycja_id, powod: 'x' });
    const t = await domena.przenies(repo, c, { przydzial_id: w.przydzialy[0].id, nowy_skladnik_id: b.skladnik_id, id_klienta: '1001', data: DZIS });
    expect(await saldo(repo, a.skladnik_id)).toMatchObject({ R: 0, B: 2 }); expect(await saldo(repo, b.skladnik_id)).toMatchObject({ R: 1, B: 0 });
    expect((await repo.pozycja(poz)).zakup_skladnik_id).toBe(b.skladnik_id); expect(t.nowy_przydzial_id).toBeTruthy();
  });
  test('przeniesienie na inną usługę jest odrzucone (bez cichej zamiany A na B)', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const a = await przyznaj(repo, c, { jednostki: 1 }); const b = await przyznaj(repo, c, { jednostki: 1, usluga_wyk_id: 'U-B' });
    const w = await rezerwujPoz(repo, c, await pozycja(repo), a.skladnik_id);
    await expect(domena.przenies(repo, c, { przydzial_id: w.przydzialy[0].id, nowy_skladnik_id: b.skladnik_id, id_klienta: '1001', data: DZIS })).rejects.toMatchObject({ extra: { code: 'INNY_WARIANT' } });
  });
});

// ═════════ K09: izolacja salonu, właściciel, autor z sesji ═════════
describe('K09 — obcy salon/klientka i podmieniony autor', () => {
  test('zakup innej klientki → WLASCICIEL; usługa niezgodna → INNY_WARIANT; brak ID klientki → odmowa', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { id_klienta: '1002' });
    await expect(rezerwujPoz(repo, c, await pozycja(repo), skladnik_id)).rejects.toMatchObject({ extra: { code: 'WLASCICIEL' } });
    const b = await przyznaj(repo, c, { usluga_wyk_id: 'U-B' });
    await expect(rezerwujPoz(repo, c, await pozycja(repo), b.skladnik_id)).rejects.toMatchObject({ extra: { code: 'INNY_WARIANT' } });
    await expect(domena.rezerwuj(repo, c, { pozycje: [{ pozycja_id: 1, skladnik_id, usluga_id: 'U-A' }], id_klienta: null, data: DZIS })).rejects.toThrow(/kartoteki/);
  });
  test('repoSql ogranicza każde zapytanie do salonu z kontekstu (tenant z sesji, nie z treści)', async () => {
    const zap = []; const qc = async (sql, p) => { zap.push({ sql, p }); return sql.startsWith('INSERT') ? { insertId: 1 } : []; };
    const repo = Z.repoSql(qc, 'salon-A');
    await repo.skladniki([1, 2], true); await repo.ruchy([1]); await repo.przydzial(5, true); await repo.zrodloSprzedaz('S-1', true); await repo.operacja('k'); await repo.wstawRuch({ skladnik_id: 1, typ: 'R', ilosc: 1 }); await repo.aktualizujPozycje(3, { stan: 'x' }); await repo.ewidencja();
    for (const z of zap) { expect(z.sql).toMatch(/tenant_id/); expect(z.p).toContain('salon-A'); }
    expect(zap.find(z => /Term_Zakupy_Skladniki s JOIN/.test(z.sql)).sql).toMatch(/FOR UPDATE$/);
    expect(zap.find(z => /FROM Sprzedaz WHERE/.test(z.sql)).sql).toMatch(/FOR SHARE/);
  });
  test('autor ruchu pochodzi z kontekstu sesji, nie z danych żądania', async () => {
    const repo = repoPamiec(T); const c = ctx('aktywna', 'Ola');
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 1, kto: 'Haker' });
    await rezerwujPoz(repo, c, await pozycja(repo), skladnik_id);
    expect(repo._T.ruchy.every(r => r.kto === 'Ola')).toBe(true);
  });
  test('tryb ewidencji: bez „aktywna” brak nowych przydziałów; „wstrzymana” blokuje też zwolnienie i wykonanie; „konczenie” pozwala rozliczać', async () => {
    const repo = repoPamiec(T);
    const { skladnik_id } = await przyznaj(repo, ctx('aktywna'), { jednostki: 2 }); const poz = await pozycja(repo);
    await expect(rezerwujPoz(repo, ctx('przygotowanie'), poz, skladnik_id)).rejects.toMatchObject({ extra: { code: 'EWIDENCJA' } });
    await expect(rezerwujPoz(repo, ctx('nie_uruchomiono'), poz, skladnik_id)).rejects.toMatchObject({ extra: { code: 'EWIDENCJA' } });
    await rezerwujPoz(repo, ctx('aktywna'), poz, skladnik_id);
    await expect(domena.wykonaj(repo, ctx('wstrzymana'), { pozycja_id: poz })).rejects.toMatchObject({ extra: { code: 'EWIDENCJA' } });
    await expect(domena.zwolnij(repo, ctx('wstrzymana'), { pozycja_id: poz, powod: 'x' })).rejects.toMatchObject({ extra: { code: 'EWIDENCJA' } });
    await expect(rezerwujPoz(repo, ctx('konczenie'), await pozycja(repo), skladnik_id)).rejects.toMatchObject({ extra: { code: 'EWIDENCJA' } });
    expect((await domena.wykonaj(repo, ctx('konczenie'), { pozycja_id: poz })).zuzyto).toBe(1);
  });
  test('przejścia trybów są jawne: nie_uruchomiono → aktywna niedozwolone bez przygotowania', async () => {
    const repo = repoPamiec(T); const c = ctx();
    await expect(domena.ustawEwidencje(repo, c, { tryb: 'aktywna' })).rejects.toMatchObject({ extra: { code: 'PRZEJSCIE' } });
    await domena.ustawEwidencje(repo, c, { tryb: 'przygotowanie' }); const w = await domena.ustawEwidencje(repo, c, { tryb: 'aktywna' });
    expect(w).toMatchObject({ tryb: 'aktywna', poprzedni: 'przygotowanie' }); expect((await repo.ewidencja()).rozpoczeto).toBe(c.teraz);
    expect((await domena.ustawEwidencje(repo, c, { tryb: 'aktywna' })).powtorzenie).toBe(true);
  });
});

// ═════════ K12 (domena): przerwana nie zużywa; ważność; potrącenie; wycofanie; źródło ═════════
describe('K12 — reguły zużycia, ważności i źródła', () => {
  test('pozycja przerwana nie ma operacji zużycia w domenie (tylko jawne wykonaj); nieobecność zwalnia, nie zużywa', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 1 }); const poz = await pozycja(repo);
    await rezerwujPoz(repo, c, poz, skladnik_id);
    expect(typeof domena.przerwij).toBe('undefined');
    const z = await domena.zwolnij(repo, c, { pozycja_id: poz, powod: 'nieobecność' });
    expect(z.zwolniono).toBe(1); expect(await saldo(repo, skladnik_id)).toMatchObject({ U: 0, F: 0, R: 0, B: 1 });
  });
  test('data wykonania = wskazana/teraz, nigdy planowana; przyszła data odrzucona; nadmiar ponad przydział odrzucony', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 1 }); const poz = await pozycja(repo, { start: `${DZIS} 08:00:00` });
    await rezerwujPoz(repo, c, poz, skladnik_id);
    await expect(domena.wykonaj(repo, c, { pozycja_id: poz, data_fakt: '2026-10-18 09:00:00' })).rejects.toThrow(/przyszłego/);
    await expect(domena.wykonaj(repo, c, { pozycja_id: poz, ilosc: 2 })).rejects.toMatchObject({ extra: { code: 'PONAD_PRZYDZIAL' } });
    const w = await domena.wykonaj(repo, c, { pozycja_id: poz });
    const real = await repo.realizacja(w.realizacje[0].id);
    expect(real.data_fakt).toBe(c.teraz); expect(real.data_fakt).not.toBe(`${DZIS} 08:00:00`); expect((await repo.pozycja(poz)).wykonanie_data_fakt).toBe(c.teraz);
  });
  test('R04: 3 jednostki w pozycji, potwierdzono 2 → zużyte 2, 1 nadal zarezerwowana i jawnie nierozstrzygnięta', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 5 }); const poz = await pozycja(repo);
    await domena.rezerwuj(repo, c, { pozycje: [{ pozycja_id: poz, skladnik_id, usluga_id: 'U-A', ilosc: 3 }], id_klienta: '1001', data: DZIS, uslugaPozycji: p => p.usluga_id });
    const w = await domena.wykonaj(repo, c, { pozycja_id: poz, ilosc: 2 });
    expect(w).toMatchObject({ zuzyto: 2, nierozstrzygniete: 1 }); expect(await saldo(repo, skladnik_id)).toMatchObject({ U: 2, R: 1, B: 2 });
  });
  test('ważność: termin po dacie ważności odrzucony (umówienie i przeniesienie), ostatni dzień włącznie dozwolony; zawieszenie blokuje', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 3, data_waznosci: '2026-10-19' });
    await expect(rezerwujPoz(repo, c, await pozycja(repo), skladnik_id, { data: '2026-10-20' })).rejects.toMatchObject({ extra: { powod: 'pakiet ważny do 2026-10-19' } });
    const poz = await pozycja(repo); await rezerwujPoz(repo, c, poz, skladnik_id, { data: '2026-10-19' });
    const spr = await domena.sprawdzPrzeniesienie(repo, c, { pozycjaIds: [poz], data: '2026-10-20' });
    expect(spr.ok).toBe(false); expect(spr.problemy[0].opis).toMatch(/ważny do 2026-10-19/); expect(await saldo(repo, skladnik_id)).toMatchObject({ R: 1 }); // przydział bez zmian
    expect((await domena.sprawdzPrzeniesienie(repo, c, { pozycjaIds: [poz], data: '2026-10-18' })).ok).toBe(true);
    await repo.aktualizujSkladnik(skladnik_id, { zawieszono_od: '2026-10-17', zawieszono_do: '2026-10-18' });
    await expect(rezerwujPoz(repo, c, await pozycja(repo), skladnik_id, { data: '2026-10-18' })).rejects.toMatchObject({ extra: { powod: 'składnik zawieszony do 2026-10-18' } });
  });
  test('R11: potrącenie rośnie F nie U; powtórzenie nie potrąca ponownie; po zwolnieniu brak przydziału → odmowa', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 2 }); const poz = await pozycja(repo);
    await rezerwujPoz(repo, c, poz, skladnik_id);
    expect((await domena.potrac(repo, c, { pozycja_id: poz, powod: 'regulamin: późne odwołanie' })).potracono).toBe(1);
    expect(await saldo(repo, skladnik_id)).toMatchObject({ F: 1, U: 0, R: 0, B: 1 });
    await expect(domena.potrac(repo, c, { pozycja_id: poz, powod: 'x' })).rejects.toMatchObject({ extra: { code: 'BRAK_PRZYDZIALU' } });
  });
  test('Z02: pełne wycofanie przy G=5,U=2,R=2,B=1 → U=2, W=3, R=0, B=0; dwie pozycje do wyjaśnienia', async () => {
    const repo = repoPamiec(T); const c = ctx();
    const { skladnik_id } = await przyznaj(repo, c, { jednostki: 5 });
    const p1 = await pozycja(repo), p2 = await pozycja(repo), p3 = await pozycja(repo), p4 = await pozycja(repo);
    for (const p of [p1, p2, p3, p4]) await rezerwujPoz(repo, c, p, skladnik_id);
    await domena.wykonaj(repo, c, { pozycja_id: p1 }); await domena.wykonaj(repo, c, { pozycja_id: p2 });
    const w = await domena.wycofaj(repo, c, { skladnik_id, zakres: 'wszystkie_niewykorzystane', powod: 'zwrot zakupu' });
    expect(await saldo(repo, skladnik_id)).toMatchObject({ G: 5, U: 2, W: 3, R: 0, B: 0 }); expect(w.zwolnione_pozycje.sort()).toEqual([p3, p4].sort());
    expect((await repo.pozycja(p3)).rozliczenie).toBe('do_wyjasnienia');
    await expect(domena.wycofaj(repo, c, { skladnik_id, ilosc: 1, powod: 'x' })).rejects.toMatchObject({ extra: { code: 'BRAK_WOLNYCH' } });
  });
  test('źródło: zmiana opisowa nie blokuje; zwrot/istotna/usunięcie blokują rezerwację, zakup oznaczony do wyjaśnienia', async () => {
    const repo = repoPamiec(T); const c = ctx();
    repo._T.sprzedaz.push({ id: 'S-7-1', status: 'AKTYWNY', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kategoria_produktu: null, kwota: 1500, data_sprzedazy: '2026-10-12', data_waznosci: '2026-12-31', karnet_zamkniety_w: null, grupa_id: null, zwrot_do_id: null });
    const zakup = await repo.wstawZakup({ sprzedaz_id: 'S-7-1', id_klienta: '1001', nazwa: 'Endermologia / 5x', data_waznosci: '2026-12-31', zrodlo_typ: 'sprzedaz' });
    const s = await repo.wstawSkladnik({ zakup_id: zakup, usluga_wyk_id: 'U-A', jednostki_przyznane: 5, stan_weryfikacji: 'zweryfikowany', zalezne_uzgodniono: 1, aktywny_od: c.teraz });
    await repo.wstawRuch({ skladnik_id: s, typ: 'G', ilosc: 5 });
    const u0 = await domena.uzgodnijZrodlo(repo, c, await repo.zakup(zakup)); expect(u0.zmiana).toBe('brak'); expect((await repo.zakup(zakup)).zrodlo_hash).toHaveLength(64);
    repo._T.sprzedaz[0].kwota = 1400; // zmiana opisowa (cena)
    await rezerwujPoz(repo, c, await pozycja(repo), s);
    expect((await repo.zakup(zakup)).stan_zrodla).toBe('ok');
    repo._T.sprzedaz.push({ id: 'S-9-1', status: 'AKTYWNY', zwrot_do_id: 'S-7-1', kwota: -1400, zabieg: 'ZWROT: Endermologia' });
    await expect(rezerwujPoz(repo, c, await pozycja(repo), s)).rejects.toMatchObject({ extra: { code: 'ZRODLO', zmiana: 'zwrot' } });
    expect((await repo.zakup(zakup)).stan_zrodla).toBe('wycofane');
    repo._T.sprzedaz[0].status = 'USUNIĘTY';
    expect((await domena.uzgodnijZrodlo(repo, c, await repo.zakup(zakup))).zmiana).toBe('usuniete');
  });
  test('logika: migawka/hash deterministyczne; klasyfikacja kandydata (dopłata, zwrot, produkt, bez ID) odrzuca; „1x” nie jest dowodem', () => {
    const row = { id: 'S-1-2', status: 'AKTYWNY', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x [Rabat: -10%]', kwota: '1200.00', data_sprzedazy: '2026-10-12 10:00:00' };
    const m1 = logika.migawkaZrodla(row, 0), m2 = logika.migawkaZrodla({ ...row, kwota: 1200 }, 0);
    expect(m1.szczegoly).toBe('5x'); expect(logika.hash(m1)).toBe(logika.hash(m2));
    expect(logika.porownajZrodlo(m1, logika.migawkaZrodla({ ...row, id_klienta: '1002' }, 0))).toBe('istotna');
    expect(logika.porownajZrodlo(m1, logika.migawkaZrodla({ ...row, komentarz: 'x' }, 0))).toBe('brak');
    expect(logika.kandydatNaZakup({ ...row, zabieg: 'Endermologia Dopłata' }).ok).toBe(false);
    expect(logika.kandydatNaZakup({ ...row, zwrot_do_id: 'S-0' }).ok).toBe(false);
    expect(logika.kandydatNaZakup({ ...row, kategoria_produktu: 'Kosmetyk' }).ok).toBe(false);
    expect(logika.kandydatNaZakup({ ...row, id_klienta: null }).powod).toMatch(/ID klientki/);
    expect(logika.kandydatNaZakup(row).ok).toBe(true);
  });
});

// ═════════ K10 / K12 / K14: kontrakt routera i start bez schematu ═════════
function atrapaBazy(odpowiedzi) {
  const zap = []; let insertId = 100;
  const wykonaj = (sql, params) => { zap.push({ sql: String(sql), params: params || [] }); for (const [re, w] of odpowiedzi) if (re.test(sql)) return typeof w === 'function' ? w(sql, params) : w; if (/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE)/i.test(sql)) return { insertId: ++insertId, affectedRows: 1 }; return []; };
  const query = (sql, p, cb) => { const c = typeof p === 'function' ? p : cb; const params = typeof p === 'function' ? [] : p; let w; try { w = wykonaj(sql, params); } catch (e) { return c && c(e); } if (c) c(null, w); };
  const conn = { query, beginTransaction: (cb) => { zap.push({ sql: 'BEGIN' }); cb(null); }, commit: (cb) => { zap.push({ sql: 'COMMIT' }); cb(null); }, rollback: (cb) => { zap.push({ sql: 'ROLLBACK' }); cb(); }, release: () => {} };
  return { query, getConnection: (cb) => cb(null, conn), zap };
}
const USTAWIENIA = { tenant_id: T, tryb: 'wewnetrzny', siatka_min: 15, tolerancja_min: 10, horyzont_dni: 90, wyprzedzenie_min: 0, godziny_json: JSON.stringify({ 1: [{ od: '08:00', do: '20:00' }], 2: [{ od: '08:00', do: '20:00' }], 3: [{ od: '08:00', do: '20:00' }], 4: [{ od: '08:00', do: '20:00' }], 5: [{ od: '08:00', do: '20:00' }], 6: [{ od: '08:00', do: '20:00' }], 7: [] }), wersja: 1, kontrola_zakupow: 'off' };
const BAZOWE = [
  [/SELECT rola FROM Użytkownicy/, [{ rola: 'manager' }]],
  [/GET_LOCK/, [{ l: 1 }]],
  [/FROM Term_Grafik WHERE/, [1, 2, 3, 4, 5, 6, 7].map(dz => ({ id: dz, pracownik: 'Anna', dzien_tyg: dz, od: '08:00', do: '20:00', od_daty: null, do_daty: null }))],
  [/FROM Term_Ustawienia WHERE/, [USTAWIENIA]],
  [/SELECT DATE_FORMAT\(NOW\(\)/, [{ t: '2026-10-19 10:00:00' }]],
  [/FROM Uslugi u LEFT JOIN Term_Uslugi/, [{ id: 'U-A', kategoria: 'Endermologia', wariant: '1x', cena: 200, typ_zabiegu: null, czas_min: 30, bufor_przed_min: 0, bufor_po_min: 0, bufor_dotyczy: 'oba', wymaga_gabinet: 0, gabinety_json: null, urzadzenia_json: '[]', pracownicy_json: null, aktywna: 1, konfig_wersja: 1 }]],
  [/SELECT p\.imie FROM Pracownicy/, [{ imie: 'Anna' }]],
  [/FROM Klienci WHERE tenant_id = \? AND id_klienta = \?/, [{ id_klienta: '1001', imie_nazwisko: 'Testowa Klientka', telefon: '600000000', status: 'AKTYWNY' }]],
  [/FROM Term_Rezerwacje WHERE tenant_id = \? AND klucz_idem/, []],
  [/FROM Term_Ewidencja/, [{ tryb: 'aktywna' }]],
];
function aplikacja(db, feature = true) { const app = express(); app.use(express.json()); const m = require('../routes/terminarz'); const router = m(db, { hasFeature: (t, k, cb) => cb(feature), log: { error() {}, warn() {}, info() {} } }); app.use('/api', router); return { app, router, AKCJE: m.AKCJE }; }
const post = (app, body) => request(app).post('/api/terminarz').send({ tenant_id: T, pracownik: 'Ola', ...body });
const zapisz = (extra = {}) => ({ action: 'trm_zapisz', klucz_idem: 'KL-1', start: '2026-10-20 10:00', klient: { id_klienta: '1001', nazwa: 'Testowa Klientka' }, pozycje: [{ usluga_id: 'U-A', pracownik: 'Anna', zakup_skladnik_id: 5 }], ...extra });

describe('K10 — brak schematu/aktywacji nie psuje rdzenia i nie dopuszcza ruchów jednostek', () => {
  const envPrzed = process.env.TERMINARZ_ZAKUPY_TENANTS;
  afterEach(() => { if (envPrzed === undefined) delete process.env.TERMINARZ_ZAKUPY_TENANTS; else process.env.TERMINARZ_ZAKUPY_TENANTS = envPrzed; });
  test('moduł ładuje się mimo bazy odrzucającej każde zapytanie (start rdzenia niezależny od dodatku)', () => {
    const db = { query: (s, p, cb) => { const c = typeof p === 'function' ? p : cb; if (c) c(new Error('brak tabel')); }, getConnection: (cb) => cb(new Error('brak bazy')) };
    expect(() => aplikacja(db)).not.toThrow();
  });
  test('dodatek wyłączony → każda akcja poza trm_init dostaje DODATEK; trm_init zwraca feature_on:false', async () => {
    const db = atrapaBazy(BAZOWE); const { app } = aplikacja(db, false);
    expect((await post(app, { action: 'trm_init' })).body).toMatchObject({ status: 'success', feature_on: false });
    expect((await post(app, zapisz())).body).toMatchObject({ status: 'error', code: 'DODATEK' });
  });
  test('N03: integracja wyłączona (brak salonu w TERMINARZ_ZAKUPY_TENANTS) → rezerwacja z zakupu odrzucona PRZED jakimkolwiek zapisem; odczyt zakupów pusty', async () => {
    delete process.env.TERMINARZ_ZAKUPY_TENANTS;
    const db = atrapaBazy(BAZOWE); const { app } = aplikacja(db);
    const r = await post(app, zapisz()); expect(r.body).toMatchObject({ status: 'error', code: 'INTEGRACJA' });
    expect(db.zap.some(z => /^\s*INSERT/i.test(z.sql) && !/Features_Catalog|Term_Migracje/.test(z.sql))).toBe(false);
    expect((await post(app, { action: 'trm_zakupy_klientki', id_klienta: '1001' })).body).toMatchObject({ status: 'success', integracja: 'off', zakupy: [] });
    for (const action of ['trm_ewidencja_ustaw', 'trm_zakup_przyznaj', 'trm_skladnik_weryfikuj', 'trm_wykonanie_koryguj', 'trm_pozycja_zrodlo', 'trm_zakupy_uzgodnij', 'trm_oferta_zapisz']) expect((await post(app, { action, tryb: 'aktywna' })).body).toMatchObject({ status: 'error', code: 'INTEGRACJA' });
    expect(db.zap.some(z => /^\s*INSERT/i.test(z.sql) && !/Features_Catalog|Term_Migracje/.test(z.sql))).toBe(false);
  });
  test('N05: salon na liście technicznej, ale BRAK schematu v2 → dodatek zgłasza niedostępność (SCHEMAT_V2), rdzeń i kalendarz bez pakietu działają', async () => {
    process.env.TERMINARZ_ZAKUPY_TENANTS = T;
    const db = atrapaBazy([[/INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME IN \('Term_Oferty'/, () => [{ t: 'Term_Oferty', c: 'id' }, { t: 'Term_Oferty_Skladniki', c: 'id' }, { t: 'Term_Zakupy', c: 'id' }, { t: 'Term_Zakupy_Skladniki', c: 'id' }, { t: 'Term_Zakupy_Ruchy', c: 'id' }, { t: 'Term_Pozycje', c: 'zakup_skladnik_id' }, { t: 'Term_Ustawienia', c: 'kontrola_zakupow' }]], [/INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME IN \(\?/, []], ...BAZOWE]);
    const { app, router } = aplikacja(db);
    await router.sprawdzSchemat(); const sv2 = await router.sprawdzSchematV2(); expect(sv2.gotowy).toBe(false); expect(sv2.braki.length).toBeGreaterThan(10);
    expect((await post(app, { action: 'trm_ewidencja_ustaw', tryb: 'przygotowanie' })).body).toMatchObject({ status: 'error', code: 'SCHEMAT_V2' });
    expect((await post(app, zapisz())).body).toMatchObject({ status: 'error', code: 'INTEGRACJA' });
    const init = (await post(app, { action: 'trm_init' })).body; expect(init.ustawienia.zakupy_integracja).toBe('off'); expect(init.schemat_v2.gotowy).toBe(false);
    // zwykła wizyta bez pakietu nadal się zapisuje (kalendarz niezależny od ewidencji)
    const zw = await post(app, zapisz({ pozycje: [{ usluga_id: 'U-A', pracownik: 'Anna' }], klucz_idem: 'KL-2' }));
    expect(zw.body.status).toBe('success'); expect(db.zap.some(z => /INSERT INTO Term_Rezerwacje/.test(z.sql))).toBe(true);
    expect(db.zap.some(z => /Term_Przydzialy|Term_Zakupy_Ruchy/.test(z.sql) && /INSERT/.test(z.sql))).toBe(false);
  });
});

describe('K12 — kontrakt handlerów na atrapie bazy ze schematem v2', () => {
  const envPrzed = process.env.TERMINARZ_ZAKUPY_TENANTS;
  afterEach(() => { if (envPrzed === undefined) delete process.env.TERMINARZ_ZAKUPY_TENANTS; else process.env.TERMINARZ_ZAKUPY_TENANTS = envPrzed; });
  const schematOk = () => [[/INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME IN \('Term_Oferty'/, () => [{ t: 'Term_Oferty', c: 'id' }, { t: 'Term_Oferty_Skladniki', c: 'id' }, { t: 'Term_Zakupy', c: 'id' }, { t: 'Term_Zakupy_Skladniki', c: 'id' }, { t: 'Term_Zakupy_Ruchy', c: 'id' }, { t: 'Term_Pozycje', c: 'zakup_skladnik_id' }, { t: 'Term_Ustawienia', c: 'kontrola_zakupow' }]], [/INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME IN \(\?/, () => Z.ELEMENTY_V2.map(n => ({ t: n.split('.')[0], c: n.split('.')[1] || 'id' }))]];
  const rez = (stanPoz, extra = {}) => ({ id: 7, tenant_id: T, id_klienta: '1001', klient_nazwa: 'Testowa', status: 'potwierdzona', obecnosc: 'przybyl', kanal: 'recepcja', start_s: '2026-10-19 09:00:00', koniec_s: '2026-10-19 09:30:00', wersja: 1, ...extra, _poz: stanPoz });
  function bazaZWizyta(stanPoz, przydzialy) {
    return atrapaBazy([...schematOk(), [/FROM Term_Rezerwacje r WHERE r\.tenant_id = \? AND r\.id = \?/, [rez(stanPoz)]],
      [/FROM Term_Pozycje p LEFT JOIN Term_Zasoby/, [{ id: 42, rezerwacja_id: 7, kolejnosc: 0, usluga_id: 'U-A', kategoria: 'Endermologia', wariant: '1x', cena: 200, czas_min: 30, pracownik: 'Anna', start_s: '2026-10-19 09:00:00', koniec_s: '2026-10-19 09:30:00', stan: stanPoz, start_fakt: null, koniec_fakt: null, wykonawca_fakt: null, zakup_skladnik_id: 5 }]],
      [/FROM Term_Przydzialy WHERE tenant_id = \? AND pozycja_id = \? AND stan = 'zarezerwowany'/, przydzialy],
      [/FROM Term_Przydzialy WHERE tenant_id = \? AND pozycja_id IN/, przydzialy.map(p => ({ ...p, pozycja_id: 42, skladnik_id: 5, ilosc: 1, ilosc_zuzyta: 0, stan: 'zarezerwowany' }))],
      [/FROM Term_Przydzialy WHERE tenant_id = \? AND id = \?/, [{ id: 9, pozycja_id: 42, skladnik_id: 5, ilosc: 1, ilosc_zuzyta: 0, cykl: 1, stan: 'zarezerwowany' }]],
      [/FROM Term_Operacje WHERE/, []], [/FROM Term_Zakupy_Ruchy2 WHERE/, [{ skladnik_id: 5, typ: 'G', kierunek: 1, ilosc: 3 }, { skladnik_id: 5, typ: 'R', kierunek: 1, ilosc: 1 }]],
      ...BAZOWE]);
  }
  beforeEach(() => { process.env.TERMINARZ_ZAKUPY_TENANTS = T; });
  test('„Oznacz wykonane” z pakietu: R−1 i U+1 w jednej transakcji, data = NOW (nie planowana 09:00), bez COALESCE(start_fakt, start)', async () => {
    const db = bazaZWizyta('zaplanowana', [{ id: 9, cykl: 1 }]); const { app, router } = aplikacja(db); await router.sprawdzSchemat(); await router.sprawdzSchematV2();
    const r = await post(app, { action: 'trm_pozycja_stan', id: 7, pozycja_id: 42, stan: 'wykonana' });
    expect(r.body.status).toBe('success'); expect(r.body.jednostki).toMatchObject({ zuzyto: 1 });
    const ruchy = db.zap.filter(z => /INSERT INTO Term_Zakupy_Ruchy2/.test(z.sql)).map(z => z.params[2] + (z.params[3] > 0 ? '+' : '-'));
    expect(ruchy).toEqual(['R-', 'U+']);
    const real = db.zap.find(z => /INSERT INTO Term_Realizacje/.test(z.sql)); expect(real.params[6]).toBe('2026-10-19 10:00:00'); // data_fakt = teraz z serwera
    const up = db.zap.find(z => /UPDATE Term_Pozycje SET stan = \?, koniec_fakt = NOW\(\)/.test(z.sql)); expect(up.sql).not.toMatch(/COALESCE\(start_fakt/);
    const idx = (re) => db.zap.findIndex(z => re.test(z.sql)); const idxOst = (re) => db.zap.map(z => re.test(z.sql)).lastIndexOf(true); expect(idx(/^BEGIN$/)).toBeLessThan(idx(/INSERT INTO Term_Zakupy_Ruchy2/)); expect(idxOst(/^COMMIT$/)).toBeGreaterThan(idxOst(/INSERT INTO Term_Zakupy_Ruchy2/));
    expect(db.zap.some(z => /GET_LOCK/.test(z.sql))).toBe(true); expect(db.zap.some(z => /RELEASE_LOCK/.test(z.sql))).toBe(true);
  });
  test('„przerwana” nie zużywa i nie zwalnia jednostki; „niewykonana” zwalnia (R−1), bez U', async () => {
    let db = bazaZWizyta('w_trakcie', [{ id: 9, cykl: 1 }]); let a = aplikacja(db); await a.router.sprawdzSchemat(); await a.router.sprawdzSchematV2();
    expect((await post(a.app, { action: 'trm_pozycja_stan', id: 7, pozycja_id: 42, stan: 'przerwana' })).body.status).toBe('success');
    expect(db.zap.some(z => /INSERT INTO Term_Zakupy_Ruchy2|INSERT INTO Term_Realizacje/.test(z.sql))).toBe(false);
    db = bazaZWizyta('zaplanowana', [{ id: 9, cykl: 1 }]); a = aplikacja(db); await a.router.sprawdzSchemat(); await a.router.sprawdzSchematV2();
    expect((await post(a.app, { action: 'trm_pozycja_stan', id: 7, pozycja_id: 42, stan: 'niewykonana' })).body.status).toBe('success');
    const ruchy = db.zap.filter(z => /INSERT INTO Term_Zakupy_Ruchy2/.test(z.sql)).map(z => z.params[2] + (z.params[3] > 0 ? '+' : '-')); expect(ruchy).toEqual(['R-']);
  });
  test('recepcja bez ustawienia salonu nie potwierdza wykonania z pakietu; inna data wykonania tylko manager z powodem', async () => {
    const db = bazaZWizyta('zaplanowana', [{ id: 9, cykl: 1 }]); db.query = ((orig) => (s, p, cb) => { if (/SELECT rola FROM Użytkownicy/.test(s)) return (typeof p === 'function' ? p : cb)(null, [{ rola: 'recepcja' }]); return orig(s, p, cb); })(db.query);
    const a = aplikacja(db); await a.router.sprawdzSchemat(); await a.router.sprawdzSchematV2();
    expect((await post(a.app, { action: 'trm_pozycja_stan', id: 7, pozycja_id: 42, stan: 'wykonana' })).body).toMatchObject({ status: 'error', code: 'UPRAWNIENIA' });
    expect(db.zap.some(z => /INSERT INTO Term_Zakupy_Ruchy2/.test(z.sql))).toBe(false);
    const db2 = bazaZWizyta('zaplanowana', [{ id: 9, cykl: 1 }]); const b = aplikacja(db2); await b.router.sprawdzSchemat(); await b.router.sprawdzSchematV2();
    expect((await post(b.app, { action: 'trm_pozycja_stan', id: 7, pozycja_id: 42, stan: 'wykonana', data_fakt: '2026-10-18 15:00' })).body.message).toMatch(/powód/);
  });
  test('odczyt zakupów nie wykonuje importu ani zapisu; stare mutatory T03 odrzucone', async () => {
    const db = atrapaBazy([...schematOk(), [/FROM Term_Zakupy WHERE tenant_id = \? AND id_klienta/, [{ id: 3, sprzedaz_id: 'S-1-1', id_klienta: '1001', nazwa: 'Endermologia / 5x', stan: 'aktywny', stan_zrodla: 'ok', zrodlo_typ: 'sprzedaz' }]], [/Term_Zakupy_Skladniki s JOIN Term_Zakupy z .*s\.zakup_id IN/, [{ id: 5, zakup_id: 3, usluga_wyk_id: 'U-A', stan: 'aktywny', stan_weryfikacji: 'niezweryfikowany', zalezne_uzgodniono: 0 }]], [/FROM Term_Zakupy_Ruchy2/, [{ skladnik_id: 5, typ: 'G', kierunek: 1, ilosc: 5 }]], ...BAZOWE]);
    const { app, router } = aplikacja(db); await router.sprawdzSchemat(); await router.sprawdzSchematV2();
    const r = await post(app, { action: 'trm_zakupy_klientki', id_klienta: '1001' });
    expect(r.body.status).toBe('success'); expect(r.body.zakupy[0].skladniki[0]).toMatchObject({ przyznane: 5, do_umowienia: null, dostepny: false, wolne: 0 });
    expect(db.zap.some(z => /^\s*(INSERT|UPDATE|DELETE)/i.test(z.sql) && !/Term_Migracje|Features_Catalog/.test(z.sql))).toBe(false); // seed katalogu dodatków przy ładowaniu modułu nie jest zapisem domeny
    expect((await post(app, { action: 'trm_zakupy_import' })).body).toMatchObject({ status: 'error', code: 'ZASTAPIONE' });
    expect((await post(app, { action: 'trm_zakup_bilans', zakup_id: 3 })).body).toMatchObject({ status: 'error', code: 'ZASTAPIONE' });
    expect(db.zap.some(z => /INSERT INTO Term_Zakupy/.test(z.sql))).toBe(false);
  });
  test('trm_zapisz z zakupem przy ewidencji „przygotowanie” → odmowa i ROLLBACK (wizyta nie powstaje)', async () => {
    const db = atrapaBazy([...schematOk(), [/FROM Term_Ewidencja/, [{ tryb: 'przygotowanie' }]], [/FROM Term_Zakupy_Skladniki s JOIN Term_Zakupy z .* s\.id IN/, [{ id: 5, zakup_id: 3, usluga_wyk_id: 'U-A', id_klienta: '1001', stan: 'aktywny', stan_weryfikacji: 'zweryfikowany', zalezne_uzgodniono: 1, aktywny_od: '2026-10-01', zakup_stan: 'aktywny', stan_zrodla: 'ok', zrodlo_typ: 'przyznane' }]], ...BAZOWE]);
    const { app, router } = aplikacja(db); await router.sprawdzSchemat(); await router.sprawdzSchematV2();
    const r = await post(app, zapisz()); expect(r.body).toMatchObject({ status: 'error', code: 'EWIDENCJA' });
    expect(db.zap.some(z => z.sql === 'ROLLBACK')).toBe(true); expect(db.zap.some(z => z.sql === 'COMMIT')).toBe(false);
  });
});

describe('K11 (mock) — migracja v2 kontrolowana i powtarzalna', () => {
  test('pusty model: wszystkie kroki DDL; drugi przebieg = „już było”; dane w starym modelu zatrzymują ścieżkę bez DDL', async () => {
    const wyk = []; let zastosowane = new Set();
    const qx = async (sql) => { wyk.push(sql); if (/GET_LOCK/.test(sql)) return [{ l: 1 }]; if (/RELEASE_LOCK/.test(sql)) return []; if (/COUNT\(\*\) n FROM INFORMATION_SCHEMA/.test(sql)) return [{ n: zastosowane.has('Term_Zakupy_Ruchy2') ? 1 : 0 }]; if (/COUNT\(\*\) n FROM/.test(sql)) return [{ n: 0 }]; if (/^(CREATE|ALTER)/.test(sql)) { const k = sql.match(/TABLE (?:IF NOT EXISTS )?(\w+)(?: ADD COLUMN (\w+))?/); const n = k[2] ? k[1] + '.' + k[2] : k[1]; if (zastosowane.has(n)) { const e = new Error('dup'); e.code = k[2] ? 'ER_DUP_FIELDNAME' : 'ER_TABLE_EXISTS_ERROR'; throw e; } zastosowane.add(n); return []; } return []; };
    const r1 = await Z.migrujV2(qx, { log: { error() {} } }); expect(r1.zastosowano).toHaveLength(Z.SCHEMAT_V2.length); expect(r1.bledy).toEqual([]); expect(r1.zatrzymano).toBeNull();
    const r2 = await Z.migrujV2(qx, { log: { error() {} } }); expect(r2.juzBylo).toHaveLength(Z.SCHEMAT_V2.length); expect(r2.zastosowano).toEqual([]);
    expect(wyk.filter(s => /DROP|TRUNCATE|DELETE/i.test(s))).toEqual([]);
    expect(wyk.some(s => /Term_Migracje/.test(s) && /v2:/.test(JSON.stringify(s)) === false)).toBe(true);
    const wyk2 = []; zastosowane = new Set();
    const qx2 = async (sql) => { wyk2.push(sql); if (/GET_LOCK/.test(sql)) return [{ l: 1 }]; if (/COUNT\(\*\) n FROM INFORMATION_SCHEMA/.test(sql)) return [{ n: 0 }]; if (/COUNT\(\*\) n FROM Term_Zakupy_Ruchy/.test(sql)) return [{ n: 12 }]; if (/COUNT/.test(sql)) return [{ n: 0 }]; return []; };
    const r3 = await Z.migrujV2(qx2, { log: { error() {} } }); expect(r3.zatrzymano).toMatch(/zawiera dane/); expect(wyk2.filter(s => /^(CREATE|ALTER)/.test(s))).toEqual([]);
    expect((await Z.migrujV2(qx, { dryRun: true })).zastosowano.every(s => /dry-run/.test(s))).toBe(true);
  });
});

describe('K14 — brak starej ścieżki T02/T03 omijającej walidację', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'terminarz.js'), 'utf8');
  test('terminarz.js nie zapisuje do Term_Zakupy_Ruchy (v1), nie ma starych helperów sald/importu ani podstawiania planowanej godziny', () => {
    expect(src).not.toMatch(/INSERT\s+(IGNORE\s+)?INTO\s+Term_Zakupy_Ruchy\s*\(/);
    expect(src).not.toMatch(/function saldaSkladnikow|function importujZakupy|function zakupyKlientki|function zatwierdzoneOferty/);
    expect(src).not.toMatch(/COALESCE\(start_fakt, start\)/);
  });
  test('wszystkie mutacje jednostek przechodzą przez wTransakcjiSalonu (GET_LOCK + BEGIN)', () => {
    for (const akcja of ['trm_anuluj', 'trm_obecnosc', 'trm_pozycja_stan', 'trm_zakup_przyznaj', 'trm_skladnik_weryfikuj', 'trm_wykonanie_koryguj', 'trm_pozycja_zrodlo', 'trm_pozycja_potrac', 'trm_zakupy_uzgodnij', 'trm_ewidencja_ustaw']) {
      const i = src.indexOf(`case '${akcja}':`); const blok = src.slice(i, src.indexOf("\n      case '", i + 10));
      expect(blok).toMatch(/wTransakcjiSalonu\(/);
    }
    expect((src.match(/Z\.domena\.(rezerwuj|zwolnij|wykonaj|potrac|wycofaj|odwrocRealizacje|przenies|przyznaj|weryfikujSkladnik|uruchomSkladnik|ustawEwidencje)\(/g) || []).length).toBeGreaterThan(8);
  });
});
