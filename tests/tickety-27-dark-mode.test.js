// Ticket #27 (Gosia, 14.11.2026): „Zgłoszenia są niewyraźne przy Dark Mode”. Lista i rozmowa zgłoszeń mają kolory wpisane w HTML
// (tk_render / tk_rozwin), a globalna reguła ciemniąca `div[style*="background:#fff"]` zostawiała ciemny tekst na ciemnym tle.
// Strażnik: elementy dostają klasy tk-*, a tryb ciemny ma dla nich reguły. Tryb jasny bez zmian (style inline zostają).
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const wyc = (od, doTxt) => { const a = INDEX.indexOf(od); expect(a).toBeGreaterThan(-1); const b = INDEX.indexOf(doTxt, a); expect(b).toBeGreaterThan(a); return INDEX.slice(a, b); };

describe('ticket #27 — Zgłoszenia w trybie ciemnym', () => {
    const RENDER = wyc('function tk_render() {', 'async function tk_rozwin(id) {');
    const ROZWIN = wyc('async function tk_rozwin(id) {', 'async function tk_dopisz(id) {');

    test('karta zgłoszenia i jej części mają klasy tk-* (tytuł, opis, odpowiedź, status „nowa”), a tryb jasny zachowuje style inline', () => {
        expect(RENDER).toContain('class="tk-karta" data-nowa="${nowaOdp ? 1 : 0}" style="border:1px solid');
        expect(RENDER).toContain('background:#fff;">');   // jasny tryb bez zmian
        for (const k of ['tk-tytul', 'tk-meta', 'tk-opis', 'tk-odp', 'tk-odp-naglowek', 'tk-odp-tresc', 'tk-nowa', 'tk-czeka', 'tk-zamkniete', 'tk-pusto']) {
            expect(RENDER).toContain(`class="${k}"`);
        }
    });

    test('rozmowa: dymki salonu i Estelio oraz wątek mają klasy tk-* z rozróżnieniem autora', () => {
        expect(ROZWIN).toContain('class="tk-dymek" data-estelio="${estelio ? 1 : 0}"');
        for (const k of ['tk-dymek-kto', 'tk-dymek-tresc', 'tk-watek', 'tk-zal-label']) expect(ROZWIN).toContain(`class="${k}"`);
    });

    test('formularz: opis pod nagłówkiem ma klasę tk-wstep (szary tekst dostaje jaśniejszy odpowiednik w ciemnym)', () => {
        expect(INDEX).toContain('<p class="tk-wstep" style="color:#64748b; font-size:13px; margin:0 0 12px;">Błąd, prośba o zmianę');
    });

    test('reguły trybu ciemnego istnieją dla każdej klasy tk-* i pola #tk-auto, zawężone do #tickety', () => {
        const CSS = wyc('/* 🎫 Zgłoszenia do Estelio w trybie ciemnym — ticket #27', '/* koniec reguł ticketu #27 */');
        for (const k of ['tk-wstep', 'tk-meta', 'tk-czeka', 'tk-zamkniete', 'tk-pusto', 'tk-zal-label', 'tk-karta', 'tk-tytul', 'tk-opis', 'tk-odp', 'tk-odp-tresc', 'tk-odp-naglowek', 'tk-nowa', 'tk-watek', 'tk-dymek', 'tk-dymek-kto', 'tk-dymek-tresc']) {
            expect(CSS).toMatch(new RegExp('body\\.dark-mode #tickety [^{]*\\.' + k + '\\b'));
        }
        expect(CSS).toContain('body.dark-mode #tickety #tk-auto {');
        // tekst jasny na ciemnym: tytuł i treści nie mogą zostać w odcieniach ciemnoszarych
        expect(CSS).toMatch(/\.tk-tytul \{ color: #f8fafc !important; \}/);
        expect(CSS).toMatch(/\.tk-opis[^{]*\{ color: #e2e8f0 !important; \}/);
        // żadna reguła nie wychodzi poza sekcję zgłoszeń
        const selektory = CSS.split('\n').filter(l => l.startsWith('body.dark-mode'));
        expect(selektory.length).toBeGreaterThan(10);
        for (const l of selektory) for (const sel of l.split('{')[0].split(',').map(s => s.trim()).filter(Boolean)) expect(sel).toMatch(/^body\.dark-mode #tickety /);
    });

    test('globalna reguła ciemniąca białe tła nadal istnieje (karta zgłoszenia na niej polega w starszych widokach)', () => {
        expect(INDEX).toContain('body.dark-mode div[style*="background:#fff"]');
    });
});
