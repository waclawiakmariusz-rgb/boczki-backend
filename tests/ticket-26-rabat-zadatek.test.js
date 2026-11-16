// Ticket #26 (Gosia, 14.11.2026): rabat na wierszu zadatku dawał 0,00 zł, bo obslugaRabatu liczył od ukrytej ceny bazowej
// wiersza (wypełnianej tylko dla zabiegu/kosmetyku). Decyzja właściciela 16.11: rabat liczy się od CENY ZABIEGU, a zadatek
// jest proponowany od ceny po rabacie (ta sama ścieżka co propozycja z ustawień zadatków: progi/procent).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const wyc = (od, doTxt) => { const a = INDEX.indexOf(od); expect(a).toBeGreaterThan(-1); const b = INDEX.indexOf(doTxt, a); expect(b).toBeGreaterThan(a); return INDEX.slice(a, b); };

describe('ticket #26 — rabat na zadatku od ceny zabiegu', () => {
    const liczRabat = (() => {
        const src = wyc('function liczRabatOdCeny(', 'const zad_timeryRabatu');
        const ctx = {}; vm.createContext(ctx); vm.runInContext(src + '\nthis.f = liczRabatOdCeny;', ctx); return ctx.f;
    })();

    test('matematyka rabatu liczona od podanej ceny zabiegu (nie od zera)', () => {
        expect(liczRabat(699, 'MANUAL_PLN', '100')).toEqual({ kwota: 100, opis: 'Rabat: -100 zł' });
        expect(liczRabat(699, 'MANUAL_PERC', '10').kwota).toBeCloseTo(69.9, 2);
        expect(liczRabat(699, 'PROCENT|15|Urodzinowy')).toEqual({ kwota: expect.closeTo(104.85, 2), opis: 'Urodzinowy: -15%' });
        expect(liczRabat(699, 'KWOTA|50|Promo')).toEqual({ kwota: 50, opis: 'Promo: -50 zł' });
        expect(liczRabat(699, '', '')).toEqual({ kwota: 0, opis: '' });
        expect(liczRabat('699', 'MANUAL_PLN', 'abc').kwota).toBe(0);
    });

    test('obslugaRabatu kieruje wiersz ZADATKU na własną ścieżkę zanim sięgnie po cenę bazową wiersza', () => {
        const F = wyc('function obslugaRabatu(id) {', '\nfunction przeliczCeneWiersza');
        const iZadatek = F.indexOf("typWiersza === 'Zadatek'");
        const iBaza = F.indexOf('const basePrice = parseFloat(document.getElementById(`base-price-${id}`).value)');
        expect(iZadatek).toBeGreaterThan(-1);
        expect(iBaza).toBeGreaterThan(iZadatek);
        expect(F).toContain('return obslugaRabatuZadatku(id, row, val, manualBox, manualInput, manualSymbol, infoDiv, priceInput);');
        // ścieżka zabiegu/kosmetyku bez zmian: nadal liczy od ceny bazowej i przelicza podział przy Portfelu
        expect(F).toContain('finalPrice = basePrice - discountAmount;');
        expect(F).toContain("if (payMethod.value === 'Portfel' || payMethod.value === 'Zadatek') {");
    });

    test('ścieżka zadatku: cena zabiegu z .zad-base-price, propozycja od ceny po rabacie, opis rabatu do zapisu, kwota nie jest zerowana', () => {
        const Z = wyc('function obslugaRabatuZadatku(', '\n// GŁÓWNA LOGIKA RABATU');
        expect(Z).toContain("const cenaZabiegu = parseFloat((row.querySelector('.zad-base-price') || {}).value) || 0;");
        expect(Z).toContain('const cenaPoRabacie = Math.max(0, cenaZabiegu - r.kwota);');
        expect(Z).toContain('zad_wyliczPropozycje(row, cenaPoRabacie, dopisek)');
        expect(Z).toContain('row.dataset.discountInfo = `${r.opis} od ceny zabiegu`;');
        expect(Z).not.toContain('priceInput.value = finalPrice');
        expect(Z).not.toMatch(/priceInput\.value = ['"]?0/);
        // bez ceny z listy rabat nie rusza kwoty i nie zapisuje opisu
        expect(Z).toContain('if (cenaZabiegu <= 0) {');
        expect(Z).toContain("row.dataset.discountInfo = '';");
        // zdjęcie rabatu wraca do propozycji od pełnej ceny
        expect(Z).toContain("if (cenaZabiegu > 0) zad_wyliczPropozycje(row, cenaZabiegu, '');");
    });

    test('zmiana wariantu przy wybranym rabacie przelicza od ceny po rabacie, a propozycja idzie z kwotą zabiegu do /zadatki/oblicz', () => {
        const W = wyc('function zad_zmienWariant(selectEl) {', '\nfunction zad_wyliczPropozycje');
        expect(W).toContain("if (rabatSelect && rabatSelect.value) { obslugaRabatu(id); return; }");
        expect(W).toContain("zad_wyliczPropozycje(row, cenaBazowa, '');");
        const P = wyc('function zad_wyliczPropozycje(row, kwotaZabiegu, dopisek) {', '\nfunction usunWiersz');
        expect(P).toContain("fetch('/api/ustawienia/zadatki/oblicz'");
        expect(P).toContain('body: JSON.stringify({ tenant_id, kwota_zabiegu: kwotaZabiegu })');
        expect(P).toContain("priceInput.value = parseFloat(d.zadatek_proponowany || 0).toFixed(2);");
    });
});
