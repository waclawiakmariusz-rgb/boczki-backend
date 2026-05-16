// routes/dokumenty_dodatkowe.js
// Dodatkowe dokumenty klienta (poza Regulaminem i RODO).
// Tabele:
//   - Typy_Dodatkowych_Dokumentow (GLOBALNA, bez tenant_id) — słownik typów
//   - Dokumenty_Dodatkowe_Klienta (per tenant) — instancje dokumentów klientów
// Endpointy:
//   GET  get_typy_dokumentow      — lista aktywnych typów (dropdown)
//   GET  get_dokumenty_klienta    — dokumenty danego klienta
//   POST add_typ_dokumentu        — dopisanie nowego typu do słownika
//   POST save_dokument_klienta    — upsert dokumentu (po unique tenant+klient+typ)
//   POST delete_dokument_klienta  — hard delete wpisu

const express = require('express');
const { randomUUID } = require('crypto');

module.exports = (db) => {
  const router = express.Router();

  // ─────────────────────────────────────────────
  // MIGRACJA (idempotentna — bezpiecznie przy każdym starcie)
  // ─────────────────────────────────────────────
  db.query(`
    CREATE TABLE IF NOT EXISTS Typy_Dodatkowych_Dokumentow (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      nazwa         VARCHAR(150) NOT NULL UNIQUE,
      aktywny       TINYINT(1)   NOT NULL DEFAULT 1,
      data_dodania  DATETIME     DEFAULT CURRENT_TIMESTAMP,
      kto_dodal     VARCHAR(100) DEFAULT 'system'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, (err) => {
    if (err) console.error('[migracja Typy_Dodatkowych_Dokumentow]', err.message);
    else {
      // Seed startowy — INSERT IGNORE pomija duplikaty po UNIQUE(nazwa)
      db.query(`
        INSERT IGNORE INTO Typy_Dodatkowych_Dokumentow (nazwa, kto_dodal) VALUES
          ('Zgoda na zabieg', 'seed'),
          ('Zgoda na fotografię (przed/po)', 'seed'),
          ('Karta lojalnościowa', 'seed'),
          ('Zgoda marketingowa', 'seed')
      `, (e) => { if (e) console.error('[seed Typy_Dodatkowych_Dokumentow]', e.message); });
    }
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS Dokumenty_Dodatkowe_Klienta (
      id             VARCHAR(36)  NOT NULL PRIMARY KEY,
      tenant_id      VARCHAR(64)  NOT NULL,
      id_klienta     VARCHAR(50)  NOT NULL,
      klient_nazwa   VARCHAR(200),
      typ_nazwa      VARCHAR(150) NOT NULL,
      link_pdf       VARCHAR(500),
      komentarz      TEXT,
      data_dodania   DATETIME     DEFAULT CURRENT_TIMESTAMP,
      pracownik      VARCHAR(100),
      UNIQUE KEY uniq_klient_typ (tenant_id, id_klienta, typ_nazwa),
      INDEX idx_klient (tenant_id, id_klienta),
      INDEX idx_typ (tenant_id, typ_nazwa)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, (err) => {
    if (err) console.error('[migracja Dokumenty_Dodatkowe_Klienta]', err.message);
  });

  // ─────────────────────────────────────────────
  // GET /dokumenty_dodatkowe
  // ─────────────────────────────────────────────
  router.get('/dokumenty_dodatkowe', (req, res) => {
    const action = req.query.action;
    const tenant_id = req.query.tenant_id;

    if (action === 'get_typy_dokumentow') {
      db.query(
        `SELECT id, nazwa FROM Typy_Dodatkowych_Dokumentow WHERE aktywny = 1 ORDER BY nazwa ASC`,
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message, typy: [] });
          return res.json({ status: 'success', typy: rows || [] });
        }
      );

    } else if (action === 'get_dokumenty_klienta') {
      if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id', dokumenty: [] });
      const id_klienta = req.query.id || req.query.id_klienta;
      if (!id_klienta) return res.json({ status: 'error', message: 'Brak id_klienta', dokumenty: [] });

      db.query(
        `SELECT id, typ_nazwa, link_pdf, komentarz, data_dodania, pracownik
         FROM Dokumenty_Dodatkowe_Klienta
         WHERE tenant_id = ? AND id_klienta = ?
         ORDER BY typ_nazwa ASC`,
        [tenant_id, String(id_klienta)],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message, dokumenty: [] });
          return res.json({ status: 'success', dokumenty: rows || [] });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET dokumenty_dodatkowe: ' + action });
    }
  });

  // ─────────────────────────────────────────────
  // POST /dokumenty_dodatkowe
  // ─────────────────────────────────────────────
  router.post('/dokumenty_dodatkowe', (req, res) => {
    const d = req.body || {};
    const action = d.action;
    const tenant_id = d.tenant_id;

    if (action === 'add_typ_dokumentu') {
      const nazwa = String(d.nazwa || '').trim();
      if (!nazwa) return res.json({ status: 'error', message: 'Brak nazwy typu' });
      if (nazwa.length > 150) return res.json({ status: 'error', message: 'Nazwa za długa (max 150 znaków)' });

      // INSERT IGNORE — jeśli typ już istnieje (po UNIQUE), nie ma błędu, zwracamy listę
      db.query(
        `INSERT IGNORE INTO Typy_Dodatkowych_Dokumentow (nazwa, kto_dodal) VALUES (?, ?)`,
        [nazwa, String(d.pracownik || 'recepcja')],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          // Jeśli typ był nieaktywny (kiedyś dezaktywowany) — przywróć
          db.query(
            `UPDATE Typy_Dodatkowych_Dokumentow SET aktywny = 1 WHERE nazwa = ?`,
            [nazwa],
            (e2) => {
              if (e2) console.error('[add_typ_dokumentu reactivate]', e2.message);
              // Zwracamy zaktualizowaną listę
              db.query(
                `SELECT id, nazwa FROM Typy_Dodatkowych_Dokumentow WHERE aktywny = 1 ORDER BY nazwa ASC`,
                (e3, rows) => {
                  if (e3) return res.json({ status: 'error', message: e3.message });
                  return res.json({ status: 'success', message: 'Dodano typ', typy: rows || [] });
                }
              );
            }
          );
        }
      );

    } else if (action === 'save_dokument_klienta') {
      if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
      const id_klienta = String(d.id_klienta || '').trim();
      const typ_nazwa  = String(d.typ_nazwa || '').trim();
      const link_pdf   = String(d.link_pdf || '').trim();
      if (!id_klienta) return res.json({ status: 'error', message: 'Brak id_klienta' });
      if (!typ_nazwa)  return res.json({ status: 'error', message: 'Brak typu dokumentu' });
      if (!link_pdf)   return res.json({ status: 'error', message: 'Brak pliku PDF — wyślij zdjęcia przed zapisem.' });

      const klient_nazwa = String(d.klient_nazwa || '').trim();
      const komentarz    = String(d.komentarz || '').trim();
      const pracownik    = String(d.pracownik || '').trim();

      // Upsert po UNIQUE (tenant_id, id_klienta, typ_nazwa)
      // Sprawdź czy istnieje
      db.query(
        `SELECT id FROM Dokumenty_Dodatkowe_Klienta
         WHERE tenant_id = ? AND id_klienta = ? AND typ_nazwa = ? LIMIT 1`,
        [tenant_id, id_klienta, typ_nazwa],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });

          if (rows && rows.length > 0) {
            // UPDATE — nadpisanie najnowszą wersją (zgodnie z założeniem "po jednym tego samego typu")
            db.query(
              `UPDATE Dokumenty_Dodatkowe_Klienta
               SET link_pdf = ?, komentarz = ?, data_dodania = NOW(), pracownik = ?, klient_nazwa = ?
               WHERE id = ?`,
              [link_pdf, komentarz, pracownik, klient_nazwa, rows[0].id],
              (e2) => {
                if (e2) return res.json({ status: 'error', message: e2.message });
                return res.json({ status: 'success', message: 'Zaktualizowano dokument', id: rows[0].id });
              }
            );
          } else {
            // INSERT
            const id = randomUUID();
            db.query(
              `INSERT INTO Dokumenty_Dodatkowe_Klienta
               (id, tenant_id, id_klienta, klient_nazwa, typ_nazwa, link_pdf, komentarz, pracownik)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, tenant_id, id_klienta, klient_nazwa, typ_nazwa, link_pdf, komentarz, pracownik],
              (e2) => {
                if (e2) return res.json({ status: 'error', message: e2.message });
                return res.json({ status: 'success', message: 'Dodano dokument', id });
              }
            );
          }
        }
      );

    } else if (action === 'delete_dokument_klienta') {
      if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
      const id = String(d.id || '').trim();
      if (!id) return res.json({ status: 'error', message: 'Brak id dokumentu' });

      db.query(
        `DELETE FROM Dokumenty_Dodatkowe_Klienta WHERE tenant_id = ? AND id = ?`,
        [tenant_id, id],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result || result.affectedRows === 0) {
            return res.json({ status: 'error', message: 'Nie znaleziono dokumentu' });
          }
          return res.json({ status: 'success', message: 'Usunięto dokument' });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja POST dokumenty_dodatkowe: ' + action });
    }
  });

  return router;
};
