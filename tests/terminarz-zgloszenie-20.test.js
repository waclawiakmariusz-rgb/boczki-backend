// Zgłoszenie #20 (Ola, 29.10.2026): wizyta wychodząca poza godziny pracy była blokowana jak kolizja.
// Wariant B zatwierdzony 30.10: ostrzeżenie zamiast blokady — wyłącznie dla kodu GRAFIK, wyłącznie gdy
// wykonawczyni wskazana ręcznie, zapis drugim kliknięciem, ślad w historii. Kolizje zostają twardą odmową.
// Strażnik pilnuje spójności silnika, serwera, ekranu i przewodnika.
const fs = require('fs');
const path = require('path');
const KAT = path.join(__dirname, '..');
const SIL = fs.readFileSync(path.join(KAT, 'routes', 'terminarz-silnik.js'), 'utf8');
const SRV = fs.readFileSync(path.join(KAT, 'routes', 'terminarz.js'), 'utf8');
const JS = fs.readFileSync(path.join(KAT, 'public', 'terminarz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(KAT, 'public', 'terminarz.css'), 'utf8');
const G = fs.readFileSync(path.join(KAT, 'public', 'estelio_pomoc_terminarz.html'), 'utf8');
const wytnij = (zrodlo, od, doTxt) => { const a = zrodlo.indexOf(od); expect(a).toBeGreaterThan(-1); return zrodlo.slice(a, zrodlo.indexOf(doTxt, a + od.length)); };

describe('silnik', () => {
    test('zgoda działa tylko z ręcznie wskazaną osobą i tylko dla GRAFIK', () => {
        expect(SIL).toContain('if (w.mimoGrafiku && poz.pracownik && maGrafikTegoDnia) {');
        expect(SIL).toContain("grafikOstrz = { kod: 'GRAFIK', pozycja: idx, pracownik: imie");
        expect(SIL).toContain('wybrany = imie; if (grafikOstrz) ostrzezenia.push(grafikOstrz); break;');   // ostrzeżenie dopiero, gdy osoba naprawdę przeszła
        expect(SIL).toContain('mozna_mimo_grafiku: !!poz.pracownik && maGrafikTegoDnia');
        expect(SIL).toContain('problemy, ostrzezenia, przerwy_min: przerwy');
    });
    test('zgoda nie dotyka pozostałych odmów — żadna inna gałąź nie czyta mimoGrafiku', () => {
        expect((SIL.match(/mimoGrafiku/g) || []).length).toBe(1);
        for (const kod of ['PRACOWNIK_ZAJETY', 'GABINET_ZAJETY', 'URZADZENIE_ZAJETE', 'KLIENT_ZAJETY', 'KOMPETENCJE']) expect(SIL).toContain(`kod: '${kod}'`);
    });
});

describe('serwer', () => {
    test('flaga przyjmowana w sprawdzeniu, zapisie i zmianie — i nigdzie indziej', () => {
        expect(wytnij(SRV, "case 'trm_sprawdz': {", "case 'trm_szukaj'")).toContain('mimoGrafiku: !!d.mimo_grafiku');
        expect(wytnij(SRV, "case 'trm_zapisz': {", "case 'trm_zmien'")).toContain('mimoGrafiku: !!d.mimo_grafiku');
        const zmien = wytnij(SRV, "case 'trm_zmien': {", "case 'trm_usun'");
        expect((zmien.match(/mimoGrafiku: !!d\.mimo_grafiku/g) || []).length).toBe(2);   // sprawdzenie + ponownie pod blokadą
        expect((SRV.match(/mimoGrafiku: !!d\.mimo_grafiku/g) || []).length).toBe(4);
    });
    test('szukanie wolnych terminów (trm_szukaj) nie zna zgody — lista propozycji zostaje w grafiku', () => {
        expect(wytnij(SRV, "case 'trm_szukaj': {", "case 'trm_zapisz'")).not.toContain('mimo_grafiku');
    });
    test('zapis poza grafikiem zostawia ślad w historii wizyty, dzienniku zdarzeń i odpowiedzi', () => {
        const z = wytnij(SRV, "case 'trm_zapisz': {", "case 'trm_zmien'");
        expect(z).toContain("const pozaGrafikiem = (w.ostrzezenia || []).filter(o => o.kod === 'GRAFIK');");
        expect(z).toContain("' · poza grafikiem: '");
        expect(z).toContain("ostrzezenia: [...ostrzezeniaZakupow, ...pozaGrafikiem]");
        expect(z).toContain("POZA GRAFIKIEM, świadomie");
        const zm = wytnij(SRV, "case 'trm_zmien': {", "case 'trm_usun'");
        expect(zm).toContain("ostrzezenia: w.ostrzezenia || []");
        expect(zm).toContain("pozaGrafikiemZm ? ' · poza grafikiem: '");
    });
});

describe('ekran', () => {
    test('zgoda gaśnie razem ze stanem dostępności i idzie w każdym żądaniu', () => {
        expect(JS).toContain('n.mimoGrafiku = false; };');
        expect(JS).toContain("mimo_grafiku: !!n.mimoGrafiku });");                      // trm_sprawdz
        expect(JS).toContain("notatka: n.notatka, mimo_grafiku: !!n.mimoGrafiku });");  // trm_zapisz
        expect(JS).toContain("mimo_grafiku: !!z.mimoGrafiku, potwierdz: !!potwierdz");  // trm_zmien
    });
    test('przycisk „Umów mimo grafiku” tylko przy jedynym problemie GRAFIK, z możliwością zgody i wskazaną osobą', () => {
        expect(JS).toContain("const tylkoGrafik = problemy.length === 1 && problemy[0].kod === 'GRAFIK' && problemy[0].mozna_mimo_grafiku && !dowolny;");
        expect(JS).toContain('onclick="TRM.nowaMimoGrafiku()">Umów mimo grafiku</button>');
        expect(JS).toContain("TRM.nowaMimoGrafiku = () => { const n = TRM.nowa; if (!n || !n.prefPrac) return;");
    });
    test('po zgodzie zielona karta mówi wprost, że to poza grafikiem; etykieta przycisku głównego też', () => {
        expect(JS).toContain("(dost.wynik.ostrzezenia || []).some(o => o.kod === 'GRAFIK')) wynikHtml2 +=");
        expect(JS).toContain("Umawiasz świadomie — ślad zostanie w historii wizyty.");
        expect(JS).toContain("n.mimoGrafiku && gotowe ? 'Umów mimo grafiku'");
        expect(JS).toContain("toast('warning', 'Wizyta poza grafikiem'");
    });
    test('grupa „Po grafiku” tylko dla wskazanej osoby, policzona z grafiku dnia, bez pytań do serwera', () => {
        const f = wytnij(JS, 'function slotyPoGrafiku(n) {', '\n  }');
        expect(f).toContain("if (!n.prefPrac || !n.pozycje.length || !TRM.dzien || TRM.dzien.data !== n.start.slice(0, 10)) return null;");
        expect(f).not.toContain('api(');
        expect(f).toContain('out.length < 6');
        expect(JS).toContain('class="trm-sloty po-grafiku"');
        expect(JS).toContain("TRM.nowaWybierzPoGrafiku = (start) =>");
        expect(CSS).toContain('.trm-sloty.po-grafiku button { border-style:dashed; }');
    });
    test('panel zmiany: „Sprawdź mimo grafiku” tylko przy jedynym problemie GRAFIK', () => {
        expect(JS).toContain("if (pr.length === 1 && pr[0].kod === 'GRAFIK' && pr[0].mozna_mimo_grafiku) h +=");
        expect(JS).toContain('onclick="TRM.zm.mimoGrafiku=true;TRM.zmianaSprawdz(false)">Sprawdź mimo grafiku</button>');
    });
});

describe('karta wyniku terminu — gałąź „ok” nie może wypaść z łańcucha else-if (regresja z 30.10)', () => {
    test('zielona karta bez ostrzeżeń renderuje się zawsze, gdy stan to ok', () => {
        const f = wytnij(JS, 'function sekcjaTerminuHtml(n) {', '\n  }');
        expect(f).toContain("if (st === 'ok' && dost.wynik) { wynikHtml2 = `<div class=\"trm-wynik-termin ok\">");
        expect(f).toContain("} else if (st === 'zajety' && dost.wynik) {");
        // dopiski do zielonej karty (GRAFIK, pominięty margines) są wewnątrz bloku „ok”, nie jako osobne if-y przed else-if
        const blokOk = f.slice(f.indexOf("if (st === 'ok' && dost.wynik) {"), f.indexOf("} else if (st === 'zajety'"));
        expect(blokOk).toContain("o.kod === 'GRAFIK')) wynikHtml2 +=");
        expect(blokOk).toContain("p.bufor_pominiety)) wynikHtml2 +=");
    });
});

describe('przewodnik mówi to samo, co robi system', () => {
    test('rozdział 32 nie obiecuje już braku wyjątków, ale nazywa jedyny wyjątek', () => {
        expect(G).not.toContain('Nie ma przycisku „mimo to" — ani dla recepcji, ani dla właścicielki.</li>');
        expect(G).toContain('Jedyny wyjątek to <em>koniec grafiku</em> osoby wskazanej ręcznie');
        expect(G).toContain('Zajęty pracownik, gabinet, urządzenie, zajęta klientka — na to nie ma przycisku „mimo to"');
    });
    test('rozdziały 21 i 18 oraz indeks opisują przycisk i grupę godzin', () => {
        expect(G).toContain('pojawia się przycisk „Umów mimo grafiku”');
        expect(G).toContain('osobna grupa „Po grafiku”');
        expect(G).toContain('Wizyta po godzinach pracy / „Umów mimo grafiku”');
    });
});
