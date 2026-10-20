// routes/naglowki-bezpieczenstwa.js — nagłówki bezpieczeństwa HTTP dla całej aplikacji.
//
// Wydzielone z server.js 20.10.2026, żeby dało się to przetestować. Powód: pierwszy prawdziwy
// klient (Ambasada Urody) dostał maila powitalnego BEZ logo i bez zrzutu ekranu. Pliki były
// na serwerze i odpowiadały poprawnie — blokował je nasz własny nagłówek
// Cross-Origin-Resource-Policy: same-origin, wysyłany do WSZYSTKIEGO. Ten nagłówek mówi
// przeglądarce: „tę treść wolno wczytać tylko stronie z tej samej domeny". Klient pocztowy
// jest inną domeną, więc grafika się nie pokazuje — i to w każdej skrzynce, nie tylko u nas.
//
// Rozwiązanie: dwa katalogi z grafiką marketingową (logo i zrzuty z przewodnika) dostają
// 'cross-origin'. To materiały i tak publiczne — leżą pod stałym adresem i każdy, kto zna link,
// może je otworzyć. Zdjęcia klientek (/uploads) zostają przy 'same-origin' — tego nie ruszamy.
'use strict';

// Tylko te dwa katalogi: logo w nagłówku maili i zrzuty ekranu z przewodnika /pomoc/.
const GRAFIKA_DO_MAILI = /^\/(img|pomoc-zrzuty)\//i;

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://www.facebook.com https://www.google-analytics.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://www.facebook.com",
  "object-src 'none'",
  "frame-ancestors 'self'",
].join('; ');

function naglowkiBezpieczenstwa(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // 2026-10-10: CSP blokowała zasoby spoza domeny — Chart.js i Sortable z CDN (→ "Chart is not
  // defined", Analiza → Miesiąc padała), czcionki Google na wszystkich stronach, piksele GA/Meta na
  // zamow.html. Biblioteki JS są teraz w public/lib (własna domena); tu dopuszczamy tylko to, co
  // nadal ładuje się z zewnątrz. Nowy zewnętrzny zasób = dopisz origin TUTAJ, inaczej przeglądarka
  // go po cichu zablokuje (błąd widać tylko w konsoli).
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', GRAFIKA_DO_MAILI.test(req.path || '') ? 'cross-origin' : 'same-origin');
  next();
}

module.exports = naglowkiBezpieczenstwa;
module.exports.GRAFIKA_DO_MAILI = GRAFIKA_DO_MAILI;
module.exports.CSP = CSP;
