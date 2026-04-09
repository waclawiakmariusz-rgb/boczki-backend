// routes/magazyn.js
// Operacje magazynowe: read, add, update, delete, restore, archive_read, dictionary, add_model, edit_product, edit_dictionary_entry, delete_dictionary_entry

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');

module.exports = (db) => {
  const zapiszLog = makeZapiszLog(db);

  // ==========================================
  // GET /magazyn - pobierz magazyn
  // ==========================================
  router.get('/magazyn', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });

    const action = req.query.action;

    if (action === 'read') {
      db.query(
        `SELECT id, nazwa_produktu, typ, ilosc, min, data_waznosci, cena_netto, cena_brutto, kategoria, kto_dodal, data_dodania FROM Magazyn WHERE tenant_id = ? ORDER BY nazwa_produktu`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json(rows.map(r => ({
            id: r.id,
            nazwa: r.nazwa_produktu,
            typ: r.typ,
            ilosc: r.ilosc,
            min: r.min,
            waznosc: r.data_waznosci,
            netto: r.cena_netto,
            brutto: r.cena_brutto,
            kategoria: r.kategoria,
            kto_dodal: r.kto_dodal,
            data_dodania: r.data_dodania
          })));
        }
      );
    } else if (action === 'archive_read') {
      db.query(
        `SELECT id, nazwa_produktu, typ, ilosc, min, data_waznosci, cena_netto, cena_brutto, kategoria, kto_dodal, data_dodania FROM Archiwum WHERE tenant_id = ? ORDER BY nazwa_produktu`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json(rows.map(r => ({
            id: r.id,
            nazwa: r.nazwa_produktu,
            typ: r.typ,
            ilosc: r.ilosc,
            min: r.min,
            waznosc: r.data_waznosci,
            netto: r.cena_netto,
            brutto: r.cena_brutto,
            kategoria: r.kategoria,
            kto_dodal: r.kto_dodal,
            data_dodania: r.data_dodania
          })));
        }
      );
    } else if (action === 'dictionary') {
      db.query(
        `SELECT firma, model, cena_detal FROM Slownik WHERE tenant_id = ? ORDER BY firma, model`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json(rows.map(r => ({
            firma: r.firma,
            model: r.model,
            cena: r.cena_detal !== null && r.cena_detal !== '' ? parseFloat(r.cena_detal) : ''
          })));
        }
      );
    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET magazyn: ' + action });
    }
  });

  // ==========================================
  // POST /magazyn - operacje zapisu
  // ==========================================
  router.post('/magazyn', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    // --- UPDATE (aktualizuj stan) ---
    if (action === 'update') {
      db.query(
        `SELECT id, nazwa_produktu, ilosc FROM Magazyn WHERE tenant_id = ? AND id = ?`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Brak ID' });
          const stara = parseFloat(rows[0].ilosc) || 0;
          const nowa = stara + parseFloat(d.ilosc);
          db.query(
            `UPDATE Magazyn SET ilosc = ? WHERE tenant_id = ? AND id = ?`,
            [nowa, tenant_id, d.id],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              zapiszLog(tenant_id, 'MAGAZYN ' + (d.opis || 'UPDATE'), d.pracownik, `${rows[0].nazwa_produktu} (Stan: ${stara} -> ${nowa})`);
              return res.json({ status: 'success', message: 'Zaktualizowano!' });
            }
          );
        }
      );

    // --- ADD (dodaj produkt) ---
    } else if (action === 'add') {
      if (!d.nazwa || !d.nazwa.trim()) return res.json({ status: 'error', message: 'Niepoprawna nazwa produktu.' });
      if (!d.ilosc || !d.netto || !d.brutto || !d.waznosc) return res.json({ status: 'error', message: 'Wszystkie pola są obowiązkowe!' });

      const now = new Date();
      const id = now.getTime().toString();
      db.query(
        `INSERT INTO Magazyn (id, tenant_id, nazwa_produktu, typ, ilosc, min, jednostka, data_waznosci, cena_netto, cena_brutto, kategoria, kto_dodal, data_dodania) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tenant_id, d.nazwa, d.typ || '', parseFloat(d.ilosc), parseFloat(d.min) || 0, d.jednostka || 'szt.', d.waznosc, parseFloat(d.netto), parseFloat(d.brutto), d.kategoria || '', d.pracownik, now],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          zapiszLog(tenant_id, 'PRZYJĘCIE TOWARU', d.pracownik, `${d.nazwa} (${d.ilosc} szt.) [${d.kategoria || ''}]`);
          return res.json({ status: 'success', message: 'Dodano!' });
        }
      );

    // --- ADD_MODEL (dodaj model do słownika) ---
    } else if (action === 'add_model') {
      db.query(
        `SELECT id FROM Slownik WHERE tenant_id = ? AND LOWER(TRIM(firma)) = LOWER(TRIM(?)) AND LOWER(TRIM(model)) = LOWER(TRIM(?)) LIMIT 1`,
        [tenant_id, d.firma, d.model],
        (err, rows) => {
          if (rows && rows.length > 0) return res.json({ status: 'success', message: 'Istnieje!' });
          const id = randomUUID();
          db.query(
            `INSERT INTO Slownik (id, tenant_id, firma, model, cena_detal) VALUES (?, ?, ?, ?, ?)`,
            [id, tenant_id, d.firma, d.model, d.cena ? parseFloat(d.cena) : null],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              return res.json({ status: 'success', message: 'Dodano!' });
            }
          );
        }
      );

    // --- DELETE (archiwizuj produkt) ---
    } else if (action === 'delete') {
      db.query(
        `SELECT * FROM Magazyn WHERE tenant_id = ? AND id = ?`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Brak ID' });
          const row = rows[0];
          db.query(
            `INSERT INTO Archiwum (id, tenant_id, nazwa_produktu, typ, ilosc, min, jednostka, data_waznosci, cena_netto, cena_brutto, kategoria, kto_dodal, data_dodania, kto_usunal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id, tenant_id, row.nazwa_produktu, row.typ, row.ilosc, row.min, row.jednostka, row.data_waznosci, row.cena_netto, row.cena_brutto, row.kategoria, row.kto_dodal, row.data_dodania, d.pracownik],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              db.query(`DELETE FROM Magazyn WHERE tenant_id = ? AND id = ?`, [tenant_id, d.id], (err3) => {
                if (err3) return res.json({ status: 'error', message: err3.message });
                zapiszLog(tenant_id, 'ARCHIWIZACJA', d.pracownik, `${row.nazwa_produktu} - zarchiwizowano`);
                return res.json({ status: 'success', message: 'Zarchiwizowano.' });
              });
            }
          );
        }
      );

    // --- RESTORE (przywróć z archiwum) ---
    } else if (action === 'restore') {
      db.query(
        `SELECT * FROM Archiwum WHERE tenant_id = ? AND id = ?`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Brak ID w archiwum' });
          const row = rows[0];
          db.query(
            `INSERT INTO Magazyn (id, tenant_id, nazwa_produktu, typ, ilosc, min, jednostka, data_waznosci, cena_netto, cena_brutto, kategoria, kto_dodal, data_dodania) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id, tenant_id, row.nazwa_produktu, row.typ, row.ilosc, row.min, row.jednostka || 'szt.', row.data_waznosci, row.cena_netto, row.cena_brutto, row.kategoria, row.kto_dodal, row.data_dodania],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              db.query(`DELETE FROM Archiwum WHERE tenant_id = ? AND id = ?`, [tenant_id, d.id], () => {
                zapiszLog(tenant_id, 'PRZYWRÓCENIE', 'System', `${row.nazwa_produktu} - przywrócono z archiwum`);
                return res.json({ status: 'success', message: 'Przywrócono!' });
              });
            }
          );
        }
      );

    // --- EDIT_PRODUCT (edytuj produkt) ---
    } else if (action === 'edit_product') {
      db.query(
        `SELECT id, nazwa_produktu, ilosc, data_waznosci, cena_netto, cena_brutto FROM Magazyn WHERE tenant_id = ? AND id = ?`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono produktu o ID: ' + d.id });
          const old = rows[0];
          let logiZmian = [];
          if (String(old.nazwa_produktu).trim() !== String(d.nazwa).trim()) logiZmian.push(`Nazwa: ${old.nazwa_produktu} -> ${d.nazwa}`);
          if (String(old.ilosc) !== String(d.ilosc)) logiZmian.push(`Ilość: ${old.ilosc} -> ${d.ilosc}`);
          if (Number(old.cena_netto).toFixed(2) !== Number(d.netto).toFixed(2)) logiZmian.push(`Netto: ${old.cena_netto} -> ${d.netto}`);
          if (Number(old.cena_brutto).toFixed(2) !== Number(d.brutto).toFixed(2)) logiZmian.push(`Brutto: ${old.cena_brutto} -> ${d.brutto}`);
          if (String(old.data_waznosci || '') !== String(d.waznosc || '')) logiZmian.push(`Ważność: ${old.data_waznosci} -> ${d.waznosc}`);

          db.query(
            `UPDATE Magazyn SET nazwa_produktu = ?, ilosc = ?, data_waznosci = ?, cena_netto = ?, cena_brutto = ? WHERE tenant_id = ? AND id = ?`,
            [d.nazwa, parseFloat(d.ilosc), d.waznosc || null, parseFloat(d.netto), parseFloat(d.brutto), tenant_id, d.id],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              const opisLog = logiZmian.length > 0 ? logiZmian.join(' | ') : 'Edycja (brak zmian wartości)';
              zapiszLog(tenant_id, 'EDYCJA PRODUKTU', d.pracownik, `${d.nazwa}: ${opisLog}`);
              return res.json({ status: 'success', message: 'Zaktualizowano produkt!' });
            }
          );
        }
      );

    // --- EDIT_DICTIONARY_ENTRY (edytuj wpis słownika) ---
    } else if (action === 'edit_dictionary_entry') {
      db.query(
        `SELECT id FROM Slownik WHERE tenant_id = ? AND TRIM(firma) = ? AND TRIM(model) = ? LIMIT 1`,
        [tenant_id, d.old_firma.trim(), d.old_model.trim()],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono wpisu do edycji.' });
          db.query(
            `UPDATE Slownik SET firma = ?, model = ?, cena_detal = ? WHERE tenant_id = ? AND id = ?`,
            [d.new_firma, d.new_model, d.new_cena ? parseFloat(d.new_cena) : null, tenant_id, rows[0].id],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              zapiszLog(tenant_id, 'EDYCJA KOSMETYKU', d.pracownik, `${d.old_firma} ${d.old_model} -> ${d.new_firma} ${d.new_model} (${d.new_cena} zł)`);
              return res.json({ status: 'success', message: 'Zaktualizowano kosmetyk!' });
            }
          );
        }
      );

    // --- DELETE_DICTIONARY_ENTRY (usuń wpis słownika) ---
    } else if (action === 'delete_dictionary_entry') {
      const nazwaSzukana = (String(d.firma).trim() + ' ' + String(d.model).trim()).toLowerCase();
      // Sprawdź czy jest na stanie
      db.query(
        `SELECT SUM(ilosc) as total FROM Magazyn WHERE tenant_id = ? AND LOWER(TRIM(nazwa_produktu)) = ?`,
        [tenant_id, nazwaSzukana],
        (err, rows) => {
          const total = rows && rows[0] ? (parseFloat(rows[0].total) || 0) : 0;
          if (total > 0) {
            return res.json({ status: 'error', message: `W systemie znajduje się jeszcze ${total} szt. tego produktu! Najpierw wyzeruj stan magazynowy.` });
          }
          db.query(
            `DELETE FROM Slownik WHERE tenant_id = ? AND TRIM(firma) = ? AND TRIM(model) = ? LIMIT 1`,
            [tenant_id, d.firma.trim(), d.model.trim()],
            (err2, result) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono produktu w słowniku.' });
              zapiszLog(tenant_id, 'USUNIĘCIE SŁOWNIK KOSMETYK', d.pracownik || 'Admin', `${d.firma} ${d.model} (Stan zweryfikowany: 0)`);
              return res.json({ status: 'success', message: 'Kosmetyk został wycofany z systemu.' });
            }
          );
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja magazyn POST: ' + action });
    }
  });

  return router;
};
