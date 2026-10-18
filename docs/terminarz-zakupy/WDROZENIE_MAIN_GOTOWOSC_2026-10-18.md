# Wdrożenie Terminarza 2.0 na main — raport gotowości (GO / NO-GO)

**Data:** 18.10.2026 (niedziela, salon zamknięty) · **Podstawa:** `Estelio_Plan_Bezpiecznego_Wdrozenia_Main_Claude_Code_2026-10-17.md` (W01–W07, §7) · **Paczka dowodów:** `docs/terminarz-zakupy/po11/`
**Werdykt:** **GO** dla kandydata opisanego w §1, w konfiguracji produkcyjnej z §1.3, z ograniczeniami z §9. Nic nie zostało scalone ani wdrożone — okno otwiera właściciel.

## 1. Zamrożony zakres

| Co | Wartość |
|---|---|
| `main` lokalny = `origin/main` = produkcja | `b3d774adafaa2fec228d3c500d00421bcac73cbd` (tag `ostatnia-dobra-2026-10-16`) |
| Kod produktu kandydata | identyczny z `0718cb3` (to, co dev.estelio.com.pl serwuje od 16.10 20:20) |
| Kandydat do scalenia (SHA) | **commit tego raportu** na `dev` (ostatni; różni się od `0718cb3` WYŁĄCZNIE plikami `tests/`, `narzedzia/`, `docs/`) — pełny SHA w §10 |
| Fast-forward | możliwy (`main` jest przodkiem kandydata), drzewo czyste, 30 commitów |
| Diff produktu `main..kandydat` | 12 plików, +3299/−360: `routes/terminarz.js`, `routes/terminarz-zakupy.js` (nowy), `routes/terminarz-silnik.js`, `public/terminarz.js`, `public/terminarz.css`, `public/index.html` (16 linii: wersje zasobów, ikony menu SVG, UI E05), `public/estelio_pomoc_terminarz.html`, `routes/users.js` (81, E05), `routes/sessions.js` (22, E05), `routes/admin.js` (12, E05), `routes/dokumenty.js` (3 linie, `new Uint8Array`), `server.js` (1 linia, `DB_PORT`) — patch: `po11/diff-produkt-main..kandydat.patch`, lista: `po11/diff-pliki-main..kandydat.txt` |

### 1.1. Wersje faktycznie uruchomione (odczyt strony `/zaloguj`, gdzie serwer wpisuje datę startu i hash)

| Host | Działa | Od |
|---|---|---|
| estelio.com.pl (produkcja) | `b3d774a` | 16.10.2026 05:36 |
| dev.estelio.com.pl (wspólna baza!) | `0718cb3` = kod produktu kandydata | 16.10.2026 20:20 |
| laptop właściciela, `node server.js` PID 82936 | kod z 13.10 (proces od 13.10 15:48), `.env` → **też wspólna baza** | — |

Trzy procesy na wspólnej bazie uruchamiają te same zadania okresowe (sprawy, lojalność, przypomnienia). To stan sprzed wydania; zadania były projektowane jako odporne na powtórzenie. Zalecenie bez obowiązku: zatrzymać lokalny proces z 13.10, bo pracuje na kodzie sprzed trzech wydań.

### 1.2. Push a wdrożenie
Push na `main` nie uruchamia niczego: wszystkie dotychczasowe wdrożenia to ręczne `git pull` + restart na Hostingerze, nie ma znanych hooków ani CI. Push traktujemy mimo to jako część okna (po nim produkcja i repozytorium różnią się do restartu).

### 1.3. Konfiguracja produkcyjna, na którą wydano GO
`TERMINARZ_ZAKUPY_TENANTS` **nieustawione/puste**, brak schematu v2 na wspólnej bazie (potwierdzone odczytem 18.10: zero tabel v2, `Term_Zakupy`=0, `Term_Oferty`=0, żaden salon z `kontrola_zakupow=on`), `DB_PORT` nieustawione (kod: `Number(DB_PORT) || 3306`). Żadne ustawienie testowe nie jest w repozytorium (`.env.test`, `.env.bezv2.local` ignorowane).

## 2. W02 — wiarygodne testy

- Przyczyna 111 porażek: commit `a72fc9d` rozszerzył w `tests/helpers/mockDb.js` pomijanie DDL z `ALTER TABLE` na `(ALTER|CREATE) TABLE`; pięć zestawów (klienci, konsultacje, lojalnosc, reset-hasla, tickety — 269 odwołań) przygotowywało odpowiedzi na `CREATE TABLE` wykonywane przy `require`, więc kolejka odpowiedzi się przesunęła. Produkt nie był dotknięty (potwierdzone wczoraj próbą „kod z dev + pomocnik z main = 266/266”).
- Naprawa (commit `b6e1c19`): domyślny kontrakt `mockDb` przywrócony (pomijany tylko `ALTER`), nowa jawna fabryka `mockDbBezDDL` dla `tests/magazyn.test.js`, nowy `tests/mockdb-kontrakt.test.js` (6 testów wykrywających przesunięcie kolejki). Bez `.skip`, bez osłabiania asercji.
- Pełna bateria na kandydacie `dbdacde` (kod produktu = `0718cb3`): **23 zestawy, 530 / 530 PASS**, atrapy, zero połączeń z bazą (9 s). Uwaga uczciwa: przebieg wykonano dwa razy pod rząd przez błąd w moim poleceniu; oba identyczne. Wczorajsza bateria miała 524 testy; +6 to test kontraktu pomocnika.

## 3. W03 — próby zapisujące tylko w izolacji

Lokalna MariaDB 11.8.9 (wersja produkcji), `127.0.0.1:3307`, dwie bazy: `estelio_test` (schemat v1 + v2, dane fikcyjne `demo-test`, `zk02-test`) i `estelio_test_bezv2` (schemat v1 bez v2). Narzędzia `schemat-bazowy.js`, `dane-demo.js`, `terminarz-zakupy-migracja.js` i oba skrypty prób odmawiają pracy na bazie z `.env` i na adresach innych niż localhost. Reset hasła bez SMTP (`SMTP_USER` pusty) kończy się jawnym błędem wysyłki — żadna wiadomość nie wyszła. Na dev.estelio.com.pl (wspólna baza) nie wykonano dziś żadnego zapisu; na wspólnej bazie wykonano wyłącznie odczyty (3 połączenia).

## 4. W04 — zwykłe ścieżki recepcji na kandydacie (`po11/wynik-kandydat-sciezki.json`, **26 PASS / 0 FAIL / 1 INFO**)

Przez rzeczywiste handlery HTTP lokalnego serwera kandydata (port 3999, `estelio_test`, lista zakupów PUSTA jak na produkcji), z prawdziwymi sesjami: hasło salonu → `verify_pin` Ola (manager) / Anna (pracownik).

| Obszar | Wynik | Dowód |
|---|---|---|
| Logowanie | PASS | sesja salonu, PIN managera, PIN pracownika; zły PIN odrzucony; operacja bez sesji → `SESJA` |
| Klientki | PASS | lista (8 fikcyjnych), kontrolowana zmiana telefonu zapisana i odczytana z normalizacją prefiksu, przywrócona |
| Sprzedaż | PASS + INFO | zwykła sprzedaż kartą zapisana przez pracownika; historia klientki odczytana. INFO: wpłata do portfela przez `manage_deposit` wymaga pola `operacja`, którego nie odgadłem — kod portfela/sprzedaży jest **identyczny** z main, więc nie dochodziłem |
| Konsultacje, lojalność | PASS | odczyty z właściwą sesją; lojalność bez dodatku → komunikat, nie 500 |
| Reset hasła | PASS | brak SMTP → jawny błąd (nic nie wyszło); link prawidłowy/błędny/zużyty rozpoznane; hasło ustawione na to samo; logowanie działa |
| Zgłoszenia | PASS | dodanie z sesją pracownika + lista; mail do admina bez SMTP = tylko wpis w logu |
| Dokumenty | PASS | **mały JPEG (697 B, bufor z puli Node) → PDF** — dokładnie przypadek z poprawki; duży JPEG + PNG → PDF 2 strony (regresja PNG) |
| Kalendarz bez zakupów | PASS | nowa wizyta, konflikt (ta sama osoba/termin) odrzucony, przesunięcie podgląd→potwierdzenie i stan po odczycie z serwera, podgląd skutków blokady bez zapisu, odwołanie, sprawa E05 w centrum spraw |
| Istniejący frontend | INFO | brak service workera/PWA; po wdrożeniu `index.html` wskazuje `?v=20261017a`, więc odświeżenie karty pobiera nowe zasoby; otwarta stara karta z nowym backendem nie testowana na żywo — jedyna różnica kontraktu to brak PIN-ów w liście użytkowników (stary ekran pokaże puste pole do czasu odświeżenia) |

## 5. W05 — E05 i sesje (`po11/wynik-kandydat-sciezki.json` W05-01…06, `po11/wynik-kandydat-sesje-dwa-procesy.json`)

| Próba | Wynik |
|---|---|
| Lista użytkowników dla managera | PASS — pola `imie, rola, pin_ustawiony` (flaga), żadnego PIN-u ani hasła |
| Sama sesja salonu / zwykły pracownik → lista użytkowników | PASS — odmowa `UPRAWNIENIA` po stronie serwera |
| Lista do ekranu PIN | PASS — `imie, rola`, bez PIN-ów |
| Sesja salonu A wskazuje salon B | PASS — `SESJA`, bez danych |
| Zmiana PIN-u konta testowego | PASS — stara sesja odrzucona, stary PIN nie działa, nowy działa; przywrócono |
| Dwa procesy na tej samej bazie (B uruchomiony przez skrypt po utworzeniu sesji na A) | INFO: B honoruje tokeny wczytane z tabeli `Sesje` przy swoim starcie; token utworzony na A po starcie B jest na B odrzucany (każdy proces ufa własnej pamięci, tabela czytana tylko przy starcie); unieważnienie na A działa na A i w tabeli, **B honoruje wcześniej wczytany token do swojego restartu lub wygaśnięcia** |

Skutek dla produkcji: tokeny nie są przenośne między hostami, więc „druga karta na dev” nie korzysta z sesji produkcji. Jedyna stara sesja, którą drugi host mógłby honorować po unieważnieniu, to wczytana przy jego starcie. Ponieważ właściciel **nie zmienia PIN-ów** (decyzja z 17.10, ostateczna), scenariusz nie występuje w tym wydaniu; przy restarcie produkcji w oknie pamięć sesji produkcji jest i tak odbudowywana z tabeli.

Stan sprzed wydania, niezmieniony i poza zakresem (zapisany, nie naprawiany): odczyty `GET /api?action=get_*` nie wymagają tokenu sesji ani na kandydacie, ani na main (W07-5). Kontrola sesji obejmuje POST (`ENFORCE_SESSION_POST`). Pozycja z audytu onboardingu 2026-10-09.

## 6. W06 — uśpione zakupy nie dotykają niczego (`po11/wynik-kandydat-zakupy-uspione.json`, **15 PASS / 0 FAIL**)

| Konfiguracja (serwer kandydata, izolowana baza) | Wynik |
|---|---|
| **A** brak schematu v2 + pusta lista | start bez DDL v2 (0 tabel v2 przed i po); `trm_init` ok, integracja `off`, schemat v2 zgłoszony `v1_czysty`; zwykła wizyta zapis→przesunięcie→odwołanie→odczyt; odczyt zakupów = pusto bez importu; podgląd i rezerwacja z zakupu odrzucone (`INTEGRACJA`) |
| **B** schemat v2 jest + pusta lista (= produkcja po wdrożeniu) | integracja `off` mimo zapisanego trybu „aktywna” (stan nie maskowany, nic nie działa); zwykła wizyta ok; istniejące zakupy v2 nie są serwowane ani uzgadniane (`INTEGRACJA` dla podglądu/uzgodnienia/stanu); liczniki tabel v2 bez zmian |
| **C** salon na liście, ewidencja nie uruchomiona | integracja `on`, ewidencja `nie_uruchomiono`; zwykła wizyta ok; rezerwacja z zakupu i uruchomienie składnika → `EWIDENCJA`; zero zapisów do v2 |
| **D** bez dodatku Terminarz | `trm_init` → `feature_on:false`; podgląd/rejestracja/zapis wizyty → `DODATEK` także bezpośrednim żądaniem; rdzeń odpowiada |
| Restart | serwer B zatrzymany i uruchomiony ponownie: liczniki v2 = baseline, `Term_Migracje` odświeżone tylko 7 wpisów v1 (rejestr sprzed wydania), 0 wpisów `v2:` — start jest odczytem |
| Zadanie okresowe | trzy serwery (w tym C z salonem na liście) ≥ 20 min: liczniki v2 bez zmian, 0 nowych spraw E20–E24, brak błędów SQL w logach (poza brakiem tabeli `Zamowienia` w bazie izolowanej — moduł Stripe, produkcja ma tę tabelę) |
| Wspólna baza (odczyt) | zero tabel v2, `Term_Zakupy`=0, `Term_Oferty`=0, 0 pozycji z zakupem, żaden salon z kontrolą zakupów; kod sięga do tabel v2 wyłącznie za strażnikiem `schematV2.gotowy` (odczyt kalendarza, ustawienia, zadanie okresowe) |

Dodatkowo dev.estelio.com.pl pracuje na tym kodzie na wspólnej bazie bez v2 od 16.10 20:20 bez zgłoszeń.

## 7. W07 — kopia i wariant awaryjny

- **Kopia bazy:** wykonana przez właściciela w hPanel 17.10 wieczorem, po zamknięciu salonu; niedziela bez pracy → aktualna na okno. Pliki dokumentów (`UPLOADS_DIR`) nie są dotykane przez to wydanie.
- **Próba wersji awaryjnej** (`po11/wynik-wersja-awaryjna.json`): kod z tagu `b3d774a` uruchomiony z osobnego katalogu roboczego (`git worktree`, bez przełączania gałęzi w katalogu serwera) na bazie `estelio_test` **po zapisach kandydata**: start OK, `trm_init` OK, odczyt wizyty zapisanej i odwołanej przez kandydata (status `anulowana`), zapis nowej wizyty przez stary kod, lista klientek. Schemat jest zgodny w obie strony: wszystkie kolumny dokładane przez kandydata są NULL-owalne lub z DEFAULT, nowe tabele są przez stary kod ignorowane. Uwaga techniczna: kod z tagu nie zna `DB_PORT`, więc próbę wykonano przez lokalny mostek TCP 3306→3307; na produkcji port jest domyślny, więc ten problem nie występuje.
- **Co przywrócenie starego kodu oznacza:** powrót ujawniania PIN-ów (W07-6: stary kod oddaje pole `pin`). Właściciel świadomie nie zmienia PIN-ów, więc powrót = stan dzisiejszy, bez nowej ekspozycji. Baza i dane zostają.

**Plan awaryjny (dwa poziomy, bez `reset --hard` i bez force-push) — jedna kartka: `WROC_DO_OSTATNIEJ_DOBREJ.md`.** Wdrożenie i powrót idą przez panel Hostingera (Git → Pull from remote, Node.js → Restart application, Cache → Purge), bez konsoli na serwerze, więc powrót musi być zwykłym krokiem naprzód na `main`:
1. **Problem w kalendarzu** → Administracja → Dodatki → wyłączyć Terminarz dla salonu. Zweryfikowane (W06-D): endpointy terminarza odmawiają, rdzeń działa, E05 zostaje. Bez pull, bez restartu.
2. **Problem w rdzeniu** (logowanie, klientki, sprzedaż, dokumenty) → gałąź **`wroc-ostatnia-dobra-2026-10-16`** (commit `4f9ab25`, przygotowana PRZED wdrożeniem: odwrócenie `b3d774a..7df0c8f`, drzewo identyczne co do bajta z produkcją — `git diff b3d774a 4f9ab25` = pusto; kandydat jest jej przodkiem, więc po scaleniu `main → 4f9ab25` to fast-forward). `git checkout main && git merge --ff-only wroc-ostatnia-dobra-2026-10-16 && git push origin main` → Pull → Restart → Purge. Zweryfikowane lokalnie, że kod sprzed wydania czyta i zapisuje dane powstałe po kandydacie. Bazy z kopii **nie przywracamy** bez analizy — od kopii mogą powstać prawidłowe zapisy. Uwaga: lokalny bezpiecznik `pre-push` zatrzymuje pushe kasujące linie w `public/index.html`; powrót kasuje je świadomie, więc ten jeden push wymaga `--no-verify` (decyzja właściciela, §9).
3. Ścieżka do przodu dla E05 (gdyby problem był w logowaniu): naprawa w kodzie, bo cofnięcie otwiera ujawnianie PIN-ów (PIN-y bez zmian → stan dzisiejszy).

## 8. Bramka GO / NO-GO (§7 planu)

| Warunek | Wynik | Dowód |
|---|---|---|
| Zamrożony zakres | PASS | §1: SHA main/kandydat, diff oceniony, kolejne commity tylko tests/narzedzia/docs |
| Wiarygodne testy | PASS | §2: helper naprawiony z testem kontraktu; 530/530 na `dbdacde` |
| Próby funkcjonalne | PASS | §4–5: 26/26 + E05 6/6 przez rzeczywiste handlery w izolacji; 1 INFO (portfel, kod niezmieniony) |
| Zakupy wyłączone | PASS | §6: 15/15 w czterech konfiguracjach + restart + 20 min zadań okresowych + odczyt wspólnej bazy; brak planu aktywacji i migracji v2 |
| Konfiguracja | PASS | §1.3: lista pusta, `DB_PORT` domyślny, testowe pliki poza repo, SMTP/Stripe nietknięte |
| Dev ze wspólną bazą | PASS | §1.1/§5: znana rola i wersja; dziś tylko odczyty; nie był miejscem zapisujących prób |
| Kopia | PASS | §7: kopia hPanel 17.10 po zamknięciu salonu; odtworzenie tylko do osobnego miejsca (nie ćwiczone — hPanel po stronie właściciela) |
| Powrót | PASS | §7: dwa poziomy; wersja awaryjna przećwiczona na danych po kandydacie; zgodność schematu potwierdzona; brak nowej ekspozycji PIN-ów (PIN-y bez zmian) |
| Obsługa zespołu | PASS | niedziela, salon zamknięty; restart: właściciel; sprawdzenie: Claude (smoke, read-only) + właściciel (kliknięcie jak recepcja); PIN-y: bez zmian, bez wylogowań |

## 9. Ograniczenia i czego nie zrobiono

- Zoom 200 % i dotyk: nie sprawdzone (jak dotąd; Terminarz nie jest jeszcze narzędziem codziennym recepcji).
- Portfel/płatność mieszana: tylko odczyt i zwykła sprzedaż; kod identyczny z main.
- Przejście otwartej starej karty na nowy backend: nie testowane na żywo (§4 INFO).
- PIN-y pozostają bez zmian — decyzja właściciela (17.10). Luka ujawniania PIN-ów jest zamykana na przyszłość przez E05; przeszłe ewentualne podejrzenie PIN-ów nie jest unieważniane.
- Odczyty GET bez tokenu (§5) — stan sprzed wydania, poza zakresem.
- Dokument ZK-03.1, na który powołuje się plan, nie został przekazany; nie ma wpływu na to wydanie (zakupy uśpione).
- Gałąź powrotu `wroc-ostatnia-dobra-2026-10-16` istnieje lokalnie i jest zweryfikowana; jej wypchnięcie na GitHub zatrzymał lokalny bezpiecznik `pre-push` (kasowanie linii w `index.html`). Wypchnięcie z `--no-verify` wymaga decyzji właściciela; do tego czasu powrót wykonuje Claude z lokalnego repozytorium (ten sam jeden push z `--no-verify`).
- Sesje po restarcie produkcji są wczytywane z tabeli `Sesje` (W05-07a), więc restart zwykle nie wylogowuje zespołu; ewentualnie jedno przelogowanie.

## 10. Sekwencja okna (po „ruszaj” właściciela)

```
# Właściciel, panel Hostingera, PRZED wszystkim: Node.js → Environment Variables → są: UPLOADS_DIR, ENFORCE_SESSION=true, DB_*, SMTP_*, STRIPE_*; brak TERMINARZ_ZAKUPY_TENANTS i DB_PORT
# Claude, repozytorium lokalne (drzewo czyste, main = b3d774a):
git fetch origin && git checkout main && git merge --ff-only 7df0c8f && git push origin main
# Właściciel, panel Hostingera (estelio.com.pl): Git → Pull from remote (sprawdzić hash 7df0c8f) → Node.js → Restart application → Cache → Purge
# Claude, kontrola (wyłącznie odczyt; smoke-prod.js: login, get_pin_users, get_months, widoki w Chrome — bez zapisów):
curl -s https://estelio.com.pl/zaloguj | grep -oE "[0-9]{2}\.[0-9]{2}\.[0-9]{4}[^<\"]{0,24}[0-9a-f]{7,12}"   # tożsamość wydania = SHA kandydata
B=https://estelio.com.pl TENANT=demo-estelio PROFIL_LOGIN=<login demo> PROFIL_HASLO=<poza czatem> node narzedzia/smoke-prod.js
# Właściciel: logowanie PIN-em, Klientki / Sprzedaż / Zgłoszenia / Terminarz jak recepcja; jeśli OK → okno zamknięte
# Po pierwszym dniu pracy bez zgłoszeń: tag ostatnia-dobra-2026-10-19 (lub data dnia)
```
Kryteria przerwania (→ §7 plan awaryjny): brak logowania kluczowej roli, awaria odczytów/zapisów rdzenia, pętla restartów, nieoczekiwane uruchomienie ewidencji zakupów.

SHA kandydata = commit tego raportu na `dev` (patrz `git log origin/dev -1`); kod produktu w nim = `0718cb3`.
