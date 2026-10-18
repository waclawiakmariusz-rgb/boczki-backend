# Weryfikacja aneksu „ścieżki płatności” (ChatGPT, 18.10.2026) — co sprawdzone w kodzie

**Zakres:** punkt po punkcie, wyłącznie twierdzenia sprawdzalne w repozytorium. Dowód = plik i funkcja. Nie wprowadzam tu zmian w module zakupów; to materiał wejściowy do ZK-03.1.

## 1. Zarzuty wobec mojego opisu rdzenia

| # | Zarzut | Werdykt | Dowód / co zrobiono |
|---|---|---|---|
| §11.1 | Scenka w §10 jest wewnętrznie sprzeczna: `P-2` raz jest dopłatą, raz wierszem głównym, a zwrot do `P-2` opisany jako zwrot dopłaty | **SŁUSZNY** | Poprawione: dwa osobne paragony (A i B), zwrot wskazuje rzeczywistą dopłatę `A-2`. Dodano fakt, którego wcześniej nie podałem: **wiersz zwrotu ma własny identyfikator z czasu zwrotu** (`add_zwrot`, `routes/sprzedaz.js:1098`), nie numer w paragonie, więc nie należy do zbioru `<baza>-%` i wiąże go wyłącznie `zwrot_do_id` |
| §11.3 | Semantyka zawieszenia niesprawdzona, „nie wymyślaj nieistniejącej kolumny” | **SŁUSZNY, odpowiedź ustalona** | `routes/sprzedaz.js` ~1294: `UPDATE Sprzedaz SET data_waznosci = ?, karnet_zamkniety_w = NULL, karnet_zamkniety_przez = NULL, zawieszenia_liczba = zawieszenia_liczba + 1, zawieszenia_dni_lacznie = zawieszenia_dni_lacznie + ?`. **Nie ma stanu „zamrożony”** — zawieszenie to przesunięcie daty ważności o N dni + dwa liczniki audytowe, przy okazji cofające zakończenie. Operacja działa na `id` albo na całej `grupa_id`. Dla dodatku skutek = zmiana `data_waznosci`, czyli zmiana istotna (`istotne` w `logika.porownajZrodlo`). Dopisane do opisu rdzenia |
| §10 | „Wspomniano decyzję właściciela, lecz nie przytoczono jej treści” | **SŁUSZNY** | Dopisany cytat warunku i zakresu z `ZAKUPY_03_WYNIK.md` §7.1 wraz z warunkiem ponownego otwarcia tematu |
| §11.2 | Rzeczywisty zapis dwóch powielonych ofert przy częściowym portfelu nie jest rozstrzygnięty przez opis | **SŁUSZNY** | Kod agreguje kwoty portfela per `depositId` (`rozliczZadatekAutomatycznie`), a podziału na wiersze dokonuje ekran (`weryfikujZadatek` w `public/index.html`). Z samego kodu nie wynika, ile dopłat powstanie przy powieleniu. Oznaczone w opisie jako **do potwierdzenia próbą**, nie zgadywane |

## 2. Zarzuty techniczne, które się nie potwierdziły

| # | Zarzut | Werdykt | Dowód |
|---|---|---|---|
| §11.4 | „Ekstrakcja bazy paragonu ma rozróżniać pozycje sprzedaży i wiersze SPLIT” | **NIEZASADNY** | Wiersze `…-SPLIT-n` trafiają do tabeli **`Platnosci`** (`routes/sprzedaz.js:599` i 882: `INSERT INTO Platnosci`), nigdy do `Sprzedaz`. Zapytanie dodatku o paragon (`repoSql.zrodloSprzedaz`) czyta wyłącznie `Sprzedaz`, więc nie może ich zobaczyć |
| §11.4 | „`LIKE '<baza>-%'` musi obsługiwać granice identyfikatora” | **W PRAKTYCE NIEZASADNY, z jednym realnym ryzykiem** | Baza ma **stałą długość 15 znaków** (`uniqueIdBase = now.toISOString().replace(/[-:.TZ]/g,'').slice(0,15)`), czyli `RRRRMMDDGGMMSS` + jedna cyfra milisekund. Wzorzec `<15 znaków>-%` nie może „przeciec” na inny paragon, bo prefiks jest pełną bazą. **Realne ryzyko:** dwa paragony wystawione w tym samym oknie 100 ms dostaną tę samą bazę i zleją się w jeden zbiór. Przy jednej recepcji nieosiągalne ręcznie; do odnotowania w kontrakcie, nie do naprawy w rdzeniu |
| §5.1 | Oferta 0 zł „uznana za zwróconą przez warunek `0 >= 0`” | **PRZEDWCZESNY** | Dziś w dodatku **nie ma żadnego porównania absolutnego** kwoty zwrotu do kwoty zakupu — `logika.porownajZrodlo` porównuje wyłącznie **różnicę** sum zwrotów między migawkami. Tej usterki nie ma. Uwaga pozostaje słuszna jako wymaganie na moment, w którym dodam kontrolę stanu absolutnego (punkt 3 niżej) |

## 3. Potwierdzona usterka w module zakupów (nowa, do ZK-03.1)

**Stan absolutny źródła nie jest sprawdzany przy pierwszym imporcie.** `logika.kandydatNaZakup` (`routes/terminarz-zakupy.js:118–127`) odrzuca wiersz usunięty, produkt, wiersz zwrotu, kwotę ujemną, dopłatę, brak ID klientki i pustą nazwę. **Nie patrzy na `zwroty_suma` ani na `karnet_zamkniety_w`**, mimo że oba pola są odczytywane i trafiają do migawki (`repoSql.zrodloSprzedaz`, `logika.migawkaZrodla`). Kolumna `Term_Zakupy.stan_zrodla` ma `DEFAULT 'ok'`, a rejestracja jej nie podnosi.

**Skutek:** pakiet **już w całości zwrócony** albo **ręcznie zakończony** przed pierwszą rejestracją w dodatku zostaje zarejestrowany jako zdrowy zakup ze stanem źródła „ok”. Wykrycie nastąpi dopiero przy **kolejnej** zmianie w Sprzedaży, bo mechanizm porównuje różnice migawek, a pierwsza migawka utrwala stan problematyczny jako punkt odniesienia.

To dokładnie przypadek z aneksu (RP-11) i z ZK-03.1 N06. **Przyjmuję jako potwierdzony błąd P0 do naprawy w ZK-03.1**, z regresją: zakup zwrócony w całości, zwrócony częściowo i zakończony ręcznie **przed** importem → brak automatycznie dostępnego prawa.

## 4. Zgadzam się bez zastrzeżeń (bez potrzeby weryfikacji kodu)

Rozdzielenie pojęć w §2, macierz ścieżek w §3, zakaz proporcji złotówki→zabiegi w §5, niezależność składników pakietu łączonego w §6, tabela zmian źródła w §8 i zasada „nie zmieniaj Sprzedaży” pokrywają się z kontraktem źródeł ZK-03 i z opisem rdzenia. Punkt §12 („nie buduj rat, należności, voucherów usługowych, fiskalizacji, konwersji portfela”) jest zgodny ze stanem faktycznym: tych rzeczy w rdzeniu nie ma.

Uwaga o równoczesności (§10) jest technicznie poprawna: decyzja organizacyjna właściciela ogranicza częstotliwość, ale nie jest gwarancją techniczną. Dlatego decyzja została przytoczona z zakresem i warunkiem ponownego otwarcia, a bramka N06 pozostaje otwarta.

## 5. Co z tego wynika dla kolejności prac

Zakres ZK-03.1 nie rośnie w istotny sposób: dochodzi jedna potwierdzona usterka (punkt 3) i dwie próby do wykonania (powielenie z częściowym portfelem; zwrot/zakończenie przed importem). Reszta aneksu to doprecyzowanie wymagań, które już były w N01–N12. Kolejność bez zmian: zadanie o sesjach między procesami, potem ZK-03.1 z regresjami, potem kreator dla recepcji. Bez migracji wspólnej bazy i bez aktywacji ewidencji.
