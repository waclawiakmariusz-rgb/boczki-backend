# Spostrzeżenia Claude Code do pakietu Estelio Mobile v0.2

Data: 1.11.2026 (wersja rozszerzona, ten sam dzień). Autor: Claude Code (wykonawca). Odbiorcy: ChatGPT (recenzent) i właściciel produktu.

Baza: repozytorium boczki-backend, gałąź `dev` = `bc9894a` (różni się od `main` = `aea74ac` wyłącznie katalogiem `docs/apka`). Produkcja estelio.com.pl działa na `aea74ac` (odczyt 1.11). Poza gitem leżą cztery pliki: raport audytu z 26.10, test izolacji salonów i dwa robocze zrzuty ekranu.

Cel notatki: zanim ruszy M00, spisać to, co już wiem z kodu i z pracy nad Estelio, żeby recenzja i wykonanie nie startowały z błędnych założeń i nie powtarzały ustaleń. To nie jest raport M00. To lista rzeczy, które M00 ma potwierdzić lub obalić dowodem, plus korekty do samego pakietu.

**Poziomy dowodu** użyte poniżej, zgodnie z zasadą pakietu:
- **kod** = przeczytane w repozytorium, podane plik:linia na stan `bc9894a`;
- **konfiguracja** = odczytane z produkcji albo ze środowiska (bez wartości sekretów);
- **test** = uruchomione w tej lub poprzednich sesjach;
- **pamięć** = wiem z wcześniejszej pracy, ale dziś nie sprawdziłem ponownie;
- **niezweryfikowane** = nie wiem; podaję, czego brakuje.

---

## 1. Zdarzenie przy odbiorze pakietu: katalog był publicznie serwowany

Pakiet został wgrany do `public/apka/`. Express serwuje cały katalog `public/` statycznie (`server.js:293`), bez logowania. Plan produktu, projekt zabezpieczeń z listą historycznych słabości, makiety i ZIP odpowiadały pod zwykłym adresem HTTP. Sprawdziłem na serwerze testowym: HTTP 200. Po commicie i wdrożeniu to samo byłoby dostępne z estelio.com.pl.

Zrobione 1.11: całość przeniesiona do `docs/apka/`, `public/apka` usunięty, stary adres zwraca 404. Nic nie trafiło na produkcję ani do gita w międzyczasie.

**Wniosek do procesu:** paczki projektowe, raporty M00, diffy i wszystko, co opisuje słabości lub plany, lądują w `docs/`, nigdy w `public/`. Makieta HTML otwiera się z pliku dwuklikiem, nie potrzebuje serwera. Proszę, żeby kolejne paczki od ChatGPT miały to zdanie w START.md.

Drugie zdarzenie, pośrednio związane: pakiet linkuje raport audytu do biblioteki plików ChatGPT (dokument 07). Ten link działa tylko na koncie właściciela. W repo raport jest plikiem lokalnym poza gitem, więc drugi laptop go nie widzi, a M00 nie może go cytować linią. Decyzja w pkt 11.

## 2. Co w pakiecie jest trafne i czego nie trzeba zmieniać

- **Rozdzielenie poziomów** pomoc / kod / konfiguracja / test i zasada „opis w pomocy nie dowodzi wdrożenia”. Tak pracujemy przy tym repozytorium od miesięcy; przykład z 30.10: pomoc mówiła „terminarz nie zużywa karnetu”, kod od tygodni robił inaczej.
- **Manager bez Kreatora dostępów i bez awaryjnej edycji** jako cel produktowy. Uwaga: kod dziś pozwala managerowi na więcej (pkt 3.4 i DOK01). To decyzja właściciela, nie błąd pakietu.
- **Jedna kasa, jedne reguły pakietów, brak drugiej logiki finansowej w telefonie.** Repo ma inwarianty finansowe zapisane w testach (Mix = osobne wiersze w tabeli płatności, zadatki liczone po statusie wykorzystania). Aplikacja musi je dziedziczyć przez te same funkcje serwera.
- **Push jako wskazówka do odświeżenia, bez danych klientki w treści.** Zgodne z tym, jak działa dzwonek Spraw: licznik, nie treść.
- **Timeout zapisu = wynik nieustalony.** Terminarz ma już klucz idempotencji przy zapisie wizyty i unikalny indeks na nim. Sprzedaż go nie ma (pkt 3.6). To pierwsza rzecz do dodania po stronie serwera pod aplikację.
- **Rozdzielenie rezerwacji, obecności, wykonania i rozliczenia.** Dokładnie tak jest w tabeli rezerwacji: osobne kolumny `status`, `obecnosc`, stan każdej pozycji i `sprzedaz_id`.
- **Matryca SEC01–SEC15 i scenariusze F01–F18** nadają się wprost na testy. Część da się napisać w jeden dzień na obecnym kodzie, bo narzędzia są (pkt 7).
- **Brak zapisów offline w pierwszej wersji.** Słuszne. Obecny serwer nie ma żadnej kolejki operacji, a dokładanie jej to osobny projekt.
- **Administrator platformy zostaje, ale imienny, z MFA i audytem.** Zgodne z pozycją K1 audytu, która jest otwarta (pkt 4).

## 3. Fakty z repozytorium, które pakiet zostawia do M00, a które już znam

### 3.1 Baza pracy, wdrożenia, środowiska

| Fakt | Poziom | Źródło |
|---|---|---|
| Jedno repozytorium Node.js (Express 4, mysql2, bcrypt, express-rate-limit, web-push, stripe), jeden proces `server.js`, frontend statyczny w `public/`. Główny ekran to jeden plik `public/index.html` (ponad 35 000 linii) plus osobne moduły, m.in. `public/terminarz.js`. | kod | `package.json`, `server.js` |
| Wdrożenie = ff-merge `dev` do `main` na słowo właściciela, potem Pull + Restart w panelu Hostingera przez właściciela. Nie ma CI, nie ma automatycznego deployu, nie ma środowiska staging z własną bazą. | pamięć + kod | brak plików CI w repo |
| Host `dev.estelio.com.pl` istnieje (jest na liście CORS), ale **dzieli bazę z produkcją**. Zapisy na nim to zapisy produkcyjne. | kod + pamięć | `server.js:33` |
| Jedyne środowisko z osobną bazą to lokalna MariaDB na porcie 3307 (`estelio_test`) i serwer testowy na porcie 3999, na jednym laptopie. Tam są salony syntetyczne (`demo-test`). | konfiguracja | `.env.test`, `narzedzia/` |
| Hostinger potrafi uruchamiać kilka procesów Node tej samej aplikacji równocześnie. Komentarz w kodzie opisuje incydent z 19.10, gdy sesja założona w jednym procesie była nieznana drugiemu. | kod | `routes/sessions.js:118-124` |
| Datowane tagi punktów powrotu: `ostatnia-dobra-2026-10-16`, `-10-21`, `-10-30`. Ruchomy tag `ostatnia-dobra` wskazuje `c4bc86e` z 21.10 i czeka na dzień pracy recepcji na nowej wersji. | kod | `git tag` |
| W repo nie ma AGENTS.md ani CLAUDE.md. Zasady pracy są w pamięci Claude i w `docs/`. Polecenie M00 każe je „odczytać”; wpisuję jako fakt, nie brak. | kod | — |
| Baza na Hostingerze stoi w UTC i nie ma załadowanych tabel stref czasowych. Od 11.08.2026 każde połączenie z puli dostaje offset polski wyliczony w Node z kalendarza IANA. Wiersze sprzed tej daty zostały w UTC. | kod | `db-strefa.js` (komentarz nagłówkowy) |

Konsekwencje dla pakietu:
- Wymaganie „terminy w UTC plus strefa salonu” trzeba doprecyzować. Dane w bazie są dziś w czasie polskim (nowe) i w UTC (stare), bez kolumny strefy. Warstwa mobilna powinna zwracać ISO 8601 z jawnym przesunięciem, liczonym na serwerze, i nie zakładać UTC w bazie.
- Zanim aplikacja zacznie pisać na jakikolwiek serwer poza laptopem, potrzebny jest staging z osobną bazą. To decyzja hostingowa i kosztowa poza M00; bez niej M02–M03 testuje się wyłącznie lokalnie.
- Wszystko, co trzyma stan w pamięci procesu (ograniczniki prób, cache sesji), działa per proces, nie per serwer. Rejestr urządzeń i tokenów mobilnych musi być w bazie od pierwszego dnia.

### 3.2 Jak wchodzi żądanie

| Fakt | Poziom | Źródło |
|---|---|---|
| Dwa modele obok siebie: dispatcher `POST /api` z polem `action` w treści (listy akcji per moduł wpisane na sztywno) oraz ok. 40 routerów Express montowanych pod `/api` (`/api/terminarz`, `/api/zgody`, `/api/koszty-plan`, `/api/stripe/...` itd.). | kod | `server.js:482-517`, `server.js:733-800` |
| Nowa akcja dispatchera wymaga dopisania do listy w `server.js`, inaczej jest odrzucana. Terminarz eksportuje własną listę (`AKCJE`, 72 akcje `trm_*`). | kod | `server.js:416`, `routes/terminarz.js` |
| Przed routerami stoi wspólne middleware sesji: ścieżki pod `/api` wymagają ważnego tokenu dla `tenant_id` z żądania, poza jawną listą publicznych (strony dla klientek, Klub, blog) i gałęziami z własnym uwierzytelnieniem (admin, billing, Magda). Wyłącznik awaryjny: `ENFORCE_SESSION_ROUTERY=false`. Dispatcher ma osobną kontrolę z wyłącznikiem `ENFORCE_SESSION_POST=false`. | kod | `routes/sesja-middleware.js`, `server.js:14-22`, `server.js:690-708` |
| Ogranicznik zapytań: 300 na minutę na parę adres IP + token sesji (żądania bez sesji dzielą pulę po IP). Wartość z env `API_RATE_LIMIT`. | kod | `server.js:81-100` |
| CORS: lista dozwolonych źródeł (estelio.com.pl, www, dev) plus każdy `http://localhost*` i każda subdomena `*.hostingersite.com`. Pozycja S5 audytu, otwarta. Dla aplikacji natywnej CORS nie ma znaczenia; dla makiet w WebView ma. | kod | `server.js:28-46` |
| Nagłówki bezpieczeństwa są: HSTS, X-Frame-Options SAMEORIGIN, Referrer-Policy, Permissions-Policy, Content-Security-Policy. CSP dopuszcza skrypty inline (pozycja W5). | kod | `routes/naglowki-bezpieczenstwa.js:30-42` |
| Limit treści JSON 1 MB. Załączniki ticketów idą do bazy jako BLOB, dokumenty klientek i zdjęcia Foto na dysk poza repo (`UPLOADS_DIR`). | kod | `server.js:106`, `routes/dokumenty.js:16`, `routes/tickety.js:10` |

### 3.3 Tożsamość i sesje (stan rzeczywisty)

| Fakt | Poziom | Źródło |
|---|---|---|
| Dwa kroki: `login` = login i hasło salonu (tabela Licencje) → token sesji salonu; `verify_pin` = imię pracownika + PIN → nowy token sesji osoby. Oba tokeny to UUID v4. | kod | `routes/auth.js`, `routes/users.js:68-98` |
| Sesja = `{ tenant_id, login, expires }`, gdzie `login` to **imię pracownika** (po `verify_pin`) albo login salonu (po `login`). **Rola nie jest w sesji.** Moduły, które jej potrzebują, pytają bazę po imieniu. | kod | `routes/sessions.js:19`, `routes/users.js:15-22`, `routes/terminarz.js:494-496` |
| Tabela Użytkownicy **ma kolumnę `id` (UUID)** nadawaną przy tworzeniu konta. Nie jest używana w sesji ani w logach; Terminarz dopiero od ZK v2 dopisuje ją jako `autor_id` do operacji jednostkowych. Czyli stabilny identyfikator osoby **istnieje w tabeli**, ale nie jest „tożsamością” w API. | kod | `routes/users.js:147-149`, `routes/terminarz.js:385-387` |
| Sesje trwają 8 godzin od ostatniej aktywności (przesuwane), są w pamięci procesu i w tabeli Sesje (token jawny w bazie, pozycja S8). Przy braku w pamięci jedno doczytanie z bazy. | kod | `routes/sessions.js:17, 86-96, 126-146, 197-214` |
| Unieważnianie: funkcja kasująca wszystkie sesje osoby w salonie istnieje i jest wołana przy zmianie PIN-u, zmianie roli i usunięciu konta (E05, 19.10). Właściciel platformy ma do tego endpoint w panelu admina. | kod | `routes/sessions.js:166-184`, `routes/users.js:141, 173`, `routes/admin.js:106-115` |
| **Nie ma akcji wylogowania po stronie serwera.** Front czyści `localStorage`, token w tabeli żyje do wygaśnięcia. Zmiana hasła salonu nie unieważnia sesji. Pozycja S1: częściowo. | kod | brak `logout` w `routes/auth.js`, `server.js`, `index.html` |
| Token w przeglądarce: `localStorage` pod kluczem `boczki_session_token`, dopisywany do nagłówka `x-session-token` przez nadpisany globalny `fetch`. Kilka modułów (koszty, typy zabiegów, baza wiedzy pomocy, PDF dokumentów) przekazuje go w adresie URL jako `session_token=`. Pozycja S2: otwarta. | kod | `public/index.html:9719-9721, 20407, 35741`, `routes/dokumenty.js:154-156` |
| Limity prób: logowanie salonu 10 prób / 15 min na IP; PIN 10 prób / 5 min na klucz IP + salon + imię. Oba liczniki w pamięci procesu (per proces Node, zerowane restartem). Przy czterocyfrowym PIN-ie to 10 000 kombinacji; z kilku adresów IP limit nie działa. | kod | `routes/sessions.js:226-301` |
| **PIN-y pracowników są przechowywane i porównywane jawnie** (porównanie tekstu z tekstem). Pozycja W1 audytu: **otwarta**. Pomoc managera mówi o bcrypt dla PIN-ów; to zdanie jest nieprawdziwe wobec kodu. | kod | `routes/users.js:78, 135, 149` |
| Hasła salonu: bcrypt z migracją przy logowaniu (jawne hasło po udanym porównaniu jest od razu haszowane). PIN-y klientek Klubu: bcrypt. | kod | `routes/auth.js:59-65`, `routes/lojalnosc.js:2495, 2635` |
| Klucz główny administratora platformy: zmienna środowiskowa porównywana przy logowaniu salonu, otwiera dowolny salon. Pozycja K1: **otwarta** w kodzie. Czy wartość jest ustawiona na produkcji: niezweryfikowane. | kod | `routes/auth.js:49` |

Co z tego wynika dla projektu sesji mobilnych (dokument 03, rozdziały 2–4):
- Pakiet zakłada parę access/refresh i rejestrację urządzenia. Obecny system ma jeden token 8 h. Oba modele mogą współistnieć: warstwa mobilna wydaje własne tokeny i zapisuje je w nowej tabeli, a wywołując istniejące funkcje domenowe podstawia kontekst `tenant_id` + imię, tak jak robi to dziś sesja. Starych tabel nie trzeba ruszać.
- „Stabilny user_id” można oprzeć na istniejącej kolumnie `Użytkownicy.id`. Trzeba jednak wiedzieć, że usunięcie i ponowne dodanie osoby o tym samym imieniu daje nowy UUID, a historia (logi, Term_Historia, Sprzedaz.sprzedawca) jest po imieniu. Scalanie tożsamości to zadanie M01.
- Blokada po zmianie PIN-u działa dziś natychmiast dla sesji WWW, bo każde żądanie sprawdza tabelę sesji. Ten sam mechanizm musi objąć tokeny mobilne: sprawdzenie w bazie przy każdym chronionym żądaniu, nie podpis JWT.

### 3.4 Uprawnienia ról po stronie serwera (pozycja K2)

Stan na `bc9894a`, policzony po modułach. „Jest” znaczy: handler sam pyta bazę o rolę osoby z sesji i odmawia.

| Moduł | Kontrola roli na serwerze | Uwagi |
|---|---|---|
| Użytkownicy (lista kont, dodanie, zmiana PIN-u/roli, usunięcie) | **jest**: wymaga sesji PIN osoby z rolą manager / admin / megaadmin | **Manager ma dziś pełny Kreator dostępów.** Pakiet chce inaczej (DOK01). |
| Terminarz (72 akcje) | **jest**: trzy zbiory ról, osobne odmowy, specjalistka widzi tylko swoje | `routes/terminarz.js:25-27` |
| Zadania, Konsultacje, Preferencje, Dodatki, Klub (strona pracownika) | **jest**, w różnym zakresie | lista plików z kontrolą: `routes/{zadania,konsultacje,preferencje,features,lojalnosc}.js` |
| Sprzedaż (dodanie, edycja, usunięcie, zwrot, **awaryjna edycja**) | **brak** | każdy z ważną sesją salonu, nawet bez PIN-u, może wywołać `emergency_edit_sale` (`routes/sprzedaz.js:1128`) |
| Klienci (pełna lista, edycja, soft-delete, anonimizacja) | **brak** | pełna baza klientek jednym żądaniem bez paginacji (pozycja S4) |
| Analityka / Analiza salonu, BI, pełny audyt | **brak** | front ukrywa zakładkę recepcji; serwer nie sprawdza (`routes/analityka.js` bez odwołań do roli) |
| Magazyn, Raport magazynu, Targety, RODO, Urodziny, Retencja | **brak** | jw. |
| Dokumenty PDF | sesja i salon tak, rola nie; token także z adresu | `routes/dokumenty.js:150-187` |

Wniosek: K2 jest naprawiona w modułach pisanych od października (Terminarz, Zadania, konta), otwarta w modułach starszych (Sprzedaż, Klienci, Analityka, Magazyn). Pakiet ma rację, że „nowe API nie naprawi starych ścieżek”. Dla aplikacji mobilnej znaczy to: każda operacja finansowa w warstwie mobilnej dostaje kontrolę roli od razu, a równolegle osobne zlecenie domyka stare akcje (najpierw tydzień w trybie „loguj”, jak proponuje plan napraw audytu).

### 3.5 Klientki, dokumenty, usuwanie

| Fakt | Poziom | Źródło |
|---|---|---|
| Lista klientek wraca w całości (bez stronicowania, bez wyszukiwania po stronie serwera). Wyszukiwanie po nazwie / telefonie / ID odbywa się w przeglądarce. | kod | `routes/klienci.js` (`get_clients`) |
| Numery telefonów nie są normalizowane w bazie; dopasowanie w szybkiej rezerwacji porównuje ostatnie 9 cyfr. | kod | `routes/terminarz.js` (`klienciPoTelefonie`) |
| Usuwanie ma już cztery osobne akcje: `soft_delete_client` (odwracalne), `anonymize_client` (RODO, nieodwracalne, rozlicza zadatki), `mark_deceased`, `set_warning`/`clear_warning` (flaga, nie usunięcie) oraz `restore_client`. | kod | `routes/klienci.js:986-1159`, lista akcji `server.js:735` |
| Profil z linku do zadatku dostaje znacznik „Regulamin (online przy płatności)”, profil z szybkiej rezerwacji bez linku „BRAK (szybka rezerwacja)”; kartoteka pokazuje odpowiednie plakietki. | kod + test | `routes/klienci.js`, `public/index.html` (renderowanie kafelków) |
| Dokumenty PDF: nazwa pliku walidowana wzorcem, ścieżka sprawdzana względem katalogu, sesja musi pasować do salonu. Brak sprawdzenia, czy dana osoba ma prawo do danego pliku (każdy w salonie widzi każdy PDF). | kod | `routes/dokumenty.js:150-187` |

Dla aplikacji: wyszukiwanie klientek musi dostać nowy endpoint z paginacją i filtrem po stronie serwera (dodatkowa akcja, nic nie zmienia dla WWW). To też dobry moment na dodanie kolumny ze znormalizowanym telefonem (NULL-owalna, uzupełniana w tle), bez ruszania istniejących kolumn.

### 3.6 Sprzedaż i finanse

| Fakt | Poziom | Źródło |
|---|---|---|
| Akcje: `add_sale`, `add_multi_sale` (koszyk wielopozycyjny), `edit_sale`, `delete_sale`, `add_zwrot`, `emergency_edit_sale`, karnety (`extend/close/reopen/suspend`), definicje usług i rabatów. | kod | `server.js:734` |
| Identyfikator sprzedaży = znacznik czasu serwera z dokładnością do 1/10 sekundy, pozycje koszyka z przyrostkiem `-N`. **Brak klucza idempotencji.** Ponowienie tego samego żądania po timeoucie tworzy drugą sprzedaż z innym identyfikatorem. | kod | `routes/sprzedaz.js:474, 571, 620` |
| Mix = osobne wiersze w tabeli Platnosci z identyfikatorem `BASE-SPLIT-n`; agregacje utargu muszą pomijać wiersz zbiorczy. Zadatki liczone po statusie wykorzystania. To inwarianty pilnowane testami. | kod + test | `routes/sprzedaz.js:745-790`, testy finansowe |
| Portfel klientki = zadatki typu WPŁATA; wykorzystanie w sprzedaży jest grupowane po identyfikatorze zadatku, żeby nie rozliczyć go dwa razy. | kod | `routes/sprzedaz.js:573-603` |
| Sprzedawca, wykonawca i „kto zapisał” pochodzą z treści żądania (`d.pracownik`), nie z sesji. Dziennik zdarzeń zapisuje to, co przysłał front. Pozycja S3: otwarta. | kod | `routes/sprzedaz.js:494, 672, 862` |
| Awaryjna edycja zapisuje migawkę „PRZED” do logu i ma jedną blokadę biznesową (rozliczenie przez księgową dla salonu Boczki). Bez kontroli roli. | kod | `routes/sprzedaz.js:1128-1150` |
| Zwrot = ujemny wpis z dzisiejszą datą, powiązany z oryginałem (`zwrot_do_id`) i chroniony przed podwójnym zwrotem. | pamięć | `routes/sprzedaz.js` (`add_zwrot`) |

Dla pakietu (reguły finansowe 1–6, SEC09, F02–F04, F09): zanim powstanie `POST /mobile/v1/sales`, serwer potrzebuje (a) kolumny klucza idempotencji na tabeli sprzedaży, NULL-owalnej, z unikalnym indeksem w parze z `tenant_id`, (b) wywołania tej samej funkcji koszyka co WWW, (c) aktora z sesji zamiast z treści. Punkt (a) to jedyna zmiana schematu, dopuszczalna w naszych zasadach (kolumna dopisana, NULL-owalna). Pozostałe to kod.

### 3.7 Terminarz

| Fakt | Poziom | Źródło |
|---|---|---|
| Tabela rezerwacji: `status` (potwierdzona / odwołana / do_wplaty / wygasla…), `obecnosc` (oczekiwana / przybyl / spozniony / nieobecny), `wersja`, `klucz_idem` z unikalnym indeksem, `hold_do`, `zadatek_id`, `sprzedaz_id`, `rozliczenie_od`. Pozycje w osobnej tabeli ze stanem, wykonawczynią faktyczną, czasem faktycznym i składnikiem zakupu. | kod | `routes/terminarz.js:160-190, 690-697` |
| Zmiana wizyty wymaga numeru wersji; przy rozjeździe serwer odmawia kodem `WERSJA`. Zapis i zmiana idą w transakcji pod blokadą salonu (`GET_LOCK`). | kod + test | `routes/terminarz.js` (`trm_zapisz`, `trm_zmien`) |
| Silnik kompletu: pozycje sekwencyjnie, każda ze swoją osobą, gabinetem i urządzeniem z puli, bufory przed/po; od 30.10 dwa identyczne zabiegi pod rząd nie mają bufora między sobą. Wyjątek „Umów mimo grafiku” tylko dla końca grafiku ręcznie wskazanej osoby; kolizje zasobów to twarda odmowa. | kod + test | `routes/terminarz-silnik.js`, `tests/terminarz-silnik.test.js`, `tests/terminarz-zgloszenie-20.test.js` |
| Rozliczenie: wizyta dostaje `sprzedaz_id`; tabela realizacji jednostek ma unikalny indeks na parę salon + sprzedaż, więc dwukrotne powiązanie tej samej sprzedaży odbija się na bazie. | kod | `routes/terminarz.js:270-284` |
| Historia wizyty z migawką „przed” i „po” w JSON, aktor po imieniu. | kod | `routes/terminarz.js:226-237` |
| Ustawienia salonu: potrącenie za nieobecność `on/off`, potwierdzanie wykonania przez recepcję, limit serii. | kod | `routes/terminarz.js:513, 1121` |
| Sprawy: tabela z typem (E02…E42), priorytetem P0/P1/P2, stanem, właścicielem, terminem działania, wynikiem, kluczem deduplikacji (unikalny per salon), dziennikiem i tabelą odczytów per pracownik. Tykanie co minutę (`tickSprawy`), w nim wygaszanie holdów, co piąte tykanie porządki ewidencji. | kod | `routes/terminarz.js:427-470, 2530-2603` |
| Agenda WWW pobiera zakres 7 dni od wybranej daty. | kod | `public/terminarz.js:291` |
| Wykonawca/wykonawczyni pozycji to imię (tekst), zgodne z kontem w tabeli Użytkownicy po imieniu. | kod | `routes/terminarz.js` |

Dla pakietu (M05, F05–F09, F13): kontrakty dla kompletu, wersji, obecności i rozliczenia już istnieją jako akcje `trm_*`; warstwa mobilna może je wołać 1:1 albo opakować. Nie trzeba projektować nowej semantyki. Trzeba natomiast zdecydować, czy aplikacja mówi do dispatchera (`action: 'trm_...'`) czy do nowych ścieżek REST, które wołają te same funkcje (pkt 5, korekta 2).

### 3.8 Ewidencja pakietów (ZK v2)

| Fakt | Poziom | Źródło |
|---|---|---|
| Tryby ewidencji to **siedem** stanów z jawnym grafem przejść: `nie_uruchomiono → przygotowanie → aktywna → (konczenie | wstrzymana | uzgadnianie) → zakonczona`. Nowe przydziały tylko w `aktywna`; mutacje w `aktywna` i `konczenie`. Pakiet wymienia cztery; trzeba uzupełnić. | kod | `routes/terminarz-zakupy.js:28-39` |
| Zakup → składniki (każdy z własną liczbą jednostek i stanem weryfikacji) → przydziały do pozycji wizyt → realizacje → księga ruchów. Składnik **niezweryfikowany ma 0 wolnych jednostek** aż do zatwierdzenia stanu początkowego i uruchomienia. Pułapka z pokazu 30.10. | kod + test | `routes/terminarz-zakupy.js`, `docs/terminarz-komplet-pakiet/` |
| Operacje jednostkowe zapisują autora z sesji PIN i `autor_id` z tabeli Użytkownicy (pierwsze miejsce w kodzie, gdzie stabilny identyfikator jest używany). | kod | `routes/terminarz.js:385-387` |
| Wyłączenie dodatku nie kasuje historii; ewidencja ma stan „wstrzymana” osobno od wyłączenia modułu. | kod | jw. |

### 3.9 Szybka rezerwacja do wpłaty zadatku (hold)

Na produkcji od 30.10 (`a397284`, potem poprawki do `aea74ac`). Stan `do_wplaty`, reguła 24 h / 24 h przed / 2 h, jeden aktywny hold na numer telefonu, sprawdzenie numeru w kartotece z potwierdzeniem „to inna osoba”, link do zadatku wiązany z rezerwacją, akceptacja regulaminu tworzy profil i Sprawę E41, „Zadatek wpłynął” ręcznie (link lub przelew / gotówka / karta / BLIK), wygaszanie w tykaniu (Sprawa E40), wpłata po wygaśnięciu bez odzyskania terminu (Sprawa E42), anonimizacja holdu bez profilu po 7 dniach. Serwer nie wie o wpłacie w tpay, bo nie ma webhooka; wie o akceptacji regulaminu. Testy: `tests/terminarz-szybka-rezerwacja.test.js` i dwa scenariusze ekranowe na bazie izolowanej. Dokument: `docs/terminarz-szybka-rezerwacja/SPECYFIKACJA.md`. Pakiet opisuje to poprawnie (F10, F11, tabela ryzyk w dokumencie 03). Poziom: kod + test + konfiguracja.

### 3.10 Zadania i telefony

Rodzaje: `TELEFON`, `DO_ZROBIENIA`. Wyniki rozmowy: `UMOWIONA`, `NIE_ODEBRALA`, `NIE_ZAINTERESOWANA`; przełożenia zapisywane w historii zadań jako typ `TERMIN`, wyniki jako `WYNIK`. Statystyki per osoba liczone z tej historii. Wynik „Umówiona” nie tworzy wizyty w terminarzu, zgodnie z F12. Poziom: kod, `routes/zadania.js:13-18, 114-153`.

### 3.11 Dodatki, konfiguracja, capabilities

Tabela katalogu dodatków ze statusem (w tym `UKRYTY` dla pilotaży) i tabela włączeń per salon z flagą `enabled`, ceną i powiązaniem ze Stripe. `verify_pin` zwraca listę aktywnych kluczy, front trzyma ją w pamięci i sprawdza `hasFeature`. Serwer ma własny pomocnik `makeHasFeature`. Capabilities dla `/mobile/v1/me` można zbudować z tej tabeli plus ról, bez nowej tabeli. Poziom: kod, `routes/features.js:58-63, 222-245`, `routes/users.js:83-90`. Nazwy kluczy (terminarz, link do płatności, Klub, Foto, SMS) potwierdzić w katalogu na produkcji w M00.

### 3.12 Powiadomienia dziś

Cztery mechanizmy, jak słusznie pisze pakiet: e-maile do klientek (potwierdzenie i przypomnienie wizyty; globalny wyłącznik `MAILE_WIZYT=off|proba|on`, na produkcji `proba`, czyli bez wysyłki), dzwonek Spraw (licznik), web-push z VAPID wyłącznie dla Klubu klientki (`Lojalnosc_Push`; bez kluczy w env push jest wyłączony), SMS ręcznie z telefonu salonu. **Push dla pracowników nie istnieje.** Naturalne miejsce na hak push to `sprawaUpsert` w Terminarzu (osobny try/catch, żeby błąd push nie przerwał zapisu sprawy) oraz przypisanie zadania. Poziom: kod, `routes/maile-wizyt.js:23-38`, `routes/lojalnosc.js:190-199`.

### 3.13 Administrator platformy

Panel `public/admin.html` z własnym logowaniem (`routes/admin.js`), token w nagłówku `x-admin-token` ze zmiennej `ADMIN_TOKEN`; część tras admina czyta token również z adresu (pozycja W2). Endpoint do unieważnienia sesji salonu lub osoby. Klonowanie salonu demo z Boczków. Klucz główny z pkt 3.3 (K1). Pakiet proponuje konto imienne z MFA i wejście do salonu ograniczone czasem; żadnego z tych elementów w kodzie nie ma. Poziom: kod, `routes/admin.js:74, 106-115`, `server.js:530`.

### 3.14 Testy, narzędzia, środowisko izolowane

- 65 plików testów jest, ostatni pełny przebieg 1.11: 1066 testów, zielony. Testy to głównie strażnicy treści kodu (regex na źródła) i testy jednostkowe silników; testów integracyjnych na żywej bazie jest kilka i wymagają `.env.test`.
- Narzędzie prób ekranowych `narzedzia/proba-ekranu.js`: scenariusze JSON, przygotowanie i sprzątanie bazy izolowanej skryptami, 27 scenariuszy, panel lokalny z „Uruchom wszystkie”, zbiorczy raport. Produkcja tylko w trybie odczytu z jawną flagą.
- Skrypty zasiewu dla salonu syntetycznego `demo-test` (`narzedzia/proby/skrypty/`).
- To środowisko istnieje na jednym laptopie. Drugi laptop ma repo, ale nie ma bazy 3307.

Dla SEC01–SEC05, SEC09 i F-scenariuszy: większość prób autoryzacyjnych da się napisać jako testy jest wołające `POST /api` na serwerze testowym (3999) z dwoma salonami syntetycznymi. Nie trzeba nowych narzędzi. Próby SEC06–SEC08 i SEC11–SEC12 dotyczą aplikacji, której nie ma; w M00 pozostają „niezweryfikowane”. SEC15 (kopie) jest poza repo.

## 4. Status pozycji audytu z 26.10 według kodu na `bc9894a`

Pakiet słusznie żąda statusu per pozycja. Oto stan przed M00, do potwierdzenia dowodami i testami w M00a. Oznaczenia: **naprawiona / częściowo / otwarta / niezweryfikowane**.

| Pozycja | Stan | Dowód / uwaga |
|---|---|---|
| K1 klucz główny bez śladu | **otwarta** w kodzie | `routes/auth.js:49`; czy ustawiony na produkcji: niezweryfikowane |
| K2 brak ról na serwerze | **częściowo** | naprawiona w Terminarzu, kontach, Zadaniach, Konsultacjach, Dodatkach, Klubie; otwarta w Sprzedaży, Klientach, Analityce, Magazynie, RODO, Targetach (pkt 3.4) |
| W1 PIN-y jawne | **otwarta** | `routes/users.js:78, 135, 149` |
| W2 panel admina | **częściowo** | token wymagany (`server.js:530`), nadal pojedynczy sekret, bez drugiego składnika; token w URL: niezweryfikowane dziś |
| W3 sekrety HMAC z łańcuchem awaryjnym | niezweryfikowane dziś | do sprawdzenia w `routes/zgody.js`, `routes/foto.js`, `routes/magda.js` |
| W4 dane dostępowe w repo | niezweryfikowane dziś | wymaga przeszukania historii gita; nie robić tego w raporcie publicznym |
| W5 XSS + CSP inline + token w localStorage | **otwarta** | `routes/naglowki-bezpieczenstwa.js:40`, `public/index.html:9719` |
| S1 brak logoutu na serwerze | **częściowo** | unieważnianie przy zmianie PIN-u/roli/usunięciu jest (E05); akcji wylogowania nie ma; reset hasła salonu nie kasuje sesji |
| S2 token w URL | **otwarta** | `public/index.html:9721, 20407, 35741`, `routes/dokumenty.js:155` |
| S3 aktor z treści żądania | **częściowo** | Terminarz i konta biorą aktora z sesji; Sprzedaż i Klienci z treści (`routes/sprzedaz.js:862`) |
| S4 pełna baza jednym żądaniem | **otwarta** | `get_clients` bez paginacji |
| S5 CORS szeroki | **otwarta** | `server.js:28-46` |
| S6 wyłączniki izolacji w env | **otwarta z założenia** | `ENFORCE_SESSION_ROUTERY`, `ENFORCE_SESSION_POST`; domyślnie włączone, wyłącznik świadomy |
| S7 zależności z podatnościami | niezweryfikowane dziś | `npm audit` do wykonania w M00a |
| S8 tokeny sesji jawne w bazie, długie sesje | **otwarta** | `routes/sessions.js:17` (8 h przesuwane) |
| S9 panel księgowej | niezweryfikowane dziś | `routes/magda.js` |
| N1–N7 | niezweryfikowane dziś | drobne, do przejrzenia w M00a |

Dwa komentarze. Po pierwsze: audyt był robiony na `f6dbd32`; od tego czasu doszło ponad 40 commitów i część pozycji ruszyła (E05, middleware sesji, role w nowych modułach). Po drugie: pakiet słusznie ostrzega, że „test pokazujący działający exploit nie jest pozytywnym odbiorem”. W repozytorium leży poza gitem plik `tests/bezpieczenstwo-izolacja-salonow.test.js` z 17 próbami; część z nich dziś przechodzi dlatego, że atak się udaje. W M00a przerobię je tak, by PASS znaczył „odmowa”, a oczekiwane dziś porażki były oznaczone jako znane otwarte pozycje.

## 5. Korekty i doprecyzowania do pakietu

1. **Stabilny identyfikator osoby.** `Użytkownicy.id` istnieje. Nie trzeba nowej tabeli pracowników; trzeba wynieść ten identyfikator do kontekstu sesji mobilnej i do odpowiedzi `/me`. Rejestr urządzeń wiąże się z tym identyfikatorem. Ryzyko: usunięcie i ponowne dodanie osoby zmienia identyfikator, a historia jest po imieniu.
2. **Kontrakt API.** Proponowany REST `/mobile/v1/...` może stać obok dispatchera. Zapisać wprost: istniejące akcje nie zmieniają kształtu; warstwa mobilna woła te same funkcje domenowe (eksportowane z routerów), nie przepisuje logiki. Alternatywa tańsza o kilka dni: aplikacja mówi do dispatchera istniejącymi akcjami (`trm_*`, `add_multi_sale`…) z nowym nagłówkiem tokenu mobilnego, a REST powstaje tylko tam, gdzie brakuje akcji (wyszukiwanie klientek, `/me`, rejestracja urządzenia, status operacji). Rekomenduję wariant mieszany; decyzja w M01.
3. **Audyt jako lista kontrolna, nie diagnoza.** Zgoda. Pkt 4 daje stan wstępny. Prośba do recenzenta: nie zakładać, że cokolwiek z „pilnych” napraw zostało wykonane poza tym, co wymieniam z plikiem i linią.
4. **Manager i Kreator dostępów (DOK01).** Kod pozwala managerowi zarządzać kontami. Pakiet i pomoc managera mówią, że nie. To decyzja właściciela: albo zmieniamy kod (osobne zlecenie, dotyka WWW), albo zmieniamy pakiet i pomoc. Do czasu decyzji aplikacja mobilna nie dostaje Kreatora dostępów w ogóle, co jest zgodne z pakietem i nic nie psuje.
5. **PIN-y pracowników (DOK03).** Pomoc managera deklaruje bcrypt. Kod porównuje tekst. Pakiet w dokumencie 03 słusznie mówi, że „sam hash krótkiego PIN-u nie rozwiązuje małej liczby kombinacji”; dodaję, że dziś nie ma nawet hasha. Osobne zlecenie naprawcze (W1) z migracją przy logowaniu, niezależne od aplikacji. Pomoc do poprawy.
6. **Czas.** Zamiast „UTC + strefa salonu” napisać: serwer zwraca czas lokalny salonu w ISO 8601 z przesunięciem, liczonym w Node; baza nie jest źródłem strefy; dane historyczne sprzed 11.08.2026 są w UTC bez znacznika. Aplikacja nie przelicza stref sama.
7. **Idempotencja sprzedaży.** Pakiet zakłada klucz idempotencji w `POST /mobile/v1/sales`. Serwer go nie ma dla sprzedaży (ma dla wizyt). To zmiana schematu typu „dopisana NULL-owalna kolumna + unikalny indeks”, jedyna dopuszczalna w naszych zasadach, i musi być w zakresie M02, nie M03.
8. **Tryby ewidencji.** Siedem, nie cztery (pkt 3.8). Dokument 01 do poprawy.
9. **Hold.** Pakiet pisze „stan wdrożenia do sprawdzenia”. Sprawdzony: na produkcji od 30.10, z testami. Można przenieść do kolumny „istnieje”.
10. **Capacitor a decyzja właściciela.** Właściciel odrzucił „opakowanie strony” (WebView z obecnym `index.html`). Capacitor z nowym, osobnym frontendem mobilnym to inna rzecz i porównanie w dokumencie 02 jest uprawnione. Proszę w dokumencie zaznaczyć to rozróżnienie wprost, żeby przy odbiorze nie wyszło, że ktoś proponuje odrzucony wariant.
11. **Staging.** Dokument 03 rozdział 8 mówi „dev/test mają osobne bazy”. Dziś host dev dzieli bazę z produkcją. Osobna baza istnieje tylko na laptopie. Zanim jakikolwiek build mobilny dostanie adres serwera, potrzebny jest staging z własną bazą i własnymi sekretami. To zależność zewnętrzna (hosting, koszt), do wpisania w M00 jako bloker M03+.
12. **Dwa laptopy, pamięć, raporty.** Praca idzie z dwóch komputerów. Pamięć Claude i baza izolowana są na jednym. Raporty M00 muszą być w repo (`docs/apka/M00/`) i commitowane na `dev`, inaczej drugi komputer i ChatGPT ich nie zobaczą. ZIP dla recenzenta dodatkowo, nie zamiast.
13. **Znacznik produkcji.** „Stan produkcji” w raportach = hash commitu, nie tag `ostatnia-dobra` (ten jest o 40+ commitów w tyle, celowo).
14. **Tempo.** Właściciel prosi o pracę bez pośpiechu. Każdy etap kończy się raportem i czeka na recenzję. Żadnego łączenia M00 z implementacją, żadnego wdrożenia na `main` w ramach M00. Z mojej strony dodatkowo: żadnych zmian w istniejących tabelach, tylko dopisane kolumny NULL-owalne i nowe tabele; zapisy tylko na bazie izolowanej; zero sekretów i danych klientek w raportach.
15. **Pomoc jako źródło.** Pakiet traktuje trzy strony pomocy jako bazę funkcjonalną. Pomoc terminarza jest utrzymywana razem z kodem (test struktury, aktualizacje przy każdej zmianie). Pomoc pracownika i managera są starsze i mają zdania sprzeczne z kodem (DOK01, DOK03, DOK05). W M00 dam listę takich zdań z propozycją poprawki.
16. **Makiety.** Nie oceniam UX w tej notatce. Jedna uwaga techniczna: makieta zakłada wyszukiwanie po znormalizowanym telefonie i stabilne ID klientki. ID klientki (`id_klienta`) istnieje i jest stabilne; telefon nie jest znormalizowany (pkt 3.5).

## 6. Odpowiedzi wstępne na DOK01–DOK10

| ID | Stan według kodu na `bc9894a` | Poziom | Co w M00 |
|---|---|---|---|
| DOK01 | Kreator dostępów dostępny dla manager / admin / megaadmin z sesją PIN (`routes/users.js:14`). Pomoc managera mówi „tylko Admin/Megaadmin”. **Rozbieżność kod vs pomoc.** | kod | decyzja właściciela; test po decyzji |
| DOK02 | Logowanie salonu: 10 prób / 15 min / IP. PIN: 10 prób / 5 min / IP+salon+imię. W pamięci procesu. | kod | test na 3999; zapis do pomocy jednej wersji |
| DOK03 | Hasła salonu bcrypt (z migracją). PIN-y Klubu bcrypt. **PIN-y pracowników jawne.** Pomoc managera nieprawdziwa w tym punkcie. | kod + konfiguracja | poprawka pomocy; osobne zlecenie W1 |
| DOK04 | Sesje po stronie serwera, 8 h przesuwane, unieważniane przy zmianie PIN-u / roli / usunięciu konta. Brak akcji wylogowania. Reset hasła salonu nie kasuje sesji. Otwarty formularz: zapis sprawdza sesję, więc stara sesja odpada przy następnym żądaniu. | kod | test: zmiana PIN-u w trakcie otwartego formularza |
| DOK05 | Ewidencja istnieje (7 trybów), rezerwuje i zużywa jednostki, pod warunkiem weryfikacji składników. Zdanie w „Zasadach” pomocy jest sprzed wdrożenia. | kod + test | poprawka rozdziału „Czego terminarz nie robi” |
| DOK06 | Obecność ma 4 stany; nieobecność oznacza pozycje jako niewykonane i zwalnia zasoby; potrącenie jednostki sterowane ustawieniem salonu `potracenie_nieobecnosc`; pieniądze zostają w kartotece. | kod | test z ustawieniem on/off |
| DOK07 | Hold na produkcji od 30.10, z testami i dokumentem. | kod + test + konfiguracja | wpisać jako istniejące |
| DOK08 | Agenda WWW = 7 dni od wybranej daty. „Ten sam dzień” w pomocy dotyczy widoku Dzień. | kod | poprawka podpisu w pomocy |
| DOK09 | Cztery akcje istnieją: odwracalne ukrycie, anonimizacja RODO (nieodwracalna, z rozliczeniem zadatków), zmarła, flaga ostrzeżenia; plus przywrócenie. Okres „do 30 dni” i scalanie duplikatów: niezweryfikowane. | kod | sprawdzić retencję ukrytych i scalanie |
| DOK10 | Mix = splity w Platnosci; zadatki po statusie WYKORZYSTANY; „zaakceptowany link” = akceptacja regulaminu, nie wpłata (brak webhooka). Definicje wskaźników Analizy: do przejrzenia w `routes/analityka.js` na jednej próbce danych syntetycznych. | kod + test | próbka danych + uzgodnienie raportów (M00b) |

## 7. Matryca SEC i scenariusze F: co da się zrobić dziś

| Grupa | Da się dziś, na obecnym kodzie i bazie izolowanej | Wymaga aplikacji lub nowej warstwy |
|---|---|---|
| SEC01 salon A → dane B | tak: dwa salony syntetyczne, `POST /api` z tokenem A i `tenant_id` B | — |
| SEC02 recepcja → Analiza / Kreator / awaryjna edycja | tak; wynik dziś: Kreator odmawia, Analiza i awaryjna edycja **nie odmawiają** (K2) | — |
| SEC03 sesja salonu bez PIN-u | tak; dziś większość danych jest dostępna (K2) | — |
| SEC04 podszycie aktora w treści | tak; dziś Sprzedaż przyjmuje (S3) | — |
| SEC05 stary token po zmianie PIN-u / roli | tak; dziś działa poprawnie (E05) | wylogowanie i reset hasła: brak |
| SEC06–SEC08 refresh, reinstalacja, zmiana osoby na tablecie | — | nowa warstwa sesji mobilnych |
| SEC09 dwa zapisy / timeout / retry | wizyta: tak (klucz idempotencji); sprzedaż: test pokaże podwójny zapis | kolumna klucza dla sprzedaży |
| SEC10 dwa urządzenia, ostatnia jednostka | tak: dwa równoległe `trm_*` pod blokadą salonu | — |
| SEC11–SEC12 tło, logi, deep link, TLS | — | aplikacja |
| SEC13 administrator wchodzi do salonu | częściowo: test, że klucz główny jest sprawdzany; bez MFA | nowy mechanizm |
| SEC14 stara wersja, wyłączony moduł | wyłączony moduł: tak (`hasFeature` na serwerze w Terminarzu); wersja aplikacji: — | nagłówek wersji w nowej warstwie |
| SEC15 odtworzenie kopii | — | hosting, poza repo |
| F01–F04, F12, F13, F17 | tak, na WWW przez próby ekranowe i testy API | — |
| F05–F11, F14, F18 | tak, Terminarz ma akcje i testy; F09 (sprzedaż po timeoucie) pokaże brak idempotencji | — |
| F15 manager nadaje konto | tak; wynik dziś: **serwer pozwala** (DOK01) | decyzja |
| F16 recepcja po managerze na tablecie | tylko WWW: zmiana osoby = nowy `verify_pin`, stara sesja żyje do 8 h | nowa warstwa |

## 8. Wskazówki do kontraktu mobilnego API (do M01, nie do implementacji teraz)

- `/me`: zwrócić `Użytkownicy.id`, imię, rolę z bazy (nie z sesji), `tenant_id`, listę aktywnych dodatków z tabeli włączeń, wersję zasad (hash listy uprawnień), czas serwera z przesunięciem.
- Wyszukiwanie klientek: nowy endpoint z filtrem po stronie serwera (nazwa, ostatnie 9 cyfr telefonu, ID), stronicowanie kursorem, ograniczone pola (bez notatek zdrowotnych na liście). Nowa kolumna znormalizowanego telefonu, NULL-owalna, uzupełniana skryptem w tle.
- Sprzedaż: jedna funkcja koszyka wspólna z WWW; klucz idempotencji = skrót (salon, osoba, treść) przechowywany w nowej kolumnie; status operacji po kluczu.
- Terminarz: 1:1 do akcji `trm_*`; wersja wizyty w każdym żądaniu zmiany; kody odmów (`WERSJA`, `PRACOWNIK_ZAJETY`, `GABINET_ZAJETY`, `URZADZENIE_ZAJETE`, `KLIENT_ZAJETY`, `KOMPETENCJE`, `GRAFIK`) już istnieją i są testowane; aplikacja ma je tłumaczyć, nie wymyślać nowych.
- Kwoty: baza trzyma DECIMAL; API zwraca grosze jako liczbę całkowitą albo tekst dziesiętny. Nie float.
- Aktor: zawsze z sesji mobilnej; pole „sprzedawca rozliczeniowy” i „wykonawczyni” to osobne dane biznesowe, nadal po imieniu (zgodność z WWW), walidowane względem listy pracowników salonu.
- Push: tabela urządzeń pracowników (identyfikator osoby, salon, token FCM/APNs, platforma, data rejestracji, data unieważnienia), hak w `sprawaUpsert` i w przypisaniu zadania, treść generyczna, dane dopiero po otwarciu z ponowną kontrolą sesji.
- Wersja aplikacji w nagłówku każdego żądania; serwer ma listę minimalnych wersji per funkcja i czytelną odmowę.

## 9. Propozycja wykonania M00 (dwie części)

Pakiet przewiduje 7 plików wyjściowych. Dzielę na dwa odbiory, żeby recenzja mogła złapać błędy kierunkowe wcześnie.

| Część | Pliki z pakietu | Zawartość | Czas |
|---|---|---|---|
| **M00a** | `M00_RAPORT.md` (szkic), `M00_ROLE_I_SESJE.md`, `M00_TESTY_I_DOWODY.md` (część 1), `M00_ROZBIEZNOSCI_POMOCY.md` | baza pracy; architektura żądań; matryca endpoint → kontrola roli dla wszystkich akcji dispatchera i routerów (nie tylko próbka); cykl sesji z dowodami; stan każdej pozycji audytu z plikiem i linią; próby SEC01–SEC05, SEC09, SEC10, SEC14 na bazie izolowanej jako testy jest; DOK01–DOK10 z dowodami; `npm audit` | 1 dzień |
| **M00b** | `M00_MAPA_FUNKCJI_API.md`, `M00_WARIANTY_I_NAKLAD.md`, `M01_PROPOZYCJA_ZAKRESU.md`, `M00_RAPORT.md` (final) | mapa pomoc → UI → akcja → tabela → test dla wszystkich modułów; definicje wskaźników Analizy sprawdzone na jednej próbce danych syntetycznych i porównane z WWW; porównanie RN/Expo vs Capacitor z nowym frontendem na podstawie tego repo (co współdzielone: funkcje czyste silnika terminarza, walidacje, formaty; co nowe: cały UI); nakład w przedziałach per obszar; zależności zewnętrzne (staging, konta sklepów, FCM/APNs); propozycja M01 | 1 do 2 dni |

Zasady wykonania: tylko odczyt kodu i produkcji; zapisy wyłącznie na bazie izolowanej na salonach syntetycznych; zero sekretów, tokenów, PIN-ów i danych klientek w raportach; każde „działa” z dowodem albo „niezweryfikowane” z nazwą brakującego elementu; raporty w `docs/apka/M00/`, commity na `dev`, ZIP dla recenzenta na końcu każdej części; żadnej implementacji funkcji aplikacji.

## 10. Ryzyka i zależności poza repozytorium

| Ryzyko / zależność | Dlaczego ważne | Kiedy blokuje |
|---|---|---|
| Brak stagingu z osobną bazą | każdy serwer poza laptopem pisze do produkcji | M02–M03 |
| Konta wydawcy Apple / Google na właściciela, 2FA, odzyskiwanie | bez nich nie ma TestFlight ani zamkniętego toru | M07 |
| FCM / APNs: klucze po stronie serwera, inwentarz danych | push pracowniczy nie istnieje; dostawca push dostaje identyfikatory urządzeń | M02 (projekt), M05 (użycie) |
| Hostinger: kilka procesów Node, brak tabel stref w bazie, limit połączeń do bazy na godzinę | stan w pamięci per proces; liczniki prób; w przeszłości incydent z limitem połączeń (14.10) | od M02 |
| Otwarte pozycje K1, W1, K2 w starych modułach | aplikacja mobilna dziedziczy słabości, jeśli woła stare akcje bez wspólnej kontroli | przed pilotem (M07) |
| Pomoc pracownika i managera rozjechane z kodem | recenzent czyta pomoc jako bazę funkcjonalną | M00b |
| Jeden wykonawca, dwa laptopy, praca po godzinach | tempo i ryzyko pośpiechu; stąd podział M00 na dwa odbiory | cały czas |

## 11. Decyzje potrzebne od właściciela przed M00a

1. Czy raport audytu z 26.10 (dziś plik lokalny poza gitem) ma wejść do repo w `docs/`, żeby M00 mógł się na niego powoływać linią, a drugi laptop i recenzent go widzieli. Repo jest prywatne; `docs/` nie jest serwowane.
2. Czy raporty M00 mogą być commitowane na `dev` na bieżąco (rekomenduję tak).
3. DOK01: czy manager ma mieć Kreator dostępów (stan kodu) czy nie (stan pomocy i pakietu). Można odłożyć do M01, ale M00 musi wiedzieć, co raportować jako „oczekiwane”.
4. Słowo „ruszaj” na M00a.

Nie proszę dziś o decyzję technologiczną (RN/Expo vs Capacitor) ani o zakres R1. To po M00b, zgodnie z pakietem.
