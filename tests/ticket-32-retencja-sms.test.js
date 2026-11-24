// tests/ticket-32-retencja-sms.test.js
// Ticket #32 (Ania, recepcja Boczki, 24.11.2026): „czy moduł retencji można zmienić tak, żeby pojawiali się
// tam nie tylko klienci ze zgodą na telefon, ale też na SMS? ale żeby było widać, którą mają”.
// Dotąd generujListeRetencji() odrzucało każdą osobę bez zgody na kontakt telefoniczny — u Boczków to 136
// klientek ze zgodą marketingową SMS, których recepcja nie widziała. Testy URUCHAMIAJĄ kod z index.html
// i trasę get_all_rodo, nie tylko czytają tekst pliku.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function wytnijFunkcje(zrodlo, naglowek) {
    const start = zrodlo.indexOf(naglowek);
    if (start < 0) throw new Error('nie znaleziono: ' + naglowek);
    let i = zrodlo.indexOf('{', start), glebokosc = 0;
    for (; i < zrodlo.length; i++) {
        if (zrodlo[i] === '{') glebokosc++;
        else if (zrodlo[i] === '}') { glebokosc--; if (glebokosc === 0) return zrodlo.slice(start, i + 1); }
    }
    throw new Error('brak końca funkcji: ' + naglowek);
}
function wytnijStala(zrodlo, naglowek) {
    const start = zrodlo.indexOf(naglowek);
    if (start < 0) throw new Error('nie znaleziono: ' + naglowek);
    const koniec = zrodlo.indexOf('};', start) > 0 && zrodlo.indexOf('};', start) < zrodlo.indexOf('];', start) ? zrodlo.indexOf('};', start) + 2 : zrodlo.indexOf('];', start) + 2;
    return zrodlo.slice(start, koniec);
}

// ─── atrapa dokumentu: tylko elementy, których funkcja dotyka ───
function dokument(ustaw = {}) {
    const el = {
        'ret-kat': { value: ustaw.tryb || 'CUSTOM' },
        'ret-custom-input': { value: ustaw.fraza === undefined ? 'masaż' : ustaw.fraza },
        'ret-kanal': ustaw.bezFiltruKanalu ? null : { value: ustaw.kanal || 'tel_sms' },
        'retencja-lista': { innerHTML: '' },
        'ret-ukryj-zalatwione': { checked: false },
        'ret-stats': { style: {}, innerHTML: '' },
    };
    return { getElementById: (id) => (id in el ? el[id] : null), el };
}

const KLIENCI = [
    { id: '1', nazwa: 'Tel Tylko', telefon: '500100001' },
    { id: '2', nazwa: 'Sms Tylko', telefon: '500100002' },
    { id: '3', nazwa: 'Obie Zgody', telefon: '500100003' },
    { id: '4', nazwa: 'Bez Zgod', telefon: '500100004' },
    { id: '5', nazwa: 'Bez Wpisu', telefon: '500100005' },
];
const RODO = [
    { id_klienta: '1', telefon_zgoda: 'TAK', sms_zgoda: 'NIE' },
    { id_klienta: '2', telefon_zgoda: 'NIE', sms_zgoda: 'TAK' },
    { id_klienta: '3', telefon_zgoda: 'TAK', sms_zgoda: 'TAK' },
    { id_klienta: '4', telefon_zgoda: 'NIE', sms_zgoda: 'NIE' },
];
// dwie wizyty na osobę, obie dawno temu → każda jest „po terminie” o setki dni (okno 60+)
const HISTORIA = KLIENCI.flatMap((k) => ['2026-05-01', '2026-06-01'].map((data) => ({
    id_klienta: k.id, klient: k.nazwa, zabieg: 'Masaż relaksacyjny', szczegoly: '', data,
})));

function uruchom(ustaw = {}) {
    const doc = dokument(ustaw);
    const okno = { wszyscyKlienciDane: KLIENCI, historiaDane: HISTORIA, retencjaCache: ustaw.retencjaCache || [] };
    const kod = wytnijFunkcje(INDEX, 'function generujListeRetencji() {');
    const cfg = wytnijStala(INDEX, 'const RET_KAT_CFG = {');
    const pobierz = jest.fn();
    // eslint-disable-next-line no-new-func
    const fabryka = new Function('document', 'window', 'rodoCache', 'historiaDane', 'ZABIEGI_TWARZ', 'aktualnyCzasRetencji', 'pobierzDaneDoRetencji',
        cfg + ';\n' + kod + '; return generujListeRetencji;');
    const fn = fabryka(doc, okno, ustaw.rodo || RODO, HISTORIA, [], 60, pobierz);
    fn();
    const html = doc.el['retencja-lista'].innerHTML;
    const wiersze = html.split('<tr class="ret-wiersz">').slice(1);
    const nazwy = wiersze.map((w) => (w.match(/onclick="pokaz\('klient-profil'\); setTimeout\(\(\)=>otworzProfil\('\d+'\),100\);">([^<]+)<\/strong>/) || [])[1]);
    return { html, wiersze, nazwy, stats: doc.el['ret-stats'].innerHTML, pobierz };
}
const wiersz = (w, nazwa) => w.wiersze[w.nazwy.indexOf(nazwa)];

describe('ticket #32 — lista retencji: zgoda na telefon LUB SMS', () => {
    test('BŁĄD, KTÓRY NAPRAWIAMY: klientka tylko ze zgodą SMS jest na liście (dotąd odpadała)', () => {
        const w = uruchom();
        expect(w.nazwy).toContain('Sms Tylko');
        expect(w.pobierz).not.toHaveBeenCalled();
    });

    test('domyślnie: telefon, SMS i obie zgody wchodzą; bez zgody i bez wpisu RODO odpadają', () => {
        const w = uruchom();
        expect(w.nazwy.sort()).toEqual(['Obie Zgody', 'Sms Tylko', 'Tel Tylko']);
        expect(w.html).not.toContain('Bez Zgod');
        expect(w.html).not.toContain('Bez Wpisu');
    });

    test('przy każdej osobie widać, którą zgodę ma', () => {
        const w = uruchom();
        const tel = wiersz(w, 'Tel Tylko'), sms = wiersz(w, 'Sms Tylko'), obie = wiersz(w, 'Obie Zgody');
        expect(tel).toContain('ret-zgoda-tel'); expect(tel).not.toContain('ret-zgoda-sms');
        expect(sms).toContain('ret-zgoda-sms'); expect(sms).not.toContain('ret-zgoda-tel');
        expect(obie).toContain('ret-zgoda-tel'); expect(obie).toContain('ret-zgoda-sms');
        expect(sms).toContain('zgoda: SMS');
        expect(tel).toContain('zgoda: telefon');
    });

    test('przycisk mówi, co zrobić: „Napisz SMS” bez zgody na telefon, „Zadzwoń” gdy jest', () => {
        const w = uruchom();
        expect(wiersz(w, 'Sms Tylko')).toContain('Napisz SMS');
        expect(wiersz(w, 'Tel Tylko')).toContain('Zadzwoń');
        expect(wiersz(w, 'Obie Zgody')).toContain('Zadzwoń');
    });

    test('okno rozmowy dostaje informację o zgodach klientki', () => {
        const w = uruchom();
        expect(wiersz(w, 'Sms Tylko')).toMatch(/otworzModalRetencji\('2', 'Sms Tylko', '[^']*', '500100002', 'sms'\)/);
        expect(wiersz(w, 'Obie Zgody')).toMatch(/'500100003', 'telsms'\)/);
        expect(wiersz(w, 'Tel Tylko')).toMatch(/'500100001', 'tel'\)/);
    });

    test('filtr „Tylko zgoda na telefon” = dotychczasowe zachowanie modułu', () => {
        const w = uruchom({ kanal: 'tel' });
        expect(w.nazwy.sort()).toEqual(['Obie Zgody', 'Tel Tylko']);
    });

    test('filtr „Tylko zgoda na SMS” zostawia osoby ze zgodą SMS', () => {
        const w = uruchom({ kanal: 'sms' });
        expect(w.nazwy.sort()).toEqual(['Obie Zgody', 'Sms Tylko']);
    });

    test('statystyki liczą zgody: na telefon 2, tylko SMS 1', () => {
        const w = uruchom();
        expect(w.stats).toContain('Zgoda na telefon: 2');
        expect(w.stats).toContain('Tylko SMS: 1');
        expect(w.stats).toContain('Łącznie: 3');
    });

    test('brak listy rozwijanej w HTML (stara wersja ekranu) nie wysypuje funkcji — działa jak „telefon lub SMS”', () => {
        const w = uruchom({ bezFiltruKanalu: true });
        expect(w.nazwy.sort()).toEqual(['Obie Zgody', 'Sms Tylko', 'Tel Tylko']);
    });

    test('wpis RODO bez pola sms_zgoda (stara odpowiedź serwera) traktowany jak brak zgody SMS', () => {
        const w = uruchom({ rodo: [{ id_klienta: '2', telefon_zgoda: 'NIE' }, { id_klienta: '1', telefon_zgoda: 'TAK' }] });
        expect(w.nazwy).toEqual(['Tel Tylko']);
    });
});

describe('ticket #32 — okno „Notatka z rozmowy”', () => {
    function okno(zgody) {
        const el = {
            'ret-modal-id': { value: '' }, 'ret-modal-nazwa': { value: '' }, 'ret-modal-kampania': { innerText: '' },
            'ret-modal-status': { value: '' }, 'ret-modal-notatka': { value: '' }, 'ret-modal-klient': { innerHTML: '' },
            'ret-modal-historia': { style: {}, innerHTML: '' }, 'retention-modal-overlay': { style: {} },
        };
        const doc = { getElementById: (id) => el[id] };
        const kod = wytnijFunkcje(INDEX, 'function otworzModalRetencji(id, nazwa, kampania, telefon, zgody = \'\') {');
        // eslint-disable-next-line no-new-func
        const fn = new Function('document', 'window', kod + '; return otworzModalRetencji;')(doc, { retencjaCache: [] });
        fn('2', 'Sms Tylko', 'Retencja: masaż (60+ dni)', '500100002', zgody);
        return el;
    }
    test('pokazuje plakietkę zgody SMS, gdy to jedyna zgoda', () => {
        const el = okno('sms');
        expect(el['ret-modal-klient'].innerHTML).toContain('zgoda: SMS');
        expect(el['ret-modal-klient'].innerHTML).not.toContain('zgoda: telefon');
        expect(el['retention-modal-overlay'].style.display).toBe('flex');
    });
    test('obie zgody → obie plakietki; brak parametru (stare wywołanie) → bez plakietek, bez błędu', () => {
        expect(okno('telsms')['ret-modal-klient'].innerHTML).toMatch(/zgoda: telefon.*zgoda: SMS/);
        const bez = okno(undefined)['ret-modal-klient'].innerHTML;
        expect(bez).toContain('500100002');
        expect(bez).not.toContain('ret-zgoda');
    });
});

describe('ticket #32 — HTML i style', () => {
    test('pasek filtrów ma listę „Zgoda na kontakt” z trzema wyborami, domyślnie telefon lub SMS', () => {
        const sel = INDEX.match(/<select id="ret-kanal"[\s\S]*?<\/select>/);
        expect(sel).not.toBeNull();
        expect(sel[0]).toContain('value="tel_sms"');
        expect(sel[0]).toContain('value="tel"');
        expect(sel[0]).toContain('value="sms"');
        expect(sel[0].indexOf('value="tel_sms"')).toBeLessThan(sel[0].indexOf('value="tel"'));
        expect(sel[0]).toContain('onchange="generujListeRetencji()"');
    });
    test('efekt kontaktu ma pozycję „SMS wysłany”, a opis modułu nie mówi już „tylko telefon”', () => {
        expect(INDEX).toContain('<option value="SMS wysłany">');
        expect(INDEX).not.toContain('Filtruje tylko osoby z <b>zgodą RODO</b> na kontakt telefoniczny.');
        expect(INDEX).toContain('na kontakt telefoniczny lub na SMS');
    });
    test('plakietki zgód mają reguły w trybie jasnym i ciemnym (nauka z ticketu #27)', () => {
        expect(INDEX).toMatch(/\.ret-zgoda-tel\s*\{[^}]*background/);
        expect(INDEX).toMatch(/\.ret-zgoda-sms\s*\{[^}]*background/);
        expect(INDEX).toMatch(/\.dark-mode \.ret-zgoda-tel\s*\{[^}]*color/);
        expect(INDEX).toMatch(/\.dark-mode \.ret-zgoda-sms\s*\{[^}]*color/);
    });
});

describe('ticket #32 — GET /api/rodo?action=get_all_rodo', () => {
    function mockDb(rows) {
        return { query: jest.fn((sql, paramsOrCb, maybeCb) => { const cb = typeof paramsOrCb === 'function' ? paramsOrCb : maybeCb; if (cb) cb(null, rows); }) };
    }
    function app(db) { const a = express(); a.use(express.json()); a.use('/api', require('../routes/rodo')(db)); return a; }

    test('oddaje zgodę na telefon I zgodę SMS, oczyszczone do TAK/NIE wielkimi literami', async () => {
        const db = mockDb([
            { id_klienta: '1', kontakt_tel: 'TAK', newsletter_sms: ' nie ' },
            { id_klienta: '2', kontakt_tel: null, newsletter_sms: 'tak' },
        ]);
        const res = await request(app(db)).get('/api/rodo').query({ action: 'get_all_rodo', tenant_id: 'salon-test' });
        expect(res.body).toEqual([
            { id_klienta: '1', telefon_zgoda: 'TAK', sms_zgoda: 'NIE' },
            { id_klienta: '2', telefon_zgoda: '', sms_zgoda: 'TAK' },
        ]);
    });

    test('zapytanie czyta newsletter_sms i oddaje najnowszy wpis pierwszy (dwa wpisy tej samej osoby)', async () => {
        const db = mockDb([]);
        await request(app(db)).get('/api/rodo').query({ action: 'get_all_rodo', tenant_id: 'salon-test' });
        const sql = String(db.query.mock.calls[0][0]).replace(/\s+/g, ' ');
        expect(sql).toContain('newsletter_sms');
        expect(sql).toContain('kontakt_tel');
        expect(sql).toMatch(/ORDER BY data_podpisu DESC, utworzono_w DESC/);
        expect(db.query.mock.calls[0][1]).toEqual(['salon-test']);
    });
});
