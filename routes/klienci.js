// routes/klienci.js
// Klienci: get_clients, get_client_profile_data, get_wallet, get_all_deposits, manage_deposit, merge_deposits,
//          add_client, add_client_fast_sales, edit_client_data, get_client_memo, save_client_memo,
//          get_suggestion_rules, add_suggestion_rule, delete_suggestion_rule

const express = require('express');
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');
const { parseKwota, parseNumOpt } = require('./utils');

module.exports = (db) => {
  const router = express.Router();
  const zapiszLog = makeZapiszLog(db);

  // Helper: generuj nowe ID klienta (numeryczne, max+1)
  function generujNoweIdKlienta(tenant_id, callback) {
    db.query(`SELECT MAX(CAST(id_klienta AS UNSIGNED)) as maxId FROM Klienci WHERE tenant_id = ?`, [tenant_id], (err, rows) => {
      const max = rows && rows[0] && rows[0].maxId ? parseInt(rows[0].maxId) : 1000;
      callback(max + 1);
    });
  }

  // ==========================================
  // GET /klienci
  // ==========================================
  router.get('/klienci', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'get_clients') {
      // Klienci + aktywne zadatki
      db.query(
        `SELECT id_klienta, imie_nazwisko, telefon, rodo, osw FROM Klienci WHERE tenant_id = ? ORDER BY imie_nazwisko`,
        [tenant_id],
        (err, klienci) => {
          if (err) return res.json({ klienci: [], zadatki: [] });
          const clients = (klienci || []).map(r => ({
            id: r.id_klienta,
            nazwa: r.imie_nazwisko,
            telefon: r.telefon || '',
            rodo: r.rodo && (r.rodo.toUpperCase() === 'TAK' || r.rodo === '1' || r.rodo === 'TRUE'),
            osw: r.osw && (r.osw.toUpperCase() === 'TAK' || r.osw === '1' || r.osw === 'TRUE')
          }));

          db.query(
            `SELECT id, id_klienta, data_wplaty, klient, kwota, metoda, cel FROM Zadatki WHERE tenant_id = ? AND typ = 'WPŁATA' AND (status = 'AKTYWNY' OR status IS NULL)`,
            [tenant_id],
            (err2, zadatki) => {
              const aktywne = (zadatki || []).map(r => ({
                id: r.id, id_klienta: String(r.id_klienta || ''),
                data: r.data_wplaty, klient: String(r.klient || '').toLowerCase(),
                kwota: parseFloat(r.kwota), metoda: r.metoda, cel: r.cel
              }));
              return res.json({ klienci: clients, zadatki: aktywne });
            }
          );
        }
      );

    } else if (action === 'get_client_profile_data') {
      const parametr = req.query.klient;
      let id = '', nazwa = '';
      try { const p = JSON.parse(parametr); id = String(p.id); nazwa = String(p.nazwa); } catch (e) { nazwa = String(parametr); }

      // Portfel
      const portfelQ = id
        ? `SELECT id, data_wplaty, typ, kwota, metoda, cel, status, pracownicy FROM Zadatki WHERE tenant_id = ? AND (id_klienta = ? OR LOWER(klient) = LOWER(?)) ORDER BY data_wplaty DESC`
        : `SELECT id, data_wplaty, typ, kwota, metoda, cel, status, pracownicy FROM Zadatki WHERE tenant_id = ? AND LOWER(klient) = LOWER(?) ORDER BY data_wplaty DESC`;
      const portfelParams = id ? [tenant_id, id, nazwa] : [tenant_id, nazwa];

      db.query(portfelQ, portfelParams, (err1, zadatki) => {
        let saldo = 0;
        const historia = (zadatki || []).map(r => {
          const row = { id: r.id, data: r.data_wplaty, typ: r.typ, kwota: parseFloat(r.kwota), metoda: r.metoda, cel: r.cel, status: r.status, pracownicy: r.pracownicy || '' };
          if (row.typ === 'WPŁATA' && row.status === 'AKTYWNY') saldo += row.kwota;
          return row;
        });

        // Memo
        const memoQ = id
          ? `SELECT notatka FROM Memo WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`
          : `SELECT notatka FROM Memo WHERE tenant_id = ? AND klient = ? LIMIT 1`;
        db.query(memoQ, [tenant_id, id || nazwa], (err2, memoRows) => {
          const memo = memoRows && memoRows.length > 0 ? { znaleziona: true, tresc: memoRows[0].notatka } : { znaleziona: false };

          // Retencja
          const retQ = id
            ? `SELECT data_kontaktu, id_klienta, klient, kategoria_filtr, status, notatka, pracownik FROM Retencja WHERE tenant_id = ? AND id_klienta = ? ORDER BY data_kontaktu DESC`
            : `SELECT data_kontaktu, id_klienta, klient, kategoria_filtr, status, notatka, pracownik FROM Retencja WHERE tenant_id = ? AND LOWER(klient) = LOWER(?) ORDER BY data_kontaktu DESC`;
          db.query(retQ, [tenant_id, id || nazwa], (err3, retRows) => {
            const retencjaData = (retRows || []).map(r => ({
              data: r.data_kontaktu, id_klienta: r.id_klienta, klient: r.klient,
              kampania: r.kategoria_filtr, status: r.status, notatka: r.notatka, pracownik: r.pracownik
            }));

            // Szukaj urodzin w tabelach miesięcznych
            const MIESIACE = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
            const szukany = nazwa.toLowerCase().replace(/\s/g, '');
            let bdFound = false, bdPending = MIESIACE.length;
            const formatDDMM = (s) => {
              if (!s) return '';
              const str = String(s);
              const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
              if (iso) return `${iso[3]}.${iso[2]}`;
              return str.slice(0, 5);
            };
            MIESIACE.forEach(miesiac => {
              if (bdFound) { bdPending--; return; }
              db.query(`SELECT imie, nazwisko, data_urodzin FROM \`${miesiac}\` WHERE tenant_id = ?`, [tenant_id], (bdErr, bdRows) => {
                if (!bdFound && !bdErr && bdRows) {
                  for (const r of bdRows) {
                    const n = String(r.nazwisko || ''), im = String(r.imie || '');
                    if ((n + im).toLowerCase().replace(/\s/g, '') === szukany ||
                        (im + n).toLowerCase().replace(/\s/g, '') === szukany) {
                      bdFound = true;
                      return res.json({ portfel: { saldo, historia }, memo, retencja: retencjaData, urodziny: { znaleziona: true, data: formatDDMM(r.data_urodzin), miesiac } });
                    }
                  }
                }
                bdPending--;
                if (bdPending === 0 && !bdFound) {
                  return res.json({ portfel: { saldo, historia }, memo, retencja: retencjaData, urodziny: { znaleziona: false } });
                }
              });
            });
          });
        });
      });

    } else if (action === 'get_wallet') {
      const parametr = req.query.klient;
      let id = '', nazwa = '';
      try { const p = JSON.parse(parametr); id = String(p.id); nazwa = String(p.nazwa); } catch (e) { nazwa = String(parametr); }

      const sql = id
        ? `SELECT id, data_wplaty, typ, kwota, metoda, cel, status, pracownicy FROM Zadatki WHERE tenant_id = ? AND (id_klienta = ? OR LOWER(klient) = LOWER(?)) ORDER BY data_wplaty DESC`
        : `SELECT id, data_wplaty, typ, kwota, metoda, cel, status, pracownicy FROM Zadatki WHERE tenant_id = ? AND LOWER(klient) = LOWER(?) ORDER BY data_wplaty DESC`;
      const params = id ? [tenant_id, id, nazwa] : [tenant_id, nazwa];

      db.query(sql, params, (err, rows) => {
        if (err) return res.json({ saldo: 0, historia: [] });
        let saldo = 0;
        const historia = (rows || []).map(r => {
          const row = { id: r.id, data: r.data_wplaty, typ: r.typ, kwota: parseFloat(r.kwota), metoda: r.metoda, cel: r.cel, status: r.status, pracownicy: r.pracownicy || '' };
          if (row.typ === 'WPŁATA' && row.status === 'AKTYWNY') saldo += row.kwota;
          return row;
        });
        return res.json({ saldo, historia });
      });

    } else if (action === 'get_all_deposits') {
      db.query(
        `SELECT id, id_klienta, data_wplaty, klient, typ, kwota, metoda, cel, status FROM Zadatki WHERE tenant_id = ? ORDER BY data_wplaty DESC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json((rows || []).map(r => ({ id: r.id, id_klienta: r.id_klienta, data: r.data_wplaty, klient: r.klient, typ: r.typ, kwota: r.kwota, metoda: r.metoda, cel: r.cel, status: r.status })));
        }
      );

    } else if (action === 'get_client_memo') {
      const parametr = req.query.klient;
      let id = '', nazwa = '';
      try { const p = JSON.parse(parametr); id = String(p.id); nazwa = String(p.nazwa); } catch (e) { nazwa = String(parametr); }
      const sql = id
        ? `SELECT notatka FROM Memo WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`
        : `SELECT notatka FROM Memo WHERE tenant_id = ? AND klient = ? LIMIT 1`;
      db.query(sql, [tenant_id, id || nazwa], (err, rows) => {
        if (err || !rows.length) return res.json({ znaleziona: false });
        return res.json({ znaleziona: true, tresc: rows[0].notatka });
      });

    } else if (action === 'get_suggestion_rules') {
      db.query(
        `SELECT matka, dziecko, argumentacja FROM Sugestie WHERE tenant_id = ?`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json((rows || []).map(r => ({ matka: r.matka, dziecko: r.dziecko, opis: r.argumentacja })));
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET klienci: ' + action });
    }
  });

  // ==========================================
  // POST /klienci
  // ==========================================
  router.post('/klienci', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'add_client') {
      generujNoweIdKlienta(tenant_id, (noweId) => {
        const id = randomUUID();
        const tekstZgody = d.zgoda_regulamin ? 'Regulamin + RODO' : 'BRAK (Do uzupełnienia)';
        db.query(
          `INSERT INTO Klienci (id, tenant_id, id_klienta, imie_nazwisko, telefon, data_rejestracji, zgody_rodo_reg, notatki) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
          [id, tenant_id, String(noweId), d.klient, d.telefon || '', tekstZgody, 'Dodano przez: ' + (d.pracownik || '')],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });

            // Rejestr_Oświadczeń
            const idOsw = randomUUID();
            const czyZgoda = d.zgoda_regulamin ? 'TAK' : 'NIE';
            db.query(
              `INSERT INTO \`Rejestr_Oświadczeń\` (id, tenant_id, id_klienta, data_podpisu, klient, zapoznanie_z_regulaminem, przekazano_wyciag, pracownik) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [idOsw, tenant_id, String(noweId), d.data_podpisu || null, d.klient, czyZgoda, czyZgoda, d.pracownik || ''],
              () => {}
            );

            // Rejestr_RODO
            const idRodo = randomUUID();
            db.query(
              `INSERT INTO Rejestr_RODO (id, tenant_id, klient, data_podpisu, wizerunek, newsletter_sms, kontakt_tel, newsletter_email, booksy_sms, email_adres, id_klienta, pracownik) VALUES (?, ?, ?, ?, 'NIE', 'NIE', 'NIE', 'NIE', 'Nie dotyczy', 'nie dotyczy', ?, ?)`,
              [idRodo, tenant_id, d.klient, d.data_podpisu || null, String(noweId), d.pracownik || ''],
              () => {}
            );

            let opisLogu = `Nowy klient: ${d.klient} (ID: ${noweId}) [Tel: ${d.telefon || 'brak'}]`;
            if (d.info_duplikat && d.info_duplikat !== '') opisLogu += ` UWAGA: ${d.info_duplikat}`;
            zapiszLog(tenant_id, 'DODANIE KLIENTA', d.pracownik, opisLogu);
            return res.json({ status: 'success', message: `Dodano klienta: ${d.klient} (ID: ${noweId})`, new_id: noweId, new_name: d.klient });
          }
        );
      });

    } else if (action === 'add_client_fast_sales') {
      generujNoweIdKlienta(tenant_id, (noweId) => {
        const id = randomUUID();
        db.query(
          `INSERT INTO Klienci (id, tenant_id, id_klienta, imie_nazwisko, telefon, data_rejestracji, zgody_rodo_reg, notatki) VALUES (?, ?, ?, ?, '', NOW(), 'BRAK', ?)`,
          [id, tenant_id, String(noweId), d.klient, 'Szybka rejestracja przy sprzedaży (' + (d.pracownik || '') + ')'],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            const idOsw = randomUUID();
            db.query(
              `INSERT INTO \`Rejestr_Oświadczeń\` (id, tenant_id, id_klienta, klient, zapoznanie_z_regulaminem, przekazano_wyciag, pracownik) VALUES (?, ?, ?, ?, 'NIE', 'NIE', ?)`,
              [idOsw, tenant_id, String(noweId), d.klient, d.pracownik || ''],
              () => {}
            );
            return res.json({ status: 'success', message: `Utworzono konto: ${d.klient} (ID: ${noweId})`, new_id: noweId, new_name: d.klient });
          }
        );
      });

    } else if (action === 'edit_client_data') {
      db.query(
        `SELECT id_klienta, imie_nazwisko, telefon, notatki FROM Klienci WHERE tenant_id = ? AND id_klienta = ?`,
        [tenant_id, d.id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono klienta o ID: ' + d.id });
          const row = rows[0];
          let zmianyOpis = [];
          const teraz = new Date().toISOString().slice(0, 16);

          let noweNotatki = row.notatki || '';
          if (row.imie_nazwisko !== d.nowa_nazwa) {
            const wpisLogu = `[SYSTEM]: zmiana z "${row.imie_nazwisko}" na "${d.nowa_nazwa}" (${teraz})`;
            noweNotatki = noweNotatki ? noweNotatki + '\n' + wpisLogu : wpisLogu;
            zmianyOpis.push(`Nazwa: "${row.imie_nazwisko}" -> "${d.nowa_nazwa}"`);
          }
          if (d.nowy_telefon && String(row.telefon) !== String(d.nowy_telefon)) {
            zmianyOpis.push(`Tel: "${row.telefon}" -> "${d.nowy_telefon}"`);
          }

          db.query(
            `UPDATE Klienci SET imie_nazwisko = ?, telefon = ?, notatki = ? WHERE tenant_id = ? AND id_klienta = ?`,
            [d.nowa_nazwa, d.nowy_telefon || row.telefon, noweNotatki, tenant_id, d.id],
            (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              if (zmianyOpis.length > 0) zapiszLog(tenant_id, 'EDYCJA DANYCH KLIENTA', d.pracownik || 'Admin', `ID ${d.id}: ${zmianyOpis.join(' | ')}`);
              return res.json({ status: 'success', message: 'Dane klienta zaktualizowane pomyślnie!' });
            }
          );
        }
      );

    } else if (action === 'save_client_memo') {
      // Sprawdź czy jest wpis
      const checkQ = d.id_klienta
        ? `SELECT id FROM Memo WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`
        : `SELECT id FROM Memo WHERE tenant_id = ? AND klient = ? AND id_klienta IS NULL LIMIT 1`;
      db.query(checkQ, [tenant_id, d.id_klienta || d.klient], (err, rows) => {
        if (rows && rows.length > 0) {
          db.query(`UPDATE Memo SET notatka = ? WHERE tenant_id = ? AND id = ?`, [d.tresc, tenant_id, rows[0].id], () => {
            return res.json({ status: 'success', message: 'Zaktualizowano notatkę!' });
          });
        } else {
          // Sprawdź po nazwie klienta
          db.query(`SELECT id FROM Memo WHERE tenant_id = ? AND klient = ? LIMIT 1`, [tenant_id, d.klient], (err2, rows2) => {
            if (rows2 && rows2.length > 0) {
              db.query(
                `UPDATE Memo SET notatka = ?, id_klienta = ? WHERE tenant_id = ? AND id = ?`,
                [d.tresc, d.id_klienta || '', tenant_id, rows2[0].id],
                () => res.json({ status: 'success', message: 'Zaktualizowano notatkę (Nazwa)!' })
              );
            } else {
              const id = randomUUID();
              db.query(
                `INSERT INTO Memo (id, tenant_id, id_klienta, klient, notatka) VALUES (?, ?, ?, ?, ?)`,
                [id, tenant_id, d.id_klienta || '', d.klient, d.tresc],
                () => res.json({ status: 'success', message: 'Dodano nową notatkę!' })
              );
            }
          });
        }
      });

    } else if (action === 'manage_deposit') {
      const pracownik = d.pracownik || 'System';

      if (d.typ === 'WPŁATA') {
        const id = 'DEP-' + Date.now();
        const sprzedawcyStr = Array.isArray(d.sprzedawcy) ? d.sprzedawcy.join(', ') : (d.sprzedawcy || '');
        let kwota;
        try { kwota = parseKwota(d.kwota, 'kwota zadatku'); } catch (e) { return res.json({ status: 'error', message: e.message }); }

        // Walidacja sumy split przed jakimkolwiek zapisem
        if (d.metoda === 'Mix' && d.split_breakdown && Array.isArray(d.split_breakdown)) {
          const sumaSplit = d.split_breakdown.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
          if (Math.abs(sumaSplit - kwota) > 0.01) {
            return res.json({ status: 'error', message: `Suma płatności Mix (${sumaSplit.toFixed(2)} zł) nie zgadza się z kwotą zadatku (${kwota.toFixed(2)} zł).` });
          }
        }

        db.query(
          `INSERT INTO Zadatki (id, tenant_id, id_klienta, data_wplaty, klient, typ, kwota, metoda, cel, status, pracownicy) VALUES (?, ?, ?, NOW(), ?, 'WPŁATA', ?, ?, ?, 'AKTYWNY', ?)`,
          [id, tenant_id, d.id_klienta || '', d.klient, kwota, d.metoda || '', d.cel || '', sprzedawcyStr],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });

            const zakoncz = () => {
              zapiszLog(tenant_id, 'WPŁATA ZADATKU', pracownik, `Klient: ${d.klient} | Kwota: ${d.kwota} zł | Metoda: ${d.metoda} | Obsługa: ${sprzedawcyStr}`);
              return res.json({ status: 'success', message: 'Zadatek przyjęty pomyślnie!' });
            };

            // Mix split — sekwencyjnie, żeby nie tracić wpisów przy przerwaniu połączenia
            if (d.metoda === 'Mix' && d.split_breakdown && Array.isArray(d.split_breakdown)) {
              let si = 0;
              function nextSplit() {
                if (si >= d.split_breakdown.length) return zakoncz();
                const part = d.split_breakdown[si];
                const splitId = id + '-SPLIT-' + si;
                si++;
                db.query(
                  `INSERT INTO Platnosci (id, tenant_id, data_platnosci, klient, metoda_platnosci, kwota, status) VALUES (?, ?, NOW(), ?, ?, ?, 'AKTYWNY')`,
                  [splitId, tenant_id, d.klient || '', part.method || '', parseNumOpt(part.amount) || 0],
                  (splitErr) => {
                    if (splitErr) console.error('[split wpłata] INSERT Platnosci failed:', splitErr.message);
                    nextSplit();
                  }
                );
              }
              nextSplit();
            } else {
              zakoncz();
            }
          }
        );

      } else if (d.typ === 'EDIT_GOAL') {
        db.query(
          `UPDATE Zadatki SET cel = ? WHERE tenant_id = ? AND id = ?`,
          [d.nowy_cel, tenant_id, d.id_zadatku],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'EDYCJA ZADATKU', pracownik, `Zmiana celu na: ${d.nowy_cel}`);
            return res.json({ status: 'success', message: 'Zmieniono opis zadatku!' });
          }
        );

      } else if (d.typ === 'KARA' || d.typ === 'ZWROT') {
        const nowyStatus = d.typ === 'KARA' ? 'PRZEPADŁ (KARA)' : 'ZWRÓCONY';
        db.query(
          `UPDATE Zadatki SET status = ? WHERE tenant_id = ? AND id = ?`,
          [nowyStatus, tenant_id, d.id_zadatku],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'ROZLICZENIE ZADATKU', pracownik, `Akcja: ${d.typ} | ID: ${d.id_zadatku}`);
            return res.json({ status: 'success', message: 'Status zmieniony na: ' + d.typ });
          }
        );

      } else if (d.typ === 'EDIT_AMOUNT') {
        let kwota;
        try { kwota = parseKwota(d.nowa_kwota, 'nowa kwota'); } catch (e) { return res.json({ status: 'error', message: e.message }); }
        db.query(
          `UPDATE Zadatki SET kwota = ? WHERE tenant_id = ? AND id = ?`,
          [kwota, tenant_id, d.id_zadatku],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'KOREKTA ZADATKU', pracownik, `Zmiana kwoty: ${d.nowa_kwota} zł`);
            return res.json({ status: 'success', message: 'Zaktualizowano kwotę zadatku!' });
          }
        );

      } else if (d.typ === 'EDIT_FULL') {
        let kwota;
        try { kwota = parseKwota(d.nowa_kwota, 'nowa kwota'); } catch (e) { return res.json({ status: 'error', message: e.message }); }
        db.query(
          `UPDATE Zadatki SET kwota = ?, metoda = ?, cel = ?, pracownicy = ?, status = COALESCE(?, status), data_wplaty = COALESCE(?, data_wplaty) WHERE tenant_id = ? AND id = ?`,
          [kwota, d.nowa_metoda || '', d.nowy_cel || '', d.nowi_pracownicy || '', d.nowy_status || null, d.nowa_data ? new Date(d.nowa_data) : null, tenant_id, d.id_zadatku],
          (err) => {
            if (err) return res.json({ status: 'error', message: err.message });
            zapiszLog(tenant_id, 'EDYCJA ZADATKU', pracownik, `Kwota: ${d.nowa_kwota} zł | Status: ${d.nowy_status || 'bez zmian'}`);
            return res.json({ status: 'success', message: 'Zaktualizowano dane zadatku!' });
          }
        );

      } else {
        return res.json({ status: 'error', message: 'Nieznana operacja: ' + d.typ });
      }

    } else if (action === 'merge_deposits') {
      const ids = d.ids;
      if (!ids || !ids.length) return res.json({ status: 'error', message: 'Brak IDs do scalenia' });

      db.query(
        `SELECT id, id_klienta, kwota FROM Zadatki WHERE tenant_id = ? AND id IN (?) AND (status = 'AKTYWNY' OR status IS NULL)`,
        [tenant_id, ids],
        (err, rows) => {
          if (err || !rows.length) return res.json({ status: 'error', message: 'Nie znaleziono aktywnych zadatków do scalenia.' });
          const suma = rows.reduce((s, r) => s + parseFloat(r.kwota), 0);
          const idKlientaDb = rows[0].id_klienta;
          const idsFound = rows.map(r => r.id);

          db.query(`UPDATE Zadatki SET status = 'SCALONY' WHERE tenant_id = ? AND id IN (?)`, [tenant_id, idsFound], (errUpd) => {
            if (errUpd) return res.json({ status: 'error', message: errUpd.message });
            const mergeId = 'DEP-MERGE-' + Date.now() + '-' + randomUUID().slice(0, 6);
            db.query(
              `INSERT INTO Zadatki (id, tenant_id, id_klienta, data_wplaty, klient, typ, kwota, metoda, cel, status) VALUES (?, ?, ?, NOW(), ?, 'WPŁATA', ?, 'System', ?, 'AKTYWNY')`,
              [mergeId, tenant_id, idKlientaDb, d.klient, suma, d.nowy_cel],
              (err2) => {
                if (err2) {
                  // Cofnij — przywróć oryginalne zadatki jako aktywne
                  db.query(`UPDATE Zadatki SET status = 'AKTYWNY' WHERE tenant_id = ? AND id IN (?)`, [tenant_id, idsFound], () => {});
                  return res.json({ status: 'error', message: err2.message });
                }
                zapiszLog(tenant_id, 'SCALENIE ZADATKÓW', d.pracownik, `Scalono ${idsFound.length} wpłat na sumę ${suma.toFixed(2)} zł dla ${d.klient}`);
                return res.json({ status: 'success', message: `Pomyślnie scalono ${idsFound.length} pozycji w jedną kwotę: ${suma.toFixed(2)} zł` });
              }
            );
          });
        }
      );

    } else if (action === 'add_suggestion_rule') {
      const id = randomUUID();
      db.query(
        `INSERT INTO Sugestie (id, tenant_id, matka, dziecko, argumentacja, kto_dodal) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, tenant_id, d.matka, d.dziecko, d.opis || '', d.pracownik || ''],
        (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({ status: 'success', message: 'Dodano nową regułę sugestii!' });
        }
      );

    } else if (action === 'delete_suggestion_rule') {
      db.query(
        `DELETE FROM Sugestie WHERE tenant_id = ? AND matka = ? AND dziecko = ? LIMIT 1`,
        [tenant_id, d.matka, d.dziecko],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: err.message });
          if (!result.affectedRows) return res.json({ status: 'error', message: 'Nie znaleziono reguły.' });
          return res.json({ status: 'success', message: 'Usunięto regułę.' });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja klienci POST: ' + action });
    }
  });

  return router;
};
