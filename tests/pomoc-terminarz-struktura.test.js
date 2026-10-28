// Przewodnik /pomoc-terminarz/ (28.10.2026): strażnik spójności po dopisaniu czterech rozdziałów.
// Pilnuje tego, co przy ręcznej edycji HTML rozjeżdża się najciszej: numeracji, nawigacji,
// odsyłaczy, istnienia zrzutów i opisów funkcji, które zostały z Terminarza zdjęte.
const fs = require('fs');
const path = require('path');
const KAT = path.join(__dirname, '..', 'public');
const G = fs.readFileSync(path.join(KAT, 'estelio_pomoc_terminarz.html'), 'utf8');
const JS = fs.readFileSync(path.join(KAT, 'terminarz.js'), 'utf8');

const ids = [...G.matchAll(/<section class="card" id="([a-z-]+)">/g)].map((m) => m[1]);
const numer = Object.fromEntries(ids.map((id, i) => [id, String(i + 1).padStart(2, '0')]));

describe('numeracja i nawigacja', () => {
    test('każdy rozdział ma nagłówek „Krok NN" zgodny z kolejnością w dokumencie', () => {
        const naglowki = [...G.matchAll(/<div class="subtitle">Krok (\d\d) /g)].map((m) => m[1]);
        expect(naglowki.length).toBe(ids.length);
        expect(naglowki).toEqual(ids.map((id) => numer[id]));
    });
    test('nawigacja ma te same rozdziały, w tej samej kolejności i z tymi samymi numerami', () => {
        const nav = [...G.matchAll(/<a class="nav-link" href="#([a-z-]+)"><span class="num">(\d\d)<\/span> ([^<]+)<\/a>/g)];
        expect(nav.map((m) => m[1])).toEqual(ids);
        expect(nav.map((m) => m[2])).toEqual(ids.map((id) => numer[id]));
        expect(nav.filter((m) => m[3].trim().length < 3).map((m) => m[1])).toEqual([]);
    });
    test('żaden odsyłacz nie prowadzi w pustkę, a numer w treści odsyłacza zgadza się z celem', () => {
        const kotwice = [...new Set([...G.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]))];
        expect(kotwice.filter((k) => !ids.includes(k))).toEqual([]);
        const zle = [...G.matchAll(/href="#([a-z-]+)">(?:Krok(?:u)? )?(\d\d)<\/a>/g)]
            .filter((m) => numer[m[1]] !== m[2])
            .map((m) => `${m[1]}: pisze ${m[2]}, jest ${numer[m[1]]}`);
        expect(zle).toEqual([]);
    });
});

describe('rozdziały dopisane 28.10.2026', () => {
    test.each([
        ['maile', 'E-maile do klientek', 'Powiadomienia e-mail'],
        ['kolory', 'Kolory zabiegów', '1. wizyta'],
        ['rezerwacja', 'Rezerwacja techniczna', 'Cały salon'],
        ['porzadki', 'Skasuj wizytę', 'Domknij zaległości'],
    ])('rozdział „%s" istnieje i opisuje to, co ma opisywać', (id, fraza1, fraza2) => {
        expect(ids).toContain(id);
        const od = G.indexOf(`<section class="card" id="${id}">`);
        const tresc = G.slice(od, G.indexOf('</section>', od));
        expect(tresc).toContain(fraza1);
        expect(tresc).toContain(fraza2);
    });
    test('każdy z nich jest w nawigacji i w indeksie sytuacji', () => {
        for (const id of ['maile', 'kolory', 'rezerwacja', 'porzadki']) {
            expect(G).toContain(`<a class="nav-link" href="#${id}">`);
            const indeks = G.slice(G.indexOf('<section class="card" id="indeks">'));
            expect(indeks).toContain(`href="#${id}"`);
        }
    });
});

describe('zrzuty ekranu', () => {
    test('każdy zrzut użyty w przewodniku leży na dysku i ma rozsądny rozmiar', () => {
        const pliki = [...new Set([...G.matchAll(/src="\/pomoc-terminarz\/([^"]+)"/g)].map((m) => m[1]))];
        expect(pliki.length).toBeGreaterThan(30);
        const braki = pliki.filter((p) => !fs.existsSync(path.join(KAT, 'pomoc-terminarz', p)));
        expect(braki).toEqual([]);
        const puste = pliki.filter((p) => fs.statSync(path.join(KAT, 'pomoc-terminarz', p)).size < 10 * 1024);
        expect(puste).toEqual([]);
    });
    test('każdy zrzut ma opis alternatywny i podpis', () => {
        const figury = [...G.matchAll(/<figure class="zrzut">([\s\S]*?)<\/figure>/g)].map((m) => m[1]);
        expect(figury.length).toBeGreaterThan(30);
        expect(figury.filter((f) => !/alt="[^"]{10,}"/.test(f))).toEqual([]);
        expect(figury.filter((f) => !/<figcaption>/.test(f))).toEqual([]);
    });
});

describe('przewodnik nie opisuje rzeczy, których w Terminarzu już nie ma', () => {
    test('widok „Tydzień" zniknął z kodu i z przewodnika', () => {
        expect(JS).not.toMatch(/\['tydzien', *'Tydzień'\]/);
        expect(G).not.toMatch(/widok[a-zu]* Tygodnia|w Tygodniu|>Tydzień</);
    });
    test('nie ma „Przejmij" ani kafelka „wartość wykonanych"', () => {
        expect(G).not.toContain('Przejmij');
        expect(G).not.toContain('wartość wykonanych');
    });
    test('„Dodaj nową klientkę" występuje wyłącznie jako informacja, że tego przycisku już nie ma', () => {
        const wystapienia = [...G.matchAll(/.{90}Dodaj nową klientkę/g)].map((m) => m[0]);
        expect(wystapienia.length).toBeGreaterThan(0);
        expect(wystapienia.every((w) => /zniknęło|nie ma|nie zakłada/i.test(w))).toBe(true);
    });
    test('priorytet spraw opisany zgodnie z kodem: po terminie schodzi, a nie zostaje pilny', () => {
        expect(JS.length).toBeGreaterThan(0);
        expect(G).not.toContain('Odwołanie wpisane po terminie zostaje pilne');
        expect(G).toContain('termin już minął');
        expect(G).toMatch(/Obniżono priorytet/);
    });
});
