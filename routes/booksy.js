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
  // UPSERT wizyty (callback-based). Rezerwacja może mieć KILKA usług (w.uslugi)
  // — każda usługa to osobny wiersz/slot. Fallback na pola top-level dla
  // starych wyników parsera bez uslugi[].
  // ==========================================
  function uslugiZ(w) {
    if (w.uslugi && w.uslugi.length) return w.uslugi;
    if (!w.slotKey) return [];
    return [{ zabieg: w.zabieg, godzOd: w.godzOd, godzDo: w.godzDo, pracownik: w.pracownik, dataWizyty: w.dataWizyty, slotKey: w.slotKey }];
  }

  function upsertWizyta(tenant_id, w, uid, cb) {
    const uslugi = uslugiZ(w);

    // Odwołanie: oznacz KAŻDĄ usługę rezerwacji jako 'odwolana'.
    if (w.typ === 'odwolanie') {
      const odwolaj = (i) => {
        if (i >= uslugi.length) return cb();
        if (!uslugi[i].slotKey) return odwolaj(i + 1);
        db.query(
          `UPDATE WizytyBooksy SET status='odwolana', updated_at=NOW() WHERE tenant_id=? AND slot_key=?`,
          [tenant_id, uslugi[i].slotKey],
          () => odwolaj(i + 1)
        );
      };
      return odwolaj(0);
    }

    if (w.typ !== 'nowa' && w.typ !== 'zmiana') return cb();

    const noweSloty = uslugi.filter(u => u.slotKey).map(u => u.slotKey);

    // Identyfikacja klienta między wpisami: telefon, w razie braku nazwisko.
    const identKol = (w.telefon && String(w.telefon).trim()) ? 'telefon'
                   : (w.klient && String(w.klient).trim()) ? 'klient' : null;
    const identVal = identKol ? String(w[identKol]).trim() : null;

    // Zmiana pracownika w Booksy = drugi mail "nowa rezerwacja" z nowym pracownikiem,
    // BEZ odwołania starego przypisania. Klient nie może być w dwóch miejscach naraz:
    // odwołaj jego inne aktywne wpisy o tych samych terminach (data + godz_od).
    const zamknijKolizje = (next) => {
      const terminy = uslugi.filter(u => u.slotKey && u.dataWizyty && u.godzOd).map(u => [u.dataWizyty, u.godzOd]);
      if (!identKol || !terminy.length || !noweSloty.length) return next();
      db.query(
        `UPDATE WizytyBooksy SET status='odwolana', updated_at=NOW()
          WHERE tenant_id=? AND status='zapisana' AND ${identKol}=? AND (data_wizyty, godz_od) IN (?) AND slot_key NOT IN (?)`,
        [tenant_id, identVal, terminy, noweSloty],
        () => next()
      );
    };

    // Po wstawieniu nowych slotów: przełożenie -> odwołaj STARE sloty rezerwacji.
    // Stary wiersz szukamy po staraSlotKey, a gdy przełożenie zmieniło też pracownika
    // (klucz z nowym pracownikiem nie trafia) — po kliencie i starym terminie.
    // Pozostałe usługi tej samej rezerwacji rozpoznajemy po wspólnym zrodlo_uid.
    const zamknijStare = () => {
      if (!(w.typ === 'zmiana' && w.staraSlotKey && !noweSloty.includes(w.staraSlotKey))) return cb();
      const znajdzStary = (dalej) => {
        db.query(
          `SELECT slot_key, zrodlo_uid, telefon, klient FROM WizytyBooksy WHERE tenant_id=? AND slot_key=?`,
          [tenant_id, w.staraSlotKey],
          (err, rows) => {
            // Wiersz pod staraSlotKey musi należeć do TEGO klienta — klucz budowany
            // z nowym pracownikiem może przypadkiem trafić w slot innej osoby.
            if (!err && rows && rows.length) {
              const r = rows[0];
              const tenSam = !identKol || String(r[identKol] || '').trim() === identVal;
              if (tenSam) return dalej(r);
            }
            if (!identKol || !w.staraData || !w.staraGodzOd) return dalej(null);
            db.query(
              `SELECT slot_key, zrodlo_uid FROM WizytyBooksy
                WHERE tenant_id=? AND status='zapisana' AND data_wizyty=? AND godz_od=? AND ${identKol}=? LIMIT 1`,
              [tenant_id, w.staraData, w.staraGodzOd, identVal],
              (e2, r2) => dalej((!e2 && r2 && r2.length) ? r2[0] : null)
            );
          }
        );
      };
      znajdzStary((stary) => {
        if (!stary) return cb();
        if (stary.zrodlo_uid != null && noweSloty.length) {
          return db.query(
            `UPDATE WizytyBooksy SET status='odwolana', updated_at=NOW()
              WHERE tenant_id=? AND status='zapisana' AND zrodlo_uid=? AND slot_key NOT IN (?)`,
            [tenant_id, stary.zrodlo_uid, noweSloty],
            () => cb()
          );
        }
        db.query(
          `UPDATE WizytyBooksy SET status='odwolana', updated_at=NOW() WHERE tenant_id=? AND slot_key=?`,
          [tenant_id, stary.slot_key],
          () => cb()
        );
      });
    };

    const wstaw = (i) => {
      if (i >= uslugi.length) return zamknijKolizje(zamknijStare);
      const u = uslugi[i];
      if (!u.slotKey || !u.dataWizyty || !u.godzOd) return wstaw(i + 1);
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
          tenant_id, u.slotKey, w.klient || '', w.telefon || '', w.email || '',
          u.dataWizyty, u.godzOd, u.godzDo || '', u.zabieg || '', u.pracownik || '', uid || null
        ],
        () => wstaw(i + 1)
      );
    };
    wstaw(0);
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
  // GET /booksy — booksy_dzis, booksy_dokumenty
  // ==========================================
  // Wizyty danego dnia + skojarzenie z kartoteką Estelio:
  //   1) po telefonie (ostatnie 9 cyfr, ignorując spacje/+48) — pewne,
  //   2) zapasowo po imieniu i nazwisku — orientacyjne.
  function wizytyDnia(tenant_id, whereData, params, cb) {
    db.query(
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
        WHERE w.tenant_id = ? AND ${whereData} AND w.status = 'zapisana'
        ORDER BY w.godz_od ASC, w.pracownik ASC`,
      params,
      (err, rows) => {
        if (err) return cb(err);
        const wizyty = (rows || []).map(r => {
          const idTel = r.id_tel != null ? String(r.id_tel) : '';
          const idNaz = r.id_nazwa != null ? String(r.id_nazwa) : '';
          const id_klienta = idTel || idNaz;
          const dopasowano = idTel ? 'telefon' : (idNaz ? 'nazwa' : null);
          const { id_tel, id_nazwa, ...reszta } = r;
          return { ...reszta, id_klienta, dopasowano };
        });
        cb(null, wizyty);
      }
    );
  }

  router.get('/booksy', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;
    const data = req.query.data && /^\d{4}-\d{2}-\d{2}$/.test(req.query.data) ? req.query.data : null;

    if (action === 'booksy_dzis') {
      const where = data ? 'w.data_wizyty = ?' : 'w.data_wizyty = CURDATE()';
      const params = data ? [tenant_id, data] : [tenant_id];
      return wizytyDnia(tenant_id, where, params, (err, wizyty) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success', wizyty, skonfigurowane: !!(IMAP_USER && IMAP_PASS) });
      });
    }

    // Wizyty na wskazany dzień (domyślnie JUTRO) + status dokumentów rozpoznanych
    // klientów (RODO z Klienci, dodatkowe dokumenty z Dokumenty_Dodatkowe_Klienta)
    // — do widoku "Dokumenty do przygotowania na jutro".
    if (action === 'booksy_dokumenty') {
      const where = data ? 'w.data_wizyty = ?' : 'w.data_wizyty = DATE_ADD(CURDATE(), INTERVAL 1 DAY)';
      const params = data ? [tenant_id, data] : [tenant_id];
      return wizytyDnia(tenant_id, where, params, (err, wizyty) => {
        if (err) return res.json({ status: 'error', message: err.message });
        const ids = [...new Set(wizyty.filter(w => w.id_klienta).map(w => String(w.id_klienta)))];
        if (!ids.length) {
          wizyty.forEach(w => { w.rodo = null; w.dokumenty = []; });
          return res.json({ status: 'success', wizyty, skonfigurowane: !!(IMAP_USER && IMAP_PASS) });
        }
        db.query(
          `SELECT id_klienta, rodo FROM Klienci WHERE tenant_id = ? AND id_klienta IN (?)`,
          [tenant_id, ids],
          (e2, kl) => {
            const rodoMap = {};
            (kl || []).forEach(k => {
              const v = String(k.rodo || '').toUpperCase();
              rodoMap[String(k.id_klienta)] = (v === 'TAK' || v === '1' || v === 'TRUE');
            });
            db.query(
              `SELECT id_klienta, typ_nazwa FROM Dokumenty_Dodatkowe_Klienta WHERE tenant_id = ? AND id_klienta IN (?)`,
              [tenant_id, ids],
              (e3, dk) => {
                const dokMap = {};
                (dk || []).forEach(d => { (dokMap[String(d.id_klienta)] = dokMap[String(d.id_klienta)] || []).push(d.typ_nazwa); });
                wizyty.forEach(w => {
                  if (w.id_klienta) {
                    w.rodo = rodoMap[String(w.id_klienta)] || false;
                    w.dokumenty = dokMap[String(w.id_klienta)] || [];
                  } else { w.rodo = null; w.dokumenty = []; }
                });
                return res.json({ status: 'success', wizyty, skonfigurowane: !!(IMAP_USER && IMAP_PASS) });
              }
            );
          }
        );
      });
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
