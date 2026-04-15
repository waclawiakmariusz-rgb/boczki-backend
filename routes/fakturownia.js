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
  const grosze = parseInt(process.env.STRIPE_CENA_GROSZE || '4900');
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
      payment_kind:    'transfer',
      currency:        'PLN',
      send_invoice:    true,          // Fakturownia wyśle PDF mailem do nabywcy automatycznie

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

  return new Promise((resolve, reject) => {
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
            console.log(`[fakturownia] Faktura wystawiona: #${json.number} (id: ${json.id}) → ${email}`);
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
}

module.exports = { wystawFakture };
