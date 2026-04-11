// routes/utils.js
// Wspólne funkcje pomocnicze

/**
 * Parsuje liczbę akceptując zarówno przecinek jak i kropkę jako separator dziesiętny.
 * Chroni przed wpisaniem daty (np. "1.3" interpretowanej jako 1 marca) czy innych śmieci.
 *
 * @param {*} val - wartość od użytkownika (string, number, null)
 * @param {Object} opts
 * @param {number} opts.domyslna - wartość domyślna gdy puste (domyślnie 0)
 * @param {boolean} opts.wymagana - rzuć błąd jeśli puste/null (domyślnie false)
 * @param {string} opts.pole - nazwa pola do komunikatu błędu
 * @returns {number}
 */
function parseNum(val, opts = {}) {
    const { domyslna = 0, wymagana = false, pole = 'wartość' } = opts;

    if (val === null || val === undefined || String(val).trim() === '') {
        if (wymagana) throw new Error(`Pole "${pole}" jest wymagane.`);
        return domyslna;
    }

    // Zamień przecinek na kropkę (polska notacja dziesiętna)
    const znormalizowana = String(val).trim().replace(',', '.');

    // Odrzuć daty i inne stringi nie będące liczbami
    if (!/^-?\d+(\.\d+)?$/.test(znormalizowana)) {
        throw new Error(`Nieprawidłowa wartość dla pola "${pole}": "${val}". Podaj liczbę (np. 1.3 lub 1,3).`);
    }

    const n = parseFloat(znormalizowana);
    if (isNaN(n)) throw new Error(`Nieprawidłowa wartość dla pola "${pole}": "${val}".`);
    return n;
}

/**
 * Parsuje ilość (zawsze >= 0).
 */
function parseIlosc(val, pole = 'ilość') {
    const n = parseNum(val, { wymagana: true, pole });
    if (n < 0) throw new Error(`Pole "${pole}" nie może być ujemne.`);
    return n;
}

/**
 * Parsuje kwotę pieniężną (>= 0, zaokrąglona do 2 miejsc).
 */
function parseKwota(val, pole = 'kwota') {
    const n = parseNum(val, { wymagana: true, pole });
    if (n < 0) throw new Error(`Pole "${pole}" nie może być ujemne.`);
    return Math.round(n * 100) / 100;
}

/**
 * Parsuje opcjonalną kwotę/ilość — zwraca domyślną wartość jeśli puste.
 */
function parseNumOpt(val, domyslna = 0) {
    return parseNum(val, { domyslna });
}

module.exports = { parseNum, parseIlosc, parseKwota, parseNumOpt };
