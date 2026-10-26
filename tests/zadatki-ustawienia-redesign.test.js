// Redesign ekranu Administracja → Ustawienia zadatków (26.10.2026): strażnik zasady „zmienia się wyłącznie oprawa”.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'zadatki-ustawienia.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'zadatki-ustawienia.js'), 'utf8');

const od = INDEX.indexOf('<div id="sekcja-zadatki-config" class="section">');
const S = INDEX.slice(od, INDEX.lastIndexOf('<!--', INDEX.indexOf('ANALIZA MANAGER', od)));   // granica niezależna od CRLF
const fn = (nazwa, koniec) => { const a = INDEX.indexOf('function ' + nazwa); expect(a).toBeGreaterThan(-1); return INDEX.slice(a, INDEX.indexOf(koniec, a)); };

describe('Ustawienia zadatków po redesignie — kontrolki, wartości i zapis bez zmian', () => {
    test('każde ID uz-* istnieje dokładnie raz, w tej samej roli', () => {
        expect(od).toBeGreaterThan(-1);
        for (const id of ['uz-tryb', 'uz-blok-procent', 'uz-procent', 'uz-blok-kwotowy', 'uz-progi-lista', 'uz-nowy-do', 'uz-nowy-zadatek', 'uz-powyzej-max', 'uz-fallback-box', 'uz-fallback-procent', 'uz-zaokraglenie', 'uz-msg']) {
            expect((S.match(new RegExp('id="' + id + '"', 'g')) || []).length).toBe(1);
        }
        expect(S).toContain('<select id="uz-tryb" class="form-control" onchange="uz_przelaczTryb()">');
        expect(S).toContain('<select id="uz-powyzej-max" class="form-control" onchange="uz_przelaczPowyzej()">');
        expect(S).toMatch(/<input type="number" id="uz-procent" class="form-control" min="0" max="100" step="0.5" value="50">/);
        expect(S).toMatch(/<input type="number" id="uz-nowy-do" min="0" step="0.01" placeholder="200">/);
        expect(S).toMatch(/<input type="number" id="uz-nowy-zadatek" min="0" step="0.01" placeholder="50">/);
        expect(S).toMatch(/<input type="number" id="uz-fallback-procent" min="0" max="100" step="0.5" value="50">/);
        expect(S).toContain('<div id="uz-blok-kwotowy" style="display:none;">');
        expect(S).toContain('<div id="uz-fallback-box" style="display:none;">');
    });
    test('wartości <option> trybu, fallbacku i zaokrąglenia bez zmian; select zaokrąglenia zostaje w DOM', () => {
        for (const v of ['PROCENT', 'KWOTOWY']) expect(S).toContain(`<option value="${v}">`);
        for (const v of ['OSTATNI_PROG', 'PUSTE']) expect(S).toContain(`<option value="${v}">`);
        const zaokr = S.slice(S.indexOf('<select id="uz-zaokraglenie"'), S.indexOf('</select>', S.indexOf('<select id="uz-zaokraglenie"')));
        expect(zaokr).toContain('<option value="0">'); expect(zaokr).toContain('<option value="5">'); expect(zaokr).toContain('<option value="10">');
        expect(S).not.toContain('<option value="none">'); expect(S).not.toContain('<option value="five">');
        // kafle mają te same wartości co select
        expect((S.match(/name="uz-zaokr-kafel" value="(0|5|10)"/g) || []).length).toBe(3);
    });
    test('te same akcje: uz_zapisz, uz_dodajProg, uz_usunProg (w szablonie wiersza), pomoc kontekstowa', () => {
        expect(S).toContain('onclick="uz_zapisz()"');
        expect(S).toContain('onclick="uz_dodajProg()"');
        expect(S).toContain('class="pk-slot" data-pomoc="admin.zadatki"');
        expect((S.match(/onclick="uz_/g) || []).length).toBe(2);
        const r = fn('uz_renderProgi(progi)', '\n}');
        expect(r).toContain('onclick="uz_usunProg(${p.id})"');
        expect(r).toContain('${parseFloat(p.do_kwoty).toFixed(2)} zł');
        expect(r).toContain('${parseFloat(p.zadatek_kwota).toFixed(2)} zł');
    });
    test('funkcje logiki bez zmian: odczyt, zapis (to samo body), progi, przełączanie bloków; hooki prezentacji są warunkowe', () => {
        const w = fn('wczytajUstawieniaZadatkow()', '\n}');
        for (const p of ["fetch(`/api/ustawienia/zadatki?tenant_id=${encodeURIComponent(tenant_id)}`", "document.getElementById('uz-tryb').value = d.config.tryb;", "document.getElementById('uz-zaokraglenie').value = String(d.config.zaokraglenie);", 'uz_przelaczTryb();', 'uz_przelaczPowyzej();', 'uz_renderProgi(d.progi || []);', 'if (window.ZADATKI_PREZENTACJA) window.ZADATKI_PREZENTACJA.poOdczycie(d);']) expect(w).toContain(p);
        const z = fn('uz_zapisz()', '\n}');
        for (const p of ["tryb: document.getElementById('uz-tryb').value,", "procent: parseFloat(document.getElementById('uz-procent').value) || 0,", "zaokraglenie: parseInt(document.getElementById('uz-zaokraglenie').value) || 0,", "powyzej_max: document.getElementById('uz-powyzej-max').value,", "fallback_procent: parseFloat(document.getElementById('uz-fallback-procent').value) || 0,", "fetch('/api/ustawienia/zadatki', {", 'if (window.ZADATKI_PREZENTACJA) window.ZADATKI_PREZENTACJA.poZapisie();']) expect(z).toContain(p);
        const d = fn('uz_dodajProg()', '\n}');
        for (const p of ["fetch('/api/ustawienia/zadatki/prog', {", 'if (zadatek_kwota > do_kwoty)', 'wczytajUstawieniaZadatkow();']) expect(d).toContain(p);
        const u = fn('uz_usunProg(id)', '\n}');
        expect(u).toContain("if (!confirm('Usunąć ten próg?')) return;");
        expect(u).toContain("method: 'DELETE'");
        const t = fn('uz_przelaczTryb()', '\n}');
        expect(t).toContain("document.getElementById('uz-blok-procent').style.display = (tryb === 'PROCENT') ? 'block' : 'none';");
    });
    test('warstwa prezentacji: żadnych zapisów — jedyny fetch to istniejący kalkulator /oblicz; kafle piszą do select', () => {
        const fetche = JS.match(/fetch\(([^,)]+)/g) || [];
        expect(fetche).toEqual(["fetch('/api/ustawienia/zadatki/oblicz'"]);
        expect(JS).not.toMatch(/\/api\/ustawienia\/zadatki'|\/zadatki\/prog/);
        expect(JS).toContain('zaokr.value = r.value;');
        expect(JS).toContain('window.ZADATKI_PREZENTACJA = {');
        expect(INDEX).toContain('<link rel="stylesheet" href="/zadatki-ustawienia.css?v=__WERSJA_PLIKOW__">');
        expect(INDEX).toContain('<script src="/zadatki-ustawienia.js?v=__WERSJA_PLIKOW__" defer></script>');
    });
    test('zniknęły elementy, których makieta nie ma', () => {
        expect(S).not.toContain('💰'); expect(S).not.toContain('💾 ZAPISZ'); expect(S).not.toContain('class="btn-primary"'); expect(S).not.toContain('#fef3c7');
    });
    test('każdy selektor CSS zawężony do .estelio-deposit-settings', () => {
        const zle = [];
        CSS.split(/\r?\n/).forEach((l, i) => {
            const t = l.trim();
            if (!t || t.startsWith('/*') || t.startsWith('@') || t.startsWith('}') || t.startsWith('--') || !t.includes('{')) return;
            t.slice(0, t.indexOf('{')).split(',').map(s => s.trim()).filter(Boolean).forEach(s => { if (!/^(body\.dark-mode )?\.estelio-deposit-settings\b/.test(s)) zle.push((i + 1) + ': ' + s); });
        });
        expect(zle).toEqual([]);
    });
});
