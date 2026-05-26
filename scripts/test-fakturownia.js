// scripts/test-fakturownia.js
// Test integracji Fakturownia.pl — wystawia prawdziwą testową fakturę B2C.
// Uruchom: node scripts/test-fakturownia.js
//
// Czyta FAKTUROWNIA_TOKEN, FAKTUROWNIA_SUBDOMAIN, STRIPE_CENA_GROSZE z .env.
// Wystawia fakturę na email podany jako argument lub TEST_FAKTURA_EMAIL z .env.
// Po teście można usunąć fakturę w panelu Fakturownia (lub przez API).

require('dotenv').config();

const { wystawFakture, pobierzFaktury } = require('../routes/fakturownia');

const email = process.argv[2] || process.env.TEST_FAKTURA_EMAIL;
if (!email) {
  console.error('Użycie: node scripts/test-fakturownia.js <email>');
  console.error('Lub ustaw TEST_FAKTURA_EMAIL w .env');
  process.exit(1);
}

const token = process.env.FAKTUROWNIA_TOKEN;
const subdomain = process.env.FAKTUROWNIA_SUBDOMAIN;

if (!token || !subdomain) {
  console.error('Brak FAKTUROWNIA_TOKEN lub FAKTUROWNIA_SUBDOMAIN w .env');
  process.exit(1);
}

const dane = {
  nazwa_salonu: 'TEST — ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
  email,
  miasto: 'Warszawa',
  telefon: '+48 000 000 000',
  nip: '',
};

console.log('=== TEST FAKTUROWNIA ===');
console.log('Subdomena:', subdomain + '.fakturownia.pl');
console.log('Email odbiorcy:', email);
console.log('Nazwa nabywcy:', dane.nazwa_salonu);
console.log('Kwota: ', (parseInt(process.env.STRIPE_CENA_GROSZE || '7900') / 100).toFixed(2), 'zł brutto');
console.log('');
console.log('Wystawiam fakturę...');

(async () => {
  try {
    const wynik = await wystawFakture(dane);
    console.log('');
    console.log('✓ SUKCES');
    console.log('  Faktura ID:', wynik.id);
    console.log('  Numer:     ', wynik.numer);
    console.log('  Email z PDF powinien dotrzeć na:', email, '(sprawdź też SPAM)');
    console.log('');
    console.log('Pobieram listę faktur tego nabywcy z ostatnich 2 lat...');
    const lista = await pobierzFaktury(email);
    console.log(`  Znaleziono ${lista.length} faktur:`);
    lista.slice(0, 5).forEach(f => {
      console.log(`  - #${f.numer} | ${f.data} | ${f.kwota_brutto} | ${f.status} | ${f.link_pdf || '(brak link)'}`);
    });
    console.log('');
    console.log('CO SPRAWDZIĆ:');
    console.log('1. Mail z PDF doszedł na', email);
    console.log('2. PDF się otwiera, dane sprzedawcy poprawne (nazwa firmy, NIP, adres)');
    console.log('3. Pozycja "Dostęp do systemu Estelio (1 miesiąc)" + 23% VAT');
    console.log('4. W panelu https://' + subdomain + '.fakturownia.pl widać fakturę #' + wynik.numer);
    console.log('');
    console.log('Jeśli wszystko OK — można usunąć testową fakturę w panelu Fakturownia.');
  } catch (err) {
    console.log('');
    console.error('✗ BŁĄD:', err.message);
    console.error('');
    console.error('Najczęstsze przyczyny:');
    console.error('  - Nieprawidłowy FAKTUROWNIA_TOKEN (sprawdź w panelu → Ustawienia → API)');
    console.error('  - Subdomena ' + subdomain + '.fakturownia.pl nie istnieje');
    console.error('  - W koncie Fakturownia nie wpisano danych sprzedawcy (nazwa, NIP, adres)');
    console.error('  - Brak SMTP w Fakturowni — fakturę wystawi, ale maila nie wyśle');
    process.exit(2);
  }
})();
