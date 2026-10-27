// Inwentaryzacja (27.10.2026): produkt z apostrofem w nazwie („Purles 108 Godess' Cream”) miał martwe przyciski X / − / +,
// bo encodeURIComponent nie koduje apostrofu, a parametry onclick stoją w pojedynczych cudzysłowach.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const F = INDEX.slice(INDEX.indexOf('function renderInwentaryzacja('), INDEX.indexOf('function zmienGrupowo('));

test('parametry onclick kodowane z apostrofem jako %27 (nazwa i kategoria)', () => {
    expect(F).toContain("const safeNazwa = encodeURIComponent(g.nazwa).replace(/'/g, '%27');");
    expect(F).toContain("const safeKat = encodeURIComponent(g.kategoria).replace(/'/g, '%27');");
    expect(F).toContain(`onclick="usunGrupowo('\${safeNazwa}', '\${safeKat}')"`);
    expect(F).toContain(`onclick="zmienGrupowo('\${safeNazwa}', '\${safeKat}', -1)"`);
});

test('nazwy z apostrofem, cudzysłowem i ukośnikiem dają poprawny składniowo onclick i wracają bez zmian po decodeURIComponent', () => {
    const koduj = (s) => encodeURIComponent(s).replace(/'/g, '%27');
    const wywolania = [];
    const usunGrupowo = (n, k) => wywolania.push([decodeURIComponent(n), decodeURIComponent(k)]);
    for (const nazwa of ["Purles 108 Godess' Cream", 'Krem "Night" 50 ml', "O'Neill \\ test", 'Zwykły krem (A+B) & spółka']) {
        const onclick = `usunGrupowo('${koduj(nazwa)}', '${koduj("Detal 'pro'")}')`;
        expect(koduj(nazwa)).not.toContain("'"); // żaden surowy apostrof w zakodowanym parametrze
        new Function('usunGrupowo', onclick)(usunGrupowo); // parsuje się i wykonuje
        expect(wywolania.pop()).toEqual([nazwa, "Detal 'pro'"]);
    }
});
