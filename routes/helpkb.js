// routes/helpkb.js
// Zarządzanie bazą wiedzy chatu pomocy (help_kb)
// Tabela: help_kb(id, tenant_id, keywords, answer, category, active, created_at)
// tenant_id = '__global__' → wpisy globalne zarządzane przez admina (endpointy w admin.js)

const express = require('express');
const router = express.Router();
const { validateTenantAccess } = require('./sessions');

const VALID_CATEGORIES = ['Ogólne','Magazyn','Klienci','Sprzedaż','Pracownicy','Usługi','Analityka','Vouchery','Ustawienia'];

// Tworzy tabelę i dodaje kolumnę category jeśli nie istnieje (idempotentne)
function ensureTable(db, cb) {
  db.query(
    `CREATE TABLE IF NOT EXISTS help_kb (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id   VARCHAR(100) NOT NULL,
      keywords    TEXT NOT NULL,
      answer      TEXT NOT NULL,
      category    VARCHAR(50) NOT NULL DEFAULT 'Ogólne',
      active      TINYINT(1) NOT NULL DEFAULT 1,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    () => {
      // Dodaj kolumnę category do istniejących tabel (MySQL 8+ obsługuje IF NOT EXISTS)
      db.query(
        `ALTER TABLE help_kb ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'Ogólne'`,
        () => cb && cb()
      );
    }
  );
}

function auth(req, res) {
  const tenant_id = req.query.tenant_id || req.body?.tenant_id;
  const token     = req.query.session_token || req.body?.session_token ||
                    req.headers['x-session-token'];
  if (!tenant_id || !token) {
    res.status(401).json({ status: 'error', message: 'Brak autoryzacji.' });
    return null;
  }
  const v = validateTenantAccess(token, tenant_id);
  if (!v.valid) {
    res.status(401).json({ status: 'error', message: 'Sesja wygasła.' });
    return null;
  }
  return tenant_id;
}

function safeCategory(cat) {
  return VALID_CATEGORIES.includes(cat) ? cat : 'Ogólne';
}

module.exports = (db) => {

  // ── GET /api/help-kb/global — publiczny odczyt globalnej KB (bez auth) ──
  router.get('/help-kb/global', (req, res) => {
    ensureTable(db, () => {
      db.query(
        `SELECT keywords, answer, category FROM help_kb WHERE tenant_id = '__global__' AND active = 1 ORDER BY id DESC`,
        (err, rows) => {
          if (err) return res.json([]);
          res.json(rows || []);
        }
      );
    });
  });

  // ── GET /api/help-kb — pobierz wszystkie wpisy tenanta ──────
  router.get('/help-kb', (req, res) => {
    const tenant_id = auth(req, res);
    if (!tenant_id) return;

    ensureTable(db, (err) => {
      if (err) return res.json({ status: 'error', message: 'Błąd bazy.' });
      db.query(
        `SELECT id, keywords, answer, category, active, created_at
         FROM help_kb WHERE tenant_id = ? ORDER BY category, id DESC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: 'Błąd bazy.' });
          res.json({ status: 'ok', data: rows || [] });
        }
      );
    });
  });

  // ── POST /api/help-kb — dodaj nowy wpis ──────────────────────
  router.post('/help-kb', (req, res) => {
    const tenant_id = auth(req, res);
    if (!tenant_id) return;

    const { keywords, answer, category } = req.body;
    if (!keywords || !answer || !String(keywords).trim() || !String(answer).trim()) {
      return res.json({ status: 'error', message: 'Uzupełnij słowa kluczowe i odpowiedź.' });
    }

    ensureTable(db, (err) => {
      if (err) return res.json({ status: 'error', message: 'Błąd bazy.' });
      db.query(
        `INSERT INTO help_kb (tenant_id, keywords, answer, category) VALUES (?, ?, ?, ?)`,
        [tenant_id, String(keywords).trim(), String(answer).trim(), safeCategory(category)],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: 'Błąd zapisu.' });
          res.json({ status: 'ok', id: result.insertId });
        }
      );
    });
  });

  // ── PUT /api/help-kb/:id — zaktualizuj wpis ───────────────────
  router.put('/help-kb/:id', (req, res) => {
    const tenant_id = auth(req, res);
    if (!tenant_id) return;

    const id = parseInt(req.params.id, 10);
    const { keywords, answer, active, category } = req.body;
    if (!id) return res.json({ status: 'error', message: 'Nieprawidłowe id.' });

    const fields = [];
    const vals   = [];
    if (keywords !== undefined) { fields.push('keywords = ?');  vals.push(String(keywords).trim()); }
    if (answer   !== undefined) { fields.push('answer = ?');    vals.push(String(answer).trim());   }
    if (active   !== undefined) { fields.push('active = ?');    vals.push(active ? 1 : 0);          }
    if (category !== undefined) { fields.push('category = ?');  vals.push(safeCategory(category));  }
    if (!fields.length) return res.json({ status: 'error', message: 'Brak danych do aktualizacji.' });

    vals.push(id, tenant_id);
    db.query(
      `UPDATE help_kb SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`,
      vals,
      (err, result) => {
        if (err) return res.json({ status: 'error', message: 'Błąd zapisu.' });
        if (result.affectedRows === 0) return res.json({ status: 'error', message: 'Nie znaleziono wpisu.' });
        res.json({ status: 'ok' });
      }
    );
  });

  // ── DELETE /api/help-kb/:id — usuń wpis ──────────────────────
  router.delete('/help-kb/:id', (req, res) => {
    const tenant_id = auth(req, res);
    if (!tenant_id) return;

    const id = parseInt(req.params.id, 10);
    if (!id) return res.json({ status: 'error', message: 'Nieprawidłowe id.' });

    db.query(
      `DELETE FROM help_kb WHERE id = ? AND tenant_id = ?`,
      [id, tenant_id],
      (err, result) => {
        if (err) return res.json({ status: 'error', message: 'Błąd usunięcia.' });
        if (result.affectedRows === 0) return res.json({ status: 'error', message: 'Nie znaleziono wpisu.' });
        res.json({ status: 'ok' });
      }
    );
  });

  return router;
};
