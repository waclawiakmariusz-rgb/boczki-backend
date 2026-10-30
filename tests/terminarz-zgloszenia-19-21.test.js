// Zgłoszenia Oli z 29.10.2026:
//  #19 — z historii klientki nie było jak wrócić do kalendarza,
//  #21 — nie dało się zmienić czasu trwania już umówionej wizyty.
// Strażnik pilnuje jednego i drugiego oraz tego, czego ta zmiana NIE miała ruszyć.
const fs = require('fs');
const path = require('path');
const KAT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(KAT, 'public', 'terminarz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(KAT, 'public', 'terminarz.css'), 'utf8');
const SRV = fs.readFileSync(path.join(KAT, 'routes', 'terminarz.js'), 'utf8');
const wytnij = (zrodlo, od, doTxt) => { const a = zrodlo.indexOf(od); expect(a).toBeGreaterThan(-1); return zrodlo.slice(a, zrodlo.indexOf(doTxt, a + od.length)); };

describe('#19 — powrót z Historii do kalendarza', () => {
    test('wejście w Historię zapamiętuje poprzedni widok, tak samo jak wejście w Ustawienia', () => {
        expect(JS).toMatch(/if \(\(w === 'ustawienia' \|\| w === 'historia'\) && TRM\.widok !== w\) TRM\.widokPoprzedni = TRM\.widok;/);
    });
    test('powrót nie wraca do Historii ani Ustawień — w razie czego ląduje w widoku Dzień', () => {
        const f = wytnij(JS, 'TRM.wrocDoKalendarza = () => {', '};');
        expect(f).toContain("p !== 'ustawienia'");
        expect(f).toContain("p !== 'historia'");
        expect(f).toContain("'dzien'");
    });
    test('pasek Historii ma przycisk powrotu i własny styl', () => {
        const pasek = wytnij(JS, '<div class="trm-hist-pasek">', '</div>`;');
        expect(pasek).toContain('onclick="TRM.wrocDoKalendarza()"');
        expect(pasek).toContain('‹ Wróć do kalendarza');
        expect(pasek).toContain('trm-hist-wroc');
        expect(CSS).toContain('.trm-hist-wroc');
    });
    test('przycisk w Ustawieniach został nietknięty — to ta sama funkcja, nie kopia', () => {
        expect((JS.match(/TRM\.wrocDoKalendarza\(\)/g) || []).length).toBe(2);   // Ustawienia + Historia
        expect((JS.match(/TRM\.wrocDoKalendarza = /g) || []).length).toBe(1);
    });
});

describe('#21 — czas trwania umówionej wizyty', () => {
    test('panel zmiany ma pole z minutami przy każdej pozycji, obok wykonawcy', () => {
        const form = wytnij(JS, 'function formZmiany() {', '\n  }');
        expect(form).toContain('class="trm-z-czas"');
        expect(form).toContain('min="5"');
        expect(form).toContain('max="480"');
        expect(form).toContain("onchange=\"TRM.zmCzas('${p.id}', this.value)\"");
        expect(form).toContain('Nowa data');            // to, co było, zostaje
        expect(form).toContain('Dowolna właściwa osoba');
    });
    test('ekran odrzuca wartość spoza zakresu i unieważnia poprzedni wynik sprawdzenia', () => {
        const f = wytnij(JS, 'TRM.zmCzas = (id, v) => {', '\n  };');
        expect(f).toMatch(/n < 5 \|\| n > 480/);
        expect(f).toContain('delete TRM.zm.czasy[id]');
        expect(f).toContain('TRM.zm.wynik = null');
    });
    test('oba wejścia w tryb zmiany zakładają pustą mapę czasów', () => {
        expect((JS.match(/czasy: \{\}|czasy:\{\}/g) || []).length).toBeGreaterThanOrEqual(2);
    });
    test('żądanie niesie czasy_pozycji obok wykonawców', () => {
        expect(JS).toContain("pracownicy_pozycji: z.prac, czasy_pozycji: z.czasy || {}");
    });
    test('serwer: brak wpisu = czas zostaje bez zmian, wartość spoza 5–480 odrzucona jawnie', () => {
        const f = wytnij(SRV, 'const czasPozycji = (poz) => {', '};');
        expect(f).toContain('return poz.czas_min;');                    // brak wpisu → stary czas
        expect(f).toMatch(/n < 5 \|\| n > 480/);
        expect(f).toContain('BladUzytkownika');
        expect(f).not.toMatch(/u\.czas_min/);                           // bez cichego powrotu do cennika
        expect(SRV).toContain('czas_min: czasPozycji(p)');
        // bez tego kolumna czas_min zostawała stara, choć start i koniec mówiły już co innego (złapane próbą 30.10)
        expect(SRV).toContain('UPDATE Term_Pozycje SET pracownik = ?, start = ?, koniec = ?, czas_min = ?');
    });
    test('zmiana czasu zostawia ślad w historii wizyty i w dzienniku zdarzeń', () => {
        expect(SRV).toContain('const opisCzasow = aktywne.map((sp, i) => (Number(sp.czas_min) !== Number(w2.pozycje[i].czas_min)');
        expect(SRV).toMatch(/historia\(conn, tenant, rez\.id, imie, 'przelozono'[\s\S]{0,200}opisCzasow/);
        expect(SRV).toContain('rez.start === w2.start && opisCzasow ? `czas trwania —');
        // gdy termin został ten sam, wpis nie może brzmieć „09:00 → 09:00”
        expect(SRV).toContain("rez.start === w2.start && opisCzasow ? 'czas trwania'");
    });
});

describe('czego te zmiany nie ruszyły', () => {
    test('kontrola wersji, blokada salonu i ponowne sprawdzenie kompletu zostają', () => {
        const h = wytnij(SRV, "case 'trm_zmien': {", "case 'trm_usun'");
        expect(h).toContain("code: 'WERSJA'");
        expect(h).toContain('GET_LOCK');
        expect(h).toMatch(/S\.sprawdzKomplet\(\{ \.\.\.k2, start, pozycje: poz, pominRezerwacje: rez\.id(, [^}]*)? \}\)/);   // #20 dopisało mimoGrafiku
        expect(h).toContain('ROLE_OPERACYJNE');
    });
    test('wizyty wykonanej ani rozliczonej nadal nie da się przestawić', () => {
        const h = wytnij(SRV, "case 'trm_zmien': {", "case 'trm_usun'");
        expect(h).toMatch(/\['wykonana', 'w_trakcie', 'przerwana'\]\.includes\(p\.stan\)/);
        expect(h).toMatch(/anulowana.*odtworzenie to nowa rezerwacja/);
    });
    test('zakres minut jest ten sam co w kreatorze nowej wizyty', () => {
        expect(JS).toMatch(/<input type="number" min="5" max="480" step="5" value="\$\{p\.czas_min\}"/);  // kreator
        expect(SRV).toContain('function ROLE_OPERACYJNE_CZAS(p) { const c = Number(p.czas_min); return c >= 5 && c <= 480; }');
    });
});
