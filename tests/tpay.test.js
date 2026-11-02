// tests/tpay.test.js — Tpay przez API, partia 1 (2.11.2026): szyfrowanie per salon, konfiguracja, webhook, spięcia.
// Bez bazy i bez sieci: mock db dopasowywany po treści SQL, TPAY_API=atrapa dla ścieżek klienta API.
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const express = require('express');
const crypto = require('crypto');

const KORZEN = path.join(__dirname, '..');
const czytaj = (p) => fs.readFileSync(path.join(KORZEN, p), 'utf8');
const KLUCZ_HEX = crypto.randomBytes(32).toString('hex');

/** mock db: odpowiedzi po wzorcu SQL (DDL i logi odpowiadają pusto) */
function dbPoWzorcu(reguly) {
  const zapytania = [];
  return {
    zapytania,
    query: (sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      zapytania.push({ sql: String(sql), params });
      for (const [re, odp] of reguly) {
        if (re.test(String(sql))) { const r = typeof odp === 'function' ? odp(params, String(sql)) : odp; return cb && cb(null, r); }
      }
      return cb && cb(null, /^\s*(INSERT|UPDATE|DELETE)/i.test(String(sql)) ? { affectedRows: 1, insertId: 7 } : []);
    },
  };
}

describe('Tpay — szyfrowanie konfiguracji salonu', () => {
  let szyfr;
  beforeAll(() => { process.env.TPAY_CONFIG_KEY = KLUCZ_HEX; szyfr = require('../routes/tpay').szyfr; });

  test('round-trip: zaszyfruj → odszyfruj zwraca ten sam tekst, szyfrogram za każdym razem inny (losowe IV)', () => {
    const a = szyfr.zaszyfruj('boczki', 'tajny-secret-123');
    const b = szyfr.zaszyfruj('boczki', 'tajny-secret-123');
    expect(a).not.toBe(b);
    expect(szyfr.odszyfruj('boczki', a)).toBe('tajny-secret-123');
    expect(szyfr.odszyfruj('boczki', b)).toBe('tajny-secret-123');
  });

  test('klucz pochodny jest inny dla każdego salonu — szyfrogram jednego salonu nie otwiera się kluczem drugiego', () => {
    expect(szyfr.kluczSalonu('boczki').equals(szyfr.kluczSalonu('demo-test'))).toBe(false);
    const blob = szyfr.zaszyfruj('boczki', 'sekret');
    expect(() => szyfr.odszyfruj('demo-test', blob)).toThrow();
  });

  test('wersja klucza zmienia klucz pochodny (rotacja bez zmiany klucza głównego)', () => {
    expect(szyfr.kluczSalonu('boczki', 1).equals(szyfr.kluczSalonu('boczki', 2))).toBe(false);
  });

  test('podmieniony bajt szyfrogramu = błąd (GCM), nie cicha śmieciowa wartość', () => {
    const b = Buffer.from(szyfr.zaszyfruj('boczki', 'sekret'), 'base64');
    b[b.length - 1] ^= 0xff;
    expect(() => szyfr.odszyfruj('boczki', b.toString('base64'))).toThrow();
  });

  test('klucz główny: hex64 i base64 32 bajty przyjęte, śmieci odrzucone', () => {
    process.env.TPAY_CONFIG_KEY = KLUCZ_HEX;
    expect(szyfr.kluczDostepny()).toBe(true);
    process.env.TPAY_CONFIG_KEY = Buffer.from(KLUCZ_HEX, 'hex').toString('base64');
    expect(szyfr.kluczDostepny()).toBe(true);
    process.env.TPAY_CONFIG_KEY = 'za-krotki';
    expect(szyfr.kluczDostepny()).toBe(false);
    process.env.TPAY_CONFIG_KEY = '';
    expect(szyfr.kluczDostepny()).toBe(false);
    let kod = null;
    try { szyfr.zaszyfruj('boczki', 'x'); } catch (e) { kod = e.kod; }
    expect(kod).toBe('BRAK_KLUCZA');
    process.env.TPAY_CONFIG_KEY = KLUCZ_HEX;
  });

  test('maskowanie zostawia tylko 4 ostatnie znaki; tryb API z env', () => {
    expect(szyfr.maskuj('abcdefgh1234')).toBe('••••1234');
    expect(szyfr.maskuj('')).toBe('');
    process.env.TPAY_API = 'off'; expect(szyfr.trybApi()).toBe('off');
    process.env.TPAY_API = 'atrapa'; expect(szyfr.trybApi()).toBe('atrapa');
    process.env.TPAY_API = ''; expect(szyfr.trybApi()).toBe('on');
    process.env.TPAY_API = 'atrapa';
  });
});

describe('Tpay — router: konfiguracja, uprawnienia, webhook (TPAY_API=atrapa)', () => {
  const { createSession } = require('../routes/sessions');
  const T = 'salon-test-tpay';
  let app, db, wiersz = null, role;

  beforeAll(() => {
    process.env.TPAY_CONFIG_KEY = KLUCZ_HEX;
    process.env.TPAY_API = 'atrapa';
    process.env.APP_URL = 'http://localhost:3999';
    role = { Ola: 'admin', Marta: 'recepcja' };
    db = dbPoWzorcu([
      [/FROM Tenant_Features/i, () => [{ feature_key: 'platnosc_link', enabled: 1 }]],
      [/SELECT rola FROM Użytkownicy/i, (p) => (role[p[1]] ? [{ rola: role[p[1]] }] : [])],
      [/SELECT \* FROM Tenant_Tpay WHERE tenant_id/i, () => (wiersz ? [wiersz] : [])],
      [/SELECT tenant_id FROM Tenant_Tpay WHERE webhook_token/i, (p) => (wiersz && wiersz.webhook_token === p[0] ? [{ tenant_id: T }] : [])],
      [/INSERT INTO Tenant_Tpay/i, (p) => { wiersz = { tenant_id: p[0], client_id: p[1], client_secret_enc: p[2], security_code_enc: p[3], merchant_id: p[4], sandbox: p[5], api_base: p[6], webhook_token: p[7], key_version: p[8], updated_by: p[9], updated_at: '2026-11-02 20:00:00' }; return { affectedRows: 1 }; }],
      [/DELETE FROM Tenant_Tpay/i, () => { wiersz = null; return { affectedRows: 1 }; }],
    ]);
    const modul = require('../routes/tpay')(db);
    app = express();
    app.use('/api/webhooks/tpay', express.raw({ type: '*/*' }));
    app.use(express.json());
    app.use('/api', modul.router);
    app.locals.narzedzia = modul.narzedzia;
  });

  const sesja = (login) => createSession(T, login);

  test('GET konfiguracja: recepcja dostaje odmowę UPRAWNIENIA, admin stan „brak konfiguracji”', async () => {
    const r1 = await request(app).get('/api/tpay/konfiguracja?tenant_id=' + T).set('x-session-token', sesja('Marta'));
    expect(r1.body.status).toBe('error'); expect(r1.body.code).toBe('UPRAWNIENIA');
    const r2 = await request(app).get('/api/tpay/konfiguracja?tenant_id=' + T).set('x-session-token', sesja('Ola'));
    expect(r2.body.status).toBe('success'); expect(r2.body.skonfigurowano).toBe(0); expect(r2.body.klucz_ok).toBe(1); expect(r2.body.tryb).toBe('atrapa');
  });

  test('sesja innego salonu nie czyta konfiguracji tego salonu', async () => {
    const obca = createSession('inny-salon', 'Ola');
    const r = await request(app).get('/api/tpay/konfiguracja?tenant_id=' + T).set('x-session-token', obca);
    expect(r.body.code).toBe('UPRAWNIENIA');
  });

  test('maKonfig = false bez wiersza; POST zapis szyfruje sekrety, odpowiedź nie zawiera sekretu, potem maKonfig = true', async () => {
    expect(await app.locals.narzedzia.maKonfig(T)).toBe(false);
    const r = await request(app).post('/api/tpay/konfiguracja').set('x-session-token', sesja('Ola'))
      .send({ tenant_id: T, client_id: 'client-abc-1234', client_secret: 'SEKRET-XYZ', security_code: 'KOD-999', merchant_id: '12345', user_log: 'Ola' });
    expect(r.body.status).toBe('success');
    expect(JSON.stringify(r.body)).not.toMatch(/SEKRET-XYZ|KOD-999/);
    expect(wiersz.client_secret_enc).not.toMatch(/SEKRET/);
    expect(wiersz.webhook_token).toMatch(/^[0-9a-f]{32}$/);
    expect(r.body.webhook_url).toBe('http://localhost:3999/api/webhooks/tpay/' + wiersz.webhook_token);
    const cfg = await app.locals.narzedzia.pobierzKonfig(T);
    expect(cfg.client_secret).toBe('SEKRET-XYZ'); expect(cfg.security_code).toBe('KOD-999');
    expect(await app.locals.narzedzia.maKonfig(T)).toBe(true);
    // żadne zapytanie do bazy nie niesie sekretu jawnie
    for (const z of db.zapytania) expect(JSON.stringify(z.params || [])).not.toMatch(/SEKRET-XYZ|KOD-999/);
  });

  test('GET po zapisie: maski zamiast sekretów, webhook_url widoczny', async () => {
    const r = await request(app).get('/api/tpay/konfiguracja?tenant_id=' + T).set('x-session-token', sesja('Ola'));
    expect(r.body.skonfigurowano).toBe(1);
    expect(r.body.client_secret_mask).toBe('••••••••');
    expect(JSON.stringify(r.body)).not.toMatch(/SEKRET-XYZ|KOD-999/);
    expect(r.body.webhook_url).toContain('/api/webhooks/tpay/');
  });

  test('recepcja nie zapisze konfiguracji', async () => {
    const r = await request(app).post('/api/tpay/konfiguracja').set('x-session-token', sesja('Marta')).send({ tenant_id: T, client_id: 'x', client_secret: 'y', security_code: 'z', merchant_id: '1' });
    expect(r.body.code).toBe('UPRAWNIENIA');
  });

  test('„Sprawdź połączenie” w trybie atrapa odpowiada sukcesem bez sieci', async () => {
    const r = await request(app).post('/api/tpay/sprawdz').set('x-session-token', sesja('Ola')).send({ tenant_id: T });
    expect(r.body.status).toBe('success'); expect(r.body.info).toMatch(/testowe/i);
  });

  test('rozpocznijPlatnosc (atrapa): zapisuje transakcję, zwraca adres powrotu z &atrapa=1; bez kwoty odmawia', async () => {
    const db2 = dbPoWzorcu([
      [/GET_LOCK/i, () => [{ l: 1 }]],
      [/RELEASE_LOCK/i, () => [{ r: 1 }]],
      [/SELECT \* FROM Tenant_Tpay WHERE tenant_id/i, () => [wiersz]],
      [/FROM Tpay_Transakcje WHERE tenant_id = \? AND zgoda_id/i, () => []],
    ]);
    const n = require('../routes/tpay')(db2).narzedzia;
    const w = await n.rozpocznijPlatnosc(T, { id: 42, kwota: '150.00', opis: 'Zadatek', imie_nazwisko: 'Anna Test' }, 'TOKEN123');
    expect(w.url).toMatch(/^http:\/\/localhost:3999\/platnosc\.html\?t=TOKEN123&wynik=ok&atrapa=1$/);
    expect(w.ponownie).toBe(false);
    const ins = db2.zapytania.find(z => /INSERT INTO Tpay_Transakcje/i.test(z.sql));
    expect(ins.params[5]).toBe(15000); // grosze
    expect(db2.zapytania.some(z => /UPDATE ZgodyPlatnosci SET platnosc_start_at/i.test(z.sql))).toBe(true);
    await expect(n.rozpocznijPlatnosc(T, { id: 43, kwota: null }, 'TOKEN')).rejects.toThrow(/kwoty/);
  });

  test('rozpocznijPlatnosc: istniejąca transakcja „pending” z 24 h → ten sam adres, bez nowego INSERT', async () => {
    const db3 = dbPoWzorcu([
      [/GET_LOCK/i, () => [{ l: 1 }]],
      [/SELECT \* FROM Tenant_Tpay WHERE tenant_id/i, () => [wiersz]],
      [/FROM Tpay_Transakcje WHERE tenant_id = \? AND zgoda_id/i, () => [{ id: 9, payment_url: 'https://secure.tpay.com/?gtitle=TR-1' }]],
    ]);
    const n = require('../routes/tpay')(db3).narzedzia;
    const w = await n.rozpocznijPlatnosc(T, { id: 42, kwota: 150 }, 'TOK');
    expect(w.url).toBe('https://secure.tpay.com/?gtitle=TR-1'); expect(w.ponownie).toBe(true);
    expect(db3.zapytania.some(z => /INSERT INTO Tpay_Transakcje/i.test(z.sql))).toBe(false);
  });

  test('TPAY_API=off: maKonfig = false (salon wraca do trybu ręcznego), rozpocznijPlatnosc odmawia', async () => {
    process.env.TPAY_API = 'off';
    expect(await app.locals.narzedzia.maKonfig(T)).toBe(false);
    await expect(app.locals.narzedzia.rozpocznijPlatnosc(T, { id: 1, kwota: 10 }, 't')).rejects.toThrow(/wyłączone/);
    process.env.TPAY_API = 'atrapa';
  });

  test('webhook: znany token → 200 TRUE i log bez pól kart; nieznany → 404 FALSE (Tpay przestaje ponawiać)', async () => {
    const r = await request(app).post('/api/webhooks/tpay/' + wiersz.webhook_token).type('form')
      .send('id=12345&tr_id=TR-1&tr_amount=150.00&tr_crc=est_abc&tr_status=TRUE&card_token=SECRETCARD&md5sum=x');
    expect(r.status).toBe(200); expect(r.text).toBe('TRUE');
    const log = db.zapytania.filter(z => /INSERT INTO Tpay_Webhook_Log/i.test(z.sql)).pop();
    expect(log.params[2]).not.toMatch(/SECRETCARD/); expect(log.params[3]).toBe('TR-1'); expect(log.params[6]).toBe('zapisano');
    const r2 = await request(app).post('/api/webhooks/tpay/' + 'f'.repeat(32)).type('form').send('tr_id=TR-2');
    expect(r2.status).toBe(404); expect(r2.text).toBe('FALSE');
  });

  test('usunięcie konfiguracji wraca do trybu ręcznego', async () => {
    const r = await request(app).post('/api/tpay/konfiguracja').set('x-session-token', sesja('Ola')).send({ tenant_id: T, usun: 1 });
    expect(r.body.status).toBe('success');
    expect(await app.locals.narzedzia.maKonfig(T)).toBe(false);
  });
});

describe('Tpay — spięcia w kodzie (strażnicy)', () => {
  test('sesja-middleware: /zgoda/zaplac i /webhooks publiczne', () => {
    const s = czytaj('routes/sesja-middleware.js');
    expect(s).toMatch(/'\/zgoda\/zaplac'/); expect(s).toMatch(/'\/webhooks'/);
  });
  test('server.js: surowe body dla webhooka Tpay PRZED express.json, moduł tpay wpięty do zgód i zamontowany', () => {
    const s = czytaj('server.js');
    const raw = s.indexOf("app.use('/api/webhooks/tpay', express.raw(");
    const json = s.indexOf('app.use(express.json(');
    expect(raw).toBeGreaterThan(-1); expect(raw).toBeLessThan(json);
    expect(s).toMatch(/require\('\.\/routes\/tpay'\)\(db\)/);
    expect(s).toMatch(/tpay: tpayModul\.narzedzia/);
    expect(s).toMatch(/app\.use\('\/api', tpayModul\.router\)/);
  });
  test('zgody.js: trasa /zgoda/zaplac, tryb api w zgoda_utworz i zgody_status, platnosc_api w info/akceptuj', () => {
    const s = czytaj('routes/zgody.js');
    expect(s).toMatch(/router\.post\('\/zgoda\/zaplac', akceptLimiter/);
    expect(s).toMatch(/tpay\.maKonfig\(tenant_id\)/);
    expect(s).toMatch(/tpay_api:/);
    expect((s.match(/platnosc_api:/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(s).toMatch(/tpay\.rozpocznijPlatnosc\(payload\.t, z, req\.body\.t\)/);
  });
  test('platnosc.html: po akceptacji w trybie API woła /api/zgoda/zaplac, obsługuje powrót ?wynik=ok|blad', () => {
    const s = czytaj('public/platnosc.html');
    expect(s).toMatch(/\/api\/zgoda\/zaplac/); expect(s).toMatch(/platnosc_api/); expect(s).toMatch(/wynik === 'ok'/); expect(s).toMatch(/wynik === 'blad'/);
  });
  test('index.html: karta konfiguracji, tryb ekspert w formularzu linku, skrypt i styl wpięte z wersją', () => {
    const s = czytaj('public/index.html');
    expect(s).toMatch(/<div id="tpay-konfig"><\/div>/);
    expect(s).toMatch(/<details id="zg-ekspert" open>/);
    expect(s).toMatch(/id="zg-tryb-api-info"/);
    expect(s).toMatch(/tpay-konfiguracja\.js\?v=__WERSJA_PLIKOW__/); expect(s).toMatch(/tpay-konfiguracja\.css\?v=__WERSJA_PLIKOW__/);
    expect(s).toMatch(/if \(!tpayLink && !trybApi\)/);
    expect(s).toMatch(/krok === 'dane' && window\.tpayKonfig/);
  });
  test('tpay-konfiguracja.js istnieje, składnia poprawna, nie zapisuje sekretów w localStorage', () => {
    const s = czytaj('public/tpay-konfiguracja.js');
    expect(() => new Function(s)).not.toThrow();
    expect(s).not.toMatch(/localStorage\.setItem/);
    expect(s).toMatch(/window\.tpayKonfig = /);
  });
  test('.env.test.example i repo: brak prawdziwego klucza TPAY_CONFIG_KEY w plikach śledzonych', () => {
    for (const p of ['.env.test.example', 'routes/tpay.js', 'server.js']) {
      if (!fs.existsSync(path.join(KORZEN, p))) continue;
      expect(czytaj(p)).not.toMatch(/TPAY_CONFIG_KEY\s*=\s*[0-9a-fA-F]{64}/);
    }
  });
});
