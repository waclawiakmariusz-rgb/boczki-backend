// scripts/booksy-imap-test.js — sprawdza połączenie IMAP i listuje ostatnie maile Booksy.
//   node scripts/booksy-imap-test.js
require('dotenv').config();
const { ImapFlow } = require('imapflow');

function clean(v) { return (v || '').replace(/^['"]|['"]$/g, ''); }

(async () => {
  const client = new ImapFlow({
    host: clean(process.env.BOOKSY_IMAP_HOST) || 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: clean(process.env.BOOKSY_IMAP_USER), pass: clean(process.env.BOOKSY_IMAP_PASS) },
    logger: false
  });

  try {
    await client.connect();
    console.log('✓ Połączono z IMAP jako', clean(process.env.BOOKSY_IMAP_USER));
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ from: 'no-reply@booksy.com' });
      console.log('Maile od no-reply@booksy.com:', uids.length);
      const ostatnie = uids.slice(-8);
      for await (const msg of client.fetch(ostatnie, { envelope: true })) {
        const d = msg.envelope.date ? new Date(msg.envelope.date).toLocaleString('pl-PL') : '?';
        const from = (msg.envelope.from && msg.envelope.from[0]) ? (msg.envelope.from[0].name || msg.envelope.from[0].address) : '?';
        console.log(`  [${d}] (${from}) ${msg.envelope.subject}`);
      }
    } finally {
      lock.release();
    }
    await client.logout();
    console.log('✓ Rozłączono poprawnie.');
  } catch (e) {
    console.error('✗ BŁĄD IMAP:', e.message);
    process.exit(1);
  }
})();
