# ZAKUPY_03 — wynik etapu ZK-03: domknięcie ZK02-R1–R6 i przygotowanie praw klientki

**Data:** 16.10.2026 · **Gałąź:** `dev` · **Commit bazowy diffu:** `092dbdd` · **Commit kodu:** `0edfec5` · **Commit raportu:** (patrz §9)
**Załączniki (paczka `docs/terminarz-zakupy/po10/`):** diffy od `092dbdd`, surowe wyniki rzeczywistej bazy (`wynik-terminarz-zakupy.json`, `wynik-terminarz-zakupy-zk03.json`), surowe wyniki prób UI (`zrzuty-zk03.json`), 11 zrzutów PNG. Kontrakt adaptera: `ZAKUPY_03_KONTRAKT_ZRODEL.md`. Errata ZK-02 naniesiona w `ZAKUPY_02_WYNIK.md` §2.

**Status jednym zdaniem:** kod ZK-03 jest na `dev`, odebrany na izolowanej MariaDB 11.8.9 (ta sama wersja co produkcja) i w przeglądarce na fikcyjnym salonie; integracja pozostaje **wyłączona** dla rzeczywistych salonów, schemat v2 **nie istnieje** na bazie wspólnej dev/produkcja, nic nie wdrożono. Jedna jawnie opisana luka równoczesności (Z3-T02b, §7) — do rozstrzygnięcia przed aktywacją.

## 1. Wykonany zakres

| Zadanie | Stan | Gdzie |
|---|---|---|
| ZK02-R1 składnia blokad | poprawione + dowód na bazie | §2 |
| ZK02-R2 kontrola źródła przy każdej operacji + próby zwrotów | poprawione (korekta/odwrócenie, potrącenie, uruchomienie) + dowód na bazie; luka T02b opisana | §2, §7 |
| ZK02-R3 plan powrotu, preflight, rejestr migracji | poprawione (dokumentacja + kod) | §2, §8 |
| ZK02-R4 dostępność techniczna ≠ stan ewidencji | poprawione | §2 |
| ZK02-R5 alias → pole zgodności, listy przydziałów | poprawione | §2 |
| ZK02-R6 autor z sesji, sprawa po rollbacku, handlery zwykłej wizyty | poprawione | §2 |
| Z3-01 klasyfikacja źródeł, rozbita sprzedaż, wersje | wykonane | kontrakt + testy |
| Z3-02 edytor składu wielowierszowy, wersjonowanie | wykonane | UI zakładka „Skład ofert”, `trm_oferta_zapisz` |
| Z3-03 podgląd → jawna rejestracja (idempotentna) | wykonane | „Przygotowanie zakupów”, `trm_zakupy_podglad` / `trm_zakupy_rejestruj` / `trm_zakup_kwalifikuj` |
| Z3-04 stan początkowy per składnik, jawne zero | wykonane | „Sprawdź stan pakietów”, `trm_skladnik_weryfikuj` |
| Z3-05 istniejące wizyty, niedobór, decyzje | wykonane | „Istniejące wizyty”, `trm_skladnik_kandydaci` / `trm_skladnik_uruchom` |
| Z3-06 plan w przygotowaniu, atomowe uruchomienie w aktywnej, aktualność podglądu | wykonane | j.w. + `trm_ewidencja_ustaw` |
| Z3-07 ekrany, komunikaty, sprawy E20–E24, uzgadnianie okresowe | wykonane; T30 bez testu (§4) | „Gotowość ewidencji”, `tickSprawy` |
| Z3-08 odbiór | ten dokument + paczka | — |

Granice zachowane: zmiany tylko w `routes/terminarz*.js`, `public/terminarz.*`, testach, narzędziach; `public/index.html` tylko wersja zasobów (`?v=20261017a`); `server.js` jedna linia (`DB_PORT` honorowany w konfiguracji puli — bez tego lokalna instancja na innym porcie była nieosiągalna). Bez zmian w Sprzedaży, Klientkach, portfelu, punktach, prowizjach, raportach. Wygląd paneli, pigułek, chmurek i centrum spraw — istniejące klasy Terminarza; nowe style tylko `.pz-*`.

## 2. ZK02-R1–R6 — status z dowodem

### R1 — zapytania blokujące działają na MariaDB · **poprawione + dowód na bazie**
- Dosłowne SQL `repoSql`: `… FROM Sprzedaz WHERE tenant_id = ? AND id = ? LOCK IN SHARE MODE` (`routes/terminarz-zakupy.js` ok. 417), `FOR UPDATE` dla `Term_Zakupy`, `Term_Zakupy_Skladniki`, `Term_Przydzialy`, `Term_Realizacje`, `Term_Pozycje`. Testy jednostkowe sprawdzają obecność tej składni, nie nazwy helperów.
- Rzeczywista baza: Z3-T01 PASS (wszystkie zapytania blokujące wykonane w transakcji, bez błędu), Z3-T01b PASS: `FOR SHARE` na tym silniku = `ER_PARSE_ERROR` — poprzednia składnia z ZK-01/ZK-02 była błędna i została usunięta z kodu, testów i dokumentów.
- Silnik: `11.8.9-MariaDB`, tabele InnoDB, izolacja `REPEATABLE-READ` (zapisane w nagłówku `wynik-terminarz-zakupy-zk03.json`).
- `GET_LOCK`: `wTransakcjiSalonu` kontynuuje tylko przy `GET_LOCK(...) = 1` (timeout 8 s → odmowa „salon zajęty”), `RELEASE_LOCK` w `finally`; dodatkowo odmowa, gdy `IS_FREE_LOCK('trm:migracja') = 0`. Wyścig dwóch połączeń o ostatnią jednostkę: K05 PASS na bazie (dokładnie jeden sukces).

### R2 — kontrola źródła przy każdej operacji · **poprawione + dowód**
Mapa „akcja API → funkcja domeny → odczyt źródła → blokada → zapis” (wszystko wewnątrz `wTransakcjiSalonu`: `GET_LOCK('trm:<salon>')` → `BEGIN` → … → `COMMIT`):

| Akcja API | Domena | Ponowny odczyt `Sprzedaz` (LOCK IN SHARE MODE) | Blokady wierszy dodatku | Zapis |
|---|---|---|---|---|
| `trm_zapisz` / `trm_zmien` (pozycje z zakupem) | `rezerwuj` | tak, `sprawdzZrodlaSkladnikow('rezerwacja')` | składniki FOR UPDATE | `R+` |
| `trm_pozycja_stan` wykonana / `trm_obecnosc` | `wykonaj` | tak (`'wykonanie'`) — rezerwacja nie zwalnia z kontroli | pozycja, przydziały, składniki FOR UPDATE | `R−, U+` |
| `trm_anuluj` / nieobecność / niewykonana | `zwolnij` | nie (zwolnienie spójne także przy wycofanym źródle; nie przywraca prawa, bo zwolnienie nie tworzy G) | przydziały FOR UPDATE | `R−` |
| `trm_pozycja_potrac` | `potrac` | tak (`'potrącenie'`) | j.w. | `R−, F+` |
| `trm_wykonanie_koryguj` | `odwrocRealizacje` | tak (`'korekta'`) **przed jakimkolwiek zapisem**, pomijane tylko przy pełnym wycofaniu puli (R22: U→W) | realizacja, przydział, składnik FOR UPDATE | `U−, R+` albo `U−, W+` |
| `trm_pozycja_zrodlo` | `przenies` | tak (`'zmiana źródła'`, nowy składnik) | oba składniki FOR UPDATE | `R−` stary / `R+` nowy, całość albo nic |
| `trm_skladnik_uruchom` | `uruchomSkladnik` | tak (`'uruchomienie'`) | składnik + kandydaci FOR UPDATE | plan albo `R+` × n |
| powtórzenie klucza | `operacja` | po sprawdzeniu dostępu zwraca utrwalony wynik, bez ruchów | — | — |

Reakcja na zmianę: `zwrot`/`istotna`/`usuniete` → `BladDomeny ZRODLO`, rollback całej operacji, a stan `stan_zrodla` + sprawa E20 utrwalane **po** rollbacku (`utrwalPoRollback`, R6). Fakt fizycznego wykonania przy nieprawidłowym źródle nie jest zamieniany na fałszywe U — pozycja zostaje do wyjaśnienia (ekran ZK-05).
Dowody: jednostkowo (`kontrola źródła także przy zmianie źródła, potrąceniu i korekcie`, `Z3-T03`), na bazie K13, Z3-T02a/b/c, Z3-T03a/b (§7).

### R3 — powrót, preflight, rejestr migracji · **poprawione**
- `stanSchematu(qx)` rozróżnia: `brak_v1`, `v1_czysty`, `v1_z_danymi`, `v2_niezgodny`, `v2_czesciowy`, `v2_kompletny`. Dane v1 liczone w `Term_Zakupy`, `Term_Zakupy_Skladniki`, `Term_Zakupy_Ruchy`, `Term_Oferty`, **`Term_Oferty_Skladniki`**, `Term_Pozycje.zakup_skladnik_id` oraz osierocone referencje. Typ każdej oczekiwanej kolumny porównywany z `INFORMATION_SCHEMA` (`oczekiwaneKolumny`); `ER_DUP_FIELDNAME` nie jest już dowodem zgodności.
- Obecność części tabel v2 → `v2_czesciowy`: migracja dokłada brakujące tabele i kolumny (`brakujace_kolumny` → `ALTER TABLE … ADD COLUMN`), nie uznaje częściowego stanu za ukończony i nie wyłącza kontroli danych v1. **Zaobserwowane na rzeczywistej bazie podczas prac** (nie skrypt): pierwszy przebieg przerwany po utworzeniu kilku tabel → ponowny przebieg uzupełnił brakujące kolumny i zakończył się kompletem; Z3-T05 na bazie: przy `v2_kompletny` migracja jest no-op i raportuje dane v1, niczego nie kasując.
- Start serwera (`sprawdzSchematV2`) jest **wyłącznie odczytem**; rejestr `Term_Migracje` zapisuje tylko narzędzie (`migrujV2` w `narzedzia/terminarz-zakupy-migracja.js`). Siedem starych migracji v1 nietknięte.
- Co powstrzymuje zapis w czasie migracji: `migrujV2` trzyma `GET_LOCK('trm:migracja')`, a każda transakcja dodatku zaczyna od `IS_FREE_LOCK('trm:migracja')` i odmawia, gdy migracja trwa. Rdzeń (Sprzedaż) nie jest zatrzymywany — migracja nie dotyka jego tabel. Blokady `trm:<salon>` i `trm:migracja` mają różne klucze i różne role; żadna nie chroni przed zapisami rdzenia (to nie jest wymagane).
- Instrukcja od pustej bazy — §6; plan powrotu — §8; errata w ZAKUPY_02 §2.

### R4 — wyłączenie dodatku przy istniejących danych · **poprawione**
`stanEwidencji(tenant)` zwraca osobno: `techniczna` (licencja + lista `TERMINARZ_ZAKUPY_TENANTS` + schemat), `zapisany` (tryb z `Term_Ewidencja`), tryb **efektywny** (`niedostepna`, gdy brak dostępności technicznej; `uzgadnianie`, gdy zapisano `przerwa_od`), `przerwa_od`. Odmowa z `EWIDENCJA_NIEDOSTEPNA` zapisuje `przerwa_od` (pierwszy ślad przerwy); powrót na listę nie odblokowuje sald — `ustawEwidencje('aktywna')` po przerwie wymaga przejścia przez uzgodnienie. Pozycja z przydziałem jest chroniona po stanie zapisanym przez serwer, nie po polu w żądaniu. Dowody: jednostkowo `R4 (Z3-T07/T08)`; handlery `Z3-T07` (anulacja i wykonanie wizyty z przydziałem odrzucone w całości, bez ROLLBACK w połowie), `Z3-T07b` (wizyta bez przydziału działa). Pełny proces kończenia/wznowienia = ZK-06.

### R5 — alias nie jest źródłem prawdy · **poprawione**
`rezerwacja()` dołącza do każdej pozycji listy `przydzialy[]` i `realizacje[]`; `trm_zakupy_klientki` zwraca składniki zakupu z saldem. Wszystkie decyzje domeny (saldo, transfer, wykonanie, odwrócenie) biorą pełną listę `Term_Przydzialy`; `Term_Pozycje.zakup_skladnik_id` jest utrzymywane tylko dla odczytów starego UI (w kodzie i dokumentach: *pole zgodności*). Z3-T25 (mock + baza): dwie jednostki z dwóch zakupów na jednej pozycji — po wykonaniu i odwróceniu jednej oba powiązania zachowane (zużyty A, zużyty B, nowy B cykl 2).

### R6 — autor z sesji, sprawa po rollbacku, handlery zwykłej wizyty · **poprawione**
`ctxZ` ustala `autor_id` z `Użytkownicy.id` po tożsamości sesji (imię jako migawka etykiety w `kto`); `wykonawca_fakt` jest osobnym polem realizacji. Odmowa z powodu źródła: `wTransakcjiSalonu` po ROLLBACK zapisuje `Term_Zakupy.stan_zrodla` i upsertuje sprawę E20 (`klucz E20:<zakup>` — jeden problem = jedna sprawa, aktualizowana). Dowód: handler `Z3-T04` na atrapie z rollbackiem, K13 i Z3-T03a na bazie. Handlery zwykłej wizyty bez zakupu: testy `zwykłe handlery bez zakupu działają jak dotąd` (nieobecność, wykonanie bez przydziału — zero ruchów v2). Uruchomione zestawy: `terminarz-zakupy`, `terminarz-zakupy-zk03`, `terminarz-silnik` = **86/86** (jeden przebieg po ostatniej zmianie).

## 3. Wyniki K01–K14 (uzupełnienie o rzeczywistą bazę)

Plik: `po10/wynik-terminarz-zakupy.json` (baza `estelio_test`, `11.8.9-MariaDB`, 2026-10-16 18:11 UTC, 17/17 PASS, kod = `0edfec5`; wcześniejszy przebieg 17:09 UTC dał ten sam wynik — powtórzono tylko po poprawce opisu K13b ze słowem `FOR SHARE` na `LOCK IN SHARE MODE`).

| ID | Wynik | Rodzaj dowodu | Uwagi |
|---|---|---|---|
| K01 | PASS | jednostkowy | bez zmian od ZK-02 |
| K02 | PASS | jednostkowy + **rzeczywista baza** (K02, K02b) | B niezweryfikowane odrzucone przez domenę na bazie; rodzic „częściowo” |
| K03 | PASS | jednostkowy + **baza** | wykonaj → cofnij → wykonaj: 2 realizacje w historii |
| K04 | PASS | jednostkowy + **baza** | UNIQUE klucza + skrót na bazie |
| K05 | PASS | **baza, dwa połączenia** | dokładnie jeden sukces o ostatnią jednostkę |
| K06 | PASS | **baza, dwa połączenia** | wykonanie ∥ odwołanie: jeden skutek |
| K07 | PASS | **baza** | awaria przed COMMIT cofa wszystko; ponowienie po COMMIT bez duplikatu |
| K08 | PASS | jednostkowy + **baza** | odrzucone przeniesienie zachowuje stare źródło |
| K09 | PASS | jednostkowy + handler | bez zmian; składnia blokad poprawiona (R1) |
| K10 | PASS | handler (atrapa) | bez zmian |
| K11 | PASS | jednostkowy (mock) + **baza** (K11, K11b) | migracja wykonana i powtarzalna; 51 elementów widocznych |
| K12 | PASS | handler + jednostkowy | bez zmian; `trm_zakupy_klientki` bez mutacji także na bazie (Z3-T18) |
| K13 | PASS | jednostkowy + **baza** | zwrot między podglądem a zapisem wykryty w transakcji; K13b = ograniczenie odroczonego uzgadniania (zmiana **po** COMMIT) |
| K14 | PASS | inspekcja + handler | bez zmian |
| A14 | PASS | **baza** | projekcja `saldo_json` = ruchy dla wszystkich składników salonu (w obu skryptach) |

## 4. Wyniki Z3-T01–T31 (rodzaj dowodu: kod / jednostkowy / handler / rzeczywista baza / UI)

Pliki: `po10/wynik-terminarz-zakupy-zk03.json` (baza: 17 PASS, 0 FAIL, 2 INFO), `po10/zrzuty-zk03.json` (UI przez działający serwer na tej bazie: 12/12 PASS), `tests/terminarz-zakupy-zk03.test.js` (21 testów).

| ID | Wynik | Dowód | Co sprawdzono |
|---|---|---|---|
| Z3-T01 | **PASS** | rzeczywista baza | wszystkie zapytania blokujące w transakcji; `FOR SHARE` = błąd składni |
| Z3-T02 | **CZĘŚCIOWO — luka opisana** | rzeczywista baza, dwa połączenia, kontrolowana pauza 1,5 s między odczytem a COMMIT | (a) `UPDATE` oryginalnej sprzedaży w rdzeniu **czeka** na COMMIT dodatku (1540 ms) — PASS; (b) pierwszy zwrot jako **nowy wiersz** `INSERT` w tym oknie **nie jest blokowany**, rezerwacja ostatniej jednostki zapisała się — INFO/LUKA; (c) zwrot wykryty przy następnym sprawdzeniu, zakup `wycofane` — PASS. Szczegóły i proponowany kontrakt: §7 |
| Z3-T03 | **PASS** (z zastrzeżeniem) | rzeczywista baza + handler + jednostkowy | (a) zwrot zatwierdzony przed wykonaniem, po wcześniejszej rezerwacji → wykonanie odrzucone `ZRODLO`, U bez zmian; (b) zwrot wstawiony podczas wykonania (pauza przed kontrolą źródła) → wykonanie odrzucone, wykryty. Zastrzeżenie: okno między kontrolą a COMMIT jest tym samym oknem co w T02b |
| Z3-T04 | **PASS** | handler (atrapa z rollbackiem) + baza (K13) | wizyta niezapisana; `stan_zrodla` i sprawa E20 utrwalone po rollbacku; podgląd po odświeżeniu pokazuje problem |
| Z3-T05 | **PASS** | rzeczywista baza (no-op przy kompletnym v2, raport danych v1) + obserwacja wznowienia po przerwanym DDL (§2 R3) + mock (zatrzymanie przy `v1_z_danymi`) | kontrolowane przerwanie skryptem **nie było** osobną próbą — wznowienie potwierdzone zdarzeniem z prac, nie testem |
| Z3-T06 | **PASS** | dokument | plan powrotu §8 nie dopuszcza prostego powrotu przy istniejących przydziałach |
| Z3-T07 | **PASS** | handler + jednostkowy | bez pola zakupu w żądaniu ochrona działa po stanie serwera; zwykła wizyta działa |
| Z3-T08 | **PASS** | jednostkowy | ponowne dopuszczenie → tryb `uzgadnianie`, brak nowego G, historia zachowana |
| Z3-T09 | **PASS** | UI + handler na bazie | edytor pokazuje 2 wiersze; zapis bez zmian = ta sama wersja; edycja jednego wiersza nie zmienia drugiego (zapis całej listy, walidacja serwera) — zrzut `zk03-01` |
| Z3-T10 | **PASS** | jednostkowy + baza | 2 egzemplarze → 10 A + 8 B |
| Z3-T11 | **PASS** | jednostkowy + baza + UI | jeden pakiet, dopłata powiązana i pominięta — zrzut `zk03-02` |
| Z3-T12 | **PASS** | jednostkowy + baza | zwrot do dopłaty = zmiana zakupu, bez przeliczenia na sesje |
| Z3-T13 | **PASS** | jednostkowy | produkt, zwrot, dopłata, brak ID, „1x”; „2 przyłożenia” = tylko podpowiedź `pewna:false` |
| Z3-T14 | **PASS** | jednostkowy + baza | 1 jednostka po jawnej kwalifikacji; powtórzenie bez G |
| Z3-T15 | **PASS** | jednostkowy **(tylko mock)** | sprzedaż sprzed wersji → rozstrzygnięcie; nigdy najnowsza |
| Z3-T16 | **PASS** | jednostkowy **(tylko mock)** | dwie wersje tego dnia → rozstrzygnięcie |
| Z3-T17 | **PASS** | baza | ponowny import w innej kolejności: te same zakupy, bez G; restart procesu nie był częścią próby (idempotencja oparta o UNIQUE `sprzedaz_id` i `Term_Operacje` w bazie, nie o pamięć procesu) |
| Z3-T18 | **PASS** | baza + handler | podgląd i lista bez mutacji |
| Z3-T19 | **PASS** | UI + baza (K02) | A sprawdzona, B nie; rodzic „częściowo” — zrzut `zk03-04` |
| Z3-T20 | **PASS** | jednostkowy | puste ≠ 0; `BILANS_NIEMOZLIWY`; ponowny zapis bez ruchów |
| Z3-T21 | **PASS** | baza + UI | 10/3/6 → B=1; po wykonaniu 4/5/1 — zrzut `zk03-07` |
| Z3-T22 | **PASS** | baza + UI | niedobór 2, bez decyzji odmowa, 5 powiązań + 2 jawne — zrzut `zk03-08` |
| Z3-T23 | **PASS** | baza + UI | przeszła nierozstrzygnięta i wizyta poza tygodniem w kandydatach (7 w UI) |
| Z3-T24 | **PASS** | jednostkowy + UI przez serwer na bazie | nowa wizyta po podglądzie → `PODGLAD_NIEAKTUALNY`, brak R, składnik nieuruchomiony — zrzut `zk03-09` |
| Z3-T25 | **PASS** | jednostkowy + baza | dwa źródła na pozycji, oba powiązania po wykonaniu i odwróceniu |
| Z3-T26 | **PASS** | jednostkowy + baza | homonimy: własność po ID; obcy salon nie widzi składnika |
| Z3-T27 | **PASS** | kod + jednostkowy (T20) | rejestracja zawsze `niezweryfikowany`; zero wymaga jawnego wpisu — brak **osobnego** testu dla „dzisiejsza sprzedaż z opóźnieniem” |
| Z3-T28 | **PASS** | baza + jednostkowy + UI (T09b) | ten sam klucz → ten sam wynik, bez drugiego G/R/wersji |
| Z3-T29 | **PASS** | handler (K10, N03/N05) + jednostkowy (Z3-T07b) | rdzeń działa bez v2; operacja jednostkowa odrzucona bez częściowego zapisu |
| Z3-T30 | **NIE WYKONANO** | — | `uzgodnijOkresowo` + `sprawaUpsert` z kluczem `E20:<zakup>` istnieją (kod), ale brak testu cyklu „wielokrotny tick → jedna sprawa → odczyt nie zmienia salda → rozwiązanie” |
| Z3-T31 | **CZĘŚCIOWO** | UI | 400 px: bez poziomego przewijania, 14 przycisków zatwierdzania widocznych, karty — zrzut `zk03-10`; 800×550 — `zk03-11`. **Zoom 200% nie był sprawdzany osobno** |

**NIE WYKONANO / tylko mock (lista dla właściciela):** Z3-T15, Z3-T16 na bazie (klasyfikacja wersji jest czystą logiką — ryzyko niskie); Z3-T30; Z3-T31 przy 200%; kontrolowane przerwanie migracji skryptem (Z3-T05 — zaobserwowane, nieskryptowane); restart procesu w Z3-T17.

## 5. Zrzuty (`po10/`, wyłącznie dane fikcyjne salonu `demo-test`)

| Wymagany | Plik |
|---|---|
| edytor 5A+4B | `zk03-01-edytor-5A-4B.png` |
| częściowa weryfikacja | `zk03-04-czesciowa-weryfikacja-5A-4B.png` |
| stan 10/3/6/1 | `zk03-07-stan-10-3-6-1.png` |
| niedobór 5/7 | `zk03-08-niedobor-5-7.png` |
| podgląd źródeł z dopłatą | `zk03-02-podglad-zrodel-doplata.png` (+ `zk03-03-rejestracja-wynik.png`) |
| nieaktualny podgląd | `zk03-09-nieaktualny-podglad.png` |
| wąski układ | `zk03-10-stan-400px.png`, `zk03-11-wizyty-800x550.png` |
| dodatkowo | `zk03-05-istniejace-wizyty-D-plan.png` (plan w przygotowaniu), `zk03-06-gotowosc-przygotowanie.png` |

## 6. Środowisko i instrukcja od pustej bazy

**Faktyczny stan:** izolowana, lokalna instancja **MariaDB 11.8.9** (archiwum portable, bez instalacji i usługi; katalog danych poza repozytorium; `127.0.0.1:3307`; `lower_case_table_names=1` jak w Windows; `innodb_buffer_pool_size=64M`, `max_connections=40`, bez TLS → `DB_SSL=off`). Różnice wobec hPanel: brak TLS, inne hasła/użytkownik, mniejsza pula; wersja silnika, InnoDB i izolacja identyczne z produkcją. hPanel-owa baza testowa **nie została** założona. Wspólna baza dev/produkcja: zero zapisów, zero migracji, jeden odczyt `INFORMATION_SCHEMA` przy ewentualnym starcie serwera.

**Od pustej bazy do testów (wszystko czyta `.env.test`; brak pliku = odmowa, nigdy fallback na `.env`):**

```
# 1. .env.test (szablon .env.test.example): DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME innej bazy niż w .env,
#    DB_SSL=off dla lokalnej instancji, PORT=3999, ENFORCE_SESSION=true, TERMINARZ_ZAKUPY_TENANTS=demo-test
node narzedzia/testy-integracyjne/schemat-bazowy.js          # 2. schema.sql + tabele spoza schema.sql (DDL z po9) + kolumny modułów + tabele Term_* v1
node narzedzia/terminarz-zakupy-migracja.js --dry-run        # 3a. preflight: oczekiwany typ v1_czysty
node narzedzia/terminarz-zakupy-migracja.js                  # 3b. schemat v2 (51 elementów, wersja 2026-10-17) pod GET_LOCK('trm:migracja')
node narzedzia/testy-integracyjne/terminarz-zakupy.js        # 4. K02–K13 na bazie → wynik-terminarz-zakupy.json
node narzedzia/testy-integracyjne/terminarz-zakupy-zk03.js   # 5. Z3-T01…T26 na bazie → wynik-terminarz-zakupy-zk03.json (sprząta po sobie; --zostaw zostawia dane)
node narzedzia/testy-integracyjne/dane-demo.js --haslo-do <plik poza repo>   # 6. fikcyjny salon demo-test (zestawy A–E, homonimy, portfel, kosmetyk)
node -r dotenv/config server.js dotenv_config_path=.env.test # 7. serwer na 3999 → UI: Ustawienia → Pakiety i zakupy
npx jest tests/terminarz-zakupy.test.js tests/terminarz-zakupy-zk03.test.js tests/terminarz-silnik.test.js   # mocki, bez bazy
```

Skrypt zrzutów (`zrzuty-zk03.js`, Chrome headless przez CDP) jest poza repozytorium (scratchpad sesji) — jego surowy wynik `zrzuty-zk03.json` jest w paczce; odtworzenie ekranów ręcznie: §5 kolejnością zakładek.

## 7. Luka Z3-T02b — opis i proponowany kontrakt

**Co się dzieje:** dodatek w transakcji czyta wiersz kanoniczny `Sprzedaz` z `LOCK IN SHARE MODE` i sumę zwrotów (`SELECT … WHERE zwrot_do_id IN (…)`). Edycja oryginału w rdzeniu (`UPDATE`) czeka na COMMIT — działa. **Nowy wiersz zwrotu** (`INSERT` z `zwrot_do_id = <kanon>`) nie koliduje z blokadą współdzieloną oryginału; zapytanie agregujące po `zwrot_do_id` nie zakłada blokady zakresu (REPEATABLE-READ, brak indeksu po `zwrot_do_id`, brak `FOR UPDATE` na agregacie). Rezerwacja ostatniej jednostki kończy się COMMIT-em z jednostką, której źródło właśnie zwrócono. Zmiana jest wykrywana przy następnej operacji na tym zakupie oraz w uzgadnianiu okresowym (co 5 min) → zakup `wycofane`, sprawa E20, dalsze operacje odrzucane.

**Czego nie zrobiono celowo:** nie dodano blokad zakresu/`SELECT … FOR UPDATE` na `Sprzedaz` ani nie zmieniono rdzenia Sprzedaży (zwrot w rdzeniu nie pobiera `GET_LOCK` salonu). Szeroka blokada obciążyłaby codzienną sprzedaż.

**Proponowany minimalny kontrakt (do decyzji właściciela, przed aktywacją):**
1. Akceptacja okna jako ograniczenia odroczonego uzgadniania **pod warunkiem** udokumentowanego czasu wykrycia (≤ 5 min tick + natychmiast przy następnej operacji) i sprawy E20 z jedną akcją „wyjaśnij” — stan obecny.
2. Albo: po COMMIT rezerwacji dodatek wykonuje jedno dodatkowe, nietransakcyjne sprawdzenie źródła (ponowna suma zwrotów); różnica → natychmiastowe oznaczenie zakupu i sprawa (bez cofania wizyty). Koszt: jeden `SELECT` na rezerwację; zamyka okno do milisekund, nie do zera.
3. Albo: w rdzeniu, przy zapisie zwrotu, `GET_LOCK('trm:<salon>', 2)` tylko gdy salon ma aktywną ewidencję — jedyna droga zamknięcia okna w 100 %; wymaga zmiany `routes/sprzedaz.js` (poza granicą tej iteracji).

Do rozstrzygnięcia tej kwestii integracja **nie jest** deklarowana jako gotowa do aktywacji.

## 8. Poprawiony plan powrotu

1. **Przed pierwszą migracją v2** (stan dzisiejszy na bazie wspólnej): powrót = `git checkout` poprzedniego commitu; schemat bez zmian.
2. **Po migracji, bez żadnego zakupu/oferty/przydziału v2** — warunek do **udowodnienia**, nie założenia: `SELECT COUNT(*)` = 0 w `Term_Zakupy`, `Term_Oferty_Wersje`, `Term_Przydzialy`, `Term_Realizacje`, `Term_Zakupy_Ruchy2`, `Term_Operacje`, `Term_Ewidencja` (narzędzie `--dry-run` raportuje dziś tylko dane v1; liczniki v2 sprawdza się tym zapytaniem ręcznie). Wtedy powrót kodu dopuszczalny; tabele v2 zostają puste, nic nie jest kasowane.
3. **Po pojawieniu się jakichkolwiek danych v2** (oferty, wersje, zakupy, stany początkowe, plany, przydziały — **nie tylko realizacje**): powrót do kodu nieznającego v2 **niedozwolony**. Zamiast tego: `trm_ewidencja_ustaw` → `wstrzymana` (nowe przydziały i wykonania z pakietu zablokowane, kalendarz działa, historia i przydziały zostają), ewentualnie usunięcie salonu z listy technicznej (tryb efektywny `niedostepna`, `przerwa_od` zapisane, pozycje z przydziałem chronione). Przywrócenie = powrót na listę + uzgodnienie (`uzgadnianie` → `aktywna`).
4. Nigdy: `DROP`/`TRUNCATE` tabel v2, ręczne czyszczenie `Term_Przydzialy`, uruchomienie kodu sprzed ZK-02 przy istniejących przydziałach.

## 9. Stan git i publikacja (każda pozycja osobno)

| Pytanie | Odpowiedź |
|---|---|
| Commit bazowy diffu | `092dbdd` (ikona Zgłoszeń SVG) |
| Commit kodu | `0edfec5` na `dev` — produkt + testy + narzędzia; diffy: `po10/diff-produkt-092dbdd..0edfec5.patch`, `po10/diff-testy-i-narzedzia-092dbdd..0edfec5.patch`, lista plików `po10/diff-stat-092dbdd..0edfec5.txt` |
| Commit raportu | następny commit na `dev` (ten plik, kontrakt, errata ZK-02, paczka `po10/`) — hash w `git log` po publikacji |
| Push | `dev` → `origin/dev` po commicie raportu (bez automatycznego wdrożenia) |
| Wdrożenie | **NIE** — ani dev.estelio.com.pl, ani produkcja |
| Migracja v2 | **tylko lokalna izolowana MariaDB**; baza wspólna dev/produkcja: brak schematu v2 |
| Aktywacja | **NIE** — `TERMINARZ_ZAKUPY_TENANTS` niezmienione na żadnym rzeczywistym środowisku; ewidencja żadnego salonu nie została uruchomiona |

## 10. Potwierdzenia i co zostaje

- Lista plików zmienionych/nowych: patrz `po10/diff-stat-092dbdd..0edfec5.txt` (14 plików; nowe: `tests/terminarz-zakupy-zk03.test.js`, `narzedzia/testy-integracyjne/{schemat-bazowy,dane-demo,terminarz-zakupy-zk03}.js`).
- Bez sekretów w repozytorium i raporcie: hasła lokalnej instancji i salonu demo są w plikach poza repo (`.env.test`, pliki `--haslo-do`).
- Rdzeń bez zmian; pełny zestaw testów Estelio nie był uruchamiany (zgodnie z R6 — tylko zestawy dotknięte).
- Pozostaje w kolejnych etapach: ZK-04 kreator umawiania z pakietu/serie, ZK-05 ekran „fakt wykonania vs rozliczenie do wyjaśnienia”, ZK-06 kończenie/wznowienie ewidencji; decyzja w sprawie §7; po stronie właściciela: baza testowa w hPanel (opcjonalnie), 4 próby ręczne na dev, deploy, zmiana PIN-ów.
