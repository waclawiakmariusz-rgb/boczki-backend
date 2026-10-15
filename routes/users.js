// routes/users.js
// Zarządzanie użytkownikami: get_pin_users, verify_pin, get_admin_users, add_admin_user, delete_admin_user

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');
const { createSession, rateLimitPin, recordFailedPin, recordSuccessPin, getSession } = require('./sessions');

module.exports = (db) => {
  const zapiszLog = makeZapiszLog(db);
  // E05: zarządzanie kontami (lista, dodanie/zmiana PIN-u, usunięcie) wymaga sesji PIN osoby z rolą manager/megaadmin w TYM salonie.
  // Rola pochodzi z bazy (po loginie z sesji), nie z treści żądania. Sesja salonowa (konto salonu bez PIN) nie wystarcza.
  const ROLE_ZARZADZANIE = new Set(['manager', 'megaadmin', 'admin']);
  function wymagajZarzadzania(req, tenant_id, cb) {
    const s = getSession(req.headers['x-session-token']);
    if (!s || String(s.tenant_id) !== String(tenant_id) || !s.login) return cb(null);
    db.query(`SELECT rola FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`, [tenant_id, String(s.login).trim()], (err, rows) => {
      if (err || !rows || !rows.length) return cb(null);
      const rola = String(rows[0].rola || '').toLowerCase().trim();
      cb(ROLE_ZARZADZANIE.has(rola) ? { imie: String(s.login).trim(), rola } : null);
    });
  }
  const ODMOWA = { status: 'error', code: 'UPRAWNIENIA', message: 'Zarządzanie kontami wymaga zalogowania PIN-em managera.' };

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
      // E05: lista bez PIN-ów i tylko dla managera/megaadmina zalogowanego PIN-em
      wymagajZarzadzania(req, tenant_id, (kto) => {
        if (!kto) return res.json(ODMOWA);
        db.query(
          `SELECT imie_login, haslo_pin, rola FROM Użytkownicy WHERE tenant_id = ?`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json([]);
            return res.json((rows || []).filter(r => r.imie_login).map(r => ({ imie: r.imie_login, rola: r.rola, pin_ustawiony: !!(r.haslo_pin && String(r.haslo_pin).trim()) })));
          }
        );
      });

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET users: ' + action });
    }
  });

  // POST /users
  router.post('/users', rateLimitPin, (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'verify_pin') {
      db.query(
        `SELECT imie_login, haslo_pin, rola FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?)`,
        [tenant_id, d.imie],
        (err, rows) => {
          if (err || !rows.length) {
            recordFailedPin(req);
            return res.json({ status: 'error', message: 'Nie znaleziono użytkownika.' });
          }
          const user = rows[0];
          if (String(user.haslo_pin).trim() === String(d.pin).trim()) {
            recordSuccessPin(req);
            const session_token = createSession(tenant_id, d.imie);

            // Załącz listę aktywnych dodatków (feature flags) — frontend zachowuje w window.tenantFeatures
            db.query(
              `SELECT feature_key FROM Tenant_Features WHERE tenant_id = ? AND enabled = 1`,
              [tenant_id],
              (errF, fRows) => {
                const features = (fRows || []).map(r => r.feature_key);
                return res.json({ status: 'success', rola: user.rola, session_token, features });
              }
            );
            return;
          }
          recordFailedPin(req);
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
      // E05: lista bez PIN-ów i tylko dla managera/megaadmina zalogowanego PIN-em
      wymagajZarzadzania(req, tenant_id, (kto) => {
        if (!kto) return res.json(ODMOWA);
        db.query(
          `SELECT imie_login, haslo_pin, rola FROM Użytkownicy WHERE tenant_id = ?`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json([]);
            return res.json((rows || []).filter(r => r.imie_login).map(r => ({ imie: r.imie_login, rola: r.rola, pin_ustawiony: !!(r.haslo_pin && String(r.haslo_pin).trim()) })));
          }
        );
      });

    } else if (action === 'add_admin_user') {
      wymagajZarzadzania(req, tenant_id, (kto) => {
      if (!kto) return res.json(ODMOWA);
      const nowyPin = d.pin == null ? '' : String(d.pin).trim();
      if (nowyPin && !/^\d{4,6}$/.test(nowyPin)) return res.json({ status: 'error', message: 'PIN to 4–6 cyfr.' });
      // Sprawdź czy istnieje
      db.query(
        `SELECT id FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?)`,
        [tenant_id, d.imie],
        (err, rows) => {
          if (rows && rows.length > 0) {
            // E05: pusty PIN przy edycji = bez zmiany PIN-u (UI nie zna PIN-u, więc nie może go „przepisać”)
            db.query(
              nowyPin ? `UPDATE Użytkownicy SET haslo_pin = ?, rola = ? WHERE tenant_id = ? AND id = ?` : `UPDATE Użytkownicy SET rola = ? WHERE tenant_id = ? AND id = ?`,
              nowyPin ? [nowyPin, d.rola, tenant_id, rows[0].id] : [d.rola, tenant_id, rows[0].id],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                zapiszLog(tenant_id, 'EDYCJA UŻYTKOWNIKA', kto.imie, `Zaktualizowano profil: ${d.imie} (${d.rola})${nowyPin ? ', nowy PIN' : ''}`);
                return res.json({ status: 'success', message: 'Zaktualizowano profil pracownika!' });
              }
            );
          } else {
            if (!nowyPin) return res.json({ status: 'error', message: 'Nowe konto wymaga PIN-u (4–6 cyfr).' });
            const id = randomUUID();
            db.query(
              `INSERT INTO Użytkownicy (id, tenant_id, imie_login, haslo_pin, rola) VALUES (?, ?, ?, ?, ?)`,
              [id, tenant_id, d.imie, nowyPin, d.rola],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                zapiszLog(tenant_id, 'NOWY UŻYTKOWNIK', kto.imie, `Dodano: ${d.imie} (${d.rola})`);
                return res.json({ status: 'success', message: 'Dodano nowego pracownika!' });
              }
            );
          }
        }
      );
      });

    } else if (action === 'delete_admin_user') {
      wymagajZarzadzania(req, tenant_id, (kto) => {
      if (!kto) return res.json(ODMOWA);
      if (String(d.imie || '').trim() === kto.imie) return res.json({ status: 'error', message: 'Nie możesz usunąć własnego konta.' });
      db.query(
        `DELETE FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`,
        [tenant_id, d.imie],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono użytkownika.' });
          zapiszLog(tenant_id, 'USUNIĘTO UŻYTKOWNIKA', kto.imie, `Usunięto profil: ${d.imie}`);
          return res.json({ status: 'success', message: 'Konto pracownika zostało usunięte.' });
        }
      );
      });

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja users POST: ' + action });
    }
  });

  return router;
};
