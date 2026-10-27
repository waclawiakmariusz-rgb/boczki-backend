// Ticket #14 (Gosia, 24.10.2026): „Administracja → Sugestie: można tylko wpisać zabieg, nie działa funkcja wybierz”.
// Przyczyna: lista zabiegów wypełniała się tylko, gdy słownik cennika NIE był jeszcze w pamięci (a prawie zawsze był).
// Naprawa + własna lista wyboru (sugestie.js). Strażnik: gałąź else w pobierzReguly(), przekazanie słownika, przyciski
// rozwijania w HTML, zachowania pickera w JS (bez API, bez localStorage), style zawężone.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'sugestie.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'sugestie.css'), 'utf8');
const wyc = (od, doTxt) => { const a = INDEX.indexOf(od); expect(a).toBeGreaterThan(-1); return INDEX.slice(a, INDEX.indexOf(doTxt, a)); };

describe('index.html — przyczyna z ticketu #14', () => {
    const F = wyc('function pobierzReguly() {', '// 2. Pobieramy reguły sugestii');
    test('pobierzReguly: słownik w pamięci → lista i tak wypełniana (gałąź else), świeży słownik → jak dotąd', () => {
        expect(F).toMatch(/if \(!salesDictCache \|\| !salesDictCache\.zabiegi \|\| salesDictCache\.zabiegi\.length === 0\) \{[\s\S]*wypelnijSelectySugestii\(\);[\s\S]*\} else \{[\s\S]*wypelnijSelectySugestii\(\);[\s\S]*\}/);
        expect((F.match(/wypelnijSelectySugestii\(\)/g) || []).length).toBe(2);
    });
    test('wypelnijSelectySugestii: datalist zostaje (zapas), słownik przekazany do oprawy tylko jako {kategoria, wariant}', () => {
        const W = wyc('function wypelnijSelectySugestii() {', '// 3. Renderowanie listy w kreatorze');
        expect(W).toContain("dataList.appendChild(option);");
        expect(W).toContain("SUGESTIE_PREZENTACJA.poSlowniku(salesDictCache.zabiegi.map(z => ({ kategoria: z.kategoria || '', wariant: z.wariant || '' })))");
        expect(W).toContain("typeof SUGESTIE_PREZENTACJA.poSlowniku === 'function'");
    });
    test('oba pola mają przycisk rozwijania (data-sug-rozwin), pola nadal tekstowe z tymi samymi ID', () => {
        const S = wyc('<div class="sug-para">', '<datalist id="lista-zabiegow-sugestie">');
        for (const id of ['sug_matka', 'sug_dziecko']) {
            expect(S).toContain(`<input type="text" id="${id}" list="lista-zabiegow-sugestie" class="form-control"`);
            expect(S).toContain(`<button type="button" class="sug-combo-btn" data-sug-rozwin="${id}" aria-label="Rozwiń listę zabiegów" aria-expanded="false">`);
        }
        expect((S.match(/sug-combo-btn/g) || []).length).toBe(2);
        expect(S).not.toMatch(/<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"\/><\/svg><\/div>/); // ozdobna strzałka bez przycisku zniknęła
    });
});

describe('sugestie.js — lista wyboru', () => {
    test('rejestruje poSlowniku obok poRenderze, zdejmuje datalist z pól, buduje panel dla obu pól', () => {
        expect(JS).toContain('window.SUGESTIE_PREZENTACJA = { poRenderze: filtruj, poSlowniku: poSlowniku };');
        expect(JS).toContain("inp.removeAttribute('list');");
        expect(JS).toContain("sekcja.querySelector('[data-sug-rozwin=\"' + inp.id + '\"]')");
        expect(JS).toContain("if (window.salesDictCache && Array.isArray(window.salesDictCache.zabiegi)) poSlowniku(window.salesDictCache.zabiegi);");
    });
    test('wybór ustawia wartość pola i wysyła input/change (podgląd + ewentualne nasłuchy jak dotąd); Enter nie wysyła formularza', () => {
        expect(JS).toMatch(/function wybierz\(st, i\) \{[\s\S]*st\.input\.value = p\.tekst;[\s\S]*new Event\('input', \{ bubbles: true \}\)[\s\S]*new Event\('change', \{ bubbles: true \}\)[\s\S]*zamknij\(st\);/);
        expect(JS).toMatch(/if \(e\.key === 'Enter'\) \{[\s\S]*e\.preventDefault\(\); wybierz\(st, st\.aktywna\)/);
        expect(JS).toContain("if (e.key === 'Escape')");
        expect(JS).toContain("if (e.key === 'ArrowDown' || e.key === 'ArrowUp')");
    });
    test('kategorie i warianty z cennika, szukanie bez ogonków, własna nazwa dozwolona (brak pozycji → komunikat, nie czyszczenie pola)', () => {
        expect(JS).toMatch(/SLOWNIK\.kategorie = Object\.keys\(kat\)\.sort/);
        expect(JS).toContain("war.push({ kategoria: k, wariant: w, tekst: k + ' ' + w });");
        expect(JS).toContain("Nic nie pasuje do „' + esc(st.input.value.trim()) + '”. Zostaw własną nazwę albo zmień frazę.");
        expect(JS).toContain('Możesz też wpisać własną nazwę');
        expect(JS).not.toMatch(/st\.input\.value = ''/);
    });
    test('nazwy z cennika trafiają do HTML tylko przez esc(); nadal zero API/localStorage', () => {
        const render = JS.slice(JS.indexOf('function renderuj('), JS.indexOf('function wybierz('));
        expect(render).toMatch(/esc\(p\.tekst\)/); expect(render).toMatch(/esc\(p\.etykieta\)/);
        expect(render).not.toMatch(/\+ p\.tekst \+/); expect(render).not.toMatch(/\+ p\.etykieta \+/);
        for (const z of ['fetch(', 'XMLHttpRequest', 'API_URL', 'action:', 'localStorage']) expect(JS).not.toContain(z);
    });
    test('style pickera zawężone do .estelio-suggestions; przycisk ma 44px, lista ukryta przez [hidden]', () => {
        expect(CSS).toContain('.estelio-suggestions .sug-combo-btn { position: absolute; right: 2px; top: 2px; width: 44px; height: 44px;');
        expect(CSS).toContain('.estelio-suggestions .sug-lista[hidden] { display: none !important; }');
        expect(CSS).not.toMatch(/\.sug-combo > svg/); // stara ozdobna strzałka (pointer-events: none) już niepotrzebna
    });
});
