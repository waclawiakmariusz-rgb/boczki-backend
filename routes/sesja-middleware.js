// routes/sesja-middleware.js — strażnik sesji dla WSZYSTKICH tras pod /api (odczyty GET i zapisy w routerach).
//
// Historia: do 2026-10-18 ten strażnik był zarejestrowany w server.js PO routerach, więc nigdy nie wykonywał się dla
// tras routerów (Express obsługuje żądanie w pierwszym pasującym handlerze). Odczyty typu GET /api/klienci?action=get_clients
// &tenant_id=… były dostępne bez tokenu sesji. Zapisy przez dispatcher POST /api były chronione osobno (ENFORCE_SESSION_POST).
// Od tej wersji strażnik jest rejestrowany PRZED routerami (test: tests/sesja-odczyty.test.js sprawdza kolejność w server.js).
//
// Zasady:
//   • pomijane: dispatcher kompatybilności (req.path === '/', ma własną kontrolę ENFORCE_SESSION_POST), gałęzie z własnym
//     uwierzytelnieniem (panel Magdy, admina, billing, Klub klientek) i JAWNA lista ścieżek publicznych (strony dla klientek
//     i kandydatów bez logowania: zdjęcia z telefonu, zgoda/płatność z linku, sklep, rejestracja, reset hasła, blog).
//     Inwentarz stron publicznych i ich wywołań: docs/terminarz-zakupy/po12/inwentarz-publiczne.md (2026-10-18).
//   • żądanie bez tenant_id w body/query przechodzi dalej (trasy z tenant w ścieżce, np. /dokumenty/:tenant/:plik i
//     /foto/plik/:tenant/:plik, sprawdzają dostęp same — zweryfikowane w inwentarzu),
//   • z tenant_id: token musi należeć do tego salonu — brak → 403, wygasły → 401, inny salon → 403,
//   • blokada jest DOMYŚLNIE WŁĄCZONA, niezależnie od starej flagi ENFORCE_SESSION (tryb miękki dotyczył czasów, gdy lista
//     publiczna była niekompletna). WYŁĄCZNIK AWARYJNY na panel Hostingera: ENFORCE_SESSION_ROUTERY=false (bez apostrofów)
//     → tylko log, jak przed tą wersją; nie wyłącza kontroli dispatchera POST.
'use strict';

/** Ścieżki pod /api dostępne bez sesji — dokładne dopasowanie req.path. */
const PUBLIC_PATHS = [
  // logowanie / konta
  '/login', '/admin/login', '/billing/login',
  '/reset-hasla/wyslij', '/reset-hasla/weryfikuj', '/reset-hasla/ustaw',
  // onboarding salonu (rejestracja.html, zamow.html)
  '/rejestracja/weryfikuj', '/rejestracja/zaloz', '/rejestracja/check-login',
  '/zamowienie', '/voucher/weryfikuj', '/kontakt', '/gus',
  '/stripe/webhook', '/stripe/config', '/stripe/sukces', '/stripe/create-checkout',
  '/predef/zabiegi', '/predef/pominięto', '/predef/pomini%C4%99to',
  // zdjęcia przed/po z telefonu pracownika (foto.html: token HMAC z QR + PIN) — UWAGA: /foto?action=… (sesje, urządzenia) jest PRYWATNE
  '/foto/mobile-info', '/foto/urzadzenie', '/foto/dzien', '/foto/klienci', '/foto/start', '/foto/potwierdz', '/foto/upload',
  // zgoda i płatność z linku SMS (platnosc.html: token HMAC) — UWAGA: /zgody (lista, statystyki) jest PRYWATNE
  '/zgoda/info', '/zgoda/akceptuj',
  // globalna baza wiedzy czatu pomocy
  '/help-kb/global',
];
/** Gałęzie z własnym uwierzytelnieniem albo w całości publiczne (dopasowanie: równe prefiksowi albo prefiks + '/'). */
const PUBLIC_PREFIXES = [
  '/magda',   // panel księgowej: x-magda-token
  '/admin',   // panel administratora: X-Admin-Token
  '/billing', // panel rozliczeń: x-billing-token
  '/klub',    // aplikacja klientki (PWA): własna sesja Klubu w treści żądania; /klub/img/:tenant/:plik = publiczne zdjęcia nagród
  '/blog',    // publiczne wpisy
];

function czyPubliczna(sciezka) {
  if (sciezka === '/') return true;
  if (PUBLIC_PATHS.includes(sciezka)) return true;
  return PUBLIC_PREFIXES.some(p => sciezka === p || sciezka.startsWith(p + '/'));
}

/**
 * Fabryka middleware. opts: { validateTenantAccess, touchSession, enforceRoutery (ENFORCE_SESSION_ROUTERY, domyślnie true), log }
 */
function sesjaMiddleware(opts) {
  const { validateTenantAccess, touchSession, log = console } = opts;
  const enforceRoutery = opts.enforceRoutery !== false;
  return function (req, res, next) {
    // Sesja „sliding”: każde żądanie z tokenem przedłuża ważność (także dispatcher '/', który poniżej pomijamy).
    const tokenAktywnosci = req.headers['x-session-token'];
    if (tokenAktywnosci && touchSession) touchSession(tokenAktywnosci);

    if (czyPubliczna(req.path)) return next();

    const tenant_id = (req.body && req.body.tenant_id) || (req.query && req.query.tenant_id);
    if (!tenant_id) return next();

    const token = req.headers['x-session-token'];
    const result = validateTenantAccess(token, tenant_id);
    if (result.valid) return next();

    log.warn(`[SESJA ${String(result.reason).toUpperCase()}] ${req.method} ${req.path} | IP: ${req.ip} | tenant: ${tenant_id} | token: ${token ? 'obecny' : 'brak'}`);
    if (!enforceRoutery) return next(); // wyłącznik awaryjny: zachowanie sprzed 2026-10-18 (tylko log)

    const status = result.reason === 'expired' ? 401 : 403;
    const message = result.reason === 'expired' ? 'Sesja wygasła. Zaloguj się ponownie.' : 'Brak dostępu.';
    return res.status(status).json({ status: 'error', code: 'SESJA', message });
  };
}

module.exports = { sesjaMiddleware, PUBLIC_PATHS, PUBLIC_PREFIXES, czyPubliczna };
