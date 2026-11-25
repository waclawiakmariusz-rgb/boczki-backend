// tests/klub-data-resetu-panel.test.js
// Panel Klub → Ustawienia: popup potwierdzenia przed zmianą daty resetu punktów (polecenie właściciela 25.11.2026:
// „popup z pytaniem czy aby na 100% chce zresetować wszystkim punkty z dniem xx”) i walidacja po stronie przeglądarki.
// Funkcje wycinane z public/index.html i uruchamiane z atrapą DOM — bez przeglądarki.
const fs = require('fs');
const path = require('path');

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

const MIESIACE = (INDEX.match(/const KLUBADM_MIESIACE = \[[^\]]*\];/) || [''])[0];
if (!MIESIACE) throw new Error('brak KLUBADM_MIESIACE w index.html');
const POMOCNICY = MIESIACE + '\n' + [
    'function klubadm_normalizujDateResetu(v) {',
    'function klubadm_dataPL(v) {',
    'function klubadm_dzisiajISO() {',
    'function klubadm_pytanieOReset(nowaData, staraData) {',
].map((h) => wytnijFunkcje(INDEX, h)).join('\n');
const ZAPISZ = wytnijFunkcje(INDEX, 'async function klubadm_zapiszUstawienia() {');

const pomocnicy = new Function(POMOCNICY + '; return { klubadm_normalizujDateResetu, klubadm_dataPL, klubadm_dzisiajISO, klubadm_pytanieOReset };')();

/** Atrapa panelu: pola ustawień + status + confirm + API. */
function panel({ wPolu, zBazy, odpowiedz }) {
    const pola = {
        'klubadm-ust-status': { textContent: '' },
        'klubadm-reset-data': { value: wPolu },
        'klubadm-nazwa': { value: 'Klub' }, 'klubadm-pkt': { value: '1' }, 'klubadm-bonus': { value: '20' }, 'klubadm-polecenie': { value: '0' },
    };
    const document = { getElementById: (id) => pola[id] };
    const confirm = jest.fn(() => odpowiedz);
    const klubadm_apiPost = jest.fn(() => Promise.resolve({ status: 'success', message: 'Zapisano. Reset punktów: test.' }));
    const klubadm_zaladujUstawienia = jest.fn();
    const zapisz = new Function('document', 'confirm', 'klubadm_apiPost', 'klubadm_zaladujUstawienia', 'klubadm_dataResetuZBazy',
        POMOCNICY + '\n' + ZAPISZ + '; return klubadm_zapiszUstawienia;')(document, confirm, klubadm_apiPost, klubadm_zaladujUstawienia, zBazy);
    return { pola, confirm, klubadm_apiPost, klubadm_zaladujUstawienia, zapisz };
}

const jutro = () => { const d = new Date(Date.now() + 24 * 60 * 60 * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

describe('Pytanie w popupie', () => {
    test('nowa data: „Czy na 100% chcesz ustawić reset punktów na 1 stycznia 2028?” + ostrzeżenie o WSZYSTKICH członkach Klubu + Dziennik', () => {
        const p = pomocnicy.klubadm_pytanieOReset('2028-01-01', '');
        expect(p).toMatch(/^Czy na 100% chcesz ustawić reset punktów na 1 stycznia 2028\?/);
        expect(p).toMatch(/Tego dnia o północy WSZYSTKIM członkom Klubu wygasną wszystkie punkty i zaczną naliczać się od nowa\./);
        expect(p).toMatch(/Zmiana zostanie zapisana w Dzienniku Zdarzeń z Twoim imieniem\./);
        expect(p).not.toMatch(/dotychczasowa data/);
    });

    test('zmiana istniejącej daty wymienia dotychczasową; wyłączenie pyta osobno; brak zmiany = brak pytania', () => {
        expect(pomocnicy.klubadm_pytanieOReset('2028-03-01', '2028-01-01')).toMatch(/ustawić reset punktów na 1 marca 2028\?[\s\S]*\(dotychczasowa data: 1 stycznia 2028\)\./);
        expect(pomocnicy.klubadm_pytanieOReset('', '2028-01-01')).toMatch(/^Wyłączyć reset punktów\? Punkty przestaną wygasać \(dotychczasowa data: 1 stycznia 2028\)\./);
        expect(pomocnicy.klubadm_pytanieOReset('2028-01-01', '2028-01-01')).toBe('');
        expect(pomocnicy.klubadm_pytanieOReset('', '')).toBe('');
    });

    test('29 lutego w pytaniu brzmi „1 marca” — tak samo, jak zapisze serwer', () => {
        expect(pomocnicy.klubadm_normalizujDateResetu('2028-02-29')).toBe('2028-03-01');
        expect(pomocnicy.klubadm_normalizujDateResetu('2028-01-05')).toBe('2028-01-05');
        expect(pomocnicy.klubadm_normalizujDateResetu('śmieci')).toBe('');
        expect(pomocnicy.klubadm_dataPL('2028-03-01')).toBe('1 marca 2028');
        expect(pomocnicy.klubadm_dzisiajISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe('Zapis ustawień z popupem', () => {
    test('odpowiedź NIE: nic nie idzie do serwera, pole wraca do dotychczasowej daty, status „Anulowano”', async () => {
        const p = panel({ wPolu: '2029-01-01', zBazy: '2028-01-01', odpowiedz: false });
        await p.zapisz();
        expect(p.confirm).toHaveBeenCalledTimes(1);
        expect(p.confirm.mock.calls[0][0]).toMatch(/^Czy na 100% chcesz ustawić reset punktów na 1 stycznia 2029\?/);
        expect(p.klubadm_apiPost).not.toHaveBeenCalled();
        expect(p.pola['klubadm-reset-data'].value).toBe('2028-01-01');
        expect(p.pola['klubadm-ust-status'].textContent).toBe('Anulowano — data resetu bez zmian (1 stycznia 2028).');
    });

    test('odpowiedź NIE przy pierwszym ustawieniu: pole znów puste', async () => {
        const p = panel({ wPolu: '2028-01-01', zBazy: '', odpowiedz: false });
        await p.zapisz();
        expect(p.klubadm_apiPost).not.toHaveBeenCalled();
        expect(p.pola['klubadm-reset-data'].value).toBe('');
        expect(p.pola['klubadm-ust-status'].textContent).toBe('Anulowano — data resetu bez zmian.');
    });

    test('odpowiedź TAK: zapis idzie do serwera z datą i reset_roczny=1, potem odświeżenie ustawień', async () => {
        const p = panel({ wPolu: '2028-01-01', zBazy: '', odpowiedz: true });
        await p.zapisz();
        expect(p.confirm).toHaveBeenCalledTimes(1);
        expect(p.klubadm_apiPost).toHaveBeenCalledTimes(1);
        expect(p.klubadm_apiPost.mock.calls[0][0]).toMatchObject({ action: 'loj_ustawienia_zapisz', nastepny_reset: '2028-01-01', reset_roczny: 1 });
        expect(p.pola['klubadm-ust-status'].textContent).toBe('✅ Zapisano. Reset punktów: test.');
        expect(p.klubadm_zaladujUstawienia).toHaveBeenCalledTimes(1);
    });

    test('29 lutego: popup pyta o 1 marca 2028', async () => {
        const p = panel({ wPolu: '2028-02-29', zBazy: '2028-01-01', odpowiedz: true });
        await p.zapisz();
        expect(p.confirm.mock.calls[0][0]).toMatch(/ustawić reset punktów na 1 marca 2028\?/);
        expect(p.klubadm_apiPost).toHaveBeenCalledTimes(1);
    });

    test('data dzisiejsza lub z przeszłości: błąd od razu, bez popupu i bez zapisu', async () => {
        for (const zla of ['2026-01-01', pomocnicy.klubadm_dzisiajISO()]) {
            const p = panel({ wPolu: zla, zBazy: '2028-01-01', odpowiedz: true });
            await p.zapisz();
            expect(p.confirm).not.toHaveBeenCalled();
            expect(p.klubadm_apiPost).not.toHaveBeenCalled();
            expect(p.pola['klubadm-ust-status'].textContent).toMatch(/^Błąd: Data resetu punktów musi być w przyszłości/);
        }
    });

    test('jutro już wolno (z popupem)', async () => {
        const p = panel({ wPolu: jutro(), zBazy: '', odpowiedz: true });
        await p.zapisz();
        expect(p.confirm).toHaveBeenCalledTimes(1);
        expect(p.klubadm_apiPost).toHaveBeenCalledTimes(1);
    });

    test('zapis bez zmiany daty (np. tylko nazwa klubu) nie pyta o nic', async () => {
        const p = panel({ wPolu: '2028-01-01', zBazy: '2028-01-01', odpowiedz: false });
        await p.zapisz();
        expect(p.confirm).not.toHaveBeenCalled();
        expect(p.klubadm_apiPost).toHaveBeenCalledTimes(1);
    });

    test('wyczyszczenie pola pyta o wyłączenie resetu; NIE przywraca datę', async () => {
        const p = panel({ wPolu: '', zBazy: '2028-01-01', odpowiedz: false });
        await p.zapisz();
        expect(p.confirm.mock.calls[0][0]).toMatch(/^Wyłączyć reset punktów\?/);
        expect(p.klubadm_apiPost).not.toHaveBeenCalled();
        expect(p.pola['klubadm-reset-data'].value).toBe('2028-01-01');
    });
});
