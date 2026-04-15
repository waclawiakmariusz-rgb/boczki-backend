// routes/admin.js
// Panel Administratora - zarządzanie salonami/tenantami

const express = require('express');
const { randomUUID } = require('crypto');
const { rateLimitLogin, recordFailedLogin, recordSuccessLogin } = require('./sessions');

let wyslijLinkRejestracji, powiadomAdmina, wyslijWitamy, wyslijPotwierdzeniZgloszenia;
try {
  const mailer = require('./mailer');
  wyslijLinkRejestracji = mailer.wyslijLinkRejestracji;
  powiadomAdmina = mailer.powiadomAdmina;
  wyslijWitamy = mailer.wyslijWitamy;
  wyslijPotwierdzeniZgloszenia = mailer.wyslijPotwierdzeniZgloszenia;
} catch (e) {
  console.warn('[admin] Mailer niedostępny:', e.message);
  wyslijLinkRejestracji = async () => { throw new Error('Mailer nie skonfigurowany na serwerze.'); };
  powiadomAdmina = async () => {};
  wyslijWitamy = async () => {};
  wyslijPotwierdzeniZgloszenia = async () => {};
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

// Sesje admina — UUID z TTL 12h (nie zwracamy hasła jako tokenu)
const ADMIN_SESSION_TTL = 12 * 60 * 60 * 1000;
const adminSessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of adminSessions.entries()) { if (now > s.expires) adminSessions.delete(t); }
}, 30 * 60 * 1000);

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.body?.admin_token || req.query?.admin_token;
  if (!token) return res.status(403).json({ status: 'error', message: 'Brak dostępu.' });
  const s = adminSessions.get(token);
  if (!s || Date.now() > s.expires) return res.status(403).json({ status: 'error', message: 'Brak dostępu.' });
  next();
}

module.exports = (db) => {
  const router = express.Router();

  // POST /api/admin/login — weryfikacja hasła admina
  router.post('/admin/login', rateLimitLogin, (req, res) => {
    const { haslo } = req.body;
    if (!haslo) return res.json({ status: 'error', message: 'Podaj hasło.' });
    if (haslo !== ADMIN_TOKEN) {
      recordFailedLogin(req);
      return res.json({ status: 'error', message: 'Błędne hasło administratora.' });
    }
    recordSuccessLogin(req);
    const sessionToken = randomUUID();
    adminSessions.set(sessionToken, { expires: Date.now() + ADMIN_SESSION_TTL });
    return res.json({ status: 'success', token: sessionToken });
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

        // Potwierdź klientowi przyjęcie zgłoszenia
        try {
          await wyslijPotwierdzeniZgloszenia({ email, imie, nazwa_salonu });
        } catch (mailErr) {
          console.error('[mailer] Potwierdzenie zgłoszenia nie wysłane:', mailErr.message);
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

            Promise.all([...pObietnice, ...uObietnice]).then(async () => {
              // Wyślij welcome email z danymi logowania
              if (email) {
                try {
                  await wyslijWitamy({ email, imie: imie || '', nazwa_salonu, login: login.trim(), haslo: haslo.trim() });
                } catch (mailErr) {
                  console.error('[admin] Błąd wysyłki welcome email:', mailErr.message);
                  // Nie blokujemy odpowiedzi — salon już istnieje
                }
              }
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

  // ─── BAZA WIEDZY CHATU (GLOBALNA) ────────────────────────────
  const GLOBAL_TENANT = '__global__';
  const VALID_KB_CATEGORIES = ['Ogólne','Magazyn','Klienci','Sprzedaż','Pracownicy','Usługi','Analityka','Vouchery','Ustawienia'];
  const safeKbCat = (c) => VALID_KB_CATEGORIES.includes(c) ? c : 'Ogólne';

  function ensureKbTable(cb) {
    db.query(
      `CREATE TABLE IF NOT EXISTS help_kb (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id  VARCHAR(100) NOT NULL,
        keywords   TEXT NOT NULL,
        answer     TEXT NOT NULL,
        category   VARCHAR(50) NOT NULL DEFAULT 'Ogólne',
        active     TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      () => {
        db.query(`ALTER TABLE help_kb ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'Ogólne'`, () => cb && cb());
      }
    );
  }

  // GET /api/admin/help-kb
  router.get('/admin/help-kb', requireAdmin, (req, res) => {
    ensureKbTable(() => {
      db.query(
        `SELECT id, keywords, answer, category, active, created_at FROM help_kb WHERE tenant_id = ? ORDER BY category, id DESC`,
        [GLOBAL_TENANT],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: 'Błąd bazy.' });
          res.json(rows || []);
        }
      );
    });
  });

  // POST /api/admin/help-kb
  router.post('/admin/help-kb', requireAdmin, (req, res) => {
    const { keywords, answer, category } = req.body;
    if (!keywords || !answer) return res.json({ status: 'error', message: 'Uzupełnij słowa kluczowe i odpowiedź.' });
    ensureKbTable(() => {
      db.query(
        `INSERT INTO help_kb (tenant_id, keywords, answer, category) VALUES (?, ?, ?, ?)`,
        [GLOBAL_TENANT, String(keywords).trim(), String(answer).trim(), safeKbCat(category)],
        (err, result) => {
          if (err) return res.json({ status: 'error', message: 'Błąd zapisu.' });
          res.json({ status: 'ok', id: result.insertId });
        }
      );
    });
  });

  // PUT /api/admin/help-kb/:id
  router.put('/admin/help-kb/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { keywords, answer, category } = req.body;
    if (!id) return res.json({ status: 'error', message: 'Nieprawidłowe id.' });
    const fields = [], vals = [];
    if (keywords !== undefined) { fields.push('keywords = ?');  vals.push(String(keywords).trim()); }
    if (answer   !== undefined) { fields.push('answer = ?');    vals.push(String(answer).trim()); }
    if (category !== undefined) { fields.push('category = ?');  vals.push(safeKbCat(category)); }
    if (!fields.length) return res.json({ status: 'error', message: 'Brak danych.' });
    vals.push(id, GLOBAL_TENANT);
    db.query(
      `UPDATE help_kb SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`,
      vals,
      (err, result) => {
        if (err) return res.json({ status: 'error', message: 'Błąd zapisu.' });
        if (result.affectedRows === 0) return res.json({ status: 'error', message: 'Nie znaleziono wpisu.' });
        res.json({ status: 'ok' });
      }
    );
  });

  // POST /api/admin/help-kb/seed — wstaw domyślne wpisy (tylko gdy tabela pusta)
  router.post('/admin/help-kb/seed', requireAdmin, (req, res) => {
    const force = req.body?.force === true; // force=true nadpisuje istniejące

    const SEED = [
      // ── MAGAZYN ──────────────────────────────────────────────
      { category:'Magazyn', keywords:'stan magazynowy, ile zostało, ilość produktu, sprawdź stan', answer:'Stan magazynowy sprawdzisz w sekcji <b>Magazyn</b>. Każdy produkt ma widoczną aktualną ilość. Czerwony kolor oznacza przekroczenie minimum — czas uzupełnić.' },
      { category:'Magazyn', keywords:'przyjęcie towaru, dostawa, nowy towar, dodaj towar', answer:'Aby przyjąć dostawę, przejdź do <b>Magazyn → Przyjęcie towaru</b>. Wybierz produkt i wpisz liczbę sztuk. Stan zaktualizuje się automatycznie.' },
      { category:'Magazyn', keywords:'inwentaryzacja, spis z natury, liczenie produktów', answer:'Inwentaryzację znajdziesz w sekcji <b>Inwentaryzacja</b>. Możesz tam zweryfikować rzeczywiste stany i wprowadzić korekty. System zapamięta datę spisu.' },
      { category:'Magazyn', keywords:'co zamówić, brakujące produkty, lista zamówień, niski stan', answer:'Sekcja <b>Co zamówić?</b> w menu automatycznie wylicza produkty poniżej minimalnego stanu. To Twoja lista zakupów — gotowa od razu.' },
      { category:'Magazyn', keywords:'usuń produkt, archiwum produktu, dezaktywuj produkt', answer:'Aby usunąć lub zarchiwizować produkt, wejdź w <b>Magazyn → Inwentaryzacja</b>, kliknij produkt i wybierz opcję <b>Archiwizuj</b>. Produkt zniknie z aktywnego widoku.' },
      { category:'Magazyn', keywords:'minimalny stan, alert magazynowy, próg, minimum', answer:'Minimalne stany magazynowe ustawiasz edytując dany produkt — pole <b>Min. ilość</b>. Gdy stan spadnie poniżej, produkt automatycznie pojawi się w raporcie "Co zamówić?".' },

      // ── KLIENCI ───────────────────────────────────────────────
      { category:'Klienci', keywords:'wyszukaj klienta, znajdź klienta, szukaj, wyszukiwanie klientów', answer:'Klientów wyszukujesz za pomocą pola wyszukiwania w górnej części sekcji <b>Klienci</b>. Możesz szukać po imieniu, nazwisku lub numerze telefonu.' },
      { category:'Klienci', keywords:'edytuj klienta, zmień dane klienta, aktualizuj telefon, zmień email', answer:'Wejdź w sekcję <b>Klienci</b>, kliknij wybranego klienta i wybierz <b>Edytuj</b>. Zmień potrzebne dane i zatwierdź przyciskiem <b>Zapisz</b>.' },
      { category:'Klienci', keywords:'historia wizyt klienta, poprzednie wizyty, karta klienta', answer:'Po kliknięciu na klienta widzisz jego <b>kartę</b> z pełną historią wizyt, wydanymi kwotami i notatkami. Świetne do analizy lojalności.' },
      { category:'Klienci', keywords:'notatka do klienta, uwagi, informacje o kliencie, special', answer:'W karcie klienta znajdziesz pole <b>Notatki</b>. Wpisz tam alergię, preferencje zabiegu, ulubiony produkt — widoczne przy każdej wizycie.' },
      { category:'Klienci', keywords:'urodziny klienta, przypomnienie urodziny, życzenia', answer:'System automatycznie oznacza klientów z urodzinami w bieżącym tygodniu. Sprawdź sekcję <b>Urodziny</b> lub filtr w widoku klientów.' },
      { category:'Klienci', keywords:'duplikat klienta, połącz klientów, ten sam klient dwa razy', answer:'Jeśli klient pojawia się dwa razy, skontaktuj się z pomocą techniczną: <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a> — ręcznie połączymy profile.' },

      // ── SPRZEDAŻ ──────────────────────────────────────────────
      { category:'Sprzedaż', keywords:'wizyty na dziś, harmonogram dnia, dzisiaj, plan dnia', answer:'Plan dnia znajdziesz w sekcji <b>Wizyty</b> lub <b>Kalendarz</b>. Widok domyślny pokazuje dzisiejsze wizyty wszystkich pracowników.' },
      { category:'Sprzedaż', keywords:'zmień godzinę wizyty, przesuń wizytę, inny termin, reschedule', answer:'Otwórz wizytę z kalendarza i kliknij <b>Edytuj</b>. Zmień datę i godzinę, wybierz pracownika i zapisz. Możesz też przeciągnąć wizytę w widoku kalendarza.' },
      { category:'Sprzedaż', keywords:'rabat, zniżka, promocja, kod rabatowy, discount', answer:'Rabat możesz dodać podczas kasowania wizyty — pole <b>Rabat</b> (kwotowy lub procentowy). Stałe rabaty dla grup klientów konfigurujesz w <b>Administracja → Rabaty</b>.' },
      { category:'Sprzedaż', keywords:'podziel płatność, split, część gotówka część karta, dwa sposoby płatności', answer:'Przy kasowaniu wizyty kliknij <b>Podziel płatność</b>. Możesz dowolnie podzielić kwotę między gotówkę, kartę i voucher.' },
      { category:'Sprzedaż', keywords:'dodaj usługę do wizyty, dopisz zabieg, więcej usług', answer:'Otwórz aktywną wizytę i kliknij <b>+ Dodaj usługę</b>. Wybierz usługę z listy — cena zostanie zsumowana automatycznie.' },
      { category:'Sprzedaż', keywords:'anuluj wizytę, odwołaj wizytę, klient rezygnuje', answer:'Otwórz wizytę i kliknij <b>Anuluj wizytę</b>. Możesz wybrać powód (klient odwołał / brak czasu / choroba). Wizyty anulowane nie trafiają do przychodów.' },

      // ── PRACOWNICY ────────────────────────────────────────────
      { category:'Pracownicy', keywords:'zmień rolę pracownika, uprawnienia, dostęp pracownika', answer:'Wejdź w <b>Administracja → Pracownicy</b>, kliknij pracownika i zmień pole <b>Rola</b>. Role: <em>pracownik</em> (ograniczony dostęp), <em>recepcja</em>, <em>manager</em>, <em>właściciel</em>.' },
      { category:'Pracownicy', keywords:'wyniki pracownika, statystyki pracownika, efektywność, ile zarobił', answer:'Statystyki każdego pracownika znajdziesz w <b>Analityka → Pracownik</b>. Widać tam przychody, liczbę wizyt i topowe usługi w wybranym okresie.' },
      { category:'Pracownicy', keywords:'targety pracownika, cel, plan sprzedażowy, KPI pracownika', answer:'Targety konfigurujesz w <b>Analityka → Konfigurator Targetów</b>. Możesz ustawić miesięczny cel przychodów lub liczby wizyt dla każdego pracownika.' },
      { category:'Pracownicy', keywords:'dezaktywuj pracownika, usuń pracownika, pracownik odszedł', answer:'W sekcji <b>Pracownicy</b> kliknij pracownika i wybierz <b>Dezaktywuj</b>. Pracownik zniknie z listy aktywnych, ale jego historia zostanie zachowana.' },
      { category:'Pracownicy', keywords:'pracownik nie może się zalogować, błąd logowania pracownika, pin nie działa', answer:'Sprawdź PIN pracownika w <b>Administracja → Pracownicy → Edytuj</b>. Możesz też nadać nowy PIN. Jeśli problem pozostaje — napisz: <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a>' },
      { category:'Pracownicy', keywords:'dodaj pracownika do usługi, przypisz pracownika, kto wykonuje zabieg', answer:'W sekcji <b>Usługi</b> edytuj wybraną usługę i w polu <b>Wykonujący</b> wskaż pracowników. Tylko oni będą propozowani przy tworzeniu wizyty na tę usługę.' },

      // ── USŁUGI ────────────────────────────────────────────────
      { category:'Usługi', keywords:'zmień cenę usługi, aktualizuj cennik, nowa cena zabiegu', answer:'Wejdź w <b>Administracja → Zabiegi</b>, kliknij usługę i zmień pole <b>Cena</b>. Nowa cena obowiązuje od razu przy kolejnych wizytach.' },
      { category:'Usługi', keywords:'ukryj usługę, dezaktywuj zabieg, przestaliśmy oferować', answer:'W <b>Administracja → Zabiegi</b> kliknij usługę i wybierz <b>Dezaktywuj</b>. Usługa zniknie z listy przy tworzeniu wizyty, ale stare wizyty pozostaną nienaruszone.' },
      { category:'Usługi', keywords:'czas trwania usługi, jak długo trwa zabieg, długość wizyty', answer:'Czas trwania ustawiasz w <b>Administracja → Zabiegi → Edytuj</b>, pole <b>Czas (min)</b>. System blokuje odpowiedni slot w kalendarzu automatycznie.' },
      { category:'Usługi', keywords:'opis usługi, informacje o zabiegu, co zawiera usługa', answer:'Opis usługi dodajesz w <b>Administracja → Zabiegi → Edytuj</b>, pole <b>Opis</b>. Pojawi się na karcie wizyty i może być widoczny dla pracowników.' },
      { category:'Usługi', keywords:'kategorie usług, grupy zabiegów, typ usługi', answer:'Usługi możesz grupować według kategorii (np. Paznokcie, Rzęsy, Masaż). Kategorię ustawiasz przy dodawaniu lub edycji usługi w polu <b>Kategoria</b>.' },
      { category:'Usługi', keywords:'kopiuj usługę, duplikuj zabieg, podobna usługa', answer:'Przy edycji usługi użyj przycisku <b>Duplikuj</b> — skopiuje wszystkie ustawienia. Zmień tylko co potrzebujesz (np. cenę lub czas) i zapisz jako nową usługę.' },

      // ── ANALITYKA ─────────────────────────────────────────────
      { category:'Analityka', keywords:'przychody za miesiąc, obrót miesięczny, wyniki miesiąca', answer:'Miesięczne przychody znajdziesz w <b>Analityka → Podsumowanie M-c</b>. Widać tam łączny obrót, podział na pracowników i porównanie z poprzednim miesiącem.' },
      { category:'Analityka', keywords:'najlepszy pracownik, ranking pracowników, top sprzedaż', answer:'Ranking pracowników jest w <b>Analityka → Pracownik</b>. Możesz sortować według przychodów, liczby wizyt lub ilości sprzedanych produktów.' },
      { category:'Analityka', keywords:'najpopularniejsze usługi, bestseller, top zabiegi, najczęściej wykonywane', answer:'Statystyki usług znajdziesz w <b>Analityka → Analiza Zabiegu</b>. Widać top usługi według liczby wykonań i generowanego przychodu.' },
      { category:'Analityka', keywords:'filtr dat, zakres czasu, od do, konkretny okres', answer:'W każdym widoku analitycznym znajdziesz selektor dat w górnym rogu. Wybierz zakres "od–do" i zatwierdź — wszystkie wykresy zaktualizują się automatycznie.' },
      { category:'Analityka', keywords:'retencja klientów, powracający klienci, lojalność, ilu wraca', answer:'Wskaźnik retencji znajdziesz w <b>Moduł Retencji</b> w menu. System wylicza odsetek klientów, którzy wrócili w ciągu 30/60/90 dni od ostatniej wizyty.' },
      { category:'Analityka', keywords:'roczne zestawienie, wyniki roczne, podsumowanie roku', answer:'Roczne zestawienie znajdziesz w <b>Analityka → Zestawienie Roczne</b>. Pokazuje przychody miesiąc po miesiącu z wykresem trendu.' },

      // ── VOUCHERY ──────────────────────────────────────────────
      { category:'Vouchery', keywords:'stwórz voucher, nowy bon, utwórz voucher, wygeneruj bon', answer:'Wejdź do sekcji <b>Vouchery</b> i kliknij <b>+ Nowy voucher</b>. Podaj wartość, opcjonalnie datę ważności i dane klienta. System wygeneruje unikalny kod.' },
      { category:'Vouchery', keywords:'saldo vouchera, wartość bonu, ile zostało na voucherze, sprawdź', answer:'W sekcji <b>Vouchery</b> wyszukaj voucher po kodzie lub nazwisku klienta. Zobaczysz pierwotną wartość, wykorzystaną kwotę i aktualne saldo.' },
      { category:'Vouchery', keywords:'zrealizuj voucher, zapłać voucherem, użyj bonu przy kasowaniu', answer:'Przy kasowaniu wizyty wybierz formę płatności <b>Voucher</b> i wpisz kod. System automatycznie odejmie kwotę od salda bonu.' },
      { category:'Vouchery', keywords:'voucher wygasł, nieważny bon, przedłuż voucher', answer:'Jeśli voucher wygasł a klient chce go zrealizować — wejdź w szczegóły vouchera i zmień datę ważności. Możesz też skontaktować się z pomocą: <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a>' },
      { category:'Vouchery', keywords:'drukuj voucher, PDF voucher, wyślij bon, wydruk', answer:'Po stworzeniu vouchera kliknij ikonę drukarki lub <b>Pobierz PDF</b>. Gotowy dokument możesz wydrukować lub przesłać klientowi mailem.' },
      { category:'Vouchery', keywords:'voucher dla pracownika, voucher prezent, bon podarunkowy dla klienta VIP', answer:'Vouchery tworzysz ręcznie — możesz wystawić bon na dowolną kwotę dla wybranego klienta. Świetne jako prezent urodzinowy dla lojalnych klientów!' },

      // ── USTAWIENIA ────────────────────────────────────────────
      { category:'Ustawienia', keywords:'zmień nazwę salonu, edytuj profil salonu, dane salonu', answer:'Dane salonu (nazwa, adres, telefon) edytujesz w <b>Ustawienia → Profil salonu</b>. Pamiętaj by zapisać zmiany przyciskiem na dole strony.' },
      { category:'Ustawienia', keywords:'godziny otwarcia, harmonogram pracy, kiedy otwarty salon', answer:'Godziny pracy ustawiasz w <b>Ustawienia → Godziny otwarcia</b>. Możesz ustawić różne godziny dla każdego dnia tygodnia i zaznaczyć dni wolne.' },
      { category:'Ustawienia', keywords:'zarządzaj dostępami, uprawnienia użytkowników, kto może co widzieć', answer:'Dostępami zarządzasz w <b>Administracja → Dostępy</b>. Możesz precyzyjnie określić jakie sekcje widzi każda rola (pracownik, recepcja, manager).' },
      { category:'Ustawienia', keywords:'backup danych, kopia zapasowa, przywróć dane', answer:'Automatyczne kopie zapasowe wykonuje Hostinger codziennie. W razie potrzeby przywrócenia danych skontaktuj się z nami: <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a>' },
      { category:'Ustawienia', keywords:'zmień hasło właściciela, hasło do systemu, nowe hasło', answer:'Hasło zmienisz klikając <b>Zapomniałem hasła</b> na stronie logowania. Na Twój email zostanie wysłany jednorazowy link (ważny 1 godzinę).' },
      { category:'Ustawienia', keywords:'integracje, połącz z systemem, API, stripe', answer:'Integracje (Stripe, SMS, email) konfigurowane są przez nasz zespół przy onboardingu. W razie zmian lub nowych potrzeb: <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a>' },

      // ── OGÓLNE ────────────────────────────────────────────────
      { category:'Ogólne', keywords:'czym jest estelio, opis systemu, co oferuje, system do salonu', answer:'Estelio to system zarządzania salonem beauty — obejmuje magazyn, klientów, wizyty, sprzedaż, vouchery i analitykę. Wszystko w jednym miejscu, dostępne z przeglądarki.' },
      { category:'Ogólne', keywords:'pierwsze kroki, jak zacząć, onboarding, start, nowy użytkownik', answer:'Zacznij od: 1) Dodania pracowników (<b>Pracownicy</b>), 2) Dodania usług (<b>Zabiegi</b>), 3) Wprowadzenia pierwszych klientów (<b>Klienci</b>). Resztą zajmiesz się w trakcie!' },
      { category:'Ogólne', keywords:'na jakich urządzeniach działa, mobile, tablet, telefon, przeglądarka', answer:'Estelio działa w przeglądarce internetowej na komputerze, tablecie i smartfonie. Nie wymaga instalacji — wystarczy adres <b>estelio.com.pl</b>.' },
      { category:'Ogólne', keywords:'bezpieczeństwo danych, RODO, ochrona danych, prywatność', answer:'Dane przechowywane są na serwerach w UE (Hostinger). System posiada szyfrowanie SSL, kontrolę dostępu i izolację danych między salonami. Pełna polityka prywatności dostępna na stronie.' },
      { category:'Ogólne', keywords:'zgłoś błąd, problem techniczny, coś nie działa, bug', answer:'Opisz problem i wyślij na <a href="mailto:kontakt@estelio.com.pl"><b>kontakt@estelio.com.pl</b></a>. Podaj co dokładnie się stało i na jakim widoku — to bardzo przyspiesza rozwiązanie.' },
      { category:'Ogólne', keywords:'aktualizacje systemu, nowe funkcje, co nowego, changelog', answer:'Aktualizacje wdrażamy automatycznie — nie musisz nic robić. O ważnych zmianach informujemy emailem. Masz pomysł na nową funkcję? Napisz do nas! 🌸' },

      // ── URODZINY ──────────────────────────────────────────────
      { category:'Urodziny', keywords:'kampania urodzinowa, lista urodzin, urodziny klientów, urodziny w systemie', answer:'Sekcja <b>Urodziny</b> w menu pokazuje klientów pogrupowanych według miesiąca urodzin. Masz 12 zakładek — jedną na każdy miesiąc. Widać imię, datę i status kampanii.' },
      { category:'Urodziny', keywords:'kto ma urodziny w tym tygodniu, najbliższe urodziny, okno 5 dni, jutro urodziny', answer:'Dashboard Urodziny automatycznie wyświetla klientów z urodzinami w ciągu <b>najbliższych 5 dni</b>. Gotowa lista do działania — wiesz kogo dziś zadzwonić lub wysłać SMS.' },
      { category:'Urodziny', keywords:'status kampanii urodzinowej, oznaczyć urodziny, wysłano sms, zadzwoniono, zaproponowano bon', answer:'Dla każdego klienta w zakładce urodzin możesz zaznaczyć status: <b>Wysłano SMS</b>, <b>Zadzwoniono</b>, <b>Zaproponowano bon</b> lub <b>Brak kontaktu</b>. Możesz też dodać notatkę.' },
      { category:'Urodziny', keywords:'dodaj datę urodzin, urodziny klienta, kiedy urodziny, pole urodziny', answer:'Datę urodzin wpisujesz w <b>karcie klienta</b> — pole <b>Data urodzin</b>. Wpisz raz — system będzie przypominał co roku i automatycznie umieści klienta na liście urodzin.' },
      { category:'Urodziny', keywords:'urodziny według miesiąca, lista styczeń, filtr miesiąc, urodziny luty marzec', answer:'W sekcji Urodziny kliknij zakładkę miesiąca (np. Marzec). Zobaczysz posortowaną listę klientów z urodzinami w tym miesiącu — imię, dzień, status kampanii.' },
      { category:'Urodziny', keywords:'komentarz do urodzin, notatka urodzinowa, klient prosił o sms nie dzwonienie', answer:'Do każdego rekordu urodzinowego możesz dopisać notatkę. Np. "Klient prosi tylko o SMS, bez telefonów". Notatka widoczna przy każdej kolejnej akcji.' },

      // ── RETENCJA ──────────────────────────────────────────────
      { category:'Retencja', keywords:'retencja klientów, klienci którzy zniknęli, dawno nie przyszli, reaktywacja klientów', answer:'Moduł <b>Retencja</b> pomaga odzyskać klientów, którzy dawno nie odwiedzili salonu. Filtruj np. "brak wizyty 60+ dni" — dostajesz gotową listę do kontaktu.' },
      { category:'Retencja', keywords:'jak prowadzić retencję, kampania reaktywacji, dzwonienie do klientów, oddzwoń', answer:'Retencja krok po kroku: 1) Wybierz filtr kampanii (np. 90 dni), 2) Zadzwoń lub napisz SMS, 3) Zapisz status rozmowy i notatkę. System śledzi kto wrócił po kontakcie.' },
      { category:'Retencja', keywords:'status retencji, wynik rozmowy retencja, umówił wizytę, brak odpowiedzi, nie wraca', answer:'Po kontakcie z klientem zapisujesz status: <b>Umówił wizytę</b>, <b>Brak odpowiedzi</b> lub <b>Nie wraca</b>. System zapamiętuje datę, kto przeprowadził kontakt i notatkę z rozmowy.' },
      { category:'Retencja', keywords:'klienci 60 dni, klienci 90 dni, nieaktywni klienci, kto nie był od miesiąca', answer:'Filtry w module Retencji: "60+ dni" to klienci po 2 miesiącach bez wizyty, "90+ dni" to 3 miesiące. Te grupy są priorytetem do reaktywacji — są blisko rezygnacji.' },
      { category:'Retencja', keywords:'kampania retencji, typ kampanii retencji, utwórz kampanię retencja', answer:'W Retencji definiujesz własne typy kampanii (np. "klienci po zabiegu Cera+"). Każda kampania ma własną listę kontaktów i pełną historię działań.' },

      // ── KONSULTACJE ───────────────────────────────────────────
      { category:'Konsultacje', keywords:'konsultacje, moduł konsultacji, co to konsultacje, wyniki reklamy facebook', answer:'Moduł <b>Konsultacje</b> śledzi wyniki kampanii sprzedażowych (np. reklama na FB). Rejestrujesz każdą rozmowę z potencjalnym klientem i sprawdzasz czy przyniosła zysk powyżej progu.' },
      { category:'Konsultacje', keywords:'dodaj konsultację, nowa konsultacja, zapis konsultacji, wynik konsultacji, wpisz konsultację', answer:'W sekcji <b>Konsultacje</b> kliknij <b>+ Nowa konsultacja</b>. Wpisz imię klienta, typ kampanii, zabiegi, kwotę zakupu i kwotę upsell. System automatycznie oceni czy to sukces.' },
      { category:'Konsultacje', keywords:'próg sukcesu konsultacji, czy konsultacja jest sukcesem, opłacalność reklamy, zielona czerwona', answer:'Dla każdej kampanii ustawiasz <b>próg sukcesu</b> (np. 500 zł). Zakup powyżej progu → konsultacja zielona (sukces). Poniżej progu → czerwona. Widzisz od razu czy reklama się opłaca.' },
      { category:'Konsultacje', keywords:'typ kampanii konsultacji, utwórz kampanię konsultacje, fb cera, pakiet zabiegowy', answer:'Typy kampanii tworzysz w <b>Konsultacje → Kampanie</b>. Każda ma własną nazwę (np. "FB Cera+") i próg kwotowy. Możesz mieć kilka aktywnych kampanii jednocześnie.' },
      { category:'Konsultacje', keywords:'konsultanci, lista konsultantów, kto prowadzi konsultacje, aktywni konsultanci', answer:'W <b>Konsultacje → Konsultanci</b> zarządzasz listą pracowników przeprowadzających konsultacje. Możesz aktywować lub dezaktywować poszczególne osoby.' },

      // ── TARGETY ───────────────────────────────────────────────
      { category:'Targety', keywords:'dodaj target, nowy target, cel pracownika, plan sprzedażowy na miesiąc, KPI', answer:'Targety ustawiasz w <b>Analityka → Konfigurator Targetów</b>. Wybierz pracownika, miesiąc, typ celu (kwota / liczba wizyt / liczba produktów) i wartość docelową.' },
      { category:'Targety', keywords:'realizacja targetu, postęp celu, ile zrobił pracownik, procent planu, jak daleko do targetu', answer:'W <b>Analityka → Pracownik</b> widać aktualny postęp realizacji targetów — ile pracownik osiągnął z planowanego celu w bieżącym miesiącu.' },
      { category:'Targety', keywords:'aov, średni paragon, średnia wartość koszyka, wartość transakcji', answer:'AOV (Average Order Value) to średnia wartość jednej transakcji. Wyliczana jako suma sprzedaży ÷ liczba transakcji. Widoczna w <b>Analityka → Pracownik</b> — ważny wskaźnik przy ustawianiu targetów.' },
      { category:'Targety', keywords:'dashboard pracownika, panel pracownika analityka, wyniki pracownika, co widać w analityce pracownika', answer:'Dashboard pracownika w Analityce pokazuje: łączny utarg, podział usługi/kosmetyki %, liczbę transakcji, AOV, konsultacje i % sukcesu. Wszystko z filtrem dat.' },
      { category:'Targety', keywords:'zmień target, edytuj cel, nowy plan na następny miesiąc, zaktualizuj target', answer:'Target edytujesz w <b>Analityka → Konfigurator Targetów</b> — kliknij istniejący wpis i zmień wartość. Każdy pracownik i każdy miesiąc to oddzielny rekord.' },

      // ── RODO ──────────────────────────────────────────────────
      { category:'RODO', keywords:'rodo klient, zgoda na dane, klauzula rodo, ochrona danych klienta, rejestr rodo', answer:'Moduł <b>RODO</b> to rejestr wszystkich zgód klientów. Dla każdego klienta odnotujesz: zgodę na wizerunek, SMS marketing, newsletter, kontakt telefoniczny i Booksy.' },
      { category:'RODO', keywords:'dodaj zgodę rodo, klient podpisał rodo, zaznaczyć rodo, flaga rodo', answer:'W karcie klienta otwórz zakładkę <b>RODO</b>. Zaznacz odpowiednie zgody, wpisz datę podpisu i kto przyjął. Klient z kompletem zgód dostaje zieloną flagę na liście.' },
      { category:'RODO', keywords:'oświadczenie klienta, regulamin osw, podpisał regulamin, wyciąg z cennika, osw co to', answer:'Oświadczenia (OSW) to osobny rejestr — czy klient zapoznał się z regulaminem i czy przekazano wyciąg. Obowiązkowe przy pierwszej wizycie. Zakładka <b>OSW</b> w karcie klienta.' },
      { category:'RODO', keywords:'wgraj dokument rodo, skan zgody, zdjęcie formularza, pdf rodo, upload dokumentu', answer:'Podpisany formularz fotografujesz (do 6 zdjęć) i wgrywasz z karty klienta. System konwertuje zdjęcia do PDF, optymalizuje i zapisuje link w kartotece klienta.' },
      { category:'RODO', keywords:'kto nie podpisał rodo, brakujące zgody, filtr rodo, lista bez rodo', answer:'W liście klientów ikonki RODO i OSW sygnalizują status zgód. Brak ikony = brakujące zgody. Użyj filtru "bez RODO" aby wyświetlić tylko klientów bez podpisanych dokumentów.' },
      { category:'RODO', keywords:'jakie zgody zbiera estelio, kategorie zgód, co zawiera rodo, wizerunek sms newsletter', answer:'System rejestruje zgody na: <b>wizerunek</b>, <b>SMS marketing</b>, <b>newsletter</b>, <b>kontakt telefoniczny</b> i <b>Booksy</b>. Każda ma datę podpisu i wskazanie osoby przyjmującej.' },

      // ── LOGI ──────────────────────────────────────────────────
      { category:'Logi', keywords:'logi systemu, historia zmian, dziennik zdarzeń, co się dzieje w systemie', answer:'Sekcja <b>Logi</b> w menu pokazuje ostatnie 300 akcji w systemie — kto co zrobił i kiedy. Widoczne: dodania klientów, zmiany magazynowe, sprzedaże, logowania.' },
      { category:'Logi', keywords:'kto dodał klienta, kto zmienił stan magazynowy, kto przeprowadził akcję, historia operacji', answer:'Każdy wpis w logach zawiera: typ zdarzenia, datę i godzinę oraz szczegóły akcji. Znajdziesz w menu sekcja <b>Logi</b>. Możesz przewijać do 300 ostatnich zdarzeń.' },
      { category:'Logi', keywords:'log sprzedaży, historia sprzedaży w logach, kiedy dodano wizytę, sprawdź transakcję', answer:'Akcje sprzedażowe pojawiają się w logach jako <b>SPRZEDAŻ ADD</b>. Widać dokładnie kiedy i jakie wizyty były rejestrowane — przydatne przy weryfikacji rozbieżności w raportach.' },
      { category:'Logi', keywords:'historia logowań, kto się logował, nieautoryzowany dostęp, sprawdź logowania', answer:'Logi rejestrują każde udane logowanie właściciela i pracownika. Jeśli widzisz podejrzane logowanie — natychmiast zmień hasło i napisz: <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a>' },

      // ── PORTFEL / ZADATKI ─────────────────────────────────────
      { category:'Klienci', keywords:'portfel klienta, zadatek, przedpłata klienta, saldo klienta, konto klienta', answer:'Portfel klienta to wbudowane konto z saldem. Klient wpłaca pieniądze z góry (np. zaliczkę) — przy kolejnych wizytach kwota może zostać pobrana z portfela zamiast gotówki.' },
      { category:'Klienci', keywords:'wpłata na portfel, dodaj zadatek, wpisz zadatek klienta, zasilij portfel', answer:'W karcie klienta kliknij <b>Portfel → + Wpłata</b>. Podaj kwotę i formę płatności. Każda operacja jest odnotowana w historii portfela.' },
      { category:'Klienci', keywords:'pobierz z portfela, użyj zadatku, płatność z portfela klienta', answer:'Przy kasowaniu wizyty wybierz formę płatności <b>Portfel</b>. System sprawdzi saldo i automatycznie pobierze odpowiednią kwotę. Możesz połączyć z gotówką (podziel płatność).' },
      { category:'Klienci', keywords:'historia portfela, operacje portfel, skąd to saldo, wszystkie wpłaty klienta', answer:'Historia wszystkich wpłat i pobrań z portfela dostępna jest w zakładce <b>Portfel</b> w karcie klienta. Widać daty, kwoty i kto wykonał każdą operację.' },

      // ── CROSS-SELL ────────────────────────────────────────────
      { category:'Klienci', keywords:'cross-sell, sugestia sprzedaży, co zaproponować klientowi, upsell przy wizycie', answer:'Moduł <b>Cross-sell</b> tworzy reguły sprzedażowe (np. "po strzyżeniu zaproponuj odżywkę"). Pracownik widzi sugestię automatycznie w karcie klienta podczas wizyty.' },
      { category:'Klienci', keywords:'reguła cross-sell, dodaj sugestię sprzedażową, po zabiegu zaproponuj produkt', answer:'Reguły cross-sell konfigurujesz w <b>Administracja → Cross-sell</b>. Wybierz usługę wyzwalającą i produkt/usługę do zaproponowania. Pracownik zobaczy podpowiedź automatycznie.' },

      // ── SPRZEDAŻ — dodatkowe warianty ────────────────────────
      { category:'Sprzedaż', keywords:'fifo kosmetyki, kolejność sprzedaży towaru, który towar sprzedać, rotacja stocku', answer:'Przy sprzedaży kosmetyku system używa metody <b>FIFO</b> — zdejmuje towar z najstarszego przyjęcia. Stare partie nie zalegają, a rotacja stocku jest zawsze poprawna.' },
      { category:'Sprzedaż', keywords:'kilku pracowników na wizycie, dwóch pracowników przy zabiegu, współpraca, podział usługi', answer:'Przy tworzeniu wizyty możesz przypisać kilku pracowników do jednego zabiegu. Każdy dostanie zaliczony udział w przychodach według ustawionego podziału.' },
      { category:'Sprzedaż', keywords:'widok dzienny wizyty, wizyty na dany dzień, plan dnia pracownika, dzisiaj w kalendarzu', answer:'W sekcji <b>Wizyty</b> lub <b>Kalendarz</b> przełącz na <b>Widok dzienny</b>. Kolumny to pracownicy, wiersze to godziny — wszystkie wizyty na dziś jednym rzutem oka.' },
      { category:'Sprzedaż', keywords:'raport dzienny, kasa koniec dnia, wyniki za dzisiaj, dzienny utarg, podsumowanie dnia', answer:'Raport dzienny znajdziesz w <b>Analityka → Raport Dzienny</b>. Pokazuje wszystkie transakcje z wybranego dnia, formy płatności (gotówka/karta/voucher) i sumę do rozliczenia.' },

      // ── MAGAZYN — dodatkowe warianty ─────────────────────────
      { category:'Magazyn', keywords:'słownik produktów, baza kosmetyków, dodaj markę, firma kosmetyczna, autocomplete produktów', answer:'<b>Słownik produktów</b> to biblioteka firm i modeli z cenami detalicznymi. Przy dodawaniu nowego produktu zacznij wpisywać nazwę — system podpowie z bazy, zamiast wpisywać ręcznie.' },
      { category:'Magazyn', keywords:'przywróć produkt z archiwum, reaktywuj produkt, wyciągnij z archiwum magazyn', answer:'Zarchiwizowany produkt przywrócisz w <b>Magazyn → Archiwum</b>. Kliknij produkt i wybierz <b>Przywróć</b>. Pojawi się na aktywnej liście z poprzednim stanem.' },
      { category:'Magazyn', keywords:'korekta stanu magazynowego, ręczna zmiana ilości, błąd w stanie, pomyłka w magazynie', answer:'Korekty stanu robisz przez <b>Inwentaryzację</b>. Wpisz rzeczywistą ilość — system wyliczy różnicę i zaloguje zmianę. Każda korekta jest odnotowana datą i osobą.' },

      // ── ANALITYKA — dodatkowe warianty ───────────────────────
      { category:'Analityka', keywords:'koszty operacyjne, wpisz koszty miesiąca, czynsz, media, kosmetyki zużycie', answer:'Koszty wpisujesz w <b>Analityka → Koszty</b>. Dodaj pozycje (czynsz, kosmetyki, media) — system automatycznie wyliczy przychód netto po odjęciu kosztów od przychodów.' },
      { category:'Analityka', keywords:'przychód netto, zysk po kosztach, ile zarobił salon netto, wynik finansowy', answer:'Przychód netto = przychody − koszty operacyjne. Obliczany automatycznie w <b>Analityka → Podsumowanie M-c</b> po uzupełnieniu sekcji Koszty o wydatki miesiąca.' },
      { category:'Analityka', keywords:'sezonowość, trendy roczne, kiedy najlepszy miesiąc salon, wykres rok, wykres trend', answer:'W <b>Analityka → Zestawienie Roczne</b> zobaczysz wykres miesięcznych przychodów z trendem. Sezonowość salonu natychmiast widoczna — które miesiące są najlepsze.' },

      // ── USTAWIENIA — dodatkowe warianty ──────────────────────
      { category:'Ustawienia', keywords:'sesja wygasła, zostałem wylogowany, muszę zalogować ponownie, koniec sesji', answer:'Sesja logowania wygasa po <b>8 godzinach</b>. Wylogowanie to normalne zachowanie systemu — po prostu zaloguj się ponownie. Wszystkie dane są bezpieczne.' },
      { category:'Ustawienia', keywords:'dark mode tryb nocny, zmień motyw, jasny ciemny tryb, wygląd systemu', answer:'Tryb ciemny (dark mode) włączysz klikając ikonę 🌙 w pasku bocznym. Kliknij ponownie żeby wrócić do jasnego motywu. Ustawienie zapamiętane w przeglądarce.' },

      // ── OGÓLNE — dodatkowe warianty ───────────────────────────
      { category:'Ogólne', keywords:'cena estelio, ile kosztuje, abonament miesięczny, 49 zł, opłata miesięczna', answer:'Estelio kosztuje <b>49 zł miesięcznie</b>. Płatność kartą przez Stripe — odnawiana automatycznie. Pytania o fakturę lub anulowanie: <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a>' },
      { category:'Ogólne', keywords:'esti jak działa, skąd esti odpowiedzi, baza wiedzy esti, algorytm chatbota', answer:'Esti szuka odpowiedzi w bazie wiedzy — liczy punkty za pasujące słowa kluczowe. Wygrywa karta z najwyższym wynikiem. Nie używa AI — działa offline, bez internetu.' },
      { category:'Ogólne', keywords:'dodaj pytania do esti, własna baza wiedzy esti, panel admina esti, niestandardowe odpowiedzi', answer:'Własne pytania do Esti dodajesz w <b>Administracja → Baza wiedzy</b>. Twoje wpisy mają wyższy priorytet (+3) niż domyślne. Możesz opisać własne procedury i produkty salonu.' },
      { category:'Ogólne', keywords:'restart serwera, wylogowani wszyscy, straciłem sesję, serwer się uruchomił ponownie', answer:'Jeśli wszyscy w salonie zostali nagle wylogowani — prawdopodobnie serwer się zrestartował. Zaloguj się ponownie — wszystkie dane są bezpieczne w bazie danych.' },
      { category:'Ogólne', keywords:'rejestracja salonu, jak założyć konto estelio, nowe konto, link aktywacyjny, token rejestracyjny', answer:'Rejestrację salonu przeprowadzasz przez jednorazowy link aktywacyjny — otrzymujesz go emailem po zakupie lub od admina. Link ważny jest <b>7 dni</b>.' },
      { category:'Ogólne', keywords:'link rejestracyjny wygasł, token wygasł, link nie działa, prześlij nowy link', answer:'Jeśli link aktywacyjny wygasł lub nie doszedł — napisz do nas: <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a>. Wygenerujemy nowy link natychmiast.' },
      { category:'Ogólne', keywords:'nie dostałem emaila, email nie doszedł, brak potwierdzenia email, sprawdź spam', answer:'Jeśli email nie doszedł: 1) sprawdź folder <b>Spam</b>, 2) odczekaj do 5 minut, 3) napisz do nas: <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a> podając adres email i nazwę salonu.' },
      { category:'Ogólne', keywords:'jak działa stripe, płatność za estelio, kartą za estelio, blik za estelio', answer:'Płatność za Estelio odbywa się przez <b>Stripe Checkout</b> — bezpieczną stronę płatności. Akceptuje kartę, BLIK i inne metody. Po płatności system automatycznie wysyła link aktywacyjny.' },

      // ── PRACOWNICY — logowanie i role ─────────────────────────
      { category:'Pracownicy', keywords:'logowanie pracownika pin, jak pracownik się loguje, wejdź jako pracownik, pin pracowniczy, ekran wyboru imienia', answer:'Pracownik <b>nie używa loginu ani hasła</b> — na ekranie logowania wybiera swoje <b>imię z listy</b>, a następnie wpisuje <b>PIN (4–6 cyfr)</b>. Każdy pracownik ma swój własny PIN przypisany przez właściciela.' },
      { category:'Pracownicy', keywords:'co widzi każda rola, dostęp recepcja, uprawnienia manager, role systemu, jakie sekcje widzi pracownik, różnica ról', answer:'Role w systemie: <b>pracownik</b> — tylko sprzedaż i podgląd klientów, bez finansów; <b>recepcja</b> — klienci, wizyty, kasowanie; <b>manager</b> — sprzedaż, magazyn, raporty; <b>właściciel</b> — pełny dostęp do wszystkiego.' },
      { category:'Pracownicy', keywords:'zmień pin pracownika, nowy pin, zapomniał pin, resetuj pin pracownika, ustaw pin', answer:'PIN pracownika zmienisz w <b>Administracja → Pracownicy → Edytuj</b>. Wpisz nowy PIN w polu <b>PIN</b> i zapisz. Pracownik od razu może się zalogować nowym PINem. Minimalna długość to 4 cyfry.' },
      { category:'Pracownicy', keywords:'ilu pracowników można dodać, limit pracowników, ile osób w systemie, maksymalnie pracownicy', answer:'System nie narzuca limitu liczby pracowników. Możesz dodać tyle osób ile potrzebujesz — każda ma własne imię, PIN i rolę określającą dostęp do modułów.' },

      // ── KLIENCI — dodawanie i flagi ───────────────────────────
      { category:'Klienci', keywords:'dodaj nowego klienta, nowa klientka, nowa osoba, rejestracja klienta, jak dodać klienta, pierwszy raz', answer:'Nowego klienta dodajesz klikając <b>+ Nowy klient</b> w sekcji Klienci. Minimum to imię i numer telefonu. Resztę (email, urodziny, notatki, RODO) możesz uzupełnić później przy pierwszej wizycie.' },
      { category:'Klienci', keywords:'flagi klientów, ikona rodo przy kliencie, co oznacza ikona osw, ikonka portfela lista, znaczki przy kliencie, symbole lista', answer:'W liście klientów trzy flagi: 🛡️ <b>RODO</b> — zgoda na przetwarzanie danych podpisana; 📋 <b>OSW</b> — regulamin/oświadczenie podpisane; 💰 <b>Portfel</b> — klient ma aktywne saldo zadatków. Brak ikony = do uzupełnienia.' },
      { category:'Klienci', keywords:'usuń klienta, skasuj klientkę, wymaż dane klienta, RODO usunięcie danych', answer:'Usunięcia danych klienta (na wniosek RODO) dokonuje się z karty klienta opcją <b>Usuń klienta</b>. Jeśli opcja jest niedostępna dla Twojej roli — skontaktuj się z właścicielem salonu.' },

      // ── SPRZEDAŻ — kasowanie kosmetyków i no-show ────────────
      { category:'Sprzedaż', keywords:'sprzedaj kosmetyk, sprzedaż produktu ze sklepu, kasuj kosmetyk, klient kupuje produkt, zakup kosmetyku przy wizycie', answer:'Przy kasowaniu dodaj pozycję <b>Kosmetyk</b> — wybierz produkt z magazynu i wpisz ilość. System automatycznie odejmie stan (metoda FIFO) i doda sprzedaż produktu do raportu.' },
      { category:'Sprzedaż', keywords:'no show, klient nie przyszedł, absent, klient nie stawił się na wizycie, nieobecny klient', answer:'Wizytę klienta, który nie przyszedł, oznacz jako <b>No-show</b> przy edycji wizyty. Wizyty no-show nie trafiają do przychodów, ale pozostają w historii — ważne dla statystyk.' },
      { category:'Sprzedaż', keywords:'usuń sprzedaż, cofnij wizytę, anuluj transakcję, błąd przy kasowaniu, korekta sprzedaży', answer:'Sprzedaż możesz anulować wchodząc w szczegóły wizyty i klikając <b>Anuluj wizytę</b>. Anulowana wizyta nie wlicza się do przychodów. Jeśli nie możesz anulować — sprawdź uprawnienia swojej roli.' },

      // ── MAGAZYN — dodawanie produktów ────────────────────────
      { category:'Magazyn', keywords:'dodaj nowy produkt magazyn, nowa pozycja magazynowa, nowy kosmetyk w systemie, utwórz produkt, nie ma produktu na liście', answer:'Nowy produkt dodajesz w <b>Magazyn → Dodaj produkt</b>. Podaj nazwę, markę i jednostkę. Zacznij wpisywać — system podpowiada z <b>Słownika produktów</b>. Po dodaniu możesz od razu przyjąć pierwszą dostawę.' },
      { category:'Magazyn', keywords:'ile mam produktów łącznie, wartość magazynu, suma stanów, całkowity stan magazynowy', answer:'Łączny widok stanów masz w sekcji <b>Magazyn</b> — lista wszystkich aktywnych produktów z aktualnymi ilościami. Produkty poniżej minimum oznaczone są czerwonym kolorem.' },

      // ── ANALITYKA — koszty i wydruki ─────────────────────────
      { category:'Analityka', keywords:'wydrukuj raport, drukuj zestawienie, eksport pdf analityka, pdf z raportu, drukowanie danych', answer:'W widoku analitycznym kliknij ikonę 🖨️ lub przycisk <b>Drukuj</b>. Otworzy się podgląd wydruku — możesz drukować lub zapisać jako PDF. Działa w każdej przeglądarce.' },
      { category:'Analityka', keywords:'porównaj miesiące, porównanie z poprzednim miesiącem, czy wzrosły przychody, różnica miesiąc do miesiąca', answer:'W <b>Analityka → Podsumowanie M-c</b> widoczne jest porównanie z poprzednim miesiącem — wzrost lub spadek przychodów zaznaczony kolorem. Świetne do śledzenia trendu wzrostu.' },

      // ── USTAWIENIA — sesja, dostęp ───────────────────────────
      { category:'Ustawienia', keywords:'wyloguj się, wyjdź z systemu, zmień użytkownika, zakończ sesję, jak się wylogować', answer:'Aby się wylogować, kliknij swoje <b>imię lub ikonę użytkownika</b> w górnym rogu i wybierz <b>Wyloguj</b>. Sesja wygasa też automatycznie po <b>8 godzinach</b> nieaktywności — dla bezpieczeństwa.' },
      { category:'Ustawienia', keywords:'domena salonu, adres url systemu, jak wejść do systemu, link do estelio, adres strony', answer:'System Estelio dostępny jest pod adresem <b>estelio.com.pl</b>. Zaloguj się używając loginu i hasła właściciela. Działa w każdej przeglądarce — bez instalacji, na komputerze, tablecie i telefonie.' },
      { category:'Ustawienia', keywords:'powiadomienia w systemie, alerty, czy estelio wysyła sms, przypomnienie o wizycie', answer:'Estelio nie wysyła automatycznych SMS-ów do klientów — to moduł planowany. Emaile wysyłane są tylko przy zdarzeniach systemowych (rejestracja, reset hasła). SMS-y wysyłasz ręcznie z modułu Retencji/Urodzin.' },

      // ── OGÓLNE — pomoc i kontakt ──────────────────────────────
      { category:'Ogólne', keywords:'pomoc techniczna, kontakt estelio, mail wsparcie, napisz do estelio, helpdesk, support', answer:'Pomoc techniczna: <a href="mailto:kontakt@estelio.com.pl"><b>kontakt@estelio.com.pl</b></a>. Opisz dokładnie co się stało i na jakim widoku. Podaj nazwę salonu. Odpowiadamy jak najszybciej. 🌸' },
      { category:'Ogólne', keywords:'jakie emaile wysyła system, automatyczne powiadomienia email, kiedy dostanę email, wiadomości od estelio', answer:'System wysyła emaile automatycznie przy: zakupie (link aktywacyjny), rejestracji salonu (dane logowania), resecie hasła (jednorazowy link). Nadawca zawsze: <b>kontakt@estelio.com.pl</b>.' },
      { category:'Ogólne', keywords:'czy dane są bezpieczne, gdzie są moje dane, serwer polska, przechowywanie danych klientów', answer:'Dane przechowywane są na serwerach <b>w UE</b> (Hostinger). Połączenie chronione certyfikatem SSL. Codzienne automatyczne kopie zapasowe. Każdy salon widzi wyłącznie swoje dane.' },
      { category:'Ogólne', keywords:'nie pamiętam loginu, zapomniałem login, jaki jest mój login, jak się nazywa moje konto', answer:'Login właściciela ustalany jest podczas rejestracji salonu. Jeśli nie pamiętasz loginu — napisz do nas: <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a>, potwierdzimy go na podstawie adresu email rejestracji.' },
    ];

    ensureKbTable(() => {
      // Sprawdź ile jest już wpisów globalnych
      db.query(`SELECT COUNT(*) AS cnt FROM help_kb WHERE tenant_id = ?`, [GLOBAL_TENANT], (err, rows) => {
        if (err) return res.json({ status: 'error', message: 'Błąd bazy.' });
        const existing = rows[0].cnt;
        if (existing > 0 && !force) {
          return res.json({ status: 'error', message: `Baza już zawiera ${existing} wpisów. Użyj force:true aby nadpisać.` });
        }

        // Jeśli force — wyczyść istniejące globalne
        const doInsert = () => {
          const values = SEED.map(e => [GLOBAL_TENANT, e.keywords, e.answer, e.category]);
          db.query(
            `INSERT INTO help_kb (tenant_id, keywords, answer, category) VALUES ?`,
            [values],
            (err, result) => {
              if (err) return res.json({ status: 'error', message: 'Błąd zapisu: ' + err.message });
              res.json({ status: 'ok', inserted: result.affectedRows });
            }
          );
        };

        if (force && existing > 0) {
          db.query(`DELETE FROM help_kb WHERE tenant_id = ?`, [GLOBAL_TENANT], (err) => {
            if (err) return res.json({ status: 'error', message: 'Błąd czyszczenia.' });
            doInsert();
          });
        } else {
          doInsert();
        }
      });
    });
  });

  // DELETE /api/admin/help-kb/:id
  router.delete('/admin/help-kb/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.json({ status: 'error', message: 'Nieprawidłowe id.' });
    db.query(
      `DELETE FROM help_kb WHERE id = ? AND tenant_id = ?`,
      [id, GLOBAL_TENANT],
      (err, result) => {
        if (err) return res.json({ status: 'error', message: 'Błąd usunięcia.' });
        if (result.affectedRows === 0) return res.json({ status: 'error', message: 'Nie znaleziono wpisu.' });
        res.json({ status: 'ok' });
      }
    );
  });

  return router;
};
