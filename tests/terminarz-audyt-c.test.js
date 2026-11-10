// tests/terminarz-audyt-c.test.js — paczka C audytu terminarza (10.11.2026): grafik i zasoby.
// #6 nieobecność/blokada „cały salon” to twarda odmowa także ze zgodą „mimo grafiku”; #7 zarchiwizowany gabinet
// nie wchodzi do puli silnika, nie pokazuje się w rezerwacji technicznej, a przywrócenie czyści datę archiwizacji.
const fs = require('fs');
const path = require('path');
const S = require('../routes/terminarz-silnik');

const D = '2026-11-12';
const min = (hhmm) => S.naMin(`${D} ${hhmm}`);
const dost = (od, do_) => [{ od: min(od), do: min(do_) }];
const usluga = (extra = {}) => ({ klucz: 'u1', nazwa: 'Omega', czas_min: 60, bufor_przed_min: 0, bufor_po_min: 0, bufor_dotyczy: 'oba', pracownik: 'Iza', pracownicyDozwoleni: ['Iza'], wymagaGabinetu: false, urzadzeniaDozwolone: [], ...extra });
const bazowe = () => ({ gabinety: ['1', '2'], urzadzenia: [], dostepnoscZasobow: { 1: dost('08:00', '20:00'), 2: dost('08:00', '20:00') }, zajete: [], klientZajety: [] });

describe('#6 nieobecność nie do obejścia zgodą „mimo grafiku”', () => {
  // Ambasada: nadpisanie 08–20, szkolenie 14–20 → dostępność 08–14, twarda blokada 14–20
  const kontekst = () => ({ ...bazowe(), dostepnoscPracownikow: { Iza: dost('08:00', '14:00') }, twardeBlokadyPracownikow: { Iza: dost('14:00', '20:00') } });
  test('bez zgody: odmowa z kodem NIEOBECNOSC (nie GRAFIK) i bez możliwości „mimo grafiku”', () => {
    const r = S.sprawdzKomplet({ ...kontekst(), start: `${D} 15:00`, pozycje: [usluga()] });
    expect(r.ok).toBe(false);
    expect(r.problemy[0].kod).toBe('NIEOBECNOSC');
    expect(r.problemy[0].mozna_mimo_grafiku).toBe(false);
    expect(r.problemy[0].opis).toMatch(/nieobecność albo blokadę \(14:00–20:00\)/);
  });
  test('ze zgodą „mimo grafiku”: nadal odmowa (przed poprawką przechodziło)', () => {
    const r = S.sprawdzKomplet({ ...kontekst(), start: `${D} 15:00`, pozycje: [usluga()], mimoGrafiku: true });
    expect(r.ok).toBe(false);
    expect(r.problemy[0].kod).toBe('NIEOBECNOSC');
  });
  test('zgoda nadal działa dla zwykłego końca grafiku (bez blokady): 17:00 przy grafiku do 14:00 → ostrzeżenie, ok', () => {
    const k = { ...bazowe(), dostepnoscPracownikow: { Iza: dost('08:00', '14:00') }, twardeBlokadyPracownikow: { Iza: [] } };
    const r = S.sprawdzKomplet({ ...k, start: `${D} 17:00`, pozycje: [usluga()], mimoGrafiku: true });
    expect(r.ok).toBe(true);
    expect(r.ostrzezenia[0].kod).toBe('GRAFIK');
  });
  test('w godzinach dostępności wizyta przechodzi normalnie', () => {
    const r = S.sprawdzKomplet({ ...kontekst(), start: `${D} 10:00`, pozycje: [usluga()] });
    expect(r.ok).toBe(true);
  });
});

describe('#7 zarchiwizowany gabinet', () => {
  const k = () => ({ ...bazowe(), dostepnoscPracownikow: { Iza: dost('08:00', '20:00') }, twardeBlokadyPracownikow: { Iza: [] } });
  test('gabinet wpisany w usłudze, ale nieaktywny (nie ma go w w.gabinety) → BRAK_GABINETU z instrukcją', () => {
    const r = S.sprawdzKomplet({ ...k(), gabinety: ['2'], start: `${D} 10:00`, pozycje: [usluga({ wymagaGabinetu: true, gabinetyDozwolone: [1] })] });
    expect(r.ok).toBe(false);
    expect(r.problemy[0].kod).toBe('BRAK_GABINETU');
    expect(r.problemy[0].opis).toMatch(/zarchiwizowany/);
  });
  test('dwa gabinety w usłudze, jeden zarchiwizowany → przydział do aktywnego', () => {
    const r = S.sprawdzKomplet({ ...k(), gabinety: ['2'], start: `${D} 10:00`, pozycje: [usluga({ wymagaGabinetu: true, gabinetyDozwolone: [1, 2] })] });
    expect(r.ok).toBe(true);
    expect(String(r.pozycje[0].gabinet_id)).toBe('2');
  });
  test('bez listy gabinetów w usłudze: pula = wszystkie aktywne (jak dotąd)', () => {
    const r = S.sprawdzKomplet({ ...k(), start: `${D} 10:00`, pozycje: [usluga({ wymagaGabinetu: true })] });
    expect(r.ok).toBe(true);
    expect(['1', '2']).toContain(String(r.pozycje[0].gabinet_id));
  });
  test('front: rezerwacja techniczna filtruje po aktywny && !zarchiwizowano; przywrócenie zasobu czyści archiwizację; kontekst dnia niesie twarde blokady', () => {
    const F = fs.readFileSync(path.join(__dirname, '..', 'public', 'terminarz.js'), 'utf8');
    expect(F).not.toContain('.filter(z => !z.archiwalny)');
    expect(F).toContain("const zas = (TRM.dane.zasoby || []).filter(z => z.aktywny && !z.zarchiwizowano);");
    const T = fs.readFileSync(path.join(__dirname, '..', 'routes', 'terminarz.js'), 'utf8');
    expect(T).toContain('zarchiwizowano = IF(? = 1, NULL, zarchiwizowano)');
    expect(T).toContain('twardeBlokadyPracownikow[p] = [...wszystkie, ...blokadyDla(n => n.pracownik === p)];');
    expect(T).toContain('return { ust, salon, dostepnoscPracownikow, twardeBlokadyPracownikow, dostepnoscZasobow,');
  });
});
