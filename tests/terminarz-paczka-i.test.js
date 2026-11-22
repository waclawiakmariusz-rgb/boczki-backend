// tests/terminarz-paczka-i.test.js
// Terminarz, paczka I — „nazwy jako klucze, ciąg dalszy" (docs/terminarz-audyt/PLAN_POPRAWY_2026-11-16.md).
// R11 porównania po znormalizowanej nazwie, R15 lista wykonawców jako JSON, R16 cztery brakujące kolumny
// i kontrola dubla w transakcji. Decyzja właściciela #4 (zmiana imienia tylko dla managera) NIE wchodzi.
const fs = require('fs');
const path = require('path');
const S = require('../routes/terminarz-silnik');
const DZ = '2026-11-23';   // konflikty() liczy w minutach od epoki, wiec obie strony musza miec date

const SPRZEDAZ = fs.readFileSync(path.join(__dirname, '..', 'routes', 'sprzedaz.js'), 'utf8');
const TERMINARZ = fs.readFileSync(path.join(__dirname, '..', 'routes', 'terminarz.js'), 'utf8');

// ─── R11: konflikty po znormalizowanym kluczu ──────────────────────────────
describe('R11 — kolizje pracownika liczone mimo różnic w pisowni', () => {
    const nowe = [{ typ_zasobu: 'pracownik', klucz: 'Anna Kowalska', od: S.naMin(DZ + " 10:00"), do: S.naMin(DZ + " 11:00") }];

    test('BŁĄD, KTÓRY NAPRAWIAMY: ten sam termin zapisany ze spacją na końcu nie był kolizją', () => {
        const k = S.konflikty(nowe, [{ typ_zasobu: 'pracownik', klucz: 'Anna Kowalska ', od: '2026-11-23 10:00', do: '2026-11-23 11:00', rezerwacja_id: 7 }]);
        expect(k).toHaveLength(1);
        expect(k[0].rezerwacja_id).toBe(7);
    });

    test('podwójna spacja w środku też jest tą samą osobą', () => {
        const k = S.konflikty(nowe, [{ typ_zasobu: 'pracownik', klucz: 'Anna  Kowalska', od: '2026-11-23 10:00', do: '2026-11-23 11:00' }]);
        expect(k).toHaveLength(1);
    });

    test('inna osoba nadal nie jest kolizją', () => {
        expect(S.konflikty(nowe, [{ typ_zasobu: 'pracownik', klucz: 'Marta Nowak', od: '2026-11-23 10:00', do: '2026-11-23 11:00' }])).toHaveLength(0);
    });

    test('gabinety i urządzenia mają klucze liczbowe — porównanie bez zmian', () => {
        const gab = [{ typ_zasobu: 'gabinet', klucz: '3', od: S.naMin(DZ + " 10:00"), do: S.naMin(DZ + " 11:00") }];
        expect(S.konflikty(gab, [{ typ_zasobu: 'gabinet', klucz: 3, od: '2026-11-23 10:00', do: '2026-11-23 11:00' }])).toHaveLength(1);
        expect(S.konflikty(gab, [{ typ_zasobu: 'gabinet', klucz: 4, od: '2026-11-23 10:00', do: '2026-11-23 11:00' }])).toHaveLength(0);
    });

    test('terminy, które się nie nakładają, nadal nie kolidują', () => {
        expect(S.konflikty(nowe, [{ typ_zasobu: 'pracownik', klucz: 'Anna Kowalska ', od: '2026-11-23 11:00', do: '2026-11-23 12:00' }])).toHaveLength(0);
    });

    test('nieobecność dopasowywana po znormalizowanej nazwie', () => {
        expect(TERMINARZ).toContain('const takaSamaOsoba = (a, b) => normalizujNazwe(a) === normalizujNazwe(b);');
        expect(TERMINARZ).toContain('blokadyDla(n => n.pracownik && takaSamaOsoba(n.pracownik, p))');
    });
});

// ─── R15: lista wykonawców usługi ──────────────────────────────────────────
describe('R15 — lista wykonawców trzymana i podmieniana jako JSON', () => {
    test('zapis konfiguracji usługi normalizuje imiona i usuwa powtórzenia', () => {
        expect(TERMINARZ).toContain('const prac = Array.isArray(d.pracownicy) ? [...new Set(d.pracownicy.map(x => normalizujNazwe(x)).filter(Boolean))] : null;');
    });

    test('zmiana imienia nie używa już REPLACE po tekście JSON', () => {
        expect(SPRZEDAZ).not.toMatch(/pracownicy_json = REPLACE\(pracownicy_json/);
        expect(SPRZEDAZ).toMatch(/SELECT usluga_id, pracownicy_json FROM Term_Uslugi/);
        expect(SPRZEDAZ).toMatch(/SET pracownicy_json = \?, wersja = wersja \+ 1/);
    });

    test('pusta lista po zmianie zapisywana jako NULL, czyli „wszyscy", i odnotowana', () => {
        expect(SPRZEDAZ).toMatch(/if \(!nowa\.length\) pustePoZmianie\.push\(row\.usluga_id\);/);
        expect(SPRZEDAZ).toMatch(/nowa\.length \? JSON\.stringify\(nowa\) : null/);
    });

    test('odporność na odpowiedź, która nie jest tablicą', () => {
        expect(SPRZEDAZ).toContain('for (const row of (Array.isArray(rows) ? rows : [])) {');
    });

    test('URUCHOMIENIE: podmiana w liście zachowuje resztę i nie dubluje', () => {
        // ta sama matematyka, którą robi krok w edit_employee
        const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
        const podmien = (lista, stare, nowe) => [...new Set(lista.map(x => (norm(x) === norm(stare) ? nowe : norm(x))).filter(Boolean))];
        expect(podmien(['Anna ', 'Ola'], 'Anna', 'Anna Nowak')).toEqual(['Anna Nowak', 'Ola']);
        expect(podmien(['Anna', 'Ola'], 'Anna', 'Ola')).toEqual(['Ola']);          // bez duplikatu
        expect(podmien(['Anna'], 'Anna', '')).toEqual([]);                          // pusta → „wszyscy"
        expect(podmien(['Marta'], 'Anna', 'X')).toEqual(['Marta']);                 // nie dotyczy
    });
});

// ─── R16: brakujące kolumny i kontrola dubla ───────────────────────────────
describe('R16 — zmiana imienia obejmuje cztery kolejne miejsca', () => {
    const lista = (() => {
        const od = SPRZEDAZ.indexOf("['Term_Nieobecnosci', 'pracownik']");
        const blok = SPRZEDAZ.slice(od, SPRZEDAZ.indexOf('];', od));
        return [...blok.matchAll(/\['?`?([A-Za-z_]+)`?'?,\s*'([a-z_]+)'\]/g)].map(m => [m[1], m[2]]);
    })();

    // nazwy sprawdzone w information_schema produkcji 22.11.2026
    test.each([
        ['Zadania', 'przypisane_do'],
        ['Wyniki_konsultacja', 'kto_wykonal'],
        ['Zadatki', 'pracownicy'],
        ['Term_Sprawy', 'wlasciciel'],
    ])('%s.%s jest na liście kolumn z imieniem', (tabela, kolumna) => {
        expect(lista.find(([t, k]) => t === tabela && k === kolumna)).toBeTruthy();
    });

    test('kontrola dubla powtórzona w transakcji z blokadą wiersza', () => {
        expect(SPRZEDAZ).toMatch(/LOWER\(TRIM\(imie\)\) = LOWER\(\?\) AND TRIM\(imie\) <> \? LIMIT 1 FOR UPDATE/);
        const odBegin = SPRZEDAZ.indexOf('conn.beginTransaction((e3)');
        expect(SPRZEDAZ.indexOf('FOR UPDATE', odBegin)).toBeGreaterThan(odBegin);
    });

    test('decyzja właściciela #4 celowo NIE wdrożona: zmiana imienia nadal dla każdej osoby z PIN-em', () => {
        const blok = SPRZEDAZ.slice(SPRZEDAZ.indexOf("action === 'edit_employee'"), SPRZEDAZ.indexOf("action === 'edit_employee'") + 1200);
        expect(blok).not.toMatch(/ROLE_MANAGER|wymagajManagera|rola !== 'manager'/);
    });
});
