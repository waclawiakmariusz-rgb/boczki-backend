'use strict';
// routes/preferencje.js — preferencje klientki widoczne „jednym rzutem oka" (19.10.2026).
//
// Po co: recepcja ma wiedzieć bez czytania ściany tekstu, że klientka pije kawę z mlekiem,
// woli ciepło i nie lubi rozmowy przy zabiegu. Memo (wolny tekst) i ostrzeżenie (problem)
// zostają tym, czym są — to jest czwarta, osobna kategoria: krótkie, stałe, powtarzalne.
//
// Model: słownik per salon (gotowa lista startowa + własne pozycje) i wartości per klientka.
//   Preferencje_Slownik(tenant_id, klucz, nazwa, ikona, typ, opcje_json, dla_zabiegu, aktywna, kolejnosc)
//   Klienci_Preferencje(tenant_id, id_klienta, klucz, wartosc, kto, kiedy)
// Jedna wartość na klucz i klientkę (UNIQUE) — „kawa z mlekiem” zastępuje „herbatę”, nie dokłada się.
//
// Uprawnienia: czytają wszyscy zalogowani; zapisuje recepcja/manager/właściciel. Specjalista
// (kosmetolog) dostaje wyłącznie preferencje oznaczone `dla_zabiegu` — temperatura, cisza,
// zapachy — czyli to, co potrzebne przy pracy, bez reszty profilu klientki.
//
// RODO: to są preferencje komfortu. Alergie, choroby i leki NIE są tu zapisywane — ich miejsce
// jest w konsultacji i dokumentach klientki. Walidacja tego nie wymusi, więc mówi o tym
// podpowiedź w interfejsie i przewodnik.

const express = require('express');
const { makeZapiszLog } = require('./logi');

const ROLE_OPERACYJNE = new Set(['recepcja', 'manager', 'admin', 'megaadmin']);
const ROLE_MANAGER = new Set(['manager', 'admin', 'megaadmin']);
const ROLE_SPECJALISTA = new Set(['kosmetolog', 'pracownik']);

// Lista startowa — zakładana przy pierwszym wejściu w moduł, każdy salon może ją zmienić.
// `dla_zabiegu` = czy ma to znaczenie dla osoby wykonującej zabieg (ona widzi tylko te).
const DOMYSLNE = [
  { klucz: 'napoj',       nazwa: 'Napój',            ikona: '☕', opcje: ['Kawa czarna', 'Kawa z mlekiem', 'Herbata czarna', 'Herbata zielona', 'Woda', 'Dziękuję, nic'], dla_zabiegu: 0 },
  { klucz: 'temperatura', nazwa: 'Temperatura',      ikona: '🌡️', opcje: ['Woli ciepło', 'Woli chłód', 'Prosi o koc'], dla_zabiegu: 1 },
  { klucz: 'rozmowa',     nazwa: 'Rozmowa',          ikona: '💬', opcje: ['Lubi pogawędkę', 'Woli ciszę'], dla_zabiegu: 1 },
  { klucz: 'muzyka',      nazwa: 'Muzyka',           ikona: '🎵', opcje: ['Relaksacyjna', 'Ciszej', 'Bez muzyki'], dla_zabiegu: 1 },
  { klucz: 'zapachy',     nazwa: 'Zapachy',          ikona: '🌿', opcje: ['Bez zapachowych olejków', 'Lubi lawendę', 'Lubi cytrusy'], dla_zabiegu: 1 },
  { klucz: 'pora',        nazwa: 'Pora wizyty',      ikona: '⏰', opcje: ['Rano', 'Popołudnie', 'Po 17:00', 'Weekend'], dla_zabiegu: 0 },
  { klucz: 'osoba',       nazwa: 'Ulubiona osoba',   ikona: '👤', typ: 'tekst', dla_zabiegu: 0 },
  { klucz: 'kontakt',     nazwa: 'Kontakt',          ikona: '📱', opcje: ['SMS', 'Telefon', 'WhatsApp', 'E-mail'], dla_zabiegu: 0 },
  { klucz: 'dojazd',      nazwa: 'Dojazd',           ikona: '🚗', opcje: ['Pyta o parking', 'Przyjeżdża komunikacją'], dla_zabiegu: 0 },
  { klucz: 'towarzystwo', nazwa: 'Towarzystwo',      ikona: '👶', opcje: ['Bywa z dzieckiem', 'Przychodzi z koleżanką'], dla_zabiegu: 0 },
  { klucz: 'uwagi',       nazwa: 'Inne',             ikona: '✏️', typ: 'tekst', dla_zabiegu: 1 },
];

class BladUzytkownika extends Error { constructor(msg) { super(msg); this.uzytkownika = true; } }

module.exports = (db, opts = {}) => {
  const router = express.Router();
  const log = opts.log || console;
  const zapiszLog = makeZapiszLog(db);
  const getSession = opts.getSession || require('./sessions').getSession;

  const q = (sql, params) => new Promise((res, rej) => db.query(sql, params || [], (e, r) => (e ? rej(e) : res(r))));

  let schemat = false;
  async function sprawdzSchemat() {
    try {
      await q(`CREATE TABLE IF NOT EXISTS Preferencje_Slownik (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        klucz VARCHAR(50) NOT NULL,
        nazwa VARCHAR(80) NOT NULL,
        ikona VARCHAR(20) DEFAULT '',
        typ VARCHAR(10) NOT NULL DEFAULT 'wybor',
        opcje_json TEXT NULL,
        dla_zabiegu TINYINT(1) NOT NULL DEFAULT 0,
        aktywna TINYINT(1) NOT NULL DEFAULT 1,
        kolejnosc INT NOT NULL DEFAULT 0,
        utworzono TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_pref_slownik (tenant_id, klucz)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await q(`CREATE TABLE IF NOT EXISTS Klienci_Preferencje (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        id_klienta VARCHAR(50) NOT NULL,
        klucz VARCHAR(50) NOT NULL,
        wartosc VARCHAR(120) NOT NULL,
        kto VARCHAR(100) NULL,
        kiedy TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_pref_klient (tenant_id, id_klienta, klucz),
        KEY idx_pref_klient (tenant_id, id_klienta)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      schemat = true;
    } catch (e) { log.error('[preferencje] schemat:', e.message); schemat = false; }
    return schemat;
  }
  sprawdzSchemat();

  async function rola(tenant, imie) {
    if (!imie) return null;
    const rows = await q(`SELECT rola FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`, [tenant, imie]);
    return rows.length ? String(rows[0].rola || '').toLowerCase().trim() : null;
  }

  /** Słownik salonu; przy pierwszym wejściu zakłada listę startową (raz na salon). */
  async function slownik(tenant) {
    let rows = await q(`SELECT klucz, nazwa, ikona, typ, opcje_json, dla_zabiegu, aktywna, kolejnosc FROM Preferencje_Slownik WHERE tenant_id = ? ORDER BY kolejnosc, id`, [tenant]);
    if (!rows.length) {
      for (let i = 0; i < DOMYSLNE.length; i++) {
        const d = DOMYSLNE[i];
        await q(`INSERT IGNORE INTO Preferencje_Slownik (tenant_id, klucz, nazwa, ikona, typ, opcje_json, dla_zabiegu, kolejnosc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [tenant, d.klucz, d.nazwa, d.ikona, d.typ || 'wybor', d.opcje ? JSON.stringify(d.opcje) : null, d.dla_zabiegu, (i + 1) * 10]);
      }
      rows = await q(`SELECT klucz, nazwa, ikona, typ, opcje_json, dla_zabiegu, aktywna, kolejnosc FROM Preferencje_Slownik WHERE tenant_id = ? ORDER BY kolejnosc, id`, [tenant]);
    }
    return rows.map(r => ({
      klucz: r.klucz, nazwa: r.nazwa, ikona: r.ikona || '', typ: r.typ || 'wybor',
      opcje: (() => { try { return JSON.parse(r.opcje_json || '[]'); } catch (e) { return []; } })(),
      dla_zabiegu: !!r.dla_zabiegu, aktywna: !!r.aktywna, kolejnosc: r.kolejnosc,
    }));
  }

  /** Preferencje wskazanych klientek, złożone ze słownikiem i w jego kolejności. */
  async function dlaKlientow(tenant, idy, tylkoZabiegowe) {
    const lista = [...new Set((idy || []).map(x => String(x || '').trim()).filter(Boolean))].slice(0, 200);
    if (!lista.length) return {};
    const sl = await slownik(tenant);
    const wg = new Map(sl.filter(s => s.aktywna).map(s => [s.klucz, s]));
    const rows = await q(
      `SELECT id_klienta, klucz, wartosc FROM Klienci_Preferencje WHERE tenant_id = ? AND id_klienta IN (${lista.map(() => '?').join(',')})`,
      [tenant, ...lista]);
    const wynik = {};
    for (const r of rows) {
      const def = wg.get(r.klucz);
      if (!def) continue;                                   // pozycja skasowana ze słownika — nie pokazujemy
      if (tylkoZabiegowe && !def.dla_zabiegu) continue;     // specjalista widzi tylko to, co dotyczy zabiegu
      (wynik[r.id_klienta] = wynik[r.id_klienta] || []).push({ klucz: r.klucz, nazwa: def.nazwa, ikona: def.ikona, wartosc: r.wartosc, kolejnosc: def.kolejnosc });
    }
    for (const id of Object.keys(wynik)) wynik[id].sort((a, b) => a.kolejnosc - b.kolejnosc);
    return wynik;
  }

  async function obsluz(action, d, tenant, imie, r) {
    if (!schemat && !(await sprawdzSchemat())) throw new BladUzytkownika('Preferencje chwilowo niedostępne — schemat bazy niekompletny.');
    const specjalista = ROLE_SPECJALISTA.has(r);

    switch (action) {
      // ── odczyty ──────────────────────────────────────────────────────────────────────
      case 'pref_slownik':
        return { status: 'success', slownik: (await slownik(tenant)).filter(s => s.aktywna || ROLE_MANAGER.has(r)) };

      case 'pref_klientki': {
        const id = String(d.id_klienta || '').trim();
        if (!id) throw new BladUzytkownika('Wskaż klientkę.');
        const mapa = await dlaKlientow(tenant, [id], specjalista);
        return { status: 'success', id_klienta: id, preferencje: mapa[id] || [], mozna_edytowac: ROLE_OPERACYJNE.has(r) };
      }

      case 'pref_wielu': {
        const idy = Array.isArray(d.id_klientow) ? d.id_klientow : [];
        return { status: 'success', preferencje: await dlaKlientow(tenant, idy, specjalista) };
      }

      // ── zapis wartości (recepcja, manager) ───────────────────────────────────────────
      case 'pref_zapisz': {
        if (!ROLE_OPERACYJNE.has(r)) throw new BladUzytkownika('Preferencje zmienia recepcja albo manager.');
        const id = String(d.id_klienta || '').trim();
        const klucz = String(d.klucz || '').trim().slice(0, 50);
        if (!id || !klucz) throw new BladUzytkownika('Wskaż klientkę i rodzaj preferencji.');
        const sl = await slownik(tenant);
        const def = sl.find(s => s.klucz === klucz && s.aktywna);
        if (!def) throw new BladUzytkownika('Nie znamy takiej preferencji.');
        const wartosc = String(d.wartosc == null ? '' : d.wartosc).trim().slice(0, 120);
        const klient = (await q(`SELECT imie_nazwisko FROM Klienci WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`, [tenant, id]))[0];
        if (!klient) throw new BladUzytkownika('Nie znaleziono klientki w kartotece.');
        if (!wartosc) {
          await q(`DELETE FROM Klienci_Preferencje WHERE tenant_id = ? AND id_klienta = ? AND klucz = ?`, [tenant, id, klucz]);
          zapiszLog(tenant, 'PREFERENCJE', imie, `${klient.imie_nazwisko} (${id}): usunięto „${def.nazwa}”`);
        } else {
          // lista wyboru pilnuje swoich opcji; „Inne” i „Ulubiona osoba” są polami tekstowymi
          if (def.typ === 'wybor' && def.opcje.length && !def.opcje.includes(wartosc)) throw new BladUzytkownika(`„${wartosc}” nie jest jedną z opcji dla „${def.nazwa}”.`);
          await q(`INSERT INTO Klienci_Preferencje (tenant_id, id_klienta, klucz, wartosc, kto) VALUES (?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE wartosc = VALUES(wartosc), kto = VALUES(kto)`, [tenant, id, klucz, wartosc, imie || null]);
          zapiszLog(tenant, 'PREFERENCJE', imie, `${klient.imie_nazwisko} (${id}): ${def.nazwa} = ${wartosc}`);
        }
        const mapa = await dlaKlientow(tenant, [id], false);
        return { status: 'success', id_klienta: id, preferencje: mapa[id] || [] };
      }

      // ── słownik salonu (manager) ─────────────────────────────────────────────────────
      case 'pref_slownik_zapisz': {
        if (!ROLE_MANAGER.has(r)) throw new BladUzytkownika('Listę preferencji układa manager albo właściciel.');
        const klucz = String(d.klucz || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 50);
        const nazwa = String(d.nazwa || '').trim().slice(0, 80);
        if (!klucz || !nazwa) throw new BladUzytkownika('Podaj nazwę preferencji.');
        const typ = d.typ === 'tekst' ? 'tekst' : 'wybor';
        const opcje = Array.isArray(d.opcje) ? d.opcje.map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 20) : [];
        if (typ === 'wybor' && !opcje.length) throw new BladUzytkownika('Lista wyboru potrzebuje przynajmniej jednej opcji.');
        const istnieje = (await q(`SELECT kolejnosc FROM Preferencje_Slownik WHERE tenant_id = ? AND klucz = ?`, [tenant, klucz]))[0];
        const kolejnosc = d.kolejnosc != null ? Number(d.kolejnosc) : (istnieje ? istnieje.kolejnosc : ((await q(`SELECT COALESCE(MAX(kolejnosc), 0) + 10 AS k FROM Preferencje_Slownik WHERE tenant_id = ?`, [tenant]))[0].k));
        await q(`INSERT INTO Preferencje_Slownik (tenant_id, klucz, nazwa, ikona, typ, opcje_json, dla_zabiegu, aktywna, kolejnosc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE nazwa = VALUES(nazwa), ikona = VALUES(ikona), typ = VALUES(typ), opcje_json = VALUES(opcje_json),
                                         dla_zabiegu = VALUES(dla_zabiegu), aktywna = VALUES(aktywna), kolejnosc = VALUES(kolejnosc)`,
          [tenant, klucz, nazwa, String(d.ikona || '').slice(0, 20), typ, typ === 'wybor' ? JSON.stringify(opcje) : null,
            d.dla_zabiegu ? 1 : 0, d.aktywna === false ? 0 : 1, kolejnosc]);
        zapiszLog(tenant, 'PREFERENCJE: SŁOWNIK', imie, `${istnieje ? 'zmiana' : 'nowa pozycja'}: ${nazwa}${d.aktywna === false ? ' (ukryta)' : ''}`);
        return { status: 'success', slownik: await slownik(tenant) };
      }

      default:
        return { status: 'error', message: 'Nieznana akcja preferencji: ' + action };
    }
  }

  router.post('/preferencje', async (req, res) => {
    const d = req.body || {};
    const tenant = d.tenant_id, action = d.action, imie = d.pracownik ? String(d.pracownik).trim() : '';
    if (!tenant) return res.json({ status: 'error', message: 'Brak tenant_id' });
    try {
      // Tożsamość liczy się z sesji PIN, nie z pola w żądaniu (ten sam wzorzec co w terminarzu).
      const sesja = getSession(req.headers['x-session-token']);
      if (sesja && String(sesja.tenant_id) === String(tenant) && sesja.login) {
        const osobaSesji = String(sesja.login).trim();
        const rolaSesji = await rola(tenant, osobaSesji);
        if (rolaSesji !== null && imie && osobaSesji !== imie) {
          log.warn(`[preferencje] tożsamość: sesja=${osobaSesji} żądanie=${imie} tenant=${tenant}`);
          return res.json({ status: 'error', code: 'TOZSAMOSC', message: 'Żądanie podaje inną osobę niż zalogowana PIN-em. Zaloguj się ponownie.' });
        }
      }
      const r = await rola(tenant, imie);
      return res.json(await obsluz(action, d, tenant, imie, r));
    } catch (e) {
      if (e && e.uzytkownika) return res.json({ status: 'error', message: e.message });
      log.error('[preferencje]', action, e && e.message);
      return res.json({ status: 'error', message: 'Błąd serwera przy preferencjach.' });
    }
  });

  router.sprawdzSchemat = sprawdzSchemat; // do prób kontraktu
  return router;
};
module.exports.DOMYSLNE = DOMYSLNE;
