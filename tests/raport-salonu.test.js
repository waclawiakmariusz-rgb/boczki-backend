// tests/raport-salonu.test.js — Raport Salonu w panelu admina (routes/raport-salonu.js, 9.11.2026).
// Sprawdzamy: moduł jest wyłącznie odczytem (brak INSERT/UPDATE/DELETE/ALTER/CREATE w kodzie), tenant = id_bazy,
// autoryzacja tym samym tokenem admina, kształt odpowiedzi na atrapie bazy, czyste funkcje (lista kontrolna,
// podejrzane dane, duble, podsumowanie dziennika, maskowanie), rejestracja w server.js i zakładka w admin.html.
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const modul = require('../routes/raport-salonu');
const F = modul.czysteFunkcje;
const ADMIN_TOKEN = 'tok-admin-123';

function appZ(db) {
  const app = express();
  app.use(express.json());
  app.use('/api', modul(db));
  return app;
}

/** Atrapa bazy: odpowiada na SQL regułami w kolejności; domyślnie pusta lista. Zlicza zapytania i pilnuje, że są tylko SELECT. */
function atrapaBazy(reguly) {
  const zapytania = [];
  const db = {
    query: jest.fn((sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      zapytania.push(String(sql));
      const s = String(sql);
      if (/FROM admin_sessions/i.test(s)) return cb(null, params[0] === ADMIN_TOKEN ? [{ expires: Date.now() + 3600e3 }] : []);
      for (const [re, wynik] of reguly) if (re.test(s)) return typeof wynik === 'function' ? wynik(cb, params, s) : cb(null, wynik);
      return cb(null, []);
    }),
  };
  return { db, zapytania };
}

const SCHEMAT = [
  { t: 'Logi', k: 'tenant_id', d: 'varchar', p: 2 }, { t: 'Logi', k: 'data_zdarzenia', d: 'datetime', p: 3 },
  { t: 'Uslugi', k: 'tenant_id', d: 'varchar', p: 2 }, { t: 'Uslugi', k: 'utworzono_w', d: 'timestamp', p: 7 },
  { t: 'Bez_Tenanta', k: 'kiedy', d: 'datetime', p: 1 },
];

describe('raport-salonu — bezpieczeństwo i kształt', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'raport-salonu.js'), 'utf8');

  test('kod modułu nie zawiera ani jednego zapytania zmieniającego (tylko odczyt)', () => {
    const sqlZmieniajacy = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE)\b/i;
    expect(src).not.toMatch(sqlZmieniajacy);
  });

  test('bez tokenu admina → 403, bez zapytań do danych', async () => {
    const { db, zapytania } = atrapaBazy([]);
    const r = await request(appZ(db)).get('/api/admin/raport-salonu?login=x');
    expect(r.status).toBe(403);
    expect(zapytania.filter(s => !/admin_sessions/i.test(s))).toHaveLength(0);
  });

  test('zły token → 403', async () => {
    const { db } = atrapaBazy([]);
    const r = await request(appZ(db)).get('/api/admin/raport-salonu?login=x').set('x-admin-token', 'zly');
    expect(r.status).toBe(403);
  });

  test('brak parametru login → 400; nieznany salon → 404', async () => {
    const { db } = atrapaBazy([[/FROM Licencje/i, []]]);
    const a = await request(appZ(db)).get('/api/admin/raport-salonu').set('x-admin-token', ADMIN_TOKEN);
    expect(a.status).toBe(400);
    const b = await request(appZ(db)).get('/api/admin/raport-salonu?login=nie-ma').set('x-admin-token', ADMIN_TOKEN);
    expect(b.status).toBe(404);
  });

  test('pełny raport: tenant = id_bazy (nie login), hasło zamaskowane, wszystkie sekcje, tylko tabele z tenant_id, tylko SELECT-y', async () => {
    const lic = { login: 'ambasadaurody51', haslo: 'TAJNE', rola: 'salon', id_bazy: 'ambasada-urody-163160e1', status: 'aktywny', nazwa_salonu: 'Ambasada Urody', data_waznosci: '2026-12-17' };
    const { db, zapytania } = atrapaBazy([
      [/FROM Licencje/i, [lic]],
      [/information_schema\.columns/i, SCHEMAT],
      [/COUNT\(\*\) n, MIN\(data_zdarzenia\)/i, [{ n: 126, od: '2026-10-23 10:06:00', do_: '2026-11-09 09:05:00' }]],
      [/GROUP BY dzien/i, [{ dzien: '2026-11-07', n: 61 }, { dzien: '2026-11-09', n: 18 }]],
      [/GROUP BY akcja/i, [{ akcja: 'NOWY PRODUKT', n: 30 }, { akcja: 'BŁĄD: list', n: 4 }]],
      [/FROM Logi WHERE tenant_id = \? ORDER BY data_zdarzenia DESC/i, [
        { kiedy: '2026-11-09 07:52', pracownik: 'System', akcja: 'BŁĄD: list', modul: 'SYSTEM', opis: 'POST /zadania — Sesja wygasła. Zaloguj się ponownie.' },
        { kiedy: '2026-11-07 17:41', pracownik: 'Anna Małkus', akcja: 'NOWY PRODUKT', modul: 'MAGAZYN: Żel', opis: 'Dodano na stan: 3 szt' },
      ]],
      [/FROM Sesje/i, [{ login: 'ambasadaurody51', created_at: '2026-11-09 07:50:00', expires: '2026-11-09 19:10:00', token: 'NIE-WYCIEKA' }]],
      [/feature_key, enabled/i, [{ feature_key: 'terminarz', enabled: 1, activated_at: '2026-11-07 11:20:00' }]],
      [/SELECT etap, data_wyslania/i, [{ etap: 'salon_1', data_wyslania: '2026-10-19 10:00:00' }]],
      [/SELECT COUNT\(\*\) FROM Pracownicy/i, [{ 'COUNT(*)': 9 }]],
      [/SELECT COUNT\(\*\) FROM Uslugi/i, [{ 'COUNT(*)': 8 }]],
      [/SELECT COUNT\(\*\) FROM Rejestr_RODO/i, [{ 'COUNT(*)': 1 }]],
      [/SELECT COUNT\(\*\) FROM Sprzedaz/i, [{ 'COUNT(*)': 0 }]],
      [/SELECT COUNT\(\*\) FROM Tenant_Features WHERE tenant_id = \? AND feature_key = 'terminarz'/i, [{ 'COUNT(*)': 1 }]],
      [/MAX\(data_sprzedazy\)/i, [{ d: null }]],
      [/MAX\(start\)/i, [{ d: null }]],
      [/SELECT kategoria, wariant, cena FROM Uslugi/i, [{ kategoria: '', wariant: '', cena: null }, { kategoria: 'Omega', wariant: 'Twarz', cena: '320.00' }]],
      [/SELECT kategoria, nazwa, ilosc, jednostka, data_waznosci FROM Raport_Magazyn/i, [
        { kategoria: 'Detal Bioline', nazwa: 'Nectar Vita', ilosc: '2.00', jednostka: 'szt', data_waznosci: '2030-07-30' },
        { kategoria: 'Detal Bioline', nazwa: 'Vita nectar', ilosc: '4.00', jednostka: 'szt', data_waznosci: '1899-11-30' },
      ]],
      [/COUNT\(\*\) n, MAX\(`data_zdarzenia`\) ost FROM `Logi`/i, [{ n: 126, ost: '2026-11-09 09:05:00' }]],
      [/COUNT\(\*\) n, MAX\(`utworzono_w`\) ost FROM `Uslugi`/i, [{ n: 8, ost: '2026-11-09 08:05:00' }]],
    ]);
    const r = await request(appZ(db)).get('/api/admin/raport-salonu?login=ambasadaurody51').set('x-admin-token', ADMIN_TOKEN);
    expect(r.status).toBe(200);
    const d = r.body;
    expect(d.status).toBe('success');
    expect(d.tenant_id).toBe('ambasada-urody-163160e1');
    expect(d.licencja.haslo).toBe('***');
    expect(d.licencja.nazwa_salonu).toBe('Ambasada Urody');
    expect(d.logi.razem).toBe(126);
    expect(d.logi.dni).toEqual([{ dzien: '2026-11-07', n: 61 }, { dzien: '2026-11-09', n: 18 }]);
    expect(d.logi.akcje[0]).toEqual({ akcja: 'NOWY PRODUKT', n: 30 });
    expect(d.logi.ostatnie).toHaveLength(2);
    expect(d.logi.bledy_w_ostatnich).toBe(1);
    expect(d.logi.sesja_wygasla_w_ostatnich).toBe(1);
    expect(d.sesje[0].login).toBe('ambasadaurody51');
    expect(JSON.stringify(d)).not.toContain('NIE-WYCIEKA');
    expect(JSON.stringify(d)).not.toContain('TAJNE');
    expect(d.dodatki[0].feature_key).toBe('terminarz');
    expect(d.maile).toHaveLength(1);
    expect(d.zliczenia.pracownicy).toBe(9);
    expect(d.zliczenia.uslugi).toBe(8);
    const lk = Object.fromEntries(d.lista_kontrolna.map(p => [p.klucz, p]));
    expect(lk.rodo.ok).toBe(true);
    expect(lk.pracownicy.ok).toBe(true);
    expect(lk.uslugi.ok).toBe(true);
    expect(lk.sprzedaz.ok).toBe(false);
    expect(lk.terminarz.ok).toBe(true);
    const typy = d.podejrzane.map(p => p.typ);
    expect(typy).toEqual(expect.arrayContaining(['uslugi_puste', 'magazyn_pro_daty', 'magazyn_pro_duble', 'kosmetyki_w_magazynie_pro']));
    expect(d.tabele.wszystkich).toBe(2); // Bez_Tenanta pominięta
    expect(d.tabele.z_danymi.map(t => t.tabela).sort()).toEqual(['Logi', 'Uslugi']);
    expect(d.tabele.z_danymi.find(t => t.tabela === 'Logi').n).toBe(126);
    // każde zapytanie do danych to SELECT po tenant_id = id_bazy, nigdy po loginie
    const doDanych = zapytania.filter(s => !/admin_sessions|information_schema|FROM Licencje/i.test(s));
    expect(doDanych.length).toBeGreaterThan(20);
    for (const s of doDanych) expect(s.trim()).toMatch(/^SELECT/i);
    const paramy = db.query.mock.calls.filter(c => Array.isArray(c[1]) && c[1].length && /tenant_id = \?/.test(String(c[0]))).map(c => c[1][0]);
    expect(paramy.length).toBeGreaterThan(0);
    expect(new Set(paramy)).toEqual(new Set(['ambasada-urody-163160e1']));
    expect(typeof d.zapytan).toBe('number');
  });

  test('błąd jednej tabeli nie przewraca raportu (tabela trafia do listy błędów)', async () => {
    const lic = { login: 'x', id_bazy: 'x-1' };
    const { db } = atrapaBazy([
      [/FROM Licencje/i, [lic]],
      [/information_schema\.columns/i, [{ t: 'Zepsuta', k: 'tenant_id', d: 'varchar', p: 1 }, { t: 'Dobra', k: 'tenant_id', d: 'varchar', p: 1 }]],
      [/FROM `Zepsuta`/i, (cb) => cb(Object.assign(new Error('boom'), { code: 'ER_NO_SUCH_TABLE' }))],
      [/FROM `Dobra`/i, [{ n: 3 }]],
    ]);
    const r = await request(appZ(db)).get('/api/admin/raport-salonu?login=x').set('x-admin-token', ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.tabele.bledy).toEqual([{ tabela: 'Zepsuta', blad: 'ER_NO_SUCH_TABLE' }]);
    expect(r.body.tabele.z_danymi).toEqual([{ tabela: 'Dobra', n: 3, ostatnia: null, wg: null }]);
  });

  test('salon bez id_bazy → tenant = login (stare licencje)', async () => {
    const { db } = atrapaBazy([[/FROM Licencje/i, [{ login: 'stary-salon', id_bazy: null }]], [/information_schema/i, []]]);
    const r = await request(appZ(db)).get('/api/admin/raport-salonu?login=stary-salon').set('x-admin-token', ADMIN_TOKEN);
    expect(r.body.tenant_id).toBe('stary-salon');
  });
});

describe('raport-salonu — czyste funkcje', () => {
  test('normalizujNazwe: małe litery, bez interpunkcji i wielokrotnych spacji', () => {
    expect(F.normalizujNazwe('  Krem  De-Ox   oko ')).toBe('krem de ox oko');
    expect(F.normalizujNazwe(null)).toBe('');
  });

  test('maskujSekrety: hasła, tokeny, PIN-y → ***, reszta bez zmian', () => {
    expect(F.maskujSekrety({ login: 'a', haslo: 'x', stripe_token: 'y', haslo_pin: '1234', miasto: 'Siedlce' }))
      .toEqual({ login: 'a', haslo: '***', stripe_token: '***', haslo_pin: '***', miasto: 'Siedlce' });
  });

  test('podsumujLogi: per dzień, per akcja, błędy i „Sesja wygasła”', () => {
    const p = F.podsumujLogi([
      { data_zdarzenia: '2026-11-09 07:52:00', akcja: 'BŁĄD: list', opis: 'Sesja wygasła. Zaloguj się ponownie.' },
      { data_zdarzenia: '2026-11-09 08:00:00', akcja: 'BŁĄD: rap_saveProduct', opis: 'Produkt już istnieje' },
      { data_zdarzenia: '2026-11-07 17:00:00', akcja: 'NOWY PRODUKT', opis: '' },
      { data_zdarzenia: '2026-11-07 17:01:00', akcja: 'NOWY PRODUKT', opis: '' },
    ], 3);
    expect(p.dni).toEqual([{ dzien: '2026-11-07', n: 2 }, { dzien: '2026-11-09', n: 2 }]);
    expect(p.akcje[0]).toEqual({ akcja: 'NOWY PRODUKT', n: 2 });
    expect(p.bledy).toBe(2);
    expect(p.sesja_wygasla).toBe(1);
    expect(p.ostatnie).toHaveLength(3);
  });

  test('listaKontrolna: pusty salon ma wszystko ✗, zespół liczy się dopiero od 2 osób', () => {
    const pusty = F.listaKontrolna({});
    expect(pusty.length).toBe(12);
    expect(pusty.every(p => p.ok === false)).toBe(true);
    const z = Object.fromEntries(F.listaKontrolna({ pracownicy: 1, uzytkownicy: 1, uslugi: 3, terminarz_feature: 1 }).map(p => [p.klucz, p]));
    expect(z.pracownicy.ok).toBe(false);
    expect(z.uslugi.ok).toBe(true);
    expect(z.terminarz.ok).toBe(true);
    expect(z.terminarz.szczegol).toBe('dodatek włączony, bez ustawień');
  });

  test('wykryjPodejrzane: puste usługi, zepsute daty, duble z przestawionymi słowami, kosmetyki w magazynie pro, nic przy czystych danych', () => {
    const w = F.wykryjPodejrzane({
      uslugi: [{ kategoria: '', wariant: '', cena: null }, { kategoria: 'Omega', wariant: 'Twarz', cena: '320' }, { kategoria: 'omega ', wariant: 'twarz', cena: '320' }],
      raport_magazyn: [
        { kategoria: 'Detal Bioline', nazwa: 'Nectar Vita', ilosc: 2, data_waznosci: '2030-07-30' },
        { kategoria: 'Detal Bioline', nazwa: 'Vita nectar', ilosc: 4, data_waznosci: '1899-11-30' },
        { kategoria: 'Chemia', nazwa: 'Płyn', ilosc: -1, data_waznosci: null },
      ],
      magazyn: [{ nazwa_produktu: 'X', ilosc: 1, data_waznosci: '2101-01-01' }],
      slownik: [{ firma: 'D', model: 'Hydra tonik', cena_detal: '140' }, { firma: 'D', model: 'Tonik Hydra', cena_detal: null }],
      pracownicy: [{ imie: 'Ola' }, { imie: 'ola' }],
    });
    const m = Object.fromEntries(w.map(x => [x.typ, x]));
    expect(m.uslugi_puste.ile).toBe(1);
    expect(m.uslugi_duble.ile).toBe(1);
    expect(m.magazyn_pro_daty.przyklady).toEqual(['Vita nectar — 1899-11-30']);
    expect(m.magazyn_pro_ujemne.ile).toBe(1);
    expect(m.magazyn_pro_duble.przyklady[0]).toContain('Nectar Vita');
    expect(m.kosmetyki_w_magazynie_pro.ile).toBe(2);
    expect(m.kosmetyki_daty.ile).toBe(1);
    expect(m.slownik_duble.ile).toBe(1);
    expect(m.slownik_bez_ceny.ile).toBe(1);
    expect(m.pracownicy_duble.ile).toBe(1);
    expect(F.wykryjPodejrzane({ uslugi: [{ kategoria: 'A', wariant: 'B', cena: '1' }], raport_magazyn: [], magazyn: [], slownik: [], pracownicy: [{ imie: 'Ola' }] })).toEqual([]);
  });

  test('poKilka: zachowuje kolejność wyników i nie przekracza limitu współbieżności', async () => {
    let naraz = 0, max = 0;
    const zad = [5, 1, 3, 2, 4].map(ms => async () => { naraz++; max = Math.max(max, naraz); await new Promise(r => setTimeout(r, ms)); naraz--; return ms; });
    expect(await F.poKilka(zad, 2)).toEqual([5, 1, 3, 2, 4]);
    expect(max).toBeLessThanOrEqual(2);
  });
});

describe('raport-salonu — rejestracja i panel', () => {
  test('server.js montuje router pod /api', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(s).toMatch(/require\('\.\/routes\/raport-salonu'\)\(db\)/);
    expect(s).toMatch(/app\.use\('\/api', raportSalonuRoutes\)/);
  });

  test('admin.html ma zakładkę, opis, panel i funkcje rs_*; wywołanie idzie z tokenem admina', () => {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
    expect(h).toContain('data-tab="tab-raport-salonu"');
    expect(h).toContain("'tab-raport-salonu': ['Raport salonu'");
    expect(h).toContain('id="tab-raport-salonu"');
    for (const f of ['rs_init', 'rs_generuj', 'rs_render', 'rs_kopiuj', 'rs_filtruj']) expect(h).toContain(`function ${f}(`);
    expect(h).toMatch(/admin\/raport-salonu\?login=\$\{encodeURIComponent\(login\)\}`, \{ headers: \{ 'X-Admin-Token': adminToken \} \}/);
  });
});
