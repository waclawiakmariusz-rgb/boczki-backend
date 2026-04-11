// routes/admin.js
// Panel Administratora - zarządzanie salonami/tenantami

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');

let wyslijLinkRejestracji, powiadomAdmina;
try {
  const mailer = require('./mailer');
  wyslijLinkRejestracji = mailer.wyslijLinkRejestracji;
  powiadomAdmina = mailer.powiadomAdmina;
} catch (e) {
  console.warn('[admin] Mailer niedostępny:', e.message);
  wyslijLinkRejestracji = async () => { throw new Error('Mailer nie skonfigurowany na serwerze.'); };
  powiadomAdmina = async () => {};
}

// ─── Pomocnicze ──────────────────────────────────────────────
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // usuń akcenty
    .replace(/ł/g, 'l').replace(/ą/g, 'a').replace(/ę/g, 'e')
    .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z')
    .replace(/ż/g, 'z').replace(/ć/g, 'c').replace(/ń/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Middleware: weryfikacja tokenu admina ────────────────────
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || 'boczki-admin-2026').replace(/^['"]|['"]$/g, '');

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.body?.admin_token || req.query?.admin_token;
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(403).json({ status: 'error', message: 'Brak dostępu.' });
  }
  next();
}

module.exports = (db) => {

  // POST /api/admin/login — weryfikacja hasła admina
  router.post('/admin/login', (req, res) => {
    const { haslo } = req.body;
    if (!haslo) return res.json({ status: 'error', message: 'Podaj hasło.' });
    if (haslo === ADMIN_TOKEN) {
      return res.json({ status: 'success', token: ADMIN_TOKEN });
    }
    return res.json({ status: 'error', message: 'Błędne hasło administratora.' });
  });

  // GET /api/admin/salony — lista wszystkich salonów
  router.get('/admin/salony', requireAdmin, (req, res) => {
    db.query(
      `SELECT id, login, rola, id_bazy, status, data_waznosci, nazwa_salonu, miasto, telefon, email, data_utworzenia
       FROM Licencje ORDER BY data_utworzenia DESC`,
      (err, rows) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json(rows || []);
      }
    );
  });

  // POST /api/admin/create_tenant — tworzenie nowego salonu
  router.post('/admin/create_tenant', requireAdmin, (req, res) => {
    const d = req.body;
    const { nazwa_salonu, miasto, telefon, email, login, haslo, data_waznosci, pracownicy, uslugi } = d;

    if (!nazwa_salonu || !login || !haslo) {
      return res.json({ status: 'error', message: 'Podaj nazwę salonu, login i hasło.' });
    }

    // Generuj unikalny tenant_id
    const slug = slugify(nazwa_salonu);
    const suffix = Date.now().toString().slice(-4);
    const tenant_id = `${slug}-${suffix}`;
    const licId = randomUUID();

    // 1. Utwórz licencję
    db.query(
      `INSERT INTO Licencje (id, login, haslo, rola, id_bazy, status, data_waznosci, nazwa_salonu, miasto, telefon, email, data_utworzenia)
       VALUES (?, ?, ?, 'salon', ?, 'aktywny', ?, ?, ?, ?, ?, NOW())`,
      [licId, login.trim(), haslo.trim(), tenant_id, data_waznosci || null, nazwa_salonu, miasto || '', telefon || '', email || ''],
      (err) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') return res.json({ status: 'error', message: 'Login już istnieje!' });
          return res.json({ status: 'error', message: 'Błąd tworzenia licencji: ' + err.message });
        }

        // 2. Dodaj pracowników i PIN-y do Użytkownicy
        const pracList = Array.isArray(pracownicy) ? pracownicy : [];
        const pObietnice = pracList
          .filter(p => p.imie && p.imie.trim())
          .map(p => new Promise((resolve) => {
            const pid = randomUUID();
            db.query(
              `INSERT INTO Użytkownicy (id, tenant_id, imie_login, haslo_pin, rola) VALUES (?, ?, ?, ?, ?)`,
              [pid, tenant_id, p.imie.trim(), p.pin || '0000', p.rola || 'pracownik'],
              () => {
                // Też do Pracownicy (dla sprzedaży)
                const prid = randomUUID();
                db.query(
                  `INSERT INTO Pracownicy (id, tenant_id, imie) VALUES (?, ?, ?)`,
                  [prid, tenant_id, p.imie.trim()],
                  () => resolve()
                );
              }
            );
          }));

        // 3. Dodaj usługi
        const uslugiList = Array.isArray(uslugi) ? uslugi : [];
        const uObietnice = uslugiList
          .filter(u => u.kategoria && u.wariant)
          .map(u => new Promise((resolve) => {
            const uid = randomUUID();
            db.query(
              `INSERT INTO Uslugi (id, tenant_id, kategoria, wariant, cena) VALUES (?, ?, ?, ?, ?)`,
              [uid, tenant_id, u.kategoria.trim(), u.wariant.trim(), parseFloat(u.cena) || 0],
              () => resolve()
            );
          }));

        Promise.all([...pObietnice, ...uObietnice]).then(() => {
          return res.json({
            status: 'success',
            message: `Salon "${nazwa_salonu}" został utworzony!`,
            tenant_id
          });
        });
      }
    );
  });

  // POST /api/admin/update_tenant — edycja salonu
  router.post('/admin/update_tenant', requireAdmin, (req, res) => {
    const d = req.body;
    if (!d.id_bazy) return res.json({ status: 'error', message: 'Brak tenant_id' });

    db.query(
      `UPDATE Licencje SET nazwa_salonu=?, miasto=?, telefon=?, email=?, data_waznosci=?, status=?
       WHERE id_bazy=? LIMIT 1`,
      [d.nazwa_salonu, d.miasto || '', d.telefon || '', d.email || '', d.data_waznosci || null, d.status || 'aktywny', d.id_bazy],
      (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success', message: 'Zaktualizowano dane salonu.' });
      }
    );
  });

  // POST /api/admin/toggle_tenant — blokowanie/odblokowywanie
  router.post('/admin/toggle_tenant', requireAdmin, (req, res) => {
    const { id_bazy, status } = req.body;
    if (!id_bazy) return res.json({ status: 'error', message: 'Brak tenant_id' });

    db.query(
      `UPDATE Licencje SET status=? WHERE id_bazy=? LIMIT 1`,
      [status, id_bazy],
      (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success' });
      }
    );
  });

  // ─── TOKENY REJESTRACJI ───────────────────────────────────────

  // POST /api/admin/generate_token — wygeneruj link rejestracyjny (opcjonalnie wyślij email)
  router.post('/admin/generate_token', requireAdmin, (req, res) => {
    const { notatka, dni_waznosci, email_klienta, imie_klienta, nazwa_salonu } = req.body;
    const token = randomUUID();
    const dni = parseInt(dni_waznosci) || 7;
    const wygasa = new Date(Date.now() + dni * 24 * 60 * 60 * 1000);

    db.query(
      `INSERT INTO Tokeny_rejestracji (token, status, data_wygasniecia, notatka) VALUES (?, 'nowy', ?, ?)`,
      [token, wygasa, notatka || null],
      async (err) => {
        if (err) return res.json({ status: 'error', message: err.message });

        // Jeśli podano email — wyślij automatycznie
        if (email_klienta) {
          try {
            await wyslijLinkRejestracji({ email: email_klienta, imie: imie_klienta, token, nazwa_salonu });
            return res.json({ status: 'success', token, wyslano_email: true });
          } catch (mailErr) {
            console.error('[mailer] Błąd wysyłki:', mailErr.message);
            return res.json({ status: 'success', token, wyslano_email: false, mail_error: mailErr.message });
          }
        }

        return res.json({ status: 'success', token, wyslano_email: false });
      }
    );
  });

  // POST /api/admin/wyslij_link — wyślij link do istniejącego tokenu lub zamówienia
  router.post('/admin/wyslij_link', requireAdmin, async (req, res) => {
    const { token, email, imie, nazwa_salonu, zamowienie_id } = req.body;
    if (!token || !email) return res.json({ status: 'error', message: 'Brak tokenu lub emaila.' });

    try {
      await wyslijLinkRejestracji({ email, imie, token, nazwa_salonu });

      // Jeśli to zgłoszenie — aktualizuj status
      if (zamowienie_id) {
        db.query(
          `UPDATE Zamowienia SET status='wyslano_link', token_wyslany=? WHERE id=?`,
          [token, zamowienie_id]
        );
      }

      return res.json({ status: 'success', message: 'Link wysłany!' });
    } catch (err) {
      return res.json({ status: 'error', message: 'Błąd wysyłki maila: ' + err.message });
    }
  });

  // GET /api/admin/tokeny — lista tokenów
  router.get('/admin/tokeny', requireAdmin, (req, res) => {
    // Najpierw wygaś przestarzałe tokeny
    db.query(
      `UPDATE Tokeny_rejestracji SET status='wygasly' WHERE status='nowy' AND data_wygasniecia < NOW()`,
      () => {
        db.query(
          `SELECT token, status, data_wygasniecia, data_utworzenia, data_wykorzystania, notatka, tenant_id_utworzony
           FROM Tokeny_rejestracji ORDER BY data_utworzenia DESC LIMIT 50`,
          (err, rows) => {
            if (err) return res.json({ status: 'error', message: err.message });
            return res.json(rows || []);
          }
        );
      }
    );
  });

  // POST /api/admin/delete_token — usuń token
  router.post('/admin/delete_token', requireAdmin, (req, res) => {
    const { token } = req.body;
    db.query(`DELETE FROM Tokeny_rejestracji WHERE token = ? LIMIT 1`, [token], (err) => {
      if (err) return res.json({ status: 'error', message: err.message });
      return res.json({ status: 'success' });
    });
  });

  // ─── ZAMÓWIENIA (formularz publiczny) ────────────────────────

  // POST /api/zamowienie — nowe zgłoszenie od klienta
  router.post('/zamowienie', async (req, res) => {
    const { imie, nazwa_salonu, email, telefon, miasto, wiadomosc } = req.body;
    if (!imie || !nazwa_salonu || !email) {
      return res.json({ status: 'error', message: 'Podaj imię, nazwę salonu i email.' });
    }

    const id = randomUUID();
    db.query(
      `INSERT INTO Zamowienia (id, imie, nazwa_salonu, email, telefon, miasto, wiadomosc) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, imie.trim(), nazwa_salonu.trim(), email.trim(), telefon || null, miasto || null, wiadomosc || null],
      async (err) => {
        if (err) return res.json({ status: 'error', message: 'Błąd zapisu: ' + err.message });

        // Powiadom admina emailem
        try {
          await powiadomAdmina({ imie, nazwa_salonu, email, telefon, miasto, wiadomosc });
        } catch (mailErr) {
          console.error('[mailer] Powiadomienie admina nie wysłane:', mailErr.message);
        }

        return res.json({ status: 'success', message: 'Zgłoszenie zostało przyjęte!' });
      }
    );
  });

  // GET /api/admin/zamowienia — lista zgłoszeń
  router.get('/admin/zamowienia', requireAdmin, (req, res) => {
    db.query(
      `SELECT * FROM Zamowienia ORDER BY data_zgloszenia DESC`,
      (err, rows) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json(rows || []);
      }
    );
  });

  // POST /api/admin/zamowienie_status — zmień status
  router.post('/admin/zamowienie_status', requireAdmin, (req, res) => {
    const { id, status } = req.body;
    db.query(`UPDATE Zamowienia SET status=? WHERE id=?`, [status, id], (err) => {
      if (err) return res.json({ status: 'error', message: err.message });
      return res.json({ status: 'success' });
    });
  });

  // ─── REJESTRACJA PRZEZ TOKEN (publiczne, bez requireAdmin) ───

  // GET /api/rejestracja/weryfikuj?token=... — sprawdź ważność tokenu
  router.get('/rejestracja/weryfikuj', (req, res) => {
    const { token } = req.query;
    if (!token) return res.json({ status: 'error', message: 'Brak tokenu.' });

    db.query(
      `SELECT token, status, data_wygasniecia, notatka FROM Tokeny_rejestracji WHERE token = ? LIMIT 1`,
      [token],
      (err, rows) => {
        if (err || !rows.length) return res.json({ status: 'error', message: 'Nieprawidłowy link rejestracyjny.' });
        const t = rows[0];
        if (t.status === 'wykorzystany') return res.json({ status: 'error', message: 'Ten link rejestracyjny został już wykorzystany.' });
        if (t.status === 'wygasly' || new Date(t.data_wygasniecia) < new Date()) {
          return res.json({ status: 'error', message: 'Ten link rejestracyjny wygasł.' });
        }
        return res.json({ status: 'ok', wygasa: t.data_wygasniecia });
      }
    );
  });

  // POST /api/rejestracja/zaloz — utwórz salon przez token (publiczne)
  router.post('/rejestracja/zaloz', (req, res) => {
    const d = req.body;
    const { token, nazwa_salonu, miasto, telefon, email, login, haslo, pracownicy, uslugi } = d;

    if (!token) return res.json({ status: 'error', message: 'Brak tokenu.' });
    if (!nazwa_salonu || !login || !haslo) return res.json({ status: 'error', message: 'Uzupełnij wszystkie wymagane pola.' });

    // Sprawdź token i zablokuj go atomowo (UPDATE ... WHERE status='nowy')
    db.query(
      `UPDATE Tokeny_rejestracji SET status='wykorzystany', data_wykorzystania=NOW()
       WHERE token = ? AND status = 'nowy' AND data_wygasniecia > NOW()`,
      [token],
      (err, result) => {
        if (err) return res.json({ status: 'error', message: 'Błąd bazy: ' + err.message });
        if (!result.affectedRows) {
          return res.json({ status: 'error', message: 'Link jest nieważny, wygasł lub został już użyty.' });
        }

        // Token zablokowany — tworzymy salon
        const slug = slugify(nazwa_salonu);
        const suffix = Date.now().toString().slice(-4);
        const tenant_id = `${slug}-${suffix}`;
        const licId = randomUUID();

        db.query(
          `INSERT INTO Licencje (id, login, haslo, rola, id_bazy, status, nazwa_salonu, miasto, telefon, email, data_utworzenia)
           VALUES (?, ?, ?, 'salon', ?, 'aktywny', ?, ?, ?, ?, NOW())`,
          [licId, login.trim(), haslo.trim(), tenant_id, nazwa_salonu, miasto || '', telefon || '', email || ''],
          (err2) => {
            if (err2) {
              // Cofnij token jeśli zapis się nie udał
              db.query(`UPDATE Tokeny_rejestracji SET status='nowy', data_wykorzystania=NULL WHERE token=?`, [token]);
              if (err2.code === 'ER_DUP_ENTRY') return res.json({ status: 'error', message: 'Ten login jest już zajęty. Wybierz inny.' });
              return res.json({ status: 'error', message: 'Błąd tworzenia konta: ' + err2.message });
            }

            // Zapisz tenant_id w tokenie
            db.query(`UPDATE Tokeny_rejestracji SET tenant_id_utworzony=? WHERE token=?`, [tenant_id, token]);

            // Pracownicy i usługi
            const pracList = Array.isArray(pracownicy) ? pracownicy : [];
            const uslugiList = Array.isArray(uslugi) ? uslugi : [];

            const pObietnice = pracList.filter(p => p.imie?.trim()).map(p => new Promise(resolve => {
              const pid = randomUUID();
              db.query(`INSERT INTO Użytkownicy (id, tenant_id, imie_login, haslo_pin, rola) VALUES (?, ?, ?, ?, ?)`,
                [pid, tenant_id, p.imie.trim(), p.pin || '0000', p.rola || 'pracownik'], () => {
                  const prid = randomUUID();
                  db.query(`INSERT INTO Pracownicy (id, tenant_id, imie) VALUES (?, ?, ?)`,
                    [prid, tenant_id, p.imie.trim()], () => resolve());
                });
            }));

            const uObietnice = uslugiList.filter(u => u.kategoria && u.wariant).map(u => new Promise(resolve => {
              const uid = randomUUID();
              db.query(`INSERT INTO Uslugi (id, tenant_id, kategoria, wariant, cena) VALUES (?, ?, ?, ?, ?)`,
                [uid, tenant_id, u.kategoria.trim(), u.wariant.trim(), parseFloat(u.cena) || 0], () => resolve());
            }));

            Promise.all([...pObietnice, ...uObietnice]).then(() => {
              return res.json({ status: 'success', message: 'Salon został zarejestrowany!', tenant_id, login: login.trim() });
            });
          }
        );
      }
    );
  });

  // ─── VOUCHERY ────────────────────────────────────────────────

  // Auto-create tabeli jeśli nie istnieje
  db.query(`CREATE TABLE IF NOT EXISTS Kody_rabatowe (
    id INT AUTO_INCREMENT PRIMARY KEY,
    kod VARCHAR(50) UNIQUE NOT NULL,
    typ ENUM('procent','zlotowki') NOT NULL,
    wartosc DECIMAL(10,2) NOT NULL,
    czas_trwania ENUM('zawsze','miesiecy') NOT NULL DEFAULT 'zawsze',
    czas_trwania_miesiecy INT NULL,
    max_uzyc INT NULL,
    ilosc_uzyc INT DEFAULT 0,
    aktywny TINYINT DEFAULT 1,
    notatka VARCHAR(255) NULL,
    data_wygasniecia DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('[admin] Błąd tworzenia tabeli Kody_rabatowe:', err.message);
  });

  // GET /api/admin/vouchery — lista voucherów
  router.get('/admin/vouchery', requireAdmin, (req, res) => {
    db.query(`SELECT * FROM Kody_rabatowe ORDER BY created_at DESC`, (err, rows) => {
      if (err) return res.json({ status: 'error', message: err.message });
      return res.json(rows || []);
    });
  });

  // POST /api/admin/voucher — utwórz voucher
  router.post('/admin/voucher', requireAdmin, (req, res) => {
    const { kod, typ, wartosc, czas_trwania, czas_trwania_miesiecy, max_uzyc, notatka, data_wygasniecia } = req.body;
    if (!kod || !typ || wartosc === undefined) return res.json({ status: 'error', message: 'Podaj kod, typ i wartość.' });
    if (!['procent', 'zlotowki'].includes(typ)) return res.json({ status: 'error', message: 'Nieprawidłowy typ.' });

    const ct = czas_trwania === 'miesiecy' ? 'miesiecy' : 'zawsze';
    const ctMies = ct === 'miesiecy' ? (parseInt(czas_trwania_miesiecy) || 12) : null;

    db.query(
      `INSERT INTO Kody_rabatowe (kod, typ, wartosc, czas_trwania, czas_trwania_miesiecy, max_uzyc, notatka, data_wygasniecia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        kod.trim().toUpperCase(), typ, parseFloat(wartosc), ct, ctMies,
        max_uzyc ? parseInt(max_uzyc) : null,
        notatka || null,
        data_wygasniecia || null
      ],
      (err) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') return res.json({ status: 'error', message: 'Kod już istnieje.' });
          return res.json({ status: 'error', message: err.message });
        }
        return res.json({ status: 'success', message: 'Voucher utworzony.' });
      }
    );
  });

  // POST /api/admin/voucher/toggle — aktywuj/deaktywuj
  router.post('/admin/voucher/toggle', requireAdmin, (req, res) => {
    const { id, aktywny } = req.body;
    db.query(`UPDATE Kody_rabatowe SET aktywny=? WHERE id=? LIMIT 1`, [aktywny ? 1 : 0, id], (err) => {
      if (err) return res.json({ status: 'error', message: err.message });
      return res.json({ status: 'success' });
    });
  });

  // POST /api/admin/voucher/delete — usuń voucher
  router.post('/admin/voucher/delete', requireAdmin, (req, res) => {
    const { id } = req.body;
    db.query(`DELETE FROM Kody_rabatowe WHERE id=? LIMIT 1`, [id], (err) => {
      if (err) return res.json({ status: 'error', message: err.message });
      return res.json({ status: 'success' });
    });
  });

  // GET /api/voucher/weryfikuj?kod=... — publiczne, sprawdź voucher i zwróć rabat
  router.get('/voucher/weryfikuj', (req, res) => {
    const { kod } = req.query;
    if (!kod) return res.json({ status: 'error', message: 'Brak kodu.' });

    const cena = parseInt(process.env.STRIPE_CENA_GROSZE) || 19900;

    db.query(
      `SELECT * FROM Kody_rabatowe WHERE kod=? AND aktywny=1 LIMIT 1`,
      [kod.trim().toUpperCase()],
      (err, rows) => {
        if (err || !rows.length) return res.json({ status: 'error', message: 'Nieprawidłowy kod rabatowy.' });
        const v = rows[0];

        if (v.data_wygasniecia && new Date(v.data_wygasniecia) < new Date()) {
          return res.json({ status: 'error', message: 'Ten kod rabatowy wygasł.' });
        }
        if (v.max_uzyc !== null && v.ilosc_uzyc >= v.max_uzyc) {
          return res.json({ status: 'error', message: 'Kod rabatowy został już w pełni wykorzystany.' });
        }

        let cenaPoRabacie;
        if (v.typ === 'procent') {
          cenaPoRabacie = Math.round(cena * (1 - v.wartosc / 100));
        } else {
          cenaPoRabacie = Math.max(0, cena - Math.round(v.wartosc * 100));
        }

        const czasOpis = v.czas_trwania === 'zawsze'
          ? 'na zawsze'
          : `przez ${v.czas_trwania_miesiecy} mies.`;

        return res.json({
          status: 'ok',
          kod: v.kod,
          typ: v.typ,
          wartosc: parseFloat(v.wartosc),
          czas_trwania: v.czas_trwania,
          czas_trwania_miesiecy: v.czas_trwania_miesiecy,
          cena_oryginalna_grosze: cena,
          cena_po_rabacie_grosze: cenaPoRabacie,
          cena_po_rabacie_display: (cenaPoRabacie / 100).toFixed(0) + ' zł',
          opis_rabatu: v.typ === 'procent'
            ? `-${v.wartosc}% ${czasOpis}`
            : `-${v.wartosc} zł ${czasOpis}`,
        });
      }
    );
  });

  return router;
};
