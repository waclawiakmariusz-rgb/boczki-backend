// routes/users.js
// Zarządzanie użytkownikami: get_pin_users, verify_pin, get_admin_users, add_admin_user, delete_admin_user

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');

module.exports = (db) => {
  const zapiszLog = makeZapiszLog(db);

  // GET /users?action=...&tenant_id=...
  router.get('/users', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'get_pin_users') {
      db.query(
        `SELECT imie_login, rola FROM Użytkownicy WHERE tenant_id = ?`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json((rows || []).filter(r => r.imie_login).map(r => ({ imie: r.imie_login, rola: r.rola })));
        }
      );

    } else if (action === 'get_admin_users') {
      db.query(
        `SELECT imie_login, haslo_pin, rola FROM Użytkownicy WHERE tenant_id = ?`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json((rows || []).filter(r => r.imie_login).map(r => ({ imie: r.imie_login, pin: r.haslo_pin, rola: r.rola })));
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET users: ' + action });
    }
  });

  // POST /users
  router.post('/users', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'verify_pin') {
      db.query(
        `SELECT imie_login, haslo_pin, rola FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?)`,
        [tenant_id, d.imie],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono użytkownika.' });
          const user = rows[0];
          if (String(user.haslo_pin).trim() === String(d.pin).trim()) {
            return res.json({ status: 'success', rola: user.rola });
          }
          return res.json({ status: 'error', message: 'Błędny PIN!' });
        }
      );

    } else if (action === 'get_pin_users') {
      db.query(
        `SELECT imie_login, rola FROM Użytkownicy WHERE tenant_id = ?`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json((rows || []).filter(r => r.imie_login).map(r => ({ imie: r.imie_login, rola: r.rola })));
        }
      );

    } else if (action === 'get_admin_users') {
      db.query(
        `SELECT imie_login, haslo_pin, rola FROM Użytkownicy WHERE tenant_id = ?`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json((rows || []).filter(r => r.imie_login).map(r => ({ imie: r.imie_login, pin: r.haslo_pin, rola: r.rola })));
        }
      );

    } else if (action === 'add_admin_user') {
      // Sprawdź czy istnieje
      db.query(
        `SELECT id FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?)`,
        [tenant_id, d.imie],
        (err, rows) => {
          if (rows && rows.length > 0) {
            db.query(
              `UPDATE Użytkownicy SET haslo_pin = ?, rola = ? WHERE tenant_id = ? AND id = ?`,
              [d.pin, d.rola, tenant_id, rows[0].id],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                zapiszLog(tenant_id, 'EDYCJA UŻYTKOWNIKA', d.pracownik, `Zaktualizowano profil: ${d.imie} (${d.rola})`);
                return res.json({ status: 'success', message: 'Zaktualizowano profil pracownika!' });
              }
            );
          } else {
            const id = randomUUID();
            db.query(
              `INSERT INTO Użytkownicy (id, tenant_id, imie_login, haslo_pin, rola) VALUES (?, ?, ?, ?, ?)`,
              [id, tenant_id, d.imie, d.pin, d.rola],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                zapiszLog(tenant_id, 'NOWY UŻYTKOWNIK', d.pracownik, `Dodano: ${d.imie} (${d.rola})`);
                return res.json({ status: 'success', message: 'Dodano nowego pracownika!' });
              }
            );
          }
        }
      );

    } else if (action === 'delete_admin_user') {
      db.query(
        `DELETE FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`,
        [tenant_id, d.imie],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono użytkownika.' });
          zapiszLog(tenant_id, 'USUNIĘTO UŻYTKOWNIKA', d.pracownik, `Usunięto profil: ${d.imie}`);
          return res.json({ status: 'success', message: 'Konto pracownika zostało usunięte.' });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja users POST: ' + action });
    }
  });

  return router;
};
