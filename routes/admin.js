// routes/admin.js
// Panel Administratora - zarządzanie salonami/tenantami

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');

// ─── Pomocnicze ──────────────────────────────────────────────
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // usuń akcenty
    .replace(/ł/g, 'l').replace(/ą/g, 'a').replace(/ę/g, 'e')
    .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z')
    .replace(/ż/g, 'z').replace(/ć/g, 'c').replace(/ń/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Middleware: weryfikacja tokenu admina ────────────────────
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'boczki-admin-2026';

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.body?.admin_token || req.query?.admin_token;
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(403).json({ status: 'error', message: 'Brak dostępu.' });
  }
  next();
}

module.exports = (db) => {

  // POST /api/admin/login — weryfikacja hasła admina
  router.post('/admin/login', (req, res) => {
    const { haslo } = req.body;
    if (!haslo) return res.json({ status: 'error', message: 'Podaj hasło.' });
    if (haslo === ADMIN_TOKEN) {
      return res.json({ status: 'success', token: ADMIN_TOKEN });
    }
    return res.json({ status: 'error', message: 'Błędne hasło administratora.' });
  });

  // GET /api/admin/salony — lista wszystkich salonów
  router.get('/admin/salony', requireAdmin, (req, res) => {
    db.query(
      `SELECT id, login, rola, id_bazy, status, data_waznosci, nazwa_salonu, miasto, telefon, email, data_utworzenia
       FROM Licencje ORDER BY data_utworzenia DESC`,
      (err, rows) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json(rows || []);
      }
    );
  });

  // POST /api/admin/create_tenant — tworzenie nowego salonu
  router.post('/admin/create_tenant', requireAdmin, (req, res) => {
    const d = req.body;
    const { nazwa_salonu, miasto, telefon, email, login, haslo, data_waznosci, pracownicy, uslugi } = d;

    if (!nazwa_salonu || !login || !haslo) {
      return res.json({ status: 'error', message: 'Podaj nazwę salonu, login i hasło.' });
    }

    // Generuj unikalny tenant_id
    const slug = slugify(nazwa_salonu);
    const suffix = Date.now().toString().slice(-4);
    const tenant_id = `${slug}-${suffix}`;
    const licId = randomUUID();

    // 1. Utwórz licencję
    db.query(
      `INSERT INTO Licencje (id, login, haslo, rola, id_bazy, status, data_waznosci, nazwa_salonu, miasto, telefon, email, data_utworzenia)
       VALUES (?, ?, ?, 'salon', ?, 'aktywny', ?, ?, ?, ?, ?, NOW())`,
      [licId, login.trim(), haslo.trim(), tenant_id, data_waznosci || null, nazwa_salonu, miasto || '', telefon || '', email || ''],
      (err) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') return res.json({ status: 'error', message: 'Login już istnieje!' });
          return res.json({ status: 'error', message: 'Błąd tworzenia licencji: ' + err.message });
        }

        // 2. Dodaj pracowników i PIN-y do Użytkownicy
        const pracList = Array.isArray(pracownicy) ? pracownicy : [];
        const pObietnice = pracList
          .filter(p => p.imie && p.imie.trim())
          .map(p => new Promise((resolve) => {
            const pid = randomUUID();
            db.query(
              `INSERT INTO Użytkownicy (id, tenant_id, imie_login, haslo_pin, rola) VALUES (?, ?, ?, ?, ?)`,
              [pid, tenant_id, p.imie.trim(), p.pin || '0000', p.rola || 'pracownik'],
              () => {
                // Też do Pracownicy (dla sprzedaży)
                const prid = randomUUID();
                db.query(
                  `INSERT INTO Pracownicy (id, tenant_id, imie) VALUES (?, ?, ?)`,
                  [prid, tenant_id, p.imie.trim()],
                  () => resolve()
                );
              }
            );
          }));

        // 3. Dodaj usługi
        const uslugiList = Array.isArray(uslugi) ? uslugi : [];
        const uObietnice = uslugiList
          .filter(u => u.kategoria && u.wariant)
          .map(u => new Promise((resolve) => {
            const uid = randomUUID();
            db.query(
              `INSERT INTO Uslugi (id, tenant_id, kategoria, wariant, cena) VALUES (?, ?, ?, ?, ?)`,
              [uid, tenant_id, u.kategoria.trim(), u.wariant.trim(), parseFloat(u.cena) || 0],
              () => resolve()
            );
          }));

        Promise.all([...pObietnice, ...uObietnice]).then(() => {
          return res.json({
            status: 'success',
            message: `Salon "${nazwa_salonu}" został utworzony!`,
            tenant_id
          });
        });
      }
    );
  });

  // POST /api/admin/update_tenant — edycja salonu
  router.post('/admin/update_tenant', requireAdmin, (req, res) => {
    const d = req.body;
    if (!d.id_bazy) return res.json({ status: 'error', message: 'Brak tenant_id' });

    db.query(
      `UPDATE Licencje SET nazwa_salonu=?, miasto=?, telefon=?, email=?, data_waznosci=?, status=?
       WHERE id_bazy=? LIMIT 1`,
      [d.nazwa_salonu, d.miasto || '', d.telefon || '', d.email || '', d.data_waznosci || null, d.status || 'aktywny', d.id_bazy],
      (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success', message: 'Zaktualizowano dane salonu.' });
      }
    );
  });

  // POST /api/admin/toggle_tenant — blokowanie/odblokowywanie
  router.post('/admin/toggle_tenant', requireAdmin, (req, res) => {
    const { id_bazy, status } = req.body;
    if (!id_bazy) return res.json({ status: 'error', message: 'Brak tenant_id' });

    db.query(
      `UPDATE Licencje SET status=? WHERE id_bazy=? LIMIT 1`,
      [status, id_bazy],
      (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success' });
      }
    );
  });

  return router;
};
