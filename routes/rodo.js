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

  // ── Dziennik Zdarzeń dla zgód (polecenie właściciela 24.11.2026: „każdorazowo zmiany zgód mają zapisywać się
  // w rejestrze"). Rejestr_RODO nie ma daty zmiany, więc jedynym śladem „kto, komu, kiedy, co" jest wpis w Logi —
  // zawsze pełnym zdaniem, z wartością przed i po. Zapis zgód nie zależy od powodzenia wpisu (zapiszLog nie rzuca).
  const POLA_ZGOD = [
    ['kontakt_tel', 'kontakt_tel', 'kontakt telefoniczny'],
    ['newsletter_sms', 'news_sms', 'SMS marketingowy'],
    ['newsletter_email', 'news_email', 'e-mail marketingowy'],
    ['wizerunek', 'wizerunek', 'wizerunek'],
    ['booksy_sms', 'booksy_sms', 'Booksy SMS'],
  ];
  const DOMYSLNE_ZGODY = { kontakt_tel: 'NIE', news_sms: 'NIE', news_email: 'NIE', wizerunek: 'NIE', booksy_sms: 'Nie dotyczy' };
  const tekst = (v) => String(v == null ? '' : v).trim();
  const emailTekst = (v) => { const t = tekst(v).toLowerCase(); return t === 'nie dotyczy' ? '' : t; };
  const dataTekst = (v) => {
    if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    const t = tekst(v); return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t;
  };
  const kiedy = () => {
    const d = new Date();
    const f = (o) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', ...o }).format(d);
    return `${f({ day: '2-digit', month: '2-digit', year: 'numeric' })} o ${f({ hour: '2-digit', minute: '2-digit' })}`;
  };
  function zdanieZmian(naglowek, kto, nowe, stare, inneZmiany, czego) {
    if (!stare) return `${naglowek} Zapisane po raz pierwszy ${kiedy()} (zapis: ${kto}): ${nowe.map(([e, v]) => `${e} ${v}`).join(', ')}.`;
    const zmienione = [], bezZmian = [];
    for (const [etykieta, nowa, kol, domyslna] of nowe) {
      const staraW = tekst(stare[kol]) || domyslna || '';
      if (staraW.toUpperCase() !== nowa.toUpperCase()) zmienione.push(`${etykieta} ${staraW || 'brak'} → ${nowa}`);
      else bezZmian.push(`${etykieta} ${nowa}`);
    }
    if (zmienione.length) {
      return `${naglowek} Zmienione ${kiedy()} (zapis: ${kto}): ${zmienione.join(', ')}.`
        + (bezZmian.length ? ` Bez zmian: ${bezZmian.join(', ')}.` : '')
        + (inneZmiany.length ? ` Zmieniono też: ${inneZmiany.join(', ')}.` : '');
    }
    if (inneZmiany.length) return `${naglowek} Zapisane ${kiedy()} (zapis: ${kto}) bez zmiany ${czego} (${bezZmian.join(', ')}). Zmieniono: ${inneZmiany.join(', ')}.`;
    return `${naglowek} Zapisane ${kiedy()} (zapis: ${kto}) bez żadnych zmian (${bezZmian.join(', ')}).`;
  }
  function zapiszZmianeZgod(tenant_id, d, stare) {
    const kto = tekst(d.pracownik) || 'nieznana osoba';
    const nazwa = tekst(d.klient_nazwa) || tekst(stare && stare.klient) || 'bez nazwy';
    const naglowek = `Zgody RODO: ${nazwa} (nr ${tekst(d.id_klienta)}).`;
    const nowe = POLA_ZGOD.map(([kol, pole, etykieta]) => [etykieta, tekst(d[pole]) || DOMYSLNE_ZGODY[pole], kol, DOMYSLNE_ZGODY[pole]]);
    const inne = [];
    if (stare) {
      const sd = dataTekst(stare.data_podpisu), nd = dataTekst(d.data_podpisu);
      if (sd !== nd) inne.push(`data podpisu ${sd || 'brak'} → ${nd || 'brak'}`);
      if (tekst(stare.link_pdf) !== tekst(d.link_pdf)) inne.push('link do dokumentu');
      if (emailTekst(stare.email_kontaktowy) !== emailTekst(d.email_kontaktowy) || emailTekst(stare.email_adres) !== emailTekst(d.email_adres)) inne.push('adres e-mail');
    }
    zapiszLog(tenant_id, 'ZMIANA ZGÓD RODO', kto, zdanieZmian(naglowek, kto, nowe, stare, inne, 'zgód'));
  }
  function zapiszZmianeOswiadczen(tenant_id, d, stare) {
    const kto = tekst(d.pracownik) || 'nieznana osoba';
    const nazwa = tekst(d.klient_nazwa) || tekst(stare && stare.klient) || 'bez nazwy';
    const naglowek = `Oświadczenia: ${nazwa} (nr ${tekst(d.id_klienta)}).`;
    const nowe = [
      ['zapoznanie z regulaminem', tekst(d.zapoznal) || 'NIE', 'zapoznanie_z_regulaminem', 'NIE'],
      ['przekazanie wyciągu', tekst(d.wyciag) || 'NIE', 'przekazano_wyciag', 'NIE'],
    ];
    const inne = [];
    if (stare) {
      const sd = dataTekst(stare.data_podpisu), nd = dataTekst(d.data_podpisu);
      if (sd !== nd) inne.push(`data podpisu ${sd || 'brak'} → ${nd || 'brak'}`);
      if (tekst(stare.link_pdf) !== tekst(d.link_pdf)) inne.push('link do dokumentu');
    }
    zapiszLog(tenant_id, 'ZMIANA OŚWIADCZEŃ', kto, zdanieZmian(naglowek, kto, nowe, stare, inne, 'oświadczeń'));
  }

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
        // Jeden ustalony wpis na klientkę (najstarszy) — ten sam, który edytuje save_rodo i czyta get_all_rodo.
        // 12 klientek Boczków ma po dwa wpisy z importów (kwiecień 2026); bez ORDER BY wybór był przypadkowy.
        `SELECT data_podpisu, wizerunek, newsletter_sms, kontakt_tel, newsletter_email, booksy_sms, email_adres, link_pdf, email_kontaktowy FROM Rejestr_RODO WHERE tenant_id = ? AND id_klienta = ? ORDER BY utworzono_w ASC, id ASC LIMIT 1`,
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
        // Ticket #32 (Ania, 24.11.2026): Retencja czyta też zgodę marketingową SMS (newsletter_sms) i pokazuje,
        // którą zgodę klientka ma. Kolejność NAJSTARSZY wpis pierwszy — dokładnie ten, który pokazuje i edytuje
        // profil klientki (get_rodo / save_rodo). Regresja z 24.11 19:10: „najnowszy pierwszy” brało przy
        // zdublowanych wpisach kopię z importu z TAK, choć w profilu zgody były już wycofane (pani Urban, 7 osób).
        `SELECT id_klienta, kontakt_tel, newsletter_sms FROM Rejestr_RODO WHERE tenant_id = ?
          ORDER BY utworzono_w ASC, id ASC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json([]);
          return res.json((rows || []).map(r => ({
            id_klienta: r.id_klienta,
            telefon_zgoda: String(r.kontakt_tel || '').trim().toUpperCase(),
            sms_zgoda: String(r.newsletter_sms || '').trim().toUpperCase()
          })));
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
        `SELECT id, klient, data_podpisu, wizerunek, newsletter_sms, kontakt_tel, newsletter_email, booksy_sms, email_adres, link_pdf, email_kontaktowy FROM Rejestr_RODO WHERE tenant_id = ? AND id_klienta = ? ORDER BY utworzono_w ASC, id ASC LIMIT 1`,
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
                // Zgody dotyczą osoby, nie wpisu: pozostałe (zdublowane) wpisy tej klientki dostają te same zgody,
                // żeby żaden ekran nie czytał już wycofanej zgody z kopii. Dokument i e-mail zostają bez zmian.
                db.query(
                  `UPDATE Rejestr_RODO SET wizerunek = ?, newsletter_sms = ?, kontakt_tel = ?, newsletter_email = ?, booksy_sms = ?, pracownik = ? WHERE tenant_id = ? AND id_klienta = ? AND id <> ?`,
                  [d.wizerunek || 'NIE', d.news_sms || 'NIE', d.kontakt_tel || 'NIE', d.news_email || 'NIE', d.booksy_sms || 'Nie dotyczy', d.pracownik || '', tenant_id, d.id_klienta, rows[0].id],
                  (err3) => {
                    zapiszZmianeZgod(tenant_id, d, rows[0]);
                    if (err3) return res.json({ status: 'error', message: 'Zgody zapisane, ale nie udało się ujednolicić zdublowanych wpisów: ' + err3.message });
                    return res.json({ status: 'success', message: 'Zaktualizowano zgody, link i email!' });
                  }
                );
              }
            );
          } else {
            const id = randomUUID();
            db.query(
              `INSERT INTO Rejestr_RODO (id, tenant_id, klient, id_klienta, data_podpisu, wizerunek, newsletter_sms, kontakt_tel, newsletter_email, booksy_sms, email_adres, pracownik, link_pdf, email_kontaktowy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, tenant_id, d.klient_nazwa || '', d.id_klienta, ...values],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                zapiszZmianeZgod(tenant_id, d, null);
                return res.json({ status: 'success', message: 'Dodano deklarację z emailem!' });
              }
            );
          }
        }
      );

    } else if (action === 'update_consents') {
      // Sprawdź czy istnieje wpis
      db.query(
        `SELECT id, klient, data_podpisu, zapoznanie_z_regulaminem, przekazano_wyciag, link_pdf FROM \`Rejestr_Oświadczeń\` WHERE tenant_id = ? AND id_klienta = ? LIMIT 1`,
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
                zapiszZmianeOswiadczen(tenant_id, d, rows[0]);
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
                zapiszZmianeOswiadczen(tenant_id, d, null);
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
