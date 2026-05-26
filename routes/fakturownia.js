// routes/fakturownia.js
// Integracja z Fakturownia.pl — automatyczne wystawianie faktur po płatności Stripe

const https = require('https');

function stripQuotes(val) {
  return (val || '').replace(/^['"]|['"]$/g, '');
}

const TOKEN      = () => stripQuotes(process.env.FAKTUROWNIA_TOKEN);
const SUBDOMAIN  = () => stripQuotes(process.env.FAKTUROWNIA_SUBDOMAIN);

// Cena brutto w złotych (STRIPE_CENA_GROSZE w groszach → złote)
function cenaBrutto() {
  const grosze = parseInt(process.env.STRIPE_CENA_GROSZE || '7900');
  return (grosze / 100).toFixed(2);
}

// Dzisiejsza data w formacie YYYY-MM-DD
function dzisiaj() {
  return new Date().toISOString().slice(0, 10);
}

// Data płatności — 7 dni od teraz
function terminPlatnosci() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Wystawia fakturę VAT i wysyła PDF mailem do klienta przez Fakturownia.pl
 *
 * @param {object} params
 * @param {string} params.nazwa_salonu  - Nazwa nabywcy (salon)
 * @param {string} params.email         - Email nabywcy
 * @param {string} [params.miasto]      - Miasto nabywcy (opcjonalne)
 * @param {string} [params.telefon]     - Telefon nabywcy (opcjonalne)
 * @param {string} [params.nip]         - NIP nabywcy (opcjonalne — bez NIP = faktura B2C)
 * @returns {Promise<{id: number, numer: string}>}
 */
async function wystawFakture({ nazwa_salonu, email, miasto, telefon, nip }) {
  const token     = TOKEN();
  const subdomain = SUBDOMAIN();

  if (!token || !subdomain) {
    throw new Error('Brak konfiguracji Fakturownia (FAKTUROWNIA_TOKEN, FAKTUROWNIA_SUBDOMAIN).');
  }

  const body = JSON.stringify({
    api_token: token,
    invoice: {
      kind:            'vat',
      number:          null,          // Fakturownia nada numer automatycznie
      issue_date:      dzisiaj(),
      sell_date:       dzisiaj(),
      payment_to:      terminPlatnosci(),
      payment_type:    'transfer',
      currency:        'PLN',

      // Sprzedawca — pobierany z ustawień konta Fakturownia (nie trzeba podawać)

      // Nabywca
      buyer_name:      nazwa_salonu,
      buyer_email:     email,
      buyer_city:      miasto  || '',
      buyer_phone:     telefon || '',
      buyer_tax_no:    nip     || '',  // Pusty = faktura bez NIP (B2C)

      // Pozycje faktury
      positions: [
        {
          name:              'Dostęp do systemu Estelio (1 miesiąc)',
          tax:               '23',
          total_price_gross: cenaBrutto(),
          quantity:          '1',
        }
      ]
    }
  });

  const created = await new Promise((resolve, reject) => {
    const options = {
      hostname: `${subdomain}.fakturownia.pl`,
      path:     '/invoices.json',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[fakturownia] Faktura wystawiona: #${json.number} (id: ${json.id})`);
            resolve({ id: json.id, numer: json.number });
          } else {
            reject(new Error(`Fakturownia HTTP ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Fakturownia parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });

  // Wysyłka PDF mailem do nabywcy — osobny endpoint w Fakturownia API
  try {
    await wyslijFaktureMailem(created.id);
    console.log(`[fakturownia] PDF wysłany mailem do ${email}`);
  } catch (mailErr) {
    console.error(`[fakturownia] Faktura #${created.numer} wystawiona, ale mail się nie wysłał:`, mailErr.message);
    // Faktura jest w panelu — admin może wysłać ręcznie
  }

  return created;
}

/**
 * Wysyła PDF faktury mailem do nabywcy (osobny endpoint Fakturownia API).
 * @param {number} invoiceId - ID faktury z Fakturowni
 */
function wyslijFaktureMailem(invoiceId) {
  const token     = TOKEN();
  const subdomain = SUBDOMAIN();
  const body = JSON.stringify({ api_token: token, email_to_buyer: true });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${subdomain}.fakturownia.pl`,
      path:     `/invoices/${invoiceId}/send_by_email.json`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`send_by_email HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Pobiera listę faktur klienta (po emailu nabywcy).
 * @param {string} email - email klienta którego faktury chcemy zobaczyć
 * @returns {Promise<Array>} - lista faktur z polami: id, numer, data, kwota_brutto, status, link_pdf
 */
async function pobierzFaktury(email) {
  const token     = TOKEN();
  const subdomain = SUBDOMAIN();
  if (!token || !subdomain) throw new Error('Brak konfiguracji Fakturownia.');
  if (!email) return [];

  return new Promise((resolve, reject) => {
    const path = `/invoices.json?api_token=${encodeURIComponent(token)}&buyer_email=${encodeURIComponent(email)}&period=last_2_years`;
    const opts = {
      hostname: `${subdomain}.fakturownia.pl`,
      path,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Fakturownia GET invoices HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try {
          const json = JSON.parse(data);
          const lista = (Array.isArray(json) ? json : []).map(f => ({
            id:           f.id,
            numer:        f.number || '',
            data:         f.issue_date || f.sell_date || '',
            kwota_brutto: f.price_gross_with_discount || f.price_gross || '0.00',
            status:       f.status || '',
            link_pdf:     f.view_url ? f.view_url + '.pdf' : null,
          }));
          resolve(lista);
        } catch (e) {
          reject(new Error('Fakturownia parse error: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { wystawFakture, pobierzFaktury };
