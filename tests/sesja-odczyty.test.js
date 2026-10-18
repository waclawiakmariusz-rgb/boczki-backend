// tests/sesja-odczyty.test.js — luka „odczyty GET bez tokenu sesji” (znaleziona 2026-10-18 przy wdrożeniu Terminarza 2.0).
// Regresja (a): strażnik sesji MUSI być zarejestrowany w server.js PRZED routerami /api — inaczej nigdy się nie wykona.
// Regresja (b): zachowanie strażnika na prawdziwym express + supertest, z sesjami w pamięci (routes/sessions.js bez bazy).
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

describe('(a) kolejność rejestracji w server.js', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    test('strażnik sesji (sesjaMiddleware) jest zarejestrowany PRZED pierwszym routerem /api', () => {
        const iStraznik = src.indexOf("app.use('/api', sesjaMiddleware(");
        const iPierwszyRouter = src.indexOf("app.use('/api', authRoutes)");
        expect(iStraznik).toBeGreaterThan(-1);
        expect(iPierwszyRouter).toBeGreaterThan(-1);
        expect(iStraznik).toBeLessThan(iPierwszyRouter);
    });
    test('stary, nieskuteczny blok strażnika po routerach został usunięty (jedna definicja PUBLIC_PATHS — w module)', () => {
        expect(src.includes('const PUBLIC_PATHS = [')).toBe(false);
        expect(src.includes("require('./routes/sesja-middleware')")).toBe(true);
    });
});

describe('(a2) /dbstatus', () => {
    test('odpowiada tylko z tokenem admina (wcześniej ujawniał DB_HOST/DB_NAME każdemu)', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        const i = src.indexOf("app.get('/dbstatus'");
        expect(i).toBeGreaterThan(-1);
        expect(src.slice(i, i + 400)).toContain("x-admin-token'] !== process.env.ADMIN_TOKEN) return res.status(404)");
    });
});

describe('(b) zachowanie strażnika (supertest, sesje w pamięci)', () => {
    const sessions = require('../routes/sessions');
    const { sesjaMiddleware, PUBLIC_PATHS } = require('../routes/sesja-middleware');
    let log;
    const zbuduj = (opts = {}) => {
        log = { warn: jest.fn() };
        const app = express();
        app.use(express.json());
        app.use('/api', sesjaMiddleware({ validateTenantAccess: sessions.validateTenantAccess, touchSession: sessions.touchSession, log, ...opts }));
        app.get('/api/klienci', (req, res) => res.json({ klienci: [{ id: '1', nazwa: 'Fikcyjna' }] }));
        app.get('/api/sprzedaz', (req, res) => res.json({ historia: [1, 2] }));
        app.post('/api/foto/upload', (req, res) => res.json({ status: 'success', publiczny: true })); // publiczny flow z telefonu (token HMAC w treści)
        app.post('/api/rodo', (req, res) => res.json({ status: 'success', prywatny: true }));
        app.get('/api/reset-hasla/weryfikuj', (req, res) => res.json({ status: 'ok' }));
        app.get('/api/dokumenty/t1/plik.pdf', (req, res) => res.json({ status: 'success', trasa: 'sama sprawdza dostęp' }));
        app.get('/api', (req, res) => res.json({ dispatcher: true }));
        return app;
    };
    const tokenT1 = sessions.createSession('t1', 'Ola');
    const tokenT2 = sessions.createSession('t2', 'Ewa');

    test('GET odczytu z tenant_id BEZ tokenu → 403 (dziś na produkcji przechodzi — to jest luka)', async () => {
        const r = await request(zbuduj()).get('/api/klienci?action=get_clients&tenant_id=t1');
        expect(r.status).toBe(403);
        expect(r.body.klienci).toBeUndefined();
        expect(log.warn).toHaveBeenCalledTimes(1);
    });
    test('GET z tokenem właściwego salonu → dane', async () => {
        const r = await request(zbuduj()).get('/api/klienci?action=get_clients&tenant_id=t1').set('x-session-token', tokenT1);
        expect(r.status).toBe(200);
        expect(r.body.klienci.length).toBe(1);
    });
    test('GET z tokenem INNEGO salonu → 403, bez danych', async () => {
        const r = await request(zbuduj()).get('/api/sprzedaz?action=full_sales_history&tenant_id=t1').set('x-session-token', tokenT2);
        expect(r.status).toBe(403);
        expect(r.body.historia).toBeUndefined();
    });
    test('token nieistniejący/wygasły → 401 z komunikatem o wygaśnięciu', async () => {
        const r = await request(zbuduj()).get('/api/klienci?tenant_id=t1').set('x-session-token', 'nie-ma-takiego');
        expect(r.status).toBe(401);
        expect(r.body.message).toMatch(/wygasła/i);
    });
    test('ścieżki publiczne przechodzą bez tokenu (reset hasła, dispatcher „/”)', async () => {
        const app = zbuduj();
        expect((await request(app).get('/api/reset-hasla/weryfikuj?token=x&tenant_id=t1')).status).toBe(200);
        expect((await request(app).get('/api?action=get_clients&tenant_id=t1')).body.dispatcher).toBe(true);
        expect(PUBLIC_PATHS).toContain('/reset-hasla/weryfikuj');
    });
    test('żądanie bez tenant_id przechodzi (trasa z tenant w ścieżce sprawdza dostęp sama)', async () => {
        const r = await request(zbuduj()).get('/api/dokumenty/t1/plik.pdf');
        expect(r.status).toBe(200);
    });
    test('POST do prywatnego routera z tenant_id bez tokenu → 403 (nie tylko GET); publiczny upload z telefonu przechodzi', async () => {
        const app = zbuduj();
        expect((await request(app).post('/api/rodo').send({ tenant_id: 't1' })).status).toBe(403);
        expect((await request(app).post('/api/foto/upload').send({ tenant_id: 't1' })).status).toBe(200);
    });
    test('wyłącznik awaryjny ENFORCE_SESSION_ROUTERY=false → tylko log, żądanie przechodzi (zachowanie sprzed 2026-10-18)', async () => {
        const r = await request(zbuduj({ enforceRoutery: false })).get('/api/klienci?tenant_id=t1');
        expect(r.status).toBe(200);
        expect(log.warn).toHaveBeenCalledTimes(1);
    });
    test('stara flaga ENFORCE_SESSION (tryb miękki) NIE osłabia strażnika routerów — blokada jest domyślna', async () => {
        const r = await request(zbuduj({ enforce: false })).get('/api/klienci?tenant_id=t1');
        expect(r.status).toBe(403);
    });
    test('jawna lista publiczna: foto z telefonu, zgoda z linku, Klub, sklep, blog przechodzą; /foto?action i /zgody są prywatne', () => {
        const { czyPubliczna } = require('../routes/sesja-middleware');
        for (const p of ['/foto/mobile-info', '/foto/upload', '/zgoda/info', '/zgoda/akceptuj', '/klub/info', '/klub/img/t1/x.jpg', '/gus', '/stripe/config', '/predef/zabiegi', '/blog/posts', '/rejestracja/check-login', '/help-kb/global', '/admin/salony', '/magda/sprzedaz', '/billing/info']) expect([p, czyPubliczna(p)]).toEqual([p, true]);
        for (const p of ['/foto', '/zgody', '/klienci', '/sprzedaz', '/users', '/lojalnosc', '/get_system_logs', '/adminfoo', '/klubik', '/features', '/dokumenty_dodatkowe']) expect([p, czyPubliczna(p)]).toEqual([p, false]);
    });
    test('poprawny token przedłuża sesję (sliding) także na ścieżce publicznej', async () => {
        const touch = jest.fn();
        const app = express();
        app.use('/api', sesjaMiddleware({ validateTenantAccess: sessions.validateTenantAccess, touchSession: touch, log: { warn() {} } }));
        app.get('/api', (req, res) => res.json({}));
        await request(app).get('/api?action=x&tenant_id=t1').set('x-session-token', tokenT1);
        expect(touch).toHaveBeenCalledWith(tokenT1);
    });
});
