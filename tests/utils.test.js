// tests/utils.test.js
// Testy jednostkowe dla routes/utils.js

const { parseNum, parseIlosc, parseKwota, parseNumOpt } = require('../routes/utils');

// ─── parseNum ─────────────────────────────────────────────────
describe('parseNum', () => {
    test('akceptuje liczbę całkowitą', () => {
        expect(parseNum('5')).toBe(5);
    });

    test('akceptuje liczbę z kropką', () => {
        expect(parseNum('1.3')).toBe(1.3);
    });

    test('akceptuje liczbę z przecinkiem (polska notacja)', () => {
        expect(parseNum('1,3')).toBe(1.3);
    });

    test('akceptuje liczbę przekazaną jako number', () => {
        expect(parseNum(42)).toBe(42);
    });

    test('zwraca domyślną wartość dla pustego stringa', () => {
        expect(parseNum('')).toBe(0);
        expect(parseNum(null)).toBe(0);
        expect(parseNum(undefined)).toBe(0);
    });

    test('rzuca błąd dla daty (problem z Excelem)', () => {
        expect(() => parseNum('1900-01-01')).toThrow();
        expect(() => parseNum('2024-03-01')).toThrow();
        expect(() => parseNum('1.3.2024')).toThrow();
    });

    test('rzuca błąd dla tekstu', () => {
        expect(() => parseNum('abc')).toThrow();
        expect(() => parseNum('sto złotych')).toThrow();
    });

    test('rzuca błąd gdy wymagana i puste', () => {
        expect(() => parseNum('', { wymagana: true, pole: 'kwota' })).toThrow('kwota');
    });

    test('akceptuje zero', () => {
        expect(parseNum('0')).toBe(0);
        expect(parseNum(0)).toBe(0);
    });

    test('akceptuje wartości ujemne (parseNum nie blokuje negacji)', () => {
        expect(parseNum('-5')).toBe(-5);
    });
});

// ─── parseIlosc ───────────────────────────────────────────────
describe('parseIlosc', () => {
    test('akceptuje ilość całkowitą', () => {
        expect(parseIlosc('10')).toBe(10);
    });

    test('akceptuje ilość ułamkową z przecinkiem', () => {
        expect(parseIlosc('1,5')).toBe(1.5);
    });

    test('rzuca błąd dla wartości ujemnych', () => {
        expect(() => parseIlosc('-1')).toThrow();
        expect(() => parseIlosc('-0.5')).toThrow();
    });

    test('rzuca błąd dla daty', () => {
        expect(() => parseIlosc('1900-01-01')).toThrow();
    });

    test('rzuca błąd dla pustej wartości (wymagana)', () => {
        expect(() => parseIlosc('')).toThrow();
        expect(() => parseIlosc(null)).toThrow();
    });

    test('akceptuje zero', () => {
        expect(parseIlosc('0')).toBe(0);
    });
});

// ─── parseKwota ───────────────────────────────────────────────
describe('parseKwota', () => {
    test('akceptuje kwotę z kropką', () => {
        expect(parseKwota('199.99')).toBe(199.99);
    });

    test('akceptuje kwotę z przecinkiem', () => {
        expect(parseKwota('199,99')).toBe(199.99);
    });

    test('zaokrągla do 2 miejsc po przecinku', () => {
        expect(parseKwota('1.999')).toBe(2.00);
        expect(parseKwota('1.001')).toBe(1.00);
    });

    test('rzuca błąd dla wartości ujemnych', () => {
        expect(() => parseKwota('-50')).toThrow();
    });

    test('rzuca błąd dla tekstu', () => {
        expect(() => parseKwota('pięćdziesiąt')).toThrow();
    });

    test('rzuca błąd dla pustej wartości', () => {
        expect(() => parseKwota('')).toThrow();
    });

    test('akceptuje zero', () => {
        expect(parseKwota('0')).toBe(0);
    });
});

// ─── parseNumOpt ──────────────────────────────────────────────
describe('parseNumOpt', () => {
    test('zwraca 0 dla pustej wartości', () => {
        expect(parseNumOpt('')).toBe(0);
        expect(parseNumOpt(null)).toBe(0);
    });

    test('zwraca podaną domyślną wartość dla pustej', () => {
        expect(parseNumOpt('', 5)).toBe(5);
    });

    test('parsuje normalnie gdy wartość podana', () => {
        expect(parseNumOpt('3,14')).toBe(3.14);
    });

    test('rzuca błąd dla daty lub tekstu', () => {
        expect(() => parseNumOpt('1900-01-01')).toThrow();
        expect(() => parseNumOpt('tekst')).toThrow();
    });
});
