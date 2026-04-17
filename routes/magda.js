// routes/magda.js
// Panel rozliczeń dla wirtualnej asystentki Magdy — tylko salon Boczki na bok
// Dodaje kolumnę czy_rozliczone do Sprzedaz i Zadatki przy starcie serwera.

const express = require('express');
const { createHmac } = require('crypto');

const TENANT_ID   = 'boczki-salon-glowny-001';
const MAGDA_HASLO = () => (process.env.MAGDA_HASLO || '').replace(/^['"]|['"]$/g, '');
const SESJA_TTL_MS = 12 * 60 * 60 * 1000; // 12 godzin

// Stateless HMAC token — przeżywa restarty serwera
// Format: "<timestamp>.<hmac-sha256>"
function stworzToken() {
  const ts = Date.now().toString();
  const sig = createHmac('sha256', MAGDA_HASLO()).update(ts).digest('hex');
  return `${ts}.${sig}`;
}

function weryfikujSesje(token) {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (Date.now() - Number(ts) > SESJA_TTL_MS) return false;
  const expected = createHmac('sha256', MAGDA_HASLO()).update(ts).digest('hex');
  return sig === expected;
}

function requireMagda(req, res, next) {
  const token = req.headers['x-magda-token'] || req.query.magda_token;
  if (!weryfikujSesje(token)) {
    return res.status(401).json({ status: 'error', message: 'Brak dostępu. Zaloguj się.' });
  }
  next();
}

module.exports = (db) => {
  const router = express.Router();

  // ── Dodaj kolumny czy_rozliczone przy starcie ──────────────
  const alter = (tabela) => {
    db.query(
      `ALTER TABLE \`${tabela}\` ADD COLUMN czy_rozliczone TINYINT NOT NULL DEFAULT 0`,
      (err) => {
        if (err && err.code !== 'ER_DUP_FIELDNAME') {
          console.error(`[magda] ALTER TABLE ${tabela}:`, err.message);
        }
      }
    );
  };
  alter('Sprzedaz');
  alter('Zadatki');

  // ── POST /api/magda/login ──────────────────────────────────
  router.post('/magda/login', (req, res) => {
    const { haslo } = req.body;
    if (!haslo || !MAGDA_HASLO()) {
      return res.json({ status: 'error', message: 'Panel Magdy nie jest skonfigurowany (brak MAGDA_HASLO w .env).' });
    }
    if (haslo.trim() !== MAGDA_HASLO()) {
      return res.json({ status: 'error', message: 'Błędne hasło.' });
    }
    const token = stworzToken();
    return res.json({ status: 'success', token });
  });

  // ── GET /api/magda/sprzedaz?od=YYYY-MM-DD&do=YYYY-MM-DD ───
  router.get('/magda/sprzedaz', requireMagda, (req, res) => {
    const { od, do: _do } = req.query;
    if (!od || !_do) return res.json({ status: 'error', message: 'Podaj zakres dat (od, do).' });

    db.query(
      `SELECT id, data_sprzedazy, klient, id_klienta, zabieg, sprzedawca,
              kwota, komentarz, szczegoly, platnosc, status, czy_rozliczone
       FROM Sprzedaz
       WHERE tenant_id = ?
         AND DATE(data_sprzedazy) BETWEEN ? AND ?
         AND COALESCE(status, '') != 'USUNIĘTY'
       ORDER BY data_sprzedazy DESC`,
      [TENANT_ID, od, _do],
      (err, rows) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success', rows: rows || [] });
      }
    );
  });

  // ── GET /api/magda/zadatki?od=YYYY-MM-DD&do=YYYY-MM-DD ────
  router.get('/magda/zadatki', requireMagda, (req, res) => {
    const { od, do: _do } = req.query;
    if (!od || !_do) return res.json({ status: 'error', message: 'Podaj zakres dat (od, do).' });

    db.query(
      `SELECT id, id_klienta, data_wplaty, klient, typ, kwota,
              metoda, cel, status, pracownicy, czy_rozliczone
       FROM Zadatki
       WHERE tenant_id = ?
         AND DATE(data_wplaty) BETWEEN ? AND ?
       ORDER BY data_wplaty DESC`,
      [TENANT_ID, od, _do],
      (err, rows) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success', rows: rows || [] });
      }
    );
  });

  // ── POST /api/magda/rozlicz ────────────────────────────────
  // Body: { tabela: 'sprzedaz'|'zadatki', id, czy_rozliczone: 0|1 }
  router.post('/magda/rozlicz', requireMagda, (req, res) => {
    const { tabela, id, czy_rozliczone } = req.body;
    if (!tabela || !id || czy_rozliczone === undefined) {
      return res.json({ status: 'error', message: 'Brak wymaganych pól.' });
    }
    if (!['sprzedaz', 'zadatki'].includes(tabela)) {
      return res.json({ status: 'error', message: 'Nieprawidłowa tabela.' });
    }
    const nazwaTabeli = tabela === 'sprzedaz' ? 'Sprzedaz' : 'Zadatki';
    const wartosc = czy_rozliczone ? 1 : 0;

    db.query(
      `UPDATE \`${nazwaTabeli}\` SET czy_rozliczone = ? WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [wartosc, id, TENANT_ID],
      (err, result) => {
        if (err) return res.json({ status: 'error', message: err.message });
        if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono rekordu.' });
        return res.json({ status: 'success', czy_rozliczone: wartosc });
      }
    );
  });

  return router;
};
