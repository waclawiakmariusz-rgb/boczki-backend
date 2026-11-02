# Tpay: automatyczne linki i potwierdzenie płatności — analiza i ocena planu

Data: 2.11.2026. Autor: Claude Code. Dotyczy: `docs/tpay/PLAN_TPAY_LINKI_PLATNOSCI.md` (plan z ChatGPT). Stan kodu: `main` = `7dd952f`.
Warunek właściciela: **dane dostępowe Tpay nie mogą iść przez zmienne środowiskowe**, bo z dodatku będzie korzystać więcej salonów niż Boczki.

To jest ocena przed decyzją. Nic w kodzie nie zostało zmienione.

---

## 1. Krok 0: co już istnieje (z kodu, nie z pomocy)

1. Dodatek `platnosc_link` jest w katalogu dodatków ze statusem **UKRYTY** (pilot u Boczków); włączony tylko dla `boczki-salon-glowny-001` i `demo-test` (`routes/zgody.js:134-142`).
2. Cała logika jest w `routes/zgody.js` (480 linii): tabela `ZgodyPlatnosci` (link) i `TenantRegulaminy` (regulamin salonu: treść albo URL).
3. Pracownik wkleja link z panelu Tpay; serwer go normalizuje (`normalizujTpayLink`) i sprawdza, że to domena `tpay.com` (`tpayLinkOk`), inaczej byłoby otwarte przekierowanie.
4. Klientka dostaje adres `/platnosc.html?t=<token>`. Token jest **podpisanym HMAC payloadem** (tenant + id linku + czas), ważny 7 dni, bez sesji. Sekret HMAC to `ZGODA_SECRET` z łańcuchem awaryjnym aż do hasła bazy (pozycja W3 z audytu, otwarta).
5. Publiczne trasy: `GET /api/zgoda/info` (dane do strony, link Tpay ujawniony dopiero po akceptacji), `POST /api/zgoda/akceptuj` (zapis kto, kiedy, IP, user agent, hash regulaminu; limit prób). Po akceptacji strona robi `location.href` na link Tpay.
6. Statusy linku: `OCZEKUJACA` → `ZAAKCEPTOWANA` | `ANULOWANA`; „wygasły” jest wyliczany z wieku (7 dni), nie zapisany.
7. Panel pracownika (`public/index.html`): modal „Link do płatności” (kafelek Pulpitu i przycisk w profilu klientki), lista linków z wyszukiwarką i stronicowaniem, zakładka w profilu, Administracja → Płatności online (tpay) z regulaminem i statystykami miesięcznymi (utworzone / zaakceptowane / anulowane / wygasłe / oczekujące). Funkcje `zg_*` (22 sztuki).
8. Most z Terminarzem (30.10): link może być związany z rezerwacją (`rezerwacja_id`); akceptacja regulaminu zakłada profil klientki i tworzy Sprawę E41; **„Zadatek wpłynął” klika pracownik ręcznie**, metoda w `Zadatki` zapisywana jako `tpay` (w zwykłej wpłacie zadatku jako `TPay`; niespójność wielkości liter).
9. Raw body przed `express.json` jest już zrobione dla webhooka Stripe (`server.js:103`); wzorzec blokady jednej instancji `GET_LOCK` istnieje w Terminarzu.
10. W repo nie ma żadnego szyfrowania danych w bazie (brak `createCipheriv`); wszystkie sekrety są dziś w env. To trzeba zbudować od zera.

## 2. Ocena planu: co jest trafne

- Źródłem prawdy o płatności ma być **webhook**, powrót klientki na stronę sukcesu nie potwierdza niczego. Zgadza się z dokumentacją Tpay i z naszą zasadą „nic po cichu”.
- **Transakcja tworzona leniwie**, dopiero po akceptacji regulaminu. Dobre: regulamin zawsze przed płatnością, transakcja świeża, a stary łańcuch „wklej link” zostaje jako tryb awaryjny.
- **Adres powiadomień per transakcja** (`callbacks.notification.url`) z losowym `webhook_token` salonu w adresie. Potwierdzone w dokumentacji: Tpay dopuszcza to po zaznaczeniu „Zezwól na nadpisanie” w panelu.
- **Weryfikacja JWS + md5sum + idempotencja + log webhooków.** Dokładnie tak, jak opisuje Tpay (nagłówek `X-JWS-Signature`, certyfikat z `x5u` zaczynającego się od `https://secure.tpay.com`, root `https://secure.tpay.com/x509/tpay-jws-root.pem`, odpowiedź `HTTP 200` z treścią `TRUE`, zatrzymanie ponowień tylko po `404`).
- **Zadatek jako półautomat** (status OPŁACONY + przycisk „Wpisz zadatek” z wypełnionymi danymi). Zgodne z inwariantami finansowymi: pieniądze wpisuje człowiek, system nie księguje sam do portfela.
- **Cron zapasowy** tylko dla zawieszonych transakcji, pod blokadą jednej instancji. Lekcja z Booksy IMAP zapamiętana poprawnie.
- Kwoty w groszach wewnętrznie. Zgodne z tym, co robimy w Stripe.

## 3. Co w planie trzeba zmienić albo doprecyzować po lekturze kodu

| # | Punkt planu | Stan faktyczny / rekomendacja |
|---|---|---|
| 1 | Nowa publiczna ścieżka `/p/:publicId` | Niepotrzebna. Mamy `/platnosc.html?t=<token HMAC>`, token nie jest zgadywalny i niesie tenant. Rozszerzamy `/api/zgoda/info` i dodajemy `POST /api/zgoda/zaplac` (utworzenie transakcji). Jedna strona, jeden token, mniej do utrzymania. |
| 2 | Pola `opened_at`, `payment_started_at`, `paid_at`… na tabeli linków | Tak, jako **dopisane kolumny NULL** w `ZgodyPlatnosci`. Statusy zostawiamy, „OPŁACONY” wyliczany z `paid_at` (plan to przewiduje). |
| 3 | `tenant_tpay_config` z `client_secret_enc` i kluczem `TPAY_CONFIG_KEY` w env | **Zgodne z warunkiem właściciela**: dane salonu są w bazie, w jego wierszu. W env jest wyłącznie klucz szyfrujący Estelio (nie dane żadnego salonu). Bez tego klucza baza pokazuje szyfrogramy. Wymóg: **brak łańcucha awaryjnego** (żadnego „albo DB_PASSWORD”), start aplikacji z włączonym Tpay bez klucza = dodatek wyłączony i komunikat w logu. Rotacja klucza: kolumna `key_version` od pierwszego dnia. |
| 4 | Token OAuth ma zakres `read` (dokumentacja autoryzacji) | Tworzenie transakcji wymaga klucza z uprawnieniem zapisu. Przy generowaniu klucza w panelu Tpay trzeba wybrać właściwy zakres. „Sprawdź połączenie” w Estelio ma to wykryć: pobrać token i **spróbować utworzyć transakcję na 1 gr w sandboxie** albo odczytać komunikat o braku uprawnień. Sam token OAuth niczego nie dowodzi. |
| 5 | Sandbox: adres API „prawdopodobnie openapi.sandbox.tpay.com” | Nie potwierdzone w dokumentacji publicznej (strona sandboxa zwraca 404). Trzeba sprawdzić po założeniu konta sandbox. Do tego czasu adres bazowy jako ustawienie w konfiguracji salonu (pole `api_base`, domyślnie produkcja), nie na sztywno. |
| 6 | Statusy `GET /transactions/{id}` | Dokumentacja publiczna wymienia tylko `pending` i `correct`. Cron ma traktować jako opłacone wyłącznie `correct`, każdy inny status logować bez zmiany stanu. Mapowanie uzupełnić po pierwszych prawdziwych odpowiedziach. |
| 7 | `tr_paid` ≠ kwota linku → `amount_mismatch` | Tak, plus osobna reguła: jeśli `tr_paid` < kwota, status „OPŁACONY CZĘŚCIOWO” (pomarańczowy), nie zielony. Tpay nie blokuje nadpłat i niedopłat przy płatności z panelu. |
| 8 | Webhook `404` dla nieznanego `webhook_token` | Zgodne z dokumentacją (404 zatrzymuje ponowienia). Ale uwaga: **każdy błąd 5xx po naszej stronie** powoduje ponowienia przez 24 h, więc handler ma zawsze kończyć 200/400/404, nigdy wyjątkiem. |
| 9 | Most z Terminarzem (hold) | Plan o nim nie wie. Link do zadatku z szybkiej rezerwacji jest tym samym mechanizmem (`rezerwacja_id`). Po webhooku „opłacone” można **automatycznie** wykonać to, co dziś robi przycisk „Zadatek wpłynął” (zmiana `do_wplaty` → `potwierdzona`, wpis zadatku metodą tpay). To jest jedyne miejsce, gdzie automat ma sens, bo kwota i cel są znane z góry. Decyzja D4 poniżej. |
| 10 | RBAC: konfiguracja tylko Admin/Megaadmin | Wzorzec jest w `routes/users.js` (`wymagajZarzadzania`: rola z bazy po loginie z sesji). Użyć go, nie menu. |
| 11 | Zmiany w `public/index.html` | Modal, lista i zakładka to ok. 700 linii w 35-tysięcznym pliku. Nowy kod frontu wydzielić do `public/platnosc-link.js/.css` (jak Terminarz, Zadania), w `index.html` tylko znacznik. Edycje w `index.html` wyłącznie punktowe. |
| 12 | Migracje „w stylu migrate.js z --dry-run” | Takiego narzędzia w repo nie ma. Migracje robimy jak wszędzie: `CREATE TABLE IF NOT EXISTS` + idempotentne `ALTER … ADD COLUMN` przy starcie modułu. Tylko dopisane tabele i kolumny NULL. |
| 13 | Testy na dev.estelio.com.pl | **Host dev dzieli bazę z produkcją.** Webhook testowy trafiłby w produkcyjne dane. Patrz pkt 6 (strategia testów). |
| 14 | Dziennik zdarzeń: „TPAY · Link opłacony…” | Tak, przez istniejące `zapiszLog`. Dodatkowo Sprawa w Terminarzu, gdy link ma `rezerwacja_id` (typ E43 „Zadatek opłacony online”). |
| 15 | Statystyki | Rozszerzenie istniejącego zapytania miesięcznego o opłacone, kwotę, konwersję i „regulamin OK, nie zapłacił”. Proste. |
| 16 | Metoda zadatku | Ujednolicić na jedną wartość (`TPay`), bo dziś hold zapisuje `tpay`, a formularz wpłaty `TPay`. Raporty grupują po tekście. |

## 4. Ryzyka, o których plan nie mówi

1. **Hostinger uruchamia kilka procesów Node.** Cache tokenu OAuth w pamięci jest per proces (nieszkodliwe), ale cron musi mieć `GET_LOCK`, a licznik prób dla `/zaplac` powinien być w bazie albo tolerować niedokładność.
2. **Brak przekierowań na trasie webhooka.** Sprawdzone 2.11: `https://estelio.com.pl/api/...` i `https://www.estelio.com.pl/api/...` odpowiadają 200 bez przekierowania; `http://` daje 301 na https. Adres powiadomień zawsze z `https://` i z tą domeną, którą ustawimy w konfiguracji (nie z nagłówka `Host` żądania).
3. **Klucz szyfrujący w env na Hostingerze.** Env „znikało” już dwa razy (UPLOADS_DIR). Jeśli zniknie `TPAY_CONFIG_KEY`, sekrety salonów są nieczytelne, ale nie stracone. Moduł ma to wykryć przy starcie i wyłączyć tworzenie transakcji z jasnym komunikatem w Administracji, zamiast sypać błędami przy kasie.
4. **Webhooki przychodzą na produkcję, nie na laptop.** Testy end-to-end bez prawdziwego publicznego adresu są niemożliwe. Patrz pkt 6.
5. **`test_mode=1` z konta produkcyjnego.** Tpay potrafi wysłać powiadomienie testowe z panelu; plan słusznie każe nie oznaczać wtedy „opłacone”. Dodać: log + Sprawa „Testowe powiadomienie Tpay”, żeby ktoś, kto klika „Wyślij ponownie” w panelu, widział skutek.
6. **Zwroty.** Tpay wysyła `chargeback` tylko przy zwrocie pełnej kwoty z panelu. Zwrot częściowy może nie dać powiadomienia (do potwierdzenia na koncie sandbox). Dlatego zwroty zostają decyzją człowieka: status informacyjny + pozycja „Do sprawdzenia”, bez ruszania zadatku.
7. **RODO / umowa powierzenia.** Estelio przekaże do Tpay imię, nazwisko i e-mail płatnika w imieniu salonu. To nowy przepływ danych do opisania w dokumentacji ochrony danych (`legal_security_description`). Nie blokuje budowy, blokuje udostępnienie innym salonom.
8. **Udostępnienie innym salonom.** Dodatek jest dziś UKRYTY i bezpłatny. Zmiana statusu na AKTYWNY i cena to decyzja biznesowa, ale techniczne „per salon” ma być gotowe od pierwszego dnia (to jest sens warunku właściciela).

## 5. Architektura w skrócie (jak to położyć na istniejącym kodzie)

- `routes/tpay-klient.js` (nowy): token OAuth per salon (cache w pamięci z datą ważności), `utworzTransakcje`, `pobierzTransakcje`, timeouty 10 s, jedno ponowienie przy 5xx. Zero sekretów w logach.
- `routes/tpay-konfiguracja.js` (nowy): tabela `Tenant_Tpay` (client_id, `client_secret_enc`, `security_code_enc`, merchant_id, sandbox, api_base, webhook_token, key_version), szyfrowanie AES-256-GCM, trasy admina (zapis, maskowany odczyt, „Sprawdź połączenie”).
- `routes/tpay-webhook.js` (nowy): `POST /api/webhooks/tpay/:token` z `express.raw` **zamontowanym przed `express.json`** (jak Stripe), JWS, md5, idempotencja pod `GET_LOCK` salonu, `Tpay_Webhook_Log`, wspólna funkcja `oznaczOplacone()` używana też przez cron.
- `routes/zgody.js` (rozszerzenie): `POST /zgoda/zaplac` (tworzy transakcję i zwraca `transactionPaymentUrl`; ponowne wejście przy transakcji `pending` < 24 h zwraca ten sam adres), kolumny czasów na `ZgodyPlatnosci`, tabela `Tpay_Transakcje` (1 link : N transakcji), statystyki.
- `public/platnosc.html`: po akceptacji wołanie `/zgoda/zaplac` zamiast gotowego linku; strony „dziękujemy” i „błąd” jako stany tej samej strony (`?t=…&wynik=ok|blad`), bez zmiany statusu.
- `public/platnosc-link.js/.css` (nowe): formularz bez pola „wklej link”, lista z plakietkami i osią czasu, „Wpisz zadatek”, filtr „Opłacone bez zadatku”; `index.html` tylko znacznik i wywołanie.
- Terminarz: hak `router.holdOplacony(tenant, rezId, dane)` wołany z `oznaczOplacone()` (jeśli D4 = tak).
- Wyłącznik awaryjny: `TPAY_API=off` w env wyłącza tworzenie transakcji (zostaje tryb ręczny), webhook nadal przyjmuje i loguje.

## 6. Strategia testów (najtrudniejsza część)

Problem: webhook musi trafić na publiczny adres HTTPS, a jedyna baza izolowana jest na laptopie. Host dev dzieli bazę z produkcją, więc odpada.

Opcje:
- **A. Tunel do laptopa** (np. Cloudflare Tunnel albo ngrok) wystawiający serwer testowy 3999 pod publicznym https. Webhooki z sandboxa Tpay trafiają w bazę izolowaną. Pełne testy end-to-end bez dotykania produkcji. Wymaga zgody właściciela na uruchomienie tunelu na czas testów i konta sandbox (D3).
- **B. Bez tunelu**: testy jednostkowe webhooka na nagranych ładunkach (podpis JWS można zweryfikować offline, md5 też), a pierwsza prawdziwa transakcja od razu na produkcji z kontem Boczków za 1 zł. Tańsze, ale pierwszy błąd wychodzi na żywo.
- Rekomendacja: **A dla etapów 3–4, potem 1 zł na produkcji** jako odbiór końcowy. Konto sandbox Tpay jest bezpłatne.

Testy automatyczne z planu (pkt 10) są dobre i wszystkie da się napisać w jest na mockach bazy, jak `tests/magazyn.test.js`. Dodać: szyfrowanie/odszyfrowanie i brak klucza; izolacja salonów (webhook salonu A nie dotyka linku salonu B); `test_mode`.

## 7. Nakład (szacunek, dni robocze po mojej stronie)

| Etap | Zakres | Dni |
|---|---|---|
| 1 | Tabele + szyfrowanie + konfiguracja w Administracji + „Sprawdź połączenie” | 1 |
| 2 | Klient API + `/zgoda/zaplac` + zmiany w `platnosc.html` | 1 |
| 3 | Webhook (JWS, md5, idempotencja, log) + wspólne `oznaczOplacone` + cron | 1,5 |
| 4 | Front: formularz, lista, oś czasu, profil, „Wpisz zadatek”, „Do sprawdzenia”, statystyki | 1,5 |
| 5 | Most z holdem (D4), Sprawy, Dziennik | 0,5 |
| 6 | Testy jednostkowe + próby ekranowe na bazie izolowanej + tunel/sandbox | 1 |
| 7 | Pomoc (Krok 25, słowniczek, FAQ), Esti, wpis bloga | 0,5 |
| | Razem | ok. 7 dni, partiami z odbiorem po każdej |

Każda partia: dev → testy → zrzuty z bazy izolowanej → słowo → main → Pull+Restart. Produkcja dostaje nowe tabele przy pierwszym starcie (migracje idempotentne), ale dodatek dla salonu działa po nowemu dopiero po wpisaniu konfiguracji Tpay. Do tego czasu stary tryb ręczny działa bez zmian.

## 8. Decyzje do podjęcia przed startem

- **D1 (z planu)** Zadatek po opłaceniu: półautomat z przyciskiem „Wpisz zadatek” (rekomenduję) czy automat dla klientek z bazy?
- **D2 (z planu)** Tryb ręczny (wklejanie linku z panelu): zostawić pod „Więcej” jako awaryjny (rekomenduję) czy usunąć?
- **D3 (z planu)** Testy: konto sandbox Tpay + tunel do laptopa (rekomenduję) czy od razu 1 zł na produkcji?
- **D4 (nowa)** Hold z Terminarza: po webhooku „opłacone” automatycznie potwierdzać wizytę i wpisywać zadatek (jak przycisk „Zadatek wpłynął”)? Rekomenduję tak, bo kwota i cel są znane, a ręczny krok dziś i tak tylko przepisuje te same dane.
- **D5 (nowa)** Klucz szyfrujący `TPAY_CONFIG_KEY`: w env Hostingera (jedyne miejsce poza bazą, jakie mamy) czy w pliku poza repo na serwerze? Rekomenduję env + sprawdzenie przy starcie + zapis instrukcji odzyskania w `project_domain`.
- **D6 (nowa)** Zakres pierwszego wdrożenia: tylko Boczki (dodatek UKRYTY) czy od razu przygotować ekran konfiguracji tak, żeby inny salon mógł sam wpisać dane? Technicznie to samo, różnica w statusie katalogu i cenie.
- **D7 (nowa)** Pierwsza partia: proponuję etap 1 + 2 (konfiguracja i tworzenie transakcji), bo bez nich nic dalej nie ma sensu, a są bezpieczne: nie zmieniają zachowania salonów bez konfiguracji.

## 9. Czego nie zrobię bez osobnej zgody

- Nie uruchomię żadnego crona ani webhooka przeciwko produkcji z laptopa.
- Nie założę konta Tpay ani tunelu bez słowa.
- Nie zmienię statusu dodatku w katalogu (UKRYTY → AKTYWNY) ani ceny.
- Nie ruszę istniejących kolumn ani tabel; tylko dopisane.
