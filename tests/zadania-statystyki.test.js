// tests/zadania-statystyki.test.js — Analiza → Zadania zespołu → Statystyki (27.10.2026).
// Baza udawana wg treści SQL (moduł robi CREATE/ALTER przy ładowaniu). Sprawdza: bramkę roli, zasięg salonu w KAŻDYM
// zapytaniu, białą listę okresów, złożenie wyniku (osoby/trend/rozmowy) oraz strażnika plików frontu.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { createSession } = require('../routes/sessions');

const SALON = 'stat-salon-a-0001';
const TOKEN = createSession(SALON, 'salon-a');

function dbWg(odpowiedzi) {
    const query = jest.fn((sql, params, cb) => {
        const callback = typeof params === 'function' ? params : cb;
        const p = typeof params === 'function' ? [] : params;
        const traf = odpowiedzi.find(o => o.re.test(String(sql)));
        const wynik = traf ? (typeof traf.rows === 'function' ? traf.rows(p, String(sql)) : traf.rows) : { affectedRows: 1 };
        if (callback) callback(null, wynik);
    });
    return { query, _sql: (re) => query.mock.calls.filter(c => re.test(String(c[0]))) };
}
function app(db) { const a = express(); a.use(express.json()); a.use('/api', require('../routes/zadania')(db)); return a; }
const post = (db, body) => request(app(db)).post('/api/zadania').set('x-session-token', TOKEN).send({ tenant_id: SALON, ...body });
const ROLA = (rola) => ({ re: /SELECT rola FROM Użytkownicy/, rows: rola ? [{ rola }] : [] });
const ok = (rows) => ({ re: /./, rows });

describe('bramka roli', () => {
    test('recepcja → odmowa, bez żadnego zapytania statystycznego', async () => {
        const db = dbWg([ROLA('recepcja')]);
        const res = await post(db, { action: 'statystyki', okres: '30', kto: 'Marta' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/manager lub właściciel/);
        expect(db._sql(/FROM Zadania z WHERE/).length).toBe(0);
    });
    test('osoba spoza tabeli Użytkownicy (brak roli) → odmowa', async () => {
        const res = await post(dbWg([ROLA(null)]), { action: 'statystyki', kto: 'Nieznana' });
        expect(res.body.status).toBe('error');
    });
    test('manager → sukces; rola czytana dla TEGO salonu', async () => {
        const db = dbWg([ROLA('Manager'), ok([])]);
        const res = await post(db, { action: 'statystyki', okres: '30', kto: 'Ola' });
        expect(res.body.status).toBe('success');
        expect(db._sql(/SELECT rola FROM Użytkownicy/)[0][1]).toEqual([SALON, 'Ola']);
    });
});

describe('zasięg salonu i okres', () => {
    test('każde zapytanie statystyczne ma tenant_id w parametrach i filtr is_szablon = 0 na Zadaniach', async () => {
        const db = dbWg([ROLA('manager'), ok([])]);
        await post(db, { action: 'statystyki', okres: '90', kto: 'Ola' });
        const zap = db.query.mock.calls.filter(c => /FROM Zadania z|FROM Zadania_Historia h/.test(String(c[0])));
        expect(zap.length).toBe(10);
        for (const [sql, params] of zap) {
            expect(params).toContain(SALON);
            if (/FROM Zadania z/.test(sql)) expect(sql).toMatch(/z\.tenant_id = \? AND z\.is_szablon = 0/);
            if (/FROM Zadania_Historia h/.test(sql)) expect(sql).toMatch(/h\.tenant_id = \?/);
            // liczba „?” = liczba parametrów (żaden znacznik nie zostaje bez wartości)
            expect((sql.match(/\?/g) || []).length).toBe(params.length);
        }
    });
    test('okres spoza białej listy → 30 dni; „wszystko” → 36500 dni; ziarno trendu wg okresu', async () => {
        let db = dbWg([ROLA('manager'), ok([])]);
        let res = await post(db, { action: 'statystyki', okres: "1; DROP TABLE Zadania", kto: 'Ola' });
        expect(res.body.okres).toBe('30');
        expect(res.body.data.okres_dni).toBe(30);
        expect(res.body.data.ziarno).toBe('tydzien');
        expect(db.query.mock.calls.every(c => !/DROP/.test(String(c[0])))).toBe(true);
        const trendSql = db._sql(/AS k, COUNT\(\*\) AS n, SUM/)[0][0];
        expect(trendSql).toContain('INTERVAL WEEKDAY(z.data_utworzenia) DAY');

        db = dbWg([ROLA('manager'), ok([])]);
        res = await post(db, { action: 'statystyki', okres: 'wszystko', kto: 'Ola' });
        expect(res.body.data.okres_dni).toBeNull();
        expect(res.body.data.ziarno).toBe('miesiac');
        expect(db._sql(/SUM\(z\.data_utworzenia >= DATE_SUB/)[0][1][0]).toBe(36500);

        db = dbWg([ROLA('manager'), ok([])]);
        res = await post(db, { action: 'statystyki', okres: '7', kto: 'Ola' });
        expect(res.body.data.ziarno).toBe('dzien');
        expect(res.body.data.trend.length).toBe(8); // 7 dni wstecz + dziś, zera gdy pusto
        expect(res.body.data.trend.every(t => t.zalozone === 0 && t.wykonane === 0)).toBe(true);
    });
});

describe('złożenie wyniku', () => {
    const dzis = new Date(); dzis.setHours(0, 0, 0, 0);
    const pon = new Date(dzis); pon.setDate(pon.getDate() - ((pon.getDay() + 6) % 7));
    const dane = [
        ROLA('manager'),
        { re: /AS zalozone,[\s\S]*AS wykonane_na_czas/, rows: [{ zalozone: '12', zalozone_telefony: 5, wykonane: 7, wykonane_telefony: 3, zarchiwizowane: 1, aktywne: 6, aktywne_telefony: 2, po_terminie: 2, bez_terminu: 1, aktywne_pilne: 1, sredni_czas_min: '95.4', wykonane_z_terminem: 5, wykonane_na_czas: 4 }] },
        { re: /'zalozone' AS miara/, rows: [
            { osoba: 'Ola', miara: 'zalozone', n: 8, telefony: 3, sredni_czas_min: null, z_terminem: 0, na_czas: 0 },
            { osoba: 'Marta', miara: 'wykonane', n: 5, telefony: 2, sredni_czas_min: '120.6', z_terminem: 4, na_czas: 3 },
            { osoba: 'Ola', miara: 'zarchiwizowane', n: 1, telefony: 0, sredni_czas_min: null, z_terminem: 0, na_czas: 0 }
        ] },
        { re: /AS otrzymane/, rows: [{ osoba: 'Marta', otrzymane: 6, aktywne: 4, aktywne_telefony: 1, po_terminie: 2 }, { osoba: 'Anna', otrzymane: 2, aktywne: 2, aktywne_telefony: 1, po_terminie: 0 }] },
        { re: /FROM Zadania_Historia h/, rows: [{ osoba: 'Marta', typ: 'WYNIK', wynik: 'UMOWIONA', n: 2 }, { osoba: 'Marta', typ: 'TERMIN', wynik: null, n: 1 }, { osoba: '', typ: 'WYNIK', wynik: 'NIE_ODEBRALA', n: 1 }, { osoba: 'Ola', typ: 'WYNIK', wynik: 'DZIWNY', n: 9 }] },
        { re: /AS k, COUNT\(\*\) AS n, SUM/, rows: [{ k: pon, n: 3, telefony: 1 }] },
        { re: /AS k, COUNT\(\*\) AS n\s/, rows: [{ k: pon, n: 2 }] },
        { re: /WEEKDAY\(z\.data_wykonania\) AS d/, rows: [{ d: 0, n: 4 }, { d: 4, n: 3 }, { d: 9, n: 99 }] },
        { re: /GROUP BY t\.kategoria/, rows: [{ kategoria: 'KLIENT', zalozone: 5, wykonane: 2, aktywne: 3 }] },
        { re: /GROUP BY z\.priorytet/, rows: [{ priorytet: 'PILNY', zalozone: 1, wykonane: 1, aktywne: 0 }] },
        { re: /ORDER BY z\.deadline ASC LIMIT 5/, rows: [{ id: 'Z-9', tytul: 'Zamówić wosk', rodzaj: 'DO_ZROBIENIA', priorytet: 'PILNY', deadline: '2026-10-20 10:00:00', przypisane_do: 'Marta', przypisani: 'Anna, Marta', dni_po_terminie: 7 }] }
    ];
    test('podsumowanie liczbowe, osoby scalone z trzech źródeł, rozmowy tylko ze znanymi wynikami, trend z siatką zer', async () => {
        const res = await post(dbWg(dane), { action: 'statystyki', okres: '30', kto: 'Ola' });
        expect(res.body.status).toBe('success');
        const d = res.body.data;
        expect(d.podsumowanie).toEqual({ zalozone: 12, zalozone_telefony: 5, wykonane: 7, wykonane_telefony: 3, zarchiwizowane: 1, aktywne: 6, aktywne_telefony: 2, po_terminie: 2, bez_terminu: 1, aktywne_pilne: 1, sredni_czas_min: 95, wykonane_z_terminem: 5, wykonane_na_czas: 4 });
        const os = Object.fromEntries(d.osoby.map(o => [o.osoba, o]));
        expect(Object.keys(os).sort()).toEqual(['Anna', 'Marta', 'Ola']);
        expect(os.Ola).toMatchObject({ zalozone: 8, zalozone_telefony: 3, zarchiwizowane: 1, wykonane: 0, aktywne: 0, sredni_czas_min: null });
        expect(os.Marta).toMatchObject({ wykonane: 5, wykonane_telefony: 2, sredni_czas_min: 121, wykonane_z_terminem: 4, wykonane_na_czas: 3, otrzymane: 6, aktywne: 4, po_terminie: 2, przelozenia: 1 });
        expect(os.Marta.rozmowy).toEqual({ UMOWIONA: 2, NIE_ODEBRALA: 0, NIE_ZAINTERESOWANA: 0 });
        expect(os.Ola.rozmowy).toEqual({ UMOWIONA: 0, NIE_ODEBRALA: 0, NIE_ZAINTERESOWANA: 0 }); // „DZIWNY” odrzucony
        expect(d.rozmowy).toEqual({ UMOWIONA: 2, NIE_ODEBRALA: 1, NIE_ZAINTERESOWANA: 0, przelozenia: 1 }); // bez autora też liczone do sumy
        expect(d.dni_tygodnia).toEqual([4, 0, 0, 0, 3, 0, 0]);
        expect(d.obszary).toEqual([{ kategoria: 'KLIENT', zalozone: 5, wykonane: 2, aktywne: 3 }]);
        expect(d.priorytety[0]).toEqual({ priorytet: 'PILNY', zalozone: 1, wykonane: 1, aktywne: 0 });
        expect(d.najstarsze).toEqual([{ id: 'Z-9', tytul: 'Zamówić wosk', rodzaj: 'DO_ZROBIENIA', priorytet: 'PILNY', deadline: '2026-10-20 10:00:00', przypisani: 'Anna, Marta', dni_po_terminie: 7 }]);
        const tydz = d.trend.find(t => t.zalozone === 3);
        expect(tydz).toMatchObject({ zalozone: 3, telefony: 1, wykonane: 2 });
        expect(d.trend.filter(t => t.zalozone === 0).length).toBe(d.trend.length - 1);
        expect(d.osoby[0].osoba).toBe('Marta'); // sortowanie: najwięcej aktywności
    });
    test('błąd bazy w jednym z zapytań → status error, bez wyniku częściowego', async () => {
        const db = { query: jest.fn((sql, params, cb) => { const f = typeof params === 'function' ? params : cb; if (/SELECT rola/.test(sql)) return f(null, [{ rola: 'manager' }]); if (/GROUP BY t\.kategoria/.test(sql)) return f(new Error('padła tabela')); f(null, []); }) };
        const res = await post(db, { action: 'statystyki', okres: '30', kto: 'Ola' });
        expect(res.body).toEqual({ status: 'error', message: 'padła tabela' });
    });
});

describe('front: pliki i wpięcie w index.html', () => {
    const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'zadania-statystyki.js'), 'utf8');
    const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'zadania-statystyki.css'), 'utf8');
    test('przełącznik Lista/Statystyki, kontener #zd-stat i owinięta lista — po jednym razie, w widoku #an_view-zadania', () => {
        const a = INDEX.indexOf('<div id="an_view-zadania"'); const b = INDEX.indexOf('<!-- Modal: Komentarze do zadania -->', a);
        const W = INDEX.slice(a, b);
        expect((W.match(/id="zd-widok-seg"/g) || []).length).toBe(1);
        expect((W.match(/id="zd-stat"/g) || []).length).toBe(1);
        expect((W.match(/id="zd-lista-wrap"/g) || []).length).toBe(1);
        expect(W).toContain('<!-- /#zd-lista-wrap -->');
        expect(W.indexOf('id="zd-lista-wrap"')).toBeLessThan(W.indexOf('id="zd-table"'));
        expect(W).toContain('<div id="zd-stat" class="estelio-zstat" hidden></div>');
        expect(W).toContain(`onclick="zst_pokaz('statystyki')"`);
        expect(INDEX).toContain('<link rel="stylesheet" href="/zadania-statystyki.css?v=__WERSJA_PLIKOW__">');
        expect(INDEX).toContain('<script src="/zadania-statystyki.js?v=__WERSJA_PLIKOW__" defer></script>');
    });
    test('JS: akcja statystyki z okresem i osobą z PIN-u, tylko pełne okresy z listy; CSS zawężony do .estelio-zstat', () => {
        expect(JS).toContain("action: 'statystyki', okres: ST.okres, kto: kto");
        expect(JS).toContain("localStorage.getItem('boczki_pracownik_imie')");
        expect(JS).toMatch(/var OKRESY = \[\['7'.*\['wszystko'/);
        for (const f of ['zst_pokaz', 'zst_okres', 'zst_odswiez']) expect(JS).toContain('window.' + f + ' = function');
        expect(JS).not.toMatch(/innerHTML\s*=\s*[^;]*\b(z|o)\.(tytul|osoba|przypisani)\b(?!\))/); // dane tylko przez esc()
        const regulyBezZawezenia = CSS.split('\n').filter(l => /^[a-z#.\[][^{]*\{/.test(l) && !/^(\.estelio-zstat|body\.dark-mode \.estelio-zstat|\.zd-widok-segments|body\.dark-mode \.zd-widok-segments|@media)/.test(l));
        expect(regulyBezZawezenia).toEqual([]);
    });
});
