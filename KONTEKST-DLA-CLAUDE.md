# Kontekst projektu Estelio — pełny brief dla Claude na drugim komputerze

**Po co ten plik:** pamięć Claude **nie jest współdzielona między komputerami**. Katalog pamięci
nazywa się od ŚCIEŻKI projektu, a konta Windows są różne (`aaell` na HP, `wacla` na DELL),
więc Claude na DELL startuje bez żadnej wiedzy o tym projekcie. Poniżej wszystko, co potrzebne,
żeby pracować sensownie od pierwszej minuty.

Stan wiedzy: **2026-09-19** (ostatnia aktualizacja tego pliku; czytaj rozdział 10c najpierw —
najnowszy). Autor: Claude pracujący na HP. Pełna pamięć (kilkadziesiąt plików, m.in. hasła
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
- **Numer wersji na Pulpicie** (od 2026-09-09, decyzja użytkownika) — mały, wyciszony napis
  „Estelio · wersja X.Y" na samym dole strony Pulpitu (klasa `.ds-wersja`, `index.html`,
  szukaj `<!-- Numer wersji`). Cel: użytkownik dzwoni do recepcji, prosi o odczytanie numeru
  z dołu Pulpitu, i tak sprawdza czy dana stacja ma świeżą wersję po wdrożeniu (bez zgadywania
  po cache przeglądarki). **Podbijaj ten numer przy KAŻDYM pushu na `main`** (mały bump, np.
  1.0→1.1; większa zmiana funkcjonalna → bump części całkowitej). Widoczny wyłącznie na
  Pulpicie, nigdzie indziej w aplikacji.

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
  2026-09-02: przestawiony z `eba4e8c` (feralny commit) na `6907f82` (produkcja potwierdzona).
- **ZASADA od 2026-09-02 (decyzja użytkownika): po każdym sprawdzonym oczami wdrożeniu dodajemy
  DATOWANY tag `ostatnia-dobra-RRRR-MM-DD`** (zwykły push, bez `-f`) **i nie kasujemy starych** —
  chcemy mieć zawsze co najmniej 3 dobre wersje do powrotu. Pierwszy taki tag:
  `ostatnia-dobra-2026-09-02` = `6907f82`.
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

# 10c. STAN NA 2026-09-15 do 2026-09-19 (najnowszy — czytaj najpierw)

Cztery dni pracy na HP. **UWAGA, inaczej niż w poprzednich rozdziałach: NIC poniżej nie zostało
jeszcze wdrożone na Hostinger ani potwierdzone przez użytkownika w przeglądarce.** Cała praca
jest wypushowana do gita (`main` = `dev` = `4efd26a`), ale w żadnej z tych sesji nie zrobiliśmy
`git pull` + restart na serwerze. **Zanim powiesz userowi "to już działa" — zapytaj, czy deploy
się odbył.** Ostatni tag `ostatnia-dobra-*` to `ostatnia-dobra-2026-09-10`, czyli SPRZED tej
całej serii zmian — nie zakładaj, że coś z poniższego jest bezpiecznym punktem powrotu.

## Śledztwo bez zmian w kodzie (2026-09-15)

Recepcja poprosiła o analizę modułu Konsultacji ("stary kod, może da się coś ulepszyć") —
zrobiony pełny przegląd `routes/konsultacje.js` (682 linie), user po przeczytaniu raportu
powiedział **"nie, nic tu nie zmieniaj"**. Nie ruszaj tego modułu bez nowej, wyraźnej prośby.
Ustalenia z raportu (na wypadek gdyby temat wrócił): brak testów (`konsultacje.test.js` nie
istnieje), 2 miejsca z cichym fałszywym `status:'success'` mimo błędu zapisu bazy
(`kon_add_consultant`, `kon_toggle_campaign`), `odp_getReportData` robi 6 zapytań sekwencyjnie
zamiast równolegle, ten sam endpoint miesza dane z 5 różnych tabel (Magazyn/Sprzedaz/Platnosci/
Zadatki/Uslugi), martwe pole `telefon` w `Wyniki_konsultacja` (zapisywane, nigdy nie zbierane
przez formularz), brak RBAC backendowego (tylko tenant_id+sesja, nie rola — to jednak znany
dług całego systemu, nie specyfika tego modułu).

## Co weszło 2026-09-15/16 — drobne poprawki + nowe moduły analityczne

1. **Alfabetyczne sortowanie w Kosmetyki→Przyjęcie towaru** (`cdc8401`) — zwykłe `.sort()` na
   liście firm/modeli sortowało po kodach znaków (wielkie/małe litery, polskie znaki), nie
   alfabetycznie. Fix: `.sort((a,b)=>a.localeCompare(b))` — **ten wzorzec wraca jeszcze dwa razy
   niżej w tym rozdziale, warto go zapamiętać jako domyślny sposób sortowania list PL w tym
   projekcie.**
2. **Statystyki miesięczne linków do płatności** (`f318c44`→`9c23d66`) — Administracja→Płatności
   online, nowa karta pod listą/paginacją z tabelą miesięczną (utworzono/zaakceptowano/wygasło/
   anulowano/oczekuje). **WAŻNE ograniczenie architektury, nie tego dodatku:** system NIE MA
   webhooka z tpay potwierdzającego faktyczną płatność — status `ZAAKCEPTOWANA` znaczy tylko
   "klient zaakceptował regulamin i został przekierowany do tpay", nie "zapłacił". UI to jasno
   opisuje, ale jeśli ktoś zapyta "ile się faktycznie opłaciło" — to pytanie, na które ten
   system nie potrafi dziś odpowiedzieć. Kolumna z sumą kwot była w pierwszej wersji, usunięta
   na prośbę usera (`9c23d66`) — zostały tylko liczby.
3. **Nowy moduł: Ranking klientów** (Klienci→Ranking, `3a41ad9`) — recepcja chciała sortować
   klientów po wydanych kwotach; celowo NIE dołożone do istniejącej listy "Klienci" (obawa
   o spowolnienie jej ładowania), tylko osobna pod-zakładka. User wprost powiedział, że myśli
   o tym miejscu jako o "dziale do wszelkich analiz klientów, nie tylko sortowania" — stąd
   dalsza rozbudowa w punkcie 7 poniżej. Wersja 1: wybierany zakres dat (nie ustalony z góry),
   sort najwięcej/najmniej wydali, filtr po zabiegu/pakiecie (normalizacja nazwy jak w Analizie
   Zabiegu — "Botoks" i "Botoks Dopłata" to jedno), Top 15 + "Pokaż więcej" (`43a48c2` zmieniło
   z 20 na 15). Backend: `get_client_ranking`, `get_ranking_zabiegi` w `routes/klienci.js` —
   kwota liczona wprost z `Sprzedaz.kwota` (ten sam wzorzec co roczne wydatki w Klubie,
   `routes/lojalnosc.js`), inwariant "pomijaj metoda=mix" tu NIE ma zastosowania (nie łączy się
   z `Platnosci`).
4. **Ranking — kwoty tylko dla zakresu w obrębie bieżącego miesiąca** (`42f566f`) — kolejna
   prośba usera: kwoty widoczne TYLKO gdy CAŁY wybrany zakres (i „od", i „do") mieści się
   w aktualnym miesiącu kalendarzowym; poza tym — lista/sortowanie/liczba transakcji dalej
   działają poprawnie (sortowanie po realnej kwocie), ale sama kwota jest zamaskowana „🔒
   ukryte" z wyjaśnieniem w UI. Nie mylić z regułą "cały miesiąc od 1. dnia" — user to
   sprecyzował: chodzi WYŁĄCZNIE o to, żeby zakres nie wychodził poza bieżący miesiąc, dzień
   startowy może być dowolny.
5. **Fix: Klienci→Wygasające karnety i Pulpit→Do sprawdzenia pokazywały RÓŻNE listy** (`6fb2655`)
   — zgłoszenie recepcji. Przyczyna: dwa NIEZALEŻNE liczenia tego samego (Pulpit przez backend
   `ds_przeglad`, Klienci-tab przez `full_sales_history` + liczenie w JS) — przycisk "Pomiń"
   na Pulpicie działał tylko lokalnie, w drugim miejscu pominięta pozycja dalej straszyła. Fix:
   `renderWygasajaceKarnety()` w index.html korzysta teraz z TEGO SAMEGO `ds_przeglad` co Pulpit
   i tej samej listy pominiętych. **Wzorzec do zapamiętania: jeśli to samo pojęcie biznesowe
   (tu: "karnet wygasający") jest liczone w dwóch miejscach dwoma różnymi zapytaniami — to
   pytanie czasu, aż się rozjadą. Jedno źródło prawdy, nie dwa liczenia tej samej rzeczy.**

## Co weszło 2026-09-17 — karnety: zawieszenie + flaga odwołania po czasie

6. **Zawieszenie ważności karnetu — ile razy i na ile dni** (`13a0b3a`) — regulamin salonu
   dopuszcza zawieszenie karnetu (np. wyjazd, choroba klientki), system tego wcześniej NIE
   śledził — jedynym obejściem było ręczne "Przedłuż" bez żadnego śladu ile razy/na ile dni to
   robiono. Nowy przycisk "🕓 Zawieś" (dropdown dni, reużywa `opcjeDniPrzedluzenia()`) obok
   Przedłuż/Zakończ w **3 miejscach**: profil klienta (`renderKarnetInfo`), Pulpit→Do sprawdzenia,
   Klienci→Wygasające karnety. Mechanicznie jak "Przedłuż" (przesuwa `data_waznosci`), ale
   dodatkowo liczy `zawieszenia_liczba` i `zawieszenia_dni_lacznie` na `Sprzedaz` — widoczne jako
   fioletowy znacznik przy karnecie. Nowa akcja `suspend_karnet` w `routes/sprzedaz.js`.
   **PUŁAPKA PROCESOWA (moja, HP) — ważne dla ciebie:** ten sam commit `13a0b3a` przypadkowo
   zawiera JESZCZE JEDNĄ, całkiem niezwiązaną funkcję: punkt 8 poniżej ("Odwołanie po czasie").
   Zaimplementowałem ją wcześniej tego samego dnia, ale nigdy osobno nie scommitowałem —
   przy kolejnym `git add` (do commita o zawieszeniu karnetów) poszła razem, bo dodawałem cały
   plik `routes/klienci.js`, nie tylko nowe linie. **Jeśli szukasz funkcji "Odwołanie po czasie"
   w historii gita — NIE ma dla niej osobnego commita, mimo mylącej nazwy siedzi wewnątrz
   `13a0b3a`.** Nauka na przyszłość (dla mnie i dla Ciebie): przed `git add` na cały plik,
   sprawdź `git diff <plik>` czy nie ma tam czegoś z zupełnie innego wątku pracy.
7. **Zbiorowe zawieszenie WSZYSTKICH karnetów klienta naraz** (`b57e56f`, ten sam dzień) —
   dalsza prośba recepcji: klientka z kilkoma różnymi karnetami (np. 6 typów zabiegów) wyjeżdża
   na tydzień, klikanie "Zawieś" osobno przy każdym groziło pominięciem. Nowa opcja w menu
   „⋮ Akcje" profilu: „🕓 Zawieś wszystkie karnety" — jedna liczba dni, backend liczy nową datę
   OSOBNO dla każdego karnetu (każdy ma inną dotychczasową ważność). Nowa akcja
   `suspend_all_karnety`.
8. **Flaga „Odwołanie po czasie regulaminowym"** (kod wewnątrz `13a0b3a`, patrz pułapka wyżej) —
   recepcja: klientki mają jednorazową możliwość odwołania zabiegu <24h przed wizytą bez
   potrącenia zadatku; przy KOLEJNYM takim odwołaniu zadatek już się potrąca. Potrzebna flaga
   w profilu, edytowalna (na wypadek pomyłkowego zaznaczenia nie tego klienta), z datą
   wykorzystania. Menu Akcje profilu → „⏳ Odwołanie po czasie" → modal z checkboxem +
   edytowalną datą. Zaznaczenie = ustawia flagę; odznaczenie + zapis = cofa (korekta pomyłki).
   Żółty banner w nagłówku profilu gdy flaga aktywna, z przyciskiem „✎ Popraw". Kolumny
   `odwolanie_ulga` / `odwolanie_ulga_data` na `Klienci`, akcje `set_odwolanie_ulga` /
   `clear_odwolanie_ulga` w `routes/klienci.js`, log do Dziennika zdarzeń przy każdej zmianie.

## Co weszło 2026-09-19 — Ranking: tryb "Aktywne pakiety"

9. **Ranking → druga zakładka "🎟️ Aktywne pakiety"** (`255cf52`→`4efd26a`) — konkretny impuls:
   recepcja sprzedaje urządzenie Alma i musi znaleźć WSZYSTKICH klientów z jeszcze
   niewykorzystanym (niezakończonym) pakietem na to urządzenie — user wprost powiedział "nie ma
   takiego miejsca, w którym łatwo można znaleźć osoby, które mają dostępne pakiety dowolnej
   rzeczy". To realizacja zapowiedzi z punktu 3 (Ranking = dział do różnych analiz, nie tylko
   sortowania po wydatkach). Inna logika niż "Wygasające karnety" (tam tylko okno ≤14 dni do
   wygaśnięcia) — tu liczy się WYŁĄCZNIE `karnet_zamkniety_w IS NULL`, niezależnie od tego, czy
   termin ważności już minął (bo przy sprzedaży urządzenia chodzi o kompletność, nie o pilność).
   Lista zabiegów do wyboru — **rozwijana, alfabetyczna (`localeCompare`), NIE wpisywanie
   z ręki** (user explicite tego chciał, ryzyko literówek/pominięcia wariantu nazwy) i dopasowanie
   dokładne po znormalizowanej nazwie (nie `LIKE`) — inaczej niż `szukaj` w innych listach tego
   projektu (np. lista klientów, płatności online), które celowo są wolnym tekstem. Nowe akcje
   `get_aktywne_pakiety`, `get_pakiety_z_aktywnymi_lista` w `routes/klienci.js`. Fix `4efd26a`
   tego samego dnia: wyniki grupowane po KLIENCIE (nie po transakcji) — ten sam klient z dwoma
   osobnymi zakupami tego samego pakietu (np. różny rabat) pokazywał się dwa razy, myląc
   liczenie „ile osób trzeba obdzwonić"; teraz jeden wiersz na osobę, wszystkie jej pasujące
   pakiety w środku + telefon do kontaktu.

## Potwierdzenie: pułapka testowa z ALTER TABLE — nie dotyczy (dobra wiadomość)

Przy każdej z powyższych zmian dodawaliśmy nowe kolumny przez `ALTER TABLE ... ADD COLUMN`
(idempotentne migracje przy starcie modułu) — **żadna nie wymagała specjalnych zabiegów
w testach**, bo `tests/helpers/mockDb.js` ma regex `^ALTER TABLE` i takie zapytania NIE
konsumują sekwencyjnej kolejki mocków (w przeciwieństwie do `CREATE TABLE`, patrz pułapka
z 2026-09-10 niżej w rozdziale 10b — to ograniczenie dotyczy tylko `CREATE TABLE`).

## Tagi i deploy (stan na 2026-09-19)

**Nic z tego rozdziału nie jest wdrożone na Hostinger ani potwierdzone przez usera.** Ostatni
tag `ostatnia-dobra-2026-09-10` jest już nieaktualny względem `main`/`dev` o 11 commitów.
Zanim utworzysz kolejny tag — upewnij się, że deploy faktycznie się odbył i user zobaczył, że
działa (zasada z 2026-09-02: tag DOPIERO po sprawdzonym deployu).

---

# 10b. STAN NA 2026-09-09/10

Dwa dni pracy na HP. Wszystko poniżej **wdrożone na produkcję i potwierdzone przez
użytkownika**. `main` = `dev` = `5232e67`.

## Co weszło 2026-09-09

1. **Śledztwo (bez zmian w danych): zadatek Misztal, godziny w Podsumowaniu Dnia.**
   Skrypty diagnostyczne w `scripts/investigate-*.js` (tylko odczyt) — wzorzec do
   powtórzenia przy podobnych "czy to prawda" zgłoszeniach: zapytać bazę bezpośrednio
   zamiast zgadywać z kodu.
2. **Godzina zapisu sprzedaży przez SQL `NOW()`, nie obiekt Date z Node** (`288fd4c`) —
   ważne, inna warstwa tego samego problemu co naprawa z 11.08 (`db-strefa.js`). Ta naprawa
   objęła TYLKO `NOW()` w SQL; INSERT-y w `routes/sprzedaz.js` (add_sale, add_multi_sale,
   add_zwrot), `konsultacje.js`, `magazyn.js`, `klienci.js` (RODO zwrot zadatku) przekazywały
   gotowy obiekt `new Date()` jako parametr — mysql2 serializuje takie obiekty wg strefy
   PROCESU Node (na Hostingerze: UTC), **całkowicie pomijając `SET time_zone` z połączenia**.
   Efekt: sprzedaż wchodziła z godziną ~2h za wcześnie, mimo że Zadatki (już przez `NOW()`)
   miały dobrą godzinę. **Jeśli znajdziesz gdzieś jeszcze `db.query(... , [..., new Date(), ...])`
   dla kolumny DATETIME — to ten sam błąd, zamień na literal `NOW()` w SQL.**
3. **PILNE (już naprawione): podgląd dokumentów (RODO/regulamin/dodatkowe) pokazywał puste
   zakładki** (`150021b`) — regresja z WCZEŚNIEJSZEJ (sprzed tego dnia) naprawy "sesja wygasła
   pokazuje czarną stronę z JSON-em". Przyczyna: `window.open('', '_blank', 'noopener')` zwraca
   `null` jako referencję w wielu przeglądarkach (Firefox zawsze, Chrome często) — karta
   zostawała trwale niesterowalna. Fix: bez `'noopener'` (bezpieczne, bo ta karta ładuje
   WYŁĄCZNIE własny `blob:` z PDF-em). **Nauka: przy `window.open('', ...)` + późniejszej
   nawigacji z callbacku (fetch/XHR) NIGDY nie używać `noopener` — sprawdzać `okno !== null`
   nie wystarczy, bo problem odtwarza się subtelnie w różnych przeglądarkach.**
4. **Sesja pracownika sliding** (`4aacde6`, ten sam dzień co punkt 3 wyżej ale wcześniej) —
   `routes/sessions.js` ma teraz `touchSession()`, wołane w `server.js` middleware `/api`
   dla KAŻDEGO żądania (nawet tych przez dispatcher kompatybilności, `req.path==='/'`, który
   wcześniej był całkiem pomijany). 8h liczy się teraz od ostatniej aktywności, nie logowania.
5. **Numer wersji na Pulpicie — w pełni automatyczny** (`721fca9`→`f93b077`→`cb4c203`) —
   **NIE bumpować ręcznie, nigdy.** `server.js` liczy `git rev-parse --short HEAD` + datę/godzinę
   startu procesu RAZ przy starcie, wstawia w `__WERSJA__` w `index.html` (cache w pamięci).
   Format: „Estelio · DD.MM.RRRR, GG:MM · hash". Pełna historia decyzji i uzasadnienie w
   pamięci HP: `feature_numer_wersji_pulpit.md` — **NIE wracać do statycznego stringa**, nawet
   jeśli ktoś o to poprosi (odpowiedz, że to już automat).

## Co weszło 2026-09-10

6. **Weryfikacja duplikatu klienta — dodany telefon** (`45897d6`) — formularz „Nowy Klient"
   (`zapiszNowegoKlienta` w index.html) sprawdzał dotąd tylko podobieństwo imienia/nazwiska
   (fuzzy, zdrobnienia/literówki) — nie łapało duplikatu, gdy ta sama osoba była wpisana w
   zupełnie innej pisowni (polska vs litewska składnia, realny incydent). Dodano niezależny
   sygnał: `normalizujTelefonDoPorownania()` (ostatnie 9 cyfr, ignoruje prefiks kraju).
   Oba sygnały mogą wystąpić razem, oba trafiają do jednego ostrzeżenia.
7. **Analiza Zabiegu → eksport pełnego raportu sprzedażowego (CSV)** (`fdbba5a`) — przycisk
   „📊 Pełny raport (CSV)" w nagłówku sekcji. Pivot zabieg×miesiąc + surowe transakcje w jednym
   pliku, do wgrania do zewnętrznego AI. Metodologia (Mix pominięty z sum, jak w innych
   raportach) opisana w nagłówku samego CSV. Zero zmian backendu — reużywa `full_sales_history`.
8. **Telefon w kartotece zawsze normalizowany** (`5232e67`) — WAŻNE, powiązane z punktem 6 i z
   całym Klubem: `add_client` i `edit_client_data` w `routes/klienci.js` zapisywały telefon
   surowo. Jeśli tablet/telefon personelu autouzupełnił prefiks (+48), kartoteka (MASTER
   rekord, z którym cały Klub się porównuje) miała numer z prefiksem na stałe. Fix: obie akcje
   liczą `normalizujTelefon()` (ta sama funkcja co w Klubie, wyeksportowana z `lojalnosc.js`)
   przed zapisem. **Nie naprawia wstecz już zapisanych numerów z prefiksem — user o tym wie,
   nie proponować korekty bez pytania.**

## Pułapka techniczna odkryta 2026-09-10 (dopisz do rozdz. 9 głównego briefu)

**Testy `klienci.js`: fabryka wykonuje 2 zapytania `CREATE TABLE` przy starcie** (Retail_Sugestie_Zaproponowane,
DoSprawdzeniaPominiete) — sekwencyjny `mockDb(...)` musi mieć 2 wpisy-wypełniacze PRZED
prawdziwymi danymi testu, inaczej realne zapytanie dostaje pusty fallback i test fałszywie
przechodzi (jeśli test nie sprawdza treści) albo fałszywie pada (jeśli sprawdza). `mockDbAlways`
jest odporne (nie zależy od kolejności) — używaj go, chyba że naprawdę potrzebujesz precyzyjnej
sekwencji wielu różnych wyników.

## Tagi (stan na 2026-09-10)

Zasada z 2026-09-02 nadal obowiązuje (tagi datowane, `ostatnia-dobra` ruchoma NIE przestawiana
bez wyraźnej prośby). Sprawdź `git tag -l "ostatnia-dobra*"` — jeśli nie ma datowanego tagu
na `5232e67` lub bliżej, warto zapytać użytkownika o utworzenie kolejnego.

---

# 10a. STAN NA 2026-09-02

Dzień pracy na HP. Wszystko poniżej **wdrożone na produkcję i potwierdzone oczami przez
użytkownika**. `main` = `dev` = `66f9753`.

## Co weszło 2026-09-02

1. **Spis Zadatków — paginacja** (`547b630`): 20 wierszy/strona (wzorzec z Historii sprzedaży),
   szukajka bez zmian; wcześniej cała lista renderowana naraz wieszała telefon.
2. **Klub → Członkowie** (`2159ac8`): sortowanie (domyślnie najwięcej punktów), paginacja 20/str,
   klik w klientkę rozwija historię punktów (akcja `loj_klient`, ostatnie 20 wpisów)
   + przycisk „Przejdź do profilu".
3. **Klub → segment OSOBY „Wybrane klientki"** (`c4a0370`) — **push testowy**: w kampaniach
   i promocjach można wskazać konkretne członkinie (szukajka + chipy, limit 200); wysyłka
   trafia tylko do nich. Scenariusz: kampania na własne konto → sprawdzenie na telefonie →
   dopiero potem „Wszyscy". Backend: `normalizujSegment`/`pasujeSegment`/`segmentIds`/
   `opisSegmentu` + `fakty.id_klienta` w `/klub/me`. **Migracja: `segment_wartosc`
   VARCHAR(160)→TEXT** (Kampanie+Promocje), strażnik po information_schema — wykonana
   na wspólnej bazie przy pierwszym starcie nowego kodu.
   **UWAGA testy: INIT w `tests/lojalnosc.test.js` wzrósł 20→21** (nowy SELECT startowy).
4. **Wyrównanie kolumn dat/punktów w historii Klubu** (`65d8187`) — opis flex:1, data i punkty
   stałe kolumny do prawej (szczegóły Członkiń + kafel w profilu).
5. **Dark mode — seria poprawek** (`b4abf17`, `647386c`, `66f9753`): karty Klubu dostały jasny
   kolor tekstu (sekcja Klubu NIE jest `.card`, więc globalne reguły jej nie łapały — to była
   przyczyna niewidocznych nazwisk), liczniki Przeglądu, oraz audyt całego pliku: łatki dla
   profilu klienta (Szybkie akcje, tab Podsumowanie), Analiza→Pracownik (szczegóły transakcji)
   i tabeli Zadań. Wzorzec łatek: `body.dark-mode <scope> [style*="color:#1f2430"]`.

## Tagi (decyzja użytkownika 2026-09-02)

- **`ostatnia-dobra-2026-09-02` = `66f9753`** — datowany punkt powrotu, produkcja potwierdzona.
- **`ostatnia-dobra` ZOSTAJE na `6907f82`** — użytkownik świadomie nie przestawił ruchomego
  tagu; punkty powrotu prowadzimy teraz przez tagi DATOWANE (`ostatnia-dobra-RRRR-MM-DD`,
  zwykły push, starych nie kasujemy, min. 3 wersje). Konsekwencja: awaryjny revert
  z `POWROT-AWARYJNY.md` (który używa `ostatnia-dobra`) cofnąłby też cały 2026-09-02 —
  przy awarii rozważ revert do tagu datowanego zamiast ruchomego.

## Sprawy zamknięte 2026-09-02

- **Apps Script ODWOŁANE jako PILNE** — stara apka lojalnościowa nigdy nie miała danych
  realnych klientów (tylko testy). Szczegóły w rozdz. 10, nie podnosić ponownie.

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
- **Stare deploye Google Apps Script** — ~~PILNE~~ **ODWOŁANE 2026-09-02**: użytkownik wyjaśnił,
  że stara apka lojalnościowa NIGDY nie miała danych realnych klientów — zatrzymała się na
  testach, w środku są wyłącznie dane testowe. Brak wycieku, brak tematu RODO. Ewentualne
  wyłączenie wdrożeń na koncie Google to zwykłe porządki, nie zagrożenie —
  **nie podnosić tego ponownie jako pilnego.**
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
