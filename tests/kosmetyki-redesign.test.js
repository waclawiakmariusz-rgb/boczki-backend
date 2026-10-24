// Redesign ekranu Administracja → Kosmetyki (Produkty i kosmetyki), 24.10.2026: strażnik zasady „zmienia się wyłącznie oprawa”.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'kosmetyki.css'), 'utf8');

const od = INDEX.indexOf('<div id="slownik" class="section');
const S = INDEX.slice(od, INDEX.indexOf('class="section', od + 40));
const mOd = INDEX.indexOf('<div id="edit-dict-overlay"');
const M = INDEX.slice(mOd, INDEX.indexOf('<div id="new-client-overlay"', mOd));
const fn = (nazwa, koniec) => { const a = INDEX.indexOf('function ' + nazwa); expect(a).toBeGreaterThan(-1); return INDEX.slice(a, INDEX.indexOf(koniec, a)); };

describe('Produkty i kosmetyki po redesignie — pola, lista i operacje bez zmian', () => {
    test('formularz dodawania: te same ID, ten sam onsubmit, select+input firmy przełączane tymi samymi funkcjami', () => {
        expect(od).toBeGreaterThan(-1);
        expect(S).toContain('<form onsubmit="dodajModel(event)">');
        expect(S).toContain('<select id="s_firma_select" onchange="obslugaWyboruFirmy()"></select>');
        expect(S).toMatch(/<input type="text" id="s_firma_input"[^>]*style="display:none;"/);
        expect(S).toMatch(/<input type="text" id="s_model" required/);
        expect(S).toMatch(/<input type="number" id="s_cena" step="0.01" placeholder="0.00"/);
        expect(S).toContain('onclick="przelaczTrybFirmy()"');
        expect(S).toContain("onclick=\"document.getElementById('s_firma_select').value=''; obslugaWyboruFirmy();");
        expect((S.match(/type="submit"/g) || []).length).toBe(1);
        for (const id of ['szukaj-slownik', 's_firma_select', 's_firma_input', 's_model', 's_cena', 'lista-slownik']) expect((S.match(new RegExp('id="' + id + '"', 'g')) || []).length).toBe(1);
    });
    test('wyszukiwarka: ten sam id i onkeyup → szukajWSlowniku; lista zostaje <ul id="lista-slownik" class="dict-list…">', () => {
        expect(S).toContain(`id="szukaj-slownik" onkeyup="_db('sl',()=>window.szukajWSlowniku())"`);
        expect(S).toMatch(/<ul id="lista-slownik" class="dict-list ksm-lista"><\/ul>/);
        expect(S).toContain('class="pk-slot" data-pomoc="kosmetyki.slownik"');
    });
    test('renderSlownik: te same dane (slownikCache), select z opcją NEW, wiersz <li class="dict-row"> z tymi samymi akcjami', () => {
        const r = fn('renderSlownik()', '\n}');
        expect(r).toContain(`s.innerHTML += '<option value="NEW">Nowa...</option>';`);
        expect(r).toContain('slownikCache.forEach(i => {');
        expect(r).toContain('<li class="dict-row">');
        expect(r).toContain(`onclick="edytujSlownikUI('\${fSafe}', '\${mSafe}', '\${cSafe}')"`);
        expect(r).toContain(`onclick="usunZeSlownikaUI('\${fSafe}', '\${mSafe}')"`);
        expect(r).toContain('escHtml(String(i.firma))');
        expect(r).toContain('l.innerHTML = htmlSl;');
    });
    test('dodajModel / zapiszEdycjeSlownika / usunZeSlownikaUI: te same pola i payloady; zmienione tylko etykieta i treść pytania', () => {
        const d = fn('dodajModel(e)', '\n}');
        for (const p of ["let f = (s.style.display !== 'none' && s.value !== 'NEW') ? s.value : i.value.trim();", "document.getElementById('s_model').value.trim()", "document.getElementById('s_cena').value", 'alert("Firma i Model są wymagane!")', "action: 'add_model'", 'btn.innerText = "Dodaj produkt";']) expect(d).toContain(p);
        expect(d).not.toContain('Dodaj do bazy');
        const z = fn('zapiszEdycjeSlownika(e)', '\n}');
        for (const p of ["action: 'edit_dictionary_entry'", "old_firma: document.getElementById('ed_old_firma').value", "new_cena: document.getElementById('ed_new_cena').value", 'btn.innerText = "Zapisz zmiany";']) expect(z).toContain(p);
        const u = fn('usunZeSlownikaUI(firmaEncoded, modelEncoded)', '\n}');
        expect(u).toMatch(/if \(!confirm\(`Usunąć produkt\?/);
        expect(u).toContain("action: 'delete_dictionary_entry'");
        expect(u).toContain('firma: firma,');
    });
    test('modal edycji: te same ID pól, onsubmit i zamykanie przez display=none', () => {
        expect(M).toContain('<form onsubmit="zapiszEdycjeSlownika(event)">');
        for (const id of ['ed_old_firma', 'ed_old_model', 'ed_new_firma', 'ed_new_model', 'ed_new_cena']) expect((M.match(new RegExp('id="' + id + '"', 'g')) || []).length).toBe(1);
        expect(M).toMatch(/<input type="text" id="ed_new_firma" required class="form-control"/);
        expect(M).toMatch(/<input type="number" id="ed_new_cena" step="0.01" class="form-control"/);
        expect((M.match(/document\.getElementById\('edit-dict-overlay'\)\.style\.display='none'/g) || []).length).toBe(2);
        expect((M.match(/type="submit"/g) || []).length).toBe(1);
    });
    test('zniknęły elementy, których makieta nie ma; CSS podpięty', () => {
        expect(S).not.toContain('class="btn-primary"');
        expect(S).not.toContain('Dodaj do bazy');
        expect(S).not.toContain('Kreator Produktu');
        expect(INDEX).toContain('<link rel="stylesheet" href="/kosmetyki.css?v=__WERSJA_PLIKOW__">');
    });
    test('każdy selektor CSS zawężony do .estelio-cosmetics', () => {
        const zle = [];
        CSS.split(/\r?\n/).forEach((l, i) => {
            const t = l.trim();
            if (!t || t.startsWith('/*') || t.startsWith('@') || t.startsWith('}') || t.startsWith('--') || !t.includes('{')) return;
            t.slice(0, t.indexOf('{')).split(',').map(s => s.trim()).filter(Boolean).forEach(s => { if (!/^(body\.dark-mode )?\.estelio-cosmetics\b/.test(s)) zle.push((i + 1) + ': ' + s); });
        });
        expect(zle).toEqual([]);
    });
});
