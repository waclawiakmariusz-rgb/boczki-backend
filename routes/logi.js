// routes/logi.js
// Funkcje logowania do bazy i pobierania logów systemowych

const express = require('express');
const { randomUUID } = require('crypto');

module.exports = (db) => {
  // Router tworzony W fabryce (25.11.2026; wcześniej na poziomie modułu): każde wywołanie fabryki dostaje własny router,
  // zamiast dokładać obsługę do wspólnego — w serwerze bez różnicy (jedno wywołanie), w testach konieczne.
  const router = express.Router();
  // Pomocnicza funkcja zapiszLog - eksportowana do użycia w innych routes
  // Wewnętrzna wersja - używa db bezpośrednio
  function zapiszLog(tenant_id, akcja, kto, opis) {
    const id = randomUUID();
    const sql = `INSERT INTO Logi (id, tenant_id, data_zdarzenia, pracownik, akcja, modul, opis) VALUES (?, ?, NOW(), ?, ?, 'SYSTEM', ?)`;
    db.query(sql, [id, tenant_id, kto || 'System', akcja, opis || ''], (err) => {
      if (err) console.error('Błąd zapisu logu:', err.message);
    });
  }

  // GET /get_system_logs
  router.get('/get_system_logs', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });

    const sql = `SELECT data_zdarzenia, pracownik, akcja, opis FROM Logi WHERE tenant_id = ? ORDER BY data_zdarzenia DESC LIMIT 300`;
    db.query(sql, [tenant_id], (err, rows) => {
      if (err) return res.json([]);
      const logi = rows.map(r => ({
        data: r.data_zdarzenia,
        kto: r.pracownik,
        akcja: r.akcja,
        opis: r.opis
      }));
      return res.json(logi);
    });
  });

  // POST /logi — akcja `eksport_log` (25.11.2026): wpis w Dzienniku o eksporcie widocznych danych do Excela.
  // Polecenie właściciela: eksport może zrobić manager, megaadmin, recepcja (i admin), a KAŻDY eksport musi być
  // zarejestrowany w Dzienniku Zdarzeń. Panel pyta o ten wpis PRZED zapisaniem pliku — bez potwierdzenia plik nie powstaje.
  const ROLE_EKSPORTU = new Set(['admin', 'megaadmin', 'manager', 'recepcja']);
  router.post('/logi', (req, res) => {
    const d = req.body || {};
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    if (d.action !== 'eksport_log') return res.json({ status: 'error', message: 'Nieznana akcja: ' + d.action });
    const kto = String(d.user_log || '').trim();
    if (!kto) return res.json({ status: 'error', message: 'Brak identyfikacji pracownika — zaloguj się ponownie.' });
    db.query(`SELECT rola FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`, [tenant_id, kto], (err, rows) => {
      const rola = (!err && Array.isArray(rows) && rows[0]) ? String(rows[0].rola || '').toLowerCase().trim() : '';
      if (!ROLE_EKSPORTU.has(rola)) return res.json({ status: 'error', message: 'Eksport danych jest dostępny dla recepcji, managera i administratora.' });
      const tekst = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
      const widok = tekst(d.widok, 80) || tekst(d.sekcja, 80) || 'widok';
      const wierszy = Math.max(0, parseInt(d.wierszy, 10) || 0);
      const arkusze = Math.max(1, parseInt(d.arkusze, 10) || 1);
      const kolumny = tekst(d.kolumny, 200);
      const filtry = tekst(d.filtry, 150);
      const plik = tekst(d.plik, 80);
      const teraz = new Date();
      const f = (o) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', ...o }).format(teraz);
      const kiedy = f({ day: '2-digit', month: '2-digit', year: 'numeric' }) + ' o ' + f({ hour: '2-digit', minute: '2-digit' });
      const opis = `Użytkownik ${kto} wyeksportował do Excela widok „${widok}” (${kiedy}): ${wierszy} wierszy${arkusze > 1 ? ' w ' + arkusze + ' arkuszach' : ''}; kolumny: ${kolumny || 'brak'}; filtry: ${filtry || 'brak'}; plik: ${plik || 'bez nazwy'}.`;
      db.query(
        `INSERT INTO Logi (id, tenant_id, data_zdarzenia, pracownik, akcja, modul, opis) VALUES (?, ?, NOW(), ?, 'EKSPORT DANYCH', 'SYSTEM', ?)`,
        [randomUUID(), tenant_id, kto, opis.slice(0, 500)],
        (err2) => {
          if (err2) return res.json({ status: 'error', message: 'Nie udało się zapisać wpisu w Dzienniku: ' + err2.message });
          return res.json({ status: 'success', message: 'Eksport zapisany w Dzienniku Zdarzeń.', opis });
        }
      );
    });
  });

  return router;
};

// ─── Rejestr BŁĘDÓW ─────────────────────────────────────────────────────────
// Powód (2026-07-29): recepcja zgłasza „wyskoczył jakiś błąd", ale nie czyta ani nie
// zapamiętuje treści komunikatu — diagnoza staje się zgadywanką. Od teraz KAŻDY błąd
// zwrócony przez API ląduje w Dzienniku Zdarzeń, więc da się go odtworzyć po fakcie.
//
// Tłumienie powtórek: identyczny błąd (ten sam salon + akcja + treść) zapisujemy raz
// na minutę. Bez tego jeden zepsuty endpoint w pętli zalałby dziennik i wypchnął
// z niego wszystko inne (widok pokazuje 300 ostatnich wpisów).
module.exports.makeZapiszBlad = (db) => {
  const ostatnie = new Map();
  const OKNO_MS = 60000;

  return function zapiszBlad(tenant_id, akcja, kto, komunikat, kontekst) {
    try {
      if (!tenant_id) return;
      const msg = String(komunikat == null ? '' : komunikat).slice(0, 400);
      if (!msg) return;

      const klucz = tenant_id + '|' + akcja + '|' + msg;
      const teraz = Date.now();
      const poprzednio = ostatnie.get(klucz);
      if (poprzednio && (teraz - poprzednio) < OKNO_MS) return;
      ostatnie.set(klucz, teraz);
      if (ostatnie.size > 500) ostatnie.clear();   // bezpiecznik pamięci

      const id = randomUUID();
      const opis = (kontekst ? String(kontekst) + ' — ' : '') + msg;
      db.query(
        `INSERT INTO Logi (id, tenant_id, data_zdarzenia, pracownik, akcja, modul, opis) VALUES (?, ?, NOW(), ?, ?, 'SYSTEM', ?)`,
        [id, tenant_id, kto || 'System', ('BŁĄD: ' + String(akcja || 'nieznana')).slice(0, 90), opis.slice(0, 500)],
        (err) => {
          // Zapis logu NIGDY nie może wywrócić właściwej operacji — tylko konsola.
          if (err) console.error('[logi] nie udało się zapisać błędu:', err.message);
        }
      );
    } catch (e) {
      console.error('[logi] zapiszBlad wyjątek:', e.message);
    }
  };
};

// Eksport pomocniczej funkcji zapiszLog do użycia w innych modułach
module.exports.makeZapiszLog = (db) => {
  return function zapiszLog(tenant_id, akcja, kto, opis) {
    const id = randomUUID();
    const sql = `INSERT INTO Logi (id, tenant_id, data_zdarzenia, pracownik, akcja, modul, opis) VALUES (?, ?, NOW(), ?, ?, 'SYSTEM', ?)`;
    db.query(sql, [id, tenant_id, kto || 'System', akcja, opis || ''], (err) => {
      if (err) console.error('Błąd zapisu logu:', err.message);
    });
  };
};
