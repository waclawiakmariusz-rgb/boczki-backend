// routes/raport.js
// Raport magazyn pro: rap_getInventory, rap_getCategories, rap_getLogs, rap_updateStock,
//                    rap_archiveProduct, rap_saveProduct, rap_saveCategory, rap_deleteCategory

const express = require('express');
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');

module.exports = (db) => {
  // Router powstaje PER WYWOŁANIE fabryki. Wcześniej był tworzony na poziomie modułu, więc
  // drugie użycie (np. w próbach z inną atrapą bazy) doklejało kolejny handler do tego samego
  // routera, a żądania obsługiwał ten pierwszy — z bazą z poprzedniego użycia.
  const router = express.Router();
  const zapiszLog = makeZapiszLog(db);

  // Idempotentna migracja: produkty wycofane z raportu "Zadania na dziś" (nie zamawiamy).
  // Klucz po id produktu (Raport_Magazyn.id), bo w tym module każdy wiersz to osobny rekord.
  db.query(
    `CREATE TABLE IF NOT EXISTS Raport_Wycofane_Zamowienia (
       tenant_id VARCHAR(100) NOT NULL,
       produkt_id VARCHAR(64) NOT NULL,
       kto VARCHAR(100),
       data DATETIME NOT NULL,
       PRIMARY KEY (tenant_id, produkt_id)
     )`,
    (err) => {
      if (err) console.error('[raport] CREATE Raport_Wycofane_Zamowienia:', err.message);
    }
  );

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
        // Nowy produkt — guard: nie pozwalamy na cichy duplikat (ta sama nazwa w tej samej kategorii).
        db.query(
          `SELECT id FROM Raport_Magazyn
           WHERE tenant_id = ?
             AND LOWER(TRIM(nazwa)) = LOWER(TRIM(?))
             AND LOWER(TRIM(IFNULL(kategoria, ''))) = LOWER(TRIM(?))
             AND (kategoria != 'Archiwum' OR kategoria IS NULL)
           LIMIT 1`,
          [tenant_id, d.nazwa || '', d.category || ''],
          (errDup, dupRows) => {
            if (!errDup && dupRows && dupRows.length) {
              return res.json({ status: 'error', code: 'DUPLICATE', message: 'Produkt o tej nazwie już istnieje w tej kategorii. Edytuj istniejący wpis zamiast dodawać nowy (inaczej powstanie duplikat na liście zamówień).' });
            }
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

    // ─── ZMIANA NAZWY I PRZENIESIENIE KATEGORII (zgłoszenie #8, 19.10.2026) ────────────────────
    // Dotąd kategorię można było tylko dodać albo skasować. Recepcja chciała przenieść „Płyny"
    // z inwentaryzacji tygodniowej do miesięcznej („z tygodnia na tydzień nic tam nie schodzi")
    // i nie miała jak — poza skasowaniem i założeniem od nowa, co odcina produkty od kategorii.
    //
    // Uwaga na model: produkty trzymają PEŁNĄ ŚCIEŻKĘ tekstem (Raport_Magazyn.kategoria =
    // „Inwentaryzacja Tygodniowa > Płyny"), a kolumna rodzic_id w starszych wpisach wskazuje
    // identyfikatory, których już nie ma. Źródłem prawdy jest więc `pelna_sciezka` — po niej
    // przepisujemy potomków i produkty, a rodzic_id przy okazji naprawiamy.
    } else if (action === 'rap_editCategory') {
      const id = String(d.id || '').trim();
      if (!id) return res.json({ status: 'error', message: 'Nie wskazano kategorii.' });
      const nowaNazwa = d.nazwa == null ? null : String(d.nazwa).trim();
      if (nowaNazwa !== null && (!nowaNazwa || nowaNazwa.includes('>'))) {
        return res.json({ status: 'error', message: 'Nazwa nie może być pusta ani zawierać znaku „>".' });
      }
      const zmianaRodzica = Object.prototype.hasOwnProperty.call(d, 'parentId');
      const parentId = zmianaRodzica ? String(d.parentId || '').trim() : null;

      db.query(`SELECT id, nazwa, rodzic_id, pelna_sciezka FROM Raport_Kategorie WHERE tenant_id = ? ORDER BY pelna_sciezka`, [tenant_id], (err, kategorie) => {
        if (err) return res.json({ status: 'error', message: err.message });
        const ta = (kategorie || []).find(k => String(k.id) === id);
        if (!ta) return res.json({ status: 'error', message: 'Nie znaleziono kategorii.' });

        const staraSciezka = String(ta.pelna_sciezka || ta.nazwa);
        const nazwa = nowaNazwa === null ? String(ta.nazwa) : nowaNazwa;
        let sciezkaRodzica;
        if (zmianaRodzica) {
          if (parentId && parentId === id) return res.json({ status: 'error', message: 'Kategoria nie może być swoim własnym rodzicem.' });
          const rodzic = parentId ? (kategorie || []).find(k => String(k.id) === parentId) : null;
          if (parentId && !rodzic) return res.json({ status: 'error', message: 'Nie znaleziono kategorii nadrzędnej.' });
          sciezkaRodzica = rodzic ? String(rodzic.pelna_sciezka || rodzic.nazwa) : '';
        } else {
          const i = staraSciezka.lastIndexOf(' > ');
          sciezkaRodzica = i < 0 ? '' : staraSciezka.slice(0, i);
        }
        const nowaSciezka = sciezkaRodzica ? sciezkaRodzica + ' > ' + nazwa : nazwa;

        if (nowaSciezka === staraSciezka) return res.json({ status: 'success', bez_zmian: true, sciezka: nowaSciezka });
        // przeniesienie pod własnego potomka zapętliłoby drzewo
        if ((nowaSciezka + ' > ').startsWith(staraSciezka + ' > ')) {
          return res.json({ status: 'error', message: 'Nie można przenieść kategorii do jej własnej podkategorii.' });
        }
        if ((kategorie || []).some(k => String(k.id) !== id && String(k.pelna_sciezka) === nowaSciezka)) {
          return res.json({ status: 'error', message: `Kategoria „${nowaSciezka}" już istnieje.` });
        }

        const przedrostek = staraSciezka + ' > ';
        const noweRodzicId = zmianaRodzica ? (parentId || '') : (ta.rodzic_id || '');
        db.getConnection((errC, conn) => {
          if (errC) return res.json({ status: 'error', message: errC.message });
          const koniec = (wynik) => { conn.release(); return res.json(wynik); };
          const odwolaj = (msg) => conn.rollback(() => koniec({ status: 'error', message: msg }));
          conn.beginTransaction((errT) => {
            if (errT) { conn.release(); return res.json({ status: 'error', message: errT.message }); }
            conn.query(`UPDATE Raport_Kategorie SET nazwa = ?, pelna_sciezka = ?, rodzic_id = ? WHERE tenant_id = ? AND id = ?`,
              [nazwa, nowaSciezka, noweRodzicId, tenant_id, id], (e1) => {
                if (e1) return odwolaj(e1.message);
                // potomkowie: przepisujemy tylko początek ścieżki, reszta zostaje nietknięta
                conn.query(`UPDATE Raport_Kategorie SET pelna_sciezka = CONCAT(?, SUBSTRING(pelna_sciezka, ?)) WHERE tenant_id = ? AND pelna_sciezka LIKE ?`,
                  [nowaSciezka + ' > ', przedrostek.length + 1, tenant_id, przedrostek + '%'], (e2, wPotomkowie) => {
                    if (e2) return odwolaj(e2.message);
                    conn.query(`UPDATE Raport_Magazyn SET kategoria = ? WHERE tenant_id = ? AND kategoria = ?`,
                      [nowaSciezka, tenant_id, staraSciezka], (e3, wProdukty) => {
                        if (e3) return odwolaj(e3.message);
                        conn.query(`UPDATE Raport_Magazyn SET kategoria = CONCAT(?, SUBSTRING(kategoria, ?)) WHERE tenant_id = ? AND kategoria LIKE ?`,
                          [nowaSciezka + ' > ', przedrostek.length + 1, tenant_id, przedrostek + '%'], (e4, wProduktyPod) => {
                            if (e4) return odwolaj(e4.message);
                            conn.commit((e5) => {
                              if (e5) return odwolaj(e5.message);
                              const ileProd = (wProdukty.affectedRows || 0) + (wProduktyPod.affectedRows || 0);
                              zapiszLog(tenant_id, 'MAGAZYN: KATEGORIA', d.pracownik, `„${staraSciezka}" → „${nowaSciezka}” (podkategorie: ${wPotomkowie.affectedRows || 0}, produkty: ${ileProd})`);
                              return koniec({ status: 'success', sciezka: nowaSciezka, podkategorie: wPotomkowie.affectedRows || 0, produkty: ileProd });
                            });
                          });
                      });
                  });
              });
          });
        });
      });

    } else if (action === 'rap_deleteCategory') {
      // Kasowanie sprawdza teraz, czy kategoria nie ma podkategorii i produktów — wcześniej
      // zostawiało sieroty: produkty ze ścieżką do nieistniejącej już kategorii.
      db.query(`SELECT id, nazwa, pelna_sciezka FROM Raport_Kategorie WHERE tenant_id = ? AND id = ? LIMIT 1`, [tenant_id, d.id], (errK, rowsK) => {
        if (errK) return res.json({ status: 'error', message: errK.message });
        if (!rowsK.length) return res.json({ status: 'error', message: 'Nie znaleziono kategorii' });
        const sciezka = String(rowsK[0].pelna_sciezka || rowsK[0].nazwa);
        db.query(`SELECT (SELECT COUNT(*) FROM Raport_Kategorie WHERE tenant_id = ? AND pelna_sciezka LIKE ?) AS dzieci,
                         (SELECT COUNT(*) FROM Raport_Magazyn WHERE tenant_id = ? AND (kategoria = ? OR kategoria LIKE ?)) AS produkty`,
          [tenant_id, sciezka + ' > %', tenant_id, sciezka, sciezka + ' > %'], (errC, rowsC) => {
            if (errC) return res.json({ status: 'error', message: errC.message });
            const { dzieci, produkty } = rowsC[0];
            if ((dzieci || produkty) && !d.force) {
              // polska odmiana: 1 produkt · 2–4 produkty · 5+ produktów (to samo dla podkategorii)
              const lm = (n, jeden, kilka, wiele) => (n === 1 ? jeden : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? kilka : wiele));
              const co = [dzieci ? `${dzieci} ${lm(dzieci, 'podkategorię', 'podkategorie', 'podkategorii')}` : null,
                          produkty ? `${produkty} ${lm(produkty, 'produkt', 'produkty', 'produktów')}` : null].filter(Boolean).join(' i ');
              return res.json({ status: 'error', code: 'NIEPUSTA', dzieci, produkty, message: `Kategoria „${sciezka}" zawiera ${co}. Przenieś je albo zmień nazwę kategorii zamiast kasować.` });
            }
            db.query(`DELETE FROM Raport_Kategorie WHERE tenant_id = ? AND id = ? LIMIT 1`, [tenant_id, d.id], (err, result) => {
              if (err) return res.json({ status: 'error', message: err.message });
              if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono kategorii' });
              zapiszLog(tenant_id, 'MAGAZYN: KATEGORIA', d.pracownik, `usunięto „${sciezka}"`);
              return res.json({ status: 'success' });
            });
          });
      });

    } else if (action === 'rap_getHidden') {
      db.query(
        `SELECT produkt_id FROM Raport_Wycofane_Zamowienia WHERE tenant_id = ?`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'success', data: [] });
          return res.json({ status: 'success', data: (rows || []).map(r => r.produkt_id) });
        }
      );

    } else if (action === 'rap_hideReorder') {
      if (!d.id) return res.json({ status: 'error', message: 'Brak id produktu.' });
      db.query(
        `INSERT INTO Raport_Wycofane_Zamowienia (tenant_id, produkt_id, kto, data)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE kto = VALUES(kto), data = VALUES(data)`,
        [tenant_id, String(d.id), d.userFull || ''],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          rap_logAction(tenant_id, 'WYCOFANIE Z ZAMOWIEN', d.nazwa || String(d.id), 'Nie zamawiamy ponownie', d.userFull);
          return res.json({ status: 'success' });
        }
      );

    } else if (action === 'rap_unhideReorder') {
      if (!d.id) return res.json({ status: 'error', message: 'Brak id produktu.' });
      db.query(
        `DELETE FROM Raport_Wycofane_Zamowienia WHERE tenant_id = ? AND produkt_id = ?`,
        [tenant_id, String(d.id)],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          rap_logAction(tenant_id, 'PRZYWROCENIE DO ZAMOWIEN', d.nazwa || String(d.id), 'Znow zamawiamy', d.userFull);
          return res.json({ status: 'success' });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja raport POST: ' + action });
    }
  });

  return router;
};
