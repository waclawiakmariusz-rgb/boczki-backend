// Redesign ekranu „Przyjęcie towaru” (22.10.2026): strażnik zasady „zmienia się wyłącznie oprawa”.
// Te testy nie sprawdzają, jak ekran wygląda (to robi próba w Chrome headless i zrzuty w docs/redesign/),
// tylko to, czego NIE wolno było ruszyć: ID pól, atrybuty walidacji natywnej, handler zapisu, payload,
// pomoc kontekstowa — oraz to, że nowe pliki prezentacji nie zapisują niczego i nie wychodzą poza swój ekran.
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'przyjecie-towaru.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'przyjecie-towaru.js'), 'utf8');

function sekcjaNowy() {
    const od = INDEX.indexOf('<div id="nowy" class="section');
    expect(od).toBeGreaterThan(-1);
    const doo = INDEX.indexOf('<div id="co-zamowic"', od);
    expect(doo).toBeGreaterThan(od);
    return INDEX.slice(od, doo);
}
function funkcja(nazwa) {
    // index.html ma końce linii CRLF — szukamy po indeksach, nie regexem z \n
    const od = INDEX.indexOf('function ' + nazwa + '(e)');
    expect(od).toBeGreaterThan(-1);
    const doo = INDEX.indexOf('\n        }', od);
    expect(doo).toBeGreaterThan(od);
    return INDEX.slice(od, doo + 10);
}

describe('Przyjęcie towaru po redesignie — pola i walidacja natywna bez zmian', () => {
    const S = sekcjaNowy();

    test('formularz nadal wysyła przez dodajProdukt(event)', () => {
        expect(S).toMatch(/<form[^>]*onsubmit="dodajProdukt\(event\)"/);
        expect((S.match(/<form\b/g) || []).length).toBe(1);
    });

    test('wszystkie dotychczasowe ID pól istnieją dokładnie raz', () => {
        for (const id of ['n_firma', 'n_model', 'n_nazwa', 'n_ilosc', 'n_typ', 'n_netto', 'n_brutto', 'n_min', 'n_waznosc']) {
            expect((S.match(new RegExp('id="' + id + '"', 'g')) || []).length).toBe(1);
        }
    });

    test('atrybuty walidacji natywnej są te same, co przed redesignem', () => {
        expect(S).toContain('<input type="number" id="n_ilosc" required min="1">');
        expect(S).toContain('<input type="number" step="0.01" id="n_netto" required min="0.01">');
        expect(S).toContain('<input type="number" step="0.01" id="n_brutto" required min="0.01">');
        expect(S).toContain('<input type="date" id="n_waznosc" required>');
        expect(S).toContain('<select id="n_firma" onchange="zaladujModeleDlaFirmy()"></select>');
        expect(S).toContain('<select id="n_model" onchange="generujNazwe()" disabled></select>');
        expect(S).toContain('<select id="n_typ"><option>Kremy</option><option>Olejek</option><option value="Witaminy">Suplement</option><option>Inne</option></select>');
        expect(S).toContain('<input type="number" id="n_min" value="2">');
    });

    test('rodzaj „Detal” nadal jest zaznaczoną kontrolką name=kategoria (dodajProdukt czyta z niej wartość)', () => {
        expect(S).toMatch(/<input type="radio" name="kategoria" value="Detal" checked[^>]*>/);
        expect((S.match(/name="kategoria"/g) || []).length).toBe(1);
        // ukryta i poza fokusem, ale NIE required — nie może zatrzymać walidacji ani przechwycić Tab
        expect(S).toMatch(/name="kategoria"[^>]*\bhidden\b/);
        expect(S).toMatch(/name="kategoria"[^>]*tabindex="-1"/);
        expect(S).not.toMatch(/name="kategoria"[^>]*\brequired\b/);
    });

    test('pomoc kontekstowa ekranu zostaje (magazyn.przyjecie)', () => {
        expect(S).toContain('class="pk-slot" data-pomoc="magazyn.przyjecie"');
    });

    test('z ekranu zniknęły elementy, których makieta nie ma', () => {
        expect(S).not.toContain('class="btn-primary"');
        expect(S).not.toMatch(/>\s*Zapisz\s*</);
        expect(S).not.toMatch(/value="Profesja"/); // (komentarz w HTML może o niej wspominać; kontrolki ma nie być)
        expect(S).not.toContain('NETTO (SZT)');
        // nazwa „Firma Model” nie jest już widocznym zielonym paskiem
        expect(S).toContain('<input type="hidden" id="n_nazwa">');
    });

    test('przyciski stopki: Anuluj (type=button) i Przyjmij towar (jedyny submit)', () => {
        expect(S).toMatch(/<button type="button"[^>]*data-anuluj>Anuluj<\/button>/);
        expect((S.match(/type="submit"/g) || []).length).toBe(1);
        expect(S).toMatch(/<button type="submit"[^>]*>Przyjmij towar<\/button>/);
        // −/+ nie są submitami
        expect(S).toMatch(/<button type="button" data-krok="-1"/);
        expect(S).toMatch(/<button type="button" data-krok="1"/);
    });

    test('style i warstwa prezentacji są podpięte z markerem wersji', () => {
        expect(INDEX).toContain('<link rel="stylesheet" href="/przyjecie-towaru.css?v=__WERSJA_PLIKOW__">');
        expect(INDEX).toContain('<script src="/przyjecie-towaru.js?v=__WERSJA_PLIKOW__" defer></script>');
    });
});

describe('Przyjęcie towaru po redesignie — handler zapisu i payload bez zmian', () => {
    const F = funkcja('dodajProdukt');

    test('payload action:add ma dokładnie te same pola i źródła wartości', () => {
        expect(F).toContain("action: 'add',");
        expect(F).toContain("nazwa: document.getElementById('n_nazwa').value,");
        expect(F).toContain("typ: document.getElementById('n_typ').value,");
        expect(F).toContain('ilosc: ilosc,');
        expect(F).toContain(`kategoria: document.querySelector('input[name="kategoria"]:checked').value,`);
        expect(F).toContain('pracownik: currentUser,');
        expect(F).toContain('min: 2,');
        expect(F).toContain('waznosc: waznosc,');
        expect(F).toContain('netto: netto,');
        expect(F).toContain('brutto: brutto');
        expect((F.match(/action: '/g) || []).length).toBe(1);
    });

    test('walidacja JS (alerty) i blokada przycisku na czas zapisu zostały', () => {
        expect(F).toContain('if (!firma || firma === "" || firma === "--") { alert("⛔ BŁĄD: Musisz wybrać poprawną firmę!"); return; }');
        expect(F).toContain('if (!model || model === "" || model === "--") { alert("⛔ BŁĄD: Musisz wybrać konkretny model!"); return; }');
        expect(F).toContain('if (!ilosc || ilosc < 1) { alert("⛔ BŁĄD: Ilość musi być większa od 0!"); return; }');
        expect(F).toContain('if (!netto || netto <= 0) { alert("⛔ BŁĄD: Podaj cenę netto!"); return; }');
        expect(F).toContain('if (!brutto || brutto <= 0) { alert("⛔ BŁĄD: Podaj cenę brutto!"); return; }');
        expect(F).toContain('if (!waznosc) { alert("⛔ BŁĄD: Podaj datę ważności!"); return; }');
        expect(F).toContain('btn.disabled = true;');
        expect(F).toContain('btn.disabled = false;');
        expect(F).toContain('alert("✅ Dodano produkt pomyślnie!");');
        expect(F).toContain("document.getElementById('nowy').querySelector('form').reset();");
    });

    test('jedyna zmiana w dodajProdukt to dwie etykiety przycisku', () => {
        expect(F).toContain('btn.innerText = "Przyjmowanie…";');
        expect(F).toContain('btn.innerText = "Przyjmij towar";');
        expect(F).not.toContain('Zapisywanie');
        expect(F).not.toContain('"Zapisz"');
    });
});

describe('Przyjęcie towaru po redesignie — nowe pliki prezentacji nie zapisują i nie wychodzą poza ekran', () => {
    test('przyjecie-towaru.js nie ma żadnej drogi do API', () => {
        for (const zakazane of ['fetch(', 'XMLHttpRequest', 'API_URL', 'action:', 'navigator.sendBeacon', 'localStorage', 'innerHTML +=']) {
            expect(JS).not.toContain(zakazane);
        }
        // jedyny dozwolony innerHTML: reset listy modeli identyczny z tym w dodajProdukt()
        expect((JS.match(/innerHTML/g) || []).length).toBe(1);
        expect(JS).toContain(`pola.model.innerHTML = '<option value="">--</option>';`);
    });

    test('warstwa prezentacji podpina zdarzenia tylko raz (strażnik data-prezentacja-gotowa)', () => {
        expect(JS).toContain("sekcja.dataset.prezentacjaGotowa === '1'");
        expect(JS).toContain("sekcja.dataset.prezentacjaGotowa = '1'");
    });

    test('każdy selektor CSS jest zawężony do .estelio-goods-receipt', () => {
        const linie = CSS.split(/\r?\n/);
        const zle = [];
        linie.forEach((l, i) => {
            const t = l.trim();
            if (!t || t.startsWith('/*') || t.startsWith('@') || t.startsWith('}') || t.startsWith('--') || !t.includes('{')) return;
            const selektory = t.slice(0, t.indexOf('{')).split(',').map(s => s.trim()).filter(Boolean);
            for (const s of selektory) {
                // reguły wewnątrz @container/@media są wcięte, ale i tak muszą zaczynać się od klasy ekranu
                if (!/^(body\.dark-mode )?\.estelio-goods-receipt\b/.test(s)) zle.push((i + 1) + ': ' + s);
            }
        });
        expect(zle).toEqual([]);
    });

    test('CSS nie rusza globalnych selektorów aplikacji', () => {
        expect(CSS).not.toMatch(/^\s*(input|select|button|label|h1|h2|body|\.card|\.btn-primary|\.section|\.main-content)\s*[,{]/m);
    });
});
