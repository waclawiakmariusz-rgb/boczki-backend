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
      // Dziennik wysyłek — dowód nadania na rozmowę z salonem („nie dostaliśmy żadnego maila").
      // Osobny od tabeli idempotencji: tam jeden wiersz na salon i etap, tutaj KAŻDA próba wysyłki,
      // razem z ponowieniami i próbkami, z odpowiedzią serwera pocztowego.
      await q(`CREATE TABLE IF NOT EXISTS Maile_wprowadzajace_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        kiedy DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        tenant_id VARCHAR(100) NULL,
        nazwa_salonu VARCHAR(255) NULL,
        email VARCHAR(255) NOT NULL,
        etap VARCHAR(40) NOT NULL,
        temat VARCHAR(255) NULL,
        rodzaj VARCHAR(16) NOT NULL,
        status VARCHAR(12) NOT NULL,
        smtp_id VARCHAR(255) NULL,
        smtp_odpowiedz VARCHAR(255) NULL,
        blad VARCHAR(500) NULL,
        kto VARCHAR(100) NULL,
        INDEX idx_tenant (tenant_id, kiedy),
        INDEX idx_kiedy (kiedy)
      ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (e) { log.error('[maile-wprow] init tabel:', e.message); }
  }

  // rodzaj: 'seria' (automat), 'ponowna' (admin wysłał drugi raz temu samemu salonowi),
  //         'proba' (wysyłka testowa pod dowolny adres). status: 'wyslany' | 'blad'.
  async function zapiszLog(w) {
    try {
      await q(`INSERT INTO Maile_wprowadzajace_log
               (tenant_id, nazwa_salonu, email, etap, temat, rodzaj, status, smtp_id, smtp_odpowiedz, blad, kto)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [w.tenant_id || null, w.nazwa_salonu || null, w.email, w.etap, (w.temat || '').slice(0, 255), w.rodzaj, w.status,
         (w.smtp_id || null), String(w.smtp_odpowiedz || '').slice(0, 255) || null, String(w.blad || '').slice(0, 500) || null, w.kto || 'system']);
    } catch (e) { log.error('[maile-wprow] zapis dziennika:', e.message); }
  }

  // Dziennik do panelu: najnowsze na górze, opcjonalnie zawężony do salonu / adresu / wiadomości.
  async function dziennik({ szukaj, etap, limit } = {}) {
    const warunki = [], parametry = [];
    if (szukaj) { warunki.push('(nazwa_salonu LIKE ? OR email LIKE ? OR tenant_id LIKE ?)'); const s = `%${szukaj}%`; parametry.push(s, s, s); }
    if (etap) { warunki.push('etap = ?'); parametry.push(etap); }
    const ile = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
    try {
      return await q(`SELECT * FROM Maile_wprowadzajace_log
                      ${warunki.length ? 'WHERE ' + warunki.join(' AND ') : ''}
                      ORDER BY kiedy DESC, id DESC LIMIT ${ile}`, parametry);
    } catch (e) { return []; }
  }

  // Ponowna wysyłka tej samej wiadomości do konkretnego salonu — gdy salon twierdzi, że nic nie dostał.
  // NIE rusza tabeli idempotencji (pierwsza wysyłka zostaje w historii), ale zapisuje się w dzienniku.
  async function wyslijPonownie(etap, tenant_id, kto) {
    const seria = await wczytajSerie();
    const mail = seria.find(m => m.etap === etap);
    if (!mail) throw new Error('Nieznana wiadomość: ' + etap);
    const salony = await q(`SELECT id_bazy AS tenant_id, email, nazwa_salonu FROM Licencje WHERE id_bazy = ? LIMIT 1`, [tenant_id]);
    const s = salony && salony[0];
    if (!s) throw new Error('Nie znaleziono salonu: ' + tenant_id);
    if (!s.email) throw new Error('Ten salon nie ma zapisanego adresu e-mail.');
    try {
      const w = await mailer.wyslijMailWprowadzajacy({ email: s.email, nazwa_salonu: s.nazwa_salonu, mail });
      await zapiszLog({ tenant_id: s.tenant_id, nazwa_salonu: s.nazwa_salonu, email: s.email, etap, temat: mail.temat, rodzaj: 'ponowna', status: 'wyslany', smtp_id: w.messageId, smtp_odpowiedz: w.odpowiedz, kto });
      return { email: s.email, nazwa_salonu: s.nazwa_salonu, smtp_id: w.messageId };
    } catch (e) {
      await zapiszLog({ tenant_id: s.tenant_id, nazwa_salonu: s.nazwa_salonu, email: s.email, etap, temat: mail.temat, rodzaj: 'ponowna', status: 'blad', blad: e.message, kto });
      throw e;
    }
  }

  // Treść obowiązująca: wiadomości z pliku + zmiany i NOWE wiadomości dopisane w panelu.
  // Wiersz w bazie, którego nie ma w pliku, to dodatkowy mail edukacyjny (ósmy, dziewiąty, dowolny).
  // Kolejność wynika z terminu wysyłki, a nie z tego, gdzie wiadomość powstała.
  async function wczytajSerie() {
    let wiersze = [];
    try { wiersze = await q(`SELECT etap, dane, zmieniono, kto FROM Maile_wprowadzajace_tresc`); }
    catch (e) { return SERIA.map(m => ({ ...m, _zrodlo: 'plik' })); }
    const mapa = new Map();
    for (const r of wiersze) { try { mapa.set(r.etap, { dane: JSON.parse(r.dane), meta: r }); } catch (e) { /* uszkodzony JSON = ignorujemy, zostaje plik */ } }

    const zPliku = SERIA.map(m => {
      const r = mapa.get(m.etap);
      if (!r) return { ...m, _zrodlo: 'plik', _wlasna: false };
      mapa.delete(m.etap);
      return { ...m, ...r.dane, etap: m.etap, _zrodlo: 'panel', _wlasna: false, _zmieniono: r.meta.zmieniono, _kto: r.meta.kto };
    });
    const wlasne = [...mapa.entries()].map(([etap, r]) => ({
      kotwica: '', cta: 'Otwórz przewodnik', sekcje: [], okno: [30, 40],
      ...r.dane, etap, _zrodlo: 'panel', _wlasna: true, _zmieniono: r.meta.zmieniono, _kto: r.meta.kto,
    }));
    return [...zPliku, ...wlasne].sort((a, b) => (a.okno[0] - b.okno[0]) || (a.okno[1] - b.okno[1]));
  }

  const POLA_EDYTOWALNE = ['temat', 'preheader', 'podtytul', 'naglowek', 'wstep', 'sekcje', 'zrzut', 'uwaga', 'dzis', 'cta', 'kotwica', 'link_wlasny', 'okno', 'wylaczona'];
  const RE_ETAP = /^[a-z0-9][a-z0-9-]{1,39}$/;

  // Zapis działa i dla wiadomości z pliku (nadpisanie tekstów), i dla nowych (pełna definicja).
  async function zapiszTresc(etap, dane, kto) {
    if (!RE_ETAP.test(String(etap || ''))) throw new Error('Identyfikator: 2–40 znaków, małe litery, cyfry i myślniki.');
    const zPliku = SERIA.find(m => m.etap === etap);
    const czyste = {};
    for (const p of POLA_EDYTOWALNE) if (dane[p] !== undefined) czyste[p] = dane[p];

    if (czyste.okno !== undefined) {
      const od = parseInt(czyste.okno[0], 10), do_ = parseInt(czyste.okno[1], 10);
      if (!Number.isFinite(od) || !Number.isFinite(do_) || od < 0 || do_ <= od || do_ > 400) throw new Error('Termin: „od" musi być mniejsze niż „do", a oba w zakresie 0–400 dni.');
      czyste.okno = [od, do_];
    } else if (!zPliku) {
      throw new Error('Nowa wiadomość musi mieć ustawiony termin wysyłki.');
    }
    if (!zPliku && !String(czyste.temat || '').trim()) throw new Error('Nowa wiadomość musi mieć temat.');

    await q(`INSERT INTO Maile_wprowadzajace_tresc (etap, dane, kto) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE dane = VALUES(dane), zmieniono = NOW(), kto = VALUES(kto)`,
      [etap, JSON.stringify(czyste), kto || null]);
    return czyste;
  }

  // Dla wiadomości z pliku: powrót do treści domyślnej. Dla własnej: skasowanie jej na dobre.
  async function przywrocDomyslne(etap) {
    const zPliku = SERIA.some(m => m.etap === etap);
    await q(`DELETE FROM Maile_wprowadzajace_tresc WHERE etap = ?`, [etap]);
    return { usunieta: !zPliku };
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
      if (mail.wylaczona) continue;   // wyłączona w panelu — zostaje w liście, ale nie wychodzi
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
          const w = await mailer.wyslijMailWprowadzajacy({ email: s.email, nazwa_salonu: s.nazwa_salonu, mail });
          wyslane++;
          await zapiszLog({ tenant_id: s.tenant_id, nazwa_salonu: s.nazwa_salonu, email: s.email, etap: mail.etap, temat: mail.temat, rodzaj: 'seria', status: 'wyslany', smtp_id: w.messageId, smtp_odpowiedz: w.odpowiedz });
          log.info(`[maile-wprow] wysłano „${mail.etap}" do ${s.email} (${s.nazwa_salonu})`);
        } catch (e) {
          log.error(`[maile-wprow] ${mail.etap}: SMTP:`, e.message);
          await zapiszLog({ tenant_id: s.tenant_id, nazwa_salonu: s.nazwa_salonu, email: s.email, etap: mail.etap, temat: mail.temat, rodzaj: 'seria', status: 'blad', blad: e.message });
          await q(`DELETE FROM Maile_wprowadzajace_wyslane WHERE tenant_id = ? AND etap = ?`, [s.tenant_id, mail.etap]).catch(() => {});
        }
      }
    }
    return { tryb, wyslane };
  }

  function start() {
    init().then(() => {
      const uruchom = () => tick().catch(e => log.error('[maile-wprow] tick:', e.message));
      // 20.10.2026 — Ambasada Urody (pierwszy prawdziwy klient) czekała na mail „start" pół doby:
      // salon wchodzi w okno dokładnie dobę po założeniu, a przebieg dobowy wypadł wcześniej tego dnia,
      // więc następny byłby dopiero 24 h później. Godzina przebiegu zależała od tego, kiedy akurat
      // restartowaliśmy serwer — czyli od przypadku. Teraz co godzinę: salon czeka najwyżej 60 minut.
      // Bezpieczne, bo rezerwacja w Maile_wprowadzajace_wyslane (UNIQUE tenant_id+etap) idzie PRZED
      // wysyłką — częstsze przebiegi nie mogą wysłać niczego dwa razy, a gdy nikt nie jest w oknie,
      // cały przebieg to siedem lekkich SELECT-ów.
      setTimeout(uruchom, 2 * 60 * 1000);          // pierwszy przebieg 2 minuty po starcie serwera
      setInterval(uruchom, 60 * 60 * 1000);        // potem co godzinę
      log.info(`[maile-wprow] seria powitalna gotowa (tryb: ${TRYB()}, etapów: ${SERIA.length})`);
    });
  }

  return { tick, start, init, SERIA, wczytajSerie, zapiszTresc, przywrocDomyslne, statystyki, zapiszLog, dziennik, wyslijPonownie, _CUTOFF: CUTOFF, _TRYB: TRYB };
};

module.exports.SERIA = SERIA;
