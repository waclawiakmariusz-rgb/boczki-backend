// tests/sesja-doczytanie.test.js — „za często wylogowuje z systemu” (zgłoszenie właściciela, 19.10.2026).
//
// Przyczyna: pamięć procesu dostawała komplet sesji tylko przy starcie (preload). Sesja założona
// później przez INNY proces Node (kilka instancji aplikacji na hostingu) była tu nieznana i każde
// żądanie kończyło się „Brak dostępu”, choć w tabeli `Sesje` token był ważny.
//
// RODZAJ PRÓB: moduł sesji + prawdziwy strażnik na express/supertest, z atrapą bazy zamiast MySQL.
const express = require('express');
const request = require('supertest');

const sessions = require('../routes/sessions');
const { sesjaMiddleware } = require('../routes/sesja-middleware');

const T = 'salon-test-001';
let licznik = 0;
const nowyToken = () => `00000000-0000-4000-8000-00000000${String(++licznik).padStart(4, "0")}`;

// Atrapa bazy: liczy zapytania i oddaje wiersz z `Sesje` tylko dla znanego tokenu.
function atrapaBazy({ wiersz } = {}) {
  const zap = [];
  return {
    zap,
    query(sql, params, cb) {
      const c = typeof params === 'function' ? params : cb;
      const p = typeof params === 'function' ? [] : params;
      zap.push({ sql: String(sql), params: p });
      if (/SELECT .*FROM `Sesje` WHERE `token` = \?/.test(sql)) {
        const pasuje = wiersz && p[0] === wiersz.token;
        return c && c(null, pasuje ? [{ tenant_id: wiersz.tenant_id, login: wiersz.login, expires_unix: wiersz.expires_unix }] : []);
      }
      if (/^SELECT/i.test(sql)) return c && c(null, []);
      return c && c(null, { affectedRows: 0 });
    },
  };
}
const zaGodzine = () => Math.floor((Date.now() + 60 * 60 * 1000) / 1000);
const selekty = (db) => db.zap.filter(z => /SELECT .*FROM `Sesje` WHERE `token`/.test(z.sql));

function aplikacja() {
  const app = express(); app.use(express.json());
  app.use('/api', sesjaMiddleware({
    validateTenantAccess: sessions.validateTenantAccessAsync,
    touchSession: sessions.touchSessionAsync,
    log: { warn() {} },
  }));
  app.get('/api/klienci', (req, res) => res.json({ status: 'success', klienci: [] }));
  return app;
}

describe('S01 — sesja z innego procesu jest doczytywana z tabeli Sesje', () => {
  test('token nieznany w pamięci, ważny w bazie → żądanie przechodzi, a sesja ląduje w pamięci', async () => {
    const TOKEN = nowyToken();
    const db = atrapaBazy({ wiersz: { token: TOKEN, tenant_id: T, login: 'Ola', expires_unix: zaGodzine() } });
    sessions.initSessions(db);
    expect(sessions.getSession(TOKEN)).toBeNull();                 // pamięć tego nie zna

    const { status, body } = await request(aplikacja()).get('/api/klienci').query({ tenant_id: T }).set('x-session-token', TOKEN);
    expect(status).toBe(200);
    expect(body.status).toBe('success');
    expect(sessions.getSession(TOKEN)).toMatchObject({ tenant_id: T, login: 'Ola' });   // od teraz jest w pamięci
  });

  test('drugie żądanie tym samym tokenem nie pyta bazy ponownie', async () => {
    const TOKEN = nowyToken();
    const db = atrapaBazy({ wiersz: { token: TOKEN, tenant_id: T, login: 'Ola', expires_unix: zaGodzine() } });
    sessions.initSessions(db);
    const app = aplikacja();
    await request(app).get('/api/klienci').query({ tenant_id: T }).set('x-session-token', TOKEN);
    const poPierwszym = selekty(db).length;
    await request(app).get('/api/klienci').query({ tenant_id: T }).set('x-session-token', TOKEN);
    expect(selekty(db).length).toBe(poPierwszym);
  });
});

describe('S02 — granice: co NIE może przejść', () => {
  test('token, którego nie ma w bazie → odmowa i tylko jedno pytanie do bazy na minutę', async () => {
    const db = atrapaBazy();                       // baza nie zna żadnego tokenu
    sessions.initSessions(db);
    const app = aplikacja();
    const a = await request(app).get('/api/klienci').query({ tenant_id: T }).set('x-session-token', 'wymyslony-token');
    expect(a.status).toBe(401);
    expect(a.body.code).toBe('SESJA');
    const po = selekty(db).length;
    await request(app).get('/api/klienci').query({ tenant_id: T }).set('x-session-token', 'wymyslony-token');
    expect(selekty(db).length).toBe(po);           // ujemny cache: nie pytamy bazy przy każdym odświeżeniu
  });

  test('sesja innego salonu nie wpuszcza do cudzych danych, choć jest ważna w bazie', async () => {
    const TOKEN = nowyToken();
    const db = atrapaBazy({ wiersz: { token: TOKEN, tenant_id: 'inny-salon', login: 'Ola', expires_unix: zaGodzine() } });
    sessions.initSessions(db);
    const { status, body } = await request(aplikacja()).get('/api/klienci').query({ tenant_id: T }).set('x-session-token', TOKEN);
    expect(status).toBe(403);
    expect(body.code).toBe('SESJA');
  });

  test('wylogowanie nie wraca „z bazy” — skasowany token zostaje skasowany', async () => {
    const TOKEN = nowyToken();
    const db = atrapaBazy({ wiersz: { token: TOKEN, tenant_id: T, login: 'Ola', expires_unix: zaGodzine() } });
    sessions.initSessions(db);
    const app = aplikacja();
    await request(app).get('/api/klienci').query({ tenant_id: T }).set('x-session-token', TOKEN);  // sesja w pamięci
    sessions.deleteSession(TOKEN);                                                                 // „Wyloguj”
    const { status } = await request(app).get('/api/klienci').query({ tenant_id: T }).set('x-session-token', TOKEN);
    expect(status).toBe(401);
    expect(db.zap.some(z => /DELETE FROM `Sesje` WHERE `token`/.test(z.sql))).toBe(true);
  });

  test('żądanie bez tokenu nie pyta bazy w ogóle', async () => {
    const db = atrapaBazy();
    sessions.initSessions(db);
    const { status } = await request(aplikacja()).get('/api/klienci').query({ tenant_id: T });
    expect(status).toBe(403);
    expect(selekty(db)).toEqual([]);
  });
});

describe('S03 — awaria bazy nie wiesza żądania', () => {
  test('błąd zapytania o sesję kończy się odmową dostępu, a nie zawieszeniem', async () => {
    const db = { zap: [], query(sql, params, cb) { const c = typeof params === 'function' ? params : cb; this.zap.push({ sql: String(sql) }); if (/FROM `Sesje` WHERE `token`/.test(sql)) return c && c(new Error('ECONNRESET')); return c && c(null, []); } };
    sessions.initSessions(db);
    const { status, body } = await request(aplikacja()).get('/api/klienci').query({ tenant_id: T }).set('x-session-token', 'token-przy-awarii');
    expect(status).toBe(401);
    expect(body.code).toBe('SESJA');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Przy okazji tego samego zgłoszenia: notatka przy WŁASNEJ wizycie jest też dla wykonawczyni
// (decyzja właściciela 19.10.2026). Przy cudzej wizycie dalej nie ma ani notatki, ani nazwiska.
describe('S04 — maskowanie wizyt: notatka dla osoby, która wykonuje zabieg', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'terminarz.js'), 'utf8');
  const maskuj = src.slice(src.indexOf('function maskuj('), src.indexOf('function maskuj(') + 900);
  test('własna wizyta: ukrywamy telefon, notatka zostaje', () => {
    expect(maskuj).toMatch(/if \(moja\) return \{ \.\.\.rez, klient_telefon: null \};/);
  });
  test('cudza wizyta: „Zajęte”, bez notatki, bez cen i bez identyfikatora klientki', () => {
    const cudza = maskuj.slice(maskuj.indexOf("klient_nazwa: 'Zajęte'"));
    expect(cudza).toMatch(/notatka: null/);
    expect(cudza).toMatch(/id_klienta: null/);
    expect(cudza).toMatch(/cena: null/);
  });
});
