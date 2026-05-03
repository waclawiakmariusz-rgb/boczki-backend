// routes/zadania.js
// Zadania od managera dla zespołu — lista, CRUD, archiwum
// POST /api/zadania { action: 'list' | 'add' | 'edit' | 'complete' | 'archive' | 'restore' | 'delete' }

const express = require('express');
const { randomUUID } = require('crypto');

module.exports = (db) => {
  const router = express.Router();

  const ALLOWED_KATEGORIE = ['MAGAZYN','KOSMETYK','KLIENT','SPRZEDAZ','INNE'];
  const ALLOWED_PRIORYTETY = ['NORMALNY','WAZNY','PILNY'];
  const ALLOWED_POWTARZAJ = ['NIE','CODZIENNIE','TYGODNIOWO','MIESIECZNIE'];

  // Czy dziś trzeba zmaterializować instancję wzorca?
  // CODZIENNIE: zawsze
  // TYGODNIOWO: dzisiejszy dzień tygodnia (1=Pn..7=Nd) == powtarzaj_dzien
  // MIESIECZNIE: dzisiejszy dzień miesiąca == powtarzaj_dzien (lub 99=ostatni dzień)
  function czyMaterializowacDzis(wzorzec, dzis) {
    const typ = String(wzorzec.powtarzaj || 'NIE').toUpperCase();
    if (typ === 'CODZIENNIE') return true;
    if (typ === 'TYGODNIOWO') {
      const dow = dzis.getDay() === 0 ? 7 : dzis.getDay(); // 1..7
      return Number(wzorzec.powtarzaj_dzien) === dow;
    }
    if (typ === 'MIESIECZNIE') {
      const dz = dzis.getDate();
      const ostatni = new Date(dzis.getFullYear(), dzis.getMonth() + 1, 0).getDate();
      const wpis = Number(wzorzec.powtarzaj_dzien);
      if (wpis === 99) return dz === ostatni;
      return wpis === dz;
    }
    return false;
  }

  // Lazy materializacja: dla każdego wzorca dla którego dziś przypada cykl,
  // sprawdź czy istnieje instancja na dziś — jeśli nie, utwórz.
  function materializujWzorce(tenant_id, cb) {
    db.query(
      `SELECT * FROM Zadania WHERE tenant_id = ? AND is_szablon = 1`,
      [tenant_id],
      (err, wzorce) => {
        if (err || !wzorce || !wzorce.length) return cb();
        const dzis = new Date();
        const dzisStr = dzis.getFullYear() + '-' + String(dzis.getMonth()+1).padStart(2,'0') + '-' + String(dzis.getDate()).padStart(2,'0');
        let pending = 0; let zakonczone = false;
        const finish = () => { if (zakonczone) return; zakonczone = true; cb(); };
        wzorce.forEach(w => {
          if (!czyMaterializowacDzis(w, dzis)) return;
          pending++;
          // Sprawdź czy instancja na dziś już istnieje
          db.query(
            `SELECT id FROM Zadania WHERE tenant_id = ? AND parent_powtarzajacy_id = ? AND DATE(deadline) = ? LIMIT 1`,
            [tenant_id, w.id, dzisStr],
            (err2, rows) => {
              if (!err2 && (!rows || !rows.length)) {
                // Stwórz instancję — kopiuje pola wzorca; deadline = dziś + godzina ze wzorca
                let instDeadline = null;
                if (w.deadline) {
                  const wzorD = new Date(w.deadline);
                  instDeadline = `${dzisStr} ${String(wzorD.getHours()).padStart(2,'0')}:${String(wzorD.getMinutes()).padStart(2,'0')}:00`;
                }
                const newId = randomUUID();
                db.query(
                  `INSERT INTO Zadania (id, tenant_id, utworzone_przez, przypisane_do, tytul, opis, kategoria, priorytet, deadline, status, id_klienta, klient_nazwa, parent_powtarzajacy_id, is_szablon)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTYWNE', ?, ?, ?, 0)`,
                  [newId, tenant_id, w.utworzone_przez, w.przypisane_do, w.tytul, w.opis, w.kategoria, w.priorytet, instDeadline, w.id_klienta, w.klient_nazwa, w.id],
                  () => { if (--pending === 0) finish(); }
                );
              } else {
                if (--pending === 0) finish();
              }
            }
          );
        });
        if (pending === 0) finish();
      }
    );
  }

  // Pobierz rolę użytkownika z tabeli Użytkownicy (imie_login = imie)
  function pobierzRoleUzytkownika(tenant_id, imie, cb) {
    if (!imie) return cb(null);
    db.query(
      `SELECT rola FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`,
      [tenant_id, imie],
      (err, rows) => {
        if (err || !rows || !rows.length) return cb(null);
        cb(String(rows[0].rola || '').toLowerCase().trim());
      }
    );
  }

  // Czy zlecający (rola_kto) może zlecić odbiorcy (target — imię lub rola string)?
  // Reguły:
  //  - praktykantka — nie może zlecać nikomu
  //  - recepcja     — może: 'recepcja' (rola) + osoby z rolą recepcja/praktykantka
  //  - manager/admin/megaadmin — wszyscy
  // cb(true|false, errorMsg)
  function sprawdzCzyMozeZlecic(tenant_id, rola_kto, target, cb) {
    if (!rola_kto) return cb(false, 'Nie udało się ustalić roli wykonującego');
    if (['admin','megaadmin','manager'].includes(rola_kto)) return cb(true);
    if (rola_kto === 'praktykantka') return cb(false, 'Praktykantka nie może zlecać zadań');
    if (rola_kto === 'recepcja') {
      const t = String(target || '').toLowerCase().trim();
      if (t === 'recepcja' || t === 'praktykantka') return cb(true);
      // Sprawdź rolę odbiorcy w bazie
      pobierzRoleUzytkownika(tenant_id, target, (rolaTarget) => {
        if (!rolaTarget) return cb(false, 'Nie znaleziono roli odbiorcy');
        if (['recepcja', 'praktykantka'].includes(rolaTarget)) return cb(true);
        return cb(false, 'Recepcja może zlecać tylko recepcji i praktykantce');
      });
      return;
    }
    // Inne role (np. kosmetolog) — domyślnie nie pozwalamy zlecać
    return cb(false, 'Brak uprawnień do zlecania zadań');
  }

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
      // Powtarzające się
      safeAlter(`ALTER TABLE Zadania ADD COLUMN powtarzaj ENUM('NIE','CODZIENNIE','TYGODNIOWO','MIESIECZNIE') DEFAULT 'NIE'`, 'powtarzaj');
      safeAlter(`ALTER TABLE Zadania ADD COLUMN powtarzaj_dzien INT NULL`, 'powtarzaj_dzien');
      safeAlter(`ALTER TABLE Zadania ADD COLUMN parent_powtarzajacy_id VARCHAR(36) NULL`, 'parent_powtarzajacy_id');
      safeAlter(`ALTER TABLE Zadania ADD COLUMN is_szablon TINYINT(1) DEFAULT 0`, 'is_szablon');
      safeAlter(`ALTER TABLE Zadania ADD INDEX idx_szablon (tenant_id, is_szablon)`, 'idx_szablon');
    }
  );

  // Tabela komentarzy — historia rozmowy pod zadaniem
  db.query(
    `CREATE TABLE IF NOT EXISTS Zadania_Komentarze (
       id VARCHAR(36) PRIMARY KEY,
       tenant_id VARCHAR(64) NOT NULL,
       id_zadania VARCHAR(36) NOT NULL,
       autor VARCHAR(100),
       tresc TEXT,
       data_utworzenia DATETIME DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_zadania (tenant_id, id_zadania, data_utworzenia)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    (err) => { if (err) console.error('[Zadania_Komentarze] CREATE TABLE error:', err.message); }
  );

  // Tabela klientów powiązanych z zadaniem (relacja wiele-do-wielu)
  // Zachowujemy też pola id_klienta/klient_nazwa w Zadania (pierwszy klient = "main")
  // dla kompatybilności wstecznej z auto-suggest i widget render.
  db.query(
    `CREATE TABLE IF NOT EXISTS Zadania_Klienci (
       id VARCHAR(36) PRIMARY KEY,
       tenant_id VARCHAR(64) NOT NULL,
       id_zadania VARCHAR(36) NOT NULL,
       id_klienta VARCHAR(50) NOT NULL,
       klient_nazwa VARCHAR(200),
       INDEX idx_zadania (tenant_id, id_zadania),
       INDEX idx_klient (tenant_id, id_klienta)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    (err) => { if (err) console.error('[Zadania_Klienci] CREATE TABLE error:', err.message); }
  );

  // Helper: zapisz listę klientów dla zadania (idempotentnie — DELETE + INSERT)
  function setKlienciZadania(tenant_id, id_zadania, klienci, cb) {
    db.query(
      `DELETE FROM Zadania_Klienci WHERE tenant_id = ? AND id_zadania = ?`,
      [tenant_id, id_zadania],
      (err) => {
        if (err) return cb(err);
        const lista = Array.isArray(klienci) ? klienci.filter(k => k && k.id) : [];
        if (!lista.length) return cb();
        let pending = lista.length;
        let errFinal = null;
        lista.forEach(k => {
          db.query(
            `INSERT INTO Zadania_Klienci (id, tenant_id, id_zadania, id_klienta, klient_nazwa) VALUES (?, ?, ?, ?, ?)`,
            [randomUUID(), tenant_id, id_zadania, String(k.id).trim(), String(k.nazwa || '').trim().slice(0, 200)],
            (err2) => {
              if (err2 && !errFinal) errFinal = err2;
              if (--pending === 0) cb(errFinal);
            }
          );
        });
      }
    );
  }

  // Helper: dla listy zadań pobierz wszystkich klientów (jednym query)
  function dolaczKlientow(tenant_id, zadania, cb) {
    if (!zadania || !zadania.length) return cb(zadania);
    const ids = zadania.map(z => z.id);
    db.query(
      `SELECT id_zadania, id_klienta, klient_nazwa FROM Zadania_Klienci WHERE tenant_id = ? AND id_zadania IN (?)`,
      [tenant_id, ids],
      (err, rows) => {
        if (err) { console.error('[dolaczKlientow]', err.message); zadania.forEach(z => z.klienci = []); return cb(zadania); }
        const map = {};
        (rows || []).forEach(r => {
          if (!map[r.id_zadania]) map[r.id_zadania] = [];
          map[r.id_zadania].push({ id: r.id_klienta, nazwa: r.klient_nazwa });
        });
        zadania.forEach(z => {
          z.klienci = map[z.id] || [];
          // Backward compat: jeśli pusto a stary main jest ustawiony — dodaj go
          if (z.klienci.length === 0 && z.id_klienta && z.klient_nazwa) {
            z.klienci = [{ id: z.id_klienta, nazwa: z.klient_nazwa }];
          }
        });
        cb(zadania);
      }
    );
  }

  // Helper: parsuj klientów z payloadu (akceptuje array LUB stare pola id_klienta/klient_nazwa)
  function parseKlienciPayload(d) {
    if (Array.isArray(d.klienci)) {
      return d.klienci.filter(k => k && k.id).map(k => ({ id: String(k.id).trim(), nazwa: String(k.nazwa || '').trim() }));
    }
    if (d.id_klienta) return [{ id: String(d.id_klienta).trim(), nazwa: String(d.klient_nazwa || '').trim() }];
    return [];
  }

  router.post('/zadania', (req, res) => {
    const d = req.body || {};
    const tenant_id = d.tenant_id;
    const action = d.action;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    if (!action) return res.json({ status: 'error', message: 'Brak action' });

    if (action === 'list') {
      const status = d.status; // AKTYWNE | WYKONANE | ZARCHIWIZOWANE | undefined (wszystkie)
      const kategoria = d.kategoria;
      const utworzonePrzez = d.utworzone_przez;
      const tylkoSzablony = !!d.tylko_szablony;
      const params = [tenant_id];
      let sql = `SELECT id, data_utworzenia, utworzone_przez, przypisane_do, tytul, opis,
                        kategoria, priorytet, deadline, status,
                        data_wykonania, wykonane_przez, data_archiwizacji, kto_zarchiwizowal,
                        id_klienta, klient_nazwa,
                        powtarzaj, powtarzaj_dzien, parent_powtarzajacy_id, is_szablon
                 FROM Zadania WHERE tenant_id = ?`;
      // Filtr szablonu — domyślnie pomijamy szablony (instancje + jednorazowe)
      sql += tylkoSzablony ? ` AND is_szablon = 1` : ` AND is_szablon = 0`;
      if (status && ['AKTYWNE','WYKONANE','ZARCHIWIZOWANE'].includes(status)) {
        sql += ` AND status = ?`;
        params.push(status);
      }
      if (kategoria && ALLOWED_KATEGORIE.includes(kategoria)) {
        sql += ` AND kategoria = ?`;
        params.push(kategoria);
      }
      if (utworzonePrzez) {
        sql += ` AND TRIM(utworzone_przez) = TRIM(?)`;
        params.push(String(utworzonePrzez).trim());
      }
      sql += ` ORDER BY FIELD(priorytet,'PILNY','WAZNY','NORMALNY'), (deadline IS NULL), deadline ASC, data_utworzenia DESC`;
      // Najpierw zmaterializuj brakujące instancje wzorców na dziś, potem zwróć listę
      const runQuery = () => db.query(sql, params, (err, rows) => {
        if (err) return res.json({ status: 'error', message: err.message });
        dolaczKlientow(tenant_id, rows || [], (zZKlientami) => {
          return res.json({ status: 'success', data: zZKlientami });
        });
      });
      if (tylkoSzablony || status === 'WYKONANE' || status === 'ZARCHIWIZOWANE') runQuery();
      else materializujWzorce(tenant_id, runQuery);

    } else if (action === 'moje') {
      // Zadania konkretnej osoby — recepcja widzi też zadania zlecone na rolę 'recepcja',
      // praktykantka widzi tylko swoje (rola praktykantka nie ma "grupowych" zadań).
      const osoba = String(d.osoba || '').trim();
      const rolaOsoby = String(d.rola || '').toLowerCase().trim();
      if (!osoba) return res.json({ status: 'error', message: 'Brak osoby' });
      // Materializacja wzorców (jeśli osoba ma przypisane szablony cykliczne)
      materializujWzorce(tenant_id, () => {
        const params = [tenant_id, osoba];
        let whereOsoba = `AND (przypisane_do = ?`;
        // Recepcja widzi też zadania dla roli 'recepcja', praktykantka — dla 'praktykantka'
        if (rolaOsoby === 'recepcja') { whereOsoba += ` OR LOWER(przypisane_do) = 'recepcja'`; }
        else if (rolaOsoby === 'praktykantka') { whereOsoba += ` OR LOWER(przypisane_do) = 'praktykantka'`; }
        whereOsoba += `)`;
        db.query(
          `SELECT id, data_utworzenia, utworzone_przez, tytul, opis, deadline, status,
                  kategoria, priorytet, id_klienta, klient_nazwa,
                  powtarzaj, powtarzaj_dzien, parent_powtarzajacy_id
             FROM Zadania
            WHERE tenant_id = ? AND status = 'AKTYWNE' AND is_szablon = 0
              ${whereOsoba}
            ORDER BY FIELD(priorytet,'PILNY','WAZNY','NORMALNY'), (deadline IS NULL), deadline ASC`,
          params,
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            dolaczKlientow(tenant_id, rows || [], (zZKlientami) => {
              return res.json({ status: 'success', data: zZKlientami });
            });
          }
        );
      });

    } else if (action === 'add') {
      const tytul = String(d.tytul || '').trim();
      const opis = String(d.opis || '').trim();
      const przypisane_do = String(d.przypisane_do || '').trim();
      const utworzone_przez = String(d.utworzone_przez || '').trim();
      const deadline = d.deadline || null;
      const kategoria = ALLOWED_KATEGORIE.includes(d.kategoria) ? d.kategoria : 'INNE';
      const priorytet = ALLOWED_PRIORYTETY.includes(d.priorytet) ? d.priorytet : 'NORMALNY';
      const klienciList = parseKlienciPayload(d);
      const id_klienta = klienciList.length > 0 ? klienciList[0].id : null;
      const klient_nazwa = klienciList.length > 0 ? klienciList[0].nazwa.slice(0, 200) : null;
      const powtarzaj = ALLOWED_POWTARZAJ.includes(d.powtarzaj) ? d.powtarzaj : 'NIE';
      let powtarzaj_dzien = null;
      if (powtarzaj === 'TYGODNIOWO') powtarzaj_dzien = parseInt(d.powtarzaj_dzien, 10) || 1;
      if (powtarzaj === 'MIESIECZNIE') powtarzaj_dzien = parseInt(d.powtarzaj_dzien, 10) || 1;
      const isSzablon = (powtarzaj !== 'NIE') ? 1 : 0;
      if (!tytul) return res.json({ status: 'error', message: 'Tytuł jest wymagany' });
      if (!przypisane_do) return res.json({ status: 'error', message: 'Wskaż osobę lub rolę' });
      // RBAC: sprawdź czy wykonujący (utworzone_przez) ma prawo zlecić temu odbiorcy
      pobierzRoleUzytkownika(tenant_id, utworzone_przez, (rolaKto) => {
        sprawdzCzyMozeZlecic(tenant_id, rolaKto, przypisane_do, (mozna, msg) => {
          if (!mozna) return res.json({ status: 'error', message: msg || 'Brak uprawnień' });
          const id = randomUUID();
          db.query(
            `INSERT INTO Zadania (id, tenant_id, utworzone_przez, przypisane_do, tytul, opis, kategoria, priorytet, deadline, status, id_klienta, klient_nazwa, powtarzaj, powtarzaj_dzien, is_szablon)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTYWNE', ?, ?, ?, ?, ?)`,
            [id, tenant_id, utworzone_przez, przypisane_do, tytul, opis, kategoria, priorytet, deadline, id_klienta, klient_nazwa, powtarzaj, powtarzaj_dzien, isSzablon],
            (err) => {
              if (err) return res.json({ status: 'error', message: err.message });
              // Zapisz wszystkich klientów (multi-klient)
              setKlienciZadania(tenant_id, id, klienciList, () => {
                if (isSzablon) materializujWzorce(tenant_id, () => res.json({ status: 'success', id }));
                else res.json({ status: 'success', id });
              });
            }
          );
        });
      });

    } else if (action === 'edit') {
      const id = d.id;
      if (!id) return res.json({ status: 'error', message: 'Brak id' });
      const tytul = String(d.tytul || '').trim();
      const opis = String(d.opis || '').trim();
      const przypisane_do = String(d.przypisane_do || '').trim();
      const deadline = d.deadline || null;
      const kategoria = ALLOWED_KATEGORIE.includes(d.kategoria) ? d.kategoria : 'INNE';
      const priorytet = ALLOWED_PRIORYTETY.includes(d.priorytet) ? d.priorytet : 'NORMALNY';
      const klienciListEdit = parseKlienciPayload(d);
      const id_klienta = klienciListEdit.length > 0 ? klienciListEdit[0].id : null;
      const klient_nazwa = klienciListEdit.length > 0 ? klienciListEdit[0].nazwa.slice(0, 200) : null;
      const kto_edytuje = String(d.kto_edytuje || d.utworzone_przez || '').trim();
      if (!tytul) return res.json({ status: 'error', message: 'Tytuł jest wymagany' });
      if (!przypisane_do) return res.json({ status: 'error', message: 'Wskaż osobę lub rolę' });
      // RBAC: sprawdź czy edytujący ma prawo zlecić tej osobie/roli
      pobierzRoleUzytkownika(tenant_id, kto_edytuje, (rolaKto) => {
        sprawdzCzyMozeZlecic(tenant_id, rolaKto, przypisane_do, (mozna, msg) => {
          if (!mozna) return res.json({ status: 'error', message: msg || 'Brak uprawnień' });
          db.query(
            `UPDATE Zadania SET tytul = ?, opis = ?, przypisane_do = ?, kategoria = ?, priorytet = ?, deadline = ?,
                                id_klienta = ?, klient_nazwa = ?
             WHERE tenant_id = ? AND id = ?`,
            [tytul, opis, przypisane_do, kategoria, priorytet, deadline, id_klienta, klient_nazwa, tenant_id, id],
            (err, result) => {
              if (err) return res.json({ status: 'error', message: err.message });
              if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono zadania' });
              setKlienciZadania(tenant_id, id, klienciListEdit, () => {
                return res.json({ status: 'success' });
              });
            }
          );
        });
      });

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

    } else if (action === 'comment_add') {
      const id_zadania = String(d.id_zadania || '').trim();
      const autor = String(d.autor || '').trim().slice(0, 100);
      const tresc = String(d.tresc || '').trim();
      if (!id_zadania) return res.json({ status: 'error', message: 'Brak id_zadania' });
      if (!tresc) return res.json({ status: 'error', message: 'Pusty komentarz' });
      const id = randomUUID();
      db.query(
        `INSERT INTO Zadania_Komentarze (id, tenant_id, id_zadania, autor, tresc) VALUES (?, ?, ?, ?, ?)`,
        [id, tenant_id, id_zadania, autor, tresc],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', id });
        }
      );

    } else if (action === 'comments_list') {
      const id_zadania = String(d.id_zadania || '').trim();
      if (!id_zadania) return res.json({ status: 'error', message: 'Brak id_zadania' });
      db.query(
        `SELECT id, autor, tresc, data_utworzenia FROM Zadania_Komentarze
         WHERE tenant_id = ? AND id_zadania = ? ORDER BY data_utworzenia ASC`,
        [tenant_id, id_zadania],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', data: rows || [] });
        }
      );

    } else if (action === 'comment_delete') {
      const id = String(d.id || '').trim();
      if (!id) return res.json({ status: 'error', message: 'Brak id' });
      db.query(
        `DELETE FROM Zadania_Komentarze WHERE tenant_id = ? AND id = ?`,
        [tenant_id, id],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success' });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja: ' + action });
    }
  });

  return router;
};
