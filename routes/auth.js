// routes/auth.js
// Logowanie SaaS - sprawdzanie w tabeli Licencje + reset hasła

const express = require('express');
const { randomUUID } = require('crypto');

let wyslijResetHasla;
try {
  wyslijResetHasla = require('./mailer').wyslijResetHasla;
} catch (e) {
  wyslijResetHasla = async () => { throw new Error('Mailer nie skonfigurowany.'); };
}

module.exports = (db) => {
  const router = express.Router();
  // Auto-create tabeli tokenów reset hasła
  db.query(`CREATE TABLE IF NOT EXISTS Tokeny_reset_hasla (
    token VARCHAR(36) PRIMARY KEY,
    login VARCHAR(100) NOT NULL,
    expires_at DATETIME NOT NULL,
    uzyty TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('[auth] Błąd tworzenia tabeli Tokeny_reset_hasla:', err.message);
  });

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

  // POST /reset-hasla/wyslij — generuj token i wyślij email
  router.post('/reset-hasla/wyslij', (req, res) => {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.json({ status: 'error', message: 'Podaj adres email.' });
    }

    db.query(
      `SELECT login, email FROM Licencje WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND status = 'aktywny' LIMIT 1`,
      [email.trim()],
      async (err, rows) => {
        if (err) return res.json({ status: 'error', message: 'Błąd bazy danych.' });

        // Zawsze zwracamy sukces — nie ujawniamy czy email istnieje w systemie
        if (!rows || rows.length === 0) {
          return res.json({ status: 'success', message: 'Jeśli podany email jest w systemie, otrzymasz wiadomość z linkiem.' });
        }

        const user = rows[0];
        const token = randomUUID();
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 godzina

        db.query(
          `INSERT INTO Tokeny_reset_hasla (token, login, expires_at) VALUES (?, ?, ?)`,
          [token, user.login, expires],
          async (err2) => {
            if (err2) return res.json({ status: 'error', message: 'Błąd zapisu tokenu.' });

            try {
              await wyslijResetHasla({ email: user.email, login: user.login, token });
            } catch (mailErr) {
              console.error('[reset hasła] Błąd wysyłki emaila:', mailErr.message);
              return res.json({ status: 'error', message: 'Nie udało się wysłać emaila. Sprawdź konfigurację SMTP.' });
            }

            return res.json({ status: 'success', message: 'Jeśli podany email jest w systemie, otrzymasz wiadomość z linkiem.' });
          }
        );
      }
    );
  });

  // GET /reset-hasla/weryfikuj?token=... — sprawdź ważność tokenu
  router.get('/reset-hasla/weryfikuj', (req, res) => {
    const { token } = req.query;
    if (!token) return res.json({ status: 'error', message: 'Brak tokenu.' });

    db.query(
      `SELECT login, expires_at, uzyty FROM Tokeny_reset_hasla WHERE token = ? LIMIT 1`,
      [token],
      (err, rows) => {
        if (err || !rows.length) return res.json({ status: 'error', message: 'Nieprawidłowy link.' });
        const t = rows[0];
        if (t.uzyty) return res.json({ status: 'error', message: 'Ten link został już wykorzystany.' });
        if (new Date(t.expires_at) < new Date()) return res.json({ status: 'error', message: 'Link wygasł. Poproś o nowy.' });
        return res.json({ status: 'ok', login: t.login });
      }
    );
  });

  // POST /reset-hasla/ustaw — ustaw nowe hasło
  router.post('/reset-hasla/ustaw', (req, res) => {
    const { token, nowe_haslo } = req.body;
    if (!token || !nowe_haslo || nowe_haslo.trim().length < 4) {
      return res.json({ status: 'error', message: 'Hasło musi mieć co najmniej 4 znaki.' });
    }

    db.query(
      `SELECT login, expires_at, uzyty FROM Tokeny_reset_hasla WHERE token = ? LIMIT 1`,
      [token],
      (err, rows) => {
        if (err || !rows.length) return res.json({ status: 'error', message: 'Nieprawidłowy link.' });
        const t = rows[0];
        if (t.uzyty) return res.json({ status: 'error', message: 'Ten link został już wykorzystany.' });
        if (new Date(t.expires_at) < new Date()) return res.json({ status: 'error', message: 'Link wygasł. Poproś o nowy.' });

        db.query(
          `UPDATE Licencje SET haslo = ? WHERE LOWER(TRIM(login)) = LOWER(TRIM(?))`,
          [nowe_haslo.trim(), t.login],
          (err2) => {
            if (err2) return res.json({ status: 'error', message: 'Błąd zapisu hasła.' });

            db.query(`UPDATE Tokeny_reset_hasla SET uzyty = 1 WHERE token = ?`, [token]);
            return res.json({ status: 'success', message: 'Hasło zostało zmienione. Możesz się teraz zalogować.' });
          }
        );
      }
    );
  });

  return router;
};
