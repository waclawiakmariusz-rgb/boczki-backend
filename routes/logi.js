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
