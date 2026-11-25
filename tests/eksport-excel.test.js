// tests/eksport-excel.test.js
// Silnik eksportu widocznych danych do Excela (public/eksport-excel.js) — polecenie właściciela 25.11.2026.
// Bez przeglądarki: generator XLSX (ZIP „stored” + XML) sprawdzany własnym czytnikiem ZIP, a czytanie tabel na atrapie DOM.
const EstelioExcel = require('../public/eksport-excel.js');

/** Minimalny czytnik ZIP „stored”: nagłówki lokalne → { nazwa: treść } */
function rozpakuj(bajty) {
    const dv = new DataView(bajty.buffer, bajty.byteOffset, bajty.byteLength);
    const pliki = {};
    let p = 0;
    while (p + 30 <= bajty.length && dv.getUint32(p, true) === 0x04034b50) {
        const metoda = dv.getUint16(p + 8, true);
        const crc = dv.getUint32(p + 14, true);
        const rozmiar = dv.getUint32(p + 18, true);
        const dlNazwy = dv.getUint16(p + 26, true);
        const dlExtra = dv.getUint16(p + 28, true);
        const nazwa = new TextDecoder().decode(bajty.slice(p + 30, p + 30 + dlNazwy));
        const dane = bajty.slice(p + 30 + dlNazwy + dlExtra, p + 30 + dlNazwy + dlExtra + rozmiar);
        expect(metoda).toBe(0);
        expect(EstelioExcel._crc32(dane)).toBe(crc);
        pliki[nazwa] = new TextDecoder().decode(dane);
        p += 30 + dlNazwy + dlExtra + rozmiar;
    }
    expect(dv.getUint32(p, true)).toBe(0x02014b50);   // zaraz po plikach zaczyna się katalog centralny
    return pliki;
}

/** Atrapa komórki tabeli. */
function td(tekst, opcje = {}) {
    const przyciski = (opcje.przyciski || []).map((t) => ({ textContent: t }));
    return {
        tagName: 'TD', innerText: tekst, textContent: opcje.textContent != null ? opcje.textContent : tekst, colSpan: opcje.colSpan || 1,
        querySelector: (sel) => (opcje.pole && /input|select/.test(sel) ? opcje.pole : null),
        querySelectorAll: (sel) => (/button/.test(sel) ? przyciski : []),
    };
}
function th(tekst) { return { tagName: 'TH', innerText: tekst, textContent: tekst, colSpan: 1, querySelector: () => null, querySelectorAll: () => [] }; }
function tr(cells, widoczny = true) { return { cells, offsetParent: widoczny ? {} : null, querySelector: (s) => (s === 'th' ? cells.find((c) => c.tagName === 'TH') || null : null), querySelectorAll: () => cells }; }
function tabela(naglowki, wiersze, dodatki = {}) {
    const ths = naglowki.map(th);
    const t = {
        tagName: 'TABLE', offsetParent: {}, tHead: { querySelectorAll: () => ths }, tBodies: [{ rows: wiersze }],
        querySelector: () => null, querySelectorAll: () => [], closest: () => null,
        parentElement: dodatki.parentElement || { closest: () => null, previousElementSibling: null, parentElement: null },
        previousElementSibling: null,
    };
    return t;
}

describe('Wartości komórek — kwoty jako liczby, numery jako tekst', () => {
    const w = EstelioExcel.wartosc;
    test('kwoty i liczby', () => {
        expect(w('1 234,50 zł')).toBe(1234.5);
        expect(w('250 zł')).toBe(250);
        expect(w('−390')).toBe(-390);
        expect(w('+80 pkt')).toBe(80);
        expect(w('12,5%')).toBe(12.5);
        expect(w('7')).toBe(7);
        expect(w('0')).toBe(0);
        expect(w('2026')).toBe(2026);
        expect(w('3 szt.')).toBe(3);
    });
    test('to, co nie jest liczbą, zostaje tekstem', () => {
        expect(w('601 200 301')).toBe('601 200 301');       // telefon bez nagłówka
        expect(w('25.11.2026')).toBe('25.11.2026');
        expect(w('10:30')).toBe('10:30');
        expect(w('0123')).toBe('0123');
        expect(w('5901234123457')).toBe('5901234123457');   // EAN
        expect(w('Krem X · Twarz')).toBe('Krem X · Twarz');
        expect(w('')).toBe('');
        expect(w(null)).toBe('');
    });
    test('kolumny „Telefon”, „PIN”, „Kod” nigdy nie są liczbami', () => {
        expect(w('500100200', 'Nr telefonu')).toBe('500100200');
        expect(w('1111', 'PIN')).toBe('1111');
        expect(w('1234', 'Kod')).toBe('1234');
        expect(w('1234', 'Kwota')).toBe(1234);
    });
});

describe('Plik XLSX — poprawny ZIP i arkusze', () => {
    test('CRC-32 zgodne ze wzorcem', () => {
        expect(EstelioExcel._crc32(new TextEncoder().encode('abc'))).toBe(0x352441C2);
    });
    test('dwa arkusze: nagłówek pogrubiony, kwoty jako liczby, stopka, nazwy oczyszczone, znaki specjalne zakodowane', () => {
        const bajty = EstelioExcel.xlsx([
            { nazwa: 'Co zamówić?', naglowki: ['Produkt', 'Kwota', 'Uwagi'], wiersze: [['Krem A&B', 1234.5, 'ok <3'], ['Tonik', 7, '']], stopka: 'Eksport z Estelio · filtry: brak' },
            { nazwa: 'Co zamówić?', naglowki: ['Produkt'], wiersze: [['X']] },
        ], new Date(2026, 10, 25, 14, 5, 0));
        expect(bajty[0]).toBe(0x50); expect(bajty[1]).toBe(0x4b);
        const pliki = rozpakuj(bajty);
        expect(Object.keys(pliki).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
        expect(pliki['xl/workbook.xml']).toContain('<sheet name="Co zamówić" sheetId="1" r:id="rId1"/>');
        expect(pliki['xl/workbook.xml']).toContain('<sheet name="Co zamówić (2)" sheetId="2" r:id="rId2"/>');
        const s1 = pliki['xl/worksheets/sheet1.xml'];
        expect(s1).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Produkt</t></is></c>');
        expect(s1).toContain('<c r="A2" t="inlineStr" s="0"><is><t xml:space="preserve">Krem A&amp;B</t></is></c>');
        expect(s1).toContain('<c r="B2" s="2"><v>1234.5</v></c>');     // kwota z groszami: format #,##0.00
        expect(s1).toContain('<c r="B3" s="0"><v>7</v></c>');          // liczba całkowita: format ogólny
        expect(s1).toContain('ok &lt;3');
        expect(s1).toContain('<row r="5"><c r="A5" t="inlineStr" s="3"><is><t xml:space="preserve">Eksport z Estelio · filtry: brak</t></is></c></row>');
        expect(s1).toContain('state="frozen"');
        expect(pliki['xl/styles.xml']).toContain('<numFmt numFmtId="164" formatCode="#,##0.00"/>');
        expect(pliki['[Content_Types].xml']).toContain('/xl/worksheets/sheet2.xml');
    });
});

describe('Czytanie tabeli z ekranu', () => {
    test('pomija wiersze ukryte filtrem, komunikat „Brak danych” i kolumnę z samymi przyciskami; kwoty jako liczby, pola formularza jako wartości', () => {
        const t = tabela(['Produkt ⇅', 'Stan', 'Cena (Brutto)', 'Telefon', 'Zgoda', 'Akcja'], [
            tr([td('Krem A'), td('12'), td('1 234,50 zł'), td('601 200 301'), td('', { pole: { tagName: 'INPUT', type: 'checkbox', checked: true } }), td('Edytuj Usuń', { przyciski: ['Edytuj', 'Usuń'] })]),
            tr([td('Krem B'), td('0'), td('99 zł'), td('500100200'), td('', { pole: { tagName: 'INPUT', type: 'checkbox', checked: false } }), td('Edytuj', { przyciski: ['Edytuj'] })], false),
            tr([td('Tonik'), td('3'), td('45,00 zł'), td('—'), td('', { pole: { tagName: 'SELECT', selectedIndex: 1, options: [{ text: 'Nie' }, { text: 'Tak' }] } }), td('Usuń', { przyciski: ['Usuń'] })]),
            tr([td('Brak danych', { colSpan: 6 })]),
        ]);
        const z = EstelioExcel.zbierzTabele(t);
        expect(z.naglowki).toEqual(['Produkt', 'Stan', 'Cena (Brutto)', 'Telefon', 'Zgoda']);
        expect(z.pominiete).toEqual(['Akcja']);
        expect(z.wiersze).toEqual([
            ['Krem A', 12, 1234.5, '601 200 301', 'TAK'],
            ['Tonik', 3, 45, '—', 'Tak'],
        ]);
    });

    test('kolumna bez nagłówka „Akcja”, ale z samymi przyciskami w ≥80% wierszy, też jest pomijana', () => {
        const t = tabela(['Nazwa', ''], [
            tr([td('A'), td('Otwórz', { przyciski: ['Otwórz'] })]),
            tr([td('B'), td('Otwórz', { przyciski: ['Otwórz'] })]),
        ]);
        const z = EstelioExcel.zbierzTabele(t);
        expect(z.naglowki).toEqual(['Nazwa']);
        expect(z.wiersze).toEqual([['A'], ['B']]);
    });

    test('komórka z kilkoma informacjami (linie, „ | ”, „ · ”) rozbija się na osobne kolumny, a tabela bez thead dostaje nazwy „Kolumna n”', () => {
        const t = tabela([], [tr([td('Krem X\nTwarz | Ola'), td('5')]), tr([td('Tonik'), td('2')])]);
        t.tHead = null;
        const z = EstelioExcel.zbierzTabele(t);
        expect(z.naglowki).toEqual(['Kolumna 1', 'Kolumna 1 (2)', 'Kolumna 1 (3)', 'Kolumna 2']);
        expect(z.wiersze).toEqual([['Krem X', 'Twarz', 'Ola', 5], ['Tonik', '', '', 2]]);
    });

    test('w przeglądarce części wynikają z budowy komórki: plakietka (inline-block) i <small> osobno, <br> dzieli, tekst przycisku pomijany', () => {
        const tekst = (t) => ({ nodeType: 3, nodeValue: t });
        const el = (tag, dzieci, opcje = {}) => ({ nodeType: 1, tagName: tag, childNodes: dzieci, className: opcje.className || '', display: opcje.display || 'inline', hasAttribute: (a) => a === 'onclick' && !!opcje.onclick });
        global.getComputedStyle = (n) => ({ display: n.display, visibility: 'visible' });
        try {
            const komorka = el('TD', [
                el('SPAN', [tekst('DETAL')], { className: 'cat-badge cat-detal', display: 'inline-block' }),
                tekst(' '),
                el('STRONG', [tekst('Witamina D3+K2')]),
                el('BR', []),
                el('SMALL', [tekst('Suplementy | Ola | dostawa 1.09.2026')]),
                el('BUTTON', [tekst('Edytuj')], { display: 'inline-block' }),
                el('DIV', [tekst('ukryte')], { display: 'none' }),
            ]);
            komorka.querySelector = () => null; komorka.querySelectorAll = () => [];
            const t = tabela(['Produkt'], [{ cells: [komorka], offsetParent: {}, querySelector: () => null, querySelectorAll: () => [komorka] }]);
            const z = EstelioExcel.zbierzTabele(t, 'magazyn');
            expect(z.naglowki).toEqual(['Kategoria', 'Produkt', 'Typ', 'Przyjął(a)', 'Dostawa']);
            expect(z.wiersze).toEqual([['DETAL', 'Witamina D3+K2', 'Suplementy', 'Ola', '1.09.2026']]);
        } finally { delete global.getComputedStyle; }
    });

    test('Magazyn: komórka Produkt → kolumny Kategoria, Produkt, Typ, Przyjął(a), Dostawa; przy kilku dostawach kolumna „Dostawy”, podpowiedź „↓ sprzedaż…” pomijana', () => {
        const t = tabela(['Produkt', 'Il.', 'Ważność', 'Cena'], [
            tr([td('DETAL\nWitamina D3+K2\nSuplement | Ola | dostawa 1.09.2026'), td('1'), td('31.12.2026'), td('79,00 PLN')]),
            tr([td('PRO\nWosk twardy\n🚛 2 dostawy: 1.09.2026, 1.10.2026\n↓ sprzedaż pobiera automatycznie z najstarszej dostawy, która ma towar'), td('7'), td('bez daty'), td('—')]),
        ]);
        const z = EstelioExcel.zbierzTabele(t, 'magazyn');
        expect(z.naglowki).toEqual(['Kategoria', 'Produkt', 'Typ', 'Przyjął(a)', 'Dostawa', 'Dostawy', 'Il.', 'Ważność', 'Cena']);
        expect(z.wiersze).toEqual([
            ['DETAL', 'Witamina D3+K2', 'Suplement', 'Ola', '1.09.2026', '', 1, '31.12.2026', 79],
            ['PRO', 'Wosk twardy', '', '', '', '2 dostawy: 1.09.2026, 1.10.2026', 7, 'bez daty', '—'],
        ]);
    });
});

describe('Widok z kilkoma tabelami', () => {
    function sekcjaZ(tabele, filtry = []) {
        return {
            id: 'rap_magazyn',
            querySelector: (sel) => (/h1/.test(sel) ? { innerText: '🧴 Stan Magazynowy' } : null),
            querySelectorAll: (sel) => (sel === 'table' ? tabele : /input|select/.test(sel) ? filtry : []),
        };
    }
    test('tabele o tych samych kolumnach (Kosmetyki: tabela na kategorię) → jeden arkusz z kolumną „Grupa”', () => {
        const sekcja = {};
        const kategoria = (nazwa, wiersze) => {
            const naglowek = { matches: () => false, querySelector: (sel) => (/rap_cat-title/.test(sel) ? { innerText: '▼ ' + nazwa } : null), previousElementSibling: null };
            const content = { closest: () => null, previousElementSibling: naglowek, parentElement: null };
            const catSection = { closest: () => null, previousElementSibling: null, parentElement: sekcja };
            content.parentElement = catSection;
            return tabela(['Nazwa', 'Ilość', 'Status', 'Akcja'], wiersze, { parentElement: content });
        };
        const t1 = kategoria('Twarz', [tr([td('Krem A'), td('4'), td('🟢 OK'), td('Edytuj', { przyciski: ['Edytuj'] })])]);
        const t2 = kategoria('Ciało', [tr([td('Balsam'), td('1'), td('🔴 MAŁO'), td('Edytuj', { przyciski: ['Edytuj'] })])]);
        Object.assign(sekcja, sekcjaZ([t1, t2]));
        const arkusze = EstelioExcel.tabeleSekcji(sekcja);
        expect(arkusze).toHaveLength(1);
        expect(arkusze[0].nazwa).toBe('Stan Magazynowy');
        expect(arkusze[0].naglowki).toEqual(['Grupa', 'Nazwa', 'Ilość', 'Status']);
        expect(arkusze[0].wiersze).toEqual([['Twarz', 'Krem A', 4, '🟢 OK'], ['Ciało', 'Balsam', 1, '🔴 MAŁO']]);
    });

    test('tabele o różnych kolumnach → osobne arkusze; tabele ukryte lub puste pomijane', () => {
        const widoczna = tabela(['Produkt', 'Stan'], [tr([td('A'), td('2')])]);
        const inna = tabela(['Produkt', 'Ważność', 'Dni'], [tr([td('B'), td('2027-01-01'), td('37')])]);
        const ukryta = tabela(['Produkt', 'Stan'], [tr([td('C'), td('9')])]); ukryta.offsetParent = null;
        const pusta = tabela(['Produkt', 'Stan'], []);
        const sekcja = sekcjaZ([widoczna, inna, ukryta, pusta]);
        const arkusze = EstelioExcel.tabeleSekcji(sekcja);
        expect(arkusze.map((a) => a.naglowki)).toEqual([['Produkt', 'Stan'], ['Produkt', 'Ważność', 'Dni']]);
        expect(arkusze[0].wiersze).toEqual([['A', 2]]);
        expect(arkusze[1].wiersze).toEqual([['B', '2027-01-01', 37]]);
    });

    test('opis filtrów: szukajka, wybrany select, zaznaczony checkbox; „Wszystkie” i puste pola pomijane', () => {
        const pole = (o) => ({ offsetParent: {}, closest: () => null, classList: { contains: () => false }, getAttribute: (a) => o[a] || null, type: o.type || 'text', tagName: o.tagName || 'INPUT', value: o.value || '', checked: !!o.checked, options: o.options, selectedIndex: o.selectedIndex || 0, id: o.id || '' });
        const sekcja = sekcjaZ([], [
            pole({ placeholder: 'Szukaj produktu…', value: 'krem' }),
            pole({ placeholder: 'Szukaj klientki', value: '' }),
            pole({ tagName: 'SELECT', title: 'Kategoria', value: 'twarz', options: [{ text: 'Wszystkie' }, { text: 'Twarz' }], selectedIndex: 1 }),
            pole({ tagName: 'SELECT', title: 'Kanał', value: '', options: [{ text: 'Wszystkie' }], selectedIndex: 0 }),
            pole({ type: 'checkbox', 'aria-label': 'Tylko ze zgodą SMS', checked: true }),
            pole({ type: 'date', 'aria-label': 'Od', value: '2026-11-01' }),
        ]);
        expect(EstelioExcel.opisFiltrow(sekcja)).toBe('Szukaj produktu: krem; Kategoria: Twarz; Tylko ze zgodą SMS: tak; Od: 2026-11-01');
    });

    test('przygotuj(): tytuł z nagłówka bez emoji, nazwa pliku, stopka z filtrami i liczbą wierszy', () => {
        const sekcja = sekcjaZ([tabela(['Produkt', 'Stan'], [tr([td('A'), td('2')]), tr([td('B'), td('3')])])]);
        const p = EstelioExcel.przygotuj(sekcja, new Date(2026, 10, 25, 14, 5));
        expect(p.tytul).toBe('Stan Magazynowy');
        expect(p.plik).toBe('estelio-stan-magazynowy-2026-11-25.xlsx');
        expect(p.wierszy).toBe(2);
        expect(p.sekcjaId).toBe('rap_magazyn');
        expect(p.arkusze[0].stopka).toMatch(/^Eksport z Estelio · salon  · widok „Stan Magazynowy” · 25\.11\.2026 o 14:05 · filtry: brak · wierszy: 2 · wykonał\(a\): $/);
    });

    test('slug nazwy pliku transliteruje polskie znaki', () => {
        expect(EstelioExcel.slug('Raport: Co zamówić? — Łódź')).toBe('raport-co-zamowic-lodz');
    });
});

describe('Widoki dedykowane (paczka B): Kosmetyki, Inwentaryzacja, Ranking, Klub', () => {
    afterEach(() => { delete global.rap_inventoryData; delete global.rap_getStatus; delete global.klubadm_czlonkowieCache; delete global.klubadm_eksportWnioski; delete global.klubadm_eksportOdbiory; delete global.klubadm_eksportZgloszenia; delete global.document; });
    const el = (o) => Object.assign({ offsetParent: {}, style: {}, querySelector: () => null, querySelectorAll: () => [], children: [] }, o);

    test('Kosmetyki (rap_magazyn): dane widoku po szukajce, posortowane kategorią i nazwą, status jak na ekranie, daty po polsku', () => {
        global.rap_inventoryData = [
            ['7', 'Twarz', 'Serum C', '2', '3', 'szt.', '2026-11-20T10:00:00', 0, 0, 0, 0, '2027-03-31'],
            ['8', 'Ciało', 'Balsam', '12', '5', 'ml', '2026-11-01T10:00:00', 0, 0, 0, 0, null],
            ['9', 'Twarz', 'Krem A', '4', '0', '', '2026-10-05T10:00:00', 0, 0, 0, 0, ''],
        ];
        global.rap_getStatus = (q, m) => (!m ? { txt: 'OK' } : (q / m) * 100 < 100 ? { txt: 'BRAK!' } : (q / m) * 100 <= 130 ? { txt: 'NISKI' } : { txt: 'OK' });
        global.document = { getElementById: (id) => (id === 'rap_search' ? { value: '' } : null) };
        const sekcja = el({ id: 'rap_magazyn' });
        const w = EstelioExcel.dedykowany(sekcja);
        expect(w.arkusze[0].naglowki).toEqual(['Kategoria', 'Nazwa', 'Ilość', 'Jednostka', 'Minimum', 'Status', 'Data modyfikacji', 'Ważność']);
        expect(w.arkusze[0].wiersze).toEqual([
            ['Ciało', 'Balsam', 12, 'ml', 5, 'OK', '01.11.2026', ''],
            ['Twarz', 'Krem A', 4, 'szt.', 0, 'OK', '05.10.2026', ''],
            ['Twarz', 'Serum C', 2, 'szt.', 3, 'BRAK!', '20.11.2026', '31.03.2027'],
        ]);
        expect(w.filtry).toBe('');
        global.document = { getElementById: (id) => (id === 'rap_search' ? { value: 'twa' } : null) };
        const w2 = EstelioExcel.dedykowany(sekcja);
        expect(w2.arkusze[0].wiersze.map((r) => r[1])).toEqual(['Krem A', 'Serum C']);
        expect(w2.filtry).toBe('Szukaj produktu: twa');
        expect(EstelioExcel.maDane(sekcja)).toBe(true);
    });

    test('Kosmetyki bez załadowanych danych → brak eksportu dedykowanego (null), bez błędu', () => {
        expect(EstelioExcel.dedykowany(el({ id: 'rap_magazyn' }))).toBeNull();
    });

    test('Inwentaryzacja: karty .inv-row → kategoria, produkt, suma partii; karty ukryte pomijane', () => {
        const karta = (kat, nazwa, ilosc, widoczna = true) => el({
            offsetParent: widoczna ? {} : null,
            querySelector: (sel) => (sel === '.cat-badge' ? { innerText: kat } : sel === 'b' ? { innerText: nazwa } : null),
            querySelectorAll: (sel) => (sel === 'span' ? [{ innerText: kat }, { innerText: 'Połączone partie (Suma)' }].concat(ilosc != null ? [{ innerText: String(ilosc) }] : []) : []),
        });
        const sekcja = el({ id: 'inwentaryzacja', querySelectorAll: () => [karta('Detal', 'Krem A', 5), karta('Pro', 'Wosk', 12, false), karta('Pro', 'Olejek', 0)] });
        const w = EstelioExcel.dedykowany(sekcja);
        expect(w.arkusze[0].naglowki).toEqual(['Kategoria', 'Produkt', 'Ilość (suma partii)']);
        expect(w.arkusze[0].wiersze).toEqual([['Detal', 'Krem A', 5], ['Pro', 'Olejek', 0]]);
    });

    test('Ranking: karty → pozycja, klientka, telefon, liczba transakcji, suma (lub „ukryte”)', () => {
        const karta = (poz, nazwa, info, kwota) => el({ innerText: '#' + poz + '\n' + nazwa + '\n' + info + '\n' + kwota, querySelector: (sel) => (sel === 'b' ? { innerText: nazwa } : null) });
        const lista = { children: [karta(1, 'Anna Nowak', '500 100 200 · 12 transakcji', '1 234,00 zł'), karta(2, 'Ewa Kowal', '3 transakcji', '🔒 ukryte')] };
        const sekcja = el({ id: 'ranking-klientow', querySelector: (sel) => (sel === '#rnk-lista' ? lista : null) });
        const w = EstelioExcel.dedykowany(sekcja);
        expect(w.arkusze[0].wiersze).toEqual([[1, 'Anna Nowak', '500 100 200', 12, 1234], [2, 'Ewa Kowal', '', 3, '🔒 ukryte']]);
    });

    test('Klub → Członkowie: z pamięci widoku, po szukajce i sortowaniu, tak jak na ekranie', () => {
        global.klubadm_czlonkowieCache = [
            { id_klienta: '1001', klient: 'Marta Kowalska', telefon: '601200301', saldo: 200, dolaczyl: '2026-09-01T10:00:00', ostatnia_wizyta: '2026-11-20T10:00:00', ma_push: 1 },
            { id_klienta: '1002', klient: 'Anna Nowak', telefon: '500100200', saldo: 350, dolaczyl: '2026-10-05T10:00:00', ostatnia_wizyta: null, ma_push: 0 },
            { id_klienta: '1003', klient: 'Ewa Kowal', telefon: '', saldo: 0, dolaczyl: null, ostatnia_wizyta: null },
        ];
        global.document = { getElementById: (id) => (id === 'klubadm-cz-szukaj' ? { value: 'kowal' } : id === 'klubadm-cz-sort' ? { value: 'nazwisko', selectedIndex: 0, options: [{ text: 'Nazwisko A–Z' }] } : null) };
        const strona = el({ id: 'klubadm-czlonkowie', style: { display: 'block' } });
        const sekcja = el({ id: 'klub-admin', querySelectorAll: (sel) => (sel === '.klubadm-page' ? [el({ id: 'klubadm-ustawienia', style: { display: 'none' } }), strona] : []) });
        const w = EstelioExcel.dedykowany(sekcja);
        expect(w.tytul).toBe('Klub — członkowie');
        expect(w.filtry).toBe('Szukaj: kowal; Sortowanie: Nazwisko A–Z');
        expect(w.arkusze[0].naglowki).toEqual(['Klientka', 'Nr klientki', 'Telefon', 'Saldo pkt', 'Dołączyła', 'Ostatnia wizyta', 'Powiadomienia']);
        expect(w.arkusze[0].wiersze).toEqual([
            ['Ewa Kowal', '1003', '', 0, '', '', ''],
            ['Marta Kowalska', '1001', '601200301', 200, '01.09.2026', '20.11.2026', 'PUSH'],
        ]);
    });

    test('Klub → Do obsłużenia: wnioski, odbiory i zgłoszenia jako osobne arkusze, tylko to, co widać (nowe + ostatnio obsłużone)', () => {
        global.klubadm_eksportWnioski = [{ typ: 'KONTO', imie: 'Ola', klient_kartoteka: 'Ola Zielińska', id_klienta: '7', telefon: '600 1', status: 'NOWY', created_at: '2026-11-25T09:05:00' }, { typ: 'RESET', imie: 'X', id_klienta: '8', status: 'ODRZUCONY', created_at: '2026-11-20T09:05:00' }];
        global.klubadm_eksportOdbiory = Array.from({ length: 12 }, (_, i) => ({ klient: 'K' + i, id_klienta: String(i), nagroda_nazwa: 'Peeling', koszt_pkt: 300, kod: 'AB' + i, status: i === 0 ? 'OCZEKUJE' : 'WYDANA', wydal: i === 0 ? '' : 'Ola', created_at: '2026-11-01T10:00:00' }));
        global.klubadm_eksportZgloszenia = [{ klient: 'Z1', id_klienta: '1', telefon: '5', promocja_tytul: 'Promo', status: 'NOWE', created_at: '2026-11-25T08:00:00' }];
        const strona = el({ id: 'klubadm-odbiory', style: { display: 'block' } });
        const sekcja = el({ id: 'klub-admin', querySelectorAll: (sel) => (sel === '.klubadm-page' ? [strona] : []) });
        const w = EstelioExcel.dedykowany(sekcja);
        expect(w.tytul).toBe('Klub — do obsłużenia');
        expect(w.arkusze.map((a) => [a.nazwa, a.wiersze.length])).toEqual([['Wnioski', 2], ['Odbiory nagród', 11], ['Zgłoszenia do promocji', 1]]);
        expect(w.arkusze[0].wiersze[0]).toEqual(['KONTO', 'Ola Zielińska', '7', '600 1', 'NOWY', '25.11.2026 09:05']);
        expect(w.arkusze[0].wiersze[1][0]).toBe('RESET PIN');
        expect(w.arkusze[1].wiersze[0]).toEqual(['K0', '0', 'Peeling', 300, 'AB0', 'OCZEKUJE', '', '01.11.2026 10:00']);
    });

    test('Klub na innej podstronie (np. Ustawienia) → null, czyli zwykłe czytanie tabel', () => {
        const sekcja = el({ id: 'klub-admin', querySelectorAll: (sel) => (sel === '.klubadm-page' ? [el({ id: 'klubadm-ustawienia', style: { display: 'block' } })] : []) });
        expect(EstelioExcel.dedykowany(sekcja)).toBeNull();
    });
});
