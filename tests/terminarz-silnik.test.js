// Testy silnika dostępności Terminarza — scenariusze z macierzy odbioru (rozdz. 30 spec):
// T031 granica przedziałów, T033 przerwa pracownika, T041 urządzenie zajęte, T043 dwie jednostki puli,
// T050 sprzątanie tylko gabinetu, T055 dwie usługi sekwencyjne, R04 kompetencje, R05 klient zajęty.
const S = require('../routes/terminarz-silnik');

const D = '2026-10-13';
const min = (hhmm) => S.naMin(`${D} ${hhmm}`);
const dost = (od, do_) => [{ od: min(od), do: min(do_) }];

const bazowe = () => ({
  gabinety: ['G1', 'G2'],
  urzadzenia: ['U1', 'U2'],
  dostepnoscPracownikow: { Natalia: dost('09:00', '17:00'), Emilia: dost('10:00', '18:00') },
  dostepnoscZasobow: { G1: dost('08:00', '20:00'), G2: dost('08:00', '20:00'), U1: dost('08:00', '20:00'), U2: dost('08:00', '20:00') },
  zajete: [],
  klientZajety: [],
});
const usluga = (extra = {}) => ({ klucz: 'inf', nazwa: 'Infinity', czas_min: 40, bufor_przed_min: 0, bufor_po_min: 10, bufor_dotyczy: 'oba', pracownik: 'Natalia', pracownicyDozwoleni: ['Natalia', 'Emilia'], wymagaGabinetu: true, gabinetyDozwolone: null, urzadzeniaDozwolone: ['U1', 'U2'], ...extra });

describe('terminarz-silnik: czas i przedziały', () => {
  test('naMin/naStr są odwrotne i naiwne (bez strefy)', () => {
    expect(S.naStr(S.naMin('2026-10-25 02:30'))).toBe('2026-10-25 02:30:00');
    expect(S.naMin('2026-10-13 10:15') - S.naMin('2026-10-13 10:00')).toBe(15);
  });
  test('T031: koniec 10:00 i początek 10:00 nie kolidują', () => {
    expect(S.nakladaja(min('09:00'), min('10:00'), min('10:00'), min('11:00'))).toBe(false);
    expect(S.nakladaja(min('09:00'), min('10:01'), min('10:00'), min('11:00'))).toBe(true);
  });
  test('odejmij wycina przerwę z dostępności', () => {
    const r = S.odejmij(dost('09:00', '17:00'), [{ od: min('12:00'), do: min('12:30') }]);
    expect(r).toEqual([{ od: min('09:00'), do: min('12:00') }, { od: min('12:30'), do: min('17:00') }]);
  });
  test('dzienTygodnia: 2026-10-13 to wtorek (2), 2026-10-18 niedziela (7)', () => {
    expect(S.dzienTygodnia('2026-10-13')).toBe(2);
    expect(S.dzienTygodnia('2026-10-18')).toBe(7);
  });
  test('przedzialyZGrafiku honoruje dzień tygodnia i zakres dat', () => {
    const wz = [{ dzien_tyg: 2, od: '09:00', do: '13:00' }, { dzien_tyg: 2, od: '14:00', do: '17:00', od_daty: '2026-11-01' }, { dzien_tyg: 3, od: '09:00', do: '17:00' }];
    expect(S.przedzialyZGrafiku(wz, D)).toEqual(dost('09:00', '13:00'));
  });
});

describe('terminarz-silnik: sprawdzKomplet', () => {
  test('komplet dostępny: pracownik + gabinet + urządzenie, bufor po liczony dla zasobów', () => {
    const r = S.sprawdzKomplet({ ...bazowe(), start: `${D} 12:00`, pozycje: [usluga()] });
    expect(r.ok).toBe(true);
    expect(r.pozycje[0]).toMatchObject({ pracownik: 'Natalia', gabinet_id: 'G1', urzadzenie_id: 'U1', start: `${D} 12:00:00`, koniec: `${D} 12:40:00` });
    const bufory = r.pozycje[0].zajecia.filter(z => z.powod === 'bufor');
    expect(bufory.map(z => z.typ_zasobu).sort()).toEqual(['gabinet', 'pracownik', 'urzadzenie']);
    expect(bufory[0]).toMatchObject({ od: min('12:40'), do: min('12:50') });
  });
  test('T033: godzina w środku przerwy pracownika jest niedostępna mimo otwartego salonu', () => {
    const b = bazowe();
    b.dostepnoscPracownikow.Natalia = S.odejmij(dost('09:00', '17:00'), [{ od: min('12:00'), do: min('13:00') }]);
    const r = S.sprawdzKomplet({ ...b, start: `${D} 12:10`, pozycje: [usluga()] });
    expect(r.ok).toBe(false);
    expect(r.problemy[0].kod).toBe('GRAFIK');
  });
  test('bufor po usłudze też musi mieścić się w grafiku (8.3)', () => {
    const r = S.sprawdzKomplet({ ...bazowe(), start: `${D} 16:30`, pozycje: [usluga()] }); // 16:30–17:10 bufor do 17:20 > 17:00
    expect(r.ok).toBe(false);
    expect(r.problemy[0].kod).toBe('GRAFIK');
    const r2 = S.sprawdzKomplet({ ...bazowe(), start: `${D} 16:10`, pozycje: [usluga()] }); // 16:10–16:50, bufor do 17:00 — na granicy OK
    expect(r2.ok).toBe(true);
  });
  test('T041: pracownik wolny, wymagane urządzenie zajęte → odrzucenie z kodem urządzenia', () => {
    const b = bazowe();
    b.zajete = [{ typ_zasobu: 'urzadzenie', klucz: 'U1', od: `${D} 12:00`, do: `${D} 12:50`, rezerwacja_id: 7 }, { typ_zasobu: 'urzadzenie', klucz: 'U2', od: `${D} 11:30`, do: `${D} 12:30`, rezerwacja_id: 8 }];
    const r = S.sprawdzKomplet({ ...b, start: `${D} 12:00`, pozycje: [usluga()] });
    expect(r.ok).toBe(false);
    expect(r.problemy[0].kod).toBe('URZADZENIE_ZAJETE');
  });
  test('T043: dwie jednostki w puli — drugi klient dostaje U2, trzeci nie ma miejsca', () => {
    const b = bazowe();
    b.zajete = [{ typ_zasobu: 'urzadzenie', klucz: 'U1', od: `${D} 12:00`, do: `${D} 12:50`, rezerwacja_id: 1 }];
    const r2 = S.sprawdzKomplet({ ...b, start: `${D} 12:00`, pozycje: [usluga({ pracownik: 'Emilia' })] });
    expect(r2.ok).toBe(true); expect(r2.pozycje[0].urzadzenie_id).toBe('U2');
    b.zajete.push({ typ_zasobu: 'urzadzenie', klucz: 'U2', od: `${D} 12:00`, do: `${D} 12:50`, rezerwacja_id: 2 });
    const r3 = S.sprawdzKomplet({ ...b, start: `${D} 12:00`, pozycje: [usluga({ pracownik: 'Emilia' })] });
    expect(r3.ok).toBe(false); expect(r3.problemy[0].kod).toBe('URZADZENIE_ZAJETE');
  });
  test('R14: pracownik zajęty w czasie bufora cudzej wizyty → PRACOWNIK_ZAJETY', () => {
    const b = bazowe();
    b.zajete = [{ typ_zasobu: 'pracownik', klucz: 'Natalia', od: `${D} 11:00`, do: `${D} 12:10`, rezerwacja_id: 3 }];
    const r = S.sprawdzKomplet({ ...b, start: `${D} 12:00`, pozycje: [usluga()] });
    expect(r.problemy[0].kod).toBe('PRACOWNIK_ZAJETY');
  });
  test('„dowolna osoba”: wybiera pierwszą wolną z uprawnieniem (R04)', () => {
    const b = bazowe();
    b.zajete = [{ typ_zasobu: 'pracownik', klucz: 'Natalia', od: `${D} 12:00`, do: `${D} 13:00`, rezerwacja_id: 3 }];
    const r = S.sprawdzKomplet({ ...b, start: `${D} 12:00`, pozycje: [usluga({ pracownik: null })] });
    expect(r.ok).toBe(true); expect(r.pozycje[0].pracownik).toBe('Emilia');
  });
  test('R04: wybrany pracownik bez kompetencji → KOMPETENCJE, nie zajętość', () => {
    const r = S.sprawdzKomplet({ ...bazowe(), start: `${D} 12:00`, pozycje: [usluga({ pracownik: 'Natalia', pracownicyDozwoleni: ['Emilia'] })] });
    expect(r.problemy[0].kod).toBe('KOMPETENCJE');
  });
  test('T050: bufor tylko dla gabinetu — pracownik wolny zaraz po usłudze', () => {
    const r = S.sprawdzKomplet({ ...bazowe(), start: `${D} 12:00`, pozycje: [usluga({ bufor_dotyczy: 'gabinet' })] });
    const z = r.pozycje[0].zajecia;
    expect(z.filter(x => x.typ_zasobu === 'pracownik')).toHaveLength(1);
    expect(z.filter(x => x.typ_zasobu === 'gabinet' && x.powod === 'bufor')).toHaveLength(1);
  });
  test('T055: dwie usługi sekwencyjne — druga zaczyna się po pierwszej i jej buforze, koniec sumuje czasy', () => {
    const r = S.sprawdzKomplet({ ...bazowe(), start: `${D} 12:00`, pozycje: [usluga(), usluga({ klucz: 'kob', nazwa: 'Kobido', czas_min: 60, bufor_po_min: 0, urzadzeniaDozwolone: [] })] });
    expect(r.ok).toBe(true);
    expect(r.pozycje[1].start).toBe(`${D} 12:50:00`);
    expect(r.koniec).toBe(`${D} 13:50:00`);
    expect(r.przerwy_min).toBe(10);
  });
  test('R05: klientka ma inną wizytę w tym czasie', () => {
    const r = S.sprawdzKomplet({ ...bazowe(), klientZajety: [{ od: `${D} 12:30`, do: `${D} 13:00` }], start: `${D} 12:00`, pozycje: [usluga()] });
    expect(r.ok).toBe(false); expect(r.problemy[0].kod).toBe('KLIENT_ZAJETY');
  });
  test('pominRezerwacje: przy zmianie terminu własne zajęcia nie blokują', () => {
    const b = bazowe();
    b.zajete = [{ typ_zasobu: 'pracownik', klucz: 'Natalia', od: `${D} 12:00`, do: `${D} 12:50`, rezerwacja_id: 55 }];
    expect(S.sprawdzKomplet({ ...b, start: `${D} 12:00`, pozycje: [usluga()] }).ok).toBe(false);
    expect(S.sprawdzKomplet({ ...b, pominRezerwacje: 55, start: `${D} 12:00`, pozycje: [usluga()] }).ok).toBe(true);
  });
  test('brak czasu trwania → BRAK_CZASU (usługa niezmapowana)', () => {
    const r = S.sprawdzKomplet({ ...bazowe(), start: `${D} 12:00`, pozycje: [usluga({ czas_min: 0 })] });
    expect(r.problemy[0].kod).toBe('BRAK_CZASU');
  });
});

describe('terminarz-silnik: szukajTerminy', () => {
  test('zwraca komplety od najwcześniejszego, pomija zajęte i respektuje siatkę 15 min', () => {
    const b = bazowe();
    b.zajete = [{ typ_zasobu: 'pracownik', klucz: 'Natalia', od: `${D} 09:00`, do: `${D} 10:00`, rezerwacja_id: 1 }];
    const r = S.szukajTerminy({ ...b, dzienOd: D, dzienDo: D, krok_min: 15, limit: 3, pozycje: [usluga()], dostepnoscDnia: () => b });
    expect(r.map(x => x.start)).toEqual([`${D} 10:00:00`, `${D} 10:15:00`, `${D} 10:30:00`]);
  });
  test('T040: dzień bez grafiku nie daje terminów; nieWczesniejNiz odcina przeszłość', () => {
    const b = bazowe();
    const r = S.szukajTerminy({ ...b, dzienOd: D, dzienDo: D, krok_min: 30, limit: 2, pozycje: [usluga()], nieWczesniejNiz: `${D} 15:00`, dostepnoscDnia: (data) => data === D ? b : null });
    expect(r.map(x => x.start)).toEqual([`${D} 15:00:00`, `${D} 15:30:00`]);
    const r2 = S.szukajTerminy({ ...b, dzienOd: '2026-10-14', dzienDo: '2026-10-14', krok_min: 30, limit: 2, pozycje: [usluga()], dostepnoscDnia: () => null });
    expect(r2).toEqual([]);
  });
});
