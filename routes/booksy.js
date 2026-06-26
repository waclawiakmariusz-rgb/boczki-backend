// routes/booksy.js
// Integracja z Booksy przez maile powiadomień (no-reply@booksy.com).
// Czyta skrzynkę IMAP (Gmail App Password), parsuje maile parserem booksyParser
// i buduje listę wizyt "Dziś w lokalu".
//
// Maile -> WizytyBooksy (slot_key = data+godzina+pracownik, UNIQUE per tenant).
//   nowa/zmiana  -> status 'zapisana' (upsert, zachowuje dobre dane przez COALESCE)
//   zmiana       -> dodatkowo oznacza STARY slot jako 'odwolana'
//   odwolanie    -> oznacza pasujący slot jako 'odwolana'
//
// Poller startuje sam, jeśli ustawione są zmienne BOOKSY_IMAP_*. Bez nich moduł
// działa "na sucho" (same akcje GET/POST, brak czytania skrzynki).

const express = require('express');

function clean(v) { return (v || '').replace(/^['"]|['"]$/g, '').trim(); }

const IMAP_HOST   = clean(process.env.BOOKSY_IMAP_HOST) || 'imap.gmail.com';
const IMAP_USER   = clean(process.env.BOOKSY_IMAP_USER);
const IMAP_PASS   = clean(process.env.BOOKSY_IMAP_PASS);
const TENANT_ID   = clean(process.env.BOOKSY_TENANT_ID);
const POLL_MS     = 3 * 60 * 1000;   // co 3 minuty
const START_DELAY = 15 * 1000;       // pierwszy przebieg po 15 s od startu
const BACKFILL_DNI = 30;             // pierwszy przebieg: ile dni wstecz

const { parseBooksyEmail } = require('./booksyParser');

module.exports = (db) => {
  const router = express.Router();

  // ==========================================
  // MIGRACJE
  // ==========================================
  db.query(
    `CREATE TABLE IF NOT EXISTS WizytyBooksy (
       id INT AUTO_INCREMENT PRIMARY KEY,
       tenant_id VARCHAR(50) NOT NULL,
       slot_key VARCHAR(200) NOT NULL,
       klient VARCHAR(200),
       telefon VARCHAR(40),
       email VARCHAR(200),
       data_wizyty DATE,
       godz_od VARCHAR(10),
       godz_do VARCHAR(10),
       zabieg VARCHAR(300),
       pracownik VARCHAR(200),
       status VARCHAR(20) NOT NULL DEFAULT 'zapisana',
       zrodlo_uid INT,
       updated_at DATETIME NOT NULL,
       UNIQUE KEY uniq_slot (tenant_id, slot_key),
       INDEX idx_dzien (tenant_id, data_wizyty, status)
     )`,
    (err) => { if (err) console.error('[booksy] CREATE WizytyBooksy:', err.message); }
  );

  db.query(
    `CREATE TABLE IF NOT EXISTS BooksyMeta (
       tenant_id VARCHAR(50) PRIMARY KEY,
       last_uid INT NOT NULL DEFAULT 0,
       last_run DATETIME
     )`,
    (err) => { if (err) console.error('[booksy] CREATE BooksyMeta:', err.message); }
  );

  // ==========================================
  // UPSERT pojedynczej wizyty (callback-based)
  // ==========================================
  function upsertWizyta(tenant_id, w, uid, cb) {
    // Odwołanie: oznacz pasujący slot jako 'odwolana'. Bez slotKey nie ma czego oznaczyć.
    if (w.typ === 'odwolanie') {
      if (!w.slotKey) return cb();
      return db.query(
        `UPDATE WizytyBooksy SET status='odwolana', updated_at=NOW() WHERE tenant_id=? AND slot_key=?`,
        [tenant_id, w.slotKey],
        () => cb()
      );
    }

    // nowa / zmiana: musi być slotKey (data+godzina+pracownik z linii kanonicznej).
    if (w.typ !== 'nowa' && w.typ !== 'zmiana') return cb();
    if (!w.slotKey || !w.dataWizyty || !w.godzOd) return cb();

    db.query(
      `INSERT INTO WizytyBooksy
         (tenant_id, slot_key, klient, telefon, email, data_wizyty, godz_od, godz_do, zabieg, pracownik, status, zrodlo_uid, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'zapisana', ?, NOW())
       ON DUPLICATE KEY UPDATE
         klient      = COALESCE(NULLIF(VALUES(klient), ''), klient),
         telefon     = COALESCE(NULLIF(VALUES(telefon), ''), telefon),
         email       = COALESCE(NULLIF(VALUES(email), ''), email),
         data_wizyty = VALUES(data_wizyty),
         godz_od     = VALUES(godz_od),
         godz_do     = COALESCE(NULLIF(VALUES(godz_do), ''), godz_do),
         zabieg      = COALESCE(NULLIF(VALUES(zabieg), ''), zabieg),
         pracownik   = COALESCE(NULLIF(VALUES(pracownik), ''), pracownik),
         status      = 'zapisana',
         zrodlo_uid  = VALUES(zrodlo_uid),
         updated_at  = NOW()`,
      [
        tenant_id, w.slotKey, w.klient || '', w.telefon || '', w.email || '',
        w.dataWizyty, w.godzOd, w.godzDo || '', w.zabieg || '', w.pracownik || '', uid || null
      ],
      () => {
        // Zmiana godziny: stary slot oznacz jako odwołany.
        if (w.typ === 'zmiana' && w.staraSlotKey && w.staraSlotKey !== w.slotKey) {
          return db.query(
            `UPDATE WizytyBooksy SET status='odwolana', updated_at=NOW() WHERE tenant_id=? AND slot_key=?`,
            [tenant_id, w.staraSlotKey],
            () => cb()
          );
        }
        cb();
      }
    );
  }

  // ==========================================
  // POLLER IMAP
  // ==========================================
  let pollujeSie = false;

  function getMeta(tenant_id) {
    return new Promise((resolve) => {
      db.query(`SELECT last_uid FROM BooksyMeta WHERE tenant_id=?`, [tenant_id], (err, rows) => {
        if (err || !rows || !rows.length) return resolve(0);
        resolve(parseInt(rows[0].last_uid, 10) || 0);
      });
    });
  }

  function setMeta(tenant_id, lastUid) {
    db.query(
      `INSERT INTO BooksyMeta (tenant_id, last_uid, last_run) VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE last_uid=GREATEST(last_uid, VALUES(last_uid)), last_run=NOW()`,
      [tenant_id, lastUid || 0],
      () => {}
    );
  }

  // Sekwencyjny upsert listy wizyt (callback-based db, bez Promise.all na zapisach).
  function upsertWszystkie(tenant_id, lista, i, onDone) {
    if (i >= lista.length) return onDone();
    upsertWizyta(tenant_id, lista[i].w, lista[i].uid, () => upsertWszystkie(tenant_id, lista, i + 1, onDone));
  }

  async function pollujRaz(tenant_id) {
    if (!IMAP_USER || !IMAP_PASS) return { ok: false, powod: 'Brak konfiguracji IMAP' };
    if (pollujeSie) return { ok: false, powod: 'Poll już trwa' };
    pollujeSie = true;

    const { ImapFlow } = require('imapflow');
    const { simpleParser } = require('mailparser');
    const client = new ImapFlow({
      host: IMAP_HOST, port: 993, secure: true,
      auth: { user: IMAP_USER, pass: IMAP_PASS }, logger: false
    });

    let przetworzone = 0, maxUid = 0;
    try {
      await client.connect();
      const lastUid = await getMeta(tenant_id);
      const lock = await client.getMailboxLock('INBOX');
      try {
        let kryteria;
        if (lastUid > 0) {
          kryteria = { uid: `${lastUid + 1}:*`, from: 'no-reply@booksy.com' };
        } else {
          const od = new Date(Date.now() - BACKFILL_DNI * 86400000);
          kryteria = { since: od, from: 'no-reply@booksy.com' };
        }
        const uids = await client.search(kryteria, { uid: true });
        const nowe = (uids || []).filter(u => u > lastUid);

        const doZapisu = [];
        for await (const msg of client.fetch(nowe, { uid: true, source: true }, { uid: true })) {
          if (msg.uid > maxUid) maxUid = msg.uid;
          try {
            const parsed = await simpleParser(msg.source);
            const fromName = (parsed.from && parsed.from.value && parsed.from.value[0]) ? (parsed.from.value[0].name || '') : '';
            const w = parseBooksyEmail({
              subject: parsed.subject || '',
              fromName,
              text: parsed.text || ''
            });
            doZapisu.push({ uid: msg.uid, w });
          } catch (e) {
            console.error('[booksy] parse maila uid', msg.uid, ':', e.message);
          }
        }

        await new Promise((resolve) => upsertWszystkie(tenant_id, doZapisu, 0, resolve));
        przetworzone = doZapisu.length;
      } finally {
        lock.release();
      }
      await client.logout();
      if (maxUid > lastUid) setMeta(tenant_id, maxUid);
      else setMeta(tenant_id, lastUid);
      return { ok: true, przetworzone };
    } catch (e) {
      console.error('[booksy] poll błąd:', e.message);
      try { await client.logout(); } catch (_) {}
      return { ok: false, powod: e.message };
    } finally {
      pollujeSie = false;
    }
  }

  // Auto-start pollera (tylko jeśli skonfigurowany IMAP + tenant).
  if (IMAP_USER && IMAP_PASS && TENANT_ID) {
    setTimeout(() => {
      pollujRaz(TENANT_ID).then(r => console.log('[booksy] pierwszy poll:', JSON.stringify(r)));
      setInterval(() => { pollujRaz(TENANT_ID); }, POLL_MS);
    }, START_DELAY);
    console.log('[booksy] poller zaplanowany (IMAP:', IMAP_USER, '→ tenant', TENANT_ID + ')');
  } else {
    console.log('[booksy] poller nieaktywny (brak BOOKSY_IMAP_USER/PASS/TENANT_ID) — moduł działa bez czytania skrzynki');
  }

  // ==========================================
  // GET /booksy — booksy_dzis
  // ==========================================
  router.get('/booksy', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'booksy_dzis') {
      const data = req.query.data && /^\d{4}-\d{2}-\d{2}$/.test(req.query.data) ? req.query.data : null;
      const where = data ? 'w.data_wizyty = ?' : 'w.data_wizyty = CURDATE()';
      const params = data ? [tenant_id, data] : [tenant_id];
      // Skojarzenie wizyty z kartoteką Estelio:
      //   1) po telefonie (ostatnie 9 cyfr, ignorując spacje/+48) — pewne,
      //   2) zapasowo po imieniu i nazwisku — orientacyjne.
      return db.query(
        `SELECT w.slot_key, w.klient, w.telefon, w.email, w.data_wizyty, w.godz_od, w.godz_do, w.zabieg, w.pracownik, w.status,
           (SELECT k.id_klienta FROM Klienci k
              WHERE k.tenant_id = w.tenant_id AND w.telefon <> ''
                AND LENGTH(REGEXP_REPLACE(k.telefon, '[^0-9]', '')) >= 9
                AND RIGHT(REGEXP_REPLACE(k.telefon, '[^0-9]', ''), 9) = RIGHT(REGEXP_REPLACE(w.telefon, '[^0-9]', ''), 9)
              LIMIT 1) AS id_tel,
           (SELECT k.id_klienta FROM Klienci k
              WHERE k.tenant_id = w.tenant_id AND w.klient <> ''
                AND LOWER(TRIM(k.imie_nazwisko)) = LOWER(TRIM(w.klient))
              LIMIT 1) AS id_nazwa
           FROM WizytyBooksy w
          WHERE w.tenant_id = ? AND ${where} AND w.status = 'zapisana'
          ORDER BY w.godz_od ASC, w.pracownik ASC`,
        params,
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          const wizyty = (rows || []).map(r => {
            const idTel = r.id_tel != null ? String(r.id_tel) : '';
            const idNaz = r.id_nazwa != null ? String(r.id_nazwa) : '';
            const id_klienta = idTel || idNaz;
            const dopasowano = idTel ? 'telefon' : (idNaz ? 'nazwa' : null);
            const { id_tel, id_nazwa, ...reszta } = r;
            return { ...reszta, id_klienta, dopasowano };
          });
          return res.json({ status: 'success', wizyty, skonfigurowane: !!(IMAP_USER && IMAP_PASS) });
        }
      );
    }

    return res.json({ status: 'error', message: 'Nieznana akcja GET booksy: ' + action });
  });

  // ==========================================
  // POST /booksy — booksy_refresh, booksy_preview
  // ==========================================
  router.post('/booksy', (req, res) => {
    const d = req.body || {};
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    // Ręczne odświeżenie skrzynki.
    if (action === 'booksy_refresh') {
      if (!IMAP_USER || !IMAP_PASS) {
        return res.json({ status: 'error', message: 'Integracja Booksy nie jest skonfigurowana (brak danych IMAP).' });
      }
      pollujRaz(TENANT_ID || tenant_id).then(r => {
        if (r.ok) return res.json({ status: 'success', message: `Odświeżono. Przetworzono maili: ${r.przetworzone}.`, przetworzone: r.przetworzone });
        return res.json({ status: 'error', message: r.powod || 'Nie udało się odświeżyć.' });
      });
      return;
    }

    // Diagnostyka: wklej treść maila -> zobacz, jak parser go zrozumiał (bez zapisu).
    if (action === 'booksy_preview') {
      const w = parseBooksyEmail({
        subject: d.subject || '',
        fromName: d.fromName || '',
        text: d.text || ''
      });
      return res.json({ status: 'success', wynik: w });
    }

    return res.json({ status: 'error', message: 'Nieznana akcja POST booksy: ' + action });
  });

  return router;
};
