// tests/terminarz-paczka-f.test.js
// Terminarz, paczka F z docs/terminarz-audyt/PLAN_POPRAWY_2026-11-16.md — pięć poprawek jednolinijkowych.
// Zasada z planu: testy frontu mają WYKONYWAĆ kod, nie tylko dopasowywać tekst pliku. Przez to R1 przeszedł
// niezauważony — poprzedni test utrwalał błędną linię zamiast sprawdzić, co ta linia robi.
const fs = require('fs');
const path = require('path');

const czytaj = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const TERMINARZ_JS = czytaj('public/terminarz.js');
const SPRZEDAZ = czytaj('routes/sprzedaz.js');
const INDEX = czytaj('public/index.html');
const TERMINARZ_SRV = czytaj('routes/terminarz.js');

/** Wycina funkcję po klamrach. */
function wytnij(zrodlo, naglowek) {
    const start = zrodlo.indexOf(naglowek);
    if (start < 0) throw new Error('nie znaleziono: ' + naglowek);
    let i = zrodlo.indexOf('{', start), g = 0;
    for (; i < zrodlo.length; i++) {
        if (zrodlo[i] === '{') g++;
        else if (zrodlo[i] === '}') { g--; if (g === 0) return zrodlo.slice(start, i + 1); }
    }
    throw new Error('brak końca: ' + naglowek);
}

// ─── R1: renderFiltry dostaje listę osób, nie całą odpowiedź dnia ───────────
describe('R1 — odświeżenie po zmianie konfiguracji nie wywala renderu Dnia', () => {
    /** Uruchamia prawdziwą renderFiltry z pliku na atrapach DOM. */
    function uruchomRenderFiltry(argument) {
        const kod = wytnij(TERMINARZ_JS, 'function renderFiltry(wszyscy) {');
        const pole = { hidden: false, innerHTML: '' };
        const TRM = { widok: 'dzien', filtrPrac: new Set() };
        const fabryka = new Function('el', 'TRM', 'esc', 'avatarHtml', kod + '; return renderFiltry;');
        const renderFiltry = fabryka(() => pole, TRM, (x) => String(x), () => '<i></i>');
        renderFiltry(argument);
        return pole;
    }

    test('lista osób: chipy się rysują', () => {
        const pole = uruchomRenderFiltry(['Anna', 'Ola', 'Marta']);
        expect(pole.hidden).toBe(false);
        expect(pole.innerHTML).toContain('Anna');
        expect(pole.innerHTML).toContain('Ola');
    });

    test('BŁĄD, KTÓRY NAPRAWIAMY: cała odpowiedź trm_dzien wysadza funkcję', () => {
        const odpowiedzDnia = { status: 'success', rezerwacje: [], cfg_odcisk: 'abc' };
        expect(() => uruchomRenderFiltry(odpowiedzDnia)).toThrow();
    });

    test('miejsce wywołania podaje listę osób, a nie odpowiedź dnia', () => {
        expect(TERMINARZ_JS).toContain('if (await sprawdzOdciskCfg(d)) { if (req !== odswiezReq) return; renderFiltry(TRM.dane.pracownicy); }');
        expect(TERMINARZ_JS).not.toContain('return; renderFiltry(d); }');
    });

    test('pusta lista i brak listy chowają pasek zamiast wywalać render', () => {
        expect(uruchomRenderFiltry([]).hidden).toBe(true);
        expect(uruchomRenderFiltry(null).hidden).toBe(true);
        expect(uruchomRenderFiltry(['Anna']).hidden).toBe(true);   // jedna osoba — nie ma czego filtrować
    });
});

// ─── R2: cztery nazwy tabel niezgodne z produkcją ──────────────────────────
describe('R2 — zmiana imienia obejmuje wszystkie tabele także na produkcji', () => {
    /** Lista z kodu, wyciągnięta tak jak czyta ją serwer. */
    const lista = (() => {
        const od = SPRZEDAZ.indexOf('[\'Term_Nieobecnosci\', \'pracownik\']');
        const blok = SPRZEDAZ.slice(od, SPRZEDAZ.indexOf('];', od));
        return [...blok.matchAll(/\['?`?([A-Za-z_ĄĆĘŁŃÓŚŹŻąćęłńóśźż`]+)`?'?,\s*'([a-z_]+)'\]/g)].map(m => [m[1].replace(/`/g, ''), m[2]]);
    })();

    // Nazwy sprawdzone w information_schema produkcji 22.11.2026. Na Windows wielkość liter nie ma
    // znaczenia, na produkcji (Linux, lower_case_table_names=0) ma — i to przez nią cztery tabele
    // latami nie dostawały nowego imienia.
    const PRODUKCJA = {
        'Pracownicy_targety': 'pracownik',
        'Pracownicy_konsultacja': 'imie',
        'Zadania_Przypisani': 'przypisany',
        'Dokumenty_Dodatkowe_Klienta': 'pracownik',
    };

    test.each(Object.entries(PRODUKCJA))('tabela %s jest na liście z kolumną %s', (tabela, kolumna) => {
        const wpis = lista.find(([t]) => t === tabela);
        expect(wpis).toBeTruthy();
        expect(wpis[1]).toBe(kolumna);
    });

    test.each(['Pracownicy_Targety', 'Pracownicy_Konsultacja', 'Zadania_przypisani', 'Dokumenty_dodatkowe_klienta'])(
        'błędna pisownia %s już nie występuje', (zla) => {
            expect(lista.some(([t]) => t === zla)).toBe(false);
        });

    test('pominięcie tabeli zostawia ślad w logu zamiast ciszy', () => {
        expect(SPRZEDAZ).toMatch(/console\.warn\(`\[edit_employee\] pominięto \$\{tabela\}\.\$\{kolumna\}/);
    });
});

// ─── R6: „Zmień” odrzucał poprawkę samej spacji ────────────────────────────
describe('R6 — poprawka samej pisowni przechodzi', () => {
    /** Uruchamia sam warunek „bez zmian” tak, jak liczy go panel. */
    const bezZmian = (imie, nowe) => {
        const czyste = String(nowe).replace(/\s+/g, ' ').trim();
        return czyste === String(imie || '');   // dokładnie ten warunek co w edytujPracownika
    };

    test('usunięcie spaski na końcu NIE jest „bez zmian”', () => {
        expect(bezZmian('Anna Kowalska ', 'Anna Kowalska')).toBe(false);
    });
    test('podwójna spacja w środku też przechodzi', () => {
        expect(bezZmian('Anna  Kowalska', 'Anna Kowalska')).toBe(false);
    });
    test('ta sama nazwa nadal jest odrzucana', () => {
        expect(bezZmian('Anna Kowalska', 'Anna Kowalska')).toBe(true);
    });
    test('panel porównuje z surowym imieniem, nie przyciętym', () => {
        expect(INDEX).toContain("if (czyste === String(imie || '')) { alert('Bez zmian — wpisano to samo imię.'); return; }");
        expect(INDEX).not.toContain("if (czyste === String(imie || '').trim()) { alert('Bez zmian");
    });
});

// ─── R7: odmowa dubla wyglądała jak sukces ─────────────────────────────────
describe('R7 — odmowa serwera wygląda jak odmowa', () => {
    test('toast zależy od statusu odpowiedzi, a pole nie jest czyszczone przy odmowie', () => {
        expect(INDEX).toContain("const ok = d.status === 'success';");
        expect(INDEX).toContain("pokazPowiadomienie(ok ? 'success' : 'error', ok ? null : 'Nie udało się zapisać'");
        expect(INDEX).toContain('if (!ok) return;');
    });
    test('błąd trzyma się na ekranie dłużej niż sukces', () => {
        // pokazPowiadomienie samo daje 15 s dla typu 'error' i 4,5 s dla reszty
        expect(INDEX).toMatch(/czas = czas \|\| \(typ === 'error' \? 15000/);
    });
});

// ─── R4: „Skasuj wizytę” na trzymanym terminie ─────────────────────────────
describe('R4 — kasowanie trzymanego terminu gasi link do zadatku', () => {
    test('kasowanie idzie przez zakonczHold, zanim ruszy zwykła ścieżka', () => {
        const kod = TERMINARZ_SRV.slice(TERMINARZ_SRV.indexOf("case 'trm_usun': {"), TERMINARZ_SRV.indexOf("case 'trm_anuluj': {"));
        expect(kod).toMatch(/if \(rez\.status === 'do_wplaty'\) \{/);
        expect(kod).toMatch(/await zakonczHold\(tenant, rez, 'anulowana', imie, 'skasowano: ' \+ powod\)/);
        expect(kod).toMatch(/Link do zadatku przestał działać/);
        // gałąź holdu musi być PRZED zwykłą transakcją, inaczej link zostałby aktywny
        expect(kod.indexOf("rez.status === 'do_wplaty'")).toBeLessThan(kod.indexOf('const zwolnione = await wTransakcjiSalonu'));
    });
    test('wizyta zostaje oznaczona jako usunięta, nie tylko odwołana', () => {
        const kod = TERMINARZ_SRV.slice(TERMINARZ_SRV.indexOf("case 'trm_usun': {"), TERMINARZ_SRV.indexOf("case 'trm_anuluj': {"));
        expect(kod).toMatch(/UPDATE Term_Rezerwacje SET usunieta = 1, usunieta_kiedy = NOW\(\)/);
        expect(kod).toMatch(/historia\(conn, tenant, rez\.id, imie, 'usunieto'/);
    });
    test('powód nadal jest wymagany, bo sprawdzany wcześniej', () => {
        const kod = TERMINARZ_SRV.slice(TERMINARZ_SRV.indexOf("case 'trm_usun': {"), TERMINARZ_SRV.indexOf("case 'trm_anuluj': {"));
        expect(kod.indexOf('Napisz krótko, dlaczego kasujesz')).toBeLessThan(kod.indexOf("rez.status === 'do_wplaty'"));
    });
});
