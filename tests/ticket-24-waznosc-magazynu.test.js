// Ticket #24 (Ola, Manager, 4.11.2026) i #13 (Gosia, 24.10.2026) — Kosmetyki → Stan Magazynowy.
// Data ważności produktu ma opisywać TOWAR leżący w gabinecie, a nie wyprzedaną dostawę.
// Przypadek ze zgłoszenia: APIS Dermasoft, 11 szt. z 4 dostaw, dwie pierwsze wyprzedane — lista
// pokazywała „po terminie” (3.02.2026 z pustej partii) zamiast realnej najbliższej ważności 29.05.2027.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').split('\r\n').join('\n');

// funkcje liczące stoją obok siebie — wycinamy je i URUCHAMIAMY, żeby sprawdzać zachowanie, nie tekst
const KOD = INDEX.slice(INDEX.indexOf('function partieNaStanie('), INDEX.indexOf('function renderChipsyStatusMagazyn('));
const API = new Function(KOD + '\nreturn { partieNaStanie, waznoscGrupyMagazyn, dniDoWaznosciGrupy, statusGrupyMagazyn };')();

const dzien = 86400000;
const zaDni = (n) => new Date(Date.now() + n * dzien).toISOString().slice(0, 10);
const grupa = (partie) => ({
    partie,
    iloscCalkowita: partie.reduce((s, p) => s + Number(p.ilosc), 0),
    ...(() => { const w = API.waznoscGrupyMagazyn(partie); return { najblizszaWaznoscTs: w.ts, najblizszaWaznoscStr: w.str }; })(),
});

// dokładnie te cztery dostawy widać na zrzutach z ticketu
const APIS = [
    { ilosc: 0, waznosc: '2026-02-03' },   // starsza dostawa, wyprzedana — to ona psuła nagłówek
    { ilosc: 0, waznosc: '2027-05-29' },   // też wyprzedana
    { ilosc: 1, waznosc: '2027-05-29' },
    { ilosc: 10, waznosc: '2028-01-20' },
];

describe('data ważności produktu liczona tylko z dostaw, które mają towar', () => {
    test('APIS Dermasoft z ticketu: nagłówek bierze 29.05.2027, nie 03.02.2026 z pustej dostawy', () => {
        const w = API.waznoscGrupyMagazyn(APIS);
        expect(w.str).toBe('2027-05-29');
        expect(new Date(w.ts).toISOString().slice(0, 10)).toBe('2027-05-29');
    });

    test('kolejność dostaw w tablicy nie ma znaczenia', () => {
        const w = API.waznoscGrupyMagazyn(APIS.slice().reverse());
        expect(w.str).toBe('2027-05-29');
    });

    test('produkt wyprzedany w całości nie ma daty (kolumna pokaże „brak na stanie”)', () => {
        const w = API.waznoscGrupyMagazyn([{ ilosc: 0, waznosc: '2025-01-01' }, { ilosc: 0, waznosc: '2030-01-01' }]);
        expect(w.str).toBe('');
        expect(w.ts).toBe(Infinity);
        expect(API.dniDoWaznosciGrupy(grupa([{ ilosc: 0, waznosc: '2025-01-01' }]))).toBeNull();
    });

    test('dostawa z towarem, ale bez wpisanej daty, nie udaje daty zerowej', () => {
        const w = API.waznoscGrupyMagazyn([{ ilosc: 5, waznosc: null }, { ilosc: 2, waznosc: '2027-03-01' }]);
        expect(w.str).toBe('2027-03-01');
        expect(API.waznoscGrupyMagazyn([{ ilosc: 5, waznosc: null }]).str).toBe('');
    });

    test('ilości tekstowe i ułamkowe liczone jak liczby', () => {
        expect(API.partieNaStanie([{ ilosc: '0.00' }, { ilosc: '1.50' }, { ilosc: 0 }])).toHaveLength(1);
    });

    test('partie ze stanem 0 NIE są usuwane z listy — tylko pomijane przy liczeniu daty (ticket #4, Ania)', () => {
        expect(API.partieNaStanie(APIS)).toHaveLength(2);
        expect(APIS).toHaveLength(4); // wejście nietknięte, akordeon nadal pokaże wszystkie cztery
    });
});

describe('status produktu i chipy', () => {
    test('towar po terminie dostaje nowy status „poterminie”, ważniejszy niż niski stan', () => {
        expect(API.statusGrupyMagazyn(grupa([{ ilosc: 5, waznosc: zaDni(-3) }]))).toBe('poterminie');
        expect(API.statusGrupyMagazyn(grupa([{ ilosc: 1, waznosc: zaDni(-3) }]))).toBe('poterminie'); // mimo stanu 1
    });

    test('APIS z ticketu przestaje być alarmem i trafia do „ok”', () => {
        expect(API.statusGrupyMagazyn(grupa(APIS))).toBe('ok');
    });

    test('przeterminowana wyprzedana dostawa nie robi już alarmu z produktu, który ma świeży towar', () => {
        const g = grupa([{ ilosc: 0, waznosc: zaDni(-200) }, { ilosc: 9, waznosc: zaDni(400) }]);
        expect(g.najblizszaWaznoscStr).toBe(zaDni(400));
        expect(API.statusGrupyMagazyn(g)).toBe('ok');
    });

    test('pozostałe progi bez zmian: ≤ 2 szt. to „mniej”, ≤ 90 dni to „krotko”, reszta „ok”', () => {
        expect(API.statusGrupyMagazyn(grupa([{ ilosc: 2, waznosc: zaDni(500) }]))).toBe('mniej');
        expect(API.statusGrupyMagazyn(grupa([{ ilosc: 6, waznosc: zaDni(30) }]))).toBe('krotko');
        expect(API.statusGrupyMagazyn(grupa([{ ilosc: 6, waznosc: zaDni(200) }]))).toBe('ok');
    });

    test('produkt bez towaru idzie do „mniej”, a nie do „po terminie” (nie ma czego zdejmować z półki)', () => {
        expect(API.statusGrupyMagazyn(grupa([{ ilosc: 0, waznosc: zaDni(-300) }]))).toBe('mniej');
    });

    test('produkt z towarem i bez żadnej daty nie wpada w alarm terminowy', () => {
        expect(API.statusGrupyMagazyn(grupa([{ ilosc: 8, waznosc: null }]))).toBe('ok');
    });

    test('chip „Po terminie” istnieje i jest domyślnie włączony', () => {
        expect(INDEX).toContain("{ id: 'poterminie', label: 'Po terminie', color: '#991b1b' },");
        expect(INDEX).toContain("let aktywneStatusyMagazyn = new Set(['poterminie','mniej','krotko','ok']);");
    });
});

describe('widok: co czyta wyliczoną datę', () => {
    const R = INDEX.slice(INDEX.indexOf('function renderMagazyn('), INDEX.indexOf('function toggleMagazynAkordeon('));

    test('pętla grupująca nie wyznacza już daty z dowolnej partii', () => {
        expect(R).not.toContain('let pdDate = p.waznosc ? new Date(p.waznosc).getTime() : Infinity;');
        expect(R).toContain('const w = waznoscGrupyMagazyn(g.partie);');
    });

    test('zniknął fallback podstawiający pierwszą partię, gdy grupa nie ma daty', () => {
        expect(R).not.toContain('if (!g.najblizszaWaznoscStr && g.partie.length > 0) g.najblizszaWaznoscStr = g.partie[0].waznosc;');
    });

    test('kolumna pokazuje „brak na stanie” zamiast daty wyprzedanego towaru', () => {
        expect(R).toContain("${!maStan ? 'brak na stanie' : (g.najblizszaWaznoscStr ? new Date(g.najblizszaWaznoscStr).toLocaleDateString() : 'bez daty')}");
        expect(INDEX).toContain('.status-none { background: #f1f5f9; color: #64748b; }');
    });

    test('„sprzedawana pierwsza” wskazuje najstarszą dostawę z towarem, puste są opisane', () => {
        expect(R).toContain('let idxPierwszejZTowarem = partieSort.findIndex(p => Number(p.ilosc) > 0);');
        expect(R).toContain('pIdx === idxPierwszejZTowarem');
        expect(R).toContain('(wyprzedana)');
        expect(R).not.toContain('>Starsza dostawa</strong>');
    });

    test('podtytuł mówi, ile dostaw naprawdę leży na półce', () => {
        expect(R).toContain("' dostawy (' + datySortowane.length + ' na stanie) — ważność: '");
        expect(R).toContain("' dostawy — wszystkie wyprzedane'");
        expect(R).toContain('let naStanieZData = partieNaStanie(g.partie).filter(p => p.waznosc);');
    });

    test('produkty bez towaru lądują na końcu sortowania po ważności, nie na początku', () => {
        expect(R).toContain('const BRAK_DATY = Number.MAX_SAFE_INTEGER;');
        expect(R).toContain('if (dA === BRAK_DATY) return 1;');
        expect(R).not.toContain('let dA = a.najblizszaWaznoscTs === Infinity ? 0 : a.najblizszaWaznoscTs;');
    });

    test('grupowanie nadal nie odrzuca partii ze stanem 0 (produkt zerowy musi być widoczny do zamówienia)', () => {
        expect(R).not.toMatch(/if \(Number\(p\.ilosc\) (<=|===) 0\) return;/);
        expect(R).toContain('zgrupowane[klucz].partie.push(p);');
    });
});

// Znalezione próbą ekranową 11.11.2026 przy okazji ticketu #24: kliknięcie dowolnego chipa czyściło całą
// listę, bo przełącznik renderował z lokalnej tablicy `daneCache`, która jest pusta od deklaracji —
// dane magazynu żyją w `window.daneCache`. Bez tej naprawy nowy chip „Po terminie” byłby martwy.
describe('chipy statusu renderują z danych, nie z pustej tablicy', () => {
    const T = INDEX.slice(INDEX.indexOf('function toggleStatusMagazyn('), INDEX.indexOf('// --- NOWE FUNKCJE DO OBSŁUGI POPUPA'));

    test('przełącznik chipa czyta window.daneCache z zapasem lokalnej zmiennej', () => {
        expect(T).toContain('renderMagazyn(window.daneCache || daneCache);');
        expect(T).not.toMatch(/renderMagazyn\(daneCache\)/);
    });

    test('lokalna zmienna daneCache nadal nigdzie nie jest wypełniana — fallback musi zostać', () => {
        expect(INDEX).toContain('let daneCache=[]');
        expect(INDEX).toMatch(/window\.daneCache = arr;/);
        expect(INDEX).not.toMatch(/[^.\w]daneCache\s*=\s*arr\s*;/);
    });
});
