// routes/konsultacje.js
// Konsultacje: kon_* i akon_* i odp_* akcje

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');

module.exports = (db) => {
  const zapiszLog = makeZapiszLog(db);

  const safeNum = (val) => Number(String(val || 0).replace(',', '.').replace(/[^0-9.-]+/g, '')) || 0;

  // Helper: pobierz mapę progów z Typy_konsultacji
  function getThresholdsMap(tenant_id, callback) {
    db.query(`SELECT nazwa, prog FROM Typy_konsultacji WHERE tenant_id = ?`, [tenant_id], (err, rows) => {
      const map = {};
      if (!err && rows) rows.forEach(r => { if (r.nazwa) map[r.nazwa] = Number(r.prog) || 0; });
      callback(map);
    });
  }

  // Helper: sprawdź sukces
  function checkIfSuccess(pakiet, zrodlo, typAkcji, thresholdsMap) {
    let threshold = 150;
    if (thresholdsMap[typAkcji] !== undefined) threshold = thresholdsMap[typAkcji];
    else if (thresholdsMap[zrodlo] !== undefined) threshold = thresholdsMap[zrodlo];
    else if (zrodlo === 'Normalna' && thresholdsMap['Konsultacja Standardowa'] !== undefined) threshold = thresholdsMap['Konsultacja Standardowa'];
    return pakiet >= threshold;
  }

  // Helper: tokenizuj listę zabiegów na pojedyncze pozycje — wspólny dla akon_ i odp_
  // (spójny z krParseZabiegi we froncie; wcześniej akon_ liczył cały sklejony string jako 1 klucz)
  const parseZabiegi = (text) => {
    if (!text || typeof text !== 'string') return [];
    return text.split(/[,;]| i |\s*\+\s*/)
      .map(t => t.trim())
      .filter(t => t.length > 2 && t.length < 80);
  };

  // Helper: data → 'YYYY-MM-DD' niezależnie czy driver zwrócił Date czy string
  const toYmd = (v) => {
    if (!v) return '';
    if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    return String(v).slice(0, 10);
  };

  // Ustawienia konsultacji standardowej per salon (cena bazowa + próg darmowości/upsellu)
  // — zastępują hardcoded 199/1000 z frontendu
  db.query(`
    CREATE TABLE IF NOT EXISTS Ustawienia_Konsultacje (
      tenant_id     VARCHAR(64) PRIMARY KEY,
      cena_standard DECIMAL(10,2) NOT NULL DEFAULT 199.00,
      prog_standard DECIMAL(10,2) NOT NULL DEFAULT 1000.00,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `, err => { if (err) console.error('[konsultacje] CREATE TABLE Ustawienia_Konsultacje:', err.message); });

  function pobierzUstawienia(tenant_id, cb) {
    db.query(`SELECT cena_standard, prog_standard FROM Ustawienia_Konsultacje WHERE tenant_id = ? LIMIT 1`, [tenant_id], (err, rows) => {
      if (!err && rows && rows.length) {
        return cb({ cena_standard: Number(rows[0].cena_standard) || 199, prog_standard: Number(rows[0].prog_standard) || 1000 });
      }
      cb({ cena_standard: 199, prog_standard: 1000 });
    });
  }

  // ==========================================
  // GET /konsultacje
  // ==========================================
  router.get('/konsultacje', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'kon_read_results') {
      // LIMIT 500 (było 50 — KPI/ranking liczone we froncie z tych wierszy były zaniżane
      // przy >50 konsultacjach). isSuccess doliczany tu, żeby front nie miał własnej,
      // rozjazdowej definicji sukcesu (wcześniej: upsell > 0).
      getThresholdsMap(tenant_id, (thresholdsMap) => {
        db.query(
          `SELECT id, data_wpisu, data_konsultacji, zrodlo, obszar, klient, telefon, zabiegi_cialo, zabiegi_twarz, kwota_reklama, kwota_pakiet, upsell, kto_wykonal, uwagi, typ_akcji, status FROM Wyniki_konsultacja WHERE tenant_id = ? ORDER BY data_wpisu DESC LIMIT 500`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json([]);
            return res.json((rows || []).map(r => ({
              id: r.id,
              data_display: r.data_konsultacji ? toYmd(r.data_konsultacji) : '-',
              data_konsultacji: toYmd(r.data_konsultacji),
              typ: r.zrodlo, obszar: r.obszar, klient: r.klient,
              zabiegi_cialo: String(r.zabiegi_cialo || ''),
              zabiegi_twarz: String(r.zabiegi_twarz || ''),
              kwota_reklama: safeNum(r.kwota_reklama),
              kwota: safeNum(r.kwota_pakiet),
              kto: r.kto_wykonal, uwagi: r.uwagi,
              typ_akcji: r.typ_akcji, upsell: safeNum(r.upsell),
              isSuccess: checkIfSuccess(safeNum(r.kwota_pakiet), String(r.zrodlo || '').trim(), String(r.typ_akcji || '').trim(), thresholdsMap),
              status: r.status || 'Aktywna'
            })));
          }
        );
      });

    } else if (action === 'kon_get_consultants') {
      const onlyActive = req.query.onlyActive;
      if (onlyActive === 'true') {
        db.query(
          `SELECT imie FROM Pracownicy_konsultacja WHERE tenant_id = ? AND (status = 'Aktywny' OR status IS NULL)`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json([]);
            return res.json((rows || []).map(r => r.imie));
          }
        );
      } else {
        db.query(
          `SELECT imie, status FROM Pracownicy_konsultacja WHERE tenant_id = ? AND COALESCE(status, '') != 'Usunięty'`,
          [tenant_id],
          (err, rows) => {
            if (err) return res.json([]);
            return res.json((rows || []).map(r => ({ imie: r.imie, status: r.status })));
          }
        );
      }

    } else if (action === 'kon_get_settings') {
      pobierzUstawienia(tenant_id, (s) => res.json({ status: 'success', cena_standard: s.cena_standard, prog_standard: s.prog_standard }));

    } else if (action === 'kon_get_logs') {
      db.query(
        `SELECT data_zdarzenia, pracownik, akcja, opis FROM Logi WHERE tenant_id = ? AND (akcja LIKE '%KONSULTACJA%' OR akcja LIKE '%KONSULTANT%') ORDER BY data_zdarzenia DESC LIMIT 300`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json((rows || []).map(r => ({ data: r.data_zdarzenia, user: r.pracownik, akcja: r.akcja, opis: r.opis })));
        }
      );

    } else if (action === 'kon_get_campaigns') {
      db.query(
        `SELECT id, nazwa, obszar, cena, prog, opis, status FROM Typy_konsultacji WHERE tenant_id = ?`,
        [tenant_id],
        (err, rows) => {
          if (err) { console.error('[kon_get_campaigns] Błąd SQL:', err.message); return res.json({ error: err.message }); }
          return res.json((rows || []).map((r, i) => ({
            id_row: i + 2, id: r.id, nazwa: r.nazwa, obszar: r.obszar,
            cena: Number(r.cena) || 0, prog: Number(r.prog) || 0,
            opis: r.opis || '', status: r.status || 'Aktywna'
          })));
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET konsultacje: ' + action });
    }
  });

  // ==========================================
  // POST /konsultacje
  // ==========================================
  router.post('/konsultacje', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'kon_save_result') {
      const klientVal = String(d.klient || '').trim();
      if (!klientVal) return res.json({ status: 'error', message: 'Podaj imię i nazwisko klienta.' });
      if (!d.data_konsultacji || isNaN(new Date(d.data_konsultacji).getTime())) return res.json({ status: 'error', message: 'Nieprawidłowa data konsultacji.' });
      if (safeNum(d.kwota_pakiet) < 0 || safeNum(d.kwota_reklama) < 0 || safeNum(d.kwota_upsell) < 0) return res.json({ status: 'error', message: 'Kwoty nie mogą być ujemne.' });
      const now = new Date();
      // randomUUID zamiast timestampu z sekundową rozdzielczością (kolizje przy 2 zapisach w tej samej sekundzie)
      const uniqueID = randomUUID();
      db.query(
        `INSERT INTO Wyniki_konsultacja (id, tenant_id, data_wpisu, data_konsultacji, zrodlo, obszar, klient, telefon, zabiegi_cialo, zabiegi_twarz, kwota_reklama, kwota_pakiet, upsell, kto_wykonal, uwagi, typ_akcji) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uniqueID, tenant_id, now, d.data_konsultacji || null, d.zrodlo || '', d.obszar_reklamy || '', d.klient || '', d.telefon || '', d.zabiegi_cialo || '', d.zabiegi_twarz || '', safeNum(d.kwota_reklama), safeNum(d.kwota_pakiet), safeNum(d.kwota_upsell), d.kto || '', d.uwagi || '', d.typ_akcji || ''],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          zapiszLog(tenant_id, 'KONSULTACJA NOWA', d.user_log || '', `Dodano: ${d.klient}, Kto: ${d.kto}, Pakiet: ${d.kwota_pakiet} zł`);
          return res.json({ status: 'success' });
        }
      );

    } else if (action === 'kon_update_result') {
      const klientVal = String(d.klient || '').trim();
      if (!klientVal) return res.json({ status: 'error', message: 'Podaj imię i nazwisko klienta.' });
      if (!d.data_konsultacji || isNaN(new Date(d.data_konsultacji).getTime())) return res.json({ status: 'error', message: 'Nieprawidłowa data konsultacji.' });
      if (safeNum(d.kwota_pakiet) < 0 || safeNum(d.kwota_reklama) < 0 || safeNum(d.kwota_upsell) < 0) return res.json({ status: 'error', message: 'Kwoty nie mogą być ujemne.' });
      // SELECT przed UPDATE — żeby zalogować CO się zmieniło (audyt finansowy), nie tylko że edytowano
      db.query(
        `SELECT data_konsultacji, zrodlo, obszar, klient, telefon, zabiegi_cialo, zabiegi_twarz, kwota_reklama, kwota_pakiet, kto_wykonal, uwagi, typ_akcji, upsell FROM Wyniki_konsultacja WHERE tenant_id = ? AND id = ? LIMIT 1`,
        [tenant_id, d.id],
        (errSel, oldRows) => {
          if (errSel) return res.json({ status: 'error', message: errSel.message });
          if (!oldRows || !oldRows.length) return res.json({ status: 'error', message: 'Nie znaleziono wpisu' });
          const o = oldRows[0];
          const zmiany = [];
          const cmp = (label, oldV, newV) => { if (String(oldV) !== String(newV)) zmiany.push(`${label}: "${oldV}" → "${newV}"`); };
          cmp('data', toYmd(o.data_konsultacji), toYmd(d.data_konsultacji));
          cmp('źródło', String(o.zrodlo || ''), String(d.zrodlo || ''));
          cmp('obszar', String(o.obszar || ''), String(d.obszar_reklamy || ''));
          cmp('klient', String(o.klient || ''), klientVal);
          cmp('zabiegi ciało', String(o.zabiegi_cialo || ''), String(d.zabiegi_cialo || ''));
          cmp('zabiegi twarz', String(o.zabiegi_twarz || ''), String(d.zabiegi_twarz || ''));
          cmp('reklama', safeNum(o.kwota_reklama), safeNum(d.kwota_reklama));
          cmp('pakiet', safeNum(o.kwota_pakiet), safeNum(d.kwota_pakiet));
          cmp('upsell', safeNum(o.upsell), safeNum(d.kwota_upsell));
          cmp('kto', String(o.kto_wykonal || ''), String(d.kto || ''));
          cmp('typ akcji', String(o.typ_akcji || ''), String(d.typ_akcji || ''));
          if (String(o.uwagi || '') !== String(d.uwagi || '')) zmiany.push('uwagi');
          db.query(
            `UPDATE Wyniki_konsultacja SET data_konsultacji = ?, zrodlo = ?, obszar = ?, klient = ?, telefon = ?, zabiegi_cialo = ?, zabiegi_twarz = ?, kwota_reklama = ?, kwota_pakiet = ?, kto_wykonal = ?, uwagi = ?, typ_akcji = ?, upsell = ? WHERE tenant_id = ? AND id = ?`,
            [d.data_konsultacji || null, d.zrodlo || '', d.obszar_reklamy || '', d.klient || '', d.telefon || '', d.zabiegi_cialo || '', d.zabiegi_twarz || '', safeNum(d.kwota_reklama), safeNum(d.kwota_pakiet), d.kto || '', d.uwagi || '', d.typ_akcji || '', safeNum(d.kwota_upsell), tenant_id, d.id],
            (err, result) => {
              if (err) return res.json({ status: 'error', message: err.message });
              if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono wpisu' });
              zapiszLog(tenant_id, 'KONSULTACJA EDYCJA', d.user_log || '', `Edycja konsultacji: ${d.klient}${zmiany.length ? ' | ' + zmiany.join('; ').slice(0, 500) : ' (bez zmian)'}`);
              return res.json({ status: 'success' });
            }
          );
        }
      );

    } else if (action === 'kon_set_status') {
      const newStatus = String(d.status || '').toLowerCase() === 'archiwizacja' ? 'Archiwizacja' : 'Aktywna';
      db.query(
        `UPDATE Wyniki_konsultacja SET status = ? WHERE tenant_id = ? AND id = ?`,
        [newStatus, tenant_id, d.id],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono wpisu' });
          zapiszLog(tenant_id, 'KONSULTACJA STATUS', d.user_log || '', `${d.id} -> ${newStatus}`);
          return res.json({ status: 'success', newStatus });
        }
      );

    } else if (action === 'kon_add_consultant') {
      // Sprawdź czy istnieje
      db.query(
        `SELECT id FROM Pracownicy_konsultacja WHERE tenant_id = ? AND LOWER(imie) = LOWER(?)`,
        [tenant_id, d.imie],
        (err, rows) => {
          if (rows && rows.length > 0) {
            db.query(`UPDATE Pracownicy_konsultacja SET status = ? WHERE tenant_id = ? AND id = ?`, [d.status, tenant_id, rows[0].id], () => {
              zapiszLog(tenant_id, 'KONSULTANT ZMIANA', d.user_log || '', `${d.imie} -> ${d.status}`);
              return res.json({ status: 'success' });
            });
          } else {
            const id = randomUUID();
            db.query(`INSERT INTO Pracownicy_konsultacja (id, tenant_id, imie, status) VALUES (?, ?, ?, ?)`, [id, tenant_id, d.imie, d.status || 'Aktywny'], () => {
              zapiszLog(tenant_id, 'KONSULTANT DODANIE', d.user_log || '', `${d.imie}`);
              return res.json({ status: 'success' });
            });
          }
        }
      );

    } else if (action === 'kon_delete_consultant') {
      // Soft-delete zamiast DELETE — statystyki historyczne (kto_wykonal) zostają spójne,
      // a ponowne dodanie tego samego imienia (kon_add_consultant upsert po imieniu) reaktywuje wpis
      db.query(`UPDATE Pracownicy_konsultacja SET status = 'Usunięty' WHERE tenant_id = ? AND imie = ? LIMIT 1`, [tenant_id, d.imie], (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        zapiszLog(tenant_id, 'KONSULTANT USUNIĘCIE', d.user_log || '', `${d.imie}`);
        return res.json({ status: 'success' });
      });

    } else if (action === 'kon_save_settings') {
      const cena = safeNum(d.cena_standard);
      const prog = safeNum(d.prog_standard);
      if (cena < 0 || prog < 0) return res.json({ status: 'error', message: 'Wartości nie mogą być ujemne.' });
      db.query(
        `INSERT INTO Ustawienia_Konsultacje (tenant_id, cena_standard, prog_standard) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE cena_standard = VALUES(cena_standard), prog_standard = VALUES(prog_standard)`,
        [tenant_id, cena, prog],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          zapiszLog(tenant_id, 'KONSULTACJA USTAWIENIA', d.user_log || '', `Cena standard: ${cena} zł, próg: ${prog} zł`);
          return res.json({ status: 'success' });
        }
      );

    } else if (action === 'kon_save_campaign') {
      if (d.id) {
        db.query(
          `UPDATE Typy_konsultacji SET nazwa = ?, obszar = ?, cena = ?, prog = ?, opis = ? WHERE tenant_id = ? AND id = ?`,
          [d.nazwa || '', d.obszar || '', Number(d.cena) || 0, Number(d.prog) || 0, d.opis || '', tenant_id, d.id],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'KAMPANIA EDYCJA', d.user_log || '', `Zaktualizowano akcję: ${d.nazwa}`);
            return res.json({ status: 'success' });
          }
        );
      } else {
        const id = randomUUID();
        db.query(
          `INSERT INTO Typy_konsultacji (id, tenant_id, nazwa, obszar, cena, prog, opis, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'Aktywna')`,
          [id, tenant_id, d.nazwa || '', d.obszar || '', Number(d.cena) || 0, Number(d.prog) || 0, d.opis || ''],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'KAMPANIA NOWA', d.user_log || '', `Utworzono akcję: ${d.nazwa}`);
            return res.json({ status: 'success' });
          }
        );
      }

    } else if (action === 'kon_toggle_campaign') {
      db.query(
        `SELECT status FROM Typy_konsultacji WHERE tenant_id = ? AND id = ? LIMIT 1`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono kampanii' });
          const nowyStatus = rows[0].status === 'Aktywna' ? 'Zakończona' : 'Aktywna';
          db.query(`UPDATE Typy_konsultacji SET status = ? WHERE tenant_id = ? AND id = ?`, [nowyStatus, tenant_id, d.id], () => {
            zapiszLog(tenant_id, 'KAMPANIA STATUS', d.user_log || '', `Zmiana statusu ${d.nazwa} na ${nowyStatus}`);
            return res.json({ status: 'success', newStatus: nowyStatus });
          });
        }
      );

    // --- ANALITYKA KONSULTACJI (akon_) ---
    } else if (action === 'akon_get_months') {
      db.query(
        `SELECT DATE_FORMAT(data_konsultacji, '%Y-%m') as miesiac FROM Wyniki_konsultacja WHERE tenant_id = ? AND data_konsultacji IS NOT NULL GROUP BY miesiac ORDER BY miesiac DESC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'success', months: [] });
          return res.json({ status: 'success', months: (rows || []).map(r => r.miesiac) });
        }
      );

    } else if (action === 'akon_get_stats') {
      const month = d.month;
      getThresholdsMap(tenant_id, (thresholdsMap) => {
        db.query(
          `SELECT data_konsultacji, kwota_pakiet, upsell, zrodlo, typ_akcji, kto_wykonal, zabiegi_cialo, zabiegi_twarz FROM Wyniki_konsultacja WHERE tenant_id = ? AND DATE_FORMAT(data_konsultacji, '%Y-%m') = ? AND (status = 'Aktywna' OR status IS NULL)`,
          [tenant_id, month],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            let stats = {
              totalRevenue: 0, consultationsCount: 0, successes: 0, totalUpsell: 0,
              employeeDetails: {}, rankingPracownikow: []
            };
            (rows || []).forEach(r => {
              const pakiet = safeNum(r.kwota_pakiet);
              const upsell = safeNum(r.upsell);
              const zrodlo = String(r.zrodlo || '').trim();
              const typAkcji = String(r.typ_akcji || '').trim();
              const pracownik = String(r.kto_wykonal || 'Brak').trim();
              const isSuccess = checkIfSuccess(pakiet, zrodlo, typAkcji, thresholdsMap);

              stats.totalRevenue += pakiet;
              stats.totalUpsell += upsell;
              stats.consultationsCount++;
              if (isSuccess) stats.successes++;

              if (!stats.employeeDetails[pracownik]) {
                stats.employeeDetails[pracownik] = { name: pracownik, total: 0, upsell: 0, consultations: 0, successes: 0, top: {} };
              }
              const emp = stats.employeeDetails[pracownik];
              emp.total += pakiet; emp.upsell += upsell; emp.consultations++;
              if (isSuccess) emp.successes++;
              const tokens = [].concat(parseZabiegi(String(r.zabiegi_cialo || '')), parseZabiegi(String(r.zabiegi_twarz || '')));
              tokens.forEach(t => { if (!emp.top[t]) emp.top[t] = 0; emp.top[t]++; });
            });
            stats.rankingPracownikow = Object.values(stats.employeeDetails).sort((a, b) => b.total - a.total);
            return res.json({ status: 'success', data: stats });
          }
        );
      });

    } else if (action === 'akon_get_daily_summary') {
      const dateStr = d.date;
      db.query(
        `SELECT klient, zabiegi_cialo, zabiegi_twarz, kwota_pakiet, upsell, zrodlo, kto_wykonal FROM Wyniki_konsultacja WHERE tenant_id = ? AND DATE(data_konsultacji) = ? AND (status = 'Aktywna' OR status IS NULL)`,
        [tenant_id, dateStr],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', data: (rows || []).map(r => {
            const cialo = String(r.zabiegi_cialo || '');
            const twarz = String(r.zabiegi_twarz || '');
            return {
              klient: r.klient, zabieg: (cialo + (cialo && twarz ? ' + ' : '') + twarz).trim() || 'Konsultacja',
              kwota: safeNum(r.kwota_pakiet), upsell: safeNum(r.upsell),
              zrodlo: String(r.zrodlo || ''), sprzedawca: r.kto_wykonal
            };
          }) });
        }
      );

    } else if (action === 'akon_get_monthly_details') {
      const month = d.month;
      const compareMonth = d.compareMonth;
      // Month-to-date: gdy porównujemy bieżący (niepełny) miesiąc z innym, ucinamy miesiąc
      // porównawczy do tego samego dnia — jak w raporcie miesięcznym analityki (f4fd96b)
      let compareCutoffDay = 0;
      if (compareMonth) {
        const now = new Date();
        const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (month === cur) {
          const [cy, cm] = compareMonth.split('-').map(Number);
          compareCutoffDay = Math.min(now.getDate(), new Date(cy, cm, 0).getDate());
        }
      }
      db.query(
        `SELECT data_konsultacji, klient, zabiegi_cialo, zabiegi_twarz, kwota_pakiet, upsell, zrodlo, kto_wykonal FROM Wyniki_konsultacja WHERE tenant_id = ? AND (DATE_FORMAT(data_konsultacji, '%Y-%m') = ? OR DATE_FORMAT(data_konsultacji, '%Y-%m') = ?) AND (status = 'Aktywna' OR status IS NULL)`,
        [tenant_id, month, compareMonth || month],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });

          const [y, m] = month.split('-');
          const daysInMonth = new Date(y, m, 0).getDate();
          let daysMap = {};
          for (let i = 1; i <= daysInMonth; i++) daysMap[String(i).padStart(2, '0')] = 0;

          let result = { total: 0, compareTotal: 0, adsCount: 0, normCount: 0, upsellSum: 0, daysLabels: [], chartValues: [], topEmployees: [], topTreatments: [] };
          let empMap = {}, treatMap = {};

          (rows || []).forEach(r => {
            const rowDate = new Date(r.data_konsultacji);
            const rowM = `${rowDate.getFullYear()}-${String(rowDate.getMonth() + 1).padStart(2, '0')}`;
            const pakiet = safeNum(r.kwota_pakiet);
            if (rowM === compareMonth && compareMonth && (!compareCutoffDay || rowDate.getDate() <= compareCutoffDay)) result.compareTotal += pakiet;
            if (rowM === month) {
              result.total += pakiet;
              result.upsellSum += safeNum(r.upsell);
              const zrodlo = String(r.zrodlo || '');
              if (zrodlo.toLowerCase().includes('reklama')) result.adsCount++; else result.normCount++;
              const dayKey = String(rowDate.getDate()).padStart(2, '0');
              if (daysMap[dayKey] !== undefined) daysMap[dayKey] += pakiet;
              const prac = String(r.kto_wykonal || '');
              if (prac) { if (!empMap[prac]) empMap[prac] = 0; empMap[prac] += pakiet; }
              const tokens = [].concat(parseZabiegi(String(r.zabiegi_cialo || '')), parseZabiegi(String(r.zabiegi_twarz || '')));
              tokens.forEach(t => { if (!treatMap[t]) treatMap[t] = 0; treatMap[t]++; });
            }
          });

          result.daysLabels = Object.keys(daysMap).sort();
          result.chartValues = result.daysLabels.map(k => daysMap[k]);
          result.topEmployees = Object.entries(empMap).sort((a, b) => b[1] - a[1]);
          result.topTreatments = Object.entries(treatMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
          result.compareCutoffDay = compareCutoffDay;
          return res.json({ status: 'success', data: result });
        }
      );

    } else if (action === 'akon_get_monthly_list') {
      const monthStr = d.month;
      getThresholdsMap(tenant_id, (thresholdsMap) => {
        db.query(
          `SELECT data_konsultacji, klient, zabiegi_cialo, zabiegi_twarz, kwota_pakiet, upsell, zrodlo, kto_wykonal, obszar, typ_akcji FROM Wyniki_konsultacja WHERE tenant_id = ? AND DATE_FORMAT(data_konsultacji, '%Y-%m') = ? AND (status = 'Aktywna' OR status IS NULL) ORDER BY data_konsultacji DESC`,
          [tenant_id, monthStr],
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', data: (rows || []).map(r => {
              const cialo = String(r.zabiegi_cialo || '');
              const twarz = String(r.zabiegi_twarz || '');
              const pakiet = safeNum(r.kwota_pakiet);
              const zrodlo = String(r.zrodlo || '').trim();
              const typAkcji = String(r.typ_akcji || '').trim();
              return {
                data: r.data_konsultacji ? String(r.data_konsultacji).slice(0, 10) : '',
                klient: r.klient, zabieg: (cialo + (cialo && twarz ? ' + ' : '') + twarz).trim() || 'Konsultacja',
                reklama_typ: r.obszar, kwota: pakiet, upsell: safeNum(r.upsell),
                zrodlo, sprzedawca: r.kto_wykonal,
                isSuccess: checkIfSuccess(pakiet, zrodlo, typAkcji, thresholdsMap)
              };
            }) });
          }
        );
      });

    } else if (action === 'odp_getReportData') {
      const dFrom = new Date(d.dateFrom); dFrom.setHours(0, 0, 0, 0);
      const dTo = new Date(d.dateTo); dTo.setHours(23, 59, 59, 999);

      let result = {
        totalSales: 0, transactions: 0, avgTicket: 0,
        cash: 0, card: 0, blik: 0, raty: 0, tubapay: 0, inne: 0,
        topEmployees: [], topItems: [], topClients: [],
        konTotal: 0, konSuccess: 0, konUpsell: 0, konEmpStats: [],
        sleepingItems: [],
        cosmeticsTotal: 0, topCosmeticsEmp: [],
        // Suplementy — osobne pola (2026-06-08). Rozróżnione od kosmetyków po
        // prefixie "Suplement:" w zabieg lub po typie='Witaminy' w Magazyn.
        suplementsTotal: 0, topSuplementsEmp: []
      };

      const classifyPayment = (m) => {
        const ml = m.toLowerCase();
        if (ml.includes('kart') || ml.includes('terminal')) return 'card';
        if (ml.includes('blik')) return 'blik';
        // WAŻNE: tubapay przed 'tpay' bo 'tubapay'.includes('tpay') === true
        if (ml.includes('tubapay') || ml.includes('tuba')) return 'tubapay';
        if (ml.includes('raty') || ml.includes('medirat')) return 'raty';
        if (ml.includes('przelew') || ml.includes('tpay')) return 'inne';
        return 'cash';
      };

      let empS = {}, itemS = {}, clientS = {}, empKon = {}, empCosm = {}, empSup = {}, soldItemsSet = new Set();

      // 0. Magazyn → Set nazw produktów typu Witaminy (= Suplementy). Lookup po
      // LOWER(TRIM) dla starych sprzedaży zapisanych jako "Kosmetyk: X" gdzie
      // X jest suplementem.
      db.query(
        `SELECT DISTINCT LOWER(TRIM(nazwa_produktu)) AS nazwa FROM Magazyn WHERE tenant_id = ? AND TRIM(typ) = 'Witaminy'`,
        [tenant_id],
        (errSup, supRows) => {
          const suplementSet = new Set((supRows || []).map(r => r.nazwa));

      // 1. Sprzedaż
      db.query(
        `SELECT data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc, szczegoly, kategoria_produktu FROM Sprzedaz WHERE tenant_id = ? AND COALESCE(status, '') NOT IN ('USUNIĘTY', 'SCALONY') AND data_sprzedazy BETWEEN ? AND ?`,
        [tenant_id, dFrom, dTo],
        (err1, sprzedaz) => {
          (sprzedaz || []).forEach(row => {
            const platnosc = String(row.platnosc || '').toLowerCase();
            if (platnosc.includes('portfel') || platnosc.includes('ręczne') || platnosc.includes('reczne') || platnosc.includes('system')) return;
            const amount = safeNum(row.kwota);
            if (amount === 0) return;
            const zabieg = String(row.zabieg || 'Inne').trim();
            const klient = String(row.klient || 'Nieznany').trim();
            const zL = zabieg.toLowerCase();
            // Wykrycie suplementu: prefix "Suplement:" w zabieg LUB kolumna
            // kategoria_produktu='Suplement' (nowe wpisy) LUB lookup w Magazyn (stare)
            let isSuplement = zL.includes('suplement') || String(row.kategoria_produktu || '').toLowerCase() === 'suplement';
            const isKosmetyk = isSuplement || zL.includes('kosmetyk') || zL.includes('krem');
            if (isKosmetyk && !isSuplement && suplementSet.size > 0) {
              const cleanProd = zabieg.replace(/^(kosmetyk|suplement)\s*[:-]?\s*/i, '').trim().toLowerCase();
              if (suplementSet.has(cleanProd)) isSuplement = true;
            }
            const sellers = String(row.sprzedawca || '').split(',').map(s => s.trim()).filter(Boolean);
            const count = sellers.length || 1;

            // topClients / topEmployees / topItems / cosmetics — liczone z KAŻDEGO wpisu Sprzedaży (włącznie z mix)
            if (klient && klient.toLowerCase() !== 'nieznany') clientS[klient] = (clientS[klient] || 0) + amount;
            if (isKosmetyk) {
              // Rozdziel sumy: Suplementy do empSup/suplementsTotal, Kosmetyki do empCosm/cosmeticsTotal
              if (isSuplement) {
                result.suplementsTotal++;
                sellers.forEach(p => { if (!empSup[p]) empSup[p] = { count: 0, val: 0 }; empSup[p].count++; empSup[p].val += amount / count; });
              } else {
                result.cosmeticsTotal++;
                sellers.forEach(p => { if (!empCosm[p]) empCosm[p] = { count: 0, val: 0 }; empCosm[p].count++; empCosm[p].val += amount / count; });
              }
            } else {
              if (zabieg && zabieg !== 'Inne') { itemS[zabieg] = (itemS[zabieg] || 0) + 1; soldItemsSet.add(zabieg.toLowerCase()); }
              sellers.forEach(p => { empS[p] = (empS[p] || 0) + amount / count; });
            }

            // Total + transactions + payment breakdown — POMIJAMY mix (sub-platnosci sa w tabeli Platnosci)
            if (platnosc === 'mix') return;
            const methodCat = classifyPayment(platnosc);
            result.totalSales += amount; result.transactions++; result[methodCat] += amount;
          });

          // 2. Platnosci (sub-platnosci dla wpisow Sprzedazy typu 'mix')
          db.query(
            `SELECT data_platnosci, metoda_platnosci, kwota, status FROM Platnosci WHERE tenant_id = ? AND DATE(data_platnosci) BETWEEN DATE(?) AND DATE(?) AND COALESCE(status, '') != 'USUNIĘTY'`,
            [tenant_id, dFrom, dTo],
            (errP, platnosci) => {
              (platnosci || []).forEach(row => {
                const metoda = String(row.metoda_platnosci || '').toLowerCase();
                if (metoda.includes('portfel') || metoda.includes('ręczne') || metoda.includes('reczne') || metoda.includes('system')) return;
                const amount = safeNum(row.kwota);
                if (amount === 0) return;
                const methodCat = classifyPayment(metoda);
                result.totalSales += amount; result[methodCat] += amount;
                // NIE inkrementujemy transactions — to subkomponent istniejacej transakcji mix-Sprzedaz
              });

              // 3. Zadatki
              db.query(
                `SELECT data_wplaty, klient, kwota, metoda, pracownicy, status, typ FROM Zadatki WHERE tenant_id = ? AND data_wplaty BETWEEN ? AND ?`,
                [tenant_id, dFrom, dTo],
                (err2, zadatki) => {
              (zadatki || []).forEach(row => {
                const status = String(row.status || '').toUpperCase();
                const typ = String(row.typ || '').toUpperCase();
                const metoda = String(row.metoda || '').toLowerCase();
                if (status === 'USUNIĘTY' || status === 'SCALONY' || typ !== 'WPŁATA') return;
                if (metoda.includes('ręczne') || metoda.includes('reczne') || metoda.includes('system')) return;
                const amount = safeNum(row.kwota);
                if (amount === 0) return;
                // Zadatek na MIX: kwoty realne siedzą w splitach Platnosci (już zsumowane wyżej) —
                // nagłówkowy wiersz pomijamy w utargu, żeby nie liczyć 2× (inwariant MIX, jak w pętli Sprzedaż).
                // Atrybucja pracownika ZOSTAJE z nagłówka — splity Platnosci nie mają pola pracownika.
                if (metoda !== 'mix') {
                  const methodCat = classifyPayment(metoda);
                  result.totalSales += amount; result[methodCat] += amount;
                }
                const sellers = String(row.pracownicy || '').split(',').map(s => s.trim()).filter(Boolean);
                const count = sellers.length || 1;
                sellers.forEach(p => { empS[p] = (empS[p] || 0) + amount / count; });
              });

              // 3. Konsultacje
              getThresholdsMap(tenant_id, (thresholdsMap) => {
                db.query(
                  `SELECT data_konsultacji, kwota_pakiet, upsell, zrodlo, typ_akcji, kto_wykonal, zabiegi_cialo, zabiegi_twarz FROM Wyniki_konsultacja WHERE tenant_id = ? AND data_konsultacji BETWEEN ? AND ? AND (status = 'Aktywna' OR status IS NULL)`,
                  [tenant_id, dFrom, dTo],
                  (err3, konsultacje) => {
                    const konZabiegiCounter = {};
                    const konRanking = {}; // per pracownik: { count, sumPakiet, sumUpsell }

                    (konsultacje || []).forEach(row => {
                      const pakiet = safeNum(row.kwota_pakiet);
                      const upsell = safeNum(row.upsell);
                      const zrodlo = String(row.zrodlo || '').trim();
                      const typAkcji = String(row.typ_akcji || '').trim();
                      const pracownik = String(row.kto_wykonal || 'Brak').trim();
                      const isSuccess = checkIfSuccess(pakiet, zrodlo, typAkcji, thresholdsMap);
                      result.konTotal++; result.konUpsell += upsell;
                      if (isSuccess) result.konSuccess++;
                      if (!empKon[pracownik]) empKon[pracownik] = { total: 0, success: 0 };
                      empKon[pracownik].total++;
                      if (isSuccess) empKon[pracownik].success++;

                      // Top zabiegi z konsultacji — parsuj zabiegi_cialo + zabiegi_twarz
                      const tokens = [].concat(parseZabiegi(row.zabiegi_cialo), parseZabiegi(row.zabiegi_twarz));
                      tokens.forEach(t => { konZabiegiCounter[t] = (konZabiegiCounter[t] || 0) + 1; });

                      // Ranking konsultacyjny per pracownik
                      if (!konRanking[pracownik]) konRanking[pracownik] = { count: 0, sumPakiet: 0, sumUpsell: 0 };
                      konRanking[pracownik].count++;
                      konRanking[pracownik].sumPakiet += pakiet;
                      konRanking[pracownik].sumUpsell += upsell;
                    });

                    result.topKonZabiegi = Object.entries(konZabiegiCounter)
                      .map(([name, count]) => ({ name, count }))
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 5);

                    result.konRanking = Object.entries(konRanking)
                      .map(([name, v]) => ({ name, count: v.count, sumPakiet: v.sumPakiet, sumUpsell: v.sumUpsell, baza: v.sumPakiet - v.sumUpsell }))
                      .sort((a, b) => b.sumPakiet - a.sumPakiet);

                    // 4. Usługi śpiące
                    db.query(`SELECT kategoria, wariant FROM Uslugi WHERE tenant_id = ?`, [tenant_id], (err4, uslugi) => {
                      (uslugi || []).forEach(row => {
                        const cat = String(row.kategoria || '').trim();
                        const war = String(row.wariant || '').trim();
                        const pelna = war ? `${cat} - ${war}` : cat;
                        if (pelna && !soldItemsSet.has(pelna.toLowerCase()) && !soldItemsSet.has(cat.toLowerCase())) {
                          result.sleepingItems.push(pelna);
                        }
                      });

                      result.avgTicket = result.transactions > 0 ? result.totalSales / result.transactions : 0;
                      result.topEmployees = Object.keys(empS).map(k => ({ name: k, val: empS[k] })).sort((a, b) => b.val - a.val).slice(0, 5);
                      result.topItems = Object.keys(itemS).map(k => ({ name: k, count: itemS[k] })).sort((a, b) => b.count - a.count).slice(0, 8);
                      result.topClients = Object.keys(clientS).map(k => ({ name: k, val: clientS[k] })).sort((a, b) => b.val - a.val).slice(0, 5);
                      result.konEmpStats = Object.keys(empKon).map(k => ({
                        name: k, total: empKon[k].total, success: empKon[k].success,
                        rate: Math.round((empKon[k].success / empKon[k].total) * 100) || 0
                      })).sort((a, b) => b.rate - a.rate);
                      result.topCosmeticsEmp = Object.keys(empCosm).map(k => ({ name: k, count: empCosm[k].count, val: empCosm[k].val })).sort((a, b) => b.count - a.count);
                      result.topSuplementsEmp = Object.keys(empSup).map(k => ({ name: k, count: empSup[k].count, val: empSup[k].val })).sort((a, b) => b.count - a.count);

                      return res.json({ status: 'success', data: result });
                    });
                  }
                );
              });
                }
              );
            }
          );
        }
      );
        } // koniec callback (errSup, supRows)
      );    // koniec db.query Magazyn (suplementSet) dla odp_getReportData

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja konsultacje POST: ' + action });
    }
  });

  return router;
};
