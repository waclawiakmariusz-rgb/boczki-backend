// Redesign ekranu Magazyn → Nowy produkt / Edycja (23.10.2026): strażnik zasady „zmienia się wyłącznie oprawa”.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'magazyn-produkt.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'magazyn-produkt.js'), 'utf8');

const od = INDEX.indexOf('<div id="rap_add" class="section rap_view-section');
const S = INDEX.slice(od, INDEX.indexOf('<div id="', od + 10) > 0 ? INDEX.indexOf('<div id="rap_', od + 40) : undefined);
function fn(nazwa) { const a = INDEX.indexOf('function ' + nazwa + '('); expect(a).toBeGreaterThan(-1); return INDEX.slice(a, INDEX.indexOf('\n}', a)); }

describe('Magazyn → Nowy produkt po redesignie — pola i zapis bez zmian', () => {
    test('sekcja zachowuje id, klasę rap_view-section i formularz z tym samym onsubmit', () => {
        expect(od).toBeGreaterThan(-1);
        expect(S).toContain('<form id="rap_product-form" class="ei-card" onsubmit="rap_zapiszProdukt(event)">');
        expect((S.match(/<form\b/g) || []).length).toBe(1);
    });
    test('wszystkie ID pól istnieją dokładnie raz, z tymi samymi atrybutami walidacji', () => {
        for (const id of ['rap_p_id', 'rap_p_cat', 'rap_p_name', 'rap_p_qty', 'rap_p_unit', 'rap_p_min', 'rap_p_expiration', 'rap_p_price']) {
            expect((S.match(new RegExp('id="' + id + '"', 'g')) || []).length).toBe(1);
        }
        expect(S).toContain('<input type="hidden" id="rap_p_id">');
        expect(S).toMatch(/<select id="rap_p_cat" required class="modern-form-control[^"]*"[^>]*><option value="">Wybierz...<\/option><\/select>/);
        expect(S).toMatch(/<input type="text" id="rap_p_name" required class="modern-form-control"/);
        expect(S).toMatch(/<input type="number" id="rap_p_qty" value="0" step="0.1" inputmode="decimal" class="modern-form-control">/);
        expect(S).toMatch(/<input type="text" id="rap_p_unit" class="modern-form-control"/);
        expect(S).toMatch(/<input type="number" id="rap_p_min" value="5" step="0.1" inputmode="decimal" class="modern-form-control">/);
        expect(S).toMatch(/<input type="date" id="rap_p_expiration" class="modern-form-control">/);
        expect(S).toMatch(/<input type="number" id="rap_p_price" step="0.01" inputmode="decimal" placeholder="0.00" class="modern-form-control">/);
    });
    test('jedyny submit w formularzu; Anuluj i wyzwalacz kategorii to type=button', () => {
        expect((S.match(/type="submit"/g) || []).length).toBe(1);
        expect(S).toMatch(/<button type="button" class="ei-button ei-secondary" data-ei-anuluj>Anuluj<\/button>/);
        expect(S).toMatch(/<button type="button" class="ei-category-trigger" data-ei-trigger/);
    });
    test('pomoc kontekstowa magazyn.pro.produkt.nowy zostaje', () => {
        expect(S).toContain('class="pk-slot" data-pomoc="magazyn.pro.produkt.nowy"');
    });
    test('zniknęły elementy, których makieta nie ma', () => {
        expect(S).not.toContain('ZAPISZ PRODUKT');
        expect(S).not.toContain('class="btn-primary"');
        expect(S).not.toContain('Próg Alarmowy');
    });
    test('handlery rap_zapiszProdukt / rap_edit / rap_resetProdForm czytają i piszą te same pola', () => {
        const Z = fn('rap_zapiszProdukt');
        for (const p of ["id: document.getElementById('rap_p_id').value", "category: document.getElementById('rap_p_cat').value", "nazwa: document.getElementById('rap_p_name').value", "ilosc: document.getElementById('rap_p_qty').value", "unit: document.getElementById('rap_p_unit').value", "min: document.getElementById('rap_p_min').value", "price_gross: document.getElementById('rap_p_price').value", "expiration: document.getElementById('rap_p_expiration').value", 'userFull: currentUser', "rap_apiCall('rap_saveProduct', payload)", 'alert("✅ Zapisano produkt!");', "pokaz('rap_magazyn');"]) expect(Z).toContain(p);
        const E = fn('rap_edit'); expect(E).toContain("pokaz('rap_add');"); expect(E).toContain("document.getElementById('rap_p_id').value = r[0];");
        const R = fn('rap_resetProdForm'); expect(R).toContain("document.getElementById('rap_product-form').reset();");
    });
    test('pliki oprawy podpięte z markerem wersji', () => {
        expect(INDEX).toContain('<link rel="stylesheet" href="/magazyn-produkt.css?v=__WERSJA_PLIKOW__">');
        expect(INDEX).toContain('<script src="/magazyn-produkt.js?v=__WERSJA_PLIKOW__" defer></script>');
    });
    test('magazyn-produkt.js nie ma drogi do API ani własnych danych kategorii', () => {
        for (const z of ['fetch(', 'XMLHttpRequest', 'API_URL', 'rap_apiCall', 'action:', 'rap_categoriesFlat', 'localStorage']) expect(JS).not.toContain(z);
        // kategorie wyłącznie z opcji istniejącego selectu
        expect(JS).toContain('select.options');
        expect(JS).toContain("select.dispatchEvent(new Event('change'");
    });
    test('każdy selektor CSS zawężony do .estelio-inventory', () => {
        const zle = [];
        CSS.split(/\r?\n/).forEach((l, i) => {
            const t = l.trim();
            if (!t || t.startsWith('/*') || t.startsWith('@') || t.startsWith('}') || t.startsWith('--') || !t.includes('{')) return;
            t.slice(0, t.indexOf('{')).split(',').map(s => s.trim()).filter(Boolean).forEach(s => { if (!/^(body\.dark-mode )?\.estelio-inventory\b/.test(s)) zle.push((i + 1) + ': ' + s); });
        });
        expect(zle).toEqual([]);
    });
});
