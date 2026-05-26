// scripts/test-stripe-checkout.js
// Test Stripe Checkout — tworzy testową sesję płatności, wypisuje URL.
// Otwierasz URL w przeglądarce, płacisz kartą testową:
//   numer:  4242 4242 4242 4242
//   data:   dowolna przyszła (np. 12/30)
//   CVC:    dowolny 3-cyfrowy (np. 123)
//
// Uruchom: node scripts/test-stripe-checkout.js
// Wymaga: STRIPE_SECRET_KEY (musi być sk_test_), STRIPE_PRICE_ID (test mode), APP_URL.

require('dotenv').config();

const key = process.env.STRIPE_SECRET_KEY;
const priceId = (process.env.STRIPE_PRICE_ID || '').replace(/^['"]|['"]$/g, '');
const appUrl = (process.env.APP_URL || 'https://estelio.com.pl').replace(/^['"]|['"]$/g, '').replace(/\/$/, '');

if (!key) {
  console.error('Brak STRIPE_SECRET_KEY w .env');
  process.exit(1);
}
if (!key.startsWith('sk_test_')) {
  console.error('⚠️  STRIPE_SECRET_KEY zaczyna się od', key.slice(0, 8), '— NIE jest to klucz testowy.');
  console.error('   Ten skrypt służy do testów. Użyj klucza sk_test_... aby uniknąć prawdziwych obciążeń.');
  console.error('   Jeśli na pewno chcesz kontynuować, zakomentuj tę walidację.');
  process.exit(1);
}
if (!priceId) {
  console.error('Brak STRIPE_PRICE_ID w .env');
  process.exit(1);
}

const stripe = require('stripe')(key);

const email = process.argv[2] || process.env.TEST_FAKTURA_EMAIL;
if (!email) {
  console.error('Użycie: node scripts/test-stripe-checkout.js <email>');
  process.exit(1);
}

const dane = {
  zamowienie_id: 'test-' + Date.now(),
  imie: 'TEST',
  nazwa_salonu: 'Salon Testowy ' + new Date().toISOString().slice(11, 16),
  email,
  telefon: '+48 600 000 000',
  miasto: 'Warszawa',
  nip: '',
};

console.log('=== TEST STRIPE CHECKOUT ===');
console.log('Tryb:        ', key.startsWith('sk_test_') ? 'TEST (bez prawdziwych płatności)' : 'LIVE (prawdziwe pieniądze!)');
console.log('Price ID:    ', priceId);
console.log('Email:       ', email);
console.log('Salon:       ', dane.nazwa_salonu);
console.log('APP_URL:     ', appUrl);
console.log('');
console.log('Tworzę sesję Checkout...');

(async () => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      customer_email: email,
      metadata: dane,
      subscription_data: { metadata: dane },
      success_url: `${appUrl}/platnosc-sukces.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/zamow.html?anulowano=1`,
      locale: 'pl',
    });

    console.log('');
    console.log('✓ Sesja utworzona');
    console.log('  Session ID:', session.id);
    console.log('');
    console.log('OTWÓRZ W PRZEGLĄDARCE:');
    console.log('  ' + session.url);
    console.log('');
    console.log('KARTA TESTOWA:');
    console.log('  Numer:  4242 4242 4242 4242');
    console.log('  Data:   dowolna przyszła (12/30)');
    console.log('  CVC:    dowolny (123)');
    console.log('  Imię:   dowolne');
    console.log('');
    console.log('CO SIĘ STANIE PO ZAPŁACENIU:');
    console.log('1. Przekierowanie na ' + appUrl + '/platnosc-sukces.html');
    console.log('2. Stripe wyśle webhook checkout.session.completed na', appUrl + '/api/stripe/webhook');
    console.log('3. Webhook wygeneruje token rejestracyjny w bazie + wyśle email z linkiem');
    console.log('4. Webhook zawoła wystawFakture() → Fakturownia wystawi fakturę i wyśle PDF');
    console.log('');
    console.log('WERYFIKACJA:');
    console.log('- Stripe Dashboard → Test mode → Payments: zobaczysz płatność');
    console.log('- Webhook log w Stripe Dashboard → Developers → Webhooks → twój endpoint');
    console.log('- Skrzynka', email, '— powinny przyjść 2 emaile (rejestracja + faktura)');
    console.log('');
    console.log('JEŚLI WEBHOOK NIE DOJDZIE (brak emaili):');
    console.log('- Sprawdź czy serwer na', appUrl, 'jest dostępny');
    console.log('- Stripe Dashboard → Webhooks → twój endpoint → "Recent deliveries" pokaże błąd');
    console.log('- STRIPE_WEBHOOK_SECRET w .env serwera musi pasować do webhooka w Dashboard');
  } catch (err) {
    console.log('');
    console.error('✗ BŁĄD:', err.message);
    if (err.code === 'resource_missing') {
      console.error('  Najpewniej zły STRIPE_PRICE_ID albo nie jest w trybie test');
      console.error('  Sprawdź: Stripe Dashboard → Test mode → Products → twój produkt → Price ID');
    }
    process.exit(2);
  }
})();
