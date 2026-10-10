// tests/mailer.test.js — treść maili do klienta (bez wysyłki: nodemailer zmockowany).
// 2026-10-10: po przeglądzie komunikacji z nowymi użytkownikami — mail z linkiem mówi o warunkach
// zakupu, każdy mail ma wersję tekstową i Reply-To na skrzynkę kontaktową, ważność linku = realna.
const wyslane = [];
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: async (m) => { wyslane.push(m); return { messageId: 'test' }; } }),
}));

process.env.SMTP_HOST = 'smtp.test';
process.env.SMTP_USER = 'kontakt@estelio.test';
process.env.SMTP_PASS = 'x';
process.env.ADMIN_EMAIL = 'kontakt@estelio.test';
process.env.APP_URL = 'https://estelio.test';

const mailer = require('../routes/mailer');

beforeEach(() => { wyslane.length = 0; });

describe('mailer — wspólne cechy maili do klienta', () => {
  test('każdy mail do klienta ma wersję tekstową, Reply-To i stopkę z kontaktem', async () => {
    await mailer.wyslijLinkRejestracji({ email: 'a@b.pl', imie: 'Anna', token: 'T1', nazwa_salonu: 'Salon X', dniWaznosci: 30 });
    await mailer.wyslijWitamy({ email: 'a@b.pl', imie: 'Anna', nazwa_salonu: 'Salon X', login: 'salon-x' });
    await mailer.wyslijResetHasla({ email: 'a@b.pl', login: 'salon-x', token: 'R1' });
    await mailer.wyslijPotwierdzeniZgloszenia({ email: 'a@b.pl', imie: 'Anna', nazwa_salonu: 'Salon X' });
    await mailer.wyslijOstrzezenieOPlatnosci({ email: 'a@b.pl', nazwa_salonu: 'Salon X', data_grace_until: new Date() });
    expect(wyslane).toHaveLength(5);
    for (const m of wyslane) {
      expect(m.to).toBe('a@b.pl');
      expect(m.replyTo).toBe('kontakt@estelio.test');
      expect(typeof m.text).toBe('string');
      expect(m.text.length).toBeGreaterThan(200);
      expect(m.text).not.toMatch(/<[a-z]+[^>]*>/i);          // bez tagów HTML w wersji tekstowej
      expect(m.html).toContain('kontakt@estelio.test');       // stopka / blok kontaktu
    }
  });
});

describe('mailer — link rejestracyjny', () => {
  test('trial: mówi „0 zł", liczbę dni za darmo i cenę abonamentu', async () => {
    await mailer.wyslijLinkRejestracji({ email: 'a@b.pl', imie: 'Anna', token: 'T1', nazwa_salonu: 'Salon X', dniWaznosci: 30,
      warunki: { kwota_grosze: 0, cena_grosze: 7900, trial_dni: 14, voucher: '' } });
    const m = wyslane[0];
    expect(m.subject).toContain('Salon X');
    expect(m.html).toContain('0 zł');
    expect(m.html).toContain('pierwsze 14 dni masz za darmo');
    expect(m.html).toContain('79 zł miesięcznie');
    expect(m.html).toContain('Zrezygnować możesz w każdej chwili');
    expect(m.html).toContain('ważny przez 30 dni');
    expect(m.html).toContain('https://estelio.test/rejestracja.html?token=T1');
  });

  test('zakup z rabatem: podaje pobraną kwotę, kod i zapowiada fakturę', async () => {
    await mailer.wyslijLinkRejestracji({ email: 'a@b.pl', imie: 'Anna', token: 'T1', nazwa_salonu: 'Salon X', dniWaznosci: 30,
      warunki: { kwota_grosze: 2900, cena_grosze: 7900, trial_dni: 14, voucher: 'START29' } });
    const m = wyslane[0];
    expect(m.html).toContain('Pobraliśmy dziś');
    expect(m.html).toContain('29 zł');
    expect(m.html).toContain('START29');
    expect(m.html).toContain('Faktura przyjdzie osobnym mailem');
    expect(m.html).not.toContain('masz za darmo');
  });

  test('kod z okresem próbnym (0 zł + voucher): nie zgaduje liczby dni', async () => {
    await mailer.wyslijLinkRejestracji({ email: 'a@b.pl', token: 'T1', dniWaznosci: 37,
      warunki: { kwota_grosze: 0, cena_grosze: 7900, trial_dni: 14, voucher: 'PARTNER30' } });
    const m = wyslane[0];
    expect(m.html).toContain('okresu próbnego z kodu');
    expect(m.html).toContain('PARTNER30');
    expect(m.html).not.toContain('pierwsze 14 dni');
    expect(m.html).toContain('ważny przez 37 dni');
  });

  test('bez warunków (link z panelu admina): brak bloku „Twoje warunki", domyślne 7 dni', async () => {
    await mailer.wyslijLinkRejestracji({ email: 'a@b.pl', token: 'T1' });
    const m = wyslane[0];
    expect(m.html).not.toContain('Twoje warunki');
    expect(m.html).toContain('ważny przez 7 dni');
    expect(m.subject).toBe('Twój link rejestracyjny — Estelio');
  });
});

describe('mailer — mail powitalny', () => {
  test('bez hasła, z loginem, przewodnikami i uwagą o cenach 0 zł', async () => {
    await mailer.wyslijWitamy({ email: 'a@b.pl', imie: 'Anna', nazwa_salonu: 'Salon X', login: 'salon-x', haslo: 'TAJNE123' });
    const m = wyslane[0];
    expect(m.subject).toContain('Salon X');
    expect(m.html).toContain('salon-x');
    expect(m.html).not.toContain('TAJNE123');
    expect(m.html).toContain('https://estelio.test/pomoc/');
    expect(m.html).toContain('https://estelio.test/pomoc-manager/');
    expect(m.html).toContain('0 zł');
    expect(m.html).toContain('Esti');
  });
});

describe('mailer — nieudana płatność', () => {
  test('zwraca się po nazwie salonu, podaje datę karencji i prowadzi do panelu rozliczeniowego', async () => {
    await mailer.wyslijOstrzezenieOPlatnosci({ email: 'a@b.pl', nazwa_salonu: 'Salon X', data_grace_until: new Date('2026-10-17T12:00:00') });
    const m = wyslane[0];
    expect(m.subject).toContain('Salon X');
    expect(m.html).toContain('Dzień dobry, Salon X');
    expect(m.html).toContain('17.10.2026');
    expect(m.html).toContain('https://estelio.test/billing.html');
    expect(m.html).not.toContain('link który wysłaliśmy');
  });

  test('bez adresu e-mail nic nie wysyła', async () => {
    await mailer.wyslijOstrzezenieOPlatnosci({ email: '', nazwa_salonu: 'Salon X' });
    expect(wyslane).toHaveLength(0);
  });
});
