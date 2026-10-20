// Nagłówki bezpieczeństwa — a przede wszystkim ten jeden, przez który grafika nie dotarła do maila.
//
// 20.10.2026: pierwszy klient (Ambasada Urody) zobaczył maila powitalnego bez logo i bez zrzutu
// ekranu. Pliki były na serwerze i odpowiadały poprawnie (200, image/png) — blokował je nasz własny
// Cross-Origin-Resource-Policy: same-origin, wysyłany do wszystkiego. Klient pocztowy to inna
// domena, więc przeglądarka odmawiała pokazania grafiki.
const express = require('express');
const request = require('supertest');
const naglowki = require('../routes/naglowki-bezpieczenstwa');

const aplikacja = () => {
  const app = express();
  app.use(naglowki);
  app.use((req, res) => res.send('ok'));   // cokolwiek pod dowolnym adresem
  return app;
};
const corp = (res) => res.headers['cross-origin-resource-policy'];

describe('nagłówki bezpieczeństwa', () => {
  test('logo z maili wolno wczytać z innej domeny (skrzynka pocztowa)', async () => {
    expect(corp(await request(aplikacja()).get('/img/estelio-logo.png'))).toBe('cross-origin');
  });

  test('zrzuty z przewodnika też — to one ilustrują serię powitalną', async () => {
    expect(corp(await request(aplikacja()).get('/pomoc-zrzuty/pom-03-pulpit.png'))).toBe('cross-origin');
  });

  test('zdjęcia klientek zostają zamknięte dla obcych domen', async () => {
    expect(corp(await request(aplikacja()).get('/uploads/klientka-123.jpg'))).toBe('same-origin');
  });

  test('strony i API zostają zamknięte', async () => {
    expect(corp(await request(aplikacja()).get('/index.html'))).toBe('same-origin');
    expect(corp(await request(aplikacja()).get('/api/cokolwiek'))).toBe('same-origin');
  });

  test('otwarcie dotyczy tylko tych dwóch katalogów, nie podobnych nazw', async () => {
    expect(corp(await request(aplikacja()).get('/imgur/cos.png'))).toBe('same-origin');
    expect(corp(await request(aplikacja()).get('/pomoc-zrzuty-prywatne/x.png'))).toBe('same-origin');
    expect(corp(await request(aplikacja()).get('/public/img/logo.png'))).toBe('same-origin');
  });

  test('pozostałe nagłówki bez zmian — CSP, ramki, sniffing, HSTS', async () => {
    const r = await request(aplikacja()).get('/img/estelio-logo.png');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(r.headers['strict-transport-security']).toMatch(/max-age=31536000/);
    expect(r.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(r.headers['content-security-policy']).toMatch(/object-src 'none'/);
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('CSP nadal wymienia origin po origin — nic nie wpuszczamy hurtem', () => {
    expect(naglowki.CSP).not.toMatch(/\*/);
  });
});
