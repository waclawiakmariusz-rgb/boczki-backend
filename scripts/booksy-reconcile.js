// scripts/booksy-reconcile.js — DIAGNOSTYKA (tylko odczyt, nic nie zapisuje).
// Odtwarza stan wizyt z maili Booksy AKTUALNYM parserem (replay w pamięci)
// i porównuje z tabelą WizytyBooksy. Pokazuje:
//   BRAK  = maile mówią "aktywna", a w bazie nie ma jako 'zapisana' (nigdy nie wpadła / stary parser na serwerze)
//   DUCH  = w bazie 'zapisana', ale maile mówią odwołana/przeniesiona (efekt pominiętych przełożeń → potrzebny reset)
// Uruchom: node scripts/booksy-reconcile.js [dni]   (domyślnie 45). Porównuje wizyty od DZIŚ w przód.
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

(async () => {
  const od = new Date(Date.now() - DNI * 86400000);
  const client = new ImapFlow({ host: HOST, port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  // Zbierz maile Booksy + parsuj, posortuj po UID rosnąco (kolejność chronologiczna = poprawny replay).
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

  // Replay w pamięci (mirror upsertWizyta, per USŁUGA): slotKey -> { status, klient, data, uid, ident }
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
      stan.set(u.slotKey, { status: 'zapisana', klient: w.klient || '', data: u.dataWizyty, godz: u.godzOd, prac: u.pracownik || '', uid, ident });
    }
    // Zmiana pracownika = nowy mail bez odwołania starego: klient nie może być
    // w dwóch miejscach naraz — odwołaj jego inne wpisy o tych samych terminach.
    if (ident && noweSloty.size) {
      for (const [sk, v] of stan) {
        if (v.status === 'zapisana' && !noweSloty.has(sk) && v.ident === ident && terminy.has(v.data + ' ' + v.godz)) v.status = 'odwolana';
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
          if (v.status === 'zapisana' && v.ident === ident && v.data === w.staraData && v.godz === w.staraGodzOd) { stary = v; break; }
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

  // Oczekiwane aktywne (zapisana) od dziś w przód.
  const oczekAktywne = new Map();  // slotKey -> info
  const znaneOdwolane = new Set(); // slotKey znane jako odwolana (do wykrycia duchów)
  for (const [sk, v] of stan) {
    if (v.data < DZIS) continue;
    if (v.status === 'zapisana') oczekAktywne.set(sk, v);
    else znaneOdwolane.add(sk);
  }

  // Stan bazy: aktywne od dziś w przód.
  const rows = await q(`SELECT slot_key, klient, data_wizyty, godz_od FROM WizytyBooksy WHERE tenant_id=? AND status='zapisana' AND data_wizyty>=? ORDER BY data_wizyty, godz_od`, [TENANT, DZIS]);
  const dbAktywne = new Map(rows.map(r => [r.slot_key, r]));

  const brak = [...oczekAktywne.keys()].filter(sk => !dbAktywne.has(sk));
  const duchy = [...dbAktywne.keys()].filter(sk => znaneOdwolane.has(sk));

  console.log(`Rekoncyliacja od ${DZIS} w przód | maili: ${maile.length} | okno: ${DNI} dni\n`);
  console.log('Oczekiwane aktywne (z maili):', oczekAktywne.size);
  console.log('Aktywne w bazie            :', dbAktywne.size);
  console.log('');
  console.log('BRAK w bazie (mail=aktywna, baza nie ma):', brak.length);
  brak.slice(0, 25).forEach(sk => { const v = oczekAktywne.get(sk); console.log(`   • ${v.data} ${v.godz} ${v.prac} — ${v.klient}  [${sk}]`); });
  console.log('');
  console.log('DUCHY w bazie (baza=aktywna, mail=odwołana/przeniesiona):', duchy.length);
  duchy.slice(0, 25).forEach(sk => { const r = dbAktywne.get(sk); console.log(`   • ${String(r.data_wizyty).slice(0,10)} ${r.godz_od} — ${r.klient}  [${sk}]`); });

  console.log('\nGotowe (nic nie zapisano).');
  process.exit(0);
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
