// tests/sprzedaz.magazyn.test.js
// Testy obsługi magazynu w delete_sale i edit_sale

const request = require('supertest');
const express = require('express');
const { mockDb, mockDbAlways } = require('./helpers/mockDb');

function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/sprzedaz')(db));
    return app;
}

const TENANT = 'test-salon-001';

// ─── DELETE_SALE — magazyn ──────────────────────────────────

describe('POST /api/sprzedaz — delete_sale + magazyn', () => {

    test('zabieg (nie kosmetyk) — magazyn NIE jest ruszany', async () => {
        // SELECT, UPDATE, INSERT Logi USUNIĘCIE — koniec
        const db = mockDb(
            { rows: [{ klient: 'Klientka', zabieg: 'Botoks', kwota: 200, id_zadatku: '', czy_rozliczone: 0, szczegoly: '' }] },
            { rows: { affectedRows: 1 } }, // UPDATE Sprzedaz
            { rows: { affectedRows: 1 } }, // INSERT Logi
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'delete_sale', tenant_id: TENANT, id: 'S1', pracownik: 'Marta'
        });
        expect(res.body.status).toBe('success');
        // 3 zapytania handlera = SELECT + UPDATE + Log (pomijamy idempotentne ALTER TABLE z ładowania modułu).
        const handlerCalls = db.query.mock.calls.filter(c => !/^\s*ALTER\s+TABLE/i.test(String(c[0] || '')));
        expect(handlerCalls.length).toBe(3);
        const sqls = db.query.mock.calls.map(c => c[0]);
        expect(sqls.some(s => /Magazyn/.test(s))).toBe(false);
    });

    test('kosmetyk — przywraca ilość do najstarszej partii', async () => {
        const db = mockDb(
            { rows: [{ klient: 'Klientka', zabieg: 'Kosmetyk: Krem ABC', kwota: 100, id_zadatku: '', czy_rozliczone: 0, szczegoly: '2 szt.' }] }, // SELECT Sprzedaz
            { rows: { affectedRows: 1 } }, // UPDATE Sprzedaz status='USUNIĘTY'
            { rows: { affectedRows: 1 } }, // INSERT Logi USUNIĘCIE
            { rows: [{ id: 'PARTIA-1', ilosc: 5 }] }, // SELECT Magazyn FIFO
            { rows: { affectedRows: 1 } }, // UPDATE Magazyn ilosc
            { rows: { affectedRows: 1 } }, // INSERT Logi PRZYWRÓCENIE
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'delete_sale', tenant_id: TENANT, id: 'S1', pracownik: 'Marta'
        });
        expect(res.body.status).toBe('success');
        // Sprawdź że UPDATE Magazyn dostał params [nowaIlosc, tenant, id]
        const updateMag = db.query.mock.calls.find(c => /UPDATE Magazyn SET ilosc/.test(c[0]));
        expect(updateMag).toBeDefined();
        expect(updateMag[1][0]).toBe(7); // 5 + 2 = 7
        expect(updateMag[1][2]).toBe('PARTIA-1');
    });

    test('kosmetyk + brak partii w magazynie — log OSTRZEŻENIE bez crashu', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Kosmetyk: Niedostępny', kwota: 50, id_zadatku: '', czy_rozliczone: 0, szczegoly: '1 szt.' }] },
            { rows: { affectedRows: 1 } }, // UPDATE Sprzedaz
            { rows: { affectedRows: 1 } }, // INSERT Logi USUNIĘCIE
            { rows: [] },                  // SELECT Magazyn — brak partii
            { rows: { affectedRows: 1 } }, // INSERT Logi OSTRZEŻENIE STANU
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'delete_sale', tenant_id: TENANT, id: 'S1', pracownik: 'Marta'
        });
        expect(res.body.status).toBe('success');
        const sqls = db.query.mock.calls.map(c => c[0]);
        // NIE było UPDATE Magazyn
        expect(sqls.some(s => /UPDATE Magazyn/.test(s))).toBe(false);
        // Ale był log ostrzeżenia
        const logs = db.query.mock.calls.filter(c => /INSERT INTO Logi/.test(c[0]));
        expect(logs.some(c => c[1][3] === 'OSTRZEŻENIE STANU')).toBe(true);
    });

    test('kosmetyk z ilością ułamkową "1,5 szt." — parsuje przecinek', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Kosmetyk: Y', kwota: 75, id_zadatku: '', czy_rozliczone: 0, szczegoly: '1,5 szt.' }] },
            { rows: { affectedRows: 1 } }, // UPDATE Sprzedaz
            { rows: { affectedRows: 1 } }, // Logi
            { rows: [{ id: 'P1', ilosc: 10 }] },
            { rows: { affectedRows: 1 } }, // UPDATE Magazyn
            { rows: { affectedRows: 1 } }, // Logi
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'delete_sale', tenant_id: TENANT, id: 'S1', pracownik: 'Marta'
        });
        expect(res.body.status).toBe('success');
        const updateMag = db.query.mock.calls.find(c => /UPDATE Magazyn SET ilosc/.test(c[0]));
        expect(updateMag[1][0]).toBe(11.5); // 10 + 1.5
    });

    test('niepełne szczegoly bez "szt." — pomija magazyn (parsujKosmetyk zwraca null)', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Kosmetyk: Krem', kwota: 50, id_zadatku: '', czy_rozliczone: 0, szczegoly: 'opisowy bez ilosci' }] },
            { rows: { affectedRows: 1 } }, // UPDATE Sprzedaz
            { rows: { affectedRows: 1 } }, // Logi
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'delete_sale', tenant_id: TENANT, id: 'S1', pracownik: 'Marta'
        });
        expect(res.body.status).toBe('success');
        const sqls = db.query.mock.calls.map(c => c[0]);
        expect(sqls.some(s => /Magazyn/.test(s))).toBe(false);
    });
});

// ─── EDIT_SALE — magazyn ────────────────────────────────────

describe('POST /api/sprzedaz — edit_sale + magazyn', () => {

    test('zmiana usługi (zabieg → zabieg, bez kosmetyków) — magazyn NIE ruszany', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Botoks', sprzedawca: 'Anna', kwota: 200, komentarz: '', szczegoly: '', platnosc: 'Karta', id_klienta: '', czy_rozliczone: 0 }] }, // SELECT
            { rows: { affectedRows: 1 } }, // UPDATE Sprzedaz
            { rows: { affectedRows: 1 } }, // INSERT Logi EDYCJA
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_sale', tenant_id: TENANT, id: 'S1',
            klient: 'X', zabieg_nazwa: 'Mezoterapia', sprzedawca: ['Anna'],
            kwota: '300', platnosc: 'Karta', pracownik: 'Anna'
        });
        expect(res.body.status).toBe('success');
        const sqls = db.query.mock.calls.map(c => c[0]);
        expect(sqls.some(s => /Magazyn/.test(s))).toBe(false);
    });

    test('ten sam kosmetyk + większa ilość (2 → 5) — zdejmuje różnicę 3', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Kosmetyk: Krem A', sprzedawca: 'Anna', kwota: 100, komentarz: '', szczegoly: '2 szt.', platnosc: 'Karta', id_klienta: '', czy_rozliczone: 0 }] }, // SELECT
            { rows: [{ total: 10 }] },     // SELECT SUM (pre-walidacja: 10 dostępnych >= 3)
            { rows: { affectedRows: 1 } }, // UPDATE Sprzedaz
            { rows: { affectedRows: 1 } }, // INSERT Logi EDYCJA
            { rows: [{ id: 'P1', ilosc: 10 }] }, // SELECT Magazyn FIFO (zdejmijZeStanuFIFO)
            { rows: { affectedRows: 1 } }, // UPDATE Magazyn (10 → 7)
            { rows: { affectedRows: 1 } }, // INSERT Logi SPRZEDAŻ DETAL
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_sale', tenant_id: TENANT, id: 'S1',
            klient: 'X', zabieg_nazwa: 'Kosmetyk: Krem A', sprzedawca: ['Anna'],
            kwota: '250', szczegoly: '5 szt.', platnosc: 'Karta', pracownik: 'Anna'
        });
        expect(res.body.status).toBe('success');
        const updateMag = db.query.mock.calls.find(c => /UPDATE Magazyn SET ilosc/.test(c[0]));
        expect(updateMag[1][0]).toBe(7); // 10 - 3
    });

    test('ten sam kosmetyk + mniejsza ilość (5 → 2) — zwraca różnicę 3', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Kosmetyk: Krem A', sprzedawca: 'Anna', kwota: 250, komentarz: '', szczegoly: '5 szt.', platnosc: 'Karta', id_klienta: '', czy_rozliczone: 0 }] },
            // brak SELECT SUM (mniejsza ilość — pomijamy walidację)
            { rows: { affectedRows: 1 } }, // UPDATE Sprzedaz
            { rows: { affectedRows: 1 } }, // INSERT Logi EDYCJA
            { rows: [{ id: 'P1', ilosc: 5 }] },  // SELECT Magazyn (przywrocDoMagazynu)
            { rows: { affectedRows: 1 } }, // UPDATE Magazyn (5 → 8)
            { rows: { affectedRows: 1 } }, // Logi PRZYWRÓCENIE
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_sale', tenant_id: TENANT, id: 'S1',
            klient: 'X', zabieg_nazwa: 'Kosmetyk: Krem A', sprzedawca: ['Anna'],
            kwota: '100', szczegoly: '2 szt.', platnosc: 'Karta', pracownik: 'Anna'
        });
        expect(res.body.status).toBe('success');
        const updateMag = db.query.mock.calls.find(c => /UPDATE Magazyn SET ilosc/.test(c[0]));
        expect(updateMag[1][0]).toBe(8); // 5 + 3
    });

    test('zmiana produktu A → B — A zwrócone, B zdjęte', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Kosmetyk: Krem A', sprzedawca: 'Anna', kwota: 100, komentarz: '', szczegoly: '2 szt.', platnosc: 'Karta', id_klienta: '', czy_rozliczone: 0 }] }, // SELECT Sprzedaz
            { rows: [{ total: 8 }] },             // SELECT SUM dla Krem B (>=1 OK)
            { rows: { affectedRows: 1 } },        // UPDATE Sprzedaz
            { rows: { affectedRows: 1 } },        // INSERT Logi EDYCJA
            { rows: [{ id: 'PA1', ilosc: 3 }] },  // SELECT Magazyn (przywrocDoMagazynu A)
            { rows: { affectedRows: 1 } },        // UPDATE Magazyn A (3 → 5)
            { rows: { affectedRows: 1 } },        // Logi PRZYWRÓCENIE A
            { rows: [{ id: 'PB1', ilosc: 8 }] },  // SELECT Magazyn (zdejmijZeStanuFIFO B)
            { rows: { affectedRows: 1 } },        // UPDATE Magazyn B (8 → 7)
            { rows: { affectedRows: 1 } },        // Logi SPRZEDAŻ DETAL B
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_sale', tenant_id: TENANT, id: 'S1',
            klient: 'X', zabieg_nazwa: 'Kosmetyk: Krem B', sprzedawca: ['Anna'],
            kwota: '50', szczegoly: '1 szt.', platnosc: 'Karta', pracownik: 'Anna'
        });
        expect(res.body.status).toBe('success');
        const magUpdates = db.query.mock.calls.filter(c => /UPDATE Magazyn SET ilosc/.test(c[0]));
        expect(magUpdates.length).toBe(2);
        expect(magUpdates[0][1][0]).toBe(5); // A: 3 + 2 (zwrot)
        expect(magUpdates[1][1][0]).toBe(7); // B: 8 - 1 (zdjęcie)
    });

    test('zmiana z kosmetyku na zabieg — tylko zwrot magazynu', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Kosmetyk: Krem A', sprzedawca: 'Anna', kwota: 100, komentarz: '', szczegoly: '2 szt.', platnosc: 'Karta', id_klienta: '', czy_rozliczone: 0 }] },
            // brak SELECT SUM (nowy nie jest kosmetykiem)
            { rows: [{ typ_zabiegu: 'twarz' }] }, // SELECT typ_zabiegu Uslugi (re-lookup, nazwa zabiegu się zmieniła)
            { rows: { affectedRows: 1 } }, // UPDATE Sprzedaz
            { rows: { affectedRows: 1 } }, // Logi EDYCJA
            { rows: [{ id: 'PA1', ilosc: 3 }] }, // SELECT Magazyn (zwrot)
            { rows: { affectedRows: 1 } }, // UPDATE Magazyn (3 → 5)
            { rows: { affectedRows: 1 } }, // Logi PRZYWRÓCENIE
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_sale', tenant_id: TENANT, id: 'S1',
            klient: 'X', zabieg_nazwa: 'Botoks', sprzedawca: ['Anna'],
            kwota: '300', szczegoly: '', platnosc: 'Karta', pracownik: 'Anna'
        });
        expect(res.body.status).toBe('success');
        const magUpdates = db.query.mock.calls.filter(c => /UPDATE Magazyn SET ilosc/.test(c[0]));
        expect(magUpdates.length).toBe(1);
        expect(magUpdates[0][1][0]).toBe(5); // 3 + 2
    });

    test('zmiana z zabiegu na kosmetyk — tylko zdjęcie magazynu', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Botoks', sprzedawca: 'Anna', kwota: 200, komentarz: '', szczegoly: '', platnosc: 'Karta', id_klienta: '', czy_rozliczone: 0 }] },
            { rows: [{ total: 10 }] },           // SELECT SUM walidacja
            { rows: { affectedRows: 1 } },        // UPDATE Sprzedaz
            { rows: { affectedRows: 1 } },        // Logi EDYCJA
            { rows: [{ id: 'P1', ilosc: 10 }] },  // SELECT Magazyn FIFO
            { rows: { affectedRows: 1 } },        // UPDATE Magazyn (10 → 8)
            { rows: { affectedRows: 1 } },        // Logi SPRZEDAŻ DETAL
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_sale', tenant_id: TENANT, id: 'S1',
            klient: 'X', zabieg_nazwa: 'Kosmetyk: Krem A', sprzedawca: ['Anna'],
            kwota: '100', szczegoly: '2 szt.', platnosc: 'Karta', pracownik: 'Anna'
        });
        expect(res.body.status).toBe('success');
        const magUpdates = db.query.mock.calls.filter(c => /UPDATE Magazyn SET ilosc/.test(c[0]));
        expect(magUpdates.length).toBe(1);
        expect(magUpdates[0][1][0]).toBe(8); // 10 - 2
    });

    test('za mało towaru (chcę 10, dostępne 3) — error i sprzedaż NIE zmieniona', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Kosmetyk: Krem A', sprzedawca: 'Anna', kwota: 100, komentarz: '', szczegoly: '2 szt.', platnosc: 'Karta', id_klienta: '', czy_rozliczone: 0 }] }, // SELECT
            { rows: [{ total: 3 }] }, // SELECT SUM — tylko 3 dostępne, potrzeba różnicy 8
            // żadnych dalszych callsów — error przed UPDATE
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_sale', tenant_id: TENANT, id: 'S1',
            klient: 'X', zabieg_nazwa: 'Kosmetyk: Krem A', sprzedawca: ['Anna'],
            kwota: '500', szczegoly: '10 szt.', platnosc: 'Karta', pracownik: 'Anna'
        });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/Za mało towaru/);
        // UPDATE Sprzedaz nie powinien się wykonać
        const sqls = db.query.mock.calls.map(c => c[0]);
        expect(sqls.some(s => /UPDATE Sprzedaz SET klient/.test(s))).toBe(false);
    });

    test('rozliczona transakcja Boczki — zwraca error przed UPDATE', async () => {
        const db = mockDb(
            { rows: [{ klient: 'X', zabieg: 'Kosmetyk: Krem A', sprzedawca: 'Anna', kwota: 100, komentarz: '', szczegoly: '2 szt.', platnosc: 'Karta', id_klienta: '', czy_rozliczone: 1 }] },
        );
        const res = await request(buildApp({ query: db.query })).post('/api/sprzedaz').send({
            action: 'edit_sale', tenant_id: 'boczki-salon-glowny-001', id: 'S1',
            klient: 'X', zabieg_nazwa: 'Kosmetyk: Krem A', sprzedawca: ['Anna'],
            kwota: '100', szczegoly: '2 szt.', platnosc: 'Karta', pracownik: 'Anna'
        });
        expect(res.body.status).toBe('error');
        expect(res.body.message).toMatch(/rozliczona/);
    });
});
