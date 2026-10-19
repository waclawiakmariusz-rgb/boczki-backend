// routes/maile-wprowadzajace.js — seria powitalna dla nowego salonu (2026-10-18).
//
// Siedem krótkich maili rozłożonych na pierwsze trzy tygodnie. Każdy pokazuje JEDNĄ rzecz,
// którą da się zrobić tego dnia, i prowadzi do właściwego rozdziału przewodnika /pomoc/
// (ten ma teraz prawdziwe zrzuty ekranu, więc mail nie musi tłumaczyć wszystkiego sam).
//
// ZASADY BEZPIECZEŃSTWA — te same co w routes/przypomnienia.js:
//  • moduł TYLKO czyta Licencje/Sesje i pisze do własnych tabel (Maile_wprowadzajace_wyslane,
//    Maile_wprowadzajace_stop); nie dotyka rejestracji, logowania ani danych salonu;
//  • każdy błąd jest łapany wewnątrz modułu — nic nie wychodzi do serwera;
//  • tryb z env MAILE_WPROWADZAJACE: 'off' (DOMYŚLNIE — nic nie wysyła), 'proba' (tylko log
//    „wysłałbym"), 'on' (wysyłka). Po wdrożeniu najpierw 'proba', dopiero potem 'on';
//  • idempotencja: INSERT IGNORE do tabeli z UNIQUE(tenant_id, etap) PRZED wysyłką — dwie
//    instancje na wspólnej bazie (dev + prod) nie wyślą tego samego dwa razy; gdy SMTP padnie,
//    wpis jest kasowany i próba wraca następnego dnia;
//  • okna czasowe domknięte z obu stron (np. etap „sprzedaz": 2–6 dni od założenia salonu),
//    CUTOFF pomija salony sprzed uruchomienia serii — nie piszemy do kogoś, kto pracuje od maja;
//  • rezygnacja: wpis w Maile_wprowadzajace_stop (tenant_id) wyłącza całą serię dla salonu;
//    każdy mail mówi, jak z niej wyjść;
//  • kopia (BCC) idzie do ADMIN_EMAIL — właściciel widzi dokładnie to, co dostają klienci.
'use strict';

const DZIEN_MS = 24 * 60 * 60 * 1000;
const CUTOFF = '2026-10-18';                 // salony założone od tego dnia
const POMIJANE_TENANTY = ['demo-estelio', 'demo-test'];

// ─── Seria: etap → kiedy wysłać (dni od założenia salonu) i treść ──────────────────────────────
// Okno [od, do) w dniach. Dzień 0 = dzień założenia salonu; mail powitalny po rejestracji
// wysyła już mailer.wyslijWitamy, więc seria zaczyna się następnego dnia.
const { SERIA } = require('./maile-wprowadzajace-tresc');  // treść siedmiu wiadomości — edytuje się TAM

module.exports = function (db, opts = {}) {
  const mailer = opts.mailer || require('./mailer');
  const log = opts.log || console;
  const teraz = opts.teraz || (() => new Date());

  const TRYB = () => {
    const t = String(process.env.MAILE_WPROWADZAJACE || 'off').trim().toLowerCase();
    return t === 'on' || t === 'proba' ? t : 'off';
  };
  const q = (sql, params = []) => new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

  // Własne tabele — tworzą się same, jak w przypomnieniach. Nic w istniejących tabelach.
  async function init() {
    try {
      await q(`CREATE TABLE IF NOT EXISTS Maile_wprowadzajace_wyslane (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        etap VARCHAR(40) NOT NULL,
        email VARCHAR(255) NULL,
        data_wyslania DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_etap (tenant_id, etap)
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await q(`CREATE TABLE IF NOT EXISTS Maile_wprowadzajace_stop (
        tenant_id VARCHAR(100) NOT NULL PRIMARY KEY,
        powod VARCHAR(255) NULL,
        kiedy DATETIME DEFAULT CURRENT_TIMESTAMP
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      // Treść edytowana w panelu admina. Pusta tabela = obowiązuje treść z pliku
      // maile-wprowadzajace-tresc.js; wiersz = nadpisanie dla jednego etapu.
      await q(`CREATE TABLE IF NOT EXISTS Maile_wprowadzajace_tresc (
        etap VARCHAR(40) NOT NULL PRIMARY KEY,
        dane MEDIUMTEXT NOT NULL,
        zmieniono DATETIME DEFAULT CURRENT_TIMESTAMP,
        kto VARCHAR(100) NULL
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) { log.error('[maile-wprow] init tabel:', e.message); }
  }

  // Treść obowiązująca: domyślna z pliku + nadpisania z panelu. Pola techniczne (etap, okno)
  // zostają z pliku — panel zmienia tylko teksty, nie harmonogram.
  async function wczytajSerie() {
    let nadpisania = [];
    try { nadpisania = await q(`SELECT etap, dane, zmieniono, kto FROM Maile_wprowadzajace_tresc`); }
    catch (e) { return SERIA.map(m => ({ ...m, _zrodlo: 'plik' })); }
    const mapa = new Map(nadpisania.map(r => [r.etap, r]));
    return SERIA.map(m => {
      const r = mapa.get(m.etap);
      if (!r) return { ...m, _zrodlo: 'plik' };
      let dane = {};
      try { dane = JSON.parse(r.dane); } catch (e) { return { ...m, _zrodlo: 'plik' }; }
      return { ...m, ...dane, etap: m.etap, okno: m.okno, _zrodlo: 'panel', _zmieniono: r.zmieniono, _kto: r.kto };
    });
  }

  const POLA_EDYTOWALNE = ['temat', 'preheader', 'naglowek', 'wstep', 'sekcje', 'zrzut', 'uwaga', 'dzis', 'cta', 'kotwica', 'link_wlasny'];

  async function zapiszTresc(etap, dane, kto) {
    if (!SERIA.some(m => m.etap === etap)) throw new Error('Nieznany etap: ' + etap);
    const czyste = {};
    for (const p of POLA_EDYTOWALNE) if (dane[p] !== undefined) czyste[p] = dane[p];
    await q(`INSERT INTO Maile_wprowadzajace_tresc (etap, dane, kto) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE dane = VALUES(dane), zmieniono = NOW(), kto = VALUES(kto)`,
      [etap, JSON.stringify(czyste), kto || null]);
    return czyste;
  }

  async function przywrocDomyslne(etap) {
    await q(`DELETE FROM Maile_wprowadzajace_tresc WHERE etap = ?`, [etap]);
  }

  // Ile salonów dostało dany etap — do podglądu w panelu.
  async function statystyki() {
    try { return await q(`SELECT etap, COUNT(*) ile, MAX(data_wyslania) ostatni FROM Maile_wprowadzajace_wyslane GROUP BY etap`); }
    catch (e) { return []; }
  }

  // Salony w oknie danego etapu: założone po CUTOFF, bez rezygnacji, bez wysłanego już etapu.
  async function kandydaci(etap, okno) {
    const [od, do_] = okno;
    return q(
      `SELECT l.id_bazy AS tenant_id, l.email, l.nazwa_salonu, l.login, l.data_utworzenia
         FROM Licencje l
        WHERE l.rola = 'salon'
          AND l.status = 'aktywny'
          AND l.email IS NOT NULL AND l.email <> ''
          AND l.data_utworzenia >= ?
          AND l.data_utworzenia <= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND l.data_utworzenia >  DATE_SUB(NOW(), INTERVAL ? DAY)
          AND NOT EXISTS (SELECT 1 FROM Maile_wprowadzajace_stop s WHERE s.tenant_id = l.id_bazy)
          AND NOT EXISTS (SELECT 1 FROM Maile_wprowadzajace_wyslane w WHERE w.tenant_id = l.id_bazy AND w.etap = ?)
        LIMIT 50`,
      [CUTOFF, od, do_, etap]);
  }

  async function tick() {
    const tryb = TRYB();
    if (tryb === 'off') return { tryb, wyslane: 0 };
    let wyslane = 0;
    const seria = await wczytajSerie();
    for (const mail of seria) {
      let lista = [];
      try { lista = await kandydaci(mail.etap, mail.okno); }
      catch (e) { log.error(`[maile-wprow] ${mail.etap}: odczyt kandydatów:`, e.message); continue; }
      for (const s of lista) {
        if (POMIJANE_TENANTY.includes(String(s.tenant_id))) continue;
        const dni = Math.floor((teraz() - new Date(s.data_utworzenia)) / DZIEN_MS);
        if (tryb === 'proba') { log.info(`[maile-wprow] PRÓBA — wysłałbym „${mail.etap}" do ${s.email} (${s.nazwa_salonu}, ${dni} dni po starcie)`); continue; }
        // rezerwacja PRZED wysyłką: dwie instancje nie wyślą tego samego
        try {
          const r = await q(`INSERT IGNORE INTO Maile_wprowadzajace_wyslane (tenant_id, etap, email) VALUES (?, ?, ?)`, [s.tenant_id, mail.etap, s.email]);
          if (!r || !r.affectedRows) continue;
        } catch (e) { log.error(`[maile-wprow] ${mail.etap}: rezerwacja:`, e.message); continue; }
        try {
          await mailer.wyslijMailWprowadzajacy({ email: s.email, nazwa_salonu: s.nazwa_salonu, mail, numer: seria.indexOf(mail) + 1, ile: seria.length });
          wyslane++;
          log.info(`[maile-wprow] wysłano „${mail.etap}" do ${s.email} (${s.nazwa_salonu})`);
        } catch (e) {
          log.error(`[maile-wprow] ${mail.etap}: SMTP:`, e.message);
          await q(`DELETE FROM Maile_wprowadzajace_wyslane WHERE tenant_id = ? AND etap = ?`, [s.tenant_id, mail.etap]).catch(() => {});
        }
      }
    }
    return { tryb, wyslane };
  }

  function start() {
    init().then(() => {
      const uruchom = () => tick().catch(e => log.error('[maile-wprow] tick:', e.message));
      setTimeout(uruchom, 5 * 60 * 1000);          // pierwszy przebieg 5 minut po starcie serwera
      setInterval(uruchom, 24 * 60 * 60 * 1000);   // potem raz na dobę
      log.info(`[maile-wprow] seria powitalna gotowa (tryb: ${TRYB()}, etapów: ${SERIA.length})`);
    });
  }

  return { tick, start, init, SERIA, wczytajSerie, zapiszTresc, przywrocDomyslne, statystyki, _CUTOFF: CUTOFF, _TRYB: TRYB };
};

module.exports.SERIA = SERIA;
