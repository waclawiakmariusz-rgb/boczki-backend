// tests/terminarz-audyt-d.test.js — paczka D audytu terminarza (10.11.2026): front i świeżość konfiguracji.
// #10 odcisk konfiguracji w odpowiedzi serwera + dociąganie danych przez przeglądarkę; #11 blokada podwójnego
// kliknięcia (rezerwacja techniczna, nowy zasób); #12 ostrzeżenie o terminie w przeszłości; #21 błąd serwera
// odróżniony od braku sieci i pokazany w wyszukiwarkach; #22 format daty szkicu; #23 szkic w sessionStorage.
const fs = require('fs');
const path = require('path');
const request = require('supertest'); const express = require('express');

const T = 'salon-test-001';
const M = require('../routes/terminarz');
// pliki w repo bywają zapisane z CRLF — porównania na wzorcach wielolinijkowych wymagają normalizacji
const bezCR = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const F = bezCR(path.join(__dirname, '..', 'public', 'terminarz.js'));
const S = bezCR(path.join(__dirname, '..', 'routes', 'terminarz.js'));

describe('#10 odcisk konfiguracji (serwer)', () => {
  function atrapa(nadpisz = {}) {
    const dane = {
      prac: [{ imie: 'Anna' }, { imie: 'Ola' }],
      ust: [{ tenant_id: T, tryb: 'wewnetrzny', siatka_min: 15, tolerancja_min: 10, horyzont_dni: 90, wyprzedzenie_min: 120, godziny_json: '{"1":[{"od":"09:00","do":"17:00"}]}', wersja: 1 }],
      graf: [{ id: 1, pracownik: 'Anna', dzien_tyg: 1, od: '09:00:00', do: '17:00:00', od_daty: null, do_daty: null }],
      zas: [{ id: 1, typ: 'gabinet', nazwa: 'G1', pojemnosc: 1, aktywny: 1, kolejnosc: 0, zarchiwizowano: null }],
      uslugi: [{ id: 'U1', kategoria: 'Omega', wariant: 'Twarz', cena: 300, czas_min: 60, aktywna: 1 }],
      ...nadpisz,
    };
    const odpowiedzi = [
      [/SELECT rola FROM Użytkownicy/, [{ rola: 'manager' }]],
      [/FROM Pracownicy p LEFT JOIN Term_Pracownicy/, dane.prac],
      [/FROM Term_Ustawienia/, dane.ust],
      [/FROM Term_Grafik/, dane.graf],
      [/FROM Term_Zasoby/, dane.zas],
      [/FROM Uslugi u LEFT JOIN Term_Uslugi|FROM Uslugi/, dane.uslugi],
      [/SELECT DATE_FORMAT\(NOW\(\)/, [{ t: '2026-11-10 12:00:00' }]],
      [/FROM Term_Nieobecnosci/, []], [/FROM Term_Zajecia/, []], [/FROM Term_Rezerwacje/, []],
      [/IS_FREE_LOCK/, [{ w: 1 }]], [/GET_LOCK/, [{ l: 1 }]], [/RELEASE_LOCK/, [{ r: 1 }]],
    ];
    const query = (sql, p, cb) => {
      const c = typeof p === 'function' ? p : cb;
      for (const [re, w] of odpowiedzi) if (re.test(String(sql))) return c && c(null, w);
      return c && c(null, []);
    };
    const conn = { query, beginTransaction: (cb) => cb(null), commit: (cb) => cb(null), rollback: (cb) => cb(null), release: () => {} };
    return { query, getConnection: (cb) => cb(null, conn) };
  }
  const dzien = (db) => request((() => { const a = express(); a.use(express.json()); a.use('/api', M(db, { hasFeature: (t, k, cb) => cb(true) })); return a; })())
    .post('/api/terminarz').send({ tenant_id: T, pracownik: 'Ola', action: 'trm_dzien', data: '2026-11-10' });

  test('odpowiedź dnia niesie odcisk konfiguracji', async () => {
    const { body } = await dzien(atrapa());
    expect(body.status).toBe('success');
    expect(body.cfg_odcisk).toMatch(/^[0-9a-f]{12}$/);
  });
  test('ta sama konfiguracja → ten sam odcisk; zmiana zespołu, usługi albo grafiku → inny', async () => {
    const a = (await dzien(atrapa())).body.cfg_odcisk;
    expect((await dzien(atrapa())).body.cfg_odcisk).toBe(a);
    const bezOli = (await dzien(atrapa({ prac: [{ imie: 'Anna' }] }))).body.cfg_odcisk;
    expect(bezOli).not.toBe(a);
    const innyCzas = (await dzien(atrapa({ uslugi: [{ id: 'U1', kategoria: 'Omega', wariant: 'Twarz', cena: 300, czas_min: 90, aktywna: 1 }] }))).body.cfg_odcisk;
    expect(innyCzas).not.toBe(a);
    const innyGrafik = (await dzien(atrapa({ graf: [{ id: 1, pracownik: 'Anna', dzien_tyg: 1, od: '08:00:00', do: '17:00:00', od_daty: null, do_daty: null }] }))).body.cfg_odcisk;
    expect(innyGrafik).not.toBe(a);
  });
  test('trm_dzien i trm_init zwracają odcisk z tej samej funkcji', () => {
    expect(S).toContain('function odciskCfg(cfg)');
    expect(S).toMatch(/teraz: cfg\.terazStr, cfg_odcisk: odciskCfg\(cfg\), rezerwacje: lista/);
    expect(S).toMatch(/teraz: cfg\.terazStr, cfg_odcisk: odciskCfg\(cfg\), schemat/);
  });
});

describe('front terminarza — paczka D', () => {
  test('#10 przeglądarka porównuje odcisk i dociąga dane po zmianie na innym stanowisku', () => {
    expect(F).toContain('async function sprawdzOdciskCfg(d)');
    expect(F).toContain('if (await sprawdzOdciskCfg(d)) { if (req !== odswiezReq) return; renderFiltry(d); }');
    expect(F).toContain("toast('info', 'Ustawienia salonu się zmieniły'");
    expect(F).toContain('TRM.cfgOdcisk = d.cfg_odcisk || null;');
  });
  test('#11 rezerwacja techniczna i nowy zasób: drugie kliknięcie nic nie robi, przycisk zablokowany', () => {
    expect(F).toContain("const b = TRM.blok; if (!b || b._zapis) return;");
    expect(F).toContain("b._zapis = true; const btnB = el('trm-blok-zapisz'); if (btnB) { btnB.disabled = true; btnB.textContent = 'Zapisujemy…'; }");
    expect(F).toContain('b._zapis = false;');
    expect(F).toContain('id="trm-blok-zapisz"');
    expect(F).toContain("if (TRM._zasobZapis) return; TRM._zasobZapis = true;");
    expect(F).toContain('id="trm-zs-dodaj-btn"');
  });
  test('#12 termin w przeszłości daje widoczne ostrzeżenie w karcie wyniku', () => {
    expect(F).toContain('<b>Termin w przeszłości.</b>');
    expect(F).toContain("n.godzina && TRM.dzien && TRM.dzien.teraz && n.start.slice(0, 16) < String(TRM.dzien.teraz).slice(0, 16)");
  });
  test('#21 błąd serwera nie udaje braku sieci; wyszukiwarki pokazują powód', () => {
    expect(F).not.toContain("message: 'Brak połączenia. Zapis będzie możliwy po odzyskaniu połączenia.'");
    expect(F).toContain('Brak połączenia z internetem. Sprawdź sieć');
    expect(F).toContain('Serwer odpowiedział błędem (kod ${r.status})');
    expect(F).toContain("toast('error', 'Nie udało się wyszukać klientki', d.message)");
    expect((F.match(/Nie udało się wyszukać klientki/g) || []).length).toBe(2); // formularz wizyty + historia
  });
  test('#22 szkic przeciągnięty na siatce ustawia datę w formacie ze spacją', () => {
    expect(F).not.toMatch(/n\.start = `\$\{TRM\.data\}T\$\{pad\(/);
    expect(F).toMatch(/n\.start = `\$\{TRM\.data\} \$\{pad\(Math\.floor\(d\.cel\.m \/ 60\)\)\}/);
  });
  test('#23 szkic wizyty w sessionStorage: zapis przy zmianie, pasek przywracania, czyszczenie po zapisie i zamknięciu', () => {
    expect(F).toContain("const SZKIC_KLUCZ = 'trm_szkic_wizyty';");
    expect(F).toContain('function zapiszSzkic()');
    expect(F).toContain('TRM.nowaZmiana = (natychmiast) => {\n    zapiszSzkic();');
    expect(F).toContain('TRM.szkicPrzywroc');
    expect(F).toContain('TRM.szkicOdrzuc');
    expect(F).toContain('${paskiSzkicu()}');
    expect(F).toContain('TRM.nowa = null; TRM.panel = null; czyscSzkic();');
    expect(F).toContain('TRM.panelZamknij = () => { czyscSzkic();');
    expect(F).toContain('SZKIC_WAZNY_MS = 30 * 60 * 1000');
  });
});
