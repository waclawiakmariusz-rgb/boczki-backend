// scripts/booksy-inspect.js — DIAGNOSTYKA (tylko odczyt). Wypisuje temat + treść wskazanych UID-ów.
// Uruchom: node scripts/booksy-inspect.js 2899 2912 3034
require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { parseBooksyEmail } = require('../routes/booksyParser');
function clean(v) { return (v || '').replace(/^['"]|['"]$/g, '').trim(); }
const HOST = clean(process.env.BOOKSY_IMAP_HOST) || 'imap.gmail.com';
const USER = clean(process.env.BOOKSY_IMAP_USER);
const PASS = clean(process.env.BOOKSY_IMAP_PASS);
const UIDS = process.argv.slice(2).map(n => parseInt(n, 10)).filter(Boolean);

(async () => {
  if (!UIDS.length) { console.error('Podaj UID-y, np. node scripts/booksy-inspect.js 2899 2912'); process.exit(1); }
  const client = new ImapFlow({ host: HOST, port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    for await (const m of client.fetch(UIDS, { uid: true, source: true }, { uid: true })) {
      const p = await simpleParser(m.source);
      console.log('\n========== UID ' + m.uid + ' ==========');
      console.log('TEMAT:', p.subject || '');
      const fromName = (p.from && p.from.value && p.from.value[0]) ? (p.from.value[0].name || '') : '';
      console.log('FROM :', fromName, '<' + ((p.from && p.from.value && p.from.value[0] && p.from.value[0].address) || '') + '>');
      const fn = (p.from && p.from.value && p.from.value[0]) ? (p.from.value[0].name || '') : '';
      const w = parseBooksyEmail({ subject: p.subject || '', fromName: fn, text: p.text || '' });
      console.log('----- PARSER -----');
      console.log('  typ        :', w.typ);
      console.log('  data/godz  :', w.dataWizyty, w.godzOd, '-', w.godzDo);
      console.log('  pracownik  :', w.pracownik, '| klient:', w.klient);
      console.log('  slotKey    :', w.slotKey);
      console.log('  staraSlotKey:', w.staraSlotKey);
    }
  } finally { lock.release(); await client.logout(); }
  process.exit(0);
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
