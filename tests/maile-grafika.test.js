// Grafika i linki w mailach — test, którego zabrakło i przez to dwa błędy wyszły dopiero u klienta.
//
// 20.10.2026, Ambasada Urody (pierwszy klient z reklamy) dostała maila powitalnego, w którym:
//  1) logo i zrzut ekranu się nie pokazały — blokował je nasz Cross-Origin-Resource-Policy,
//  2) szósty mail serii („terminarz") wskazywał na plik, którego pod tym adresem w ogóle nie ma.
//
// Oba błędy były niewidoczne w podglądzie w panelu (ta sama domena = obrazki zawsze się ładują)
// i w wysyłce próbnej na Gmaila (Gmail pobiera grafikę własnym serwerem, nie przeglądarką).
// Ten test sprawdza jedno i drugie offline, przy każdym uruchomieniu zestawu.
const fs = require('fs');
const path = require('path');
const { GRAFIKA_DO_MAILI } = require('../routes/naglowki-bezpieczenstwa');

process.env.APP_URL = 'https://estelio.com.pl';
const mailer = require('../routes/mailer');
const { SERIA } = require('../routes/maile-wprowadzajace-tresc');

const PUBLIC = path.join(__dirname, '..', 'public');
const zbudowane = SERIA.map(m => ({ etap: m.etap, html: mailer.zbudujMailWprowadzajacy({ nazwa_salonu: 'Salon Testowy', mail: m }) }));
const obrazki = (html) => [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]);
const sciezka = (url) => url.replace(/^https?:\/\/[^/]+/, '');

describe('maile — grafika', () => {
  test.each(zbudowane.map(z => [z.etap, z]))('„%s": każdy obrazek ma plik na dysku', (_etap, z) => {
    const adresy = obrazki(z.html);
    expect(adresy.length).toBeGreaterThan(0);                       // przynajmniej logo
    for (const u of adresy) {
      const plik = path.join(PUBLIC, sciezka(u));
      expect(fs.existsSync(plik) ? u : `BRAK PLIKU: ${u}`).toBe(u);  // komunikat mówi, czego brakuje
      expect(fs.statSync(plik).size).toBeGreaterThan(1000);          // nie pusty, nie placeholder
    }
  });

  test.each(zbudowane.map(z => [z.etap, z]))('„%s": każdy obrazek leży w katalogu otwartym dla skrzynek', (_etap, z) => {
    for (const u of obrazki(z.html)) {
      expect(GRAFIKA_DO_MAILI.test(sciezka(u)) ? u : `KATALOG ZAMKNIETY DLA POCZTY: ${u}`).toBe(u);
    }
  });

  test('zrzut z przewodnika Terminarza podany pełną ścieżką trafia tam, gdzie leży', () => {
    const terminarz = zbudowane.find(z => z.etap === 'terminarz');
    expect(obrazki(terminarz.html)).toContain('https://estelio.com.pl/pomoc-terminarz/trm-09-widok-dzien.png');
  });

  test('sama nazwa pliku nadal oznacza katalog przewodnika głównego', () => {
    const start = zbudowane.find(z => z.etap === 'start');
    expect(obrazki(start.html)).toContain('https://estelio.com.pl/pomoc-zrzuty/pom-03-pulpit.png');
  });

  test('logo jest w każdym mailu serii i ma czytelny opis zastępczy', () => {
    for (const z of zbudowane) {
      expect(z.html).toContain('/img/estelio-logo.png');
      expect(z.html).toMatch(/alt="Estelio — Beauty Management"/);
    }
  });

  test('każdy obrazek ma alt — gdy skrzynka nie pobierze grafiki, zostaje sensowny tekst', () => {
    for (const z of zbudowane) {
      for (const tag of z.html.match(/<img[^>]*>/g) || []) {
        expect(tag).toMatch(/alt="[^"]{3,}"/);
      }
    }
  });
});

describe('maile — linki', () => {
  test('wszystkie prowadzą na naszą domenę albo na adres e-mail', () => {
    for (const z of zbudowane) {
      for (const m of z.html.matchAll(/href="([^"]+)"/g)) {
        const u = m[1];
        expect(u.startsWith('https://estelio.com.pl') || u.startsWith('mailto:')).toBe(true);
      }
    }
  });

  test('kotwica każdej wiadomości wskazuje rozdział przewodnika, nie samą stronę', () => {
    for (const m of SERIA) {
      if (!m.link_wlasny) expect(typeof m.kotwica).toBe('string');
    }
  });
});
