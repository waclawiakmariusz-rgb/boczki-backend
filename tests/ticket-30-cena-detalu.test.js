// tests/ticket-30-cena-detalu.test.js
// Ticket #30 (Gosia, 18.11.2026): kosmetyk przy sprzedaży miał cenę 0 zł, bo nazwa pozycji
// magazynowej nie zgadzała się co do znaku z „firma + model” z cennika, a kod milczał.
// Test wyciąga funkcję wyczyscCeny z public/index.html i URUCHAMIA ją na atrapie wiersza.
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/** Wycina ciało funkcji po klamrach — tak samo jak robiła to łatka. */
function wytnijFunkcje(zrodlo, naglowek) {
    const start = zrodlo.indexOf(naglowek);
    if (start < 0) throw new Error('nie znaleziono: ' + naglowek);
    let i = zrodlo.indexOf('{', start), glebokosc = 0;
    for (; i < zrodlo.length; i++) {
        if (zrodlo[i] === '{') glebokosc++;
        else if (zrodlo[i] === '}') { glebokosc--; if (glebokosc === 0) return zrodlo.slice(start, i + 1); }
    }
    throw new Error('brak końca funkcji: ' + naglowek);
}

/** Atrapa wiersza sprzedaży — tylko to, czego funkcja naprawdę dotyka. */
function fakeRow() {
    const pole = (klasa) => ({ klasa, value: '', style: {}, focus: jest.fn() });
    const uwaga = { klasa: '.item-cena-uwaga', textContent: '', style: { display: 'none' } };
    const el = {
        '.item-unit-price': pole('.item-unit-price'),
        '.item-qty': pole('.item-qty'),
        '.item-price': pole('.item-price'),
        '.item-cena-uwaga': uwaga,
    };
    const row = { id: 'row-abc', dataset: {}, querySelector: (k) => el[k] || null };
    const select = { value: '', closest: () => row };
    return { row, select, el, uwaga };
}

function srodowisko(slownik) {
    const { row, select, el, uwaga } = fakeRow();
    const prosteMnozenie = jest.fn();
    const kod = wytnijFunkcje(INDEX, 'function wyczyscCeny(selectEl) {');
    // eslint-disable-next-line no-new-func
    const fabryka = new Function('slownikCache', 'prosteMnozenie', 'setTimeout', kod + '; return wyczyscCeny;');
    const wyczyscCeny = fabryka(slownik, prosteMnozenie, () => {});
    return { wyczyscCeny, row, select, el, uwaga, prosteMnozenie };
}

const CENNIK = [
    { firma: 'Vagheggi', model: 'SUN Anti-Ageing Face Sun Cream SPF 50', cena: 225 },
    { firma: 'Vagheggi', model: 'BALANCE Face Cream', cena: 260 },
    { firma: 'Vagheggi', model: 'REHYDRA Hydrating Face Scrub', cena: null },
];

describe('ticket #30 — cena detalu z cennika', () => {
    test('dokładna nazwa: cena wpada do pola, suma przeliczona, bez ostrzeżenia', () => {
        const s = srodowisko(CENNIK);
        s.select.value = 'Vagheggi BALANCE Face Cream';
        s.wyczyscCeny(s.select);
        expect(s.el['.item-unit-price'].value).toBe(260);
        expect(s.prosteMnozenie).toHaveBeenCalledWith('abc');
        expect(s.uwaga.style.display).toBe('none');
    });

    test('różnica wielkości liter i podwójnych spacji nie psuje dopasowania', () => {
        const s = srodowisko(CENNIK);
        s.select.value = '  vagheggi   balance face cream ';
        s.wyczyscCeny(s.select);
        expect(s.el['.item-unit-price'].value).toBe(260);
        expect(s.uwaga.style.display).toBe('none');
    });

    test('PRZYPADEK ZE ZGŁOSZENIA: magazyn bez członu „SUN” → cena pusta, ale z komunikatem i podpowiedzią', () => {
        const s = srodowisko(CENNIK);
        s.select.value = 'Vagheggi Anti-Ageing Face Sun Cream SPF 50';
        s.wyczyscCeny(s.select);
        expect(s.el['.item-unit-price'].value).toBe('');
        expect(s.el['.item-price'].value).toBe('');
        expect(s.uwaga.style.display).toBe('block');
        expect(s.uwaga.textContent).toMatch(/nie ma w cenniku/i);
        expect(s.uwaga.textContent).toMatch(/Vagheggi SUN Anti-Ageing Face Sun Cream SPF 50/);
        expect(s.uwaga.textContent).toMatch(/225/);
        // podpowiedź NIE wstawia ceny sama — to byłaby cicha pomyłka zamiast cichego zera
        expect(s.prosteMnozenie).not.toHaveBeenCalled();
    });

    test('pozycja jest w cenniku, ale bez ceny → inny komunikat, pole puste', () => {
        const s = srodowisko(CENNIK);
        s.select.value = 'Vagheggi REHYDRA Hydrating Face Scrub';
        s.wyczyscCeny(s.select);
        expect(s.el['.item-unit-price'].value).toBe('');
        expect(s.uwaga.style.display).toBe('block');
        expect(s.uwaga.textContent).toMatch(/nie ma przy nim ceny/i);
    });

    test('wyczyszczenie wyboru i pusty cennik nie wywracają funkcji', () => {
        const s1 = srodowisko(CENNIK);
        s1.select.value = '';
        expect(() => s1.wyczyscCeny(s1.select)).not.toThrow();
        expect(s1.uwaga.style.display).toBe('none');

        const s2 = srodowisko([]);
        s2.select.value = 'Cokolwiek';
        expect(() => s2.wyczyscCeny(s2.select)).not.toThrow();
        expect(s2.uwaga.style.display).toBe('block');
    });

    test('ponowny wybór kasuje poprzednie ostrzeżenie i zgodę na gratis', () => {
        const s = srodowisko(CENNIK);
        s.select.value = 'Vagheggi Anti-Ageing Face Sun Cream SPF 50';
        s.wyczyscCeny(s.select);
        expect(s.uwaga.style.display).toBe('block');
        s.row.dataset.zeroPotwierdzone = '1';
        s.select.value = 'Vagheggi BALANCE Face Cream';
        s.wyczyscCeny(s.select);
        expect(s.uwaga.style.display).toBe('none');
        expect(s.row.dataset.zeroPotwierdzone).toBe('');
    });
});

describe('ticket #30 — zapis detalu za 0 zł', () => {
    test('formularz ma miejsce na komunikat pod ceną', () => {
        expect(INDEX).toMatch(/class="item-cena-uwaga"/);
    });

    test('zapis detalu za 0 zł pyta o potwierdzenie gratisu i blokuje przy odmowie', () => {
        expect(INDEX).toMatch(/typ === 'Kosmetyk' && cena === 0 && !row\.dataset\.zeroPotwierdzone/);
        expect(INDEX).toMatch(/Zapisać jako gratis/);
        expect(INDEX).toMatch(/zeroPotwierdzone = '1'/);
    });

    test('zabieg i zadatek za 0 zł nadal przechodzą bez pytania', () => {
        const od = INDEX.indexOf("if (typ === 'Kosmetyk' && cena === 0");
        const blok = INDEX.slice(od, INDEX.indexOf("zeroPotwierdzone = '1';", od));
        expect(blok).not.toMatch(/typ === 'Zabieg'/);
        expect(blok).not.toMatch(/typ === 'Zadatek'/);
    });
});
