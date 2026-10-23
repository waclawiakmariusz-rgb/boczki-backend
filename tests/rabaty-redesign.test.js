// Redesign ekranu „Rabaty” (23.10.2026): strażnik zasady „zmienia się wyłącznie oprawa”.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'rabaty.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'rabaty.js'), 'utf8');

const od = INDEX.indexOf('<div id="sekcja-kreator-rabatow"');
const S = INDEX.slice(od, INDEX.indexOf('<!-- ═', od));
const fOd = INDEX.indexOf('function zapiszDefinicjeRabatu()');
const F = INDEX.slice(fOd, INDEX.indexOf('\n}', fOd));

describe('Rabaty po redesignie — ID, kontrolki i zapis bez zmian', () => {
    test('ID pól i listy istnieją dokładnie raz', () => {
        for (const id of ['rabat-nazwa', 'rabat-typ', 'rabat-wartosc', 'lista-rabatow-podglad']) {
            expect((S.match(new RegExp('id="' + id + '"', 'g')) || []).length).toBe(1);
        }
    });
    test('select typu ma te same wartości PROCENT/KWOTA i jest źródłem dla zapisu', () => {
        expect(S).toContain('<option value="PROCENT">');
        expect(S).toContain('<option value="KWOTA">');
        expect(F).toContain("const typ = document.getElementById('rabat-typ').value;");
        // segmenty radio mapują się 1:1 na te wartości
        expect(S).toContain('name="rb-typ-segment" value="PROCENT" checked');
        expect(S).toContain('name="rb-typ-segment" value="KWOTA"');
    });
    test('jedyny przycisk zapisu woła zapiszDefinicjeRabatu(), a handler celuje właśnie w niego', () => {
        expect((S.match(/onclick="zapiszDefinicjeRabatu\(\)"/g) || []).length).toBe(1);
        expect(F).toContain(`document.querySelector('#sekcja-kreator-rabatow button[onclick="zapiszDefinicjeRabatu()"]')`);
    });
    test('payload add_discount_def ma te same pola', () => {
        for (const p of ["action: 'add_discount_def'", 'nazwa: nazwa,', 'typ: typ,', 'wartosc: wartosc,', 'pracownik: currentUser']) expect(F).toContain(p);
        expect(F).toContain('alert("⛔ Uzupełnij nazwę i wartość rabatu!");');
    });
    test('pomoc kontekstowa admin.rabaty zostaje', () => {
        expect(S).toContain('class="pk-slot" data-pomoc="admin.rabaty"');
    });
    test('zniknęły elementy, których makieta nie ma', () => {
        expect(S).not.toContain('ZAPISZ NOWY RABAT');
        expect(S).not.toContain('#8b5cf6');
        expect(S).not.toContain('Kreator Rabatów');
    });
    test('pliki oprawy podpięte z markerem wersji', () => {
        expect(INDEX).toContain('<link rel="stylesheet" href="/rabaty.css?v=__WERSJA_PLIKOW__">');
        expect(INDEX).toContain('<script src="/rabaty.js?v=__WERSJA_PLIKOW__" defer></script>');
    });
    test('rabaty.js nie ma drogi do API ani do zapisu', () => {
        for (const z of ['fetch(', 'XMLHttpRequest', 'API_URL', 'action:', 'innerHTML', 'rabatyCache']) expect(JS).not.toContain(z);
    });
    test('każdy selektor CSS zawężony do .estelio-discounts', () => {
        const zle = [];
        CSS.split(/\r?\n/).forEach((l, i) => {
            const t = l.trim();
            if (!t || t.startsWith('/*') || t.startsWith('@') || t.startsWith('}') || t.startsWith('--') || !t.includes('{')) return;
            t.slice(0, t.indexOf('{')).split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
                if (!/^(body\.dark-mode )?\.estelio-discounts\b/.test(s)) zle.push((i + 1) + ': ' + s);
            });
        });
        expect(zle).toEqual([]);
    });
});
