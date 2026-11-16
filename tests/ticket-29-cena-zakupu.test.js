// Ticket #29 (Gosia, 14.11.2026), część 1: w edycji produktu magazynu pro (sekcja #rap_add) pole ceny nazywało się
// „Cena sprzedaży brutto” z podpisem „Uzupełnij, jeśli produkt sprzedajesz detalicznie”, a do tego magazynu trafiają
// produkty do użytku w gabinecie, nie do sprzedaży — pole to cena zakupu. Serwer zapisuje ją jak dotąd (cena_brutto),
// nic z niej nie liczy. Część 2 (przyjęcia z datami ważności) to osobny projekt partii — poza tym testem.
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

describe('ticket #29 — cena w edycji produktu magazynu pro', () => {
    const od = INDEX.indexOf('<div id="rap_add" class="section');
    const do_ = INDEX.indexOf('</form>', od);
    const FORM = INDEX.slice(od, do_);

    test('formularz produktu istnieje i ma pole ceny z etykietą „Cena zakupu brutto”', () => {
        expect(od).toBeGreaterThan(-1);
        expect(FORM).toContain('<label for="rap_p_price">Cena zakupu brutto');
        expect(FORM).toContain('id="rap_p_price"');
    });

    test('podpis mówi, czym jest ta cena, i nie sugeruje sprzedaży detalicznej', () => {
        expect(FORM).toContain('Cena, za jaką salon kupił produkt do użytku w gabinecie.');
        expect(FORM).not.toContain('Uzupełnij, jeśli produkt sprzedajesz detalicznie');
        expect(FORM).not.toContain('Cena sprzedaży brutto');
    });

    test('podpis jest jednym zdaniem (uwaga właściciela 16.11: bez dopisku o liczeniu)', () => {
        const i = FORM.indexOf('<span class="ei-help">Cena, za jaką salon kupił produkt do użytku w gabinecie.');
        expect(i).toBeGreaterThan(-1);
        expect(FORM.slice(i, FORM.indexOf('</span>', i))).not.toMatch(/nic z niej|Tylko do informacji/);
    });

    test('sufiks „zł” nie wystaje pod pole: input w grupie jest blokiem (ramka równa z polem)', () => {
        const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'magazyn-produkt.css'), 'utf8');
        expect(CSS).toMatch(/\.estelio-inventory \.ei-input-group input\.modern-form-control \{[^}]*display: block;/);
        expect(CSS).toMatch(/\.estelio-inventory \.ei-suffix \{[^}]*position: absolute;[^}]*bottom: 1px;/);
    });

    test('zapis i odczyt pola bez zmian (price_gross → cena_brutto po stronie serwera)', () => {
        expect(INDEX).toContain("price_gross: document.getElementById('rap_p_price').value");
        const RAPORT = fs.readFileSync(path.join(__dirname, '..', 'routes', 'raport.js'), 'utf8');
        expect(RAPORT).toMatch(/cena_brutto = \?/);
        expect(RAPORT).toMatch(/Number\(d\.price_gross\)/);
    });
});
