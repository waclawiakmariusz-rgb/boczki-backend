// routes/sprzedaz.js
// Sprzedaż: sales_history, full_sales_history, sales_dictionary, add_sale, edit_sale, delete_sale,
//           add_sales_def, add_multi_sale, emergency_edit_sale, get_discounts, add_discount_def

const express = require('express');
const { parseKwota, parseIlosc, parseNumOpt } = require('./utils');
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');

module.exports = (db) => {
  const router = express.Router();
  const zapiszLog = makeZapiszLog(db);

  // ==========================================
  // Helper: pobierz FIFO i zdejmij ze stanu
  // ==========================================
  function zdejmijZeStanuFIFO(tenant_id, nazwa, ilosc, pracownik, callback) {
    db.query(
      `SELECT id, ilosc, data_waznosci FROM Magazyn WHERE tenant_id = ? AND nazwa_produktu = ? AND kategoria = 'Detal' AND ilosc > 0 ORDER BY data_waznosci ASC`,
      [tenant_id, nazwa],
      (err, rows) => {
        if (err) return callback(err);
        const totalDost = rows.reduce((s, r) => s + parseFloat(r.ilosc), 0);
        if (totalDost < parseFloat(ilosc)) return callback(new Error('Za mało towaru!'));
        let rem = parseFloat(ilosc);
        let logParts = '';
        let idx = 0;
        function next() {
          if (rem <= 0 || idx >= rows.length) {
            zapiszLog(tenant_id, 'SPRZEDAŻ DETAL', Array.isArray(pracownik) ? pracownik.join(',') : pracownik, `${nazwa}: ${logParts}`);
            return callback(null);
          }
          const row = rows[idx++];
          const stara = parseFloat(row.ilosc);
          const v = Math.min(stara, rem);
          rem -= v;
          logParts += `[ID:${row.id} -${v}] `;
          db.query(`UPDATE Magazyn SET ilosc = ? WHERE tenant_id = ? AND id = ?`, [stara - v, tenant_id, row.id], (updErr) => {
            if (updErr) return callback(updErr);
            next();
          });
        }
        next();
      }
    );
  }

  // ==========================================
  // Helper: parsuj pozycję sprzedaży kosmetyku
  // Format: zabieg = "Kosmetyk: NAZWA", szczegoly = "X szt." (lub "X,5 szt.")
  // Zwraca {nazwa, ilosc} lub null jeśli to nie kosmetyk.
  // ==========================================
  function parsujKosmetyk(zabieg, szczegoly) {
    const z = String(zabieg || '');
    const s = String(szczegoly || '');
    if (!z.toLowerCase().startsWith('kosmetyk:')) return null;
    const nazwa = z.replace(/^[Kk]osmetyk:\s*/, '').trim();
    const m = s.match(/(\d+(?:[.,]\d+)?)\s*szt/i);
    const il = m ? parseFloat(m[1].replace(',', '.')) : 0;
    if (!nazwa || !(il > 0)) return null;
    return { nazwa, ilosc: il };
  }

  // ==========================================
  // Helper: przywróć ilość kosmetyku do magazynu (dodaje do najstarszej partii FIFO)
  // Używany przy delete_sale i edit_sale gdy zmniejsza się ilość lub zmienia produkt.
  // ==========================================
  function przywrocDoMagazynu(tenant_id, nazwa, ilosc, pracownik, callback) {
    const il = parseFloat(String(ilosc).replace(',', '.'));
    if (!nazwa || !(il > 0)) return callback(null);
    db.query(
      `SELECT id, ilosc FROM Magazyn WHERE tenant_id = ? AND nazwa_produktu = ? AND kategoria = 'Detal' ORDER BY data_waznosci ASC LIMIT 1`,
      [tenant_id, nazwa],
      (err, rows) => {
        if (err) return callback(err);
        if (rows.length === 0) {
          // Brak partii — nie tworzymy nowej (wymagałoby data_waznosci, cen, typu).
          // Logujemy ostrzeżenie żeby admin mógł ręcznie utworzyć partię.
          zapiszLog(tenant_id, 'OSTRZEŻENIE STANU', pracownik || 'System',
            `Nie udało się przywrócić ${il} szt. produktu "${nazwa}" — brak partii w magazynie. Dodaj partię ręcznie.`);
          return callback(null);
        }
        const r = rows[0];
        const nowa = parseFloat(r.ilosc) + il;
        db.query(
          `UPDATE Magazyn SET ilosc = ? WHERE tenant_id = ? AND id = ?`,
          [nowa, tenant_id, r.id],
          (uErr) => {
            if (uErr) return callback(uErr);
            zapiszLog(tenant_id, 'PRZYWRÓCENIE STANU', pracownik || 'System',
              `${nazwa}: +${il} szt. (partia ID:${r.id}, było ${r.ilosc} → ${nowa})`);
            callback(null);
          }
        );
      }
    );
  }

  // Helper: rozlicz zadatek automatycznie
  function rozliczZadatekAutomatycznie(tenant_id, klientId, klientNazwa, kwotaDoPobrania, konkretneIdZadatku, pracownik, callback) {
    db.query(
      `SELECT id, klient, kwota, cel FROM Zadatki WHERE tenant_id = ? AND typ = 'WPŁATA' AND (status = 'AKTYWNY' OR status IS NULL) AND (id_klienta = ? OR LOWER(klient) = LOWER(?)) ORDER BY data_wplaty ASC`,
      [tenant_id, klientId || '', klientNazwa || ''],
      (err, rows) => {
        if (err || !rows.length) return callback && callback();
        let pozostalo = parseFloat(kwotaDoPobrania);
        let dozwoloneId = konkretneIdZadatku ? String(konkretneIdZadatku).split(',') : [];
        let idx = 0;
        function next() {
          if (pozostalo <= 0 || idx >= rows.length) return callback && callback();
          const row = rows[idx++];
          if (dozwoloneId.length > 0 && !dozwoloneId.includes(String(row.id))) return next();
          const dostepne = parseFloat(row.kwota);
          if (dostepne <= pozostalo) {
            db.query(`UPDATE Zadatki SET status = 'WYKORZYSTANY' WHERE tenant_id = ? AND id = ?`, [tenant_id, row.id], () => {
              zapiszLog(tenant_id, 'UŻYCIE ZADATKU', pracownik, `Wykorzystano całość: ${dostepne.toFixed(2)} zł | Klient: ${row.klient} | Cel: ${row.cel} | ID: ${row.id}`);
              pozostalo -= dostepne;
              next();
            });
          } else {
            const reszta = dostepne - pozostalo;
            const idReszty = 'DEP-REST-' + Date.now() + '-' + randomUUID().slice(0, 6);
            db.query(`UPDATE Zadatki SET status = 'WYKORZYSTANY' WHERE tenant_id = ? AND id = ?`, [tenant_id, row.id], (errUpd) => {
              if (errUpd) {
                console.error('[rozliczZadatek] UPDATE failed:', errUpd.message);
                return callback && callback();
              }
              db.query(
                `INSERT INTO Zadatki (id, tenant_id, id_klienta, data_wplaty, klient, typ, kwota, metoda, cel, status) VALUES (?, ?, ?, NOW(), ?, 'WPŁATA', ?, 'System', ?, 'AKTYWNY')`,
                [idReszty, tenant_id, klientId || '', klientNazwa, reszta, 'Reszta z: ' + row.cel],
                (errIns) => {
                  if (errIns) {
                    console.error('[rozliczZadatek] INSERT reszta failed:', errIns.message);
                    // Cofnij oznaczenie jako WYKORZYSTANY — zadatek wraca jako aktywny
                    db.query(`UPDATE Zadatki SET status = 'AKTYWNY' WHERE tenant_id = ? AND id = ?`, [tenant_id, row.id], () => {});
                    return callback && callback();
                  }
                  zapiszLog(tenant_id, 'UŻYCIE ZADATKU', pracownik, `Wykorzystano częściowo: ${pozostalo.toFixed(2)} zł (Zostało: ${reszta.toFixed(2)} zł) | Klient: ${row.klient}`);
                  pozostalo = 0;
                  next();
                }
              );
            });
          }
        }
        next();
      }
    );
  }

  // ==========================================
  // GET /sprzedaz
  // ==========================================
  router.get('/sprzedaz', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'sales_history') {
      const today = new Date().toISOString().slice(0, 10);
      db.query(
        `SELECT id, data_sprzedazy, TIME_FORMAT(data_sprzedazy, '%H:%i') as czas_sprzedazy, klient, zabieg, sprzedawca, kwota, komentarz, szczegoly, platnosc, id_klienta FROM Sprzedaz WHERE tenant_id = ? AND DATE(data_sprzedazy) = ? AND COALESCE(status, '') != 'USUNIĘTY' ORDER BY data_sprzedazy DESC LIMIT 50`,
        [tenant_id, today],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json(rows.map(r => ({
            id: r.id, data: r.data_sprzedazy, czas: r.czas_sprzedazy, klient: r.klient, zabieg: r.zabieg,
            sprzedawca: r.sprzedawca, kwota: r.kwota, komentarz: r.komentarz,
            szczegoly: r.szczegoly, platnosc: r.platnosc, id_klienta: r.id_klienta
          })));
        }
      );

    } else if (action === 'full_sales_history') {
      db.query(
        `SELECT id, data_sprzedazy, klient, zabieg, sprzedawca, kwota, komentarz, szczegoly, platnosc, id_klienta FROM Sprzedaz WHERE tenant_id = ? AND COALESCE(status, '') != 'USUNIĘTY' ORDER BY data_sprzedazy DESC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json(rows.map(r => ({
            data: r.data_sprzedazy, id: r.id, klient: r.klient, zabieg: r.zabieg,
            sprzedawca: r.sprzedawca, kwota: r.kwota, komentarz: r.komentarz,
            szczegoly: r.szczegoly, platnosc: r.platnosc, id_klienta: r.id_klienta
          })));
        }
      );

    } else if (action === 'sales_dictionary') {
      // Pracownicy + Uslugi
      db.query(`SELECT imie FROM Pracownicy WHERE tenant_id = ? ORDER BY imie`, [tenant_id], (err1, pracownicy) => {
        db.query(`SELECT kategoria, wariant, cena FROM Uslugi WHERE tenant_id = ? ORDER BY kategoria, wariant`, [tenant_id], (err2, uslugi) => {
          const pr = (pracownicy || []).map(r => r.imie).filter(Boolean);
          const zb = (uslugi || []).map(r => ({ kategoria: r.kategoria, wariant: r.wariant, cena: r.cena }));
          return res.json({ pracownicy: pr.sort(), zabiegi: zb });
        });
      });

    } else if (action === 'get_discounts') {
      db.query(
        `SELECT nazwa, typ, wartosc FROM Rabaty WHERE tenant_id = ? AND UPPER(aktywny) = 'TAK'`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json(rows.map(r => ({ nazwa: r.nazwa, typ: r.typ, wartosc: parseFloat(r.wartosc) })));
        }
      );

    } else if (action === 'emergency_history') {
      const limit35 = new Date();
      limit35.setDate(limit35.getDate() - 35);
      db.query(
        `SELECT id, data_sprzedazy, klient, zabieg, sprzedawca, kwota, komentarz, szczegoly, platnosc, id_klienta, pracownik_dodajacy, czy_rozliczone FROM Sprzedaz WHERE tenant_id = ? AND COALESCE(status, '') != 'USUNIĘTY' AND data_sprzedazy >= ? ORDER BY data_sprzedazy DESC`,
        [tenant_id, limit35.toISOString().slice(0, 10)],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json(rows.map(r => ({
            id: r.id, data: r.data_sprzedazy, klient: r.klient, zabieg: r.zabieg,
            sprzedawca: r.sprzedawca, kwota: r.kwota, komentarz: r.komentarz,
            szczegoly: r.szczegoly, platnosc: r.platnosc, id_klienta: r.id_klienta,
            kto_dodal: r.pracownik_dodajacy, rozliczone: r.czy_rozliczone ? true : false
          })));
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET sprzedaz: ' + action });
    }
  });

  // ==========================================
  // POST /sprzedaz
  // ==========================================
  router.post('/sprzedaz', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    // --- ADD_SALE ---
    if (action === 'add_sale') {
      const now = new Date();
      const sprzedawca = Array.isArray(d.sprzedawca) ? d.sprzedawca.join(', ') : d.sprzedawca;
      const uniqueId = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 15);

      let _kwotaAdd;
      try { _kwotaAdd = parseKwota(d.kwota, 'kwota'); } catch (e) { return res.json({ status: 'error', message: e.message }); }

      const doInsert = () => {
        // Snapshot typu zabiegu — best-effort lookup w Uslugi.
        // Próby (kolejno): exact CONCAT(kategoria,' ',wariant), exact kategoria, prefix.
        // Dla Kosmetyków NULL (osobny box w profilu).
        const insertWithTyp = (typZab) => {
          db.query(
            `INSERT INTO Sprzedaz (id, tenant_id, data_sprzedazy, klient, zabieg, sprzedawca, kwota, komentarz, szczegoly, status, platnosc, id_klienta, pracownik_dodajacy, typ_zabiegu) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTYWNY', ?, ?, ?, ?)`,
            [uniqueId, tenant_id, now, d.klient, d.zabieg_nazwa, sprzedawca, _kwotaAdd, d.komentarz || '', d.szczegoly || '', d.platnosc || '', d.id_klienta || '', d.pracownik || '', typZab],
            (err) => {
              if (err) return res.json({ status: 'error', message: err.message });
              zapiszLog(tenant_id, 'SPRZEDAŻ', sprzedawca, `${d.klient} | ${d.zabieg_nazwa} | ${d.kwota} zł`);
              return res.json({ status: 'success', message: 'Sprzedaż zarejestrowana!' });
            }
          );
        };
        if (d.typ_transakcji === 'Kosmetyk') {
          return insertWithTyp(null);
        }
        const nazwa = String(d.zabieg_nazwa || '').trim();
        db.query(
          `SELECT typ_zabiegu FROM Uslugi
             WHERE tenant_id = ?
               AND (TRIM(CONCAT(kategoria,' ',COALESCE(wariant,''))) = TRIM(?)
                    OR TRIM(kategoria) = TRIM(?))
             ORDER BY (TRIM(CONCAT(kategoria,' ',COALESCE(wariant,''))) = TRIM(?)) DESC
             LIMIT 1`,
          [tenant_id, nazwa, nazwa, nazwa],
          (errL, rowsL) => {
            const typZab = (rowsL && rowsL[0] && rowsL[0].typ_zabiegu) || null;
            insertWithTyp(typZab);
          }
        );
      };

      if (d.typ_transakcji === 'Kosmetyk') {
        zdejmijZeStanuFIFO(tenant_id, d.produkt_nazwa, d.ilosc_sztuk, d.sprzedawca, (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          doInsert();
        });
      } else {
        doInsert();
      }

    // --- ADD_MULTI_SALE ---
    } else if (action === 'add_multi_sale') {
      const now = new Date();
      const sprzedawcyStr = Array.isArray(d.sprzedawca) ? d.sprzedawca.join(', ') : d.sprzedawca;
      const uniqueIdBase = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 15);

      // Rozlicz zadatki portfela — grupuj po depositId żeby uniknąć podwójnego rozliczenia
      // (frontend dzieli jeden zadatek na wiele pozycji, co przy sekwencyjnych wywołaniach
      //  powoduje że drugi call nie może znaleźć już WYKORZYSTANEGO oryginału)
      const depositSumy = {};
      (d.pozycje || []).forEach(p => {
        if ((p.platnosc === 'Portfel' || p.platnosc === 'Zadatek') && parseFloat(p.kwota) > 0) {
          const key = p.depositId || '__bez_id__';
          depositSumy[key] = (depositSumy[key] || 0) + parseFloat(p.kwota);
        }
      });
      const pozycjePortfel = Object.entries(depositSumy).map(([depositId, kwota]) => ({
        depositId: depositId === '__bez_id__' ? null : depositId,
        kwota
      }));
      let portfelIdx = 0;
      function rozliczPortfele() {
        if (portfelIdx >= pozycjePortfel.length) return zapiszPozycje();
        const p = pozycjePortfel[portfelIdx++];
        rozliczZadatekAutomatycznie(tenant_id, d.id_klienta, d.klient, p.kwota, p.depositId, sprzedawcyStr, rozliczPortfele);
      }

      function zapiszSplit(callback) {
        if (!d.split_breakdown || !Array.isArray(d.split_breakdown)) return callback();
        let si = 0;
        function nextSplit() {
          if (si >= d.split_breakdown.length) return callback();
          const part = d.split_breakdown[si++];
          const splitId = uniqueIdBase + '-SPLIT-' + si;
          db.query(
            `INSERT INTO Platnosci (id, tenant_id, data_platnosci, klient, metoda_platnosci, kwota, status) VALUES (?, ?, ?, ?, ?, ?, 'AKTYWNY')`,
            [splitId, tenant_id, now, d.klient || '', part.method || '', parseFloat(part.amount) || 0],
            nextSplit
          );
        }
        nextSplit();
      }

      function zapiszPozycje() {
        const pozycje = d.pozycje || [];
        let idx = 0;
        function nextPoz() {
          if (idx >= pozycje.length) {
            zapiszLog(tenant_id, 'MULTI-SPRZEDAŻ', sprzedawcyStr, `Klient: ${d.klient} | ${pozycje.length} pozycji`);
            return res.json({ status: 'success', message: 'Zarejestrowano sprzedaż!' });
          }
          const poz = pozycje[idx++];
          const uniqueId = uniqueIdBase + '-' + idx;
          let zapisKategoria = poz.kategoria;
          let zapisSzczegoly = poz.wariant || '';
          if (poz.typ === 'Kosmetyk') {
            zapisKategoria = 'Kosmetyk: ' + poz.nazwa_produktu;
            zapisSzczegoly = poz.ilosc + ' szt.';
          }
          let idZadatkuLog = '';
          if (poz.platnosc === 'Portfel' || poz.platnosc === 'Zadatek') idZadatkuLog = poz.depositId || '';

          let _kwotaPoz;
          try { _kwotaPoz = parseKwota(poz.kwota, 'kwota pozycji'); } catch (e) { return res.json({ status: 'error', message: e.message }); }

          // Snapshot typu zabiegu — lookup w Uslugi po (kategoria, wariant).
          // Dla Kosmetyków typ_zabiegu pozostaje NULL (mają osobny box w profilu klienta).
          const doInsertPoz = () => {
            const insertWithTyp = (typZab) => {
              db.query(
                `INSERT INTO Sprzedaz (id, tenant_id, data_sprzedazy, klient, zabieg, sprzedawca, kwota, komentarz, szczegoly, status, platnosc, id_klienta, pracownik_dodajacy, id_zadatku, typ_zabiegu) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTYWNY', ?, ?, ?, ?, ?)`,
                [uniqueId, tenant_id, now, d.klient, zapisKategoria, sprzedawcyStr, _kwotaPoz, poz.komentarz || '', zapisSzczegoly, poz.platnosc || '', d.id_klienta || '', d.pracownik || '', idZadatkuLog, typZab],
                nextPoz
              );
            };
            if (poz.typ === 'Kosmetyk') {
              return insertWithTyp(null);
            }
            db.query(
              `SELECT typ_zabiegu FROM Uslugi WHERE tenant_id = ? AND TRIM(kategoria) = TRIM(?) AND TRIM(COALESCE(wariant,'')) = TRIM(?) LIMIT 1`,
              [tenant_id, poz.kategoria || '', poz.wariant || ''],
              (errL, rowsL) => {
                const typZab = (rowsL && rowsL[0] && rowsL[0].typ_zabiegu) || null;
                insertWithTyp(typZab);
              }
            );
          };

          if (poz.typ === 'Kosmetyk') {
            zdejmijZeStanuFIFO(tenant_id, poz.nazwa_produktu, poz.ilosc, sprzedawcyStr, (err) => {
              if (err) return res.json({ status: 'error', message: 'Błąd magazynu: ' + err.message });
              doInsertPoz();
            });
          } else {
            doInsertPoz();
          }
        }
        nextPoz();
      }

      zapiszSplit(() => rozliczPortfele());

    // --- EDIT_SALE ---
    } else if (action === 'edit_sale') {
      let _kwotaEdit;
      try { _kwotaEdit = parseKwota(d.kwota, 'kwota'); } catch (e) { return res.json({ status: 'error', message: e.message }); }

      db.query(
        `SELECT klient, zabieg, sprzedawca, kwota, komentarz, szczegoly, platnosc, id_klienta, czy_rozliczone FROM Sprzedaz WHERE tenant_id = ? AND id = ?`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono transakcji o ID: ' + d.id });
          if (tenant_id === 'boczki-salon-glowny-001' && rows[0].czy_rozliczone) {
            return res.json({ status: 'error', message: 'Transakcja jest już rozliczona przez Magdę. Cofnij rozliczenie przed edycją.' });
          }
          const old = rows[0];
          const newSprzedawca = Array.isArray(d.sprzedawca) ? d.sprzedawca.join(', ') : d.sprzedawca;
          let zmiany = [];
          if (String(old.sprzedawca) !== String(newSprzedawca)) zmiany.push(`Sprzedawca: ${old.sprzedawca} -> ${newSprzedawca}`);
          if (String(old.klient) !== String(d.klient)) zmiany.push(`Klient: ${old.klient} -> ${d.klient}`);
          if (d.id_klienta && String(old.id_klienta) !== String(d.id_klienta)) zmiany.push(`ID Klienta: ${old.id_klienta} -> ${d.id_klienta}`);
          if (String(old.zabieg) !== String(d.zabieg_nazwa)) zmiany.push(`Usługa: ${old.zabieg} -> ${d.zabieg_nazwa}`);
          if (Number(old.kwota).toFixed(2) !== Number(d.kwota).toFixed(2)) zmiany.push(`Kwota: ${old.kwota} -> ${d.kwota}`);
          if (String(old.szczegoly) !== String(d.szczegoly)) zmiany.push(`Szczegóły: ${old.szczegoly} -> ${d.szczegoly}`);
          if (String(old.platnosc) !== String(d.platnosc)) zmiany.push(`Płatność: ${old.platnosc} -> ${d.platnosc}`);

          // Magazyn — różnicowa korekta gdy edycja dotyczy kosmetyku
          const stary = parsujKosmetyk(old.zabieg, old.szczegoly);
          const nowy = parsujKosmetyk(d.zabieg_nazwa, d.szczegoly);

          // Pre-check: czy nowa pozycja kosmetyku ma pokrycie w magazynie
          const sprawdzDostepnoscNowego = (cb) => {
            if (!nowy) return cb(null);
            // Ten sam produkt, mniejsza/równa ilość — bez sprawdzania (zwracamy nadmiar)
            if (stary && stary.nazwa === nowy.nazwa && nowy.ilosc <= stary.ilosc) return cb(null);
            // Inaczej musimy zdjąć dodatkową ilość (różnicę lub całość nowego produktu)
            const doZdjecia = (stary && stary.nazwa === nowy.nazwa)
              ? (nowy.ilosc - stary.ilosc)   // ten sam produkt, większa ilość
              : nowy.ilosc;                  // inny produkt → cała nowa ilość
            db.query(
              `SELECT SUM(ilosc) AS total FROM Magazyn WHERE tenant_id = ? AND nazwa_produktu = ? AND kategoria = 'Detal' AND ilosc > 0`,
              [tenant_id, nowy.nazwa],
              (sErr, sRows) => {
                if (sErr) return cb(sErr);
                const totalDost = parseFloat((sRows[0] || {}).total || 0);
                if (totalDost < doZdjecia) {
                  return cb(new Error(`Za mało towaru "${nowy.nazwa}" w magazynie (dostępne: ${totalDost}, potrzeba: ${doZdjecia})`));
                }
                cb(null);
              }
            );
          };

          sprawdzDostepnoscNowego((checkErr) => {
            if (checkErr) return res.json({ status: 'error', message: checkErr.message });

            // Re-lookup typu zabiegu jeśli zmieniła się nazwa zabiegu (snapshot)
            const updateSale = (typZab) => {
              const fields = ['klient = ?', 'zabieg = ?', 'sprzedawca = ?', 'kwota = ?', 'komentarz = ?', 'szczegoly = ?', 'platnosc = ?', 'id_klienta = ?'];
              const vals = [d.klient, d.zabieg_nazwa, newSprzedawca, _kwotaEdit, d.komentarz || '', d.szczegoly || '', d.platnosc || '', d.id_klienta || ''];
              if (typZab !== undefined) { fields.push('typ_zabiegu = ?'); vals.push(typZab); }
              vals.push(tenant_id, d.id);
              db.query(
                `UPDATE Sprzedaz SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`,
                vals,
                (err2) => {
                  if (err2) return res.json({ status: 'error', message: err2.message });
                  zapiszLog(tenant_id, 'EDYCJA SPRZEDAŻY', d.pracownik, zmiany.length > 0 ? zmiany.join(' | ') : 'Edycja danych (bez kluczowych zmian)');

                // Korekta magazynu — po pomyślnym UPDATE
                const finish = () => res.json({ status: 'success', message: 'Zaktualizowano transakcję!' });

                if (stary && nowy && stary.nazwa === nowy.nazwa) {
                  // Ten sam produkt, różnica ilości
                  const diff = nowy.ilosc - stary.ilosc;
                  if (diff > 0) {
                    zdejmijZeStanuFIFO(tenant_id, nowy.nazwa, diff, d.pracownik, () => finish());
                  } else if (diff < 0) {
                    przywrocDoMagazynu(tenant_id, nowy.nazwa, -diff, d.pracownik, () => finish());
                  } else {
                    finish();
                  }
                } else {
                  // Zmiana produktu / typu — zwróć stary, zdejmij nowy (oba mogą być null)
                  const krok2 = () => {
                    if (nowy) {
                      zdejmijZeStanuFIFO(tenant_id, nowy.nazwa, nowy.ilosc, d.pracownik, () => finish());
                    } else {
                      finish();
                    }
                  };
                  if (stary) {
                    przywrocDoMagazynu(tenant_id, stary.nazwa, stary.ilosc, d.pracownik, () => krok2());
                  } else {
                    krok2();
                  }
                }
              }
            );
            };

            // Wywołanie updateSale: jeśli zmieniła się nazwa zabiegu — re-lookup typu, inaczej zostaw bez zmian
            if (String(old.zabieg) !== String(d.zabieg_nazwa)) {
              if (nowy !== null) {
                // Kosmetyk → typ_zabiegu = NULL (osobny box w profilu klienta)
                updateSale(null);
              } else {
                const nazwa = String(d.zabieg_nazwa || '').trim();
                db.query(
                  `SELECT typ_zabiegu FROM Uslugi
                     WHERE tenant_id = ?
                       AND (TRIM(CONCAT(kategoria,' ',COALESCE(wariant,''))) = TRIM(?)
                            OR TRIM(kategoria) = TRIM(?))
                     ORDER BY (TRIM(CONCAT(kategoria,' ',COALESCE(wariant,''))) = TRIM(?)) DESC
                     LIMIT 1`,
                  [tenant_id, nazwa, nazwa, nazwa],
                  (errL, rowsL) => {
                    const typZab = (rowsL && rowsL[0] && rowsL[0].typ_zabiegu) || null;
                    updateSale(typZab);
                  }
                );
              }
            } else {
              updateSale(undefined); // typ_zabiegu nie zmieniany
            }
          });
        }
      );

    // --- DELETE_SALE ---
    } else if (action === 'delete_sale') {
      const pracownik = d.pracownik || 'Admin';
      db.query(
        `SELECT klient, zabieg, kwota, id_zadatku, czy_rozliczone, szczegoly FROM Sprzedaz WHERE tenant_id = ? AND id = ?`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono transakcji o takim ID.' });
          if (tenant_id === 'boczki-salon-glowny-001' && rows[0].czy_rozliczone) {
            return res.json({ status: 'error', message: 'Transakcja jest już rozliczona przez Magdę. Cofnij rozliczenie przed usunięciem.' });
          }
          const row = rows[0];
          db.query(
            `UPDATE Sprzedaz SET status = 'USUNIĘTY' WHERE tenant_id = ? AND id = ?`,
            [tenant_id, d.id],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              zapiszLog(tenant_id, 'USUNIĘCIE SPRZEDAŻY', pracownik, `Klient: ${row.klient} | Usługa: ${row.zabieg} | Kwota: ${row.kwota} zł | ID: ${d.id}`);

              // Przywrócenie stanu magazynu, jeśli to była sprzedaż kosmetyku
              const kosm = parsujKosmetyk(row.zabieg, row.szczegoly);
              if (kosm) {
                przywrocDoMagazynu(tenant_id, kosm.nazwa, kosm.ilosc, pracownik, () => {});
              }

              // Auto-zwrot zadatku
              let restoreMsg = '';
              if (row.id_zadatku) {
                const idsToRestore = String(row.id_zadatku).split(',').filter(Boolean);
                if (idsToRestore.length > 0) {
                  db.query(
                    `UPDATE Zadatki SET status = 'AKTYWNY' WHERE tenant_id = ? AND id IN (?)`,
                    [tenant_id, idsToRestore],
                    (err3, result3) => {
                      if (!err3 && result3.affectedRows > 0) {
                        zapiszLog(tenant_id, 'AUTO-ZWROT ZADATKU', 'System', `Przywrócono zadatek po usunięciu sprzedaży ${d.id}`);
                        restoreMsg = '\n Zadatek wrócił na konto klienta!';
                      }
                    }
                  );
                }
              }

              // Oznacz platnosci mix
              let parts = String(d.id).split('-');
              if (parts.length >= 2) {
                parts.pop();
                const baseId = parts.join('-');
                db.query(
                  `UPDATE Platnosci SET status = 'USUNIĘTY' WHERE tenant_id = ? AND id LIKE ?`,
                  [tenant_id, '%' + baseId + '%'],
                  () => {}
                );
              }

              return res.json({ status: 'success', message: 'Transakcja pomyślnie usunięta.' + restoreMsg });
            }
          );
        }
      );

    // --- EMERGENCY_EDIT_SALE ---
    } else if (action === 'emergency_edit_sale') {
      let _kwotaEmerg;
      try { _kwotaEmerg = parseKwota(d.kwota, 'kwota'); } catch (e) { return res.json({ status: 'error', message: e.message }); }

      db.query(
        `SELECT klient, zabieg, sprzedawca, kwota, platnosc, czy_rozliczone FROM Sprzedaz WHERE tenant_id = ? AND id = ?`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono ID' });
          if (tenant_id === 'boczki-salon-glowny-001' && rows[0].czy_rozliczone) {
            return res.json({ status: 'error', message: 'Transakcja jest już rozliczona przez Magdę. Cofnij rozliczenie przed edycją.' });
          }
          const row = rows[0];
          const nowySprzedawca = Array.isArray(d.sprzedawca) ? d.sprzedawca.join(', ') : d.sprzedawca;
          let logSzczegoly = [];
          const snapshot = `[PRZED]: Klient: ${row.klient}, Usługa: ${row.zabieg}, Kwota: ${row.kwota}, Sprzedawca: ${row.sprzedawca}, Płatność: ${row.platnosc}`;
          if (String(row.klient) !== String(d.klient)) logSzczegoly.push(`KLIENT: ${row.klient} >> ${d.klient}`);
          if (String(row.zabieg) !== String(d.zabieg_nazwa)) logSzczegoly.push(`USŁUGA: ${row.zabieg} >> ${d.zabieg_nazwa}`);
          if (String(row.sprzedawca) !== String(nowySprzedawca)) logSzczegoly.push(`SPRZEDAWCA: ${row.sprzedawca} >> ${nowySprzedawca}`);
          if (Number(row.kwota) !== Number(d.kwota)) logSzczegoly.push(`KWOTA: ${row.kwota} >> ${d.kwota}`);
          if (String(row.platnosc) !== String(d.platnosc)) logSzczegoly.push(`PŁATNOŚĆ: ${row.platnosc} >> ${d.platnosc}`);

          db.query(
            `UPDATE Sprzedaz SET klient = ?, zabieg = ?, sprzedawca = ?, kwota = ?, komentarz = ?, szczegoly = ?, platnosc = ?, id_klienta = ? WHERE tenant_id = ? AND id = ?`,
            [d.klient, d.zabieg_nazwa, nowySprzedawca, _kwotaEmerg, d.komentarz || '', d.szczegoly || '', d.platnosc || '', d.id_klienta || '', tenant_id, d.id],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              zapiszLog(tenant_id, 'AWARIA EDYCJA', d.pracownik, `ALARMOWA MODYFIKACJA ID:${d.id} | ZMIANY: ${logSzczegoly.join(' || ')} | ${snapshot}`);
              return res.json({ status: 'success', message: 'KOREKTA ZAPISANA. ZDARZENIE ZALOGOWANE.' });
            }
          );
        }
      );

    // --- ADD_SALES_DEF ---
    } else if (action === 'add_sales_def') {
      if (d.typ === 'Pracownik') {
        const id = randomUUID();
        db.query(`INSERT INTO Pracownicy (id, tenant_id, imie) VALUES (?, ?, ?)`, [id, tenant_id, d.wartosc], (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          zapiszLog(tenant_id, 'DODANO PRACOWNIKA', d.pracownik, d.wartosc);
          return res.json({ status: 'success', message: 'Dodano pomyślnie!' });
        });
      } else {
        const id = randomUUID();
        const typZabiegu = d.typ_zabiegu ? String(d.typ_zabiegu).trim().toLowerCase().slice(0, 80) : null;
        db.query(`INSERT INTO Uslugi (id, tenant_id, kategoria, wariant, cena, typ_zabiegu) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, tenant_id, d.kategoria, d.wariant, d.cena ? parseNumOpt(d.cena) : null, typZabiegu],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'DODANO ZABIEG', d.pracownik, `${d.kategoria} ${d.wariant} (${d.cena} zł)${typZabiegu ? ' [typ: ' + typZabiegu + ']' : ''}`);
            return res.json({ status: 'success', message: 'Dodano pomyślnie!' });
          }
        );
      }

    // --- ADD_DISCOUNT_DEF ---
    } else if (action === 'add_discount_def') {
      const id = randomUUID();
      db.query(
        `INSERT INTO Rabaty (id, tenant_id, nazwa, typ, wartosc, aktywny, data_dodania, kto_dodal) VALUES (?, ?, ?, ?, ?, 'TAK', NOW(), ?)`,
        [id, tenant_id, d.nazwa || '', d.typ || '', parseNumOpt(d.wartosc) || 0, d.pracownik || ''],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          zapiszLog(tenant_id, 'DODANO RABAT', d.pracownik, `${d.nazwa} (${d.wartosc} ${d.typ})`);
          return res.json({ status: 'success', message: 'Dodano nowy rabat!' });
        }
      );

    // --- DELETE_EMPLOYEE ---
    } else if (action === 'delete_employee') {
      db.query(`DELETE FROM Pracownicy WHERE tenant_id = ? AND imie = ? LIMIT 1`, [tenant_id, d.imie], (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        zapiszLog(tenant_id, 'USUNIĘCIE PRACOWNIKA', d.pracownik, d.imie);
        return res.json({ status: 'success', message: 'Usunięto' });
      });

    // --- DELETE_SERVICE ---
    } else if (action === 'delete_service') {
      db.query(
        `DELETE FROM Uslugi WHERE tenant_id = ? AND TRIM(kategoria) = ? AND TRIM(wariant) = ? LIMIT 1`,
        [tenant_id, d.kategoria, d.wariant],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          zapiszLog(tenant_id, 'USUNIĘCIE ZABIEGU', d.pracownik, d.kategoria);
          return res.json({ status: 'success', message: 'Usunięto' });
        }
      );

    // --- EDIT_SERVICE ---
    } else if (action === 'edit_service') {
      // typ_zabiegu opcjonalny — jeśli klient go nie wysłał, zostaw bez zmian
      const fields = ['kategoria = ?', 'wariant = ?', 'cena = ?'];
      const vals = [d.new_kategoria, d.new_wariant, d.new_cena ? parseFloat(d.new_cena) : null];
      if (d.typ_zabiegu !== undefined) {
        fields.push('typ_zabiegu = ?');
        vals.push(d.typ_zabiegu ? String(d.typ_zabiegu).trim().toLowerCase().slice(0, 80) : null);
      }
      vals.push(tenant_id, d.old_kategoria, d.old_wariant);
      db.query(
        `UPDATE Uslugi SET ${fields.join(', ')} WHERE tenant_id = ? AND TRIM(kategoria) = ? AND TRIM(wariant) = ? LIMIT 1`,
        vals,
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          zapiszLog(tenant_id, 'EDYCJA ZABIEGU', d.pracownik, d.new_kategoria);
          return res.json({ status: 'success', message: 'Zaktualizowano' });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja sprzedaz POST: ' + action });
    }
  });

  return router;
};
