// ═══════════════════════════════════════════════════════════════════════════
//  TERMINARZ — dodatek Estelio+ (0 zł). Etap A: terminarz wewnętrzny.
//  Spec: design/terminarz 2.0/Estelio_Terminarz_Specyfikacja_dla_Claude_Code.md
//
//  Zasady bezpieczeństwa (reguła „nic nie może się zepsuć po cichu”):
//   • ZERO zmian w istniejących tabelach — tylko własne Term_* (CREATE IF NOT EXISTS),
//   • żadnej drugiej kartoteki, kasy ani portfela: klient = Klienci, usługa = Uslugi,
//     wykonawca = Pracownicy.imie, rozliczenie = istniejąca multisprzedaż (most E11),
//   • każdy zapis rezerwacji w transakcji pod blokadą salonu GET_LOCK — wygrywa
//     pierwszy poprawnie utrwalony komplet, nie pierwszy klik (R09, R10, 15),
//   • klucz idempotencji: ponowienie tej samej akcji zwraca tę samą wizytę (T073, T078),
//   • wersja wizyty: zmiana ze starą wersją = konflikt, nigdy nadpisanie po cichu (T079).
//  Czas: DATETIME w czasie lokalnym salonu jako łańcuchy (nigdy obiekty Date — mysql2
//  serializuje je w UTC procesu), NOW() tylko w SQL (konwencja repo).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const crypto = require('crypto');
const { makeZapiszLog } = require('./logi');
const S = require('./terminarz-silnik');

const FEATURE_KEY = 'terminarz';
const ROLE_MANAGER_PLUS = new Set(['manager', 'admin', 'megaadmin']);
const ROLE_OPERACYJNE = new Set(['recepcja', 'manager', 'admin', 'megaadmin']);
const ROLE_SPECJALISTA = new Set(['kosmetolog', 'pracownik']);
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_DT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const RE_HHMM = /^\d{2}:\d{2}$/;
const DOMYSLNE_GODZINY = { 1: [{ od: '09:00', do: '17:00' }], 2: [{ od: '09:00', do: '17:00' }], 3: [{ od: '09:00', do: '17:00' }], 4: [{ od: '09:00', do: '17:00' }], 5: [{ od: '09:00', do: '17:00' }], 6: [{ od: '09:00', do: '14:00' }], 7: [] };
const STANY_REZ = ['szkic', 'hold', 'do_zatwierdzenia', 'do_wplaty', 'potwierdzona', 'anulowana', 'odrzucona', 'wygasla'];
const OBECNOSCI = ['oczekiwana', 'przybyl', 'spozniony', 'nieobecny'];
const STANY_POZ = ['zaplanowana', 'w_trakcie', 'wykonana', 'przerwana', 'anulowana', 'niewykonana', 'odmowa'];
const KANALY = ['recepcja', 'telefon', 'wiadomosc', 'online', 'klub', 'import', 'kampania'];

class BladUzytkownika extends Error { constructor(msg, extra) { super(msg); this.extra = extra || {}; this.uzytkownika = true; } }

module.exports = (db, opts = {}) => {
  const router = express.Router();
  const log = opts.log || console;
  const zapiszLog = makeZapiszLog(db);
  const hasFeature = opts.hasFeature || require('./features').makeHasFeature(db);
  const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (e, r) => (e ? reject(e) : resolve(r))));
  const polacz = () => new Promise((resolve, reject) => db.getConnection((err, conn) => (err ? reject(err) : resolve(conn))));
  const qc = (conn, sql, params = []) => new Promise((resolve, reject) => conn.query(sql, params, (e, r) => (e ? reject(e) : resolve(r))));
  const begin = (conn) => new Promise((resolve, reject) => conn.beginTransaction((e) => (e ? reject(e) : resolve())));
  const commit = (conn) => new Promise((resolve, reject) => conn.commit((e) => (e ? reject(e) : resolve())));
  const rollback = (conn) => new Promise((resolve) => conn.rollback(() => resolve()));
  const KOL = ' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
  const mk = (sql, nazwa) => db.query(sql, (e) => { if (e) log.error(`[terminarz] CREATE ${nazwa}:`, e.message); });

  // ── tabele własne (idempotentnie, przy ładowaniu modułu) ─────────────────────
  mk(`CREATE TABLE IF NOT EXISTS Term_Ustawienia (
      tenant_id VARCHAR(100) NOT NULL PRIMARY KEY,
      tryb VARCHAR(20) NOT NULL DEFAULT 'wewnetrzny',
      siatka_min INT NOT NULL DEFAULT 15,
      tolerancja_min INT NOT NULL DEFAULT 10,
      horyzont_dni INT NOT NULL DEFAULT 90,
      wyprzedzenie_min INT NOT NULL DEFAULT 120,
      godziny_json TEXT NULL,
      wersja INT NOT NULL DEFAULT 1,
      utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      zmieniono DATETIME NULL
    )${KOL}`, 'Term_Ustawienia');
  mk(`CREATE TABLE IF NOT EXISTS Term_Zasoby (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      typ VARCHAR(20) NOT NULL,
      nazwa VARCHAR(120) NOT NULL,
      pojemnosc INT NOT NULL DEFAULT 1,
      aktywny TINYINT(1) NOT NULL DEFAULT 1,
      kolejnosc INT NOT NULL DEFAULT 0,
      zarchiwizowano DATETIME NULL,
      INDEX idx_tenant (tenant_id, typ, aktywny)
    )${KOL}`, 'Term_Zasoby');
  mk(`CREATE TABLE IF NOT EXISTS Term_Uslugi (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      usluga_id VARCHAR(36) NOT NULL,
      czas_min INT NULL,
      bufor_przed_min INT NOT NULL DEFAULT 0,
      bufor_po_min INT NOT NULL DEFAULT 0,
      bufor_dotyczy VARCHAR(12) NOT NULL DEFAULT 'oba',
      wymaga_gabinet TINYINT(1) NOT NULL DEFAULT 0,
      gabinety_json TEXT NULL,
      urzadzenia_json TEXT NULL,
      pracownicy_json TEXT NULL,
      aktywna TINYINT(1) NOT NULL DEFAULT 1,
      wersja INT NOT NULL DEFAULT 1,
      zmieniono DATETIME NULL,
      UNIQUE KEY uq_usluga (tenant_id, usluga_id)
    )${KOL}`, 'Term_Uslugi');
  mk(`CREATE TABLE IF NOT EXISTS Term_Grafik (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      pracownik VARCHAR(100) NOT NULL,
      dzien_tyg TINYINT NOT NULL,
      od VARCHAR(5) NOT NULL,
      do_ VARCHAR(5) NOT NULL,
      od_daty DATE NULL,
      do_daty DATE NULL,
      INDEX idx_tenant (tenant_id, pracownik)
    )${KOL}`, 'Term_Grafik');
  mk(`CREATE TABLE IF NOT EXISTS Term_Nieobecnosci (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      pracownik VARCHAR(100) NULL,
      zasob_id INT NULL,
      od DATETIME NOT NULL,
      do_ DATETIME NOT NULL,
      typ VARCHAR(20) NOT NULL DEFAULT 'inne',
      opis VARCHAR(255) NULL,
      utworzyl VARCHAR(100) NULL,
      utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tenant (tenant_id, od, do_)
    )${KOL}`, 'Term_Nieobecnosci');
  mk(`CREATE TABLE IF NOT EXISTS Term_Rezerwacje (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      id_klienta VARCHAR(50) NULL,
      klient_nazwa VARCHAR(255) NOT NULL,
      klient_telefon VARCHAR(50) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'potwierdzona',
      obecnosc VARCHAR(20) NOT NULL DEFAULT 'oczekiwana',
      kanal VARCHAR(20) NOT NULL DEFAULT 'recepcja',
      zrodlo VARCHAR(100) NULL,
      start DATETIME NOT NULL,
      koniec DATETIME NOT NULL,
      notatka TEXT NULL,
      brak_kontaktu TINYINT(1) NOT NULL DEFAULT 0,
      wersja INT NOT NULL DEFAULT 1,
      klucz_idem VARCHAR(64) NULL,
      utworzyl VARCHAR(100) NULL,
      utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      zmieniono DATETIME NULL,
      anulowano DATETIME NULL,
      anulowal VARCHAR(100) NULL,
      powod_anulacji VARCHAR(255) NULL,
      kto_anulowal VARCHAR(20) NULL,
      obecnosc_zmieniono DATETIME NULL,
      rozliczenie_od DATETIME NULL,
      sprzedaz_id VARCHAR(50) NULL,
      UNIQUE KEY uq_idem (tenant_id, klucz_idem),
      INDEX idx_dzien (tenant_id, start),
      INDEX idx_klient (tenant_id, id_klienta)
    )${KOL}`, 'Term_Rezerwacje');
  mk(`CREATE TABLE IF NOT EXISTS Term_Pozycje (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      rezerwacja_id INT NOT NULL,
      kolejnosc INT NOT NULL DEFAULT 0,
      usluga_id VARCHAR(36) NULL,
      kategoria VARCHAR(255) NOT NULL,
      wariant VARCHAR(255) NULL,
      cena DECIMAL(10,2) NULL,
      czas_min INT NOT NULL,
      pracownik VARCHAR(100) NOT NULL,
      start DATETIME NOT NULL,
      koniec DATETIME NOT NULL,
      gabinet_id INT NULL,
      urzadzenie_id INT NULL,
      stan VARCHAR(20) NOT NULL DEFAULT 'zaplanowana',
      start_fakt DATETIME NULL,
      koniec_fakt DATETIME NULL,
      wykonawca_fakt VARCHAR(100) NULL,
      sprzedaz_id VARCHAR(50) NULL,
      INDEX idx_rez (tenant_id, rezerwacja_id),
      INDEX idx_prac (tenant_id, pracownik, start)
    )${KOL}`, 'Term_Pozycje');
  mk(`CREATE TABLE IF NOT EXISTS Term_Zajecia (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      rezerwacja_id INT NOT NULL,
      pozycja_id INT NULL,
      typ_zasobu VARCHAR(12) NOT NULL,
      klucz VARCHAR(100) NOT NULL,
      od DATETIME NOT NULL,
      do_ DATETIME NOT NULL,
      powod VARCHAR(12) NOT NULL DEFAULT 'usluga',
      aktywne TINYINT(1) NOT NULL DEFAULT 1,
      INDEX idx_zasob (tenant_id, typ_zasobu, klucz, od, do_),
      INDEX idx_rez (tenant_id, rezerwacja_id)
    )${KOL}`, 'Term_Zajecia');
  mk(`CREATE TABLE IF NOT EXISTS Term_Historia (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      rezerwacja_id INT NOT NULL,
      kiedy DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      kto VARCHAR(100) NULL,
      akcja VARCHAR(40) NOT NULL,
      opis VARCHAR(500) NULL,
      przed_json TEXT NULL,
      po_json TEXT NULL,
      INDEX idx_rez (tenant_id, rezerwacja_id)
    )${KOL}`, 'Term_Historia');
  mk(`CREATE TABLE IF NOT EXISTS Term_Pracownicy (
      tenant_id VARCHAR(100) NOT NULL,
      pracownik VARCHAR(100) NOT NULL,
      wykonuje_zabiegi TINYINT(1) NOT NULL DEFAULT 1,
      zmieniono DATETIME NULL,
      PRIMARY KEY (tenant_id, pracownik)
    )${KOL}`, 'Term_Pracownicy');
  // Katalog Estelio+: widoczny dla każdego salonu, 0 zł — włącza manager+ w Administracja → Dodatki.
  db.query(`INSERT INTO Features_Catalog (feature_key, nazwa, opis, miesieczna_cena_grosze, status, sortowanie)
            VALUES (?, ?, ?, 0, 'AKTYWNY', 5) ON DUPLICATE KEY UPDATE feature_key = feature_key`,
    [FEATURE_KEY, 'Terminarz', 'Wewnętrzny kalendarz wizyt zintegrowany z kartoteką, karnetami i sprzedażą: grafik zespołu, gabinety i urządzenia, nowa wizyta bez opuszczania grafiku, rozliczenie w istniejącej Sprzedaży.'],
    (e) => { if (e) log.warn('[terminarz] seed Features_Catalog:', e.message); });

  // ── pomocnicze ───────────────────────────────────────────────────────────────
  const czyFeature = (tenant) => new Promise((resolve) => hasFeature(tenant, FEATURE_KEY, (ok) => resolve(!!ok)));
  const teraz = async () => (await q(`SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS t`))[0].t;
  const dt = (v) => (v == null ? null : (v instanceof Date ? S.naStr(Math.floor(v.getTime() / 60000)) : String(v).replace('T', ' ').slice(0, 19)));
  const dataZ = (v) => (v == null ? null : (v instanceof Date ? S.naStr(Math.floor(v.getTime() / 60000)).slice(0, 10) : String(v).slice(0, 10)));
  const json = (s, dom) => { try { const v = JSON.parse(s); return v == null ? dom : v; } catch (e) { return dom; } };
  const sprawdzDt = (v, nazwa) => { if (!RE_DT.test(String(v || ''))) throw new BladUzytkownika(`Nieprawidłowa data/godzina: ${nazwa}.`); return String(v).replace('T', ' ').slice(0, 16) + ':00'; };
  const sprawdzData = (v, nazwa) => { if (!RE_DATA.test(String(v || ''))) throw new BladUzytkownika(`Nieprawidłowa data: ${nazwa}.`); return String(v); };

  async function rola(tenant, imie) {
    if (!imie) return null;
    const rows = await q(`SELECT rola FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`, [tenant, imie]);
    return rows.length ? String(rows[0].rola || '').toLowerCase().trim() : null;
  }
  const wymagaj = (r, zbior, co) => { if (!r || !zbior.has(r)) throw new BladUzytkownika(co || 'Nie masz uprawnienia do tej akcji.'); };

  async function ustawienia(tenant) {
    let rows = await q(`SELECT * FROM Term_Ustawienia WHERE tenant_id = ?`, [tenant]);
    if (!rows.length) {
      await q(`INSERT IGNORE INTO Term_Ustawienia (tenant_id, godziny_json) VALUES (?, ?)`, [tenant, JSON.stringify(DOMYSLNE_GODZINY)]);
      rows = await q(`SELECT * FROM Term_Ustawienia WHERE tenant_id = ?`, [tenant]);
    }
    const u = rows[0];
    return { tryb: u.tryb, siatka_min: u.siatka_min, tolerancja_min: u.tolerancja_min, horyzont_dni: u.horyzont_dni, wyprzedzenie_min: u.wyprzedzenie_min, godziny: json(u.godziny_json, DOMYSLNE_GODZINY), wersja: u.wersja };
  }

  async function zasoby(tenant, tylkoAktywne = false) {
    return q(`SELECT id, typ, nazwa, pojemnosc, aktywny, kolejnosc, zarchiwizowano FROM Term_Zasoby WHERE tenant_id = ? ${tylkoAktywne ? 'AND aktywny = 1 AND zarchiwizowano IS NULL' : ''} ORDER BY typ, kolejnosc, nazwa`, [tenant]);
  }

  /** Usługi z cennika (Uslugi) złączone z konfiguracją terminarza. */
  async function uslugi(tenant) {
    const rows = await q(`SELECT u.id, u.kategoria, u.wariant, u.cena, u.typ_zabiegu, t.czas_min, t.bufor_przed_min, t.bufor_po_min, t.bufor_dotyczy, t.wymaga_gabinet, t.gabinety_json, t.urzadzenia_json, t.pracownicy_json, t.aktywna, t.wersja AS konfig_wersja, tz.kolor, tz.ikona
      FROM Uslugi u LEFT JOIN Term_Uslugi t ON t.tenant_id = u.tenant_id AND t.usluga_id = u.id
      LEFT JOIN Typy_Zabiegow tz ON tz.tenant_id = u.tenant_id AND tz.nazwa = u.typ_zabiegu
      WHERE u.tenant_id = ? AND u.kategoria IS NOT NULL AND TRIM(u.kategoria) <> '' ORDER BY u.kategoria, u.wariant`, [tenant]);
    return rows.map(r => ({
      id: r.id, kategoria: r.kategoria, wariant: r.wariant, cena: r.cena == null ? null : Number(r.cena), typ_zabiegu: r.typ_zabiegu, kolor: r.kolor || null, ikona: r.ikona || null,
      czas_min: r.czas_min, bufor_przed_min: r.bufor_przed_min || 0, bufor_po_min: r.bufor_po_min || 0, bufor_dotyczy: r.bufor_dotyczy || 'oba',
      wymaga_gabinet: !!r.wymaga_gabinet, gabinety: json(r.gabinety_json, null), urzadzenia: json(r.urzadzenia_json, []), pracownicy: json(r.pracownicy_json, null),
      aktywna: r.aktywna == null ? true : !!r.aktywna, skonfigurowana: r.czas_min != null,
    }));
  }

  // Tylko osoby oznaczone jako wykonujące zabiegi (brak wpisu w Term_Pracownicy = domyślnie TAK, nic się nie zmienia dla nikogo bez decyzji managera).
  // To jest JEDYNE miejsce filtrowania — propaguje się do wszystkich widoków (siatki dni, listy, grafik, nowa wizyta) przez wspólną funkcję.
  const pracownicy = (tenant) => q(`SELECT p.imie FROM Pracownicy p LEFT JOIN Term_Pracownicy tp ON tp.tenant_id = p.tenant_id AND tp.pracownik = p.imie
      WHERE p.tenant_id = ? AND COALESCE(tp.wykonuje_zabiegi, 1) = 1 ORDER BY p.imie`, [tenant]).then(r => r.map(x => x.imie));
  // Pełna lista (łącznie z osobami „tylko recepcja”) — tylko do ekranu ustawień „Zespół”.
  const zespol = (tenant) => q(`SELECT p.imie, COALESCE(tp.wykonuje_zabiegi, 1) AS wykonuje_zabiegi FROM Pracownicy p LEFT JOIN Term_Pracownicy tp ON tp.tenant_id = p.tenant_id AND tp.pracownik = p.imie
      WHERE p.tenant_id = ? ORDER BY p.imie`, [tenant]).then(r => r.map(x => ({ imie: x.imie, wykonuje_zabiegi: !!x.wykonuje_zabiegi })));
  const grafik = (tenant) => q(`SELECT id, pracownik, dzien_tyg, od, do_ AS \`do\`, od_daty, do_daty FROM Term_Grafik WHERE tenant_id = ? ORDER BY pracownik, dzien_tyg, od`, [tenant]).then(r => r.map(x => ({ ...x, od_daty: dataZ(x.od_daty), do_daty: dataZ(x.do_daty) })));

  /** Godziny salonu dla dnia → przedziały w minutach. */
  function godzinySalonu(ust, data) {
    const dtg = S.dzienTygodnia(data), baza = S.naMin(data + ' 00:00');
    return ((ust.godziny || {})[dtg] || []).map(p => {
      const [h1, m1] = p.od.split(':').map(Number), [h2, m2] = p.do.split(':').map(Number);
      return { od: baza + h1 * 60 + m1, do: baza + h2 * 60 + m2 };
    }).filter(p => p.do > p.od);
  }

  /**
   * Kontekst dostępności dnia: grafiki pracowników minus nieobecności, zasoby w godzinach salonu minus serwis,
   * istniejące zajęcia (±1 dzień, bo wizyty mogą przechodzić przez północ), inne wizyty klientki.
   */
  async function kontekstDnia(tenant, data, cfg, idKlienta) {
    const ust = cfg.ust || await ustawienia(tenant);
    const prac = cfg.pracownicy || await pracownicy(tenant);
    const graf = cfg.grafik || await grafik(tenant);
    const zas = cfg.zasoby || await zasoby(tenant, true);
    const od = data + ' 00:00:00', do_ = data + ' 23:59:59';
    const nieob = await q(`SELECT id, pracownik, zasob_id, DATE_FORMAT(od,'%Y-%m-%d %H:%i:%s') AS od, DATE_FORMAT(do_,'%Y-%m-%d %H:%i:%s') AS do_, typ, opis FROM Term_Nieobecnosci WHERE tenant_id = ? AND od < ? AND do_ > ?`, [tenant, do_, od]);
    const blokadyDla = (pred) => nieob.filter(pred).map(n => ({ od: S.naMin(n.od), do: S.naMin(n.do_) }));
    const wszystkie = blokadyDla(n => !n.pracownik && !n.zasob_id);
    const dostepnoscPracownikow = {};
    for (const p of prac) {
      dostepnoscPracownikow[p] = S.odejmij(S.przedzialyZGrafiku(graf.filter(g => g.pracownik === p), data), [...wszystkie, ...blokadyDla(n => n.pracownik === p)]);
    }
    const salon = godzinySalonu(ust, data);
    const dostepnoscZasobow = {};
    for (const z of zas) dostepnoscZasobow[String(z.id)] = S.odejmij(salon, [...wszystkie, ...blokadyDla(n => Number(n.zasob_id) === Number(z.id))]);
    const zajete = await q(`SELECT typ_zasobu, klucz, DATE_FORMAT(od,'%Y-%m-%d %H:%i:%s') AS od, DATE_FORMAT(do_,'%Y-%m-%d %H:%i:%s') AS do_, rezerwacja_id, pozycja_id, powod
      FROM Term_Zajecia WHERE tenant_id = ? AND aktywne = 1 AND od < ? AND do_ > ?`, [tenant, data + ' 23:59:59', data + ' 00:00:00']);
    let klientZajety = [];
    if (idKlienta) {
      klientZajety = (await q(`SELECT DATE_FORMAT(start,'%Y-%m-%d %H:%i:%s') AS od, DATE_FORMAT(koniec,'%Y-%m-%d %H:%i:%s') AS do_, id FROM Term_Rezerwacje WHERE tenant_id = ? AND id_klienta = ? AND status NOT IN ('anulowana','odrzucona','wygasla') AND start < ? AND koniec > ?`, [tenant, String(idKlienta), do_, od])).map(r => ({ od: r.od, do: r.do_, rezerwacja_id: r.id }));
    }
    return { ust, salon, dostepnoscPracownikow, dostepnoscZasobow, zajete: zajete.map(z => ({ ...z, do: z.do_ })), klientZajety, nieobecnosci: nieob, gabinety: zas.filter(z => z.typ === 'gabinet').map(z => String(z.id)), urzadzenia: zas.filter(z => z.typ === 'urzadzenie').map(z => String(z.id)) };
  }

  /** Pozycje z żądania → pozycje silnika (konfiguracja usługi, kompetencje, pula zasobów). */
  function zbudujPozycje(wejscie, katalog, prac) {
    if (!Array.isArray(wejscie) || !wejscie.length) throw new BladUzytkownika('Wybierz co najmniej jedną usługę.');
    if (wejscie.length > 8) throw new BladUzytkownika('Maksymalnie 8 usług w jednej wizycie.');
    return wejscie.map((p, i) => {
      const u = katalog.find(x => String(x.id) === String(p.usluga_id));
      if (!u) throw new BladUzytkownika(`Usługa nr ${i + 1} nie istnieje w cenniku.`);
      if (!u.aktywna) throw new BladUzytkownika(`Usługa „${u.kategoria}${u.wariant ? ' / ' + u.wariant : ''}” jest wyłączona w terminarzu.`);
      const dozwoleni = Array.isArray(u.pracownicy) && u.pracownicy.length ? u.pracownicy.filter(x => prac.includes(x)) : prac;
      const wybrany = p.pracownik ? String(p.pracownik).trim() : null;
      if (wybrany && !prac.includes(wybrany)) throw new BladUzytkownika(`Pracownik „${wybrany}” nie istnieje.`);
      return {
        klucz: u.id, usluga_id: u.id, nazwa: u.kategoria + (u.wariant ? ' / ' + u.wariant : ''), kategoria: u.kategoria, wariant: u.wariant, cena: u.cena,
        czas_min: p.czas_min != null && ROLE_OPERACYJNE_CZAS(p) ? Number(p.czas_min) : u.czas_min,
        bufor_przed_min: u.bufor_przed_min, bufor_po_min: u.bufor_po_min, bufor_dotyczy: u.bufor_dotyczy,
        pracownik: wybrany, pracownicyDozwoleni: dozwoleni,
        wymagaGabinetu: u.wymaga_gabinet, gabinetyDozwolone: Array.isArray(u.gabinety) && u.gabinety.length ? u.gabinety.map(String) : null,
        urzadzeniaDozwolone: Array.isArray(u.urzadzenia) ? u.urzadzenia.map(String) : [],
      };
    });
  }
  // Ręczna korekta czasu przez recepcję (np. „dziś krócej”) — dozwolona, ale min. 5 min i nie więcej niż 8 h.
  function ROLE_OPERACYJNE_CZAS(p) { const c = Number(p.czas_min); return c >= 5 && c <= 480; }

  /** Pełna rezerwacja z pozycjami (+ nazwy zasobów). */
  async function rezerwacja(tenant, id) {
    const r = (await q(`SELECT r.*, DATE_FORMAT(r.start,'%Y-%m-%d %H:%i:%s') AS start_s, DATE_FORMAT(r.koniec,'%Y-%m-%d %H:%i:%s') AS koniec_s FROM Term_Rezerwacje r WHERE r.tenant_id = ? AND r.id = ?`, [tenant, Number(id)]))[0];
    if (!r) return null;
    const poz = await q(`SELECT p.*, DATE_FORMAT(p.start,'%Y-%m-%d %H:%i:%s') AS start_s, DATE_FORMAT(p.koniec,'%Y-%m-%d %H:%i:%s') AS koniec_s, g.nazwa AS gabinet, u.nazwa AS urzadzenie
      FROM Term_Pozycje p LEFT JOIN Term_Zasoby g ON g.id = p.gabinet_id LEFT JOIN Term_Zasoby u ON u.id = p.urzadzenie_id WHERE p.tenant_id = ? AND p.rezerwacja_id = ? ORDER BY p.kolejnosc, p.start`, [tenant, Number(id)]);
    return formatujRez(r, poz);
  }
  function formatujRez(r, poz) {
    return {
      id: r.id, numer: 'EST-' + String(r.id).padStart(4, '0'), id_klienta: r.id_klienta, klient_nazwa: r.klient_nazwa, klient_telefon: r.klient_telefon,
      status: r.status, obecnosc: r.obecnosc, kanal: r.kanal, zrodlo: r.zrodlo, start: r.start_s, koniec: r.koniec_s, notatka: r.notatka, brak_kontaktu: !!r.brak_kontaktu,
      wersja: r.wersja, utworzyl: r.utworzyl, utworzono: dt(r.utworzono), anulowano: dt(r.anulowano), anulowal: r.anulowal, powod_anulacji: r.powod_anulacji, kto_anulowal: r.kto_anulowal,
      sprzedaz_id: r.sprzedaz_id, rozliczenie_od: dt(r.rozliczenie_od),
      pozycje: poz.map(p => ({ id: p.id, kolejnosc: p.kolejnosc, usluga_id: p.usluga_id, kategoria: p.kategoria, wariant: p.wariant, cena: p.cena == null ? null : Number(p.cena), czas_min: p.czas_min, pracownik: p.pracownik, start: p.start_s, koniec: p.koniec_s, gabinet_id: p.gabinet_id, urzadzenie_id: p.urzadzenie_id, gabinet: p.gabinet, urzadzenie: p.urzadzenie, stan: p.stan, start_fakt: dt(p.start_fakt), koniec_fakt: dt(p.koniec_fakt), wykonawca_fakt: p.wykonawca_fakt, sprzedaz_id: p.sprzedaz_id })),
      wykonanie: podsumujWykonanie(poz),
    };
  }
  function podsumujWykonanie(poz) {
    const akt = poz.filter(p => p.stan !== 'anulowana');
    if (!akt.length) return 'anulowana';
    if (akt.every(p => p.stan === 'wykonana')) return 'wykonana';
    if (akt.some(p => p.stan === 'w_trakcie')) return 'w_toku';
    if (akt.some(p => p.stan === 'wykonana' || p.stan === 'przerwana')) return 'czesciowo';
    if (akt.every(p => ['niewykonana', 'odmowa'].includes(p.stan))) return 'niewykonana';
    return 'zaplanowana';
  }
  const historia = (conn, tenant, rezId, kto, akcja, opis, przed, po) => qc(conn, `INSERT INTO Term_Historia (tenant_id, rezerwacja_id, kto, akcja, opis, przed_json, po_json) VALUES (?, ?, ?, ?, ?, ?, ?)`, [tenant, rezId, kto || null, akcja, (opis || '').slice(0, 500), przed == null ? null : JSON.stringify(przed), po == null ? null : JSON.stringify(po)]);

  /** Maskowanie danych dla specjalisty/praktykantki (03: inni bez danych osobowych domyślnie). */
  function maskuj(rez, r, imie) {
    if (ROLE_OPERACYJNE.has(r)) return rez;
    const moja = ROLE_SPECJALISTA.has(r) && rez.pozycje.some(p => p.pracownik === imie);
    if (moja) return { ...rez, klient_telefon: null, notatka: null };
    return { ...rez, klient_nazwa: 'Zajęte', klient_telefon: null, id_klienta: null, notatka: null, pozycje: rez.pozycje.map(p => ({ ...p, cena: null })) };
  }

  /** Lista rezerwacji w zakresie dat (z pozycjami), opcjonalnie dla pracownika. */
  async function rezerwacjeZakres(tenant, od, do_, pracownik, statusy) {
    const params = [tenant, do_ + ' 23:59:59', od + ' 00:00:00'];
    let sql = `SELECT r.*, DATE_FORMAT(r.start,'%Y-%m-%d %H:%i:%s') AS start_s, DATE_FORMAT(r.koniec,'%Y-%m-%d %H:%i:%s') AS koniec_s FROM Term_Rezerwacje r WHERE r.tenant_id = ? AND r.start < ? AND r.koniec > ?`;
    if (statusy && statusy.length) { sql += ` AND r.status IN (${statusy.map(() => '?').join(',')})`; params.push(...statusy); }
    if (pracownik) { sql += ` AND EXISTS (SELECT 1 FROM Term_Pozycje p WHERE p.tenant_id = r.tenant_id AND p.rezerwacja_id = r.id AND p.pracownik = ?)`; params.push(pracownik); }
    sql += ' ORDER BY r.start';
    const rows = await q(sql, params);
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    const poz = await q(`SELECT p.*, DATE_FORMAT(p.start,'%Y-%m-%d %H:%i:%s') AS start_s, DATE_FORMAT(p.koniec,'%Y-%m-%d %H:%i:%s') AS koniec_s, g.nazwa AS gabinet, u.nazwa AS urzadzenie
      FROM Term_Pozycje p LEFT JOIN Term_Zasoby g ON g.id = p.gabinet_id LEFT JOIN Term_Zasoby u ON u.id = p.urzadzenie_id WHERE p.tenant_id = ? AND p.rezerwacja_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.rezerwacja_id, p.kolejnosc`, [tenant, ...ids]);
    const wg = {}; poz.forEach(p => { (wg[p.rezerwacja_id] = wg[p.rezerwacja_id] || []).push(p); });
    return rows.map(r => formatujRez(r, wg[r.id] || []));
  }

  /** Alternatywy dla konfliktu (E09): ten sam pracownik inna godzina, dowolny pracownik. */
  async function alternatywy(tenant, data, pozycje, cfg, idKlienta, pominRez) {
    const kontekst = (d) => kontekstDnia(tenant, d, cfg, idKlienta);
    const dni = {}; const dnia = async (d) => (dni[d] = dni[d] || await kontekst(d));
    const wynik = [];
    for (let i = 0; i < 7 && wynik.length < 3; i++) {
      const d = S.dzienZ(S.naMin(data + ' 00:00') + i * 1440);
      const k = await dnia(d);
      const r = S.szukajTerminy({ pozycje, gabinety: k.gabinety, urzadzenia: k.urzadzenia, dzienOd: d, dzienDo: d, krok_min: cfg.ust.siatka_min, limit: 3 - wynik.length, pominRezerwacje: pominRez, nieWczesniejNiz: cfg.terazStr, dostepnoscDnia: () => k });
      r.forEach(x => wynik.push({ start: x.start, koniec: x.koniec, pozycje: x.pozycje.map(p => ({ pracownik: p.pracownik, gabinet_id: p.gabinet_id, urzadzenie_id: p.urzadzenie_id })), opis: 'Ten sam komplet usług' }));
    }
    if (pozycje.some(p => p.pracownik)) {
      const dowolne = pozycje.map(p => ({ ...p, pracownik: null }));
      for (let i = 0; i < 3; i++) {
        const d = S.dzienZ(S.naMin(data + ' 00:00') + i * 1440);
        const k = await dnia(d);
        const r = S.szukajTerminy({ pozycje: dowolne, gabinety: k.gabinety, urzadzenia: k.urzadzenia, dzienOd: d, dzienDo: d, krok_min: cfg.ust.siatka_min, limit: 2, pominRezerwacje: pominRez, nieWczesniejNiz: cfg.terazStr, dostepnoscDnia: () => k });
        r.filter(x => x.pozycje.some((p, j) => p.pracownik !== pozycje[j].pracownik)).forEach(x => wynik.push({ start: x.start, koniec: x.koniec, pozycje: x.pozycje.map(p => ({ pracownik: p.pracownik, gabinet_id: p.gabinet_id, urzadzenie_id: p.urzadzenie_id })), opis: 'Inna osoba z uprawnieniem' }));
        if (r.length) break;
      }
    }
    return wynik.slice(0, 6);
  }

  async function wspolneCfg(tenant) {
    const [ust, prac, graf, zas, kat, terazStr] = await Promise.all([ustawienia(tenant), pracownicy(tenant), grafik(tenant), zasoby(tenant, true), uslugi(tenant), teraz()]);
    return { ust, pracownicy: prac, grafik: graf, zasoby: zas, katalog: kat, terazStr };
  }

  /** Wizyty dotknięte zmianą dostępności (T191/T193): pozycje poza nową dostępnością w zakresie dat. */
  async function wizytyDotkniete(tenant, pracownik, zasobId, od, do_, dostepnoscFn) {
    const params = [tenant, do_ + ' 23:59:59', od + ' 00:00:00'];
    let sql = `SELECT p.id, p.rezerwacja_id, p.pracownik, p.kategoria, p.wariant, DATE_FORMAT(p.start,'%Y-%m-%d %H:%i:%s') AS start, DATE_FORMAT(p.koniec,'%Y-%m-%d %H:%i:%s') AS koniec, r.klient_nazwa, r.status
      FROM Term_Pozycje p JOIN Term_Rezerwacje r ON r.id = p.rezerwacja_id AND r.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND p.stan IN ('zaplanowana','w_trakcie') AND r.status NOT IN ('anulowana','odrzucona','wygasla') AND p.start < ? AND p.koniec > ?`;
    if (pracownik) { sql += ' AND p.pracownik = ?'; params.push(pracownik); }
    if (zasobId) { sql += ' AND (p.gabinet_id = ? OR p.urzadzenie_id = ?)'; params.push(Number(zasobId), Number(zasobId)); }
    const rows = await q(sql + ' ORDER BY p.start', params);
    return rows.filter(p => !dostepnoscFn || !dostepnoscFn(p));
  }

  // ═══════════════════ ROUTER ═══════════════════
  router.post('/terminarz', async (req, res) => {
    const d = req.body || {};
    const tenant = d.tenant_id, action = d.action, imie = d.pracownik ? String(d.pracownik).trim() : '';
    if (!tenant) return res.json({ status: 'error', message: 'Brak tenant_id' });
    try {
      const r = await rola(tenant, imie);
      if (action === 'trm_init') {
        const on = await czyFeature(tenant);
        if (!on) return res.json({ status: 'success', feature_on: false, rola: r });
        const cfg = await wspolneCfg(tenant);
        const nieob = await q(`SELECT id, pracownik, zasob_id, DATE_FORMAT(od,'%Y-%m-%d %H:%i:%s') AS od, DATE_FORMAT(do_,'%Y-%m-%d %H:%i:%s') AS \`do\`, typ, opis, utworzyl FROM Term_Nieobecnosci WHERE tenant_id = ? AND do_ >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY od`, [tenant]);
        return res.json({ status: 'success', feature_on: true, rola: r, teraz: cfg.terazStr, ustawienia: cfg.ust, pracownicy: cfg.pracownicy, grafik: cfg.grafik, zasoby: await zasoby(tenant, false), uslugi: cfg.katalog, nieobecnosci: nieob, zespol: await zespol(tenant) });
      }
      if (!(await czyFeature(tenant))) return res.json({ status: 'error', code: 'DODATEK', message: 'Dodatek „Terminarz” nie jest aktywny w tym salonie.' });
      const wynik = await obsluz(action, d, tenant, imie, r);
      return res.json(wynik);
    } catch (e) {
      if (e && e.uzytkownika) return res.json({ status: 'error', message: e.message, ...e.extra });
      log.error('[terminarz]', action, e && e.message);
      return res.json({ status: 'error', message: 'Błąd terminarza. Spróbuj ponownie.' });
    }
  });

  async function obsluz(action, d, tenant, imie, r) {
    switch (action) {
      // ───────── konfiguracja (manager+) ─────────
      case 'trm_ustawienia_zapisz': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        const ust = await ustawienia(tenant);
        const godziny = {};
        for (let i = 1; i <= 7; i++) {
          const lista = Array.isArray((d.godziny || {})[i]) ? d.godziny[i] : [];
          godziny[i] = lista.filter(p => RE_HHMM.test(p.od) && RE_HHMM.test(p.do) && p.od < p.do).map(p => ({ od: p.od, do: p.do }));
        }
        const siatka = [5, 10, 15, 30].includes(Number(d.siatka_min)) ? Number(d.siatka_min) : ust.siatka_min;
        const tol = Math.min(30, Math.max(0, Number(d.tolerancja_min ?? ust.tolerancja_min) || 0));
        const hor = Math.min(365, Math.max(7, Number(d.horyzont_dni ?? ust.horyzont_dni) || 90));
        const wyp = Math.min(168 * 60, Math.max(0, Number(d.wyprzedzenie_min ?? ust.wyprzedzenie_min) || 0));
        const tryb = ['wewnetrzny', 'online', 'obok'].includes(d.tryb) ? d.tryb : ust.tryb;
        await q(`UPDATE Term_Ustawienia SET godziny_json = ?, siatka_min = ?, tolerancja_min = ?, horyzont_dni = ?, wyprzedzenie_min = ?, tryb = ?, wersja = wersja + 1, zmieniono = NOW() WHERE tenant_id = ?`, [JSON.stringify(godziny), siatka, tol, hor, wyp, tryb, tenant]);
        zapiszLog(tenant, 'TERMINARZ: USTAWIENIA', imie, `siatka ${siatka} min, tryb ${tryb}`);
        return { status: 'success', ustawienia: await ustawienia(tenant) };
      }
      case 'trm_zasob_zapisz': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        const typ = d.typ === 'urzadzenie' ? 'urzadzenie' : 'gabinet';
        const nazwa = String(d.nazwa || '').trim().slice(0, 120);
        if (!nazwa) throw new BladUzytkownika('Podaj nazwę zasobu.');
        const poj = Math.max(1, Math.min(50, Number(d.pojemnosc) || 1));
        if (d.id) {
          await q(`UPDATE Term_Zasoby SET nazwa = ?, pojemnosc = ?, aktywny = ?, kolejnosc = ? WHERE tenant_id = ? AND id = ?`, [nazwa, poj, d.aktywny === false || d.aktywny === 0 ? 0 : 1, Number(d.kolejnosc) || 0, tenant, Number(d.id)]);
        } else {
          await q(`INSERT INTO Term_Zasoby (tenant_id, typ, nazwa, pojemnosc, kolejnosc) VALUES (?, ?, ?, ?, ?)`, [tenant, typ, nazwa, poj, Number(d.kolejnosc) || 0]);
        }
        zapiszLog(tenant, 'TERMINARZ: ZASÓB', imie, `${typ}: ${nazwa}`);
        return { status: 'success', zasoby: await zasoby(tenant, false) };
      }
      case 'trm_zasob_archiwizuj': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        const id = Number(d.id);
        const t = await teraz();
        const dotk = await wizytyDotkniete(tenant, null, id, t.slice(0, 10), '2099-12-31', null);
        if (dotk.length && !d.wymus) return { status: 'success', wymaga_decyzji: true, dotkniete: dotk, message: `Ten zasób ma ${dotk.length} przyszłych wizyt. Przenieś je lub potwierdź archiwizację — wizyty zostaną z flagą do rozwiązania.` };
        await q(`UPDATE Term_Zasoby SET aktywny = 0, zarchiwizowano = NOW() WHERE tenant_id = ? AND id = ?`, [tenant, id]);
        zapiszLog(tenant, 'TERMINARZ: ZASÓB ZARCHIWIZOWANY', imie, `id ${id}, dotkniętych wizyt: ${dotk.length}`);
        return { status: 'success', zasoby: await zasoby(tenant, false), dotkniete: dotk };
      }
      case 'trm_usluga_zapisz': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        const u = (await q(`SELECT id FROM Uslugi WHERE tenant_id = ? AND id = ?`, [tenant, String(d.usluga_id || '')]))[0];
        if (!u) throw new BladUzytkownika('Usługa nie istnieje w cenniku.');
        const czas = d.czas_min == null || d.czas_min === '' ? null : Math.max(5, Math.min(480, Number(d.czas_min) || 0));
        const bp = Math.max(0, Math.min(120, Number(d.bufor_przed_min) || 0)), ba = Math.max(0, Math.min(120, Number(d.bufor_po_min) || 0));
        const dot = ['pracownik', 'gabinet', 'oba', 'brak'].includes(d.bufor_dotyczy) ? d.bufor_dotyczy : 'oba';
        const gab = Array.isArray(d.gabinety) ? d.gabinety.map(Number).filter(Boolean) : null;
        const urz = Array.isArray(d.urzadzenia) ? d.urzadzenia.map(Number).filter(Boolean) : [];
        const prac = Array.isArray(d.pracownicy) ? d.pracownicy.map(String) : null;
        await q(`INSERT INTO Term_Uslugi (tenant_id, usluga_id, czas_min, bufor_przed_min, bufor_po_min, bufor_dotyczy, wymaga_gabinet, gabinety_json, urzadzenia_json, pracownicy_json, aktywna, zmieniono)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE czas_min = VALUES(czas_min), bufor_przed_min = VALUES(bufor_przed_min), bufor_po_min = VALUES(bufor_po_min), bufor_dotyczy = VALUES(bufor_dotyczy), wymaga_gabinet = VALUES(wymaga_gabinet), gabinety_json = VALUES(gabinety_json), urzadzenia_json = VALUES(urzadzenia_json), pracownicy_json = VALUES(pracownicy_json), aktywna = VALUES(aktywna), wersja = wersja + 1, zmieniono = NOW()`,
          [tenant, u.id, czas, bp, ba, dot, d.wymaga_gabinet ? 1 : 0, gab && gab.length ? JSON.stringify(gab) : null, JSON.stringify(urz), prac && prac.length ? JSON.stringify(prac) : null, d.aktywna === false ? 0 : 1]);
        return { status: 'success', uslugi: await uslugi(tenant) };
      }
      case 'trm_grafik_zapisz': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        const prac = await pracownicy(tenant);
        const kto = String(d.pracownik_grafik || '').trim();
        if (!prac.includes(kto)) throw new BladUzytkownika('Nieznany pracownik.');
        const wzorce = (Array.isArray(d.wzorce) ? d.wzorce : []).filter(w => w.dzien_tyg >= 1 && w.dzien_tyg <= 7 && RE_HHMM.test(w.od) && RE_HHMM.test(w.do) && w.od < w.do);
        const cfg = await wspolneCfg(tenant);
        // podgląd wpływu (T191): przyszłe pozycje tego pracownika poza nową dostępnością
        const nowyGrafik = wzorce.map(w => ({ pracownik: kto, dzien_tyg: Number(w.dzien_tyg), od: w.od, do: w.do }));
        const dotk = await wizytyDotkniete(tenant, kto, null, cfg.terazStr.slice(0, 10), '2099-12-31', (p) => S.miesciSie(S.naMin(p.start), S.naMin(p.koniec), S.przedzialyZGrafiku(nowyGrafik, p.start.slice(0, 10))));
        if (dotk.length && !d.wymus) return { status: 'success', wymaga_decyzji: true, dotkniete: dotk, message: `Zmiana grafiku dotknie ${dotk.length} wizyt. Sprawdź zastępstwo, zaproponuj klientkom zmianę albo przełóż terminy — zapis grafiku ich nie odwołuje.` };
        const conn = await polacz();
        try {
          await begin(conn);
          await qc(conn, `DELETE FROM Term_Grafik WHERE tenant_id = ? AND pracownik = ?`, [tenant, kto]);
          for (const w of nowyGrafik) await qc(conn, `INSERT INTO Term_Grafik (tenant_id, pracownik, dzien_tyg, od, do_) VALUES (?, ?, ?, ?, ?)`, [tenant, kto, w.dzien_tyg, w.od, w.do]);
          await commit(conn);
        } catch (e) { await rollback(conn); throw e; } finally { conn.release(); }
        zapiszLog(tenant, 'TERMINARZ: GRAFIK', imie, `${kto}: ${nowyGrafik.length} przedziałów, dotkniętych wizyt: ${dotk.length}`);
        return { status: 'success', grafik: await grafik(tenant), dotkniete: dotk };
      }
      case 'trm_grafik_z_godzin_salonu': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        const ust = await ustawienia(tenant);
        const prac = await pracownicy(tenant);
        const wybrani = (Array.isArray(d.pracownicy_lista) ? d.pracownicy_lista : prac).filter(p => prac.includes(p));
        const conn = await polacz();
        try {
          await begin(conn);
          for (const p of wybrani) {
            const istnieje = (await qc(conn, `SELECT COUNT(*) AS n FROM Term_Grafik WHERE tenant_id = ? AND pracownik = ?`, [tenant, p]))[0].n;
            if (istnieje && !d.nadpisz) continue;
            await qc(conn, `DELETE FROM Term_Grafik WHERE tenant_id = ? AND pracownik = ?`, [tenant, p]);
            for (let dz = 1; dz <= 7; dz++) for (const g of (ust.godziny[dz] || [])) await qc(conn, `INSERT INTO Term_Grafik (tenant_id, pracownik, dzien_tyg, od, do_) VALUES (?, ?, ?, ?, ?)`, [tenant, p, dz, g.od, g.do]);
          }
          await commit(conn);
        } catch (e) { await rollback(conn); throw e; } finally { conn.release(); }
        zapiszLog(tenant, 'TERMINARZ: GRAFIK Z GODZIN SALONU', imie, wybrani.join(', '));
        return { status: 'success', grafik: await grafik(tenant) };
      }
      case 'trm_nieobecnosc_zapisz': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        const od = sprawdzDt(d.od, 'od'), do_ = sprawdzDt(d.do, 'do');
        if (do_ <= od) throw new BladUzytkownika('Koniec nieobecności musi być po początku.');
        const typ = ['urlop', 'choroba', 'szkolenie', 'przerwa', 'serwis', 'zamkniete', 'inne'].includes(d.typ) ? d.typ : 'inne';
        const prac = d.pracownik_nieob ? String(d.pracownik_nieob).trim() : null;
        const zasob = d.zasob_id ? Number(d.zasob_id) : null;
        if (prac && !(await pracownicy(tenant)).includes(prac)) throw new BladUzytkownika('Nieznany pracownik.');
        const dotk = await wizytyDotkniete(tenant, prac, zasob, od.slice(0, 10), do_.slice(0, 10), (p) => !S.nakladaja(S.naMin(p.start), S.naMin(p.koniec), S.naMin(od), S.naMin(do_)));
        if (dotk.length && !d.wymus) return { status: 'success', wymaga_decyzji: true, dotkniete: dotk, message: `Ta nieobecność nachodzi na ${dotk.length} wizyt. Zapis jej nie odwołuje — rozwiąż je osobno (zastępstwo, zmiana terminu, kontakt).` };
        const res_ = await q(`INSERT INTO Term_Nieobecnosci (tenant_id, pracownik, zasob_id, od, do_, typ, opis, utworzyl) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, prac, zasob, od, do_, typ, String(d.opis || '').slice(0, 255) || null, imie || null]);
        zapiszLog(tenant, 'TERMINARZ: NIEOBECNOŚĆ', imie, `${prac || (zasob ? 'zasób ' + zasob : 'cały salon')} ${od}–${do_} (${typ}), dotkniętych wizyt: ${dotk.length}`);
        return { status: 'success', id: res_.insertId, dotkniete: dotk };
      }
      case 'trm_zespol_zapisz': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        const kto = String(d.pracownik_zespol || '').trim();
        const wszyscyProc = await q(`SELECT imie FROM Pracownicy WHERE tenant_id = ?`, [tenant]).then(rr => rr.map(x => x.imie));
        if (!wszyscyProc.includes(kto)) throw new BladUzytkownika('Nieznany pracownik.');
        const wartosc = (d.wykonuje_zabiegi === false || d.wykonuje_zabiegi === 0 || d.wykonuje_zabiegi === '0') ? 0 : 1;
        await q(`INSERT INTO Term_Pracownicy (tenant_id, pracownik, wykonuje_zabiegi, zmieniono) VALUES (?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE wykonuje_zabiegi = VALUES(wykonuje_zabiegi), zmieniono = NOW()`, [tenant, kto, wartosc]);
        zapiszLog(tenant, 'TERMINARZ: ZESPÓŁ', imie, `${kto}: ${wartosc ? 'wykonuje zabiegi' : 'tylko recepcja'}`);
        return { status: 'success', zespol: await zespol(tenant), pracownicy: await pracownicy(tenant) };
      }
      case 'trm_nieobecnosc_usun': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        await q(`DELETE FROM Term_Nieobecnosci WHERE tenant_id = ? AND id = ?`, [tenant, Number(d.id)]);
        return { status: 'success' };
      }

      // ───────── odczyt ─────────
      case 'trm_dzien': {
        const data = sprawdzData(d.data, 'data');
        const cfg = await wspolneCfg(tenant);
        const k = await kontekstDnia(tenant, data, cfg, null);
        let lista = await rezerwacjeZakres(tenant, data, data, ROLE_SPECJALISTA.has(r) && d.tylko_moje ? imie : null, null);
        lista = lista.map(x => maskuj(x, r, imie));
        const dostep = {}; Object.keys(k.dostepnoscPracownikow).forEach(p => { dostep[p] = k.dostepnoscPracownikow[p].map(x => ({ od: S.naStr(x.od), do: S.naStr(x.do) })); });
        const dostepZas = {}; Object.keys(k.dostepnoscZasobow).forEach(z => { dostepZas[z] = k.dostepnoscZasobow[z].map(x => ({ od: S.naStr(x.od), do: S.naStr(x.do) })); });
        return { status: 'success', data, teraz: cfg.terazStr, rezerwacje: lista, dostepnosc: dostep, dostepnosc_zasobow: dostepZas, salon: k.salon.map(x => ({ od: S.naStr(x.od), do: S.naStr(x.do) })), nieobecnosci: k.nieobecnosci.map(n => ({ ...n, do: n.do_ })), zajecia: ROLE_OPERACYJNE.has(r) ? k.zajete : [] };
      }
      case 'trm_zakres': {
        const od = sprawdzData(d.od, 'od'), do_ = sprawdzData(d.do, 'do');
        if (S.naMin(do_ + ' 00:00') - S.naMin(od + ' 00:00') > 45 * 1440) throw new BladUzytkownika('Zakres maksymalnie 45 dni.');
        const prac = d.pracownik_filtr ? String(d.pracownik_filtr) : (ROLE_SPECJALISTA.has(r) && d.tylko_moje ? imie : null);
        const statusy = Array.isArray(d.statusy) && d.statusy.length ? d.statusy.filter(s => STANY_REZ.includes(s)) : null;
        const lista = (await rezerwacjeZakres(tenant, od, do_, prac, statusy)).map(x => maskuj(x, r, imie));
        return { status: 'success', od, do: do_, rezerwacje: lista };
      }
      case 'trm_rezerwacja': {
        const rez = await rezerwacja(tenant, d.id);
        if (!rez) throw new BladUzytkownika('Nie znaleziono wizyty.');
        const hist = ROLE_OPERACYJNE.has(r) ? await q(`SELECT DATE_FORMAT(kiedy,'%Y-%m-%d %H:%i:%s') AS kiedy, kto, akcja, opis FROM Term_Historia WHERE tenant_id = ? AND rezerwacja_id = ? ORDER BY id`, [tenant, rez.id]) : [];
        let sprzedaz = null;
        if (rez.sprzedaz_id && ROLE_OPERACYJNE.has(r)) sprzedaz = await q(`SELECT id, DATE_FORMAT(data_sprzedazy,'%Y-%m-%d %H:%i') AS data, zabieg, szczegoly, kwota, platnosc, sprzedawca FROM Sprzedaz WHERE tenant_id = ? AND (id = ? OR id LIKE ?) AND status = 'AKTYWNY' ORDER BY id`, [tenant, rez.sprzedaz_id, rez.sprzedaz_id + '-%']);
        return { status: 'success', rezerwacja: maskuj(rez, r, imie), historia: hist, sprzedaz };
      }
      case 'trm_szukaj_klienta': {
        wymagaj(r, ROLE_OPERACYJNE);
        const fraza = String(d.fraza || '').trim();
        if (fraza.length < 1) return { status: 'success', klienci: [] };
        const like = '%' + fraza + '%';
        const rows = await q(`SELECT id_klienta, imie_nazwisko, telefon, status, ostrzezenie FROM Klienci WHERE tenant_id = ? AND (status IS NULL OR status = 'AKTYWNY') AND (imie_nazwisko LIKE ? OR telefon LIKE ? OR id_klienta = ?) ORDER BY imie_nazwisko LIMIT 12`, [tenant, like, like, fraza]);
        return { status: 'success', klienci: rows.map(k => ({ id_klienta: k.id_klienta, nazwa: k.imie_nazwisko, telefon: k.telefon, ostrzezenie: k.ostrzezenie })) };
      }

      // ───────── dostępność ─────────
      case 'trm_sprawdz': {
        wymagaj(r, ROLE_OPERACYJNE);
        const start = sprawdzDt(d.start, 'start');
        const cfg = await wspolneCfg(tenant);
        const poz = zbudujPozycje(d.pozycje, cfg.katalog, cfg.pracownicy);
        const k = await kontekstDnia(tenant, start.slice(0, 10), cfg, d.id_klienta || null);
        if (d.pomin_rezerwacje) k.klientZajety = k.klientZajety.filter(x => String(x.rezerwacja_id) !== String(d.pomin_rezerwacje));
        const w = S.sprawdzKomplet({ ...k, start, pozycje: poz, pominRezerwacje: d.pomin_rezerwacje || null });
        const odp = { status: 'success', ok: w.ok, start: w.start, koniec: w.koniec, przerwy_min: w.przerwy_min, problemy: w.problemy, pozycje: w.pozycje.map(p => ({ usluga_id: p.usluga_id, nazwa: p.nazwa, start: p.start, koniec: p.koniec, pracownik: p.pracownik, gabinet_id: p.gabinet_id, urzadzenie_id: p.urzadzenie_id, cena: p.cena, czas_min: p.czas_min })), alternatywy: [] };
        if (!w.ok && d.z_alternatywami !== false) odp.alternatywy = await alternatywy(tenant, start.slice(0, 10), poz, cfg, d.id_klienta || null, d.pomin_rezerwacje || null);
        return odp;
      }
      case 'trm_szukaj': {
        wymagaj(r, ROLE_OPERACYJNE);
        const od = sprawdzData(d.dzien_od, 'od'), do_ = sprawdzData(d.dzien_do, 'do');
        if (S.naMin(do_ + ' 00:00') - S.naMin(od + ' 00:00') > 60 * 1440) throw new BladUzytkownika('Zakres wyszukiwania maksymalnie 60 dni.');
        const cfg = await wspolneCfg(tenant);
        const poz = zbudujPozycje(d.pozycje, cfg.katalog, cfg.pracownicy);
        // szukajTerminy jest synchroniczne — konteksty dni dociągamy wcześniej (dni bez grafiku dają pusty kontekst)
        const cache = {};
        for (let m = S.naMin(od + ' 00:00'); m <= S.naMin(do_ + ' 00:00'); m += 1440) { const data = S.dzienZ(m); cache[data] = await kontekstDnia(tenant, data, cfg, d.id_klienta || null); }
        const pelne = S.szukajTerminy({ pozycje: poz, dzienOd: od, dzienDo: do_, krok_min: cfg.ust.siatka_min, limit: Math.min(30, Number(d.limit) || 10), nieWczesniejNiz: cfg.terazStr, pominRezerwacje: d.pomin_rezerwacje || null, dostepnoscDnia: (data) => cache[data] || null });
        return { status: 'success', terminy: pelne.map(x => ({ start: x.start, koniec: x.koniec, przerwy_min: x.przerwy_min, pozycje: x.pozycje.map(p => ({ usluga_id: p.usluga_id, nazwa: p.nazwa, start: p.start, koniec: p.koniec, pracownik: p.pracownik, gabinet_id: p.gabinet_id, urzadzenie_id: p.urzadzenie_id })) })) };
      }

      // ───────── zapis (atomowo, pod blokadą salonu) ─────────
      case 'trm_zapisz': {
        wymagaj(r, ROLE_OPERACYJNE);
        const start = sprawdzDt(d.start, 'start');
        const klucz = String(d.klucz_idem || '').slice(0, 64) || crypto.randomUUID();
        const kanal = KANALY.includes(d.kanal) ? d.kanal : 'recepcja';
        const klient = d.klient || {};
        const nazwa = String(klient.nazwa || '').trim().slice(0, 255);
        if (!nazwa) throw new BladUzytkownika('Wskaż klientkę.');
        let idKlienta = klient.id_klienta ? String(klient.id_klienta) : null, telefon = null;
        if (idKlienta) {
          const kr = (await q(`SELECT id_klienta, imie_nazwisko, telefon, status FROM Klienci WHERE tenant_id = ? AND id_klienta = ?`, [tenant, idKlienta]))[0];
          if (!kr) throw new BladUzytkownika('Nie znaleziono klientki w kartotece.');
          if (kr.status && kr.status !== 'AKTYWNY') throw new BladUzytkownika('Ta kartoteka jest nieaktywna — wizyta wymaga decyzji uprawnionej osoby.');
          telefon = kr.telefon || null;
        } else if (!d.bez_kartoteki) {
          throw new BladUzytkownika('Wybierz klientkę z kartoteki albo dodaj nową.');
        }
        const cfg = await wspolneCfg(tenant);
        const poz = zbudujPozycje(d.pozycje, cfg.katalog, cfg.pracownicy);
        const conn = await polacz();
        try {
          const lock = await qc(conn, `SELECT GET_LOCK(?, 8) AS l`, ['trm:' + tenant]);
          if (!lock[0] || Number(lock[0].l) !== 1) throw new BladUzytkownika('Salon zapisuje właśnie inną wizytę. Spróbuj za chwilę.');
          try {
            // idempotencja: ponowienie tej samej akcji zwraca tę samą wizytę
            const ist = await qc(conn, `SELECT id FROM Term_Rezerwacje WHERE tenant_id = ? AND klucz_idem = ?`, [tenant, klucz]);
            if (ist.length) return { status: 'success', powtorzenie: true, rezerwacja: await rezerwacja(tenant, ist[0].id) };
            const k = await kontekstDnia(tenant, start.slice(0, 10), cfg, idKlienta);
            const w = S.sprawdzKomplet({ ...k, start, pozycje: poz });
            if (!w.ok) {
              const alt = await alternatywy(tenant, start.slice(0, 10), poz, cfg, idKlienta, null);
              return { status: 'konflikt', message: w.problemy[0] ? w.problemy[0].opis : 'Wybrany komplet nie jest dostępny.', problemy: w.problemy, alternatywy: alt };
            }
            await begin(conn);
            const ins = await qc(conn, `INSERT INTO Term_Rezerwacje (tenant_id, id_klienta, klient_nazwa, klient_telefon, status, kanal, zrodlo, start, koniec, notatka, brak_kontaktu, klucz_idem, utworzyl) VALUES (?, ?, ?, ?, 'potwierdzona', ?, ?, ?, ?, ?, ?, ?, ?)`,
              [tenant, idKlienta, nazwa, telefon, kanal, String(d.zrodlo || '').slice(0, 100) || null, w.start, w.koniec, String(d.notatka || '').slice(0, 2000) || null, d.brak_kontaktu || !telefon ? 1 : 0, klucz, imie || null]);
            const rezId = ins.insertId;
            for (let i = 0; i < w.pozycje.length; i++) {
              const p = w.pozycje[i];
              const pi = await qc(conn, `INSERT INTO Term_Pozycje (tenant_id, rezerwacja_id, kolejnosc, usluga_id, kategoria, wariant, cena, czas_min, pracownik, start, koniec, gabinet_id, urzadzenie_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [tenant, rezId, i, p.usluga_id, p.kategoria, p.wariant || null, p.cena, p.czas_min, p.pracownik, p.start, p.koniec, p.gabinet_id ? Number(p.gabinet_id) : null, p.urzadzenie_id ? Number(p.urzadzenie_id) : null]);
              for (const z of p.zajecia) await qc(conn, `INSERT INTO Term_Zajecia (tenant_id, rezerwacja_id, pozycja_id, typ_zasobu, klucz, od, do_, powod) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, rezId, pi.insertId, z.typ_zasobu, String(z.klucz), S.naStr(z.od), S.naStr(z.do), z.powod]);
            }
            await historia(conn, tenant, rezId, imie, 'utworzono', `${kanal}: ${w.pozycje.map(p => p.nazwa + ' — ' + p.pracownik).join('; ')}`, null, { start: w.start, koniec: w.koniec });
            await commit(conn);
            zapiszLog(tenant, 'TERMINARZ: NOWA WIZYTA', imie, `EST-${String(rezId).padStart(4, '0')} ${nazwa} ${w.start.slice(0, 16)} (${w.pozycje.map(p => p.nazwa).join(', ')})`);
            return { status: 'success', rezerwacja: await rezerwacja(tenant, rezId), przerwy_min: w.przerwy_min };
          } finally { await qc(conn, `SELECT RELEASE_LOCK(?)`, ['trm:' + tenant]).catch(() => {}); }
        } catch (e) { await rollback(conn); throw e; } finally { conn.release(); }
      }
      case 'trm_zmien': {
        wymagaj(r, ROLE_OPERACYJNE);
        const rez = await rezerwacja(tenant, d.id);
        if (!rez) throw new BladUzytkownika('Nie znaleziono wizyty.');
        if (Number(d.wersja) !== Number(rez.wersja)) throw new BladUzytkownika('Ktoś zmienił tę wizytę. Sprawdź aktualne dane przed zapisaniem.', { code: 'WERSJA', rezerwacja: rez });
        if (['anulowana', 'odrzucona', 'wygasla'].includes(rez.status)) throw new BladUzytkownika('Wizyta jest anulowana — odtworzenie to nowa rezerwacja.');
        if (rez.pozycje.some(p => ['wykonana', 'w_trakcie', 'przerwana'].includes(p.stan))) throw new BladUzytkownika('Wizyta jest już w trakcie lub wykonana — zmiana terminu wymaga korekty, nie przełożenia.');
        const start = sprawdzDt(d.start || rez.start, 'start');
        const cfg = await wspolneCfg(tenant);
        const aktywne = rez.pozycje.filter(p => p.stan !== 'anulowana');
        const nowePoz = aktywne.map(p => ({ usluga_id: p.usluga_id, pracownik: (d.pracownicy_pozycji && d.pracownicy_pozycji[String(p.id)] !== undefined) ? (d.pracownicy_pozycji[String(p.id)] || null) : p.pracownik, czas_min: p.czas_min }));
        const poz = zbudujPozycje(nowePoz, cfg.katalog, cfg.pracownicy);
        const k = await kontekstDnia(tenant, start.slice(0, 10), cfg, rez.id_klienta);
        k.klientZajety = k.klientZajety.filter(x => String(x.rezerwacja_id) !== String(rez.id));
        const w = S.sprawdzKomplet({ ...k, start, pozycje: poz, pominRezerwacje: rez.id });
        const podglad = { obecny: { start: rez.start, koniec: rez.koniec, pozycje: aktywne.map(p => ({ id: p.id, nazwa: p.kategoria + (p.wariant ? ' / ' + p.wariant : ''), pracownik: p.pracownik, start: p.start, koniec: p.koniec })) }, nowy: { start: w.start, koniec: w.koniec, pozycje: w.pozycje.map(p => ({ nazwa: p.nazwa, pracownik: p.pracownik, start: p.start, koniec: p.koniec, gabinet_id: p.gabinet_id, urzadzenie_id: p.urzadzenie_id })) }, ok: w.ok, problemy: w.problemy };
        if (!w.ok) return { status: 'konflikt', message: w.problemy[0] ? w.problemy[0].opis : 'Wybrany komplet nie jest dostępny.', podglad, alternatywy: await alternatywy(tenant, start.slice(0, 10), poz, cfg, rez.id_klienta, rez.id) };
        if (!d.potwierdz) return { status: 'success', podglad, message: 'Obecna wizyta pozostaje — zmienimy ją po zatwierdzeniu.' };
        const conn = await polacz();
        try {
          const lock = await qc(conn, `SELECT GET_LOCK(?, 8) AS l`, ['trm:' + tenant]);
          if (!lock[0] || Number(lock[0].l) !== 1) throw new BladUzytkownika('Salon zapisuje właśnie inną wizytę. Spróbuj za chwilę.');
          try {
            // ponowne sprawdzenie pod blokadą (R08) i kontrola wersji w UPDATE
            const k2 = await kontekstDnia(tenant, start.slice(0, 10), cfg, rez.id_klienta);
            k2.klientZajety = k2.klientZajety.filter(x => String(x.rezerwacja_id) !== String(rez.id));
            const w2 = S.sprawdzKomplet({ ...k2, start, pozycje: poz, pominRezerwacje: rez.id });
            if (!w2.ok) return { status: 'konflikt', message: 'Termin został w międzyczasie zajęty. ' + (w2.problemy[0] ? w2.problemy[0].opis : ''), podglad: { ...podglad, ok: false, problemy: w2.problemy }, alternatywy: await alternatywy(tenant, start.slice(0, 10), poz, cfg, rez.id_klienta, rez.id) };
            await begin(conn);
            const up = await qc(conn, `UPDATE Term_Rezerwacje SET start = ?, koniec = ?, wersja = wersja + 1, zmieniono = NOW() WHERE tenant_id = ? AND id = ? AND wersja = ?`, [w2.start, w2.koniec, tenant, rez.id, rez.wersja]);
            if (!up.affectedRows) { await rollback(conn); throw new BladUzytkownika('Ktoś zmienił tę wizytę. Sprawdź aktualne dane przed zapisaniem.', { code: 'WERSJA' }); }
            await qc(conn, `UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND rezerwacja_id = ?`, [tenant, rez.id]);
            for (let i = 0; i < w2.pozycje.length; i++) {
              const p = w2.pozycje[i], stara = aktywne[i];
              await qc(conn, `UPDATE Term_Pozycje SET pracownik = ?, start = ?, koniec = ?, gabinet_id = ?, urzadzenie_id = ? WHERE tenant_id = ? AND id = ?`, [p.pracownik, p.start, p.koniec, p.gabinet_id ? Number(p.gabinet_id) : null, p.urzadzenie_id ? Number(p.urzadzenie_id) : null, tenant, stara.id]);
              for (const z of p.zajecia) await qc(conn, `INSERT INTO Term_Zajecia (tenant_id, rezerwacja_id, pozycja_id, typ_zasobu, klucz, od, do_, powod) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, rez.id, stara.id, z.typ_zasobu, String(z.klucz), S.naStr(z.od), S.naStr(z.do), z.powod]);
            }
            await historia(conn, tenant, rez.id, imie, 'przelozono', `${rez.start.slice(0, 16)} → ${w2.start.slice(0, 16)}${d.powod ? ' — ' + String(d.powod).slice(0, 200) : ''}`, podglad.obecny, podglad.nowy);
            await commit(conn);
            zapiszLog(tenant, 'TERMINARZ: ZMIANA TERMINU', imie, `${rez.numer} ${rez.klient_nazwa}: ${rez.start.slice(0, 16)} → ${w2.start.slice(0, 16)}`);
            return { status: 'success', rezerwacja: await rezerwacja(tenant, rez.id) };
          } finally { await qc(conn, `SELECT RELEASE_LOCK(?)`, ['trm:' + tenant]).catch(() => {}); }
        } catch (e) { await rollback(conn); throw e; } finally { conn.release(); }
      }
      case 'trm_anuluj': {
        wymagaj(r, ROLE_OPERACYJNE);
        const rez = await rezerwacja(tenant, d.id);
        if (!rez) throw new BladUzytkownika('Nie znaleziono wizyty.');
        if (['anulowana', 'odrzucona', 'wygasla'].includes(rez.status)) return { status: 'success', powtorzenie: true, rezerwacja: rez }; // T159
        if (Number(d.wersja) !== Number(rez.wersja)) throw new BladUzytkownika('Ktoś zmienił tę wizytę. Sprawdź aktualne dane przed zapisaniem.', { code: 'WERSJA', rezerwacja: rez });
        const pozId = d.pozycja_id ? Number(d.pozycja_id) : null;
        const cel = pozId ? rez.pozycje.filter(p => p.id === pozId) : rez.pozycje.filter(p => p.stan === 'zaplanowana');
        if (pozId && (!cel.length || cel[0].stan !== 'zaplanowana')) throw new BladUzytkownika('Tę pozycję można anulować tylko, gdy jest jeszcze zaplanowana (wykonanej części nie anulujemy).');
        if (!cel.length) throw new BladUzytkownika('Nie ma już zaplanowanych pozycji do anulowania — wykonaną część rozlicz lub skoryguj.');
        const kto = d.kto_anulowal === 'klient' ? 'klient' : 'salon';
        const powod = String(d.powod || '').trim().slice(0, 255);
        if (!powod) throw new BladUzytkownika('Podaj powód odwołania.');
        const conn = await polacz();
        try {
          await begin(conn);
          for (const p of cel) {
            await qc(conn, `UPDATE Term_Pozycje SET stan = 'anulowana' WHERE tenant_id = ? AND id = ?`, [tenant, p.id]);
            await qc(conn, `UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND pozycja_id = ? AND od >= NOW()`, [tenant, p.id]);
            await qc(conn, `UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND pozycja_id = ? AND powod = 'bufor'`, [tenant, p.id]);
          }
          const pozostale = rez.pozycje.filter(p => !cel.some(c => c.id === p.id) && p.stan !== 'anulowana');
          const calosc = pozostale.length === 0 || pozostale.every(p => ['niewykonana', 'odmowa'].includes(p.stan));
          const nicNieWykonano = !rez.pozycje.some(p => ['wykonana', 'przerwana', 'w_trakcie'].includes(p.stan));
          if (calosc && nicNieWykonano) {
            await qc(conn, `UPDATE Term_Rezerwacje SET status = 'anulowana', anulowano = NOW(), anulowal = ?, powod_anulacji = ?, kto_anulowal = ?, wersja = wersja + 1, zmieniono = NOW() WHERE tenant_id = ? AND id = ? AND wersja = ?`, [imie || null, powod, kto, tenant, rez.id, rez.wersja]);
            await qc(conn, `UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND rezerwacja_id = ?`, [tenant, rez.id]);
          } else {
            // częściowa anulacja: wizyta pozostaje, koniec przeliczony z pozostałych pozycji (R13: zwolnienie po zapisie)
            const kon = pozostale.length ? pozostale.map(p => p.koniec).sort().slice(-1)[0] : rez.koniec;
            const st = pozostale.length ? pozostale.map(p => p.start).sort()[0] : rez.start;
            await qc(conn, `UPDATE Term_Rezerwacje SET start = ?, koniec = ?, wersja = wersja + 1, zmieniono = NOW() WHERE tenant_id = ? AND id = ? AND wersja = ?`, [st, kon, tenant, rez.id, rez.wersja]);
          }
          const pozn = cel.map(p => p.kategoria + (p.wariant ? ' / ' + p.wariant : '')).join(', ');
          await historia(conn, tenant, rez.id, imie, calosc && nicNieWykonano ? 'anulowano' : 'anulowano_pozycje', `${kto === 'klient' ? 'Klientka odwołała' : 'Salon odwołał'}: ${pozn} — ${powod}`, null, { pozycje: cel.map(p => p.id) });
          await commit(conn);
          zapiszLog(tenant, 'TERMINARZ: ODWOŁANIE', imie, `${rez.numer} ${rez.klient_nazwa} (${kto}): ${pozn} — ${powod}`);
        } catch (e) { await rollback(conn); throw e; } finally { conn.release(); }
        const po = await rezerwacja(tenant, rez.id);
        return { status: 'success', rezerwacja: po, rozrachunek: 'Rozliczenie środków (zadatki, karnet) wykonuje się w istniejących modułach — terminarz ich nie zmienia.' };
      }
      case 'trm_obecnosc': {
        wymagaj(r, ROLE_OPERACYJNE);
        const rez = await rezerwacja(tenant, d.id);
        if (!rez) throw new BladUzytkownika('Nie znaleziono wizyty.');
        if (!OBECNOSCI.includes(d.obecnosc)) throw new BladUzytkownika('Nieznany stan obecności.');
        if (['anulowana', 'odrzucona', 'wygasla'].includes(rez.status)) throw new BladUzytkownika('Wizyta anulowana — nie oznaczamy obecności.');
        if (rez.obecnosc === d.obecnosc) return { status: 'success', powtorzenie: true, rezerwacja: rez };
        const conn = await polacz();
        try {
          await begin(conn);
          await qc(conn, `UPDATE Term_Rezerwacje SET obecnosc = ?, obecnosc_zmieniono = NOW(), zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [d.obecnosc, tenant, rez.id]);
          if (d.obecnosc === 'nieobecny') {
            // Nieobecność: przyszłe zasoby zwalnia decyzja człowieka; pozycje zaplanowane → niewykonane (T158: jednostka karnetu wraca — nie zużywamy jej)
            await qc(conn, `UPDATE Term_Pozycje SET stan = 'niewykonana' WHERE tenant_id = ? AND rezerwacja_id = ? AND stan = 'zaplanowana'`, [tenant, rez.id]);
            await qc(conn, `UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND rezerwacja_id = ? AND do_ > NOW()`, [tenant, rez.id]);
          }
          await historia(conn, tenant, rez.id, imie, 'obecnosc', `${rez.obecnosc} → ${d.obecnosc}${d.powod ? ' — ' + String(d.powod).slice(0, 200) : ''}`, { obecnosc: rez.obecnosc }, { obecnosc: d.obecnosc });
          await commit(conn);
        } catch (e) { await rollback(conn); throw e; } finally { conn.release(); }
        return { status: 'success', rezerwacja: await rezerwacja(tenant, rez.id) };
      }
      case 'trm_pozycja_stan': {
        const rez = await rezerwacja(tenant, d.id);
        if (!rez) throw new BladUzytkownika('Nie znaleziono wizyty.');
        const p = rez.pozycje.find(x => x.id === Number(d.pozycja_id));
        if (!p) throw new BladUzytkownika('Nie znaleziono pozycji.');
        const stan = d.stan;
        if (!['w_trakcie', 'wykonana', 'przerwana', 'niewykonana', 'odmowa'].includes(stan)) throw new BladUzytkownika('Nieznany stan wykonania.');
        // specjalista tylko własne pozycje (T028), recepcja/manager wszystkie
        if (!ROLE_OPERACYJNE.has(r)) { if (!ROLE_SPECJALISTA.has(r) || p.pracownik !== imie) throw new BladUzytkownika('Możesz prowadzić tylko własne usługi — poproś o przekazanie.'); }
        if (p.stan === stan) return { status: 'success', powtorzenie: true, rezerwacja: rez }; // T121: drugie „Zakończ” nic nie zmienia
        const dozw = { zaplanowana: ['w_trakcie', 'wykonana', 'niewykonana', 'odmowa'], w_trakcie: ['wykonana', 'przerwana'] };
        if (!(dozw[p.stan] || []).includes(stan)) throw new BladUzytkownika(`Z „${p.stan}” nie można przejść do „${stan}”.`);
        if (['w_trakcie', 'wykonana'].includes(stan) && rez.obecnosc === 'oczekiwana') await q(`UPDATE Term_Rezerwacje SET obecnosc = 'przybyl', obecnosc_zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [tenant, rez.id]);
        const wyk = d.wykonawca ? String(d.wykonawca).trim() : (imie || p.pracownik);
        const conn = await polacz();
        try {
          await begin(conn);
          if (stan === 'w_trakcie') await qc(conn, `UPDATE Term_Pozycje SET stan = 'w_trakcie', start_fakt = NOW(), wykonawca_fakt = ? WHERE tenant_id = ? AND id = ?`, [wyk, tenant, p.id]);
          else if (stan === 'wykonana' || stan === 'przerwana') await qc(conn, `UPDATE Term_Pozycje SET stan = ?, start_fakt = COALESCE(start_fakt, start), koniec_fakt = NOW(), wykonawca_fakt = COALESCE(wykonawca_fakt, ?) WHERE tenant_id = ? AND id = ?`, [stan, wyk, tenant, p.id]);
          else await qc(conn, `UPDATE Term_Pozycje SET stan = ? WHERE tenant_id = ? AND id = ?`, [stan, tenant, p.id]);
          if (['niewykonana', 'odmowa', 'przerwana'].includes(stan)) await qc(conn, `UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND pozycja_id = ? AND do_ > NOW()`, [tenant, p.id]);
          await historia(conn, tenant, rez.id, imie, 'wykonanie', `${p.kategoria}${p.wariant ? ' / ' + p.wariant : ''}: ${p.stan} → ${stan}${d.uwaga ? ' — ' + String(d.uwaga).slice(0, 200) : ''}`, { stan: p.stan }, { stan, wykonawca: wyk });
          await commit(conn);
        } catch (e) { await rollback(conn); throw e; } finally { conn.release(); }
        return { status: 'success', rezerwacja: await rezerwacja(tenant, rez.id) };
      }

      // ───────── most do Sprzedaży (E11) ─────────
      case 'trm_rozlicz_start': {
        wymagaj(r, ROLE_OPERACYJNE);
        const rez = await rezerwacja(tenant, d.id);
        if (!rez) throw new BladUzytkownika('Nie znaleziono wizyty.');
        if (rez.sprzedaz_id) return { status: 'success', juz_rozliczona: true, sprzedaz_id: rez.sprzedaz_id, rezerwacja: rez };
        const wykonane = rez.pozycje.filter(p => ['wykonana', 'przerwana'].includes(p.stan));
        if (!wykonane.length) throw new BladUzytkownika('Rozliczamy tylko faktycznie wykonane usługi — najpierw oznacz wykonanie.');
        await q(`UPDATE Term_Rezerwacje SET rozliczenie_od = COALESCE(rozliczenie_od, NOW()) WHERE tenant_id = ? AND id = ?`, [tenant, rez.id]);
        return { status: 'success', prefill: { klient: rez.klient_nazwa, id_klienta: rez.id_klienta, pozycje: wykonane.map(p => ({ kategoria: p.kategoria, wariant: p.wariant, cena: p.cena, pracownik: p.wykonawca_fakt || p.pracownik, czesciowo: p.stan === 'przerwana' })) }, rezerwacja: await rezerwacja(tenant, rez.id) };
      }
      case 'trm_rozlicz_powiaz': {
        wymagaj(r, ROLE_OPERACYJNE);
        const rez = await rezerwacja(tenant, d.id);
        if (!rez) throw new BladUzytkownika('Nie znaleziono wizyty.');
        if (rez.sprzedaz_id) return { status: 'success', juz_rozliczona: true, sprzedaz_id: rez.sprzedaz_id, rezerwacja: rez };
        if (!rez.rozliczenie_od) throw new BladUzytkownika('Najpierw kliknij „Rozlicz” — wtedy wiemy, od kiedy szukać sprzedaży.');
        const sId = d.sprzedaz_id ? String(d.sprzedaz_id) : null;
        let rows;
        if (sId) rows = await q(`SELECT id, DATE_FORMAT(data_sprzedazy,'%Y-%m-%d %H:%i') AS data, zabieg, kwota FROM Sprzedaz WHERE tenant_id = ? AND (id = ? OR id LIKE ?) AND status = 'AKTYWNY'`, [tenant, sId, sId + '-%']);
        else rows = await q(`SELECT id, DATE_FORMAT(data_sprzedazy,'%Y-%m-%d %H:%i') AS data, zabieg, kwota FROM Sprzedaz WHERE tenant_id = ? AND status = 'AKTYWNY' AND data_sprzedazy >= ? AND (id_klienta = ? OR (id_klienta IS NULL AND klient = ?)) ORDER BY data_sprzedazy DESC, id LIMIT 20`, [tenant, rez.rozliczenie_od, rez.id_klienta || '', rez.klient_nazwa]);
        if (!rows.length) return { status: 'success', znaleziono: false, message: 'Nie znaleziono jeszcze sprzedaży tej klientki zapisanej po kliknięciu „Rozlicz”. Zatwierdź sprzedaż, potem wróć i kliknij „Powiąż”.' };
        const baza = String(rows[0].id).replace(/-\d+$/, '');
        const juz = await q(`SELECT id FROM Term_Rezerwacje WHERE tenant_id = ? AND sprzedaz_id = ? AND id <> ?`, [tenant, baza, rez.id]);
        if (juz.length) throw new BladUzytkownika(`Ta sprzedaż jest już powiązana z wizytą EST-${String(juz[0].id).padStart(4, '0')}.`);
        const conn = await polacz();
        try {
          await begin(conn);
          await qc(conn, `UPDATE Term_Rezerwacje SET sprzedaz_id = ?, zmieniono = NOW() WHERE tenant_id = ? AND id = ? AND sprzedaz_id IS NULL`, [baza, tenant, rez.id]);
          await qc(conn, `UPDATE Term_Pozycje SET sprzedaz_id = ? WHERE tenant_id = ? AND rezerwacja_id = ? AND stan IN ('wykonana','przerwana')`, [baza, tenant, rez.id]);
          await historia(conn, tenant, rez.id, imie, 'rozliczono', `Powiązano ze sprzedażą ${baza}`, null, { sprzedaz_id: baza });
          await commit(conn);
        } catch (e) { await rollback(conn); throw e; } finally { conn.release(); }
        zapiszLog(tenant, 'TERMINARZ: ROZLICZENIE', imie, `${rez.numer} ${rez.klient_nazwa} → sprzedaż ${baza}`);
        return { status: 'success', znaleziono: true, sprzedaz_id: baza, sprzedaz: rows.filter(x => String(x.id).replace(/-\d+$/, '') === baza), rezerwacja: await rezerwacja(tenant, rez.id) };
      }
      case 'trm_notatka': {
        wymagaj(r, ROLE_OPERACYJNE);
        await q(`UPDATE Term_Rezerwacje SET notatka = ?, zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [String(d.notatka || '').slice(0, 2000) || null, tenant, Number(d.id)]);
        return { status: 'success' };
      }
      default:
        throw new BladUzytkownika('Nieznana akcja terminarza: ' + action);
    }
  }

  return router;
};
module.exports.FEATURE_KEY = FEATURE_KEY;
module.exports.AKCJE = ['trm_init', 'trm_ustawienia_zapisz', 'trm_zasob_zapisz', 'trm_zasob_archiwizuj', 'trm_usluga_zapisz', 'trm_grafik_zapisz', 'trm_grafik_z_godzin_salonu', 'trm_nieobecnosc_zapisz', 'trm_nieobecnosc_usun', 'trm_zespol_zapisz', 'trm_dzien', 'trm_zakres', 'trm_rezerwacja', 'trm_szukaj_klienta', 'trm_sprawdz', 'trm_szukaj', 'trm_zapisz', 'trm_zmien', 'trm_anuluj', 'trm_obecnosc', 'trm_pozycja_stan', 'trm_rozlicz_start', 'trm_rozlicz_powiaz', 'trm_notatka'];
