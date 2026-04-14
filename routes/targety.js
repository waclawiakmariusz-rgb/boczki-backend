// routes/targety.js
// Targety: add_target, get_targets, edit_target, tgt_get_employee_dashboard

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');

module.exports = (db) => {
  const zapiszLog = makeZapiszLog(db);

  // Auto-migrate: add min_cena if missing (errno 1060 = column already exists, ignored)
  db.query(
    `ALTER TABLE Pracownicy_targety ADD COLUMN min_cena DECIMAL(10,2) NULL DEFAULT 0`,
    (err) => { if (err && err.errno !== 1060) console.warn('[targety] min_cena migration:', err.message); }
  );

  const parseDate = (val) => {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    let s = String(val).trim();
    let m1 = s.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})/);
    if (m1) return new Date(m1[3], m1[2] - 1, m1[1]);
    let m2 = s.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})/);
    if (m2) return new Date(m2[1], m2[2] - 1, m2[3]);
    let d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  const safeNum = (val) => Number(String(val).replace(',', '.').replace(/[^0-9.-]+/g, '')) || 0;

  // POST /targety
  router.post('/targety', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'add_target') {
      const id = 'TGT-' + Date.now();
      db.query(
        `INSERT INTO Pracownicy_targety (id, tenant_id, pracownik, miesiac, typ_targetu, wartosc, szczegoly, opis_slowny, status, log_data, kto_dodal, min_cena) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Aktywny', NOW(), ?, ?)`,
        [id, tenant_id, d.pracownik, d.miesiac, d.typ_targetu, parseFloat(d.wartosc), d.szczegoly || '', d.opis_slowny || '', d.kto_dodal || '', parseFloat(d.min_cena) || 0],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          zapiszLog(tenant_id, 'NOWY TARGET', d.kto_dodal, `Dla: ${d.pracownik} | ${d.opis_slowny}`);
          return res.json({ status: 'success', message: 'Cel pracownika został pomyślnie dodany!' });
        }
      );

    } else if (action === 'get_targets') {
      db.query(
        `SELECT id, pracownik, miesiac, typ_targetu, szczegoly, wartosc, opis_slowny, status, min_cena FROM Pracownicy_targety WHERE tenant_id = ? AND COALESCE(status, '') != 'Usunięty' ORDER BY log_data DESC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          console.log(`[get_targets] tenant=${tenant_id} znaleziono=${(rows||[]).length} rekordów`);
          return res.json({ status: 'success', data: (rows || []).map(r => ({
            id: r.id, pracownik: r.pracownik, miesiac: r.miesiac,
            typ_targetu: r.typ_targetu, szczegoly: r.szczegoly,
            wartosc: parseFloat(r.wartosc) || 0, opis_slowny: r.opis_slowny,
            status: r.status, min_cena: parseFloat(r.min_cena) || 0
          })) });
        }
      );

    } else if (action === 'edit_target') {
      db.query(
        `UPDATE Pracownicy_targety SET pracownik = ?, miesiac = ?, typ_targetu = ?, szczegoly = ?, wartosc = ?, opis_slowny = ?, status = COALESCE(?, status), min_cena = ? WHERE tenant_id = ? AND id = ?`,
        [d.pracownik, d.miesiac, d.typ_targetu, d.szczegoly || '', parseFloat(d.wartosc), d.opis_slowny || '', d.status || null, parseFloat(d.min_cena) || 0, tenant_id, d.id_targetu],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          zapiszLog(tenant_id, 'EDYCJA TARGETU', d.kto_dodal || 'Admin', `Zaktualizowano cel dla: ${d.pracownik} | ${d.opis_slowny}`);
          return res.json({ status: 'success', message: 'Target zaktualizowany pomyślnie!' });
        }
      );

    } else if (action === 'tgt_get_employee_dashboard') {
      const pracownik = String(d.pracownik).trim();
      const dFrom = new Date(d.dateFrom); dFrom.setHours(0, 0, 0, 0);
      const dTo = new Date(d.dateTo); dTo.setHours(23, 59, 59, 999);

      let res_data = {
        utargTotal: 0, utargUslogi: 0, utargKosmetyki: 0,
        kosmetykiSzt: 0, uslugiSzt: 0, zlotyParagon: 0, aov: 0,
        konCount: 0, konSuccess: 0, konUpsell: 0, logZabiegow: []
      };

      let wizyty = {};

      // 1. Sprzedaż główna
      db.query(
        `SELECT data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc FROM Sprzedaz WHERE tenant_id = ? AND COALESCE(status, '') NOT IN ('USUNIĘTY', 'SCALONY') AND data_sprzedazy BETWEEN ? AND ?`,
        [tenant_id, dFrom, dTo],
        (err1, sprzedaz) => {
          if (!err1 && sprzedaz) {
            sprzedaz.forEach(row => {
              const platnosc = String(row.platnosc || '').toLowerCase();
              if (platnosc.includes('ręczne') || platnosc.includes('reczne') || platnosc.includes('system')) return;
              const sellers = String(row.sprzedawca || '').split(',').map(s => s.trim()).filter(Boolean);
              if (!sellers.includes(pracownik)) return;
              const count = sellers.length;
              const amount = safeNum(row.kwota);
              const kwotaDlaMnie = amount / count;
              const zabieg = String(row.zabieg || 'Inne').trim();
              const isKosmetyk = zabieg.toLowerCase().includes('kosmetyk') || zabieg.toLowerCase().includes('krem');
              const isDoplata = zabieg.toLowerCase().includes('dopłata') || zabieg.toLowerCase().includes('doplata');

              if (!platnosc.includes('portfel')) {
                res_data.utargTotal += kwotaDlaMnie;
                if (isKosmetyk) res_data.utargKosmetyki += kwotaDlaMnie;
                else res_data.utargUslogi += kwotaDlaMnie;
              }
              if (isKosmetyk) { if (!isDoplata) res_data.kosmetykiSzt++; }
              else { if (!isDoplata) res_data.uslugiSzt++; }

              if (!isDoplata) res_data.logZabiegow.push({ n: zabieg, v: amount, q: 1 });

              const klient = String(row.klient || 'Nieznany').trim();
              const dateObj = new Date(row.data_sprzedazy);
              const kluczWizyty = `${dateObj.getFullYear()}-${dateObj.getMonth()}-${dateObj.getDate()}_${klient}`;
              if (!wizyty[kluczWizyty]) wizyty[kluczWizyty] = 0;
              wizyty[kluczWizyty] += kwotaDlaMnie;
            });
          }

          // 2. Zadatki
          db.query(
            `SELECT data_wplaty, klient, kwota, metoda, pracownicy, status, typ FROM Zadatki WHERE tenant_id = ? AND data_wplaty BETWEEN ? AND ?`,
            [tenant_id, dFrom, dTo],
            (err2, zadatki) => {
              if (!err2 && zadatki) {
                zadatki.forEach(row => {
                  const status = String(row.status || '').toUpperCase();
                  const typ = String(row.typ || '').toUpperCase();
                  const metoda = String(row.metoda || '').toLowerCase();
                  if (status === 'USUNIĘTY' || status === 'SCALONY' || typ !== 'WPŁATA') return;
                  if (metoda.includes('ręczne') || metoda.includes('reczne') || metoda.includes('system')) return;
                  const sellers = String(row.pracownicy || '').split(',').map(s => s.trim()).filter(Boolean);
                  if (!sellers.includes(pracownik)) return;
                  const amount = safeNum(row.kwota);
                  if (amount === 0) return;
                  const kwotaDlaMnie = amount / sellers.length;
                  res_data.utargTotal += kwotaDlaMnie;
                  res_data.utargUslogi += kwotaDlaMnie;
                  const klient = String(row.klient || '').trim();
                  const dateObj = new Date(row.data_wplaty);
                  const kluczWizyty = `${dateObj.getFullYear()}-${dateObj.getMonth()}-${dateObj.getDate()}_${klient}`;
                  if (!wizyty[kluczWizyty]) wizyty[kluczWizyty] = 0;
                  wizyty[kluczWizyty] += kwotaDlaMnie;
                });
              }

              // 3. Konsultacje
              db.query(
                `SELECT data_konsultacji, kwota_pakiet, upsell, zrodlo, typ_akcji, kto_wykonal FROM Wyniki_konsultacja WHERE tenant_id = ? AND data_konsultacji BETWEEN ? AND ?`,
                [tenant_id, dFrom, dTo],
                (err3, konsultacje) => {
                  // Progi z Typy_konsultacji
                  db.query(
                    `SELECT nazwa, prog FROM Typy_konsultacji WHERE tenant_id = ?`,
                    [tenant_id],
                    (err4, typy) => {
                      const thresholdsMap = {};
                      if (!err4 && typy) typy.forEach(t => { if (t.nazwa) thresholdsMap[t.nazwa] = Number(t.prog) || 0; });

                      const checkIfSuccess = (pakiet, zrodlo, typAkcji) => {
                        let threshold = 150;
                        if (thresholdsMap[typAkcji] !== undefined) threshold = thresholdsMap[typAkcji];
                        else if (thresholdsMap[zrodlo] !== undefined) threshold = thresholdsMap[zrodlo];
                        else if (zrodlo === 'Normalna' && thresholdsMap['Konsultacja Standardowa'] !== undefined) threshold = thresholdsMap['Konsultacja Standardowa'];
                        return pakiet >= threshold;
                      };

                      if (!err3 && konsultacje) {
                        konsultacje.forEach(row => {
                          const szukanyPracownik = pracownik.replace(/\s+/g, '').toLowerCase();
                          const sellers = String(row.kto_wykonal || '').split(',').map(s => s.replace(/\s+/g, '').toLowerCase()).filter(Boolean);
                          if (!sellers.includes(szukanyPracownik)) return;
                          const pakiet = safeNum(row.kwota_pakiet);
                          const upsell = safeNum(row.upsell);
                          const zrodlo = String(row.zrodlo || '').trim();
                          const typAkcji = String(row.typ_akcji || '').trim();
                          const count = sellers.length;
                          res_data.konCount++;
                          res_data.konUpsell += upsell / count;
                          if (checkIfSuccess(pakiet, zrodlo, typAkcji)) res_data.konSuccess++;
                        });
                      }

                      let iloscWizyt = 0;
                      for (let key in wizyty) {
                        iloscWizyt++;
                        if (wizyty[key] > res_data.zlotyParagon) res_data.zlotyParagon = wizyty[key];
                      }
                      res_data.aov = iloscWizyt > 0 ? (res_data.utargTotal / iloscWizyt) : 0;

                      return res.json({ status: 'success', data: res_data });
                    }
                  );
                }
              );
            }
          );
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja targety POST: ' + action });
    }
  });

  return router;
};
