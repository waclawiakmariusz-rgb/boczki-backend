// Ticket #28 (Gosia, 14.11.2026): „przy wprowadzaniu nowego zadania docelowo było ono przyporządkowane całej recepcji, nie tylko
// zalogowanej osoby”. Domyślne przypisanie liczy public/zadania-pulpit.js (domyslnePrzypisanie, wołane z nadpisanego zd_addOpen).
// Strażnik: recepcja → rola grupowa „recepcja”; inne role → zalogowana osoba; istniejące przypisania nie są nadpisywane.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'zadania-pulpit.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Wycinamy same funkcje pomocnicze i uruchamiamy je z udawanym localStorage/DOM — bez przeglądarki.
function zbuduj(rola, imie, przypisaniStart, opcje) {
    const od = JS.indexOf('  function domyslnyPrzypisany()');
    const do_ = JS.indexOf('  var _addOpen = window.zd_addOpen');
    expect(od).toBeGreaterThan(-1); expect(do_).toBeGreaterThan(od);
    const fragment = JS.slice(od, do_);
    const store = { boczki_pracownik_rola: rola, boczki_pracownik_imie: imie };
    const sel = { options: (opcje || []).map(v => ({ value: v })), appendChild(o) { this.options.push(o); } };
    const ctx = {
        ls: (k) => store[k] || '',
        mojaRola: () => (store.boczki_pracownik_rola || '').trim().toLowerCase(),
        $: (id) => (id === 'zd-przypisane-source' ? sel : null),
        document: { createElement: () => ({ dataset: {} }) },
        Array,
        zd_przypisani: przypisaniStart.slice(),
        zd_renderPrzypisaniBadges: () => { ctx.renderowano = true; },
    };
    vm.createContext(ctx);
    vm.runInContext(fragment + '\ndomyslnePrzypisanie();', ctx);
    return { przypisani: ctx.zd_przypisani, opcje: sel.options.map(o => o.value), renderowano: !!ctx.renderowano };
}

describe('ticket #28 — domyślne przypisanie nowego zadania', () => {
    test('recepcja: nowe zadanie startuje z rolą grupową „recepcja” (nie z imieniem wpisującej)', () => {
        const r = zbuduj('Recepcja', 'Gosia', [], ['recepcja', 'Gosia']);
        expect(r.przypisani).toEqual(['recepcja']);
        expect(r.renderowano).toBe(true);
    });
    test('recepcja bez opcji „recepcja” na liście: opcja jest dokładana z czytelną etykietą', () => {
        const r = zbuduj('recepcja', 'Gosia', [], ['Gosia']);
        expect(r.przypisani).toEqual(['recepcja']);
        expect(r.opcje).toContain('recepcja');
    });
    test('manager i kosmetolog: bez zmian — domyślnie zalogowana osoba', () => {
        expect(zbuduj('Manager', 'Ola', [], ['Ola']).przypisani).toEqual(['Ola']);
        expect(zbuduj('kosmetolog', 'Ania', [], []).przypisani).toEqual(['Ania']);
    });
    test('już wybrane przypisania nie są nadpisywane (edycja, ponowne otwarcie)', () => {
        expect(zbuduj('recepcja', 'Gosia', ['Marta'], ['recepcja', 'Marta']).przypisani).toEqual(['Marta']);
    });
    test('brak zalogowanej osoby i roli: nic nie podstawiamy', () => {
        expect(zbuduj('', '', [], []).przypisani).toEqual([]);
    });
    test('serwer pozwala recepcji zlecać roli „recepcja”, a lista wyboru recepcji ma tę opcję', () => {
        const ZAD = fs.readFileSync(path.join(__dirname, '..', 'routes', 'zadania.js'), 'utf8');
        expect(ZAD).toMatch(/RECEPCJA_DOZWOLONE_ROLE\s*=\s*\[[^\]]*'recepcja'/);
        expect(INDEX).toContain(`<option value="recepcja" data-ico="📞">📞 Recepcja (cała rola)</option>`);
    });
});
