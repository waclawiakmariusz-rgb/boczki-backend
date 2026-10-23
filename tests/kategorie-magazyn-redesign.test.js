// Redesign ekranu Magazyn → Kategorie (23.10.2026): strażnik zasady „zmienia się wyłącznie oprawa”.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'kategorie-magazyn.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'kategorie-magazyn.js'), 'utf8').split(/\r?\n/).filter(l => !l.trim().startsWith('//')).join('\n'); // bez linii komentarza

const od = INDEX.indexOf('<div id="rap_categories" class="section rap_view-section');
const S = INDEX.slice(od, INDEX.indexOf('class="section rap_view-section', od + 40));
const fn = (nazwa, koniec) => { const a = INDEX.indexOf('function ' + nazwa); expect(a).toBeGreaterThan(-1); return INDEX.slice(a, INDEX.indexOf(koniec, a)); };

describe('Kategorie magazynowe po redesignie — formularz, drzewo i operacje bez zmian', () => {
    test('formularz: #rap_cat-form z tym samym onsubmit, #rap_c_name required, #rap_c_parent z opcją poziomu głównego', () => {
        expect(od).toBeGreaterThan(-1);
        expect(S).toContain('<form id="rap_cat-form" onsubmit="rap_zapiszKategorie(event)">');
        expect(S).toMatch(/<input type="text" id="rap_c_name" required class="modern-form-control"/);
        expect(S).toMatch(/<select id="rap_c_parent" class="modern-form-control[^"]*"[^>]*><option value="">-- Kategoria Główna --<\/option><\/select>/);
        expect((S.match(/type="submit"/g) || []).length).toBe(1);
        expect((S.match(/id="rap_tree-container"/g) || []).length).toBe(1);
    });
    test('rap_zapiszKategorie czyta te same pola i woła rap_saveCategory; jedyna zmiana to etykieta przycisku', () => {
        const f = fn('rap_zapiszKategorie(e)', '\n}');
        expect(f).toContain("name: document.getElementById('rap_c_name').value");
        expect(f).toContain("parentId: document.getElementById('rap_c_parent').value");
        expect(f).toContain("rap_apiCall('rap_saveCategory'");
        expect(f).toContain('alert("✅ Dodano Kategorię!");');
        expect(f).toContain('btn.innerText = "Dodaj kategorię";');
        expect(f).not.toContain('DODAJ KATEGORIĘ');
    });
    test('drzewo: te same trzy akcje wołane z tymi samymi argumentami, dane z rap_categoriesFlat, nazwy przez esc()', () => {
        const r = fn('rap_renderCategoryTree()', '\n}');
        expect(r).toContain("rap_zmienNazweKategorii('${x.id}', '${esc(x.name).replace(/'/g, \"\\\\'\")}')");
        expect(r).toContain("rap_przeniesKategorie('${x.id}', '${esc(x.sciezka).replace(/'/g, \"\\\\'\")}')");
        expect(r).toContain("rap_deleteCategory('${x.id}')");
        expect(r).toContain('[...rap_categoriesFlat]');
        expect(r).toContain('${esc(x.name)}');
        expect(r).toContain('c.innerHTML = korzen.length ? g(korzen, 0)');
        // akcje to zwykłe przyciski type=button (nie submit)
        expect(r).toContain('<button type="button" class="kat-akcja');
    });
    test('operacje rename / move / delete nietknięte', () => {
        const z = fn('rap_zmienNazweKategorii(id, obecna)', '\n}');
        expect(z).toContain("const nazwa = prompt('Nowa nazwa kategorii:', obecna);");
        expect(z).toContain("rap_apiCall('rap_editCategory', { id, nazwa: czysta })");
        const p = fn('rap_przeniesKategorie(id, sciezka)', '\n}');
        expect(p).toContain("rap_apiCall('rap_editCategory', { id, parentId })");
        expect(p).toContain("!(c.sciezka + ' > ').startsWith(sciezka + ' > ')");
        const d = fn('rap_deleteCategory(id)', '\n}');
        expect(d).toContain('if(confirm("⚠️ Czy na pewno usunąć tę kategorię?"))');
        expect(d).toContain("rap_apiCall('rap_deleteCategory', {id: id})");
    });
    test('zniknęły elementy, których makieta nie ma; pliki oprawy podpięte', () => {
        expect(S).not.toContain('DODAJ KATEGORIĘ');
        expect(S).not.toContain('class="btn-primary"');
        expect(S).not.toContain('📂');
        expect(INDEX).toContain('<link rel="stylesheet" href="/kategorie-magazyn.css?v=__WERSJA_PLIKOW__">');
        expect(INDEX).toContain('<script src="/kategorie-magazyn.js?v=__WERSJA_PLIKOW__" defer></script>');
    });
    test('kategorie-magazyn.js nie ma drogi do API ani własnych danych kategorii', () => {
        for (const z of ['fetch(', 'XMLHttpRequest', 'API_URL', 'rap_apiCall', 'action:', 'rap_categoriesFlat', 'localStorage', 'innerHTML +=']) expect(JS).not.toContain(z);
        expect(JS).toContain('select.options');
        expect(JS).toContain("select.dispatchEvent(new Event('change'");
    });
    test('każdy selektor CSS zawężony do .est-categories', () => {
        const zle = [];
        CSS.split(/\r?\n/).forEach((l, i) => {
            const t = l.trim();
            if (!t || t.startsWith('/*') || t.startsWith('@') || t.startsWith('}') || t.startsWith('--') || !t.includes('{')) return;
            t.slice(0, t.indexOf('{')).split(',').map(s => s.trim()).filter(Boolean).forEach(s => { if (!/^(body\.dark-mode )?\.est-categories\b/.test(s)) zle.push((i + 1) + ': ' + s); });
        });
        expect(zle).toEqual([]);
    });
});
