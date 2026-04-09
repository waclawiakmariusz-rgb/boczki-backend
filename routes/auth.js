// routes/auth.js
// Logowanie SaaS - sprawdzanie w tabeli Licencje

const express = require('express');
const router = express.Router();

module.exports = (db) => {
  // POST /login
  router.post('/login', (req, res) => {
    const { login, haslo } = req.body;
    if (!login || !haslo) {
      return res.json({ status: 'error', message: 'Podaj login i hasło.' });
    }

    const sql = `SELECT login, haslo, rola, id_bazy, status FROM Licencje WHERE LOWER(TRIM(login)) = LOWER(TRIM(?)) LIMIT 1`;
    db.query(sql, [login.trim()], (err, rows) => {
      if (err) return res.json({ status: 'error', message: 'Błąd bazy: ' + err.message });
      if (!rows || rows.length === 0) return res.json({ status: 'error', message: 'Błędny login lub hasło' });

      const user = rows[0];
      if (user.haslo.trim() !== haslo.trim()) {
        return res.json({ status: 'error', message: 'Błędny login lub hasło' });
      }
      if (user.status && user.status.toLowerCase() !== 'aktywny') {
        return res.json({ status: 'error', message: 'Licencja nieaktywna.' });
      }
      return res.json({ status: 'success', role: user.rola, tenant_id: user.id_bazy });
    });
  });

  return router;
};
