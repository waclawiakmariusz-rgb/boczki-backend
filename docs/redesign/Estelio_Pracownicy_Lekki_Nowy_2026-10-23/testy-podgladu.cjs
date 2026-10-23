const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const failures = [];
  page.on('pageerror', e => failures.push(e.message));
  const url = pathToFileURL(path.join(__dirname, 'index.html')).href;
  const passed = [];
  async function ready(query = '') { await page.goto(url + query); await page.evaluate(() => window.employeesDemo.ready); }
  async function test(name, fn) { await fn(); passed.push(name); console.log('PASS ' + name); }
  const count = () => page.locator('.emp-row').count();
  try {
    await test('01 — 8 osób i zgodny licznik', async () => { await ready(); assert.equal(await count(), 8); assert.equal(await page.locator('[data-count]').innerText(), '8'); });
    await page.screenshot({ path: path.join(__dirname, '02-podglad-desktop.png'), fullPage: true });
    await test('02 — puste pole bez zapisu', async () => { await page.locator('[data-add-button]').click(); assert.equal(await page.locator('[data-name]').getAttribute('aria-invalid'), 'true'); assert.equal(await count(), 8); });
    await test('03 — dodawanie przez Enter', async () => { await page.locator('[data-name]').fill('Testowa Kowalska'); await page.locator('[data-name]').press('Enter'); await page.waitForFunction(() => document.querySelector('[data-count]').textContent === '9'); assert.equal(await count(), 9); });
    await test('04 — duplikat pozostawia wpisany tekst', async () => { await page.waitForFunction(() => !document.querySelector('[data-name]').disabled); await page.locator('[data-name]').fill('Testowa Kowalska'); await page.locator('[data-add-button]').click(); await page.waitForFunction(() => !document.querySelector('[data-name]').disabled); assert.match(await page.locator('[data-field-error]').innerText(), /już na liście/); assert.equal(await count(), 9); });
    await test('05 — Escape anuluje usunięcie i oddaje fokus', async () => { await page.locator('.emp-delete').first().click(); await page.keyboard.press('Escape'); assert.equal(await page.locator('[data-dialog]').evaluate(e => e.open), false); assert.equal(await count(), 9); assert.equal(await page.locator('.emp-delete').first().evaluate(e => e === document.activeElement), true); });
    await test('06 — usunięcie potwierdzone', async () => { await page.locator('.emp-delete').first().click(); await page.screenshot({ path: path.join(__dirname, '04-podglad-potwierdzenie.png') }); await page.locator('[data-confirm]').click(); await page.waitForFunction(() => !document.querySelector('[data-dialog]').open); assert.equal(await count(), 8); assert.equal(await page.getByText('Anna Kowalska', { exact: true }).count(), 0); });
    await test('07 — pomoc otwierana i zamykana klawiaturą', async () => { await page.locator('[data-help-toggle]').click(); assert.equal(await page.locator('[data-help]').isVisible(), true); await page.keyboard.press('Escape'); assert.equal(await page.locator('[data-help]').isVisible(), false); });
    await test('08 — pusta lista', async () => { await ready('?stan=pusty'); assert.equal(await count(), 0); assert.match(await page.locator('[data-list-state]').innerText(), /Nie ma jeszcze/); });
    await test('09 — błąd odczytu odróżniony od pustej listy', async () => { await ready('?stan=blad-listy'); assert.equal(await page.locator('[data-count]').isVisible(), false); assert.equal(await page.locator('[data-retry]').isVisible(), true); });
    await test('10 — błąd zapisu zachowuje nazwę', async () => { await ready('?stan=blad-zapisu'); await page.locator('[data-name]').fill('Nowa osoba'); await page.locator('[data-add-button]').click(); await page.waitForFunction(() => !document.querySelector('[data-name]').disabled); assert.equal(await page.locator('[data-name]').inputValue(), 'Nowa osoba'); assert.equal(await count(), 8); });
    await test('11 — blokada usunięcia i powrót fokusu po odświeżeniu', async () => { await ready('?stan=blokada'); await page.locator('.emp-delete').first().click(); await page.locator('[data-confirm]').click(); await page.waitForFunction(() => !document.querySelector('[data-confirm]').disabled); assert.equal(await count(), 8); assert.match(await page.locator('[data-remove-error]').innerText(), /powiązania/); await page.locator('[data-cancel]').click(); assert.equal(await page.locator('.emp-delete').first().evaluate(e => e === document.activeElement), true); });
    await test('12 — same dane bez mutacji', async () => { await ready('?stan=podglad'); assert.equal(await page.locator('[data-add-form]').isVisible(), false); assert.equal(await page.locator('.emp-delete').count(), 0); });
    await test('13 — 400 px i długa nazwa', async () => { await page.setViewportSize({ width: 400, height: 850 }); await ready('?stan=dluga-nazwa'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: path.join(__dirname, '03-podglad-mobile.png'), fullPage: true }); });
    await test('14 — 320 px oraz pomoc bez przepełnienia', async () => { await page.setViewportSize({ width: 320, height: 640 }); await page.locator('[data-help-toggle]').click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); });
    await test('15 — nazwa jako tekst, bez interpretacji HTML', async () => { await ready(); await page.locator('[data-name]').fill('<img src=x onerror=alert(1)>'); await page.locator('[data-add-button]').click(); await page.waitForFunction(() => !document.querySelector('[data-name]').disabled); assert.equal(await page.locator('.emp-name img').count(), 0); assert.equal(await page.locator('.emp-name').last().textContent(), '<img src=x onerror=alert(1)>'); });
    await test('16 — brak błędów wykonania JavaScript', async () => { assert.deepEqual(failures, []); });
    fs.writeFileSync(path.join(__dirname, 'testy-wynik.json'), JSON.stringify({ passed: passed.length, failed: 0, tests: passed, scope: 'Lokalny podgląd z adapterem demo; brak połączenia z Estelio.' }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
