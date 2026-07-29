// routes/logi.js
// Funkcje logowania do bazy i pobierania logów systemowych

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');

module.exports = (db) => {
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
