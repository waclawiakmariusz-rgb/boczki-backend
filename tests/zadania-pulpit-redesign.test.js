// Redesign widgetu Zadań na Pulpicie i formularza zadania (26.10.2026): strażnik znacznika, nadpisań i zawężenia CSS.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'zadania-pulpit.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'zadania-pulpit.js'), 'utf8');
const wyc = (od, doTxt) => { const a = INDEX.indexOf(od); expect(a).toBeGreaterThan(-1); return INDEX.slice(a, INDEX.indexOf(doTxt, a)); };

describe('widget Zadań na Pulpicie', () => {
    const W = wyc('<section class="ds-frame-card estelio-tasks" id="ds-zadania-section"', '<!-- Szybki dostęp');
    test('te same ID nośne (sekcja, tytuł, licznik, lista, przycisk dodawania, zlecone) + nowe kontrolki dokładnie raz', () => {
        for (const id of ['ds-zadania-section', 'ds-zadania-title', 'ds-zadania-count', 'ds-zadania-summary', 'ds-zadania-add-btn', 'ds-zadania-body', 'ds-zadania-banner', 'ds-zadania-tabs', 'ds-zadania-list', 'ds-zadania-search', 'ds-zadania-zlecone-wrap', 'ds-zadania-zlecone-list', 'ds-zadania-moje', 'ds-zadania-obszar', 'ds-zadania-zakres', 'ds-zadania-clear', 'ds-zadania-szablony', 'ds-zadania-szablony-btn', 'ds-zadania-chevron']) {
            expect((W.match(new RegExp('id="' + id + '"', 'g')) || []).length).toBe(1);
        }
        expect(W).toContain('onclick="zd_addOpen();"');
        expect(W).toContain('onchange="ds_zd_setMoje(this.checked)"');
        for (const v of ['ALL', 'KLIENT', 'MAGAZYN', 'KOSMETYK', 'SPRZEDAZ', 'INNE']) expect(W).toContain(`<option value="${v}">`);
        expect(W).not.toContain('📋'); expect(W).not.toContain('🔍');
    });
    test('JS nadpisuje funkcje widgetu i trzyma zasady: Tylko moje = przypisani, Wszystkie domyślnie, bez tel: dla pustego numeru', () => {
        for (const f of ['ds_zd_renderTabs', 'ds_zd_renderList', 'ds_zd_renderTaskCard', 'ds_zd_toggleMore', 'ds_zadanieComplete', 'ds_zd_updateCollapsedSummary', 'ds_zd_applyCollapseState', 'zd_addOpen', 'zd_editOpen', 'zd_save']) expect(JS).toContain('window.' + f + ' = ');
        expect(JS).toContain("var F = { rodzaj: 'ALL', moje: false, obszar: 'ALL', q: '' }");
        expect(JS).toMatch(/function jestMoje\(z\)[\s\S]*przypisani\(z\)/);
        expect(JS).not.toMatch(/jestMoje[\s\S]{0,300}utworzone_przez/);
        expect(JS).toMatch(/z\.telefon \? '<a class="et-call" href="tel:'/);
        expect(JS).toContain("action: 'wynik_rozmowy'"); expect(JS).toContain("action: 'przeloz'"); expect(JS).toContain("action: 'kontakt_szukaj'"); expect(JS).toContain("action: 'historia'");
        expect(JS).toContain("rodzaj: rodz, telefon: rodz === 'TELEFON' ? telefon : ''");
        expect(JS).toContain("action: 'complete'");
        expect(INDEX).toContain('<link rel="stylesheet" href="/zadania-pulpit.css?v=__WERSJA_PLIKOW__">');
        expect(INDEX).toContain('<script src="/zadania-pulpit.js?v=__WERSJA_PLIKOW__" defer></script>');
    });
});

describe('formularz zadania (modal)', () => {
    const M = wyc('<div id="zd-modal-overlay"', '<div id="kreator_dostepow"');
    test('wszystkie dotychczasowe ID i wywołania zostały; nowe pola dokładnie raz; kolejność: rodzaj → tytuł → kontakt → termin → obszary → Więcej', () => {
        for (const id of ['zd-modal-title', 'zd-edit-id', 'zd-edit-szablon-banner', 'zd-tytul', 'zd-opis', 'zd-klient-suggest', 'zd-kategorie-badges', 'zd-priorytet', 'zd-przypisani-badges', 'zd-przypisane-source', 'zd-deadline', 'zd-powtarzaj', 'zd-powtarzaj-co-wrap', 'zd-powtarzaj-co-label', 'zd-powtarzaj-co', 'zd-powtarzaj-dzien-wrap', 'zd-powtarzaj-dzien-label', 'zd-powtarzaj-dzien', 'zd-magazyn-badges', 'zd-magazyn-search-wrap', 'zd-magazyn-search', 'zd-magazyn-results', 'zd-add-magazyn-btn', 'zd-klienci-badges', 'zd-klient-search-wrap', 'zd-klient-search', 'zd-klient-results', 'zd-add-klient-btn',
            'zd-telefon-wrap', 'zd-kontakt-search', 'zd-kontakt-results', 'zd-kontakt-wybrany', 'zd-kontakt-typ', 'zd-kontakt-id', 'zd-kontakt-nazwa', 'zd-telefon', 'zd-wiecej', 'zd-wiecej-summary', 'zd-save-btn', 'zd-termin-hint']) {
            expect((M.match(new RegExp('id="' + id + '"', 'g')) || []).length).toBe(1);
        }
        for (const h of ['onsubmit="event.preventDefault(); zd_save();"', 'oninput="zd_autoSuggest()"', 'onchange="zd_powtarzajChange()"', 'onclick="zd_magShowSearch()"', 'onclick="zd_showKlientSearch()"', 'oninput="zd_klientSearchInput()"', 'onkeydown="zd_magSearchKey(event)"', 'onclick="zd_modalClose()"', 'list="lista-klientow"']) expect(M).toContain(h);
        expect((M.match(/name="zd-rodzaj"/g) || []).length).toBe(2);
        expect(M).toContain('value="TELEFON"'); expect(M).toContain('value="DO_ZROBIENIA" checked');
        const kol = ['name="zd-rodzaj"', 'id="zd-tytul"', 'id="zd-telefon-wrap"', 'id="zd-deadline"', 'id="zd-kategorie-badges"', 'id="zd-wiecej"', 'id="zd-przypisani-badges"', 'id="zd-powtarzaj"'].map(s => M.indexOf(s));
        expect(kol).toEqual(kol.slice().sort((a, b) => a - b));
        for (const v of ['NORMALNY', 'WAZNY', 'PILNY', 'NIE', 'CODZIENNIE', 'TYGODNIOWO', 'MIESIECZNIE']) expect(M).toContain(`<option value="${v}">`);
        for (const b of ['zd_terminSzybki(\'dzis\')', 'zd_terminSzybki(\'jutro\')', 'zd_terminSzybki(\'tydzien\')', 'zd_terminSzybki(\'brak\')']) expect(M).toContain(b);
    });
});

test('każdy selektor CSS zawężony do .estelio-tasks / .estelio-task-form', () => {
    const zle = [];
    CSS.split(/\r?\n/).forEach((l, i) => {
        const t = l.trim();
        if (!t || t.startsWith('/*') || t.startsWith('@') || t.startsWith('}') || t.startsWith('--') || !t.includes('{')) return;
        t.slice(0, t.indexOf('{')).split(',').map(s => s.trim()).filter(Boolean).forEach(s => { if (!/^(body\.dark-mode )?\.estelio-(tasks|task-form)\b/.test(s)) zle.push((i + 1) + ': ' + s); });
    });
    expect(zle).toEqual([]);
});
