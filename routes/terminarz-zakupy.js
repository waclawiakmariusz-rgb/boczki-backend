// routes/terminarz-zakupy.js — ZK-02: ewidencja jednostek zakupionych zabiegów (model v2), w granicach dodatku Terminarz.
//
//  Spec: design/terminarz 2.0/raport naprawczy/po3/Estelio_Terminarz_Realizacja_Zakupow_Specyfikacja_Claude_Code_v1_2026-10-16.md
//        + Estelio_ZK02_Decyzje_i_Polecenia_Claude_Code_2026-10-16.md; rozpoznanie: docs/terminarz-zakupy/ZAKUPY_01_MAPA_STANU_I_PLAN.md
//
//  Zasady (D01–D20, §4.2, §7, §15):
//   • rdzeń (Sprzedaz, Zadatki, Klienci, Uslugi) jest TYLKO czytany; żadnych kolumn, FK ani wywołań w sprzedaz.js,
//   • jeden właściciel salda: ten moduł. Saldo składnika liczone z ruchów ze znakiem: G/W/U/F/R → L = G−W−U−F, B = L−R;
//     ujemny wynik NIE jest przycinany do zera — składnik dostaje stan „niespojny” i blokadę użycia,
//   • przydział (rezerwacja) ≠ realizacja (fakt wykonania) ≠ ruch (niezmienny zapis); korekta = odwrócenie, nigdy usunięcie,
//   • każda mutacja jednostek przez wTransakcjiSalonu(): GET_LOCK('trm:<salon>') → BEGIN → … → COMMIT → RELEASE_LOCK,
//   • idempotencja: Term_Operacje (klucz per salon + skrót żądania); ten sam klucz z innym żądaniem = błąd (A07),
//     a stan domeny (przydział zużyty/zwolniony) blokuje podwójne zużycie także przy innym kluczu (A08),
//   • hash źródła (migawka istotnych pól Sprzedaz) wykrywa zmiany między odczytami; NIE zastępuje blokady — przed
//     mutacją źródło jest czytane ponownie w transakcji (FOR SHARE) i porównywane,
//   • schemat v2 NIE jest tworzony przy starcie serwera: start tylko sprawdza obecność (sprawdzSchematV2), migrację
//     uruchamia jawnie narzedzia/terminarz-zakupy-migracja.js (odrębna baza; odmowa dla bazy z .env bez potwierdzenia),
//   • tryby ewidencji (§14.1) per salon w Term_Ewidencja; bez trybu „aktywna” serwer odmawia nowych przydziałów,
//     a bez „aktywna/konczenie” — każdej mutacji jednostek. Lista techniczna salonów (env) i licencja dodatku są
//     warunkami osobnymi (sprawdza routes/terminarz.js).
'use strict';
const crypto = require('crypto');

const WERSJA_SCHEMATU_V2 = '2026-10-17';
const TRYBY = ['nie_uruchomiono', 'przygotowanie', 'aktywna', 'konczenie', 'wstrzymana', 'zakonczona', 'uzgadnianie'];
// dozwolone przejścia trybów (§14): każda zmiana jest jawną decyzją managera
const PRZEJSCIA = {
  nie_uruchomiono: ['przygotowanie'],
  przygotowanie: ['aktywna', 'nie_uruchomiono'],
  aktywna: ['konczenie', 'wstrzymana', 'uzgadnianie'],
  konczenie: ['zakonczona', 'aktywna', 'wstrzymana'],
  wstrzymana: ['uzgadnianie', 'konczenie'],
  zakonczona: ['uzgadnianie'],
  uzgadnianie: ['aktywna', 'konczenie'],
};
const TRYBY_NOWE_PRZYDZIALY = new Set(['aktywna']);
const TRYBY_MUTACJE = new Set(['aktywna', 'konczenie']);
const RODZAJE_OFERTY = ['pakiet', 'pojedynczy_z_gory', 'nie_ewidencjonuj', 'nieobslugiwany'];
const KWALIFIKACJE = ['pakiet', 'pojedynczy_z_gory', 'nie_ewidencjonuj', 'do_sprawdzenia'];

class BladDomeny extends Error { constructor(msg, extra) { super(msg); this.extra = extra || {}; this.uzytkownika = true; } }

// ═══════════════════ LOGIKA CZYSTA (bez bazy) ═══════════════════
const logika = {
  /** Saldo składnika z listy ruchów {typ:'G'|'W'|'U'|'F'|'R', kierunek:+1|-1, ilosc}. Niezmienniki §7.1 — bez przycinania. */
  saldo(ruchy) {
    const s = { G: 0, W: 0, U: 0, F: 0, R: 0, U_hist: 0, U_term: 0, R_oczekuje: 0 };
    for (const r of ruchy || []) {
      const q = Number(r.ilosc) * (Number(r.kierunek) || 1);
      if (!(r.typ in s)) continue;
      s[r.typ] += q;
      if (r.typ === 'U') { if (r.historyczny) s.U_hist += q; else s.U_term += q; }
    }
    s.L = s.G - s.W - s.U - s.F;
    s.B = s.L - s.R;
    s.niespojny = [s.G, s.W, s.U, s.F, s.R].some(x => x < 0) || s.L < 0 || s.B < 0;
    return s;
  },
  /** Powód niedostępności składnika do NOWEGO przydziału na datę `data` (YYYY-MM-DD) albo null. */
  powodNiedostepnosci(skl, zakup, saldo, data, tryb) {
    if (!TRYBY_NOWE_PRZYDZIALY.has(tryb)) return tryb === 'nie_uruchomiono' || tryb === 'przygotowanie' ? 'ewidencja zakupów nie jest uruchomiona' : `ewidencja w trybie „${tryb}” — nowe umówienia z pakietu wstrzymane`;
    if (saldo.niespojny || skl.stan === 'niespojny') return 'stan niespójny — wymaga sprawdzenia';
    if (zakup.stan_zrodla && zakup.stan_zrodla !== 'ok') return zakup.stan_zrodla === 'usuniete' ? 'zakup usunięty w Sprzedaży — wymaga wyjaśnienia' : zakup.stan_zrodla === 'wycofane' ? 'zakup wycofany/zwrócony — wymaga wyjaśnienia' : 'zakup zmieniony w Sprzedaży — wymaga wyjaśnienia';
    if (zakup.stan && zakup.stan !== 'aktywny') return zakup.stan === 'zamkniety' ? 'zakup zakończony w Sprzedaży — do uzgodnienia' : `zakup: ${zakup.stan}`;
    if (skl.stan === 'wycofany') return 'składnik wycofany';
    if (skl.stan === 'do_uzgodnienia') return 'składnik wymaga uzgodnienia';
    if (skl.stan_weryfikacji !== 'zweryfikowany') return 'stan do sprawdzenia — najpierw potwierdź, ile zabiegów pozostało';
    if (!skl.zalezne_uzgodniono || !skl.aktywny_od) return 'najpierw powiąż istniejące wizyty';
    if (skl.zawieszono_od && skl.zawieszono_do && data >= String(skl.zawieszono_od).slice(0, 10) && data <= String(skl.zawieszono_do).slice(0, 10)) return `składnik zawieszony do ${String(skl.zawieszono_do).slice(0, 10)}`;
    const waz = logika.waznosc(skl, zakup);
    if (waz && data > waz) return `pakiet ważny do ${waz}`;
    if (saldo.B <= 0) return saldo.R > 0 ? 'wszystkie pozostałe zabiegi są już umówione' : saldo.L <= 0 ? 'pakiet wykorzystany' : 'brak dostępnych jednostek';
    return null;
  },
  /** Obowiązująca ważność: lokalna (dodatek) ma pierwszeństwo, inaczej źródłowa z rdzenia; brak = bezterminowo (tylko gdy źródło tak mówi). */
  waznosc(skl, zakup) {
    const lok = skl.data_waznosci_lok ? String(skl.data_waznosci_lok).slice(0, 10) : null;
    const zr = zakup.data_waznosci ? String(zakup.data_waznosci).slice(0, 10) : null;
    return lok || zr || null;
  },
  /** Migawka istotnych pól wiersza Sprzedaz (nazwy kolumn z rzeczywistej bazy) + suma zwrotów. Deterministyczna. */
  migawkaZrodla(row, zwrotySuma) {
    if (!row) return null;
    return {
      id: String(row.id), status: String(row.status || 'AKTYWNY'), id_klienta: row.id_klienta == null ? null : String(row.id_klienta),
      zabieg: String(row.zabieg || '').trim(), szczegoly: logika.bezSufiksuRabatu(row.szczegoly), kategoria_produktu: row.kategoria_produktu || null,
      kwota: row.kwota == null ? null : Number(row.kwota).toFixed(2), data_sprzedazy: row.data_sprzedazy ? String(row.data_sprzedazy).slice(0, 10) : null,
      data_waznosci: row.data_waznosci ? String(row.data_waznosci).slice(0, 10) : null, karnet_zamkniety_w: row.karnet_zamkniety_w ? String(row.karnet_zamkniety_w).slice(0, 19) : null,
      grupa_id: row.grupa_id || null, zwrot_do_id: row.zwrot_do_id || null, zwroty_suma: Number(zwrotySuma || 0).toFixed(2),
    };
  },
  bezSufiksuRabatu: (w) => String(w || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim(),
  hash: (obj) => crypto.createHash('sha256').update(JSON.stringify(obj, Object.keys(obj || {}).sort())).digest('hex'),
  /** Porównanie migawek: 'brak' | 'opisowa' | 'istotna' | 'usuniete' | 'zwrot'. Zmiana opisowa (kwota, data sprzedaży) nie dotyka praw. */
  porownajZrodlo(stara, nowa) {
    if (!nowa) return 'usuniete';
    if (nowa.status !== 'AKTYWNY') return 'usuniete';
    if (!stara) return 'brak';
    const istotne = ['id_klienta', 'zabieg', 'szczegoly', 'kategoria_produktu', 'data_waznosci', 'karnet_zamkniety_w', 'zwrot_do_id'];
    if (Number(nowa.zwroty_suma) !== Number(stara.zwroty_suma)) return 'zwrot';
    if (istotne.some(k => String(stara[k]) !== String(nowa[k]))) return 'istotna';
    if (['kwota', 'data_sprzedazy', 'grupa_id'].some(k => String(stara[k]) !== String(nowa[k]))) return 'opisowa';
    return 'brak';
  },
  /** Czy wiersz Sprzedaz jest KANDYDATEM na zakup (jeszcze nie: czy daje jednostki — o tym decyduje kwalifikacja/oferta). */
  kandydatNaZakup(row) {
    if (!row) return { ok: false, powod: 'brak rekordu' };
    if (String(row.status || 'AKTYVNY') !== 'AKTYWNY') return { ok: false, powod: 'usunięty' };
    if (row.kategoria_produktu) return { ok: false, powod: 'produkt' };
    if (row.zwrot_do_id || /^ZWROT:/.test(String(row.zabieg || ''))) return { ok: false, powod: 'wiersz zwrotu' };
    if (Number(row.kwota) < 0) return { ok: false, powod: 'kwota ujemna' };
    if (/dopłata\s*$/i.test(String(row.zabieg || '').trim())) return { ok: false, powod: 'wiersz dopłaty (część płatności, nie oferta)' };
    if (!row.id_klienta) return { ok: false, powod: 'brak ID klientki — wymaga jawnego powiązania' };
    if (!String(row.zabieg || '').trim()) return { ok: false, powod: 'brak nazwy usługi' };
    return { ok: true };
  },
  skrotZadania: (rodzaj, dane) => crypto.createHash('sha256').update(rodzaj + '|' + JSON.stringify(dane, Object.keys(dane || {}).sort())).digest('hex'),
  przejscieTrybu: (z, do_) => !!(PRZEJSCIA[z] || []).includes(do_),
  TRYBY, TRYBY_NOWE_PRZYDZIALY, TRYBY_MUTACJE, RODZAJE_OFERTY, KWALIFIKACJE, WERSJA_SCHEMATU_V2,
};

// ═══════════════════ SCHEMAT V2 (kontrolowana migracja — NIE przy starcie) ═══════════════════
const KOL = ' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
/** [nazwa elementu w Term_Migracje, SQL]. Każdy krok idempotentny (IF NOT EXISTS / ER_DUP_FIELDNAME). Zero DROP/DELETE/TRUNCATE. */
const SCHEMAT_V2 = [
  ['Term_Oferty_Wersje', `CREATE TABLE IF NOT EXISTS Term_Oferty_Wersje (
      id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, oferta_id INT NOT NULL, wersja INT NOT NULL DEFAULT 1,
      rodzaj VARCHAR(24) NOT NULL DEFAULT 'pakiet', stan VARCHAR(16) NOT NULL DEFAULT 'propozycja',
      obowiazuje_od DATETIME NULL, obowiazuje_do DATETIME NULL, autor VARCHAR(100) NULL, utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_of_w (tenant_id, oferta_id, wersja))${KOL}`],
  ['Term_Oferty_Skladniki.wersja_id', `ALTER TABLE Term_Oferty_Skladniki ADD COLUMN wersja_id INT NULL`],
  ['Term_Oferty_Skladniki.jednostka_miary', `ALTER TABLE Term_Oferty_Skladniki ADD COLUMN jednostka_miary VARCHAR(20) NOT NULL DEFAULT 'sesja'`],
  ['Term_Oferty_Skladniki.jednostki_na_pozycje', `ALTER TABLE Term_Oferty_Skladniki ADD COLUMN jednostki_na_pozycje INT NOT NULL DEFAULT 1`],
  ['Term_Zakupy.zrodlo_typ', `ALTER TABLE Term_Zakupy ADD COLUMN zrodlo_typ VARCHAR(16) NOT NULL DEFAULT 'sprzedaz'`],
  ['Term_Zakupy.oferta_wersja_id', `ALTER TABLE Term_Zakupy ADD COLUMN oferta_wersja_id INT NULL`],
  ['Term_Zakupy.zrodlo_hash', `ALTER TABLE Term_Zakupy ADD COLUMN zrodlo_hash CHAR(64) NULL`],
  ['Term_Zakupy.zrodlo_migawka_json', `ALTER TABLE Term_Zakupy ADD COLUMN zrodlo_migawka_json TEXT NULL`],
  ['Term_Zakupy.zrodlo_sprawdzono', `ALTER TABLE Term_Zakupy ADD COLUMN zrodlo_sprawdzono DATETIME NULL`],
  ['Term_Zakupy.zwroty_suma', `ALTER TABLE Term_Zakupy ADD COLUMN zwroty_suma DECIMAL(10,2) NOT NULL DEFAULT 0`],
  ['Term_Zakupy.stan_zrodla', `ALTER TABLE Term_Zakupy ADD COLUMN stan_zrodla VARCHAR(16) NOT NULL DEFAULT 'ok'`],
  ['Term_Zakupy.kwalifikacja', `ALTER TABLE Term_Zakupy ADD COLUMN kwalifikacja VARCHAR(24) NULL`],
  ['Term_Zakupy.kwalifikowal', `ALTER TABLE Term_Zakupy ADD COLUMN kwalifikowal VARCHAR(100) NULL`],
  ['Term_Zakupy.kwalifikowano', `ALTER TABLE Term_Zakupy ADD COLUMN kwalifikowano DATETIME NULL`],
  ['Term_Zakupy.wersja', `ALTER TABLE Term_Zakupy ADD COLUMN wersja INT NOT NULL DEFAULT 1`],
  ['Term_Zakupy_Skladniki.stan', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN stan VARCHAR(16) NOT NULL DEFAULT 'aktywny'`],
  ['Term_Zakupy_Skladniki.stan_weryfikacji', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN stan_weryfikacji VARCHAR(16) NOT NULL DEFAULT 'niezweryfikowany'`],
  ['Term_Zakupy_Skladniki.punkt_odciecia', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN punkt_odciecia DATETIME NULL`],
  ['Term_Zakupy_Skladniki.hist_wykorzystane', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN hist_wykorzystane INT NULL`],
  ['Term_Zakupy_Skladniki.hist_wycofane', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN hist_wycofane INT NULL`],
  ['Term_Zakupy_Skladniki.hist_potracone', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN hist_potracone INT NULL`],
  ['Term_Zakupy_Skladniki.zrodlo_ustalen', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zrodlo_ustalen VARCHAR(300) NULL`],
  ['Term_Zakupy_Skladniki.zweryfikowal', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zweryfikowal VARCHAR(100) NULL`],
  ['Term_Zakupy_Skladniki.zweryfikowano', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zweryfikowano DATETIME NULL`],
  ['Term_Zakupy_Skladniki.zalezne_uzgodniono', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zalezne_uzgodniono TINYINT(1) NOT NULL DEFAULT 0`],
  ['Term_Zakupy_Skladniki.uzgodnienie_wersja', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN uzgodnienie_wersja INT NOT NULL DEFAULT 0`],
  ['Term_Zakupy_Skladniki.aktywny_od', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN aktywny_od DATETIME NULL`],
  ['Term_Zakupy_Skladniki.data_waznosci_lok', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN data_waznosci_lok DATE NULL`],
  ['Term_Zakupy_Skladniki.zawieszono_od', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zawieszono_od DATE NULL`],
  ['Term_Zakupy_Skladniki.zawieszono_do', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zawieszono_do DATE NULL`],
  ['Term_Zakupy_Skladniki.jednostka_miary', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN jednostka_miary VARCHAR(20) NOT NULL DEFAULT 'sesja'`],
  ['Term_Zakupy_Skladniki.jednostki_na_pozycje', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN jednostki_na_pozycje INT NOT NULL DEFAULT 1`],
  ['Term_Zakupy_Skladniki.usluga_nazwa', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN usluga_nazwa VARCHAR(300) NULL`],
  ['Term_Zakupy_Skladniki.saldo_json', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN saldo_json TEXT NULL`],
  ['Term_Zakupy_Skladniki.wersja', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN wersja INT NOT NULL DEFAULT 1`],
  ['Term_Przydzialy', `CREATE TABLE IF NOT EXISTS Term_Przydzialy (
      id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, pozycja_id INT NOT NULL, skladnik_id INT NOT NULL,
      ilosc INT NOT NULL DEFAULT 1, ilosc_zuzyta INT NOT NULL DEFAULT 0, cykl INT NOT NULL DEFAULT 1,
      stan VARCHAR(16) NOT NULL DEFAULT 'zarezerwowany', operacja_id INT NULL, utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, zmieniono DATETIME NULL,
      INDEX idx_poz (tenant_id, pozycja_id), INDEX idx_skl (tenant_id, skladnik_id, stan))${KOL}`],
  ['Term_Realizacje', `CREATE TABLE IF NOT EXISTS Term_Realizacje (
      id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, pozycja_id INT NULL, przydzial_id INT NULL, skladnik_id INT NOT NULL,
      ilosc INT NOT NULL DEFAULT 1, wykonawca_fakt VARCHAR(100) NULL, data_fakt DATETIME NOT NULL, zapisal VARCHAR(100) NULL,
      zapisano DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, cykl INT NOT NULL DEFAULT 1, stan VARCHAR(12) NOT NULL DEFAULT 'zapisana',
      odwrocona_przez INT NULL, operacja_id INT NULL, powod VARCHAR(300) NULL, zrodlo VARCHAR(16) NOT NULL DEFAULT 'wizyta',
      INDEX idx_poz (tenant_id, pozycja_id), INDEX idx_skl (tenant_id, skladnik_id))${KOL}`],
  ['Term_Zakupy_Ruchy2', `CREATE TABLE IF NOT EXISTS Term_Zakupy_Ruchy2 (
      id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, skladnik_id INT NOT NULL, typ CHAR(1) NOT NULL, kierunek TINYINT NOT NULL DEFAULT 1,
      ilosc INT NOT NULL, historyczny TINYINT(1) NOT NULL DEFAULT 0, przydzial_id INT NULL, realizacja_id INT NULL, operacja_id INT NULL, odwraca_id INT NULL,
      data_zdarzenia DATETIME NULL, kto VARCHAR(100) NULL, powod VARCHAR(300) NULL, zapisano DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_skl (tenant_id, skladnik_id), INDEX idx_odw (tenant_id, odwraca_id))${KOL}`],
  ['Term_Operacje', `CREATE TABLE IF NOT EXISTS Term_Operacje (
      id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, klucz VARCHAR(64) NOT NULL, rodzaj VARCHAR(32) NOT NULL,
      autor VARCHAR(100) NULL, skrot CHAR(64) NOT NULL, stan VARCHAR(12) NOT NULL DEFAULT 'zapisano', wynik_json TEXT NULL,
      utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_op (tenant_id, klucz))${KOL}`],
  ['Term_Ewidencja', `CREATE TABLE IF NOT EXISTS Term_Ewidencja (
      tenant_id VARCHAR(100) NOT NULL PRIMARY KEY, tryb VARCHAR(20) NOT NULL DEFAULT 'nie_uruchomiono', rozpoczeto DATETIME NULL,
      punkt_uzgodnienia DATETIME NULL, zakonczono DATETIME NULL, zmienil VARCHAR(100) NULL, zmieniono DATETIME NULL, raport_json TEXT NULL)${KOL}`],
  ['Term_Pozycje.jednostki_wymagane', `ALTER TABLE Term_Pozycje ADD COLUMN jednostki_wymagane INT NOT NULL DEFAULT 1`],
  ['Term_Pozycje.rozliczenie', `ALTER TABLE Term_Pozycje ADD COLUMN rozliczenie VARCHAR(16) NULL`],
  ['Term_Pozycje.wykonanie_data_fakt', `ALTER TABLE Term_Pozycje ADD COLUMN wykonanie_data_fakt DATETIME NULL`],
  ['Term_Pozycje.wykonanie_zapisal', `ALTER TABLE Term_Pozycje ADD COLUMN wykonanie_zapisal VARCHAR(100) NULL`],
  ['Term_Uslugi.wymaga_zakupu', `ALTER TABLE Term_Uslugi ADD COLUMN wymaga_zakupu TINYINT(1) NULL`],
  ['Term_Ustawienia.recepcja_potwierdza_wykonanie', `ALTER TABLE Term_Ustawienia ADD COLUMN recepcja_potwierdza_wykonanie TINYINT(1) NOT NULL DEFAULT 0`],
  ['Term_Ustawienia.potracenie_nieobecnosc', `ALTER TABLE Term_Ustawienia ADD COLUMN potracenie_nieobecnosc VARCHAR(5) NOT NULL DEFAULT 'off'`],
  ['Term_Ustawienia.seria_limit', `ALTER TABLE Term_Ustawienia ADD COLUMN seria_limit INT NOT NULL DEFAULT 20`],
];
const ELEMENTY_V2 = SCHEMAT_V2.map(([n]) => n);

/** Sprawdzenie obecności elementów v2 przez INFORMATION_SCHEMA (tylko odczyt + zapis stanu do Term_Migracje). */
async function sprawdzSchematV2(q, log) {
  const wynik = { wersja: WERSJA_SCHEMATU_V2, sprawdzono: new Date().toISOString(), gotowy: false, braki: [] };
  try {
    const tabele = [...new Set(ELEMENTY_V2.map(n => n.split('.')[0]))];
    const rows = await q(`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tabele.map(() => '?').join(',')})`, tabele);
    for (const n of ELEMENTY_V2) {
      const [t, c] = n.split('.');
      const jest = c ? rows.some(r => r.t === t && r.c === c) : rows.some(r => r.t === t);
      if (!jest) wynik.braki.push(n);
      await q(`INSERT INTO Term_Migracje (nazwa, wersja, obecna, sprawdzono) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE wersja = VALUES(wersja), obecna = VALUES(obecna), sprawdzono = NOW()`, ['v2:' + n, WERSJA_SCHEMATU_V2, jest ? 1 : 0]).catch(() => {});
    }
    wynik.gotowy = wynik.braki.length === 0;
    if (!wynik.gotowy && log) log.warn(`[terminarz-zakupy] schemat v2 nieobecny/niekompletny (${wynik.braki.length} elementów) — ewidencja zakupów niedostępna; migracja: node narzedzia/terminarz-zakupy-migracja.js`);
  } catch (e) { wynik.braki = ['(nie udało się sprawdzić: ' + e.message + ')']; if (log) log.error('[terminarz-zakupy] sprawdzSchematV2:', e.message); }
  return wynik;
}

/**
 * Kontrolowana migracja v2 (narzędzie, nie start serwera). `qx(sql, params)` → Promise<rows>.
 * Ścieżka „pusty model” wymaga, by stary model T02/T03 nie miał danych (sprawdzane POD BLOKADĄ); inaczej zatrzymuje się
 * i raportuje potrzebę przeniesienia historii (ZK-03). Nigdy DROP/DELETE/TRUNCATE. Powtarzalna.
 */
async function migrujV2(qx, { dryRun = false, log = console } = {}) {
  const raport = { wersja: WERSJA_SCHEMATU_V2, dryRun, zastosowano: [], juzBylo: [], bledy: [], zatrzymano: null, daneV1: null };
  const [lock] = await qx(`SELECT GET_LOCK('trm:migracja', 10) AS l`);
  if (!lock || Number(lock.l) !== 1) throw new Error('Nie udało się uzyskać blokady migracji (inny proces migruje?).');
  try {
    const licz = async (sql) => { try { const r = await qx(sql); return Number(r[0] && (r[0].n ?? 0)); } catch (e) { return e.code === 'ER_NO_SUCH_TABLE' ? 0 : (() => { throw e; })(); } };
    raport.daneV1 = {
      Term_Zakupy: await licz(`SELECT COUNT(*) n FROM Term_Zakupy`), Term_Zakupy_Skladniki: await licz(`SELECT COUNT(*) n FROM Term_Zakupy_Skladniki`),
      Term_Zakupy_Ruchy: await licz(`SELECT COUNT(*) n FROM Term_Zakupy_Ruchy`), Term_Oferty: await licz(`SELECT COUNT(*) n FROM Term_Oferty`),
      Term_Pozycje_z_zakupem: await licz(`SELECT COUNT(*) n FROM Term_Pozycje WHERE zakup_skladnik_id IS NOT NULL`),
    };
    const sumaV1 = Object.values(raport.daneV1).reduce((a, b) => a + b, 0);
    const v2Istnieje = (await qx(`SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Term_Zakupy_Ruchy2'`))[0].n > 0;
    if (sumaV1 > 0 && !v2Istnieje) {
      raport.zatrzymano = `Stary model T02/T03 zawiera dane (${JSON.stringify(raport.daneV1)}). Ścieżka migracji zakładająca pusty model została zatrzymana — potrzebne przeniesienie historii (ZK-03). Niczego nie usunięto.`;
      log.error('[migracja v2] ' + raport.zatrzymano);
      return raport;
    }
    for (const [nazwa, sql] of SCHEMAT_V2) {
      if (dryRun) { raport.zastosowano.push(nazwa + ' (dry-run)'); continue; }
      try { await qx(sql); raport.zastosowano.push(nazwa); }
      catch (e) { if (e.code === 'ER_DUP_FIELDNAME' || e.code === 'ER_TABLE_EXISTS_ERROR') raport.juzBylo.push(nazwa); else { raport.bledy.push(nazwa + ': ' + e.message); log.error('[migracja v2]', nazwa, e.message); } }
    }
    if (!dryRun) for (const n of ELEMENTY_V2) await qx(`INSERT INTO Term_Migracje (nazwa, wersja, obecna, sprawdzono) VALUES (?, ?, 1, NOW()) ON DUPLICATE KEY UPDATE wersja = VALUES(wersja), obecna = 1, sprawdzono = NOW()`, ['v2:' + n, WERSJA_SCHEMATU_V2]).catch(() => {});
  } finally { await qx(`SELECT RELEASE_LOCK('trm:migracja')`).catch(() => {}); }
  return raport;
}

// ═══════════════════ REPOZYTORIUM SQL (bindowane do połączenia transakcji) ═══════════════════
/** `qc(sql, params)` → Promise<rows> na połączeniu transakcji. Każda metoda ogranicza się do tenant. */
function repoSql(qc, tenant) {
  const q1 = async (sql, p) => (await qc(sql, p))[0] || null;
  const set = (pola) => { const k = Object.keys(pola); return { sql: k.map(x => `${x} = ?`).join(', '), p: k.map(x => pola[x]) }; };
  return {
    tenant,
    async skladniki(ids, blokuj) {
      if (!ids.length) return [];
      return qc(`SELECT s.*, z.id_klienta, z.stan AS zakup_stan, z.stan_zrodla, z.data_waznosci, z.nazwa AS zakup_nazwa, z.zrodlo_typ, z.sprzedaz_id, z.zrodlo_hash, z.zrodlo_migawka_json, z.zwroty_suma, z.kwalifikacja, z.data_zakupu
        FROM Term_Zakupy_Skladniki s JOIN Term_Zakupy z ON z.id = s.zakup_id AND z.tenant_id = s.tenant_id WHERE s.tenant_id = ? AND s.id IN (${ids.map(() => '?').join(',')})${blokuj ? ' FOR UPDATE' : ''}`, [tenant, ...ids]);
    },
    async skladnikiZakupow(zakupIds) { if (!zakupIds.length) return []; return qc(`SELECT s.*, z.id_klienta, z.stan AS zakup_stan, z.stan_zrodla, z.data_waznosci, z.nazwa AS zakup_nazwa, z.zrodlo_typ, z.sprzedaz_id, z.kwalifikacja FROM Term_Zakupy_Skladniki s JOIN Term_Zakupy z ON z.id = s.zakup_id AND z.tenant_id = s.tenant_id WHERE s.tenant_id = ? AND s.zakup_id IN (${zakupIds.map(() => '?').join(',')})`, [tenant, ...zakupIds]); },
    async zakupyKlientki(idKlienta) { return qc(`SELECT * FROM Term_Zakupy WHERE tenant_id = ? AND id_klienta = ? ORDER BY data_waznosci IS NULL, data_waznosci, data_zakupu, id`, [tenant, String(idKlienta)]); },
    async zakup(id, blokuj) { return q1(`SELECT * FROM Term_Zakupy WHERE tenant_id = ? AND id = ?${blokuj ? ' FOR UPDATE' : ''}`, [tenant, id]); },
    async ruchy(skladnikIds) { if (!skladnikIds.length) return []; return qc(`SELECT * FROM Term_Zakupy_Ruchy2 WHERE tenant_id = ? AND skladnik_id IN (${skladnikIds.map(() => '?').join(',')}) ORDER BY id`, [tenant, ...skladnikIds]); },
    async przydzialyPozycji(pozycjaIds) { if (!pozycjaIds.length) return []; return qc(`SELECT * FROM Term_Przydzialy WHERE tenant_id = ? AND pozycja_id IN (${pozycjaIds.map(() => '?').join(',')}) ORDER BY id`, [tenant, ...pozycjaIds]); },
    async przydzial(id, blokuj) { return q1(`SELECT * FROM Term_Przydzialy WHERE tenant_id = ? AND id = ?${blokuj ? ' FOR UPDATE' : ''}`, [tenant, id]); },
    async wstawPrzydzial(r) { const x = await qc(`INSERT INTO Term_Przydzialy (tenant_id, pozycja_id, skladnik_id, ilosc, ilosc_zuzyta, cykl, stan, operacja_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`, [tenant, r.pozycja_id, r.skladnik_id, r.ilosc, r.cykl || 1, r.stan || 'zarezerwowany', r.operacja_id || null]); return x.insertId; },
    async aktualizujPrzydzial(id, pola) { const s = set(pola); await qc(`UPDATE Term_Przydzialy SET ${s.sql}, zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    async realizacja(id, blokuj) { return q1(`SELECT * FROM Term_Realizacje WHERE tenant_id = ? AND id = ?${blokuj ? ' FOR UPDATE' : ''}`, [tenant, id]); },
    async realizacjePozycji(pozycjaId) { return qc(`SELECT * FROM Term_Realizacje WHERE tenant_id = ? AND pozycja_id = ? ORDER BY id`, [tenant, pozycjaId]); },
    async wstawRealizacje(r) { const x = await qc(`INSERT INTO Term_Realizacje (tenant_id, pozycja_id, przydzial_id, skladnik_id, ilosc, wykonawca_fakt, data_fakt, zapisal, cykl, operacja_id, powod, zrodlo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, r.pozycja_id || null, r.przydzial_id || null, r.skladnik_id, r.ilosc, r.wykonawca_fakt || null, r.data_fakt, r.zapisal || null, r.cykl || 1, r.operacja_id || null, r.powod || null, r.zrodlo || 'wizyta']); return x.insertId; },
    async aktualizujRealizacje(id, pola) { const s = set(pola); await qc(`UPDATE Term_Realizacje SET ${s.sql} WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    async wstawRuch(r) { const x = await qc(`INSERT INTO Term_Zakupy_Ruchy2 (tenant_id, skladnik_id, typ, kierunek, ilosc, historyczny, przydzial_id, realizacja_id, operacja_id, odwraca_id, data_zdarzenia, kto, powod) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, r.skladnik_id, r.typ, r.kierunek || 1, r.ilosc, r.historyczny ? 1 : 0, r.przydzial_id || null, r.realizacja_id || null, r.operacja_id || null, r.odwraca_id || null, r.data_zdarzenia || null, r.kto || null, r.powod ? String(r.powod).slice(0, 300) : null]); return x.insertId; },
    async ruch(id) { return q1(`SELECT * FROM Term_Zakupy_Ruchy2 WHERE tenant_id = ? AND id = ?`, [tenant, id]); },
    async odwroceniaRuchu(id) { return qc(`SELECT * FROM Term_Zakupy_Ruchy2 WHERE tenant_id = ? AND odwraca_id = ?`, [tenant, id]); },
    async zapiszSaldo(skladnikId, saldo) { await qc(`UPDATE Term_Zakupy_Skladniki SET saldo_json = ?, wersja = wersja + 1 WHERE tenant_id = ? AND id = ?`, [JSON.stringify(saldo), tenant, skladnikId]); },
    async aktualizujSkladnik(id, pola) { const s = set(pola); await qc(`UPDATE Term_Zakupy_Skladniki SET ${s.sql} WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    async aktualizujZakup(id, pola) { const s = set(pola); await qc(`UPDATE Term_Zakupy SET ${s.sql}, wersja = wersja + 1 WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    async wstawZakup(r) { const x = await qc(`INSERT INTO Term_Zakupy (tenant_id, sprzedaz_id, id_klienta, klient_nazwa, oferta_id, usluga_id, nazwa, data_zakupu, data_waznosci, stan, bilans_status, zrodlo_typ, oferta_wersja_id, zrodlo_hash, zrodlo_migawka_json, zrodlo_sprawdzono, zwroty_suma, stan_zrodla, kwalifikacja, kwalifikowal, kwalifikowano) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'aktywny', 'niezweryfikowany', ?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?)`, [tenant, r.sprzedaz_id, r.id_klienta, r.oferta_id || 0, r.usluga_id || '', r.nazwa || null, r.data_zakupu || null, r.data_waznosci || null, r.zrodlo_typ || 'sprzedaz', r.oferta_wersja_id || null, r.zrodlo_hash || null, r.zrodlo_migawka_json || null, r.zrodlo_sprawdzono || null, r.zwroty_suma || 0, r.kwalifikacja || null, r.kwalifikowal || null, r.kwalifikowano || null]); return x.insertId; },
    async wstawSkladnik(r) { const x = await qc(`INSERT INTO Term_Zakupy_Skladniki (tenant_id, zakup_id, usluga_wyk_id, jednostki_przyznane, jednostki_historyczne, stan, stan_weryfikacji, zalezne_uzgodniono, aktywny_od, jednostka_miary, jednostki_na_pozycje, usluga_nazwa, zweryfikowal, zweryfikowano, zrodlo_ustalen) VALUES (?, ?, ?, ?, 0, 'aktywny', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, r.zakup_id, r.usluga_wyk_id, r.jednostki_przyznane, r.stan_weryfikacji || 'niezweryfikowany', r.zalezne_uzgodniono ? 1 : 0, r.aktywny_od || null, r.jednostka_miary || 'sesja', r.jednostki_na_pozycje || 1, r.usluga_nazwa || null, r.zweryfikowal || null, r.zweryfikowano || null, r.zrodlo_ustalen || null]); return x.insertId; },
    async operacja(klucz) { return q1(`SELECT * FROM Term_Operacje WHERE tenant_id = ? AND klucz = ?`, [tenant, klucz]); },
    async wstawOperacje(r) { const x = await qc(`INSERT INTO Term_Operacje (tenant_id, klucz, rodzaj, autor, skrot, stan, wynik_json) VALUES (?, ?, ?, ?, ?, ?, ?)`, [tenant, r.klucz, r.rodzaj, r.autor || null, r.skrot, r.stan || 'zapisano', JSON.stringify(r.wynik == null ? null : r.wynik)]); return x.insertId; },
    async aktualizujOperacje(id, pola) { const s = set(pola); await qc(`UPDATE Term_Operacje SET ${s.sql} WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    async pozycja(id, blokuj) { return q1(`SELECT p.*, r.id_klienta, r.klient_nazwa, r.wersja AS rez_wersja, r.status AS rez_status FROM Term_Pozycje p JOIN Term_Rezerwacje r ON r.id = p.rezerwacja_id AND r.tenant_id = p.tenant_id WHERE p.tenant_id = ? AND p.id = ?${blokuj ? ' FOR UPDATE' : ''}`, [tenant, id]); },
    async aktualizujPozycje(id, pola) { const s = set(pola); await qc(`UPDATE Term_Pozycje SET ${s.sql} WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    /** Adapter źródła: wiersz Sprzedaz (odczyt współdzielony w transakcji) + suma zwrotów. Brak wiersza → null. */
    async zrodloSprzedaz(sprzedazId, wTransakcji) {
      const row = await q1(`SELECT id, status, id_klienta, zabieg, szczegoly, kategoria_produktu, kwota, data_sprzedazy, data_waznosci, karnet_zamkniety_w, grupa_id, zwrot_do_id FROM Sprzedaz WHERE tenant_id = ? AND id = ?${wTransakcji ? ' FOR SHARE' : ''}`, [tenant, String(sprzedazId)]);
      if (!row) return { row: null, zwrotySuma: 0 };
      const z = await q1(`SELECT COALESCE(SUM(ABS(kwota)), 0) AS s FROM Sprzedaz WHERE tenant_id = ? AND zwrot_do_id = ? AND COALESCE(status, '') <> 'USUNIĘTY'`, [tenant, String(sprzedazId)]);
      return { row, zwrotySuma: Number(z ? z.s : 0) };
    },
    async ewidencja() { return q1(`SELECT * FROM Term_Ewidencja WHERE tenant_id = ?`, [tenant]); },
    async zapiszEwidencje(pola) { const k = Object.keys(pola); await qc(`INSERT INTO Term_Ewidencja (tenant_id, ${k.join(', ')}) VALUES (?, ${k.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${k.map(x => `${x} = VALUES(${x})`).join(', ')}`, [tenant, ...k.map(x => pola[x])]); },
    async aktywnePrzydzialySkladnika(skladnikId) { return qc(`SELECT * FROM Term_Przydzialy WHERE tenant_id = ? AND skladnik_id = ? AND stan = 'zarezerwowany' ORDER BY id`, [tenant, skladnikId]); },
  };
}

// ═══════════════════ DOMENA (operacje na repozytorium; bez SQL) ═══════════════════
/** ctx = { tenant, autor, rola, teraz: 'YYYY-MM-DD HH:MM:SS', tryb } — autor WYŁĄCZNIE z sesji (router). */
const domena = {
  async saldoSkladnikow(repo, skladnikIds) {
    const ruchy = await repo.ruchy(skladnikIds);
    const out = {}; skladnikIds.forEach(id => { out[id] = logika.saldo(ruchy.filter(r => r.skladnik_id === id)); });
    return out;
  },
  async zapiszProjekcje(repo, skladnikIds) {
    const salda = await domena.saldoSkladnikow(repo, skladnikIds);
    for (const id of skladnikIds) { await repo.zapiszSaldo(id, salda[id]); if (salda[id].niespojny) await repo.aktualizujSkladnik(id, { stan: 'niespojny' }); }
    return salda;
  },
  wymagajTryb(ctx, zbior, co) { if (!zbior.has(ctx.tryb)) throw new BladDomeny(co || (ctx.tryb === 'nie_uruchomiono' || ctx.tryb === 'przygotowanie' ? 'Ewidencja zakupów nie jest uruchomiona w tym salonie.' : `Ewidencja zakupów jest w trybie „${ctx.tryb}” — ta operacja jest wstrzymana.`), { code: 'EWIDENCJA', tryb: ctx.tryb }); },

  /** Idempotentna operacja: ten sam klucz + ten sam skrót → zapisany wynik; ten sam klucz + inny skrót → błąd (A07). */
  async operacja(repo, ctx, { klucz, rodzaj, dane }, fn) {
    if (!klucz) throw new BladDomeny('Brak klucza operacji.');
    const skrot = logika.skrotZadania(rodzaj, dane || {});
    const ist = await repo.operacja(klucz);
    if (ist) {
      if (ist.skrot !== skrot) throw new BladDomeny('Ten klucz operacji został już użyty dla innego żądania.', { code: 'KLUCZ_OPERACJI' });
      let w = null; try { w = JSON.parse(ist.wynik_json); } catch (e) { w = null; }
      return { powtorzenie: true, wynik: w, operacja_id: ist.id };
    }
    // wiersz „w toku” powstaje w tej samej transakcji: ruchy/przydziały dostają operacja_id; rollback usuwa wszystko razem (A06)
    const operacja_id = await repo.wstawOperacje({ klucz, rodzaj, autor: ctx.autor, skrot, stan: 'w_toku', wynik: null });
    const wynik = await fn(operacja_id);
    await repo.aktualizujOperacje(operacja_id, { stan: 'zapisano', wynik_json: JSON.stringify(wynik == null ? null : wynik) });
    return { powtorzenie: false, wynik, operacja_id };
  },

  /** Uzgodnienie źródła zakupu z rdzeniem (adapter). Zwraca { zmiana, migawka }. Aktualizuje hash/stan w zakupie. */
  async uzgodnijZrodlo(repo, ctx, zakup, { wTransakcji = true } = {}) {
    if (zakup.zrodlo_typ && zakup.zrodlo_typ !== 'sprzedaz') return { zmiana: 'brak', migawka: null };
    const { row, zwrotySuma } = await repo.zrodloSprzedaz(zakup.sprzedaz_id, wTransakcji);
    const nowa = logika.migawkaZrodla(row, zwrotySuma);
    let stara = null; try { stara = zakup.zrodlo_migawka_json ? JSON.parse(zakup.zrodlo_migawka_json) : null; } catch (e) { stara = null; }
    const zmiana = logika.porownajZrodlo(stara, nowa);
    const pola = { zrodlo_sprawdzono: ctx.teraz };
    if (nowa) { pola.zrodlo_hash = logika.hash(nowa); pola.zrodlo_migawka_json = JSON.stringify(nowa); pola.zwroty_suma = Number(nowa.zwroty_suma); }
    if (zmiana === 'usuniete') pola.stan_zrodla = 'usuniete';
    else if (zmiana === 'zwrot') pola.stan_zrodla = Number(nowa.zwroty_suma) >= Math.abs(Number(stara && stara.kwota) || Number(nowa.kwota) || 0) - 0.005 ? 'wycofane' : 'do_uzgodnienia';
    else if (zmiana === 'istotna') pola.stan_zrodla = 'do_uzgodnienia';
    else if (zmiana === 'brak' && !stara && nowa) pola.stan_zrodla = zakup.stan_zrodla || 'ok'; // pierwszy odczyt
    await repo.aktualizujZakup(zakup.id, pola);
    return { zmiana, migawka: nowa, stan_zrodla: pola.stan_zrodla || zakup.stan_zrodla || 'ok' };
  },

  /** Przyznanie uprawnienia przez salon (gratis/rekompensata/dane testowe) — źródło „przyznane”, bez wiersza Sprzedaz. */
  async przyznaj(repo, ctx, { id_klienta, usluga_wyk_id, usluga_nazwa, jednostki, nazwa, data_waznosci, powod, operacja_id, zweryfikowany = true }) {
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    const n = Number(jednostki); if (!Number.isInteger(n) || n <= 0 || n > 500) throw new BladDomeny('Liczba jednostek musi być całkowita (1–500).');
    if (!id_klienta) throw new BladDomeny('Wskaż klientkę (ID).'); if (!usluga_wyk_id) throw new BladDomeny('Wskaż usługę.'); if (!powod) throw new BladDomeny('Podaj powód przyznania.');
    const zrodloId = 'PRZYZNANE:' + crypto.randomUUID();
    const zakupId = await repo.wstawZakup({ sprzedaz_id: zrodloId, zrodlo_typ: 'przyznane', id_klienta: String(id_klienta), usluga_id: usluga_wyk_id, nazwa: nazwa || `Przyznane przez salon: ${usluga_nazwa || usluga_wyk_id}`, data_zakupu: ctx.teraz.slice(0, 10), data_waznosci: data_waznosci || null, kwalifikacja: 'pakiet', kwalifikowal: ctx.autor, kwalifikowano: ctx.teraz, zrodlo_sprawdzono: ctx.teraz });
    const sklId = await repo.wstawSkladnik({ zakup_id: zakupId, usluga_wyk_id, usluga_nazwa, jednostki_przyznane: n, stan_weryfikacji: zweryfikowany ? 'zweryfikowany' : 'niezweryfikowany', zalezne_uzgodniono: zweryfikowany ? 1 : 0, aktywny_od: zweryfikowany ? ctx.teraz : null, zweryfikowal: zweryfikowany ? ctx.autor : null, zweryfikowano: zweryfikowany ? ctx.teraz : null, zrodlo_ustalen: zweryfikowany ? powod : null });
    await repo.wstawRuch({ skladnik_id: sklId, typ: 'G', kierunek: 1, ilosc: n, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod: 'przyznane przez salon: ' + powod });
    await domena.zapiszProjekcje(repo, [sklId]);
    return { zakup_id: zakupId, skladnik_id: sklId };
  },

  /** Weryfikacja JEDNEGO składnika (manager): wszystkie liczby jawne (także zero). Zapis jako ruchy historyczne (różnica). */
  async weryfikujSkladnik(repo, ctx, { skladnik_id, hist_wykorzystane, hist_wycofane, hist_potracone, punkt_odciecia, zrodlo_ustalen, operacja_id }) {
    domena.wymagajTryb(ctx, new Set(['przygotowanie', 'aktywna', 'konczenie', 'uzgadnianie']), 'Weryfikacja składników wymaga trybu przygotowania albo aktywnej ewidencji.');
    const liczby = { U: hist_wykorzystane, W: hist_wycofane, F: hist_potracone };
    for (const [k, v] of Object.entries(liczby)) if (v === undefined || v === null || v === '' || !Number.isInteger(Number(v)) || Number(v) < 0) throw new BladDomeny(`Podaj jawnie liczbę (także 0): ${k === 'U' ? 'wykorzystane wcześniej' : k === 'W' ? 'wycofane wcześniej' : 'potrącone wcześniej'}.`);
    if (!zrodlo_ustalen) throw new BladDomeny('Podaj źródło ustaleń (np. „wykonania w Booksy do 10.2026”).');
    const [s] = await repo.skladniki([Number(skladnik_id)], true); if (!s) throw new BladDomeny('Nie znaleziono składnika.');
    const salda = await domena.saldoSkladnikow(repo, [s.id]); const przed = salda[s.id];
    const G = przed.G, sumaHist = Number(liczby.U) + Number(liczby.W) + Number(liczby.F);
    if (sumaHist > G) throw new BladDomeny(`Zgłoszone historyczne wykorzystanie (${sumaHist}) przekracza zakupione jednostki (${G}). Odszukaj brakujący zakup albo popraw dane — nie zatwierdzamy niemożliwego salda.`, { code: 'BILANS_NIEMOZLIWY' });
    const nowyL = G - sumaHist; const nowyB = nowyL - przed.R;
    if (nowyB < 0) throw new BladDomeny(`Po tej weryfikacji wolna pula (${nowyL}) byłaby mniejsza niż już przydzielone jednostki (${przed.R}). Najpierw uzgodnij zależne wizyty.`, { code: 'ZALEZNE_WIZYTY' });
    for (const [typ, v] of Object.entries(liczby)) {
      const dotych = Number(typ === 'U' ? s.hist_wykorzystane : typ === 'W' ? s.hist_wycofane : s.hist_potracone) || 0;
      const roznica = Number(v) - dotych; if (!roznica) continue;
      await repo.wstawRuch({ skladnik_id: s.id, typ, kierunek: roznica > 0 ? 1 : -1, ilosc: Math.abs(roznica), historyczny: 1, operacja_id, data_zdarzenia: punkt_odciecia || ctx.teraz, kto: ctx.autor, powod: `stan początkowy: ${dotych} → ${Number(v)}; ${zrodlo_ustalen}` });
    }
    await repo.aktualizujSkladnik(s.id, { hist_wykorzystane: Number(liczby.U), hist_wycofane: Number(liczby.W), hist_potracone: Number(liczby.F), punkt_odciecia: punkt_odciecia || ctx.teraz, zrodlo_ustalen: String(zrodlo_ustalen).slice(0, 300), stan_weryfikacji: 'zweryfikowany', zweryfikowal: ctx.autor, zweryfikowano: ctx.teraz, stan: s.stan === 'niespojny' ? 'aktywny' : s.stan });
    const po = await domena.zapiszProjekcje(repo, [s.id]);
    return { skladnik_id: s.id, saldo: po[s.id] };
  },

  /** Uruchomienie składnika do nowych umówień: wymaga weryfikacji; uzgodnienie zależnych wizyt (lista) jest jawnym potwierdzeniem. */
  async uruchomSkladnik(repo, ctx, { skladnik_id, potwierdzenie_zaleznych }) {
    domena.wymagajTryb(ctx, new Set(['przygotowanie', 'aktywna', 'uzgadnianie']));
    const [s] = await repo.skladniki([Number(skladnik_id)], true); if (!s) throw new BladDomeny('Nie znaleziono składnika.');
    if (s.stan_weryfikacji !== 'zweryfikowany') throw new BladDomeny('Najpierw potwierdź stan początkowy tego składnika.');
    if (!potwierdzenie_zaleznych) throw new BladDomeny('Potwierdź, że istniejące wizyty tej klientki na tę usługę zostały przejrzane (powiązane albo oznaczone jako wyjątki).');
    await repo.aktualizujSkladnik(s.id, { zalezne_uzgodniono: 1, uzgodnienie_wersja: Number(s.uzgodnienie_wersja || 0) + 1, aktywny_od: s.aktywny_od || ctx.teraz });
    return { skladnik_id: s.id };
  },

  /**
   * Rezerwacja jednostek dla pozycji wizyty — cała lista albo nic. pozycje: [{pozycja_id, skladnik_id, ilosc}].
   * Sprawdza: tryb, właściciela po ID, usługę, stan/weryfikację/uruchomienie, ważność na datę, aktualne źródło (w transakcji), B dla PEŁNEJ listy.
   */
  async rezerwuj(repo, ctx, { pozycje, id_klienta, data, uslugaPozycji, operacja_id }) {
    domena.wymagajTryb(ctx, TRYBY_NOWE_PRZYDZIALY);
    if (!id_klienta) throw new BladDomeny('Rezerwacja z zakupu wymaga klientki z kartoteki (ID).');
    const ids = [...new Set(pozycje.map(p => Number(p.skladnik_id)))];
    const skl = await repo.skladniki(ids, true);
    const salda = await domena.saldoSkladnikow(repo, ids);
    const potrzeba = {};
    for (const p of pozycje) {
      const s = skl.find(x => x.id === Number(p.skladnik_id));
      if (!s) throw new BladDomeny('Nie znaleziono wskazanego zakupu.');
      if (String(s.id_klienta || '') !== String(id_klienta)) throw new BladDomeny('Wskazany zakup należy do innej klientki.', { code: 'WLASCICIEL' });
      const uslugaPoz = uslugaPozycji ? uslugaPozycji(p) : p.usluga_id;
      if (uslugaPoz && String(s.usluga_wyk_id) !== String(uslugaPoz)) throw new BladDomeny(`Pakiet „${s.zakup_nazwa || ''}” dotyczy innej usługi (${s.usluga_nazwa || s.usluga_wyk_id}). Wybierz zgodną usługę.`, { code: 'INNY_WARIANT' });
      const zakup = { stan: s.zakup_stan, stan_zrodla: s.stan_zrodla, data_waznosci: s.data_waznosci };
      if (s.zrodlo_typ === 'sprzedaz' || !s.zrodlo_typ) {
        const u = await domena.uzgodnijZrodlo(repo, ctx, { id: s.zakup_id, sprzedaz_id: s.sprzedaz_id, zrodlo_typ: 'sprzedaz', zrodlo_migawka_json: s.zrodlo_migawka_json, stan_zrodla: s.stan_zrodla });
        zakup.stan_zrodla = u.stan_zrodla;
        if (u.zmiana === 'istotna' || u.zmiana === 'usuniete' || u.zmiana === 'zwrot') { const e = new BladDomeny('Zakup wymaga wyjaśnienia — został zmieniony w Sprzedaży po ostatnim sprawdzeniu. Wizyta nie została zapisana; formularz zachowany.', { code: 'ZRODLO', zmiana: u.zmiana }); e.utrwalPoRollback = { zakup_id: s.zakup_id, stan_zrodla: u.stan_zrodla }; throw e; }
      }
      const powod = logika.powodNiedostepnosci(s, zakup, salda[s.id], data, ctx.tryb);
      if (powod) throw new BladDomeny(`Nie można umówić z pakietu „${s.zakup_nazwa || ''}”: ${powod}.`, { code: 'NIEDOSTEPNY', powod });
      const q = Math.max(1, Number(p.ilosc) || Number(s.jednostki_na_pozycje) || 1);
      potrzeba[s.id] = (potrzeba[s.id] || 0) + q;
      if (potrzeba[s.id] > salda[s.id].B) throw new BladDomeny(potrzeba[s.id] - q >= salda[s.id].B && salda[s.id].B > 0 ? `W pakiecie „${s.zakup_nazwa || ''}” została ${salda[s.id].B === 1 ? '1 jednostka' : salda[s.id].B + ' jednostki'} — ten formularz chce użyć ${potrzeba[s.id]}. Usuń jedną pozycję albo wybierz inny zakup.` : `Ostatni zabieg z pakietu „${s.zakup_nazwa || ''}” został przed chwilą przypisany do innej wizyty. Ta wizyta nie została zapisana.`, { code: 'BRAK_JEDNOSTEK', dostepne: salda[s.id].B });
    }
    const przydzialy = [];
    for (const p of pozycje) {
      const s = skl.find(x => x.id === Number(p.skladnik_id)); const q = Math.max(1, Number(p.ilosc) || Number(s.jednostki_na_pozycje) || 1);
      const pid = await repo.wstawPrzydzial({ pozycja_id: p.pozycja_id, skladnik_id: s.id, ilosc: q, cykl: 1, operacja_id });
      await repo.wstawRuch({ skladnik_id: s.id, typ: 'R', kierunek: 1, ilosc: q, przydzial_id: pid, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod: p.powod || 'umówienie' });
      await repo.aktualizujPozycje(p.pozycja_id, { zakup_skladnik_id: s.id, jednostki_wymagane: q, rozliczenie: 'pakiet' });
      przydzialy.push({ id: pid, pozycja_id: p.pozycja_id, skladnik_id: s.id, ilosc: q });
    }
    await domena.zapiszProjekcje(repo, ids);
    return { przydzialy };
  },

  /** Zwolnienie aktywnych przydziałów pozycji (odwołanie, nieobecność, niewykonanie). R − q; U bez zmian. Idempotentne stanem. */
  async zwolnij(repo, ctx, { pozycja_id, powod, operacja_id }) {
    const prz = (await repo.przydzialyPozycji([Number(pozycja_id)])).filter(x => x.stan === 'zarezerwowany');
    if (!prz.length) return { zwolniono: 0 };
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    let n = 0;
    for (const p of prz) {
      const [pl] = [await repo.przydzial(p.id, true)]; if (!pl || pl.stan !== 'zarezerwowany') continue;
      const q = pl.ilosc - pl.ilosc_zuzyta; if (q <= 0) { await repo.aktualizujPrzydzial(pl.id, { stan: 'zuzyty' }); continue; }
      await repo.aktualizujPrzydzial(pl.id, { stan: 'zwolniony' });
      await repo.wstawRuch({ skladnik_id: pl.skladnik_id, typ: 'R', kierunek: -1, ilosc: q, przydzial_id: pl.id, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod });
      n += q;
    }
    await domena.zapiszProjekcje(repo, [...new Set(prz.map(p => p.skladnik_id))]);
    return { zwolniono: n };
  },

  /** Fakt wykonania pozycji: R − q, U + q w jednej transakcji; realizacja z rzeczywistą datą. ilosc = całe jednostki (domyślnie całe zapotrzebowanie). */
  async wykonaj(repo, ctx, { pozycja_id, ilosc, wykonawca_fakt, data_fakt, powod, operacja_id }) {
    const prz = (await repo.przydzialyPozycji([Number(pozycja_id)])).filter(x => x.stan === 'zarezerwowany');
    if (!prz.length) return { zuzyto: 0, realizacje: [], bez_przydzialu: true };
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    const dostepne = prz.reduce((a, p) => a + (p.ilosc - p.ilosc_zuzyta), 0);
    let doZuzycia = ilosc == null ? dostepne : Number(ilosc);
    if (!Number.isInteger(doZuzycia) || doZuzycia <= 0) throw new BladDomeny('Liczba wykonanych jednostek musi być dodatnią liczbą całkowitą.');
    if (doZuzycia > dostepne) throw new BladDomeny(`Ta pozycja ma ${dostepne} zarezerwowane jednostki — nie można wykonać ${doZuzycia}.`, { code: 'PONAD_PRZYDZIAL' });
    const dataF = data_fakt || ctx.teraz; if (dataF > ctx.teraz) throw new BladDomeny('Nie zapisujemy przyszłego wykonania.');
    const realizacje = []; let zuzyto = 0;
    for (const p of prz) {
      if (doZuzycia <= 0) break;
      const pl = await repo.przydzial(p.id, true); if (!pl || pl.stan !== 'zarezerwowany') throw new BladDomeny('Przydział został w międzyczasie zmieniony. Sprawdź aktualny stan wizyty.', { code: 'STAN' });
      const q = Math.min(doZuzycia, pl.ilosc - pl.ilosc_zuzyta); if (q <= 0) continue;
      const rid = await repo.wstawRealizacje({ pozycja_id: Number(pozycja_id), przydzial_id: pl.id, skladnik_id: pl.skladnik_id, ilosc: q, wykonawca_fakt, data_fakt: dataF, zapisal: ctx.autor, cykl: pl.cykl, operacja_id, powod });
      await repo.wstawRuch({ skladnik_id: pl.skladnik_id, typ: 'R', kierunek: -1, ilosc: q, przydzial_id: pl.id, realizacja_id: rid, operacja_id, data_zdarzenia: dataF, kto: ctx.autor, powod: 'wykonanie' });
      await repo.wstawRuch({ skladnik_id: pl.skladnik_id, typ: 'U', kierunek: 1, ilosc: q, przydzial_id: pl.id, realizacja_id: rid, operacja_id, data_zdarzenia: dataF, kto: ctx.autor, powod: 'wykonanie' });
      const nowaZuzyta = pl.ilosc_zuzyta + q;
      await repo.aktualizujPrzydzial(pl.id, { ilosc_zuzyta: nowaZuzyta, stan: nowaZuzyta >= pl.ilosc ? 'zuzyty' : 'zarezerwowany' });
      realizacje.push({ id: rid, przydzial_id: pl.id, skladnik_id: pl.skladnik_id, ilosc: q }); zuzyto += q; doZuzycia -= q;
    }
    await repo.aktualizujPozycje(Number(pozycja_id), { wykonanie_data_fakt: dataF, wykonanie_zapisal: ctx.autor });
    await domena.zapiszProjekcje(repo, [...new Set(prz.map(p => p.skladnik_id))]);
    return { zuzyto, realizacje, nierozstrzygniete: dostepne - zuzyto };
  },

  /** Potrącenie jednostki z aktywnego przydziału (osobna decyzja, reguła salonu): R − q, F + q; U bez zmian. */
  async potrac(repo, ctx, { pozycja_id, ilosc = 1, powod, operacja_id }) {
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    if (!powod) throw new BladDomeny('Potrącenie wymaga powodu.');
    const prz = (await repo.przydzialyPozycji([Number(pozycja_id)])).filter(x => x.stan === 'zarezerwowany');
    let q = Number(ilosc); if (!Number.isInteger(q) || q <= 0) throw new BladDomeny('Nieprawidłowa liczba jednostek.');
    const dostepne = prz.reduce((a, p) => a + (p.ilosc - p.ilosc_zuzyta), 0);
    if (q > dostepne) throw new BladDomeny(dostepne ? `Do potrącenia dostępne ${dostepne}.` : 'Jednostka została już zwolniona — potrącenie wymagałoby ponownego sprawdzenia wolnej puli; nie zabieramy jednostki innej wizycie.', { code: 'BRAK_PRZYDZIALU' });
    let n = 0;
    for (const p of prz) { if (q <= 0) break; const pl = await repo.przydzial(p.id, true); const k = Math.min(q, pl.ilosc - pl.ilosc_zuzyta); if (k <= 0) continue;
      await repo.wstawRuch({ skladnik_id: pl.skladnik_id, typ: 'R', kierunek: -1, ilosc: k, przydzial_id: pl.id, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod: 'potrącenie: ' + powod });
      await repo.wstawRuch({ skladnik_id: pl.skladnik_id, typ: 'F', kierunek: 1, ilosc: k, przydzial_id: pl.id, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod: 'potrącenie: ' + powod });
      await repo.aktualizujPrzydzial(pl.id, { stan: 'potracony' }); q -= k; n += k; }
    await domena.zapiszProjekcje(repo, [...new Set(prz.map(p => p.skladnik_id))]);
    return { potracono: n };
  },

  /** Wycofanie q wolnych jednostek (zwrot/korekta ilości): W + q; wymaga B ≥ q. zakres 'wszystkie_niewykorzystane' zwalnia też aktywne przydziały (wizyty pozostają do wyjaśnienia). */
  async wycofaj(repo, ctx, { skladnik_id, ilosc, zakres = 'wolne', powod, operacja_id }) {
    domena.wymagajTryb(ctx, new Set(['aktywna', 'konczenie', 'uzgadnianie', 'wstrzymana']));
    if (!powod) throw new BladDomeny('Wycofanie wymaga powodu.');
    const [s] = await repo.skladniki([Number(skladnik_id)], true); if (!s) throw new BladDomeny('Nie znaleziono składnika.');
    let saldo = (await domena.saldoSkladnikow(repo, [s.id]))[s.id];
    const zwolnione = [];
    if (zakres === 'wszystkie_niewykorzystane') {
      for (const p of await repo.aktywnePrzydzialySkladnika(s.id)) { const q = p.ilosc - p.ilosc_zuzyta; if (q <= 0) continue; await repo.aktualizujPrzydzial(p.id, { stan: 'zwolniony' }); await repo.wstawRuch({ skladnik_id: s.id, typ: 'R', kierunek: -1, ilosc: q, przydzial_id: p.id, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod: 'wycofanie uprawnień: ' + powod }); await repo.aktualizujPozycje(p.pozycja_id, { rozliczenie: 'do_wyjasnienia' }); zwolnione.push(p.pozycja_id); }
      saldo = (await domena.saldoSkladnikow(repo, [s.id]))[s.id];
    }
    const q = ilosc == null ? saldo.B : Number(ilosc);
    if (!Number.isInteger(q) || q < 0) throw new BladDomeny('Nieprawidłowa liczba jednostek.');
    if (q > saldo.B) throw new BladDomeny(`Wolnych jednostek jest ${saldo.B}, nie można wycofać ${q}${saldo.R ? ` (umówione: ${saldo.R} — najpierw uzgodnij zależne wizyty)` : ''}.`, { code: 'BRAK_WOLNYCH' });
    if (q > 0) await repo.wstawRuch({ skladnik_id: s.id, typ: 'W', kierunek: 1, ilosc: q, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod });
    const po = await domena.zapiszProjekcje(repo, [s.id]);
    return { wycofano: q, zwolnione_pozycje: zwolnione, saldo: po[s.id] };
  },

  /** Korekta błędnego wykonania (manager): odwrócenie realizacji (U − q). wynik: 'odbedzie_sie' (R + q, nowy cykl) | 'nie_odbedzie_sie'. */
  async odwrocRealizacje(repo, ctx, { realizacja_id, wynik, powod, data, operacja_id }) {
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    if (!powod) throw new BladDomeny('Korekta wykonania wymaga powodu.');
    if (!['odbedzie_sie', 'nie_odbedzie_sie'].includes(wynik)) throw new BladDomeny('Wskaż rzeczywisty rezultat korekty.');
    const r = await repo.realizacja(Number(realizacja_id), true); if (!r) throw new BladDomeny('Nie znaleziono realizacji.');
    if (r.stan === 'odwrocona') throw new BladDomeny('Ta realizacja została już skorygowana — powtórzenie korekty nie oddaje kolejnej jednostki.', { code: 'JUZ_ODWROCONA' });
    const ruchy = await repo.ruchy([r.skladnik_id]); const ruchU = ruchy.find(x => x.realizacja_id === r.id && x.typ === 'U' && x.kierunek === 1);
    if (!ruchU) throw new BladDomeny('Brak ruchu wykorzystania dla tej realizacji — niespójność, wymaga sprawdzenia.', { code: 'NIESPOJNY' });
    const [s] = await repo.skladniki([r.skladnik_id], true);
    const saldo = logika.saldo(ruchy);
    // jeżeli pula została w całości wycofana (W pokrywa L), korekta przenosi U → W zamiast odtwarzać prawo (§9.5, §11.1)
    const wycofanoCalosc = saldo.W > 0 && saldo.G - saldo.U - saldo.F - saldo.W <= 0 && saldo.R === 0;
    const odwrId = await repo.wstawRuch({ skladnik_id: r.skladnik_id, typ: 'U', kierunek: -1, ilosc: r.ilosc, realizacja_id: r.id, przydzial_id: r.przydzial_id, operacja_id, odwraca_id: ruchU.id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod: 'korekta wykonania: ' + powod });
    await repo.aktualizujRealizacje(r.id, { stan: 'odwrocona', odwrocona_przez: odwrId });
    let nowyPrzydzial = null;
    if (wycofanoCalosc) {
      await repo.wstawRuch({ skladnik_id: r.skladnik_id, typ: 'W', kierunek: 1, ilosc: r.ilosc, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod: 'korekta po wycofaniu puli: jednostka wraca jako wycofana, nie wolna' });
    } else if (wynik === 'odbedzie_sie') {
      const zakup = { stan: s.zakup_stan, stan_zrodla: s.stan_zrodla, data_waznosci: s.data_waznosci };
      const powodN = logika.powodNiedostepnosci(s, zakup, logika.saldo(await repo.ruchy([s.id])), data || ctx.teraz.slice(0, 10), ctx.tryb);
      if (powodN) throw new BladDomeny(`Jednostka wraca do historii, ale nie można odtworzyć rezerwacji: ${powodN}. Pozycja pozostaje do rozstrzygnięcia.`, { code: 'NIEDOSTEPNY', powod: powodN });
      const stary = r.przydzial_id ? await repo.przydzial(r.przydzial_id) : null;
      const pid = await repo.wstawPrzydzial({ pozycja_id: r.pozycja_id, skladnik_id: r.skladnik_id, ilosc: r.ilosc, cykl: (stary ? stary.cykl : r.cykl) + 1, operacja_id });
      await repo.wstawRuch({ skladnik_id: r.skladnik_id, typ: 'R', kierunek: 1, ilosc: r.ilosc, przydzial_id: pid, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod: 'korekta wykonania — zabieg nadal ma się odbyć' });
      if (r.pozycja_id) await repo.aktualizujPozycje(r.pozycja_id, { stan: 'zaplanowana', zakup_skladnik_id: r.skladnik_id, wykonanie_data_fakt: null, wykonanie_zapisal: null });
      nowyPrzydzial = pid;
    } else if (r.pozycja_id) {
      await repo.aktualizujPozycje(r.pozycja_id, { stan: 'niewykonana', wykonanie_data_fakt: null, wykonanie_zapisal: null });
    }
    const po = await domena.zapiszProjekcje(repo, [r.skladnik_id]);
    return { odwrocono: r.ilosc, nowy_przydzial_id: nowyPrzydzial, saldo: po[r.skladnik_id], do_wycofanych: wycofanoCalosc };
  },

  /** Atomowa zmiana źródła przydziału: R − q w starym, R + q w nowym (po pełnej walidacji nowego); błąd = brak zmiany. */
  async przenies(repo, ctx, { przydzial_id, nowy_skladnik_id, id_klienta, data, powod, operacja_id }) {
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    const pl = await repo.przydzial(Number(przydzial_id), true); if (!pl || pl.stan !== 'zarezerwowany') throw new BladDomeny('Przydział nie jest aktywny — nie można zmienić źródła.', { code: 'STAN' });
    const q = pl.ilosc - pl.ilosc_zuzyta; if (q <= 0) throw new BladDomeny('Przydział jest już wykorzystany.');
    const [stary] = await repo.skladniki([pl.skladnik_id], true); const [nowy] = await repo.skladniki([Number(nowy_skladnik_id)], true);
    if (!nowy) throw new BladDomeny('Nie znaleziono nowego zakupu.'); if (nowy.id === stary.id) throw new BladDomeny('To ten sam zakup.');
    if (String(nowy.id_klienta || '') !== String(id_klienta || stary.id_klienta)) throw new BladDomeny('Nowy zakup należy do innej klientki.', { code: 'WLASCICIEL' });
    if (String(nowy.usluga_wyk_id) !== String(stary.usluga_wyk_id)) throw new BladDomeny('Nowy zakup dotyczy innej usługi — nie zamieniamy A na B po cichu.', { code: 'INNY_WARIANT' });
    const salda = await domena.saldoSkladnikow(repo, [nowy.id]);
    const powodN = logika.powodNiedostepnosci(nowy, { stan: nowy.zakup_stan, stan_zrodla: nowy.stan_zrodla, data_waznosci: nowy.data_waznosci }, salda[nowy.id], data, ctx.tryb);
    if (powodN) throw new BladDomeny(`Nie zmieniono zakupu (${powodN}). Wizyta nadal korzysta z dotychczasowego pakietu.`, { code: 'NIEDOSTEPNY', powod: powodN });
    if (salda[nowy.id].B < q) throw new BladDomeny('Nie zmieniono zakupu — w nowym brakuje wolnych jednostek. Wizyta nadal korzysta z dotychczasowego pakietu.', { code: 'BRAK_JEDNOSTEK' });
    await repo.wstawRuch({ skladnik_id: stary.id, typ: 'R', kierunek: -1, ilosc: q, przydzial_id: pl.id, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod: 'zmiana źródła: ' + (powod || '') });
    await repo.aktualizujPrzydzial(pl.id, { stan: 'zwolniony' });
    const pid = await repo.wstawPrzydzial({ pozycja_id: pl.pozycja_id, skladnik_id: nowy.id, ilosc: q, cykl: pl.cykl, operacja_id });
    await repo.wstawRuch({ skladnik_id: nowy.id, typ: 'R', kierunek: 1, ilosc: q, przydzial_id: pid, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, powod: 'zmiana źródła: ' + (powod || '') });
    await repo.aktualizujPozycje(pl.pozycja_id, { zakup_skladnik_id: nowy.id });
    await domena.zapiszProjekcje(repo, [stary.id, nowy.id]);
    return { stary_przydzial_id: pl.id, nowy_przydzial_id: pid, ilosc: q };
  },

  /** Zmiana trybu ewidencji (manager). Wymaga dozwolonego przejścia; „aktywna” wymaga włączonej integracji i schematu (sprawdza router). */
  async ustawEwidencje(repo, ctx, { tryb, raport }) {
    if (!TRYBY.includes(tryb)) throw new BladDomeny('Nieznany tryb ewidencji.');
    const ew = { tryb: 'nie_uruchomiono', ...((await repo.ewidencja()) || {}) }; // kopia: repozytorium może zwrócić współdzielony obiekt
    const poprzedni = ew.tryb;
    if (poprzedni === tryb) return { tryb, powtorzenie: true };
    if (!logika.przejscieTrybu(poprzedni, tryb)) throw new BladDomeny(`Z trybu „${poprzedni}” nie można przejść do „${tryb}”.`, { code: 'PRZEJSCIE' });
    const pola = { tryb, zmienil: ctx.autor, zmieniono: ctx.teraz };
    if (tryb === 'aktywna' && !ew.rozpoczeto) pola.rozpoczeto = ctx.teraz;
    if (tryb === 'zakonczona') pola.zakonczono = ctx.teraz;
    if (tryb === 'uzgadnianie' || tryb === 'aktywna') pola.punkt_uzgodnienia = ctx.teraz;
    if (raport) pola.raport_json = JSON.stringify(raport);
    await repo.zapiszEwidencje(pola);
    return { tryb, poprzedni };
  },

  /** Walidacja przydziałów wizyty na NOWĄ datę (przesunięcie): ważność/zawieszenie/źródło; brak zmian liczników. */
  async sprawdzPrzeniesienie(repo, ctx, { pozycjaIds, data }) {
    const prz = (await repo.przydzialyPozycji(pozycjaIds)).filter(p => p.stan === 'zarezerwowany');
    if (!prz.length) return { ok: true, problemy: [] };
    domena.wymagajTryb(ctx, TRYBY_MUTACJE, 'Ewidencja zakupów jest wstrzymana — przełożenie wizyty z pakietu wymaga działającej ewidencji.');
    const ids = [...new Set(prz.map(p => p.skladnik_id))]; const skl = await repo.skladniki(ids, true); const salda = await domena.saldoSkladnikow(repo, ids);
    const problemy = [];
    for (const s of skl) {
      const zakup = { stan: s.zakup_stan, stan_zrodla: s.stan_zrodla, data_waznosci: s.data_waznosci };
      if (s.zrodlo_typ === 'sprzedaz' || !s.zrodlo_typ) { const u = await domena.uzgodnijZrodlo(repo, ctx, { id: s.zakup_id, sprzedaz_id: s.sprzedaz_id, zrodlo_typ: 'sprzedaz', zrodlo_migawka_json: s.zrodlo_migawka_json, stan_zrodla: s.stan_zrodla }); zakup.stan_zrodla = u.stan_zrodla; }
      // przy przesunięciu nie wymagamy wolnej jednostki (przydział już jest) — tylko ważności/stanu składnika i zakupu
      const saldoBezB = { ...salda[s.id], B: 1 };
      const powod = logika.powodNiedostepnosci(s, zakup, saldoBezB, data, 'aktywna');
      if (powod) problemy.push({ skladnik_id: s.id, opis: `Pakiet „${s.zakup_nazwa || ''}”: ${powod}` });
    }
    return { ok: !problemy.length, problemy };
  },
};

/** Widok zakupów klientki do UI (bez mutacji): składniki z saldem, powodami i czasem ostatniego sprawdzenia. */
async function widokZakupow(repo, ctx, { id_klienta, data, katalogNazwa }) {
  if (!id_klienta) return [];
  const zakupy = await repo.zakupyKlientki(id_klienta); if (!zakupy.length) return [];
  const skl = await repo.skladnikiZakupow(zakupy.map(z => z.id));
  const salda = await domena.saldoSkladnikow(repo, skl.map(s => s.id));
  const dzien = data || ctx.teraz.slice(0, 10);
  return zakupy.map(z => {
    const sk = skl.filter(s => s.zakup_id === z.id).map(s => {
      const sa = salda[s.id]; const powod = logika.powodNiedostepnosci(s, z, sa, dzien, ctx.tryb);
      return { id: s.id, usluga_wyk_id: s.usluga_wyk_id, usluga_nazwa: s.usluga_nazwa || (katalogNazwa ? katalogNazwa(s.usluga_wyk_id) : String(s.usluga_wyk_id)), jednostka_miary: s.jednostka_miary || 'sesja', jednostki_na_pozycje: s.jednostki_na_pozycje || 1,
        stan: s.stan, stan_weryfikacji: s.stan_weryfikacji, uruchomiony: !!(s.zalezne_uzgodniono && s.aktywny_od), waznosc: logika.waznosc(s, z), zawieszono_do: s.zawieszono_do ? String(s.zawieszono_do).slice(0, 10) : null,
        przyznane: sa.G, wycofane: sa.W, potracone: sa.F, wykorzystane: sa.U, wykorzystane_historycznie: sa.U_hist, umowione: sa.R, pozostalo: sa.L, do_umowienia: s.stan_weryfikacji === 'zweryfikowany' ? Math.max(0, sa.B) : null,
        niespojny: sa.niespojny, dostepny: !powod, powod: powod || null,
        // zgodność ze starym UI (public/terminarz.js, etap T03): wykonane / zaplanowane / wolne
        wykonane: sa.U, zaplanowane: sa.R, wolne: powod ? 0 : sa.B, historyczne: sa.U_hist };
    });
    const zwer = sk.filter(s => s.stan_weryfikacji === 'zweryfikowany').length;
    const weryfikacja = !sk.length ? 'brak_skladnikow' : zwer === sk.length ? 'zweryfikowany' : zwer ? 'czesciowo' : 'niezweryfikowany';
    const wyk = sk.every(s => s.pozostalo === 0 && s.przyznane > 0 && s.wycofane === 0 && s.potracone === 0) ? 'w_calosci_wykorzystany' : sk.some(s => s.wykorzystane > 0) ? 'czesciowo_wykorzystany' : sk.some(s => s.pozostalo === 0 && (s.wycofane || s.potracone)) ? 'brak_dostepnych_sprawdz_powody' : 'do_wykorzystania';
    return { id: z.id, sprzedaz_id: z.sprzedaz_id, zrodlo_typ: z.zrodlo_typ || 'sprzedaz', nazwa: z.nazwa, data_zakupu: z.data_zakupu ? String(z.data_zakupu).slice(0, 10) : null, data_waznosci: z.data_waznosci ? String(z.data_waznosci).slice(0, 10) : null,
      stan: z.stan, stan_zrodla: z.stan_zrodla || 'ok', kwalifikacja: z.kwalifikacja || null, zrodlo_sprawdzono: z.zrodlo_sprawdzono ? String(z.zrodlo_sprawdzono).slice(0, 19) : null, weryfikacja, wykorzystanie: wyk,
      bilans_status: weryfikacja === 'zweryfikowany' ? 'zweryfikowany' : 'niezweryfikowany', skladniki: sk };
  });
}

module.exports = { logika, domena, repoSql, widokZakupow, SCHEMAT_V2, ELEMENTY_V2, WERSJA_SCHEMATU_V2, sprawdzSchematV2, migrujV2, BladDomeny, TRYBY, TRYBY_MUTACJE, TRYBY_NOWE_PRZYDZIALY, RODZAJE_OFERTY, KWALIFIKACJE };
