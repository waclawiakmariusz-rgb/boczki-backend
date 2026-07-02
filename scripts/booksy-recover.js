// scripts/booksy-recover.js — ODZYSKANIE (ZAPISUJE do bazy!). Chirurgiczne: naprawia tylko rozjazdy
// od DZIŚ w przód wykryte przez rekoncyliację:
//   BRAK  -> upsert brakującej wizyty jako 'zapisana' (ta sama logika co poller),
//   DUCH  -> UPDATE status='odwolana' (mail mówi odwołana/przeniesiona).
// Stan liczony AKTUALNYM parserem (replay maili w kolejności UID). Nie rusza wizyt zgodnych z bazą.
// Uruchom: node scripts/booksy-recover.js [dni]   (domyślnie 45)
require('dotenv').config();
const mysql = require('mysql2');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { parseBooksyEmail } = require('../routes/booksyParser');

function clean(v) { return (v || '').replace(/^['"]|['"]$/g, '').trim(); }
const HOST = clean(process.env.BOOKSY_IMAP_HOST) || 'imap.gmail.com';
const USER = clean(process.env.BOOKSY_IMAP_USER);
const PASS = clean(process.env.BOOKSY_IMAP_PASS);
const TENANT = clean(process.env.BOOKSY_TENANT_ID);
const DNI = parseInt(process.argv[2], 10) || 45;
const DZIS = new Date().toISOString().slice(0, 10);

const db = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 2 });
function q(sql, p) { return new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r))); }
const pierwszyNiepusty = (a, b) => (a && String(a).trim() !== '') ? a : b;

(async () => {
  const od = new Date(Date.now() - DNI * 86400000);
  const client = new ImapFlow({ host: HOST, port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const maile = [];
  try {
    const uids = await client.search({ since: od, from: 'no-reply@booksy.com' }, { uid: true });
    for await (const m of client.fetch(uids || [], { uid: true, source: true }, { uid: true })) {
      let p; try { p = await simpleParser(m.source); } catch (e) { continue; }
      const fromName = (p.from && p.from.value && p.from.value[0]) ? (p.from.value[0].name || '') : '';
      const w = parseBooksyEmail({ subject: p.subject || '', fromName, text: p.text || '' });
      maile.push({ uid: m.uid, w });
    }
  } finally { lock.release(); await client.logout(); }
  maile.sort((a, b) => a.uid - b.uid);

  // Replay (mirror upsertWizyta, per USŁUGA): slotKey -> pełny rekord + status + uid maila.
  const stan = new Map();
  for (const { uid, w } of maile) {
    const uslugi = (w.uslugi && w.uslugi.length) ? w.uslugi
      : (w.slotKey ? [{ zabieg: w.zabieg, godzOd: w.godzOd, godzDo: w.godzDo, pracownik: w.pracownik, dataWizyty: w.dataWizyty, slotKey: w.slotKey }] : []);
    if (w.typ === 'odwolanie') {
      for (const u of uslugi) if (u.slotKey && stan.has(u.slotKey)) stan.get(u.slotKey).status = 'odwolana';
      continue;
    }
    if (w.typ !== 'nowa' && w.typ !== 'zmiana') continue;
    const ident = (w.telefon && String(w.telefon).trim()) || (w.klient && String(w.klient).trim()) || null;
    const noweSloty = new Set(), terminy = new Set();
    for (const u of uslugi) {
      if (!u.slotKey || !u.dataWizyty || !u.godzOd) continue;
      noweSloty.add(u.slotKey);
      terminy.add(u.dataWizyty + ' ' + u.godzOd);
      const prev = stan.get(u.slotKey) || {};
      stan.set(u.slotKey, {
        status: 'zapisana',
        klient: pierwszyNiepusty(w.klient, prev.klient) || '',
        telefon: pierwszyNiepusty(w.telefon, prev.telefon) || '',
        email: pierwszyNiepusty(w.email, prev.email) || '',
        data: u.dataWizyty, godzOd: u.godzOd,
        godzDo: pierwszyNiepusty(u.godzDo, prev.godzDo) || '',
        zabieg: pierwszyNiepusty(u.zabieg, prev.zabieg) || '',
        prac: pierwszyNiepusty(u.pracownik, prev.prac) || '',
        uid, ident
      });
    }
    // Zmiana pracownika = nowy mail bez odwołania starego: klient nie może być
    // w dwóch miejscach naraz — odwołaj jego inne wpisy o tych samych terminach.
    if (ident && noweSloty.size) {
      for (const [sk, v] of stan) {
        if (v.status === 'zapisana' && !noweSloty.has(sk) && v.ident === ident && terminy.has(v.data + ' ' + v.godzOd)) v.status = 'odwolana';
      }
    }
    // Przełożenie: odwołaj stare sloty rezerwacji (po wspólnym uid maila-źródła).
    // Gdy przełożenie zmieniło też pracownika, staraSlotKey nie trafia — szukaj
    // starego wpisu po kliencie i starym terminie.
    if (w.typ === 'zmiana' && w.staraSlotKey && !noweSloty.has(w.staraSlotKey)) {
      let stary = stan.get(w.staraSlotKey);
      // Klucz z nowym pracownikiem może trafić w slot INNEGO klienta — weryfikuj.
      if (stary && ident && stary.ident && stary.ident !== ident) stary = null;
      if (!stary && ident && w.staraData && w.staraGodzOd) {
        for (const v of stan.values()) {
          if (v.status === 'zapisana' && v.ident === ident && v.data === w.staraData && v.godzOd === w.staraGodzOd) { stary = v; break; }
        }
      }
      if (stary) {
        const uidStary = stary.uid;
        for (const [sk, v] of stan) {
          if (v.status === 'zapisana' && v.uid === uidStary && !noweSloty.has(sk)) v.status = 'odwolana';
        }
      }
    }
  }

  // Oczekiwane aktywne / znane odwołane (od dziś w przód).
  const oczekAktywne = new Map(), znaneOdwolane = new Set();
  for (const [sk, v] of stan) {
    if (v.data < DZIS) continue;
    if (v.status === 'zapisana') oczekAktywne.set(sk, v); else znaneOdwolane.add(sk);
  }

  const rows = await q(`SELECT slot_key FROM WizytyBooksy WHERE tenant_id=? AND status='zapisana' AND data_wizyty>=?`, [TENANT, DZIS]);
  const dbAktywne = new Set(rows.map(r => r.slot_key));
  const brak = [...oczekAktywne.keys()].filter(sk => !dbAktywne.has(sk));
  const duchy = [...dbAktywne].filter(sk => znaneOdwolane.has(sk));

  console.log(`Odzyskanie od ${DZIS} | maili: ${maile.length} | BRAK do dodania: ${brak.length} | DUCHY do odwołania: ${duchy.length}\n`);

  const UPSERT = `INSERT INTO WizytyBooksy
      (tenant_id, slot_key, klient, telefon, email, data_wizyty, godz_od, godz_do, zabieg, pracownik, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'zapisana', NOW())
    ON DUPLICATE KEY UPDATE
      klient=COALESCE(NULLIF(VALUES(klient),''),klient), telefon=COALESCE(NULLIF(VALUES(telefon),''),telefon),
      email=COALESCE(NULLIF(VALUES(email),''),email), data_wizyty=VALUES(data_wizyty), godz_od=VALUES(godz_od),
      godz_do=COALESCE(NULLIF(VALUES(godz_do),''),godz_do), zabieg=COALESCE(NULLIF(VALUES(zabieg),''),zabieg),
      pracownik=COALESCE(NULLIF(VALUES(pracownik),''),pracownik), status='zapisana', updated_at=NOW()`;

  for (const sk of brak) {
    const v = oczekAktywne.get(sk);
    await q(UPSERT, [TENANT, sk, v.klient, v.telefon, v.email, v.data, v.godzOd, v.godzDo, v.zabieg, v.prac]);
    console.log(`  + DODANO : ${v.data} ${v.godzOd} ${v.prac} — ${v.klient}`);
  }
  for (const sk of duchy) {
    await q(`UPDATE WizytyBooksy SET status='odwolana', updated_at=NOW() WHERE tenant_id=? AND slot_key=?`, [TENANT, sk]);
    console.log(`  - ODWOŁANO (duch): ${sk}`);
  }

  console.log('\nGotowe. Zapisano zmian:', brak.length + duchy.length);
  process.exit(0);
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
