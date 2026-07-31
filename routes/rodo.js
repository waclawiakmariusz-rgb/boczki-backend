// routes/rodo.js
// RODO i zgody: get_consents, get_rodo, save_rodo, update_consents, get_all_rodo

const express = require('express');
const { randomUUID } = require('crypto');
const { makeZapiszLog } = require('./logi');

module.exports = (db) => {
  // Router MUSI powstawać wewnątrz fabryki (jak w pozostałych routerach). Gdy siedział
  // na poziomie modułu, każde kolejne wywołanie module.exports(db) dokładało handlery
  // do TEGO SAMEGO routera — pierwsza instancja (ze swoim `db`) obsługiwała wszystkie
  // żądania. W produkcji niewidoczne (fabryka wołana raz), ale w testach dawało
  // „db.query nigdy nie wywołane" i byłaby to pułapka przy każdej kolejnej instancji.
  const router = express.Router();
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

    } else if (action === 'sms_baza') {
      // Baza do akcji marketingowych (prośba recepcji 2026-07-31).
      // WAŻNE PRAWNIE: podstawą wysyłki marketingu jest zgoda MARKETINGOWA
      // (newsletter_sms / newsletter_email), a NIE kontakt_tel — ta ostatnia dotyczy
      // organizacji wizyt i nie uprawnia do reklamy. Dlatego kolumna jest wybierana
      // z zamkniętej listy, a nie doklejana z parametru.
      const KOLUMNY_ZGOD = {
        sms:   { kolumna: 'newsletter_sms',    opis: 'Zgoda marketingowa SMS' },
        email: { kolumna: 'newsletter_email',  opis: 'Zgoda marketingowa e-mail' },
        tel:   { kolumna: 'kontakt_tel',       opis: 'Zgoda na kontakt telefoniczny (NIE marketing)' },
      };
      const wybor = KOLUMNY_ZGOD[String(req.query.zgoda || 'sms').toLowerCase()];
      if (!wybor) return res.json({ status: 'error', message: 'Nieznany rodzaj zgody.' });

      // Wykluczamy usuniętych, zanonimizowanych (RODO) i zmarłych — wysyłka do nich
      // byłaby błędem, a przy zanonimizowanych też naruszeniem.
      db.query(
        `SELECT k.id_klienta, k.imie_nazwisko, k.telefon,
                r.email_adres, r.email_kontaktowy, r.data_podpisu
           FROM Rejestr_RODO r
           JOIN Klienci k ON k.tenant_id = r.tenant_id AND k.id_klienta = r.id_klienta
          WHERE r.tenant_id = ?
            AND UPPER(TRIM(COALESCE(r.\`${wybor.kolumna}\`, ''))) = 'TAK'
            AND (k.status IS NULL OR k.status = 'AKTYWNY')
            AND COALESCE(k.zmarly, 0) = 0
            AND k.data_usuniecia IS NULL
          ORDER BY k.imie_nazwisko`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: 'Błąd bazy: ' + err.message });

          const czyEmail = wybor.kolumna === 'newsletter_email';
          const lista = (rows || []).map(r => {
            const email = String(r.email_kontaktowy || r.email_adres || '').trim();
            const telefon = String(r.telefon || '').trim();
            return {
              id_klienta: r.id_klienta,
              klient: r.imie_nazwisko,
              telefon,
              email,
              kontakt: czyEmail ? email : telefon,     // to, czego użyje wysyłka
              data_zgody: r.data_podpisu ? String(r.data_podpisu).slice(0, 10) : '',
            };
          });
          const zKontaktem = lista.filter(p => p.kontakt);
          return res.json({
            status: 'ok',
            zgoda: wybor.kolumna,
            opis_zgody: wybor.opis,
            marketingowa: wybor.kolumna !== 'kontakt_tel',
            razem: lista.length,
            bez_kontaktu: lista.length - zKontaktem.length,
            lista,
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
