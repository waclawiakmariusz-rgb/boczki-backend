const { getSession } = require('./sessions'); // C06/A24: tożsamość osoby z sesji PIN
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
const Z = require('./terminarz-zakupy'); // ZK-02: ewidencja jednostek zakupionych zabiegów (model v2) — jedyny właściciel salda

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
  // kolumny dodawane idempotentnie (ER_DUP_FIELDNAME = już jest); zawsze NULL-owalne / z domyślną wartością, żeby stary kod działał bez zmian
  const alterKolumna = (tabela, kolumna, def) => db.query(`ALTER TABLE ${tabela} ADD COLUMN ${kolumna} ${def}`, (e) => { if (e && e.code !== 'ER_DUP_FIELDNAME') log.error(`[terminarz] ALTER ${tabela}.${kolumna}:`, e.message); });

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
  // ── T02/T03 (raport naprawczy 2026-10-15): zakupy klientki i jednostki zabiegowe — WSZYSTKO dodatkowe, bez zmian
  // w Sprzedaz/Uslugi. Trzy znaczenia: usługa wykonywana (Uslugi.id z czasem/zasobami), oferta sprzedażowa (wiersz
  // cennika, np. „1 obszar 4x”) → Term_Oferty mapuje ją na składniki wykonywane, zakup klientki (wiersz Sprzedaz) → Term_Zakupy.
  mk(`CREATE TABLE IF NOT EXISTS Term_Oferty (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      usluga_id VARCHAR(36) NOT NULL,
      stan VARCHAR(16) NOT NULL DEFAULT 'propozycja',
      zrodlo VARCHAR(16) NOT NULL DEFAULT 'tekst',
      zatwierdzil VARCHAR(100) NULL,
      zatwierdzono DATETIME NULL,
      zmieniono DATETIME NULL,
      UNIQUE KEY uq_oferta (tenant_id, usluga_id)
    )${KOL}`, 'Term_Oferty');
  mk(`CREATE TABLE IF NOT EXISTS Term_Oferty_Skladniki (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      oferta_id INT NOT NULL,
      usluga_wyk_id VARCHAR(36) NOT NULL,
      jednostki INT NOT NULL DEFAULT 1,
      INDEX idx_of (tenant_id, oferta_id)
    )${KOL}`, 'Term_Oferty_Skladniki');
  mk(`CREATE TABLE IF NOT EXISTS Term_Zakupy (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      sprzedaz_id VARCHAR(50) NOT NULL,
      id_klienta VARCHAR(50) NULL,
      klient_nazwa VARCHAR(255) NULL,
      oferta_id INT NOT NULL,
      usluga_id VARCHAR(36) NOT NULL,
      nazwa VARCHAR(300) NULL,
      data_zakupu DATE NULL,
      data_waznosci DATE NULL,
      stan VARCHAR(16) NOT NULL DEFAULT 'aktywny',
      bilans_status VARCHAR(20) NOT NULL DEFAULT 'niezweryfikowany',
      zweryfikowal VARCHAR(100) NULL,
      zweryfikowano DATETIME NULL,
      powod_korekty VARCHAR(300) NULL,
      utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sprz (tenant_id, sprzedaz_id),
      INDEX idx_kl (tenant_id, id_klienta)
    )${KOL}`, 'Term_Zakupy');
  mk(`CREATE TABLE IF NOT EXISTS Term_Zakupy_Skladniki (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      zakup_id INT NOT NULL,
      usluga_wyk_id VARCHAR(36) NOT NULL,
      jednostki_przyznane INT NOT NULL DEFAULT 1,
      jednostki_historyczne INT NOT NULL DEFAULT 0,
      INDEX idx_z (tenant_id, zakup_id)
    )${KOL}`, 'Term_Zakupy_Skladniki');
  mk(`CREATE TABLE IF NOT EXISTS Term_Zakupy_Ruchy (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      skladnik_id INT NOT NULL,
      pozycja_id INT NULL,
      typ VARCHAR(12) NOT NULL,
      jednostki INT NOT NULL DEFAULT 1,
      kto VARCHAR(100) NULL,
      kiedy DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      powod VARCHAR(300) NULL,
      UNIQUE KEY uq_poz_typ (tenant_id, pozycja_id, typ),
      INDEX idx_s (tenant_id, skladnik_id)
    )${KOL}`, 'Term_Zakupy_Ruchy');
  alterKolumna('Term_Pozycje', 'zakup_skladnik_id', 'INT NULL');
  alterKolumna('Term_Ustawienia', 'kontrola_zakupow', "VARCHAR(5) NOT NULL DEFAULT 'off'");
  // ── C07: rejestr stanu schematu. Każdy krok DDL powyżej jest idempotentny, ale jego wynik był dotąd tylko w logu.
  // Term_Migracje zapisuje, które elementy schematu zakupów są obecne; brak kolumny NIE może cicho wyłączyć kontroli —
  // trm_zapisz/trm_ustawienia_zapisz odmawiają włączenia/użycia zakupów, gdy schemat jest niekompletny.
  mk(`CREATE TABLE IF NOT EXISTS Term_Migracje (
      nazwa VARCHAR(120) NOT NULL PRIMARY KEY,
      wersja VARCHAR(20) NOT NULL,
      obecna TINYINT(1) NOT NULL DEFAULT 0,
      sprawdzono DATETIME NOT NULL,
      uwaga VARCHAR(255) NULL
    )${KOL}`, 'Term_Migracje');
  const SCHEMAT_ZAKUPOW = [['Term_Oferty', null], ['Term_Oferty_Skladniki', null], ['Term_Zakupy', null], ['Term_Zakupy_Skladniki', null], ['Term_Zakupy_Ruchy', null], ['Term_Pozycje', 'zakup_skladnik_id'], ['Term_Ustawienia', 'kontrola_zakupow']];
  const schemat = { wersja: '2026-10-15', sprawdzono: null, gotowy: false, braki: [] };
  async function sprawdzSchemat() {
    try {
      const rows = await q(`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('Term_Oferty','Term_Oferty_Skladniki','Term_Zakupy','Term_Zakupy_Skladniki','Term_Zakupy_Ruchy','Term_Pozycje','Term_Ustawienia')`);
      const braki = [];
      for (const [t, c] of SCHEMAT_ZAKUPOW) {
        const jest = c ? rows.some(r => String(r.t).toLowerCase() === t.toLowerCase() && String(r.c).toLowerCase() === c.toLowerCase()) : rows.some(r => String(r.t).toLowerCase() === t.toLowerCase()); // bez względu na wielkość liter (lower_case_table_names=1 na Windows zwraca nazwy małymi literami)
        if (!jest) braki.push(c ? `${t}.${c}` : t);
        await q(`INSERT INTO Term_Migracje (nazwa, wersja, obecna, sprawdzono) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE wersja = VALUES(wersja), obecna = VALUES(obecna), sprawdzono = NOW()`, [c ? `${t}.${c}` : t, schemat.wersja, jest ? 1 : 0]);
      }
      schemat.braki = braki; schemat.gotowy = braki.length === 0; schemat.sprawdzono = new Date().toISOString();
      if (braki.length) log.error('[terminarz] schemat zakupów niekompletny:', braki.join(', '));
    } catch (e) { schemat.gotowy = false; schemat.braki = ['(nie udało się sprawdzić: ' + e.message + ')']; log.error('[terminarz] sprawdzSchemat:', e.message); }
    return schemat;
  }
  if (!process.env.JEST_WORKER_ID && process.env.NODE_ENV !== 'test') setTimeout(() => { sprawdzSchemat(); }, 4000); // po CREATE/ALTER wyżej
  // ── Sekcja 0 odbioru: integracja zakupów (T02/T03) jest ODSEPAROWANA od terminarza. Włącza ją wyłącznie właściciel,
  // listą salonów w zmiennej środowiskowej TERMINARZ_ZAKUPY_TENANTS (np. „demo-estelio,inny-salon”). Bez wpisu: brak
  // importu, brak rezerwacji jednostek, brak UI zakupów; kontrola_zakupow traktowana jak „off”. Kod i tabele zostają.
  const zakupyAktywne = (tenant) => String(process.env.TERMINARZ_ZAKUPY_TENANTS || '').split(',').map(s => s.trim()).filter(Boolean).includes(String(tenant));
  // ── ZK-02: schemat v2 ewidencji NIE jest tworzony przy starcie (kontrolowana migracja: narzedzia/terminarz-zakupy-migracja.js).
  // Start tylko sprawdza obecność elementów; brak = ewidencja niedostępna (dodatek zgłasza własną niedostępność, rdzeń działa).
  const schematV2 = { wersja: Z.WERSJA_SCHEMATU_V2, sprawdzono: null, gotowy: false, braki: ['(nie sprawdzono)'] };
  async function sprawdzSchematV2() { const w = await Z.sprawdzSchematV2(q, log); Object.assign(schematV2, w); return schematV2; }
  if (!process.env.JEST_WORKER_ID && process.env.NODE_ENV !== 'test') setTimeout(() => { sprawdzSchematV2(); }, 4500);
  const integracjaZakupow = (tenant) => zakupyAktywne(tenant) && schemat.gotowy && schematV2.gotowy;
  /**
   * Stan ewidencji salonu (§14.1, R4) — trzy niezależne rzeczy: dostępność techniczna (env + schematy), ZAPISANY stan (Term_Ewidencja —
   * nigdy nie maskowany przez brak dostępności) i tryb efektywny (co wolno teraz). Bez dostępności technicznej tryb efektywny = „niedostepna”
   * (każda mutacja jednostek odrzucona w całości, historia zachowana); po przerwie (przerwa_od) = „uzgadnianie” do decyzji managera.
   */
  async function stanEwidencji(tenant) {
    const techniczna = integracjaZakupow(tenant);
    const rows = schematV2.gotowy ? await q(`SELECT tryb, rozpoczeto, przerwa_od, punkt_uzgodnienia, zakonczono FROM Term_Ewidencja WHERE tenant_id = ?`, [tenant]).catch(() => []) : [];
    const zapisany = rows.length && Z.TRYBY.includes(rows[0].tryb) ? rows[0].tryb : 'nie_uruchomiono';
    const przerwa = rows.length && rows[0].przerwa_od ? String(rows[0].przerwa_od).slice(0, 19) : null;
    const tryb = !techniczna ? 'niedostepna' : (przerwa && ['aktywna', 'konczenie'].includes(zapisany) ? 'uzgadnianie' : zapisany);
    return { techniczna, zapisany, tryb, przerwa_od: przerwa, rozpoczeto: rows.length && rows[0].rozpoczeto ? String(rows[0].rozpoczeto).slice(0, 19) : null };
  }
  const trybEwidencji = async (tenant) => (await stanEwidencji(tenant)).tryb;
  /** Kontekst operacji jednostkowej: autor WYŁĄCZNIE z sesji PIN (router sprawdza tożsamość) + stabilny identyfikator konta (R6), czas serwera, stan ewidencji. */
  async function ctxZ(tenant, imie, r) {
    const konto = imie ? (await q(`SELECT id FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`, [tenant, imie]).catch(() => []))[0] : null;
    const st = await stanEwidencji(tenant);
    return { tenant, autor: imie || null, autor_id: konto ? String(konto.id) : null, rola: r, teraz: await teraz(), tryb: st.tryb, techniczna: st.techniczna, zapisany: st.zapisany, przerwa_od: st.przerwa_od, widziKwoty: ROLE_OPERACYJNE.has(r) };
  }
  /**
   * Jedyna droga mutacji jednostek (§15.2): GET_LOCK salonu → BEGIN → fn(conn, repo) → COMMIT → RELEASE_LOCK; błąd = ROLLBACK.
   * Blokada i zwolnienie na TYM SAMYM połączeniu; blokada jest po stronie serwera MySQL (działa też przy wielu procesach).
   * Uwaga: chroni tylko operacje tego modułu — edycje w Sprzedaży jej nie używają; dlatego źródło jest czytane ponownie w transakcji (LOCK IN SHARE MODE).
   */
  async function wTransakcjiSalonu(tenant, fn) {
    const conn = await polacz();
    try {
      // R3: na czas kontrolowanej migracji schematu (blokada 'trm:migracja' trzymana przez narzędzie) operacje dodatku są odrzucane; rdzeń nie jest wstrzymywany
      const wolna = await qc(conn, `SELECT IS_FREE_LOCK('trm:migracja') AS w`);
      if (wolna[0] && Number(wolna[0].w) === 0) throw new BladUzytkownika('Trwa migracja schematu ewidencji zakupów — spróbuj za chwilę.', { code: 'MIGRACJA' });
      const lock = await qc(conn, `SELECT GET_LOCK(?, 8) AS l`, ['trm:' + tenant]);
      if (!lock[0] || Number(lock[0].l) !== 1) throw new BladUzytkownika('Salon zapisuje właśnie inną wizytę. Spróbuj za chwilę.', { code: 'BLOKADA' });
      try {
        await begin(conn);
        const repo = Z.repoSql((sql, params) => qc(conn, sql, params), tenant);
        try { const wynik = await fn(conn, repo); await commit(conn); return wynik; }
        catch (e) {
          await rollback(conn);
          if (e && e.utrwalPoRollback && schematV2.gotowy) { // zmiana źródła wykryta w transakcji ma zostać utrwalona mimo odrzucenia operacji (R6): zakup „do wyjaśnienia” + sprawa
            const u = e.utrwalPoRollback;
            await q(`UPDATE Term_Zakupy SET stan_zrodla = ?, wersja = wersja + 1 WHERE tenant_id = ? AND id = ?`, [u.stan_zrodla, tenant, u.zakup_id]).catch(() => {});
            await sprawaZrodla(tenant, { zakup_id: u.zakup_id, zmiana: u.zmiana, stan_zrodla: u.stan_zrodla, kto: null }).catch(() => {});
          }
          if (e && e.extra && e.extra.code === 'EWIDENCJA_NIEDOSTEPNA' && schematV2.gotowy) { // R4: odmowa przy istniejących przydziałach = rzeczywista przerwa ewidencji (powrót wymaga uzgodnienia)
            await q(`UPDATE Term_Ewidencja SET przerwa_od = COALESCE(przerwa_od, NOW()) WHERE tenant_id = ? AND tryb IN ('aktywna','konczenie')`, [tenant]).catch(() => {});
          }
          throw e;
        }
      } finally { await qc(conn, `SELECT RELEASE_LOCK(?)`, ['trm:' + tenant]).catch(() => {}); }
    } finally { conn.release(); }
  }
  /** Sprawa „zakup zmieniony w Sprzedaży” (E20) — jedna na zakup, aktualizowana (klucz dedup per zakup), nie co 5 minut nowa. */
  async function sprawaZrodla(tenant, { zakup_id, zmiana, stan_zrodla, nazwa, id_klienta, kto }) {
    const opis = `${nazwa ? nazwa + ': ' : ''}${zmiana === 'usuniete' ? 'zakup usunięty w Sprzedaży' : zmiana === 'zwrot' ? (stan_zrodla === 'wycofane' ? 'zwrot całości — uprawnienia wycofane' : 'zwrot części — zakres do ustalenia (nie przeliczamy kwoty na zabiegi)') : 'zmiana istotnych danych sprzedaży'}; nowe umówienia z tego zakupu wstrzymane do wyjaśnienia.`;
    return sprawaUpsert(tenant, { typ: 'E20', tytul: 'Zakup zmieniony w Sprzedaży — wymaga wyjaśnienia', opis, dane: { zakup_id, id_klienta: id_klienta || null, zmiana, stan_zrodla, dotyczy: [] }, priorytet: 'P1', klucz: `E20:${zakup_id}`, kto: kto || null, dziennikOpis: opis });
  }
  mk(`CREATE TABLE IF NOT EXISTS Term_Sprawy (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      typ VARCHAR(10) NOT NULL,
      rezerwacja_id INT NULL,
      tytul VARCHAR(255) NOT NULL,
      opis TEXT NULL,
      dane_json TEXT NULL,
      priorytet VARCHAR(2) NOT NULL DEFAULT 'P2',
      priorytet_bazowy VARCHAR(2) NOT NULL DEFAULT 'P2',
      stan VARCHAR(12) NOT NULL DEFAULT 'nowa',
      wlasciciel VARCHAR(100) NULL,
      termin_dzialania DATETIME NULL,
      powiazany_czas DATETIME NULL,
      wynik TEXT NULL,
      rozwiazal VARCHAR(100) NULL,
      rozwiazano DATETIME NULL,
      eskalowano_o DATETIME NULL,
      utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      zmieniono DATETIME NULL,
      klucz_dedup VARCHAR(190) NOT NULL,
      UNIQUE KEY uq_dedup (tenant_id, klucz_dedup),
      INDEX idx_lista (tenant_id, stan, priorytet),
      INDEX idx_rez (tenant_id, rezerwacja_id)
    )${KOL}`, 'Term_Sprawy');
  mk(`CREATE TABLE IF NOT EXISTS Term_Sprawy_Dziennik (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      sprawa_id INT NOT NULL,
      kiedy DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      kto VARCHAR(100) NULL,
      akcja VARCHAR(24) NOT NULL,
      opis VARCHAR(500) NULL,
      INDEX idx_sprawa (tenant_id, sprawa_id)
    )${KOL}`, 'Term_Sprawy_Dziennik');
  mk(`CREATE TABLE IF NOT EXISTS Term_Sprawy_Odczyt (
      tenant_id VARCHAR(100) NOT NULL,
      sprawa_id INT NOT NULL,
      pracownik VARCHAR(100) NOT NULL,
      przeczytano DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, sprawa_id, pracownik)
    )${KOL}`, 'Term_Sprawy_Odczyt');
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
    const integracja = integracjaZakupow(tenant); // env + schemat v1 + schemat v2
    return { tryb: u.tryb, siatka_min: u.siatka_min, tolerancja_min: u.tolerancja_min, horyzont_dni: u.horyzont_dni, wyprzedzenie_min: u.wyprzedzenie_min, godziny: json(u.godziny_json, DOMYSLNE_GODZINY), wersja: u.wersja,
      zakupy_integracja: integracja ? 'on' : 'off', kontrola_zakupow: integracja && u.kontrola_zakupow === 'on' ? 'on' : 'off', kontrola_zakupow_zapisana: u.kontrola_zakupow === 'on' ? 'on' : 'off',
      // ZK-02: trzy niezależne decyzje (§14.1): dostęp techniczny (zakupy_integracja), tryb ewidencji (manager), dopuszczenie usługi bez zakupu (kontrola_zakupow / Term_Uslugi.wymaga_zakupu)
      ewidencja: integracja ? (await stanEwidencji(tenant)).tryb : 'niedostepna', ewidencja_zapisana: schematV2.gotowy ? (await stanEwidencji(tenant)).zapisany : 'nie_uruchomiono',
      recepcja_potwierdza_wykonanie: !!u.recepcja_potwierdza_wykonanie, potracenie_nieobecnosc: u.potracenie_nieobecnosc === 'on' ? 'on' : 'off', seria_limit: Math.min(50, Math.max(1, Number(u.seria_limit) || 20)) };
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
    const wynik = formatujRez(r, poz);
    if (schematV2.gotowy && poz.length) { // R5: prawdą o jednostkach są przydziały i realizacje (wiele źródeł na pozycję); zakup_skladnik_id to tylko pole zgodności
      const ids = poz.map(p => p.id);
      const [prz, real] = await Promise.all([
        q(`SELECT a.id, a.pozycja_id, a.skladnik_id, a.ilosc, a.ilosc_zuzyta, a.cykl, a.stan, s.usluga_nazwa, z.nazwa AS zakup_nazwa, z.id AS zakup_id FROM Term_Przydzialy a JOIN Term_Zakupy_Skladniki s ON s.id = a.skladnik_id JOIN Term_Zakupy z ON z.id = s.zakup_id WHERE a.tenant_id = ? AND a.pozycja_id IN (${ids.map(() => '?').join(',')}) ORDER BY a.id`, [tenant, ...ids]).catch(() => []),
        q(`SELECT id, pozycja_id, przydzial_id, skladnik_id, ilosc, wykonawca_fakt, DATE_FORMAT(data_fakt,'%Y-%m-%d %H:%i:%s') AS data_fakt, zapisal, cykl, stan, odwrocona_przez FROM Term_Realizacje WHERE tenant_id = ? AND pozycja_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, [tenant, ...ids]).catch(() => []),
      ]);
      wynik.pozycje.forEach(p => { p.przydzialy = prz.filter(x => x.pozycja_id === p.id); p.realizacje = real.filter(x => x.pozycja_id === p.id); p.jednostki_wymagane = (poz.find(x => x.id === p.id) || {}).jednostki_wymagane || 1; p.rozliczenie = (poz.find(x => x.id === p.id) || {}).rozliczenie || null; p.wykonanie_data_fakt = dt((poz.find(x => x.id === p.id) || {}).wykonanie_data_fakt); });
    }
    return wynik;
  }
  function formatujRez(r, poz) {
    return {
      id: r.id, numer: 'EST-' + String(r.id).padStart(4, '0'), id_klienta: r.id_klienta, klient_nazwa: r.klient_nazwa, klient_telefon: r.klient_telefon,
      status: r.status, obecnosc: r.obecnosc, kanal: r.kanal, zrodlo: r.zrodlo, start: r.start_s, koniec: r.koniec_s, notatka: r.notatka, brak_kontaktu: !!r.brak_kontaktu,
      wersja: r.wersja, utworzyl: r.utworzyl, utworzono: dt(r.utworzono), anulowano: dt(r.anulowano), anulowal: r.anulowal, powod_anulacji: r.powod_anulacji, kto_anulowal: r.kto_anulowal,
      sprzedaz_id: r.sprzedaz_id, rozliczenie_od: dt(r.rozliczenie_od),
      pozycje: poz.map(p => ({ id: p.id, kolejnosc: p.kolejnosc, usluga_id: p.usluga_id, kategoria: p.kategoria, wariant: p.wariant, cena: p.cena == null ? null : Number(p.cena), czas_min: p.czas_min, pracownik: p.pracownik, start: p.start_s, koniec: p.koniec_s, gabinet_id: p.gabinet_id, urzadzenie_id: p.urzadzenie_id, gabinet: p.gabinet, urzadzenie: p.urzadzenie, stan: p.stan, start_fakt: dt(p.start_fakt), koniec_fakt: dt(p.koniec_fakt), wykonawca_fakt: p.wykonawca_fakt, zakup_skladnik_id: p.zakup_skladnik_id || null, sprzedaz_id: p.sprzedaz_id })),
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

  // ═══════════ CENTRUM POWIADOMIEŃ: Sprawy (aneks "Centrum powiadomień", zakres etapu A) ═══════════
  // Zdarzenie = już zapisany fakt (Term_Historia). Sprawa = wspólna praca z właścicielem/priorytetem/stanem.
  // Sprawę tworzymy TYLKO dla zdarzeń, które etap A faktycznie generuje — reszta katalogu z aneksu
  // (karnety, SMS, serie, import, przekazanie zmiany) czeka na odpowiednie etapy B/C.
  const prIz = (poz) => [...new Set((poz || []).map(x => x.pracownik).filter(Boolean))];
  /** Priorytet P1 → P0, gdy do powiązanego czasu zostało mniej niż próg (domyślnie 120 min, rozdz. 07 aneksu). */
  function priorytetDlaCzasu(terazStr, czasStr, prog) {
    if (!czasStr) return 'P1';
    return (S.naMin(czasStr) - S.naMin(terazStr)) <= (prog || 120) ? 'P0' : 'P1';
  }
  /** Tworzy sprawę albo cicho odświeża treść istniejącego otwartego wątku tej samej przyczyny (klucz_dedup) —
   * bez duplikatów przy powtórzeniu zdarzenia (np. kolejny tick pollera dla wciąż otwartego E13/E19).
   * Dziennik dostaje wpis TYLKO przy realnej zmianie (świeży wątek, podniesienie priorytetu, wznowienie) —
   * identyczny powtórzony upsert nie zostawia śladu i nie dotyka `zmieniono` (inaczej samo NOW() w UPDATE
   * zawsze zgłaszałoby "zmianę", nawet gdy nic naprawdę się nie stało). */
  async function sprawaUpsert(tenant, { typ, rezerwacja_id = null, tytul, opis = null, dane = null, priorytet = 'P2', powiazany_czas = null, klucz, kto = null, dziennikOpis = null }) {
    try {
      const istniejaca = (await q(`SELECT id, priorytet, stan FROM Term_Sprawy WHERE tenant_id = ? AND klucz_dedup = ?`, [tenant, klucz]))[0];
      const tyt = String(tytul).slice(0, 255), op = opis ? String(opis).slice(0, 2000) : null, dj = dane ? JSON.stringify(dane) : null;
      if (!istniejaca) {
        const ins = await q(`INSERT INTO Term_Sprawy (tenant_id, typ, rezerwacja_id, tytul, opis, dane_json, priorytet, priorytet_bazowy, powiazany_czas, klucz_dedup) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tenant, typ, rezerwacja_id, tyt, op, dj, priorytet, priorytet, powiazany_czas, klucz]);
        await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'zdarzenie', ?)`, [tenant, ins.insertId, kto, (dziennikOpis || tyt).slice(0, 500)]);
        return ins.insertId;
      }
      // eskalacja do P0 nigdy się nie cofa przez zwykłe odświeżenie treści tego samego, wciąż otwartego wątku
      const docelowyPriorytet = istniejaca.priorytet === 'P0' ? 'P0' : priorytet;
      const wznawiamy = ['rozwiazana', 'nieaktualna'].includes(istniejaca.stan);
      const realnaZmiana = wznawiamy || docelowyPriorytet !== istniejaca.priorytet;
      if (realnaZmiana) {
        await q(`UPDATE Term_Sprawy SET tytul = ?, opis = ?, dane_json = ?, priorytet = ?, priorytet_bazowy = ?, powiazany_czas = ?, stan = IF(stan IN ('rozwiazana', 'nieaktualna'), 'nowa', stan), zmieniono = NOW() WHERE id = ?`,
          [tyt, op, dj, docelowyPriorytet, priorytet, powiazany_czas, istniejaca.id]);
        await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'zdarzenie', ?)`, [tenant, istniejaca.id, kto, (dziennikOpis || tyt).slice(0, 500)]);
      } else {
        // cichy refresh treści (np. zaktualizowana lista dotkniętych wizyt) bez ruszania zmieniono/dziennika
        await q(`UPDATE Term_Sprawy SET tytul = ?, opis = ?, dane_json = ?, powiazany_czas = ? WHERE id = ?`, [tyt, op, dj, powiazany_czas, istniejaca.id]);
      }
      return istniejaca.id;
    } catch (e) { log.error('[terminarz] sprawaUpsert:', e.message); return null; }
  }
  /** Zamyka sprawę, gdy przyczyna się rozstrzygnęła sama (np. ustalono wynik wizyty, odwołano dotkniętą wizytę). */
  // E02: „obsłużona” = wizyta naprawdę poza kolizją, która założyła sprawę (odwołana, przełożona, inny wykonawca, cofnięta blokada/zmiana grafiku).
  // Sprawdzamy STAN ŹRÓDŁOWY, nie listę z chwili utworzenia sprawy. Zwraca { koliduje, powod }.
  async function kolizjaWizytyWSprawie(tenant, row, rezId, dotknieta) {
    const dane = json(row.dane_json, {});
    const rez = await rezerwacja(tenant, rezId);
    if (!rez || ['anulowana', 'odrzucona', 'wygasla'].includes(rez.status)) return { koliduje: false, powod: 'wizyta odwołana' };
    const pozAkt = rez.pozycje.filter(p => ['zaplanowana', 'w_trakcie'].includes(p.stan));
    if (!pozAkt.length) return { koliduje: false, powod: 'wizyta bez zaplanowanych pozycji' };
    if (row.typ === 'E15' || row.typ === 'E16') {
      const m = String(row.klucz_dedup || '').match(/:nieob:(\d+)$/);
      if (m) { const nb = (await q(`SELECT id FROM Term_Nieobecnosci WHERE tenant_id = ? AND id = ?`, [tenant, Number(m[1])]))[0]; if (!nb) return { koliduje: false, powod: 'blokada została usunięta' }; }
      const prac = dane.kogo && !/^zasób /.test(dane.kogo) ? dane.kogo : null; const zasob = dane.kogo && /^zasób /.test(dane.kogo) ? Number(dane.kogo.replace('zasób ', '')) : null;
      if (!dane.od || !dane.do) return { koliduje: false, powod: 'brak zakresu blokady' };
      const lista = await wizytyDotkniete(tenant, prac, zasob, String(dane.od).slice(0, 10), String(dane.do).slice(0, 10), (p) => !S.nakladaja(S.naMin(p.start), S.naMin(p.koniec), S.naMin(dane.od), S.naMin(dane.do)));
      const nadal = lista.some(x => Number(x.rezerwacja_id) === Number(rezId));
      return nadal ? { koliduje: true, powod: `nadal w czasie blokady ${prac || dane.kogo} (${String(dane.od).slice(0, 16)}–${String(dane.do).slice(0, 16)})` } : { koliduje: false, powod: 'poza blokadą' };
    }
    if (row.typ === 'E18') {
      const cfg = await wspolneCfg(tenant); const kto = dane.kto;
      const dni = [...new Set(pozAkt.map(p => p.start.slice(0, 10)))];
      for (const dzien of dni) {
        const przedz = S.przedzialyZGrafiku(cfg.grafik.filter(g => g.pracownik === kto), dzien);
        const poza = pozAkt.filter(p => p.pracownik === kto && p.start.slice(0, 10) === dzien && !S.miesciSie(S.naMin(p.start), S.naMin(p.koniec), przedz));
        if (poza.length) return { koliduje: true, powod: `${kto} nie pracuje wtedy według grafiku (${poza[0].start.slice(11, 16)}–${poza[0].koniec.slice(11, 16)})` };
      }
      return { koliduje: false, powod: 'wizyta mieści się w grafiku' };
    }
    return { koliduje: false, powod: 'sprawa bez kolizji zasobów' };
  }
  // Odświeża listę dotkniętych wizyt sprawy według stanu źródłowego; wizyty poza kolizją oznacza jako obsłużone (ślad w dzienniku),
  // a gdy wszystkie są obsłużone — zamyka sprawę. Zwraca { dane, pozostalo, zamknieta }.
  async function odswiezDotkniete(tenant, row, kto, opis) {
    const dane = json(row.dane_json, {});
    if (!Array.isArray(dane.dotkniete) || !dane.dotkniete.length || ['rozwiazana', 'nieaktualna'].includes(row.stan)) return { dane, pozostalo: Array.isArray(dane.dotkniete) ? dane.dotkniete.filter(x => !x.rozwiazana).length : 0, zamknieta: false };
    let zmiana = false; const wpisy = [];
    for (const x of dane.dotkniete) {
      if (x.rozwiazana) continue;
      const k = await kolizjaWizytyWSprawie(tenant, row, x.rezerwacja_id, x);
      if (!k.koliduje) { x.rozwiazana = true; x.rozwiazano = new Date().toISOString().slice(0, 16).replace('T', ' '); x.jak = k.powod; zmiana = true; wpisy.push(`Wizyta EST-${String(x.rezerwacja_id).padStart(4, '0')} obsłużona — ${k.powod}${opis ? ' (' + opis + ')' : ''}`); }
    }
    const pozostalo = dane.dotkniete.filter(x => !x.rozwiazana).length;
    if (zmiana) {
      if (!pozostalo) await q(`UPDATE Term_Sprawy SET dane_json = ?, stan = 'rozwiazana', rozwiazal = ?, rozwiazano = NOW(), wynik = 'Wszystkie dotknięte wizyty obsłużone', zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [JSON.stringify(dane), kto || 'System', tenant, row.id]);
      else await q(`UPDATE Term_Sprawy SET dane_json = ?, zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [JSON.stringify(dane), tenant, row.id]);
      for (const w of wpisy) await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'obsluzono_pozycje', ?)`, [tenant, row.id, kto || 'System', w.slice(0, 500)]);
      if (!pozostalo) await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'rozwiazano', 'Wszystkie dotknięte wizyty obsłużone — sprawa zamknięta automatycznie')`, [tenant, row.id, kto || 'System']);
      row.dane_json = JSON.stringify(dane); if (!pozostalo) row.stan = 'rozwiazana';
    }
    return { dane, pozostalo, zamknieta: zmiana && !pozostalo };
  }
  // Po przełożeniu / zmianie wykonawcy / odwołaniu wizyty: otwarte sprawy grupowe z tą wizytą dostają aktualny stan.
  async function sprawyPoZmianieWizyty(tenant, rezId, kto, opis) {
    try {
      const rows = await q(`SELECT * FROM Term_Sprawy WHERE tenant_id = ? AND stan NOT IN ('rozwiazana', 'nieaktualna') AND rezerwacja_id IS NULL AND dane_json LIKE ?`, [tenant, `%"rezerwacja_id":${Number(rezId)},%`]);
      for (const row of rows) await odswiezDotkniete(tenant, row, kto, opis);
    } catch (e) { log.error('[terminarz] sprawyPoZmianieWizyty:', e.message); }
  }
  async function sprawaAutoZamknij(tenant, klucz, wynik, stan) {
    stan = stan || 'rozwiazana';
    try {
      const up = await q(`UPDATE Term_Sprawy SET stan = ?, wynik = ?, rozwiazal = 'System', rozwiazano = NOW(), zmieniono = NOW() WHERE tenant_id = ? AND klucz_dedup = ? AND stan NOT IN ('rozwiazana', 'nieaktualna')`, [stan, String(wynik).slice(0, 500), tenant, klucz]);
      if (up.affectedRows) {
        const row = (await q(`SELECT id FROM Term_Sprawy WHERE tenant_id = ? AND klucz_dedup = ?`, [tenant, klucz]))[0];
        if (row) await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, 'System', ?, ?)`, [tenant, row.id, stan === 'nieaktualna' ? 'nieaktualna' : 'rozwiazano', String(wynik).slice(0, 500)]);
      }
    } catch (e) { log.error('[terminarz] sprawaAutoZamknij:', e.message); }
  }
  /** Widoczność i maskowanie sprawy dla odbiorcy (12: tylko dane potrzebne właściwej osobie) — analogicznie do maskuj(). */
  function sprawaDlaOdbiorcy(s, r, imie) {
    const dane = json(s.dane_json, {});
    if (ROLE_OPERACYJNE.has(r)) return { ...s, dane };
    if (!ROLE_SPECJALISTA.has(r)) return null;
    if (Array.isArray(dane.dotkniete)) {
      const wlasne = dane.dotkniete.filter(x => x.pracownik === imie);
      if (!wlasne.length) return null;
      return { ...s, dane: { ...dane, dotkniete: wlasne } };
    }
    if (!Array.isArray(dane.dotyczy) || !dane.dotyczy.includes(imie)) return null;
    return { ...s, dane };
  }
  function formatujSprawe(s) {
    return { id: s.id, typ: s.typ, rezerwacja_id: s.rezerwacja_id, tytul: s.tytul, opis: s.opis, dane: s.dane,
      priorytet: s.priorytet, stan: s.stan, wlasciciel: s.wlasciciel, termin_dzialania: dt(s.termin_dzialania),
      powiazany_czas: dt(s.powiazany_czas), wynik: s.wynik, rozwiazal: s.rozwiazal, rozwiazano: dt(s.rozwiazano),
      utworzono: dt(s.utworzono), zmieniono: dt(s.zmieniono) };
  }
  async function sprawyLista(tenant, r, imie, zakladka) {
    const rows = await q(`SELECT * FROM Term_Sprawy WHERE tenant_id = ? ORDER BY CASE priorytet WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, COALESCE(powiazany_czas, utworzono), utworzono DESC LIMIT 300`, [tenant]);
    const odczytane = imie ? new Set((await q(`SELECT sprawa_id FROM Term_Sprawy_Odczyt WHERE tenant_id = ? AND pracownik = ?`, [tenant, imie])).map(x => x.sprawa_id)) : new Set();
    let widoczne = rows.map(x => sprawaDlaOdbiorcy(x, r, imie)).filter(Boolean);
    if (zakladka === 'do_dzialania') widoczne = widoczne.filter(x => ['P0', 'P1'].includes(x.priorytet) && !['rozwiazana', 'nieaktualna'].includes(x.stan));
    else if (zakladka === 'zmiany') widoczne = widoczne.filter(x => x.rezerwacja_id);
    else if (zakladka === 'dla_mnie') widoczne = widoczne.filter(x => x.wlasciciel === imie || (Array.isArray(x.dane.dotyczy) && x.dane.dotyczy.includes(imie)) || (Array.isArray(x.dane.dotkniete) && x.dane.dotkniete.some(y => y.pracownik === imie)));
    else if (zakladka === 'informacje') widoczne = widoczne.filter(x => x.priorytet === 'P2');
    return widoczne.map(x => ({ ...formatujSprawe(x), przeczytane: odczytane.has(x.id) }));
  }
  async function sprawyLicznik(tenant, r, imie) {
    const lista = await sprawyLista(tenant, r, imie, 'do_dzialania');
    return { otwarte: lista.length, pilne: lista.filter(x => x.priorytet === 'P0').length, nieprzeczytane: lista.filter(x => !x.przeczytane).length };
  }

  // ───────── T02/T03: zakupy klientki i jednostki (pomocnicze) ─────────
  const bezSufiksuRabatu = (w) => String(w || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim(); // „4x [Rabat: -20%]” → „4x” (jak w sprzedaz.js)
  const bazaWariantu = (w) => String(w || '').replace(/\s*\d+\s*[x×]\s*$/i, '').trim().toLowerCase();
  const liczbaZTekstu = (w) => { const m = String(w || '').match(/(\d+)\s*[x×]\s*$/i); return m ? Math.max(1, parseInt(m[1], 10)) : null; };
  /** Propozycja mapowania oferty → składniki, WYŁĄCZNIE jako podpowiedź do zatwierdzenia (tekst „4x” nie jest dowodem). */
  function propozycjaOferty(u, katalog) {
    const n = liczbaZTekstu(u.wariant);
    if (!n) return { skladniki: [{ usluga_wyk_id: u.id, jednostki: 1 }], pewna: true, uwaga: 'pojedynczy zabieg — 1 jednostka tej usługi' };
    const baza = bazaWariantu(u.wariant);
    const jednostkowa = katalog.find(x => x.id !== u.id && x.kategoria === u.kategoria && bazaWariantu(x.wariant) === baza && liczbaZTekstu(x.wariant) === 1);
    if (jednostkowa) return { skladniki: [{ usluga_wyk_id: jednostkowa.id, jednostki: n }], pewna: false, uwaga: `z nazwy: ${n} × „${jednostkowa.kategoria}${jednostkowa.wariant ? ' / ' + jednostkowa.wariant : ''}” — wymaga zatwierdzenia` };
    return { skladniki: [{ usluga_wyk_id: u.id, jednostki: n }], pewna: false, uwaga: `z nazwy: ${n} jednostek tej pozycji (brak wariantu 1x) — sprawdź obszar/technologię i zatwierdź` };
  }
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
  const wymagajIntegracji = (tenant) => { if (!zakupyAktywne(tenant)) throw new BladUzytkownika('Integracja zakupów nie jest włączona w tym salonie (etap w przygotowaniu).', { code: 'INTEGRACJA' }); if (!schemat.gotowy) throw new BladUzytkownika('Integracja zakupów niedostępna — schemat bazy niekompletny: ' + schemat.braki.join(', '), { code: 'SCHEMAT' }); if (!schematV2.gotowy) throw new BladUzytkownika('Ewidencja zakupów niedostępna — schemat v2 nie został zmigrowany (narzedzia/terminarz-zakupy-migracja.js): ' + schematV2.braki.slice(0, 3).join(', ') + (schematV2.braki.length > 3 ? '…' : ''), { code: 'SCHEMAT_V2' }); };
  const nazwaKat = (katalog, id) => { const u = (katalog || []).find(x => String(x.id) === String(id)); return u ? u.kategoria + (u.wariant ? ' / ' + u.wariant : '') : String(id); };
  router.post('/terminarz', async (req, res) => {
    const d = req.body || {};
    const tenant = d.tenant_id, action = d.action, imie = d.pracownik ? String(d.pracownik).trim() : '';
    if (!tenant) return res.json({ status: 'error', message: 'Brak tenant_id' });
    try {
      // C06/A24: sesja założona przez verify_pin niesie imię zalogowanej osoby (sessions.login). Jeśli żądanie podaje
      // inne imię pracownika tego salonu, odrzucamy — uprawnienia liczą się dla osoby uwierzytelnionej PIN-em, nie dla
      // pola w żądaniu. Sesja salonowa (login kontem salonu, bez PIN-u) nie ma tożsamości osoby i zachowuje się jak dotąd.
      const sesja = getSession(req.headers['x-session-token']);
      if (sesja && String(sesja.tenant_id) === String(tenant)) {
        const osobaSesji = sesja.login ? String(sesja.login).trim() : '';
        const rolaSesji = osobaSesji ? await rola(tenant, osobaSesji) : null; // null = sesja salonowa (login kontem salonu), nie osoba
        if (rolaSesji !== null && imie && osobaSesji !== imie) {
          log.warn(`[terminarz] tożsamość: sesja=${osobaSesji} żądanie=${imie} tenant=${tenant} akcja=${action}`);
          return res.json({ status: 'error', code: 'TOZSAMOSC', message: 'Żądanie podaje inną osobę niż zalogowana PIN-em. Zaloguj się ponownie.' });
        }
        // D06.4: uprawnienia liczą się dla osoby uwierzytelnionej PIN-em. Sesja salonowa (przed wyborem osoby) może tylko zainicjować moduł.
        if (rolaSesji === null && action !== 'trm_init') return res.json({ status: 'error', code: 'PIN', message: 'Wybierz osobę (PIN), żeby korzystać z terminarza.' });
      }
      const r = await rola(tenant, imie);
      if (action === 'trm_init') {
        const on = await czyFeature(tenant);
        if (!on) return res.json({ status: 'success', feature_on: false, rola: r });
        const cfg = await wspolneCfg(tenant);
        const nieob = await q(`SELECT id, pracownik, zasob_id, DATE_FORMAT(od,'%Y-%m-%d %H:%i:%s') AS od, DATE_FORMAT(do_,'%Y-%m-%d %H:%i:%s') AS \`do\`, typ, opis, utworzyl FROM Term_Nieobecnosci WHERE tenant_id = ? AND do_ >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY od`, [tenant]);
        return res.json({ status: 'success', feature_on: true, rola: r, teraz: cfg.terazStr, schemat, schemat_v2: schematV2, ustawienia: cfg.ust, pracownicy: cfg.pracownicy, grafik: cfg.grafik, zasoby: await zasoby(tenant, false), uslugi: cfg.katalog, nieobecnosci: nieob, zespol: await zespol(tenant) });
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
        if (d.kontrola_zakupow === 'on' && !integracjaZakupow(tenant)) throw new BladUzytkownika(zakupyAktywne(tenant) ? 'Nie można włączyć kontroli zakupów — schemat bazy niekompletny.' : 'Integracja zakupów nie jest włączona w tym salonie.');
        if (d.kontrola_zakupow === 'on' || d.kontrola_zakupow === 'off') await q(`UPDATE Term_Ustawienia SET kontrola_zakupow = ? WHERE tenant_id = ?`, [d.kontrola_zakupow, tenant]); // T03: opt-in per salon
        if (schematV2.gotowy) { // ZK-02: ustawienia ewidencji (kolumny istnieją tylko po migracji v2)
          if (d.recepcja_potwierdza_wykonanie !== undefined) await q(`UPDATE Term_Ustawienia SET recepcja_potwierdza_wykonanie = ? WHERE tenant_id = ?`, [d.recepcja_potwierdza_wykonanie ? 1 : 0, tenant]);
          if (d.potracenie_nieobecnosc === 'on' || d.potracenie_nieobecnosc === 'off') await q(`UPDATE Term_Ustawienia SET potracenie_nieobecnosc = ? WHERE tenant_id = ?`, [d.potracenie_nieobecnosc, tenant]);
          if (d.seria_limit !== undefined) await q(`UPDATE Term_Ustawienia SET seria_limit = ? WHERE tenant_id = ?`, [Math.min(50, Math.max(1, Number(d.seria_limit) || 20)), tenant]);
        }
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
        if (dotk.length) {
          const najwczesniej = dotk.map(x => x.start).sort()[0];
          await sprawaUpsert(tenant, { typ: 'E18', rezerwacja_id: null,
            tytul: `Zasób zarchiwizowany — ${dotk.length} ${dotk.length === 1 ? 'wizyta' : 'wizyt'} do obsłużenia`,
            opis: 'Zasób zarchiwizowano mimo wpływu na istniejące wizyty.',
            dane: { zrodlo: 'zasob', dotkniete: dotk.map(x => ({ rezerwacja_id: x.rezerwacja_id, pozycja_id: x.id, pracownik: x.pracownik, start: x.start, koniec: x.koniec, klient_nazwa: x.klient_nazwa, kategoria: x.kategoria + (x.wariant ? ' / ' + x.wariant : ''), rozwiazana: false })) },
            priorytet: priorytetDlaCzasu(t, najwczesniej), powiazany_czas: najwczesniej, klucz: `E18:${crypto.randomUUID()}`, kto: imie });
        }
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
        const wyjatkiOsoby = cfg.grafik.filter(g => g.pracownik === kto && g.od_daty && g.do_daty && String(g.od_daty) === String(g.do_daty));
        const grafikPodglad = [...nowyGrafik, ...wyjatkiOsoby]; // podgląd wpływu liczony z nowym harmonogramem + zachowanymi wyjątkami dni
        const dotk = await wizytyDotkniete(tenant, kto, null, cfg.terazStr.slice(0, 10), '2099-12-31', (p) => S.miesciSie(S.naMin(p.start), S.naMin(p.koniec), S.przedzialyZGrafiku(grafikPodglad, p.start.slice(0, 10))));
        if (dotk.length && !d.wymus) return { status: 'success', wymaga_decyzji: true, dotkniete: dotk, message: `Zmiana grafiku dotknie ${dotk.length} wizyt. Sprawdź zastępstwo, zaproponuj klientkom zmianę albo przełóż terminy — zapis grafiku ich nie odwołuje.` };
        const conn = await polacz();
        try {
          await begin(conn);
          // zapis stałego harmonogramu nie usuwa wyjątków datowanych (R05) — one mają własną akcję trm_grafik_dzien_zapisz/usun
          await qc(conn, `DELETE FROM Term_Grafik WHERE tenant_id = ? AND pracownik = ? AND NOT (od_daty IS NOT NULL AND do_daty IS NOT NULL AND od_daty = do_daty)`, [tenant, kto]);
          for (const w of nowyGrafik) await qc(conn, `INSERT INTO Term_Grafik (tenant_id, pracownik, dzien_tyg, od, do_) VALUES (?, ?, ?, ?, ?)`, [tenant, kto, w.dzien_tyg, w.od, w.do]);
          await commit(conn);
        } catch (e) { await rollback(conn); throw e; } finally { conn.release(); }
        zapiszLog(tenant, 'TERMINARZ: GRAFIK', imie, `${kto}: ${nowyGrafik.length} przedziałów, dotkniętych wizyt: ${dotk.length}`);
        if (dotk.length) {
          const najwczesniej = dotk.map(x => x.start).sort()[0];
          await sprawaUpsert(tenant, { typ: 'E18', rezerwacja_id: null,
            tytul: `Zmiana grafiku ${kto} — ${dotk.length} ${dotk.length === 1 ? 'wizyta' : 'wizyt'} poza nową dostępnością`,
            opis: 'Grafik zapisano mimo wpływu na istniejące wizyty.',
            dane: { zrodlo: 'grafik', kto, dotkniete: dotk.map(x => ({ rezerwacja_id: x.rezerwacja_id, pozycja_id: x.id, pracownik: x.pracownik, start: x.start, koniec: x.koniec, klient_nazwa: x.klient_nazwa, kategoria: x.kategoria + (x.wariant ? ' / ' + x.wariant : ''), rozwiazana: false })) },
            priorytet: priorytetDlaCzasu(cfg.terazStr, najwczesniej), powiazany_czas: najwczesniej, klucz: `E18:${crypto.randomUUID()}`, kto: imie });
        }
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
      // ───────── R05: wyjątek jednego dnia w grafiku (pierwszeństwo nad regułą cykliczną, nie zmienia innych tygodni) ─────────
      case 'trm_grafik_dzien_zapisz': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        const kto = String(d.pracownik_grafik || '').trim();
        if (!(await pracownicy(tenant)).includes(kto)) throw new BladUzytkownika('Nieznany pracownik.');
        const data = sprawdzData(d.data, 'data');
        const wolne = !!d.wolne;
        const przedz = wolne ? [] : (Array.isArray(d.przedzialy) ? d.przedzialy : []).filter(w => RE_HHMM.test(w.od) && RE_HHMM.test(w.do) && w.od < w.do);
        if (!wolne && !przedz.length) throw new BladUzytkownika('Podaj godziny albo zaznacz „dzień wolny”.');
        const cfg = await wspolneCfg(tenant);
        const dt = S.dzienTygodnia(data);
        const wyjatek = (wolne ? [{ od: '00:00', do: '00:00' }] : przedz).map(w => ({ pracownik: kto, dzien_tyg: dt, od: w.od, do: w.do, od_daty: data, do_daty: data }));
        // podgląd wpływu: grafik osoby bez dotychczasowego wyjątku tego dnia + nowy wyjątek
        const grafikPodglad = [...cfg.grafik.filter(g => g.pracownik === kto && !(g.od_daty && g.do_daty && String(g.od_daty) === data && String(g.do_daty) === data)), ...wyjatek];
        const dotk = await wizytyDotkniete(tenant, kto, null, data, data, (p) => S.miesciSie(S.naMin(p.start), S.naMin(p.koniec), S.przedzialyZGrafiku(grafikPodglad, data)));
        if (d.podglad) return { status: 'success', podglad: true, dotkniete: dotk };
        if (dotk.length && !d.wymus) return { status: 'success', wymaga_decyzji: true, dotkniete: dotk, message: `Zmiana tego dnia dotknie ${dotk.length} wizyt. Zapis ich nie odwołuje — rozwiąż je osobno.` };
        const conn = await polacz();
        try {
          await begin(conn);
          await qc(conn, `DELETE FROM Term_Grafik WHERE tenant_id = ? AND pracownik = ? AND od_daty = ? AND do_daty = ?`, [tenant, kto, data, data]);
          for (const w of wyjatek) await qc(conn, `INSERT INTO Term_Grafik (tenant_id, pracownik, dzien_tyg, od, do_, od_daty, do_daty) VALUES (?, ?, ?, ?, ?, ?, ?)`, [tenant, kto, dt, w.od, w.do, data, data]);
          await commit(conn);
        } catch (e) { await rollback(conn); throw e; } finally { conn.release(); }
        zapiszLog(tenant, 'TERMINARZ: GRAFIK DZIEŃ', imie, `${kto} ${data}: ${wolne ? 'dzień wolny' : przedz.map(w => w.od + '–' + w.do).join(', ')}, dotkniętych wizyt: ${dotk.length}`);
        if (dotk.length) {
          const najwczesniej = dotk.map(x => x.start).sort()[0];
          await sprawaUpsert(tenant, { typ: 'E18', rezerwacja_id: null, tytul: `Zmiana grafiku ${kto} (${data}) — ${dotk.length} ${dotk.length === 1 ? 'wizyta' : 'wizyt'} poza nową dostępnością`, opis: 'Wyjątek dnia zapisano mimo wpływu na istniejące wizyty.',
            dane: { zrodlo: 'grafik_dzien', kto, data, dotkniete: dotk.map(x => ({ rezerwacja_id: x.rezerwacja_id, pozycja_id: x.id, pracownik: x.pracownik, start: x.start, koniec: x.koniec, klient_nazwa: x.klient_nazwa, kategoria: x.kategoria + (x.wariant ? ' / ' + x.wariant : ''), rozwiazana: false })) },
            priorytet: priorytetDlaCzasu(cfg.terazStr, najwczesniej), powiazany_czas: najwczesniej, klucz: `E18:dzien:${kto}:${data}`, kto: imie });
        }
        return { status: 'success', grafik: await grafik(tenant), dotkniete: dotk };
      }
      case 'trm_grafik_dzien_usun': {
        wymagaj(r, ROLE_MANAGER_PLUS);
        const kto = String(d.pracownik_grafik || '').trim(), data = sprawdzData(d.data, 'data');
        await q(`DELETE FROM Term_Grafik WHERE tenant_id = ? AND pracownik = ? AND od_daty = ? AND do_daty = ?`, [tenant, kto, data, data]);
        zapiszLog(tenant, 'TERMINARZ: GRAFIK DZIEŃ', imie, `${kto} ${data}: przywrócono stały harmonogram`);
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
        // podgląd skutków bez zapisu (raport naprawczy T10) — ta sama lista co przy zapisie, nic nie zmienia w bazie
        if (d.podglad) return { status: 'success', podglad: true, dotkniete: dotk };
        if (dotk.length && !d.wymus) return { status: 'success', wymaga_decyzji: true, dotkniete: dotk, message: `Ta nieobecność nachodzi na ${dotk.length} wizyt. Zapis jej nie odwołuje — rozwiąż je osobno (zastępstwo, zmiana terminu, kontakt).` };
        const res_ = await q(`INSERT INTO Term_Nieobecnosci (tenant_id, pracownik, zasob_id, od, do_, typ, opis, utworzyl) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, prac, zasob, od, do_, typ, String(d.opis || '').slice(0, 255) || null, imie || null]);
        zapiszLog(tenant, 'TERMINARZ: NIEOBECNOŚĆ', imie, `${prac || (zasob ? 'zasób ' + zasob : 'cały salon')} ${od}–${do_} (${typ}), dotkniętych wizyt: ${dotk.length}`);
        if (dotk.length) {
          const typSprawy = prac ? 'E15' : 'E16';
          const najwczesniej = dotk.map(x => x.start).sort()[0];
          const terazStr = await teraz();
          await sprawaUpsert(tenant, { typ: typSprawy, rezerwacja_id: null,
            tytul: `${prac ? 'Nieobecność: ' + prac : 'Niedostępny zasób'} — ${dotk.length} ${dotk.length === 1 ? 'wizyta' : 'wizyt'} do obsłużenia`,
            opis: `${typ} ${od.slice(0, 16)}–${do_.slice(0, 16)}`,
            dane: { typ_nieob: typ, kogo: prac || `zasób ${zasob}`, od, do: do_, dotkniete: dotk.map(x => ({ rezerwacja_id: x.rezerwacja_id, pozycja_id: x.id, pracownik: x.pracownik, start: x.start, koniec: x.koniec, klient_nazwa: x.klient_nazwa, kategoria: x.kategoria + (x.wariant ? ' / ' + x.wariant : ''), rozwiazana: false })) },
            priorytet: priorytetDlaCzasu(terazStr, najwczesniej), powiazany_czas: najwczesniej, klucz: `${typSprawy}:nieob:${res_.insertId}`, kto: imie });
        }
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
      // wyszukiwarka wizyt po klientce (nazwa, telefon, ID) w jawnie podanym zakresie ±60 dni (raport naprawczy T08)
      case 'trm_szukaj_wizyt': {
        wymagaj(r, ROLE_OPERACYJNE);
        const fraza = String(d.fraza || '').trim().slice(0, 80);
        if (fraza.length < 2) return { status: 'success', wizyty: [], klienci: [], dni: 60 };
        const like = '%' + fraza + '%';
        const cfg = await wspolneCfg(tenant);
        const dzis = cfg.terazStr.slice(0, 10);
        const od = S.dzienZ(S.naMin(dzis + ' 00:00') - 60 * 1440) + ' 00:00:00', do_ = S.dzienZ(S.naMin(dzis + ' 00:00') + 60 * 1440) + ' 23:59:59';
        const rows = await q(`SELECT r.id, r.klient_nazwa, r.status, DATE_FORMAT(r.start,'%Y-%m-%d %H:%i:%s') AS start,
            GROUP_CONCAT(DISTINCT CONCAT(p.kategoria, IF(p.wariant IS NULL OR p.wariant = '', '', CONCAT(' · ', p.wariant))) ORDER BY p.kolejnosc SEPARATOR ' + ') AS uslugi,
            GROUP_CONCAT(DISTINCT p.pracownik ORDER BY p.kolejnosc SEPARATOR ', ') AS pracownicy
          FROM Term_Rezerwacje r LEFT JOIN Term_Pozycje p ON p.tenant_id = r.tenant_id AND p.rezerwacja_id = r.id AND p.stan <> 'anulowana'
          WHERE r.tenant_id = ? AND r.start BETWEEN ? AND ? AND (r.klient_nazwa LIKE ? OR r.klient_telefon LIKE ? OR r.id_klienta = ?)
          GROUP BY r.id ORDER BY ABS(TIMESTAMPDIFF(MINUTE, r.start, ?)) LIMIT 21`, [tenant, od, do_, like, like, fraza, cfg.terazStr]);
        const klienci = rows.length ? [] : await q(`SELECT id_klienta, imie_nazwisko FROM Klienci WHERE tenant_id = ? AND (status IS NULL OR status = 'AKTYWNY') AND (imie_nazwisko LIKE ? OR telefon LIKE ?) ORDER BY imie_nazwisko LIMIT 5`, [tenant, like, like]);
        return { status: 'success', dni: 60, wiecej: rows.length > 20, wizyty: rows.slice(0, 20), klienci: klienci.map(k => ({ id_klienta: k.id_klienta, nazwa: k.imie_nazwisko })) };
      }

      // ───────── ZK-02: zakupy klientki (odczyt BEZ mutacji), uzgodnienie źródeł, mapowanie ofert (wersje), ewidencja, korekty ─────────
      case 'trm_zakupy_klientki': {
        wymagaj(r, ROLE_OPERACYJNE);
        if (!integracjaZakupow(tenant)) return { status: 'success', integracja: 'off', zakupy: [], bez_mapowania: 0 }; // sekcja 0: bez sald, gdy integracja nieaktywna
        const idKlienta = d.id_klienta ? String(d.id_klienta) : null;
        if (!idKlienta) return { status: 'success', zakupy: [], bez_mapowania: 0, uwaga: 'Zakupy są powiązane z kartoteką (ID klientki) — bez kartoteki nie ma zakupów do pokazania.' };
        const cfg = await wspolneCfg(tenant);
        const ctx = await ctxZ(tenant, imie, r);
        // ODCZYT: żadnego importu, przyznania ani zużycia (§6.2 decyzji ZK-02); nowe źródła rejestruje jawna operacja (ZK-03)
        const zakupy = await Z.widokZakupow(Z.repoSql(q, tenant), ctx, { id_klienta: idKlienta, data: d.data ? sprawdzData(d.data, 'data') : null, katalogNazwa: (id) => nazwaKat(cfg.katalog, id) });
        return { status: 'success', kontrola_zakupow: cfg.ust.kontrola_zakupow, ewidencja: ctx.tryb, zakupy, bez_mapowania: 0 };
      }
      case 'trm_zakupy_uzgodnij': { // jawna, idempotentna operacja: ponowny odczyt źródeł ISTNIEJĄCYCH zakupów klientki (hash/stan). Rejestracja nowych sprzedaży → ZK-03.
        wymagaj(r, ROLE_OPERACYJNE); wymagajIntegracji(tenant);
        const idKlienta = d.id_klienta ? String(d.id_klienta) : null; if (!idKlienta) throw new BladUzytkownika('Wskaż klientkę (ID).');
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => { const ctx = await ctxZ(tenant, imie, r); const out = []; for (const z of await repo.zakupyKlientki(idKlienta)) { const u = await Z.domena.uzgodnijZrodlo(repo, ctx, z); out.push({ zakup_id: z.id, nazwa: z.nazwa, id_klienta: z.id_klienta, zmiana: u.zmiana, stan_zrodla: u.stan_zrodla }); } return out; });
        for (const x of wyn.filter(x => ['istotna', 'usuniete', 'zwrot'].includes(x.zmiana))) await sprawaZrodla(tenant, { ...x, kto: imie });
        return { status: 'success', uzgodniono: wyn, nowe_zrodla: 'nowe sprzedaże rejestruje jawnie trm_zakupy_podglad → trm_zakupy_rejestruj' };
      }
      // ───────── ZK-03: podgląd i rejestracja źródeł (Z3-03), kwalifikacja „1×”, kandydaci wizyt (Z3-05), gotowość (Z3-06) ─────────
      case 'trm_zakupy_podglad': { // ODCZYT bez mutacji: klasyfikacja sprzedaży salonu/klientki (gotowe / wymaga mapowania / do rozstrzygnięcia / pominięte / istniejące / zmienione)
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const ctx = await ctxZ(tenant, imie, r);
        const w = await Z.domena.podgladZrodel(Z.repoSql(q, tenant), ctx, { id_klienta: d.id_klienta ? String(d.id_klienta) : null, od: d.od ? sprawdzData(d.od, 'od') : null, do_: d.do ? sprawdzData(d.do, 'do') : null, limit: Math.min(500, Math.max(1, Number(d.limit) || 300)) });
        return { status: 'success', ewidencja: ctx.tryb, ewidencja_zapisana: ctx.zapisany, sprawdzono: ctx.teraz, ...w };
      }
      case 'trm_zakupy_rejestruj': { // JAWNE potwierdzenie listy źródeł → idempotentna rejestracja (klucz źródła + Term_Operacje); per pozycja wynik; bez R/U
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const lista = (Array.isArray(d.pozycje) ? d.pozycje : []).map(p => ({ sprzedaz_id: String(p.sprzedaz_id || ''), wersja_id: p.wersja_id ? Number(p.wersja_id) : null, id_klienta: p.id_klienta ? String(p.id_klienta) : null, powiazane: Array.isArray(p.powiazane) ? p.powiazane.map(String) : undefined })).filter(p => p.sprzedaz_id).slice(0, 200);
        if (!lista.length) throw new BladUzytkownika('Wskaż sprzedaże do zarejestrowania.');
        const klucz = String(d.klucz_idem || '').slice(0, 64) || crypto.randomUUID();
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => { const ctx = await ctxZ(tenant, imie, r); return Z.domena.operacja(repo, ctx, { klucz, rodzaj: 'rejestracja', dane: { pozycje: lista } }, (operacja_id) => Z.domena.zarejestrujZakupy(repo, ctx, { pozycje: lista, operacja_id })); });
        if (!wyn.powtorzenie && wyn.wynik.zarejestrowano) zapiszLog(tenant, 'TERMINARZ: REJESTRACJA ZAKUPÓW', imie, `${wyn.wynik.zarejestrowano} zarejestrowano, ${wyn.wynik.istnialo} już było, ${wyn.wynik.pominieto} pominięto/do rozstrzygnięcia`);
        return { status: 'success', powtorzenie: wyn.powtorzenie, ...wyn.wynik };
      }
      case 'trm_zakup_kwalifikuj': { // „1×” kupiony na przyszłość (albo nie ewidencjonowany) — decyzja managera per zakup, z podstawą
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => Z.domena.kwalifikujZakup(repo, await ctxZ(tenant, imie, r), { zakup_id: Number(d.zakup_id), kwalifikacja: String(d.kwalifikacja || ''), powod: String(d.powod || '').trim().slice(0, 300) }));
        if (!wyn.powtorzenie) zapiszLog(tenant, 'TERMINARZ: KWALIFIKACJA ZAKUPU', imie, `zakup ${wyn.zakup_id}: ${wyn.kwalifikacja} — ${String(d.powod || '').slice(0, 120)}`);
        return { status: 'success', ...wyn };
      }
      case 'trm_skladnik_kandydaci': { // ODCZYT: istniejące wizyty klientki na tę usługę (także przeszłe nierozstrzygnięte i poza tygodniem), saldo, niedobór, skrót podglądu
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const ctx = await ctxZ(tenant, imie, r);
        return { status: 'success', ...(await Z.domena.kandydaciWizyt(Z.repoSql(q, tenant), ctx, { skladnik_id: Number(d.skladnik_id) })), ewidencja: ctx.tryb };
      }
      case 'trm_ewidencja_stan': { // ODCZYT: gotowość ewidencji — co można uruchomić, co wymaga decyzji
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const ctx = await ctxZ(tenant, imie, r); const repo = Z.repoSql(q, tenant);
        const liczniki = await repo.liczniki();
        const skl = await repo.skladnikiSalonu({});
        const salda = await Z.domena.saldoSkladnikow(repo, skl.map(s => s.id));
        const lista = skl.map(s => ({ id: s.id, zakup_id: s.zakup_id, zakup_nazwa: s.zakup_nazwa, id_klienta: s.id_klienta, usluga_nazwa: s.usluga_nazwa, stan: s.stan, stan_weryfikacji: s.stan_weryfikacji, kwalifikacja: s.kwalifikacja, stan_zrodla: s.stan_zrodla, uruchomiony: !!(s.zalezne_uzgodniono && s.aktywny_od), ma_plan: !!s.plan_json && !s.aktywny_od, saldo: salda[s.id], powod: Z.logika.powodNiedostepnosci(s, { stan: s.zakup_stan, stan_zrodla: s.stan_zrodla, data_waznosci: s.data_waznosci, kwalifikacja: s.kwalifikacja }, salda[s.id], ctx.teraz.slice(0, 10), ctx.tryb) }));
        const sprawy = await q(`SELECT COUNT(*) AS n FROM Term_Sprawy WHERE tenant_id = ? AND typ IN ('E20','E21','E22','E23','E24') AND stan IN ('nowa','w_trakcie','oczekuje')`, [tenant]).catch(() => [{ n: 0 }]);
        return { status: 'success', ewidencja: ctx.tryb, ewidencja_zapisana: ctx.zapisany, techniczna: ctx.techniczna, przerwa_od: ctx.przerwa_od, liczniki: { ...liczniki, sprawy_otwarte: sprawy[0].n }, skladniki: lista, schemat_v2: { gotowy: schematV2.gotowy, typ: schematV2.typ } };
      }
      case 'trm_oferty_lista': {
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const cfg = await wspolneCfg(tenant);
        const of = await q(`SELECT id, usluga_id, stan, zrodlo, zatwierdzil, DATE_FORMAT(zatwierdzono,'%Y-%m-%d %H:%i') AS zatwierdzono FROM Term_Oferty WHERE tenant_id = ?`, [tenant]);
        const wer = of.length ? await q(`SELECT * FROM Term_Oferty_Wersje WHERE tenant_id = ? AND obowiazuje_do IS NULL AND oferta_id IN (${of.map(() => '?').join(',')})`, [tenant, ...of.map(o => o.id)]) : [];
        const sk = wer.length ? await q(`SELECT wersja_id, usluga_wyk_id, jednostki, jednostka_miary, jednostki_na_pozycje FROM Term_Oferty_Skladniki WHERE tenant_id = ? AND wersja_id IN (${wer.map(() => '?').join(',')}) ORDER BY id`, [tenant, ...wer.map(w => w.id)]) : [];
        const lista = cfg.katalog.map(u => {
          const o = of.find(x => String(x.usluga_id) === String(u.id)); const w = o ? wer.find(x => x.oferta_id === o.id) : null;
          const prop = propozycjaOferty(u, cfg.katalog);
          return { usluga_id: u.id, nazwa: u.kategoria + (u.wariant ? ' / ' + u.wariant : ''), cena: u.cena, skonfigurowana: u.skonfigurowana, stan: o ? o.stan : 'brak', zrodlo: o ? o.zrodlo : null, zatwierdzil: o ? o.zatwierdzil : null, zatwierdzono: o ? o.zatwierdzono : null,
            rodzaj: w ? w.rodzaj : (prop.pewna ? 'nie_ewidencjonuj' : 'pakiet'), wersja: w ? w.wersja : null, // decyzja D-2: „1x” bez jawnej kwalifikacji = nie ewidencjonuj
            skladniki: w ? sk.filter(s => s.wersja_id === w.id).map(s => ({ usluga_wyk_id: s.usluga_wyk_id, jednostki: s.jednostki, jednostka_miary: s.jednostka_miary, jednostki_na_pozycje: s.jednostki_na_pozycje })) : prop.skladniki, propozycja: prop };
        });
        const niezw = await q(`SELECT COUNT(*) AS n FROM Term_Zakupy_Skladniki WHERE tenant_id = ? AND stan_weryfikacji = 'niezweryfikowany' AND stan = 'aktywny'`, [tenant]);
        return { status: 'success', kontrola_zakupow: cfg.ust.kontrola_zakupow, ewidencja: cfg.ust.ewidencja, oferty: lista, zakupy_do_weryfikacji: niezw[0].n, skladniki_do_weryfikacji: niezw[0].n };
      }
      case 'trm_oferta_zapisz': { // wersjonowane mapowanie: zmiana = NOWA wersja dla kolejnych zakupów; istniejące zakupy zachowują swoją (D12, §6.2); pełna lista składników (C03)
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const uid = String(d.usluga_id || '');
        const u = (await q(`SELECT id FROM Uslugi WHERE tenant_id = ? AND id = ?`, [tenant, uid]))[0];
        if (!u) throw new BladUzytkownika('Oferta nie istnieje w cenniku.');
        const stan = ['zatwierdzona', 'odrzucona', 'propozycja'].includes(d.stan) ? d.stan : 'zatwierdzona';
        const rodzaj = Z.RODZAJE_OFERTY.includes(d.rodzaj) ? d.rodzaj : 'pakiet';
        const skl = (Array.isArray(d.skladniki) ? d.skladniki : []).map(s => ({ usluga_wyk_id: String(s.usluga_wyk_id || ''), jednostki: Math.max(1, Math.min(500, Number(s.jednostki) || 1)), jednostka_miary: ['sesja', 'przylozenie', 'zabieg'].includes(s.jednostka_miary) ? s.jednostka_miary : 'sesja', jednostki_na_pozycje: Math.max(1, Math.min(20, Number(s.jednostki_na_pozycje) || 1)) })).filter(s => s.usluga_wyk_id);
        if (stan === 'zatwierdzona' && (rodzaj === 'pakiet' || rodzaj === 'pojedynczy_z_gory') && !skl.length) throw new BladUzytkownika('Zatwierdzona oferta musi mieć co najmniej jeden składnik (usługa wykonywana + liczba jednostek).');
        if (rodzaj === 'pojedynczy_z_gory' && (skl.length !== 1 || skl[0].jednostki !== 1)) throw new BladUzytkownika('Oferta „pojedynczy zabieg kupiony na przyszłość” ma dokładnie jeden składnik × 1.');
        if (skl.length) { const znane = await q(`SELECT id FROM Uslugi WHERE tenant_id = ? AND id IN (${skl.map(() => '?').join(',')})`, [tenant, ...skl.map(s => s.usluga_wyk_id)]); if (skl.some(s => !znane.find(z => String(z.id) === s.usluga_wyk_id))) throw new BladUzytkownika('Składnik wskazuje usługę, której nie ma w cenniku.'); }
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => {
          await qc(conn, `INSERT INTO Term_Oferty (tenant_id, usluga_id, stan, zrodlo, zatwierdzil, zatwierdzono, zmieniono) VALUES (?, ?, ?, 'reczne', ?, ?, NOW()) ON DUPLICATE KEY UPDATE stan = VALUES(stan), zrodlo = 'reczne', zatwierdzil = VALUES(zatwierdzil), zatwierdzono = VALUES(zatwierdzono), zmieniono = NOW()`, [tenant, uid, stan, imie || null, stan === 'zatwierdzona' ? new Date() : null]);
          const o = (await qc(conn, `SELECT id FROM Term_Oferty WHERE tenant_id = ? AND usluga_id = ? FOR UPDATE`, [tenant, uid]))[0];
          const ost = (await qc(conn, `SELECT id, wersja, rodzaj, stan FROM Term_Oferty_Wersje WHERE tenant_id = ? AND oferta_id = ? AND obowiazuje_do IS NULL ORDER BY wersja DESC LIMIT 1`, [tenant, o.id]))[0];
          const stareSkl = ost ? await qc(conn, `SELECT usluga_wyk_id, jednostki, jednostka_miary, jednostki_na_pozycje FROM Term_Oferty_Skladniki WHERE tenant_id = ? AND wersja_id = ? ORDER BY id`, [tenant, ost.id]) : [];
          const taSama = !!ost && ost.rodzaj === rodzaj && ost.stan === stan && JSON.stringify(stareSkl.map(s => [String(s.usluga_wyk_id), s.jednostki, s.jednostka_miary, s.jednostki_na_pozycje])) === JSON.stringify(skl.map(s => [s.usluga_wyk_id, s.jednostki, s.jednostka_miary, s.jednostki_na_pozycje]));
          if (taSama) return { wersja: ost.wersja, bez_zmian: true }; // otwarcie i zapis bez zmian nie tworzy wersji i niczego nie gubi (C03)
          if (ost) await qc(conn, `UPDATE Term_Oferty_Wersje SET obowiazuje_do = NOW() WHERE tenant_id = ? AND id = ?`, [tenant, ost.id]);
          const nr = ost ? ost.wersja + 1 : 1;
          const w = await qc(conn, `INSERT INTO Term_Oferty_Wersje (tenant_id, oferta_id, wersja, rodzaj, stan, obowiazuje_od, autor) VALUES (?, ?, ?, ?, ?, NOW(), ?)`, [tenant, o.id, nr, rodzaj, stan, imie || null]);
          for (const s of skl) await qc(conn, `INSERT INTO Term_Oferty_Skladniki (tenant_id, oferta_id, wersja_id, usluga_wyk_id, jednostki, jednostka_miary, jednostki_na_pozycje) VALUES (?, ?, ?, ?, ?, ?, ?)`, [tenant, o.id, w.insertId, s.usluga_wyk_id, s.jednostki, s.jednostka_miary, s.jednostki_na_pozycje]);
          const uzyte = (await qc(conn, `SELECT COUNT(*) AS n FROM Term_Zakupy WHERE tenant_id = ? AND oferta_id = ? AND oferta_wersja_id IS NOT NULL AND oferta_wersja_id <> ?`, [tenant, o.id, w.insertId]))[0].n;
          return { wersja: nr, zakupy_na_starych_wersjach: Number(uzyte) };
        });
        if (!wyn.bez_zmian) zapiszLog(tenant, 'TERMINARZ: MAPOWANIE OFERTY', imie, `${uid}: ${stan}, ${rodzaj}, wersja ${wyn.wersja} (${skl.map(s => s.jednostki + '×' + s.usluga_wyk_id).join(', ') || 'bez składników'})`);
        return { status: 'success', ...wyn };
      }
      case 'trm_zakupy_import':
      case 'trm_zakup_bilans': { // stare mutatory T02/T03 WYŁĄCZONE (decyzje ZK-02 §8.6): zastąpione przez v2 — rejestracja źródeł i weryfikacja per składnik (ZK-03)
        wymagaj(r, ROLE_MANAGER_PLUS);
        throw new BladUzytkownika('Ta akcja została zastąpiona przez model ewidencji v2 (każdy składnik weryfikowany osobno). Rejestracja zakupów ze sprzedaży jest w przygotowaniu — nic nie zapisano.', { code: 'ZASTAPIONE' });
      }
      case 'trm_ewidencja_ustaw': { // tryb ewidencji salonu (§14.1) — decyzja managera, niezależna od listy technicznej
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => Z.domena.ustawEwidencje(repo, await ctxZ(tenant, imie, r), { tryb: String(d.tryb || ''), raport: d.raport || null }));
        if (!wyn.powtorzenie) zapiszLog(tenant, 'TERMINARZ: EWIDENCJA ZAKUPÓW', imie, `${wyn.poprzedni} → ${wyn.tryb}`);
        return { status: 'success', ...wyn, ustawienia: await ustawienia(tenant) };
      }
      case 'trm_zakup_przyznaj': { // uprawnienie przyznane przez salon (gratis/rekompensata/dane pilotażowe) — bez wiersza Sprzedaz, bez pieniędzy (§12.3)
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const cfg = await wspolneCfg(tenant);
        const idKlienta = d.id_klienta ? String(d.id_klienta) : null;
        if (idKlienta) { const kr = (await q(`SELECT id_klienta FROM Klienci WHERE tenant_id = ? AND id_klienta = ?`, [tenant, idKlienta]))[0]; if (!kr) throw new BladUzytkownika('Nie znaleziono klientki w kartotece.'); }
        const klucz = String(d.klucz_idem || '').slice(0, 64) || crypto.randomUUID();
        const dane = { id_klienta: idKlienta, usluga_wyk_id: String(d.usluga_wyk_id || ''), jednostki: Number(d.jednostki), nazwa: String(d.nazwa || '').slice(0, 300) || null, data_waznosci: d.data_waznosci ? sprawdzData(d.data_waznosci, 'ważność') : null, powod: String(d.powod || '').trim().slice(0, 300), zweryfikowany: d.zweryfikowany !== false };
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => { const ctx = await ctxZ(tenant, imie, r); return Z.domena.operacja(repo, ctx, { klucz, rodzaj: 'przyznaj', dane }, (operacja_id) => Z.domena.przyznaj(repo, ctx, { ...dane, usluga_nazwa: nazwaKat(cfg.katalog, dane.usluga_wyk_id), operacja_id })); });
        if (!wyn.powtorzenie) zapiszLog(tenant, 'TERMINARZ: PRZYZNANO ZABIEGI', imie, `${idKlienta}: ${dane.jednostki} × ${nazwaKat(cfg.katalog, dane.usluga_wyk_id)} — ${dane.powod}`);
        return { status: 'success', powtorzenie: wyn.powtorzenie, ...wyn.wynik };
      }
      case 'trm_skladnik_weryfikuj': { // stan początkowy JEDNEGO składnika — wszystkie liczby jawne (także 0); stan rodzica wyliczany (C04, §13.2)
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const klucz = String(d.klucz_idem || '').slice(0, 64) || crypto.randomUUID();
        const dane = { skladnik_id: Number(d.skladnik_id), hist_wykorzystane: d.hist_wykorzystane, hist_wycofane: d.hist_wycofane, hist_potracone: d.hist_potracone, punkt_odciecia: d.punkt_odciecia ? sprawdzDt(d.punkt_odciecia, 'punkt odcięcia') : null, zrodlo_ustalen: String(d.zrodlo_ustalen || '').trim().slice(0, 300) };
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => { const ctx = await ctxZ(tenant, imie, r); return Z.domena.operacja(repo, ctx, { klucz, rodzaj: 'weryfikuj', dane }, (operacja_id) => Z.domena.weryfikujSkladnik(repo, ctx, { ...dane, operacja_id })); });
        if (!wyn.powtorzenie) zapiszLog(tenant, 'TERMINARZ: STAN POCZĄTKOWY SKŁADNIKA', imie, `składnik ${dane.skladnik_id}: U=${dane.hist_wykorzystane} W=${dane.hist_wycofane} F=${dane.hist_potracone}; ${dane.zrodlo_ustalen}`);
        return { status: 'success', powtorzenie: wyn.powtorzenie, ...wyn.wynik };
      }
      case 'trm_skladnik_uruchom': { // Z3-05/06: decyzje dla istniejących wizyt → plan (przygotowanie) albo atomowe przydziały + gotowość (aktywna); podgląd musi być aktualny
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const klucz = String(d.klucz_idem || '').slice(0, 64) || crypto.randomUUID();
        const dane = { skladnik_id: Number(d.skladnik_id), decyzje: Array.isArray(d.decyzje) ? d.decyzje.map(x => ({ pozycja_id: Number(x.pozycja_id), decyzja: String(x.decyzja || ''), uzasadnienie: String(x.uzasadnienie || '').slice(0, 300) })) : null, skrot: d.skrot ? String(d.skrot) : null, z_planu: !!d.z_planu, potwierdzenie_zaleznych: !!d.potwierdzenie_zaleznych };
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => { const ctx = await ctxZ(tenant, imie, r); return Z.domena.operacja(repo, ctx, { klucz, rodzaj: 'uruchom', dane }, (operacja_id) => Z.domena.uruchomSkladnik(repo, ctx, { ...dane, operacja_id })); });
        if (!wyn.powtorzenie) { zapiszLog(tenant, wyn.wynik.plan ? 'TERMINARZ: PLAN POWIĄZAŃ' : 'TERMINARZ: SKŁADNIK URUCHOMIONY', imie, `składnik ${dane.skladnik_id}: ${wyn.wynik.powiazan} powiązań${wyn.wynik.plan ? ' (plan, bez rezerwacji)' : ''}`); for (const pid of (wyn.wynik.do_wyjasnienia || [])) await sprawaUpsert(tenant, { typ: 'E21', tytul: 'Wizyta wymaga zakupu lub wyjaśnienia', opis: `Pozycja ${pid}: przy uruchamianiu pakietu rozstrzygnięta jako wymagająca zakupu/wyjaśnienia.`, dane: { pozycja_id: pid, skladnik_id: dane.skladnik_id, dotyczy: [] }, priorytet: 'P2', klucz: `E21:poz:${pid}`, kto: imie }); }
        return { status: 'success', powtorzenie: wyn.powtorzenie, ...wyn.wynik };
      }
      case 'trm_wykonanie_koryguj': { // korekta błędnego wykonania (manager): odwrócenie realizacji, historia zostaje (§9.5)
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const klucz = String(d.klucz_idem || '').slice(0, 64) || crypto.randomUUID();
        const dane = { realizacja_id: Number(d.realizacja_id), wynik: String(d.wynik || ''), powod: String(d.powod || '').trim().slice(0, 300) };
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => {
          const ctx = await ctxZ(tenant, imie, r);
          const real = await repo.realizacja(dane.realizacja_id); if (!real) throw new BladUzytkownika('Nie znaleziono realizacji.');
          const poz = real.pozycja_id ? await repo.pozycja(real.pozycja_id) : null;
          const w = await Z.domena.operacja(repo, ctx, { klucz, rodzaj: 'koryguj', dane }, (operacja_id) => Z.domena.odwrocRealizacje(repo, ctx, { ...dane, data: poz ? String(poz.start).slice(0, 10) : null, operacja_id }));
          if (poz && !w.powtorzenie) await historia(conn, tenant, poz.rezerwacja_id, imie, 'korekta_wykonania', `${poz.kategoria}${poz.wariant ? ' / ' + poz.wariant : ''}: ${dane.wynik === 'odbedzie_sie' ? 'zabieg nadal ma się odbyć' : 'zabieg nie odbędzie się'} — ${dane.powod}`, { realizacja_id: real.id }, w.wynik);
          return { ...w, rezerwacja_id: poz ? poz.rezerwacja_id : null };
        });
        if (!wyn.powtorzenie) zapiszLog(tenant, 'TERMINARZ: KOREKTA WYKONANIA', imie, `realizacja ${dane.realizacja_id}: ${dane.wynik} — ${dane.powod}`);
        return { status: 'success', powtorzenie: wyn.powtorzenie, ...wyn.wynik, rezerwacja: wyn.rezerwacja_id ? await rezerwacja(tenant, wyn.rezerwacja_id) : null };
      }
      case 'trm_pozycja_zrodlo': { // atomowa zmiana zakupu dla pozycji (U10): zwolnienie w starym i przydział w nowym albo nic
        wymagaj(r, ROLE_OPERACYJNE); wymagajIntegracji(tenant);
        const klucz = String(d.klucz_idem || '').slice(0, 64) || crypto.randomUUID();
        const dane = { pozycja_id: Number(d.pozycja_id), nowy_skladnik_id: Number(d.nowy_skladnik_id), powod: String(d.powod || '').slice(0, 300) };
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => {
          const ctx = await ctxZ(tenant, imie, r);
          const poz = await repo.pozycja(dane.pozycja_id, true); if (!poz) throw new BladUzytkownika('Nie znaleziono pozycji.');
          const akt = (await repo.przydzialyPozycji([poz.id])).filter(p => p.stan === 'zarezerwowany'); if (!akt.length) throw new BladUzytkownika('Ta pozycja nie ma aktywnej rezerwacji z pakietu.');
          const w = await Z.domena.operacja(repo, ctx, { klucz, rodzaj: 'zrodlo', dane }, (operacja_id) => Z.domena.przenies(repo, ctx, { przydzial_id: akt[0].id, nowy_skladnik_id: dane.nowy_skladnik_id, id_klienta: poz.id_klienta, data: String(poz.start).slice(0, 10), powod: dane.powod, operacja_id }));
          if (!w.powtorzenie) await historia(conn, tenant, poz.rezerwacja_id, imie, 'zmiana_zrodla', `${poz.kategoria}${poz.wariant ? ' / ' + poz.wariant : ''}: zakup ${akt[0].skladnik_id} → ${dane.nowy_skladnik_id}`, { skladnik_id: akt[0].skladnik_id }, { skladnik_id: dane.nowy_skladnik_id });
          return { ...w, rezerwacja_id: poz.rezerwacja_id };
        });
        return { status: 'success', powtorzenie: wyn.powtorzenie, ...wyn.wynik, rezerwacja: await rezerwacja(tenant, wyn.rezerwacja_id) };
      }
      case 'trm_pozycja_potrac': { // potrącenie jednostki (osobna decyzja, reguła salonu włączona): F rośnie, U nie (§9.4)
        wymagaj(r, ROLE_MANAGER_PLUS); wymagajIntegracji(tenant);
        const ust = await ustawienia(tenant); if (ust.potracenie_nieobecnosc !== 'on') throw new BladUzytkownika('Potrącanie jednostek za nieobecność nie jest włączone w zasadach salonu.');
        const klucz = String(d.klucz_idem || '').slice(0, 64) || crypto.randomUUID();
        const dane = { pozycja_id: Number(d.pozycja_id), ilosc: Number(d.ilosc) || 1, powod: String(d.powod || '').trim().slice(0, 300) };
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => { const ctx = await ctxZ(tenant, imie, r); const poz = await repo.pozycja(dane.pozycja_id, true); if (!poz) throw new BladUzytkownika('Nie znaleziono pozycji.'); const w = await Z.domena.operacja(repo, ctx, { klucz, rodzaj: 'potrac', dane }, (operacja_id) => Z.domena.potrac(repo, ctx, { ...dane, operacja_id })); if (!w.powtorzenie) await historia(conn, tenant, poz.rezerwacja_id, imie, 'potracenie', `${poz.kategoria}: potrącono ${w.wynik.potracono} — ${dane.powod}`, null, w.wynik); return { ...w, rezerwacja_id: poz.rezerwacja_id }; });
        if (!wyn.powtorzenie) zapiszLog(tenant, 'TERMINARZ: POTRĄCENIE JEDNOSTKI', imie, `pozycja ${dane.pozycja_id}: ${wyn.wynik.potracono} — ${dane.powod}`);
        return { status: 'success', powtorzenie: wyn.powtorzenie, ...wyn.wynik, rezerwacja: await rezerwacja(tenant, wyn.rezerwacja_id) };
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
        // ZK-02: jednostki zakupów — opt-in per pozycja (zakup_skladnik_id); walidacja zasobów i jednostek oraz zapis w JEDNEJ transakcji pod blokadą salonu (§15.2)
        const zakupPoz = (Array.isArray(d.pozycje) ? d.pozycje : []).map(p => p && p.zakup_skladnik_id ? Number(p.zakup_skladnik_id) : null);
        if (zakupPoz.some(Boolean) && cfg.ust.zakupy_integracja !== 'on') throw new BladUzytkownika(schemat.gotowy && schematV2.gotowy ? 'Rezerwacja zabiegów z zakupów nie jest włączona w tym salonie.' : 'Rezerwacja zabiegów z zakupów niedostępna — schemat bazy niekompletny.', { code: 'INTEGRACJA' });
        if (zakupPoz.some(Boolean) && !idKlienta) throw new BladUzytkownika('Rezerwacja z zakupu wymaga klientki z kartoteki (ID).', { code: 'WLASCICIEL' });
        if (cfg.ust.kontrola_zakupow === 'on' && zakupPoz.some(x => !x)) throw new BladUzytkownika('Kontrola zakupów jest włączona — wskaż zakup klientki dla każdego zabiegu (albo zarejestruj nowy zakup w Sprzedaży).');
        const skrotDane = { start, klient: idKlienta || nazwa, pozycje: (Array.isArray(d.pozycje) ? d.pozycje : []).map(p => ({ usluga_id: p && p.usluga_id ? String(p.usluga_id) : null, pracownik: (p && p.pracownik) || null, zakup_skladnik_id: (p && p.zakup_skladnik_id) || null })) };
        const wyn = await wTransakcjiSalonu(tenant, async (conn, repo) => {
          // idempotencja: ponowienie tej samej akcji zwraca tę samą wizytę; ten sam klucz z INNYM żądaniem = błąd (A07)
          const ist = await qc(conn, `SELECT id FROM Term_Rezerwacje WHERE tenant_id = ? AND klucz_idem = ?`, [tenant, klucz]);
          if (ist.length) {
            if (schematV2.gotowy) { const op = await repo.operacja(klucz); if (op && op.skrot !== Z.logika.skrotZadania('zapisz', skrotDane)) throw new BladUzytkownika('Ten klucz operacji został już użyty dla innego żądania.', { code: 'KLUCZ_OPERACJI' }); }
            return { status: 'success', powtorzenie: true, rezerwacja: await rezerwacja(tenant, ist[0].id) };
          }
          const k = await kontekstDnia(tenant, start.slice(0, 10), cfg, idKlienta);
          const w = S.sprawdzKomplet({ ...k, start, pozycje: poz });
          if (!w.ok) {
            const alt = await alternatywy(tenant, start.slice(0, 10), poz, cfg, idKlienta, null);
            return { status: 'konflikt', message: w.problemy[0] ? w.problemy[0].opis : 'Wybrany komplet nie jest dostępny.', problemy: w.problemy, alternatywy: alt };
          }
          const ins = await qc(conn, `INSERT INTO Term_Rezerwacje (tenant_id, id_klienta, klient_nazwa, klient_telefon, status, kanal, zrodlo, start, koniec, notatka, brak_kontaktu, klucz_idem, utworzyl) VALUES (?, ?, ?, ?, 'potwierdzona', ?, ?, ?, ?, ?, ?, ?, ?)`,
            [tenant, idKlienta, nazwa, telefon, kanal, String(d.zrodlo || '').slice(0, 100) || null, w.start, w.koniec, String(d.notatka || '').slice(0, 2000) || null, d.brak_kontaktu || !telefon ? 1 : 0, klucz, imie || null]);
          const rezId = ins.insertId; const pozIds = [];
          for (let i = 0; i < w.pozycje.length; i++) {
            const p = w.pozycje[i];
            const pi = await qc(conn, `INSERT INTO Term_Pozycje (tenant_id, rezerwacja_id, kolejnosc, usluga_id, kategoria, wariant, cena, czas_min, pracownik, start, koniec, gabinet_id, urzadzenie_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [tenant, rezId, i, p.usluga_id, p.kategoria, p.wariant || null, p.cena, p.czas_min, p.pracownik, p.start, p.koniec, p.gabinet_id ? Number(p.gabinet_id) : null, p.urzadzenie_id ? Number(p.urzadzenie_id) : null]);
            pozIds.push(pi.insertId);
            for (const z of p.zajecia) await qc(conn, `INSERT INTO Term_Zajecia (tenant_id, rezerwacja_id, pozycja_id, typ_zasobu, klucz, od, do_, powod) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, rezId, pi.insertId, z.typ_zasobu, String(z.klucz), S.naStr(z.od), S.naStr(z.do), z.powod]);
          }
          let ostrzezeniaZakupow = [];
          if (zakupPoz.some(Boolean)) { // przydziały jednostek: cała lista albo nic; brak jednostki = brak wizyty (rollback całości)
            const ctx = await ctxZ(tenant, imie, r);
            const lista = w.pozycje.map((p, i) => zakupPoz[i] ? { pozycja_id: pozIds[i], skladnik_id: zakupPoz[i], usluga_id: p.usluga_id, powod: `EST-${String(rezId).padStart(4, '0')} ${p.nazwa}` } : null).filter(Boolean);
            const wynRez = await Z.domena.operacja(repo, ctx, { klucz, rodzaj: 'zapisz', dane: skrotDane }, (operacja_id) => Z.domena.rezerwuj(repo, ctx, { pozycje: lista, id_klienta: idKlienta, data: start.slice(0, 10), uslugaPozycji: (p) => p.usluga_id, operacja_id }));
            ostrzezeniaZakupow = ((wynRez && wynRez.wynik && wynRez.wynik.ostrzezenia) || []); // Z8: np. zabieg po terminie ważności
          }
          await historia(conn, tenant, rezId, imie, 'utworzono', `${kanal}: ${w.pozycje.map(p => p.nazwa + ' — ' + p.pracownik).join('; ')}`, null, { start: w.start, koniec: w.koniec });
          return { status: 'success', rezId, w, ostrzezenia: ostrzezeniaZakupow };
        });
        if (wyn.status !== 'success' || wyn.powtorzenie) return wyn;
        zapiszLog(tenant, 'TERMINARZ: NOWA WIZYTA', imie, `EST-${String(wyn.rezId).padStart(4, '0')} ${nazwa} ${wyn.w.start.slice(0, 16)} (${wyn.w.pozycje.map(p => p.nazwa).join(', ')})`);
        return { status: 'success', rezerwacja: await rezerwacja(tenant, wyn.rezId), przerwy_min: wyn.w.przerwy_min, ostrzezenia: wyn.ostrzezenia || [] };
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
            // ZK-02 (U07/U08, §10.1): przesunięcie zachowuje przydziały; składniki sprawdzane na NOWĄ datę (ważność, zawieszenie, stan, aktualne źródło) — odmowa = stara wizyta i rezerwacja bez zmian
            if (schematV2.gotowy && aktywne.length) {
              const spr = await Z.domena.sprawdzPrzeniesienie(Z.repoSql((sql, params) => qc(conn, sql, params), tenant), await ctxZ(tenant, imie, r), { pozycjaIds: aktywne.map(p => p.id), data: start.slice(0, 10) });
              if (!spr.ok) { await rollback(conn); return { status: 'konflikt', kod: 'PAKIET', message: `${spr.problemy[0].opis}. Wybierz wcześniejszy termin albo inny zakup. Obecna wizyta i jej rezerwacja pozostają bez zmian.`, podglad: { ...podglad, ok: false, problemy: spr.problemy.map(x => ({ opis: x.opis, typ: 'pakiet' })) }, alternatywy: [] }; }
            }
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
            const czasZmienil = rez.start !== w2.start;
            const kimZmienil = podglad.obecny.pozycje.some((pp, i) => pp.pracownik !== w2.pozycje[i].pracownik);
            const dotyczyWszyscy = [...new Set([...prIz(podglad.obecny.pozycje), ...prIz(w2.pozycje)])];
            if (czasZmienil) {
              await sprawaUpsert(tenant, { typ: 'E02', rezerwacja_id: rez.id, tytul: `Zmieniono termin — ${rez.klient_nazwa}`,
                opis: `${rez.start.slice(0, 16)} → ${w2.start.slice(0, 16)}${d.powod ? ' — ' + String(d.powod).slice(0, 200) : ''}`,
                dane: { poprzednio: podglad.obecny, teraz: podglad.nowy, autor: imie, dotyczy: dotyczyWszyscy },
                priorytet: priorytetDlaCzasu(cfg.terazStr, w2.start), powiazany_czas: w2.start, klucz: `E02:${rez.id}`, kto: imie });
            }
            if (kimZmienil) {
              await sprawaUpsert(tenant, { typ: 'E03', rezerwacja_id: rez.id, tytul: `Zmieniono wykonawcę — ${rez.klient_nazwa}`,
                opis: podglad.obecny.pozycje.map((pp, i) => pp.pracownik !== w2.pozycje[i].pracownik ? `${pp.nazwa}: ${pp.pracownik || '—'} → ${w2.pozycje[i].pracownik || '—'}` : null).filter(Boolean).join('; '),
                dane: { pozycje: podglad.obecny.pozycje.map((pp, i) => ({ nazwa: pp.nazwa, poprzedni: pp.pracownik, nowy: w2.pozycje[i].pracownik })), dotyczy: dotyczyWszyscy },
                priorytet: 'P2', powiazany_czas: w2.start, klucz: `E03:${rez.id}`, kto: imie });
            }
            await sprawyPoZmianieWizyty(tenant, rez.id, imie, 'wizyta przełożona / zmieniony wykonawca'); // E02
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
        const pozn = cel.map(p => p.kategoria + (p.wariant ? ' / ' + p.wariant : '')).join(', ');
        // ZK-02: pod blokadą salonu — zwolnienie jednostek (R − q, U bez zmian, bez zwrotu pieniędzy — D10) w tej samej transakcji co anulacja
        const zwolnione = await wTransakcjiSalonu(tenant, async (conn, repo) => {
          const ctx = schematV2.gotowy ? await ctxZ(tenant, imie, r) : null; let zw = 0;
          for (const p of cel) {
            await qc(conn, `UPDATE Term_Pozycje SET stan = 'anulowana' WHERE tenant_id = ? AND id = ?`, [tenant, p.id]);
            await qc(conn, `UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND pozycja_id = ? AND od >= NOW()`, [tenant, p.id]);
            await qc(conn, `UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND pozycja_id = ? AND powod = 'bufor'`, [tenant, p.id]);
            if (ctx) zw += (await Z.domena.zwolnij(repo, ctx, { pozycja_id: p.id, powod: `${rez.numer}: odwołanie (${kto})` })).zwolniono;
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
          await historia(conn, tenant, rez.id, imie, calosc && nicNieWykonano ? 'anulowano' : 'anulowano_pozycje', `${kto === 'klient' ? 'Klientka odwołała' : 'Salon odwołał'}: ${pozn} — ${powod}${zw ? ` (do pakietu wróciło: ${zw})` : ''}`, null, { pozycje: cel.map(p => p.id), zwolnione_jednostki: zw });
          return zw;
        });
        zapiszLog(tenant, 'TERMINARZ: ODWOŁANIE', imie, `${rez.numer} ${rez.klient_nazwa} (${kto}): ${pozn} — ${powod}`);
        await sprawaUpsert(tenant, { typ: 'E05', rezerwacja_id: rez.id, tytul: `Odwołano wizytę — ${rez.klient_nazwa}`,
          opis: `${kto === 'klient' ? 'Klientka odwołała' : 'Salon odwołał'}: ${pozn} — ${powod}`,
          dane: { pozycje: cel.map(p => ({ kategoria: p.kategoria, wariant: p.wariant, pracownik: p.pracownik, start: p.start })), kto, powod, dotyczy: prIz(cel) },
          priorytet: 'P2', powiazany_czas: null, klucz: `E05:${rez.id}`, kto: imie });
        for (const p of cel) await sprawaAutoZamknij(tenant, `E13:poz:${p.id}`, 'Wizyta odwołana', 'nieaktualna');
        const po = await rezerwacja(tenant, rez.id);
        await sprawyPoZmianieWizyty(tenant, rez.id, imie, 'wizyta odwołana'); // E02
        return { status: 'success', rezerwacja: po, zwolnione_jednostki: zwolnione, rozrachunek: zwolnione ? `Do pakietu ${zwolnione === 1 ? 'wrócił 1 zabieg' : 'wróciły ' + zwolnione + ' zabiegi'}. Rozliczenie środków (zadatki) wykonuje się w istniejących modułach — terminarz ich nie zmienia.` : 'Rozliczenie środków (zadatki, karnet) wykonuje się w istniejących modułach — terminarz ich nie zmienia.' };
      }
      case 'trm_obecnosc': {
        wymagaj(r, ROLE_OPERACYJNE);
        const rez = await rezerwacja(tenant, d.id);
        if (!rez) throw new BladUzytkownika('Nie znaleziono wizyty.');
        if (!OBECNOSCI.includes(d.obecnosc)) throw new BladUzytkownika('Nieznany stan obecności.');
        if (['anulowana', 'odrzucona', 'wygasla'].includes(rez.status)) throw new BladUzytkownika('Wizyta anulowana — nie oznaczamy obecności.');
        if (rez.obecnosc === d.obecnosc) return { status: 'success', powtorzenie: true, rezerwacja: rez };
        await wTransakcjiSalonu(tenant, async (conn, repo) => {
          await qc(conn, `UPDATE Term_Rezerwacje SET obecnosc = ?, obecnosc_zmieniono = NOW(), zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [d.obecnosc, tenant, rez.id]);
          if (d.obecnosc === 'nieobecny') {
            // Nieobecność: przyszłe zasoby zwalnia decyzja człowieka; pozycje zaplanowane → niewykonane.
            // ZK-02: domyślna polityka — jednostka WRACA (R − q), U i F bez zmian; potrącenie to osobna, jawna decyzja (trm_pozycja_potrac) wg reguły salonu (§9.4)
            if (schematV2.gotowy) { const ctx = await ctxZ(tenant, imie, r); for (const p of rez.pozycje.filter(x => x.stan === 'zaplanowana')) await Z.domena.zwolnij(repo, ctx, { pozycja_id: p.id, powod: `${rez.numer}: nieobecność` }); }
            await qc(conn, `UPDATE Term_Pozycje SET stan = 'niewykonana' WHERE tenant_id = ? AND rezerwacja_id = ? AND stan = 'zaplanowana'`, [tenant, rez.id]);
            await qc(conn, `UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND rezerwacja_id = ? AND do_ > NOW()`, [tenant, rez.id]);
          }
          await historia(conn, tenant, rez.id, imie, 'obecnosc', `${rez.obecnosc} → ${d.obecnosc}${d.powod ? ' — ' + String(d.powod).slice(0, 200) : ''}`, { obecnosc: rez.obecnosc }, { obecnosc: d.obecnosc });
        });
        if (d.obecnosc === 'nieobecny') {
          const zaplanowaneIdy = rez.pozycje.filter(p => p.stan === 'zaplanowana').map(p => p.id);
          await sprawaUpsert(tenant, { typ: 'E06', rezerwacja_id: rez.id, tytul: `Potwierdzono nieobecność — ${rez.klient_nazwa}`,
            opis: d.powod ? String(d.powod).slice(0, 300) : null,
            dane: { pozycje: rez.pozycje.map(p => ({ kategoria: p.kategoria, wariant: p.wariant, pracownik: p.pracownik })), dotyczy: prIz(rez.pozycje) },
            priorytet: 'P2', powiazany_czas: null, klucz: `E06:${rez.id}`, kto: imie });
          for (const pid of zaplanowaneIdy) await sprawaAutoZamknij(tenant, `E13:poz:${pid}`, 'Potwierdzono nieobecność klientki');
        }
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
        const wyk = d.wykonawca ? String(d.wykonawca).trim() : (imie || p.pracownik);
        if (d.wykonawca && !(await pracownicy(tenant)).includes(wyk)) throw new BladUzytkownika('Wskazany wykonawca nie jest pracownikiem salonu.');
        // ZK-02: pozycja z aktywnym przydziałem — potwierdzenie wykonania zużywa jednostkę (D04). Uprawnienie (§18.1): manager+, wykonawca własnej pozycji,
        // recepcja tylko z włączonym ustawieniem salonu. Rzeczywista data: moment potwierdzenia albo jawnie wskazana (manager+, powód); planowana godzina NIE jest faktem (§9.2).
        const przydzialy = schematV2.gotowy ? await q(`SELECT id, cykl FROM Term_Przydzialy WHERE tenant_id = ? AND pozycja_id = ? AND stan = 'zarezerwowany' ORDER BY id`, [tenant, p.id]) : [];
        const zPakietu = przydzialy.length > 0;
        let dataFakt = null;
        if (zPakietu && stan === 'wykonana') {
          const ust = await ustawienia(tenant);
          const wolno = ROLE_MANAGER_PLUS.has(r) || (ROLE_SPECJALISTA.has(r) && p.pracownik === imie) || (r === 'recepcja' && ust.recepcja_potwierdza_wykonanie);
          if (!wolno) throw new BladUzytkownika('Potwierdzenie wykonania zabiegu z pakietu należy do wykonawcy albo managera (recepcja — tylko gdy salon to włączył w ustawieniach).', { code: 'UPRAWNIENIA' });
          if (d.data_fakt) { wymagaj(r, ROLE_MANAGER_PLUS, 'Wskazanie innej daty wykonania wymaga uprawnienia managera.'); if (!String(d.powod || '').trim()) throw new BladUzytkownika('Podaj powód wpisania wykonania z inną datą.'); dataFakt = sprawdzDt(d.data_fakt, 'data wykonania'); }
        }
        if (['w_trakcie', 'wykonana'].includes(stan) && rez.obecnosc === 'oczekiwana') await q(`UPDATE Term_Rezerwacje SET obecnosc = 'przybyl', obecnosc_zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [tenant, rez.id]);
        const wynJ = await wTransakcjiSalonu(tenant, async (conn, repo) => {
          if (stan === 'w_trakcie') await qc(conn, `UPDATE Term_Pozycje SET stan = 'w_trakcie', start_fakt = NOW(), wykonawca_fakt = ? WHERE tenant_id = ? AND id = ?`, [wyk, tenant, p.id]);
          else if (stan === 'wykonana' || stan === 'przerwana') await qc(conn, `UPDATE Term_Pozycje SET stan = ?, koniec_fakt = NOW(), wykonawca_fakt = COALESCE(wykonawca_fakt, ?) WHERE tenant_id = ? AND id = ?`, [stan, wyk, tenant, p.id]); // start_fakt zostaje NULL, gdy nie było „Rozpocznij”: planowana godzina nie udaje faktycznej (§9.2)
          else await qc(conn, `UPDATE Term_Pozycje SET stan = ? WHERE tenant_id = ? AND id = ?`, [stan, tenant, p.id]);
          if (['niewykonana', 'odmowa', 'przerwana'].includes(stan)) await qc(conn, `UPDATE Term_Zajecia SET aktywne = 0 WHERE tenant_id = ? AND pozycja_id = ? AND do_ > NOW()`, [tenant, p.id]);
          let j = null;
          if (zPakietu) {
            const ctx = await ctxZ(tenant, imie, r);
            if (stan === 'wykonana') { // R − q, U + q dokładnie raz: stan przydziału + klucz operacji (per przydział/cykl) blokują podwójne zużycie także przy innym kluczu (A08, R05)
              const klucz = String(d.klucz_idem || '').slice(0, 64) || `wykonanie:${p.id}:${przydzialy[0].id}`;
              const dane = { pozycja_id: p.id, przydzial_id: przydzialy[0].id, ilosc: d.ilosc == null ? null : Number(d.ilosc), data_fakt: dataFakt };
              const w = await Z.domena.operacja(repo, ctx, { klucz, rodzaj: 'wykonanie', dane }, (operacja_id) => Z.domena.wykonaj(repo, ctx, { pozycja_id: p.id, ilosc: dane.ilosc, wykonawca_fakt: wyk, data_fakt: dataFakt, powod: d.powod ? String(d.powod).slice(0, 300) : null, operacja_id }));
              j = w.wynik;
            } else if (stan === 'niewykonana' || stan === 'odmowa') { j = await Z.domena.zwolnij(repo, ctx, { pozycja_id: p.id, powod: `${rez.numer}: ${stan}` }); }
            // 'przerwana': NIE zużywa i NIE zwalnia — pozycja nierozstrzygnięta, przydział zostaje do jawnej decyzji (§9.3, R07); 'w_trakcie': bez zmian
          }
          await historia(conn, tenant, rez.id, imie, 'wykonanie', `${p.kategoria}${p.wariant ? ' / ' + p.wariant : ''}: ${p.stan} → ${stan}${d.uwaga ? ' — ' + String(d.uwaga).slice(0, 200) : ''}${j && j.zuzyto ? ` (z pakietu: ${j.zuzyto})` : ''}`, { stan: p.stan }, { stan, wykonawca: wyk, data_fakt: dataFakt || null, jednostki: j });
          return j;
        });
        await sprawaAutoZamknij(tenant, `E13:poz:${p.id}`, `Ustalono: ${stan}`);
        if (stan === 'przerwana') {
          await sprawaUpsert(tenant, { typ: 'E08', rezerwacja_id: rez.id, tytul: `Przerwano usługę — ${rez.klient_nazwa}`,
            opis: `${p.kategoria}${p.wariant ? ' / ' + p.wariant : ''}${d.uwaga ? ' — ' + String(d.uwaga).slice(0, 200) : ''}${zPakietu ? ' — jednostka pakietu pozostaje zarezerwowana do decyzji (wykonana / do przełożenia / odwołana)' : ''}`,
            dane: { kategoria: p.kategoria, wariant: p.wariant, pracownik: wyk, dotyczy: [wyk].filter(Boolean), z_pakietu: zPakietu },
            priorytet: 'P1', powiazany_czas: rez.koniec, klucz: `E08:${rez.id}:${p.id}`, kto: imie });
        }
        return { status: 'success', rezerwacja: await rezerwacja(tenant, rez.id), jednostki: wynJ || null };
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
        await sprawaAutoZamknij(tenant, `E19:rez:${rez.id}`, 'Powiązano ze sprzedażą ' + baza);
        return { status: 'success', znaleziono: true, sprzedaz_id: baza, sprzedaz: rows.filter(x => String(x.id).replace(/-\d+$/, '') === baza), rezerwacja: await rezerwacja(tenant, rez.id) };
      }
      case 'trm_notatka': {
        wymagaj(r, ROLE_OPERACYJNE);
        await q(`UPDATE Term_Rezerwacje SET notatka = ?, zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [String(d.notatka || '').slice(0, 2000) || null, tenant, Number(d.id)]);
        return { status: 'success' };
      }
      // ───────── centrum powiadomień: Sprawy ─────────
      case 'trm_sprawy_lista': {
        if (!ROLE_OPERACYJNE.has(r) && !ROLE_SPECJALISTA.has(r)) throw new BladUzytkownika('Brak dostępu do powiadomień.');
        const zakladka = ['do_dzialania', 'zmiany', 'dla_mnie', 'informacje'].includes(d.zakladka) ? d.zakladka : 'do_dzialania';
        return { status: 'success', zakladka, sprawy: await sprawyLista(tenant, r, imie, zakladka) };
      }
      case 'trm_sprawy_licznik': {
        if (!ROLE_OPERACYJNE.has(r) && !ROLE_SPECJALISTA.has(r)) return { status: 'success', otwarte: 0, pilne: 0, nieprzeczytane: 0 };
        return { status: 'success', ...(await sprawyLicznik(tenant, r, imie)) };
      }
      case 'trm_sprawa_szczegoly': {
        if (!ROLE_OPERACYJNE.has(r) && !ROLE_SPECJALISTA.has(r)) throw new BladUzytkownika('Brak dostępu do powiadomień.');
        const row = (await q(`SELECT * FROM Term_Sprawy WHERE tenant_id = ? AND id = ?`, [tenant, Number(d.id)]))[0];
        const widoczna = row ? sprawaDlaOdbiorcy(row, r, imie) : null;
        if (!widoczna) throw new BladUzytkownika('Nie znaleziono sprawy.');
        await odswiezDotkniete(tenant, row, null, 'sprawdzenie przy otwarciu'); // E02: stan źródłowy, nie lista z chwili utworzenia
        const swieza = sprawaDlaOdbiorcy(row, r, imie) || widoczna;
        const dziennik = await q(`SELECT DATE_FORMAT(kiedy,'%Y-%m-%d %H:%i:%s') AS kiedy, kto, akcja, opis FROM Term_Sprawy_Dziennik WHERE tenant_id = ? AND sprawa_id = ? ORDER BY id`, [tenant, widoczna.id]);
        return { status: 'success', sprawa: formatujSprawe(swieza), dziennik };
      }
      case 'trm_sprawa_przejmij': {
        if (!ROLE_OPERACYJNE.has(r) && !ROLE_SPECJALISTA.has(r)) throw new BladUzytkownika('Brak dostępu do powiadomień.');
        const id = Number(d.id);
        const row = (await q(`SELECT * FROM Term_Sprawy WHERE tenant_id = ? AND id = ?`, [tenant, id]))[0];
        const widoczna0 = row ? sprawaDlaOdbiorcy(row, r, imie) : null;
        if (!widoczna0) throw new BladUzytkownika('Nie znaleziono sprawy.');
        if (row.wlasciciel && row.wlasciciel !== imie) return { status: 'success', juz_przejeta: true, sprawa: formatujSprawe(widoczna0) };
        await q(`UPDATE Term_Sprawy SET wlasciciel = ?, stan = IF(stan = 'nowa', 'w_trakcie', stan), zmieniono = NOW() WHERE tenant_id = ? AND id = ? AND (wlasciciel IS NULL OR wlasciciel = ?)`, [imie, tenant, id, imie]);
        const swiezy = (await q(`SELECT * FROM Term_Sprawy WHERE tenant_id = ? AND id = ?`, [tenant, id]))[0];
        const widocznaPo = sprawaDlaOdbiorcy(swiezy, r, imie);
        if (swiezy.wlasciciel !== imie) return { status: 'success', juz_przejeta: true, sprawa: formatujSprawe(widocznaPo) };
        await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'przejeto', ?)`, [tenant, id, imie, `${imie} przejęła sprawę`]);
        return { status: 'success', sprawa: formatujSprawe(widocznaPo) };
      }
      case 'trm_sprawa_przekaz': {
        wymagaj(r, ROLE_OPERACYJNE);
        const id = Number(d.id), komu = String(d.komu || '').trim();
        if (!komu) throw new BladUzytkownika('Wskaż osobę, której przekazujesz sprawę.');
        const up = await q(`UPDATE Term_Sprawy SET wlasciciel = ?, zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [komu, tenant, id]);
        if (!up.affectedRows) throw new BladUzytkownika('Nie znaleziono sprawy.');
        await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'przekazano', ?)`, [tenant, id, imie, `Przekazano: ${komu}${d.powod ? ' — ' + String(d.powod).slice(0, 200) : ''}`]);
        return { status: 'success' };
      }
      case 'trm_sprawa_kontakt': {
        if (!ROLE_OPERACYJNE.has(r) && !ROLE_SPECJALISTA.has(r)) throw new BladUzytkownika('Brak dostępu do powiadomień.');
        const id = Number(d.id), tresc = String(d.tresc || '').trim().slice(0, 500);
        if (!tresc) throw new BladUzytkownika('Opisz wynik kontaktu.');
        const row = (await q(`SELECT * FROM Term_Sprawy WHERE tenant_id = ? AND id = ?`, [tenant, id]))[0];
        if (!row || !sprawaDlaOdbiorcy(row, r, imie)) throw new BladUzytkownika('Nie znaleziono sprawy.');
        const termin = d.termin_dzialania ? sprawdzDt(d.termin_dzialania, 'termin_dzialania') : null;
        await q(`UPDATE Term_Sprawy SET stan = 'oczekuje', termin_dzialania = COALESCE(?, termin_dzialania), zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [termin, tenant, id]);
        await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'kontakt', ?)`, [tenant, id, imie, tresc]);
        return { status: 'success' };
      }
      case 'trm_sprawa_rozwiaz': {
        if (!ROLE_OPERACYJNE.has(r) && !ROLE_SPECJALISTA.has(r)) throw new BladUzytkownika('Brak dostępu do powiadomień.');
        const id = Number(d.id), wynik = String(d.wynik || '').trim().slice(0, 500);
        if (!wynik) throw new BladUzytkownika('Opisz wynik sprawy.');
        const row = (await q(`SELECT * FROM Term_Sprawy WHERE tenant_id = ? AND id = ?`, [tenant, id]))[0];
        if (!row || !sprawaDlaOdbiorcy(row, r, imie)) throw new BladUzytkownika('Nie znaleziono sprawy.');
        // E02: sprawa z listą wizyt zamyka się dopiero po obsłużeniu wszystkich (stan źródłowy); wyjątek tylko dla managera, jawnie oznaczony
        const stanD = await odswiezDotkniete(tenant, row, imie, 'sprawdzenie przy zamykaniu');
        if (stanD.zamknieta) return { status: 'success', zamknieta_automatycznie: true, message: 'Wszystkie wizyty są już poza kolizją — sprawa zamknęła się sama.' };
        if (stanD.pozostalo) {
          if (!d.wyjatek) throw new BladUzytkownika(`Pozostało ${stanD.pozostalo} ${stanD.pozostalo === 1 ? 'wizyta' : stanD.pozostalo < 5 ? 'wizyty' : 'wizyt'} do obsłużenia — przełóż je, zmień wykonawcę albo odwołaj. Notatka nie usuwa kolizji.`, { pozostalo: stanD.pozostalo });
          if (!ROLE_MANAGER_PLUS.has(r)) throw new BladUzytkownika('Zamknięcie sprawy mimo nieobsłużonych wizyt wymaga managera.');
          await q(`UPDATE Term_Sprawy SET stan = 'rozwiazana', wynik = ?, rozwiazal = ?, rozwiazano = NOW(), zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [`WYJĄTEK MANAGERA (${stanD.pozostalo} wizyt nieobsłużonych): ${wynik}`, imie, tenant, id]);
          await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'wyjatek_managera', ?)`, [tenant, id, imie, `Zamknięto wyjątkowo mimo ${stanD.pozostalo} nieobsłużonych wizyt: ${wynik}`.slice(0, 500)]);
          zapiszLog(tenant, 'TERMINARZ: SPRAWA — WYJĄTEK MANAGERA', imie, `sprawa #${id}: ${stanD.pozostalo} wizyt nieobsłużonych — ${wynik}`);
          return { status: 'success', wyjatek: true };
        }
        await q(`UPDATE Term_Sprawy SET stan = 'rozwiazana', wynik = ?, rozwiazal = ?, rozwiazano = NOW(), zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [wynik, imie, tenant, id]);
        await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'rozwiazano', ?)`, [tenant, id, imie, wynik]);
        return { status: 'success' };
      }
      case 'trm_sprawa_wznow': {
        wymagaj(r, ROLE_OPERACYJNE);
        const id = Number(d.id), powod = String(d.powod || '').trim().slice(0, 300) || 'Wznowiono';
        const up = await q(`UPDATE Term_Sprawy SET stan = 'nowa', wlasciciel = NULL, rozwiazano = NULL, zmieniono = NOW() WHERE tenant_id = ? AND id = ? AND stan IN ('rozwiazana', 'nieaktualna')`, [tenant, id]);
        if (!up.affectedRows) throw new BladUzytkownika('Sprawa jest już otwarta albo nie istnieje.');
        await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'wznowiono', ?)`, [tenant, id, imie, powod]);
        return { status: 'success' };
      }
      case 'trm_sprawa_pozycja_obsluzono': {
        if (!ROLE_OPERACYJNE.has(r) && !ROLE_SPECJALISTA.has(r)) throw new BladUzytkownika('Brak dostępu do powiadomień.');
        const id = Number(d.id), rezId = Number(d.rezerwacja_id);
        const row = (await q(`SELECT * FROM Term_Sprawy WHERE tenant_id = ? AND id = ?`, [tenant, id]))[0];
        if (!row || !sprawaDlaOdbiorcy(row, r, imie)) throw new BladUzytkownika('Nie znaleziono sprawy.');
        const dane = json(row.dane_json, {});
        if (!Array.isArray(dane.dotkniete)) throw new BladUzytkownika('Ta sprawa nie ma listy wizyt.');
        if (!dane.dotkniete.some(x => Number(x.rezerwacja_id) === rezId)) throw new BladUzytkownika('Ta wizyta nie jest na liście tej sprawy.');
        // E02: znacznik nie ukrywa aktywnej kolizji — sprawdzamy stan źródłowy; wyjątek managera jawny (powód w historii)
        const kol = await kolizjaWizytyWSprawie(tenant, row, rezId);
        if (kol.koliduje && !(d.wyjatek && ROLE_MANAGER_PLUS.has(r))) throw new BladUzytkownika(`Wizyta EST-${String(rezId).padStart(4, '0')} nadal koliduje (${kol.powod}) — przełóż ją, zmień wykonawcę albo odwołaj. Samo oznaczenie nie usuwa kolizji.`, { koliduje: true });
        let zmienilo = false;
        dane.dotkniete = dane.dotkniete.map(x => { if (Number(x.rezerwacja_id) === rezId) { zmienilo = true; return { ...x, rozwiazana: true, jak: kol.koliduje ? `WYJĄTEK MANAGERA: ${String(d.powod || '').slice(0, 200)}` : kol.powod }; } return x; });
        const wszystkie = dane.dotkniete.every(x => x.rozwiazana);
        if (wszystkie) {
          await q(`UPDATE Term_Sprawy SET dane_json = ?, stan = 'rozwiazana', rozwiazal = ?, rozwiazano = NOW(), wynik = 'Wszystkie dotknięte wizyty obsłużone', zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [JSON.stringify(dane), imie, tenant, id]);
        } else {
          await q(`UPDATE Term_Sprawy SET dane_json = ?, zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [JSON.stringify(dane), tenant, id]);
        }
        await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) VALUES (?, ?, ?, 'obsluzono_pozycje', ?)`, [tenant, id, imie, `Wizyta EST-${String(rezId).padStart(4, '0')} obsłużona${wszystkie ? ' — cała sprawa zamknięta' : ''}`]);
        return { status: 'success' };
      }
      case 'trm_sprawy_przeczytane': {
        if (!imie) return { status: 'success', oznaczono: 0 };
        const ids = Array.isArray(d.ids) ? d.ids.map(Number).filter(Boolean) : (d.id ? [Number(d.id)] : []);
        for (const id of ids.slice(0, 200)) await q(`INSERT IGNORE INTO Term_Sprawy_Odczyt (tenant_id, sprawa_id, pracownik) VALUES (?, ?, ?)`, [tenant, id, imie]);
        return { status: 'success', oznaczono: ids.length };
      }
      default:
        throw new BladUzytkownika('Nieznana akcja terminarza: ' + action);
    }
  }

  // ─── Centrum powiadomień: eskalacja czasowa + zdarzenia bez pojedynczego wyzwalacza (E13/E19) ───
  // Ten sam wzorzec co w routes/lojalnosc.js (tickHarmonogramu): co 60 s, własny try/catch,
  // nie startuje w testach. Baza wspólna dla dev+prod — UPDATE z warunkiem w WHERE jest atomowym claimem.
  async function tickSprawy() {
    try {
      const kandydaciEskalacji = await q(`SELECT id FROM Term_Sprawy WHERE priorytet = 'P1' AND stan IN ('nowa', 'w_trakcie', 'oczekuje') AND powiazany_czas IS NOT NULL AND powiazany_czas <= DATE_ADD(NOW(), INTERVAL 120 MINUTE) LIMIT 100`).catch(() => []);
      for (const s of (kandydaciEskalacji || [])) {
        const up = await q(`UPDATE Term_Sprawy SET priorytet = 'P0', eskalowano_o = NOW(), zmieniono = NOW() WHERE id = ? AND priorytet = 'P1'`, [s.id]).catch(() => null);
        if (up && up.affectedRows) await q(`INSERT INTO Term_Sprawy_Dziennik (tenant_id, sprawa_id, kto, akcja, opis) SELECT tenant_id, id, 'System', 'eskalacja', 'Podniesiono priorytet do P0 — zbliża się powiązany termin' FROM Term_Sprawy WHERE id = ?`, [s.id]).catch(() => {});
      }
      const bezWyniku = await q(`SELECT p.id AS pozycja_id, p.rezerwacja_id, p.tenant_id, p.pracownik, p.kategoria, p.wariant, DATE_FORMAT(p.koniec,'%Y-%m-%d %H:%i:%s') AS koniec, r.klient_nazwa
        FROM Term_Pozycje p JOIN Term_Rezerwacje r ON r.id = p.rezerwacja_id AND r.tenant_id = p.tenant_id
        WHERE p.stan IN ('zaplanowana', 'w_trakcie') AND r.status NOT IN ('anulowana', 'odrzucona', 'wygasla') AND p.koniec <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
        LIMIT 200`).catch(() => []);
      for (const poz of (bezWyniku || [])) {
        await sprawaUpsert(poz.tenant_id, { typ: 'E13', rezerwacja_id: poz.rezerwacja_id, tytul: `Brak wyniku wizyty — ${poz.klient_nazwa}`,
          opis: `${poz.kategoria}${poz.wariant ? ' / ' + poz.wariant : ''} — planowany koniec ${poz.koniec.slice(0, 16)}, brak potwierdzonego wykonania lub nieobecności.`,
          dane: { pozycja_id: poz.pozycja_id, pracownik: poz.pracownik, planowany_koniec: poz.koniec, dotyczy: [poz.pracownik].filter(Boolean) },
          priorytet: 'P1', powiazany_czas: poz.koniec, klucz: `E13:poz:${poz.pozycja_id}`, kto: null });
      }
      const bezPokrycia = await q(`SELECT r.id, r.tenant_id, r.klient_nazwa, DATE_FORMAT(r.koniec,'%Y-%m-%d %H:%i:%s') AS koniec
        FROM Term_Rezerwacje r WHERE r.sprzedaz_id IS NULL AND r.status NOT IN ('anulowana', 'odrzucona', 'wygasla')
          AND r.koniec <= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
          AND EXISTS (SELECT 1 FROM Term_Pozycje p WHERE p.tenant_id = r.tenant_id AND p.rezerwacja_id = r.id AND p.stan IN ('wykonana', 'przerwana'))
        LIMIT 200`).catch(() => []);
      for (const rz of (bezPokrycia || [])) {
        const wyk = await q(`SELECT pracownik, kategoria, wariant FROM Term_Pozycje WHERE tenant_id = ? AND rezerwacja_id = ? AND stan IN ('wykonana', 'przerwana')`, [rz.tenant_id, rz.id]).catch(() => []);
        await sprawaUpsert(rz.tenant_id, { typ: 'E19', rezerwacja_id: rz.id, tytul: `Potwierdź rozliczenie — ${rz.klient_nazwa}`,
          opis: `Wizyta zakończona ${rz.koniec.slice(0, 16)}, brak powiązanej sprzedaży.`,
          dane: { pozycje: wyk, dotyczy: prIz(wyk) },
          priorytet: 'P1', powiazany_czas: null, klucz: `E19:rez:${rz.id}`, kto: null });
      }
    } catch (e) { log.error('[terminarz] tickSprawy:', e.message); }
    // ZK-03 (Z3-07): okresowe uzgadnianie źródeł zakupów — co 5 minut, tylko salony z dostępnością techniczną i zapisaną ewidencją aktywna/konczenie.
    // Brak tabel v2 albo błąd jednego źródła nie zatrzymuje CRM; ten sam problem aktualizuje jedną sprawę (klucz E20:<zakup>), nie tworzy nowej co 5 minut.
    try {
      if (schematV2.gotowy && (tickSprawy.licznik = (tickSprawy.licznik || 0) + 1) % 5 === 0) {
        const salony = await q(`SELECT tenant_id FROM Term_Ewidencja WHERE tryb IN ('aktywna','konczenie') AND przerwa_od IS NULL`).catch(() => []);
        for (const s of salony) {
          if (!integracjaZakupow(s.tenant_id)) continue;
          const w = await wTransakcjiSalonu(s.tenant_id, async (conn, repo) => Z.domena.uzgodnijOkresowo(repo, await ctxZ(s.tenant_id, null, null), { limit: 200 })).catch(e => { log.error('[terminarz] uzgadnianie', s.tenant_id, e.message); return null; });
          for (const x of ((w && w.zmiany) || [])) await sprawaZrodla(s.tenant_id, { ...x, kto: null }).catch(() => {});
        }
      }
    } catch (e) { log.error('[terminarz] uzgadnianie okresowe:', e.message); }
  }
  if (!process.env.JEST_WORKER_ID && process.env.NODE_ENV !== 'test') {
    const timerSprawy = setInterval(tickSprawy, 60 * 1000);
    if (timerSprawy.unref) timerSprawy.unref();
    const pierwszySprawy = setTimeout(tickSprawy, 8000);
    if (pierwszySprawy.unref) pierwszySprawy.unref();
  }

  router.sprawdzSchemat = sprawdzSchemat; router.sprawdzSchematV2 = sprawdzSchematV2; // do testów kontraktu (jest): wymuszenie sprawdzenia schematów na atrapie bazy
  return router;
};
module.exports.FEATURE_KEY = FEATURE_KEY;
module.exports.AKCJE = ['trm_init', 'trm_ustawienia_zapisz', 'trm_zasob_zapisz', 'trm_zasob_archiwizuj', 'trm_usluga_zapisz', 'trm_grafik_zapisz', 'trm_grafik_z_godzin_salonu', 'trm_nieobecnosc_zapisz', 'trm_nieobecnosc_usun', 'trm_zespol_zapisz', 'trm_dzien', 'trm_zakres', 'trm_rezerwacja', 'trm_szukaj_klienta', 'trm_szukaj_wizyt', 'trm_grafik_dzien_zapisz', 'trm_grafik_dzien_usun', 'trm_zakupy_klientki', 'trm_zakupy_uzgodnij', 'trm_zakupy_podglad', 'trm_zakupy_rejestruj', 'trm_zakup_kwalifikuj', 'trm_skladnik_kandydaci', 'trm_ewidencja_stan', 'trm_oferty_lista', 'trm_oferta_zapisz', 'trm_zakupy_import', 'trm_zakup_bilans', 'trm_ewidencja_ustaw', 'trm_zakup_przyznaj', 'trm_skladnik_weryfikuj', 'trm_skladnik_uruchom', 'trm_wykonanie_koryguj', 'trm_pozycja_zrodlo', 'trm_pozycja_potrac', 'trm_sprawdz', 'trm_szukaj', 'trm_zapisz', 'trm_zmien', 'trm_anuluj', 'trm_obecnosc', 'trm_pozycja_stan', 'trm_rozlicz_start', 'trm_rozlicz_powiaz', 'trm_notatka', 'trm_sprawy_lista', 'trm_sprawy_licznik', 'trm_sprawa_szczegoly', 'trm_sprawa_przejmij', 'trm_sprawa_przekaz', 'trm_sprawa_kontakt', 'trm_sprawa_rozwiaz', 'trm_sprawa_wznow', 'trm_sprawa_pozycja_obsluzono', 'trm_sprawy_przeczytane'];
