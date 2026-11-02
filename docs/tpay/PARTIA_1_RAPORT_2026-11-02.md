# Tpay przez API — partia 1: raport z wykonania (2.11.2026)

Zakres partii 1 wg ustaleń z właścicielem (decyzje D1–D7 w `ANALIZA_I_OCENA_2026-11-02.md`): konfiguracja konta Tpay
per salon (szyfrowana w bazie, nie w env), klient API, tworzenie transakcji po akceptacji regulaminu, „tryb ekspert”
jako ścieżka awaryjna. Webhook tylko loguje — przetwarzanie wpłat to partia 2.

## Co powstało

| Element | Plik | Uwagi |
|---|---|---|
| Moduł Tpay (szyfrowanie, konfiguracja, klient API, transakcje, webhook-log) | `routes/tpay.js` | nowy |
| Trasa płatności `POST /api/zgoda/zaplac`, tryb `api` w tworzeniu linku, `platnosc_api` w info/akceptuj, `tpay_api` w statusie | `routes/zgody.js` | rozszerzenie, bez zmiany zachowania dla salonów bez konfiguracji |
| Ścieżki publiczne `/zgoda/zaplac`, `/webhooks` | `routes/sesja-middleware.js` | |
| Surowe body dla webhooka przed `express.json`, moduł wpięty do zgód | `server.js` | wzorzec jak Stripe |
| Strona płatności: po akceptacji w trybie API woła `zaplac`, obsługa powrotu `?wynik=ok|blad` | `public/platnosc.html` | |
| Karta „Konto Tpay salonu” + przełącznik trybu formularza linku | `public/tpay-konfiguracja.js`, `.css` | osobne pliki, wpięte z `?v=__WERSJA_PLIKOW__` |
| Kontener karty, „Tryb ekspert” w formularzu, odznaka „W PŁATNOŚCI” na liście | `public/index.html` | punktowe zmiany narzędziem Edit |
| Testy jednostkowe (24) | `tests/tpay.test.js` | szyfr, RBAC, maski, webhook, strażnicy spięć |
| Scenariusz próby + skrypt przygotowania/sprzątania | `narzedzia/proby/tpay-partia-1.json`, `skrypty/tpay-partia-1-sprzatanie.js` | baza izolowana |

### Schemat (tylko nowe tabele i kolumny NULL)

- `Tenant_Tpay` — jeden wiersz na salon: `client_id`, `client_secret_enc`, `security_code_enc` (AES-256-GCM, klucz pochodny
  salonu = HKDF-SHA256(klucz główny, salt `estelio-tpay-v<wersja>`, info `tenant_id`)), `merchant_id`, `sandbox`, `api_base`,
  `webhook_token` (32 hex, unikalny — adres powiadomień salonu), `key_version`, `updated_by/at`.
- `Tpay_Transakcje` — transakcja per link: `zgoda_id`, `tpay_transaction_id`, `tpay_title`, `crc` (unikalny per salon),
  `kwota_grosze`, `payment_url`, `status` (`pending`), `test_mode`, `paid_at`, `last_checked_at`.
- `Tpay_Webhook_Log` — surowy ładunek każdego powiadomienia (bez pól kart), kto, kiedy, wynik.
- `ZgodyPlatnosci` + kolumny NULL: `tryb` (`manual`/`api`), `otwarto_at`, `platnosc_start_at`, `oplacono_at`, `zwrot_at`,
  `kwota_wplacona`, `zadatek_id`. Istniejące wiersze = tryb ręczny, nic się dla nich nie zmienia.

### Zmienne środowiskowe (tylko Estelio, nic o salonach)

- `TPAY_CONFIG_KEY` — klucz główny, 32 bajty jako 64 znaki hex (albo base64). **Bez łańcucha awaryjnego**: brak klucza =
  karta mówi „serwer nie ma klucza”, zapis i płatności API wyłączone, tryb ręczny działa. Wygenerować:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` i wkleić w Hostingerze bez apostrofów.
- `TPAY_API` — `on` (domyślnie) / `off` (wyłącznik awaryjny: zero wywołań Tpay, salony wracają do trybu ręcznego) /
  `atrapa` (tylko środowisko testowe: udawane odpowiedzi, żadne żądanie nie wychodzi).
- `APP_URL` — już istnieje; z niego budowane są adresy powrotu i webhooka.

## Jak to działa dla salonu

1. **Bez konfiguracji** (wszystkie salony poza pilotem): dokładnie dotychczasowy przebieg. Formularz „Link do płatności”
   pokazuje pole „Link do płatności z panelu tpay” (otwarte), kwota opcjonalna.
2. **Konfiguracja** — Administracja → Płatności online → karta „Konto Tpay salonu” (tylko rola admin/megaadmin, rola
   sprawdzana na serwerze z bazy). Pola: Client ID, Client Secret, Kod zabezpieczający, Merchant ID; zaawansowane: sandbox,
   adres API. Sekrety po zapisie nie wracają do przeglądarki (maska, puste pole = bez zmiany). Przyciski: Zapisz,
   Sprawdź połączenie (token + odczyt transakcji), Usuń konfigurację (powrót do trybu ręcznego). Karta pokazuje adres
   webhooka salonu — w panelu Tpay trzeba zaznaczyć „Zezwól na nadpisanie”.
3. **Z konfiguracją**: formularz linku pokazuje informację „link Tpay powstanie automatycznie”, pole z panelu schowane pod
   „Tryb ekspert” (wklejony link ma pierwszeństwo — ścieżka awaryjna), kwota wymagana.
4. **Klientka**: otwiera `/platnosc.html?t=…` (zapisujemy `otwarto_at`), akceptuje regulamin → status ZAAKCEPTOWANA →
   strona woła `POST /api/zgoda/zaplac` → Estelio tworzy transakcję w Tpay (opis, kwota, `hiddenDescription=crc`, adres
   powiadomień salonu, adresy powrotu) → przekierowanie do bramki. Ponowne wejście w ciągu 24 h przy transakcji
   „pending” zwraca ten sam adres (bez duplikatu); podwójne kliknięcie blokuje `GET_LOCK`.
5. **Po powrocie z bramki** (`?wynik=ok`) strona dziękuje i mówi wprost, że potwierdzenie przyjdzie do salonu z Tpay —
   powrót niczego nie potwierdza. `?wynik=blad` — komunikat i możliwość ponowienia.
6. **Lista linków**: dla trybu API po wejściu do bramki pojawia się odznaka „W PŁATNOŚCI” z godziną. Status „Opłacono”
   nadejdzie dopiero z webhookiem (partia 2).

## Dowody (środowisko izolowane, `TPAY_API=atrapa`)

Próba `narzedzia/proby/tpay-partia-1.json`: 11 zrzutów w `docs/tpay/zrzuty-partia-1/`, 12 sprawdzeń PASS, 0 błędów JS.
Skrypt sprzątania przed usunięciem wypisał stan linku z próby: `status=ZAAKCEPTOWANA, tryb=api, kwota=150.00,
otwarto_at=14:50:43, platnosc_start_at=14:50:47`, konfiguracja: `client_id=proba-client-id-1234, secret_len=64 (szyfrogram),
key_version=1, updated_by=Ola`. Po sprzątaniu: 0 wierszy Tpay dla demo-test, Ola z powrotem `manager`, regulamin dodany na
czas próby usunięty.

| Zrzut | Co pokazuje |
|---|---|
| 01 | karta „Konto Tpay salonu” pusta — „Brak konfiguracji — działa tryb ręczny” |
| 02 | formularz linku bez konfiguracji: pole z panelu tpay otwarte (stan dotychczasowy) |
| 03–04 | wypełnienie i zapis; po zapisie maski zamiast sekretów, adres webhooka, odznaka SKONFIGUROWANE |
| 05 | „Sprawdź połączenie” — OK (atrapa) |
| 06 | formularz linku z konfiguracją: informacja o automatycznym linku, „Tryb ekspert” zwinięty |
| 07–08 | link wygenerowany bez wklejania; na liście jako OCZEKUJE |
| 09–10 | strona płatności klientki (osoba spoza bazy): kwota, dane, regulamin |
| 11 | po akceptacji → transakcja (atrapa) → powrót `?wynik=ok` „Dziękujemy” |

Testy: `tests/tpay.test.js` 24/24; pełny zestaw jest — wynik w komunikacie do właściciela.

## Co zauważyłem po drodze

- Narzędzie prób zgadywało listę dodatków po logowaniu PIN-em (stała lista bez `platnosc_link`) — teraz bierze ją z
  odpowiedzi `verify_pin`, jak prawdziwe logowanie. Dzięki temu karta Tpay i menu dodatku są widoczne w próbach.
- Salon demo-test nie ma regulaminu — bez niego nie da się wygenerować linku. Skrypt przygotowania dodaje regulamin-URL
  na czas próby i usuwa go po niej (tylko jeśli sam go dodał).
- Serwer usuwa nawiasy kwadratowe z opisu linku (`[próba tpay]` → `próba tpay`) — sprzątanie szuka po treści bez nawiasów.
- „Sprawdź połączenie” potwierdza token i odczyt; prawo do tworzenia transakcji zweryfikuje dopiero pierwszy prawdziwy
  link (Tpay nie zwraca zakresu klucza). Klucz API w panelu Tpay musi mieć uprawnienie zapisu.

## Zanim Boczki użyją tego na produkcji

1. Właściciel ustawia `TPAY_CONFIG_KEY` w Hostingerze (bez apostrofów), restart aplikacji; `TPAY_API` nieustawione = `on`.
2. Deploy main (ff-merge dev) — dopiero na słowo.
3. W Estelio (Boczki, rola admin): Administracja → Płatności online → karta Tpay → dane z Panelu Akceptanta → Zapisz →
   Sprawdź połączenie.
4. W Panelu Tpay: Powiadomienia → „Zezwól na nadpisanie” adresu powiadomień.
5. Pierwszy link na 1 zł na własny telefon (decyzja D3). W partii 1 wpłata zostanie zapisana w `Tpay_Webhook_Log`
   (bez zmiany statusu linku) — to materiał do partii 2.

## Partia 2 (następna)

Przetwarzanie webhooka (JWS + md5 + idempotencja po `tr_crc`), status „Opłacono” / „Do sprawdzenia” (kwota ≠),
automat zadatku dla klientek z bazy i półautomat dla osób spoza bazy, automatyczne „Zadatek wpłynął” dla holdu Terminarza,
cron zapasowy pod `GET_LOCK` (odpytanie `GET /transactions/{id}` dla „pending” starszych niż X min), statystyki, pomoc.
