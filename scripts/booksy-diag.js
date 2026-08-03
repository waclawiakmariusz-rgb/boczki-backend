// scripts/booksy-diag.js — DIAGNOSTYKA (tylko odczyt, nic nie zapisuje).
// Sprawdza, co umyka integracji Booksy:
//  1) jakich nadawców mamy w skrzynce (czy wszystko leci z no-reply@booksy.com),
//  2) jak parser klasyfikuje maile Booksy (nowa/zmiana/odwolanie/nieznany),
//  3) ile maili odpada przez brak linii kanonicznej / brak slotKey / brak pracownika,
//  4) stan tabeli WizytyBooksy na dziś (kolizje slot_key, statusy).
// Uruchom: node scripts/booksy-diag.js [dni]   (domyślnie 45)
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

const db = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 2
});
function q(sql, p) { return new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r))); }

function naglowek(t) { console.log('\n===== ' + t + ' ====='); }

(async () => {
  if (!USER || !PASS) { console.error('Brak BOOKSY_IMAP_USER/PASS w .env'); process.exit(1); }
  const od = new Date(Date.now() - DNI * 86400000);
  console.log(`Skrzynka: ${USER} | zakres: ostatnie ${DNI} dni (od ${od.toISOString().slice(0, 10)}) | tenant: ${TENANT}`);

  const client = new ImapFlow({ host: HOST, port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  // --- PASS 1: wszyscy nadawcy w zakresie (envelope = tanio) ---
  const nadawcy = {};
  let lacznie = 0;
  try {
    const uidsAll = await client.search({ since: od }, { uid: true });
    for await (const m of client.fetch(uidsAll || [], { uid: true, envelope: true }, { uid: true })) {
      lacznie++;
      const a = (m.envelope && m.envelope.from && m.envelope.from[0]) ? m.envelope.from[0] : {};
      const adr = ((a.address || '') + '').toLowerCase() || '(brak)';
      nadawcy[adr] = (nadawcy[adr] || 0) + 1;
    }
  } catch (e) { console.error('PASS1 błąd:', e.message); }

  naglowek(`NADAWCY (wszystkich maili: ${lacznie})`);
  Object.entries(nadawcy).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([adr, n]) => {
    const flag = /booksy/i.test(adr) && adr !== 'no-reply@booksy.com' ? '  <-- BOOKSY, ale INNY adres niż no-reply@booksy.com!' : '';
    console.log(`  ${String(n).padStart(4)}  ${adr}${flag}`);
  });

  // --- PASS 2: maile Booksy (każdy adres zawierający booksy) -> parser ---
  const adresyBooksy = Object.keys(nadawcy).filter(a => /booksy/i.test(a));
  const liczniki = { nowa: 0, zmiana: 0, odwolanie: 0, nieznany: 0 };
  let brakKanon = 0, brakSlot = 0, brakPrac = 0, brakKlient = 0, parsedOk = 0;
  const przyklNieznany = [], przyklBrakKanon = [], przyklBrakPrac = [];
  const subjektyTypow = {};

  try {
    // szukamy po każdym adresie booksy (na wypadek innego niż no-reply)
    let uidsB = [];
    for (const adr of adresyBooksy) {
      const u = await client.search({ since: od, from: adr }, { uid: true });
      uidsB = uidsB.concat(u || []);
    }
    uidsB = [...new Set(uidsB)];
    naglowek(`MAILE BOOKSY do analizy: ${uidsB.length} (adresy: ${adresyBooksy.join(', ') || 'brak'})`);

    for await (const m of client.fetch(uidsB, { uid: true, source: true }, { uid: true })) {
      let parsed;
      try { parsed = await simpleParser(m.source); } catch (e) { continue; }
      const subject = parsed.subject || '';
      const fromName = (parsed.from && parsed.from.value && parsed.from.value[0]) ? (parsed.from.value[0].name || '') : '';
      const w = parseBooksyEmail({ subject, fromName, text: parsed.text || '' });
      liczniki[w.typ] = (liczniki[w.typ] || 0) + 1;
      (subjektyTypow[w.typ] = subjektyTypow[w.typ] || new Set()).add(subject.slice(0, 70));

      if (w.typ === 'nieznany') {
        if (przyklNieznany.length < 10) przyklNieznany.push(`uid ${m.uid}: "${subject.slice(0, 80)}"`);
        continue;
      }
      if (w.typ === 'odwolanie') continue; // odwołania nie wymagają pełnego kompletu
      // nowa / zmiana — sprawdź kompletność do zapisu
      if (!w.dataWizyty || !w.godzOd) { brakKanon++; if (przyklBrakKanon.length < 10) przyklBrakKanon.push(`uid ${m.uid}: "${subject.slice(0, 70)}"`); continue; }
      if (!w.slotKey) { brakSlot++; continue; }
      if (!w.pracownik) { brakPrac++; if (przyklBrakPrac.length < 10) przyklBrakPrac.push(`uid ${m.uid}: ${w.dataWizyty} ${w.godzOd} klient="${w.klient}"`); }
      if (!w.klient) brakKlient++;
      parsedOk++;
    }
  } catch (e) { console.error('PASS2 błąd:', e.message); }

  lock.release();
  await client.logout();

  naglowek('KLASYFIKACJA MAILI BOOKSY');
  console.log('  nowa     :', liczniki.nowa);
  console.log('  zmiana   :', liczniki.zmiana);
  console.log('  odwolanie:', liczniki.odwolanie);
  console.log('  NIEZNANY :', liczniki.nieznany, '  <-- te są CICHO POMIJANE (nie trafiają do bazy)');
  naglowek('PROBLEMY KOMPLETNOŚCI (nowa/zmiana)');
  console.log('  poprawnie sparsowane :', parsedOk);
  console.log('  brak linii kanonicznej (data/godz) -> DROP:', brakKanon);
  console.log('  brak slotKey -> DROP:', brakSlot);
  console.log('  brak pracownika (ryzyko KOLIZJI slot_key):', brakPrac);
  console.log('  brak nazwiska klienta:', brakKlient);

  if (przyklNieznany.length) { naglowek('PRZYKŁADY: typ = nieznany'); przyklNieznany.forEach(s => console.log('  ' + s)); }
  if (przyklBrakKanon.length) { naglowek('PRZYKŁADY: brak linii kanonicznej'); przyklBrakKanon.forEach(s => console.log('  ' + s)); }
  if (przyklBrakPrac.length) { naglowek('PRZYKŁADY: brak pracownika'); przyklBrakPrac.forEach(s => console.log('  ' + s)); }

  // --- DB: stan na dziś + kolizje ---
  try {
    naglowek('BAZA: WizytyBooksy (tenant ' + TENANT + ')');
    const st = await q(`SELECT status, COUNT(*) n FROM WizytyBooksy WHERE tenant_id=? GROUP BY status`, [TENANT]);
    st.forEach(r => console.log('  status', r.status, ':', r.n));
    const dzis = await q(`SELECT COUNT(*) n FROM WizytyBooksy WHERE tenant_id=? AND data_wizyty=CURDATE() AND status='zapisana'`, [TENANT]);
    console.log('  na DZIŚ (zapisana):', dzis[0].n);
    const pustyPrac = await q(`SELECT COUNT(*) n FROM WizytyBooksy WHERE tenant_id=? AND (pracownik IS NULL OR pracownik='')`, [TENANT]);
    console.log('  wiersze z PUSTYM pracownikiem (ryzyko kolizji):', pustyPrac[0].n);
    const zakres = await q(`SELECT MIN(data_wizyty) mn, MAX(data_wizyty) mx FROM WizytyBooksy WHERE tenant_id=?`, [TENANT]);
    console.log('  zakres dat w bazie:', zakres[0].mn, '->', zakres[0].mx);
    const meta = await q(`SELECT last_uid, last_run FROM BooksyMeta WHERE tenant_id=?`, [TENANT]);
    console.log('  BooksyMeta:', meta.length ? `last_uid=${meta[0].last_uid}, last_run=${meta[0].last_run}` : '(brak wpisu)');
  } catch (e) { console.error('DB błąd:', e.message); }

  console.log('\nGotowe (nic nie zapisano).');
  process.exit(0);
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
