// tests/konsultacje.test.js
// Raport reklamowy (akon_get_ad_report) — zanonimizowane sumy dla firmy od leadów (2026-10-09).

const request = require('supertest');
const express = require('express');
const { mockDb, mockDbAlways } = require('./helpers/mockDb');

// UWAGA: routes/konsultacje.js tworzy `router` na poziomie MODUŁU, a fabryka tylko dokłada
// do niego handlery. Bez resetModules każdy kolejny buildApp dokładałby handlery do tego
// samego routera i żądania trafiałyby do handlera z PIERWSZEGO testu (z jego mockiem db).
beforeEach(() => { jest.resetModules(); });
function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/konsultacje')(db));
    return app;
}

const TENANT = 'test-salon-001';
// 1 wypełniacz: moduł robi 1× CREATE TABLE przy ładowaniu (mockDb pomija tylko ALTER).
const INIT = [{ rows: [] }];
const ROLA_ADMIN = { rows: [{ rola: 'Admin' }] };        // duża litera — porównanie toLowerCase
const ROLA_MANAGER = { rows: [{ rola: 'manager' }] };
const ROLA_RECEPCJA = { rows: [{ rola: 'Recepcja' }] };
const PROGI = { rows: [{ nazwa: 'Kriolipoliza', prog: 500 }] };
const CENNIK = { rows: [{ nazwa: 'Kriolipoliza', cena: 275, obszar: 'Ciało' }] };
const WPISY = { rows: [
    // reklama, powyżej progu 500 → pakiet
    { m: '2026-08', zrodlo: 'Reklama', obszar: 'Ciało', typ_akcji: 'Kriolipoliza', kwota_reklama: 275, kwota_pakiet: 1200, upsell: 925 },
    // reklama, poniżej progu → bez pakietu
    { m: '2026-09', zrodlo: 'Reklama', obszar: 'Ciało', typ_akcji: 'Kriolipoliza', kwota_reklama: 275, kwota_pakiet: 275, upsell: 0 },
    // reklama bez kampanii → próg domyślny 150, pakiet 160 → sukces, kampania "Nieoznaczona"
    { m: '2026-09', zrodlo: 'Reklama', obszar: 'Twarz', typ_akcji: '', kwota_reklama: 0, kwota_pakiet: 160, upsell: 160 },
    // normalna — liczy się tylko do "wszystkie"
    { m: '2026-09', zrodlo: 'Normalna', obszar: '-', typ_akcji: 'Konsultacja Standardowa', kwota_reklama: 0, kwota_pakiet: 900, upsell: 0 },
] };

const zadanie = (db, body) => request(buildApp(db)).post('/api/konsultacje').send({ action: 'akon_get_ad_report', tenant_id: TENANT, user_log: 'Ania', ...body });

describe('akon_get_ad_report — raport reklamowy', () => {
    test('recepcja → odmowa, bez sięgania po wpisy konsultacji', async () => {
        const db = mockDb(...INIT, ROLA_RECEPCJA);
        const res = await zadanie(db, { od: '2026-08', do: '2026-09' });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/uprawnie/i);
        expect(db.query.mock.calls.some(c => /FROM Wyniki_konsultacja/.test(c[0]))).toBe(false);
    });

    test('brak użytkownika w żądaniu → odmowa', async () => {
        const db = mockDb(...INIT);
        const res = await request(buildApp(db)).post('/api/konsultacje').send({ action: 'akon_get_ad_report', tenant_id: TENANT, od: '2026-08', do: '2026-09' });
        expect(res.body.status).toBe('error');
    });

    test('admin → sumy per miesiąc, kampanie i total; bez danych osobowych w odpowiedzi', async () => {
        const db = mockDb(...INIT, ROLA_ADMIN, PROGI, CENNIK, WPISY);
        const res = await zadanie(db, { od: '2026-08', do: '2026-09' });
        expect(res.body.status).toBe('success');
        const d = res.body.data;
        expect(d.miesiace.map(x => x.m)).toEqual(['2026-08', '2026-09']);
        expect(d.wszystkie).toBe(4);
        expect(d.total).toEqual({ n: 3, sukcesy: 2, oferta: 550, pakiet: 1635, upsell: 1085 });
        const wrz = d.miesiace[1];
        expect(wrz.wszystkie).toBe(3);
        expect(wrz.n).toBe(2);
        expect(wrz.sukcesy).toBe(1);
        const krio = d.kampanie.find(k => k.nazwa === 'Kriolipoliza');
        expect(krio.cena).toBe(275);
        expect(krio.prog).toBe(500);
        expect(krio.obszar).toBe('Ciało');
        expect(krio.n).toBe(2);
        expect(krio.sukcesy).toBe(1);
        expect(krio.perM['2026-08']).toEqual({ n: 1, pakiet: 1200 });
        const nieozn = d.kampanie.find(k => k.nazwa === 'Nieoznaczona');
        expect(nieozn.prog).toBe(150);
        expect(nieozn.cena).toBeNull();
        expect(nieozn.sukcesy).toBe(1);
        // anonimizacja: żadnych pól osobowych ani w SQL, ani w odpowiedzi
        const sql = db.query.mock.calls.find(c => /FROM Wyniki_konsultacja/.test(c[0]))[0];
        expect(sql).not.toMatch(/klient|telefon|kto_wykonal|uwagi/);
        const txt = JSON.stringify(res.body);
        expect(txt).not.toMatch(/"klient"|"telefon"|"kto_wykonal"|"uwagi"|"zabiegi/);
        // zakres w SQL = parametry od/do
        const params = db.query.mock.calls.find(c => /FROM Wyniki_konsultacja/.test(c[0]))[1];
        expect(params).toEqual([TENANT, '2026-08', '2026-09']);
    });

    test('manager też ma dostęp; miesiąc bez wpisów dostaje zera', async () => {
        const db = mockDb(...INIT, ROLA_MANAGER, PROGI, CENNIK, { rows: [] });
        const res = await zadanie(db, { od: '2026-06', do: '2026-07' });
        expect(res.body.status).toBe('success');
        expect(res.body.data.miesiace).toEqual([
            { m: '2026-06', wszystkie: 0, n: 0, sukcesy: 0, oferta: 0, pakiet: 0, upsell: 0 },
            { m: '2026-07', wszystkie: 0, n: 0, sukcesy: 0, oferta: 0, pakiet: 0, upsell: 0 },
        ]);
        expect(res.body.data.kampanie).toEqual([]);
    });

    test('zakres przez granicę roku buduje poprawną listę miesięcy', async () => {
        const db = mockDb(...INIT, ROLA_ADMIN, PROGI, CENNIK, { rows: [] });
        const res = await zadanie(db, { od: '2025-11', do: '2026-02' });
        expect(res.body.data.miesiace.map(x => x.m)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });

    test('walidacja: zły format, od > do, ponad 24 miesiące → błąd bez zapytań do bazy', async () => {
        for (const body of [{ od: '2026/08', do: '2026-09' }, { od: '2026-09', do: '2026-08' }, { od: '2024-01', do: '2026-09' }]) {
            const db = mockDbAlways([]);
            const res = await zadanie(db, body);
            expect(res.body.status).toBe('error');
            expect(db.query.mock.calls.some(c => /Użytkownicy|Wyniki_konsultacja/.test(c[0]))).toBe(false);
        }
    });
});
