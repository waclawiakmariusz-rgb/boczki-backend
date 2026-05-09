'use strict';
// routes/typy_zabiegow.js
// Zarządzanie TYPAMI ZABIEGÓW per tenant (twarz, ciało, epilacja laserowa,
// medycyna estetyczna, stylizacja paznokci, podologia, masaże + własne).
// Tabela: Typy_Zabiegow(id, tenant_id, nazwa, ikona, kolor, kolejnosc, created_at)
//
// Dwie powiązane kolumny dodawane idempotentnie do istniejących tabel:
//   - Uslugi.typ_zabiegu       VARCHAR(80)  — typ przypisany do wariantu w cenniku
//   - Sprzedaz.typ_zabiegu     VARCHAR(80)  — snapshot typu przy zapisie sprzedaży
//
// Snapshot to świadoma decyzja (opcja B w rozmowie 2026-05-04): historia
// zostaje zamrożona. Zmiana typu w cenniku nie zmienia historycznych
// rekordów. Migracja jednorazowa wypełnia kolumny dla danych sprzed tej daty.

const express = require('express');
// Walidacja sesji odbywa się w globalnym middleware (server.js). Tutaj tylko sanity tenant_id.

const DEFAULT_TYPY = [
  { nazwa: 'twarz',                ikona: '💆‍♀️', kolor: '#ec4899', kolejnosc: 1 },
  { nazwa: 'ciało',                ikona: '🧘‍♀️', kolor: '#3b82f6', kolejnosc: 2 },
  { nazwa: 'epilacja laserowa',    ikona: '✨',   kolor: '#f59e0b', kolejnosc: 3 },
  { nazwa: 'medycyna estetyczna',  ikona: '💉',   kolor: '#ef4444', kolejnosc: 4 },
  { nazwa: 'stylizacja paznokci',  ikona: '💅',   kolor: '#a855f7', kolejnosc: 5 },
  { nazwa: 'podologia',            ikona: '🦶',   kolor: '#14b8a6', kolejnosc: 6 },
  { nazwa: 'masaże',               ikona: '👐',   kolor: '#84cc16', kolejnosc: 7 },
];

// Soft auth — wymagamy tylko tenant_id (jak inne endpointy CRUD typu add_sales_def
// itd.). Twarda walidacja sesji odbywa się w globalnym middleware w server.js
// gdy ENFORCE_SESSION=true. Tutaj tylko sanity check że tenant_id istnieje.
function auth(req, res) {
  const tenant_id = req.query.tenant_id || req.body?.tenant_id;
  if (!tenant_id) {
    res.status(400).json({ status: 'error', message: 'Brak tenant_id.' });
    return null;
  }
  return tenant_id;
}

// ─── Setup schematu — idempotentne ALTER + CREATE ─────────────────────────
function setupSchema(db) {
  // 1. Tabela typów per tenant
  db.query(
    `CREATE TABLE IF NOT EXISTS Typy_Zabiegow (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id   VARCHAR(100) NOT NULL,
      nazwa       VARCHAR(80)  NOT NULL,
      ikona       VARCHAR(20)  DEFAULT '',
      kolor       VARCHAR(20)  DEFAULT '#64748b',
      kolejnosc   INT          DEFAULT 0,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_tenant_nazwa (tenant_id, nazwa)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    (err) => {
      if (err) console.error('[typy_zabiegow] CREATE TABLE error:', err.message);
    }
  );

  // 2. Kolumna typ_zabiegu w Uslugi (cennik salonu)
  db.query(
    `ALTER TABLE Uslugi ADD COLUMN IF NOT EXISTS typ_zabiegu VARCHAR(80) NULL`,
    (err) => {
      if (err && !/Duplicate column/i.test(err.message)) {
        console.error('[typy_zabiegow] ALTER Uslugi error:', err.message);
      }
    }
  );

  // 3. Kolumna typ_zabiegu w Sprzedaz (snapshot historii)
  db.query(
    `ALTER TABLE Sprzedaz ADD COLUMN IF NOT EXISTS typ_zabiegu VARCHAR(80) NULL`,
    (err) => {
      if (err && !/Duplicate column/i.test(err.message)) {
        console.error('[typy_zabiegow] ALTER Sprzedaz error:', err.message);
      }
    }
  );
}

// Lazy seed — przy pierwszym GET dla tenanta dosypujemy 7 default typów,
// jeśli jeszcze ich nie ma. INSERT IGNORE używa UNIQUE KEY (tenant_id, nazwa).
function seedDefaultsIfMissing(db, tenant_id, cb) {
  db.query(
    `SELECT COUNT(*) AS cnt FROM Typy_Zabiegow WHERE tenant_id = ?`,
    [tenant_id],
    (err, rows) => {
      if (err) return cb(err);
      if (rows[0].cnt > 0) return cb(null); // już zaseedowane (lub user dodał własne)

      const values = DEFAULT_TYPY.map(t => [tenant_id, t.nazwa, t.ikona, t.kolor, t.kolejnosc]);
      db.query(
        `INSERT IGNORE INTO Typy_Zabiegow (tenant_id, nazwa, ikona, kolor, kolejnosc) VALUES ?`,
        [values],
        (err2) => cb(err2 || null)
      );
    }
  );
}

module.exports = (db) => {
  setupSchema(db);
  const router = express.Router();

  // ─── GET /api/typy-zabiegow — lista typów dla tenanta ─────────────
  router.get('/typy-zabiegow', (req, res) => {
    const tenant_id = auth(req, res);
    if (!tenant_id) return;

    seedDefaultsIfMissing(db, tenant_id, (err) => {
      if (err) return res.json({ status: 'error', message: 'Błąd seed: ' + err.message });
      db.query(
        `SELECT id, nazwa, ikona, kolor, kolejnosc
         FROM Typy_Zabiegow
         WHERE tenant_id = ?
         ORDER BY kolejnosc, id`,
        [tenant_id],
        (err2, rows) => {
          if (err2) return res.json({ status: 'error', message: 'Błąd bazy: ' + err2.message });
          res.json({ status: 'ok', data: rows || [] });
        }
      );
    });
  });

  // ─── POST /api/typy-zabiegow — dodaj nowy typ ──────────────────────
  router.post('/typy-zabiegow', (req, res) => {
    const tenant_id = auth(req, res);
    if (!tenant_id) return;

    const nazwa     = String(req.body.nazwa || '').trim().toLowerCase();
    const ikona     = String(req.body.ikona || '').trim().slice(0, 20);
    const kolor     = String(req.body.kolor || '#64748b').trim().slice(0, 20);
    const kolejnosc = parseInt(req.body.kolejnosc, 10) || 99;

    if (!nazwa || nazwa.length > 80) {
      return res.json({ status: 'error', message: 'Nazwa wymagana, max 80 znaków.' });
    }

    db.query(
      `INSERT INTO Typy_Zabiegow (tenant_id, nazwa, ikona, kolor, kolejnosc) VALUES (?, ?, ?, ?, ?)`,
      [tenant_id, nazwa, ikona, kolor, kolejnosc],
      (err, result) => {
        if (err) {
          if (/Duplicate entry/i.test(err.message)) {
            return res.json({ status: 'error', message: 'Typ o tej nazwie już istnieje.' });
          }
          return res.json({ status: 'error', message: 'Błąd zapisu: ' + err.message });
        }
        res.json({ status: 'ok', id: result.insertId });
      }
    );
  });

  // ─── PUT /api/typy-zabiegow/:id — edytuj nazwę/ikonę/kolor/kolejność ─
  router.put('/typy-zabiegow/:id', (req, res) => {
    const tenant_id = auth(req, res);
    if (!tenant_id) return;

    const id = parseInt(req.params.id, 10);
    if (!id) return res.json({ status: 'error', message: 'Nieprawidłowe id.' });

    const fields = [];
    const vals   = [];
    if (req.body.nazwa !== undefined) {
      const n = String(req.body.nazwa).trim().toLowerCase();
      if (!n || n.length > 80) return res.json({ status: 'error', message: 'Nazwa max 80 znaków.' });
      fields.push('nazwa = ?');     vals.push(n);
    }
    if (req.body.ikona !== undefined)     { fields.push('ikona = ?');     vals.push(String(req.body.ikona).slice(0, 20)); }
    if (req.body.kolor !== undefined)     { fields.push('kolor = ?');     vals.push(String(req.body.kolor).slice(0, 20)); }
    if (req.body.kolejnosc !== undefined) { fields.push('kolejnosc = ?'); vals.push(parseInt(req.body.kolejnosc, 10) || 0); }

    if (!fields.length) return res.json({ status: 'error', message: 'Brak danych do aktualizacji.' });

    // Najpierw pobierz starą nazwę — jeśli zmieniamy nazwę typu, musimy też
    // zaktualizować Uslugi.typ_zabiegu i Sprzedaz.typ_zabiegu (snapshot)
    db.query(
      `SELECT nazwa FROM Typy_Zabiegow WHERE id = ? AND tenant_id = ?`,
      [id, tenant_id],
      (errSel, rows) => {
        if (errSel) return res.json({ status: 'error', message: 'Błąd bazy: ' + errSel.message });
        if (!rows.length) return res.json({ status: 'error', message: 'Nie znaleziono typu.' });
        const oldNazwa = rows[0].nazwa;

        vals.push(id, tenant_id);
        db.query(
          `UPDATE Typy_Zabiegow SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`,
          vals,
          (err, result) => {
            if (err) {
              if (/Duplicate entry/i.test(err.message)) {
                return res.json({ status: 'error', message: 'Typ o tej nazwie już istnieje.' });
              }
              return res.json({ status: 'error', message: 'Błąd zapisu: ' + err.message });
            }
            if (result.affectedRows === 0) return res.json({ status: 'error', message: 'Nie znaleziono typu.' });

            const newNazwa = req.body.nazwa !== undefined ? String(req.body.nazwa).trim().toLowerCase() : null;
            if (!newNazwa || newNazwa === oldNazwa) {
              return res.json({ status: 'ok' });
            }
            // Cascading rename — Uslugi i Sprzedaz dla snapshotów
            db.query(
              `UPDATE Uslugi SET typ_zabiegu = ? WHERE tenant_id = ? AND typ_zabiegu = ?`,
              [newNazwa, tenant_id, oldNazwa],
              () => {
                db.query(
                  `UPDATE Sprzedaz SET typ_zabiegu = ? WHERE tenant_id = ? AND typ_zabiegu = ?`,
                  [newNazwa, tenant_id, oldNazwa],
                  () => res.json({ status: 'ok' })
                );
              }
            );
          }
        );
      }
    );
  });

  // ─── DELETE /api/typy-zabiegow/:id — usuń typ (jeśli nieużywany) ─────
  router.delete('/typy-zabiegow/:id', (req, res) => {
    const tenant_id = auth(req, res);
    if (!tenant_id) return;

    const id = parseInt(req.params.id, 10);
    if (!id) return res.json({ status: 'error', message: 'Nieprawidłowe id.' });

    db.query(
      `SELECT nazwa FROM Typy_Zabiegow WHERE id = ? AND tenant_id = ?`,
      [id, tenant_id],
      (err, rows) => {
        if (err) return res.json({ status: 'error', message: 'Błąd bazy: ' + err.message });
        if (!rows.length) return res.json({ status: 'error', message: 'Nie znaleziono typu.' });
        const nazwa = rows[0].nazwa;

        // Sprawdź czy typ jest w użyciu — odmów jeśli tak
        db.query(
          `SELECT COUNT(*) AS cnt FROM Uslugi WHERE tenant_id = ? AND typ_zabiegu = ?`,
          [tenant_id, nazwa],
          (err2, cntRows) => {
            if (err2) return res.json({ status: 'error', message: 'Błąd bazy: ' + err2.message });
            if (cntRows[0].cnt > 0) {
              return res.json({
                status: 'error',
                message: `Typ „${nazwa}" jest przypisany do ${cntRows[0].cnt} zabiegów w cenniku. Najpierw zmień im typ.`
              });
            }
            db.query(
              `DELETE FROM Typy_Zabiegow WHERE id = ? AND tenant_id = ?`,
              [id, tenant_id],
              (err3) => {
                if (err3) return res.json({ status: 'error', message: 'Błąd usunięcia: ' + err3.message });
                res.json({ status: 'ok' });
              }
            );
          }
        );
      }
    );
  });

  return router;
};
