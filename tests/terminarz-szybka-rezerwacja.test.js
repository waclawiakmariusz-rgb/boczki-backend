// Szybka rezerwacja do wpłaty zadatku (hold) — decyzje właściciela z 30.10.2026 (docs/terminarz-szybka-rezerwacja/SPECYFIKACJA.md).
// Reguła terminu holdu jest czystą funkcją i jest tu liczona wprost; reszta to strażnik spójności serwera, mostu do zgód,
// strony linku, ekranu i przewodnika. Przebieg na żywo: narzedzia/proby/terminarz-szybka-rezerwacja-{a,b}.json (baza izolowana).
const fs = require('fs');
const path = require('path');
const KAT = path.join(__dirname, '..');
const czytaj = (p) => fs.readFileSync(path.join(KAT, p), 'utf8');
const SRV = czytaj('routes/terminarz.js');
const ZG = czytaj('routes/zgody.js');
const SERVER = czytaj('server.js');
const JS = czytaj('public/terminarz.js');
const CSS = czytaj('public/terminarz.css');
const LINK = czytaj('public/platnosc.html');
const KLIENCI_SRV = czytaj('routes/klienci.js');
const INDEX = czytaj('public/index.html');
const G = czytaj('public/estelio_pomoc_terminarz.html');
const wytnij = (zrodlo, od, doTxt) => { const a = zrodlo.indexOf(od); expect(a).toBeGreaterThan(-1); return zrodlo.slice(a, zrodlo.indexOf(doTxt, a + od.length)); };
const { terminHoldu } = require('../routes/terminarz');

describe('reguła terminu holdu (24 h od zapisu / 24 h przed wizytą / 2 h gdy blisko)', () => {
    test('wizyta za kilka dni — hold kończy się dobę po zapisie', () => {
        expect(terminHoldu('2026-11-02 12:00:00', '2026-11-05 10:00:00')).toBe('2026-11-03 12:00:00');
    });
    test('wizyta za 36 h — hold kończy się dobę przed wizytą, bo to wcześniej niż doba od zapisu', () => {
        expect(terminHoldu('2026-11-02 12:00:00', '2026-11-04 00:00:00')).toBe('2026-11-03 00:00:00');
    });
    test('dokładnie na granicy: wizyta za 24 h i 30 min → hold tylko 30 minut (do „doby przed”)', () => {
        expect(terminHoldu('2026-11-02 12:00:00', '2026-11-03 12:30:00')).toBe('2026-11-02 12:30:00');
    });
    test('wizyta za mniej niż dobę — hold 2 godziny', () => {
        expect(terminHoldu('2026-11-02 12:00:00', '2026-11-03 09:00:00')).toBe('2026-11-02 14:00:00');
        expect(terminHoldu('2026-11-02 12:00:00', '2026-11-02 18:00:00')).toBe('2026-11-02 14:00:00');
    });
    test('wizyta za godzinę — hold nigdy dłużej niż do jej startu', () => {
        expect(terminHoldu('2026-11-02 12:00:00', '2026-11-02 13:00:00')).toBe('2026-11-02 13:00:00');
    });
    test('wizyta już minęła — holdu nie ma', () => {
        expect(terminHoldu('2026-11-02 12:00:00', '2026-11-02 11:00:00')).toBeNull();
        expect(terminHoldu('2026-11-02 12:00:00', '2026-11-02 12:00:00')).toBeNull();
    });
});

describe('serwer: zapis holdu', () => {
    const zapisz = wytnij(SRV, "case 'trm_zapisz': {", "case 'trm_zmien': {");
    test('kolumny dopisywane idempotentnie, obie opcjonalne', () => {
        expect(SRV).toContain("alterKolumna('Term_Rezerwacje', 'hold_do', 'DATETIME NULL');");
        expect(SRV).toContain("alterKolumna('Term_Rezerwacje', 'zadatek_id', 'VARCHAR(64) NULL');");
        expect(ZG).toContain('ALTER TABLE ZgodyPlatnosci ADD COLUMN rezerwacja_id INT NULL');
    });
    test('hold wymaga telefonu (link idzie SMS-em) i przyszłego terminu', () => {
        expect(zapisz).toContain("if (hold && (telefon || '').replace(/\\D/g, '').length < 9) throw new BladUzytkownika('Szybka rezerwacja wymaga numeru telefonu");
        expect(zapisz).toContain('const holdDo = hold ? terminHoldu(cfg.terazStr, start) : null;');
        expect(zapisz).toContain("if (hold && !holdDo) throw new BladUzytkownika('Ta godzina już minęła");
    });
    test('jeden aktywny hold na numer telefonu', () => {
        expect(zapisz).toContain("status = 'do_wplaty' AND hold_do > NOW()");
        expect(zapisz).toContain("code: 'HOLD_TELEFON'");
    });
    test('hold zapisuje się w stanie do_wplaty z terminem ważności; zwykła wizyta nadal jako potwierdzona', () => {
        expect(zapisz).toContain("hold ? 'do_wplaty' : 'potwierdzona'");
        expect(zapisz).toMatch(/INSERT INTO Term_Rezerwacje \([^)]*hold_do\)/);
        expect(zapisz).toContain('szybka rezerwacja do wpłaty zadatku (termin trzymany do');
    });
    test('hold nie wysyła maila potwierdzającego i omija kontrolę zakupów (nic jeszcze nie kupiono)', () => {
        expect(zapisz).toContain('if (!hold) try { maileWizyt().potwierdzenieWTle(tenant, wyn.rezId, imie); }');
        expect(zapisz).toContain("if (cfg.ust.kontrola_zakupow === 'on' && !hold && zakupPoz.some(x => !x))");
    });
    test('szczegóły wizyty niosą hold_do, zadatek_id i stan linku', () => {
        expect(SRV).toContain('hold_do: dt(r.hold_do), zadatek_id: r.zadatek_id || null,');
        expect(SRV).toContain("zadatek_link: zadatekLink, link_dodatek: linkDodatek }");
        expect(JS).toContain("const linkOn = !!s.linkDodatek;");   // dostępność dodatku mówi serwer, nie pamięć przeglądarki
    });
});

describe('serwer: link, wpłata, zwolnienie, wygaszanie', () => {
    test('trzy nowe akcje są zarejestrowane i wymagają roli operacyjnej (recepcja + manager)', () => {
        for (const a of ['trm_hold_link', 'trm_hold_wplata', 'trm_hold_zwolnij']) {
            expect(SRV).toContain(`'${a}'`);
            expect(wytnij(SRV, `case '${a}': {`, 'const rez = await rezerwacja(tenant, d.id);')).toContain('wymagaj(r, ROLE_OPERACYJNE);');
        }
    });
    test('link do zadatku: tylko dla do_wplaty, przez dodatek platnosc_link, z prawdziwym linkiem tpay; jeden aktywny na hold', () => {
        const l = wytnij(SRV, "case 'trm_hold_link': {", "case 'trm_hold_wplata': {");
        expect(l).toContain("if (rez.status !== 'do_wplaty') throw");
        expect(l).toContain('hasFeature(tenant, ZG.FEATURE_KEY');
        expect(l).toContain('if (!ZG.tpayLinkOk(tpayLink)) throw');
        expect(l).toContain("UPDATE ZgodyPlatnosci SET status = 'ANULOWANA' WHERE tenant_id = ? AND rezerwacja_id = ? AND status = 'OCZEKUJACA'");
        expect(l).toContain("'zadatek_link', `link do zadatku ${kwota.toFixed(2)} zł");
    });
    test('wpłata: rekord zadatku, stan potwierdzona, ślad; po wygaśnięciu — zadatek na koncie i Sprawa E42, wizyta nie wraca', () => {
        const w = wytnij(SRV, "case 'trm_hold_wplata': {", "case 'trm_hold_zwolnij': {");
        expect(w).toContain("const poWygasnieciu = rez.status === 'wygasla' && !!rez.hold_do;");
        expect(w).toContain("INSERT INTO Zadatki (id, tenant_id, id_klienta, data_wplaty, klient, typ, kwota, metoda, cel, status, pracownicy, bon) VALUES (?, ?, ?, NOW(), ?, 'WPŁATA', ?, ?, ?, 'AKTYWNY', ?, 0)");
        expect(w).toContain("SET status = 'potwierdzona', id_klienta = COALESCE(id_klienta, ?), zadatek_id = ?");
        expect(w).toContain("typ: 'E42'");
        expect(w).not.toMatch(/poWygasnieciu[\s\S]{0,600}status = 'potwierdzona'/);
        // profil bez regulaminu powstaje tylko, gdy nikt nie wszedł w link — i jest jawnie tak oznaczony
        expect(w).toContain("'BRAK (szybka rezerwacja)'");
        expect(w).toContain('profil_bez_regulaminu: profilBezRegulaminu');
    });
    test('zwolnienie i wygaszenie idą tą samą drogą: pozycje anulowane, zasoby zwolnione, link unieważniony', () => {
        const z = wytnij(SRV, 'async function zakonczHold(tenant, rez, status, kto, powod) {', 'async function wygasHoldy() {');
        expect(z).toContain("UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND rezerwacja_id = ?");
        expect(z).toContain("WHERE tenant_id = ? AND id = ? AND status = 'do_wplaty'");
        expect(z).toContain("UPDATE ZgodyPlatnosci SET status = 'ANULOWANA'");
        const t = wytnij(SRV, 'async function wygasHoldy() {', 'router.holdPoAkceptacji =');
        expect(t).toContain("WHERE status = 'do_wplaty' AND hold_do IS NOT NULL AND hold_do <= NOW()");
        expect(t).toContain("typ: 'E40'");
        expect(t).toContain('INTERVAL 7 DAY');   // minimalizacja danych po tygodniu
        expect(SRV).toContain('try { await wygasHoldy(); }');
    });
    test('most z modułu zgód: akceptacja przypina profil, zostawia ślad i zakłada Sprawę E41', () => {
        const m = wytnij(SRV, 'router.holdPoAkceptacji = async (tenant, rezId, info) => {', 'router.holdInfo =');
        expect(m).toContain('id_klienta = COALESCE(id_klienta, ?)');
        expect(m).toContain("'regulamin', `regulamin zaakceptowany online");
        expect(m).toContain("typ: 'E41'");
        expect(SERVER).toContain("require('./routes/zgody')(db, { terminarz: terminarzHaki })");
        expect(SERVER).toContain('terminarzHaki.poAkceptacji = terminarzRoutes.holdPoAkceptacji;');
    });
});

describe('moduł zgód i strona linku', () => {
    test('po wygaśnięciu holdu info i akceptacja odmawiają PRZED ogólnym „anulowany”, bez tpay i bez profilu', () => {
        const info = wytnij(ZG, "router.get('/zgoda/info'", "router.post('/zgoda/akceptuj'");
        expect(info.indexOf('const hold = await stanHoldu(payload.t, z);')).toBeLessThan(info.indexOf("if (z.status === 'ANULOWANA')"));
        const akc = wytnij(ZG, "router.post('/zgoda/akceptuj'", 'async function stanHoldu(');
        expect(akc.indexOf('const hold = await stanHoldu(payload.t, z);')).toBeLessThan(akc.indexOf("if (z.status === 'ANULOWANA')"));
        expect(akc.indexOf('if (hold.blokada) return')).toBeLessThan(akc.indexOf('INSERT INTO Klienci'));
        expect(ZG).toContain("blokada: 'HOLD_WYGASL'");
        expect(ZG).toContain("blokada: 'HOLD_OPLACONY'");
        expect(ZG).toContain('terminarz.poAkceptacji(payload.t, z.rezerwacja_id');
    });
    test('strona linku pokazuje termin, zabiegi i „wpłata do”, podpowiada dane z rozmowy i nazywa wygaśnięcie po imieniu', () => {
        expect(LINK).toContain('id="w-termin"');
        expect(LINK).toContain('id="w-do"');
        expect(LINK).toContain("if (d.imie_podpowiedz) el('f-imie').value = d.imie_podpowiedz;");
        expect(LINK).toContain("kod === 'HOLD_WYGASL' ? 'Termin został zwolniony'");
        expect(LINK).toContain("pokazBlad(d.message, d.kod)");
    });
});

describe('ekran recepcji', () => {
    test('kreator: wejście „bez kartoteki” z imieniem i telefonem; klientka bez ID z flagą', () => {
        // pełny przycisk z ikoną SVG z prostych linii (uwaga właściciela 30.10: tekstowy odnośnik „wyglądał jak roboczy slop”; zasada: ikony SVG, nie emoji)
        expect(JS).toContain('<button type="button" class="trm-bk-start" onclick="TRM.nowaBezKartoteki()">${IKONA_TELEFON}<span class="t"><b>Szybka rezerwacja bez kartoteki</b>');
        expect(JS).toMatch(/const IKONA_TELEFON = '<svg class="ico" viewBox="0 0 24 24"/);
        expect(JS).not.toMatch(/nowaBezKartoteki\(\)">[^<]*[\u{1F300}-\u{1FAFF}]/u);
        expect(CSS).toContain('.trm-bk-start { display:flex;');
        // druga uwaga właściciela (30.10, zrzut z produkcji): żółta kreskowana ramka w kreatorze wyglądała roboczo —
        // formularz i wybór są teraz zwykłą kartą panelu ze złotym akcentem; kreskowany zostaje tylko kafelek na siatce
        expect(CSS).toContain('.trm-bk, .trm-wybrana.hold { background:var(--t-sur); border:1px solid var(--t-line); border-left:4px solid var(--t-gold);');
        expect(CSS).not.toMatch(/\.trm-bk \{[^}]*dashed/);
        expect(CSS).toContain('.trm-karta.hold { border-style:dashed;');
        expect(JS).toContain('<label>Telefon</label>');
        expect(JS).toContain('>Zapisz dane</button>');
        expect(JS).toContain("n.klient = { id_klienta: null, nazwa, telefon, bez_kartoteki: true };");
        expect(JS).toContain("if (telefon.replace(/\\D/g, '').length < 9) return toast('warning', 'Podaj numer telefonu'");
    });
    test('zapis niesie flagę hold i telefon; przycisk nazywa rzecz po imieniu', () => {
        expect(JS).toContain("bez_kartoteki: hold, hold, pozycje: n.pozycje");
        expect(JS).toContain("'Zarezerwuj do wpłaty zadatku'");
    });
    test('kartoteka, zakupy i historia nie są pytane o osobę bez ID', () => {
        expect(JS).toContain("if (!n || !n.klient || !n.klient.id_klienta) { if (n) n.zakupy = null; return; }");
        expect(JS).toContain("if (!n.klient || !n.klient.id_klienta || !kategorie.length)");
        expect(JS).toContain("if (n.klient.bez_kartoteki) return '';");
    });
    test('kafelek holdu: klasa hold, plakietka z terminem; wygasły hold nazwany', () => {
        expect(JS).toContain("${r.status === 'do_wplaty' ? 'hold' : ''}");
        expect(JS).toContain("zn.push(`<span class=\"st\">Do wpłaty do ${esc(krotkiTermin(r.hold_do))}</span>`)");
        expect(CSS).toContain('.trm-karta.hold { border-style:dashed;');
    });
    test('panel: karta Zadatek z osią zdarzeń, linkiem, „Zadatek wpłynął” i „Zwolnij termin”; 50% i zaokrąglenie do 10 zł', () => {
        expect(JS).toContain("if (op && s.tryb === 'podglad') html += zadatekKartaHtml(r, s);");
        expect(JS).toContain('* 0.5 * 100) / 100');
        expect(JS).toContain('h.kwota = Math.ceil(k / 10) * 10;');
        expect(JS).toContain(">${hold ? 'Zadatek wpłynął' : 'Wpłata mimo wygaśnięcia'}</button>");
        expect(JS).toContain('>Zwolnij termin</button>');
        expect(JS).toContain("if ((hold || wygaslaBezWplaty) && !r.zadatek_id) {");   // po zapisaniu wpłaty przyciski znikają
        expect(JS).toContain("TRM.holdLink = async (id) =>");
        expect(JS).toContain("api('trm_hold_wplata', { id, wersja: r.wersja, kwota: kw, metoda: met })");
    });
    test('hold nie dostaje akcji dnia wizyty (przybycie, spóźnienie, nieobecność)', () => {
        expect(JS).toContain("if (anul || !op || r.status === 'do_wplaty') return '';");
        expect((JS.match(/r\.wykonanie === 'zaplanowana' && r\.status !== 'do_wplaty'/g) || []).length).toBe(2);
    });
    test('zmiana licznika dzwonka odświeża siatkę i otwarty hold — bez odpytywania, gdy nic się nie stało', () => {
        const f = wytnij(JS, 'async function odswiezLicznikSpraw() {', 'TRM.idz =');
        expect(f).toContain("if (TRM._odciskSpraw && TRM._odciskSpraw !== odcisk) {");
        expect(f).toContain("odswiez({ cicho: true })");
    });
    test('typy spraw E40–E42 mają etykiety', () => {
        expect(JS).toContain("E40: 'Hold wygasł bez wpłaty'");
        expect(JS).toContain("E41: 'Regulamin zaakceptowany — sprawdź wpłatę'");
        expect(JS).toContain("E42: 'Wpłata po wygaśnięciu terminu'");
    });
});

describe('odróżnienie w Klientach', () => {
    test('lista klientek oznacza profile z linku i z wpłaty bez regulaminu', () => {
        expect(KLIENCI_SRV).toContain("rezerwacja_online: r.zgody_rodo_reg === 'Regulamin (online przy płatności)' ? 'link' : /szybka rezerwacja/i.test(String(r.zgody_rodo_reg || '')) ? 'hold' : null,");
        expect(INDEX).toContain('🔗 z linku online</span>');
        expect(INDEX).toContain('📞 szybka rezerwacja · regulamin do podpisania</span>');
        expect(INDEX).toContain('let ikony = rodoIcon + oswIcon + dodIcon + pubBadge + onlineBadge;');
    });
});

describe('przewodnik mówi to samo, co robi system', () => {
    test('jest rozdział o szybkiej rezerwacji i wpis w indeksie', () => {
        expect(G).toContain('id="szybka-rezerwacja"');
        expect(G).toContain('Szybka rezerwacja do wpłaty zadatku');
        expect(G).toMatch(/<tr><td>[^<]*zadatek[^<]*<\/td><td><a href="#szybka-rezerwacja">/i);
    });
    test('rozdział nazywa granice: brak potwierdzenia od tpay, dzień/doba przed, jeden hold na numer', () => {
        const r = wytnij(G, 'id="szybka-rezerwacja"', '</section>');
        expect(r).toMatch(/tpay/);
        expect(r).toMatch(/24 godzin|dobę/);
        expect(r).toMatch(/tylko jeden termin naraz|jeden (aktywny )?hold/i);
        expect(r).toMatch(/Zadatek wpłynął/);
    });
});
