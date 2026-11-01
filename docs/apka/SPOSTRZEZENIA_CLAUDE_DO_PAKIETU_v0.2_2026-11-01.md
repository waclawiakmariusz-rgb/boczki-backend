# Spostrzeżenia Claude Code do pakietu Estelio Mobile v0.2

Data: 1.11.2026. Autor: Claude Code (wykonawca). Odbiorca: ChatGPT (recenzent) i właściciel produktu.
Baza pracy: repozytorium boczki-backend, gałąź `dev` = `main` = `aea74ac`, produkcja na tym samym commicie (sprawdzone odczytem 1.11). Drzewo czyste poza czterema plikami poza gitem (raport audytu, test izolacji, dwa robocze zrzuty).

Cel tej notatki: zanim ruszy M00, spisać to, co już wiem z repozytorium i z pracy nad Estelio w ostatnich tygodniach, żeby recenzja i wykonanie nie powtarzały ustaleń ani nie startowały z błędnych założeń. Każda informacja ma oznaczenie poziomu: **kod** (przeczytane w repozytorium), **konfiguracja** (odczytane z produkcji lub środowiska), **test** (uruchomione), **niezweryfikowane**.

---

## 1. Zdarzenie przy odbiorze pakietu: katalog był publicznie serwowany

Pakiet został wgrany do `public/apka/`. Express serwuje `public/` statycznie (`server.js:293`), więc plan produktu, projekt zabezpieczeń z listą historycznych słabości i ZIP odpowiadały pod zwykłym adresem HTTP (potwierdzone na serwerze testowym: HTTP 200). Po commicie i wdrożeniu byłyby dostępne z estelio.com.pl bez logowania.

Zrobione 1.11: całość przeniesiona do `docs/apka/` (nieserwowany), `public/apka` usunięty, adres zwraca 404. Nic nie trafiło na produkcję ani do gita w międzyczasie.

Wniosek do procesu: paczki projektowe, raporty M00 i wszystko, co zawiera opis słabości lub plany, lądują w `docs/`, nigdy w `public/`. Makieta HTML otwiera się z pliku dwuklikiem, nie potrzebuje serwera.

## 2. Co w pakiecie jest trafne i czego nie trzeba zmieniać

- Rozdzielenie poziomów „pomoc / kod / konfiguracja / test” i zasada „opis w pomocy nie dowodzi wdrożenia”. Dokładnie tak pracujemy przy tym repozytorium.
- Manager bez Kreatora dostępów i bez awaryjnej edycji. Zgodne z kodem: role operacyjne i managerskie są rozdzielone w module Terminarza (`routes/terminarz.js:25-27`: ROLE_MANAGER_PLUS = manager/admin/megaadmin, ROLE_OPERACYJNE = recepcja + managerskie, ROLE_SPECJALISTA = kosmetolog/pracownik). Czy ten sam podział obowiązuje w starszych modułach, odpowie M00.
- Jedna kasa, jedne reguły pakietów, brak drugiej logiki finansowej w telefonie. Repo ma inwarianty finansowe spisane w testach (Mix jako splity w tabeli płatności, zadatki liczone po statusie wykorzystania). Aplikacja musi je dziedziczyć, nie liczyć sama.
- Push jako wskazówka do odświeżenia bez danych klientki w treści. Zgodne z tym, jak dziś działa dzwonek Spraw.
- Timeout zapisu = wynik nieustalony, nie „nie zapisano”. Terminarz ma już klucz idempotencji przy zapisie wizyty (`klucz_idem`) i ponowienie zwraca tę samą wizytę. Sprzedaż: do sprawdzenia w M00.
- Matryca SEC01–SEC15 i scenariusze F01–F18 nadają się wprost na scenariusze narzędzia prób (patrz pkt 6).

## 3. Fakty z repozytorium, które pakiet zostawia do M00, a które już znam

Poziom **kod**, chyba że zaznaczono inaczej. Bez sekretów.

| Temat w pakiecie | Co wiem dziś | Źródło |
|---|---|---|
| Model API | Jeden `POST /api` z polem `action` + nowsze routery modułów (`/api/zgody`, `/api/terminarz`, `/api/stripe/...`). Nowe akcje muszą być zarejestrowane w `server.js` w liście akcji modułu, inaczej dispatcher ich nie przepuści. | `server.js`, `routes/terminarz.js` (`module.exports.AKCJE`) |
| Sesja | Hasło salonu → `login` → token; PIN osoby → `verify_pin` → token sesji osoby. Token w nagłówku `x-session-token`, dopisywany przez globalną nadpisaną funkcję `fetch` w `index.html`. Token leży w `localStorage` przeglądarki. Są też wywołania GET z tokenem w adresie (np. moduł kosztów) — to pozycja S2 z audytu, **otwarta** w kodzie. | `public/index.html` ~11892, ~9719; `routes/sessions.js` |
| Tożsamość pracownika | Pracownik = imię w ramach salonu + PIN. **Nie ma stabilnego identyfikatora osoby** w sensie `user_id` z pakietu. Sesja wiąże salon + imię. Rejestracja urządzenia i unieważnianie per osoba będą wymagały nowej, dodanej tabeli; nic istniejącego nie trzeba zmieniać. | `routes/sessions.js:169` (sesje po `login` = imię) |
| Hasła i PIN-y | Hasło salonu w tabeli licencji jest hashem bcrypt (poziom **konfiguracja**: widziany prefiks `$2b$` w rekordzie produkcyjnym). PIN-y klientek Klubu są hashowane bcrypt (`routes/lojalnosc.js:2495, 2635`). PIN-y pracowników: **niezweryfikowane**, do sprawdzenia w M00 (DOK03). | jw. |
| Administrator platformy | Istnieje mechanizm klucza głównego ze zmiennej środowiskowej (`routes/auth.js:49`). To pozycja K1 z audytu. Pakiet słusznie żąda konta imiennego z MFA i audytem; dziś tego nie ma. **Otwarte.** | `routes/auth.js` |
| Dodatki per salon | Tabela funkcji per salon (`Tenant_Features`) + katalog (`Features_Catalog`) ze statusem, w tym `UKRYTY` dla pilotaży. Front sprawdza `hasFeature(klucz)`, serwer ma własne sprawdzenie `makeHasFeature`. Capabilities dla aplikacji można zbudować z tego bez nowej tabeli. | `routes/features.js` |
| Terminarz: wizyta | Trzy osie osobno (status rezerwacji, obecność, stan pozycji), wersjonowanie (`wersja`, odmowa `code: 'WERSJA'`), blokada salonu w transakcji (`GET_LOCK`), klucz idempotencji przy zapisie. Pozycje idą sekwencyjnie, każda z własną wykonawczynią, gabinetem i urządzeniem. Od 30.10: dwa identyczne zabiegi pod rząd bez bufora między nimi. | `routes/terminarz.js` (`trm_zapisz`, `trm_zmien`), `routes/terminarz-silnik.js` |
| Terminarz: hold (DOK07) | **Istnieje i jest na produkcji od 30.10.** Stan `do_wplaty`, kolumna `hold_do`, reguła 24 h / 24 h przed / 2 h, jeden hold na numer telefonu, sprawdzanie numeru w kartotece z potwierdzeniem „inna osoba”, link do zadatku z rezerwacji, akceptacja regulaminu tworzy profil i Sprawę E41, „Zadatek wpłynął” ręcznie, wygaszanie w tykaniu co minutę (Sprawa E40), wpłata po wygaśnięciu bez odzyskania terminu (Sprawa E42), anonimizacja holdu bez profilu po 7 dniach. Testy: `tests/terminarz-szybka-rezerwacja.test.js` + scenariusze A/B na bazie izolowanej. | `routes/terminarz.js`, `routes/zgody.js`, `docs/terminarz-szybka-rezerwacja/` |
| Ewidencja pakietów (DOK05) | **Istnieje** (model v2: Term_Zakupy, składniki, przydziały, realizacje, księga ruchów). Tryby ewidencji, weryfikacja stanu początkowego składnika, uruchomienie z rozstrzygnięciem istniejących wizyt, rezerwacja jednostki przy umówieniu, zwolnienie przy odwołaniu. Zdanie w pomocy „terminarz nie zużywa karnetu” dotyczy stanu sprzed wdrożenia i wymaga korekty w rozdziale „Czego terminarz nie robi”. Pułapka z pokazu 30.10: składnik niezweryfikowany pokazuje 0 wolnych jednostek; w demo trzeba zatwierdzić stan początkowy. | `routes/terminarz-zakupy.js`, `routes/terminarz.js` (`trm_skladnik_*`) |
| Agenda (DOK08) | Widok Agenda pobiera zakres **7 dni** od wybranej daty (`od`, `do = od + 6`). „Ten sam dzień” w pomocy to opis widoku Dzień, nie Agendy. Poprawka dokumentacji, nie kodu. | `public/terminarz.js:291` |
| Sprawy / dzwonek | Tabela `Term_Sprawy` z priorytetem P0/P1/P2, polem `dane.dotyczy` (adresaci), `rezerwacja_id`, kluczem deduplikacji, dziennikiem. Licznik dzwonka liczy otwarte P0/P1. Typy od E02 do E42. Gotowe źródło zdarzeń pod push, bez nowej logiki. | `routes/terminarz.js` (`sprawaUpsert`, `tickSprawy`) |
| Powiadomienia dziś | Cztery osobne mechanizmy, jak słusznie pisze pakiet: e-mail do klientek (moduł maili wizyt, tryb z env), dzwonek Spraw, web-push tylko dla Klubu klienta (`Lojalnosc_Push`, VAPID), SMS wyłącznie ręcznie z telefonu salonu. Push dla pracowników nie istnieje. | `routes/maile-wizyt.js`, `routes/lojalnosc.js` |
| Płatności tpay | Link do płatności generowany ręcznie w panelu tpay i wklejany; nasz serwer wie tylko o akceptacji regulaminu, **nie o wpłacie**. Brak webhooka. Pakiet ma to poprawnie. | `routes/zgody.js` |
| Testy i środowisko | 66 plików testów jest (ostatni pełny przebieg 1066 testów, zielony). Narzędzie prób ekranowych ze scenariuszami JSON (27 scenariuszy, panel lokalny), skrypty zasiewu i sprzątania bazy izolowanej. Baza izolowana: osobna MariaDB na porcie 3307, serwer testowy na 3999, salon syntetyczny `demo-test`. **To środowisko istnieje tylko na jednym laptopie** (poziom konfiguracja). | `tests/`, `narzedzia/` |
| Pliki instrukcji dla agenta | Pakiet każe czytać AGENTS i instrukcje projektu. **W repo nie ma AGENTS.md ani CLAUDE.md.** Zasady pracy są w pamięci Claude i w `docs/`. Wpisuję jako fakt, nie brak do naprawy. | — |

## 4. Korekty i doprecyzowania do pakietu

1. **Stabilny identyfikator osoby.** Pakiet zakłada `user_id`. Dziś go nie ma. Proponuję, żeby M01 od razu przewidział dodaną tabelę pracowników z identyfikatorem i powiązaniem do imienia w salonie, bez zmiany istniejącej logiki PIN-u. Stare sesje działają jak dotąd, aplikacja używa identyfikatora.
2. **Kontrakt API.** Pakiet proponuje REST `/mobile/v1/...`. To może stać obok dispatchera. Trzeba zapisać wprost: istniejące akcje nie zmieniają kształtu, dostają co najwyżej wspólne sprawdzanie uprawnień; warstwa mobilna nie dubluje logiki domenowej, tylko woła te same funkcje. Inaczej recenzent ocenia dwie architektury.
3. **Audyt z 26.10 jako lista kontrolna.** Commit audytu jest w historii, ale od tamtej pory doszło 40+ commitów. Część pozycji ma już częściową odpowiedź w kodzie (role w Terminarzu, bcrypt dla haseł salonu i PIN-ów Klubu), część jest otwarta (klucz główny administratora, token w adresie w module kosztów, token w `localStorage`). M00 oznaczy każdą pozycję z dowodem. Nie zakładać ani „wszystko naprawione”, ani „nic nie naprawione”.
4. **Dwa laptopy.** Praca idzie z dwóch komputerów; środowisko izolowane i pamięć Claude są tylko na jednym. Raporty M00 muszą być w repo (`docs/apka/M00/`), nie w czacie ani w plikach lokalnych, inaczej drugi komputer ich nie zobaczy.
5. **Ruchomy znacznik produkcji.** Produkcja jest na `aea74ac`, ale znacznik „ostatnia dobra” wskazuje wersję z 21.10; przestawienie czeka na dzień pracy recepcji na nowej wersji. Dla M00 to znaczy: „stan produkcji” = commit, nie znacznik.
6. **Tempo.** Właściciel wyraźnie prosi o pracę bez pośpiechu. Każdy etap kończy się raportem i czeka na recenzję. Żadnego łączenia M00 z implementacją, żadnego wdrożenia na main w ramach M00.

## 5. Odpowiedzi wstępne na DOK01–DOK10 (do potwierdzenia dowodem w M00)

| ID | Stan dziś | Poziom |
|---|---|---|
| DOK01 | Kreator dostępów (`add_admin_user`, `delete_admin_user`) to osobne akcje; kto może je wywołać po stronie serwera: do sprawdzenia | kod, częściowo |
| DOK02 | Limity prób PIN: niezweryfikowane | — |
| DOK03 | Hasła salonu bcrypt (konfiguracja), PIN-y Klubu bcrypt (kod), PIN-y pracowników: niezweryfikowane | mieszane |
| DOK04 | Sesje po stronie serwera z możliwością unieważnienia po `login`; czy zmiana PIN-u/roli unieważnia: do sprawdzenia | kod, częściowo |
| DOK05 | Ewidencja istnieje i działa pod warunkiem uruchomienia składników; zdanie w pomocy do korekty | kod + test |
| DOK06 | Nieobecność oznacza pozycje jako niewykonane i zwalnia zasoby; potrącenie jednostki z pakietu to osobna akcja (`trm_pozycja_potrac`); pieniądze w kartotece | kod |
| DOK07 | Hold istnieje, na produkcji od 30.10 | kod + test + konfiguracja |
| DOK08 | Agenda = 7 dni; „ten sam dzień” dotyczy widoku Dzień | kod |
| DOK09 | Soft-delete klientki z 4 wariantami był projektowany (niedokończony design w pamięci); stan w kodzie do sprawdzenia | niezweryfikowane |
| DOK10 | Inwarianty: Mix = splity w Platnosci, zadatki po statusie WYKORZYSTANY; akceptacja linku ≠ wpłata (brak webhooka) | kod + test |

## 6. Propozycja wykonania M00

Dwie części, każda kończy się raportem w `docs/apka/M00/` i ZIP-em dla recenzenta.

| Część | Zawartość | Czas |
|---|---|---|
| M00a | baza pracy, architektura, matryca ról i cykl sesji z dowodami plik:linia, stan każdego punktu audytu, próby SEC01–SEC05 i SEC09 na bazie izolowanej jako scenariusze narzędzia prób, DOK01–DOK10 z dowodami | 1 dzień |
| M00b | mapa funkcji pomoc → UI → akcja → tabela → test dla wszystkich modułów, definicje wskaźników na jednej próbce danych syntetycznych, porównanie wariantów RN/Expo vs Capacitor z nakładem w przedziałach, propozycja M01 | 1 do 2 dni |

Zasady wykonania: tylko odczyt kodu i produkcji; zapisy wyłącznie na bazie izolowanej na salonie syntetycznym; zero sekretów, tokenów, PIN-ów i danych klientek w raportach; każde „działa” z dowodem albo „niezweryfikowane” z nazwą brakującego elementu.

## 7. Decyzje potrzebne od właściciela przed M00a

1. Czy raport audytu bezpieczeństwa z 26.10 (dziś plik lokalny poza gitem) ma wejść do repo w `docs/`, żeby M00 mógł się na niego powoływać linią, a drugi laptop go widział.
2. Czy raporty M00 mogą być commitowane na `dev` na bieżąco (rekomenduję tak; `docs/` nie jest serwowane i nie wpływa na system).
3. Słowo „ruszaj” na M00a.
