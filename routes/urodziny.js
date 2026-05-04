// routes/urodziny.js
// Urodziny: birthdays, upcoming_birthdays, add_birthday, update_birthday_status, update_birthday_comment, update_birthday_field, get_client_birthday

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');

const NAZWY_MIESIECY = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

// Zwraca dzień (liczba) z daty w dowolnym formacie: "15.04", "15.04.1985", "1985-04-15"
function parseDzien(dataStr) {
  if (!dataStr) return -1;
  const s = String(dataStr);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // YYYY-MM-DD
  if (iso) return +iso[3];
  const dot = s.match(/^(\d{1,2})\./);              // DD.MM lub DD.MM.YYYY
  if (dot) return +dot[1];
  return -1;
}

// Zwraca "DD.MM" bez roku
function formatDDMM(dataStr) {
  if (!dataStr) return '';
  const s = String(dataStr);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}.${iso[2]}`;
  return s.slice(0, 5); // DD.MM (lub DD.MM. z kropką - bierzemy 5 znaków)
}

// Mapowanie nazwy miesiąca na nazwę tabeli (MySQL nie lubi polskich znaków jako identyfikatory - korzystamy z backticks)
const getMonthTable = (miesiac) => {
  if (NAZWY_MIESIECY.includes(miesiac)) return `\`${miesiac}\``;
  return null;
};

module.exports = (db) => {

  // ==========================================
  // GET /urodziny
  // ==========================================
  router.get('/urodziny', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'birthdays') {
      const miesiac = req.query.miesiac || NAZWY_MIESIECY[new Date().getMonth()];
      const tbl = getMonthTable(miesiac);
      if (!tbl) return res.json({ error: 'Nieznany miesiąc: ' + miesiac });

      db.query(
        `SELECT id, c_status, nazwisko, imie, data_urodzin, nr_telefonu, sms, telefon, komentarz FROM ${tbl} WHERE tenant_id = ? ORDER BY data_urodzin`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ error: err.message });
          const klienci = (rows || [])
            .filter(r => r.nazwisko || r.imie)
            .map((r, i) => {
              const dataUr = formatDDMM(r.data_urodzin);
              const dzienSort = parseDzien(r.data_urodzin);
              return {
                wiersz: i + 2,
                id: r.id,
                c_status: r.c_status,
                nazwisko: r.nazwisko,
                imie: r.imie,
                data_ur: dataUr,       // zawsze "DD.MM"
                dzien_sort: dzienSort < 0 ? 99 : dzienSort,
                telefon: r.nr_telefonu,
                sms: r.sms,
                zgoda_tel: r.telefon,
                komentarz: r.komentarz
              };
            })
            .sort((a, b) => a.dzien_sort - b.dzien_sort);
          return res.json({ miesiac, klienci });
        }
      );

    } else if (action === 'upcoming_birthdays') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const year = today.getFullYear();
      const RANGE_DAYS = 5;
      const results = [];

      // Sprawdzamy bieżący miesiąc i następny jeśli po 20
      const monthsToCheck = [today.getMonth()];
      if (today.getDate() > 20) monthsToCheck.push((today.getMonth() + 1) % 12);

      let pending = monthsToCheck.length;
      if (pending === 0) return res.json({ lista: [] });

      monthsToCheck.forEach(mi => {
        const tbl = getMonthTable(NAZWY_MIESIECY[mi]);
        db.query(
          `SELECT imie, nazwisko, data_urodzin FROM ${tbl} WHERE tenant_id = ?`,
          [tenant_id],
          (err, rows) => {
            if (!err && rows) {
              rows.forEach(r => {
                const dzien = parseDzien(r.data_urodzin);
                if (dzien > 0) {
                  const by = new Date(year, mi, dzien);
                  by.setHours(0, 0, 0, 0);
                  const diff = Math.ceil((by - today) / 86400000);
                  if (diff >= 0 && diff <= RANGE_DAYS) {
                    results.push({ imie: r.imie, nazwisko: r.nazwisko, dzien, miesiac: NAZWY_MIESIECY[mi], ile_dni: diff });
                  }
                }
              });
            }
            pending--;
            if (pending === 0) {
              results.sort((a, b) => a.ile_dni - b.ile_dni);
              return res.json({ lista: results });
            }
          }
        );
      });

    } else if (action === 'get_client_birthday') {
      const klientFull = req.query.klient || '';
      const szukany = klientFull.toLowerCase().replace(/\s/g, '');
      let found = false;
      let pending = NAZWY_MIESIECY.length;

      NAZWY_MIESIECY.forEach((miesiac, mi) => {
        if (found) { pending--; return; }
        const tbl = getMonthTable(miesiac);
        db.query(
          `SELECT id, imie, nazwisko, data_urodzin, nr_telefonu, sms, telefon, komentarz FROM ${tbl} WHERE tenant_id = ?`,
          [tenant_id],
          (err, rows) => {
            if (!found && !err && rows) {
              for (const r of rows) {
                const nazw = String(r.nazwisko || ''), imie = String(r.imie || '');
                const wBazie1 = (nazw + imie).toLowerCase().replace(/\s/g, '');
                const wBazie2 = (imie + nazw).toLowerCase().replace(/\s/g, '');
                if (wBazie1 === szukany || wBazie2 === szukany) {
                  found = true;
                  return res.json({
                    znaleziona: true,
                    id: r.id,
                    miesiac,
                    data: formatDDMM(r.data_urodzin),
                    imie: r.imie,
                    nazwisko: r.nazwisko,
                    telefon: r.nr_telefonu || '',
                    sms: r.sms || '',
                    zgoda_tel: r.telefon || '',
                    komentarz: r.komentarz || ''
                  });
                }
              }
            }
            pending--;
            if (pending === 0 && !found) return res.json({ znaleziona: false });
          }
        );
      });

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET urodziny: ' + action });
    }
  });

  // ==========================================
  // POST /urodziny
  // ==========================================
  router.post('/urodziny', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'add_birthday') {
      const parts = String(d.data_ur || '').split('-');
      if (parts.length !== 3) return res.json({ status: 'error', message: 'Błędny format daty' });
      const miesiacIndex = parseInt(parts[1], 10) - 1;
      const miesiac = NAZWY_MIESIECY[miesiacIndex];
      if (!miesiac) return res.json({ status: 'error', message: 'Nieprawidłowy miesiąc' });
      const tbl = getMonthTable(miesiac);
      // Kolumna data_urodzin jest typu DATE — zapisujemy pełne YYYY-MM-DD,
      // inaczej MySQL parsuje "DD.MM" jako 0000-00-00 (bug widoczny dopiero przy odczycie).
      const dataIso = parts.join('-');
      const id = randomUUID();
      db.query(
        `INSERT INTO ${tbl} (id, tenant_id, nazwisko, imie, data_urodzin, nr_telefonu, sms, telefon, komentarz) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tenant_id, d.nazwisko, d.imie, dataIso, d.telefon || '', d.sms || '', d.zgoda_tel || '', d.komentarz || ''],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', message: 'Dodano klienta do miesiąca: ' + miesiac });
        }
      );

    } else if (action === 'edit_birthday') {
      // Edycja istniejącego wpisu urodzinowego (z poziomu profilu klienta).
      // Trudność: jeśli zmieniono MIESIĄC daty, trzeba przenieść wpis do innej tabeli.
      // body: { tenant_id, id, stary_miesiac, data_ur (YYYY-MM-DD), imie, nazwisko, telefon, sms, zgoda_tel, komentarz }
      const id = d.id;
      const staryMiesiac = d.stary_miesiac;
      if (!id || !staryMiesiac) return res.json({ status: 'error', message: 'Brak id lub stary_miesiac' });

      const parts = String(d.data_ur || '').split('-');
      if (parts.length !== 3) return res.json({ status: 'error', message: 'Błędny format daty (oczekiwane YYYY-MM-DD)' });
      const nowyMiesiacIndex = parseInt(parts[1], 10) - 1;
      const nowyMiesiac = NAZWY_MIESIECY[nowyMiesiacIndex];
      if (!nowyMiesiac) return res.json({ status: 'error', message: 'Nieprawidłowy miesiąc nowej daty' });

      const tblStary = getMonthTable(staryMiesiac);
      const tblNowy  = getMonthTable(nowyMiesiac);
      if (!tblStary || !tblNowy) return res.json({ status: 'error', message: 'Nieznana tabela miesiąca' });

      // Kolumna data_urodzin jest typu DATE — zapisujemy ISO (YYYY-MM-DD), nie DD.MM
      const dataIso = parts.join('-');

      if (staryMiesiac === nowyMiesiac) {
        // Ten sam miesiąc — UPDATE
        db.query(
          `UPDATE ${tblStary} SET nazwisko = ?, imie = ?, data_urodzin = ?, nr_telefonu = ?, sms = ?, telefon = ?, komentarz = ?
           WHERE tenant_id = ? AND id = ?`,
          [d.nazwisko || '', d.imie || '', dataIso, d.telefon || '', d.sms || '', d.zgoda_tel || '', d.komentarz || '', tenant_id, id],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json({ status: 'success', message: 'Zaktualizowano datę urodzin.' });
          }
        );
      } else {
        // Zmiana miesiąca — DELETE z starej + INSERT do nowej (zachowaj id)
        db.query(
          `INSERT INTO ${tblNowy} (id, tenant_id, nazwisko, imie, data_urodzin, nr_telefonu, sms, telefon, komentarz) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, tenant_id, d.nazwisko || '', d.imie || '', dataIso, d.telefon || '', d.sms || '', d.zgoda_tel || '', d.komentarz || ''],
          (errIns) => {
            if (errIns) return res.json({ status: 'error', message: 'Błąd INSERT do ' + nowyMiesiac + ': ' + errIns.message });
            db.query(
              `DELETE FROM ${tblStary} WHERE tenant_id = ? AND id = ?`,
              [tenant_id, id],
              (errDel) => {
                if (errDel) {
                  // Nie udało się usunąć ze starej — duplikat. Lepiej zwrócić błąd niż zostawić w 2 miesiącach.
                  return res.json({ status: 'error', message: 'Wpis dodany do ' + nowyMiesiac + ' ale nie usunięto z ' + staryMiesiac + ' — sprawdź ręcznie. Błąd: ' + errDel.message });
                }
                return res.json({ status: 'success', message: 'Przeniesiono z ' + staryMiesiac + ' do ' + nowyMiesiac + '.' });
              }
            );
          }
        );
      }

    } else if (action === 'update_birthday_status') {
      const tbl = getMonthTable(d.miesiac);
      if (!tbl) return res.json({ status: 'error', message: 'Nieznany miesiąc' });
      db.query(
        `UPDATE ${tbl} SET sms = ? WHERE tenant_id = ? AND id = ?`,
        [d.status, tenant_id, d.id],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', message: 'OK' });
        }
      );

    } else if (action === 'update_birthday_comment') {
      const tbl = getMonthTable(d.miesiac);
      if (!tbl) return res.json({ status: 'error', message: 'Nieznany miesiąc' });
      db.query(
        `UPDATE ${tbl} SET komentarz = ? WHERE tenant_id = ? AND id = ?`,
        [d.komentarz, tenant_id, d.id],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', message: 'OK' });
        }
      );

    } else if (action === 'update_birthday_field') {
      const tbl = getMonthTable(d.miesiac);
      if (!tbl) return res.json({ status: 'error', message: 'Nieznany miesiąc' });
      // d.kolumna - numer kolumny Apps Script (1-indexed), mapuj na nazwę kolumny
      const kolMapping = {
        1: 'c_status', 2: 'nazwisko', 3: 'imie', 4: 'data_urodzin',
        5: 'nr_telefonu', 6: 'sms', 7: 'telefon', 8: 'komentarz'
      };
      const kolName = kolMapping[d.kolumna];
      if (!kolName) return res.json({ status: 'error', message: 'Nieznana kolumna: ' + d.kolumna });
      db.query(
        `UPDATE ${tbl} SET ${kolName} = ? WHERE tenant_id = ? AND id = ?`,
        [d.wartosc, tenant_id, d.id],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', message: 'OK' });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja urodziny POST: ' + action });
    }
  });

  return router;
};
