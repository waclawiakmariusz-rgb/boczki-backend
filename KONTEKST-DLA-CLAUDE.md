# Kontekst projektu Estelio — pełny brief dla Claude na drugim komputerze

**Po co ten plik:** pamięć Claude **nie jest współdzielona między komputerami**. Katalog pamięci
nazywa się od ŚCIEŻKI projektu, a konta Windows są różne (`aaell` na HP, `wacla` na DELL),
więc Claude na DELL startuje bez żadnej wiedzy o tym projekcie. Poniżej wszystko, co potrzebne,
żeby pracować sensownie od pierwszej minuty.

Stan wiedzy: **2026-08-11**. Autor: Claude pracujący na HP. Pełna pamięć (64 pliki, m.in. hasła
i dane dostępowe — celowo NIE ma ich tutaj) siedzi na HP; jeśli czegoś brakuje, poproś
użytkownika, żeby zapytał tamtej instancji.

Daty w tym pliku są bezwzględne. Wszystko, co opisane jako „na main", było prawdą 2026-08-11 —
**weryfikuj w kodzie, zanim powiesz to użytkownikowi jako fakt.**

---

# 1. JAK PRACOWAĆ Z TYM UŻYTKOWNIKIEM — czytaj najuważniej

To nie są preferencje kosmetyczne. Każda z tych reguł powstała po konkretnym zgrzycie.

- **Piszemy po polsku.** Zawsze, bez wyjątku.
- **Push na `main` = ZAWSZE pytaj i czekaj na wyraźne „push".** To jedyna bramka, ale bezwzględna.
  Zgoda na jeden push NIE autoryzuje kolejnego. Frazy „niech to działa", „napraw to", „żeby
  chodziło" autoryzują KOD, nie deploy. Ta reguła została złamana kilka razy w 2026 i raz
  skończyła się awarią logowania na produkcji — użytkownik ma do tego pełne prawo być wyczulony.
- **Cała reszta — bez pytania.** Badanie kodu, implementacja uzgodnionego zadania, testy,
  `git add`/`commit`, push na `dev`. Użytkownik powiedział wprost: *„weź nie pytaj się co chwilę,
  nie mam czasu siedzieć i naciskać tej 1. co moment"*. Meldunek dopiero na końcu roboty.
- **Nowa funkcja: najpierw ustal zakres, potem buduj.** Ale gdy zadanie jest już uzgodnione —
  wykonaj je w CAŁOŚCI, bez pytań pośrednich.
- **Nie używaj `sed`/`awk`/`echo >` do edycji plików** — wyłącznie narzędzia Edit/Write.
- **`rm` bywa odrzucane** — jeśli musisz usunąć pliki, wyjaśnij po co albo przenieś je zamiast
  kasować. Użytkownik odrzucił kiedyś polecenie z `rm -f` i miał rację, że wyglądało groźnie.
- **Nie zakładaj z góry, że użytkownik się myli.** Kilka razy miał rację wbrew moim założeniom
  (np. „przecież to już zrobiłeś wczoraj" — sprawdziłem produkcję i faktycznie było zrobione).
  Weryfikuj fakty, zanim odpowiesz.
- Użytkownik jest właścicielem firmy i zna swój biznes; nie jest programistą. Tłumacz skutki,
  nie mechanikę. Gdy prosi „wytłumacz jaśniej" — wyrzuć żargon, nie skracaj treści.

---

# 2. CO TO JEST ESTELIO — produkt i szerszy cel

**Estelio** to system do prowadzenia salonu kosmetycznego, sprzedawany w modelu SaaS
(subskrypcja miesięczna przez Stripe, cena rzędu 79 zł/mies., wcześniej 49 zł).

**Szerszy cel:** system wyrósł z wewnętrznego narzędzia jednego salonu („Boczki na bok")
i jest przekształcany w produkt sprzedawany innym salonom. Sprzedaż wystartowała
**2026-06-12** (pierwsza reklama na Facebooku). To znaczy, że **na produkcji są prawdziwi
płacący klienci**, a nie tylko salon właściciela.

**Kluczowa konsekwencja:** `estelio.com.pl` to system, na którym recepcja pracuje na żywo.
Błąd na produkcji = ktoś nie może obsłużyć klientki, wystawić paragonu albo się zalogować.
Stąd cała paranoja wokół deploymentu.

**Co system robi** (moduły):
- **Magazyn** — kosmetyki detaliczne (FIFO przy sprzedaży), osobny „magazyn pro" na materiały
- **Sprzedaż** — zabiegi i kosmetyki, sprzedaż wielopozycyjna, rabaty, płatności (Gotówka/Karta/
  Blik/Portfel/**Mix** — rozbicie na kilka metod), zwroty
- **Klienci** — kartoteka, portfel zadatków, memo, retencja (rozmowy odzyskujące), RODO,
  dokumenty dodatkowe, zdjęcia przed/po
- **Analityka** — dzień/miesiąc/rok, analiza zabiegów, BI, koszty, targety pracowników,
  „audyt pełny" (raport sprzedaży usług/produktów z udziałem w obrocie)
- **Konsultacje** — wyniki konsultacji sprzedażowych i ich skuteczność
- **Klub** — płatny dodatek lojalnościowy (patrz rozdział 8)
- **Esti** — asystent w panelu odpowiadający na pytania o system (keyword-scoring, NIE AI)
- **Onboarding SaaS** — Stripe checkout → token → email → rejestracja salonu → licencja,
  panel rozliczeniowy `billing.html`, faktury przez Fakturownia.pl

---

# 3. ARCHITEKTURA TECHNICZNA

**Stack:** Node.js + Express + MySQL (mysql2, pula połączeń). Frontend to **statyczny
`public/index.html`** — ok. 34 tys. linii vanilla JS, cały CSS+HTML+JS w jednym pliku,
bez frameworka. Jedyna zewnętrzna biblioteka na froncie to Chart.js.

## Backend

- **`server.js`** — tworzy pulę MySQL, rejestruje routery pod `/api`, zawiera **dispatcher
  kompatybilności** dla starych klientów wołających `?action=...` (GET i POST).
  `express.raw()` dla webhooka Stripe MUSI być przed `express.json()`.
- **`routes/*.js`** — moduły domenowe, każdy jako fabryka `module.exports = (db) => { ... }`.
  Najważniejsze: `sprzedaz.js`, `klienci.js`, `magazyn.js`, `analityka.js`, `lojalnosc.js`
  (Klub — duży), `logi.js` (eksportuje `makeZapiszLog`), `auth.js`, `admin.js`, `stripe.js`,
  `fakturownia.js`, `mailer.js`, `foto.js`, `dokumenty*.js`, `rodo.js`, `raport.js`,
  `konsultacje.js`, `targety.js`, `retencja.js`, `booksy.js`.
- **`tests/`** — jest + supertest, baza mockowana przez `tests/helpers/mockDb.js`
  (`mockDb(...kolejne wyniki)` i `mockDbAlways(jeden wynik)`).

## Frontend — `public/index.html`

- Widoki to `<div class="section" id="...">`, przełączane funkcją `pokaz(viewId)`.
- Stan trzymany w zmiennych globalnych i `localStorage`
  (`boczki_tenant_id`, `boczki_pracownik_imie`, `boczki_pracownik_rola`, `boczki_theme`).
- Logowanie dwustopniowe: login salonu → PIN pracownika.
- **RBAC po rolach**: praktykantka (tylko magazyn) < kosmetolog < recepcja < manager < admin/megaadmin.
  Uwaga: RBAC jest głównie po stronie frontu — backend historycznie nie sprawdzał roli
  przy części akcji (patrz rozdział 10, otwarte).
- Dark mode, RWD z hamburgerem, dużo `onclick=` w HTML zamiast addEventListener.

## Wielotenantowość

Wszystko jest per `tenant_id`. Zapytania MUSZĄ filtrować po `tenant_id` — pominięcie to
wyciek danych między salonami. Historycznie `tenant_id` był kontrolowany przez klienta
(luka bezpieczeństwa), potem naprawiony sesjami (`ENFORCE_SESSION=true`).

---

# 4. BAZA DANYCH — INWARIANTY, KTÓRYCH NIE WOLNO ZŁAMAĆ

## 4.1. Strefa czasowa: baza stoi w UTC

Zweryfikowane 2026-08-11: `@@system_time_zone = UTC`. System zapisuje czas funkcjami bazy
(`NOW()` w 97 miejscach, `CURDATE()` w 24, `CURRENT_TIMESTAMP` jako DEFAULT w 51), więc
wszystko zapisywało się o 2 h za wcześnie (latem; zimą 1 h).

**Naprawione w `db-strefa.js`** — `SET time_zone` na połączeniach puli, wpięte w `server.js`
tuż po `createPool`. Dwie rzeczy, które musisz wiedzieć:
- **Nazwane strefy NIE działają** na tym hostingu (`'Europe/Warsaw'` → *„Unknown or incorrect
  time zone"*, brak tabel `mysql.time_zone_name`). Działa tylko offset.
- **Offset licz przez `Intl` z `timeZoneName: 'longOffset'`.** Metoda przez
  `new Date(x.toLocaleString(...))` w dwóch strefach **myli się w oknie zmiany czasu** —
  sprawdzone, dawała +01:00 zamiast +02:00 dla 29.03.2026 01:30 UTC.
- Stare wpisy zostają w UTC. Korekta danych = osobna decyzja użytkownika, **nie zapadła**.

## 4.2. Płatność MIX — splity są źródłem prawdy

Transakcja opłacona Mixem zapisuje się w DWÓCH miejscach: wiersz nagłówkowy z `platnosc='Mix'`
(pełna kwota) **oraz** rozbicie na metody w tabeli `Platnosci`.

**INWARIANT: każda agregacja utargu sumująca `Platnosci` MUSI pominąć wiersz nagłówkowy
`metoda/platnosc === 'mix'`** — inaczej kwota liczy się dwa razy. Dotyczy OSOBNO pętli
`Sprzedaz` i pętli `Zadatki`. Brak symetrii już raz dał podwójne liczenie zadatku 2637,50 zł.

**Wyjątek:** ranking „Top Pracownicy" — tam wiersz Mix ZOSTAJE, bo splity nie mają pola pracownika.

## 4.3. Zadatki — liczyć po statusie, nie tylko AKTYWNY

Raport utargu filtruje zadatki `NOT IN ('USUNIĘTY','SCALONY')`. Samo `AKTYWNY` gubi realny
przychód (zabieg opłacony zadatkiem przechodzi w `WYKORZYSTANY`). Rozbieżność 46951 vs 53319 zł
w Analizie wzięła się dokładnie stąd.

## 4.4. Collation

Nowe tabele w tej bazie muszą mieć **`utf8mb4_unicode_ci`** (takie jest jądro, m.in. `Klienci`).
`utf8mb4_polish_ci` wywala JOIN-y błędem „Illegal mix of collations" — **ale dopiero przy
pierwszym wierszu**, puste tabele nie błądzą, więc błąd wychodzi długo po wdrożeniu.

## 4.5. Wspólna baza dev i prod

Środowisko dev i produkcja **dzielą jedną bazę MySQL**. Konsekwencje:
- migracja/ALTER wykonany z dev jest natychmiast aktywny na produkcji,
- jednorazowe skrypty migracyjne uruchamiaj **tylko raz**, niezależnie skąd,
- schedulery muszą mieć **atomowy claim** (obie instancje odpalają je równolegle) —
  tak są zrobione zadania Klubu.

---

# 5. GIT I DEPLOYMENT

## Workflow (obowiązujący, nadpisuje starsze notatki)

- Pracujemy na **`dev`**. Na `main` wchodzi **wyłącznie `git merge dev --ff-only`**.
- **NIGDY cherry-pick z `dev` na `main`** — od tego rozjeżdżały się gałęzie. (Starsze notatki
  w pamięci HP dopuszczają cherry-pick przy hotfixie — to jest NIEAKTUALNE.)
- Nigdy nie pushuj na `dev` i `main` „przy okazji" w jednym ruchu. Synchronizacja gałęzi
  to osobna decyzja użytkownika.
- `--force` na `main`: tylko po jawnej zgodzie i po utworzeniu tagu zabezpieczającego.

## Deployment na produkcję

- Hosting **Hostinger**, domena `estelio.com.pl`, gałąź `main`, wdrożenie **przyciskiem
  „Ponowne wdrożenie" w panelu** (nie autopull — potrafi nie zadziałać).
- **Nie ma pm2.** Nie sugeruj go — użytkownik próbował, nie poszło, temat zamknięty.
- Restart aplikacji = wszyscy zalogowani dostają „Sesja wygasła" i logują się ponownie.
- Historycznie istniało środowisko `dev.estelio.com.pl` (osobna instancja Node, ta sama baza) —
  **zweryfikuj, czy nadal jest używane**, zanim się na nie powołasz.
- Env vars na Hostingerze zapisuj **bez apostrofów** (`KLUCZ=wartość`, nie `KLUCZ='wartość'`).
- **`UPLOADS_DIR` znikało już dwa razy** — gdy „dokumenty klientów zniknęły", sprawdzaj tę
  zmienną PIERWSZĄ. Pliki leżą poza repo, w katalogu uploadów na serwerze.
- Nie zgaduj ścieżek na Hostingerze — pytaj użytkownika albo support.
- Backup bazy przed deployem: **konieczny tylko gdy zmiana rusza dane lub schemat**
  (`CREATE/ALTER/INSERT/UPDATE/DELETE/DROP`, skrypt migracyjny). Czysty kod = `git revert`
  wystarcza, bo cofa kod, ale NIE cofa danych.

## Punkty powrotu

- Tag **`ostatnia-dobra`** — ruchomy, wskazuje ostatnią wersję **sprawdzoną oczami na produkcji**
  (nie „ostatnią wdrożoną" — ta różnica jest istotą incydentu z rozdziału 6). Przestawiać PO
  weryfikacji: `git tag -f ostatnia-dobra main && git push -f origin ostatnia-dobra`.
- Tag `pre-fix-regres-sync-2026-08-10` — stan produkcji sprzed naprawy Klubu.
- Procedura cofania: **`POWROT-AWARYJNY.md`** w repo (jedna komenda `git revert
  ostatnia-dobra..main`, bez `--force`, bez kasowania historii).

---

# 6. INCYDENT 3–10.08.2026 — geneza połowy tego pliku

**To najważniejsza historia w tym briefie.**

3 sierpnia po południu powstały trzy commity poprawiające dodatek Klub: godziny przy
zgłoszeniach, pasek Klubu na Pulpicie, poprawione nazwy przycisków. Wieczorem tego samego dnia
(20:34) z drugiego komputera przyszedł commit `eba4e8c` „Sync z HP" — **pliki zostały skopiowane
między laptopami zamiast przenieść zmiany gitem**. Starsze wersje nadpisały nowsze:
`public/index.html` −54 linie, `routes/lojalnosc.js` −36, `server.js` −1, testy −43.

**Git nie zgłosił konfliktu** — dla niego to była zwykła nowa wersja pliku. Deploy 4 sierpnia
o 09:39 wdrożył regres na produkcję i wypisał „Zakończone" na zielono. Wykryte dopiero
**10 sierpnia**, gdy użytkownik zauważył brak godzin przy zgłoszeniach w Klubie.

Najgorszy skutek: przez tydzień recepcja nie miała na Pulpicie paska „coś czeka na obsługę",
więc klientki mogły czekać na aktywację konta, o której nikt nie wiedział.

**Wniosek do zapamiętania: kopiowanie plików projektu między komputerami to cichy revert.**

**Metoda diagnozy, która to rozstrzygnęła** (używaj przy każdym „zniknęła mi zmiana"):
```bash
curl -sL https://estelio.com.pl/zaloguj | grep -c "<marker zmiany>"   # co NAPRAWDĘ stoi na prodzie
git fetch && git log --oneline main..origin/main                       # czy ktoś wyprzedził
git show --numstat <hash>                                              # ile USUWA vs dodaje
```
Sygnał alarmowy: commit usuwający dużo linii z `public/index.html` lub `routes/*.js`, mający
w opisie „sync"/„kopia"/„z laptopa".

Dodatkowa wskazówka: **autor commita zdradza maszynę.** Do 2026-08-11 HP podpisywał się
`waclawiakmariusz-rgb`, DELL `Mariusz Waclawiak`; od 2026-08-11 DELL ma ustawione
`Mariusz (DELL)`. Feralny commit rozpoznałem właśnie po autorze.

---

# 7. CO JEST W REPO — narzędzia i dokumenty

- **`POWROT-AWARYJNY.md`** — jak w minutę cofnąć produkcję; jak sprawdzić, co naprawdę na niej
  stoi; jak rozpoznać cichy revert; checklist przed pushem na `main`.
- **`PRZENOSINY-NA-DELL.md`** — co przenieść ręcznie, zasady pracy na dwóch komputerach.
- **`npm run start-pracy`** (`narzedzia/praca-start.js`) — na początku pracy: fetch, stan gałęzi,
  `pull --ff-only`. Gdy przychodzący commit masowo kasuje kod — **nie ściąga**, zatrzymuje się i pyta.
- **`npm run koniec-pracy`** (`narzedzia/praca-koniec.js`) — pilnuje, żeby nic nie zostało na jednym
  laptopie; wysyła gotowe zmiany na bieżącą gałąź; **na `main` nigdy nie wysyła sam**;
  nie commituje za użytkownika (opis zmiany pisze człowiek).
- **`npm run zabezpiecz`** (`narzedzia/zabezpiecz.js`) — uruchamiane **raz na każdej maszynie**:
  ustawia `core.hooksPath=githooks` i `pull.ff=only`. Ustawienia gita siedzą w `.git/`, który
  nie jedzie przez repo — dlatego osobny krok.
- **`githooks/pre-push`** — blokuje wysyłkę commita, który usuwa ≥20 linii z `public/*.html`,
  `routes/*.js`, `server.js` i usuwa 2× więcej niż dodaje (albo ≥5 usunięć przy opisie ze słowem
  „sync"/„kopia"). Furtka: `git push --no-verify`. Zweryfikowane: na 60 commitach zatrzymał
  dokładnie ten jeden feralny, zero fałszywych alarmów.
- **`.gitattributes`** — wymusza LF dla `githooks/**`. Hook z CRLF nie startuje
  („bad interpreter: /bin/sh^M"), czyli wyglądałby na działający, nie chroniąc przed niczym.
- **`design/`** — makiety, plany, dokumentacja (26 MB, **poza gitem**). Tam m.in.
  `design/klub-lojalnosc-plan.md` — pełny plan Klubu, czytać przed pracą nad lojalnością.

---

# 8. FUNKCJE PRODUKTU — co już istnieje i o co chodziło

Skrótowo, żebyś nie projektował od nowa czegoś, co jest.

- **Klub (dodatek płatny, `feature_key: lojalnosc`)** — największy moduł ostatnich miesięcy.
  PWA klienta (`public/klub.html`, adres `/klub/`), logowanie telefon+PIN (bcrypt, tokeny HMAC).
  Punkty naliczają się **automatycznie z paragonów** (hook w sprzedaży, ledger append-only
  `Lojalnosc_Punkty`, idempotencja po `ref_id`) — to naprawia główną wadę poprzedniej aplikacji,
  gdzie kadra musiała klikać punkty ręcznie. Punkty dostają **tylko członkowie Klubu**.
  Zadatki **punktują przy wpłacie** (od 2026-07-17), a realizacja zadatku/portfela już nie —
  żeby nie liczyć podwójnie. Do tego: nagrody z kodem odbioru, promocje, kampanie (push VAPID
  + wiadomości w apce), mnożnik ×2, automaty (urodziny/winback/rocznica/próg/awans), poziomy
  wg wydatków rocznych, „poleć koleżankę", reset punktów 1 stycznia, wspólna tożsamość
  multi-salon. Dostęp: admin, megaadmin **i recepcja**.
- **Foto przed/po** — zdjęcia zabiegowe, upload przez QR+PIN.
- **Zwroty sprzedaży** — ujemny wpis z dzisiejszą datą (stare raporty zostają nietknięte),
  `zwrot_do_id` blokuje podwójny zwrot, kosmetyk wraca na stan FIFO.
- **Ważność zabiegów/karnetów** — `waznosc_dni` w usłudze + `data_waznosci` jako snapshot przy
  sprzedaży; akcje Przedłuż/Zakończ/Przywróć; lista wygasających.
- **Dokumenty dodatkowe klienta** — słownik globalny + per-salon.
- **Link do płatności (tpay)** — token HMAC, regulamin, pilot Boczki.
- **Audyt pełny** — raport w Analizie: sprzedaż usług i produktów, udział % w obrocie, zysk salonu,
  godziny. Model obrotowy (system nie zna marż jednostkowych).
- **Booksy** — integracja przez skrzynkę e-mail (parsing powiadomień), dziś single-tenant
  pod Boczki; plan multi-tenant istnieje, niewdrożony.
- **Esti** — asystent w panelu. **To NIE jest AI**: keyword-scoring po bazie wiedzy, źródłem
  jest przewodnik HTML. Pułapka historyczna: wrapper `window.fetch` w index.html podmieniał
  HTML na JSON.

---

# 9. PUŁAPKI TECHNICZNE — każda kosztowała już czas albo awarię

1. **`public/index.html` edytuj WYŁĄCZNIE narzędziem Edit**, nigdy nie przepisuj całości i nigdy
   nie ruszaj PowerShellem (`Get-Content`/`Set-Content`). Plik jest UTF-8 bez BOM; PS 5.1 czyta
   go jako ANSI i masakruje polskie znaki (kiedyś: 10 tys. linii diffu).
   Przed commitem sprawdź: brak BOM, zero znaków `U+FFFD`, wszystkie bloki `<script>` bez błędu.
2. **Nigdy literalny `</script>` w template literal JS** — parser HTML utnie skrypt i **cała
   aplikacja przestanie się ładować** (awaria 15.05.2026, użytkownicy nie mogli się zalogować).
   Używaj `<\/script>`.
3. **Nowa akcja POST wymaga rejestracji w `server.js`** — sam handler w `routes/*.js` nie
   wystarczy, inaczej „Nieznana akcja POST". Szukaj list `<modul>Actions`.
4. **Role mają mieszaną wielkość liter** w bazie (`Recepcja`, `Praktykantka`) — porównuj przez
   `.toLowerCase()`.
5. **`router` musi być WEWNĄTRZ fabryki** `module.exports = (db) => {...}`. Inaczej cache modułów
   Node powoduje, że wszystkie testy dopisują handlery do tego samego routera.
   (`routes/stripe.js` historycznie miał ten błąd — sprawdź, czy nadal.)
6. **`npm test` bez `--forceExit` wisi** — jest zostaje na otwartych uchwytach. Skrypt `test`
   ma już tę flagę; jeśli uruchamiasz ręcznie: `npx jest --runInBand --forceExit`.
7. **Znane, ZASTANE porażki testów: 14 sztuk** w `magazyn`, `voucher`, `dokumenty` (stan
   zastany, nie regresja). Wynik `344/358` był poprawny 2026-08-11. Każdy inny czerwony test =
   Twoja regresja, nie pushuj.
8. **Tabele urodzin mają polskie nazwy miesięcy** (`Styczeń`…`Grudzień`) — w SQL w backtickach.
   Nie mają `id_klienta`, dopasowanie idzie po telefonie.
9. **`ALTER TABLE` w starcie modułu musi być idempotentny** — łapane po „Duplicate column".
10. **Mocki testów**: `CREATE TABLE`/`ALTER` w fabryce zużywają pierwsze wywołania `db.query`,
    trzeba je uwzględnić w `mockDb`.
11. **Naprawiając warstwę niżej, sprawdź najpierw, czy warstwa wyżej nie obchodziła tego błędu.**
    Kosztowna lekcja z 2026-08-11: po naprawie strefy w bazie sprzedaż zaczęła pokazywać godziny
    **o 2 h za późno** (wpłata 17:15 wyświetlana jako 19:15). Front miał funkcję
    `utcTimeToLocal()` z komentarzem „Baza zapisuje godziny w UTC", która ręcznie dodawała offset —
    dwa błędy się znosiły, a naprawa źródła odsłoniła kompensację. Przed taką zmianą **grepuj
    front za** `UTC`, `offset`, `getTimezoneOffset`, `toISOString`. Dziś jest tam `godzinaZBazy()`,
    która wyłącznie waliduje i formatuje — nic nie przelicza. Nie „naprawiaj" jej z powrotem.

---

# 10. STAN NA 2026-08-11 I SPRAWY OTWARTE

## Gałęzie (stan na koniec dnia 2026-08-11)
- `main` = `dev` = `origin/main` = `origin/dev` = **`7c79ff6`**. Gałęzie zrównane.
- Tag `ostatnia-dobra` wciąż wskazuje `eba4e8c` — **do przestawienia** po potwierdzeniu produkcji.
- **Nie ufaj tym hashom po fakcie** — sprawdź `npm run start-pracy` albo `git log --oneline -5`.

## Wdrożone na produkcję 2026-08-11 (zweryfikowane, użytkownik potwierdził działanie)

Potwierdzone przez pobranie `https://estelio.com.pl/pomoc/` oraz sprawdzenie przez użytkownika
w panelu. Ostatni wdrożony commit: **`6907f82`**.

0. **Godziny w Podsumowaniu sprzedaży** (`6907f82`) — naprawa regresji opisanej w pułapce nr 11.
   Front przestał doliczać 2 h. **Nowe wpisy pokazują się poprawnie; stare zostają z czasem UTC.**
1. **Czas polski w bazie** (`db-strefa.js`) — wymagało RESTARTU aplikacji, deploy go robi.
   Test: nowy wpis w Dzienniku Zdarzeń ma godzinę zgodną z zegarem.
2. **Czytelne wpisy karnetów w Dzienniku** — było `KARNET ZAKOŃCZONY — ID:202608061754188-3`,
   jest nazwisko klientki, zabieg i daty. Helper `opisKarnetu` w `routes/sprzedaz.js`,
   dotyczy `close_karnet`, `reopen_karnet`, `extend_karnet`.
3. **Zaktualizowany przewodnik** `public/estelio_pomoc_f.html` (adres `/pomoc/`) — commit
   `7c79ff6`. Plik był z 15.07 i zawierał trzy twierdzenia NIEPRAWDZIWE, które poprawiono:
   że zadatki nie punktują (punktują, od 17.07, przy wpłacie), że Klub jest tylko dla admina
   (ma go też recepcja) i że „SMS pisze się sam" (Estelio nie wysyła wiadomości — panel
   przygotowuje treść, wysyła człowiek). Dopisano funkcje z lipca i sierpnia: kod aktywacyjny
   do odczytania na głos, mnożnik ×2, automaty, poziomy, polecenia, kasowanie punktów
   1 stycznia, multi-salon, pasek Klubu na Pulpicie, Bazę do akcji SMS.

**Wniosek na przyszłość:** przewodnik `/pomoc/` łatwo się rozjeżdża z systemem. Po każdej
większej zmianie funkcjonalnej sprawdź, czy nie trzeba go poprawić — recepcja czyta go
jako źródło prawdy i błędny zapis realnie zmienia jej zachowanie.

## Otwarte / niedokończone (nie zaczynaj bez rozmowy z użytkownikiem)
- **Znacznik `ostatnia-dobra` nadal wskazuje `eba4e8c`** — czyli feralny commit sprzed naprawy
  Klubu. Użytkownik nie zdecydował o przestawieniu. Dopóki tak jest, awaryjne cofnięcie
  z `POWROT-AWARYJNY.md` wycofałoby CAŁY dzień 11.08. Komenda (jedyna z `-f` w tym obiegu,
  więc wymaga zgody): `git tag -f ostatnia-dobra main && git push -f origin ostatnia-dobra`.
- **NIE prostujemy godzin w danych historycznych.** Użytkownik 2026-08-11, dosłownie:
  *„ŻADNEGO COFANIA DANYCH!!!"*. Stare rekordy (Logi 13 399, Sprzedaz 3 242, Zadatki 1 107,
  Platnosci 202) zostają z czasem UTC i pokazują godziny o 1–2 h za wcześnie — to zaakceptowane.
  Liczy się wyłącznie poprawność nowych wpisów. **Nie proponuj migracji ponownie.**
- **RBAC po stronie backendu** — front chroni menu Analiza/Zadania, ale backend historycznie
  przyjmował żądania bez sprawdzania roli. Luka zgłoszona 2026-04-30, **zweryfikuj stan**.
- **Rozdzielenie Kosmetyki vs Suplementy** w `rap_module` i Targetach — dwa miejsca UI wciąż
  traktują je łącznie.
- **Partie/terminy w magazynie pro** — prośba recepcji, opcja uzgodniona, niewdrożone.
- **Soft-delete klienta** — 4 funkcje (duplikat / anonimizacja RODO / zmarły / problematyczny)
  ustalone biznesowo, czekają pytania techniczne.
- **Zadania od managera dla recepcji** — pomysł, wariant do wyboru.
- **Booksy multi-tenant** — dziś single-tenant na sztywno.
- **`UNIQUE tenant_id`** i odnowienia subskrypcji po `subscription_id` zamiast po e-mailu —
  dwie odłożone słabości onboardingu.
- **Wyścig onboardingu**: `invoice.paid` potrafi przyjść przed utworzeniem licencji → Stripe IDs
  gubią się w Licencjach; doraźnie backfill z dashboardu.
- **Stare deploye Google Apps Script** po poprzedniej aplikacji lojalnościowej mogą wciąż działać
  i wystawiać publicznie bazę telefonów i PIN-ów — **PILNE do sprawdzenia i wyłączenia.**
- `sync-memory.ps1` na DELL (nieśledzony) — skrypt użytkownika do synchronizacji pamięci Claude,
  jeszcze nieprzejrzany; `memory-backup/` jest w `.gitignore`.

---

# 11. CZEGO GIT NIE PRZENOSI + różnice między maszynami

| co | uwaga |
|---|---|
| **`.env`** (ok. 1,4 KB) | hasła do bazy, klucze Stripe, VAPID, SMTP. **Bez tego nic nie ruszy.** Przenosić bezpiecznie, nie mailem. |
| **`design/`** (26 MB) | makiety, plany, zrzuty, dumpy SQL — w `.gitignore` |
| **pamięć Claude** | osobna na każdym komputerze, stąd ten plik |
| `uploads/` | dokumenty klientów, żyją na serwerze |

`scripts/*.js` **są w gicie** (23 pliki) — przenoszą się same.

**Ścieżki:** HP `C:\Users\aaell\...`, DELL `C:\Users\wacla\...`. Różne konta Windows.

---

# 12. CO ZRÓB PO PRZECZYTANIU

1. **Zapisz najważniejsze rzeczy z tego pliku do swojej pamięci** — inaczej przy następnej sesji
   na tym komputerze znów zaczniesz bez kontekstu. Priorytet: rozdziały 1, 4, 5, 6, 9.
2. Uruchom `npm run start-pracy`, żeby zobaczyć aktualny stan gałęzi i produkcji.
3. Zanim powiesz cokolwiek jako fakt — **sprawdź w kodzie**. Ten plik opisuje stan
   z 2026-08-11 i będzie się starzeć.
4. Nie wdrażaj niczego na `main` bez wyraźnego „push na main" od użytkownika.
