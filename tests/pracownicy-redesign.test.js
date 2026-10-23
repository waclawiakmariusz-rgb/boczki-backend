// Redesign ekranu Administracja → Pracownicy (23.10.2026): strażnik zasady „zmienia się wyłącznie oprawa”.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'pracownicy.css'), 'utf8');

const od = INDEX.indexOf('<div id="setup-pracownicy" class="section');
const S = INDEX.slice(od, INDEX.indexOf('<div id="setup-sugestie"', od));

describe('Pracownicy po redesignie — pola, lista i operacje bez zmian', () => {
    test('formularz: #def_prac required, onsubmit dodajDefinicje(event, Pracownik), jeden submit', () => {
        expect(od).toBeGreaterThan(-1);
        expect(S).toContain(`<form onsubmit="dodajDefinicje(event, 'Pracownik')">`);
        expect(S).toMatch(/<input type="text" id="def_prac" required/);
        expect((S.match(/type="submit"/g) || []).length).toBe(1);
        expect((S.match(/id="def_prac"/g) || []).length).toBe(1);
    });
    test('lista #pracownicy-list istnieje raz; licznik #pracownicy-licznik', () => {
        expect((S.match(/id="pracownicy-list"/g) || []).length).toBe(1);
        expect(S).toContain('id="pracownicy-licznik"');
    });
    test('pomoc kontekstowa admin.pracownicy zostaje', () => {
        expect(S).toContain('class="pk-slot" data-pomoc="admin.pracownicy"');
    });
    test('render listy: te same dane, usunPracownika(imie) jak dotąd, nazwa przez escHtml', () => {
        const r = INDEX.slice(INDEX.indexOf("const listPrac = document.getElementById('pracownicy-list');"), INDEX.indexOf('// Kategorie zabiegów (Kreator)'));
        expect(r).toContain('d.pracownicy.forEach(p => {');
        expect(r).toContain(`onclick="usunPracownika('\${p}')"`);
        expect(r).toContain('${escHtml(p)}');
        expect(r).toContain('listPrac.innerHTML = htmlList;');
        expect(r).toContain("licznikPrac.textContent = String(d.pracownicy.length)");
    });
    test('dodajDefinicje wysyła add_sales_def z wartością z #def_prac i czyści pole po odpowiedzi', () => {
        const f = INDEX.slice(INDEX.indexOf('function dodajDefinicje(e, typ)'), INDEX.indexOf('function pobierzLogi()'));
        expect(f).toContain("p.action = 'add_sales_def';");
        expect(f).toContain("p.wartosc = document.getElementById('def_prac').value;");
        expect(f).toContain("if(typ==='Pracownik') document.getElementById('def_prac').value='';");
        expect(f).toContain('alert(d.message);');
    });
    test('usunPracownika: nadal confirm → delete_employee z imieniem; zmieniona tylko treść pytania', () => {
        const u = INDEX.slice(INDEX.indexOf('function usunPracownika(imie)'), INDEX.indexOf('function toggleDefKat'));
        expect(u).toMatch(/if\(confirm\("Usunąć pracownika\?/);
        expect(u).toContain("action:'delete_employee', imie, pracownik:currentUser");
        expect(u).toContain('pobierzSlownikSprzedazy(true);');
    });
    test('zniknęły elementy, których makieta nie ma; CSS podpięty', () => {
        expect(S).not.toContain('class="btn-primary"');
        expect(S).not.toContain('Imię i Nazwisko:');
        expect(INDEX).toContain('<link rel="stylesheet" href="/pracownicy.css?v=__WERSJA_PLIKOW__">');
    });
    test('każdy selektor CSS zawężony do .est-employees', () => {
        const zle = [];
        CSS.split(/\r?\n/).forEach((l, i) => {
            const t = l.trim();
            if (!t || t.startsWith('/*') || t.startsWith('@') || t.startsWith('}') || t.startsWith('--') || !t.includes('{')) return;
            t.slice(0, t.indexOf('{')).split(',').map(s => s.trim()).filter(Boolean).forEach(s => { if (!/^(body\.dark-mode )?\.est-employees\b/.test(s)) zle.push((i + 1) + ': ' + s); });
        });
        expect(zle).toEqual([]);
    });
});
