// Uruchomienie: node --test tests/obliczenia.test.cjs. Bez instalacji zależności.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMoney, parseQuantity, parseDate, totalCents } = require('../przyjecie-towaru.js');

test('kwoty z przecinkiem, kropką i separatorem tysięcy', () => {
  for (const [raw, expected] of [['98,40',9840],['98.40',9840],['80',8000],['98,',9800],['0,01',1],['1 234,56',123456],['1\u00a0234,56',123456]]) assert.equal(parseMoney(raw), expected, raw);
});
test('pusta kwota nie jest zerem', () => {
  assert.equal(parseMoney(''), null); assert.equal(parseMoney('  '), null); assert.equal(parseMoney('0,00'), 0);
});
test('odrzucenie niepoprawnych i nadmiernie dokładnych kwot', () => {
  for (const raw of ['-1','1,234','1e3','1,2.3','12 zł','1 2','0x10','NaN','Infinity','9007199254740992']) assert.equal(parseMoney(raw), null, raw);
});
test('suma z makiety i zmiana na 7 sztuk', () => {
  assert.equal(totalCents(6, parseMoney('98,40')), 59040);
  assert.equal(totalCents(7, parseMoney('98,40')), 68880);
});
test('obliczenie w groszach nie dodaje VAT', () => {
  assert.equal(totalCents(3, parseMoney('0,10')), 30);
  assert.equal(totalCents(6, parseMoney('98,40')), 59040);
});
test('niepełne i przepełnione podsumowanie', () => {
  assert.equal(totalCents(null, 9840), null); assert.equal(totalCents(6, null), null);
  assert.equal(totalCents(Number.MAX_SAFE_INTEGER, 100), null);
});
test('ilość musi być dodatnią bezpieczną liczbą całkowitą', () => {
  assert.equal(parseQuantity('6'), 6); assert.equal(parseQuantity(' 50 '), 50);
  for (const raw of ['', '0', '-1', '2,5', '2.5', '1e2', 'abc', '9007199254740992']) assert.equal(parseQuantity(raw), null, raw);
});
test('format daty i zachowanie dnia bez stref czasowych', () => {
  assert.equal(parseDate('31.12.2027'), '2027-12-31'); assert.equal(parseDate('2027-12-31'), '2027-12-31');
  assert.equal(parseDate('29.03.2026'), '2026-03-29'); assert.equal(parseDate('25.10.2026'), '2026-10-25');
});
test('pusta data i błędna data to różne stany', () => {
  assert.equal(parseDate(''), null); assert.equal(parseDate('31.02.2027'), undefined);
});
test('lata przestępne i niemożliwe dni', () => {
  assert.equal(parseDate('29.02.2028'), '2028-02-29'); assert.equal(parseDate('29.02.2000'), '2000-02-29');
  for (const raw of ['29.02.2027','29.02.2100','31.04.2027','00.12.2027','31.13.2027','1.2.27','2027-2-1','31.12.0000']) assert.equal(parseDate(raw), undefined, raw);
});
test('komponent odmawia uruchomienia bez adaptera zapisu', () => {
  const { mount } = require('../przyjecie-towaru.js');
  assert.throws(() => mount({ matches: () => true }, { loadCatalog() {} }), /loadCatalog i save/);
});
