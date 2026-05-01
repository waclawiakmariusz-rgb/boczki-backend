// routes/zadania.js
// Zadania od managera dla zespołu — lista, CRUD, archiwum
// POST /api/zadania { action: 'list' | 'add' | 'edit' | 'complete' | 'archive' | 'restore' | 'delete' }

const express = require('express');
const { randomUUID } = require('crypto');

module.exports = (db) => {
  const router = express.Router();

  const ALLOWED_KATEGORIE = ['MAGAZYN','KOSMETYK','KLIENT','SPRZEDAZ','INNE'];
  const ALLOWED_PRIORYTETY = ['NORMALNY','WAZNY','PILNY'];

  // Auto-tworzenie tabeli przy starcie modułu + idempotentna migracja kolumn
  db.query(
    `CREATE TABLE IF NOT EXISTS Zadania (
       id VARCHAR(36) PRIMARY KEY,
       tenant_id VARCHAR(64) NOT NULL,
       data_utworzenia DATETIME DEFAULT CURRENT_TIMESTAMP,
       utworzone_przez VARCHAR(100),
       przypisane_do VARCHAR(100),
       tytul VARCHAR(255) NOT NULL,
       opis TEXT,
       kategoria ENUM('MAGAZYN','KOSMETYK','KLIENT','SPRZEDAZ','INNE') DEFAULT 'INNE',
       priorytet ENUM('NORMALNY','WAZNY','PILNY') DEFAULT 'NORMALNY',
       deadline DATETIME,
       status ENUM('AKTYWNE','WYKONANE','ZARCHIWIZOWANE') DEFAULT 'AKTYWNE',
       data_wykonania DATETIME NULL,
       wykonane_przez VARCHAR(100),
       data_archiwizacji DATETIME NULL,
       kto_zarchiwizowal VARCHAR(100),
       id_klienta VARCHAR(36) NULL,
       klient_nazwa VARCHAR(200) NULL,
       INDEX idx_tenant_status (tenant_id, status),
       INDEX idx_przypisane (tenant_id, przypisane_do, status),
       INDEX idx_klient (tenant_id, id_klienta)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    (err) => {
      if (err) { console.error('[Zadania] CREATE TABLE error:', err.message); return; }
      // Migracja dla istniejących baz — dodaj kolumny jeśli brakuje
      const safeAlter = (sql, label) => db.query(sql, (e) => {
        if (e && !/Duplicate column|Duplicate key/i.test(e.message)) console.error('[Zadania] migrate ' + label + ':', e.message);
      });
      safeAlter(`ALTER TABLE Zadania ADD COLUMN kategoria ENUM('MAGAZYN','KOSMETYK','KLIENT','SPRZEDAZ','INNE') DEFAULT 'INNE'`, 'kategoria');
      safeAlter(`ALTER TABLE Zadania ADD COLUMN priorytet ENUM('NORMALNY','WAZNY','PILNY') DEFAULT 'NORMALNY'`, 'priorytet');
      safeAlter(`ALTER TABLE Zadania ADD COLUMN id_klienta VARCHAR(36) NULL`, 'id_klienta');
      safeAlter(`ALTER TABLE Zadania ADD COLUMN klient_nazwa VARCHAR(200) NULL`, 'klient_nazwa');
      safeAlter(`ALTER TABLE Zadania ADD INDEX idx_klient (tenant_id, id_klienta)`, 'idx_klient');
    }
  );

  router.post('/zadania', (req, res) => {
    const d = req.body || {};
    const tenant_id = d.tenant_id;
    const action = d.action;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    if (!action) return res.json({ status: 'error', message: 'Brak action' });

    if (action === 'list') {
      const status = d.status; // AKTYWNE | WYKONANE | ZARCHIWIZOWANE | undefined (wszystkie)
      const kategoria = d.kategoria;
      const params = [tenant_id];
      let sql = `SELECT id, data_utworzenia, utworzone_przez, przypisane_do, tytul, opis,
                        kategoria, priorytet, deadline, status,
                        data_wykonania, wykonane_przez, data_archiwizacji, kto_zarchiwizowal,
                        id_klienta, klient_nazwa
                 FROM Zadania WHERE tenant_id = ?`;
      if (status && ['AKTYWNE','WYKONANE','ZARCHIWIZOWANE'].includes(status)) {
        sql += ` AND status = ?`;
        params.push(status);
      }
      if (kategoria && ALLOWED_KATEGORIE.includes(kategoria)) {
        sql += ` AND kategoria = ?`;
        params.push(kategoria);
      }
      // PILNY → najpierw, potem WAŻNY, potem NORMALNY; w obrębie priorytetu po deadline
      sql += ` ORDER BY FIELD(priorytet,'PILNY','WAZNY','NORMALNY'), (deadline IS NULL), deadline ASC, data_utworzenia DESC`;
      db.query(sql, params, (err, rows) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success', data: rows || [] });
      });

    } else if (action === 'moje') {
      // Zadania konkretnej osoby (do widoku recepcji w przyszłości)
      const osoba = String(d.osoba || '').trim();
      if (!osoba) return res.json({ status: 'error', message: 'Brak osoby' });
      db.query(
        `SELECT id, data_utworzenia, utworzone_przez, tytul, opis, deadline, status,
                kategoria, priorytet, id_klienta, klient_nazwa
           FROM Zadania
          WHERE tenant_id = ? AND status = 'AKTYWNE'
            AND (przypisane_do = ? OR LOWER(przypisane_do) = 'recepcja')
          ORDER BY FIELD(priorytet,'PILNY','WAZNY','NORMALNY'), (deadline IS NULL), deadline ASC`,
        [tenant_id, osoba],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', data: rows || [] });
        }
      );

    } else if (action === 'add') {
      const tytul = String(d.tytul || '').trim();
      const opis = String(d.opis || '').trim();
      const przypisane_do = String(d.przypisane_do || '').trim();
      const utworzone_przez = String(d.utworzone_przez || '').trim();
      const deadline = d.deadline || null;
      const kategoria = ALLOWED_KATEGORIE.includes(d.kategoria) ? d.kategoria : 'INNE';
      const priorytet = ALLOWED_PRIORYTETY.includes(d.priorytet) ? d.priorytet : 'NORMALNY';
      const id_klienta = d.id_klienta ? String(d.id_klienta).trim() : null;
      const klient_nazwa = d.klient_nazwa ? String(d.klient_nazwa).trim().slice(0, 200) : null;
      if (!tytul) return res.json({ status: 'error', message: 'Tytuł jest wymagany' });
      if (!przypisane_do) return res.json({ status: 'error', message: 'Wskaż osobę lub rolę' });
      const id = randomUUID();
      db.query(
        `INSERT INTO Zadania (id, tenant_id, utworzone_przez, przypisane_do, tytul, opis, kategoria, priorytet, deadline, status, id_klienta, klient_nazwa)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTYWNE', ?, ?)`,
        [id, tenant_id, utworzone_przez, przypisane_do, tytul, opis, kategoria, priorytet, deadline, id_klienta, klient_nazwa],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', id });
        }
      );

    } else if (action === 'edit') {
      const id = d.id;
      if (!id) return res.json({ status: 'error', message: 'Brak id' });
      const tytul = String(d.tytul || '').trim();
      const opis = String(d.opis || '').trim();
      const przypisane_do = String(d.przypisane_do || '').trim();
      const deadline = d.deadline || null;
      const kategoria = ALLOWED_KATEGORIE.includes(d.kategoria) ? d.kategoria : 'INNE';
      const priorytet = ALLOWED_PRIORYTETY.includes(d.priorytet) ? d.priorytet : 'NORMALNY';
      const id_klienta = d.id_klienta ? String(d.id_klienta).trim() : null;
      const klient_nazwa = d.klient_nazwa ? String(d.klient_nazwa).trim().slice(0, 200) : null;
      if (!tytul) return res.json({ status: 'error', message: 'Tytuł jest wymagany' });
      if (!przypisane_do) return res.json({ status: 'error', message: 'Wskaż osobę lub rolę' });
      db.query(
        `UPDATE Zadania SET tytul = ?, opis = ?, przypisane_do = ?, kategoria = ?, priorytet = ?, deadline = ?,
                            id_klienta = ?, klient_nazwa = ?
         WHERE tenant_id = ? AND id = ?`,
        [tytul, opis, przypisane_do, kategoria, priorytet, deadline, id_klienta, klient_nazwa, tenant_id, id],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono zadania' });
          return res.json({ status: 'success' });
        }
      );

    } else if (action === 'complete') {
      const id = d.id;
      const wykonane_przez = String(d.wykonane_przez || '').trim();
      if (!id) return res.json({ status: 'error', message: 'Brak id' });
      db.query(
        `UPDATE Zadania SET status = 'WYKONANE', data_wykonania = NOW(), wykonane_przez = ?
         WHERE tenant_id = ? AND id = ? AND status = 'AKTYWNE'`,
        [wykonane_przez, tenant_id, id],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result.affectedRows) return res.json({ status: 'error', message: 'Zadanie nie jest aktywne lub nie znaleziono' });
          return res.json({ status: 'success' });
        }
      );

    } else if (action === 'archive') {
      const id = d.id;
      const kto = String(d.kto_zarchiwizowal || '').trim();
      if (!id) return res.json({ status: 'error', message: 'Brak id' });
      db.query(
        `UPDATE Zadania SET status = 'ZARCHIWIZOWANE', data_archiwizacji = NOW(), kto_zarchiwizowal = ?
         WHERE tenant_id = ? AND id = ?`,
        [kto, tenant_id, id],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono zadania' });
          return res.json({ status: 'success' });
        }
      );

    } else if (action === 'restore') {
      const id = d.id;
      if (!id) return res.json({ status: 'error', message: 'Brak id' });
      db.query(
        `UPDATE Zadania SET status = 'AKTYWNE', data_archiwizacji = NULL, kto_zarchiwizowal = NULL,
                            data_wykonania = NULL, wykonane_przez = NULL
         WHERE tenant_id = ? AND id = ?`,
        [tenant_id, id],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono zadania' });
          return res.json({ status: 'success' });
        }
      );

    } else if (action === 'delete') {
      const id = d.id;
      if (!id) return res.json({ status: 'error', message: 'Brak id' });
      db.query(
        `DELETE FROM Zadania WHERE tenant_id = ? AND id = ?`,
        [tenant_id, id],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono zadania' });
          return res.json({ status: 'success' });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja: ' + action });
    }
  });

  return router;
};
