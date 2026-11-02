# Plan wdrożenia: Link do płatności — automatyczne linki Tpay + potwierdzenie płatności

Dla: Claude Code (repo boczki-backend / Estelio)
Data: 2026-11-02
Dotyczy dodatku Estelio+ „Link do płatności” (przewodnik pracownika, Krok 25).

---

## 1. Cel

1. Pracownik tworzy link do płatności **w Estelio**. Nie wchodzi do panelu Tpay i nie wkleja linku z Tpay.
2. Pracownik widzi przy każdym linku, na jakim etapie jest klientka:
   - otworzyła link,
   - zaakceptowała regulamin,
   - przeszła do płatności,
   - **zapłaciła**,
   - zwrot / wygasł / anulowany.
3. „Zapłacił” pochodzi **wyłącznie z webhooka Tpay** (z zapasowym odpytaniem API). Powrót klientki na stronę sukcesu niczego nie potwierdza.

## 2. Stan obecny (wg przewodnika /pomoc/, Krok 25)

Obecny przepływ:

1. Pracownik generuje link w **panelu Tpay**, kopiuje go.
2. Estelio → kafelek „Link do płatności” (albo „+ Link do płatności” w profilu klientki).
3. Pracownik wybiera klientkę lub „Osoba spoza bazy”, wkleja link z Tpay, podaje kwotę i opis.
4. Klika „Generuj link Estelio” i dostaje link ważny 7 dni.

Pozostałe zachowanie:

- Po otwarciu linku klientka akceptuje regulamin, a system zapisuje kto, kiedy i IP. Potem następuje przekierowanie na link Tpay.
- Klientka, która już zaakceptowała regulamin, pomija ten krok.
- System naprawia „panelowe” adresy Tpay wklejone z paska adresu.
- Lista linków ma wyszukiwarkę.
- Administracja → Płatności online (tpay) pokazuje statystyki miesięczne: utworzone / zaakceptowane / wygasłe / anulowane / oczekujące.
- Po wpłacie pracownik **ręcznie** sprawdza panel Tpay i ręcznie wpisuje zadatek (Sprzedaż → Wpłata zadatku, metoda TPay).

Problem: Estelio nie wie, czy klientka zapłaciła. Status kończy się na „zaakceptował regulamin”.

> **Krok 0 dla Claude Code:** znajdź istniejący kod tego dodatku (trasy, tabela linków, publiczna strona akceptacji regulaminu, statystyki w Administracji) i opisz go w 10 linijkach, zanim cokolwiek zmienisz. Nazwy tabel i plików poniżej są propozycją. Dopasuj je do tego, co istnieje.

## 3. Kluczowe decyzje architektoniczne

| Temat | Decyzja |
|---|---|
| Kiedy tworzyć transakcję w Tpay | **Leniwie: w chwili akceptacji regulaminu** (albo przy otwarciu linku, jeśli regulamin był już zaakceptowany). Dzięki temu transakcja jest świeża, nie trzeba zgadywać jej ważności, a regulamin jest zawsze przed płatnością. |
| Powiązanie płatności z linkiem | `hiddenDescription` = krótki, unikalny identyfikator linku (np. `est_<publicId>`). Wraca w webhooku jako `tr_crc`. Zapisujemy też `transactionId` i `title` z odpowiedzi Tpay. |
| Adres webhooka | Ustawiany **per transakcja** w `callbacks.notification.url`. Wymaga zaznaczenia „Zezwól na nadpisanie” w panelu Tpay. Dzięki temu Estelio nie nadpisuje globalnego URL konta, jeśli to samo konto Tpay obsługuje też inny sklep. |
| Multi-tenant | Każdy salon ma własne konto Tpay i dane dostępowe w osobnym rekordzie `tenant_id`. URL webhooka zawiera losowy `webhook_token` salonu, nie `tenant_id`. |
| Źródło prawdy o płatności | Webhook (`tr_status=TRUE`). Zapas: `GET /transactions/{id}` z crona tylko dla „zawieszonych” transakcji. |
| Zadatek po opłaceniu | **Domyślnie półautomat:** status OPŁACONY i przycisk „Wpisz zadatek” z wypełnionymi danymi (klientka, kwota, metoda TPay, cel = opis linku). Bez automatycznego księgowania do portfela. Patrz pkt 11, decyzja D1. |
| Stare linki (wklejone z panelu) | Zostają działające, oznaczone jako „bez śledzenia płatności”. Tryb ręczny zostaje jako awaryjny, schowany pod „Więcej”. Patrz D2. |

## 4. Konfiguracja Tpay (jednorazowo, po stronie salonu)

W Panelu Akceptanta Tpay (salon ma już `client_id` i `client_secret`):

1. **Integracja > API:** `client_id`, `client_secret`. Sprawdzić, czy klucz ma uprawnienie do tworzenia transakcji (zakres zapisu, nie tylko odczyt).
2. **Powiadomienia > Zabezpieczenia:** **kod zabezpieczający**, potrzebny do `md5sum`.
3. **ID sprzedawcy (Merchant ID):** numeryczne `id`, przychodzi w webhooku.
4. **Ustawienia > Powiadomienia:** zaznaczyć **„Zezwól na nadpisanie”**.

W Estelio: **Administracja → Płatności online (tpay) → Konfiguracja**.

- Pola: Client ID, Client Secret, Kod zabezpieczający, Merchant ID, przełącznik Sandbox.
- Przycisk **„Sprawdź połączenie”** pobiera token OAuth i pokazuje OK/błąd. Nie tworzy transakcji.
- Pokazuje (tylko do odczytu) adres webhooka salonu, do wglądu i wsparcia.
- Dostęp: tylko Megaadmin/Admin. Sekrety po zapisie są maskowane (`••••1234`) i nigdy nie wracają do frontendu.

## 5. Model danych

### 5.1 `tenant_tpay_config` (nowa)

```
tenant_id            PK/FK
client_id            VARCHAR
client_secret_enc    TEXT        -- AES-256-GCM, klucz z env TPAY_CONFIG_KEY
security_code_enc    TEXT        -- jw.
merchant_id          VARCHAR
sandbox              TINYINT(1)
webhook_token        CHAR(32)    -- losowy, UNIQUE, do URL webhooka
access_token_cache   TEXT NULL   -- opcjonalnie, albo cache w pamięci
access_token_exp     DATETIME NULL
updated_at, updated_by
```

### 5.2 Istniejąca tabela linków: rozszerzenie

Dodać kolumny (nazwy dopasować do istniejącej tabeli):

```
mode                 ENUM('api','manual') DEFAULT 'api'   -- manual = stary wklejony link
opened_at            DATETIME NULL        -- pierwsze otwarcie linku przez klientkę
terms_accepted_at    DATETIME NULL        -- prawdopodobnie już istnieje
payment_started_at   DATETIME NULL        -- utworzono transakcję i przekierowano do Tpay
paid_at              DATETIME NULL
refunded_at          DATETIME NULL
paid_amount_gr       INT NULL             -- tr_paid w groszach
amount_mismatch      TINYINT(1) DEFAULT 0
deposit_id           INT NULL             -- FK do zadatku, gdy pracownik go wpisze
```

### 5.3 `tpay_transactions` (nowa, 1 link : N transakcji)

Klientka może wrócić do linku po tym, jak transakcja w Tpay wygasła.

```
id                   PK
tenant_id
payment_link_id      FK
tpay_transaction_id  VARCHAR UNIQUE   -- transactionId z POST /transactions
tpay_title           VARCHAR          -- np. TR-XXX-XXXX (tr_id w webhooku)
crc                  VARCHAR UNIQUE   -- hiddenDescription
amount_gr            INT
payment_url          TEXT
status               ENUM('pending','paid','refunded','failed') DEFAULT 'pending'
test_mode            TINYINT(1)
created_at, paid_at, last_checked_at
```

### 5.4 `tpay_webhook_log` (nowa: audyt i debug)

```
id, tenant_id NULL, received_at, remote_ip, headers_json, raw_body,
jws_ok, md5_ok, tr_id, tr_crc, tr_status, result ENUM('processed','duplicate','unknown_crc','invalid'), note
```

Retencja: 12 miesięcy. Bez danych kart. Pola `card_*` wycinać przed zapisem.

**Wyświetlany status linku** wyliczany jest z dat, od najwyższego:

ANULOWANY / ZWRÓCONY / OPŁACONY / W PŁATNOŚCI / REGULAMIN OK / OTWARTY / WYSŁANY / WYGASŁY

Uwagi:
- Link wygasły z `paid_at` pokazuje **OPŁACONY**.
- Link anulowany z `paid_at` pokazuje **„OPŁACONY PO ANULOWANIU”** (czerwony, do zwrotu).

## 6. Backend

### 6.1 Klient API Tpay (`services/tpay/client.js`)

- Baza: `https://api.tpay.com`. Sandbox: **zweryfikować w dokumentacji** (prawdopodobnie `https://openapi.sandbox.tpay.com`).
- `getToken(tenantId)`:
  - `POST /oauth/auth`, `application/x-www-form-urlencoded`, `client_id` i `client_secret`.
  - Token ważny 7200 s. Cache per tenant i odnawianie przy < 5 min do końca.
- `createTransaction(tenantId, {amountGr, description, hiddenDescription, payer, notificationUrl, successUrl, errorUrl})`:
  - `POST /transactions` z body:
    ```json
    {
      "amount": 100.00,
      "description": "Zadatek – Boczki na bok – zabieg 15.07",
      "hiddenDescription": "est_8f3k2m9q",
      "payer": { "email": "...", "name": "..." },
      "callbacks": {
        "notification": { "url": "https://<domena>/api/webhooks/tpay/<webhook_token>" },
        "payerUrls": {
          "success": "https://<domena>/p/<publicId>/dziekujemy",
          "error":   "https://<domena>/p/<publicId>/blad"
        }
      }
    }
    ```
  - Zapisuje `transactionId`, `title` i `transactionPaymentUrl`.
  - Nie wybiera metody płatności: klientka wybiera ją na stronie Tpay.
  - `payer` przekazuje tylko, jeśli Estelio zna dane (dla „osoby spoza bazy” może być puste).
  - **Zweryfikować w API Reference (api.tpay.com):** limity długości `description` i `hiddenDescription`, czy `payer.email`/`payer.name` są wymagane, czy da się ustawić czas ważności transakcji.
- `getTransaction(tenantId, transactionId)`: `GET /transactions/{id}`. Mapowanie statusów odpowiedzi sprawdzić w Swaggerze.
- Kwoty wewnętrznie zawsze w **groszach (INT)**. Konwersja na liczbę z 2 miejscami tylko na granicy API.
- Timeouty 10 s, 1 ponowienie przy 5xx/sieci. Błędy logowane do Sentry bez sekretów.

### 6.2 Publiczna strona linku (rozszerzenie istniejącej)

1. `GET /p/:publicId`:
   - ustaw `opened_at`, jeśli puste;
   - jeśli wygasł lub anulowany, pokaż komunikat;
   - jeśli opłacony, pokaż „Płatność już została zaksięgowana”.
2. Akceptacja regulaminu: obecna logika, czyli zapis `terms_accepted_at`, IP i wersji regulaminu. Pomijanie dla klientki, która już zaakceptowała, zostaje.
3. Po akceptacji (lub przy pominięciu): `POST /p/:publicId/pay`.
   - Jeśli istnieje transakcja `pending` utworzona < 24 h temu: przekieruj na jej `payment_url` (ponowne wejście nie tworzy duplikatu).
   - W przeciwnym razie utwórz nową transakcję (6.1), ustaw `payment_started_at` i przekieruj (303) na `transactionPaymentUrl`.
   - Zabezpieczenie przed podwójnym kliknięciem: blokada w transakcji DB (`SELECT … FOR UPDATE` na linku).
4. `GET /p/:publicId/dziekujemy`: tekst „Dziękujemy. Potwierdzenie płatności dotrze do salonu automatycznie w ciągu kilku minut.” **Nie zmienia statusu.**
5. `GET /p/:publicId/blad`: komunikat i przycisk „Spróbuj ponownie”, który wraca do kroku 3.
6. Tryb `manual` (stare linki): zachowanie bez zmian, czyli przekierowanie na wklejony URL.

### 6.3 Webhook: `POST /api/webhooks/tpay/:webhookToken`

Kolejność (wszystko w try/catch, każdy przypadek zapisany do `tpay_webhook_log`):

1. **Surowe body.** Na tej trasie `express.raw({ type: 'application/x-www-form-urlencoded' })`, montowane **przed** globalnym `express.urlencoded`. Inaczej podpis się nie zgodzi. Parsowanie przez `new URLSearchParams(raw.toString('utf8'))`.
2. Znajdź tenant po `webhookToken`. Jeśli brak: `404`. Tpay po 404 przestaje ponawiać i to jest tu zamierzone.
3. **Weryfikacja JWS (obowiązkowa)** z nagłówka `X-JWS-Signature`:
   ```js
   const [h64, , s64] = jws.split('.');
   const header = JSON.parse(Buffer.from(h64, 'base64url').toString());
   // x5u musi zaczynać się od https://secure.tpay.com (sandbox: zweryfikować domenę, dopuścić tylko przy sandbox=1)
   const cert = new crypto.X509Certificate(await getCachedPem(header.x5u));                       // cache 24h
   const root = new crypto.X509Certificate(await getCachedPem('https://secure.tpay.com/x509/tpay-jws-root.pem'));
   if (!cert.verify(root.publicKey)) fail('cert');
   const payload = rawBody.toString('base64url');
   const ok = crypto.verify('sha256', Buffer.from(`${h64}.${payload}`), cert.publicKey, Buffer.from(s64, 'base64url'));
   ```
   Błąd: `400` i `FALSE`, log `invalid`. Listy IP Tpay nie ma, więc nie whitelistujemy.
4. **md5sum:** `md5(id + tr_id + tr_amount + tr_crc + security_code)` musi się zgadzać, a `id` musi być równe `merchant_id` salonu. Błąd: `400 FALSE`.
5. Znajdź `tpay_transactions` po `crc = tr_crc` **i** `tenant_id`. Jeśli brak (np. płatność z linku wygenerowanego ręcznie w panelu): log `unknown_crc`, odpowiedz `200 TRUE`, żeby zatrzymać ponowienia.
6. **Idempotencja:** w jednej transakcji DB z `FOR UPDATE`:
   - `tr_status = TRUE`: jeśli już `paid`, to `duplicate` i nic więcej. W przeciwnym razie:
     - transakcja: `status=paid`, `paid_at=tr_date`;
     - link: `paid_at`, `paid_amount_gr=tr_paid`, `amount_mismatch = (tr_paid != kwota linku)`.
   - `tr_status = CHARGEBACK`: `status=refunded`, link `refunded_at`. Jeśli zadatek już wpisany: wpis do „Do sprawdzenia” (zadatku nie ruszać automatycznie).
   - `test_mode=1` przy `sandbox=0`: zalogować ostrzeżenie i nie oznaczać jako opłacone.
7. Wpis do **Dziennika zdarzeń**: „TPAY · Link opłacony · {klientka} · {kwota} zł · {tr_id}” (zwrot analogicznie).
8. Odpowiedź: **HTTP 200, body `TRUE`** (dokładnie tak).

Wymagania sieciowe Tpay:
- **Bez przekierowań 301/302** na tej trasie. Sprawdzić, czy proxy Hostingera ani reguła www/https niczego nie przekierowuje.
- Porty 80/8080/443.
- TLS 1.2.

### 6.4 Zapasowe odpytywanie (cron)

- Co 15 min. Wybiera `tpay_transactions` ze statusem `pending`, `created_at` > 10 min i < 7 dni oraz `last_checked_at` starszym niż 30 min.
- Dla każdej wykonuje `GET /transactions/{id}`.
- Jeśli opłacona, wykonuje **tę samą funkcję** co webhook (wspólna `markPaid()`), żeby była jedna ścieżka logiki.
- Limit np. 50 transakcji na przebieg. Tpay zaleca GET wyłącznie jako fallback.
- **Pojedyncza instancja:** blokada `GET_LOCK('tpay_poller')` w MySQL. Lokalna instancja dev nie może odpytywać produkcji. Ta sama lekcja co z pollerem Booksy IMAP: dwie maszyny naraz to duplikaty.

### 6.5 Uprawnienia (RBAC)

- Tworzenie, podgląd, anulowanie linku i „Wpisz zadatek”: Recepcja, Manager, Admin, Megaadmin. Kosmetolog tylko podgląd, jeśli dziś też tak jest; dopasować do obecnych reguł dodatku.
- Konfiguracja Tpay: Admin/Megaadmin.
- Sprawdzanie ról po stronie serwera, nie tylko w menu.

## 7. Frontend

### 7.1 Formularz „Link do płatności” (kafelek Pulpitu i przycisk w profilu)

- **Usunąć pole „wklej link z tpay”.** Zostają: klientka / osoba spoza bazy (imię, opcjonalnie e-mail lub telefon), **kwota**, **opis**.
- Przycisk „🔗 Utwórz link” daje gotowy link Estelio z przyciskami „Kopiuj” oraz „Wyślij SMS/e-mail” (jeśli istnieją).
- Zwijana sekcja „Więcej → Wklej link z panelu tpay (bez śledzenia płatności)”, tryb `manual`, tylko jeśli D2 = tak.
- Gdy salon nie ma konfiguracji Tpay: komunikat „Skonfiguruj Tpay w Administracji” i tylko tryb ręczny.

### 7.2 Lista linków

- Kolumny: data, klientka, kwota, opis, **status (badge)**, kto utworzył.
- Badge statusów:
  - Wysłany (szary)
  - Otwarty (niebieski)
  - Regulamin OK (fiolet)
  - W płatności (żółty)
  - **Opłacony (zielony)**
  - Zwrócony / Wygasł / Anulowany (szare lub czerwone)
  - „Kwota inna niż w linku” (pomarańczowy)
- Rozwinięcie wiersza to **oś czasu**:
  - utworzono (kto),
  - otwarto,
  - regulamin zaakceptowany (data, IP),
  - przekierowano do płatności,
  - opłacono (data, kwota, tytuł TR-…),
  - zadatek wpisany (kto, kiedy).
- Filtry: Wszystkie / Opłacone bez zadatku / Oczekujące / Wygasłe. Wyszukiwarka zostaje.
- Akcje:
  - **Wpisz zadatek**: otwiera „Wpłata zadatku” z wypełnionymi polami: klientka, kwota = `paid_amount_gr`, metoda TPay, cel = opis linku. Po zapisie ustawia `deposit_id`, a przycisk znika (blokada podwójnego wpisu). Dla „osoby spoza bazy” najpierw wybór lub dodanie klientki.
  - **Anuluj link** (gdy nieopłacony).
- Odświeżanie listy co 30 s albo przycisk „Odśwież”. Websockety nie są potrzebne.

### 7.3 Profil klientki

Historia linków z tymi samymi badge'ami i osią czasu.

### 7.4 Pulpit

- „Do sprawdzenia” dostaje nową pozycję **„Opłacone linki bez wpisanego zadatku (N)”**. Jednym kliknięciem przechodzi się do listy z filtrem.
- Pozycje do wyjaśnienia:
  - „Opłacony po anulowaniu”,
  - „Zwrot w Tpay, a zadatek wpisany”,
  - „Kwota inna niż w linku”.

### 7.5 Administracja → Płatności online (tpay)

- Nowa zakładka **Konfiguracja** (pkt 4).
- Statystyki miesięczne: dodać kolumny **Opłacone (szt.)**, **Kwota opłacona**, **Konwersja** (opłacone / utworzone) oraz **„Regulamin OK, nie zapłacił”**. Ta ostatnia to dokładnie przypadek „zamknął przeglądarkę”.

## 8. Bezpieczeństwo i RODO

- Sekrety szyfrowane w DB (AES-256-GCM, klucz w `.env`, poza repo). Nigdy w logach ani w odpowiedziach API.
- Webhook bez sesji, za to z JWS, md5sum i nieodgadywalnym `webhook_token`.
- `publicId` linków: losowe, nie inkrementalne. Sprawdzić, czy obecne takie są.
- Rate limit na `/p/:publicId/pay` (np. 10/min/IP).
- Nowy podmiot przetwarzający? Tpay to operator płatności salonu, a nie Estelio. Dopisać jednak do dokumentacji DPA, że Estelio przekazuje do Tpay imię, nazwisko i e-mail płatnika w imieniu salonu.
- `tpay_webhook_log` bez danych karty.

## 9. Etapy i kolejność prac

| # | Etap | Wynik |
|---|---|---|
| 0 | Rozpoznanie istniejącego kodu dodatku | Krótki opis tabel, tras i widoków. Mapa zmian. |
| 1 | Migracje DB (5.1–5.4) + szyfrowanie sekretów | Migracja z `--dry-run`, w stylu `migrate.js` |
| 2 | Konfiguracja Tpay w Administracji + „Sprawdź połączenie” | Salon zapisuje dane, token się pobiera |
| 3 | Klient API + tworzenie transakcji przy akceptacji regulaminu | Link z Estelio prowadzi do bramki Tpay |
| 4 | Webhook (JWS, md5, idempotencja, Dziennik zdarzeń) | Status OPŁACONY ustawia się sam |
| 5 | UI: formularz, lista, oś czasu, profil, „Wpisz zadatek” | Pracownik widzi i księguje |
| 6 | Cron-fallback + „Do sprawdzenia” + statystyki | Komplet |
| 7 | Testy (pkt 10) na **dev.estelio.com.pl** + sandbox / 1 zł | Checklist zielony |
| 8 | Wdrożenie produkcyjne + konfiguracja panelu Tpay Boczki na bok | Działa na żywo |
| 9 | Aktualizacja przewodnika (Krok 25, słowniczek, FAQ) + baza wiedzy Esti | Dokumentacja zgodna z systemem |

## 10. Testy i kryteria akceptacji

Automatyczne (jednostkowe/integracyjne):

- [ ] Webhook z poprawnym JWS i md5 ustawia `paid` i zwraca `200 TRUE`.
- [ ] Ten sam webhook 3× daje jedną zmianę statusu, jeden wpis w Dzienniku, odpowiedzi `TRUE`.
- [ ] Zły podpis JWS: `400 FALSE`, status bez zmian.
- [ ] Zły md5sum lub obcy `id`: `400 FALSE`.
- [ ] Nieznany `tr_crc`: `200 TRUE`, log `unknown_crc`.
- [ ] `CHARGEBACK` ustawia `refunded`.
- [ ] `tr_paid` ≠ kwota ustawia `amount_mismatch=1`.
- [ ] Podwójne kliknięcie „Przejdź do płatności” tworzy jedną transakcję w Tpay.
- [ ] Ponowne wejście w link przy transakcji `pending` < 24 h daje ten sam `payment_url`.
- [ ] Strona „dziekujemy” nie zmienia statusu.
- [ ] Cron oznacza opłaconą transakcję, gdy webhook nie dotarł (zamockowany GET).
- [ ] Tenant A nie może oznaczyć linku tenanta B (krzyżowy `webhook_token` / `crc`).

Ręczne end-to-end:

- [ ] Sandbox: pełna ścieżka od utworzenia linku, przez akceptację i płatność, do statusu „Opłacony” w liście w ciągu < 2 min.
- [ ] Panel Tpay → transakcja → „Wyślij ponownie” powiadomienie: brak duplikatu.
- [ ] Produkcja: płatność 1 zł BLIK-iem, status Opłacony, potem zwrot z panelu Tpay i status Zwrócony.
- [ ] Klientka zamyka bramkę bez płatności: status zostaje „W płatności”, po 7 dniach „Wygasł”, w statystykach „Regulamin OK, nie zapłacił”.
- [ ] Stary link w trybie `manual` działa jak dotąd.

## 11. Decyzje do potwierdzenia przez Mariusza (przed etapem 5)

- **D1. Zadatek:** półautomat z przyciskiem „Wpisz zadatek” (rekomendacja) czy pełny automat dla klientek z bazy?
- **D2. Tryb ręczny** (wklejanie linku z panelu Tpay): zostawić jako awaryjny czy usunąć?
- **D3. Testy:** zakładamy konto sandbox Tpay czy testujemy na produkcji transakcjami po 1 zł?

## 12. Uwagi dla Claude Code

- **Nie uruchamiaj interfejsu lokalnie podpiętego do produkcyjnej bazy** (82.198.229.231) i nie uruchamiaj crona Tpay lokalnie przeciwko produkcji.
- Wszystkie szczegóły pól i statusów `GET /transactions/{id}`, limity długości oraz adres API sandboxa **sprawdź w API Reference: https://api.tpay.com**. Nie zgaduj.
- Przewodnik w scence „Zapłaciłam, widać?” pokazuje już status „opłacony”. Po wdrożeniu będzie to prawda. Krok 25 trzeba jednak przepisać:
  - usunąć „wygeneruj link w panelu tpay i wklej”,
  - opisać statusy i „Wpisz zadatek”,
  - zmienić nawyk „po zaksięgowaniu wpłaty wpisz zadatek” na „gdy link ma status Opłacony”.

## Źródła

- Tpay – Notyfikacje: https://docs-api.tpay.com/pl/webhooks/
- Tpay – Pierwsza transakcja: https://docs-api.tpay.com/pl/first-steps/first-transaction/
- Tpay – Autoryzacja: https://docs-api.tpay.com/pl/first-steps/authorization
- Tpay – API Reference: https://api.tpay.com
- Estelio – Przewodnik pracownika, Krok 25: https://www.estelio.com.pl/pomoc/
