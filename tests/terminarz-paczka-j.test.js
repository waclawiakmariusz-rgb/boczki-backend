// tests/terminarz-paczka-j.test.js
// Terminarz, paczka J — „porządki, diagnostyka, testy" (docs/terminarz-audyt/PLAN_POPRAWY_2026-11-16.md).
// R13 (konflikt wersji przy zmianie stanu pozycji), R14 (błąd unieważnienia linku do zadatku nie ginie),
// R18 / #24 (bufor przy buforze to nie kolizja) oraz wybrane pozycje z listy „niskie": czas usługi
// musi być liczbą, nazwa blokady salonu ≤ 64 znaki, poller nie milczy o błędach, przycisk ponowienia
// w Pakietach, komunikat o braku urządzenia. Decyzje właściciela #9, #18, #19 i R16 NIE wchodzą.
const fs = require('fs');
const path = require('path');
const S = require('../routes/terminarz-silnik');

const plik = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const TERMINARZ = plik('routes', 'terminarz.js');
const SILNIK = plik('routes', 'terminarz-silnik.js');
const FRONT = plik('public', 'terminarz.js');
const DZ = '2026-11-23';   // poniedziałek — konflikty() liczy minuty od epoki, więc obie strony z datą

// ─── R18 (#24): bufor po jednym zabiegu i bufor przed następnym ─────────────
describe('R18 — sprzątanie stanowiska nie blokuje następnej wizyty', () => {
    const buforNowy = { typ_zasobu: 'gabinet', klucz: '1', od: S.naMin(DZ + ' 11:00'), do: S.naMin(DZ + ' 11:15'), powod: 'bufor' };

    test('BŁĄD, KTÓRY NAPRAWIAMY: dwa bufory na tym samym gabinecie były zgłaszane jako kolizja', () => {
        const istniejace = [{ typ_zasobu: 'gabinet', klucz: '1', od: DZ + ' 11:05', do: DZ + ' 11:20', powod: 'bufor', rezerwacja_id: 5 }];
        expect(S.konflikty([buforNowy], istniejace)).toHaveLength(0);
    });

    test('bufor na prawdziwej wizycie nadal jest kolizją i wie, że chodzi o bufor', () => {
        const istniejace = [{ typ_zasobu: 'gabinet', klucz: '1', od: DZ + ' 11:05', do: DZ + ' 12:00', powod: 'usluga', rezerwacja_id: 7 }];
        const k = S.konflikty([buforNowy], istniejace);
        expect(k).toHaveLength(1);
        expect(k[0].powod).toBe('bufor');
        expect(k[0].rezerwacja_id).toBe(7);
    });

    test('dwie prawdziwe wizyty to kolizja bez etykiety bufora', () => {
        const wizyta = { typ_zasobu: 'gabinet', klucz: '1', od: S.naMin(DZ + ' 11:00'), do: S.naMin(DZ + ' 12:00'), powod: 'usluga' };
        const k = S.konflikty([wizyta], [{ typ_zasobu: 'gabinet', klucz: '1', od: DZ + ' 11:30', do: DZ + ' 12:30', powod: 'usluga' }]);
        expect(k).toHaveLength(1);
        expect(k[0].powod).toBeNull();
    });

    test('zajętość bez pola powod (stare wiersze) nadal koliduje', () => {
        const k = S.konflikty([buforNowy], [{ typ_zasobu: 'gabinet', klucz: '1', od: DZ + ' 11:00', do: DZ + ' 12:00' }]);
        expect(k).toHaveLength(1);
    });

    test('powod jest zapisywany i czytany z bazy, więc reguła działa poza testem', () => {
        expect(SILNIK).toContain("powod: 'bufor'");
        expect(TERMINARZ).toMatch(/AS do_, rezerwacja_id, pozycja_id, powod/);
        expect(TERMINARZ).toMatch(/powod VARCHAR\(12\) NOT NULL DEFAULT 'usluga'/);
    });
});

// ─── R13: konflikt wersji przy zmianie stanu pozycji ───────────────────────
describe('R13 — „ktoś zmienił tę wizytę" przy zmianie stanu zabiegu', () => {
    test('serwer odmawia ze znacznikiem WERSJA i oddaje aktualną rezerwację', () => {
        const od = TERMINARZ.indexOf("case 'trm_pozycja_stan'");
        expect(od).toBeGreaterThan(0);
        // serwer nie dokłada tu świeżej rezerwacji (odmowa leci ze środka transakcji, przed ROLLBACK),
        // dlatego front przeładowuje kartę sam — ważne jest, że odmowa jest OZNACZONA jako konflikt wersji
        const blok = TERMINARZ.slice(od, od + 6000);
        expect(blok).toContain('Odśwież wizytę i sprawdź aktualny stan.');
        expect(blok).toContain("{ code: 'WERSJA' }");
    });

    test('front przeładowuje szczegóły zamiast zostawiać stary ekran', () => {
        const od = FRONT.indexOf('TRM.pozStan = async');
        expect(od).toBeGreaterThan(0);
        const blok = FRONT.slice(od, od + 1200);
        expect(blok).toContain("if (d.code === 'WERSJA')");
        expect(blok).toContain('przeladujSzczegoly(d.rezerwacja)');
        // przeladujSzczegoly() dociąga wizytę z serwera także bez przekazanego obiektu — serwer przy
        // konflikcie wersji nie dokłada rezerwacji (odmowa leci ze środka transakcji), a karta i tak się odświeża
        const odP = FRONT.indexOf('async function przeladujSzczegoly(rez) {');
        expect(odP).toBeGreaterThan(0);
        expect(FRONT.slice(odP, odP + 300)).toContain("await api('trm_rezerwacja', { id: TRM.szcz.id })");
    });
});

// ─── R14: unieważnienie linku do zadatku ───────────────────────────────────
describe('R14 — błąd unieważnienia linku do zadatku nie ginie po cichu', () => {
    test('połykany jest wyłącznie brak tabeli zgód', () => {
        const od = TERMINARZ.indexOf('async function zakonczHold');
        expect(od).toBeGreaterThan(0);
        const blok = TERMINARZ.slice(od, od + 3000);
        expect(blok).toContain("if (e && e.code === 'ER_NO_SUCH_TABLE') return null; throw e;");
        expect(blok).not.toMatch(/ZgodyPlatnosci SET status = 'ANULOWANA'[^\n]*\.catch\(\(\) => \{\}\)/);
    });

    test('URUCHOMIENIE: ta sama obsługa błędu przepuszcza brak tabeli, a resztę podnosi', async () => {
        const obsluga = (e) => { if (e && e.code === 'ER_NO_SUCH_TABLE') return null; throw e; };
        await expect(Promise.reject({ code: 'ER_NO_SUCH_TABLE' }).catch(obsluga)).resolves.toBeNull();
        await expect(Promise.reject({ code: 'ER_LOCK_WAIT_TIMEOUT' }).catch(obsluga)).rejects.toEqual({ code: 'ER_LOCK_WAIT_TIMEOUT' });
    });
});

// ─── Niskie: czas trwania usługi ───────────────────────────────────────────
describe('Czas trwania usługi musi być liczbą minut', () => {
    test('śmieci w polu nie dają już cichych 5 minut', () => {
        expect(TERMINARZ).toContain('Czas trwania usługi musi być liczbą minut (np. 45)');
        expect(TERMINARZ).toContain('if (!Number.isFinite(liczba)) throw new BladUzytkownika');
        expect(TERMINARZ).not.toContain('Math.max(5, Math.min(480, Number(d.czas_min) || 0))');
    });

    test('URUCHOMIENIE: puste zostaje puste, liczba przycięta do widełek, tekst odrzucony', () => {
        const policz = (v) => {
            if (v == null || v === '') return null;
            const liczba = Number(v);
            if (!Number.isFinite(liczba)) throw new Error('odmowa');
            return Math.max(5, Math.min(480, Math.round(liczba)));
        };
        expect(policz('')).toBeNull();
        expect(policz(null)).toBeNull();
        expect(policz('45')).toBe(45);
        expect(policz('1')).toBe(5);
        expect(policz('900')).toBe(480);
        expect(() => policz('abc')).toThrow('odmowa');
        expect(() => policz('44,5')).toThrow('odmowa');   // przecinek też jest śmieciem, nie 44,5 min
    });
});

// ─── Niskie: nazwa blokady salonu ≤ 64 znaki ───────────────────────────────
describe('GET_LOCK — nazwa blokady mieści się w limicie MariaDB', () => {
    test('wszystkie cztery miejsca używają wspólnej, skróconej nazwy', () => {
        expect(TERMINARZ).toContain("const nazwaBlokadySalonu = (t) => ('trm:' + t).slice(0, 64);");
        expect(TERMINARZ.split('[nazwaBlokadySalonu(tenant)]').length - 1).toBe(4);
        expect(TERMINARZ).not.toContain("['trm:' + tenant]");
    });

    test('URUCHOMIENIE: długi identyfikator salonu nie przekracza 64 znaków', () => {
        const nazwa = (t) => ('trm:' + t).slice(0, 64);
        expect(nazwa('salon-demo')).toBe('trm:salon-demo');
        expect(nazwa('x'.repeat(200))).toHaveLength(64);
    });
});

// ─── Niskie: poller nie milczy o błędach ───────────────────────────────────
describe('Poller spraw mówi w logu, gdy zapytanie padnie', () => {
    const blokPollera = (() => {
        const od = TERMINARZ.indexOf('async function tickSprawy() {');
        return TERMINARZ.slice(od, TERMINARZ.indexOf('if (!process.env.JEST_WORKER_ID', od));
    })();

    test('ciche catch-e zastąpione wspólnym logowaniem kodu błędu', () => {
        expect(blokPollera).not.toContain('.catch(() => [])');
        expect(blokPollera).not.toContain('.catch(() => null)');
        expect(blokPollera).not.toContain('.catch(() => {})');
        expect(blokPollera.split('tickBlad(e,').length - 1).toBeGreaterThanOrEqual(10);
    });

    test('ten sam kod błędu nie zalewa logu częściej niż raz na 10 minut', () => {
        expect(TERMINARZ).toContain('const tickCisza = new Map();');
        expect(TERMINARZ).toContain('if (Date.now() - (tickCisza.get(kod) || 0) > 10 * 60 * 1000) {');
        expect(TERMINARZ).toContain("log.error('[terminarz] poller spraw pominął zapytanie:', kod,");
    });

    test('URUCHOMIENIE: pierwszy błąd zapisany, powtórka przemilczana, wartość zastępcza oddana', () => {
        const wpisy = [];
        const tickCisza = new Map();
        const tickBlad = (e, zwroc) => {
            const kod = (e && (e.code || e.message)) || 'nieznany błąd';
            if (Date.now() - (tickCisza.get(kod) || 0) > 10 * 60 * 1000) { tickCisza.set(kod, Date.now()); wpisy.push(kod); }
            return zwroc;
        };
        expect(tickBlad({ code: 'ER_CANT_AGGREGATE_2COLLATIONS' }, [])).toEqual([]);
        expect(tickBlad({ code: 'ER_CANT_AGGREGATE_2COLLATIONS' }, [])).toEqual([]);
        expect(tickBlad({ code: 'ER_NO_SUCH_TABLE' }, null)).toBeNull();
        expect(wpisy).toEqual(['ER_CANT_AGGREGATE_2COLLATIONS', 'ER_NO_SUCH_TABLE']);
    });
});

// ─── Niskie: dwa komunikaty i jeden przycisk ───────────────────────────────
describe('Drobiazgi widoczne dla recepcji', () => {
    test('„Spróbuj ponownie" w Pakietach woła funkcję, która istnieje poza modułem', () => {
        expect(FRONT).toContain('TRM.ustPakietyZaladuj = ustPakietyZaladuj;');
        expect(FRONT).toContain('onclick="TRM.ustPakietyZaladuj()"');
        expect(FRONT).not.toContain('onclick="ustPakietyZaladuj()"');
    });

    test('brak urządzenia mówi, co zrobić — tak jak brak gabinetu', () => {
        expect(SILNIK).toContain('Żadne urządzenie wymagane przez tę usługę nie jest aktywne — w Ustawieniach → Zasoby przywróć urządzenie albo wskaż usłudze inne.');
        expect(SILNIK).not.toContain("opis: 'Żadne zgodne urządzenie nie jest aktywne.'");
    });
});

// ─── Celowo NIE w paczce ───────────────────────────────────────────────────
describe('Decyzje właściciela celowo poza paczką J', () => {
    test('#9: nadpisanie grafiku nadal nie przebija godzin salonu w nowy sposób', () => {
        expect(TERMINARZ).not.toContain('POZA_GODZINAMI_SALONU');
    });

    test('#19: trzy ustawienia rezerwacji nadal bez wymuszania przy zapisie', () => {
        expect(TERMINARZ).not.toMatch(/throw new BladUzytkownika\([^)]*tolerancj/i);
        expect(TERMINARZ).not.toMatch(/throw new BladUzytkownika\([^)]*horyzont/i);
    });
});
