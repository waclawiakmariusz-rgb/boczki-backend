// tests/terminarz-paczka-h.test.js
// Terminarz, paczka H — szkic wizyty (docs/terminarz-audyt/PLAN_POPRAWY_2026-11-16.md).
// Mechanizm powstał w paczce D i jest na produkcji, ale nie działał w jedynym momencie,
// do którego go zrobiono: przy wygaśnięciu sesji. R5, R12a, R12b, R12c, R17.
const fs = require('fs');
const path = require('path');

const FRONT = fs.readFileSync(path.join(__dirname, '..', 'public', 'terminarz.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

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

// ─── R5: szkic przeżywa pełne wylogowanie ──────────────────────────────────
describe('R5 — niedokończona wizyta przeżywa wygaśnięcie sesji', () => {
    /** Uruchamia prawdziwe wylogujGlowne na atrapie pamięci przeglądarki. */
    function uruchomWylogowanie(zawartoscSesji) {
        const kod = wytnij(INDEX, 'function wylogujGlowne() {');
        const magazyn = (poczatek) => {
            const m = { ...poczatek };
            return {
                getItem: (k) => (k in m ? m[k] : null),
                setItem: (k, v) => { m[k] = String(v); },
                removeItem: (k) => { delete m[k]; },
                clear: () => { Object.keys(m).forEach(k => delete m[k]); },
                _stan: () => m,
            };
        };
        const sessionStorage = magazyn(zawartoscSesji);
        const localStorage = magazyn({ boczki_tenant_id: 'x', boczki_session_token: 'y' });
        const location = { reload: jest.fn() };
        new Function('sessionStorage', 'localStorage', 'location', kod + '; wylogujGlowne();')(sessionStorage, localStorage, location);
        return { sesja: sessionStorage._stan(), lokalna: localStorage._stan(), location };
    }

    test('szkic wizyty zostaje, reszta sesji znika', () => {
        const w = uruchomWylogowanie({ trm_szkic_wizyty: '{"kiedy":1,"nowa":{}}', cos_innego: 'do skasowania' });
        expect(w.sesja.trm_szkic_wizyty).toBe('{"kiedy":1,"nowa":{}}');
        expect(w.sesja.cos_innego).toBeUndefined();
    });

    test('pamięć przeglądarki czyszczona do końca, strona przeładowana', () => {
        const w = uruchomWylogowanie({ trm_szkic_wizyty: 'x' });
        expect(Object.keys(w.lokalna)).toHaveLength(0);
        expect(w.location.reload).toHaveBeenCalled();
    });

    test('brak szkicu niczego nie psuje', () => {
        const w = uruchomWylogowanie({ cos: '1' });
        expect(w.sesja.trm_szkic_wizyty).toBeUndefined();
        expect(Object.keys(w.sesja)).toHaveLength(0);
    });
});

// ─── R12a i R12c: przywrócenie i kasowanie szkicu ──────────────────────────
describe('R12a — przywrócony formularz jest naprawdę podłączony', () => {
    test('ustawia panel, synchronizuje datę, dociąga sloty i odświeża siatkę', () => {
        const kod = wytnij(FRONT, 'TRM.szkicPrzywroc = () => {');
        expect(kod).toContain("TRM.panel = 'nowa';");
        expect(kod).toMatch(/const poleData = el\('trm-data'\); if \(poleData\) poleData\.value = TRM\.data;/);
        expect(kod).toMatch(/if \(nowaNaTerminie\(TRM\.nowa\)\) nowaLadujSloty\(\);/);
        expect(kod.lastIndexOf("odswiez({ cicho: true })")).toBeGreaterThan(kod.indexOf("renderNowa()"));
    });
    test('R12c: pasek znika także wtedy, gdy szkicu już nie ma', () => {
        const kod = wytnij(FRONT, 'TRM.szkicPrzywroc = () => {');
        const usunPaska = kod.indexOf("el('trm-pasek-szkic')");
        const wyjscieBezSzkicu = kod.indexOf('if (!s) return odswiez');
        expect(usunPaska).toBeGreaterThan(-1);
        expect(usunPaska).toBeLessThan(wyjscieBezSzkicu);   // najpierw sprzątamy pasek, potem wychodzimy
    });
});

describe('R12c — szkic kasuje tylko zamknięcie formularza', () => {
    test('zamknięcie innego panelu zostawia szkic', () => {
        expect(FRONT).toContain("TRM.panelZamknij = () => { if (TRM.panel === 'nowa') czyscSzkic();");
        expect(FRONT).not.toContain('TRM.panelZamknij = () => { czyscSzkic();');
    });
});

// ─── R12b: szkic zapisuje się przy każdej realnej zmianie ──────────────────
describe('R12b — kreator zapisuje szkic, nie tylko krok trzeci', () => {
    test.each([
        ['wybór klientki', 'TRM.nowaKlient = (i) =>'],
        ['dodanie zabiegu', 'TRM.nowaDodajPoz = (id) =>'],
    ])('%s zapisuje szkic', (_nazwa, naglowek) => {
        const kod = wytnij(FRONT, naglowek);
        expect(kod).toMatch(/zapiszSzkic\(\);/);
    });

    test('notatka i kanał wołają zapis z formularza', () => {
        expect(FRONT).toContain('TRM.nowa.notatka=this.value; TRM.szkicZapisz();');
        expect(FRONT).toContain('TRM.nowa.kanal=this.value; TRM.szkicZapisz();');
        expect(FRONT).toContain('TRM.szkicZapisz = () => zapiszSzkic();');
    });
});

// ─── R17: resize i ponowne wejście w sekcję ────────────────────────────────
describe('R17 — przeciąganie okna i powrót do sekcji', () => {
    test('resize ma opóźnienie, więc nie wywołuje dziesiątek odświeżeń', () => {
        expect(FRONT).toMatch(/let resizeT = null;/);
        expect(FRONT).toMatch(/clearTimeout\(resizeT\);/);
        expect(FRONT).toMatch(/\}, 300\);/);
    });

    test('szkielet nie przebudowuje widoku przy otwartym formularzu', () => {
        const kod = wytnij(FRONT, 'function szkielet() {');
        expect(kod).toContain("if (TRM.panel === 'nowa' && root && root.querySelector('#trm-main')) { zapiszSzkic(); return; }");
    });

    test('URUCHOMIENIE: szkielet z otwartym formularzem nie dotyka innerHTML', () => {
        const kod = wytnij(FRONT, 'function szkielet() {');
        let dotknieto = false;
        const root = {
            querySelector: () => ({}),
            set innerHTML(v) { dotknieto = true; },
            get innerHTML() { return ''; },
        };
        const TRM = { panel: 'nowa', widok: 'dzien', data: '2026-11-23' };
        const f = new Function('el', 'TRM', 'zapiszSzkic', 'specjalista', kod + '; return szkielet;')(
            () => root, TRM, () => {}, () => false);
        f();
        expect(dotknieto).toBe(false);
    });

    // Drugiego kierunku nie da sie sensownie uruchomic: dalsza czesc szkieletu wola kilkanascie
    // pomocnikow widoku. Straznik sprawdzamy wyzej, uruchamiajac go naprawde.
});
