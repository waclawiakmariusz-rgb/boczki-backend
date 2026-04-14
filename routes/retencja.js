// routes/retencja.js
// Retencja: get_retention, save_retention

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');

module.exports = (db) => {
  const zapiszLog = makeZapiszLog(db);

  // GET /retencja?action=get_retention&tenant_id=...
  router.get('/retencja', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });

    db.query(
      `SELECT data_kontaktu, id_klienta, klient, kategoria_filtr, status, notatka, pracownik FROM Retencja WHERE tenant_id = ? ORDER BY data_kontaktu DESC`,
      [tenant_id],
      (err, rows) => {
        if (err) return res.json([]);
        return res.json((rows || []).map(r => ({
          data: r.data_kontaktu, id_klienta: r.id_klienta, klient: r.klient,
          kampania: r.kategoria_filtr, status: r.status, notatka: r.notatka, pracownik: r.pracownik
        })));
      }
    );
  });

  // POST /retencja
  router.post('/retencja', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });

    if (d.action === 'save_retention') {
      const id = randomUUID();
      db.query(
        `INSERT INTO Retencja (id, tenant_id, data_kontaktu, id_klienta, klient, kategoria_filtr, status, notatka, pracownik) VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
        [id, tenant_id, d.id_klienta || '', d.klient, d.kampania || '', d.status || 'nowy', d.notatka || '', d.pracownik || ''],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', message: 'Zapisano notatkę z rozmowy!' });
        }
      );
    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja retencja POST: ' + d.action });
    }
  });

  return router;
};
