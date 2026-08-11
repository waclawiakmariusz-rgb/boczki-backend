// tests/karnety.test.js
// Testy funkcji ważności zabiegów/karnetów (waznosc_dni, data_waznosci, extend/close/reopen).

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

// Znajduje wywołanie db.query, którego SQL zawiera podany fragment. Zwraca { sql, params }.
function findQuery(db, fragment) {
    const calls = db.query.mock.calls;
    for (const c of calls) {
        const sql = String(c[0] || '');
        if (sql.includes(fragment)) {
            const params = Array.isArray(c[1]) ? c[1] : [];
            return { sql, params };
        }
    }
    return null;
}

// ─── add_sales_def — zapis waznosc_dni do Uslugi ──────────────
describe('add_sales_def — waznosc_dni', () => {
    test('zapisuje liczbę dni do INSERT INTO Uslugi', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sales_def', tenant_id: TENANT, typ: 'zabieg',
            kategoria: 'Twarz', wariant: '10x LPG', cena: '500', waznosc_dni: '90', pracownik: 'Anna',
        });
        const q = findQuery(db, 'INSERT INTO Uslugi');
        expect(q).not.toBeNull();
        expect(q.sql).toContain('waznosc_dni');
        // ostatni parametr to waznosc_dni
        expect(q.params[q.params.length - 1]).toBe(90);
    });

    test('pusta wartość = bezterminowo (NULL)', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sales_def', tenant_id: TENANT, typ: 'zabieg',
            kategoria: 'Twarz', wariant: 'Pojedynczy', cena: '100', waznosc_dni: '', pracownik: 'Anna',
        });
        const q = findQuery(db, 'INSERT INTO Uslugi');
        expect(q.params[q.params.length - 1]).toBeNull();
    });
});

// ─── edit_service — aktualizacja waznosc_dni ──────────────────
describe('edit_service — waznosc_dni', () => {
    test('dokłada kolumnę waznosc_dni do UPDATE gdy podana', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_service', tenant_id: TENANT,
            old_kategoria: 'Twarz', old_wariant: '10x LPG',
            new_kategoria: 'Twarz', new_wariant: '10x LPG', new_cena: '500',
            waznosc_dni: '60', pracownik: 'Anna',
        });
        const q = findQuery(db, 'UPDATE Uslugi SET');
        expect(q).not.toBeNull();
        expect(q.sql).toContain('waznosc_dni = ?');
        expect(q.params).toContain(60);
    });

    test('bez waznosc_dni nie rusza kolumny', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'edit_service', tenant_id: TENANT,
            old_kategoria: 'Twarz', old_wariant: 'X',
            new_kategoria: 'Twarz', new_wariant: 'X', new_cena: '100', pracownik: 'Anna',
        });
        const q = findQuery(db, 'UPDATE Uslugi SET');
        expect(q.sql).not.toContain('waznosc_dni');
    });
});

// ─── add_sale — snapshot data_waznosci ────────────────────────
describe('add_sale — snapshot data_waznosci', () => {
    test('liczy datę wygaśnięcia z waznosc_dni usługi', async () => {
        // lookup typ_zabiegu/waznosc_dni zwróci 30 dni
        const db = mockDbAlways([{ typ_zabiegu: 'twarz', waznosc_dni: 30 }]);
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sale', tenant_id: TENANT, typ_transakcji: 'Zabieg',
            sprzedawca: ['Anna'], klient: 'Kowalska', zabieg_nazwa: 'Botoks',
            kwota: '250', platnosc: 'Karta', pracownik: 'Anna',
        });
        const q = findQuery(db, 'INSERT INTO Sprzedaz');
        expect(q).not.toBeNull();
        expect(q.sql).toContain('data_waznosci');
        const dataWaznosci = q.params[q.params.length - 1];
        expect(dataWaznosci).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

// ─── Bug rabatu: sufiks „[Rabat: -X%]" psuł dopasowanie waznosc_dni ──
describe('add_multi_sale — ważność liczy się mimo rabatu', () => {
    test('lookup Uslugi używa BAZOWEGO wariantu (bez sufiksu rabatu)', async () => {
        const db = mockDbAlways([{ typ_zabiegu: 'ciało', waznosc_dni: 90 }]);
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_multi_sale', tenant_id: TENANT, sprzedawca: ['Anna'], klient: 'Bielasz', id_klienta: '1230',
            pozycje: [{ typ: 'Zabieg', kategoria: 'Endermologia Infinity', wariant: '15x [Rabat: -20%]', kwota: '800', platnosc: 'Karta' }],
        });
        const q = findQuery(db, 'SELECT typ_zabiegu, waznosc_dni FROM Uslugi');
        expect(q).not.toBeNull();
        expect(q.params).toContain('15x');                                       // dopasowanie po czystym wariancie
        expect(q.params.some(p => String(p).includes('[Rabat'))).toBe(false);    // bez sufiksu
        const ins = findQuery(db, 'INSERT INTO Sprzedaz');
        expect(ins.params).toContain('15x [Rabat: -20%]');                       // szczegóły zapisane PEŁNE
        expect(ins.params.some(p => /^\d{4}-\d{2}-\d{2}$/.test(String(p)))).toBe(true); // data ważności policzona
    });

    test('rabat urodzinowy z emoji też jest obcinany', async () => {
        const db = mockDbAlways([{ typ_zabiegu: 'ciało', waznosc_dni: 30 }]);
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_multi_sale', tenant_id: TENANT, sprzedawca: ['Anna'], klient: 'X', id_klienta: '1',
            pozycje: [{ typ: 'Zabieg', kategoria: 'Storz', wariant: 'Uda przód/wewnętrzne/tył 5x [🎂 Urodziny: -15%]', kwota: '500', platnosc: 'Karta' }],
        });
        const q = findQuery(db, 'SELECT typ_zabiegu, waznosc_dni FROM Uslugi');
        expect(q.params).toContain('Uda przód/wewnętrzne/tył 5x');
        expect(q.params.some(p => String(p).includes('Urodziny'))).toBe(false);
    });

    test('wariant bez sufiksu przechodzi bez zmian', async () => {
        const db = mockDbAlways([{ typ_zabiegu: 'ciało', waznosc_dni: 90 }]);
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_multi_sale', tenant_id: TENANT, sprzedawca: ['Anna'], klient: 'X', id_klienta: '1',
            pozycje: [{ typ: 'Zabieg', kategoria: 'Endermologia Infinity', wariant: '10x', kwota: '600', platnosc: 'Karta' }],
        });
        const q = findQuery(db, 'SELECT typ_zabiegu, waznosc_dni FROM Uslugi');
        expect(q.params).toContain('10x');
    });
});

// ─── extend_karnet / close_karnet / reopen_karnet ─────────────
describe('akcje karnetów', () => {
    test('extend_karnet odrzuca złą datę', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'extend_karnet', tenant_id: TENANT, id: 'S1', data_waznosci: '2026/13/40', pracownik: 'Anna',
        });
        expect(res.body.status).toBe('error');
    });

    test('extend_karnet zapisuje poprawną datę', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'extend_karnet', tenant_id: TENANT, id: 'S1', data_waznosci: '2026-12-31', pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
        const q = findQuery(db, 'SET data_waznosci = ?');
        expect(q).not.toBeNull();
        expect(q.params).toContain('2026-12-31');
    });

    test('close_karnet ustawia znacznik zakończenia', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'close_karnet', tenant_id: TENANT, id: 'S1', pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
        expect(findQuery(db, 'karnet_zamkniety_w = NOW()')).not.toBeNull();
    });

    test('reopen_karnet czyści znacznik', async () => {
        const db = mockDbAlways({ affectedRows: 1 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'reopen_karnet', tenant_id: TENANT, id: 'S1', pracownik: 'Anna',
        });
        expect(res.body.status).toBe('success');
        expect(findQuery(db, 'karnet_zamkniety_w = NULL')).not.toBeNull();
    });

    test('close_karnet zgłasza błąd gdy ID nie istnieje', async () => {
        const db = mockDbAlways({ affectedRows: 0 });
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'close_karnet', tenant_id: TENANT, id: 'NIEMA', pracownik: 'Anna',
        });
        expect(res.body.status).toBe('error');
    });
});

// ─── Czytelność wpisów w Dzienniku Zdarzeń (zgłoszone 2026-08-11) ─────────────
// Było: "KARNET ZAKOŃCZONY — ID:202608061754188-3" — recepcja nie wiedziała, czyj to karnet.
describe('akcje karnetów — opis w Dzienniku Zdarzeń', () => {
    const KARNET = {
        klient: 'Karolina Bańdosz-Kotarak',
        zabieg: 'Endermologia Alliance',
        data_sprzedazy: '2026-08-06 17:54:18',
        data_waznosci: '2026-08-13',
    };

    // Kolejność zapytań: 1) UPDATE, 2) SELECT po dane do opisu, 3) INSERT do Logi.
    const dbZKarnetem = () => mockDb(
        { rows: { affectedRows: 1 } },
        { rows: [KARNET] },
        { rows: { affectedRows: 1 } },
    );

    function opisZLogu(db) {
        const wpis = findQuery(db, 'INSERT INTO Logi');
        return wpis ? String(wpis.params[wpis.params.length - 1]) : null;
    }

    test('close_karnet: opis zawiera klientkę, zabieg i daty', async () => {
        const db = dbZKarnetem();
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'close_karnet', tenant_id: TENANT, id: '202608061754188-3', pracownik: 'Gosia',
        });
        expect(res.body.status).toBe('success');

        const opis = opisZLogu(db);
        expect(opis).toContain('Karolina Bańdosz-Kotarak');
        expect(opis).toContain('Endermologia Alliance');
        expect(opis).toContain('sprzedaż 06.08.2026');
        expect(opis).toContain('ważność do 13.08.2026');
        expect(opis).toContain('ID:202608061754188-3');   // identyfikator zostaje — bywa potrzebny
    });

    test('daty w opisie są po polsku (DD.MM.RRRR), nie w formacie bazy', async () => {
        const db = dbZKarnetem();
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'close_karnet', tenant_id: TENANT, id: 'S1', pracownik: 'Gosia',
        });
        const opis = opisZLogu(db);
        expect(opis).not.toContain('2026-08-06');
        expect(opis).not.toContain('17:54:18');
    });

    test('reopen_karnet też opisuje karnet po ludzku', async () => {
        const db = dbZKarnetem();
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'reopen_karnet', tenant_id: TENANT, id: 'S1', pracownik: 'Gosia',
        });
        expect(opisZLogu(db)).toContain('Karolina Bańdosz-Kotarak');
    });

    test('extend_karnet pokazuje NOWĄ datę ważności', async () => {
        const db = mockDb(
            { rows: { affectedRows: 1 } },
            { rows: [{ ...KARNET, data_waznosci: '2026-12-31' }] },   // rekord już po przedłużeniu
            { rows: { affectedRows: 1 } },
        );
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'extend_karnet', tenant_id: TENANT, id: 'S1', data_waznosci: '2026-12-31', pracownik: 'Gosia',
        });
        expect(opisZLogu(db)).toContain('ważność do 31.12.2026');
    });

    test('gdy danych karnetu brak — log powstaje mimo to, w starej formie', async () => {
        // Zdarzenie MUSI trafić do Dziennika nawet bez ładnego opisu.
        const db = mockDb(
            { rows: { affectedRows: 1 } },
            { rows: [] },                      // SELECT nic nie zwrócił
            { rows: { affectedRows: 1 } },
        );
        const res = await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'close_karnet', tenant_id: TENANT, id: 'S1', pracownik: 'Gosia',
        });
        expect(res.body.status).toBe('success');
        expect(opisZLogu(db)).toBe('ID:S1');
    });

    test('akcja grupowa podaje liczbę sztuk', async () => {
        const db = mockDb(
            { rows: { affectedRows: 3 } },
            { rows: [KARNET] },
            { rows: { affectedRows: 1 } },
        );
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'close_karnet', tenant_id: TENANT, grupa_id: 'G7', pracownik: 'Gosia',
        });
        const opis = opisZLogu(db);
        expect(opis).toContain('3 szt.');
        expect(opis).toContain('GRUPA:G7');
    });
});

// ─── Bug „zabieg wpada w losową zakładkę": add_sale dopasowywał się po samej
// kategorii (wariant siedzi w `szczegoly` i był ignorowany). Kategoria z wariantami
// o różnych typach (np. Adipologia twarz/ciało) trafiała przez LIMIT 1 w losowy
// wiersz Uslugi → losowy typ_zabiegu ORAZ losowa ważność karnetu.
describe('add_sale — dopasowanie po kategorii ORAZ wariancie', () => {
    test('wariant ze `szczegoly` trafia do zapytania o Uslugi', async () => {
        const db = mockDbAlways([{ typ_zabiegu: 'medycyna estetyczna', waznosc_dni: 60 }]);
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sale', tenant_id: TENANT, typ_transakcji: 'Zabieg',
            sprzedawca: ['Anna'], klient: 'Kowalska',
            zabieg_nazwa: 'Lipoliza iniekcyjna', szczegoly: 'Brzuch',
            kwota: '600', platnosc: 'Karta', pracownik: 'Anna',
        });
        const q = findQuery(db, 'SELECT typ_zabiegu, waznosc_dni FROM Uslugi');
        expect(q).not.toBeNull();
        // zapytanie MUSI zawężać po wariancie — inaczej wraca losowy wiersz kategorii
        expect(q.sql).toContain("TRIM(COALESCE(wariant,'')) = TRIM(?)");
        expect(q.params).toContain('Lipoliza iniekcyjna');
        expect(q.params).toContain('Brzuch');
        // typ z dopasowanego wariantu ląduje w snapshocie sprzedaży
        const ins = findQuery(db, 'INSERT INTO Sprzedaz');
        expect(ins.params).toContain('medycyna estetyczna');
    });

    test('placeholder "-" (kategoria bez wariantów) leci jako pusty wariant', async () => {
        const db = mockDbAlways([{ typ_zabiegu: 'twarz', waznosc_dni: null }]);
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sale', tenant_id: TENANT, typ_transakcji: 'Zabieg',
            sprzedawca: ['Anna'], klient: 'X', zabieg_nazwa: 'Konsultacja', szczegoly: '-',
            kwota: '100', platnosc: 'Karta', pracownik: 'Anna',
        });
        const q = findQuery(db, 'SELECT typ_zabiegu, waznosc_dni FROM Uslugi');
        expect(q.params).toContain('');
        expect(q.params).not.toContain('-');
    });

    test('sufiks rabatu w wariancie jest obcinany (spójnie z add_multi_sale)', async () => {
        const db = mockDbAlways([{ typ_zabiegu: 'ciało', waznosc_dni: 90 }]);
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sale', tenant_id: TENANT, typ_transakcji: 'Zabieg',
            sprzedawca: ['Anna'], klient: 'X',
            zabieg_nazwa: 'Endermologia Infinity', szczegoly: '15x [Rabat: -20%]',
            kwota: '800', platnosc: 'Karta', pracownik: 'Anna',
        });
        const q = findQuery(db, 'SELECT typ_zabiegu, waznosc_dni FROM Uslugi');
        expect(q.params).toContain('15x');
        expect(q.params.some(p => String(p).includes('[Rabat'))).toBe(false);
        // szczegóły zapisane PEŁNE (z rabatem) — obcinamy tylko do dopasowania
        const ins = findQuery(db, 'INSERT INTO Sprzedaz');
        expect(ins.params).toContain('15x [Rabat: -20%]');
    });

    test('Kosmetyk nadal nie dostaje typu (osobny box w profilu)', async () => {
        const db = mockDbAlways([]);
        await request(buildApp(db)).post('/api/sprzedaz').send({
            action: 'add_sale', tenant_id: TENANT, typ_transakcji: 'Kosmetyk',
            sprzedawca: ['Anna'], klient: 'X', zabieg_nazwa: 'Kosmetyk: Krem',
            szczegoly: '2 szt.', produkt_nazwa: 'Krem', ilosc_sztuk: '2',
            kwota: '120', platnosc: 'Karta', pracownik: 'Anna',
        });
        expect(findQuery(db, 'SELECT typ_zabiegu, waznosc_dni FROM Uslugi')).toBeNull();
    });
});
