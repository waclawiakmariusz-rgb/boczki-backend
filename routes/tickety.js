// routes/tickety.js — wewnętrzne zgłoszenia salonów do twórcy Estelio (błędy, prośby o zmiany, pytania).
// 2026-10-11. „Taka Jira": każde zgłoszenie = ticket z numerem (#id), kategorią, pilnością, zrzutami
// ekranu; automatycznie: salon (tenant), kto zgłosił, data/godzina. Salon widzi WSZYSTKIE swoje
// zgłoszenia z odpowiedzią admina i statusem; admin (admin.html) widzi wszystkie salony, odpowiada,
// zamyka, ma statystyki (kto ile zgłosił).
//
// IZOLACJA OD RESZTY SYSTEMU (wymóg usera: „nie może zepsuć innych elementów"):
//  • dwie WŁASNE tabele (Zgloszenia_Tickety, Zgloszenia_Zalaczniki), tworzone IF NOT EXISTS, nic w istniejących;
//  • własny prefiks akcji `tk_*` w dispatcherze POST /api (sesja + tenant sprawdzane jak wszędzie);
//  • załączniki jako MEDIUMBLOB w bazie (nie w UPLOADS_DIR — ta zmienna już 2× znikała na Hostingerze),
//    upload osobną trasą multipart (limit express.json 1 MB nie dotyczy multipart), max 4 MB/plik, 5 plików;
//  • każde zapytanie do tabel ticketów filtruje po tenant_id; załącznik można pobrać tylko w ramach
//    swojego salonu (albo jako admin);
//  • admin: ten sam mechanizm tokenu co reszta admin.html (admin_sessions, nagłówek X-Admin-Token).
const express = require('express');
const multer = require('multer');
const { makeZapiszLog } = require('./logi');

const KATEGORIE = ['blad', 'prosba', 'pytanie', 'inne'];
const PILNOSCI = ['niska', 'normalna', 'wysoka', 'krytyczna'];
const STATUSY = ['nowe', 'w_toku', 'zamkniete'];
const MAX_ZALACZNIKOW = 5;
const MAX_PLIK_B = 4 * 1024 * 1024;
const DOZWOLONE_TYPY = /^(image\/(png|jpeg|jpg|gif|webp)|application\/pdf)$/i;

module.exports = (db, opts = {}) => {
  const router = express.Router();
  const mailer = opts.mailer || require('./mailer');
  const sessions = opts.sessions || require('./sessions');
  const log = opts.log || console;
  const zapiszLog = makeZapiszLog(db);
  const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (e, r) => (e ? reject(e) : resolve(r))));

  // ── tabele (IF NOT EXISTS; kolacja jawnie, bo nowe tabele MariaDB dostają inną domyślną) ──
  db.query(`CREATE TABLE IF NOT EXISTS Zgloszenia_Tickety (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      nazwa_salonu VARCHAR(255) NULL,
      pracownik VARCHAR(100) NULL,
      rola VARCHAR(50) NULL,
      kategoria VARCHAR(20) NOT NULL DEFAULT 'inne',
      pilnosc VARCHAR(20) NOT NULL DEFAULT 'normalna',
      tytul VARCHAR(200) NOT NULL,
      opis TEXT NULL,
      kontekst VARCHAR(500) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'nowe',
      odpowiedz TEXT NULL,
      odpowiedz_data DATETIME NULL,
      odpowiedz_przeczytana TINYINT(1) NOT NULL DEFAULT 1,
      data_utworzenia DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      data_zamkniecia DATETIME NULL,
      INDEX idx_tenant (tenant_id, status),
      INDEX idx_status (status, data_utworzenia)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, (e) => { if (e) log.error('[tickety] CREATE Zgloszenia_Tickety:', e.message); });
  db.query(`CREATE TABLE IF NOT EXISTS Zgloszenia_Zalaczniki (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id INT NOT NULL,
      tenant_id VARCHAR(100) NOT NULL,
      nazwa VARCHAR(200) NULL,
      typ VARCHAR(100) NULL,
      rozmiar INT NULL,
      dane MEDIUMBLOB NULL,
      data_dodania DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket (ticket_id)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, (e) => { if (e) log.error('[tickety] CREATE Zgloszenia_Zalaczniki:', e.message); });

  const s = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const KOLUMNY_LISTY = `t.id, t.tenant_id, t.nazwa_salonu, t.pracownik, t.rola, t.kategoria, t.pilnosc, t.tytul, t.opis, t.kontekst,
      t.status, t.odpowiedz, t.odpowiedz_data, t.odpowiedz_przeczytana, t.data_utworzenia, t.data_zamkniecia,
      (SELECT COUNT(*) FROM Zgloszenia_Zalaczniki z WHERE z.ticket_id = t.id) AS zalaczniki`;

  // ── admin: ten sam token co reszta panelu (tabela admin_sessions z routes/admin.js) ──
  function wymagajAdmina(req, res, next) {
    const token = req.headers['x-admin-token'] || (req.query && req.query.admin_token);
    if (!token) return res.status(403).json({ status: 'error', message: 'Brak dostępu.' });
    db.query('SELECT expires FROM admin_sessions WHERE token = ?', [token], (err, rows) => {
      if (err || !rows || !rows.length || Date.now() > Number(rows[0].expires)) {
        return res.status(403).json({ status: 'error', message: 'Sesja wygasła — zaloguj się ponownie.' });
      }
      next();
    });
  }

  // ════════════════ Dispatcher POST /api (action tk_*) — sesja i tenant już sprawdzone w server.js ════════════════
  router.post('/tickety', async (req, res) => {
    const d = req.body || {};
    const { action, tenant_id } = d;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id.' });
    try {
      if (action === 'tk_add') {
        const tytul = s(d.tytul, 200);
        const opis = s(d.opis, 5000);
        if (tytul.length < 3) return res.json({ status: 'error', message: 'Podaj krótki tytuł zgłoszenia (min. 3 znaki).' });
        if (opis.length < 5) return res.json({ status: 'error', message: 'Opisz, co się stało albo czego potrzebujesz (min. 5 znaków).' });
        const kategoria = KATEGORIE.includes(d.kategoria) ? d.kategoria : 'inne';
        const pilnosc = PILNOSCI.includes(d.pilnosc) ? d.pilnosc : 'normalna';
        const pracownik = s(d.pracownik || d.user_log, 100) || 'nieznany';
        const rola = s(d.rola, 50);
        const nazwa_salonu = s(d.nazwa_salonu, 255) || null;
        const kontekst = s(d.kontekst, 500) || null;
        const r = await q(
          `INSERT INTO Zgloszenia_Tickety (tenant_id, nazwa_salonu, pracownik, rola, kategoria, pilnosc, tytul, opis, kontekst, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'nowe')`,
          [tenant_id, nazwa_salonu, pracownik, rola, kategoria, pilnosc, tytul, opis, kontekst]);
        const id = r.insertId;
        zapiszLog(tenant_id, 'ZGŁOSZENIE DO ESTELIO', pracownik, `#${id} [${kategoria}/${pilnosc}] ${tytul}`);
        // mail do admina — fire-and-forget, błąd poczty nie psuje zgłoszenia
        Promise.resolve()
          .then(() => mailer.powiadomAdminaOTickecie({ id, tenant_id, nazwa_salonu, pracownik, rola, kategoria, pilnosc, tytul, opis }))
          .catch(e => log.error('[tickety] mail do admina:', e.message));
        return res.json({ status: 'success', id, message: `Zgłoszenie #${id} zapisane.` });
      }

      if (action === 'tk_list') {
        const rows = await q(`SELECT ${KOLUMNY_LISTY} FROM Zgloszenia_Tickety t WHERE t.tenant_id = ? ORDER BY t.id DESC LIMIT 300`, [tenant_id]);
        return res.json({ status: 'success', data: rows || [] });
      }

      if (action === 'tk_get') {
        const id = parseInt(d.id, 10);
        if (!id) return res.json({ status: 'error', message: 'Brak numeru zgłoszenia.' });
        const rows = await q(`SELECT ${KOLUMNY_LISTY} FROM Zgloszenia_Tickety t WHERE t.id = ? AND t.tenant_id = ?`, [id, tenant_id]);
        if (!rows || !rows.length) return res.json({ status: 'error', message: 'Nie ma takiego zgłoszenia w tym salonie.' });
        const zal = await q(`SELECT id, nazwa, typ, rozmiar, data_dodania FROM Zgloszenia_Zalaczniki WHERE ticket_id = ? AND tenant_id = ? ORDER BY id`, [id, tenant_id]);
        return res.json({ status: 'success', data: { ...rows[0], zalaczniki_lista: zal || [] } });
      }

      if (action === 'tk_przeczytane') {
        const id = parseInt(d.id, 10);
        if (!id) return res.json({ status: 'error', message: 'Brak numeru zgłoszenia.' });
        await q(`UPDATE Zgloszenia_Tickety SET odpowiedz_przeczytana = 1 WHERE id = ? AND tenant_id = ?`, [id, tenant_id]);
        return res.json({ status: 'success' });
      }

      if (action === 'tk_zalacznik') {
        // Załącznik tylko w ramach własnego salonu — jako base64 (POST przechodzi przez sesję, GET-y nie).
        const id = parseInt(d.id, 10);
        if (!id) return res.json({ status: 'error', message: 'Brak numeru załącznika.' });
        const rows = await q(`SELECT nazwa, typ, dane FROM Zgloszenia_Zalaczniki WHERE id = ? AND tenant_id = ?`, [id, tenant_id]);
        if (!rows || !rows.length) return res.json({ status: 'error', message: 'Brak załącznika.' });
        const z = rows[0];
        return res.json({ status: 'success', nazwa: z.nazwa, typ: z.typ, dane: Buffer.from(z.dane || '').toString('base64') });
      }

      return res.json({ status: 'error', message: 'Nieznana akcja zgłoszeń: ' + action });
    } catch (e) {
      log.error('[tickety]', action, e.message);
      return res.json({ status: 'error', message: 'Nie udało się przetworzyć zgłoszenia. Spróbuj ponownie.' });
    }
  });

  // ════════════════ Upload załącznika (multipart; sesja sprawdzana TU, bo to nie dispatcher) ════════════════
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PLIK_B, files: 1 } });
  router.post('/tickety/zalacznik', (req, res) => {
    upload.single('plik')(req, res, async (err) => {
      if (err) return res.status(400).json({ status: 'error', message: err.code === 'LIMIT_FILE_SIZE' ? 'Plik jest za duży (max 4 MB).' : 'Nie udało się przyjąć pliku.' });
      const tenant_id = s(req.body && req.body.tenant_id, 100);
      const ticket_id = parseInt(req.body && req.body.ticket_id, 10);
      const w = sessions.validateTenantAccess(req.headers['x-session-token'], tenant_id);
      if (!w.valid) return res.status(403).json({ status: 'error', code: 'SESJA', message: 'Brak dostępu. Zaloguj się ponownie.' });
      if (!ticket_id || !req.file) return res.status(400).json({ status: 'error', message: 'Brak pliku albo numeru zgłoszenia.' });
      if (!DOZWOLONE_TYPY.test(req.file.mimetype || '')) return res.status(400).json({ status: 'error', message: 'Dozwolone są obrazy (PNG, JPG, GIF, WebP) i PDF.' });
      try {
        const t = await q(`SELECT id FROM Zgloszenia_Tickety WHERE id = ? AND tenant_id = ?`, [ticket_id, tenant_id]);
        if (!t || !t.length) return res.status(404).json({ status: 'error', message: 'Nie ma takiego zgłoszenia w tym salonie.' });
        const n = await q(`SELECT COUNT(*) AS n FROM Zgloszenia_Zalaczniki WHERE ticket_id = ?`, [ticket_id]);
        if (n && n[0] && Number(n[0].n) >= MAX_ZALACZNIKOW) return res.status(400).json({ status: 'error', message: `Maksymalnie ${MAX_ZALACZNIKOW} załączników do jednego zgłoszenia.` });
        const r = await q(`INSERT INTO Zgloszenia_Zalaczniki (ticket_id, tenant_id, nazwa, typ, rozmiar, dane) VALUES (?, ?, ?, ?, ?, ?)`,
          [ticket_id, tenant_id, s(req.file.originalname, 200) || 'zalacznik', s(req.file.mimetype, 100), req.file.size, req.file.buffer]);
        return res.json({ status: 'success', id: r.insertId });
      } catch (e) {
        log.error('[tickety] upload:', e.message);
        return res.status(500).json({ status: 'error', message: 'Nie udało się zapisać załącznika.' });
      }
    });
  });

  // ════════════════ Admin (admin.html) ════════════════
  // Nazwa salonu dla admina: z ticketu, a gdy aplikacja jej nie przekazała — z licencji (JOIN po tenant_id).
  const KOLUMNY_ADMIN = KOLUMNY_LISTY.replace('t.nazwa_salonu,', 'COALESCE(NULLIF(t.nazwa_salonu, \'\'), l.nazwa_salonu) AS nazwa_salonu,');
  const JOIN_LICENCJE = 'LEFT JOIN Licencje l ON l.id_bazy = t.tenant_id';

  router.get('/admin/tickety', wymagajAdmina, async (req, res) => {
    try {
      const where = []; const params = [];
      if (req.query.status && STATUSY.includes(req.query.status)) { where.push('t.status = ?'); params.push(req.query.status); }
      if (req.query.tenant_id) { where.push('t.tenant_id = ?'); params.push(s(req.query.tenant_id, 100)); }
      const rows = await q(`SELECT ${KOLUMNY_ADMIN} FROM Zgloszenia_Tickety t ${JOIN_LICENCJE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.id DESC LIMIT 500`, params);
      return res.json({ status: 'success', data: rows || [] });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  router.get('/admin/tickety/statystyki', wymagajAdmina, async (req, res) => {
    try {
      const [wgStatusu, wgSalonu, wgOsoby, wgKategorii] = await Promise.all([
        q(`SELECT status, COUNT(*) AS n FROM Zgloszenia_Tickety GROUP BY status`),
        q(`SELECT t.tenant_id, COALESCE(NULLIF(MAX(t.nazwa_salonu), ''), MAX(l.nazwa_salonu)) AS nazwa_salonu, COUNT(*) AS n, SUM(t.status <> 'zamkniete') AS otwarte
             FROM Zgloszenia_Tickety t ${JOIN_LICENCJE} GROUP BY t.tenant_id ORDER BY n DESC`),
        q(`SELECT tenant_id, pracownik, COUNT(*) AS n, MAX(data_utworzenia) AS ostatnie FROM Zgloszenia_Tickety GROUP BY tenant_id, pracownik ORDER BY n DESC LIMIT 50`),
        q(`SELECT kategoria, pilnosc, COUNT(*) AS n FROM Zgloszenia_Tickety GROUP BY kategoria, pilnosc`),
      ]);
      return res.json({ status: 'success', wg_statusu: wgStatusu, wg_salonu: wgSalonu, wg_osoby: wgOsoby, wg_kategorii: wgKategorii });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  router.get('/admin/tickety/zalaczniki/:ticketId', wymagajAdmina, async (req, res) => {
    try {
      const rows = await q(`SELECT id, nazwa, typ, rozmiar, data_dodania FROM Zgloszenia_Zalaczniki WHERE ticket_id = ? ORDER BY id`, [parseInt(req.params.ticketId, 10) || 0]);
      return res.json({ status: 'success', data: rows || [] });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  router.get('/admin/tickety/zalacznik/:id', wymagajAdmina, async (req, res) => {
    try {
      const rows = await q(`SELECT nazwa, typ, dane FROM Zgloszenia_Zalaczniki WHERE id = ?`, [parseInt(req.params.id, 10) || 0]);
      if (!rows || !rows.length) return res.status(404).json({ status: 'error', message: 'Brak załącznika.' });
      res.setHeader('Content-Type', rows[0].typ || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(rows[0].nazwa || 'zalacznik')}"`);
      return res.send(rows[0].dane);
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
  });

  router.post('/admin/tickety/odpowiedz', wymagajAdmina, async (req, res) => {
    const d = req.body || {};
    const id = parseInt(d.id, 10);
    if (!id) return res.json({ status: 'error', message: 'Brak numeru zgłoszenia.' });
    const status = STATUSY.includes(d.status) ? d.status : null;
    const odpowiedz = d.odpowiedz == null ? null : s(d.odpowiedz, 5000);
    if (!status && odpowiedz == null) return res.json({ status: 'error', message: 'Podaj odpowiedź albo nowy status.' });
    try {
      const rows = await q(`SELECT id, tenant_id, pracownik, tytul, status, odpowiedz FROM Zgloszenia_Tickety WHERE id = ?`, [id]);
      if (!rows || !rows.length) return res.json({ status: 'error', message: 'Nie ma takiego zgłoszenia.' });
      const t = rows[0];
      const set = []; const params = [];
      if (odpowiedz != null && odpowiedz !== (t.odpowiedz || '')) { set.push('odpowiedz = ?', 'odpowiedz_data = NOW()', 'odpowiedz_przeczytana = 0'); params.push(odpowiedz || null); }
      if (status) { set.push('status = ?'); params.push(status); set.push(status === 'zamkniete' ? 'data_zamkniecia = NOW()' : 'data_zamkniecia = NULL'); }
      if (!set.length) return res.json({ status: 'success', message: 'Bez zmian.' });
      params.push(id);
      await q(`UPDATE Zgloszenia_Tickety SET ${set.join(', ')} WHERE id = ?`, params);
      zapiszLog(t.tenant_id, 'ZGŁOSZENIE — ODPOWIEDŹ ESTELIO', 'Estelio', `#${id} ${status ? 'status: ' + status : ''}${odpowiedz != null ? ' · odpowiedź zaktualizowana' : ''}`);
      return res.json({ status: 'success' });
    } catch (e) { return res.json({ status: 'error', message: e.message }); }
  });

  router._const = { KATEGORIE, PILNOSCI, STATUSY, MAX_ZALACZNIKOW };
  return router;
};
