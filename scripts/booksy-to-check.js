// scripts/booksy-to-check.js — DIAGNOSTYKA (tylko odczyt).
// Sprawdza nagłówek To: w mailach Booksy — czy display-name = nazwa salonu (klucz routingu wielosalonowego).
// Uruchom: node scripts/booksy-to-check.js [dni]   (domyślnie 45)
require('dotenv').config();
const { ImapFlow } = require('imapflow');
function clean(v) { return (v || '').replace(/^['"]|['"]$/g, '').trim(); }
const HOST = clean(process.env.BOOKSY_IMAP_HOST) || 'imap.gmail.com';
const USER = clean(process.env.BOOKSY_IMAP_USER);
const PASS = clean(process.env.BOOKSY_IMAP_PASS);
const DNI = parseInt(process.argv[2], 10) || 45;

(async () => {
  const od = new Date(Date.now() - DNI * 86400000);
  const client = new ImapFlow({ host: HOST, port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const toNames = {};   // display-name -> licznik
  const toAddr = {};    // adres -> licznik
  let n = 0;
  try {
    const uids = await client.search({ since: od, from: 'no-reply@booksy.com' }, { uid: true });
    for await (const m of client.fetch(uids || [], { uid: true, envelope: true }, { uid: true })) {
      n++;
      const to = (m.envelope && m.envelope.to && m.envelope.to[0]) ? m.envelope.to[0] : {};
      const nm = (to.name || '(brak nazwy)').trim();
      const ad = (to.address || '(brak)').toLowerCase();
      toNames[nm] = (toNames[nm] || 0) + 1;
      toAddr[ad] = (toAddr[ad] || 0) + 1;
    }
  } finally { lock.release(); await client.logout(); }

  console.log(`Maile Booksy: ${n} (ostatnie ${DNI} dni)\n`);
  console.log('=== To: DISPLAY-NAME (klucz routingu salonu) ===');
  Object.entries(toNames).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  "${k}"`));
  console.log('\n=== To: ADRES ===');
  Object.entries(toAddr).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
  process.exit(0);
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
