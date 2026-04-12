// routes/rodo.js
// RODO i zgody: get_consents, get_rodo, save_rodo, update_consents, get_all_rodo

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');

module.exports = (db) => {
  const zapiszLog = makeZapiszLog(db);

  // Helper: zaktualizuj flagę dokumentów w Klienci
  function zaktualizujFlageDokumentow(tenant_id, idKlienta, typDokumentu) {
    const col = typDokumentu === 'RODO' ? 'rodo' : 'osw';
    db.query(
      `UPDATE Klienci SET ${col} = 'TAK' WHERE tenant_id = ? AND id_klienta = ?`,
      [tenant_id, idKlienta],
      (err) => { if (err) console.error('Błąd aktualizacji flagi:', err.message); }
    );
  }

  // ==========================================
  // GET /rodo
  // ==========================================
  router.get('/rodo', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'get_consents') {
      const id = req.query.id;
      db.query(
        `SELECT id_klienta, data_podpisu, zapoznanie_z_regulaminem, przekazano_wyciag, link_pdf FROM \`Rejestr_Oświadczeń\` WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`,
        [tenant_id, id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ znaleziona: false });
          const r = rows[0];
          const data_podpisu = r.data_podpisu ? String(r.data_podpisu).slice(0, 10) : '';
          return res.json({ znaleziona: true, data_podpisu, zapoznal: r.zapoznanie_z_regulaminem, wyciag: r.przekazano_wyciag, link_pdf: r.link_pdf || '' });
        }
      );

    } else if (action === 'get_rodo') {
      const id = req.query.id;
      db.query(
        `SELECT data_podpisu, wizerunek, newsletter_sms, kontakt_tel, newsletter_email, booksy_sms, email_adres, link_pdf, email_kontaktowy FROM Rejestr_RODO WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`,
        [tenant_id, id],
        (err, rows) => {
          if (err || !rows.length) return res.json({ znaleziona: false });
          const r = rows[0];
          const data_podpisu = r.data_podpisu ? String(r.data_podpisu).slice(0, 10) : '';
          return res.json({
            znaleziona: true, data_podpisu,
            wizerunek: r.wizerunek, news_sms: r.newsletter_sms,
            kontakt_tel: r.kontakt_tel, news_email: r.newsletter_email,
            booksy_sms: r.booksy_sms, email_adres: r.email_adres,
            link_pdf: r.link_pdf || '', email_kontaktowy: r.email_kontaktowy || ''
          });
        }
      );

    } else if (action === 'get_all_rodo') {
      db.query(
        `SELECT id_klienta, kontakt_tel FROM Rejestr_RODO WHERE tenant_id = ?`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json((rows || []).map(r => ({ id_klienta: r.id_klienta, telefon_zgoda: String(r.kontakt_tel || '').toUpperCase() })));
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET rodo: ' + action });
    }
  });

  // ==========================================
  // POST /rodo
  // ==========================================
  router.post('/rodo', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'save_rodo') {
      // Sprawdź czy istnieje wpis dla tego klienta
      db.query(
        `SELECT id FROM Rejestr_RODO WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`,
        [tenant_id, d.id_klienta],
        (err, rows) => {
          const values = [
            d.data_podpisu || null, d.wizerunek || 'NIE', d.news_sms || 'NIE',
            d.kontakt_tel || 'NIE', d.news_email || 'NIE', d.booksy_sms || 'Nie dotyczy',
            d.email_adres || '', d.pracownik || '', d.link_pdf || '', d.email_kontaktowy || ''
          ];

          // Sprawdź link do dokumentu i zaktualizuj flagę
          if (d.link_pdf) {
            zaktualizujFlageDokumentow(tenant_id, d.id_klienta, 'RODO');
          }

          if (rows && rows.length > 0) {
            db.query(
              `UPDATE Rejestr_RODO SET data_podpisu = ?, wizerunek = ?, newsletter_sms = ?, kontakt_tel = ?, newsletter_email = ?, booksy_sms = ?, email_adres = ?, pracownik = ?, link_pdf = ?, email_kontaktowy = ? WHERE tenant_id = ? AND id = ?`,
              [...values, tenant_id, rows[0].id],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                return res.json({ status: 'success', message: 'Zaktualizowano zgody, link i email!' });
              }
            );
          } else {
            const id = randomUUID();
            db.query(
              `INSERT INTO Rejestr_RODO (id, tenant_id, klient, id_klienta, data_podpisu, wizerunek, newsletter_sms, kontakt_tel, newsletter_email, booksy_sms, email_adres, pracownik, link_pdf, email_kontaktowy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, tenant_id, d.klient_nazwa || '', d.id_klienta, ...values],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                return res.json({ status: 'success', message: 'Dodano deklarację z emailem!' });
              }
            );
          }
        }
      );

    } else if (action === 'update_consents') {
      // Sprawdź czy istnieje wpis
      db.query(
        `SELECT id FROM \`Rejestr_Oświadczeń\` WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`,
        [tenant_id, d.id_klienta],
        (err, rows) => {
          // Sprawdź link
          if (d.link_pdf) {
            zaktualizujFlageDokumentow(tenant_id, d.id_klienta, 'OSW');
          }

          if (rows && rows.length > 0) {
            db.query(
              `UPDATE \`Rejestr_Oświadczeń\` SET data_podpisu = ?, zapoznanie_z_regulaminem = ?, przekazano_wyciag = ?, pracownik = ?, link_pdf = ? WHERE tenant_id = ? AND id = ?`,
              [d.data_podpisu || null, d.zapoznal || 'NIE', d.wyciag || 'NIE', d.pracownik || '', d.link_pdf || '', tenant_id, rows[0].id],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                return res.json({ status: 'success', message: 'Zaktualizowano status regulaminu i link!' });
              }
            );
          } else {
            const id = randomUUID();
            db.query(
              `INSERT INTO \`Rejestr_Oświadczeń\` (id, tenant_id, id_klienta, klient, data_podpisu, zapoznanie_z_regulaminem, przekazano_wyciag, pracownik, link_pdf) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, tenant_id, d.id_klienta, d.klient_nazwa || '', d.data_podpisu || null, d.zapoznal || 'NIE', d.wyciag || 'NIE', d.pracownik || '', d.link_pdf || ''],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                return res.json({ status: 'success', message: 'Dodano oświadczenie z linkiem!' });
              }
            );
          }
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja rodo POST: ' + action });
    }
  });

  return router;
};
