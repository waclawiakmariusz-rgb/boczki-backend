// Redesign ekranu Administracja → Sugestie (24.10.2026): strażnik zasady „zmienia się wyłącznie oprawa”.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'sugestie.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'sugestie.js'), 'utf8').split(/\r?\n/).filter(l => !l.trim().startsWith('//')).join('\n');

const od = INDEX.indexOf('<div id="setup-sugestie" class="section');
const S = INDEX.slice(od, INDEX.indexOf('<div id="ranking-klientow"', od));
const fn = (nazwa, koniec) => { const a = INDEX.indexOf('function ' + nazwa); expect(a).toBeGreaterThan(-1); return INDEX.slice(a, INDEX.indexOf(koniec, a)); };

describe('Sugestie po redesignie — pola, lista i operacje bez zmian', () => {
    test('trzy pola biznesowe z tymi samymi ID; datalist bez zmian (dowolny tekst, jak dotąd)', () => {
        expect(od).toBeGreaterThan(-1);
        for (const id of ['sug_matka', 'sug_dziecko', 'sug_opis', 'lista-zabiegow-sugestie', 'lista-regul-sugestii']) expect((S.match(new RegExp('id="' + id + '"', 'g')) || []).length).toBe(1);
        expect(S).toMatch(/<input type="text" id="sug_matka" list="lista-zabiegow-sugestie" class="form-control"/);
        expect(S).toMatch(/<input type="text" id="sug_dziecko" list="lista-zabiegow-sugestie" class="form-control"/);
        expect(S).toMatch(/<textarea id="sug_opis" class="form-control"/);
        expect(S).toContain('<datalist id="lista-zabiegow-sugestie"></datalist>');
    });
    test('przycisk zapisu woła zapiszReguleSugestii() i nie jest submitem; pomoc admin.sugestie zostaje', () => {
        expect(S).toMatch(/<button type="button" onclick="zapiszReguleSugestii\(\)" class="sug-primary">Dodaj regułę<\/button>/);
        expect(S).not.toContain('type="submit"');
        expect(S).toContain('class="pk-slot" data-pomoc="admin.sugestie"');
    });
    test('zapiszReguleSugestii: te same pola, walidacja i payload add_suggestion_rule; zmieniona tylko etykieta', () => {
        const f = fn('zapiszReguleSugestii()', '\n}');
        for (const p of ["document.getElementById('sug_matka').value", "document.getElementById('sug_dziecko').value", "document.getElementById('sug_opis').value", 'alert("Wybierz oba zabiegi!")', `alert("Zabieg 'Matka' i 'Dziecko' muszą być różne!")`, "action: 'add_suggestion_rule'", 'pracownik: currentUser', 'btn.innerText = "Zapisywanie..."', 'btn.innerText = "Dodaj regułę"']) expect(f).toContain(p);
        expect(f).not.toContain('Zapisz Regułę');
    });
    test('usunRegule: nadal confirm → delete_suggestion_rule {matka, dziecko}; zmieniona tylko treść pytania', () => {
        const u = fn('usunRegule(matka, dziecko)', '\n}');
        expect(u).toMatch(/if\(!confirm\("Usunąć tę regułę\?/);
        expect(u).toContain("action: 'delete_suggestion_rule'");
        expect(u).toContain('matka: matka,');
        expect(u).toContain('dziecko: dziecko');
    });
    test('render listy: te same dane (regulyCache), ten sam usunRegule, nazwy przez escHtml', () => {
        const r = fn('renderKreatorSugestii()', '\n}');
        expect(r).toContain('regulyCache.forEach(r => {');
        expect(r).toContain(`onclick="usunRegule('\${r.matka}', '\${r.dziecko}')"`);
        expect(r).toContain("escHtml(String(r.matka || ''))");
        expect(r).toContain('div.innerHTML = htmlRegul;');
    });
    test('zniknęły elementy, których makieta nie ma; pliki oprawy podpięte', () => {
        expect(S).not.toContain('Kreator Sugestii');
        expect(S).not.toContain('class="btn-primary"');
        expect(S).not.toContain('👉');
        expect(INDEX).toContain('<link rel="stylesheet" href="/sugestie.css?v=__WERSJA_PLIKOW__">');
        expect(INDEX).toContain('<script src="/sugestie.js?v=__WERSJA_PLIKOW__" defer></script>');
    });
    test('sugestie.js nie ma drogi do API ani do danych reguł', () => {
        for (const z of ['fetch(', 'XMLHttpRequest', 'API_URL', 'action:', 'regulyCache', 'localStorage', 'innerHTML +=']) expect(JS).not.toContain(z);
    });
    test('każdy selektor CSS zawężony do .estelio-suggestions', () => {
        const zle = [];
        CSS.split(/\r?\n/).forEach((l, i) => {
            const t = l.trim();
            if (!t || t.startsWith('/*') || t.startsWith('@') || t.startsWith('}') || t.startsWith('--') || !t.includes('{')) return;
            t.slice(0, t.indexOf('{')).split(',').map(s => s.trim()).filter(Boolean).forEach(s => { if (!/^(body\.dark-mode )?\.estelio-suggestions\b/.test(s)) zle.push((i + 1) + ': ' + s); });
        });
        expect(zle).toEqual([]);
    });
});
