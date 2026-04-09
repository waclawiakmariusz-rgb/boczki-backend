// routes/raport.js
// Raport magazyn pro: rap_getInventory, rap_getCategories, rap_getLogs, rap_updateStock,
//                    rap_archiveProduct, rap_saveProduct, rap_saveCategory, rap_deleteCategory

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');

module.exports = (db) => {
  const zapiszLog = makeZapiszLog(db);

  // Helper: loguj do Raport_Logi i Logi
  function rap_logAction(tenant_id, akcja, produkt, opis, pracownik) {
    const id = randomUUID();
    const pelnyOpis = `[${produkt}] ${opis}`;
    db.query(
      `INSERT INTO Raport_Logi (id, tenant_id, data, akcja, produkt, opis, pracownik) VALUES (?, ?, NOW(), ?, ?, ?, ?)`,
      [id, tenant_id, akcja, produkt, pelnyOpis, pracownik || ''],
      (err) => { if (err) console.error('Błąd Raport_Logi:', err.message); }
    );
    // Logujemy też do głównych Logów
    const logId = randomUUID();
    db.query(
      `INSERT INTO Logi (id, tenant_id, data_zdarzenia, pracownik, akcja, modul, opis) VALUES (?, ?, NOW(), ?, ?, ?, ?)`,
      [logId, tenant_id, pracownik || '', akcja, 'MAGAZYN: ' + produkt, pelnyOpis],
      () => {}
    );
  }

  // POST /raport - wszystkie akcje rap_
  router.post('/raport', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'rap_getInventory') {
      db.query(
        `SELECT id, kategoria, nazwa, ilosc, min, jednostka, data_zmiany, edytowal, cena_netto, cena_brutto, data_waznosci FROM Raport_Magazyn WHERE tenant_id = ? AND (kategoria != 'Archiwum' OR kategoria IS NULL) ORDER BY kategoria, nazwa`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          // Zwracamy tablicę tablic (zgodnie z oryginalem)
          const data = (rows || []).map(r => [r.id, r.kategoria, r.nazwa, r.ilosc, r.min, r.jednostka, r.data_zmiany, r.edytowal, 'Aktywny', r.cena_brutto, '', r.data_waznosci]);
          return res.json({ status: 'success', data });
        }
      );

    } else if (action === 'rap_getCategories') {
      db.query(
        `SELECT id, nazwa, rodzic_id, pelna_sciezka FROM Raport_Kategorie WHERE tenant_id = ? ORDER BY pelna_sciezka`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          const data = (rows || []).map(r => [r.id, r.nazwa, r.rodzic_id, r.pelna_sciezka]);
          return res.json({ status: 'success', data });
        }
      );

    } else if (action === 'rap_getLogs') {
      db.query(
        `SELECT data_zdarzenia, akcja, modul, opis, pracownik FROM Logi WHERE tenant_id = ? AND modul LIKE 'MAGAZYN:%' ORDER BY data_zdarzenia DESC LIMIT 200`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'success', data: [] });
          const data = (rows || []).map(r => {
            const czystyProdukt = String(r.modul || '').replace('MAGAZYN: ', '');
            let czystyOpis = String(r.opis || '');
            const prefix = `[${czystyProdukt}] `;
            if (czystyOpis.startsWith(prefix)) czystyOpis = czystyOpis.substring(prefix.length);
            return [r.data_zdarzenia, r.akcja, czystyProdukt, czystyOpis, r.pracownik];
          });
          return res.json({ status: 'success', data });
        }
      );

    } else if (action === 'rap_updateStock') {
      db.query(
        `SELECT id, nazwa, ilosc, jednostka FROM Raport_Magazyn WHERE tenant_id = ? AND id = ?`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono produktu' });
          const row = rows[0];
          const oldQty = Number(row.ilosc) || 0;
          const newQty = d.mode === 'delta' ? oldQty + Number(d.value) : Number(d.value);
          const unit = row.jednostka || 'szt.';

          let opTxt;
          if (d.mode === 'absolute') {
            opTxt = `Korekta ręczna: ze stanu ${oldQty} na ${Math.round(newQty * 100) / 100} ${unit}`;
          } else {
            const diff = Math.round((newQty - oldQty) * 100) / 100;
            const znak = diff > 0 ? '+' : '';
            const slowo = diff > 0 ? 'Dodano' : 'Pobrano';
            opTxt = `${slowo} ${znak}${diff} ${unit} (Obecny stan: ${Math.round(newQty * 100) / 100})`;
          }

          db.query(
            `UPDATE Raport_Magazyn SET ilosc = ?, data_zmiany = NOW(), edytowal = ? WHERE tenant_id = ? AND id = ?`,
            [Math.round(newQty * 100) / 100, d.userFull || '', tenant_id, d.id],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              rap_logAction(tenant_id, 'ZMIANA STANU', row.nazwa, opTxt, d.userFull);
              return res.json({ status: 'success' });
            }
          );
        }
      );

    } else if (action === 'rap_archiveProduct') {
      db.query(
        `SELECT id, nazwa FROM Raport_Magazyn WHERE tenant_id = ? AND id = ?`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono produktu' });
          const prodName = rows[0].nazwa;
          db.query(
            `UPDATE Raport_Magazyn SET kategoria = 'Archiwum', data_zmiany = NOW(), edytowal = ? WHERE tenant_id = ? AND id = ?`,
            [d.userFull || '', tenant_id, d.id],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              rap_logAction(tenant_id, 'ARCHIWIZACJA', prodName, 'Usunięto do archiwum', d.userFull);
              return res.json({ status: 'success' });
            }
          );
        }
      );

    } else if (action === 'rap_saveProduct') {
      const now = new Date().toISOString();
      if (d.id) {
        // Edycja
        db.query(
          `UPDATE Raport_Magazyn SET kategoria = ?, nazwa = ?, ilosc = ?, min = ?, jednostka = ?, data_zmiany = NOW(), edytowal = ?, cena_brutto = ?, data_waznosci = ? WHERE tenant_id = ? AND id = ?`,
          [d.category || '', d.nazwa || '', Number(d.ilosc) || 0, Number(d.min) || 0, d.unit || 'szt.', d.userFull || '', Number(d.price_gross) || null, d.expiration || null, tenant_id, d.id],
          (err, result) => {
            if (err) return res.json({ status: 'error', message: err.message });
            if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono produktu' });
            rap_logAction(tenant_id, 'EDYCJA PRODUKTU', d.nazwa, 'Zaktualizowano dane', d.userFull);
            return res.json({ status: 'success', message: 'Zapisano zmiany' });
          }
        );
      } else {
        // Nowy produkt
        const newId = 'PRD_' + Date.now();
        db.query(
          `INSERT INTO Raport_Magazyn (id, tenant_id, kategoria, nazwa, ilosc, min, jednostka, data_zmiany, edytowal, cena_brutto, data_waznosci) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
          [newId, tenant_id, d.category || '', d.nazwa || '', Number(d.ilosc) || 0, Number(d.min) || 0, d.unit || 'szt.', d.userFull || '', Number(d.price_gross) || null, d.expiration || null],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            rap_logAction(tenant_id, 'NOWY PRODUKT', d.nazwa, `Dodano na stan: ${d.ilosc} ${d.unit || 'szt.'}`, d.userFull);
            return res.json({ status: 'success', message: 'Dodano produkt' });
          }
        );
      }

    } else if (action === 'rap_saveCategory') {
      const newId = 'CAT_' + Date.now();
      if (d.parentId) {
        db.query(
          `SELECT pelna_sciezka FROM Raport_Kategorie WHERE tenant_id = ? AND id = ? LIMIT 1`,
          [tenant_id, d.parentId],
          (err, rows) => {
            const parentPath = rows && rows.length ? rows[0].pelna_sciezka : d.name;
            const fullPath = parentPath + ' > ' + d.name;
            db.query(
              `INSERT INTO Raport_Kategorie (id, tenant_id, nazwa, rodzic_id, pelna_sciezka) VALUES (?, ?, ?, ?, ?)`,
              [newId, tenant_id, d.name, d.parentId, fullPath],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                return res.json({ status: 'success' });
              }
            );
          }
        );
      } else {
        db.query(
          `INSERT INTO Raport_Kategorie (id, tenant_id, nazwa, rodzic_id, pelna_sciezka) VALUES (?, ?, ?, '', ?)`,
          [newId, tenant_id, d.name, d.name],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success' });
          }
        );
      }

    } else if (action === 'rap_deleteCategory') {
      db.query(
        `DELETE FROM Raport_Kategorie WHERE tenant_id = ? AND id = ? LIMIT 1`,
        [tenant_id, d.id],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono kategorii' });
          return res.json({ status: 'success' });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja raport POST: ' + action });
    }
  });

  return router;
};
