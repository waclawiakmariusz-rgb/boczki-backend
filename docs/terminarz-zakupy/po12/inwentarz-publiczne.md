# Inwentarz wywołań bez sesji (strony publiczne Estelio) — 18.10.2026

Podstawa jawnej listy wyjątków w `routes/sesja-middleware.js`. Sporządzony z kodu stron w `public/` i tras w `routes/*.js` (przegląd read-only). Żadna strona publiczna nie wysyła `x-session-token` ani `tenant_id`; każda ma własne zabezpieczenie (token HMAC, token urządzenia, własna sesja Klubu, hasło panelu) albo jest z założenia publiczna.

## A. Strony → wywołania

| Strona | Wywołania (metoda ścieżka) | Zabezpieczenie własne |
|---|---|---|
| `foto.html` (zdjęcia przed/po z telefonu) | GET `/api/foto/mobile-info?t=`, GET `/api/foto/urzadzenie?dt=`, POST `/api/foto/dzien`, GET `/api/foto/klienci?dt=`, POST `/api/foto/start`, POST `/api/foto/potwierdz`, POST `/api/foto/upload` | token HMAC z QR, token urządzenia, PIN pracownika |
| `klub.html` (aplikacja klientki) | POST `/api/klub/*` (info, aktywuj, login, me, kosmetyki, nagroda_odbierz, promocja_biore, push_zapisz, rejestracja, reset_pin, zmien_pin, polecenia…), GET `/api/klub/img/:tenant/:plik` | sesja Klubu w treści żądania, limitery; obrazki publiczne |
| `platnosc.html` (zgoda/płatność z linku SMS) | GET `/api/zgoda/info?t=`, POST `/api/zgoda/akceptuj` | token HMAC, limiter |
| `platnosc-sukces.html` | GET `/api/stripe/sukces?session_id=` | walidacja Stripe |
| `zamow.html` (sklep) | GET `/api/stripe/config`, GET `/api/voucher/weryfikuj`, GET `/api/gus?nip=`, POST `/api/stripe/create-checkout`, POST `/api/zamowienie`, POST `/api/kontakt` | limitery; dane publiczne |
| `rejestracja.html` | GET `/api/rejestracja/weryfikuj?token=`, GET `/api/rejestracja/check-login`, GET `/api/predef/zabiegi`, POST `/api/predef/pominięto`, POST `/api/rejestracja/zaloz` | token rejestracji, limitery |
| `reset-hasla.html` | GET `/api/reset-hasla/weryfikuj`, POST `/api/reset-hasla/ustaw` | token resetu |
| `blog.html` | GET `/api/blog/posts` | publiczne |
| `magda.html` | POST `/api/magda/login`, GET/POST `/api/magda/*` | `x-magda-token` |
| `billing.html` | POST `/api/billing/login`, GET/POST `/api/billing/*` | `x-billing-token` |
| `admin.html`, `admin-blog.html` | POST `/api/admin/login`, GET/POST `/api/admin/*`, GET `/api/predef/zabiegi` | `X-Admin-Token` |
| strony statyczne (regulaminy, polityki, pomoc, przewodniki, 403/404/500) | brak wywołań | — |

## B. Trasy GET pod `/api` zwracające dane prywatne (muszą mieć sesję)

`/api/klienci`, `/api/sprzedaz`, `/api/analityka`, `/api/konsultacje`, `/api/lojalnosc`, `/api/zgody`, `/api/rodo`, `/api/urodziny`, `/api/retencja`, `/api/magazyn`, `/api/users`, `/api/get_system_logs`, `/api/booksy`, `/api/features`, `/api/dokumenty_dodatkowe`, `/api/ustawienia/zadatki`, `/api/koszty-plan/*`, `/api/foto?action=…` (sesje, urządzenia) — wszystkie czytają `tenant_id` z zapytania i do 18.10.2026 były dostępne bez tokenu (strażnik stał po routerach). Dispatcher GET `/api?action=…` przekierowuje do tych tras.

Trasy sprawdzające dostęp same (tenant w ścieżce): `/api/dokumenty/:tenant/:plik`, `/api/foto/plik/:tenant/:plik`, `/api/typy-zabiegow`, `/api/help-kb` — zostawione bez zmian.

## C. Poza `/api`

`GET /dbstatus` — ujawniał `DB_HOST`, `DB_NAME` i liczby rekordów bez żadnej autoryzacji; od 18.10.2026 odpowiada tylko z `X-Admin-Token`, inaczej 404.

## D. Do wiedzy (nie zmieniane w tym wydaniu)

`GET /api/foto/mobile-info` i `/api/foto/urzadzenie` zwracają imiona pracowników i nazwę salonu każdemu z ważnym tokenem QR lub urządzenia; `/api/foto/klienci` zwraca imiona klientek po potwierdzeniu PIN-em. To świadomy projekt przepływu zdjęć; token urządzenia w telefonie daje trwały dostęp do wyszukiwarki klientek tego salonu.
