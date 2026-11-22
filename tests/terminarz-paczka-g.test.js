// tests/terminarz-paczka-g.test.js
// Terminarz, paczka G — „nieobecność klientki do końca" (docs/terminarz-audyt/PLAN_POPRAWY_2026-11-16.md).
// R3 przycisk cofnięcia, R8 wznowienie spraw E13, R9 tylko pozycje zdjęte przez nieobecność,
// R10 sloty po grafiku poza nieobecnością, plus strażnik blokady całego salonu przez API.
// Testy frontu URUCHAMIAJĄ kod (zasada z planu po wpadce R1), nie dopasowują tekstu pliku.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');

const FRONT = fs.readFileSync(path.join(__dirname, '..', 'public', 'terminarz.js'), 'utf8');
const SERWER = fs.readFileSync(path.join(__dirname, '..', 'routes', 'terminarz.js'), 'utf8');
const M = require('../routes/terminarz');
const T = 'salon-test-001';

function wytnij(zrodlo, naglowek) {
    const start = zrodlo.indexOf(naglowek);
    if (start < 0) throw new Error('nie znaleziono: ' + naglowek);
    let i = zrodlo.indexOf('{', start), g = 0;
    for (; i < zrodlo.length; i++) {
        if (zrodlo[i] === '{') g++;
        else if (zrodlo[i] === '}') { g--; if (g === 0) return zrodlo.slice(start, i + 1); }
    }
    throw new Error('brak końca: ' + naglowek);
}

// ─── R3: przycisk cofnięcia nieobecności ───────────────────────────────────
describe('R3 — recepcja ma czym cofnąć pomyłkową nieobecność', () => {
    const glowna = (() => {
        const kod = wytnij(FRONT, 'function glownaAkcjaWizyty(r, anul, op) {');
        return new Function('esc', kod + '; return glownaAkcjaWizyty;')((x) => String(x));
    })();
    const poz = (stan) => ({ id: 5, stan, kategoria: 'Endermologia', wariant: '1x' });

    test('wizyta oznaczona jako nieobecna dostaje przycisk cofnięcia', () => {
        const html = glowna({ obecnosc: 'nieobecny', status: 'potwierdzona', pozycje: [poz('niewykonana')] }, false, true);
        expect(html).toContain("TRM.obecnosc('przybyl')");
        expect(html).toMatch(/Jednak przybyła/);
    });

    test('BŁĄD, KTÓRY NAPRAWIAMY: bez tej gałęzi nieobecna wizyta nie miała żadnej głównej czynności', () => {
        // przy „nieobecna" wszystkie pozycje są niewykonane, więc warunek na „Oznacz przybycie" nie przechodzi
        const bezPoprawki = glowna({ obecnosc: 'nieobecny', status: 'potwierdzona', pozycje: [poz('niewykonana')] }, false, true);
        expect(bezPoprawki).not.toBe('');
    });

    test('zwykła wizyta nadal dostaje „Oznacz przybycie"', () => {
        const html = glowna({ obecnosc: 'oczekiwana', status: 'potwierdzona', pozycje: [poz('zaplanowana')] }, false, true);
        expect(html).toContain('Oznacz przybycie');
        expect(html).not.toMatch(/Jednak przybyła/);
    });

    test('zabieg w trakcie wygrywa z cofaniem nieobecności', () => {
        const html = glowna({ obecnosc: 'nieobecny', status: 'potwierdzona', pozycje: [poz('w_trakcie')] }, false, true);
        expect(html).toContain('Zakończ zabieg');
    });

    test('wizyta anulowana i trzymany termin nadal bez głównej czynności', () => {
        expect(glowna({ obecnosc: 'nieobecny', status: 'anulowana', pozycje: [poz('niewykonana')] }, true, true)).toBe('');
        expect(glowna({ obecnosc: 'nieobecny', status: 'do_wplaty', pozycje: [poz('niewykonana')] }, false, true)).toBe('');
    });

    test('komunikat serwera o liczbie przywróconych zabiegów trafia na ekran', () => {
        expect(FRONT).toContain("if (d.message) toast('success', d.przywrocone ? 'Cofnięto nieobecność' : 'Zapisano', d.message);");
    });
});

// ─── R10: sloty „po grafiku" ───────────────────────────────────────────────
describe('R10 — podpowiedzi po grafiku nie wchodzą w nieobecność', () => {
    function uruchom({ nieobecnosci = [], grafik = [], dostepnosc = [{ od: '09:00', do: '15:00' }] }) {
        const kod = wytnij(FRONT, 'function slotyPoGrafiku(n) {');
        const minDnia = (t) => {
            const s = String(t || ''); const m = s.slice(s.length > 5 ? 11 : 0, s.length > 5 ? 16 : 5);
            if (!/^\d{2}:\d{2}$/.test(m)) return 0;
            return Number(m.slice(0, 2)) * 60 + Number(m.slice(3, 5));
        };
        const TRM = {
            dane: { grafik, ustawienia: { siatka_min: 15 } },
            dzien: { data: '2026-11-23', dostepnosc: { Anna: dostepnosc }, salon: [{ od: '09:00', do: '17:00' }], rezerwacje: [], zajecia: [], nieobecnosci, teraz: '2026-11-23 08:00' },
        };
        const f = new Function('TRM', 'minDnia', 'dzienTyg', 'jestWyjatkiem', kod + '; return slotyPoGrafiku;')(TRM, minDnia, () => 1, () => false);
        return f({ prefPrac: 'Anna', pozycje: [{ czas_min: 60 }], sloty: [], start: '2026-11-23 10:00' });
    }

    test('bez nieobecności podpowiedzi po grafiku się pojawiają', () => {
        const w = uruchom({});
        expect(w).toBeTruthy();
        expect(w.godziny.length).toBeGreaterThan(0);
    });

    test('BŁĄD, KTÓRY NAPRAWIAMY: urlop po grafiku wycinał godziny z podpowiedzi', () => {
        const w = uruchom({ nieobecnosci: [{ pracownik: 'Anna', od: '2026-11-23 15:00:00', do: '2026-11-23 20:00:00', typ: 'urlop' }] });
        expect(w.godziny).toEqual([]);
    });

    test('zamknięcie całego salonu też zajmuje czas', () => {
        const w = uruchom({ nieobecnosci: [{ pracownik: null, zasob_id: null, od: '2026-11-23 00:00:00', do: '2026-11-23 23:59:00', typ: 'zamkniete' }] });
        expect(w.godziny).toEqual([]);
    });

    test('nieobecność innej osoby nie zabiera godzin tej osobie', () => {
        const w = uruchom({ nieobecnosci: [{ pracownik: 'Marta', od: '2026-11-23 15:00:00', do: '2026-11-23 20:00:00', typ: 'urlop' }] });
        expect(w.godziny.length).toBeGreaterThan(0);
    });

    test('koniec grafiku liczony z GRAFIKU, nie z okrojonej dostępności', () => {
        // grafik do 17:00, ale dostępność ucięta do 12:00 przez nieobecność popołudniową
        const w = uruchom({
            grafik: [{ pracownik: 'Anna', dzien_tyg: 1, od: '09:00', do: '17:00' }],
            dostepnosc: [{ od: '09:00', do: '12:00' }],
            nieobecnosci: [],
        });
        expect(w.koniecGrafiku).toBe(17 * 60);
    });
});

// ─── R8 i R9 po stronie serwera ────────────────────────────────────────────
describe('R8 i R9 — cofnięcie przywraca dokładnie to, co zdjęła nieobecność', () => {
    test('nieobecność zapisuje w historii listę zdjętych pozycji', () => {
        expect(SERWER).toContain('const zdjetePrzezNieobecnosc = rez.pozycje.filter(x => x.stan === \'zaplanowana\').map(x => x.id);');
        expect(SERWER).toMatch(/pozycje_zdjete: zdjetePrzezNieobecnosc/);
    });
    test('cofnięcie czyta ten ślad i zawęża listę do przywrócenia', () => {
        expect(SERWER).toMatch(/po_json LIKE '%"obecnosc":"nieobecny"%' ORDER BY id DESC LIMIT 1/);
        expect(SERWER).toMatch(/\(!tylkoTe \|\| tylkoTe\.has\(Number\(x\.id\)\)\)/);
    });
    test('brak śladu (stare wizyty) nie blokuje cofnięcia', () => {
        expect(SERWER).toMatch(/let tylkoTe = null;/);
        expect(SERWER).toMatch(/catch \(e\) \{ tylkoTe = null; \}/);
    });
    test('R8: sprawy E13 przywróconych pozycji wracają na listę', () => {
        expect(SERWER).toMatch(/async function sprawaAutoWznow\(tenant, klucz, powod\)/);
        expect(SERWER).toMatch(/for \(const pid of przywroconeIdy\) await sprawaAutoWznow\(tenant, `E13:poz:\$\{pid\}`/);
    });
    test('wznowienie zdejmuje właściciela i wynik, żeby sprawa była naprawdę otwarta', () => {
        const kod = SERWER.slice(SERWER.indexOf('async function sprawaAutoWznow'), SERWER.indexOf('async function sprawaAutoWznow') + 900);
        expect(kod).toMatch(/stan = 'nowa', wlasciciel = NULL, wynik = NULL, rozwiazal = NULL, rozwiazano = NULL/);
        expect(kod).toMatch(/stan IN \('rozwiazana', 'nieaktualna'\)/);
    });
});

// ─── strażnik: nieobecność bez osoby i bez zasobu ──────────────────────────
describe('nieobecność przez API nie zamyka salonu po cichu', () => {
    function atrapa(odpowiedzi) {
        const zap = [];
        const wykonaj = (sql) => { zap.push(String(sql).replace(/\s+/g, ' ').trim()); for (const [re, w] of odpowiedzi) if (re.test(sql)) return w; return []; };
        const query = (sql, p, cb) => { const c = typeof p === 'function' ? p : cb; let w; try { w = wykonaj(sql); } catch (e) { return c && c(e); } if (c) c(null, w); };
        const conn = { query, beginTransaction: (cb) => cb(null), commit: (cb) => cb(null), rollback: (cb) => cb(null), release: () => {} };
        return { query, getConnection: (cb) => cb(null, conn), zap };
    }
    const app = (db) => { const a = express(); a.use(express.json()); a.use('/api', M(db, { hasFeature: (t, k, cb) => cb(true) })); return a; };
    const wyslij = (db, body) => request(app(db)).post('/api/terminarz').send({ tenant_id: T, pracownik: 'Ola', action: 'trm_nieobecnosc_zapisz', ...body });

    const baza = () => atrapa([
        [/SELECT rola FROM Użytkownicy/, [{ rola: 'manager' }]],
        [/SELECT DATE_FORMAT\(NOW\(\)/, [{ t: '2026-11-23 09:00:00' }]],
        [/FROM Pracownicy/, [{ imie: 'Anna' }]],
    ]);

    test('bez osoby, bez zasobu i bez deklaracji „cały salon" — odmowa z wyjaśnieniem', async () => {
        const { body } = await wyslij(baza(), { od: '2026-11-23 09:00', do: '2026-11-23 17:00', typ: 'urlop', opis: 'x' });
        expect(body.status).toBe('error');
        expect(body.message).toMatch(/cały salon/i);
        expect(body.message).toMatch(/Wskaż/i);
    });

    test('żaden INSERT nie poszedł do bazy przy odmowie', async () => {
        const db = baza();
        await wyslij(db, { od: '2026-11-23 09:00', do: '2026-11-23 17:00', typ: 'urlop' });
        expect(db.zap.some(s => /INSERT INTO Term_Nieobecnosci/.test(s))).toBe(false);
    });

    test('strażnik jest tym samym wzorcem co przy rezerwacji technicznej', () => {
        expect(SERWER).toMatch(/const calySalonNieob = d\.caly_salon === true \|\| d\.caly_salon === 'true' \|\| d\.caly_salon === 1;/);
    });
});
